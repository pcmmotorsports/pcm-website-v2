import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ list: vi.fn(), cookie: vi.fn() }));
vi.mock('../orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ listOrderSummariesForAdmin: mocks.list }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => mocks.cookie(name) }),
}));
import { ORDER_KEYWORD_COOKIE, encodeOrderKeywordCookie } from '../orders/order-keyword-cookie';

import { parseOrderListSearchParams } from '../orders/order-list-view';
import { frozenListHref, hrefToRaw } from '../orders/order-list-count';
import { VIEW_CHIPS, applyViewChip } from '../orders/order-toolbar-view';
import { TODO_LIST_SPECS, loadTodayTodoLists, todoListHref, unreadableTodoLists } from './today-todo-read';

// 🔴 `now` 固定,「近半年」那條預設才能被斷言成一個確定的日期(台北 2026-09-13 中午)。
const NOW = new Date('2026-09-13T04:00:00Z');

function filterSentFor(label: string) {
  const call = mocks.list.mock.calls.find((c) => (c as unknown[])[2] === label);
  // 呼叫端沒帶 label ⇒ 用回傳順序對:三格依 `TODO_LIST_SPECS` 的鍵序併發送出。
  if (call) return call[0];
  const idx = Object.values(TODO_LIST_SPECS).findIndex((s) => s.label === label);
  return mocks.list.mock.calls[idx]![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ items: [], total: 4 });
  mocks.cookie.mockReturnValue(undefined);
});

describe('loadTodayTodoLists · 四格 = 網址 → 列表頁讀法 → 同一支查詢的 total', () => {
  it('🔴🔴 由構造保證:送去查的 filter === 把那格的 href 用列表頁的 parser 讀回來的 filter', async () => {
    const out = await loadTodayTodoLists(NOW);
    for (const key of ['unpaidBankTransfer', 'notOrdered', 'instock', 'partiallyPaid', 'partialArrived', 'overdueArrival'] as const) {
      const expected = parseOrderListSearchParams(hrefToRaw(out[key].href), { now: NOW }).filter;
      expect(filterSentFor(out[key].label)).toEqual(expected);
      expect(out[key].count).toBe(4);
      expect(out[key].href).toBe(todoListHref(key, NOW));
    }
    expect(mocks.list).toHaveBeenCalledTimes(6);
    for (const c of mocks.list.mock.calls) expect(c[1]).toEqual({ limit: 1, offset: 0 });
  });

  // 🔬 突變對照(主視窗要求「改掉一個篩選 ⇒ 那個數字的測試要紅」):下面三格各釘死一個軸。
  //    實跑:把 `TODO_LIST_SPECS.unpaidBankTransfer.filter.paymentChannels` 改成 `['cash']`
  //    ⇒ 只有第一格紅;把 `notOrdered` 的 `goodsAxes` 改 `['ordered']` ⇒ 只有第二格紅。
  it('待收款（匯款）= 未付款 × 銀行轉帳 × pending(排除已取消/退款),刷卡未付款不放回來、近半年預設有套', async () => {
    await loadTodayTodoLists(NOW);
    const f = filterSentFor('待收款（匯款）');
    expect(f).toMatchObject({
      paymentStatus: 'unpaid',
      paymentChannels: ['bank_transfer'],
      pendingOnly: true,
      includeUnpaidCardOrders: false,
    });
    expect(f.goodsAxes).toBeUndefined();
    // 近半年:2026-09-13 往回半年 ⇒ 2026-03-13 台北 00:00 起(列表頁同一條預設)
    expect(f.createdFrom).toBe('2026-03-13T00:00:00+08:00');
    expect(typeof f.createdTo).toBe('string');
  });

  it('待下訂 = 貨品軸 none,不帶付款軸', async () => {
    await loadTodayTodoLists(NOW);
    const f = filterSentFor('待下訂');
    expect(f.goodsAxes).toEqual(['none']);
    expect(f.paymentStatus).toBeUndefined();
    expect(f.pendingOnly).toBe(false);
  });

  it('可出貨 = 貨品軸 instock', async () => {
    await loadTodayTodoLists(NOW);
    expect(filterSentFor('可出貨').goodsAxes).toEqual(['instock']);
  });

  // Sean 2026-09-30 批「今天要做的事＋三格」;主視窗 Q2 甲:已出貨但錢沒收齊的單也算(不限貨品軸)。
  it('待尾款 = 已收訂金 × pending(排除已取消/退款),不限貨品軸、不限付款管道', async () => {
    await loadTodayTodoLists(NOW);
    const f = filterSentFor('待尾款');
    expect(f).toMatchObject({ paymentStatus: 'partiallyPaid', pendingOnly: true });
    expect(f.goodsAxes).toBeUndefined();
    expect(f.paymentChannels).toBeUndefined();
    expect(f.createdFrom).toBe('2026-03-13T00:00:00+08:00');
  });

  // 🆕 2026-09-30:每一格連到自己的待辦模式(`todo=`, 顯示軸;上面第一格證了讀回來的 filter 不受它影響)。
  it('有貨可先出 = partialArrivedOnly(view 欄 has_arrived_unshipped, 貼板 255), 不帶貨品軸 / 付款軸', async () => {
    await loadTodayTodoLists(NOW);
    const f = filterSentFor('有貨可先出');
    expect(f.partialArrivedOnly).toBe(true);
    expect(f.goodsAxes).toBeUndefined();
    expect(f.paymentStatus).toBeUndefined();
  });

  it('逾期未到 = overdueArrivalOnly(view 欄 has_overdue_arrival, 貼板 256), 不帶貨品軸 / 付款軸', async () => {
    await loadTodayTodoLists(NOW);
    const f = filterSentFor('逾期未到');
    expect(f.overdueArrivalOnly).toBe(true);
    expect(f.goodsAxes).toBeUndefined();
    expect(f.paymentStatus).toBeUndefined();
  });

  it('🔴 href 把「近半年」那段日期【寫死】(codex must-fix 2:跨午夜點進去不得換一天算);不帶密度 / page / 空參數', () => {
    const dates = 'date_from=2026-03-13&date_to=2026-09-13';
    expect(todoListHref('unpaidBankTransfer', NOW)).toBe(
      `/orders?payment_status=unpaid&payment_channel=bank_transfer&pending=1&${dates}&todo=unpaid-transfer`,
    );
    expect(todoListHref('notOrdered', NOW)).toBe(`/orders?goods_axis=none&${dates}&todo=to-order`);
    expect(todoListHref('instock', NOW)).toBe(`/orders?goods_axis=instock&${dates}&todo=ready-ship`);
    expect(todoListHref('partiallyPaid', NOW)).toBe(`/orders?payment_status=partiallyPaid&pending=1&${dates}&todo=partial-paid`);
    expect(todoListHref('partialArrived', NOW)).toBe(`/orders?partial_arrived=1&${dates}&todo=partial-ship`);
    expect(todoListHref('overdueArrival', NOW)).toBe(`/orders?overdue=1&${dates}&todo=overdue`);
    // 隔天算 ⇒ 日期跟著隔天,而昨晚產的那條網址不變(它已經是字面)
    expect(todoListHref('instock', new Date('2026-09-13T16:30:00Z'))).toBe(
      '/orders?goods_axis=instock&date_from=2026-03-14&date_to=2026-09-14&todo=ready-ship',
    );
  });

  it('🔴 列表頁的搜尋 cookie 要一起套(codex must-fix 1:列表頁不管網址帶什麼都會套它)', async () => {
    mocks.cookie.mockImplementation((name: string) =>
      name === ORDER_KEYWORD_COOKIE ? { value: encodeOrderKeywordCookie('王小明') } : undefined,
    );
    await loadTodayTodoLists(NOW);
    for (const c of mocks.list.mock.calls) expect(c[0].keyword).toBe('王小明');
  });

  it('沒有搜尋 cookie ⇒ filter 不帶 keyword 鍵(不是 keyword: undefined)', async () => {
    await loadTodayTodoLists(NOW);
    for (const c of mocks.list.mock.calls) expect('keyword' in c[0]).toBe(false);
  });

  it('🔴 一格查詢拋 ⇒ 那格 null(不是 0),另外兩格照算', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.list
      .mockResolvedValueOnce({ items: [], total: 4 })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [], total: 0 });
    const out = await loadTodayTodoLists(NOW);
    expect(out.unpaidBankTransfer.count).toBe(4);
    expect(out.notOrdered.count).toBeNull();
    expect(out.instock.count).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('🔴 total 不是安全整數(undefined / 字串)⇒ null,不是 0', async () => {
    mocks.list.mockResolvedValue({ items: [] });
    const out = await loadTodayTodoLists(NOW);
    expect(out.instock.count).toBeNull();
  });

  it('unreadableTodoLists:三格 null、label 與 href 同真身', () => {
    const u = unreadableTodoLists(NOW);
    expect(Object.keys(u)).toEqual(Object.keys(TODO_LIST_SPECS));
    expect(u.notOrdered).toEqual({
      label: '待下訂',
      href: '/orders?goods_axis=none&date_from=2026-03-13&date_to=2026-09-13&todo=to-order',
      count: null,
    });
  });
});

// 2026-09-30 名稱統一(主視窗 -fe):同一個名字要算出同一個數字。
//   首頁「待尾款」格子與訂單頁「只看:待尾款」那顆, 按下去要是同一份篩選 ⇒ 同一支查詢、同一個筆數。
//   已取消但收過訂金的單要走退款, 不是收尾款 ⇒ 兩邊都要 pendingOnly(排除已取消 / 已退款);
//   也不能疊著列表預設的「未完成」貨品軸 —— 已出貨而錢沒收齊的單正是這一格要看到的。
describe('待尾款:首頁格子 = 訂單頁只看列那顆(同一份篩選)', () => {
  const NOW = new Date('2026-09-30T02:00:00Z');
  const strip = (href: string) => {
    const u = new URL(href, 'http://x');
    u.searchParams.delete('todo');
    return [...u.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&');
  };

  it('首頁那一格帶 pendingOnly', () => {
    expect(TODO_LIST_SPECS.partiallyPaid.filter).toMatchObject({ paymentStatus: 'partiallyPaid', pendingOnly: true });
  });

  it('從訂單頁預設畫面按「待尾款」⇒ 網址與首頁格子點進去的一樣(拿掉任一邊的 pendingOnly 都會不同)', () => {
    const partial = VIEW_CHIPS.find((c) => c.key === 'partial')!;
    const listDefault = parseOrderListSearchParams({}, { now: NOW }).filter;
    const fromChip = frozenListHref(applyViewChip(listDefault, partial), NOW);
    expect(strip(fromChip)).toBe(strip(todoListHref('partiallyPaid', NOW)));
  });
});
