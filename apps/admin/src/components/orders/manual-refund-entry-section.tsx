'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { recordManualRefundAction } from '../../lib/payment/manual-refund-actions';
import {
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  type ManualRefundActionState,
} from '../../lib/payment/manual-refund-action-state';
import { MANUAL_REFUND_RAILS, type ManualRefundRail } from '../../lib/payment/manual-refund-form';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// manual-refund-entry-section.tsx — M-4b E10 D3:訂單詳情的非卡退款登記入口
// (現金/匯款;高風險片、鐵則 12 ①)。骨架照抄 `refund-section.tsx`(TapPay 線),
// 依 `manual-refund-actions.ts` 檔頭所述簡化:單一 RPC 呼叫,沒有 kind 切換、
// 沒有 wire 層多步驟。
//
// 🔴 bfcache 還原絕不 client 換鍵(同 refund-section.tsx MF1 段的理由:退款的重送保護
// 就是舊 token,換新鍵會讓同一張舊表單變成「全新請求」)——這裡改做 router.refresh()。
//
// 🔴 失敗回來的值要真的進畫面(同 refund-section.tsx 的理由):useState 初值只在掛載時
// 求值,用 effect 套 state.input;denied 例外(input 是空殼,見 action state 檔頭)。

const RAIL_LABEL: Record<ManualRefundRail, string> = {
  bank_transfer: '匯款',
  cash: '現金',
};

/** datetime-local 預設值:當下時刻(本機時區,精確到分)。 */
function nowLocalInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function ManualRefundEntrySection({
  orderId,
  returnTo,
  serverToken,
}: {
  orderId: string;
  returnTo: string;
  /** 由 server component 渲染期產(同 refund-section.tsx 慣例;不得落任何快取層)。 */
  serverToken: string;
}) {
  const [state, formAction, isPending] = useActionState<ManualRefundActionState, FormData>(
    recordManualRefundAction,
    { status: 'idle', requestToken: serverToken },
  );
  const [rail, setRail] = useState<ManualRefundRail>('bank_transfer');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [occurredAt, setOccurredAt] = useState(nowLocalInput);
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  useEffect(() => {
    if (state.status !== 'failed') return;
    if (state.code === 'denied') return;
    if (state.input.rail === 'bank_transfer' || state.input.rail === 'cash') {
      setRail(state.input.rail);
    }
    setAmount(state.input.amount);
    setReason(state.input.reason);
    if (state.input.occurredAt !== '') setOccurredAt(state.input.occurredAt);
  }, [state]);

  const failed = state.status === 'failed';
  const requestToken = failed ? state.requestToken : serverToken;

  return (
    <section className='border-destructive/40 bg-destructive/5 rounded-lg border p-4'>
      <h2 className='text-destructive mb-1 text-sm font-semibold'>登記退款(現金/匯款)</h2>
      <p className='text-muted-foreground mb-3 text-xs'>
        記錄一筆已經交還給客人的現金或匯款退款,系統不會實際動錢——錢是人交回去的。
      </p>

      {failed && (
        <p
          role='alert'
          className='border-destructive/30 bg-destructive/10 text-destructive mb-3 rounded-md border px-3 py-2 text-sm'
        >
          {state.message}
        </p>
      )}

      <form action={formAction}>
        <fieldset disabled={isPending} className='min-w-0 space-y-3 border-0'>
          <input type='hidden' name={MANUAL_REFUND_ORDER_ID_FIELD} value={orderId} />
          <input type='hidden' name={MANUAL_REFUND_REQUEST_TOKEN_FIELD} value={requestToken} />
          <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />

          <div className='flex flex-wrap gap-4'>
            {MANUAL_REFUND_RAILS.map((r) => (
              <label key={r} className='flex items-center gap-1.5 text-sm'>
                <input
                  type='radio'
                  name={MANUAL_REFUND_RAIL_FIELD}
                  value={r}
                  checked={rail === r}
                  onChange={() => setRail(r)}
                />
                {RAIL_LABEL[r]}
              </label>
            ))}
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <AdminFormField label='退款金額(元、正整數)'>
              <input
                name={MANUAL_REFUND_AMOUNT_FIELD}
                required
                inputMode='numeric'
                pattern='[1-9][0-9]{0,9}'
                maxLength={10}
                autoComplete='off'
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={ADMIN_INPUT_CLASS}
                placeholder='不含小數、不含逗號'
              />
            </AdminFormField>
            <AdminFormField label='錢實際交回去的時間'>
              <input
                type='datetime-local'
                name={MANUAL_REFUND_OCCURRED_AT_FIELD}
                required
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
                className={ADMIN_INPUT_CLASS}
              />
            </AdminFormField>
          </div>

          <AdminFormField label='退款原因'>
            <input
              name={MANUAL_REFUND_REASON_FIELD}
              required
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={ADMIN_INPUT_CLASS}
              placeholder='會寫入退款紀錄與稽核,例:商品缺貨,匯款退回客人帳戶'
            />
          </AdminFormField>

          <div className='flex flex-wrap items-center justify-end gap-3'>
            <span className='text-muted-foreground mr-auto text-xs'>
              這是一筆登記,不會實際扣款或匯款——請先完成實際退款,再回來登記。
            </span>
            <button
              type='submit'
              disabled={isPending}
              className='bg-destructive h-9 rounded-md px-5 text-sm font-medium text-white disabled:opacity-50'
            >
              {isPending ? '送出中…' : '登記退款'}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
