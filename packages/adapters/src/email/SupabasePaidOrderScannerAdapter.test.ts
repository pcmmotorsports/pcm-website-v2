// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
//
// M-4a B-5 plan §6 的 **#5**(cutoff 要卡兩邊)+ anti-join 字面守門住在這裡;#1-#4/#6 在 use-case、#7/#8 在 route。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  ScanQueryError,
  SupabasePaidOrderScannerAdapter,
  type PaidOrderScannerClient,
} from './SupabasePaidOrderScannerAdapter';

const CUTOFF = '2026-08-18T00:00:00.000Z';
const PII = 'member@example.com';

type Resp = { data: unknown; error: { message: string; code?: string } | null };

/**
 * 鏈式 thenable builder mock。
 * 🔴 **`.limit(n)` 會真的截斷回傳列** —— 這不是裝飾:第一版的 mock 無視 `.limit()`,
 *    結果那格叫「飢餓」的測試**其實沒有在守它宣稱要守的東西**。
 */
function makeBuilder(result: Resp) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = { calls };
  let limit: number | null = null;
  for (const m of ['select', 'eq', 'gte', 'gt', 'in', 'is', 'order', 'limit']) {
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
const CUSTOMERS_EMPTY = () => makeBuilder({ data: [], error: null });

describe('SupabasePaidOrderScannerAdapter — 掃描述詞', () => {
  it('🔴 #5 cutoff 同時卡 paid_at 與 created_at(PRD §5 R3)—— 少一半就會寄舊單', async () => {
    // 失敗情境不是「壞掉」,是【客人收到一封關於幾個月前那張單的通知信】,
    // 而那件事在 repo 內沒有任何症狀。突變:拿掉 created_at 那一行 ⇒ 這格必紅。
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
    expect(argsOf(orders, 'order')).toEqual([['id', { ascending: true }]]);
  });

  // ── 🔴🔴 anti-join 的字面守門(2026-08-19 實測 PostgREST 14.16)──────────────
  //
  // 這一族存在的理由:**那個字面差一個欄名就會靜默壞掉,而兩個世界都回 200。**
  //   ✅ `email_outbox=is.null`          ⇒ 只回沒排過的
  //   🔴 `email_outbox.order_id=is.null` ⇒ 回【全部的列】+ 空 embed(看起來完全正常)
  // ⇒ 只斷言 http=200 或「非空」的守門,對【寫錯的那版】照樣全綠。
  describe('🔴 anti-join 字面(差一個欄名就靜默壞掉)', () => {
    it('三個部件都要在:embed 在 select 裡 / event_type 篩子表 / `email_outbox` 篩父列', async () => {
      const orders = makeBuilder({ data: [], error: null });
      const { client } = makeClient(orders);
      await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
        cutoff: CUTOFF,
        limit: 50,
      });

      const select = String(argsOf(orders, 'select')[0]![0]);
      // ① embed 必須在 select 裡 —— 少了它 PostgREST 回 PGRST108(我第一次量就是栽在這)
      expect(select).toContain('email_outbox!left(order_id)');
      // ② 子表篩 event_type:少了它,只有 order_shipped 的單會被當成「排過了」而永久跳過
      expect(argsOf(orders, 'eq')).toContainEqual(['email_outbox.event_type', 'order_created']);
      // ③ 父列條件必須是【不帶欄名】的 `email_outbox`
      expect(argsOf(orders, 'is')).toEqual([['email_outbox', null]]);
      // 🔴 反向:不得出現帶欄名的毒分支
      expect(argsOf(orders, 'is')).not.toContainEqual(['email_outbox.order_id', null]);
    });

    it('🔴 逐列比對:回的必須【正好是】沒排過通知信的那幾列,不是「非空」也不是「數量對」', async () => {
      // 測資語意 = 我 2026-08-19 在拋棄式 PostgREST 上量的那一組:
      //   O1 有 order_created / O2 只有 order_shipped / O3,O4 完全沒有列 ⇒ 正確答案 = O2,O3,O4
      // 🔴 DB 端已經把 O1 濾掉了 ⇒ mock 回的就是 O2,O3,O4。
      //    這一格守的是「adapter 把它們【原樣】交出去、沒有自己再過濾或改順序」。
      const pending = ['O2', 'O3', 'O4'].map((d, i) => ({
        ...ORDER_ROW,
        id: `order-${d}`,
        display_id: d,
        customer_user_id: `user-${i}`,
      }));
      const orders = makeBuilder({ data: pending, error: null });
      const { client } = makeClient(orders, CUSTOMERS_EMPTY());

      const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
        cutoff: CUTOFF,
        limit: 50,
      });

      expect(res.rows.map((r) => r.displayId)).toEqual(['O2', 'O3', 'O4']);
      expect(res.truncated).toBe(false);
    });
  });

  it('🔴 多要一列當截斷探針:拿到 limit+1 ⇒ truncated=true,而且【只回 limit 列】', async () => {
    // 不用「短頁 = 末頁」是刻意的 —— 那個判準依賴 `db-max-rows`,
    // 而它是一個 dashboard 上改得回去、改了不會有任何東西紅的設定。
    const many = Array.from({ length: 20 }, (_, i) => ({ ...ORDER_ROW, id: `o-${i}`, display_id: `D${i}` }));
    const orders = makeBuilder({ data: many, error: null });
    const { client } = makeClient(orders, CUSTOMERS_EMPTY());

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 5,
    });

    expect(argsOf(orders, 'limit')).toEqual([[6]]); // limit + 1
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });

  it.each([0, -1, 1.5, 201])('🔴 limit=%s ⇒ 直接 throw(契約由 adapter 強制,不是靠註解)', async (bad) => {
    // codex 關卡2:adapter 原本沒 clamp,「最多 50 筆」只是註解裡的假設。
    // limit=0 會走空列分支回 truncated=false(有待排也說沒有);limit 過大會讓探針被 db-max-rows 截掉。
    const { client } = makeClient(makeBuilder({ data: [], error: null }));
    await expect(
      new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
        cutoff: CUTOFF,
        limit: bad,
      }),
    ).rejects.toThrow(/limit 必須是 1\.\.200 的整數/);
  });

  it('負對照:limit=1 與 limit=200 都放行(證明上一格不是「全部擋掉」)', async () => {
    for (const ok of [1, 200]) {
      const { client } = makeClient(makeBuilder({ data: [], error: null }));
      await expect(
        new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
          cutoff: CUTOFF,
          limit: ok,
        }),
      ).resolves.toMatchObject({ rows: [] });
    }
  });

  it('剛好 limit 列 ⇒ truncated=false(負對照:證明上一格不是「永遠 true」)', async () => {
    const exact = Array.from({ length: 5 }, (_, i) => ({ ...ORDER_ROW, id: `o-${i}` }));
    const orders = makeBuilder({ data: exact, error: null });
    const { client } = makeClient(orders, CUSTOMERS_EMPTY());

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 5,
    });

    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(false);
  });

  it('🔴 fallback 信箱【無條件】撈(判斷只留 use-case 一處;GR nit 1)', async () => {
    // 舊版在 adapter 自己判一次「有沒有值」、use-case 再判一次 ⇒ 兩個判準會漂,
    // 而漂掉那天的症狀是「該收的信永遠不會被排進去」,測試全綠(codex R1 must-fix 2)。
    const orders = makeBuilder({ data: [ORDER_ROW], error: null }); // 有 notification_email
    const customers = makeBuilder({ data: [{ user_id: 'user-1', email: 'frozen@example.com' }], error: null });
    const { client, from } = makeClient(orders, customers);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(from.mock.calls.map(([t]) => t)).toEqual(['orders', 'customers']);
    expect(argsOf(customers, 'in')).toEqual([['user_id', ['user-1']]]);
    expect(res.rows[0]).toMatchObject({
      notificationEmail: 'member@example.com',
      customerEmail: 'frozen@example.com', // 🔴 兩個都交出去,由 use-case 決定用哪個
    });
  });

  it('零待排 ⇒ 不去撈 customers(沒有人要 fallback)', async () => {
    const orders = makeBuilder({ data: [], error: null });
    const { client, from } = makeClient(orders);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    expect(res.rows).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  // 🔴 codex 關卡2 R2/R3 must-fix 3:只驗 `Error.message` 不夠 —— 有人加一行 `console.error(err)`
  //    格子照樣全綠,而 email 已經進 log。兩個查詢路徑都要參數化。
  it.each([
    ['orders', () => [makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST500' } })]],
    [
      'customers',
      () => [
        makeBuilder({ data: [ORDER_ROW], error: null }),
        makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST502' } }),
      ],
    ],
  ])('🔴 %s 查詢 error ⇒ throw,訊息【不含】DB 原訊息,而且【一行 log 都不准寫】', async (_label, build) => {
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
    const rejecting = { calls: [] as Array<[string, unknown[]]> };
    for (const m of ['select', 'eq', 'gte', 'gt', 'in', 'is', 'order', 'limit']) {
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

  it('🔴 安全錯誤帶得到 `stage` 與 `code` 兩個固定欄(運維要查得下去)', async () => {
    const orders = makeBuilder({ data: [ORDER_ROW], error: null });
    const customers = makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST502' } });
    const { client } = makeClient(orders, customers);

    const err = (await new SupabasePaidOrderScannerAdapter(client)
      .listPaidWithoutOrderCreatedEmail({ cutoff: CUTOFF, limit: 50 })
      .then(() => null, (e: unknown) => e)) as ScanQueryError;

    expect(err).toBeInstanceOf(ScanQueryError);
    expect(err.stage).toBe('customers');
    expect(err.code).toBe('PGRST502');
    expect(err.message).not.toContain('@');
  });
});
