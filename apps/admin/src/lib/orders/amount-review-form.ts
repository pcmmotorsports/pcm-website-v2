// amount-review-form.ts — M-4b-03 C 片:核 / 退表單欄位名(純常數;`'use server'` 檔只能 export async function, 所以住這裡)。
export const AMOUNT_REVIEW_ROW_FIELD = 'amount_request_row_id';
export const AMOUNT_REVIEW_DECISION_FIELD = 'decision';
export const AMOUNT_REVIEW_NOTE_FIELD = 'review_note';
export const AMOUNT_REVIEW_NOTE_MAX = 500;

export type AmountReviewResultCode =
  | 'amount_review_approved'
  | 'amount_review_rejected'
  | 'amount_review_superseded'
  | 'amount_review_denied'
  | 'amount_review_invalid'
  | 'amount_review_refused'
  | 'amount_review_error';
