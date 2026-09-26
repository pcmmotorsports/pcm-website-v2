// 退貨收回(第 2 片):讀一張訂單的退貨紀錄。形狀照 payment/manual-refund-read.ts。
// 兩次查詢(表頭 + 品項)而不用 PostgREST 內嵌:兩表之間是複合外鍵 (return_id, order_id), 分開查最不會出意外。
// 讀取失敗一律 throw, 由訂單詳情頁收成「退貨紀錄載入失敗」, 不把讀不到當成沒有退貨。
import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { OrderReturnRow, ReturnCondition, ReturnReasonCode, ReturnStatus } from './return-view';

const RETURN_COLUMNS =
  'id, status, reason_code, reason_detail, note, return_tracking_number, registered_by, registered_at, ' +
  'received_by, received_at, receive_note, voided_by, voided_at, void_reason';
const ITEM_COLUMNS = 'return_id, order_item_id, quantity, received_quantity, condition';
/** 一張單的退貨筆數上限;真的超過代表資料異常, 直接當讀取失敗, 不顯示不完整的清單(可退數量會算錯)。 */
const ORDER_RETURNS_LIMIT = 100;

type RawReturn = {
  id: string;
  status: ReturnStatus;
  reason_code: ReturnReasonCode;
  reason_detail: string | null;
  note: string | null;
  return_tracking_number: string | null;
  registered_by: string;
  registered_at: string;
  received_by: string | null;
  received_at: string | null;
  receive_note: string | null;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
};
type RawItem = {
  return_id: string;
  order_item_id: string;
  quantity: number;
  received_quantity: number | null;
  condition: ReturnCondition | null;
};

export async function listOrderReturns(orderId: string): Promise<OrderReturnRow[]> {
  const db = createSupabaseServiceClient();
  const [heads, items] = await Promise.all([
    db
      .from('order_returns')
      .select(RETURN_COLUMNS)
      .eq('order_id', orderId)
      .order('registered_at', { ascending: false })
      .limit(ORDER_RETURNS_LIMIT + 1),
    db.from('order_return_items').select(ITEM_COLUMNS).eq('order_id', orderId).limit(ORDER_RETURNS_LIMIT * 50),
  ]);
  if (heads.error) throw heads.error;
  if (items.error) throw items.error;
  const rawHeads = heads.data as unknown as RawReturn[];
  if (rawHeads.length > ORDER_RETURNS_LIMIT) throw new Error(`order_returns 超過 ${ORDER_RETURNS_LIMIT} 筆`);
  const byReturn = new Map<string, OrderReturnRow['items']>();
  for (const it of items.data as unknown as RawItem[]) {
    const list = byReturn.get(it.return_id) ?? byReturn.set(it.return_id, []).get(it.return_id)!;
    list.push({
      orderItemId: it.order_item_id,
      quantity: it.quantity,
      receivedQuantity: it.received_quantity,
      condition: it.condition,
    });
  }
  return rawHeads.map((r) => ({
    id: r.id,
    status: r.status,
    reasonCode: r.reason_code,
    reasonDetail: r.reason_detail,
    note: r.note,
    trackingNumber: r.return_tracking_number,
    registeredBy: r.registered_by,
    registeredAt: r.registered_at,
    receivedBy: r.received_by,
    receivedAt: r.received_at,
    receiveNote: r.receive_note,
    voidedBy: r.voided_by,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    items: byReturn.get(r.id) ?? [],
  }));
}
