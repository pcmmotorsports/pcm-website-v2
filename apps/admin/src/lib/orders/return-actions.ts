'use server';
// 退貨收回(第 2 片):登記退貨 / 確認收到退貨 / 作廢退貨登記 三個 server action。形狀照 payment/manual-refund-actions.ts。
// 成功一律 redirect(PRG, 頁面重新渲染 ⇒ 下一次送出拿到新的送出編號);失敗回 state, 沿用同一個送出編號。
// 權限:一般後台登入即可(同手動登記退款), 不限管理者。真正的數量上限在資料庫函式裡(鎖單之後重算)。
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import { isUuid } from './note-action-state';
import { ORDER_RETURN_TO_FIELD, appendResultQuery, parseOrderReturnTo } from './order-return-to';
import { revalidateOrderViews } from './order-revalidate';
import {
  RETURN_ID_FIELD,
  RETURN_NOTE_FIELD,
  RETURN_ORDER_ID_FIELD,
  RETURN_REASON_CODE_FIELD,
  RETURN_REASON_DETAIL_FIELD,
  RETURN_RECEIVED_RESULT_CODE,
  RETURN_REGISTERED_RESULT_CODE,
  RETURN_REQUEST_TOKEN_FIELD,
  RETURN_TRACKING_FIELD,
  RETURN_VOIDED_RESULT_CODE,
  RETURN_VOID_REASON_FIELD,
  generateReturnRequestToken,
  returnConditionField,
  returnFailure,
  type ReturnActionState,
} from './return-action-state';
import { receiveReturn, registerReturn, voidReturn, type ReturnOutcome } from './return-repository';
import { RETURN_REASON_CODES, type ReturnCondition, type ReturnReasonCode } from './return-view';

const QTY_PREFIX = 'qty:';

function text(formData: FormData, field: string, max: number): string | null | 'too-long' {
  const v = (readSingleString(formData, field) ?? '').trim();
  if (v === '') return null;
  return [...v].length > max ? 'too-long' : v;
}

/** 表單上所有 `qty:<order_item_id>` 欄位(依出現順序);格式不對回 null。 */
function quantities(formData: FormData): { orderItemId: string; quantity: number }[] | null {
  const out: { orderItemId: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(QTY_PREFIX)) continue;
    const orderItemId = key.slice(QTY_PREFIX.length);
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!isUuid(orderItemId) || !/^[0-9]{1,6}$/.test(raw === '' ? '0' : raw)) return null;
    out.push({ orderItemId, quantity: raw === '' ? 0 : Number(raw) });
  }
  return out;
}

async function finish(
  outcome: ReturnOutcome,
  ctx: { orderId: string; token: string; returnTo: string; httpRequestId: string; scope: string; resultCode: string },
): Promise<ReturnActionState> {
  revalidateOrderViews({ orderId: ctx.orderId, returnTo: ctx.returnTo, scope: ctx.scope, requestId: ctx.httpRequestId });
  if (!outcome.ok) {
    console.error(`[admin/orders/${ctx.scope}] 失敗`, {
      request_id: ctx.httpRequestId,
      request_token: ctx.token,
      order_id: ctx.orderId,
      code: outcome.code,
      sqlstate: outcome.sqlstate,
      message: outcome.logMessage,
    });
    return returnFailure(outcome.code, ctx.token, outcome.staffMessage ?? undefined);
  }
  console.info(`[admin/orders/${ctx.scope}] 完成`, {
    request_id: ctx.httpRequestId,
    request_token: ctx.token,
    order_id: ctx.orderId,
    return_id: outcome.returnId,
    idempotent: outcome.idempotent,
  });
  redirect(appendResultQuery(ctx.returnTo, `r=${ctx.resultCode}`));
}

/** 共用開頭:登入、訂單編號、送出編號。回傳 null ⇒ 已經是失敗 state。 */
type Begun =
  | { ok: false; fail: ReturnActionState }
  | { ok: true; actor: string; orderId: string; token: string; returnTo: string; httpRequestId: string };

async function begin(formData: FormData): Promise<Begun> {
  const token = readSingleString(formData, RETURN_REQUEST_TOKEN_FIELD) ?? '';
  const authorization = await authorizeAdminMutation();
  if (!authorization) return { ok: false, fail: returnFailure('denied', generateReturnRequestToken()) };
  const orderId = readSingleString(formData, RETURN_ORDER_ID_FIELD) ?? '';
  if (!isUuid(orderId) || !isUuid(token)) {
    return { ok: false, fail: returnFailure('invalid', isUuid(token) ? token : generateReturnRequestToken()) };
  }
  return {
    ok: true,
    actor: authorization.actorId,
    orderId,
    token,
    returnTo: parseOrderReturnTo(readSingleString(formData, ORDER_RETURN_TO_FIELD), orderId),
    httpRequestId: await getRequestId(),
  };
}

export async function registerReturnAction(_prev: ReturnActionState, formData: FormData): Promise<ReturnActionState> {
  const b = await begin(formData);
  if (!b.ok) return b.fail;
  const reasonCode = readSingleString(formData, RETURN_REASON_CODE_FIELD) ?? '';
  const reasonDetail = text(formData, RETURN_REASON_DETAIL_FIELD, 200);
  const note = text(formData, RETURN_NOTE_FIELD, 500);
  const tracking = text(formData, RETURN_TRACKING_FIELD, 50);
  const items = quantities(formData)?.filter((i) => i.quantity > 0);
  if (
    !RETURN_REASON_CODES.includes(reasonCode as ReturnReasonCode) ||
    reasonDetail === 'too-long' ||
    note === 'too-long' ||
    tracking === 'too-long' ||
    (reasonCode === 'other' && reasonDetail === null) ||
    !items ||
    items.length === 0
  ) {
    return returnFailure('invalid', b.token);
  }
  const outcome = await registerReturn({
    orderId: b.orderId,
    requestId: b.token,
    actor: b.actor,
    reasonCode: reasonCode as ReturnReasonCode,
    reasonDetail,
    note,
    trackingNumber: tracking,
    items,
  });
  return finish(outcome, { ...b, scope: 'return-register', resultCode: RETURN_REGISTERED_RESULT_CODE });
}

export async function receiveReturnAction(_prev: ReturnActionState, formData: FormData): Promise<ReturnActionState> {
  const b = await begin(formData);
  if (!b.ok) return b.fail;
  const returnId = readSingleString(formData, RETURN_ID_FIELD) ?? '';
  const note = text(formData, RETURN_NOTE_FIELD, 500);
  const qty = quantities(formData);
  if (!isUuid(returnId) || note === 'too-long' || !qty || qty.length === 0) return returnFailure('invalid', b.token);
  const items: { orderItemId: string; receivedQuantity: number; condition: ReturnCondition | null }[] = [];
  for (const q of qty) {
    const raw = readSingleString(formData, returnConditionField(q.orderItemId)) ?? '';
    const condition = raw === 'good' || raw === 'damaged' ? raw : null;
    // 有收到就一定要選狀況;沒收到的品項不帶狀況(資料庫同一條規則), 選了也忽略。
    if (q.quantity > 0 && condition === null) return returnFailure('invalid', b.token);
    items.push({ orderItemId: q.orderItemId, receivedQuantity: q.quantity, condition: q.quantity > 0 ? condition : null });
  }
  const outcome = await receiveReturn({ returnId, requestId: b.token, actor: b.actor, note, items });
  return finish(outcome, { ...b, scope: 'return-receive', resultCode: RETURN_RECEIVED_RESULT_CODE });
}

export async function voidReturnAction(_prev: ReturnActionState, formData: FormData): Promise<ReturnActionState> {
  const b = await begin(formData);
  if (!b.ok) return b.fail;
  const returnId = readSingleString(formData, RETURN_ID_FIELD) ?? '';
  const voidReason = text(formData, RETURN_VOID_REASON_FIELD, 200);
  if (!isUuid(returnId) || voidReason === null || voidReason === 'too-long') return returnFailure('invalid', b.token);
  const outcome = await voidReturn({ returnId, requestId: b.token, actor: b.actor, voidReason });
  return finish(outcome, { ...b, scope: 'return-void', resultCode: RETURN_VOIDED_RESULT_CODE });
}
