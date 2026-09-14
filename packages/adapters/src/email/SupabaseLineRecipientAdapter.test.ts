import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { SupabaseLineRecipientAdapter } from './SupabaseLineRecipientAdapter';

// ⟦line-PUSH⟧ 形狀照 `SupabaseOrderCurrentRecipientAdapter.test.ts`(同一種 embed 查詢)。
function client(result: { data: unknown[] | null; error?: unknown; throws?: boolean }) {
  const limit = vi.fn(async () => {
    if (result.throws === true) throw new Error('boom');
    return { data: result.data, error: result.error ?? null };
  });
  const eq = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { c: { from } as never, from, select, eq };
}
const run = (r: Parameters<typeof client>[0]) =>
  new SupabaseLineRecipientAdapter(client(r).c).getLineRecipient({ orderId: 'o1' });

describe('SupabaseLineRecipientAdapter', () => {
  it('🔴 兩欄都有 ⇒ friend + userId;好友時間空(unfollow 清掉)⇒ not_friend;userId 空 ⇒ not_friend', async () => {
    await expect(run({ data: [{ customers: { line_user_id: 'Uabc', line_friend_at: '2026-09-14T00:00:00Z' } }] }))
      .resolves.toEqual({ kind: 'friend', lineUserId: 'Uabc' });
    await expect(run({ data: [{ customers: { line_user_id: 'Uabc', line_friend_at: null } }] }))
      .resolves.toEqual({ kind: 'not_friend' });
    await expect(run({ data: [{ customers: { line_user_id: null, line_friend_at: '2026-09-14T00:00:00Z' } }] }))
      .resolves.toEqual({ kind: 'not_friend' });
    await expect(run({ data: [{ customers: null }] })).resolves.toEqual({ kind: 'not_friend' });
  });

  it('🔵 embed 回陣列的環境也讀得到(to-one 有些版本回陣列)', async () => {
    await expect(run({ data: [{ customers: [{ line_user_id: 'U1', line_friend_at: 't' }] }] }))
      .resolves.toEqual({ kind: 'friend', lineUserId: 'U1' });
  });

  it('🔴 查無那一列 / error(S1 沒貼 = 欄不存在)/ throw ⇒ unavailable,不是 not_friend', async () => {
    await expect(run({ data: [] })).resolves.toEqual({ kind: 'unavailable' });
    await expect(run({ data: null, error: { code: '42703' } })).resolves.toEqual({ kind: 'unavailable' });
    await expect(run({ data: null, throws: true })).resolves.toEqual({ kind: 'unavailable' });
  });

  it('🔴 查的是 orders 經 customer_user_id embed 的那兩欄、eq id', async () => {
    const k = client({ data: [] });
    await new SupabaseLineRecipientAdapter(k.c).getLineRecipient({ orderId: 'o9' });
    expect(k.from).toHaveBeenCalledWith('orders');
    expect(k.select).toHaveBeenCalledWith('customers(line_user_id, line_friend_at)');
    expect(k.eq).toHaveBeenCalledWith('id', 'o9');
  });
});
