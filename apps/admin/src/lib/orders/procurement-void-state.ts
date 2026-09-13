// procurement-void-state.ts — 作廢採購那顆鈕的 action state(client 可 import:零 server-only)。
// 2026-09-14,稿 v22 彈窗 7 摺疊「已下的採購(作廢在這裡)」。形狀抄 `receipt-action-state.ts` 的 `ReceiptUndoState`。

export const PVOID_ORDER_ID_FIELD = 'order_id';
export const PVOID_PROCUREMENT_ID_FIELD = 'procurement_id';
export const PVOID_REASON_FIELD = 'void_reason';
/** 冪等鍵:掛載時 client 鑄一次(同到貨表單的做法)⇒ 同一次確認重送不會作廢兩次。 */
export const PVOID_REQUEST_ID_FIELD = 'request_id';
export const PVOID_REASON_MAX = 500;

export type ProcurementVoidState =
  | { status: 'idle' }
  | { status: 'voided' }
  /** `ALREADY_VOIDED` / `PROCUREMENT_NOT_FOUND` / 列不在:對員工是同一件事 —— 這筆已經不是生效的採購了。 */
  | { status: 'already_gone' }
  /** `HAS_RECEIPTS_UNDO_FIRST`:RPC 一個字沒動,叫他先去撤到貨。 */
  | { status: 'has_receipts' }
  | { status: 'failed'; code: ProcurementVoidFailureCode; message: string };

export type ProcurementVoidFailureCode = 'denied' | 'reason_required' | 'bug' | 'error';

const FAILURE_MESSAGES: Record<ProcurementVoidFailureCode, string> = {
  denied: '你目前沒有權限作廢採購。請重新登入後再試。',
  reason_required: '作廢理由要寫,這一句會寫進稽核。',
  bug: '這次作廢被系統擋下(送出的資料不符合規則)。請重新整理這一頁再確認一次,不要重複按。',
  // 同一把冪等鍵重送同 payload 會回 DUPLICATE_REQUEST(不會作廢第二次)⇒ 這裡可以叫他確認後再按。
  error: '作廢沒有完成(系統忙線或連線中斷)。請重新整理這一頁,確認這筆採購還在不在,再決定要不要重按。',
};

export function procurementVoidFailure(code: ProcurementVoidFailureCode): ProcurementVoidState {
  return { status: 'failed', code, message: FAILURE_MESSAGES[code] };
}
