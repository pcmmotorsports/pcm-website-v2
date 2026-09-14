'use client';

import { useState } from 'react';
import { requestOrderItemAmountAction } from '../../lib/orders/amount-request-actions';
import {
  AMOUNT_ORDER_ID_FIELD,
  AMOUNT_ORDER_ITEM_ID_FIELD,
  AMOUNT_RETURN_TO_FIELD,
  AMOUNT_UNIT_PRICE_FIELD,
  AMOUNT_VERSION_FIELD,
  AMOUNT_ZERO_PRICE_REASON_FIELD,
} from '../../lib/orders/amount-form';
import { AMOUNT_REQUEST_ID_FIELD, AMOUNT_REQUEST_REASON_FIELD, AMOUNT_REQUEST_REASON_MAX } from '../../lib/orders/amount-request-form';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// item-amount-request-form.tsx — M-4b-03 B 片:員工「申請改成 ___ + 原因」(不改金額;管理者核了才改)。
// 🔴 欄位與 `item-amount-form.tsx` 同一組(訂單 / 品項 / version / 單價 / 0 元理由 / return_to)+ 兩格:原因、冪等 id。
// 🔴 `requestId` 由 server 渲染時發(同一次開窗重按 = 同鍵 = RPC 回 idempotent, 不會提兩條)。
// 🔴 client 驗證(required / pattern / maxLength)只是擋手滑;server `parseAmountRequestForm` 那道仍必要。

export type ItemAmountRequestFormProps = {
  orderId: string;
  expectedVersion: number;
  orderItemId: string;
  currentUnitPrice: number;
  returnTo: string;
  requestId: string;
  /** 這一項已經有一條待審 ⇒ 不掛表單, 印一句(一品項一條 pending, Q2 甲)。 */
  pendingBlocked?: boolean;
};

export function ItemAmountRequestForm({
  orderId,
  expectedVersion,
  orderItemId,
  currentUnitPrice,
  returnTo,
  requestId,
  pendingBlocked = false,
}: ItemAmountRequestFormProps) {
  const [price, setPrice] = useState(String(currentUnitPrice));
  const [submitting, setSubmitting] = useState(false);
  const isZero = /^0+$/.test(price.trim());

  if (pendingBlocked) {
    return (
      <p className='text-muted-foreground mt-1 text-xs' data-testid='amount-request-pending-blocked'>
        這一項已經有一條待審的申請, 等管理者處理完再提。
      </p>
    );
  }

  return (
    <form action={requestOrderItemAmountAction} onSubmit={() => setSubmitting(true)} className='flex flex-col gap-2' data-testid='item-amount-request-form'>
      <input type='hidden' name={AMOUNT_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={AMOUNT_ORDER_ITEM_ID_FIELD} value={orderItemId} />
      <input type='hidden' name={AMOUNT_VERSION_FIELD} value={expectedVersion} />
      <input type='hidden' name={AMOUNT_RETURN_TO_FIELD} value={returnTo} />
      <input type='hidden' name={AMOUNT_REQUEST_ID_FIELD} value={requestId} />

      <AdminFormField label='申請改成(元)'>
        <input
          name={AMOUNT_UNIT_PRICE_FIELD}
          className={ADMIN_INPUT_CLASS}
          inputMode='numeric'
          required
          pattern='[0-9]+'
          title='只能填數字(不要加逗號、小數點或空白)'
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </AdminFormField>

      {isZero ? (
        <AdminFormField label='改成 0 元的原因(必填)'>
          <input name={AMOUNT_ZERO_PRICE_REASON_FIELD} className={ADMIN_INPUT_CLASS} required placeholder='例:贈品 / 換貨補寄' />
        </AdminFormField>
      ) : null}

      <AdminFormField label='為什麼要改(給管理者看, 必填)'>
        <input
          name={AMOUNT_REQUEST_REASON_FIELD}
          className={ADMIN_INPUT_CLASS}
          required
          maxLength={AMOUNT_REQUEST_REASON_MAX}
          placeholder='例:客人是老朋友, 老闆口頭答應過'
        />
      </AdminFormField>

      <div>
        <button type='submit' disabled={submitting} className='text-sm underline disabled:opacity-50'>
          {submitting ? '送出中…' : '送出申請'}
        </button>
      </div>
    </form>
  );
}
