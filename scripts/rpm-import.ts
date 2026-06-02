/**
 * rpm-import — RPM Carbon 同步:entry / orchestration(S3b 改讀報價單乾淨 view)
 *
 * 來源(唯讀、絕不寫):報價單 B庫 `dllwkkfanaebrsuyuedy` 乾淨 view `storefront_catalog_v`
 *   WHERE supplier_slug='rpm';用 anon publishable key(讀不到成本/蝦皮/經銷)。
 * 目標(寫):pcm-website-v2 `bmpnplmnldofgaohnaok`
 *   products + product_variants;brands/categories 已 16b-1 seed;唯一鍵=複合(S3a 已套用)。
 *
 * 跑法:
 *   pnpm dlx tsx scripts/rpm-import.ts --dry-run [--group=APRILIA-01] [--limit=3]
 *     → 跑 pv_spec preflight + 兩層價格 delta gate、印清單、不寫(S3b-2 看 delta、Sean 點頭依據)
 *   pnpm dlx tsx scripts/rpm-import.ts --confirm-price-delta
 *     → 正式寫入;硬 gate:異常列(null/0/負)一律 abort、正常價格變動須帶 --confirm-price-delta 才放行
 *
 * env(repo 根 .env.local、不入 git):
 *   QUOTE_SUPABASE_URL / QUOTE_SUPABASE_PUBLISHABLE_KEY(來源報價單 view、anon 唯讀)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(目標寫)
 *   註(S3b):來源改吃 QUOTE_*(取代 S2 退役的 SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SECRET_KEY raw 讀)。
 *
 * 🔴 紅線(S3b):各段檔頭(rpm-fetch 讀乾淨 view 濾 supplier_slug='rpm';
 *   rpm-transform price_retail→price_general〔零售〕/ price_store 欄 NULL / 停寫敏感 metadata;
 *   rpm-delta 兩層價格硬 gate + pv_spec preflight)。
 */

import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');

import { createClient } from '@supabase/supabase-js';
import { fetchAllRpmProducts, type SourceProductRow } from './rpm-fetch';
import {
  transformGroup,
  transformVariant,
  variantSortKey,
  type ProductRow,
  type VariantRow,
} from './rpm-transform';
import { resolveId, upsertBatched } from './rpm-load';
import {
  computeDelta,
  printDeltaReport,
  hasPriceChange,
  hasAbnormal,
  preflightSpecUnique,
} from './rpm-delta';

// ── constants ──
const BRAND_SLUG = 'rpm-carbon';
const CATEGORY_RAW_PATH = '碳纖維部品';
const ALLOWED_TARGET_REF = 'bmpnplmnldofgaohnaok'; // prod-safety:只准寫這個 dev project

// ── CLI args ──
const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM_PRICE_DELTA = process.argv.includes('--confirm-price-delta'); // 正式寫入放行價格變動
const GROUP_FILTER = argValue('--group'); // 篩單群(dry-run 驗 / D5 單群上線抽驗)
const LIMIT = Number(argValue('--limit') ?? '0') || 0; // 篩前 N 群(dry-run)

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set(填 repo 根 .env.local)`);
  return v;
}

// ── main ──
async function main(): Promise<void> {
  const now = new Date().toISOString();
  const source = createClient(
    requireEnv('QUOTE_SUPABASE_URL'),
    requireEnv('QUOTE_SUPABASE_PUBLISHABLE_KEY'),
  );
  const targetUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  if (!targetUrl.includes(ALLOWED_TARGET_REF)) {
    throw new Error(`prod-safety:目標 URL 非 ${ALLOWED_TARGET_REF}、拒寫(${targetUrl})`);
  }
  const target = createClient(targetUrl, requireEnv('SUPABASE_SECRET_KEY'));

  console.log(`[rpm-import] ${DRY_RUN ? 'DRY-RUN' : 'WRITE'} 模式 / 讀報價單乾淨 view…`);
  const [products, brandId, categoryId] = await Promise.all([
    fetchAllRpmProducts(source),
    resolveId(target, 'brands', 'slug', BRAND_SLUG),
    resolveId(target, 'categories', 'raw_path', CATEGORY_RAW_PATH),
  ]);
  console.log(`[rpm-import] 來源 view RPM 變體 ${products.length} 筆;brand_id=${brandId} category_id=${categoryId}`);

  // 分群(view.main_sku、廢 computeMainSku regex)
  const groups = new Map<string, SourceProductRow[]>();
  for (const p of products) {
    const list = groups.get(p.main_sku);
    if (list) list.push(p);
    else groups.set(p.main_sku, [p]);
  }
  console.log(`[rpm-import] 分群 ${groups.size} 群`);

  // 篩選(dry-run --group / --limit)
  let entries = [...groups.entries()];
  if (GROUP_FILTER) entries = entries.filter(([m]) => m === GROUP_FILTER.toUpperCase());
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);

  // 轉換
  const productRows: ProductRow[] = [];
  const variantsByExternalId = new Map<string, VariantRow[]>();
  for (const [mainSku, variants] of entries) {
    const vehicleLabel = variants.find((v) => v.vehicle_label)?.vehicle_label ?? ''; // 群內第一個非空
    const pr = transformGroup(mainSku, variants, vehicleLabel, brandId, categoryId, now);
    productRows.push(pr);
    const sorted = [...variants].sort((a, b) => (variantSortKey(a) < variantSortKey(b) ? -1 : 1));
    variantsByExternalId.set(
      pr.external_id,
      sorted.map((v, idx) => transformVariant(v, now, idx)),
    );
  }
  const variantRows = [...variantsByExternalId.values()].flat();

  // ── 硬 gate 1:pv_spec_unique preflight(source 群內 + target 模擬)──
  const collisions = await preflightSpecUnique(target, variantsByExternalId);
  if (collisions.length) {
    console.error(`[rpm-import] 🔴 pv_spec_unique preflight 撞鍵 ${collisions.length} 群、abort 不寫:`);
    console.table(collisions.slice(0, 50));
    throw new Error('pv_spec_unique preflight 撞鍵、停止(避免部分寫的髒中間態)');
  }

  // ── 價格 delta gate(兩層、唯讀比對)──
  const delta = await computeDelta(target, productRows, variantRows);
  printDeltaReport(delta);

  if (DRY_RUN) {
    const sample = productRows[0];
    if (sample) {
      const vrs = variantsByExternalId.get(sample.external_id)!;
      console.log('\n-- 抽樣群(transform 驗) --');
      console.log(JSON.stringify({ product: sample, variant_count: vrs.length, sample_variants: vrs.slice(0, 3) }, null, 2));
    }
    console.log(`\n[rpm-import] DRY-RUN:${productRows.length} 群 / ${variantRows.length} 變體(未寫入)`);
    console.log('→ 看完 delta 清單、Sean 點頭後、跑正式並帶 --confirm-price-delta');
    return;
  }

  // ── 硬 gate 2:正式寫入價格守門 ──
  if (hasAbnormal(delta)) {
    throw new Error(`價格異常列 ${delta.abnormal.length}(null/0/負)、不可覆寫硬 abort、停止(查源頭)`);
  }
  if (hasPriceChange(delta) && !CONFIRM_PRICE_DELTA) {
    throw new Error('偵測到價格變動、須先看 dry-run delta + Sean 點頭、正式跑帶 --confirm-price-delta 才放行');
  }
  console.log(`[rpm-import] 價格 gate 放行(price_change=${hasPriceChange(delta)} confirm=${CONFIRM_PRICE_DELTA})`);
  if (GROUP_FILTER || LIMIT > 0) {
    console.warn(`⚠️ WRITE 模式僅寫部分 ${productRows.length} 群(--group/--limit 篩選後)、非全量(D5 單群上線抽驗用;全量請去除篩選)`);
  }

  // 寫入:products(每批 .select 累積 id↔external_id 對照)→ product_variants;onConflict 複合鍵(S3a)
  const savedProducts = await upsertBatched(target, 'products', productRows, 'supplier_slug,external_id', 'id, external_id');
  const idByExtId = new Map(savedProducts.map((r) => [r.external_id as string, r.id as string]));

  const variantRowsWithProduct = productRows.flatMap((pr) =>
    variantsByExternalId.get(pr.external_id)!.map((vr) => ({ ...vr, product_id: idByExtId.get(pr.external_id)! })),
  );
  await upsertBatched(target, 'product_variants', variantRowsWithProduct, 'supplier_slug,sku');
  console.log(`[rpm-import] WRITE 完成:${productRows.length} 商品 / ${variantRowsWithProduct.length} 變體`);
}

main().catch((e) => {
  console.error('[rpm-import] FAILED:', e);
  process.exit(1);
});
