'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeManagerMutation } from '../session/authorize';
import { reviewOrderItemAmountViaRpc } from './amount-request-repository';
import { ORDER_RETURN_TO_FIELD, appendResultQuery, parseOrderReturnTo } from './order-return-to';

// amount-review-actions.ts — M-4b-03 C 片:管理者核 / 退「改品項單價」申請。
// 🔴 L2 = authorizeManagerMutation(非管理者 ⇒ denied, 它自己 warn admin.manager.denied);L3 在 RPC(管理者閘 '無權執行此操作')。
// 🔴 核准 = RPC 內同交易走既有 admin_update_order_item_amount, actor = 這位管理者;本檔不碰金額。

import {
  AMOUNT_REVIEW_DECISION_FIELD,
  AMOUNT_REVIEW_NOTE_FIELD,
  AMOUNT_REVIEW_NOTE_MAX,
  AMOUNT_REVIEW_ROW_FIELD,
  bindOpenTo,
  type AmountReviewResultCode,
} from './amount-review-form';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function redirectWith(returnTo: string, code: AmountReviewResultCode): never {
  redirect(appendResultQuery(returnTo, `r=${code}`));
}

export async function reviewOrderItemAmountAction(formData: FormData): Promise<void> {
  const parsedReturnTo = parseOrderReturnTo(readSingleString(formData, ORDER_RETURN_TO_FIELD), '');
  const returnTo = parsedReturnTo === '/orders/' ? '/orders' : parsedReturnTo;

  const auth = await authorizeManagerMutation();
  if (!auth) redirectWith(returnTo, 'amount_review_denied');

  const rowId = readSingleString(formData, AMOUNT_REVIEW_ROW_FIELD);
  const decision = readSingleString(formData, AMOUNT_REVIEW_DECISION_FIELD);
  const noteRaw = readSingleString(formData, AMOUNT_REVIEW_NOTE_FIELD);
  const note = (noteRaw ?? '').trim();
  if (!rowId || !UUID_RE.test(rowId) || (decision !== 'approve' && decision !== 'reject') || note.length > AMOUNT_REVIEW_NOTE_MAX) {
    redirectWith(returnTo, 'amount_review_invalid');
  }
  if (decision === 'reject' && note === '') redirectWith(returnTo, 'amount_review_invalid');

  const requestId = await getRequestId();
  let outcome;
  try {
    outcome = await reviewOrderItemAmountViaRpc({
      requestRowId: rowId.toLowerCase(),
      decision,
      reviewNote: note === '' ? null : note,
      actorId: auth.actorId,
      requestId,
    });
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    console.error('[admin/orders/amount-review] 核退寫入失敗', {
      request_id: requestId,
      row_id: rowId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(returnTo, 'amount_review_error');
  }
  if (outcome.kind === 'denied') redirectWith(returnTo, 'amount_review_denied');
  if (outcome.kind === 'rejected') {
    // RPC 的人話(版本不符 / 已是終態 / 單價已相同)不進網址;log 留全文, 畫面一句。
    console.warn('[admin/orders/amount-review] RPC 拒絕', { request_id: requestId, row_id: rowId, message: outcome.message.slice(0, 200) });
    redirectWith(returnTo, 'amount_review_refused');
  }
  revalidatePath('/orders');
  // 🔴 codex C 片 must-fix:導頁要綁【真的被核 / 退的那張單】—— 表單 return_to 的 open= 可被換成別張單, 那會讓管理者以為改的是 B 而其實是 A。
  //    RPC 回 order_id ⇒ 這裡把 open= 覆寫成它(沒有 open= 的 return_to 照舊回列表)。
  const bound = bindOpenTo(returnTo, outcome.orderId);
  // 🔴 20260915130000 第 2 代:同是 rejected, 系統自動退回(單子在提案後被改過)不能印「退回了, 員工看得到你的理由」—— 那不是管理者退的。
  const code: AmountReviewResultCode | null =
    outcome.status === 'rejected' && outcome.result === 'stale_rejected' ? 'amount_review_stale'
      : outcome.status === 'rejected' && outcome.result === 'blocked_rejected' ? 'amount_review_blocked'
      : outcome.status === 'approved' ? 'amount_review_approved'
      : outcome.status === 'rejected' ? 'amount_review_rejected'
        : outcome.status === 'superseded' ? 'amount_review_superseded'
          : null;
  if (code === null) {
    console.error('[admin/orders/amount-review] RPC 回了不認得的 status', { request_id: requestId, status: outcome.status });
    redirectWith(bound, 'amount_review_error');
  }
  redirectWith(bound, code);
}

