'use client';
// 退貨收回(第 2 片):三個表單(登記退貨 / 確認收到退貨 / 作廢退貨登記)。外框由 order-return-section.tsx 排。
// 送出編號由伺服器渲染時產生(serverToken), 失敗時沿用 state 裡那一顆 —— 理由見 return-action-state.ts 檔頭。
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { receiveReturnAction, registerReturnAction, voidReturnAction } from '../../lib/orders/return-actions';
import {
  RETURN_ID_FIELD,
  RETURN_NOTE_FIELD,
  RETURN_ORDER_ID_FIELD,
  RETURN_REASON_CODE_FIELD,
  RETURN_REASON_DETAIL_FIELD,
  RETURN_REQUEST_TOKEN_FIELD,
  RETURN_TRACKING_FIELD,
  RETURN_VOID_REASON_FIELD,
  returnConditionField,
  returnQtyField,
  type ReturnActionState,
} from '../../lib/orders/return-action-state';
import {
  RETURN_CONDITION_LABEL,
  RETURN_REASON_CODES,
  RETURN_REASON_LABEL,
  type ReturnCondition,
  type ReturnReasonCode,
} from '../../lib/orders/return-view';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

export type ReturnFormItem = { id: string; label: string; spec: string | null; max: number };

const BUTTON = 'bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_OUTLINE = 'h-9 rounded-md border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';

/** bfcache 還原時重抓頁面, 避免拿舊畫面的送出編號再送一次(同 manual-refund-entry-section.tsx)。 */
function useRefreshOnBfcache() {
  const router = useRouter();
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);
}

function FailureMessage({ state }: { state: ReturnActionState }) {
  if (state.status !== 'failed') return null;
  return (
    <p role='alert' className='border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm'>
      {state.message}
    </p>
  );
}

function Hidden({ orderId, returnTo, token, returnId }: { orderId: string; returnTo: string; token: string; returnId?: string }) {
  return (
    <>
      <input type='hidden' name={RETURN_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={RETURN_REQUEST_TOKEN_FIELD} value={token} />
      <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
      {returnId && <input type='hidden' name={RETURN_ID_FIELD} value={returnId} />}
    </>
  );
}

export function ReturnRegisterForm({
  orderId,
  returnTo,
  serverToken,
  items,
}: {
  orderId: string;
  returnTo: string;
  serverToken: string;
  items: readonly ReturnFormItem[];
}) {
  const [state, formAction, isPending] = useActionState<ReturnActionState, FormData>(registerReturnAction, {
    status: 'idle',
    requestToken: serverToken,
  });
  const [reason, setReason] = useState<ReturnReasonCode>('defective');
  useRefreshOnBfcache();
  const token = state.status === 'failed' ? state.requestToken : serverToken;
  return (
    <form action={formAction} className='space-y-3'>
      <h3 className='text-sm font-semibold'>登記退貨</h3>
      <p className='text-muted-foreground text-xs'>
        客人說要退貨時先在這裡登記，等商品寄回再按「確認收到退貨」。登記不會退款，也不會改訂單狀態；確認收到後再到下方登記退款。
      </p>
      <FailureMessage state={state} />
      <fieldset disabled={isPending} className='min-w-0 space-y-3 border-0'>
        <Hidden orderId={orderId} returnTo={returnTo} token={token} />
        <table className='w-full text-sm'>
          <thead className='text-muted-foreground text-xs'>
            <tr>
              <th className='py-1 text-left font-medium'>品項</th>
              <th className='py-1 text-right font-medium'>可退</th>
              <th className='py-1 text-right font-medium'>這次退貨數量</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className='border-t'>
                <td className='py-2 pr-2'>
                  <div>{it.label}</div>
                  {it.spec && <div className='text-muted-foreground text-xs'>{it.spec}</div>}
                </td>
                <td className='py-2 text-right tabular-nums'>{it.max} 件</td>
                <td className='py-2 text-right'>
                  <input
                    type='number'
                    name={returnQtyField(it.id)}
                    aria-label={`${it.label} 這次退貨數量`}
                    min={0}
                    max={it.max}
                    step={1}
                    defaultValue={0}
                    className={`${ADMIN_INPUT_CLASS} w-20 text-right`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className='grid gap-3 sm:grid-cols-2'>
          <AdminFormField label='退貨原因'>
            <select
              name={RETURN_REASON_CODE_FIELD}
              value={reason}
              onChange={(e) => setReason(e.target.value as ReturnReasonCode)}
              className={ADMIN_INPUT_CLASS}
            >
              {RETURN_REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {RETURN_REASON_LABEL[c]}
                </option>
              ))}
            </select>
          </AdminFormField>
          <AdminFormField label={reason === 'other' ? '原因說明（必填）' : '原因說明（選填）'}>
            <input name={RETURN_REASON_DETAIL_FIELD} maxLength={200} required={reason === 'other'} className={ADMIN_INPUT_CLASS} />
          </AdminFormField>
          <AdminFormField label='客人寄回的物流單號（選填）'>
            <input name={RETURN_TRACKING_FIELD} maxLength={50} autoComplete='off' className={ADMIN_INPUT_CLASS} />
          </AdminFormField>
          <AdminFormField label='備註（選填）'>
            <input name={RETURN_NOTE_FIELD} maxLength={500} className={ADMIN_INPUT_CLASS} />
          </AdminFormField>
        </div>
        <button type='submit' className={BUTTON}>
          登記退貨
        </button>
      </fieldset>
    </form>
  );
}

export function ReturnReceiveForm({
  orderId,
  returnId,
  returnTo,
  serverToken,
  items,
}: {
  orderId: string;
  returnId: string;
  returnTo: string;
  serverToken: string;
  items: readonly ReturnFormItem[];
}) {
  const [state, formAction, isPending] = useActionState<ReturnActionState, FormData>(receiveReturnAction, {
    status: 'idle',
    requestToken: serverToken,
  });
  const [open, setOpen] = useState(false);
  useRefreshOnBfcache();
  const token = state.status === 'failed' ? state.requestToken : serverToken;
  if (!open && state.status !== 'failed') {
    return (
      <button type='button' className={BUTTON} onClick={() => setOpen(true)}>
        確認收到退貨
      </button>
    );
  }
  return (
    <form action={formAction} className='space-y-3 rounded-md border p-3'>
      <p className='text-muted-foreground text-xs'>逐項填實際收到的數量。有收到的品項請選商品狀況；沒收到的填 0。</p>
      <FailureMessage state={state} />
      <fieldset disabled={isPending} className='min-w-0 space-y-3 border-0'>
        <Hidden orderId={orderId} returnTo={returnTo} token={token} returnId={returnId} />
        {items.map((it) => (
          <div key={it.id} className='grid items-end gap-2 sm:grid-cols-[1fr_auto_auto]'>
            <div className='text-sm'>
              <div>{it.label}</div>
              <div className='text-muted-foreground text-xs'>登記 {it.max} 件</div>
            </div>
            <AdminFormField label='實收數量'>
              <input
                type='number'
                name={returnQtyField(it.id)}
                aria-label={`${it.label} 實收數量`}
                min={0}
                max={it.max}
                step={1}
                defaultValue={it.max}
                className={`${ADMIN_INPUT_CLASS} w-20 text-right`}
              />
            </AdminFormField>
            <AdminFormField label='商品狀況'>
              <select name={returnConditionField(it.id)} aria-label={`${it.label} 商品狀況`} defaultValue='' className={ADMIN_INPUT_CLASS}>
                <option value=''>請選擇</option>
                {(Object.keys(RETURN_CONDITION_LABEL) as ReturnCondition[]).map((c) => (
                  <option key={c} value={c}>
                    {RETURN_CONDITION_LABEL[c]}
                  </option>
                ))}
              </select>
            </AdminFormField>
          </div>
        ))}
        <AdminFormField label='收件備註（選填）'>
          <input name={RETURN_NOTE_FIELD} maxLength={500} className={ADMIN_INPUT_CLASS} />
        </AdminFormField>
        <div className='flex gap-2'>
          <button type='submit' className={BUTTON}>
            確認收到退貨
          </button>
          <button type='button' className={BUTTON_OUTLINE} onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function ReturnVoidForm({
  orderId,
  returnId,
  returnTo,
  serverToken,
}: {
  orderId: string;
  returnId: string;
  returnTo: string;
  serverToken: string;
}) {
  const [state, formAction, isPending] = useActionState<ReturnActionState, FormData>(voidReturnAction, {
    status: 'idle',
    requestToken: serverToken,
  });
  const [open, setOpen] = useState(false);
  useRefreshOnBfcache();
  const token = state.status === 'failed' ? state.requestToken : serverToken;
  if (!open && state.status !== 'failed') {
    return (
      <button type='button' className={BUTTON_OUTLINE} onClick={() => setOpen(true)}>
        作廢退貨登記
      </button>
    );
  }
  return (
    <form action={formAction} className='space-y-3 rounded-md border p-3'>
      <p className='text-muted-foreground text-xs'>登記錯了，或客人決定不寄回時使用。作廢後這筆登記的數量會釋出，可以重新登記。</p>
      <FailureMessage state={state} />
      <fieldset disabled={isPending} className='min-w-0 space-y-3 border-0'>
        <Hidden orderId={orderId} returnTo={returnTo} token={token} returnId={returnId} />
        <AdminFormField label='作廢原因'>
          <input name={RETURN_VOID_REASON_FIELD} required maxLength={200} className={ADMIN_INPUT_CLASS} />
        </AdminFormField>
        <div className='flex gap-2'>
          <button type='submit' className={BUTTON_OUTLINE}>
            作廢退貨登記
          </button>
          <button type='button' className={BUTTON_OUTLINE} onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}
