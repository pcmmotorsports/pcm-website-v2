import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ILineRecipientReader, LineRecipientResult } from '@pcm/ports';
import type { Database } from '../supabase/database.types';

export type LineRecipientClient = SupabaseClient<Database>;

/**
 * ⟦line-PUSH⟧ 寄送當下「這張單的客人現在能不能收 LINE」。
 * 形狀逐字照 `SupabaseOrderCurrentRecipientAdapter`(orders → customers embed 經 `customer_user_id` FK)。
 * 🔴 `line_user_id` / `line_friend_at` 是 B 窗 S1(`20260914040000`)加的欄;`database.types` 還沒 regen
 *    ⇒ select 字串用 `as never`。**S1 沒貼時這一支回 `unavailable`**(PostgREST 400)⇒ 呼叫端 fail-closed 不推。
 * 🛑 兩欄都要非空才算好友:`unfollow` 只清 `line_friend_at`、留 `line_user_id`(plan §1-2)。
 */
export class SupabaseLineRecipientAdapter implements ILineRecipientReader {
  constructor(private readonly client: LineRecipientClient) {}

  async getLineRecipient(input: { orderId: string }): Promise<LineRecipientResult> {
    let outcome: { data: unknown[] | null; error: unknown };
    try {
      outcome = await this.client
        .from('orders' as never)
        .select('customers(line_user_id, line_friend_at)' as never)
        .eq('id', input.orderId)
        .limit(1);
    } catch {
      return { kind: 'unavailable' };
    }
    if (outcome.error !== null && outcome.error !== undefined) {
      return { kind: 'unavailable' };
    }
    type C = { line_user_id: string | null; line_friend_at: string | null };
    const rows = (outcome.data ?? []) as Array<{ customers: C | C[] | null }>;
    const row = rows[0];
    if (row === undefined) return { kind: 'unavailable' };
    const c = Array.isArray(row.customers) ? (row.customers[0] ?? null) : row.customers;
    const userId = c?.line_user_id ?? null;
    const friendAt = c?.line_friend_at ?? null;
    if (userId === null || userId.trim() === '' || friendAt === null) return { kind: 'not_friend' };
    return { kind: 'friend', lineUserId: userId };
  }
}
