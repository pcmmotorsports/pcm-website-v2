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

// 🔴 2026-09-05:改成 **view** 的欄(`order_id` 而非 `id`;`customer_email` 由 SQL 給,
//    `customer_user_id` 不再需要 —— 它原本只是拿去打第二發查詢的鑰匙)。
const ORDER_ROW = {
  order_id: 'order-1',
  display_id: 'ABC123',
  paid_at: '2026-08-18T10:00:00.000Z',
  created_at: '2026-08-18T09:00:00.000Z',
  notification_email: 'member@example.com',
  customer_email: null,
  order_source: 'manual_phone',
};
const CUSTOMERS_EMPTY = () => makeBuilder({ data: [], error: null });

describe('SupabasePaidOrderScannerAdapter — 掃描述詞', () => {
  it('🔴 W3-G:掃描查詢帶 cancelled_at is null(payment_status=paid 原本沒有排除取消單)', async () => {
    // 這格只證明【掃描時的查詢字面】排除了已取消單,不證明「不會寄信」——
    // codex 關卡2(2026-08-20)FAIL:掃描後、真正寄送前才被取消的單,這條擋不住,
    // sweep-email-outbox.ts 寄送前沒有重查訂單狀態,是更大的洞,本片範圍外、另案處理。
    // W5 2026-08-20 掃出原始缺口:.eq('payment_status','paid') 全程零 cancelled 過濾。
    // mock 不執行 PostgREST 過濾,真過濾語意只能由部署前的真實測打證明。
    const orders = makeBuilder({ data: [], error: null });
    const { client, from: fromSpy } = makeClient(orders);
    await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    // 🔴🔴 **2026-09-05(⟦b4-NORECIPIENTWINDOW⟧ 甲):這個條件【搬進 view】了。**
    //    ⛔ ~~`expect(argsOf(orders,'is')).toContainEqual(['cancelled_at', null])`~~
    //    ⇒ 現在 adapter 不再下這個 filter ⇒ 那一行必紅, 而**紅的不是缺陷**。
    // 🛑 **而【守門也要跟著搬, 不是刪掉】** —— 那個性質仍然承重:
    //    取消不改 `payment_status`, 只補 `cancelled_at` ⇒ 少了它會寄信給剛取消的客人。
    // ✅ **它現在的落點有兩個, 而兩個都在**:
    //    ① view 定義裡(`20260905020000` 的 `WHERE … cancelled_at IS NULL`)
    //    ② 那支 migration 的 **apply 期釘樁②** 逐字找 `cancelled_at IS NULL`, 找不到就 RAISE
    // 🔵 而本格改成守【adapter 真的去讀那個 view】—— 那是這一層唯一還答得出來的事。
    expect(argsOf(orders, 'is')).toEqual([]);
    expect(fromSpy).toHaveBeenCalledWith('pcm_order_created_email_pending');
  });

  it('🔴 #5 cutoff 同時卡 paid_at 與 created_at(PRD §5 R3)—— 少一半就會寄舊單', async () => {
    // 失敗情境不是「壞掉」,是【客人收到一封關於幾個月前那張單的通知信】,
    // 而那件事在 repo 內沒有任何症狀。突變:拿掉 created_at 那一行 ⇒ 這格必紅。
    const orders = makeBuilder({ data: [], error: null });
    const { client } = makeClient(orders);
    await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    // 🔵 **cutoff 那兩個【沒有】搬進 view** —— 它是參數, 烤不進去 ⇒ 這一格照舊承重。
    expect(argsOf(orders, 'gte')).toEqual([
      ['paid_at', CUTOFF],
      ['created_at', CUTOFF],
    ]);
    // 🔴 排序鍵改成 view 的欄名 `order_id`(仍是唯一鍵 ⇒ 翻頁不跳列)。
    expect(argsOf(orders, 'order')).toEqual([['order_id', { ascending: true }]]);
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
      // 🔴🔴 **2026-09-05(⟦b4-NORECIPIENTWINDOW⟧ 甲):整個 anti-join 【搬進 view】了。**
      //    ⇒ 📌 **那個「差一個欄名就靜默壞掉」的字面, 在這一層【不再存在】** ——
      //      而它不是被刪掉, 是**那個查詢形狀消失了**(PostgREST 的 embed 換成 SQL 的 NOT EXISTS)。
      //    🎯 ⇒ **這一族守的那個病, 現在是【結構上不可能】而不是【被測試擋著】。**
      // ✅ 而守門搬到兩個地方:①view 的 `NOT EXISTS … event_type = 'order_created'`
      //    ②那支 migration 的 apply 期釘樁(逐字找 `order_created`, 找不到就 RAISE)。
      // 🔵 本格改成守【那三個毒字面一個都不准回來】—— 它們回來就代表有人把 anti-join 搬回這一層。
      expect(select).not.toContain('email_outbox');
      expect(argsOf(orders, 'eq')).toEqual([]);
      expect(argsOf(orders, 'is')).toEqual([]);
      // 🟢 正對照:它確實去讀了那個 view(否則上面三行在「什麼查詢都沒發」時也會綠)。
      expect(select).toContain('customer_email');
      expect(select).toContain('order_id');
    });

    it('DB 回傳的列由 adapter【原樣傳遞】(不自己再過濾、不改順序)', async () => {
      // 🔴 **這一格【不驗】PostgREST 的過濾語意**(codex 關卡2 R2:名稱也要跟著收斂)——
      //    O1 是我在 mock 外**人工移除**的,真查詢若錯誤納入 O1,只要 mock 照樣回三列,這格還是綠。
      //    守毒分支的是上一格的字面斷言;過濾語意只能由部署前的真實測打證明。
      // 測資語意 = 我 2026-08-19 在拋棄式 PostgREST 上量的那一組:
      //   O1 有 order_created / O2 只有 order_shipped / O3,O4 完全沒有列 ⇒ 正確答案 = O2,O3,O4
      const pending = ['O2', 'O3', 'O4'].map((d, i) => ({
        ...ORDER_ROW,
        order_id: `order-${d}`,
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
    // 🔴 2026-09-05(codex nit):**改的是 `order_id` 不是舊欄 `id`** ——
    //    寫成 `id` 的話 20 列會共用**同一個 `order_id`**(來自 ORDER_ROW)
    //    ⇒ 只驗長度照樣綠, 而「唯一排序鍵」那句敘述**沒有東西撐著它**。
    const many = Array.from({ length: 20 }, (_, i) => ({ ...ORDER_ROW, order_id: `o-${i}`, display_id: `D${i}` }));
    const orders = makeBuilder({ data: many, error: null });
    const { client } = makeClient(orders, CUSTOMERS_EMPTY());

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 5,
    });

    expect(argsOf(orders, 'limit')).toEqual([[6]]); // limit + 1
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
    // 🟢 **而它們真的是【五張不同的單】** —— 少了這一行, 上面兩行在
    //    「20 列共用同一個 order_id」的世界裡也會綠(codex 2026-09-05 nit 指的就是那個世界)。
    expect(new Set(res.rows.map((r) => r.orderId)).size).toBe(5);
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
    const exact = Array.from({ length: 5 }, (_, i) => ({ ...ORDER_ROW, order_id: `o-${i}` }));
    const orders = makeBuilder({ data: exact, error: null });
    const { client } = makeClient(orders, CUSTOMERS_EMPTY());

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 5,
    });

    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(false);
  });

  it('🔴 兩個信箱都原樣交出去 —— 而現在只打【一發】查詢', async () => {
    // 🔴🔴 **2026-09-05(⟦b4-NORECIPIENTWINDOW⟧ 甲):第二發查詢【整段刪掉了】。**
    //    ⛔ ~~`expect(from.mock.calls.map(...)).toEqual(['orders','customers'])`~~
    //    ⇒ 那條路不存在了 ⇒ 那一行必紅, 而**紅的不是缺陷**。
    // 🛑 **而它守的那個性質仍然承重, 只是換了保證的方式**:
    //    舊版在 adapter 自己判一次「有沒有值」、use-case 再判一次 ⇒ 兩個判準會漂,
    //    而漂掉那天的症狀是「該收的信永遠不會被排進去」, 測試全綠(codex R1 must-fix 2)。
    //    ✅ 現在 `customer_email` **由 view LEFT JOIN 好直接給** ⇒ adapter 連判的機會都沒有
    //    ⇒ 🎯 **那個病從「被測試擋著」變成「結構上不可能」。**
    const orders = makeBuilder({
      data: [{ ...ORDER_ROW, customer_email: 'frozen@example.com' }],
      error: null,
    });
    const { client, from } = makeClient(orders);

    const res = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });

    // 🔴 承重:只打一發, 而且打的是那個 view。第二發回來 ⇒ 這一行紅。
    expect(from.mock.calls.map(([t]) => t)).toEqual(['pcm_order_created_email_pending']);
    expect(res.rows[0]).toMatchObject({
      notificationEmail: 'member@example.com',
      customerEmail: 'frozen@example.com', // 🔴 兩個都交出去, 由 use-case 決定用哪個
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
    // 🔴🔴 **2026-09-05:`customers` 那一格【刪掉了】, 而它不是「少一個測試」。**
    //    那一發查詢在 ⟦b4-NORECIPIENTWINDOW⟧ 甲之後**不存在** —— `customer_email` 由 view 給。
    //    ⇒ 📌 留著它的話, 它會餵一個第二 builder 而 adapter 根本不去拿 ⇒ **它永遠不會 throw**
    //      ⇒ 🛑 **那是一格【由構造上不可能失敗】的測試, 而它讀起來像一道保護。**
    //    ✅ 而它守的「錯誤不得帶 PII」那個性質**沒有失去守門** —— 上面 `'orders'` 那一格
    //      走的就是同一支 `safeQuery` / `ScanQueryError`(現在唯一的那一發查詢)。
    //    🔵 另有一格獨立測 `stage` / `code` 兩個固定欄, 也改成走那一發。
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
    // 🔵 2026-09-05:改用**那一發** view 查詢的錯誤(第二發查詢已不存在)。
    //    ⚠️ `stage` 仍是 `'orders'` —— 它是**給 log 看的階段名**, 不是表名
    //    (`ScanStage` 與取消信那支 adapter 共用, 為本檔改窄它會動到別人)。
    const orders = makeBuilder({ data: null, error: { message: `row ${PII} failed`, code: 'PGRST502' } });
    const { client } = makeClient(orders);

    const err = (await new SupabasePaidOrderScannerAdapter(client)
      .listPaidWithoutOrderCreatedEmail({ cutoff: CUTOFF, limit: 50 })
      .then(() => null, (e: unknown) => e)) as ScanQueryError;

    expect(err).toBeInstanceOf(ScanQueryError);
    expect(err.stage).toBe('orders');
    expect(err.code).toBe('PGRST502');
    expect(err.message).not.toContain('@');
  });
});

// ══ 片 B(⟦f3-MAILFALLBACKVSRULING⟧, 2026-09-05)——「撈得到 order_source」════════
// 🔴 **兩個宣稱, 各一格**:①它在 select 字串裡 ②它真的走到 port 物件上。
//    少了②, 一個「加進 select 而忘了對映」的實作【第①格照樣綠】。
// 🔵 而 fixture 刻意用 'manual_phone' 不用 'web' —— 一個把它寫死成 'web' 的對映
//    在 'web' 的 fixture 上完全看不出來。
describe('片 B:order_source 接出來了', () => {
  it('①select 字串帶了它, 而②它走到 port 物件上', async () => {
    const orders = makeBuilder({ data: [ORDER_ROW], error: null });
    const { client } = makeClient(orders, CUSTOMERS_EMPTY());
    const r = await new SupabasePaidOrderScannerAdapter(client).listPaidWithoutOrderCreatedEmail({
      cutoff: CUTOFF,
      limit: 50,
    });
    const select = String(orders.calls.find(([m]) => m === 'select')?.[1]?.[0] ?? '');
    expect(select).toContain('order_source');
    expect(r.rows[0]?.orderSource).toBe('manual_phone');
  });
});
