'use client';

import { useState } from 'react';
import { reviewOrderItemAmountAction } from '../../lib/orders/amount-review-actions';
import {
  AMOUNT_REVIEW_DECISION_FIELD,
  AMOUNT_REVIEW_NOTE_FIELD,
  AMOUNT_REVIEW_NOTE_MAX,
  AMOUNT_REVIEW_ROW_FIELD,
} from '../../lib/orders/amount-review-form';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';
import { MANUAL_SMALL_BUTTON } from './manual-order-field-classes';

// amount-review-form.tsx — M-4b-03 C 片:pending 那一條右邊的「核准」「退回」(管理者才掛;真的擋在 action L2 + RPC L3)。
// 🔴 兩顆鈕同一張 form、同一支 action, 用 `decision` hidden 分:退回要理由 ⇒ 按「退回」先開出理由格, 再按一次才送。
// 🔴 核准會【真的改價】(RPC 內走既有 admin_update_order_item_amount)⇒ 鈕文寫清楚「核准並改價」, 不寫「同意」。

export function AmountReviewForm({ requestRowId, returnTo, toUnitPrice }: { requestRowId: string; returnTo: string; toUnitPrice: number }) {
  const [rejecting, setRejecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  return (
    <form action={reviewOrderItemAmountAction} onSubmit={() => setSubmitting(true)} className='flex flex-col gap-2' data-testid='amount-review-form'>
      <input type='hidden' name={AMOUNT_REVIEW_ROW_FIELD} value={requestRowId} />
      <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
      {rejecting ? (
        <>
          <input type='hidden' name={AMOUNT_REVIEW_DECISION_FIELD} value='reject' />
          <input
            name={AMOUNT_REVIEW_NOTE_FIELD}
            className={ADMIN_INPUT_CLASS}
            required
            maxLength={AMOUNT_REVIEW_NOTE_MAX}
            placeholder='退回理由(必填, 員工看得到)'
            autoFocus
          />
          <div className='flex gap-2'>
            <button type='submit' disabled={submitting} className={`${MANUAL_SMALL_BUTTON} text-destructive`}>
              {submitting ? '送出中…' : '確定退回'}
            </button>
            <button type='button' className={MANUAL_SMALL_BUTTON} onClick={() => setRejecting(false)}>
              先不退
            </button>
          </div>
        </>
      ) : (
        <>
          <input type='hidden' name={AMOUNT_REVIEW_DECISION_FIELD} value='approve' />
          <div className='flex gap-2'>
            <button type='submit' disabled={submitting} className={MANUAL_SMALL_BUTTON} data-testid='amount-review-approve'>
              {submitting ? '改價中…' : `核准並改價成 ${toUnitPrice.toLocaleString('en-US')}`}
            </button>
            <button type='button' className={`${MANUAL_SMALL_BUTTON} text-destructive`} onClick={() => setRejecting(true)} data-testid='amount-review-reject'>
              退回
            </button>
          </div>
        </>
      )}
    </form>
  );
}
