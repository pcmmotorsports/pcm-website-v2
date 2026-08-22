// manual-refund-void-action-state.ts — M-4b E10 片 D3-c:非卡退款「作廢」的 action state + 表單常數。
//
// 🔴 **作廢不是「又退了一筆負的錢」,是「這筆登記本身記錯了」**(D3-b 的 COMMENT ON FUNCTION 原話)。
//    ⇒ 它不動錢。錢有沒有真的交回客人,看 actor 與稽核。
//
// 🔴 與登記那半(`manual-refund-action-state.ts`)刻意分檔、**而且刻意沒有 requestToken**:
//    `admin_void_manual_refund` 沒有 `p_request_id`,那是 D3-b 明寫的設計 ——
//    「沖銷是對一列特定的列做狀態轉移,而『它作廢了沒』那一列自己就答得出來」,
//    冪等由 `(voided_at, void_reason, voided_by)` 三欄承擔。
//    ⇒ 把登記那半的 token 機制照抄過來,會是搬一個這支 RPC 沒有的概念。
//
// 🔴🔴 本檔會被 client 元件 import ⇒ **不得引入 `server-only` 或任何 server 專用模組**
//    (同 `manual-refund-action-state.ts` 檔頭紀律)。

export const MANUAL_REFUND_VOIDED_RESULT_CODE = 'manual_refund_voided';

export const MANUAL_REFUND_VOID_ID_FIELD = 'refund_id';
export const MANUAL_REFUND_VOID_REASON_FIELD = 'void_reason';
/** 🔴 只給「重新驗證哪張訂單頁 / 回哪裡」用,**不進 RPC**(見 actions 檔內註解)。 */
export const MANUAL_REFUND_VOID_ORDER_ID_FIELD = 'order_id';

/** 作廢理由上限。與登記那半的 reason 同值(200),兩邊都寫進同一張表的 text 欄。 */
export const MANUAL_REFUND_VOID_REASON_MAX = 200;

/**
 * 失敗原因碼。**分類依 SQLSTATE、不逐句解析 RPC 訊息**(同登記那半)——
 * D3-b 的業務 RAISE 全部走預設 `P0001`(該檔一個 `USING ERRCODE` 都沒有)。
 *
 * 🔴 `rejected` 例外地把 RPC 的 message 原樣顯示給員工,理由逐字同登記那半:
 *    D3-b 每一句 RAISE 本身就是寫給員工看的(例:「這筆退款已於 X 由『Y』以理由『Z』作廢」),
 *    罐頭化只會把 RPC 作者已經寫好的具體指引換成一句更含糊的話。
 *
 * 🔴 `conflict` 是本檔比登記那半多出來的一格,而它**不是我加的、是 RPC 自己宣告的**:
 *    D3-b 的 COMMENT 逐字寫「併發下呼叫端會拿到兩種不同的東西……REPEATABLE READ ⇒ 拿到
 *    `could not serialize access due to concurrent update`,冪等分支走不到 ⇒ 顯示面要吃得下兩種」。
 *    ⚠️ Supabase 預設是 READ COMMITTED ⇒ **這一格在今天的正式庫大概不會出現**。
 *       留著是因為「它出現時該說什麼」已經被 RPC 作者寫下來了,而漏掉它會落成一句無意義的 `bug`。
 */
export type ManualRefundVoidFailureCode =
  | 'denied'
  | 'invalid'
  | 'rejected'
  | 'conflict'
  | 'bug'
  | 'error';

const FAILURE_MESSAGES: Record<ManualRefundVoidFailureCode, string> = {
  denied: '沒有權限或登入狀態已失效,這筆登記沒有被作廢。',
  invalid: '作廢理由不正確(不能空白,最多 200 字),這筆登記沒有被作廢。',
  // 🔴 只在 repository 沒給到 RPC message 時當備援(理論上不會發生,見呼叫端)。
  rejected: '這次作廢被拒絕,這筆登記沒有被作廢。請重新整理頁面看它現在的狀態。',
  conflict: '有人同時在動這筆登記,這次沒有寫進去。請重新整理頁面看它現在的狀態,不要直接再按一次。',
  bug: '系統呼叫異常,請重新整理頁面確認這筆是否已作廢;不要重複送出,並通知系統維護。',
  error: '作廢沒有完成。請先重新整理頁面看這筆的現況——它可能已經寫進去了,再決定要不要重送。',
};

export type ManualRefundVoidActionState =
  | { status: 'idle' }
  | {
      status: 'failed';
      code: ManualRefundVoidFailureCode;
      message: string;
      /** 失敗時帶回員工打的理由(這一欄是打字成本最高的);denied 為空殼。 */
      reason: string;
      /** 哪一列失敗的——同一張表上有多列,不帶這個的話錯誤訊息會貼錯列。 */
      refundId: string;
    };

/**
 * 這個失敗要不要顯示在【這一列】的表單上。
 *
 * 🔴🔴 **這支函式的存在本身是一個 bug 的修法**(codex R1 must-fix ②,2026-08-22):
 *   第一版寫死 `state.refundId === refundId`,而**授權失敗那一格帶回的 refundId 是空字串**
 *   (授權閘在讀任何欄位之前就 return ⇒ 那時還不知道是哪一列)。
 *   ⇒ Session 過期時:server 正確拒絕、log 也寫了,而**員工畫面一個字都不會出現** ——
 *     他按了、沒反應、而他不知道為什麼。**那是真的會咬到人的,不是理論。**
 *
 * 🔴 為什麼「空字串 ⇒ 顯示」是安全的:`useActionState` 的 state 是**每個元件實例各自一份**,
 *   一顆按鈕拿到的 failed state 只可能是**它自己那一次送出**的結果 ——
 *   不會有別列的錯誤漏過來。ID 比對是額外那一層,不是唯一那一層。
 *
 * ⚠️ 那為什麼還留著 ID 比對:這一列若被 key 重用(換單、重新掛載)而 state 沒跟著重置,
 *   ID 比對會把不屬於這一列的錯誤擋掉。**兩層各擋一種,不是重複。**
 */
export type ManualRefundVoidFailedState = Extract<
  ManualRefundVoidActionState,
  { status: 'failed' }
>;

// 🔴 回傳 type predicate 而不是 boolean:呼叫端要拿 `state.message` 來顯示,
//    回 boolean 的話 TS 收窄不了、呼叫端就得再寫一次 `state.status === 'failed'`
//    —— 那正好又變回「同一件事寫兩份」那個病(本函式就是為了消滅它才存在的)。
export function shouldShowVoidFailure(
  state: ManualRefundVoidActionState,
  refundId: string,
): state is ManualRefundVoidFailedState {
  if (state.status !== 'failed') return false;
  // 空字串 = server 在知道是哪一列之前就失敗了(授權閘)⇒ 一定要顯示。
  return state.refundId === '' || state.refundId === refundId;
}

export function manualRefundVoidFailure(
  code: ManualRefundVoidFailureCode,
  reason: string,
  refundId: string,
  /** 僅 `rejected` 會給值(RPC 的 message);其餘一律用罐頭文案。 */
  rpcMessage?: string,
): ManualRefundVoidActionState {
  return {
    status: 'failed',
    code,
    message: code === 'rejected' && rpcMessage ? rpcMessage : FAILURE_MESSAGES[code],
    reason,
    refundId,
  };
}

/**
 * 表單形狀解析(純形狀;**業務判定的單一真相在 RPC**)。
 *
 * 🔴 blank 判定只用 `.trim() === ''`,**而那已經涵蓋 NBSP 與全形空格**。
 *    ⚠️ **這一段是被突變測試改出來的,原本不是這樣寫的**(2026-08-22,留痕):
 *      第一版另外寫了 `/^[\s\u00A0\u3000]*$/u`,理由寫著「要跟 DB 那道 `pcm_b2_is_blank` 對齊,
 *      它多擋 NBSP 與全形空格」。**那句話對 DB 成立,對 JS 不成立** ——
 *      `String.prototype.trim()` 依規格移除 WhiteSpace + LineTerminator,**U+00A0 與 U+3000 都在裡面**。
 *      ⇒ 那條正規式在 `.trim()` 之後**永遠是死的**,而它的測試**永遠會綠** ——
 *        我把整條正規式突變掉,11 格照樣全過。**它是一段有自信的註解在守一段沒有作用的碼。**
 *      實測(node,2026-08-22):`'　　'.trim()` / `'\u00A0\u00A0'.trim()` 皆 `''`;
 *      對照組 `' 　中　 '.trim()` ⇒ `'中'` ⇒ 尺有判別力。
 *    🔴 **DB 那道仍然必要且沒有被取代** —— 它擋的是**不經過本函式**的呼叫路徑。
 *    ⚠️ **這一格不是防線**(RPC 那道才是),它只是為了給人話。
 */

export type ManualRefundVoidParse =
  | { ok: true; refundId: string; reason: string }
  | { ok: false };

export function parseManualRefundVoidForm(input: {
  refundId: string | null;
  reason: string | null;
}): ManualRefundVoidParse {
  const refundId = input.refundId ?? '';
  const reason = (input.reason ?? '').trim();
  if (refundId === '') return { ok: false };
  if (reason === '') return { ok: false };
  // 🔴 用 [...reason].length 不用 .length:JS 的 .length 數的是 UTF-16 code unit,
  //    emoji 與部分 CJK 擴充字會被算成 2 ⇒ 員工打不滿 200 字就被擋(同 repo 既有慣例)。
  if ([...reason].length > MANUAL_REFUND_VOID_REASON_MAX) return { ok: false };
  return { ok: true, refundId, reason };
}
