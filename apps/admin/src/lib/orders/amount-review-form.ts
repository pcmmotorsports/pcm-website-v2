// amount-review-form.ts — M-4b-03 C 片:核 / 退表單欄位名(純常數;`'use server'` 檔只能 export async function, 所以住這裡)。
export const AMOUNT_REVIEW_ROW_FIELD = 'amount_request_row_id';
export const AMOUNT_REVIEW_DECISION_FIELD = 'decision';
export const AMOUNT_REVIEW_NOTE_FIELD = 'review_note';
export const AMOUNT_REVIEW_NOTE_MAX = 500;

export type AmountReviewResultCode =
  | 'amount_review_approved'
  | 'amount_review_rejected'
  | 'amount_review_superseded'
  /** 20260915130000 第 2 代:核准時單子已在提案後被改過 ⇒ 沒改價、系統自動退回(RPC 回 result = stale_rejected)。 */
  | 'amount_review_stale'
  | 'amount_review_denied'
  | 'amount_review_invalid'
  | 'amount_review_refused'
  | 'amount_review_error';

/** `return_to` 裡的 `open=<uuid>` 一律改成 RPC 說的那張單;沒有 open= 就原樣(回列表)。 */
export function bindOpenTo(returnTo: string, orderId: string): string {
  const q = returnTo.indexOf('?');
  if (q < 0) return returnTo;
  const params = new URLSearchParams(returnTo.slice(q + 1));
  if (!params.has('open')) return returnTo;
  params.set('open', orderId);
  return `${returnTo.slice(0, q)}?${params.toString()}`;
}
