import type { ProcurementFailureCode } from './procurement-action-state';
import type { ProcurementResultCode } from './procurement-repository';
// 🔴 **直接 import,不走注入**(R1 nit10)。第一版把 `classifyResult` 當參數收,理由是
//    「免得寫第二份分類邏輯」—— 但**直接 import 一樣達成那件事**,注入沒換到任何好處,
//    反而開了一條「注錯分類器 ⇒ 靜默算錯」的路,而本檔的存在理由正是消滅靜默算錯。
//    ⚠️ 這一支本身零 runtime import、純函式 ⇒ **直接 import 不影響本檔的純度判準**。
import { classifyResult } from './procurement-result';

// procurement-batch-policy.ts — A9h-2 的**純決策層**(`#4` 批次標商品進度)。
//
// 🔴 **為什麼獨立成一片**:A9h-2 整片命中鐵則 12③(一次寫 N 列)⇒ 要 codex 關卡2,
//    而那道關卡 2026-08-15 卡住。但**「算錯了不會炸、只會給錯數字」的那半根本不需要 DB**
//    ⇒ 先把最容易靜默出錯的東西釘死,寫入的 coordinator 另成一片。
//    **這個順序就算關卡明天通了也仍然是對的** —— 不是為了繞開卡關才這樣拆。
//
// 🔴 **本檔零 runtime import**(兩個都是 `import type`,編譯期抹除)——
//    與 `procurement-result.ts:18-19` 同一條紀律:不把 server-only 拖進任何 bundle。
//    這也是「切得出來」的機械判準:**import 清單零 supabase / adapter / server-only / RPC**。
//
// 🔴 **本檔刻意不含任何「批次上限」的常數** —— 見 `maxRowsForBudget` 的說明。

/**
 * 一列跑完之後的結局 —— **四種寫入狀態,不是兩種也不是三種**(R3 前自審重做)。
 *
 * 🔴🔴 **`'bug'` 刻意**不是**合法的 outcome。** 理由是本片最重要的一個發現:
 *    `ProcurementCallerBugError` **一個型別橫跨兩種相反的寫入狀態**
 *    (`procurement-repository.ts` 兩個擲點):
 *
 *    | 擲點 | 條件 | 寫進去了嗎 |
 *    |---|---|---|
 *    | `:167` | `error` 有值且 `isRpcRaise(error)` ⇒ **RPC RAISE 了** | **確定沒寫**(見下方 ⚠️) |
 *    | `:181` | `error` 是 null(**RPC 正常回來了**)、`data` 是未知碼或 null | **可能已經寫進去** |
 *
 *    ⇒ 上一版讓 `recordsAsUnknown('bug') = true`(一律未知)**過寬** ——
 *      `:167` 那條**確定沒寫**卻被畫成「狀態未知,請重新整理確認」
 *      ⇒ 員工看到「不確定」而其實是明確失敗 = **反方向的傷害**。
 *    ⇒ 而 `procurement-actions.ts:233-234` 那句「`bug`/`error` **兩支都**可能已經寫進去了」
 *      **也不精確**(它把 `:167` 併進去了)。**那句是 `2cdb6c6b` 建檔時寫的,commit body 42 行對它零說明**
 *      ⇒ 它是推論,不是驗證過的觀察。
 *
 * 🔴 **所以型別在這裡強迫呼叫端把話講清楚**:`'bug'` 不是合法 outcome,
 *    呼叫端必須說出**是哪一種**,不能丟一個含糊的碼過來讓這層猜。
 *
 * 🔴🔴 **但這是一個【目前還滿足不了】的契約 —— 前置條件寫在這裡,不要當成已成立。**
 *    我原本在這裡寫「coordinator 手上有 error 物件、**分得出**是哪個擲點」——**那句是假的**,
 *    我後來開檔驗了:`procurement-repository.ts:43-48` 的 `ProcurementCallerBugError`
 *    **只有 `constructor(message)` 與 `this.name`,零判別欄位**;兩個擲點擲的是**同一個類別**
 *    ⇒ 呼叫端 `instanceof` 對兩者都為真,**唯一分法是去 parse 訊息文字**(脆弱、且壞掉時不會紅)。
 *
 *    ⇒ **具名前置條件**:**A9h-2c 開工前,`procurement-repository.ts` 必須先讓兩個擲點可分辨**
 *      (加判別欄位,或拆成兩個 error 類別)。
 *      ⚠️ 那是**動已上線的單列採購路徑** ⇒ **不在本片範圍,也不在主視窗自批範圍**,已交主視窗當決策題。
 *
 *    🔴🔴 **這條缺口的出口只蓋到一半 —— 兩條滿足路裡只有一條有守門(R5 MF 更正)**:
 *      | 滿足路 | 有沒有守門 |
 *      |---|---|
 *      | **拆成兩個 error 類別** | ✅ **有** —— `procurement-batch-policy.test.ts` 那格會紅 |
 *      | **加判別欄位** | 🔴 **沒有** —— 見下 |
 *      **為什麼「加判別欄位」守不住**:R5 實測,在**擲點**對 instance 掛欄位
 *      (`const bug = new …(); (bug as unknown as {written:boolean}).written = false; throw bug;`)
 *      ⇒ 類別宣告沒動、擲出面沒變 ⇒ **那格全綠,而呼叫端真的分得出來了。**
 *      要擋它得比對**任意屬性賦值**=**無界**,而會誤報的守門最後一定被人放寬或刪掉
 *      ⇒ **主視窗裁「縮宣稱、不加第五層」。**
 *      ⚠️ **所以這裡不能再寫「這條缺口有出口」** —— 正確說法是
 *      **「拆類別那條有出口;加欄位那條沒有,它被滿足時不會有任何東西紅」**。
 *      **那格釘住的四項**(shape / 擲出面集合 / `extends` / 同前綴數)寫在該測試檔的誠實界,
 *      **含它守不住的兩條逐字列表**。**任一被打破的那天,那格會紅**,
 *      🔴 **R4 MF1 更正**:上一版這裡寫的是「釘住那個類別現在還沒有判別欄位」——
 *      **那只釘到「原地加欄位」一種**,而 R4 實測 `class ProcurementRpcRaiseError extends
 *      ProcurementCallerBugError {}`(**最自然的命名**)⇒ **34 格全綠**。
 *      **那是 R3 F4 同一個病的第二次:折了被指名的三種寫法,沒折那件事。**
 *      紅了就會有人回到這裡把這段前置條件改掉。
 *      (判準:**如果永遠沒人回來看這段,會有東西紅嗎?** 會 —— 就是那一格。)
 *
 * ⚠️⚠️ **「`:167` RAISE ⇒ 確定沒寫」的證據狀態(R3 F3 改寫;原本只寫「這是推的」而沒有出口)**:
 *    - **機制已實測**:house 有 **10 支** migration 把「末端 RAISE 強制 rollback」當交易模擬標準手法,
 *      並在跑後驗過 `catalog residue=0`(`20260624120003:34`、`120004:35`、`120006:31` …)。
 *    - **實例的源碼面已排除兩條逃逸路徑**(R3 查證):A5a 全檔**零 dblink、零自治交易**
 *      ⇒ 沒有「在外層交易之外另開一個交易寫進去」的可能;三個 EXCEPTION handler **只做翻譯**、不吞。
 *    - **A5a 內 14 個 RAISE 擲點的分佈**(我數的,附分母):10 個在驗證期(全早於第一個寫入 `:354`)、
 *      3 個是 handler 內 re-raise(區塊 savepoint 已回滾)、1 個是防衛枝 `:420`(自標理論不可達)。
 *      🔴 **我這份 census 漏了一類,R3 補上**:`:425` 稽核 INSERT 在採購寫入之後、**無 handler**
 *      ⇒「交易回滾只剩 `:420`」**不成立**;但那反而更穩 —— **整筆回滾正是上面 residue=0 實測過的機制**。
 *    - 🔴 **仍未做的那一件**:**沒有人對正式庫實際觸發一次 A5a 的 RAISE、確認該列不存在。**
 *      施工端無 DB 連線 ⇒ 現在做不到。
 *    ⇒ **出口**:這條落在 `#507` 條目的驗證清單裡(A9h-2c 上線前必跑),**不是只寫在這裡**。
 *      判準:「如果永遠沒人回來看這段,會有東西紅嗎?」——**這一條的答案仍是『不會』**,
 *      所以它的出口不是測試,是 **`#507` 的必做項**。**寫在這裡是為了讓改這個型別的人看到,不是處置。**
 *
 * ⚠️ **本層閘四碼(`denied`/`invalid`/`stale`/`not_hydrated`)也不是合法 outcome。**
 *    它們是**整批層級**的閘(權限、表單狀態)—— 擋的是「這次送出」,不是「某一列」
 *    ⇒ 屬 `checkBatchInput` / coordinator 的入口判斷,不該出現在逐列結果裡。
 *    🔴 **這一條同樣是【推的】**(我讀的是它們在單列 action 的用法,**沒有** coordinator 可讀)——
 *    上一版我把它當事實寫進註解(自標 §7-2),這次標明。
 * `NOT_ATTEMPTED` = 批次中止後沒跑到的列(母 plan §4.4)。
 * `RESULT_UNKNOWN` = 母 plan `:145-147` 的第三態(`ok: 'unknown'`)——
 *    **是第三種 `ok` 值(`ok: 'unknown'`),不是第 21 個失敗碼**;母 plan `:145-146` 逐字
 *    「A12b 必須畫成『狀態未知,請重新整理確認』而**不是**失敗 —— **畫成失敗會誘發重送**」。
 *    ⚠️ **本檔第一版漏了它**,而那正是關卡1 R1 must-fix #3(母 plan `:231`)**復發**;
 *    契約漏一個態不是「少一個列舉值」,是**把一條會造成重複寫入的路徑寫進了契約**。
 *
 * ⚠️ **R3 F2 更正**:上面這段原本是**另一塊獨立 JSDoc**,寫著「三態,不是兩態」,
 *    而它**沒被刪就接上了**現在這塊(「四種…」)⇒ **同一個 export 上疊了兩份互相矛盾的說明**。
 *    🔴 定性照 E:那是「index 切片**靜默吞內容**」的**鏡像 —— 這次是靜默『留』**。
 *    ⇒ 修法:舊塊獨有的句子併進來(就是上面那四行),整塊刪。
 */
export type BatchRowOutcome =
  | ProcurementResultCode
  /** 一般 DB/網路例外(`procurement-repository.ts:172` 的裸 throw)⇒ **可能已寫**。 */
  | 'error'
  /** 🔴 RPC **RAISE 了**(`:167`)⇒ 交易中止 ⇒ **確定沒寫**(⚠️ 推的,見檔頭)。 */
  | 'CALLER_BUG_NOT_WRITTEN'
  /** 🔴 RPC **正常回來但回了未知碼**(`:181`)⇒ 它跑過了 ⇒ **可能已寫**。 */
  | 'CALLER_BUG_WRITE_UNKNOWN'
  | 'NOT_ATTEMPTED'
  | 'RESULT_UNKNOWN';

export type BatchRow = {
  orderItemId: string;
  outcome: BatchRowOutcome;
};

/**
 * 這個失敗碼**能不能繼續跑下一列**?
 *
 * 🔴🔴 **列舉的是「可以繼續」那一側,default 一律中止 —— 這個方向是刻意的(fail-closed)。**
 *    第一版反過來寫(列舉中止、default 繼續),於是 `'error'` 這種**「可能已經寫進去了」**的碼
 *    掉進 default ⇒ 答案是「繼續」,**與母 plan `:172` 逐字相反**
 *    (「一般 DB/網路例外 ⇒ 記 `RESULT_UNKNOWN`、**中止整批**」)。
 *    ⇒ 換成這個方向之後,**日後新增任何一個碼,預設行為是「停下來」**,
 *      而不是「拿一個沒人分類過的碼繼續寫下去」。
 *
 * **可以繼續的只有「員工自己改得掉的業務失敗」** —— 這一列不行,但別列可能完全沒問題。
 * ⚠️ `EXPECTED_ARRIVAL_OUT_OF_RANGE` **在可繼續側**:它在 `procurement-action-state.ts:96`
 *    那條「呼叫端 bug 型」分隔註解的**上方**,`procurement-result.ts:34` 特地警告過別收進去。
 *
 * ⚠️ 本函式**只回答「能不能繼續」**;不回答「算不算失敗」(那是 `classifyResult`)、
 *    也不回答「該記成什麼結局」(那是 `recordsAsUnknown`)。三份判斷分開,免得加碼時三處各漂移。
 */
export function shouldAbortBatch(code: ProcurementFailureCode): boolean {
  switch (code) {
    // ── 可改輸入型:員工改一下就過得去 ⇒ 記這一列、繼續下一列
    case 'SUPPLIER_INACTIVE':
    case 'OVER_ALLOCATION':
    case 'ALLOCATED_BELOW_RECEIVED':
    case 'INVALID_ALLOCATED':
    case 'INVALID_REPLY_STATUS':
    case 'INVALID_CONTACT_CHANNEL':
    case 'INVALID_SUPPLIER_ORDER_NO':
    case 'INVALID_EXCEPTION_REASON':
    case 'SUBMITTED_AT_OUT_OF_RANGE':
    case 'SUBMITTED_AT_IN_FUTURE':
    case 'EXPECTED_ARRIVAL_OUT_OF_RANGE':
      return false;
    default:
      // 🔴 **其餘一律中止**,涵蓋三類:
      //   ① 呼叫端 bug 型(`INVALID_INPUT` / `ORDER_ITEM_NOT_FOUND` / `SUPPLIER_NOT_FOUND`)——
      //      送上來的東西本身壞掉了,繼續只會拿同一份壞契約再寫 N 次。
      //   ② `'error'` —— 寫入結果未知,見 `recordsAsUnknown`。
      //   ③ 本層閘(`denied` / `invalid` / `stale` / `not_hydrated` / `bug`)——
      //      🔴 這五個是**表單 action 層**的閘,批次路徑直接呼叫 repository、**產不出它們**。
      //      落在這裡是型別窮盡的結果、不是預期路徑 ⇒ **真的出現就是有事,停下來才對**。
      //      (`bug` 的員工訊息逐字就是「不要重複按送出」,`procurement-action-state.ts:145`。)
      return true;
  }
}

/**
 * 這個結局代表**「寫入結果未知」**嗎?(⇒ 記 `unknown`,**不是** `failed`)
 *
 * 🔴 **它吃的是 `BatchRowOutcome`(結局),不是 `ProcurementFailureCode`(失敗碼)** ——
 *    上一版吃失敗碼,而失敗碼 `'bug'` **分不出兩種相反的寫入狀態**(見 `BatchRowOutcome` 檔頭)。
 *    **換型別本身就是修法的一部分**:呼叫端被迫在它分得出來的地方就把話講清楚。
 *
 * **為真的三個**,共同點是「**RPC 可能已經跑完並 commit,而我們沒收到答案**」:
 * - `'error'` —— 一般 DB/網路例外(回應斷在路上)
 * - `'CALLER_BUG_WRITE_UNKNOWN'` —— RPC 正常回來但回了未知碼 ⇒ **它跑過了**
 * - `'RESULT_UNKNOWN'` —— coordinator 自己判定的第三態(母 plan `:145-147`)
 *
 * 🔴🔴 **回傳型別必須是 type predicate,不能是 `boolean`**(R3 F1,**commit blocker**):
 *    `summarizeBatch` 靠這支把三個非 A5a 碼**收窄掉**,再把剩下的餵給 `classifyResult`
 *    (它只吃 A5a 的 17 碼)。回 `boolean` ⇒ **TS 不做 narrowing** ⇒ `classifyResult` 收到含
 *    `'error'` / `'CALLER_BUG_*'` 的聯集 ⇒ **TS2345,build 閘紅**。
 *    ⚠️ 而 **runtime 是對的** —— 這正是它躲過我驗收的原因:
 *    vitest 走 esbuild **去型別**、eslint 也看不到型別錯 ⇒ **三綠的第三綠沒被量到。**
 *
 * **為假的那個容易被誤收**:`'CALLER_BUG_NOT_WRITTEN'`(RPC RAISE)⇒ **確定沒寫** ⇒ 記 `failed`。
 * 🔴 把它收進「未知」= 員工看到「請重新整理確認」而其實是**明確失敗** —— 那是反方向的傷害。
 */
export function recordsAsUnknown(
  outcome: BatchRowOutcome,
): outcome is 'error' | 'CALLER_BUG_WRITE_UNKNOWN' | 'RESULT_UNKNOWN' {
  return (
    outcome === 'error' ||
    outcome === 'CALLER_BUG_WRITE_UNKNOWN' ||
    outcome === 'RESULT_UNKNOWN'
  );
}

/**
 * 批次上限 = 由逾時預算反推,**不是拍腦袋的常數**(母 plan §4.3 + §10 假設 A2)。
 *
 * 🔴🔴 **本函式刻意要求呼叫端傳入 `p95MsPerRow`,而且沒有預設值。**
 *    理由:那個數字**到今天為止沒有任何人量過**
 *    (`#4` 狀態更正檔 `:36` §2 表逐字「那個 P95 **沒有人量過**」+ `:127` §5 第 11 條;
 *     🔴 R1 #8 更正:原引「§4-1」不存在 —— 該檔 §4 是「檔數與鐵則判定」、無 P95)。
 *    給一個預設值 = 把一個沒量過的數字偷渡成規格,而它算錯的症狀是
 *    **批次跑到一半逾時、前面的列已經寫進去了** —— 不會有測試紅給你看。
 *    ⇒ 量到之前,型別系統會逼呼叫端自己面對這件事。
 *
 * `safetyFactor` 是**留給啟動、序列化、回程的餘裕**,不是保守心理 ——
 * 逾時預算全部吃滿的話,最後一列必然壓線。
 *
 * @throws 任一輸入不是正數 ⇒ 直接擲。**寧可炸,不要算出一個看起來合理的上限。**
 */
export function maxRowsForBudget(input: {
  /** 該路由的 `export const maxDuration`(秒)。 */
  maxDurationSec: number;
  /** 單列 RPC 往返的實測 P95(毫秒)。**必填,沒有預設值。** */
  p95MsPerRow: number;
  /** 0 < f ≤ 1;預算的可用比例。 */
  safetyFactor: number;
}): number {
  const { maxDurationSec, p95MsPerRow, safetyFactor } = input;
  if (!(maxDurationSec > 0) || !(p95MsPerRow > 0)) {
    throw new Error(
      `批次上限算不出來:maxDurationSec=${maxDurationSec}、p95MsPerRow=${p95MsPerRow}(兩者都必須是正數)`,
    );
  }
  if (!(safetyFactor > 0) || safetyFactor > 1) {
    throw new Error(`safetyFactor 必須落在 (0, 1],收到 ${safetyFactor}`);
  }
  const rows = Math.floor((maxDurationSec * 1000 * safetyFactor) / p95MsPerRow);
  // 預算連一列都跑不完時回 1,而不是 0 ——「上限 0」會讓批次變成永遠什麼都不做,
  // 而那是一個**看起來很安靜的壞法**。跑一列然後逾時至少會留下訊號。
  return Math.max(1, rows);
}

export type BatchSummary = {
  /** 真的寫進去的列數(`CREATED` + `UPDATED`)。 */
  written: number;
  /** 🔴 **新建**的列 —— 與「更新」分開,理由見下。 */
  created: string[];
  updated: number;
  /** 送上去但內容與現況相同、零寫入(A5a `NO_CHANGE`)。 */
  unchanged: number;
  /** 跑了、**確定沒寫進去**的列。 */
  failed: { orderItemId: string; code: ProcurementFailureCode }[];
  /**
   * 🔴🔴 **寫入結果未知**的列(母 plan `:145-147` 的第三態)。
   *
   * **絕不可以併進 `failed`** —— 母 plan 逐字:「必須畫成『狀態未知,請重新整理確認』
   * 而**不是**失敗 —— **畫成失敗會誘發重送**」,而那一列可能已經寫進去了。
   * ⇒ 畫面對這一桶的義務是「請重新整理確認」,**不是**「重送」。
   */
  unknown: string[];
  /** 批次中止後沒跑到的列。 */
  notAttempted: string[];
};

/**
 * N 列結果 → 一份給畫面用的彙總。
 *
 * 🔴🔴 **`created` 回的是 id 清單、不是數字**,而 `updated` 只回數字 —— 這個不對稱是刻意的:
 *    A5a 在 `20260814100000:29-33` 把**已作廢的採購列視同不存在、走新建路徑**
 *    (🔴 R1 #7 更正:原引 `:32-36`,其中 `:34-36` 是**另一支函式**`admin_record_item_receipt`)
 *    ⇒ 員工一次勾 N 列、其中有已作廢的採購時,結果是「**悄悄新建**」而不是「更新」。
 *    單列 UI 下這是 Sean 拍板的語意(`Q-S1=A`),但**一次 N 筆時員工看不出差別**。
 *    ⇒ 畫面必須講得出「**這幾列是新建、不是更新**」,所以這裡要留 id。
 *    (`#4` 狀態更正檔 §3-1 記的那個漂移,就是這條。)
 *
 * ⚠️ 本函式**不判斷成功失敗**,它信 `classifyResult`;也**不決定中止**,那是 `shouldAbortBatch`。
 *    它只做加總 —— 三份職責分開,免得加碼時三處各漂移一點。
 */
export function summarizeBatch(rows: readonly BatchRow[]): BatchSummary {
  const summary: BatchSummary = {
    written: 0,
    created: [],
    updated: 0,
    unchanged: 0,
    failed: [],
    unknown: [],
    notAttempted: [],
  };
  for (const row of rows) {
    if (row.outcome === 'NOT_ATTEMPTED') {
      summary.notAttempted.push(row.orderItemId);
      continue;
    }
    // 🔴 **先用 `recordsAsUnknown` 分流**(單一判準,不在這裡再寫一份清單)——
    //    上一版在這裡手列 `error`/`bug`,於是判準有兩份、會漂移。
    if (recordsAsUnknown(row.outcome)) {
      summary.unknown.push(row.orderItemId);
      continue;
    }
    // 🔴 RPC RAISE ⇒ **確定沒寫** ⇒ failed,而且**必須與上面那條分開**(這正是本輪的修法)。
    if (row.outcome === 'CALLER_BUG_NOT_WRITTEN') {
      summary.failed.push({ orderItemId: row.orderItemId, code: 'bug' });
      continue;
    }
    if (row.outcome === 'CREATED') {
      summary.created.push(row.orderItemId);
      summary.written += 1;
      continue;
    }
    if (row.outcome === 'UPDATED') {
      summary.updated += 1;
      summary.written += 1;
      continue;
    }
    const failure = classifyResult(row.outcome);
    if (failure === null) {
      // 走到這裡只剩 `NO_CHANGE`(成功型但零寫入)。
      summary.unchanged += 1;
      continue;
    }
    summary.failed.push({ orderItemId: row.orderItemId, code: failure });
  }
  return summary;
}

/**
 * 送出之前的**輸入檢查**(母 plan §11 條件 8 的純判定半)。
 *
 * 🔴🔴 **重複 `orderItemId` 為什麼要「整批拒收」而不是「跳過重複的那列」**:
 *    同一個品項出現兩次 ⇒ 第二次會**覆蓋**第一次的分配數量(A5a 是 upsert),
 *    而**兩次都回 `UPDATED`** ⇒ 彙總顯示「2 列成功」。
 *    ⇒ 員工看到的是**兩列都成功**,實際上只有最後一列的值留下來
 *    —— **那是會騙人的成功訊息,比失敗嚴重**(失敗至少他知道要重看)。
 *    跳過重複列一樣不行:那等於**替員工決定哪一列才算數**,而他根本不知道自己送重了。
 *
 * 🔴 **為什麼放在純判定層,不放在 coordinator 的寫入迴圈**:
 *    放進迴圈就是「一個 if」,而那是**最容易在日後改動中被繞過的位置**
 *    (加一條 early-continue、換一個迭代方式,它就不見了,而且沒有測試會紅)。
 *    這裡它是一個**有名字、有守門、零 IO** 的判定。
 *
 * ⚠️ **本函式只回答「這批能不能送」**,不執行拒收 —— 拒收動作在 coordinator。
 *    它也**不檢查批次上限**(那要 `maxRowsForBudget`,而那個 P95 還沒人量過)。
 */
export type BatchInputVerdict =
  | { ok: true; rowCount: number }
  /** 空批次:**不是錯誤**,是「沒有東西要送」⇒ 呼叫端直接返回,不進寫入迴圈。 */
  | { ok: false; reason: 'empty' }
  /** 🔴 同一個 `orderItemId` 出現多次 ⇒ **整批拒收**,`duplicates` 給畫面點名。 */
  | { ok: false; reason: 'duplicate_order_item'; duplicates: string[] };

export function checkBatchInput(
  rows: readonly { orderItemId: string }[],
): BatchInputVerdict {
  if (rows.length === 0) return { ok: false, reason: 'empty' };

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.orderItemId)) dupes.add(row.orderItemId);
    seen.add(row.orderItemId);
  }
  if (dupes.size > 0) {
    // 排序:同一批輸入**每次都要得到同一個清單**,否則畫面上的順序會在重整之間跳動。
    return { ok: false, reason: 'duplicate_order_item', duplicates: [...dupes].sort() };
  }
  return { ok: true, rowCount: rows.length };
}
