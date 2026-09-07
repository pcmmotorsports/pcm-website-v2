import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { SupabaseOrderCurrentRecipientAdapter } from './SupabaseOrderCurrentRecipientAdapter';

/**
 * ⟦mail-RECIPIENTNOTRECHECKED⟧ 第一顆:**讀得到現值**(這一顆不接線、不改寄不寄)。
 * 🔴 驗收(主視窗 B 指定):**給一個 order_id 它回得出值, 而且【改了 DB 的值它回的會跟著變】**
 *    —— 那是**兩個世界**;只驗一個世界的話, 一個寫死回傳的實作也會全綠。
 */
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
  new SupabaseOrderCurrentRecipientAdapter(client(r).c).getCurrentRecipient({ orderId: 'o1' });

describe('SupabaseOrderCurrentRecipientAdapter', () => {
  it('🔴 兩個世界:改了 DB 的值, 它回的就跟著變', async () => {
    const a = await run({ data: [{ order_source: 'web', notification_email: 'a@x.com', customers: { email: 'c@x.com'  }}] });
    const b = await run({ data: [{ order_source: 'web', notification_email: 'b@x.com', customers: { email: 'c@x.com'  }}] });
    expect(a).toEqual({ kind: 'known', email: 'a@x.com' });
    expect(b).toEqual({ kind: 'known', email: 'b@x.com' });
    // 🛑 兩個世界要印**不同**的東西 —— 一個寫死回傳的實作在這一行會紅。
    expect((a as { email: string }).email).not.toBe((b as { email: string }).email);
  });

  it('🔵 notification 空 ⇒ 回退到 customer(與排信當下同一套算法)', async () => {
    await expect(run({ data: [{ order_source: 'web', notification_email: '   ', customers: { email: 'c@x.com'  }}] }))
      .resolves.toEqual({ kind: 'known', email: 'c@x.com' });
  });

  it('🔴 兩個欄位都空 ⇒ `known` 而 email 是 null(**不是 unavailable**)', async () => {
    // 🛑 「這張單現在沒有地址」與「我讀不到」是兩件事, 呼叫端的處置不同。
    await expect(run({ data: [{ order_source: 'web', notification_email: null, customers: { email: ''  }}] }))
      .resolves.toEqual({ kind: 'known', email: null });
  });

  /**
   * 🔴🔴 **這一格是【一發活下來的突變】逼出來的 —— 今天第六次同族。**
   *    突變:把 `suppressCustomerEmailFallback(order_source)` 那一段拿掉
   *    ⇒ **rc=0, 6 格全綠** ⇒ 那道規則**根本沒有人在看**。
   * 🛑 **成因是 fixture 的形狀**:我上面每一格都用 `order_source: 'web'`,
   *    而 `web` **不在**壓制名單裡 ⇒ 兩條路算出**同一個值** ⇒ 📌 **要區分的那兩件事,
   *    在我的測資裡從來沒有分開過。**
   * ✅ 這一格用**會壓制**的來源(`manual_phone`), 讓那兩條路第一次分岔。
   */
  /**
   * 🔴🔴 **PostgREST 的 to-one embed 【也可能回陣列】—— 這一格是被一發活下來的突變逼出來的。**
   *
   * 突變:把 `Array.isArray(row.customers) ? (row.customers[0] ?? null) : …` 的陣列那半
   * 改成永遠回 `null` ⇒ **7 格全綠、一格都沒紅。**
   * 成因:上面每一格的 fixture 都寫 `customers: { email: … }`(物件形)
   * ⇒ 📌 **要區分的那兩件事, 在測資裡從來沒有分開過** —— 本檔今天第三次踩同一個坑
   *   (第一次是每格都 `order_source: 'web'`)。
   *
   * 🛑 而它的失敗方向是**安靜的**:回陣列的環境 ⇒ `email` 變 `null`
   *   ⇒ 呼叫端讀成「這張單沒有地址」⇒ **不寄** —— 而沒有任何東西會紅。
   */
  it('🔴 embed 回【陣列】時也要取得到 email(不是掉回 null)', async () => {
    const asArray = await run({
      data: [{ order_source: 'web', notification_email: null, customers: [{ email: 'c@x.com' }] }],
    });
    const asObject = await run({
      data: [{ order_source: 'web', notification_email: null, customers: { email: 'c@x.com' } }],
    });
    // 🔵 兩種形狀必須給同一個答案 —— 而它們走的是不同的分支。
    expect(asArray).toEqual({ kind: 'known', email: 'c@x.com' });
    expect(asObject).toEqual(asArray);
    // 🛑 空陣列 ⇒ 沒有客人列 ⇒ `known/null`(不是 `unavailable`:那張單在, 只是沒地址)。
    const emptyArray = await run({
      data: [{ order_source: 'web', notification_email: null, customers: [] }],
    });
    expect(emptyArray).toEqual({ kind: 'known', email: null });
  });

  it('🔴 來源會壓制 customer 回退 ⇒ 不得退到 customer_email(否則是【假的漂移】)', async () => {
    // 🔵 兩個世界:同一份資料, 只有 `order_source` 不同 ⇒ 答案必須不同。
    const suppressed = await run({
      data: [{ order_source: 'manual_phone', notification_email: null, customers: { email: 'c@x.com'  }}],
    });
    const normal = await run({
      data: [{ order_source: 'web', notification_email: null, customers: { email: 'c@x.com'  }}],
    });
    expect(suppressed).toEqual({ kind: 'known', email: null });
    expect(normal).toEqual({ kind: 'known', email: 'c@x.com' });
    // 🛑 承重:拿掉壓制規則 ⇒ 上面那個 `null` 會變成 `c@x.com` ⇒ 這一行紅。
    expect(suppressed).not.toEqual(normal);
  });

  it('🔴 查無那一列 ⇒ `unavailable`(**不是 known/null**)', async () => {
    await expect(run({ data: [] })).resolves.toEqual({ kind: 'unavailable' });
  });

  it('🔴 查詢報錯 / 丟例外 ⇒ 都是 `unavailable`(fail-closed)', async () => {
    await expect(run({ data: null, error: { message: 'x' } })).resolves.toEqual({ kind: 'unavailable' });
    await expect(run({ data: null, throws: true })).resolves.toEqual({ kind: 'unavailable' });
  });

  it('🔴 逐欄指名:少一欄就套不了壓制規則 ⇒ 釘住 select 的字面', async () => {
    const { c, select, from } = client({ data: [{ order_source: 'web', notification_email: 'a@x.com', customers: { email: null  }}] });
    await new SupabaseOrderCurrentRecipientAdapter(c).getCurrentRecipient({ orderId: 'o1' });
    expect(from).toHaveBeenCalledWith('orders');
    // 🛑 `order_source` 少了 ⇒ 假的漂移(現值與排信當下用不同規則算)。
    // 🔴🔴 **這一格【曾經釘住一個錯的字面】而它照樣全綠**(codex 12⑤ 2026-09-07 must-fix):
    //    舊字面 `'order_source, notification_email, customer_email'` —— 而 `customer_email`
    //    **不是 orders 的欄位**(`CREATE TABLE orders` 逐欄看過沒有;repo 那 43 處全是 view 裡的
    //    `c.email AS customer_email` 別名)⇒ 正式環境 PostgREST 回錯 ⇒ adapter fail-closed
    //    ⇒ 📌 **每一封信都停**。
    // 🛑 **為什麼這一格擋不住它**:它比對的是【我寫在 adapter 裡的那個字串】與
    //    【我寫在測試裡的那個字串】—— **兩邊同源** ⇒ 📌 **拿它驗它自己。**
    //    ⇒ ⚠️ **唯一驗得到的是【拿字面去對 schema】**, 而那件事今天沒有任何自動化在做
    //      —— **已知缺口, 明寫**(不是「這格守住了」)。
    expect(select).toHaveBeenCalledWith('order_source, notification_email, customers(email)');
    // 🔵 負向:舊那個不存在的欄位名不可以再出現。
    expect(select).not.toHaveBeenCalledWith(expect.stringContaining('customer_email'));
  });
});
