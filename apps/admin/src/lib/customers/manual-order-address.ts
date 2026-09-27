import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { CustomerAddress } from '@pcm/domain';

// manual-order-address.ts — 後台手動建單的收件地址存進 / 讀出客人地址簿(Sean 2026-08-28 Q-建單2 甲、2026-09-27 全甲)。
// plan:~/pcm-mailbox/計畫-手動建單地址存進客人地址簿-20260927.md
// 🔴 寫入只走 RPC admin_save_manual_order_address(20260927120000):地址簿上沒有給 service_role 的寫入政策
//    (20260905190000 b9-RLSHARDEN),不在 app 層直接寫表;RPC 同交易寫稽核。
// 🔴 存地址失敗【不往外丟】:呼叫時訂單已經成立,讓建單看起來失敗會讓員工重送(雖然冪等,但會以為沒建成)。

export type SaveManualOrderAddressResult = 'INSERTED' | 'EXISTS' | 'SKIPPED' | 'NOT_FOUND';
const RESULTS: ReadonlySet<string> = new Set(['INSERTED', 'EXISTS', 'SKIPPED', 'NOT_FOUND']);

export async function saveManualOrderAddress(
  orderId: string,
  actor: string,
  requestId: string,
): Promise<{ ok: true; result: SaveManualOrderAddressResult } | { ok: false }> {
  try {
    const { data, error } = await createSupabaseServiceClient().rpc('admin_save_manual_order_address', {
      p_order_id: orderId,
      p_actor: actor,
      p_request_id: requestId,
    });
    if (error) {
      console.error('[admin/manual-order] 收件地址存進客人地址簿失敗', { orderId, message: error.message });
      return { ok: false };
    }
    if (typeof data !== 'string' || !RESULTS.has(data)) {
      console.error('[admin/manual-order] 收件地址存進客人地址簿回傳不認得', { orderId, data });
      return { ok: false };
    }
    return { ok: true, result: data as SaveManualOrderAddressResult };
  } catch (error) {
    console.error('[admin/manual-order] 收件地址存進客人地址簿失敗', { orderId, error });
    return { ok: false };
  }
}

/** 收件區「從地址簿選」要的欄位。 */
export interface AddressChoice {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly line: string;
}

/** 地址簿 ⇒ 最近用過的在最前面(RPC 在「同一個地址又用了一次」時會更新 updated_at)。地址空的不列。 */
export function recentAddresses(list: readonly CustomerAddress[], limit = 10): AddressChoice[] {
  return [...list]
    .filter((a) => a.line.trim() !== '')
    .sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0))
    .slice(0, limit)
    .map((a) => ({ id: a.id, name: a.name, phone: a.phone, line: a.line }));
}
