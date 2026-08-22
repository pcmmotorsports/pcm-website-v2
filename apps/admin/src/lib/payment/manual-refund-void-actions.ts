'use server';

import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import {
  MANUAL_REFUND_VOIDED_RESULT_CODE,
  MANUAL_REFUND_VOID_ID_FIELD,
  MANUAL_REFUND_VOID_ORDER_ID_FIELD,
  MANUAL_REFUND_VOID_REASON_FIELD,
  manualRefundVoidFailure,
  parseManualRefundVoidForm,
  type ManualRefundVoidActionState,
} from './manual-refund-void-action-state';
import { ORDER_RETURN_TO_FIELD, appendResultQuery, parseOrderReturnTo } from '../orders/order-return-to';
import { revalidateOrderViews } from '../orders/order-revalidate';
import { voidManualRefund } from './manual-refund-void-repository';

// manual-refund-void-actions.ts — M-4b E10 片 D3-c:非卡退款作廢 server action(高風險片、鐵則 12 ①)。
//
// 🔴 **這支是 `#787` 的解除鍵。** #787 封印登記入口的理由是「登記錯了改不掉」——
//    本檔就是「改得掉」的那條路。⇒ 它壞掉 = #787 的封印理由重新成立。
//
// 🔴 本檔沒有一行稽核 code —— RPC 同交易寫 admin_audit_log。
//
// ⚠️ **actor 一律取自 `authorizeAdminMutation()`,絕不讀表單。**
//    D3-b 的 COMMENT 逐字:「p_actor / voided_by 記的是『操作者自己挑的身分』,不是登入身分」——
//    那句話描述的是 RPC 的射程,不是准許呼叫端從表單收 actor。從表單收 = 多開一條偽造路徑。

export async function voidManualRefundAction(
  _prev: ManualRefundVoidActionState,
  formData: FormData,
): Promise<ManualRefundVoidActionState> {
  // ① 授權閘。絕對第一,連讀一個欄位都在它之後。
  const authorization = await authorizeAdminMutation();
  if (!authorization) return manualRefundVoidFailure('denied', '', '');

  const refundId = readSingleString(formData, MANUAL_REFUND_VOID_ID_FIELD);
  const rawReason = readSingleString(formData, MANUAL_REFUND_VOID_REASON_FIELD);
  // 🔴 `order_id` **不進 RPC** —— `admin_void_manual_refund` 只吃 refund_id。
  //    它在這裡只有兩個用途:重新驗證那張訂單頁的快取、以及 returnTo 的 fallback。
  //    ⇒ 就算它被竄改,也影響不到「作廢了哪一列」。
  const orderId = readSingleString(formData, MANUAL_REFUND_VOID_ORDER_ID_FIELD) ?? '';

  // ② 解析(純形狀;業務判定的單一真相在 RPC)。
  const parsed = parseManualRefundVoidForm({ refundId, reason: rawReason });
  if (!parsed.ok) {
    return manualRefundVoidFailure('invalid', (rawReason ?? '').trim(), refundId ?? '');
  }

  const returnTo = parseOrderReturnTo(readSingleString(formData, ORDER_RETURN_TO_FIELD), orderId);

  const httpRequestId = await getRequestId();
  console.info('[admin/payment/manual-refund-void] manual_refund_void.attempt', {
    request_id: httpRequestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    refund_id: parsed.refundId,
    reason_length: [...parsed.reason].length,
  });

  const outcome = await voidManualRefund({
    refundId: parsed.refundId,
    reason: parsed.reason,
    actor: authorization.actorId,
  });

  if (!outcome.ok) {
    console.error('[admin/payment/manual-refund-void] 作廢失敗', {
      request_id: httpRequestId,
      refund_id: parsed.refundId,
      code: outcome.code,
      sqlstate: outcome.sqlstate,
      message: outcome.logMessage,
    });
    revalidateOrderViews({
      orderId,
      returnTo,
      scope: 'manual-refund-void',
      requestId: httpRequestId,
    });
    return manualRefundVoidFailure(
      outcome.code,
      parsed.reason,
      parsed.refundId,
      outcome.staffMessage ?? undefined,
    );
  }

  console.info('[admin/payment/manual-refund-void] manual_refund_void.done', {
    request_id: httpRequestId,
    refund_id: outcome.refundId,
    idempotent: outcome.idempotent,
  });
  revalidateOrderViews({
    orderId,
    returnTo,
    scope: 'manual-refund-void',
    requestId: httpRequestId,
  });

  // 🔴 idempotent: true 也是成功(同登記那半對重送的處置):同一人同一理由按第二次,
  //    在任何意義下就是同一個操作;顯示成錯誤只會誘導員工換一句理由再送,
  //    而換了理由就會撞上 D3-b 那句「本 RPC 不覆蓋既有的作廢紀錄」的 RAISE。
  // 成功才 PRG,在一切 try 之外(本層與 repository 都不 throw)。
  redirect(appendResultQuery(returnTo, `r=${MANUAL_REFUND_VOIDED_RESULT_CODE}`));
}
