'use server';

import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import { MANUAL_REFUND_ENTRY_BLOCKED_BY_787 } from '../../components/orders/manual-refund-entry-gate';
import { parseManualRefundForm } from './manual-refund-form';
import {
  EMPTY_MANUAL_REFUND_INPUT,
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  MANUAL_REFUND_SUBMITTED_RESULT_CODE,
  generateManualRefundRequestToken,
  manualRefundFailure,
  type ManualRefundActionState,
  type ManualRefundFormInput,
} from './manual-refund-action-state';
import { ORDER_RETURN_TO_FIELD, appendResultQuery, parseOrderReturnTo } from '../orders/order-return-to';
import { revalidateOrderViews } from '../orders/order-revalidate';
import { recordManualRefund } from './manual-refund-repository';

// manual-refund-actions.ts — M-4b E10 D3:非卡退款登記 server action(高風險片、鐵則 12 ①)。
//
// 🔴 與 `refund-actions.ts`(TapPay 線)刻意簡化:那支要走 G0 baseline + adapter.refund() +
//    三態 wire 結果,本 RPC 是單一一次 `.rpc()` 呼叫、結局只有「成功/idempotent」與「RAISE」
//    兩種 —— 照抄那支的多步驟結構會把不存在的複雜度也一起搬過來。
//
// 🔴 本檔沒有一行稽核 code —— RPC 同交易寫 admin_audit_log(D1 header 段)。

/** 失敗時帶回的員工輸入(reason 是打字成本最高的一欄)。 */
function carryBack(formData: FormData): ManualRefundFormInput & { requestToken: string } {
  const read = (field: string): string => readSingleString(formData, field) ?? '';
  const token = read(MANUAL_REFUND_REQUEST_TOKEN_FIELD);
  return {
    rail: read(MANUAL_REFUND_RAIL_FIELD),
    amount: read(MANUAL_REFUND_AMOUNT_FIELD),
    reason: read(MANUAL_REFUND_REASON_FIELD),
    occurredAt: read(MANUAL_REFUND_OCCURRED_AT_FIELD),
    requestToken: token !== '' ? token : generateManualRefundRequestToken(),
  };
}

export async function recordManualRefundAction(
  _prev: ManualRefundActionState,
  formData: FormData,
): Promise<ManualRefundActionState> {
  // ① 授權閘。絕對第一,連讀一個欄位都在它之後。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return manualRefundFailure('denied', EMPTY_MANUAL_REFUND_INPUT, generateManualRefundRequestToken());
  }

  // 🔴 #787 硬閘(同 manual-refund-entry-gate.ts 的封印,server 端補一份——
  // 畫面按鈕不渲染擋不住直接送這支 server action 的請求)。
  if (MANUAL_REFUND_ENTRY_BLOCKED_BY_787) {
    return manualRefundFailure('denied', EMPTY_MANUAL_REFUND_INPUT, generateManualRefundRequestToken());
  }

  const carried = carryBack(formData);
  const input: ManualRefundFormInput = {
    rail: carried.rail,
    amount: carried.amount,
    reason: carried.reason,
    occurredAt: carried.occurredAt,
  };

  // ② 解析(純形狀;業務判定單一真相在 RPC)。
  const parsed = parseManualRefundForm(formData);
  if (!parsed.ok) return manualRefundFailure('invalid', input, carried.requestToken);

  const returnTo = parseOrderReturnTo(
    readSingleString(formData, ORDER_RETURN_TO_FIELD),
    parsed.orderId,
  );

  const httpRequestId = await getRequestId();
  console.info('[admin/payment/manual-refund] manual_refund.attempt', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: parsed.orderId,
    rail: parsed.rail,
    amount: parsed.amount,
    reason_length: [...parsed.reason].length,
  });

  const outcome = await recordManualRefund({
    orderId: parsed.orderId,
    rail: parsed.rail,
    refundAmount: parsed.amount,
    reason: parsed.reason,
    occurredAt: parsed.occurredAt,
    actor: authorization.actorId,
    requestId: parsed.requestToken,
  });

  if (!outcome.ok) {
    console.error('[admin/payment/manual-refund] 登記失敗', {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      order_id: parsed.orderId,
      code: outcome.code,
      sqlstate: outcome.sqlstate,
      message: outcome.logMessage,
    });
    revalidateOrderViews({
      orderId: parsed.orderId,
      returnTo,
      scope: 'manual-refund',
      requestId: httpRequestId,
    });
    return manualRefundFailure(
      outcome.code,
      input,
      parsed.requestToken,
      outcome.staffMessage ?? undefined,
    );
  }

  console.info('[admin/payment/manual-refund] manual_refund.done', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    order_id: parsed.orderId,
    refund_id: outcome.refundId,
    idempotent: outcome.idempotent,
  });
  revalidateOrderViews({
    orderId: parsed.orderId,
    returnTo,
    scope: 'manual-refund',
    requestId: httpRequestId,
  });

  // idempotent: true 也是成功(同 cancel 線對 DUPLICATE_REQUEST 的處置):顯示成錯誤會誘導
  // 員工換一把 token 重送,冪等設計反而製造第二筆退款登記。
  // 成功才 PRG,在一切 try 之外(本層與 repository 都不 throw,見 repository 檔頭)。
  redirect(appendResultQuery(returnTo, `r=${MANUAL_REFUND_SUBMITTED_RESULT_CODE}`));
}
