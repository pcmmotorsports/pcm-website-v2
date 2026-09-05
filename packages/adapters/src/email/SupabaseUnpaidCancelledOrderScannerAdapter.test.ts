// node env;mock 'server-only'(adapter 檔頭 import 'server-only')——
// 🔴 少了這一行, vitest 印的是【no tests】不是紅色, 而那與「檔案沒被收進來」長一樣。
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { SupabaseUnpaidCancelledOrderScannerAdapter } from './SupabaseUnpaidCancelledOrderScannerAdapter';

type Call = [string, unknown[]];

/** 記下每一個鏈式呼叫,讓測試問得出「那道 .neq 到底送出去了沒」。 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'not', 'is', 'gte', 'in', 'order', 'limit']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  (b as { then: unknown }).then = (res: (v: unknown) => unknown) => res(result);
  return { b, calls };
}

// 🔴 2026-09-05:掃描面改成 view ⇒ 分流的鍵從 `'orders'` 換成那個 view 名。
//    🛑 而 `from` 改成 `vi.fn()` **是承重的**:有一格要斷言「只打一發、而且打的是那個 view」,
//      而舊版那個裸箭頭函式**記不下被叫過幾次、用什麼參數**。
function makeClient(orders: ReturnType<typeof makeBuilder>, customers: ReturnType<typeof makeBuilder>) {
  const from = vi.fn((t: string) =>
    t === 'pcm_unpaid_cancelled_email_pending' ? orders.b : customers.b,
  );
  // 🔵 `client` 對 adapter 是 `never`(生成型別那一側), 而 `from` 這支 spy 要拿得到
  //    ⇒ 分開回傳, 不要叫呼叫端去 `client.from` 挖(那在型別上過不了)。
  return { client: { from } as never, from };
}

// 🔴 2026-09-05(⟦b4-NORECIPIENTWINDOW⟧ 甲 · 第二條線):改成 **view** 的欄。
const ORDER = {
  order_id: 'order-1',
  display_id: 'PCM-2026-0001',
  cancelled_at: '2026-09-03T10:00:00.000Z',
  cancelled_reason: 'out_of_stock',
  created_at: '2026-09-03T09:00:00.000Z',
  notification_email: 'a@example.com',
  customer_email: null,
  order_source: 'manual_phone',
};

const IN = { cutoff: '2026-09-03T00:00:00.000Z', limit: 50 };

function argsOf(calls: Call[], method: string): unknown[][] {
  return calls.filter(([m]) => m === method).map(([, a]) => a);
}

describe('SupabaseUnpaidCancelledOrderScannerAdapter — 射程(而它靠一個住在【另一支檔】的字面)', () => {
  // 🔴🔴 **這一族釘的是「這封信寄給誰」** ——
  //    判準靠「逾時自動取消寫的是 `payment_expired` 這個字面」
  //    (`20260828060000_..._expire_unpaid_orders_heartbeat.sql:233-235`)。
  //    ⇒ 🛑 **那個字面住在另一支檔** ⇒ 有人改它、或加第八個員工理由叫 payment_expired
  //      ⇒ **這道閘會安靜地換一批收件人, 而沒有東西會叫。**
  //    ⇒ ✅ 所以三個世界都釘住。
  // 🔴🔴 **2026-09-05:射程那道判準【搬進 view】了。**
  //    ⇒ 它現在是 view 裡的 `EXISTS (SELECT 1 FROM order_cancellations …)`,
  //      而不是這一層 select 字串裡的 `!inner`。
  //    ✅ **守門跟著搬**:`20260905030000` 的 apply 期**釘樁②**逐字找 `order_cancellations`,
  //      找不到就 RAISE, 而訊息說出後果(逾時那批會收到信, 而 Sean 2026-09-03 拍過不寄)。
  //    ⛔ ~~**而換成 EXISTS 還解掉一件 `!inner` 帶著的風險**:`!inner` 對一對多會複製父列~~
  //    🔴 **那句是假的**(codex 2026-09-05, 附官方文件):PostgREST 的 to-many embed
  //      回的是父物件 + 子陣列, **不複製父列** ⇒ 兩者的父列集合本來就相同。
  //    ✅ 換成 EXISTS 仍然對, 理由是「這個 view 是 SQL, 而 SQL 裡沒有 embed 這個東西」。
  it('🔴 射程那道判準【不在這一層了】—— 而毒字面一個都不准回來', async () => {
    // 🔴🔴 **判準換過一次, 而換的理由要留在測試裡**:
    //    ⛔ 第一版用 `.neq('cancelled_reason', 'payment_expired')`
    //      ⇒ codex 打穿:員工選 `other` 時那一欄**就是他打的字**(a8a1 `:129-136`)
    //      ⇒ 他打 `payment_expired` ⇒ 他的取消被判成逾時 ⇒ **信安靜地不寄**
    //    📌 **判準的種類錯了 —— 拿【內容】當【身分】。**
    //    ✅ 換成問「`order_cancellations` 那一列在不在」:員工取消(a8a1)會寫那一列,
    //      逾時那條**一列都不寫** ⇒ 而**它存不存在由哪一支函式跑過決定, 不由任何人填**。
    // 🎯 而過濾**現在由 view 做** ⇒ 這一格要驗的變成:**那三個毒字面一個都不准回到這一層**。
    const orders = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [], error: null });
    await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers).client,
    ).listUnpaidCancelledWithoutEmail(IN);
    const sel = String(argsOf(orders.calls, 'select')[0]?.[0]);
    // 🔴 承重:它們回來就代表有人把判準搬回這一層 ——
    //    而搬回來的那一版**不會**有 view 那道 apply 期釘樁在守。
    expect(sel).not.toContain('order_cancellations');
    expect(sel).not.toContain('email_outbox');
    expect(argsOf(orders.calls, 'eq')).toEqual([]);
    expect(argsOf(orders.calls, 'not')).toEqual([]);
    // 🟢 正對照:它確實去讀了那個 view(否則上面四行在「什麼都沒發」時也會綠)。
    expect(sel).toContain('customer_email');
    expect(sel).toContain('cancelled_reason');
    // 🔴 而【不得】再有那道舊的 reason 過濾 —— 它是被推翻的那個判準
    expect(argsOf(orders.calls, 'neq')).not.toContainEqual([
      'cancelled_reason',
      'payment_expired',
    ]);
  });

  // 🔴🔴 **2026-09-05:本格【證不到它原本要證的東西了】, 而那要說出來而不是靜靜留著。**
  //    它原本靠「`!inner` 的字面在 select 裡」當證據;而那個字面搬進 view 之後,
  //    這一層**沒有任何東西**在表達「逾時那批要被濾掉」。
  //    ⇒ 🛑 留著一格餵空資料、斷言空結果的測試 ⇒ **在「濾對了」與「完全沒濾」印同一個綠**
  //      —— 而那正是本檔 code-reviewer must-fix 5 當初打掉的那個形狀。
  //    ✅ **它的守門搬到 `20260905030000` 的釘樁②**(逐字找 `order_cancellations`,
  //      找不到就 RAISE 並說出後果)。
  //    🔵 本格改成守一件這一層【還答得出來】的事:**adapter 打的是那個 view, 不是 orders。**
  it('🔴 ① 打的是那個 view —— 而「逾時不寄」那道判準已經不在這一層(見 view 的釘樁②)', async () => {
    // ⚠️ **這一格證得到的東西比它的舊版【更少】, 而那是誠實的**:
    //    過濾語意在 view 裡, 而 mock 不執行 SQL ⇒ 這一層只答得出「它去讀了誰」。
    const orders = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [], error: null });
    const { client, from } = makeClient(orders, customers);
    const r = await new SupabaseUnpaidCancelledOrderScannerAdapter(
      client,
    ).listUnpaidCancelledWithoutEmail(IN);
    expect(r.rows).toStrictEqual([]);
    // 🔴 承重:打錯表(例如有人改回 'orders')⇒ 這一行紅;
    //    而**只打一發**也在這一行裡(第二發回來 ⇒ 陣列變兩個元素)。
    expect(from.mock.calls.map(([t]) => t)).toEqual(['pcm_unpaid_cancelled_email_pending']);
  });

  it('🟢 ② 員工理由(out_of_stock)⇒ 原樣傳出去(而現在只打一發查詢)', async () => {
    const orders = makeBuilder({ data: [ORDER], error: null });
    const customers = makeBuilder({ data: [], error: null });
    const r = await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers).client,
    ).listUnpaidCancelledWithoutEmail(IN);
    expect(r.rows.map((x) => x.orderId)).toStrictEqual(['order-1']);
    expect(r.rows[0]?.cancelledReason).toBe('out_of_stock');
  });

  it('🔴 ③ 員工在 other 打了 `payment_expired` ⇒ **仍然必須被撈進來**', async () => {
    // 🎯 **這一格釘住的是「我用的是【排除法】, 不是白名單」** ——
    //    排除法的預設是「其餘都寄」。⇒ 哪天有人加了第八個理由而【不該寄】,
    //    這一格會逼他來看這裡, 而不是靜靜地多寄一批。
    // 🎯 **這一格就是舊判準死掉的地方** —— 舊版會把他判成逾時而不寄。
    //    新判準不看這一欄 ⇒ 他照樣收得到信。
    const orders = makeBuilder({
      data: [{ ...ORDER, cancelled_reason: 'payment_expired' }],
      error: null,
    });
    const customers = makeBuilder({ data: [{ user_id: 'user-1', email: null }], error: null });
    const r = await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers).client,
    ).listUnpaidCancelledWithoutEmail(IN);
    expect(r.rows.map((x) => x.orderId)).toStrictEqual(['order-1']);
  });

  it('🟢 `cancelled_reason` 是 NULL ⇒ **照樣被撈進來**(新判準根本不讀那一欄)', async () => {
    // 🔴🔴 **本格【翻面了】, 而舊版是在替一個不存在的行為背書**(code-reviewer must-fix 4):
    //    ⛔ ~~舊標題:「`cancelled_reason` 是 NULL ⇒ 靜靜地不被選中(SQL 的 `<>` 對 NULL 回 NULL)」~~
    //    ⇒ 那是**舊判準**(`.neq('cancelled_reason', …)`)的行為, 而判準換掉之後
    //      查詢**沒有任何述詞讀那一欄** ⇒ 那種列**會**被撈進來, 而 use-case 與模板都正確處理 null。
    //    📌 **⇒ 一格測試在替一個【已經不存在】的不變式背書 —— 而它是綠的。**
    const orders = makeBuilder({
      data: [{ ...ORDER, cancelled_reason: null }],
      error: null,
    });
    const customers = makeBuilder({ data: [{ user_id: 'user-1', email: null }], error: null });
    const r = await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers).client,
    ).listUnpaidCancelledWithoutEmail(IN);
    expect(r.rows.map((x) => x.orderId)).toStrictEqual(['order-1']);
    expect(r.rows[0]?.cancelledReason).toBeNull();
  });

  it('🔴 cutoff 兩端都卡(cancelled_at 與 created_at)—— 少一半, 很舊的單今天被取消就會寄', async () => {
    const orders = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [], error: null });
    await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers).client,
    ).listUnpaidCancelledWithoutEmail(IN);
    const gte = argsOf(orders.calls, 'gte');
    expect(gte).toContainEqual(['cancelled_at', IN.cutoff]);
    expect(gte).toContainEqual(['created_at', IN.cutoff]);
  });

  it('🔴 錯誤訊息零 PII(只帶 stage 與 provider 碼)', async () => {
    const orders = makeBuilder({ data: null, error: { code: 'PGRST999', message: 'a@example.com 出事' } });
    const customers = makeBuilder({ data: [], error: null });
    await expect(
      new SupabaseUnpaidCancelledOrderScannerAdapter(
        makeClient(orders, customers).client,
      ).listUnpaidCancelledWithoutEmail(IN),
    ).rejects.toThrow(/orders\/PGRST999/);
    await expect(
      new SupabaseUnpaidCancelledOrderScannerAdapter(
        makeClient(orders, customers).client,
      ).listUnpaidCancelledWithoutEmail(IN),
    ).rejects.not.toThrow(/@example\.com/);
  });
});

// ══ 片 B(⟦f3-MAILFALLBACKVSRULING⟧, 2026-09-05)——「撈得到 order_source」════════
// 🔴 **兩個宣稱, 各一格**:①它在 select 字串裡 ②它真的走到 port 物件上。
//    少了②, 一個「加進 select 而忘了對映」的實作【第①格照樣綠】。
// 🔵 而 fixture 刻意用 'manual_phone' 不用 'web' —— 一個把它寫死成 'web' 的對映
//    在 'web' 的 fixture 上完全看不出來。
describe('片 B:order_source 接出來了', () => {
  it('①select 字串帶了它, 而②它走到 port 物件上', async () => {
    const orders = makeBuilder({ data: [ORDER], error: null });
    const customers = makeBuilder({ data: [], error: null });
    const { client } = makeClient(orders, customers);
    const r = await new SupabaseUnpaidCancelledOrderScannerAdapter(
      client,
    ).listUnpaidCancelledWithoutEmail(IN);
    const sel = String(orders.calls.find(([m]) => m === 'select')?.[1]?.[0] ?? '');
    expect(sel).toContain('order_source');
    expect(r.rows[0]?.orderSource).toBe('manual_phone');
  });
});
