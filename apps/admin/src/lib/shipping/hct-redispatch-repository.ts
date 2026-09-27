import 'server-only';

import { createSupabaseServiceClient } from '@pcm/adapters/server';

// hct-redispatch-repository.ts —— 「重新叫車」的資料庫呼叫(2026-09-28 出貨流程乙第 8 項;migration 20260928010000)。
// 🔴 那兩支函式與那張表在 `database.types.ts` 重產之前沒有型別 ⇒ 這裡用結構型別收斂回傳, 不用 `as` 硬轉結果。
//    重產型別之後, 這幾個 `as never` 就該拿掉(同 shipment-repository.ts 對 admin_record_hct_label_raw 的做法)。

/** 重新叫車的佔位。丟例外 = 資料庫拒絕(不到 10 分鐘 / 次數變了 / 訂單不能出 / 狀態不對), 呼叫端不得往下送。 */
export async function claimHctRedispatch(args: {
  shipmentReference: string;
  edelno: string;
  expectedAttemptNo: number;
  actor: string;
}): Promise<string> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_claim_hct_redispatch' as never, {
    p_shipment_reference: args.shipmentReference,
    p_edelno: args.edelno,
    p_expected_attempt_no: args.expectedAttemptNo,
    p_actor: args.actor,
  } as never);
  if (error !== null) throw new Error((error as { message: string }).message);
  if (typeof data !== 'string' || data === '') throw new Error('admin_claim_hct_redispatch 沒有回傳這一次叫車的 id');
  return data;
}

/** 記「叫到了」。同一個結果重送是冪等的。 */
export async function recordHctRedispatch(args: { attemptId: string; edelno: string }): Promise<void> {
  const { error } = await createSupabaseServiceClient().rpc('admin_record_hct_redispatch' as never, {
    p_attempt_id: args.attemptId,
    p_edelno: args.edelno,
  } as never);
  if (error !== null) throw new Error((error as { message: string }).message);
}

/**
 * 畫面用:這幾箱「最後一次叫車是第幾次、在什麼時候」。第一次叫車記在 shipments, 之後的在新表。
 * ⚠️ 這只給畫面決定要不要顯示「重新叫車」;真正的 10 分鐘與次數判準在資料庫函式裡(用資料庫的 now())。
 */
export async function listLastDispatchAttempts(
  shipmentIds: readonly string[],
): Promise<Map<string, { lastNo: number; lastAt: string }>> {
  const out = new Map<string, { lastNo: number; lastAt: string }>();
  if (shipmentIds.length === 0) return out;
  const db = createSupabaseServiceClient();
  const [first, later] = await Promise.all([
    db.from('shipments').select('id, hct_dispatch_attempted_at').in('id', [...shipmentIds]),
    db
      .from('shipment_hct_dispatch_attempts' as never)
      .select('shipment_id, attempt_no, claimed_at')
      .in('shipment_id' as never, [...shipmentIds] as never),
  ]);
  if (first.error !== null) throw new Error(first.error.message);
  if (later.error !== null) throw new Error((later.error as { message: string }).message);
  for (const r of first.data ?? []) {
    if (r.hct_dispatch_attempted_at !== null) out.set(r.id, { lastNo: 1, lastAt: r.hct_dispatch_attempted_at });
  }
  for (const r of (later.data ?? []) as unknown as { shipment_id: string; attempt_no: number; claimed_at: string }[]) {
    const cur = out.get(r.shipment_id);
    if (cur === undefined || r.attempt_no > cur.lastNo) out.set(r.shipment_id, { lastNo: r.attempt_no, lastAt: r.claimed_at });
  }
  return out;
}
