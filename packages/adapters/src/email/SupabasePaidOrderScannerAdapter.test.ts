// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
//
// M-4a B-5 plan §6 的 **#5**(cutoff 要卡兩邊)住在這裡;#1-#4/#6 在 use-case、#7/#8 在 route。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  ScanQueryError,
  SupabasePaidOrderScannerAdapter,
  type PaidOrderScannerClient,
} from './SupabasePaidOrderScannerAdapter';

const CUTOFF = '2026-08-18T00:00:00.000Z';

type Resp = { data: unknown; error: { message: string; code?: string } | null };

/**
 * 鏈式 thenable builder mock(鏡像 SupabaseEmailOutboxAdapter.test.ts):鏈方法回自身、await 回注入結果。
 *
 * 🔴 **`.limit(n)` 會真的截斷回傳列** —— 這不是裝飾。
 *    第一版的 mock 無視 `.limit()`,結果那格叫「MF1 飢餓」的測試**其實沒有在守 MF1**:
 *    把 `.limit(PAGE_SIZE)` 改回 `.limit(input.limit)` 時,紅的是另一格(斷言 `limit` 引數的那格),
 *    而飢餓那格照樣綠 —— **量具沒有模擬那個行為,格子就守不到它宣稱要守的東西。**
 */
function makeBuilder(result: Resp) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = { calls };
  let limit: number | null = null;
  for (const m of ['select', 'eq', 'gte', 'gt', 'in', 'order', 'limit']) {
    b[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      if (m === 'limit' && typeof args[0] === 'number') limit = args[0];
      return b;
    });
  }
  b.then = (resolve: (v: Resp) => unknown) => {
    const data =
      limit !== null && Array.isArray(result.data) ? result.data.slice(0, limit) : result.data;
    return Promise.resolve({ ...result, data }).then(resolve);
  };
  return b as unknown as { calls: Array<[string, unknown[]]> };
}

function makeClient(...builders: Array<{ calls: Array<[string, unknown[]]> }>) {
  const from = vi.fn();
  for (const b of builders) from.mockReturnValueOnce(b);
  return { client: { from } as unknown as PaidOrderScannerClient, from };
}

function argsOf(b: { calls: Array<[string, unknown[]]> }, method: string): unknown[][] {
  return b.calls.filter(([m]) => m === method).map(([, args]) => args);
}

const ORDER_ROW = {
  id: 'order-1',
  display_id: 'ABC123',
  paid_at: '2026-08-18T10:00:00.000Z',
  notification_email: 'member@example.com',
  customer_user_id: 'user-1',
};

describe('SupabasePaidOrderScannerAdapter — 掃描述詞', () => {
  it('🔴 #5 cutoff 同時卡 paid_at 與 created_at(PRD §5 R3)—— 少一半就會寄舊單', async () => {
    // 這格的失敗情境不是「壞掉」,是【客人收到一封關於幾個月前那張單的通知信】,
    // 而那件事在 repo 內沒有任何症狀。⇒ 突變:拿掉 created_at 那一行 ⇒ 這格必紅。
    const orders = makeBuilder({ data: [], error: null });
    const { client } = makeClient(orders);
    await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(argsOf(orders, 'gte')).toEqual([
      ['paid_at', CUTOFF],
      ['created_at', CUTOFF],
    ]);
    expect(argsOf(orders, 'eq')).toEqual([['payment_status', 'paid']]);
    expect(argsOf(orders, 'order')).toEqual([['id', { ascending: true }]]);
    expect(argsOf(orders, 'limit')).toEqual([[200]]); // PAGE_SIZE,不是 caller 的 limit
  });

  it('差集:outbox 已有列的單被濾掉,沒有列的留下(且回的是那個【具體】email)', async () => {
    const orders = makeBuilder({
      data: [ORDER_ROW, { ...ORDER_ROW, id: 'order-2', display_id: 'DEF456' }],
      error: null,
    });
    const outbox = makeBuilder({ data: [{ order_id: 'order-2' }], error: null });
    const { client } = makeClient(orders, outbox);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(res.rows).toEqual([
      {
        orderId: 'order-1',
        displayId: 'ABC123',
        paidAt: '2026-08-18T10:00:00.000Z',
        notificationEmail: 'member@example.com',
        customerEmail: null, // 沒人需要 fallback ⇒ 沒去讀 customers
      },
    ]);
    expect(res.truncated).toBe(false);
    expect(argsOf(outbox, 'eq')).toEqual([['event_type', 'order_created']]);
    expect(argsOf(outbox, 'in')).toEqual([['order_id', ['order-1', 'order-2']]]);
  });

  it('🔴 沒有人需要 fallback ⇒ 【不去讀 customers】(那張表的 email 是 PII,不必每輪撈)', async () => {
    const orders = makeBuilder({ data: [ORDER_ROW], error: null });
    const outbox = makeBuilder({ data: [], error: null });
    const { client, from } = makeClient(orders, outbox);

    await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(from).toHaveBeenCalledTimes(2);
    expect(from.mock.calls.map(([t]) => t)).toEqual(['orders', 'email_outbox']);
  });

  it('notification_email 為 NULL ⇒ 讀 customers、以 user_id 對回去(不是 id)', async () => {
    const orders = makeBuilder({ data: [{ ...ORDER_ROW, notification_email: null }], error: null });
    const outbox = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [{ user_id: 'user-1', email: 'frozen@example.com' }], error: null });
    const { client, from } = makeClient(orders, outbox, customers);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(from.mock.calls.map(([t]) => t)).toEqual(['orders', 'email_outbox', 'customers']);
    expect(argsOf(customers, 'in')).toEqual([['user_id', ['user-1']]]);
    expect(res.rows[0]).toMatchObject({ notificationEmail: null, customerEmail: 'frozen@example.com' });
  });

  // 🔴 codex 關卡2 R1 must-fix 3:原本只有 orders 那一段驗了零 PII,
  //    outbox / customers 兩段的 throw 改成內插 error.message 也【不會紅】。三段都要參數化。
  const PII = 'member@example.com';
  it.each([
    [
      'orders',
      () => [makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST500' } })],
    ],
    [
      'email_outbox',
      () => [
        makeBuilder({ data: [ORDER_ROW], error: null }),
        makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST501' } }),
      ],
    ],
    [
      'customers',
      () => [
        makeBuilder({ data: [{ ...ORDER_ROW, notification_email: null }], error: null }),
        makeBuilder({ data: [], error: null }),
        makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST502' } }),
      ],
    ],
  ])('🔴 %s 查詢 error ⇒ throw,錯誤訊息【不含】DB 原訊息,而且【一行 log 都不准寫】', async (_label, build) => {
    // 🔴 codex 關卡2 R2 must-fix 3:只驗 `Error.message` 不夠 ——
    //    有人加一行 `console.error(ordersError)` 三格照樣全綠,而 email 已經進 log。
    const spies = (['error', 'warn', 'log', 'info', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const { client } = makeClient(...build());
      const err = await new SupabasePaidOrderScannerAdapter(client)
        .listPaidWithoutOrderCreatedEmail({ cutoff: CUTOFF, limit: 50 })
        .then(() => null, (e: Error) => e);

      expect(err).toBeInstanceOf(Error); // 整輪失敗要浮上去變 503,不得吞成空陣列
      expect(err!.message).not.toContain('@');
      expect(err!.message).not.toContain(PII);
      expect(err!.message).toMatch(/PGRST50\d/); // code 可以帶(非 PII、debug 要用)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('🔴 query 本身【直接 reject】(不是回 { error })⇒ 原始 message / stack / cause 都不得冒出去', async () => {
    // codex 關卡2 R2 must-fix 3 的另一半:mock 原本只模擬「resolve 成 { error }」那一條路,
    // 而網路層 / client 內部拋出來的是**直接 rejection** —— 那條路上原本沒有任何 sanitize。
    const rejecting = {
      calls: [] as Array<[string, unknown[]]>,
    } as unknown as { calls: Array<[string, unknown[]]> };
    for (const m of ['select', 'eq', 'gte', 'gt', 'in', 'order', 'limit']) {
      (rejecting as unknown as Record<string, unknown>)[m] = vi.fn(() => rejecting);
    }
    const raw = new Error(`socket hang up while reading ${PII}`);
    (raw as Error & { cause?: unknown }).cause = { detail: PII };
    (rejecting as unknown as Record<string, unknown>).then = (
      _res: unknown,
      rej: (e: unknown) => unknown,
    ) => Promise.reject(raw).catch(rej);

    const { client } = makeClient(rejecting);
    const err = await new SupabasePaidOrderScannerAdapter(client)
      .listPaidWithoutOrderCreatedEmail({ cutoff: CUTOFF, limit: 50 })
      .then(() => null, (e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBe(raw); // 🔴 不是把原物件遞出去
    expect(err!.message).not.toContain('@');
    expect(JSON.stringify((err as Error & { cause?: unknown }).cause ?? null)).not.toContain('@');
    expect(err!.stack ?? '').not.toContain(PII);
  });

  it('🔴🔴 MF1 飢餓:第一頁全部已排過 ⇒ 【繼續翻下一頁】,不是回空陣列', async () => {
    // 病的形狀:limit 若在算差集【之前】就套到 orders,而最舊那批剛好都排過信
    // ⇒ 每輪只看到那批、差集恆空 ⇒ 後面的單永遠排不進去,而 route 回 200、counts 全 0、測試全綠。
    // 這格用 PAGE_SIZE 滿頁 + 全部已排過,逼它必須翻第二頁才拿得到東西。
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ ...ORDER_ROW, id: `old-${i}` }));
    const page1 = makeBuilder({ data: fullPage, error: null });
    const outbox1 = makeBuilder({ data: fullPage.map((o) => ({ order_id: o.id })), error: null });
    const page2 = makeBuilder({ data: [{ ...ORDER_ROW, id: 'new-1' }], error: null });
    const outbox2 = makeBuilder({ data: [], error: null });
    const { client, from } = makeClient(page1, outbox1, page2, outbox2);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(res.rows.map((r) => r.orderId)).toEqual(['new-1']);
    expect(res.scannedPages).toBe(2);
    expect(from.mock.calls.map(([t]) => t)).toEqual(['orders', 'email_outbox', 'orders', 'email_outbox']);
    // keyset:第二頁必須帶著第一頁最後一列的 id 當游標(不是 .range 位移)
    expect(argsOf(page2, 'gt')).toEqual([['id', 'old-199']]);
  });

  it('🔴 MF2 空白字串的 notification_email ⇒ 【要去撈 customers】(與 use-case 的 trim 判準一致)', async () => {
    // 病:adapter 用 falsy 判、use-case 用 trim 判 ⇒ '   ' 在 adapter 眼裡「有值」、在 use-case 眼裡沒有
    // ⇒ adapter 不撈 customers ⇒ 那張單落 noRecipient ⇒ 該收的信永遠不會被排進去。
    const orders = makeBuilder({ data: [{ ...ORDER_ROW, notification_email: '   ' }], error: null });
    const outbox = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [{ user_id: 'user-1', email: 'frozen@example.com' }], error: null });
    const { client, from } = makeClient(orders, outbox, customers);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(from.mock.calls.map(([t]) => t)).toContain('customers');
    expect(res.rows[0]).toMatchObject({ notificationEmail: '   ', customerEmail: 'frozen@example.com' });
  });

  it('🔴 收滿 limit 就停,而且【明說】truncated(不得靜默截斷)', async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ ...ORDER_ROW, id: `o-${i}` }));
    const orders = makeBuilder({ data: fullPage, error: null });
    const outbox = makeBuilder({ data: [], error: null });
    const { client } = makeClient(orders, outbox);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 5,
    });

    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });

  it('🔴 R2-MF2 邊界:整頁 200 筆裡【剛好】5 筆待排、limit 也是 5 ⇒ truncated 仍必須是 true', async () => {
    // 原本寫 `pending.length > limit` ⇒ 這一格會回 false(「我掃完了」),而後面其實還有整整一頁沒看。
    // 判準改成【只有親眼看到空頁或短頁才算掃完】。
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ ...ORDER_ROW, id: `o-${i}` }));
    const orders = makeBuilder({ data: fullPage, error: null });
    const outbox = makeBuilder({
      data: fullPage.slice(0, 195).map((o) => ({ order_id: o.id })), // 195 筆已排、剩 5 筆
      error: null,
    });
    const { client } = makeClient(orders, outbox);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 5,
    });

    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });

  it('🔴🔴 R3-MF1:短末頁,但那一頁裡待排的比 limit 多 ⇒ truncated 仍必須是 true', async () => {
    // `!exhausted` 單獨用會有這個假陰性:末頁是短頁(exhausted=true)、但 10 筆全待排而 limit=5
    // ⇒ 只回 5 筆,卻宣稱「掃完了」。值班的人看到 enqTruncated=false 會判斷沒有 backlog。
    const shortPage = Array.from({ length: 10 }, (_, i) => ({ ...ORDER_ROW, id: `s-${i}` }));
    const orders = makeBuilder({ data: shortPage, error: null }); // 10 < PAGE_SIZE = 短頁
    const outbox = makeBuilder({ data: [], error: null }); // 全部沒排過
    const { client } = makeClient(orders, outbox);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 5,
    });

    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });

  it('🔴 R3-MF2:安全錯誤帶得到 `stage` 與 `code` 兩個固定欄(運維要查得下去)', async () => {
    // R2 那一輪把所有錯誤壓成一句話 ⇒ PII 保住了,而「查哪裡」的能力也一起沒了。
    const orders = makeBuilder({ data: [ORDER_ROW], error: null });
    const outbox = makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST501' } });
    const { client } = makeClient(orders, outbox);

    const err = (await new SupabasePaidOrderScannerAdapter(client)
      .listPaidWithoutOrderCreatedEmail({ cutoff: CUTOFF, limit: 50 })
      .then(() => null, (e: unknown) => e)) as ScanQueryError;

    expect(err).toBeInstanceOf(ScanQueryError);
    expect(err.stage).toBe('email_outbox'); // 🔴 哪一段壞的
    expect(err.code).toBe('PGRST501'); // 🔴 PostgREST 怎麼說的(非 PII)
    expect(err.message).not.toContain('@');
    expect(JSON.stringify({ s: err.stage, c: err.code })).not.toContain('@');
  });

  it('看到短頁 ⇒ truncated = false(那是「真的掃完了」的唯一證據)', async () => {
    const orders = makeBuilder({ data: [ORDER_ROW], error: null }); // 1 < PAGE_SIZE = 短頁
    const outbox = makeBuilder({ data: [], error: null });
    const { client } = makeClient(orders, outbox);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(res.truncated).toBe(false);
  });
});
