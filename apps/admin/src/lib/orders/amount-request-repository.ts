import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// amount-request-repository.ts — M-4b-03 改金額審核:員工提 / 管理者核退 兩支 RPC + 這張單的申請列表(唯讀直讀表)。
// 🔴 形狀抄 `item-costs-repository.ts`:LooseClient、RPC 錯誤三分(denied / rejected / throw)、讀失敗標旗不當 0。
// 🔴 金額只在 RPC 裡動;這裡不算錢、不改單。

type LooseQuery = {
  eq(col: string, value: string): LooseQuery;
  neq(col: string, value: string): LooseQuery;
  order(col: string, opts: { ascending: boolean }): LooseQuery;
  limit(n: number): LooseQuery;
} & Promise<{ data: unknown; error: unknown }>;
type LooseClient = {
  from(table: string): { select(cols: string): LooseQuery };
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<{ data: unknown; error: unknown }>;
};

function client(): LooseClient {
  return createSupabaseServiceClient() as unknown as LooseClient;
}

export type AmountRequestStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export type OrderAmountRequest = {
  id: string;
  orderId: string;
  orderItemId: string;
  expectedVersion: number;
  fromUnitPrice: number;
  toUnitPrice: number;
  zeroPriceReason: string | null;
  reason: string;
  status: AmountRequestStatus;
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

const REQUEST_SELECT =
  'id, order_id, order_item_id, expected_version, from_unit_price, to_unit_price, zero_price_reason, reason, status, requested_by, requested_at, reviewed_by, reviewed_at, review_note';

const STATUSES: readonly AmountRequestStatus[] = ['pending', 'approved', 'rejected', 'superseded'];

function toRow(r: unknown): OrderAmountRequest | null {
  const o = r as Record<string, unknown>;
  if (typeof o !== 'object' || o === null) return null;
  if (
    typeof o.id !== 'string' || typeof o.order_id !== 'string' || typeof o.order_item_id !== 'string' ||
    typeof o.expected_version !== 'number' || typeof o.from_unit_price !== 'number' || typeof o.to_unit_price !== 'number' ||
    typeof o.reason !== 'string' || typeof o.status !== 'string' || !(STATUSES as readonly string[]).includes(o.status) ||
    typeof o.requested_by !== 'string' || typeof o.requested_at !== 'string'
  ) {
    return null;
  }
  return {
    id: o.id,
    orderId: o.order_id,
    orderItemId: o.order_item_id,
    expectedVersion: o.expected_version,
    fromUnitPrice: o.from_unit_price,
    toUnitPrice: o.to_unit_price,
    zeroPriceReason: typeof o.zero_price_reason === 'string' ? o.zero_price_reason : null,
    reason: o.reason,
    status: o.status as AmountRequestStatus,
    requestedBy: o.requested_by,
    requestedAt: o.requested_at,
    reviewedBy: typeof o.reviewed_by === 'string' ? o.reviewed_by : null,
    reviewedAt: typeof o.reviewed_at === 'string' ? o.reviewed_at : null,
    reviewNote: typeof o.review_note === 'string' ? o.review_note : null,
  };
}

export type OrderAmountRequestsRead = { rows: OrderAmountRequest[]; readFailed: boolean; historyTruncated: boolean };

/** 歷史(終態)列最多拉幾條;pending 不受此限(另一發查全)。 */
export const AMOUNT_REQUEST_HISTORY_LIMIT = 50;

/**
 * 這張單的申請:pending【全部】(codex R1 must-fix:不能讓歷史列把待審擠出回傳上限 —— 擠掉的話員工被 RPC 拒、管理者看不到)
 * + 終態最新 N 條(`historyTruncated` 標出有被截)。讀失敗 ⇒ `readFailed`(畫面要說「讀不到」, 不當「沒有申請」)。
 */
export async function listOrderAmountRequests(orderId: string): Promise<OrderAmountRequestsRead> {
  const parse = (data: unknown): OrderAmountRequest[] => {
    if (!Array.isArray(data)) throw new Error('order_amount_requests 回的不是陣列');
    return data.map((r) => {
      const row = toRow(r);
      if (row === null) throw new Error('order_amount_requests 有一列形狀不對');
      return row;
    });
  };
  try {
    const pending = await client().from('order_amount_requests').select(REQUEST_SELECT).eq('order_id', orderId).eq('status', 'pending').order('requested_at', { ascending: false });
    if (pending.error) throw pending.error;
    const history = await client()
      .from('order_amount_requests')
      .select(REQUEST_SELECT)
      .eq('order_id', orderId)
      .neq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(AMOUNT_REQUEST_HISTORY_LIMIT + 1);
    if (history.error) throw history.error;
    const hist = parse(history.data);
    return {
      rows: [...parse(pending.data), ...hist.slice(0, AMOUNT_REQUEST_HISTORY_LIMIT)],
      readFailed: false,
      historyTruncated: hist.length > AMOUNT_REQUEST_HISTORY_LIMIT,
    };
  } catch (e) {
    console.error('[admin/orders] 改金額申請讀取失敗(畫面標「讀不到」, 不當「沒有申請」)', e);
    return { rows: [], readFailed: true, historyTruncated: false };
  }
}

const MANAGER_GATE_MESSAGE = '無權執行此操作';

export type AmountRequestOutcome =
  | { kind: 'ok'; requestRowId: string; status: string; orderId: string }
  | { kind: 'denied' }
  | { kind: 'rejected'; message: string };

function mapOutcome(data: unknown, error: unknown): AmountRequestOutcome {
  if (error) {
    const e = error as { code?: unknown; message?: unknown };
    const message = typeof e.message === 'string' ? e.message : '';
    if (e.code === 'P0001' && message.includes(MANAGER_GATE_MESSAGE)) return { kind: 'denied' };
    if (e.code === 'P0001') return { kind: 'rejected', message };
    throw error;
  }
  const o = data as Record<string, unknown> | null;
  if (o === null || typeof o !== 'object' || typeof o.request_row_id !== 'string' || typeof o.status !== 'string' || typeof o.order_id !== 'string') {
    throw new Error('RPC 回傳形狀不對(缺 request_row_id / status / order_id)');
  }
  return { kind: 'ok', requestRowId: o.request_row_id, status: o.status, orderId: o.order_id };
}

/** 員工提「這一項改成多少、為什麼」。不改任何金額。 */
export async function requestOrderItemAmountViaRpc(args: {
  orderId: string;
  orderItemId: string;
  expectedVersion: number;
  toUnitPrice: number;
  zeroPriceReason: string | null;
  reason: string;
  actorId: string;
  requestId: string;
}): Promise<AmountRequestOutcome> {
  const { data, error } = await client().rpc('admin_request_order_item_amount', {
    p_order_id: args.orderId,
    p_order_item_id: args.orderItemId,
    p_expected_version: args.expectedVersion,
    p_to_unit_price: args.toUnitPrice,
    p_zero_price_reason: args.zeroPriceReason,
    p_reason: args.reason,
    p_actor: args.actorId,
    p_request_id: args.requestId,
  });
  return mapOutcome(data, error);
}

/** 管理者核 / 退。approve 時 RPC 內部同交易走既有 admin_update_order_item_amount。 */
export async function reviewOrderItemAmountViaRpc(args: {
  requestRowId: string;
  decision: 'approve' | 'reject';
  reviewNote: string | null;
  actorId: string;
  requestId: string;
}): Promise<AmountRequestOutcome> {
  const { data, error } = await client().rpc('admin_review_order_item_amount', {
    p_request_row_id: args.requestRowId,
    p_decision: args.decision,
    p_review_note: args.reviewNote,
    p_actor: args.actorId,
    p_request_id: args.requestId,
  });
  return mapOutcome(data, error);
}
