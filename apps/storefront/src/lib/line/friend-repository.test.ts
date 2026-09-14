import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn(), or: vi.fn(), select: vi.fn(), from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    from: (t: string) => {
      h.from(t);
      return { update: (v: unknown) => { h.update(v); return { eq: (c: string, x: string) => { h.eq(c, x); return { or: (f: string) => { h.or(f); return { select: h.select }; } }; } }; } };
    },
  }),
}));
import { setLineFriendAt } from './friend-repository';

// friend-repository.test.ts — 條件更新的【形狀】(S3;codex R1 must-fix:亂序重送不回寫)。
// 🔴 真正的行為(0 列 / 1 列)由拋棄式 PG 上同一條述詞背書(commit body);這裡釘的是送去 PostgREST 的查詢長什麼樣。
const U = 'U' + 'c'.repeat(32);
const T = '2026-09-14T09:05:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockResolvedValue({ data: [{ user_id: 'x' }], error: null });
});

describe('setLineFriendAt', () => {
  it('follow:update 兩欄、eq line_user_id、or(event_at is null / lte eventAt)、select;有列 ⇒ updated', async () => {
    expect(await setLineFriendAt(U, T, T)).toBe('updated');
    expect(h.from).toHaveBeenCalledWith('customers');
    expect(h.update).toHaveBeenCalledWith({ line_friend_at: T, line_friend_event_at: T });
    expect(h.eq).toHaveBeenCalledWith('line_user_id', U);
    expect(h.or).toHaveBeenCalledWith(`line_friend_event_at.is.null,line_friend_event_at.lte.${T}`);
  });
  it('unfollow:line_friend_at null、event_at 仍寫;0 列(沒客人 / 更舊的事件)⇒ skipped;error ⇒ throw', async () => {
    h.select.mockResolvedValueOnce({ data: [], error: null });
    expect(await setLineFriendAt(U, null, T)).toBe('skipped');
    expect(h.update).toHaveBeenLastCalledWith({ line_friend_at: null, line_friend_event_at: T });
    h.select.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(setLineFriendAt(U, T, T)).rejects.toMatchObject({ code: '42501' });
  });
});
