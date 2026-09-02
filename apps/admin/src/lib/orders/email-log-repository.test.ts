import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import { EmailLogShapeError, listOrderEmailLog } from './email-log-repository';
import { EMAIL_LOG_COLUMNS } from './email-log-view';

// email-log-repository.test.ts — 片A 的取數層測試。
//
// 🔴🔴 **這支檔是 R2 逼出來的, 而它的成因值得記在這裡**:
//    我原本在 repository 檔頭寫「本檔 `import 'server-only'` ⇒ 測試 import 它會爆
//    ⇒ 那條斷言裝不上去」—— 那一發爆是真的, **而它有標準解法**:
//    `vi.mock('server-only', () => ({}))`,而本 repo **早就有一大票測試檔在用它**
//    (量法見 repository 檔頭;⛔ ~~原句寫死「123 支」~~ ⇒ **本檔自己把它變成 124**)。
//    🛑 ⇒ 我撞到一個錯誤, 就把它寫成一條限制, **而我沒有先問「這個錯誤有沒有標準解法」**。
//    📌 ⇒ 一句「這裡測不了」寫在檔頭, 沒有人會回來驗它 —— 它會安靜地把整支檔擋在測試之外。

/** 一條 builder chain 的替身:`.select().eq().order().limit()` 最後 await 得到結果。 */
function mockClient(result: { data: unknown; error: unknown }) {
  const seen: { columns?: unknown; limit?: unknown } = {};
  const builder = {
    select: (c: unknown) => {
      seen.columns = c;
      return builder;
    },
    eq: () => builder,
    order: () => builder,
    limit: (n: unknown) => {
      seen.limit = n;
      return Promise.resolve(result);
    },
  };
  createSupabaseServiceClient.mockReturnValue({ from: () => builder });
  return seen;
}

const row = (over: Record<string, unknown> = {}) => ({
  event_type: 'order_created',
  status: 'sent',
  attempts: 1,
  max_attempts: 5,
  created_at: '2026-09-02T02:55:00.315Z',
  sent_at: '2026-09-02T02:55:00.929Z',
  ...over,
});

beforeEach(() => {
  createSupabaseServiceClient.mockReset();
});

describe('listOrderEmailLog', () => {
  it('🟢 正常路徑 ⇒ 逐欄映成 camelCase(含 maxAttempts)', async () => {
    mockClient({ data: [row()], error: null });
    const out = await listOrderEmailLog('o-1');
    expect(out).toHaveLength(1);
    expect(out[0]?.maxAttempts).toBe(5);
    expect(out[0]?.attempts).toBe(1);
    expect(out[0]?.sentAt).toBe('2026-09-02T02:55:00.929Z');
  });

  it('🎯 送出去的欄位字串**就是** EMAIL_LOG_COLUMNS —— 不是另一份會分岔的手打字串', async () => {
    // 🔴 這條擋的是【常數與實際送出去的值分岔】—— 實測兩個方向都紅:
    //      手打字串 + 多一欄 `recipient_email` ⇒ 1 紅
    //      手打字串 + 少一欄 `max_attempts`    ⇒ 1 紅
    //
    // 🛑🛑 **而這裡有一格我差點誤判, 留著給下一個人**:
    //    我先跑的突變是「`.select(EMAIL_LOG_COLUMNS)` ⇒ 換成一份**值完全相同**的手打字串」
    //    ⇒ **49 格全綠** ⇒ 我第一個念頭是「這條斷言不夠強」。
    //    ✅ 而正確的問法是:**那個突變有沒有製造出一個缺陷?**
    //       —— 沒有。兩份字串值相同 ⇒ **行為零改變** ⇒ 該綠。
    //    📌 **⇒ 一個突變跑出全綠, 有兩種原因:①斷言太弱 ②那個突變根本沒壞掉任何東西。**
    //    **⇒ ⇒ 而它們印同一個綠。先問第二個, 再去改斷言 —— 否則會為了殺死一個**
    //    **   不存在的缺陷, 把斷言改成一條會誤報的。**
    const seen = mockClient({ data: [], error: null });
    await listOrderEmailLog('o-1');
    expect(seen.columns).toBe(EMAIL_LOG_COLUMNS);
  });

  it('🔴 超過上限 ⇒ throw(而不是 slice 之後照樣畫)', async () => {
    // 📌 少印一列而畫面看起來正常 = 這一片要修的病。寧可走 unreadable 態。
    const seen = mockClient({ data: Array.from({ length: 201 }, () => row()), error: null });
    await expect(listOrderEmailLog('o-1')).rejects.toBeInstanceOf(EmailLogShapeError);
    // 而它撈的是【上限 + 1】—— 少了那個 +1 就永遠偵測不到「剛好滿」
    expect(seen.limit).toBe(201);
  });

  it('🟢 對照組:剛好在上限 ⇒ 不 throw(否則上面那格可能是恆真的)', async () => {
    mockClient({ data: Array.from({ length: 200 }, () => row()), error: null });
    await expect(listOrderEmailLog('o-1')).resolves.toHaveLength(200);
  });

  it('🔴 PostgREST 回 error ⇒ 往上丟(呼叫端才折得成 unreadable, 不是空陣列)', async () => {
    mockClient({ data: null, error: { message: 'boom' } });
    await expect(listOrderEmailLog('o-1')).rejects.toBeTruthy();
  });

  it('🔴 `sent_at` 鍵根本不存在 ⇒ throw —— 那代表 select 漏了一欄, 是 bug 不是資料', async () => {
    const bad = row();
    delete (bad as Record<string, unknown>).sent_at;
    mockClient({ data: [bad], error: null });
    await expect(listOrderEmailLog('o-1')).rejects.toBeInstanceOf(EmailLogShapeError);
  });

  it('🟢 對照組:`sent_at` 是 null(欄位在、真的沒值)⇒ 正常回 null', async () => {
    mockClient({ data: [row({ sent_at: null })], error: null });
    const out = await listOrderEmailLog('o-1');
    expect(out[0]?.sentAt).toBeNull();
  });

  it('🔴 `max_attempts` 不是數字 ⇒ throw(否則 isDead 會拿 NaN 去比, 而 NaN 比較永遠 false)', async () => {
    mockClient({ data: [row({ max_attempts: '5' })], error: null });
    await expect(listOrderEmailLog('o-1')).rejects.toBeInstanceOf(EmailLogShapeError);
  });

  it('🔵 data 是 null ⇒ 回空陣列(不是 throw)—— 那是「這張單沒寄過信」', async () => {
    mockClient({ data: null, error: null });
    await expect(listOrderEmailLog('o-1')).resolves.toEqual([]);
  });
});
