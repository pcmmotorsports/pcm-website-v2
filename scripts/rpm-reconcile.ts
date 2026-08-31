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
// ⛔ ~~2026-08-31:多一個欄位要用同一道判斷 ⇒ 欄名改成參數~~
// 🔴 **那兩個「新的呼叫端」在同一夜被刪掉了**(第一版設計被推翻)⇒ **今天沒有任何自訂欄名的呼叫端。**
//    ⇒ 參數留著,而它是一個**沒有第二個使用者的通用化** —— codex R1 nit 點名為「半套死介面」。
//    🔵 **留著的理由要寫出來,否則下一個人會刪它**:它零成本(預設值不變、兩個既有呼叫端一行沒動),
//      而那張表遲早會多一個同族欄位(`⟦b4-WITHHELD1⟧` 那張清單就是候選)。
//    ⚠️ **而若那一列最後不落在 `products` 上 ⇒ 這個參數就該收回去。**
function isMissingColumn(
  error: { code?: string; message?: string } | null,
  column: string = SOURCE_MISSING_COLUMN,
): boolean {
  if (!error) return false;
  return (
    error.code === UNDEFINED_COLUMN ||
    error.code === SCHEMA_CACHE_MISS ||
    // 訊息比對只是備援,且**必須同時**命中欄名與「找不到這個東西」的措辭
    (!!error.message &&
      error.message.includes(column) &&
      /does not exist|could not find|unknown column/i.test(error.message))
  );
}

function warnColumnNotApplied(fn: string, column: string = SOURCE_MISSING_COLUMN, mig = '20260815030000'): void {
  console.warn(
    `⚠️ [rpm-reconcile] ${fn} 跳過:products.${column} 不存在(migration ${mig} 尚未 apply)。` +
      ' 其餘同步照跑;apply 後本步驟會自動恢復,無需人工補跑(下一輪 FULL 同步會重算)。',
  );
}

// ⛔ ~~`markVariantsEmptied` / `clearVariantsEmptied` / `externalIdsWithVariants` 與那支新 migration~~
// 🔴🔴 **2026-08-31 全部拿掉** —— 它們是【被推翻的那個設計】的零件:
//    原本要在 `products` 上標「這支商品的變體被清空了」,而 Sean 拍【乙】之後語意變了 ——
//    乙 記錄的是「**這一次**我不確定,所以沒刪」⇒ 那是**每一輪一筆**,不是每支商品一個時戳。
//    ⇒ 📌 **一個標記欄與一張清單,不是同一個東西的兩種寫法 —— 它們的主鍵不同。**
// ⚠️ 而那支 migration 也一併刪了(`20260831020000`)—— **它從來沒有被 apply**,
//    留著只會讓下一個人以為那是現行設計的一部分。


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

/** 這一批 source 是不是完整的。`'unknown'` = 沒有人說得出來(今天恆為它)。 */
export type SourceCompleteness = 'complete' | 'incomplete' | 'unknown';

/**
 * 🔴 **拿不到完整性證據時,預設偏哪一邊。**
 *
 * 🛑 **這是一個【商業取捨】,不是工程判斷** —— 而它會被誤認成工程判斷,因為它的載體是一個 `if`。
 * 📌 **一個商業取捨若剛好只需要改一行碼,它就會被當成一行碼做掉。**
 *
 * 兩邊的代價(各有一個今天量到的實例):
 *   `true`(照刪) ⇒ 商品上架而買不到 —— 那 10 支壞掉的商品就是
 *   `false`(不刪)⇒ 客人買得到而我們訂不到的規格 —— 而它在**出貨那一刻**才炸
 *
 * ⚠️ **它寫成一個具名常數而不是散在 `if` 裡,理由是:這一格 2026-08-31 一夜之內被翻過一次方向**
 * (`-48` 推「照刪」,而 Sean 拍「寧可少刪」;而那一夜它被來回撥了三次)⇒ **它會再被翻。**
 *
 * ✅ **現值 `false` = 乙 = 寧可少刪**(Sean 2026-08-31 逐字「乙 = 寧可少刪 —— 不確定就不下架」,
 * 最後一則「確定乙」明確確認)。
 * 🔴 **而它今天的量級要寫在這裡,不要藏在別的檔**:那個完整性資訊**現在不存在**
 * (報價單那一側沒有 sync_log)⇒ `'unknown'` 是**每一次** ⇒ **今天這等於把孤兒刪除整個關掉。**
 * ⇒ 📌 **所以下面那張「沒刪的清單」不是附帶產物,它是這個決定的【全部代價】。**
 */
export const DELETE_ORPHANS_WHEN_COMPLETENESS_UNKNOWN = false;

/**
 * 「這一輪要送去刪除的孤兒」與「要跳過原子同步的 hazard 群」。
 *
 * 🔴🔴 **抽成純函式的理由是 codex R1 抓到的兩件事,而它們都在【接線】那一層**:
 *   MF4:我五格新測試只驗分類器 ⇒ 把 `rpm-import` 那一行改回傳全部 `orphans`,
 *        **兩條刪除路徑會重新打開,而五格仍然全綠**。⇒ 那是現有突變殺不掉的破口。
 *   MF2:hazard 群若有被扣留的孤兒,傳**空清單**給那支原子 RPC 會撞它的斷言
 *        「payload 不是完整商品群(缺 orphan)」(`20260825120000:256-268` 逐字)
 *        ⇒ 🔴 **那不是「不刪」,那是【整群同步 abort】** —— 而我第一版的註解宣稱它是正常不刪。
 *        ⇒ ✅ 正解:**那幾群整個跳過,不要呼叫 RPC。**
 *
 * 📌 **⇒ 「扣留」在兩條路徑上是【兩個不同的動作】**:
 *    一般群 = 不把 sku 放進刪除清單;hazard 群 = **不做這一群**。
 */
/**
 * 「這一輪真的要送去刪除的孤兒」。
 *
 * 🔴 **它【不需要】知道 hazard 群** —— 而那不是巧合,是這兩個決定的順序決定的:
 *    `hazardExternalIds` 是**預檢的產物**,而預檢又要吃「哪些孤兒會被刪」
 *    ⇒ 兩者互為前提。⇒ ✅ **拆成兩支:這一支在預檢【之前】跑,下一支在【之後】。**
 *    ⚠️ 我第一版把它們寫成同一支 ⇒ `hazardExternalIds` 在那個位置**還不存在**(typecheck 紅)
 *    ⇒ 📌 **一個「看起來該放在一起」的計算,被它自己的資料相依性拆開了。**
 */
export function orphansToDeleteFor(input: {
  orphans: VariantOrphan[];
  withheldOrphans: VariantOrphan[];
}): VariantOrphan[] {
  return input.withheldOrphans.length ? [] : input.orphans;
}

/**
 * 「因為扣留而要【整群跳過】原子同步的 hazard 群」。
 *
 * 🔴 為什麼是「跳過整群」而不是「傳空 orphan 清單」:那支 RPC 有一道斷言
 * 「任何非 desired 現存列都必須明列 orphan」(`20260825120000:256-268` 逐字)
 * ⇒ 傳空 ⇒ `RAISE EXCEPTION 'payload 不是完整商品群(缺 orphan)'`
 * ⇒ 📌 **那不是「不刪」,那是【整群同步 abort】** —— 而我第一版的註解宣稱它是正常不刪(codex R1 MF2)。
 */
export function hazardGroupsToSkip(input: {
  withheldOrphans: VariantOrphan[];
  hazardExternalIds: ReadonlySet<string>;
}): string[] {
  return [
    ...new Set(
      input.withheldOrphans
        .filter((o) => input.hazardExternalIds.has(o.externalId))
        .map((o) => o.externalId),
    ),
  ].sort();
}

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
  /**
   * ⛔ ~~`emptiedExternalIds`:刪完之後 in-scope 變體剩零個的那些商品~~
   * 🔴🔴 **2026-08-31 整個判準被推翻,而不是調整** —— 那個情境**在程式裡生不出來**
   * (`liveVariantsOf` 保證每個群至少帶一列 ⇒ 「群在 source 而 source 零變體」不存在),
   * 而它會對**純改名**誤報(舊 SKU 全變孤兒 + 新 SKU 寫進來,在那個判準底下與「被清空」一樣)。
   *
   * ✅ **真正的判準是這一個**:**這一次的 source 是不是完整的?**
   * 因為「source 沒有這一列」與「我這次沒抓到這一列」**在 target 這一側是同一個觀察** ——
   * 📌 **那道閘在【它自己會遇到的那種故障】面前是盲的:同步壞掉的那一次,
   * 正是它最可能刪錯東西的那一次。**
   *
   * ⚠️ **而那個資訊今天【不存在】**(報價單那一側沒有 sync_log)⇒ 恆為 `'unknown'`
   * ⇒ 🔴 **所以「拿不到」是主要路徑,不是 fallback。**
   */
  sourceCompleteness: SourceCompleteness;
  /**
   * 「本來會被刪、而因為拿不到完整性證據所以【沒有刪】」的那些變體。
   *
   * 🛑 **乙不是「什麼都不做」,乙是【把刪除換成一張清單】** ——
   * 而若沒有人看得到這張清單,乙的代價會**安靜地累積**(殘留變體可下單、凍結舊價)。
   * ⇒ 📌 **這個欄位存在的理由就是讓那張清單有一個落點。**
   */
  withheldOrphans: VariantOrphan[];
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
  opts: { allowLargeDelist?: boolean; sourceCompleteness?: SourceCompleteness } = {},
): VariantOrphanReport {
  // 🔴 預設 `'unknown'` —— 而那不是「還沒接上」,是**今天的事實**:
  //    沒有任何一側說得出「這一批 source 是完整的」。呼叫端不傳 = 誠實地說不知道。
  const sourceCompleteness: SourceCompleteness = opts.sourceCompleteness ?? 'unknown';
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
  // 🔴🔴 **乙:拿不到「source 是完整的」這個證據時,【不刪】。**
  //    (Sean 2026-08-31「乙 = 寧可少刪 —— 不確定就不下架」,最後一則「確定乙」)
  //
  //    為什麼判準是這個而不是「刪完剩幾個」:
  //    **「source 沒有這一列」與「我這次沒抓到這一列」在 target 這一側是【同一個觀察】** ——
  //    📌 **那道閘在【它自己會遇到的那種故障】面前是盲的:同步壞掉的那一次,
  //       正是它最可能刪錯東西的那一次。**
  //
  // ⚠️ **而 `aborted` 時不扣留** —— abort 代表這一輪整個不寫,呼叫端會 throw;
  //    在那裡回報「扣留了 N 個」只會製造一個沒有發生過的數字。
  // 🔴 **`incomplete` 與 `unknown` 走同一邊,而【理由不同】——**
  //    `incomplete` = 我們**知道**它不完整 ⇒ **無條件不刪**(那個常數管不到它)
  //    `unknown`    = 我們**不知道** ⇒ 由那個常數決定(現值 `false` = 乙 = 不刪)
  //    ⚠️ codex R1 MF5:我第一版讓那個常數同時管兩者 ⇒ **有一天有人把它翻成 `true`,
  //      連【已經確定不完整】的 source 也會被放行刪除** —— 而那與常數的名字牴觸。
  //    📌 **⇒ 兩個狀態的結論相同,不代表它們該共用一個開關。**
  const withhold =
    !aborted &&
    (sourceCompleteness === 'incomplete' ||
      (sourceCompleteness === 'unknown' && !DELETE_ORPHANS_WHEN_COMPLETENESS_UNKNOWN));
  const withheldOrphans = withhold ? orphans : [];

  return {
    targetInScope: inScope.length,
    sourceSkuCount: sourceSkus.size,
    orphans,
    ratio,
    aborted,
    abortReason,
    largeDeleteBypassed,
    sourceCompleteness,
    withheldOrphans,
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
  // 🔴🔴 **預覽不可以說謊**(codex R1 MF3):這一段原本無條件印「待硬刪 / 寫入模式將刪除」,
  //    而扣留之後**一個都不會刪**。
  //    📌 **⇒ 一個說謊的 dry-run,比沒有 dry-run 糟 —— 它會讓人放心地按下去。**
  // 🔴 **codex R1 MF2**:只看 `withheldOrphans` 會漏掉 abort 那一路 ——
  //    `withhold = !aborted && …` ⇒ **abort 時 `withheldOrphans` 是空的** ⇒ 這一段會印
  //    「待硬刪 / 寫入模式將刪除」, 而那一輪【一個都不會刪】。
  //    📌 **⇒ 判準要問【這一輪會不會刪】, 不是【是不是因為扣留而不刪】** —— 兩個原因, 同一個後果,
  //       而預覽只需要答後果。(abort 的理由仍由本函式最後那行 ALERT 印出來。)
  const nothingWillBeDeleted = r.withheldOrphans.length > 0 || r.aborted;
  const withheld = nothingWillBeDeleted;
  console.log(
    `target 變體(本次群範圍): ${r.targetInScope} / source 變體 sku: ${r.sourceSkuCount} / ` +
      `孤兒(${withheld ? '🔴 【這一輪不刪】' : '待硬刪'}): ${r.orphans.length}(${(r.ratio * 100).toFixed(1)}%)` +
      ` / source 完整性: ${r.sourceCompleteness}`,
  );
  if (r.orphans.length) {
    console.log(
      withheld
        ? `孤兒變體清單(${opts.full ? '全量' : '前 50'};🔴 **這一輪【不會刪】** —— ` +
            `${r.aborted ? 'abort(理由見下方 ALERT)' : `拿不到「source 是完整的」證據(現值 ${r.sourceCompleteness})`}` +
            `;它們會留在庫裡):`
        : `孤兒變體清單(${opts.full ? '全量' : '前 50'};寫入模式將刪除、dry-run 僅列):`,
    );
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
