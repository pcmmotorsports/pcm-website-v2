import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  listRefundExceptions: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock('../payment/refund-read', () => ({
  listRefundExceptions: mocks.listRefundExceptions,
}));

import { TODAY_SECTION, loadTodaySummary } from './today-read';

// today-read.test.ts — `#16` IO 層的**查詢形狀**與**逐格失敗**守門。
//
// 🔴 **這支的存在本身就是一條 finding 的產物**:第一版宣稱「`server-only` 在 vitest 會 throw
//    ⇒ 這層測不到」,那是假的(repo 有 90 支測試檔 mock 它)。做法逐字抄同一條線的隔壁:
//    `lib/payment/refund-recovery-read.test.ts:1-10`。
//
// 🔴 **誠實邊界**:鏈式 mock 只證「**本層送出什麼形狀**」—— **不證** PostgREST/DB 行為、
//    不證那些欄在 DB 上真的存在、不證 RPC 真的存在或真的回對的數。
//    真資料路徑的證據**不在本檔**,而目前也**還沒有人取得過**。
// ⚠️ **2026-08-15 09:3x 補注(不要把這條讀成已解決)**:那支 migration 已 apply 到正式庫且成功,
//    ⇒ **「RPC 真的存在」現在成立了**(檔尾五道閘 fail-closed,沒中止就是全過)。
//    🔴 **但「真的回對的數」仍然零證據** —— apply 證的是**結構**,不是**資料**。
//    ⇒ 原句「`#16` 全程零正式庫查詢」**仍為真**:至今沒有人對正式庫跑過一次 `SELECT` 看真數字。

/** 記錄每個 table 收到的鏈式呼叫,讓斷言可以看「送出去的形狀」。 */
function makeChain(result: {
  data?: unknown[];
  count?: number;
  error?: unknown;
  reject?: unknown;
  /**
   * 🔴🔴 **原樣直傳 `count`,繞過下面那句 `?? null`**。
   *
   * **這是「替身把要驗的東西兜掉」在本檔的第三次**,而且**就長在我為了防第二次而寫的那格裡**:
   *   第一次 `?? 0`(讓「count 是 null」永遠測不到)→ 已在下面留警告
   *   第二次 `over.orderCount === undefined ? 0 : …`(讓「count 是 undefined」被兜成 0)→ 加了 `orderCountRaw`
   *   第三次 **`count: result.count ?? null`** ——`orderCountRaw` 送進來的 `undefined`
   *          **在替身自己這一層又被吃成 `null`** ⇒ 標籤寫「undefined(欄根本沒回來)」,
   *          實際送到被測函式的是 `null`,**與同組的 null 案例是同一條路徑的重複測試**。
   *
   * 🔴 **三次的寫法都不一樣**(`?? 0` / 三元 / `?? null`)——
   *    **所以「在旁邊寫警告」攔不住下一次:下一次長得不像上一次。**
   *    ⇒ 唯一有效的修法是**讓管道本身有一條「原樣直傳」的路**,而不是每次都補一句提醒。
   * ⚠️ 付款側沒有這個病:`paymentRows` 是直傳的,所以那組 `undefined` 案例一直是真的。
   */
  countRaw?: { value: unknown };
}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  // 🔴 `lte` 與 `order` 是**故意列進來的**:前者是「不得用閉區間」那格的靶,
  //    後者是 R2 nit1 的靶 —— 沒列進來的話,呼叫端一加就 TypeError,那是假紅不是守門。
  for (const fn of ['select', 'eq', 'gte', 'lt', 'lte', 'order', 'limit']) {
    chain[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
  }
  // 🔴 `reject` 是 MF3 的靶:builder **在 transport 層 reject**,而不是回 `{ error }`。
  //    ⚠️ 必須做在 `chain.then` 本體上 —— 鏈式方法一律回傳**同一個** `chain`,
  //       在外面 spread 一份覆寫 `then` 會被第一個 `.select()` 換回原件(我第一版就是這樣紅的)。
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    result.reject !== undefined && reject
      ? reject(result.reject)
      : resolve({
          data: result.data ?? null,
          // 🔴 `countRaw` 在 `??` **之前**攔截 —— 它的存在理由就是不被任何兜底改寫。
          count: result.countRaw ? result.countRaw.value : (result.count ?? null),
          error: result.error ?? null,
        });
  return { chain, calls };
}

type Over = {
  paymentTotal?: number | null;
  paymentRowCount?: number;
  paymentError?: unknown;
  paymentRows?: unknown[];
  orderCount?: number | null;
  orderError?: unknown;
  exceptionsReject?: unknown;
  /** 🔴 transport 層 reject(網路斷 / DNS / abort)—— 不是 `{ error }`,是真的 reject(MF3)。 */
  rpcReject?: unknown;
  ordersReject?: unknown;
  /**
   * 🔴 **繞過 `orderCount` 的正規化,原樣送進替身**。
   *    存在理由:`orderCount` 那條為了區分「沒指定」與「指定成 null」用了
   *    `=== undefined ? 0 : ...` ⇒ **想測「`count` 真的是 `undefined`」時,替身會先把它兜成 0**,
   *    那格於是恆綠。**又一次「替身自己把要驗的東西兜掉」**(同檔上面那條註解講的是同一件事)。
   */
  orderCountRaw?: { value: unknown };
};

function setup(over: Over = {}) {
  // 🔴 `?? 0` 會讓「`count` 是 null」那格永遠測不到 —— **替身自己把要驗的東西兜掉了**。
  //    要區分「沒指定」與「指定成 null」,只能用 `undefined` 判斷。
  const orders = makeChain({
    count: over.orderCount === undefined ? 0 : (over.orderCount ?? undefined),
    countRaw: over.orderCountRaw,
    error: over.orderError,
    reject: over.ordersReject,
  });
  mocks.from.mockImplementation((table: string) => {
    // 🔴 `order_refunds` 刻意**不再列進來** —— 2026-08-15 拆掉退款那格之後,
    //    若有人把撈列加總的實作加回來,這裡會擲「未預期的 table」⇒ **當場紅,不是靜默通過**。
    if (table === 'orders') return orders.chain;
    // 🔴 收款**不得**再走 `.from()` —— 走到這裡就是 MF-A 回來了(直查零表權的表 ⇒ 上線 42501)。
    throw new Error(`未預期的 table:${table}`);
  });
  const rpcCalls: unknown[][] = [];
  mocks.rpc.mockImplementation((...args: unknown[]) => {
    rpcCalls.push(args);
    // 🔴 MF3 的靶:RPC 在 transport 層 reject。
    if (over.rpcReject !== undefined) return Promise.reject(over.rpcReject);
    return Promise.resolve({
      data:
        over.paymentRows ??
        (over.paymentError
          ? null
          : [{ total: over.paymentTotal ?? 0, row_count: over.paymentRowCount ?? 0 }]),
      error: over.paymentError ?? null,
    });
  });
  if (over.exceptionsReject) {
    mocks.listRefundExceptions.mockRejectedValue(over.exceptionsReject);
  } else {
    mocks.listRefundExceptions.mockResolvedValue({ rows: [], truncated: false });
  }
  return { orders, rpcCalls };
}

const NOW = new Date('2026-08-14T04:00:00Z'); // 台北 2026-08-14 12:00
const FROM = '2026-08-14T00:00:00+08:00';
const TO = '2026-08-15T00:00:00+08:00';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ══ 🔴🔴 替身自己的健全性測試 ═══════════════════════════════════════════════
//    **本檔的替身已經三次把「要驗的東西」在半路兜掉**(`?? 0` / 三元 / `?? null`),
//    每次都讓一格測試名實不符:標籤寫著送 `undefined`,實際送到的是 `0` 或 `null`。
//    🔴 **三次的寫法都不一樣 ⇒ 在旁邊加更大聲的警告攔不住第四次。**
//    ⇒ 改成**斷言管道本身**:送什麼進去,就要有什麼出來。
//    ⚠️ 這一格壞掉時,上面所有「count 是 X」的測試都會變成名實不符而**照樣全綠** ——
//       那正是它存在的理由。
describe('替身健全性 — 送進去的值要原樣到得了被測函式', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['字串 "abc"', 'abc'],
    ['數字 0', 0],
  ])('🔴 `countRaw` 送 %s ⇒ 替身 resolve 出來的就是同一個值(不被任何 ?? 兜底改寫)', async (_l, v) => {
    const { chain } = makeChain({ countRaw: { value: v } });
    const out = (await (chain as unknown as PromiseLike<{ count: unknown }>)) as { count: unknown };
    expect(out.count).toBe(v);
  });

  it('✅ 正向對照:沒給 `countRaw` 時,`count` 走原本的兜底路徑(證明上面不是恆真)', async () => {
    const { chain } = makeChain({ count: 7 });
    const out = (await (chain as unknown as PromiseLike<{ count: unknown }>)) as { count: unknown };
    expect(out.count).toBe(7);
    const empty = makeChain({});
    const outEmpty = (await (empty.chain as unknown as PromiseLike<{ count: unknown }>)) as { count: unknown };
    expect(outEmpty.count).toBeNull(); // ← 沒給就是 null，這條兜底仍然在
  });
});

describe('loadTodaySummary — 查詢形狀', () => {
  it('🔴 MF-A:收款走 RPC、**不得**直查 `order_payments`(零表權 ⇒ 上線必 42501)', async () => {
    const { rpcCalls } = setup({ paymentTotal: 12345, paymentRowCount: 7 });
    const out = await loadTodaySummary(NOW);
    expect(rpcCalls).toEqual([['admin_today_payment_total', { p_from: FROM, p_to: TO }]]);
    expect(out.receivedAmount).toBe(12345);
    // 突變靶:改回 `.from('order_payments')` ⇒ setup 的 `from` 會擲「未預期的 table」。
    expect(mocks.from).not.toHaveBeenCalledWith('order_payments');
  });

  // 🪦 「退款用 `confirmed_at` + 只算 `confirmed`」那格隨查詢一起刪掉(2026-08-15)。
  //    ⚠️ 它守的 **「時點欄要取事情真的發生的那一刻、不是列被建出來的那一刻」** 仍然有效,
  //       而收款那邊由 RPC 的 `received_at` 在 SQL 端擁有(migration `:98-99`)。

  it('🔴 新單用半開區間 `gte`/`lt`、**不得**用 `.lte`(退款那格拆掉後,這條守門搬到這裡)', async () => {
    // 🔴 **這格是從退款那格搬過來的,不是新加的**:原本的靶在 `order_refunds` 的鏈上,
    //    而那條查詢 2026-08-15 拆掉了。**直接刪掉會讓「半開區間」這條原則在本檔零覆蓋**
    //    —— 那就是「修好一半、順手掏空另一半」。⇒ 改釘還活著的 `orders` 查詢。
    const { orders } = setup();
    await loadTodaySummary(NOW);
    expect(orders.calls.some((c) => c.fn === 'lte')).toBe(false);
    // 正向對照:證明這條鏈真的記得到呼叫(否則上一行對任何實作恆真)。
    expect(orders.calls.some((c) => c.fn === 'lt')).toBe(true);
    expect(
      orders.calls.filter((c) => c.fn === 'gte' || c.fn === 'lt').map((c) => [c.args[0], c.args[1]]),
    ).toEqual([
      ['created_at', FROM],
      ['created_at', TO],
    ]);
  });

  it('新單只數筆數、不搬列', async () => {
    const { orders } = setup({ orderCount: 7 });
    const out = await loadTodaySummary(NOW);
    expect(orders.calls).toContainEqual({
      fn: 'select',
      args: ['id', { count: 'exact', head: true }],
    });
    expect(out.newOrderCount).toBe(7);
  });

  // 🪦 退款那格的兩格守門(`.order()` + `.limit(N+1)` / 上限嚴格低於 max-rows)
  //    隨查詢本身於 2026-08-15 一起刪掉。
  //    🔴 **`toBeLessThan(1000)` 那格特別要記著它為什麼存在**:它守的不是「剛好 500」,
  //       是「**嚴格低於伺服器上限**」—— 寫成 `toBe(500)` 的話,有人改回 1000 只是換個數字,
  //       看不出那會讓截斷旗標**恆假**。**退款那格若又用撈列加總,這格必須一起回來。**
});

// 🔴 **逐格失敗**(R2 nit7):一支掛掉只讓**那一格**變 `null`,另外兩格照常有值。
//    🪦 原本是「另外三格」—— 退款那格 2026-08-15 拆掉。
//    上一版是「任一失敗就整段拋」⇒ 退款查詢掛掉會連帶蓋掉**今天收了多少錢**,而那格明明是好的。
//    🔴 但 `null` **絕不能被兜成 0** —— 那才是這一區最怕的「安靜的錯數字」。
describe('loadTodaySummary — 各格各自獨立失敗', () => {
  it('收款掛 ⇒ 只有收款是 null,其餘照常', async () => {
    setup({ paymentError: new Error('boom'), orderCount: 5 });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBeNull();
    expect(out.failedSections).toEqual([TODAY_SECTION.received]);
    expect(out.newOrderCount).toBe(5);
  });

  // 🪦 「退款掛 ⇒ 只有退款是 null」那格隨退款查詢一起刪掉(2026-08-15)。
  //    ⚠️ 它守的原則 **「絕不把讀取失敗兜成 0」仍然有效**,而且仍有守門:
  //       同 describe 的「收款掛」「新單掛」「`count` 是 null 也算失敗」「RPC 回空陣列」四格。
  //    ⇒ **原則沒被掏空,只是少了退款那個載體。**

  it('新單掛 ⇒ 只有新單是 null', async () => {
    setup({ orderError: new Error('boom'), paymentTotal: 999 });
    const out = await loadTodaySummary(NOW);
    expect(out.newOrderCount).toBeNull();
    expect(out.failedSections).toEqual([TODAY_SECTION.newOrders]);
    expect(out.receivedAmount).toBe(999);
  });

  it('🔴 `count` 是 null 也算失敗 —— 不得兜成 0', async () => {
    setup({ orderCount: null });
    const out = await loadTodaySummary(NOW);
    expect(out.newOrderCount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.newOrders);
  });

  it('異常清單那支 reject ⇒ 只有那格 null(它是會 reject 的,不像 builder 回 error)', async () => {
    setup({ exceptionsReject: new Error('boom'), paymentTotal: 999 });
    const out = await loadTodaySummary(NOW);
    expect(out.refundExceptionCount).toBeNull();
    expect(out.failedSections).toEqual([TODAY_SECTION.exceptions]);
    expect(out.receivedAmount).toBe(999);
  });

  // ══ codex 關卡2 MF1/MF2:`Number(null)` / `Number('')` 都是 `0` ══════════════
  //    🔴 **這組與今早 SQL 端的 `STRICT` 是同一個病、只是換一層**:
  //       SQL 層 参數 NULL ⇒ 零列 ⇒ `COALESCE` 包成一列 0;應用層 `total` null ⇒ `Number(null)` ⇒ 0。
  //       **兩層都會產生「今天沒收到錢」這個假訊息**,而這格是要拿來對帳的。
  //    突變靶:把 `readRpcInteger(paymentRow.total)` 改回 `Number(paymentRow.total)` ⇒ 下面全紅。
  it.each([
    ['null', null],
    ['空字串', ''],
    ['undefined(欄根本沒回來)', undefined],
    ['布林 false', false],
    ['非數字字串', 'NaN'],
  ])('🔴🔴 `total` 是 %s ⇒ 那格是 null,**絕不是 0**', async (_label, bad) => {
    setup({ paymentRows: [{ total: bad, row_count: 0 }] });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.received);
  });

  it('🔴 `total` 超過 MAX_SAFE_INTEGER ⇒ 那格是 null(顯示一個已經失真的數字比空著更糟)', async () => {
    // ⚠️ 限度誠實話:精度其實在 `JSON.parse` 那一刻就掉了,本守門**救不回真值** ——
    //    它只保證「不把一個已經錯掉的數字當成對的顯示出去」。
    setup({ paymentRows: [{ total: Number.MAX_SAFE_INTEGER + 2, row_count: 0 }] });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.received);
  });

  it('✅ 正向對照:`total` 真的是 0 ⇒ 顯示 0、**不算失敗**(否則上面幾格是恆真的)', async () => {
    setup({ paymentTotal: 0 });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBe(0);
    expect(out.failedSections).toEqual([]);
  });

  it('✅ 正向對照:`total` 是數字字串 "12345"(bigint 被序列化成字串)⇒ 讀得出來', async () => {
    setup({ paymentRows: [{ total: '12345', row_count: 0 }] });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBe(12345);
  });

  // ══ codex 關卡2 MF3:transport 層 reject ⇒ `Promise.all` 整包倒 ═════════════
  //    突變靶:把 `settle(...)` 拿掉 ⇒ 下面兩格會變成「整個函式拋」而不是「那一格 null」。
  it('🔴🔴 RPC 在 transport 層 reject ⇒ 只有收款是 null,**整頁不倒**', async () => {
    setup({ rpcReject: new Error('fetch failed'), orderCount: 5 });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.received);
    // 本體:另外兩格照常有值 —— 這正是「逐格獨立失敗」的設計,transport 層不該讓它失效。
    expect(out.newOrderCount).toBe(5);
    expect(out.refundExceptionCount).toBe(0);
  });

  // ══ codex R2 nit1:`count` 只擋 `null` ⇒ `undefined` / 型別不對會漏成畫面上的「0 筆」══
  //    突變靶:改回 `orders.count === null ? fail(...) : orders.count` ⇒ 下面前兩格紅。
  it.each([
    ['undefined(欄根本沒回來)', undefined],
    ['字串 "abc"', 'abc'],
    ['布林 true', true],
  ])('🔴 `count` 是 %s ⇒ 新單那格是 null,**不是 0**', async (_label, bad) => {
    setup({ orderCountRaw: { value: bad } });
    const out = await loadTodaySummary(NOW);
    expect(out.newOrderCount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.newOrders);
  });

  it('✅ 正向對照:`count` 真的是 0 ⇒ 顯示 0、**不算失敗**(否則上面三格對「永遠失敗」也綠)', async () => {
    setup({ orderCount: 0 });
    const out = await loadTodaySummary(NOW);
    expect(out.newOrderCount).toBe(0);
    expect(out.failedSections).toEqual([]);
  });

  // ══ codex R2 nit2:錯誤訊息裡的 `JSON.stringify()` 自己會拋 ═════════════════
  //    🔴 **防禦性訊息本身變成新的失敗來源** ⇒ 一格的壞資料讓整個函式拋
  //       ⇒ 破壞 MF3 剛修好的「單格失敗隔離」。
  //    突變靶:把 `describe(...)` 改回 `JSON.stringify(...)` ⇒ 下面兩格紅(會擲 TypeError)。
  it('🔴 `total` 是 bigint(`JSON.stringify` 會擲 TypeError)⇒ 仍只是那格 null,整頁不倒', async () => {
    setup({ paymentRows: [{ total: 10n }], orderCount: 5 });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.received);
    // 本體:隔離沒被破壞 —— 另一格照常有值。
    expect(out.newOrderCount).toBe(5);
  });

  it('🔴 `total` 是循環物件(`JSON.stringify` 會擲)⇒ 同樣只是那格 null', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    setup({ paymentRows: [{ total: circular }], orderCount: 5 });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBeNull();
    expect(out.newOrderCount).toBe(5);
  });

  it('🔴 新單查詢在 transport 層 reject ⇒ 只有新單是 null,收款照常', async () => {
    setup({ ordersReject: new Error('network down'), paymentTotal: 999 });
    const out = await loadTodaySummary(NOW);
    expect(out.newOrderCount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.newOrders);
    expect(out.receivedAmount).toBe(999);
  });

  it('🔴 RPC 回空陣列 ⇒ 算失敗,**不得**當成「今天收 0 元」', async () => {
    // RPC 恆回一列(SQL 端 `COALESCE` 保證)⇒ 回不出來就是有事。
    // 把它讀成 0 = 一個看起來完全正常的、今天還沒收到錢的早上。
    setup({ paymentRows: [] });
    const out = await loadTodaySummary(NOW);
    expect(out.receivedAmount).toBeNull();
    expect(out.failedSections).toContain(TODAY_SECTION.received);
  });

  it('三支都正常 ⇒ `failedSections` 是空的(正向對照:證明上面各格不是恆真)', async () => {
    setup({ paymentTotal: 100, orderCount: 3 });
    const out = await loadTodaySummary(NOW);
    expect(out.failedSections).toEqual([]);
    expect(out.receivedAmount).toBe(100);
  });
});

// 🪦 `describe('loadTodaySummary — 退款截斷')` 整組(3 格)於 2026-08-15 刪掉。
//    🔴 **其中第三格「收款筆數再多也不會點亮截斷旗標」是刻意留下的負向對照**,
//       證明那個旗標**只**由退款驅動。⇒ 現在旗標本身不存在了,那格失去對象。
//    ⚠️ **重做退款那格時,截斷語意要跟著新實作重新決定,不要沿用 `amountsTruncated` 這個名字** ——
//       走 RPC 的話(正解方向)SQL 端加總、物理上沒有列可截,**根本不需要截斷旗標**。

// 🔴🔴 **源碼契約測試:錢的不變式現在住在 SQL 裡,而我跑不了 SQL。**
//    `sumReceived` 那 6 格(鏈式沖銷 / 濾負列會變 1000 / 改用筆數會變 3 / 零筆回 0 / 跨日)
//    隨 MF-A 一起被刪掉了 —— 加總搬到 RPC 之後那支純函式是死碼。
//    ⚠️ **本 describe 不是等價替代品**:它只證「那句 SQL 還在檔裡」,
//       **不證** DB 真的那樣算、不證 migration apply 得過。真要補回同等強度只有一條路:對真的 DB 跑一次。
//    但它擋得住**刪掉的那 6 格原本擋的那些突變**,而那是本機唯一做得到的觀察點。
describe('migration SQL 的錢口徑(源碼契約,非行為證明)', () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../../supabase/migrations/20260815010000_m4b_e10_16_admin_today_payment_total.sql',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  it('正向對照:檔讀得到而且是那支函式(否則下面每一條都恆真)', () => {
    expect(sql).toContain('CREATE FUNCTION public.admin_today_payment_total');
    expect(sql.length).toBeGreaterThan(1000);
  });

  it('🔴 零列回 0 不回 NULL —— `COALESCE(SUM(...), 0)`(每天早上的常態)', () => {
    expect(sql).toContain('COALESCE(SUM(p.amount), 0)');
  });

  it('🔴 沖銷列照加:不得 `ABS`、不得只算正列、不得排除沖銷列', () => {
    expect(sql).not.toContain('ABS(');
    expect(sql).not.toMatch(/amount\s*>\s*0/);
    expect(sql).not.toMatch(/reverses_payment_id\s+IS\s+NULL/i);
  });

  it('🔴 半開區間 `[p_from, p_to)` —— 不得用 `<=` 收尾', () => {
    expect(sql).toMatch(/received_at\s*>=\s*p_from/);
    expect(sql).toMatch(/received_at\s*<\s+p_to/);
    expect(sql).not.toMatch(/received_at\s*<=\s*p_to/);
  });

  it('🔴 依 `received_at` 不是 `created_at`(對帳看的是實際收到錢的時點)', () => {
    expect(sql).not.toMatch(/WHERE[\s\S]{0,120}created_at/);
  });

  it('🔴 授權四件套:SECDEF / search_path / 逐個點名 REVOKE / 只 GRANT service_role', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    // `REVOKE FROM PUBLIC` 收不掉 anon(建函式時 pg_default_acl 自動給)⇒ 必須逐個點名。
    expect(sql).toMatch(/FROM PUBLIC, anon, authenticated, authenticator/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]{0,160}TO service_role/);
  });
});
