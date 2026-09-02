import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import { DEAD_LETTER_SCAN_CAP, loadDeadLetterCount } from './dead-letter-count-read';

// dead-letter-count-read.test.ts — ⟦f3-DEADLETTERCOUNT⟧。
//
// 🔴 **本檔最承重的兩格都不是「數對了」,是【兩個世界要印不同的東西】**:
//    ① `total` 來自 DB 的 `count`,`dead` 來自本地比對 ⇒ **兩個來源**
//       ⇒ 超過 SCAN_CAP 時 `dead` 是下界,而 `deadExact` 必須跟著變 false。
//    ② 讀不到時**不可以印 0** —— 那會把「我們壞了」印成「一封都沒有」。

function makeClient(result: { data: unknown; error: unknown; count: number | null }) {
  const limit = vi.fn().mockResolvedValue(result);
  const inFn = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ in: inFn });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select, inFn, limit };
}

function row(attempts: number, maxAttempts: number) {
  return { attempts, max_attempts: maxAttempts };
}

beforeEach(() => createSupabaseServiceClient.mockReset());

describe('loadDeadLetterCount', () => {
  it('should count only rows whose attempts have run out', async () => {
    const { client } = makeClient({
      data: [row(5, 5), row(1, 5), row(6, 5), row(4, 5)],
      error: null,
      count: 4,
    });
    createSupabaseServiceClient.mockReturnValue(client);

    const res = await loadDeadLetterCount();

    expect(res.total).toBe(4);
    // 5>=5 與 6>=5 算,1 與 4 不算 —— 判準與 dead-letter-read.ts:93 逐字同一條。
    expect(res.dead).toBe(2);
    expect(res.deadExact).toBe(true);
    expect(res.unreadableReason).toBeNull();
  });

  it('should take total from the database, not from the rows it fetched', async () => {
    // 🔴 這一格是本片存在的理由:撈回來的列數被 SCAN_CAP 蓋住,而 total 沒有。
    //    若有人日後改成 `rows.length`,只有這一格會紅。
    const { client } = makeClient({
      data: [row(5, 5), row(5, 5)],
      error: null,
      count: 4321,
    });
    createSupabaseServiceClient.mockReturnValue(client);

    const res = await loadDeadLetterCount();

    expect(res.total).toBe(4321);
    expect(res.total).not.toBe(2);
  });

  it('should say the dead count is not exact once the scan cap is passed', async () => {
    // 🔴 **一個被截斷的數字若印得像精確值,它就是下一件事故。**
    const { client } = makeClient({
      data: [row(5, 5)],
      error: null,
      count: DEAD_LETTER_SCAN_CAP + 1,
    });
    createSupabaseServiceClient.mockReturnValue(client);

    expect((await loadDeadLetterCount()).deadExact).toBe(false);
  });

  it('should still call the dead count exact when the total sits exactly on the cap', async () => {
    // 邊界:`total <= CAP` ⇒ 撈得完 ⇒ 精確。差一格就會把一個精確的數字標成不精確。
    const { client } = makeClient({ data: [row(5, 5)], error: null, count: DEAD_LETTER_SCAN_CAP });
    createSupabaseServiceClient.mockReturnValue(client);

    expect((await loadDeadLetterCount()).deadExact).toBe(true);
  });

  it('should ask the database for an exact count and cap what it drags back', async () => {
    // 架構閘,不是行為測試:釘住「有要 count」與「有上限」。
    // ⇒ 有人日後拿掉 `{ count: 'exact' }`(total 變 null)或拿掉 `.limit`(無上限撈)時,
    //   這一格會紅 —— 而畫面上兩者都看不出來。
    const { client, select, limit } = makeClient({ data: [], error: null, count: 0 });
    createSupabaseServiceClient.mockReturnValue(client);

    await loadDeadLetterCount();

    expect(select).toHaveBeenCalledWith('attempts, max_attempts', { count: 'exact' });
    expect(limit).toHaveBeenCalledWith(DEAD_LETTER_SCAN_CAP);
  });

  it('should not select any column that carries customer content', async () => {
    // 零 PII —— 抄 dead-letter-read.test.ts 那條紀律。多撈一欄不會壞任何功能,
    // 畫面也不會變 ⇒ 沒有別的東西會紅。
    const { client, select } = makeClient({ data: [], error: null, count: 0 });
    createSupabaseServiceClient.mockReturnValue(client);

    await loadDeadLetterCount();

    const cols = String(select.mock.calls[0]?.[0]);
    for (const banned of ['recipient_email', 'payload', 'subject', 'order_id']) {
      expect(cols).not.toContain(banned);
    }
  });

  it('should report unreadable rather than zero when the query fails', async () => {
    const { client } = makeClient({ data: null, error: { message: 'boom' }, count: null });
    createSupabaseServiceClient.mockReturnValue(client);

    const res = await loadDeadLetterCount();

    expect(res.unreadableReason).not.toBeNull();
    expect(res.deadExact).toBe(false);
  });

  it('should report unreadable rather than zero when the count comes back null', async () => {
    // 🔴 `count` 是 null 時印 0 ⇒ 「拿不到數字」與「一封都沒有」長一樣。
    const { client } = makeClient({ data: [row(5, 5)], error: null, count: null });
    createSupabaseServiceClient.mockReturnValue(client);

    expect((await loadDeadLetterCount()).unreadableReason).not.toBeNull();
  });

  it('should report unreadable when the query rejects', async () => {
    // 🔵 真實的失敗形狀是**查詢**炸掉(網路 / socket),不是建 client 炸掉。
    const limit = vi.fn().mockRejectedValue(new Error('network'));
    const inFn = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ in: inFn });
    createSupabaseServiceClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) });

    const res = await loadDeadLetterCount();

    expect(res.unreadableReason).not.toBeNull();
    expect(res.total).toBe(0);
  });

  it('should report unreadable when building the query throws', async () => {
    // 同一個 try 的另一半:同步丟出。
    createSupabaseServiceClient.mockReturnValue({
      from: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    });

    expect((await loadDeadLetterCount()).unreadableReason).not.toBeNull();
  });
});
