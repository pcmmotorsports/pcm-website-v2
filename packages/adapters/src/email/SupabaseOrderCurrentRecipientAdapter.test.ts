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
    const a = await run({ data: [{ order_source: 'web', notification_email: 'a@x.com', customer_email: 'c@x.com' }] });
    const b = await run({ data: [{ order_source: 'web', notification_email: 'b@x.com', customer_email: 'c@x.com' }] });
    expect(a).toEqual({ kind: 'known', email: 'a@x.com' });
    expect(b).toEqual({ kind: 'known', email: 'b@x.com' });
    // 🛑 兩個世界要印**不同**的東西 —— 一個寫死回傳的實作在這一行會紅。
    expect((a as { email: string }).email).not.toBe((b as { email: string }).email);
  });

  it('🔵 notification 空 ⇒ 回退到 customer(與排信當下同一套算法)', async () => {
    await expect(run({ data: [{ order_source: 'web', notification_email: '   ', customer_email: 'c@x.com' }] }))
      .resolves.toEqual({ kind: 'known', email: 'c@x.com' });
  });

  it('🔴 兩個欄位都空 ⇒ `known` 而 email 是 null(**不是 unavailable**)', async () => {
    // 🛑 「這張單現在沒有地址」與「我讀不到」是兩件事, 呼叫端的處置不同。
    await expect(run({ data: [{ order_source: 'web', notification_email: null, customer_email: '' }] }))
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
  it('🔴 來源會壓制 customer 回退 ⇒ 不得退到 customer_email(否則是【假的漂移】)', async () => {
    // 🔵 兩個世界:同一份資料, 只有 `order_source` 不同 ⇒ 答案必須不同。
    const suppressed = await run({
      data: [{ order_source: 'manual_phone', notification_email: null, customer_email: 'c@x.com' }],
    });
    const normal = await run({
      data: [{ order_source: 'web', notification_email: null, customer_email: 'c@x.com' }],
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
    const { c, select, from } = client({ data: [{ order_source: 'web', notification_email: 'a@x.com', customer_email: null }] });
    await new SupabaseOrderCurrentRecipientAdapter(c).getCurrentRecipient({ orderId: 'o1' });
    expect(from).toHaveBeenCalledWith('orders');
    // 🛑 `order_source` 少了 ⇒ 假的漂移(現值與排信當下用不同規則算)。
    expect(select).toHaveBeenCalledWith('order_source, notification_email, customer_email');
  });
});
