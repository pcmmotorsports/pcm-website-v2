'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { parseAmountRequestForm } from './amount-request-form';
import { requestOrderItemAmountViaRpc } from './amount-request-repository';
import { appendResultQuery } from './order-return-to';

// amount-request-actions.ts — M-4b-03 B 片:員工提「改品項單價」申請(不改金額)。
// 🔴 閘 = 一般員工閘 `authorizeAdminMutation`(提案不碰錢, 管理者紅線在 review 那支 + RPC 內);形狀抄 `item-costs-actions.ts`。
// 🔴 RPC 的人話不進網址:結果碼五顆(`amount_request_*`, 登記在 result-banner + 它的鍵集合測試)。

export type AmountRequestResultCode =
  | 'amount_request_sent'
  | 'amount_request_denied'
  | 'amount_request_invalid'
  | 'amount_request_rejected'
  | 'amount_request_error';

function redirectWith(returnTo: string, code: AmountRequestResultCode): never {
  redirect(appendResultQuery(returnTo, `r=${code}`));
}

export async function requestOrderItemAmountAction(formData: FormData): Promise<void> {
  const auth = await authorizeAdminMutation();
  if (!auth) redirectWith('/orders', 'amount_request_denied');

  const parsed = parseAmountRequestForm(formData);
  if (!parsed.ok) redirectWith(parsed.orderId ? `/orders/${parsed.orderId}` : '/orders', 'amount_request_invalid');

  const requestId = await getRequestId();
  let outcome;
  try {
    outcome = await requestOrderItemAmountViaRpc({
      orderId: parsed.orderId,
      orderItemId: parsed.patch.orderItemId,
      expectedVersion: parsed.expectedVersion,
      toUnitPrice: parsed.patch.unitPrice,
      zeroPriceReason: parsed.patch.zeroPriceReason,
      reason: parsed.reason,
      actorId: auth.actorId,
      requestId: parsed.requestId,
    });
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    console.error('[admin/orders/amount-request] 提案寫入失敗', {
      request_id: requestId,
      order_id: parsed.orderId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(parsed.returnTo, 'amount_request_error');
  }
  if (outcome.kind === 'denied') redirectWith(parsed.returnTo, 'amount_request_denied');
  if (outcome.kind === 'rejected') {
    console.warn('[admin/orders/amount-request] RPC 拒絕', { request_id: requestId, message: outcome.message.slice(0, 200) });
    redirectWith(parsed.returnTo, 'amount_request_rejected');
  }
  revalidatePath('/orders');
  redirectWith(parsed.returnTo, 'amount_request_sent');
}
