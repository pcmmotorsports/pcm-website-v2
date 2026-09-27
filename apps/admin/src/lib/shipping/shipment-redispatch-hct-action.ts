'use server';

// shipment-redispatch-hct-action.ts —— 「新竹說沒派到車：重新叫車」(2026-09-28 出貨流程乙第 8 項;migration 20260928010000)。
// 計畫 ~/pcm-mailbox/計畫-後台出貨流程乙-20260927.md 第二節第 8 項。
//
// 順序與第一次叫車相同(見 shipment-dispatch-hct-action.ts 檔頭):① 佔位 ⇒ ② 叫車 ⇒ ③ 記結果 ⇒ ④ 標出貨。
// 差別只在佔位:用 `admin_claim_hct_redispatch`, 由資料庫判「上一次叫車已超過 10 分鐘、次數沒變、訂單可以出」,
// 每一次叫車記一列(shipment_hct_dispatch_attempts), 標出貨的重試鍵綁那一列 ⇒ 同一次不會標兩遍。
// 🛑 佔位被拒就不往下打;③ 失敗不吞;不確定就留著「叫車結果未確認」, 員工可以在 10 分鐘後再判斷一次。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { toMessage } from './error-message';
import { auditLog, NO_ACTOR_MESSAGE } from './shipment-action-audit';
import { getDispatchShipment, markShipmentShipped } from './shipment-repository';
import { claimHctRedispatch, recordHctRedispatch } from './hct-redispatch-repository';
import { dispatchOrder, hctDispatchGateOpen } from './hct-client';
import { dispatchedButUnrecordedMessage, planFromDispatch, uncertainDispatchMessage } from './hct-dispatch-flow';
import type { DispatchActionResult } from './shipment-dispatch-hct-action';

const DISPATCH_SEND_DEADLINE_MS = 30_000;

export async function redispatchShipmentAction(args: {
  shipmentId: string;
  /** 畫面上看到的「最後一次是第幾次」。資料庫比對不同就拒絕(別人剛叫過)。 */
  expectedAttemptNo: number;
}): Promise<DispatchActionResult> {
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, kind: 'error', message: NO_ACTOR_MESSAGE };
  auditLog('shipment.hct_redispatch', auth, 'attempt', { shipment_id: args.shipmentId });
  const fail = (r: DispatchActionResult): DispatchActionResult => {
    auditLog('shipment.hct_redispatch', auth, 'fail', { shipment_id: args.shipmentId });
    return r;
  };

  try {
    const endpoint = (process.env.HCT_API_ENDPOINT ?? '').trim();
    const account = (process.env.HCT_API_ACCOUNT ?? '').trim();
    const password = (process.env.HCT_API_PASSWORD ?? '').trim();
    const emark = (process.env.HCT_DISPATCH_EMARK ?? '').trim();
    if (!hctDispatchGateOpen() || endpoint === '' || account === '' || password === '' || emark === '') {
      return fail({ ok: false, kind: 'disabled', message: '新竹物流叫車功能尚未開通或設定不完整，這一箱沒有送出叫車。請聯絡系統管理員。' });
    }

    const row = await getDispatchShipment(args.shipmentId);
    if (row === null) return fail({ ok: false, kind: 'error', message: '找不到這一箱，請重新整理頁面。' });
    const uncertain =
      row.carrierCode === 'hct' &&
      !row.voidedAt &&
      !row.shippedAt &&
      !!row.hctDispatchAttemptedAt &&
      !row.hctDispatchedAt;
    if (!uncertain) {
      return fail({ ok: false, kind: 'rejected', message: '這一箱不是「叫車結果未確認」，不能重新叫車。請重新整理頁面。' });
    }
    const edelno = row.hctRequestId ?? '';

    // ── ① 佔位。丟例外 = 資料庫不准 ⇒ 不往下打, 把原因給員工。
    const claimStartedAt = Date.now();
    let attemptId: string;
    try {
      attemptId = await claimHctRedispatch({
        shipmentReference: row.shipmentReference,
        edelno,
        expectedAttemptNo: args.expectedAttemptNo,
        actor: auth.actorId,
      });
    } catch (e) {
      return fail({ ok: false, kind: 'rejected', message: `沒有重新叫車：${toMessage(e)}` });
    }

    if (Date.now() - claimStartedAt > DISPATCH_SEND_DEADLINE_MS) {
      return fail({
        ok: false,
        kind: 'needs_human',
        message: '這次沒有送出叫車：系統在送出前等太久。這一箱仍是「叫車結果未確認」，10 分鐘後可以再判斷一次。（send_deadline）',
      });
    }

    // ── ② 叫車。
    const out = await dispatchOrder({ fetchImpl: fetch, endpoint, account, password }, [{ epino: row.shipmentReference, edelno }], emark);
    const plan = planFromDispatch(out);
    if (plan.kind === 'disabled') {
      return fail({ ok: false, kind: 'needs_human', message: '這次沒有送出叫車：叫車功能在送出前被關閉。請聯絡系統管理員。' });
    }
    if (plan.kind === 'all_unknown') {
      return fail({ ok: false, kind: 'needs_human', message: uncertainDispatchMessage(edelno, '系統看不懂新竹的回覆', plan.reason) });
    }
    const only = plan.rows[0];
    if (only === undefined) {
      return fail({ ok: false, kind: 'needs_human', message: uncertainDispatchMessage(edelno, '新竹沒有回傳這一箱的結果', null) });
    }
    if (only.action === 'leave_alone') {
      return fail({ ok: false, kind: 'rejected', message: `新竹物流拒絕了這次叫車，車沒有叫到（原因：${only.message}）。請聯絡系統管理員處理。` });
    }
    if (only.action === 'needs_human') {
      return fail({ ok: false, kind: 'needs_human', message: uncertainDispatchMessage(edelno, '系統看不懂新竹回傳的這一箱結果', only.reason) });
    }

    // ── ③ 記結果(不吞)⇒ ④ 標出貨(寄信在它下游)。失敗要說「車已叫到、不要重新叫車」(R1 Fable 建議)。
    try {
      await recordHctRedispatch({ attemptId, edelno: only.edelno });
      await markShipmentShipped({
        idempotencyKey: `redispatch:${attemptId}`,
        shipmentId: args.shipmentId,
        trackingNumber: only.edelno,
        actor: auth.actorId,
        requestId: await (await import('../audit/context')).getRequestId(),
      });
    } catch (e) {
      return fail({ ok: false, kind: 'needs_human', message: dispatchedButUnrecordedMessage(only.edelno, toMessage(e)) });
    }
    revalidatePath('/shipments');
    revalidatePath('/orders');
    auditLog('shipment.hct_redispatch', auth, 'ok', { shipment_id: args.shipmentId, has_tracking_number: true });
    return { ok: true, kind: 'dispatched', edelno: only.edelno };
  } catch (e) {
    return fail({ ok: false, kind: 'error', message: toMessage(e) });
  }
}
