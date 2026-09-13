'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { voidItemProcurementAction } from '../../lib/orders/procurement-actions';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import {
  PVOID_ORDER_ID_FIELD,
  PVOID_PROCUREMENT_ID_FIELD,
  PVOID_REASON_FIELD,
  PVOID_REASON_MAX,
  PVOID_REQUEST_ID_FIELD,
  type ProcurementVoidState,
} from '../../lib/orders/procurement-void-state';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';
import { mintRequestId } from './receipt-record-form';

// procurement-void-button.tsx — 「已下的採購(作廢在這裡)」每一筆內摺的 作廢 → 作廢理由 + 紅鈕 確認作廢(稿 v22 彈窗 7)。
//
// 🔴 兩段式(先按「作廢」展開,再填理由、按「確認作廢」)—— 抄 `manual-refund-void-button.tsx` 的形狀:不可逆的動作,
//    而清單上每一列都有一顆。理由必填(`required` + action 再擋 + RPC 第三道),會寫進稽核。
// 🔴 冪等鍵掛載時鑄一次(復用到貨表單的 `mintRequestId`;hydrate 前 fieldset 是 disabled ⇒ 送不出去)。
// 🔴 成功 / 已不在 ⇒ 導回 `doneHref`(列表 + 展開這張單);導之前查現在的網址還是不是這張單的下訂彈窗
//    (同 `receipt-delete-button.tsx` 那條 codex 教訓:員工等回應時關了 A 開 B,回應不能把他拉回 A)。
export function ProcurementVoidButton({
  procurementId,
  orderId,
  returnTo,
  doneHref,
  label,
}: {
  procurementId: string;
  orderId: string;
  returnTo: string;
  /** 作廢成功後導去哪(列表彈窗傳);不傳 = 留在原地、就地變「已作廢」。 */
  doneHref?: string;
  /** 確認句裡講「作廢哪一筆」,不參與判定。 */
  label: string;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState('');
  // 掛載後才鑄(避 SSR hydration mismatch);`mintRequestId` 含非 secure context 的 fallback(同到貨表單)。
  useEffect(() => setRequestId(mintRequestId()), []);
  const stillThisDialog = () => {
    if (typeof window === 'undefined') return false;
    const q = new URLSearchParams(window.location.search);
    return q.get('next') === orderId && q.get('do') === 'order';
  };
  const [state, formAction, pending] = useActionState<ProcurementVoidState, FormData>(
    async (prev, fd) => {
      const next = await voidItemProcurementAction(prev, fd);
      if (doneHref !== undefined && (next.status === 'voided' || next.status === 'already_gone') && stillThisDialog()) {
        router.replace(doneHref);
      }
      return next;
    },
    { status: 'idle' },
  );

  if (state.status === 'voided') return <span className='text-muted-foreground text-xs'>已作廢</span>;
  if (state.status === 'already_gone') return <span className='text-muted-foreground text-xs'>這筆已經不是生效的採購了</span>;

  return (
    <details className='inline' data-testid='procurement-void'>
      <summary className='text-destructive cursor-pointer text-xs underline'>作廢</summary>
      <form action={formAction} className='mt-1 space-y-1.5'>
        <input type='hidden' name={PVOID_ORDER_ID_FIELD} value={orderId} />
        <input type='hidden' name={PVOID_PROCUREMENT_ID_FIELD} value={procurementId} />
        <input type='hidden' name={PVOID_REQUEST_ID_FIELD} value={requestId} />
        <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
        {state.status === 'failed' && (
          <p role='alert' className='text-destructive text-xs'>
            {state.message}
          </p>
        )}
        {state.status === 'has_receipts' && (
          <p role='alert' className='text-destructive text-xs'>
            這筆採購已經登過到貨,系統沒有動它。要作廢請先到「到貨登記」把那些到貨撤掉,再回來作廢。
          </p>
        )}
        <fieldset disabled={pending || requestId === ''} className='space-y-1.5 border-0 p-0'>
          <input
            name={PVOID_REASON_FIELD}
            required
            maxLength={PVOID_REASON_MAX}
            className={ADMIN_INPUT_CLASS}
            placeholder='為什麼這筆記錯了?會寫進稽核'
            aria-label='作廢理由'
          />
          <button
            type='submit'
            className='bg-destructive text-destructive-foreground inline-flex min-h-[30px] items-center rounded-lg px-3 text-[13px] leading-[1.4] font-semibold disabled:opacity-50'
          >
            {pending ? '作廢中…' : `確認作廢(${label})`}
          </button>
        </fieldset>
      </form>
    </details>
  );
}
