/**
 * rpm-import — 多供應商上架同步:entry / orchestration(S3b 改讀報價單乾淨 view;P0-A-3 起 --supplier 參數化)
 *
 * 來源(唯讀、絕不寫):報價單 B庫 `dllwkkfanaebrsuyuedy` 乾淨 view `storefront_catalog_v`
 *   WHERE supplier_slug=<--supplier、default 'rpm'>;用 anon publishable key(讀不到成本/蝦皮/經銷)。
 * 目標(寫):pcm-website-v2 `bmpnplmnldofgaohnaok`
 *   products + product_variants;brands/categories 已 16b-1 seed;唯一鍵=複合(S3a 已套用)。
 *   scope/brand/category/handle/subtitle/description 全由 supplier-config(getSupplierConfig)逐家供給。
 *
 * 跑法(tsx 已釘為 devDep、走 pnpm exec;CI workflow 同):
 *   pnpm exec tsx scripts/rpm-import.ts --dry-run [--supplier=rpm] [--group=APRILIA-01] [--limit=3] [--delta-full]
 *     → 跑 W1 抓取完整性 + pv_spec preflight + 兩層價格 delta gate + S4 下架對賬報告(全量才跑)、印清單、不寫
 *   pnpm exec tsx scripts/rpm-import.ts --confirm-write [--supplier=rpm] [--allow-large-delist] [--allow-fetch-shrink]
 *     → 正式寫入 + S4 下架對賬(源頭消失→軟下架、只全量);硬 gate:異常列(null/0/負/NaN)無條件 abort、
 *       任何寫入須帶 --confirm-write;S5 W1 抓取完整性 gate(商品維度差集、來源缺現存上架商品>5% 疑截斷硬 abort 除非 --allow-fetch-shrink);
 *       下架安全 gate:source 空硬 abort、下架比例>10% abort 除非 --allow-large-delist
 *
 * env(repo 根 .env.local、不入 git):
 *   QUOTE_SUPABASE_URL / QUOTE_SUPABASE_PUBLISHABLE_KEY(來源報價單 view、anon 唯讀)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(目標寫)
 *   註(S3b):來源改吃 QUOTE_*(取代 S2 退役的 SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SECRET_KEY raw 讀)。
 *
 * 🔴 紅線(S3b/S4/S5):各段檔頭(rpm-fetch 讀乾淨 view 濾 supplier_slug=<呼叫端傳入> + 57014 退避重試;
 *   rpm-transform price_retail→price_general〔零售〕/ price_store 欄 NULL / 停寫敏感 metadata / delisted_at=null 復架;
 *   rpm-delta 兩層價格硬 gate + pv_spec preflight;rpm-preflight 抓取完整性 gate〔W1〕;rpm-reconcile 下架對賬安全 gate + scope rpm 軟下架)。
 */

import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
// 本機從 .env.local 載連線 env;排程 runner(GitHub Actions / Vercel / pg_cron)無此檔(gitignored)、
// 走平台注入的 process.env。loadEnvFile 對缺檔硬 throw ENOENT、會在 main() 前炸 → 存在才載
// (S5 無人值守前提;否則 cron 每天 100% 失敗。fallback 對抗審查 B1)。
if (existsSync('.env.local')) loadEnvFile('.env.local');

import { createClient } from '@supabase/supabase-js';
import { getSupplierConfig } from './supplier-config';
import { fetchAllSupplierProducts, type SourceProductRow } from './rpm-fetch';
import {
  transformGroup,
  transformVariant,
  variantSortKey,
  type ProductRow,
  type VariantRow,
  type GroupTransformContext,
} from './rpm-transform';
import { resolveId, resolveIdOrNull, upsertBatched, partitionByKeyPresence } from './rpm-load';
import {
  computeDelta,
  printDeltaReport,
  hasPriceChange,
  hasAbnormal,
  preflightSpecUnique,
} from './rpm-delta';
import {
  computeDelist,
  applyDelist,
  printReconcileReport,
  computeVariantOrphans,
  applyVariantDelete,
  printVariantOrphanReport,
} from './rpm-reconcile';
import {
  checkFetchIntegrity,
  printFetchIntegrityReport,
  assertBypassFlagsExclusive,
  readHandleOwners,
  preflightHandles,
  printHandlePreflightReport,
  summarizeCategoryResolution,
  printCategoryResolutionReport,
  findNullCategoryProducts,
} from './rpm-preflight';

// ── constants ──
// P0-A-3:orchestrator 全量由 supplier-config 驅動(scope/brand/category/handle/subtitle/description)。
// 供應商由 --supplier CLI 指定、default 'rpm';getSupplierConfig 供給每家一組參數。
// rpm 這組 = 現況鏡射 → 管線輸出 byte 等價(不變式 3;唯一 Sean 拍板差異 = 副標「碳纖維」→「碳纖維部品」)。
const ALLOWED_TARGET_REF = 'bmpnplmnldofgaohnaok'; // prod-safety:只准寫這個 dev project
const ALLOWED_TARGET_HOST = `${ALLOWED_TARGET_REF}.supabase.co`; // 精準 host 比對(非 .includes、codex k2 審查 consider)

// ── CLI args ──
const SUPPLIER = argValue('--supplier') ?? 'rpm'; // 供應商 slug(default rpm);getSupplierConfig 未登記→fail-closed throw
const DRY_RUN = process.argv.includes('--dry-run');
// 🔴 正式寫入授權旗標(codex k2 審查 must-fix 1):任何非 dry-run 寫入一律要、無價變也要、無旗標即 abort
const CONFIRM_WRITE = process.argv.includes('--confirm-write'); // 唯一寫入授權旗標(審查 round2 nit:移除舊 alias)
const DELTA_FULL = process.argv.includes('--delta-full'); // delta 印全量(非前 50)
const DELTA_JSON = process.argv.includes('--delta-json'); // delta 出 JSON 留證(S3b-2 sign-off)
const GROUP_FILTER = argValue('--group'); // 篩單群(dry-run 驗 / D5 單群上線抽驗)
const LIMIT = Number(argValue('--limit') ?? '0') || 0; // 篩前 N 群(dry-run)
const ALLOW_LARGE_DELIST = process.argv.includes('--allow-large-delist'); // S4:放行大比例下架(防誤殺 bypass、需確認來源完整才帶)
const ALLOW_FETCH_SHRINK = process.argv.includes('--allow-fetch-shrink'); // S5 W1:放行大幅來源縮水(防誤殺 bypass、需確認來源完整才帶)
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
  const config = getSupplierConfig(SUPPLIER); // fail-closed:未登記 slug 直接 throw(→ main().catch exit 1)
  // 🔴 writeAllowed 硬擋(V1、codex must-fix 4):「僅乾跑」不再只是註解——cncracing 等未授權家帶
  //    --confirm-write 一律最早 abort(任何連線/寫入動作前);dry-run 不受限。
  if (CONFIRM_WRITE && !config.writeAllowed) {
    throw new Error(
      `supplier「${config.supplierSlug}」writeAllowed=false(supplier-config.ts;Phase 3 放量拍板前僅乾跑)、--confirm-write 拒絕執行`,
    );
  }
  assertBypassFlagsExclusive(ALLOW_FETCH_SHRINK, ALLOW_LARGE_DELIST); // F3:禁同帶兩 bypass 旗標(不變式 5)
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

  console.log(`[rpm-import] ${DRY_RUN ? 'DRY-RUN' : 'WRITE'} 模式 / supplier=${config.supplierSlug} / 讀報價單乾淨 view…`);
  const [products, brandId] = await Promise.all([
    fetchAllSupplierProducts(source, config.supplierSlug),
    resolveId(target, 'brands', 'slug', config.brandSlug),
  ]);

  // ── 分類解析(v1.2 兩層、#212;取代舊 fixed/per-group 單層 major 解析)──
  //   每群依 major_category_v2_zh + sub_category_v2_zh 組麵包屑 raw_path「大類 · 子類」解析到「子類」id;
  //   缺 v2(少數 major/sub 為 null)或子類未 seed → 未分類 fallback(避免 #261 null-category abort、
  //   一筆髒資料不擋整家同步)。分類 seed = migration 20260712120000_seed_taxonomy_v2_categories
  //   (全 14/77 + 未分類、冪等)。🔴 分隔符 ' · ' 須與 seed raw_path + storefront
  //   products-filter-logic.ts CATEGORY_PATH_SEP 三處一致(matchesCategory 前綴/精確比對靠此)。
  const CATEGORY_PATH_SEP = ' · ';
  const categoryIdCache = new Map<string, string | null>();
  async function resolveCategoryByPath(rawPath: string): Promise<string | null> {
    if (categoryIdCache.has(rawPath)) return categoryIdCache.get(rawPath)!;
    const id = await resolveIdOrNull(target, 'categories', 'raw_path', rawPath);
    categoryIdCache.set(rawPath, id);
    return id;
  }
  // 未分類 fallback 必存在(seed 必先套用;查無 → resolveId fail-closed throw = 明確擋下「seed 前置未完成就重匯入」)
  const uncategorizedId = await resolveId(target, 'categories', 'raw_path', '未分類');

  console.log(
    `[rpm-import] 來源 view ${config.supplierSlug} 變體 ${products.length} 筆;brand_id=${brandId} ` +
      `category=v2 兩層(major·sub 麵包屑 → 子類 id、缺則未分類 fallback)`,
  );

  // ── S5 W1:抓取完整性 gate(無人值守誤下架前置防線;商品維度差集、來源缺現存上架商品 >5% 疑截斷硬 abort)──
  //   fetch 永遠全量(--group/--limit 僅篩寫入、不篩 fetch)→ 此 gate 不分模式皆驗。dry-run 只報告不 abort。
  //   差集比 target active 商品(growth-immune、新品蓋不掉缺口);5% 嚴於 S4 下架 10%、抓 5–10% 靜默截斷帶。
  const sourceMainSkus = new Set(products.map((p) => p.main_sku));
  const fetchIntegrity = await checkFetchIntegrity(target, config.supplierSlug, sourceMainSkus, products.length, {
    allowFetchShrink: ALLOW_FETCH_SHRINK,
  });
  printFetchIntegrityReport(fetchIntegrity);
  if (!DRY_RUN && fetchIntegrity.aborted) {
    throw new Error(`抓取完整性 gate 觸發、不寫:${fetchIntegrity.abortReason}`); // 🔴 loud alert + 非零退出(cron 警報)
  }

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
  const categoryResolutions: { majorCategoryZh: string; categoryId: string | null }[] = []; // 乾跑彙整(逐群 v2 解析)
  let nullV2Groups = 0; // major/sub 缺 → 未分類(少數髒資料、預期)
  let unseededSubGroups = 0; // 有 v2 但子類未 seed → 未分類(需補 seed migration、異常)
  for (const [mainSku, variants] of entries) {
    const vehicleLabel = variants.find((v) => v.vehicle_label)?.vehicle_label ?? ''; // 群內第一個非空
    // 分類 + 副標詞:v2 major·sub 麵包屑 → 子類 id;缺 v2 或子類未 seed → 未分類 fallback(#212 取代 fixed/per-group)
    const majorV2 = variants.find((v) => v.major_category_v2_zh)?.major_category_v2_zh ?? ''; // 群內第一個非空
    const subV2 = variants.find((v) => v.sub_category_v2_zh)?.sub_category_v2_zh ?? '';
    const rawPath = majorV2 && subV2 ? `${majorV2}${CATEGORY_PATH_SEP}${subV2}` : '';
    const resolved = rawPath ? await resolveCategoryByPath(rawPath) : null;
    const categoryId: string | null = resolved ?? uncategorizedId;
    if (!rawPath) nullV2Groups++;
    else if (!resolved) unseededSubGroups++;
    const subtitleTag: string = majorV2 || '精選部品';
    categoryResolutions.push({ majorCategoryZh: rawPath || '未分類', categoryId });
    const ctx: GroupTransformContext = {
      brandId,
      categoryId,
      handlePrefix: config.handlePrefix,
      subtitleTag,
      syncDescription: config.syncDescription,
      syncInstallResources: config.syncInstallResources, // #270:gbracing/bonamici=true 寫 manuals/video_url、rpm/cnc=false 凍結
    };
    const pr = transformGroup(mainSku, variants, vehicleLabel, ctx, now);
    productRows.push(pr);
    const sorted = [...variants].sort((a, b) => (variantSortKey(a) < variantSortKey(b) ? -1 : 1));
    variantsByExternalId.set(
      pr.external_id,
      sorted.map((v, idx) => transformVariant(v, now, idx, config.variantImages)),
    );
  }
  const variantRows = [...variantsByExternalId.values()].flat();
  const sourceExternalIds = new Set(productRows.map((p) => p.external_id)); // S4 下架對賬:本次 source 出現的主碼集合
  const sourceVariantSkus = new Set(variantRows.map((v) => v.sku)); // V1 變體級對賬:本次 source 變體碼集合

  // ── 乾跑診斷:逐群 v2 分類解析彙整(#212)──
  if (categoryResolutions.length) {
    printCategoryResolutionReport(summarizeCategoryResolution(categoryResolutions));
  }
  if (nullV2Groups || unseededSubGroups) {
    console.log(
      `[rpm-import] 分類 fallback → 未分類:null-v2 ${nullV2Groups} 群(少數髒資料、預期)、` +
        `子類未 seed ${unseededSubGroups} 群(異常、需補 seed migration 後重跑)`,
    );
  }

  // ── 硬 gate:category_id=null(#261;products.category_id NOT NULL、null 進 upsert = 23502、該 500 列批全敗)──
  //   dry-run 列清單不 throw(配合上方彙整報告、Sean 看全貌);寫入模式 abort 不進 upsert(避免整批 23502 髒中間態)。
  //   #212 後 categoryId 恆非 null(v2 解析 ?? 未分類 fallback、seed 未套用則 uncategorizedId resolveId 早已 throw)
  //   → 此 gate 現為防禦性空過;保留防未來新增 code path 漏掛。
  const nullCategoryProducts = findNullCategoryProducts(productRows);
  if (nullCategoryProducts.length) {
    console.warn(
      `[rpm-import] 🔴 category_id=null ${nullCategoryProducts.length} 群(未對上 categories.raw_path)、寫入模式將 abort:`,
    );
    console.table(
      nullCategoryProducts.slice(0, 30).map((p) => ({ external_id: p.external_id, handle: p.handle, subtitle: p.subtitle })),
    );
    if (nullCategoryProducts.length > 30) console.log(`(另有 ${nullCategoryProducts.length - 30} 群未列)`);
    if (!DRY_RUN) {
      throw new Error(
        `category_id=null ${nullCategoryProducts.length} 群、abort 不寫(products.category_id NOT NULL;看上方未對上分類彙整、補 categories seed 後重跑)`,
      );
    }
  }

  // ── 硬 gate 0:handle preflight(F4、charset + 全域唯一;不變式 6)──
  //   dry-run 列報告不 throw(Sean 看完整報告);寫入模式撞鍵/髒字元 → abort 不進 upsert(避免中途撞 products_handle_key 部分寫髒)。
  const handleOwners = await readHandleOwners(target, productRows.map((p) => p.handle));
  const handleIssues = preflightHandles(productRows, handleOwners);
  printHandlePreflightReport(handleIssues, productRows.length);
  if (!DRY_RUN && handleIssues.length) {
    throw new Error(`handle preflight 撞鍵/髒字元 ${handleIssues.length} 筆、abort 不寫(修源頭 sku 後重跑;dry-run 看清單)`);
  }

  // ── V1 變體級對賬(2026-07-05 雙跨模型審查 must-fix F1-F3):群在、變體 sku 從來源消失=孤兒
  //   (殘留前台選項可見+可下單凍結舊價)。差集 scope=本次要寫的群(其 source 變體集完整、全模式安全);
  //   dry-run 列報告不刪(F2 觀測性);寫入模式 gate 觸發(源空/比例>10% 無 bypass)→ abort 不寫。
  //   真正刪除在 products upsert 後、variants upsert 前(見寫入段;改名同 spec 先清舊列免 23505=F3)。
  const variantOrphans = await computeVariantOrphans(
    target,
    config.supplierSlug,
    sourceVariantSkus,
    sourceExternalIds,
    { allowLargeDelist: ALLOW_LARGE_DELIST },
  );
  printVariantOrphanReport(variantOrphans, { full: DELTA_FULL });
  if (!DRY_RUN && variantOrphans.aborted) {
    throw new Error(`變體級對賬 gate 觸發、不寫:${variantOrphans.abortReason}`); // 🔴 loud alert + 非零退出(cron 警報)
  }
  const orphanSkusToDelete = new Set(variantOrphans.aborted ? [] : variantOrphans.orphans.map((o) => o.sku));

  // ── 硬 gate 1:pv_spec_unique preflight(source 群內 + target 模擬)──
  //   dry-run 列報告不 throw(Sean 看完整碰撞清單、Phase 1 處置 C3:bonamici 3 群真正區分軸是尺寸、不在 spec);
  //   寫入模式撞鍵 → abort 不進 upsert(避免 23505 部分寫的髒中間態)。
  //   V1:排除已排定刪除的孤兒 sku(upsert 前先刪、不參與模擬;變體改名同 spec 不再恆撞=F3)。
  const collisions = await preflightSpecUnique(target, config.supplierSlug, variantsByExternalId, orphanSkusToDelete);
  if (!collisions.length) console.log('✅ pv_spec_unique preflight 撞鍵 0(留檔證據自明、免讀源碼反推)');
  if (collisions.length) {
    console.warn(`[rpm-import] 🔴 pv_spec_unique preflight 撞鍵 ${collisions.length} 群、寫入模式將 abort:`);
    console.table(collisions.slice(0, 50));
    if (collisions.length > 50) console.log(`(另有 ${collisions.length - 50} 群未列)`);
    if (!DRY_RUN) throw new Error('pv_spec_unique preflight 撞鍵、停止(避免部分寫的髒中間態)');
  }

  // ── 價格 delta gate(兩層、唯讀比對)──
  const delta = await computeDelta(target, config.supplierSlug, productRows, variantRows);
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
      const recon = await computeDelist(target, config.supplierSlug, sourceExternalIds, { allowLargeDelist: ALLOW_LARGE_DELIST });
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
  // 🔴 #260(保留現值 ①):按 description key 是否存在分兩 uniform 批 upsert,避免 postgrest `?columns` 全批聯集 +
  //    defaultToNull 把「省 key」列寫成 NULL(rpm 全省 key → withKey 空 → 現行單批行為 byte 等價;
  //    試點來源空描述列落 withoutKey 批、不覆寫現值)。source-權威鏡射 ② 若採用另議、見 backlog #260。
  //    ⚠️ 本 partition 只治「同一 run 內 row 間 presence 會變動」的條件寫欄(description 因來源可空而 per-row 變動)。
  //       例外:highlights(A/#270)與 manuals/video_url(#270 安裝資源)亦條件省 key,但均屬「供應商級」
  //       (依 ctx.syncDescription / ctx.syncInstallResources、單一 run all-or-nothing、非 per-row)→ 對本 partition
  //       天然 uniform、不需納入(codex 關卡1 確認)。未來新增「per-row 變動」的省 key 欄才需一併納入 partition。
  const { withKey: prodWithDesc, withoutKey: prodWithoutDesc } = partitionByKeyPresence(productRows, 'description');
  const savedProducts = [
    ...(prodWithDesc.length
      ? await upsertBatched(target, 'products', prodWithDesc, 'supplier_slug,external_id', 'id, external_id')
      : []),
    ...(prodWithoutDesc.length
      ? await upsertBatched(target, 'products', prodWithoutDesc, 'supplier_slug,external_id', 'id, external_id')
      : []),
  ];
  const idByExtId = new Map(savedProducts.map((r) => [r.external_id as string, r.id as string]));

  // ── V1 孤兒變體硬刪(variants upsert **前**:變體改名同 spec 先清舊列、免撞 pv_spec_unique 23505=F3)──
  //   gate 已在寫入前驗過(aborted 早 throw);此處 orphanSkusToDelete 必為安全集合。
  //   ⚠️ 無交易:刪除成功後若 variants upsert 失敗 → 該群短暫少列(下輪同步自癒、冪等);審查 should-fix 已知。
  if (orphanSkusToDelete.size) {
    const deleted = await applyVariantDelete(target, config.supplierSlug, [...orphanSkusToDelete]);
    console.log(`[rpm-import] 孤兒變體硬刪:${deleted} 列(scope ${config.supplierSlug};order_items FK SET NULL、歷史不破)`);
  }

  const variantRowsWithProduct = productRows.flatMap((pr) =>
    variantsByExternalId.get(pr.external_id)!.map((vr) => ({ ...vr, product_id: idByExtId.get(pr.external_id)! })),
  );
  await upsertBatched(target, 'product_variants', variantRowsWithProduct, 'supplier_slug,sku');
  console.log(`[rpm-import] WRITE 完成:${productRows.length} 商品 / ${variantRowsWithProduct.length} 變體`);

  // ── S4 下架對賬(源頭消失 → 軟下架;upsert 後跑、只全量、篩選模式跳過避免誤殺)──
  if (FULL_MODE) {
    const recon = await computeDelist(target, config.supplierSlug, sourceExternalIds, { allowLargeDelist: ALLOW_LARGE_DELIST });
    printReconcileReport(recon, { full: DELTA_FULL });
    if (recon.aborted) {
      throw new Error(`下架對賬安全 gate 觸發、不下架:${recon.abortReason}`); // 🔴 loud alert + 非零退出(cron 警報)
    }
    if (recon.toDelist.length) {
      const n = await applyDelist(target, config.supplierSlug, recon.toDelist, now);
      console.log(`[rpm-import] 下架對賬完成:軟下架 ${n} 商品(delisted_at=now、scope ${config.supplierSlug}、變體靠 RLS 連動隱藏)`);
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
