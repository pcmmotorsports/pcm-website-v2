import { beforeEach, describe, expect, it, vi } from 'vitest';

// getDisabledAccountNoticeDeps().findDisabledUserId:決定「誰會被當成停用帳號」的唯一地方(Fable Q30 R1 應修 1)。
// 判錯的後果:正常客人按忘記密碼收到「帳號已停用」、收不到重設連結。
vi.mock('server-only', () => ({}));
const q = vi.hoisted(() => ({ rows: [] as unknown[], ilike: vi.fn(), abortSignal: vi.fn() }));
vi.mock('@pcm/adapters/server', async (orig) => ({
  ...(await orig<object>()),
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        ilike: (col: string, v: string) => {
          q.ilike(col, v);
          return {
            limit: () => ({
              abortSignal: (s: AbortSignal) => {
                q.abortSignal(s);
                return Promise.resolve({ data: q.rows, error: null });
              },
            }),
          };
        },
      }),
    }),
  }),
}));
import { getDisabledAccountNoticeDeps } from './composition';

beforeEach(() => {
  q.rows = [];
  q.ilike.mockClear();
  q.abortSignal.mockClear();
});

describe('findDisabledUserId', () => {
  const find = (e: string) => getDisabledAccountNoticeDeps().findDisabledUserId(e);

  it('🔴 disabled_at 是空值(正常會員)⇒ null', async () => {
    q.rows = [{ user_id: 'u1', email: 'a@x.tw', disabled_at: null }];
    expect(await find('a@x.tw')).toBeNull();
  });

  it('已停用 ⇒ 會員 id;大小寫不同仍命中', async () => {
    q.rows = [{ user_id: 'u1', email: 'a@x.tw', disabled_at: '2026-09-26T02:00:00Z' }];
    expect(await find('A@X.tw')).toBe('u1');
  });

  it('🔴 Email 裡的 _ % 先逃逸;ilike 撈到的別人(萬用字元命中)不算', async () => {
    q.rows = [{ user_id: 'u9', email: 'aXb@x.tw', disabled_at: '2026-09-26T02:00:00Z' }];
    expect(await find('a_b@x.tw')).toBeNull();
    expect(q.ilike).toHaveBeenCalledWith('email', 'a\\_b@x.tw');
  });

  it('查詢有逾時(資料庫卡住時不讓忘記密碼一直等)', async () => {
    await find('a@x.tw');
    expect(q.abortSignal).toHaveBeenCalledTimes(1);
  });
});
