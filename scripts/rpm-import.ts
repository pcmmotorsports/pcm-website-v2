/**
 * M-1-16b RPM Carbon 匯入腳本 — entry / orchestration(S2 拆檔後主控段)
 *
 * 來源(唯讀、絕不寫):pcm-quote-v2 `dllwkkfanaebrsuyuedy`
 *   products WHERE supplier_slug='rpm'(7277 變體)+ product_groups_mv(取 vehicle_label)
 * 目標(寫):pcm-website-v2 `bmpnplmnldofgaohnaok`
 *   products(933 群)+ product_variants(7277);brands/categories 已 16b-1 seed
 *
 * 跑法:
 *   pnpm dlx tsx scripts/rpm-import.ts --dry-run [--group=APRILIA-01] [--limit=3]
 *   pnpm dlx tsx scripts/rpm-import.ts            # 全量寫入(16b-3)
 *
 * env(repo 根 .env.local、不入 git;用新式 Secret key `sb_secret_…`、非 legacy service_role JWT):
 *   SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SECRET_KEY(來源唯讀)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(目標寫)
 *   註:import 專用新 SECRET_KEY、不碰 storefront 既有 SUPABASE_SERVICE_ROLE_KEY(legacy、全站遷移留 backlog)
 *
 * 🔴 紅線(對齊 16b plan):見各段檔頭(rpm-fetch 來源濾 supplier_slug='rpm';
 *   rpm-transform price_listing 對外零售 / 經銷敏感欄只進 metadata〔view 排除〕)。
 *
 * S2(2026-06-02):本檔原 415 行、破鐵則 6 元件 400 上限。屬一次性 ETL 腳本(非元件/Hook)、
 *   16d 週同步邏輯疊加前拆檔(原檔頭預告)。拆 fetch / transform / load 三段、純 refactor 行為不變:
 *   - ./rpm-fetch      來源唯讀讀取(wire types + 分頁讀取)
 *   - ./rpm-transform  純轉換(wire → 目標 row、🔴 經銷價防護)
 *   - ./rpm-load       目標寫入(resolveId + 分批冪等 upsert)
 *   本檔留 env / CLI args / 分群 / 篩選 / dry-run / 串接(orchestration)。三段平鋪 scripts/ root
 *   (被 tsconfig.scripts.json + eslint scripts/*.ts 覆蓋、不動 config)。
 */

import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');

import { createClient } from '@supabase/supabase-js';
import { fetchAllRpmProducts, fetchVehicleLabels, type SourceProductRow } from './rpm-fetch';
import {
  computeMainSku,
  transformGroup,
  transformVariant,
  variantSortKey,
  type ProductRow,
  type VariantRow,
} from './rpm-transform';
import { resolveId, upsertBatched } from './rpm-load';

// ── constants ──
const BRAND_SLUG = 'rpm-carbon';
const CATEGORY_RAW_PATH = '碳纖維部品';
const ALLOWED_TARGET_REF = 'bmpnplmnldofgaohnaok'; // prod-safety:只准寫這個 dev project

// ── CLI args ──
const DRY_RUN = process.argv.includes('--dry-run');
const GROUP_FILTER = argValue('--group'); // dry-run 單群
const LIMIT = Number(argValue('--limit') ?? '0') || 0; // dry-run 前 N 群

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
    requireEnv('SOURCE_SUPABASE_URL'),
    requireEnv('SOURCE_SUPABASE_SECRET_KEY'),
  );
  const targetUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  if (!targetUrl.includes(ALLOWED_TARGET_REF)) {
    throw new Error(`prod-safety:目標 URL 非 ${ALLOWED_TARGET_REF}、拒寫(${targetUrl})`);
  }
  const target = createClient(targetUrl, requireEnv('SUPABASE_SECRET_KEY'));

  console.log(`[rpm-import] ${DRY_RUN ? 'DRY-RUN' : 'WRITE'} 模式 / 來源唯讀讀取…`);
  const [products, vehicleLabels, brandId, categoryId] = await Promise.all([
    fetchAllRpmProducts(source),
    fetchVehicleLabels(source),
    resolveId(target, 'brands', 'slug', BRAND_SLUG),
    resolveId(target, 'categories', 'raw_path', CATEGORY_RAW_PATH),
  ]);
  console.log(`[rpm-import] 來源 RPM 變體 ${products.length} 筆;brand_id=${brandId} category_id=${categoryId}`);

  // 分群(main_sku)
  const groups = new Map<string, SourceProductRow[]>();
  for (const p of products) {
    const mainSku = computeMainSku(p.sku);
    const list = groups.get(mainSku);
    if (list) list.push(p);
    else groups.set(mainSku, [p]);
  }
  console.log(`[rpm-import] 分群 ${groups.size} 群(預期 933)`);

  // 篩選(dry-run --group / --limit)
  let entries = [...groups.entries()];
  if (GROUP_FILTER) entries = entries.filter(([m]) => m === GROUP_FILTER.toUpperCase());
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);

  // 轉換
  const productRows: ProductRow[] = [];
  const variantsByExternalId = new Map<string, VariantRow[]>();
  for (const [mainSku, variants] of entries) {
    const pr = transformGroup(mainSku, variants, vehicleLabels.get(mainSku) ?? '', brandId, categoryId, now);
    productRows.push(pr);
    const sorted = [...variants].sort((a, b) => (variantSortKey(a) < variantSortKey(b) ? -1 : 1));
    variantsByExternalId.set(
      pr.external_id,
      sorted.map((v, idx) => transformVariant(v, now, idx)),
    );
  }

  if (DRY_RUN) {
    for (const pr of productRows) {
      const vrs = variantsByExternalId.get(pr.external_id)!;
      console.log('\n' + '─'.repeat(60));
      console.log(JSON.stringify({ product: pr, variant_count: vrs.length, sample_variants: vrs.slice(0, 3) }, null, 2));
    }
    console.log(`\n[rpm-import] DRY-RUN:${productRows.length} 群 / ${[...variantsByExternalId.values()].reduce((n, a) => n + a.length, 0)} 變體(未寫入)`);
    return;
  }

  // 寫入:products(每批 .select 累積 id↔external_id 對照、免大 .in() 超 URL 上限)→ product_variants
  const savedProducts = await upsertBatched(target, 'products', productRows, 'external_id', 'id, external_id');
  const idByExtId = new Map(savedProducts.map((r) => [r.external_id as string, r.id as string]));

  const variantRows = productRows.flatMap((pr) =>
    variantsByExternalId.get(pr.external_id)!.map((vr) => ({ ...vr, product_id: idByExtId.get(pr.external_id)! })),
  );
  // 變體 upsert onConflict sku(首次匯入空表冪等)。註:16d 週同步若來源 re-parse 令同群兩變體
  // spec 互換,可能撞 pv_spec_unique(product_id,spec) 而非 sku 約束(23505) → 16d 處理(首灌無此風險)。
  await upsertBatched(target, 'product_variants', variantRows, 'sku');
  console.log(`[rpm-import] WRITE 完成:${productRows.length} 商品 / ${variantRows.length} 變體`);
}

main().catch((e) => {
  console.error('[rpm-import] FAILED:', e);
  process.exit(1);
});
