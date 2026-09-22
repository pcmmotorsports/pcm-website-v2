import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isItemSwapRejectReason, type ItemSwapRejectReason } from './item-swap-state';

// item-swap-repository.ts — 呼叫資料庫函式 `admin_swap_order_item`(migration 20260922100000)。
// 同一交易刪 A 品項列、新增 B 品項列;是否能換全部由函式判斷, 這裡只把回傳收斂成固定的幾種結果。

export type ItemSwapOutcome =
  | { kind: 'swapped'; newItemId: string }
  /** 同一個操作編號、同樣內容重送 ⇒ 函式回上次的結果, 沒有再動任何資料。 */
  | { kind: 'idempotent'; newItemId: string }
  | { kind: 'conflict' }
  | { kind: 'noop' }
  | { kind: 'rejected'; reason: ItemSwapRejectReason }
  | { kind: 'denied' };

/** 函式對「不是在職員工」的固定訊息(同其他後台寫入函式)。 */
const STAFF_GATE_MESSAGE = '無權執行此操作';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapItemSwapOutcome(data: unknown, error: unknown): ItemSwapOutcome {
  if (error) {
    const e = error as { code?: unknown; message?: unknown };
    if (e.code === 'P0001' && typeof e.message === 'string' && e.message.includes(STAFF_GATE_MESSAGE)) {
      return { kind: 'denied' };
    }
    throw error;
  }
  const o = data as Record<string, unknown> | null;
  if (o === null || typeof o !== 'object' || typeof o.result !== 'string') {
    throw new Error('admin_swap_order_item 回傳形狀不對(缺 result)');
  }
  switch (o.result) {
    case 'swapped':
    case 'idempotent':
      // 🔴 不是合法的品項編號 ⇒ 當成結果不明(丟錯), 不顯示「已更換」。
      if (typeof o.new_item_id !== 'string' || !UUID_RE.test(o.new_item_id)) {
        throw new Error(`admin_swap_order_item 回 ${o.result} 卻沒有合法的 new_item_id`);
      }
      return { kind: o.result, newItemId: o.new_item_id };
    case 'conflict':
      return { kind: 'conflict' };
    case 'noop':
      return { kind: 'noop' };
    case 'rejected':
      // 🔴 不認得的代碼當成錯誤, 不猜成某一種拒絕 —— 猜錯會給員工錯的下一步。
      if (!isItemSwapRejectReason(o.reason)) throw new Error(`admin_swap_order_item 回了不認得的拒絕代碼:${String(o.reason)}`);
      return { kind: 'rejected', reason: o.reason };
    default:
      throw new Error(`admin_swap_order_item 回了不認得的 result:${o.result}`);
  }
}

export async function swapOrderItemViaRpc(args: {
  orderId: string;
  itemId: string;
  expectedVersion: number;
  newVariantId: string;
  actorId: string;
  requestId: string;
}): Promise<ItemSwapOutcome> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_swap_order_item', {
    p_actor: args.actorId,
    p_request_id: args.requestId,
    p_order_id: args.orderId,
    p_item_id: args.itemId,
    p_expected_order_version: args.expectedVersion,
    p_new_variant_id: args.newVariantId,
  });
  return mapItemSwapOutcome(data, error);
}
