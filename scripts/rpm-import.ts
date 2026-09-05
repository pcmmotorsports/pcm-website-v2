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
 *   pnpm exec tsx scripts/rpm-import.ts --confirm-write [--supplier=rpm] [--expect-groups=648] [--allow-large-delist] [--allow-fetch-shrink]
 *     → 正式寫入 + S4 下架對賬(源頭消失→軟下架、只全量);硬 gate:異常列(null/負/NaN/±Infinity/-0;🔴 `0` 自 2026-08-25 起合法)無條件 abort、
 *       M2 群數指紋 gate(首灌 target active=0 時 W1 恆過 → 強制帶 --expect-groups=<乾跑實查群數>、不符即停);
*       任何寫入須帶 --confirm-write;S5 W1 抓取完整性 gate(商品維度差集、來源缺現存上架商品>5% 疑截斷硬 abort 除非 --allow-fetch-shrink);
 *       下架安全 gate:source 空硬 abort、下架比例>10% abort 除非 --allow-large-delist
 *
 * env(repo 根 .env.local、不入 git):
 *   QUOTE_SUPABASE_URL / QUOTE_SUPABASE_PUBLISHABLE_KEY(來源報價單 view、anon 唯讀)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(目標寫)
 *   註(S3b):來源改吃 QUOTE_*(取代 S2 退役的 SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SECRET_KEY raw 讀)。
 *
 * 🔴 紅線(S3b/S4/S5):各段檔頭(rpm-fetch 讀乾淨 view 濾 supplier_slug=<呼叫端傳入> + 57014 退避重試;
 *   rpm-transform price_retail→price_general〔零售〕/ price_store 欄 NULL / 停寫敏感 metadata /
 *   delisted_at **鏡射來源**(view v3 投影、合約 §10;非舊的無條件 null 復架 — 別改回去);
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
import { runAtomicGroups, installKillReporter } from './rpm-partial-report';
import { applyTitleGateSkip, runTitleShapeGate } from './title-shape-gate';
import { fetchAllSupplierProducts, type SourceProductRow } from './rpm-fetch';
import {
  transformGroup,
  transformVariant,
  variantSortKey,
  liveVariantsOf,
  type ProductRow,
  type VariantRow,
  type GroupTransformContext,
} from './rpm-transform';
import {
  resolveId,
  resolveIdOrNull,
  upsertBatched,
  groupByKeySignature,
  stripColumnIfMissing,
  splitVariantSyncWork,
  syncVariantGroupAtomic,
} from './rpm-load';
import {
  computeDelta,
  printDeltaReport,
  hasPriceChange,
  hasAbnormal,
  preflightSpecUnique,
  checkNewItemPrices,
  printNewItemPriceReport,
  independentPrice,
  independentGroupPrice,
} from './rpm-delta';
import {
  computeSourceMissing,
  markSourceMissing,
  clearSourceMissing,
  printReconcileReport,
  computeVariantOrphans,
  applyVariantDelete,
  printVariantOrphanReport,
  orphansToDeleteFor,
  hazardGroupsToSkip,
} from './rpm-reconcile';
import {
  checkFetchIntegrity,
  printFetchIntegrityReport,
  assertBypassFlagsExclusive,
  checkGroupCountGate,
  printGroupCountGate,
  readHandleOwners,
  preflightHandles,
  printHandlePreflightReport,
  summarizeCategoryResolution,
  printCategoryResolutionReport,
  findNullCategoryProducts,
  findCategorySemanticMismatches,
  printCategorySemanticReport,
} from './rpm-preflight';
import { printTitleLanguageReport } from './rpm-title-language';
import { deniedGroupMessage, findDeniedGroup } from './supplier-group-denylist';

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
// M2(Codex R1 must-fix):預期群數指紋。首灌(target active=0)寫入模式強制要帶——W1 縮水閘該情境恆過。
const EXPECT_GROUPS = parseExpectGroups(argValue('--expect-groups'));
const ALLOW_LARGE_DELIST = process.argv.includes('--allow-large-delist'); // S4:放行大比例下架(防誤殺 bypass、需確認來源完整才帶)
const ALLOW_FETCH_SHRINK = process.argv.includes('--allow-fetch-shrink'); // S5 W1:放行大幅來源縮水(防誤殺 bypass、需確認來源完整才帶)
// 🔴 S4 下架對賬只在全量模式跑(篩選下 source 不完整、跑了會誤殺全站)。
// ⚠️ FULL_MODE 是 CLI flag 推斷、非 source 完整性保證;真正防殘缺誤殺的最終防線是 reconcile 兩條 gate(source 空硬 abort + 比例>10% abort)。
const FULL_MODE = !GROUP_FILTER && LIMIT === 0;

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

/** --expect-groups=N 解析:未帶→null;非正整數→fail-closed throw(免「--expect-groups=abc」被當沒帶而靜默放行) */
function parseExpectGroups(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--expect-groups 需為正整數(收到「${raw}」);帶乾跑實查到的群數當基線`);
  }
  return n;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set(填 repo 根 .env.local)`);
  return v;
}

// ── main ──
async function main(): Promise<void> {
  // 🔴 最早掛:被砍在半路時留一行(⟦supply-SYNCTIMEOUTPARTIAL⟧)。
  //    它與 runAtomicGroups 的 catch 留痕是**兩條不同的路** —— `timeout-minutes` 送的是
  //    `SIGTERM`,**沒有任何東西被丟出來** ⇒ 那個 catch 對逾時結構上失明。
  //    行為差異(退出碼變 143 / 130)寫在 rpm-partial-report.ts 那一段, 不藏。
  installKillReporter();
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

  // ── M2:群數指紋 gate(首灌基線;Codex R1 must-fix)──
  //   比的是【來源全量群數】(fetch 永遠全量、--group/--limit 只篩寫入)→ 與篩選模式無關。
  //   dry-run 只報告(Sean 看全貌、順便讀出這次該帶的指紋值);寫入模式 aborted → throw。
  const groupCountGate = checkGroupCountGate({
    sourceGroupCount: groups.size,
    expectedGroupCount: EXPECT_GROUPS,
    targetActiveCount: fetchIntegrity.targetActiveCount,
    isWrite: !DRY_RUN,
  });
  printGroupCountGate(groupCountGate);
  if (!DRY_RUN && groupCountGate.aborted) {
    throw new Error(`群數指紋 gate 觸發、不寫:${groupCountGate.abortReason}`); // 🔴 loud alert + 非零退出(cron 警報)
  }

  // 篩選(dry-run --group / --limit)
  let entries = [...groups.entries()];
  if (GROUP_FILTER) entries = entries.filter(([m]) => m === GROUP_FILTER.toUpperCase());
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);

  // 轉換
  const productRows: ProductRow[] = [];
  const variantsByExternalId = new Map<string, VariantRow[]>();
  const categoryResolutions: { majorCategoryZh: string; categoryId: string | null }[] = [];
  const categorySemanticRows: { external_id: string; title: string; rawPath: string }[] = []; // #789 分類語意 gate 的輸入(title 中文優先、rawPath 麵包屑) // 乾跑彙整(fallback 傳 null=真實反映未對上、避免假綠 Codex must-fix 1)
  let nullV2Groups = 0; // 整群無完整 (major,sub) pair(大面積 null)→ 未分類
  let unseededSubGroups = 0; // 有完整 pair 卻 resolve 不到 seed 子類(seed 漂移、異常)
  const conflictGroups: { mainSku: string; pairs: string[] }[] = []; // 群內「跨大類」衝突(Codex must-fix 2 的危險情境:錯置到別大類)
  let subMildGroups = 0; // 同大類但子類分歧(輕微;取決定性子類、不 abort)
  let partialDelistDropped = 0; // R2-SF2:部分停產群被剔除的變體數(唯一會產生孤兒的路徑)
  let partialDelistGroups = 0;
  // M1 新品驗價:從【來源列】獨立重算的價,與 transform 產出的 price_general 逐筆對(見 rpm-delta 檔內說明)。
  //   來源=liveVariants(與 transform 吃同一集合;停產剔除屬另一個問題、不混進驗價)。
  const sourceGroupPrice = new Map<string, number | null>(); // external_id → min(price_retail) 獨立重算
  const sourceVariantPrice = new Map<string, number | null>(); // sku → price_retail 獨立重算
  for (const [mainSku, variants] of entries) {
    // 🔴 liveVariants 必須在【最上面】算,群內所有衍生值(車款標籤、分類 pair、群層轉換、變體列)
    //    一律吃同一個集合。規則與理由見 rpm-transform.ts 的 liveVariantsOf。
    //    對抗審查 R2-SF1:若車款標籤與分類 pair 仍吃全部 variants,停產變體的殘留舊標籤會污染在售群 ——
    //    最嚴重情境是停產變體的 major_category_v2_zh 與在售的不同 => majorsInGroup.size===2
    //    => 進 conflictGroups => WRITE 模式整批 abort,等於「停產品的殘留標籤凍結整家供應商同步」,
    //    正是本次改動要消滅的事故類型。
    const liveVariants = liveVariantsOf(variants);
    const vehicleLabel = liveVariants.find((v) => v.vehicle_label)?.vehicle_label ?? ''; // 群內第一個非空
    // 分類:群內收集去重「大類 · 子類」完整 pair + 大類集合(Codex must-fix 2:防 .find 靜默取第一筆/合成不存在麵包屑)。
    //   恰一 pair=正常;0=大面積 null;>1 且同大類=輕微子類分歧(取決定性子類);>1 且跨大類=危險衝突(abort)。
    const pairs = new Set<string>();
    const majorsInGroup = new Set<string>();
    for (const v of liveVariants) {
      if (v.major_category_v2_zh && v.sub_category_v2_zh) {
        pairs.add(`${v.major_category_v2_zh}${CATEGORY_PATH_SEP}${v.sub_category_v2_zh}`);
        majorsInGroup.add(v.major_category_v2_zh);
      }
    }
    let rawPath = '';
    let resolved: string | null = null;
    if (pairs.size === 0) {
      nullV2Groups++;
    } else if (majorsInGroup.size <= 1) {
      // 恰一 pair、或同大類子類分歧:取排序後第一個 pair(決定性、穩定)。同大類下選大類 rollup 涵蓋任一子類、
      //   挑哪個子類不影響大類篩選;子類篩選頂多這一群略偏(牌照架類邊緣品、可接受)。
      rawPath = [...pairs].sort()[0]!;
      resolved = await resolveCategoryByPath(rawPath);
      if (!resolved) unseededSubGroups++; // 有完整 pair 卻查無 seed 子類
      if (pairs.size > 1) subMildGroups++;
    } else {
      // 跨大類衝突:Codex 的真正危險情境(錯置到別大類)→ 未分類 + WRITE abort。
      conflictGroups.push({ mainSku, pairs: [...pairs] });
    }
    const categoryId: string | null = resolved ?? uncategorizedId; // products.category_id NOT NULL:未對上一律未分類 fallback
    const subtitleTag: string = (rawPath ? rawPath.split(CATEGORY_PATH_SEP)[0] : '') || '精選部品';
    categoryResolutions.push({ majorCategoryZh: rawPath || '未分類', categoryId: resolved }); // 傳 resolved(fallback=null)
    const ctx: GroupTransformContext = {
      brandId,
      categoryId,
      handlePrefix: config.handlePrefix,
      subtitleTag,
      syncDescription: config.syncDescription,
      syncInstallResources: config.syncInstallResources, // #270:true 才寫 manuals/video_url、false 凍結(名單真權威在 supplier-config)
      appendManualFilename: config.appendManualFilename, // 合約 v5 §3:gbracing/evotech 接檔名、其餘同類多份編號
    };
    // 群層轉換同樣吃 liveVariants(分開餵會讓商品卡顯示已被剔除的停產變體價格 ——
    // 對抗審查實例:停產款 $1,000 / 在售款 $2,000,卡片仍顯示 $1,000)。
    const pr = transformGroup(mainSku, liveVariants, vehicleLabel, ctx, now);
    productRows.push(pr);
    categorySemanticRows.push({ external_id: pr.external_id, title: pr.title, rawPath }); // #789
    sourceGroupPrice.set(pr.external_id, independentGroupPrice(liveVariants)); // M1:獨立重算、不共用 transform 實作
    for (const v of liveVariants) sourceVariantPrice.set(v.sku, independentPrice(v.price_retail));
    if (liveVariants.length < variants.length) {
      partialDelistDropped += variants.length - liveVariants.length; // R2-SF2 可觀測性
      partialDelistGroups++;
    }
    const sorted = [...liveVariants].sort((a, b) => (variantSortKey(a) < variantSortKey(b) ? -1 : 1));
    variantsByExternalId.set(
      pr.external_id,
      sorted.map((v, idx) => transformVariant(v, now, idx, config.variantImages)),
    );
  }
  const variantRows = [...variantsByExternalId.values()].flat();
  const sourceExternalIds = new Set(productRows.map((p) => p.external_id)); // S4 來源消失對賬:本次 source 出現的主碼集合
  const sourceVariantSkus = new Set(variantRows.map((v) => v.sku)); // V1 變體級對賬:本次 source 變體碼集合

  // ── 🔴 2026-08-15 `#20` 片2b:鏡射路徑已整個拿掉,本段可觀測量隨之消失 ──
  //   舊版在這裡印「鏡射下架 N/M 群帶 delisted_at」,用途是讓無人值守的 cron 也能發現
  //   「來源側一次誤標讓整家供應商在顧客站靜默蒸發」。**那條路徑本片已不存在**
  //   (rpm-transform 不再輸出 delisted_at)⇒ 這個計數恆為 0、留著只會誤導。
  //   ⚠️ **它防的風險也一併消失**:來源誤標不再能讓商品從顧客站消失 —— 這正是本片的目的。
  //   取而代之的可觀測量 = 下方「來源消失對賬」印出的標記數(那個不會讓商品消失,只是標記)。
  //   —— 那兩道閘量的是「缺席」,鏡射路徑零缺席、兩閘皆不觸發。無人值守 cron 若不 log,
  //   來源側一次誤標可讓整家供應商在顧客站靜默蒸發而無人察覺。故此處【永遠】印出數量與比例。
  //   (刻意只 log 不 abort:來源側已有 fetcher MIN_SAFE_FETCH 安全閘 + view 的 7 天去抖兩層防護,
  //    且套用 v3 當次本就會一次鏡射大量既有停產品 —— 加 abort 會讓首次同步必掛。
  //    是否要再加一道量閘 = 待 Sean 拍板的 backlog,不在本 slice 自行決定。)
  // R2-SF2:部分停產剔除是【唯一】會產生變體孤兒的路徑;孤兒 >10% 會撞 VARIANT_DELETE_RATIO_ABORT
  // 而 F3 又禁兩旗標並用 => 先讓它在撞閘【之前】就可見(「目前只佔 0.07%」是快照、不是不變式)。
  // 🔴 `scopeNote` 原本定義在上面「鏡射下架」那段,而片2b 把整段刪掉了 ——
  //    刪的時候沒發現這裡還在用它 ⇒ 之前是 `ReferenceError`(不是型別問題,是真的會炸)。
  //    在這裡就地定義,別再依賴別段的區域變數。
  const scopeNote = FULL_MODE ? '' : '(篩選後、非全量比例)'; // --group/--limit 下分母非全量,免誤判事故
  console.log(
    `[rpm-import] 部分停產剔除變體:${partialDelistDropped} 顆 / ${partialDelistGroups} 群${scopeNote}` +
      `(將走孤兒硬刪;整群停產者保留全變體、不計入)`,
  );

  // ── 乾跑診斷:逐群 v2 分類解析彙整(#212)──
  if (categoryResolutions.length) {
    printCategoryResolutionReport(summarizeCategoryResolution(categoryResolutions));
  }
  if (nullV2Groups || unseededSubGroups || conflictGroups.length || subMildGroups) {
    console.log(
      `[rpm-import] v2 分類:null-v2 ${nullV2Groups} 群→未分類 / 未 seed 子類 ${unseededSubGroups} 群 / ` +
        `同大類子類分歧 ${subMildGroups} 群(取決定性子類、不擋) / 跨大類衝突 ${conflictGroups.length} 群`,
    );
    if (conflictGroups.length) {
      console.table(conflictGroups.slice(0, 20).map((c) => ({ mainSku: c.mainSku, pairs: c.pairs.join(' | ') })));
    }
  }
  // ── 硬 gate(#212、Codex must-fix 1/2):WRITE 模式分類異常必 abort、不靜默把整批搬「未分類」──
  //   dry-run 只報告(Sean 看全貌);WRITE:未 seed 子類(seed 漂移)/ 群內衝突(髒來源)/ null-v2 大比例(來源崩)→ abort。
  //   已知少數 null(50k 中 ~60 筆、0.1%)容忍;>5% 疑來源 v2 崩(對齊 fetch 完整性 5% 精神)。
  // null-v2 比例 gate 只在 FULL_MODE 套用(Codex R2 must-fix:--group/--limit 部分寫入下 entries 被篩、
  //   分母失真會把單一已知 null-v2 群誤判成 100% 而誤殺);unseeded/conflict 是正確性問題、任何 scope 都 abort。
  const nullV2Ratio = entries.length ? nullV2Groups / entries.length : 0;
  const nullV2Abort = FULL_MODE && nullV2Ratio > 0.05;
  if (!DRY_RUN && (unseededSubGroups > 0 || conflictGroups.length > 0 || nullV2Abort)) {
    throw new Error(
      `分類異常、abort 不寫(避免整批誤掛未分類):未 seed 子類 ${unseededSubGroups} 群(補 seed migration)` +
        ` / 群內衝突 ${conflictGroups.length} 群(修來源 v2)` +
        (nullV2Abort ? ` / null-v2 ${nullV2Groups} 群(${(nullV2Ratio * 100).toFixed(1)}%、FULL_MODE >5% 疑來源崩)` : '') +
        `。dry-run 看清單。`,
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

  // ── 硬 gate:分類語意(#789;名字已明說種類的商品不得落進相剋分類)──
  //   既有的 #261 null gate 對「掛錯分類」零判別力(categoryId 恆非 null)。掛錯的商品前後台
  //   都正常顯示,唯一的錯是客人在正確分類底下找不到它 —— 沒有任何一格會紅。
  //   判別式、中英雙語 pattern、與雙向表演測試在 ./rpm-preflight.ts + rpm-preflight.test.ts。
  //   🔴 本 gate 至 2026-08-21 為止【沒有跑過一次真的匯入】—— 行為由單元測試 + 接線斷言證明,不是由實跑證明。
  //   ⇒ 第一次真的跑匯入時,要核對報告印出的那兩個數字:總列數 與 實際掃描列數。
  //      兩者差距 = rawPath 為空、連判別式都沒進去的列;差距大 ⇒ 那個「0 違規」不代表什麼,
  //      要先去看 #261 的未對上分類彙整,不是收下這個綠燈。
  const categorySemanticMismatches = findCategorySemanticMismatches(categorySemanticRows);
  printCategorySemanticReport(categorySemanticRows, categorySemanticMismatches); // 收列陣列、兩個分母由它自己算(R1 DN-1)
  // Q31(Sean 2026-09-03 拍甲):沒中文名的商品會靜靜用英文名上架, 而今天沒有地方看得到有幾件。
  //   🔴 分母刻意用 productRows【不是】categorySemanticRows —— 兩者今天 1:1, 而借別的 gate 的陣列
  //      當自己的分母正是 rpm-preflight.ts:390-394 記的那個病(話對、數字錯, 而畫面上分不出來)。
  //   🔴 分母是【本次轉換出的商品數】—— 而 --group/--limit 下它不是全量, 所以要把 FULL_MODE 傳進去
  //      (照 :333 的既有慣用法;不傳的話 `--limit 5` 會印出一個看起來很乾淨的假全綠)。
  //   🛑 只印不擋(warn)—— 那一格有測試釘住, 不要改成擋。
  printTitleLanguageReport(productRows, FULL_MODE);
  if (categorySemanticMismatches.length && !DRY_RUN) {
    throw new Error(
      `#789 分類語意違規 ${categorySemanticMismatches.length} 筆、abort 不寫(看上方表:名字明說的種類與掛進去的分類相剋;` +
        `真的是合法的組合品 ⇒ 把規則加進 rpm-preflight.ts 的 CATEGORY_SEMANTIC_RULES,不要繞過本 gate)`,
    );
  }

  // ── 硬 gate:品名形狀(2026-08-21 W1;起因 = 客人站上真的出現一件品名 `#N/A` 的商品)──
  //   判別式、「擋 vs 只報」的分界、abort 訊息、以及本段接線本身,全在 ./title-shape-gate.ts
  //   (那裡有雙向表演的測試 + 一格會在【這一行被刪掉時變紅】的接線斷言;codex 關卡2 MF-6)。
  //   🔴 **本段的位置是有意義的,不要往上搬。**
  //      `sourceExternalIds`(:306)與 `sourceVariantSkus`(:307)必須在本段【之前】就建好 ——
  //      它們是 S4 來源消失對賬 / V1 孤兒變體對賬的分母。若把本段搬到它們之前,
  //      被跳過的商品會從那兩個集合裡消失 ⇒ **被當成「來源已無此品」而軟下架、變體被硬刪**。
  //      那是「跳過」變成「悄悄下架客人看得到的商品」,而畫面上不會有任何異常。
  //      (title-shape-gate.test.ts 有一發讀本檔原始碼釘住這個順序。)
  const titleGate = runTitleShapeGate(productRows, { dryRun: DRY_RUN });
  if (titleGate.skipExternalIds.length) {
    // 丙:跳過那幾筆、其餘照匯。移除邏輯在模組裡(那裡有直接測它的斷言)。
    applyTitleGateSkip(productRows, variantsByExternalId, variantRows, titleGate.skipExternalIds);
    // 非零退出(cron 警報);**不影響本次寫入** —— exitCode 在行程結束才生效。
    process.exitCode = 1;
  }

  // ── 🔴🔴 不准上架名單(⟦supply-RIZOMASPECWRONG⟧)——【擋在兩條寫入路徑之前】──
  //
  // ⛔ ~~我 2026-09-04 第一版只擋在 `syncVariantGroupAtomic` 裡~~ ⇒ **繞得過**。
  //    成因(codex 派工時 `-94` 要我查, 而查出來的是我自己講錯了):
  //      我逐字寫過「`syncVariantGroupAtomic` 是全 repo【唯一】寫 `products` 的路」——
  //      **依據是「`rpc('sync_product_variant_group')` 在 `rpm-load.ts` 只出現一次」**
  //      🔴 而【那支 RPC 只被呼叫一次】與【products 只有一條寫入路徑】是兩個宣稱。
  //    實際有兩條:`:647` 的 `upsertBatched(target, 'products', …)`(一般群)
  //              與 `:749` 的 `syncVariantGroupAtomic`(transition hazard 群)。
  //    🛑 **而走哪一條是【資料】決定的, 不是設定決定的** ⇒ 今天擋得住而重灌那天可能擋不住,
  //       **而中間沒有任何東西會叫。**
  //
  // ✅ ⇒ 移到這裡:兩條路都源自 `productRows` / `variantsByExternalId`
  //    ⇒ **一份名單、一道擋。**(主視窗 2026-09-04 裁甲)
  //
  // 🔴 **位置與 titleGate 同一格, 而理由也同一條**:`sourceExternalIds`(`:314`)必須在
  //    本段【之前】就建好 —— 否則被擋掉的商品會從那個集合裡消失
  //    ⇒ 被當成「**來源已無此品**」⇒ 📌 **「不要更新它」會變成「悄悄下架它」。**
  //    ⇒ 那正是我們最不想要的結果:那兩群現在還在架上賣, 只是顏色是錯的。
  const deniedHits = productRows
    .map((p) => findDeniedGroup(config.supplierSlug, p.external_id))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  if (deniedHits.length) {
    for (const d of deniedHits) console.error(deniedGroupMessage(d));
    applyTitleGateSkip(
      productRows,
      variantsByExternalId,
      variantRows,
      deniedHits.map((d) => d.externalId),
    );
    // 🔵 非零退出(與 titleGate 同款)—— 不影響本次寫入, 而 cron 看得到。
    process.exitCode = 1;
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
  // 🔴 **預檢要吃【真的會被刪的那些】,不是「所有孤兒」**(codex R1 MF1)。
  //    那道 `pv_spec_unique` 預檢會把「已排定刪除的孤兒」排除掉(它們 upsert 前先刪、不參與模擬)。
  //    ⇒ 而扣留之後它們**不會被刪** ⇒ 若仍然排除,一次**純改名且 spec 相同**的同步
  //      會過得了預檢,然後在 variant upsert 撞 `23505` ——
  //      📌 **而那是「預檢放行 ⇒ products 已經寫進去了」之後才炸,是最貴的位置。**
  const orphansToDelete = orphansToDeleteFor({
    orphans: variantOrphans.aborted ? [] : variantOrphans.orphans,
    withheldOrphans: variantOrphans.withheldOrphans,
  });
  const orphanSkusToDelete = new Set(orphansToDelete.map((o) => o.sku));

  // ── 硬 gate 1:pv_spec_unique preflight(source 群內 + target 模擬)──
  //   dry-run 列報告不 throw(Sean 看完整碰撞清單、Phase 1 處置 C3:bonamici 3 群真正區分軸是尺寸、不在 spec);
  //   寫入模式撞鍵 → abort 不進 upsert(避免 23505 部分寫的髒中間態)。
  //   V1:排除已排定刪除的孤兒 sku(upsert 前先刪、不參與模擬;變體改名同 spec 不再恆撞=F3)。
  const specIssues = await preflightSpecUnique(target, config.supplierSlug, variantsByExternalId, orphanSkusToDelete);
  const finalSpecCollisions = specIssues.filter((issue) => issue.kind === 'final');
  const transitionHazards = specIssues.filter((issue) => issue.kind === 'transition');
  const hazardExternalIds = new Set(transitionHazards.map((issue) => issue.externalId));
  if (!finalSpecCollisions.length) {
    console.log(
      `✅ pv_spec_unique preflight 最終撞鍵 0 / 中途換位 ${hazardExternalIds.size} 群` +
        (hazardExternalIds.size ? '(將走 atomic RPC)' : ''),
    );
  }
  if (transitionHazards.length) {
    console.warn(`[rpm-import] ⚠️ pv_spec_unique 中途換位 ${hazardExternalIds.size} 群、將排除一般 bulk 路徑:`);
    console.table(transitionHazards.slice(0, 50));
    if (transitionHazards.length > 50) console.log(`(另有 ${transitionHazards.length - 50} 個換位點未列)`);
  }
  if (finalSpecCollisions.length) {
    console.warn(`[rpm-import] 🔴 pv_spec_unique 最終撞鍵 ${finalSpecCollisions.length} 個、寫入模式將 abort:`);
    console.table(finalSpecCollisions.slice(0, 50));
    if (finalSpecCollisions.length > 50) console.log(`(另有 ${finalSpecCollisions.length - 50} 個未列)`);
    if (!DRY_RUN) throw new Error('pv_spec_unique preflight 撞鍵、停止(避免部分寫的髒中間態)');
  }

  // ── 價格 delta gate(兩層、唯讀比對)──
  const delta = await computeDelta(target, config.supplierSlug, productRows, variantRows);
  printDeltaReport(delta, { full: DELTA_FULL, json: DELTA_JSON });

  // ── 硬 gate:新品驗價(M1、Codex R1 must-fix)──
  //   delta gate 只比得出「變價」,新品無舊價可比 → 首灌整批零檢查。此處對來源逐筆比對(恆驗)
  //   + 絕對價區間(僅首灌硬擋、日常誤殺率高故只報;實查依據見 rpm-delta.ts)。
  //   dry-run 印報告不 throw(對齊其他 gate);寫入模式有 issue → abort 不進 upsert。
  // 🔴🔴 **這條路有【兩個世界】:首灌(`isFirstLoad=true`)與日常(`false`), 而它們走不同的閘。**
  //   改動任何一個價格判準 ⇒ **兩個世界各跑一發**, 只跑一發等於只驗了一半。
  //   📌 這一行是 2026-08-25 補的, 而補它的理由是一次實錘:本片(放行 0 元贈品)的
  //     三發突變**全部跑在日常那條路上** ⇒ 完全沒有碰到首灌, 而首灌上有一道
  //     `NEW_ITEM_PRICE_FLOOR = 100` 的硬擋會把 0 元贈品整批 abort
  //     (在 `rpm-delta.ts`,🔴 **用 `grep -n "export const NEW_ITEM_PRICE_FLOOR" scripts/rpm-delta.ts` 找,
  //      不要寫行號** —— 見本段最下方那條自陳)。
  //     漏掉它的不是眼力, 是**測試選取比爆炸半徑窄** —— 而這是這個病的第【二】次
  //     (第一次:2026-08-23 L5, 新檔只跑了自己那個目錄的測試)。
  //
  // 🔴🔴 **首灌【不放行】0 元贈品 —— 而這是拍板, 不是漏掉的。**
  //   Sean 2026-08-25 拍板甲:贈品之後走**日常匯入**補上, `NEW_ITEM_PRICE_FLOOR = 100`
  //   那道閘**一個字都不改**(同上, 用 `grep -n "export const NEW_ITEM_PRICE_FLOOR"` 找)。
  //   理由:那道閘的註解逐字寫「疑小數點/單位錯位」⇒ **它防的是【打錯字】, 不是防贈品**;
  //   而機械上分不出「0 是贈品」與「0 是把 1000 打成 0」⇒ 放寬它等於同時放掉打錯字那一半。
  //   代價 = 上架要分兩趟。這是他知情之下選的。
  //   ⚠️ **不要「順手」把 floor 改成 0 或加 0 的例外** —— 那會推翻一條拍板,
  //     而且 diff 上看起來只是修好一個明顯的漏洞。拍板全文:
  //     memory `project_0825-sean-first-load-excludes-gifts.md`
  //     (完整路徑 `~/.claude/projects/-Users-sean-1-pcm-website-v2/memory/`;2026-08-25 實查存在)
  //
  // 🔴🔴 **自陳(這一段自己踩過一次, 留著給下一個人)**:
  //   本段原本寫「見 rpm-delta.ts:174」—— 那是**動手改之前**的行號。
  //   而這份 diff 自己在 `rpm-delta.ts` 上游加了註解 ⇒ 套用之後那個常數**往下移了**,
  //   而 `:174` 指到一句完全不相干的話。
  //   🔴🔴 **而這段話原本自己也端出了兩個數字(常數搬到哪一行 / 上游加了幾行), 兩個都是錯的。**
  //     成因:我量它們的時候檔案**還沒改完**, 之後繼續編輯而**沒有回頭重量**。
  //     ⇒ 處置是**把數字整個拿掉**, 不是換成新的正確值 —— 換成新的, 明天會再過期一次。
  //     📌 一段【主旨就是「行號會過期」】的話, 自己端出兩個過期的數字。
  //        **寫下規矩不會讓你遵守它;把數字換成 grep 才會。**
  //   ⇒ **我在同一次改動裡, 弄壞了我自己剛寫下的座標。** 沒有任何一刻是不一致的
  //     (寫的當下是對的), 所以沒有測試、沒有 lint、沒有審查會撞到它。
  //   ⇒ **規矩:跨檔指路一律用【可 grep 的字面錨】, 不寫行號。**
  const isFirstLoad = fetchIntegrity.targetActiveCount === 0;
  const productPriceByExtId = new Map(productRows.map((p) => [p.external_id, p.price_general]));
  const variantPriceBySku = new Map(variantRows.map((v) => [v.sku, v.price_general]));
  const newItemPriceIssues = checkNewItemPrices(
    [
      ...delta.newProductKeys.map((key) => ({
        level: 'product' as const,
        key,
        price: productPriceByExtId.get(key) ?? null,
        sourcePrice: sourceGroupPrice.get(key) ?? null,
      })),
      ...delta.newVariantKeys.map((key) => ({
        level: 'variant' as const,
        key,
        price: variantPriceBySku.get(key) ?? null,
        sourcePrice: sourceVariantPrice.get(key) ?? null,
      })),
    ],
    { enforceBand: isFirstLoad },
  );
  printNewItemPriceReport(newItemPriceIssues, {
    newProducts: delta.newProducts,
    newVariants: delta.newVariants,
    enforceBand: isFirstLoad,
  });
  if (!DRY_RUN && newItemPriceIssues.length) {
    // 🔴🔴 2026-08-25:**這個 throw 原本會把兩個世界合流。**
    //   Sean 拍板甲:首灌(`isFirstLoad`)【不放行 0 元贈品】, 贈品走日常匯入補上,
    //   而 `NEW_ITEM_PRICE_FLOOR = 100` 那道閘**一個字都不改**(理由見上面 isFirstLoad 那段)。
    //   ⇒ 問題是:撞到時它只印「新品驗價 N 筆問題」——**那句話不會說「因為你放了贈品」**,
    //     而這條拍板**零機制在守**(沒有任何東西會提醒首灌的人別放贈品)。
    //   ⇒ 這一段就是唯一會在現場說話的東西。它不改行為, 只讓錯誤訊息分得出世界。
    //
    // 🔴 **`Object.is(p, 0)` 不是 `p === 0`** —— `-0 === 0` 為 true。
    //   `-0` 是**負價取整來的**(來源落在 `[-0.5, 0)`), 它**不是贈品**;
    //   而它會比 `hasAbnormal`(在本行【下方】)更早撞到這道 floor
    //   ⇒ 用 `===` 的話, 一個負價商品會被這行訊息指認成「贈品」。**那正是本片在防的病。**
    // 🔴 **2026-08-25 訂正(codex R2 must-fix 1)**:~~原本只看 `price`~~ ——
    //   那會讓 `source-mismatch` 且 `price` 剛好是 0 的一列, 在**首灌與日常兩個世界都**
    //   印出「贈品?請走日常匯入補上」。而在日常世界, 看到的人**已經在日常匯入了**
    //   ⇒ 照著做只是把同一批壞資料再跑一次, 而真正的病(transform 接線壞)沒人查。
    //   ⇒ 兩個條件都要:**`reason` 必須是 `below-floor`**(才是被 floor 擋的)
    //     **且必須是首灌**(才是那條拍板適用的世界)。
    const giftHintIssues = isFirstLoad
      ? newItemPriceIssues.filter((i) => i.reason === 'below-floor' && Object.is(i.price, 0))
      : [];
    // 🔴 `-0` 這半【不看 isFirstLoad 也不看 reason】—— 只要它出現, 就是「來源有負價」,
    //   而那永遠是要查來源的事, 不是要換一條匯入路徑的事。
    //   ⚠️ **範圍講準**:實際上 `-0` 在【日常】世界走不到這裡(`enforceBand=false`
    //   ⇒ 區間檢查整段 `continue`, 只剩對源比對)。這裡不加條件是**刻意的防禦性寫法**,
    //   不是因為「兩個世界都會發生」—— ~~原本那句寫成後者, 比實情寬~~。
    const negZeroCount = newItemPriceIssues.filter((i) => Object.is(i.price, -0)).length;
    const hint = [
      giftHintIssues.length
        ? `其中 ${giftHintIssues.length} 筆是 0 元且被首灌下限擋下(贈品?Sean 2026-08-25 拍板甲:首灌先上非贈品, 贈品之後走日常匯入補上)`
        : '',
      negZeroCount ? `🔴 其中 ${negZeroCount} 筆是 -0(**負價**取整來的、不是贈品, 查來源)` : '',
    ]
      .filter(Boolean)
      .join(';');
    throw new Error(
      `新品驗價 ${newItemPriceIssues.length} 筆問題、abort 不寫(對源不符=transform 接線壞;區間異常=疑單位錯位;dry-run 看清單)${hint ? `。${hint}` : ''}`,
    );
  }

  if (DRY_RUN) {
    const sample = productRows[0];
    if (sample) {
      const vrs = variantsByExternalId.get(sample.external_id)!;
      console.log('\n-- 抽樣群(transform 驗) --');
      console.log(JSON.stringify({ product: sample, variant_count: vrs.length, sample_variants: vrs.slice(0, 3) }, null, 2));
    }
    // S4 來源消失對賬(只全量;篩選下 source 不完整、跳過避免誤判)。
    // dry-run 即使 gate 觸發也只印報告不 throw(故意:Sean 要看完整報告、不靠 dry-run exit code 當預檢;真跑才 exit 1)。
    if (FULL_MODE) {
      const recon = await computeSourceMissing(target, config.supplierSlug, sourceExternalIds, { allowLargeDelist: ALLOW_LARGE_DELIST });
      printReconcileReport(recon, { full: DELTA_FULL });
    } else {
      console.log('[rpm-import] 來源消失對賬跳過(--group/--limit 篩選、source 不完整、全量才對賬)');
    }
    console.log(`\n[rpm-import] DRY-RUN:${productRows.length} 群 / ${variantRows.length} 變體(未寫入)`);
    console.log('→ 看完 delta/離群/下架對賬、Sean 點頭後、跑正式並帶 --confirm-write');
    return;
  }

  // ── 硬 gate 2:正式寫入守門(codex k2 審查 must-fix 1)──
  // 異常列(null/負/NaN/±Infinity/-0)= 不可覆寫硬 abort、無條件先擋(即使帶旗標也不放行)
  // 🔴 2026-08-25:`0` 已從這個清單移除(Sean 拍板 0 元贈品合法);`-0` 留著 —— 它是負價取整來的。
  if (hasAbnormal(delta)) {
    throw new Error(`價格異常列 ${delta.abnormal.length}(null/負/NaN/±Infinity/-0)、不可覆寫硬 abort、停止(查源頭)`);
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
  // 🔴 #260(保留現值 ①):把 productRows 依「own key 集合」分成數個 uniform 組各自 upsert,避免 postgrest
  //    `?columns` 全批聯集 + defaultToNull 把「省 key」列寫成 NULL(rpm 全批省同樣的 key → 只有一組 →
  //    現行單批行為 byte 等價)。source-權威鏡射 ② 若採用另議、見 backlog #260。
  //    ⚠️ 2026-08-07 由「只按 description 二分」改為 groupByKeySignature 全 key 分組:條件省 key 的欄已達三個 ——
  //       description(per-row、視來源空否)、manuals / video_url(per-row、來源 null 防清空,見 rpm-transform
  //       transformGroup 內註)。舊註「manuals/video_url 屬供應商級、天然 uniform、不需納入」自該次改動起作廢。
  //       新增任何條件省 key 欄不需再改這裡(signature 自動涵蓋)。
  // 🔴 跨 apply 停點護欄(見 rpm-load.stripColumnIfMissing 的完整理由):sound_clips 的 DB 欄由
  //    20260808000000 migration 建立。本檔可能先於 apply 被 merge 進 dev,而 rpm-sync cron 每日
  //    帶 --confirm-write 跑 —— 探測必須在分批之前跑完,否則剝 key 會改變 key-signature、分組失效。
  await stripColumnIfMissing(target, 'products', productRows, 'sound_clips');

  const savedProducts: Record<string, unknown>[] = [];
  for (const group of groupByKeySignature(productRows)) {
    savedProducts.push(
      ...(await upsertBatched(target, 'products', group, 'supplier_slug,external_id', 'id, external_id')),
    );
  }
  const idByExtId = new Map(savedProducts.map((r) => [r.external_id as string, r.id as string]));

  // transition hazard 群完整排除一般 orphan delete / bulk upsert，交給單一 RPC 原子處理。
  // 一般群維持既有路徑；本 slice 的 rollback 承諾只涵蓋 hazard 商品群的變體，不擴成整家供應商大交易。
  // 🔴 **被扣留的不進刪除清單** —— 這一行就是「乙」的全部行為改變。
  //    (`withheldOrphans` 要嘛是空的、要嘛就是 `orphans` 整份 —— 見 classifyVariantOrphans。)
  //
  // ✅ **而它【同時關掉兩條刪除路徑】,我開檔確認過** —— 這一格重要,因為
  //    「只關掉一半」會比全開或全關都難理解:
  //      一般群 ⇒ `variantWork.regularOrphanSkus` ⇒ `applyVariantDelete`
  //      hazard 群 ⇒ `variantWork.atomicGroups[].orphanSkus` ⇒ 原子 RPC 內
  //                 `DELETE … WHERE sku = ANY(p_orphan_skus)`(`20260825120000:303-306`)
  //    🔵 **兩條都從【同一份 orphans】長出來**(`rpm-load.ts:221-236` 逐字:
  //       `orphanSkusByExternalId` 由傳進來的 `orphans` 建,hazard 群取它的那一份)
  //    ⇒ **傳空陣列 ⇒ 兩條都收到空的 ⇒ 兩條都不刪。**
  //    ⚠️ 而那支 RPC 是【吃參數】不是【自己算要刪誰】—— 我開了 migration 確認,
  //       否則「關掉」只會關掉我看得到的那一半。
  // 🔵 `orphansToDelete` 在**預檢之前**就算好了 —— **同一份餵給預檢與刪除**,
  //    而那正是 MF1 的修法:兩處若各算一次,它們有一天會不一致而沒有人會紅。
  const variantWork = splitVariantSyncWork(variantsByExternalId, orphansToDelete, hazardExternalIds);
  // 🔴 而 hazard 那一半只能在**預檢之後**算(`hazardExternalIds` 是預檢的產物)。
  const skippedHazardGroups = hazardGroupsToSkip({
    withheldOrphans: variantOrphans.withheldOrphans,
    hazardExternalIds,
  });

  // ── V1 一般群孤兒變體硬刪(variants upsert 前)──
  //   ⚠️ 一般群仍是既有非交易行為；hazard 群 orphan 已排除，由 RPC 內同交易刪除。
  if (variantWork.regularOrphanSkus.length) {
    const deleted = await applyVariantDelete(target, config.supplierSlug, variantWork.regularOrphanSkus);
    console.log(`[rpm-import] 孤兒變體硬刪:${deleted} 列(scope ${config.supplierSlug};order_items FK SET NULL、歷史不破)`);
  }

  // ── V1b 「該刪而沒刪」的那張清單(2026-08-31,Sean 拍【乙 = 寧可少刪】)──
  //
  // 🛑 **乙不是「什麼都不做」,乙是【把刪除換成一張清單】。**
  //    Sean 逐字:「乙 = 寧可少刪 —— 不確定就不下架」(最後一則「確定乙」明確確認)。
  //
  // 🔴 **而它今天的量級**:那個「source 是完整的」的證據**現在不存在**(報價單那一側沒有 sync_log)
  //    ⇒ `sourceCompleteness` 恆為 `'unknown'` ⇒ **今天這等於把孤兒刪除整個關掉。**
  //    ⇒ 📌 **所以下面這個數字不是附帶產物,它是這個決定的【全部代價】** ——
  //      沒有人看它 ⇒ 殘留變體安靜累積 ⇒ 可下單、凍結舊價(那正是那道閘原本要防的)。
  //
  // ⚠️ **而這一行 log【不滿足】plan §六 那條驗收**:「log 只滿足『當晚看得到』,
  //    不滿足『隔天查得到』」⇒ **本片明寫這個缺口,不假裝它完整。**
  //    ⇒ 真正的落點是那張同步結果表(報價單側,尚未建)⇒ `⟦b4-WITHHELD1⟧`。
  if (variantOrphans.withheldOrphans.length) {
    const sample = variantOrphans.withheldOrphans.slice(0, 10).map((o) => o.sku);
    console.log(
      `[rpm-import] 🔴 該刪而【沒刪】:${variantOrphans.withheldOrphans.length} 個孤兒變體` +
        `(source 完整性=${variantOrphans.sourceCompleteness};scope ${config.supplierSlug})` +
        ` — ${sample.join(', ')}${variantOrphans.withheldOrphans.length > 10 ? ' …' : ''}`,
    );
  } else {
    // 🔴 **零也要印** —— 「不印」與「這一輪沒有扣留」長得一樣(plan §六,`-b6` 提的)。
    console.log(
      `[rpm-import] 該刪而沒刪:0 個(source 完整性=${variantOrphans.sourceCompleteness})`,
    );
  }

  const regularVariantRowsWithProduct = productRows
    .filter((pr) => !hazardExternalIds.has(pr.external_id))
    .flatMap((pr) =>
      variantsByExternalId.get(pr.external_id)!.map((vr) => ({ ...vr, product_id: idByExtId.get(pr.external_id)! })),
    );
  if (regularVariantRowsWithProduct.length !== variantWork.regularVariants.length) {
    throw new Error('variant work 分流計數不一致、拒絕寫入');
  }
  await upsertBatched(target, 'product_variants', regularVariantRowsWithProduct, 'supplier_slug,sku');

  // ── 🔴 純觀測:失敗時留下「停在哪裡」——【零行為改動】(⟦b4-PARTIAL1⟧ 第一版)────────────
  //   為什麼要這一段:這個迴圈失敗時留下的是**半寫入的中間態**,不是「整批回捲」——
  //     失敗點【之前】已經 commit(:651 的 upsertBatched 每 500 列各自一個交易)、
  //     失敗那一群整群沒進去、失敗點【之後】的**從來沒有被送出去**。
  //   2026-08-28 Gilles 那次,三方(對方 repo / Sean / 主視窗)都把它讀成「整批回捲」,
  //     而沒有人答得出「1,817 裡實際進去幾筆」——
  //     🔴 **那不是因為沒人查,是因為那個數字從來沒有被產生過。**
  //
  //   🔴 **本段只記錄、不改行為**:catch 之後**原封 re-throw**(`throw e`,不包裝)。
  //     「留下痕跡」與「改變失敗行為」是兩件事;寫進同一顆 commit,
  //     之後出事時沒有人分得出是哪一半造成的。「跳過並繼續」= 第二版,要另外拍板。
  //
  //   ⚠️ **本段「行為沒變」這個宣稱只在單元層成立**(Sean 未拍、主視窗 2026-08-28 選乙):
  //     我們證的是「餵一個會 throw 的假 syncFn 時,流程與修前相同」,
  //     **沒有證「真的連 DB 跑一次時相同」** —— 缺的檢查 = 起拋棄式 PG 實跑一次。
  //   🔴 迴圈本體抽到 `rpm-partial-report.ts` 的唯一理由 = **可測**:
  //     本檔檔尾直接 `main()`(無 `import.meta` 守衛)⇒ 一被 import 就會把整個匯入跑起來。
  // 🔴 **被扣留的 hazard 群整個跳過** —— 傳空 orphan 清單給那支 RPC 會撞
  //    「payload 不是完整商品群(缺 orphan)」的斷言 ⇒ **那是 abort,不是不刪**(codex R1 MF2)。
  const atomicToRun = variantWork.atomicGroups.filter(
    (g) => !skippedHazardGroups.includes(g.externalId),
  );
  if (skippedHazardGroups.length) {
    console.log(
      `[rpm-import] 🔴 因扣留而【整群跳過】原子同步:${skippedHazardGroups.length} 群` +
        ` — ${skippedHazardGroups.slice(0, 10).join(', ')}`,
    );
  }
  await runAtomicGroups(atomicToRun, config.supplierSlug, async (group) => {
    const synced = await syncVariantGroupAtomic(
      target,
      config.supplierSlug,
      group.externalId,
      group.variants,
      group.orphanSkus,
    );
    console.log(`  product_variants atomic:${group.externalId} ${synced}/${group.variants.length}`);
  });
  // 🔴 **codex R1 MF1**:`atomicToRun` 已經把被扣留的 hazard 群濾掉了, 而這一行原本仍印
  //    `variantWork.atomicGroups.length`(**濾之前**的數)⇒ **跳過的群被算進「WRITE 完成」**。
  //    ⚠️ 而 runbook 拿這一行當完成依據 ⇒ 一個【沒同步的群】會被讀成成功。
  //    📌 **⇒ 印出來的數要是【真的跑過的那個集合】的長度, 不是它上游那個。**
  //    🔵 跳過的群另外印, 不併進同一個數 —— 併進去就等於用一個總數蓋掉兩件事。
  // 🔴 **codex R2**:R1 我只把「群數」換成 `atomicToRun`, 而**變體總數仍是 `variantRows.length`**
  //    ——那是**濾之前**的全集 ⇒ 被扣留那幾群的變體照樣被算進「WRITE 完成」。
  //    📌 **⇒ 這就是「改對一半」**:一個數字改對了, 而它旁邊那個沒跟 ——
  //       而修好的那一半會讓人相信整行都對了。(同族:R1 的 (b) 也是「訊息與行為對不上」。)
  const atomicVariantsRun = atomicToRun.reduce((n, g) => n + g.variants.length, 0);
  const writtenVariants = regularVariantRowsWithProduct.length + atomicVariantsRun;
  // 🔴 **「WRITE 完成」那一行搬到 S4 之後了 —— 見本段末尾。**(片B2, codex R3)
  // ── S4 來源消失對賬(源頭消失 → **標記** source_missing_at,不下架;upsert 後跑、只全量)──
  // 🔴 2026-08-15 `#20` 片2b:本段**不再下架任何商品**(Sean `Q-B-2=甲` / `Q-關哪一條=乙`)。
  //    篩選模式(--group/--limit)整段跳過:那時 source 集合不完整 ⇒ 標記會誤標、清除會誤清。
  if (FULL_MODE) {
    const recon = await computeSourceMissing(target, config.supplierSlug, sourceExternalIds, { allowLargeDelist: ALLOW_LARGE_DELIST });
    printReconcileReport(recon, { full: DELTA_FULL });
    if (recon.aborted) {
      throw new Error(`來源消失對賬安全 gate 觸發、不標記:${recon.abortReason}`); // 🔴 loud alert + 非零退出(cron 警報)
    }
    if (recon.toMark.length) {
      const n = await markSourceMissing(target, config.supplierSlug, recon.toMark, now);
      console.log(
        `[rpm-import] 來源消失對賬完成:標記 ${n} 商品(source_missing_at=now、scope ${config.supplierSlug})` +
          ' — 🔴 這些商品仍然維持上架、仍可購買,只是後台會顯示「原廠已無此品」',
      );
    } else {
      console.log('[rpm-import] 來源消失對賬:無待標記');
    }
    // 反向:來源重新出現 → 清回 NULL。沒有這一步,標記會永遠黏著(商品早回來了、畫面還說沒有)。
    const cleared = await clearSourceMissing(target, config.supplierSlug, [...sourceExternalIds]);
    if (cleared) console.log(`[rpm-import] 來源重新出現:清除 ${cleared} 筆「原廠已無此品」標記`);
  } else {
    console.log('[rpm-import] 來源消失對賬跳過(--group/--limit 篩選、非全量、避免誤標與誤清)');
  }

  // ══ 🔴 片B2(codex R3 must-fix):這一行【原本印在 S4 之前】════════════════════
  //   而 S4 會 `throw`(來源消失對賬安全 gate 觸發)⇒ 舊順序下, 一次【中途失敗的同步】
  //   仍然會先印出「WRITE 完成:N 商品 / M 變體」, 然後才 throw。
  //   📌 **⇒ 而 runbook 與操作的人是拿那一行當完成依據的** —— 他看到「完成」就走了。
  //   🛑 **這一格【沒有任何測試守著】**:本檔檔尾直接 `main()`(無 `import.meta` 守衛,
  //      理由見上方 :727 那段)⇒ 一被 import 就整支跑起來 ⇒ 要測它得先拆檔, 那是另一片。
  //      ⇒ 所以它靠的是【位置】不是【斷言】—— 而位置這種東西, 下一個人很容易順手搬回去。
  //   ⚠️ **這是一個可觀察行為的改變, 不是純搬移**:
  //      · S4 throw 的那一輪, 這一行【不再印】(舊行為:印了才 throw)
  //      · 輸出順序變了:S4 那幾行(標記 / 清除 / 跳過)現在【在這一行之前】
  //      ⇒ 任何用「WRITE 完成 是最後一行」或「它在 S4 之前」來剖 log 的東西都會受影響。
  //   🔵 而扣留那幾群仍然只在括號裡另計, 不併進主數字 —— 那是 R1/R2 那兩條, 本片沒有動它。
  console.log(
    `[rpm-import] WRITE 完成:${productRows.length} 商品 / ${writtenVariants} 變體` +
      `(一般 ${regularVariantRowsWithProduct.length} / atomic ${atomicToRun.length} 群 ${atomicVariantsRun} 變體` +
      `${skippedHazardGroups.length ? ` / 🔴 扣留跳過 ${skippedHazardGroups.length} 群(其變體【不計入】上面那個數)` : ''})`,
  );
}

main().catch((e) => {
  console.error('[rpm-import] FAILED:', e);
  process.exit(1);
});
