'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { parseItemSwapForm } from './item-swap-form';
import { swapOrderItemViaRpc, type ItemSwapOutcome } from './item-swap-repository';
import { itemSwapRejectResultCode, type ItemSwapResultCode } from './item-swap-state';
import { appendResultQuery } from './order-return-to';

// item-swap-actions.ts — 後台「換商品」server action(plan 2026-09-22-admin-order-item-swap-plan.md)。
// 權限:在職員工即可(Sean Q2 甲);寫入、鎖、稽核都在資料庫函式同一交易, 這裡不另寫紀錄。

function redirectWith(returnTo: string, code: ItemSwapResultCode): never {
  redirect(appendResultQuery(returnTo, `r=${code}`));
}

export async function swapOrderItemAction(formData: FormData): Promise<void> {
  const auth = await authorizeAdminMutation();
  if (!auth) redirectWith('/orders', 'item_swap_denied');

  const parsed = parseItemSwapForm(formData);
  if (!parsed.ok) redirectWith(parsed.orderId ? `/orders/${parsed.orderId}` : '/orders', 'item_swap_invalid');

  const requestId = await getRequestId();
  let outcome: ItemSwapOutcome;
  try {
    outcome = await swapOrderItemViaRpc({
      orderId: parsed.orderId,
      itemId: parsed.itemId,
      expectedVersion: parsed.expectedVersion,
      newVariantId: parsed.newVariantId,
      actorId: auth.actorId,
      requestId: parsed.requestId,
    });
  } catch (error) {
    // 只記代碼與識別欄位;結果不明時畫面請員工先重新整理確認, 不直接叫他重送。
    const e = error as { code?: unknown };
    console.error('[admin/orders/item-swap] 換商品失敗', {
      request_id: requestId,
      swap_request_id: parsed.requestId,
      order_id: parsed.orderId,
      code: typeof e.code === 'string' ? e.code : undefined,
    });
    redirectWith(parsed.returnTo, 'item_swap_error');
  }

  switch (outcome.kind) {
    case 'swapped':
    case 'idempotent':
      revalidatePath('/orders');
      redirectWith(parsed.returnTo, 'item_swapped');
    case 'noop':
      redirectWith(parsed.returnTo, 'item_swap_noop');
    case 'conflict':
      revalidatePath('/orders');
      redirectWith(parsed.returnTo, 'item_swap_conflict');
    case 'denied':
      redirectWith(parsed.returnTo, 'item_swap_denied');
    case 'rejected':
      console.warn('[admin/orders/item-swap] 換商品被拒', {
        request_id: requestId,
        order_id: parsed.orderId,
        reason: outcome.reason,
      });
      redirectWith(parsed.returnTo, itemSwapRejectResultCode(outcome.reason));
    default: {
      const exhaustive: never = outcome;
      throw new Error(`換商品回了非預期結果:${JSON.stringify(exhaustive)}`);
    }
  }
}
