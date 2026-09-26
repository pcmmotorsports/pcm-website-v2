// 退貨收回(第 2 片):三個表單共用的欄位名稱、送出編號與結果文字。形狀照 manual-refund-action-state.ts。
//
// 🔴 送出編號(審查 C2):admin_receive_return / admin_void_return 重送同一個 request_id 時不比內容 ⇒
//    編號一律由伺服器在【畫面渲染時】產生(每次載入頁面都是新的一顆), 成功後 redirect ⇒ 頁面重新渲染 ⇒ 下一次送出一定是新編號。
//    送出失敗時沿用同一顆:失敗代表沒有寫入(狀態沒變), 同一顆重送不會被誤認成「已經做過」。
import { isUuid } from './note-action-state';

export const RETURN_REGISTERED_RESULT_CODE = 'return_registered';
export const RETURN_RECEIVED_RESULT_CODE = 'return_received';
export const RETURN_VOIDED_RESULT_CODE = 'return_voided';

export const RETURN_ORDER_ID_FIELD = 'order_id';
export const RETURN_ID_FIELD = 'return_id';
export const RETURN_REQUEST_TOKEN_FIELD = 'request_token';
export const RETURN_REASON_CODE_FIELD = 'reason_code';
export const RETURN_REASON_DETAIL_FIELD = 'reason_detail';
export const RETURN_NOTE_FIELD = 'note';
export const RETURN_TRACKING_FIELD = 'tracking_number';
export const RETURN_VOID_REASON_FIELD = 'void_reason';
/** 每個品項一格:`qty:<order_item_id>`(登記數量 / 實收數量)、`cond:<order_item_id>`(商品狀況)。 */
export const returnQtyField = (orderItemId: string) => `qty:${orderItemId}`;
export const returnConditionField = (orderItemId: string) => `cond:${orderItemId}`;

export function generateReturnRequestToken(): string {
  return crypto.randomUUID();
}
export function isReturnRequestToken(value: string): boolean {
  return isUuid(value);
}

export type ReturnFailureCode = 'denied' | 'invalid' | 'rejected' | 'bug' | 'error';

const FAILURE_MESSAGES: Record<ReturnFailureCode, string> = {
  denied: '目前可能沒有權限或登入已過期，這次沒有送出。請重新登入後再試一次；若仍無法操作，請聯絡管理者。',
  invalid: '表單內容有誤，這次沒有送出。請確認品項數量是整數、必填欄位都已填寫。',
  rejected: '這次操作被拒絕，沒有送出。請重新整理頁面確認退貨紀錄後再試一次。',
  bug: '系統呼叫異常，請重新整理頁面確認這筆退貨紀錄的狀態；不要重複送出，並通知系統管理員。',
  error: '這次操作沒有完成。請重新整理頁面確認退貨紀錄的狀態，再決定要不要重新送出。',
};

export type ReturnActionState =
  | { status: 'idle'; requestToken: string }
  | { status: 'failed'; code: ReturnFailureCode; message: string; requestToken: string };

/** rejected 時顯示資料庫函式自己的那句話(那些句子本來就是寫給員工看的, 例如「超過可退數量(已出貨 2 件…)」)。 */
export function returnFailure(code: ReturnFailureCode, requestToken: string, rpcMessage?: string): ReturnActionState {
  return {
    status: 'failed',
    code,
    message: code === 'rejected' && rpcMessage ? rpcMessage : FAILURE_MESSAGES[code],
    requestToken,
  };
}

// ── 第 3 片:「為這筆退貨登記退款」把建議金額帶進既有退款表單 ─────────────────────
// 用網址參數帶(退貨卡片上的連結 → 同一頁 + #refund), 兩個退款表單掛載時讀一次當初值。
// 🔴 只是預填:員工看得到、改得了;金額上限照舊由退款流程在伺服器端檢查, 這兩個參數不會放寬任何限制。
// 🔴 兩個參數都列進 order-return-to.ts 的 RESULT_ONLY_PARAMS ⇒ 退款送出後轉回的網址不帶它們,
//    成功後表單不會又被填一次(避免員工以為還沒退而重送)。
export const RETURN_REFUND_AMOUNT_PARAM = 'refund_amount';
export const RETURN_REFUND_REASON_PARAM = 'refund_reason';
export const RETURN_REFUND_ANCHOR = 'refund';

export type ReturnRefundPrefill = { amount: string; reason: string };

/** 讀網址上的預填值;格式不對一律當作沒有(不猜、不截斷)。 */
export function readReturnRefundPrefill(params: { get(name: string): string | null } | null): ReturnRefundPrefill | null {
  if (!params) return null;
  const amount = params.get(RETURN_REFUND_AMOUNT_PARAM) ?? '';
  const reason = (params.get(RETURN_REFUND_REASON_PARAM) ?? '').trim();
  if (!/^[1-9][0-9]{0,9}$/.test(amount) || [...reason].length > 200) return null;
  return { amount, reason };
}

/** 退貨卡片上那顆連結的網址:目前頁面(returnTo)+ 預填參數 + #refund(打開退款區塊)。 */
export function returnRefundHref(returnTo: string, amount: number, reason: string): string {
  const at = returnTo.indexOf('?');
  const path = at === -1 ? returnTo : returnTo.slice(0, at);
  const q = new URLSearchParams(at === -1 ? '' : returnTo.slice(at + 1));
  q.delete('r'); // 上一次動作的結果橫幅不要跟著帶過去
  q.set(RETURN_REFUND_AMOUNT_PARAM, String(amount)); // set 而不是 append:網址上原本有舊的預填時直接換掉
  q.set(RETURN_REFUND_REASON_PARAM, reason);
  return `${path}?${q.toString()}#${RETURN_REFUND_ANCHOR}`;
}
