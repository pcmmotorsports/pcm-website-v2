import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
// rpc(...) 回一個帶 abortSignal() 的 builder(同 supabase-js);m.rpc 決定那個 promise 的結果
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    rpc: (fn: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => m.rpc(fn, args, signal) }),
  }),
}));

import { recentAddresses, saveManualOrderAddress } from './manual-order-address';

// manual-order-address.test.ts — 後台手動建單的地址存進 / 讀出客人地址簿(20260927120000)。

beforeEach(() => vi.clearAllMocks());

describe('saveManualOrderAddress', () => {
  it('呼叫 admin_save_manual_order_address, 參數原樣', async () => {
    m.rpc.mockResolvedValue({ data: 'INSERTED', error: null });
    expect(await saveManualOrderAddress('o-1', 'alice', 'req-1')).toEqual({ ok: true, result: 'INSERTED' });
    expect(m.rpc).toHaveBeenCalledWith(
      'admin_save_manual_order_address',
      { p_order_id: 'o-1', p_actor: 'alice', p_request_id: 'req-1' },
      expect.any(AbortSignal),
    );
  });

  it('🔴 資料庫回錯或丟錯 ⇒ ok false(不往外丟:訂單已經成立, 不能讓建單看起來失敗)', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await saveManualOrderAddress('o-1', 'alice', 'req-1')).ok).toBe(false);
    m.rpc.mockRejectedValue(new Error('network'));
    expect((await saveManualOrderAddress('o-1', 'alice', 'req-1')).ok).toBe(false);
  });

  it('回傳值不認得 ⇒ ok false', async () => {
    m.rpc.mockResolvedValue({ data: 'WHAT', error: null });
    expect((await saveManualOrderAddress('o-1', 'alice', 'req-1')).ok).toBe(false);
  });
});

describe('Codex R1 必修 3:存地址卡住不能讓建單一直等', () => {
  it('🔴 5 秒沒回應 ⇒ 中止請求、回 ok false(不再等)', async () => {
    vi.useFakeTimers();
    try {
      m.rpc.mockImplementation(
        (_fn: string, _args: unknown, signal: AbortSignal) =>
          new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      );
      let settled = false;
      const pending = saveManualOrderAddress('o-1', 'alice', 'req-1').finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(settled).toBe(false); // 真的在等那個請求, 不是當場回
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('recentAddresses:最近用過的在最前面', () => {
  const a = (id: string, line: string, updatedAt: string, over: object = {}) => ({
    id,
    name: '張保元',
    phone: '0922129301',
    line,
    isDefault: false,
    updatedAt,
    ...over,
  });

  it('依 updatedAt 新到舊;只留姓名電話地址與 id', () => {
    const out = recentAddresses([
      a('1', '舊地址', '2026-09-01T00:00:00Z'),
      a('2', '新地址', '2026-09-27T00:00:00Z'),
    ] as never);
    expect(out.map((x) => x.line)).toEqual(['新地址', '舊地址']);
    expect(Object.keys(out[0]!).sort()).toEqual(['id', 'line', 'name', 'phone']);
  });

  it('時間相同 ⇒ 用 id 排, 每次一樣;不截斷(Codex R1 建議:不要靜靜只給 10 筆)', () => {
    const same = '2026-09-27T00:00:00Z';
    const many = Array.from({ length: 15 }, (_, i) => a(String(100 + i), `地址${i}`, same));
    const out = recentAddresses(many as never);
    expect(out.length).toBe(15);
    expect(out.map((x) => x.id)).toEqual([...out.map((x) => x.id)].sort());
  });

  it('地址是空的不列(前台舊資料可能有)', () => {
    expect(recentAddresses([a('1', '  ', '2026-09-27T00:00:00Z')] as never)).toEqual([]);
  });
});
