/**
 * rpm-import — RPM Carbon 同步:entry / orchestration(S3b 改讀報價單乾淨 view)
 *
 * 來源(唯讀、絕不寫):報價單 B庫 `dllwkkfanaebrsuyuedy` 乾淨 view `storefront_catalog_v`
 *   WHERE supplier_slug='rpm';用 anon publishable key(讀不到成本/蝦皮/經銷)。
 * 目標(寫):pcm-website-v2 `bmpnplmnldofgaohnaok`
 *   products + product_variants;brands/categories 已 16b-1 seed;唯一鍵=複合(S3a 已套用)。
 *
 * 跑法:
 *   pnpm dlx tsx scripts/rpm-import.ts --dry-run [--group=APRILIA-01] [--limit=3] [--delta-full]
 *     → 跑 pv_spec preflight + 兩層價格 delta gate + S4 下架對賬報告(全量才跑)、印清單、不寫
 *   pnpm dlx tsx scripts/rpm-import.ts --confirm-write [--allow-large-delist]
 *     → 正式寫入 + S4 下架對賬(源頭消失→軟下架、只全量);硬 gate:異常列(null/0/負/NaN)無條件 abort、
 *       任何寫入須帶 --confirm-write;下架安全 gate:source 空硬 abort、下架比例>10% abort 除非 --allow-large-delist
 *
 * env(repo 根 .env.local、不入 git):
 *   QUOTE_SUPABASE_URL / QUOTE_SUPABASE_PUBLISHABLE_KEY(來源報價單 view、anon 唯讀)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(目標寫)
 *   註(S3b):來源改吃 QUOTE_*(取代 S2 退役的 SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SECRET_KEY raw 讀)。
 *
 * 🔴 紅線(S3b/S4):各段檔頭(rpm-fetch 讀乾淨 view 濾 supplier_slug='rpm';
 *   rpm-transform price_retail→price_general〔零售〕/ price_store 欄 NULL / 停寫敏感 metadata / delisted_at=null 復架;
 *   rpm-delta 兩層價格硬 gate + pv_spec preflight;rpm-reconcile 下架對賬安全 gate + scope rpm 軟下架)。
 */

import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
// 本機從 .env.local 載連線 env;排程 runner(GitHub Actions / Vercel / pg_cron)無此檔(gitignored)、
// 走平台注入的 process.env。loadEnvFile 對缺檔硬 throw ENOENT、會在 main() 前炸 → 存在才載
// (S5 無人值守前提;否則 cron 每天 100% 失敗。fallback 對抗審查 B1)。
if (existsSync('.env.local')) loadEnvFile('.env.local');

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
import { computeDelist, applyDelist, printReconcileReport } from './rpm-reconcile';

// ── constants ──
const BRAND_SLUG = 'rpm-carbon';
const CATEGORY_RAW_PATH = '碳纖維部品';
const ALLOWED_TARGET_REF = 'bmpnplmnldofgaohnaok'; // prod-safety:只准寫這個 dev project
const ALLOWED_TARGET_HOST = `${ALLOWED_TARGET_REF}.supabase.co`; // 精準 host 比對(非 .includes、codex k2 審查 consider)

// ── CLI args ──
const DRY_RUN = process.argv.includes('--dry-run');
// 🔴 正式寫入授權旗標(codex k2 審查 must-fix 1):任何非 dry-run 寫入一律要、無價變也要、無旗標即 abort
const CONFIRM_WRITE = process.argv.includes('--confirm-write'); // 唯一寫入授權旗標(審查 round2 nit:移除舊 alias)
const DELTA_FULL = process.argv.includes('--delta-full'); // delta 印全量(非前 50)
const DELTA_JSON = process.argv.includes('--delta-json'); // delta 出 JSON 留證(S3b-2 sign-off)
const GROUP_FILTER = argValue('--group'); // 篩單群(dry-run 驗 / D5 單群上線抽驗)
const LIMIT = Number(argValue('--limit') ?? '0') || 0; // 篩前 N 群(dry-run)
const ALLOW_LARGE_DELIST = process.argv.includes('--allow-large-delist'); // S4:放行大比例下架(防誤殺 bypass、需確認來源完整才帶)
// 🔴 S4 下架對賬只在全量模式跑(篩選下 source 不完整、跑了會誤殺全站)。
// ⚠️ FULL_MODE 是 CLI flag 推斷、非 source 完整性保證;真正防殘缺誤殺的最終防線是 reconcile 兩條 gate(source 空硬 abort + 比例>10% abort)。
const FULL_MODE = !GROUP_FILTER && LIMIT === 0;

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
  const targetHost = new URL(targetUrl).hostname;
  if (targetHost !== ALLOWED_TARGET_HOST) {
    throw new Error(`prod-safety:目標 host 非 ${ALLOWED_TARGET_HOST}、拒寫(${targetHost})`);
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
  const sourceExternalIds = new Set(productRows.map((p) => p.external_id)); // S4 下架對賬:本次 source 出現的主碼集合

  // ── 硬 gate 1:pv_spec_unique preflight(source 群內 + target 模擬)──
  const collisions = await preflightSpecUnique(target, variantsByExternalId);
  if (collisions.length) {
    console.error(`[rpm-import] 🔴 pv_spec_unique preflight 撞鍵 ${collisions.length} 群、abort 不寫:`);
    console.table(collisions.slice(0, 50));
    throw new Error('pv_spec_unique preflight 撞鍵、停止(避免部分寫的髒中間態)');
  }

  // ── 價格 delta gate(兩層、唯讀比對)──
  const delta = await computeDelta(target, productRows, variantRows);
  printDeltaReport(delta, { full: DELTA_FULL, json: DELTA_JSON });

  if (DRY_RUN) {
    const sample = productRows[0];
    if (sample) {
      const vrs = variantsByExternalId.get(sample.external_id)!;
      console.log('\n-- 抽樣群(transform 驗) --');
      console.log(JSON.stringify({ product: sample, variant_count: vrs.length, sample_variants: vrs.slice(0, 3) }, null, 2));
    }
    // S4 下架對賬(只全量;篩選下 source 不完整、跳過避免誤判)。
    // dry-run 即使 gate 觸發也只印報告不 throw(故意:Sean 要看完整報告、不靠 dry-run exit code 當預檢;真跑才 exit 1)。
    if (FULL_MODE) {
      const recon = await computeDelist(target, sourceExternalIds, { allowLargeDelist: ALLOW_LARGE_DELIST });
      printReconcileReport(recon, { full: DELTA_FULL });
    } else {
      console.log('[rpm-import] 下架對賬跳過(--group/--limit 篩選、source 不完整、全量才對賬)');
    }
    console.log(`\n[rpm-import] DRY-RUN:${productRows.length} 群 / ${variantRows.length} 變體(未寫入)`);
    console.log('→ 看完 delta/離群/下架對賬、Sean 點頭後、跑正式並帶 --confirm-write');
    return;
  }

  // ── 硬 gate 2:正式寫入守門(codex k2 審查 must-fix 1)──
  // 異常列(null/0/負/NaN)= 不可覆寫硬 abort、無條件先擋(即使帶旗標也不放行)
  if (hasAbnormal(delta)) {
    throw new Error(`價格異常列 ${delta.abnormal.length}(null/0/負/NaN/Inf)、不可覆寫硬 abort、停止(查源頭)`);
  }
  // 任何正式寫入一律須 --confirm-write(無價變也要、無旗標一律 abort)
  if (!CONFIRM_WRITE) {
    throw new Error('正式寫入須帶 --confirm-write(先看 dry-run delta/離群、Sean 點頭授權);無旗標一律 abort');
  }
  console.log(`[rpm-import] 寫入 gate 放行(confirm-write、price_change=${hasPriceChange(delta)}、離群=${delta.outliers.length})`);
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

  // ── S4 下架對賬(源頭消失 → 軟下架;upsert 後跑、只全量、篩選模式跳過避免誤殺)──
  if (FULL_MODE) {
    const recon = await computeDelist(target, sourceExternalIds, { allowLargeDelist: ALLOW_LARGE_DELIST });
    printReconcileReport(recon, { full: DELTA_FULL });
    if (recon.aborted) {
      throw new Error(`下架對賬安全 gate 觸發、不下架:${recon.abortReason}`); // 🔴 loud alert + 非零退出(cron 警報)
    }
    if (recon.toDelist.length) {
      const n = await applyDelist(target, recon.toDelist, now);
      console.log(`[rpm-import] 下架對賬完成:軟下架 ${n} 商品(delisted_at=now、scope rpm、變體靠 RLS 連動隱藏)`);
    } else {
      console.log('[rpm-import] 下架對賬:無待下架、零孤兒');
    }
  } else {
    console.log('[rpm-import] 下架對賬跳過(--group/--limit 篩選、非全量、避免誤殺全站)');
  }
}

main().catch((e) => {
  console.error('[rpm-import] FAILED:', e);
  process.exit(1);
});
