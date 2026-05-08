/**
 * M-1-03 main-c spike — round-trip 5 case + clean up
 *
 * 對齊:
 * - docs/architecture/medusa-spike-verification-checklist.md §2.1 5 步:建 → 查 → map → 比對 → clean up
 * - docs/specs/M-1-03-main-b-PRD.md §1.2 + §6.2(main-c spike 範圍 + priceByTier 不洩漏 mapper boundary)
 * - docs/architecture/supabase-schema-design.md §2-§6 + §9.2(schema + RLS)
 * - docs/decisions/0003-domain-entity-naming.md §3.4-§3.5 + §4(domain 邊界 wire 紀律)
 *
 * 5 case:
 * - C1 brand JOIN(adapter.findById + listByBrand cardinality)
 * - C2 category JOIN(adapter.listByCategory)
 * - C3 fitment jsonb @> + matchFitmentYear 4 種年份狀態(無年份 / 範圍 / 開放式 / 單年)
 *   注:Sean 字面 C3 spec '(year=...)' 與 matchFitmentYear 真實簽名 (actual: FitmentSpec, spec: FitmentSpec)
 *   偏離(spec 本身就是 FitmentSpec 含 yearStart/yearEnd、無 year 欄位);本 spike 用 spec.yearStart 設值對齊
 *   真實簽名(對齊累積教訓 #4 規範類偏離精神 — 真權威 helpers/fitment.ts:L123 為準)
 * - C4 priceByTier mapper boundary(adapter.findById F5 + 三點 assert,對齊 main-b PRD §6.1
 *   adapter 邊界保留完整 priceByTier 三 tier、不洩漏為 use-case 層責任)
 * - C6 empty fitments=[](listByFitment 不含 F4 + findById F4 fitments=[])
 *
 * C5 nullable 已由 drift-fix slice(commit 93ba36e)從根本解(schema NOT NULL + ERROR 23502 已驗)、
 * 本 spike 不重複驗(對齊 sub-slice 2 v2 指令 Q5 拍板)。
 *
 * 跑法:pnpm dlx tsx scripts/spikes/M-1-03-main-c-roundtrip.ts
 *
 * spike 純驗、不修 adapter / mapper / helper / domain / ports / schema。
 * 全程 service_role(對齊 supabase-schema-design.md §6 + §9.2)、不用 anon。
 * fixture 'spike-fixture-' 前綴 便於 clean up grep(handle / brand.slug / category.raw_path)。
 * FK ON DELETE RESTRICT 順序 clean up:products → categories → brands(對齊 schema §2.1 真權威)。
 */

import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');

import { createSupabaseServiceClient } from '../../packages/adapters/src/supabase/client';
import { SupabaseProductAdapter } from '../../packages/adapters/src/supabase/SupabaseProductAdapter';
import { matchFitmentYear } from '../../packages/adapters/src/supabase/helpers/fitment';
import type { CategoryPath, FitmentSpec, MemberTier, Money } from '@pcm/domain';

const PREFIX = 'spike-fixture-';
const BRAND_NAME = `${PREFIX}brand`;
const BRAND_SLUG = `${PREFIX}brand`;
const CAT_A_RAW = `${PREFIX}cat-a`;
const CAT_B_RAW = `${PREFIX}cat-b`;

/**
 * Prod-safety guard:white-list 模式、只允許跑在指定 Supabase dev project ref。
 *
 * spike script 是 destructive(setup INSERT + cleanup DELETE 對 'spike-fixture-' 前綴);若
 * .env.local 字面誤指 prod URL、cleanup 會刪除任何 prefix 撞上的 row。Phase 1 階段 1 dev
 * project ref 寫死(對齊 audit 立即修 + Sean Q1=A1 拍板);Phase 2 multi-env 觸發時白名單擴。
 *
 * Override:`ALLOWED_DEV_REF` env var(顯式 opt-in、不替代字面 default、避免靜默誤跑)。
 */
const DEFAULT_ALLOWED_DEV_REF = 'bmpnplmnldofgaohnaok';

function assertDevProject(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const allowedRef = process.env.ALLOWED_DEV_REF ?? DEFAULT_ALLOWED_DEV_REF;
  if (!url.includes(allowedRef)) {
    throw new Error(
      `spike-script aborted: SUPABASE_URL not whitelisted dev project. ` +
        `Spike scripts only allow project ref containing '${allowedRef}'. ` +
        `If you intentionally want to run against another project, set ALLOWED_DEV_REF env var.`,
    );
  }
}

const supabase = createSupabaseServiceClient();
const adapter = new SupabaseProductAdapter(supabase);

type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}: ${detail}`);
}

const tier3 = (g: number, s: number, p: number) => ({
  general: { amount: g, currency: 'TWD' },
  store: { amount: s, currency: 'TWD' },
  premiumStore: { amount: p, currency: 'TWD' },
});

async function insertBrand(name: string, slug: string): Promise<string> {
  const { data, error } = await supabase
    .from('brands')
    .insert({ name, slug })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function insertCategory(rawPath: string, leafName: string, segments: string[]): Promise<string> {
  const { data, error } = await supabase
    .from('categories')
    .insert({
      name: leafName,
      raw_path: rawPath,
      segments,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function insertProduct(row: {
  handle: string;
  title: string;
  brandId: string;
  categoryId: string;
  priceByTier: Record<MemberTier, { amount: number; currency: string }>;
  fitments: object[];
}): Promise<string> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      external_id: row.handle,
      handle: row.handle,
      title: row.title,
      brand_id: row.brandId,
      category_id: row.categoryId,
      price_by_tier: row.priceByTier,
      fitments: row.fitments,
      // images / availability / metadata 走 default('[]' / 'in-stock' / '{}')
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function cleanUp(): Promise<{ p: number; c: number; b: number }> {
  // FK ON DELETE RESTRICT 順序:products → categories → brands
  const { error: pe } = await supabase.from('products').delete().like('handle', `${PREFIX}%`);
  if (pe) throw pe;
  const { error: ce } = await supabase.from('categories').delete().like('raw_path', `${PREFIX}%`);
  if (ce) throw ce;
  const { error: be } = await supabase.from('brands').delete().like('slug', `${PREFIX}%`);
  if (be) throw be;

  // 三表 0 row 驗證
  const { data: pLeft } = await supabase.from('products').select('id').like('handle', `${PREFIX}%`);
  const { data: cLeft } = await supabase.from('categories').select('id').like('raw_path', `${PREFIX}%`);
  const { data: bLeft } = await supabase.from('brands').select('id').like('slug', `${PREFIX}%`);
  return {
    p: (pLeft as unknown[] | null)?.length ?? 0,
    c: (cLeft as unknown[] | null)?.length ?? 0,
    b: (bLeft as unknown[] | null)?.length ?? 0,
  };
}

async function main(): Promise<void> {
  // Prod-safety guard:setup 任何 INSERT 之前 abort、防 .env.local URL 誤指 prod
  assertDevProject();

  let brandId = '';
  let catAId = '';
  let catBId = '';
  const pids: Record<string, string> = {};

  try {
    // ============ 建 brand + 2 category ============
    brandId = await insertBrand(BRAND_NAME, BRAND_SLUG);
    catAId = await insertCategory(CAT_A_RAW, 'a', [`${PREFIX}cat`, 'a']);
    catBId = await insertCategory(CAT_B_RAW, 'b', [`${PREFIX}cat`, 'b']);
    console.log(`Setup: brand=${brandId.slice(0, 8)}.. catA=${catAId.slice(0, 8)}.. catB=${catBId.slice(0, 8)}..`);

    // ============ 建 5 fixture products ============
    // F1 正常(C1 + C2 用)
    pids.f1 = await insertProduct({
      handle: `${PREFIX}f1`,
      title: 'F1 normal',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [{ motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2018, yearEnd: 2024 }],
    });

    // F2 4 fitment 狀態 — 拆 4 個 product 各 1 fitment 1 狀態(避免 1-product-4-fitment 設計
    // 在 client-side `fitments.some(matchFitmentYear)` short-circuit 時交叉污染、無法精確驗 4 狀態;
    // adapter listByFitment 真實業務行為 = product 有任何 fitment match year 就通過、client 端
    // 不 cross-check motoBrand+modelCode、對齊 PRD §3.4)。同 brand+catA、不同 modelCode 區隔。
    pids.f2_noYear = await insertProduct({
      handle: `${PREFIX}f2-noYear`,
      title: 'F2 noYear',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [{ motoBrand: 'Honda', modelCode: 'noYear' }], // yearStart undef / yearEnd undef
    });
    pids.f2_range = await insertProduct({
      handle: `${PREFIX}f2-range`,
      title: 'F2 range',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [{ motoBrand: 'Honda', modelCode: 'range', yearStart: 2018, yearEnd: 2024 }],
    });
    pids.f2_open = await insertProduct({
      handle: `${PREFIX}f2-open`,
      title: 'F2 open',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [{ motoBrand: 'Honda', modelCode: 'open', yearStart: 2025, yearEnd: null }],
    });
    pids.f2_single = await insertProduct({
      handle: `${PREFIX}f2-single`,
      title: 'F2 single',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [{ motoBrand: 'Honda', modelCode: 'single', yearStart: 2024, yearEnd: 2024 }],
    });

    // F4 empty fitments(C6 用)
    pids.f4 = await insertProduct({
      handle: `${PREFIX}f4`,
      title: 'F4 empty fitments',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [],
    });

    // F5 priceByTier 顯著差異(C4 用)
    pids.f5 = await insertProduct({
      handle: `${PREFIX}f5`,
      title: 'F5 priceByTier diverse',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(1000, 800, 760),
      fitments: [{ motoBrand: 'Ducati', modelCode: 'Panigale', yearStart: 2020, yearEnd: null }],
    });

    // F6 同 brand 不同 category(C1 listByBrand cardinality 用)
    pids.f6 = await insertProduct({
      handle: `${PREFIX}f6`,
      title: 'F6 different category same brand',
      brandId,
      categoryId: catBId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [{ motoBrand: 'BMW', modelCode: 'S1000RR' }],
    });

    // F7 跨車型(C3i 用)— 同 product 含 2 條不同車型 fitment、驗 client-side 三條 cross-check 修
    // 對齊 sub-slice 2.5 commit:fitment A 含 spec brand+model 且 year-out / fitment B 不含 spec brand+model 但 year-match
    pids.f7 = await insertProduct({
      handle: `${PREFIX}f7`,
      title: 'F7 cross-vehicle false positive guard',
      brandId,
      categoryId: catAId,
      priceByTier: tier3(4500, 4000, 3800),
      fitments: [
        { motoBrand: 'Yamaha', modelCode: 'R1', yearStart: 2018, yearEnd: 2024 },
        { motoBrand: 'Honda', modelCode: 'CBR600RR', yearStart: 2010, yearEnd: 2012 },
      ],
    });

    console.log(
      `Inserted 9 products: F1=${pids.f1!.slice(0, 8)}.. F2[noYear/range/open/single]=${pids.f2_noYear!.slice(0, 8)}../${pids.f2_range!.slice(0, 8)}../${pids.f2_open!.slice(0, 8)}../${pids.f2_single!.slice(0, 8)}.. F4=${pids.f4!.slice(0, 8)}.. F5=${pids.f5!.slice(0, 8)}.. F6=${pids.f6!.slice(0, 8)}.. F7=${pids.f7!.slice(0, 8)}..`,
    );

    // ============ C1 brand JOIN ============
    const p1 = await adapter.findById(pids.f1!);
    if (!p1) {
      record('C1a brand JOIN findById', false, 'F1 returned null');
    } else {
      const okBrand =
        p1.brand.id === brandId &&
        p1.brand.name === BRAND_NAME &&
        p1.brand.slug === BRAND_SLUG &&
        typeof p1.brand.id === 'string' &&
        typeof p1.brand.name === 'string' &&
        typeof p1.brand.slug === 'string';
      record(
        'C1a brand JOIN findById',
        okBrand,
        okBrand
          ? `Brand value-object {id,name,slug} resolved: ${p1.brand.name}`
          : `Brand mismatch: ${JSON.stringify(p1.brand)}`,
      );
    }

    const byBrand = await adapter.listByBrand(brandId);
    const byBrandIds = new Set(byBrand.map((p) => p.id));
    const allFixtureIds = [pids.f1, pids.f2_noYear, pids.f2_range, pids.f2_open, pids.f2_single, pids.f4, pids.f5, pids.f6, pids.f7];
    const expectAll9 = allFixtureIds.every((id) => byBrandIds.has(id!));
    record(
      'C1b brand JOIN listByBrand cardinality',
      byBrand.length >= 2 && expectAll9,
      `listByBrand returned ${byBrand.length} rows, contains all 9 fixture products: ${expectAll9}`,
    );

    // ============ C2 category JOIN ============
    const catA: CategoryPath = { raw: CAT_A_RAW, segments: [`${PREFIX}cat`, 'a'] };
    const byCat = await adapter.listByCategory(catA);
    const byCatIds = new Set(byCat.map((p) => p.id));
    const okCatShape = byCat.length > 0 && byCat.every((p) =>
      typeof p.category.raw === 'string' &&
      Array.isArray(p.category.segments) &&
      p.category.raw === CAT_A_RAW
    );
    const expectCatA =
      byCatIds.has(pids.f1!) &&
      byCatIds.has(pids.f2_noYear!) &&
      byCatIds.has(pids.f2_range!) &&
      byCatIds.has(pids.f2_open!) &&
      byCatIds.has(pids.f2_single!) &&
      byCatIds.has(pids.f4!) &&
      byCatIds.has(pids.f5!) &&
      byCatIds.has(pids.f7!) &&
      !byCatIds.has(pids.f6!); // F6 in catB
    record(
      'C2 category JOIN listByCategory',
      okCatShape && expectCatA,
      okCatShape && expectCatA
        ? `listByCategory(${CAT_A_RAW}) returned ${byCat.length} rows, all CategoryPath shape OK, F1+F2(4 split)+F4+F5+F7 in catA / F6 excluded(in catB)`
        : `shape OK=${okCatShape}, expectedSet=${expectCatA}`,
    );

    // ============ C3 fitment jsonb @> + matchFitmentYear 4 種年份狀態 ============
    // sub-cases 對齊 sup-schema §2.4 4 狀態 × match/no-match 雙向
    // 注:matchFitmentYear 真實簽名 (actual, spec) 雙 FitmentSpec、spec.yearStart 設值驗

    // C3a 無年份(actual.yearStart=undefined)→ matchFitmentYear 第一行 return true、無論 spec.yearStart 為何
    const c3a = await adapter.listByFitment({ motoBrand: 'Honda', modelCode: 'noYear', yearStart: 2050 });
    const c3aPass = c3a.some((p) => p.id === pids.f2_noYear);
    record('C3a 無年份 + spec yearStart=2050', c3aPass, c3aPass ? 'F2_noYear in result(actual.yearStart undef → match all)' : `F2_noYear not in (${c3a.length} rows)`);

    // C3b 範圍 in-range(2018-2024 + spec.yearStart=2020)→ match
    const c3b = await adapter.listByFitment({ motoBrand: 'Honda', modelCode: 'range', yearStart: 2020 });
    const c3bPass = c3b.some((p) => p.id === pids.f2_range);
    record('C3b 範圍 spec yearStart=2020', c3bPass, c3bPass ? 'F2_range in result(2020 ∈ [2018,2024])' : `F2_range not in (${c3b.length} rows)`);

    // C3c 範圍 out-of-range(2018-2024 + spec.yearStart=2017)→ no match
    const c3c = await adapter.listByFitment({ motoBrand: 'Honda', modelCode: 'range', yearStart: 2017 });
    const c3cPass = !c3c.some((p) => p.id === pids.f2_range);
    record('C3c 範圍 spec yearStart=2017', c3cPass, c3cPass ? 'F2_range correctly excluded(2017 < 2018)' : `F2_range wrongly in result`);

    // C3d 開放式 below(2025+ + spec.yearStart=2024)→ no match
    const c3d = await adapter.listByFitment({ motoBrand: 'Honda', modelCode: 'open', yearStart: 2024 });
    const c3dPass = !c3d.some((p) => p.id === pids.f2_open);
    record('C3d 開放式 spec yearStart=2024', c3dPass, c3dPass ? 'F2_open correctly excluded(2024 < 2025)' : `F2_open wrongly in result`);

    // C3e 開放式 above(2025+ + spec.yearStart=2030)→ match
    const c3e = await adapter.listByFitment({ motoBrand: 'Honda', modelCode: 'open', yearStart: 2030 });
    const c3ePass = c3e.some((p) => p.id === pids.f2_open);
    record('C3e 開放式 spec yearStart=2030', c3ePass, c3ePass ? 'F2_open in result(2030 ∈ [2025,Infinity])' : `F2_open not in (${c3e.length} rows)`);

    // C3f 單年 match(2024 + spec.yearStart=2024)→ match
    const c3f = await adapter.listByFitment({ motoBrand: 'Honda', modelCode: 'single', yearStart: 2024 });
    const c3fPass = c3f.some((p) => p.id === pids.f2_single);
    record('C3f 單年 spec yearStart=2024', c3fPass, c3fPass ? 'F2_single in result(2024 = 2024)' : `F2_single not in (${c3f.length} rows)`);

    // C3g 單年 mismatch(2024 + spec.yearStart=2025)→ no match
    const c3g = await adapter.listByFitment({ motoBrand: 'Honda', modelCode: 'single', yearStart: 2025 });
    const c3gPass = !c3g.some((p) => p.id === pids.f2_single);
    record('C3g 單年 spec yearStart=2025', c3gPass, c3gPass ? 'F2_single correctly excluded(2025 ≠ 2024)' : `F2_single wrongly in result`);

    // C3h matchFitmentYear 直接調用驗 4 actual 狀態(對 spec.yearStart=2020 中性 spec)
    // 對齊 sup-schema §2.4 真權威字面、不依賴 listByFitment server-side filter
    const noYearActual: FitmentSpec = { motoBrand: 'X', modelCode: 'X' };
    const rangeActual: FitmentSpec = { motoBrand: 'X', modelCode: 'X', yearStart: 2018, yearEnd: 2024 };
    const openActual: FitmentSpec = { motoBrand: 'X', modelCode: 'X', yearStart: 2025, yearEnd: null };
    const singleActual: FitmentSpec = { motoBrand: 'X', modelCode: 'X', yearStart: 2024, yearEnd: 2024 };
    const spec2020: FitmentSpec = { motoBrand: 'X', modelCode: 'X', yearStart: 2020 };
    const c3hExpect =
      matchFitmentYear(noYearActual, spec2020) === true &&
      matchFitmentYear(rangeActual, spec2020) === true &&
      matchFitmentYear(openActual, spec2020) === false &&
      matchFitmentYear(singleActual, spec2020) === false;
    record('C3h matchFitmentYear 4 actual × spec.yearStart=2020', c3hExpect,
      c3hExpect
        ? '無年份=true / 範圍 2018-2024=true / 開放式 2025+=false / 單年 2024=false 全對齊'
        : `行為偏離 sup-schema §2.4`);

    // ============ C3i 跨車型 false positive 防護 ============
    // F7.fitments=[{Yamaha,R1,2018-2024},{Honda,CBR600RR,2010-2012}]
    // 修前(只 matchFitmentYear year-only):spec=(Honda,CBR600RR,2020) → server @> 通過 +
    //   client some over fitments → Yamaha R1 fitment(2018-2024 含 2020)matchFitmentYear=true
    //   → F7 false positive in result。
    // 修後(三條 cross-check brand+model+year):各 fitment cross-check 該條 brand+model+year 三條全符,
    //   Honda CBR fitment year=2020 不在 [2010,2012] → false / Yamaha R1 fitment brand 不對 → false
    //   → F7 correctly excluded。
    const c3iCross = await adapter.listByFitment({
      motoBrand: 'Honda',
      modelCode: 'CBR600RR',
      yearStart: 2020,
      yearEnd: 2020,
    });
    const c3iCrossPass = !c3iCross.some((p) => p.id === pids.f7);
    record('C3i 跨車型 false positive 防護:spec=(Honda,CBR600RR,2020) F7 should excluded', c3iCrossPass,
      c3iCrossPass
        ? `F7 correctly excluded(Honda CBR fitment 2010-2012 不 cover 2020、Yamaha R1 fitment brand 不對齊)`
        : `F7 wrongly in result — cross-車型 false positive 仍存在`);

    // C3i 對照組:正常 match 應仍通過
    const c3iPositive = await adapter.listByFitment({
      motoBrand: 'Yamaha',
      modelCode: 'R1',
      yearStart: 2020,
      yearEnd: 2020,
    });
    const c3iPositivePass = c3iPositive.some((p) => p.id === pids.f7);
    record('C3i 對照組:spec=(Yamaha,R1,2020) F7 should match', c3iPositivePass,
      c3iPositivePass
        ? `F7 in result(Yamaha R1 fitment 2018-2024 cover 2020、三條全符)`
        : `F7 not in result — 修法過頭、正常 match 也壞了`);

    // ============ C4 priceByTier mapper boundary ============
    const p5 = await adapter.findById(pids.f5!);
    if (!p5) {
      record('C4 priceByTier mapper boundary', false, 'F5 returned null');
    } else {
      // (a) Product 物件 key = 'priceByTier' camelCase / 不含 wire 字面 'price_by_tier' snake_case
      const noWireKey = !('price_by_tier' in p5);
      const hasDomainKey = 'priceByTier' in p5;
      // (b) 三 tier 全在、Money 結構
      const all3Tier =
        p5.priceByTier &&
        'general' in p5.priceByTier &&
        'store' in p5.priceByTier &&
        'premiumStore' in p5.priceByTier;
      const moneyStructure =
        all3Tier &&
        typeof (p5.priceByTier as Record<MemberTier, Money>).general.amount === 'number' &&
        (p5.priceByTier as Record<MemberTier, Money>).general.currency === 'TWD' &&
        (p5.priceByTier as Record<MemberTier, Money>).general.amount === 1000 &&
        (p5.priceByTier as Record<MemberTier, Money>).store.amount === 800 &&
        (p5.priceByTier as Record<MemberTier, Money>).premiumStore.amount === 760;
      // (c) Money.amount 是整數(toMoneyAmount guard 通過、否則 mapper 會 throw)
      const integerAmount =
        Number.isInteger((p5.priceByTier as Record<MemberTier, Money>).general.amount) &&
        Number.isInteger((p5.priceByTier as Record<MemberTier, Money>).store.amount) &&
        Number.isInteger((p5.priceByTier as Record<MemberTier, Money>).premiumStore.amount);
      const allOk = noWireKey && hasDomainKey && all3Tier && moneyStructure && integerAmount;
      record(
        'C4 priceByTier mapper boundary',
        allOk,
        allOk
          ? `wire 'price_by_tier' absent / domain 'priceByTier' present / 3 tier complete (general=1000 store=800 premiumStore=760, all integer/TWD; toMoneyAmount guard passed)`
          : `noWire=${noWireKey} hasCamel=${hasDomainKey} 3tier=${all3Tier} money=${moneyStructure} integer=${integerAmount}`,
      );
    }

    // ============ C6 empty fitments=[] ============
    // (a) listByFitment(任意非空 spec)→ F4 不在 result(.contains 對 empty array @> false)
    const c6aList = await adapter.listByFitment({ motoBrand: 'Yamaha', modelCode: 'R1' });
    const c6aPass = !c6aList.some((p) => p.id === pids.f4);
    record('C6a empty fitments not in listByFitment', c6aPass,
      c6aPass ? `F4 correctly excluded(empty array [] @> [{...}] = false)` : `F4 wrongly in result`);

    // (b) findById(F4) → returns Product、fitments=[]、不 throw
    const p4 = await adapter.findById(pids.f4!);
    const c6bPass = p4 !== null && Array.isArray(p4.fitments) && p4.fitments.length === 0;
    record('C6b empty fitments findById', c6bPass,
      c6bPass ? `F4 returned, fitments=[] preserved` : `F4: ${p4 ? `fitments=${JSON.stringify(p4.fitments)}` : 'null'}`);

    // ============ Step 4 — Clean up ============
    console.log('\n--- Clean up ---');
    const left = await cleanUp();
    if (left.p === 0 && left.c === 0 && left.b === 0) {
      console.log(`✅ Clean up complete: products=0 categories=0 brands=0`);
    } else {
      console.log(`❌ Clean up incomplete: products=${left.p} categories=${left.c} brands=${left.b}`);
      process.exit(1);
    }

    // ============ 結果統計 ============
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n=== ${passed}/${passed + failed} sub-cases PASS, ${failed} FAIL ===`);
    if (failed > 0) {
      console.log('\nFailed sub-cases:');
      results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
      process.exit(1);
    }
    console.log('\n5 case 全 PASS(C1+C2+C3 [8 sub-cases]+C4+C6 [2 sub-cases]= 13 sub-cases all green)');
  } catch (e) {
    console.error('Spike script error:', e);
    // emergency clean up
    try {
      const left = await cleanUp();
      console.log(`Emergency clean up done: products=${left.p} categories=${left.c} brands=${left.b}`);
    } catch (cleanErr) {
      console.error('Emergency clean up failed:', cleanErr);
    }
    process.exit(1);
  }
}

main();
