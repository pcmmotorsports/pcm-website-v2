/**
 * rpm-reconcile — S4 來源消失對賬(源頭消失 → **標記**,不下架)+ V1 變體級對賬
 *
 * 🔴🔴 2026-08-15 `#20` 片2b **本檔不再下架任何商品**(規格 `docs/specs/2026-08-15-products-manual-listing-override-plan.md` v5)
 *   Sean 拍板 `Q-B-2=甲`(把自動下架關掉、改成只標記)+ `Q-關哪一條=乙`(鏡射與對賬兩條都關)。
 *   業務理由逐字:「**如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態**」。
 *   ⇒ 原 `applyDelist`(寫 `delisted_at=now`)→ `markSourceMissing`(寫 `source_missing_at=now`);
 *     新增反向 `clearSourceMissing`(來源重新出現 → 清回 NULL,否則標記永遠黏著)。
 *   ⇒ **`delisted_at` 從此不由本管線寫入**。員工手動上下架的入口在後續片(plan §5 `Q3=乙`)——
 *     **在那片做好之前,系統裡沒有任何機制會下架任何商品**(plan §7-2、backlog `#510`,Sean 明示接受)。
 *
 * lifecycle(片2b 後):
 *   - 上架/下架:**本管線完全不碰** `delisted_at`(rpm-transform 也不再鏡射來源值)。
 *   - 來源消失:target 現存「未下架」商品中、不在本次 source external_id 集合者 → 設 `source_missing_at=now`。
 *     ⚠️ **範圍限度**:讀取端 `readActiveExternalIds` 仍只讀「未下架」的列 ⇒ **已經下架的商品
 *     (正式庫現有 560 筆)不會被標記**。刻意不改 —— 改讀取範圍會同時改掉下面兩道安全閘的分母。
 *   - 來源重新出現:`clearSourceMissing` 清回 NULL(只在 FULL 模式;篩選模式下「沒吐」不代表消失,會誤清)。
 *   - 變體:無 `delisted_at` 欄;孤兒變體仍走硬刪(見下方 V1)。**本片刻意不動 `liveVariantsOf`**
 *     (plan §2b;`Q-部分停產=甲` 但另開一片做)。
 *   - 🔴 變體級對賬(V1、2026-07-05 雙跨模型審查 must-fix F1-F3):群(main_sku)還在、但群內某
 *     variant sku 從來源消失 → 該變體殘留 DB + 前台選項可見 + create_order 可下單(凍結舊價)=
 *     客人買到停產色。修:computeVariantOrphans 差集(scope=本次要寫的群)→ 寫入模式 applyVariantDelete
 *     **硬刪**(order_items.variant_id FK ON DELETE SET NULL、migration 20260604120000:143 註明
 *     「變體刪不破歷史」;order_items 自帶 sku/spec/價快照欄、cart stale variantId 已有 found:false 路徑)。
 *     刪除在 products upsert 後、variants upsert **前**(變體改名同 spec 時先清舊列、免撞 pv_spec_unique 23505=F3)。
 *
 * 🔴 安全紅線(**片2b 後守的是「標記」而非「下架」,但大量異動仍該警報 —— 閘刻意保留**):
 *   - source 集合為空 → 硬 abort(疑 fetch 失敗、不標記全部、不可 bypass)。
 *   - 待標記比例 > SOURCE_MISSING_RATIO_ABORT(疑來源殘缺、批次部分抓)→ abort 除非顯式 --allow-large-delist。
 *     ⚠️ CLI 旗標字面仍是 `--allow-large-delist`(對外介面、workflow 與既有文件都在用)⇒ **刻意不改名**,
 *        改名要另開一片同步 `.github/workflows/rpm-sync.yml` 與 runbook。**這是已知的字面債,不是漏改。**
 *   - 只在 FULL 模式跑(無 --group/--limit;篩選下 source 不完整、跑了會誤標/誤清)→ 由 rpm-import 把關。
 *   - markSourceMissing / clearSourceMissing 一律 scope supplier_slug=<呼叫端 supplierSlug>(每家自成一輪)
 *     + `source_missing_at IS NULL` / `IS NOT NULL`(冪等、不覆寫既有時戳)。
 *
 * 全程唯讀比對 + 只在 confirm-write 才 UPDATE;唯讀 SELECT 只取 external_id(不取金額/敏感欄)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const READ_BATCH = 1000;
const WRITE_BATCH = 500;
const SOURCE_MISSING_RATIO_ABORT = 0.1; // 單次標記比例硬上限(>10% 疑來源殘缺;確認後 --allow-large-delist 放行)

export interface ReconcileReport {
  targetActive: number; // target 現存未下架商品數
  sourcePresent: number; // 本次 source 出現的 external_id 數
  toMark: string[]; // target 有、source 無 → 待標記「來源已消失」的 external_id(片2b 前叫 toDelist)
  ratio: number; // toMark / targetActive
  aborted: boolean; // 安全 gate 觸發(不可標記)
  abortReason?: string;
  largeDelistBypassed: boolean; // ratio 超限但 --allow-large-delist 顯式放行(loud log 提醒、留 audit trail)
}

/** 分批讀 target 現存「未下架」RPM 商品 external_id(只取 key、不取金額/敏感;S5 W1 共用) */
export async function readActiveExternalIds(tgt: SupabaseClient, supplierSlug: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += READ_BATCH) {
    const { data, error } = await tgt
      .from('products')
      .select('external_id')
      .eq('supplier_slug', supplierSlug)
      .is('delisted_at', null)
      .order('external_id')
      .range(from, from + READ_BATCH - 1);
    if (error) throw new Error(`readActiveExternalIds@${from}: ${error.message}`);
    const rows = (data ?? []) as { external_id: string }[];
    out.push(...rows.map((r) => r.external_id));
    if (rows.length < READ_BATCH) break;
  }
  return out;
}

/**
 * 算「來源已消失」的名單:target 未下架商品 − 本次 source external_id 集合。
 * 套用安全 gate(source 空 / 比例超限)、回報告(不寫)。
 * 🔴 片2b 起,這份名單的用途是**標記** `source_missing_at`,**不再是下架**。
 */
export async function computeSourceMissing(
  tgt: SupabaseClient,
  supplierSlug: string,
  sourceExternalIds: Set<string>,
  opts: { allowLargeDelist?: boolean } = {},
): Promise<ReconcileReport> {
  const active = await readActiveExternalIds(tgt, supplierSlug);
  const toMark = active.filter((id) => !sourceExternalIds.has(id));
  const ratio = active.length > 0 ? toMark.length / active.length : 0;

  const largeDelist = toMark.length > 0 && ratio > SOURCE_MISSING_RATIO_ABORT;
  let aborted = false;
  let abortReason: string | undefined;
  let largeDelistBypassed = false;
  if (sourceExternalIds.size === 0) {
    aborted = true;
    abortReason = '來源 external_id 集合為空(疑 fetch 失敗)、絕不標記全部、硬 abort(不可 bypass)';
  } else if (largeDelist && !opts.allowLargeDelist) {
    aborted = true;
    abortReason = `待標記「來源已消失」比例 ${(ratio * 100).toFixed(1)}% 超上限 ${SOURCE_MISSING_RATIO_ABORT * 100}%(疑來源殘缺/部分抓);確認屬實後帶 --allow-large-delist`;
  } else if (largeDelist) {
    largeDelistBypassed = true; // ratio 超限但顯式 --allow-large-delist 放行 → printReconcileReport loud log + audit
  }
  return {
    targetActive: active.length,
    sourcePresent: sourceExternalIds.size,
    toMark,
    ratio,
    aborted,
    abortReason,
    largeDelistBypassed,
  };
}

/** 欄位還沒 apply 時的兩個已知錯誤碼(對照 `rpm-load.ts:105-107` 同一組判別) */
const UNDEFINED_COLUMN = '42703'; // PG:column does not exist
const SCHEMA_CACHE_MISS = 'PGRST204'; // PostgREST:欄不在 schema cache
const SOURCE_MISSING_COLUMN = 'source_missing_at';

/**
 * 🔴 跨 apply 停點閘(plan §3 片2b;Sean `Q-同步失敗策略=甲`)。
 * 情境:片2b 的 code 上線了、而 `20260815030000` 還沒 apply ⇒ 隔天凌晨 cron 照跑 ⇒ 打一個不存在的欄。
 * ⚠️ 咬的是**每天自動跑的東西,壞掉時沒有人在看** ⇒ 選擇「**跳過這一步 + 大聲記錄,其餘同步照跑**」,
 *    不 abort 整批(這一欄不影響既有商品資料正確性,為它停掉整條每日同步不划算)。
 * ⚠️ **不能直接用 `rpm-load.stripColumnIfMissing`** —— 那支剝的是 upsert payload 的 key;
 *    這裡是**單欄 UPDATE**,剝光就沒有這個語句了。**兩側不對稱,不套同一條。**
 */
/**
 * 🔴 **fail-closed:只有錯誤確實指向「這個欄不存在」才算命中,其他一律往外 throw。**
 *
 * 關卡2 must-fix(2026-08-15):我的初版寫成「訊息含 `source_missing_at` 就算」——**那太寬**。
 * 23505、權限錯誤、逾時,只要訊息碰巧提到欄名就會被誤判成「欄還沒建」⇒ **cron 不報錯、靜靜跑完**。
 * ⚠️ **通則**:任何「接住錯誤然後繼續」的東西,要問的不是「接住了嗎」,**是「接住了不該接的嗎」**。
 * fail-soft 的預設失敗方式,就是連不該 soft 的也 soft 掉。
 *
 * 判別邏輯**逐字對齊本 repo 既有前例** `rpm-load.ts:105-108`(`stripColumnIfMissing`)——
 * 那支的註解早就寫著「只比對欄名太寬」。**同一個坑,前例已經填過,我照抄而不是自己再發明一次。**
 */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === UNDEFINED_COLUMN ||
    error.code === SCHEMA_CACHE_MISS ||
    // 訊息比對只是備援,且**必須同時**命中欄名與「找不到這個東西」的措辭
    (!!error.message &&
      error.message.includes(SOURCE_MISSING_COLUMN) &&
      /does not exist|could not find|unknown column/i.test(error.message))
  );
}

function warnColumnNotApplied(fn: string): void {
  console.warn(
    `⚠️ [rpm-reconcile] ${fn} 跳過:products.source_missing_at 不存在(migration 20260815030000 尚未 apply)。` +
      ' 其餘同步照跑;apply 後本步驟會自動恢復,無需人工補跑(下一輪 FULL 同步會重算)。',
  );
}

/**
 * 標記「來源已消失」:UPDATE source_missing_at=now WHERE supplier_slug=… AND external_id IN batch AND source_missing_at IS NULL。
 * 回實際標記列數(.select 計);冪等(再跑不重複設、IS NULL 過濾)。
 * 🔴 **不碰 `delisted_at`** —— 片2b 起本管線不下架任何商品(見檔頭)。
 */
export async function markSourceMissing(tgt: SupabaseClient, supplierSlug: string, externalIds: string[], now: string): Promise<number> {
  let n = 0;
  for (let i = 0; i < externalIds.length; i += WRITE_BATCH) {
    const batch = externalIds.slice(i, i + WRITE_BATCH);
    const { data, error } = await tgt
      .from('products')
      .update({ source_missing_at: now })
      .eq('supplier_slug', supplierSlug) // 🔴 scope 該供應商(rollback 反向也須此 scope)
      .is('source_missing_at', null) // 冪等:只動尚未標記的、不覆寫既有時戳(保留「第一次消失」的語意)
      .in('external_id', batch)
      .select('external_id');
    if (isMissingColumn(error)) {
      warnColumnNotApplied('markSourceMissing');
      return 0;
    }
    if (error) throw new Error(`markSourceMissing batch@${i}: ${error.message}`);
    n += (data ?? []).length;
    console.log(`  標記來源已消失: ${Math.min(i + WRITE_BATCH, externalIds.length)}/${externalIds.length}`);
  }
  return n;
}

/**
 * 反向:來源**重新出現**的商品 → `source_missing_at` 清回 NULL。
 * 沒有這一支,標記會永遠黏著 —— 商品早就回來了,畫面還在說「原廠已無此品」。
 * 🔴 **只能在 FULL 模式呼叫**:篩選模式(`--group`/`--limit`)下「來源沒吐」不代表消失,
 *    拿那份不完整的集合來清,會把真正消失的標記一起洗掉。由 rpm-import 把關。
 */
export async function clearSourceMissing(tgt: SupabaseClient, supplierSlug: string, sourceExternalIds: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < sourceExternalIds.length; i += WRITE_BATCH) {
    const batch = sourceExternalIds.slice(i, i + WRITE_BATCH);
    const { data, error } = await tgt
      .from('products')
      .update({ source_missing_at: null })
      .eq('supplier_slug', supplierSlug)
      .not('source_missing_at', 'is', null) // 冪等:只動目前有標記的
      .in('external_id', batch)
      .select('external_id');
    if (isMissingColumn(error)) {
      warnColumnNotApplied('clearSourceMissing');
      return 0;
    }
    if (error) throw new Error(`clearSourceMissing batch@${i}: ${error.message}`);
    n += (data ?? []).length;
  }
  return n;
}

// ── V1:變體級對賬(孤兒變體=群在、變體 sku 從來源消失;2026-07-05 雙跨模型審查 must-fix)──

const VARIANT_DELETE_RATIO_ABORT = 0.1; // 單次孤兒刪除比例硬上限(對齊商品下架 10%;疑來源變體殘缺、防誤刪)

export interface VariantOrphan {
  sku: string;
  externalId: string; // 所屬群 main_sku(報告用、客訴可回查)
}

export interface VariantOrphanReport {
  targetInScope: number; // target 現存、parent 在本次 source 群集合內的變體數(比例分母)
  sourceSkuCount: number; // 本次 source 變體 sku 數
  orphans: VariantOrphan[]; // target 有、source 無 → 待硬刪
  ratio: number; // orphans / targetInScope
  aborted: boolean; // 安全 gate 觸發(不可刪)
  abortReason?: string;
  largeDeleteBypassed: boolean; // ratio 超限但 --allow-large-delist 顯式放行(loud log、audit trail)
}

/**
 * 純分類(可測):target 變體(sku+所屬群 externalId)vs 本次 source。
 * 孤兒判定 = parent 群在本次 source 集合內(該群變體集完整、差集可信)且 sku 不在 source sku 集合。
 * parent 不在 source → 交給商品級 delist 路徑(RLS 連動隱藏)、不在此刪(復架時由下一輪對賬收斂)。
 * 安全 gate(fail-closed、對齊商品級):source sku 集合空 → 硬 abort(疑 transform 失敗、絕不刪全部);
 * 比例 > 10% → abort 除非 allowLargeDelist(顯式放行留 audit)。
 */
export function classifyVariantOrphans(
  targetVariants: VariantOrphan[],
  sourceSkus: Set<string>,
  sourceExternalIds: Set<string>,
  opts: { allowLargeDelist?: boolean } = {},
): VariantOrphanReport {
  const inScope = targetVariants.filter((v) => sourceExternalIds.has(v.externalId));
  const orphans = inScope.filter((v) => !sourceSkus.has(v.sku));
  const ratio = inScope.length > 0 ? orphans.length / inScope.length : 0;

  const largeDelete = orphans.length > 0 && ratio > VARIANT_DELETE_RATIO_ABORT;
  let aborted = false;
  let abortReason: string | undefined;
  let largeDeleteBypassed = false;
  if (sourceSkus.size === 0 && inScope.length > 0) {
    aborted = true;
    abortReason = '來源變體 sku 集合為空(疑 transform 失敗)、絕不刪全部變體、硬 abort(不可 bypass)';
  } else if (largeDelete && !opts.allowLargeDelist) {
    aborted = true;
    abortReason = `孤兒變體比例 ${(ratio * 100).toFixed(1)}% 超上限 ${VARIANT_DELETE_RATIO_ABORT * 100}%(疑來源變體殘缺);確認屬實後帶 --allow-large-delist`;
  } else if (largeDelete) {
    largeDeleteBypassed = true;
  }
  return {
    targetInScope: inScope.length,
    sourceSkuCount: sourceSkus.size,
    orphans,
    ratio,
    aborted,
    abortReason,
    largeDeleteBypassed,
  };
}

/**
 * 讀 target 該供應商全部變體(sku + 所屬群 external_id;embed parent、唯讀非敏感欄)+ 純分類。
 * 全模式可跑:fetch 永遠全量 → 本次要寫的每一群其 source 變體集完整,--group/--limit 篩選下
 * scope 亦只縮到被寫的群(sourceExternalIds 即 productRows 集合)、不會拿殘缺集合誤刪別群變體。
 */
export async function computeVariantOrphans(
  tgt: SupabaseClient,
  supplierSlug: string,
  sourceSkus: Set<string>,
  sourceExternalIds: Set<string>,
  opts: { allowLargeDelist?: boolean } = {},
): Promise<VariantOrphanReport> {
  const targetVariants: VariantOrphan[] = [];
  for (let from = 0; ; from += READ_BATCH) {
    const { data, error } = await tgt
      .from('product_variants')
      .select('sku, products!inner(external_id)')
      .eq('supplier_slug', supplierSlug)
      .order('sku')
      .range(from, from + READ_BATCH - 1);
    if (error) throw new Error(`computeVariantOrphans@${from}: ${error.message}`);
    // supabase-js 動態 embed select 回型別無法靜態推 → 雙 cast escape hatch(同 rpm-delta/readExistingPrices)
    const rows = (data ?? []) as unknown as { sku: string; products: { external_id: string } }[];
    targetVariants.push(...rows.map((r) => ({ sku: r.sku, externalId: r.products.external_id })));
    if (rows.length < READ_BATCH) break;
  }
  return classifyVariantOrphans(targetVariants, sourceSkus, sourceExternalIds, opts);
}

/**
 * 執行孤兒變體硬刪:DELETE WHERE supplier_slug=<scope> AND sku IN batch。
 * 冪等(再跑查無列)。order_items.variant_id FK ON DELETE SET NULL → 訂單歷史不破(自帶快照欄)。
 */
export async function applyVariantDelete(tgt: SupabaseClient, supplierSlug: string, skus: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < skus.length; i += WRITE_BATCH) {
    const batch = skus.slice(i, i + WRITE_BATCH);
    const { data, error } = await tgt
      .from('product_variants')
      .delete()
      .eq('supplier_slug', supplierSlug) // 🔴 scope 該供應商(不變式 1)
      .in('sku', batch)
      .select('sku');
    if (error) throw new Error(`applyVariantDelete batch@${i}: ${error.message}`);
    n += (data ?? []).length;
    console.log(`  孤兒變體 deleted: ${Math.min(i + WRITE_BATCH, skus.length)}/${skus.length}`);
  }
  return n;
}

export function printVariantOrphanReport(r: VariantOrphanReport, opts: { full?: boolean } = {}): void {
  const cap = opts.full ? Number.MAX_SAFE_INTEGER : 50;
  console.log('\n=== 變體級對賬(V1、孤兒變體=群在但變體從來源消失)===');
  console.log(
    `target 變體(本次群範圍): ${r.targetInScope} / source 變體 sku: ${r.sourceSkuCount} / 孤兒(待硬刪): ${r.orphans.length}(${(r.ratio * 100).toFixed(1)}%)`,
  );
  if (r.orphans.length) {
    console.log(`孤兒變體清單(${opts.full ? '全量' : '前 50'};寫入模式將刪除、dry-run 僅列):`);
    console.table(r.orphans.slice(0, cap));
  } else {
    console.log('✅ 無孤兒變體(target 變體全在 source)');
  }
  if (r.largeDeleteBypassed) {
    console.warn(
      `⚠️ 大比例孤兒刪除 ${(r.ratio * 100).toFixed(1)}%(${r.orphans.length} 變體)經 --allow-large-delist 放行 — 請確認來源變體完整、非殘缺誤刪`,
    );
  }
  if (r.aborted) {
    console.error(`🔴 ALERT 變體對賬 abort、不刪:${r.abortReason}`);
  }
}

export function printReconcileReport(r: ReconcileReport, opts: { full?: boolean } = {}): void {
  const cap = opts.full ? Number.MAX_SAFE_INTEGER : 50;
  // 🔴 訊息一律講「標記」不講「下架」(plan §4-11):行為已改成標記,而營運者是照 log 判斷發生了什麼事。
  console.log('\n=== 來源消失對賬(S4;片2b 起只標記、不下架)===');
  console.log(
    `target 現存上架: ${r.targetActive} / source 出現: ${r.sourcePresent} / 待標記「原廠已無此品」: ${r.toMark.length}(${(r.ratio * 100).toFixed(1)}%)`,
  );
  if (r.toMark.length) {
    console.log(`待標記 external_id(${opts.full ? '全量' : '前 50'})—— 這些商品仍會維持上架、仍可購買:`);
    console.table(r.toMark.slice(0, cap).map((id) => ({ external_id: id })));
  } else {
    console.log('✅ 無待標記(target 上架商品全在 source)');
  }
  if (r.largeDelistBypassed) {
    console.warn(
      `⚠️ 大比例標記 ${(r.ratio * 100).toFixed(1)}%(${r.toMark.length} 商品)經 --allow-large-delist 放行 — 請確認來源完整、非殘缺誤標`,
    );
  }
  if (r.aborted) {
    console.error(`🔴 ALERT 來源消失對賬 abort、不標記:${r.abortReason}`);
  }
}
