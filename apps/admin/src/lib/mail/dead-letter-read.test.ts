import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import { DEAD_LETTER_MAX_ROWS, listDeadLetters } from './dead-letter-read';

// dead-letter-read.test.ts — ⟦b4-MAILDEAD⟧ 讀取層。
//
// 🔴 **本檔最承重的是「零 PII」那一格**,而它是**架構閘**不是行為測試:
//    它釘住 select 字串裡**沒有** recipient_email / payload / subject。
//    ⇒ 有人日後「順手多撈一欄好顯示」時,那一格會紅 —— 而**沒有任何其他東西會紅**
//      (多撈一欄不會壞任何功能,畫面也不會變,除非有人刻意去印它)。

function makeClient(result: { data: unknown; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const inFn = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ in: inFn });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select, inFn, order, limit };
}

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'aa',
    order_id: 'oo',
    event_type: 'order_shipped',
    status: 'failed',
    attempts: 5,
    max_attempts: 5,
    last_error_code: 'provider_error',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => createSupabaseServiceClient.mockReset());

describe('listDeadLetters', () => {
  it('should keep every pending row and mark which ones are dead', async () => {
    // 🔴 **這一格 2026-09-01 換過方向**(codex R1 must-fix 4)。
    //    ⛔ ~~原本驗「未耗盡的列被篩掉」~~ —— 而那個篩發生在 `.limit(50)` **之後**
    //    ⇒ 前 50 列都是未耗盡時,畫面會印「目前沒有」**而其實有**。
    //    ✅ 改成:一列都不丟,每列自己標 `isDead`;鈕由頁面依那個旗標決定。
    const c = makeClient({
      data: [row({ id: 'dead', attempts: 5, max_attempts: 5 }), row({ id: 'alive', attempts: 2, max_attempts: 5 })],
      error: null,
    });
    createSupabaseServiceClient.mockReturnValue(c.client);

    const res = await listDeadLetters();

    // 🟢 兩種列都要在(少了這格,一個「又篩回去」的實作會靜默通過)。
    expect(res.rows.map((r) => r.id)).toEqual(['dead', 'alive']);
    // 🔴 而標記要分得出來 —— 這是那顆鈕唯一的依據。
    expect(res.rows.map((r) => r.isDead)).toEqual([true, false]);
    expect(res.loadFailed).toBe(false);
  });

  it('should never select PII columns', async () => {
    const c = makeClient({ data: [], error: null });
    createSupabaseServiceClient.mockReturnValue(c.client);

    await listDeadLetters();

    const selected = String(c.select.mock.calls[0]?.[0] ?? '');
    // 🔴 這三欄的建表註解寫著它們可含 PII;而那支 RPC 的回傳也刻意不含它們。
    expect(selected).not.toContain('recipient_email');
    expect(selected).not.toContain('payload');
    expect(selected).not.toContain('subject');
    // 🟢 正對照:尺不是恆綠 —— 該在的欄位要真的在。
    expect(selected).toContain('order_id');
    expect(selected).toContain('last_error_code');
  });

  it('should report truncation instead of silently dropping rows', async () => {
    const many = Array.from({ length: DEAD_LETTER_MAX_ROWS + 1 }, (_, i) => row({ id: `d${i}` }));
    const c = makeClient({ data: many, error: null });
    createSupabaseServiceClient.mockReturnValue(c.client);

    const res = await listDeadLetters();

    expect(res.truncated).toBe(true);
    expect(res.rows).toHaveLength(DEAD_LETTER_MAX_ROWS);
  });

  it('should keep "read failed" distinguishable from "nothing is wrong"', async () => {
    // 🔴 這兩個世界在畫面上長得一樣(都是空清單)—— 而一個是好消息、一個是我們壞了。
    const failed = makeClient({ data: null, error: { message: 'boom' } });
    createSupabaseServiceClient.mockReturnValue(failed.client);
    expect((await listDeadLetters()).loadFailed).toBe(true);

    const empty = makeClient({ data: [], error: null });
    createSupabaseServiceClient.mockReturnValue(empty.client);
    const res = await listDeadLetters();
    expect(res.loadFailed).toBe(false);
    expect(res.rows).toHaveLength(0);
  });
});
