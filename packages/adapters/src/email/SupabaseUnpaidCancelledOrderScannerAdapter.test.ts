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

function makeClient(orders: ReturnType<typeof makeBuilder>, customers: ReturnType<typeof makeBuilder>) {
  return {
    from: (t: string) => (t === 'orders' ? orders.b : customers.b),
  } as never;
}

const ORDER = {
  id: 'order-1',
  display_id: 'PCM-2026-0001',
  cancelled_at: '2026-09-03T10:00:00.000Z',
  cancelled_reason: 'out_of_stock',
  notification_email: 'a@example.com',
  customer_user_id: 'user-1',
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
  it('🔴 射程那道【真的送出去了】—— 而它是 select 裡的 `!inner`, 不是一個 filter', async () => {
    // 🔴🔴 **判準換過一次, 而換的理由要留在測試裡**:
    //    ⛔ 第一版用 `.neq('cancelled_reason', 'payment_expired')`
    //      ⇒ codex 打穿:員工選 `other` 時那一欄**就是他打的字**(a8a1 `:129-136`)
    //      ⇒ 他打 `payment_expired` ⇒ 他的取消被判成逾時 ⇒ **信安靜地不寄**
    //    📌 **判準的種類錯了 —— 拿【內容】當【身分】。**
    //    ✅ 換成問「`order_cancellations` 那一列在不在」:員工取消(a8a1)會寫那一列,
    //      逾時那條**一列都不寫** ⇒ 而**它存不存在由哪一支函式跑過決定, 不由任何人填**。
    // 🎯 而過濾是 `!inner` 這個 join 自己做的 ⇒ **這一格要驗的是那個字面在 select 裡**。
    const orders = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [], error: null });
    await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers),
    ).listUnpaidCancelledWithoutEmail(IN);
    const sel = String(argsOf(orders.calls, 'select')[0]?.[0]);
    expect(sel).toContain('order_cancellations!inner');
    // 🟢 而 payment_status 那一半也要在 —— 少了它會撈到已付款的單
    expect(argsOf(orders.calls, 'eq')).toContainEqual(['payment_status', 'unpaid']);
    // 🔴 而【不得】再有那道舊的 reason 過濾 —— 它是被推翻的那個判準
    expect(argsOf(orders.calls, 'neq')).not.toContainEqual([
      'cancelled_reason',
      'payment_expired',
    ]);
  });

  it('🔴 ① 逾時取消 ⇒ 不得被撈進來 —— 而【它是被 `!inner` 濾掉的】', async () => {
    // 🛑🛑 **本格舊版餵 `data: []` 再斷言 `rows === []` ⇒ 在「濾對了」與「完全沒濾」
    //    兩個世界印同一個綠 —— 壞不掉**(code-reviewer must-fix 5)。
    //    ✅ 改法:**餵一筆真的資料, 而它模擬 DB 端 `!inner` 把它濾掉之後的結果** ——
    //    而「那道 `!inner` 真的送出去了」由上面那格 select 字面斷言證。
    //    ⚠️ **這一格證得到的東西有限, 而那要說出來**:mock 不執行 PostgREST 的 join,
    //      所以**真正的過濾語意只有正式庫對照得了**(見本檔尾的效度限定)。
    const orders = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [], error: null });
    const r = await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers),
    ).listUnpaidCancelledWithoutEmail(IN);
    expect(r.rows).toStrictEqual([]);
    // 🟢 而【那道 join 的字面在不在】才是這一格真正守得住的東西
    const sel = String(argsOf(orders.calls, 'select')[0]?.[0]);
    expect(sel).toContain('order_cancellations!inner');
  });

  it('🟢 ② 員工理由(out_of_stock)⇒ 必須被撈進來', async () => {
    const orders = makeBuilder({ data: [ORDER], error: null });
    const customers = makeBuilder({ data: [{ user_id: 'user-1', email: null }], error: null });
    const r = await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers),
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
      makeClient(orders, customers),
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
      makeClient(orders, customers),
    ).listUnpaidCancelledWithoutEmail(IN);
    expect(r.rows.map((x) => x.orderId)).toStrictEqual(['order-1']);
    expect(r.rows[0]?.cancelledReason).toBeNull();
  });

  it('🔴 cutoff 兩端都卡(cancelled_at 與 created_at)—— 少一半, 很舊的單今天被取消就會寄', async () => {
    const orders = makeBuilder({ data: [], error: null });
    const customers = makeBuilder({ data: [], error: null });
    await new SupabaseUnpaidCancelledOrderScannerAdapter(
      makeClient(orders, customers),
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
        makeClient(orders, customers),
      ).listUnpaidCancelledWithoutEmail(IN),
    ).rejects.toThrow(/orders\/PGRST999/);
    await expect(
      new SupabaseUnpaidCancelledOrderScannerAdapter(
        makeClient(orders, customers),
      ).listUnpaidCancelledWithoutEmail(IN),
    ).rejects.not.toThrow(/@example\.com/);
  });
});
