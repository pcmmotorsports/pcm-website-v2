// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEEDS_YOU_CARDS } from '../lib/dashboard/needs-you-cards';
import { cleanup, render } from '@testing-library/react';

// page.test.tsx — `#16` 的 **MF6 守門:對帳讀取失敗不得把整頁帶走**。
//
// 🔴 這一格的必要性:`today-read.ts` 寫著「寧可炸也不要顯示少算的數字」,那句只證成
//    **那幾格**該炸。第一版把 `await loadTodaySummary()` 裸放在頁面 body ⇒ 對帳一失敗,
//    連 M0-S2 具名身分(這頁原本**唯一在用**的功能)一起 500。
//    把 try/catch 拿掉、或把身分那塊挪進 try 裡,下面第二格就紅。
//
// 🔴 誠實邊界:這是 **jsdom 下對 server component 回傳樹的渲染**,
//    **不證** Next 真的這樣渲染、不證 server action 真的能送出、也不證 DB 行為。
// 🔴 本檔現在會 `importOriginal` 真的 `freshness-read`(見下方那顆 mock 的理由),
//    而那支檔 `import 'server-only'` ⇒ jsdom 下會拋。全 repo 90 支測試檔用同一句解。
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getSessionActorWithSource: vi.fn(),
  listActiveStaff: vi.fn(),
  loadTodaySummary: vi.fn(),
  loadDataFreshness: vi.fn(),
  loadFitmentFreshness: vi.fn(),
  loadCronHeartbeats: vi.fn(),
  loadDeadLetterCount: vi.fn(),
  loadRetiredKeyCount: vi.fn(),
  loadStuckPaymentCount: vi.fn(),
  loadReleasedStuckCount: vi.fn(),
  loadTodayTodoLists: vi.fn(),
  loadInvoiceMonthStats: vi.fn(),
}));
vi.mock('../lib/session/actor-actions', () => ({ selectActorAction: vi.fn() }));
vi.mock('../lib/session/actor', () => ({
  ACTOR_ID_FIELD: 'actor_id',
  getSessionActorWithSource: mocks.getSessionActorWithSource,
}));
vi.mock('../lib/staff', () => ({ listActiveStaff: mocks.listActiveStaff }));
vi.mock('../lib/dashboard/today-read', () => ({ loadTodaySummary: mocks.loadTodaySummary }));
// 🔴 `freshnessLabel` **刻意不 mock** —— 它是那一行字的真正作者。
//    mock 掉它,下面「量不到」那一格就會變成在驗我自己寫的假字串。
vi.mock('../lib/dashboard/freshness-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadDataFreshness: mocks.loadDataFreshness,
  // 🔴 2026-09-01 `⟦b4-FIT1⟧`:**這一行沒補之前, 這支測試會【打真的 supabase client】** ——
  //    而 `loadFitmentFreshness` 把查詢層的錯接成值 + 首頁用 `allSettled` ⇒ 它會安靜地落成「量不到」
  //    ⇒ **測試照樣全綠, 而那一行字從來沒有被驗過。**
  //    📌 那正是本檔開頭那句「一個只在正常時出現的儀表」的第二個實例, 這次發生在【測試】那一側。
  loadFitmentFreshness: mocks.loadFitmentFreshness,
}));
// 同上:`unreadableReport` **刻意不 mock** —— 它是「量不到長什麼樣」的唯一作者。
vi.mock('../lib/mail/dead-letter-count-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadDeadLetterCount: mocks.loadDeadLetterCount,
}));
// ⟦mail-KEYRETIRECOUNT⟧ 同上:`unreadableRetiredKeyCount` **刻意不 mock** ——
// 它是「量不到長什麼樣」的唯一作者, mock 掉就變成我在驗我自己寫的 fixture。
vi.mock('../lib/mail/retired-key-count-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadRetiredKeyCount: mocks.loadRetiredKeyCount,
}));
vi.mock('../lib/dashboard/stuck-payment-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadStuckPaymentCount: mocks.loadStuckPaymentCount,
  // 🔴🔴 **這一行沒補之前, 26 格會叫【真的】那支 `loadReleasedStuckCount`**
  //    ⇒ 它呼 `createSupabaseServiceClient()`(缺 env 就拋)⇒ 被首頁的 `allSettled` 接住
  //    ⇒ **安靜落成「量不到」而 26 格照樣全綠**;env 若在, 測試會打真的 Supabase。
  //    📌 **那正是本檔 `⟦b4-FIT1⟧` 那一格自己寫下的坑, 而我在同一支檔上又踩了一次。**
  loadReleasedStuckCount: mocks.loadReleasedStuckCount,
}));
vi.mock('../lib/dashboard/today-todo-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadTodayTodoLists: mocks.loadTodayTodoLists,
}));
vi.mock('../lib/dashboard/invoice-month-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadInvoiceMonthStats: mocks.loadInvoiceMonthStats,
}));
// 🔴 `today-todo-read` 真身會 import `order-repository`(建構 supabase client;缺 env 就拋)——
//    本檔只要它的 `TODO_LIST_SPECS` / `unreadableTodoLists` 純函式,把 repo 那支拔掉。
vi.mock('../lib/orders/order-repository', () => ({ getAdminOrderRepository: () => ({}) }));
vi.mock('../lib/dashboard/cron-heartbeat-read', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadCronHeartbeats: mocks.loadCronHeartbeats,
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../lib/test-support/strip-comments';

import AdminHomePage from './page';

const SUMMARY = {
  ymd: '2026-08-14',
  receivedAmount: 12345,
  newOrderCount: 7,
  refundExceptionCount: 2,
  refundExceptionTruncated: false,
  refundExceptionVerdictsUnavailable: false,
  failedSections: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  // 預設 = 第 3 層(旗標關、票非 v:2)+ 已選到人。
  // ⚠️ **不寫「= 今天正式站的世界」**(codex 關卡2 R3 角度A must-fix):
  //    `ADMIN_REQUIRE_REAL_IDENTITY` 的線上值**我們讀不到**,而
  //    `app/settings/audit/page.tsx`(錨 `那句話 2026-08-25 就已經假了`)說它 08-25 起是開的。
  //    ⇒ 這個預設的身分是「**本檔既有各格原本的前提**」,不是一個關於正式站的事實宣稱。
  mocks.getSessionActorWithSource.mockResolvedValue({
    actor: { id: 's1', label: '小陳' },
    source: 'self-selected',
  });
  mocks.listActiveStaff.mockResolvedValue([{ id: 's1', label: '小陳' }]);
  mocks.loadTodaySummary.mockResolvedValue(SUMMARY);
  mocks.loadDataFreshness.mockResolvedValue({ hoursAgo: 3, stale: false, abnormal: false, unreadableReason: null });
  mocks.loadFitmentFreshness.mockResolvedValue({ hoursAgo: 24, stale: false, abnormal: false, unreadableReason: null });
  // 🔵 預設【零張】—— 而這個預設值本身就是本片的重點:零張要印 0, 不是不印。
  mocks.loadStuckPaymentCount.mockResolvedValue({ count: 0, unreadableReason: null });
  mocks.loadReleasedStuckCount.mockResolvedValue({ count: 0, unreadableReason: null });
  mocks.loadDeadLetterCount.mockResolvedValue({
    total: 0,
    dead: 0,
    deadExact: true,
    unreadableReason: null,
  });
  mocks.loadRetiredKeyCount.mockResolvedValue({
    superseded: 0,
    voided: 0,
    unreadableReason: null,
  });
  mocks.loadTodayTodoLists.mockResolvedValue({
    unpaidBankTransfer: { label: '待收款(匯款)', href: '/orders?a=1', count: 3 },
    notOrdered: { label: '待訂貨', href: '/orders?b=1', count: 0 },
    instock: { label: '到貨待出貨', href: '/orders?c=1', count: 5 },
  });
  mocks.loadInvoiceMonthStats.mockResolvedValue({
    month: '2026-09',
    invoicedAmount: 1000,
    revenueAmount: 4500,
    issuedWithoutDateCount: 0,
    truncated: false,
  });
  mocks.loadCronHeartbeats.mockResolvedValue({
    jobs: [
      { jobName: 'pcm-settle-sweep', label: '結帳掃描', minutesAgo: 1, consecutiveFailures: 0, abnormal: false, note: '1 分前成功' },
    ],
    neverBeat: [],
    unknownJobs: [],
    unreadableReason: null,
  });
});
afterEach(cleanup);

describe('AdminHomePage · 今天要做的事 / 發票月統計(2026-09-13)', () => {
  it('五格都在、零印 0、退款非 0 走紅、每格帶連結;工程數字收在 details 裡', async () => {
    const { container } = render(await AdminHomePage());
    const todo = container.querySelector('[data-testid="today-todo"]');
    expect(todo).not.toBeNull();
    const links = Array.from(todo!.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/orders?date_from=2026-08-14&date_to=2026-08-14&show_unpaid_card=1',
      '/orders?a=1',
      '/orders?b=1',
      '/orders?c=1',
      '/orders/refund-exceptions',
    ]);
    expect(links.map((a) => a.textContent)).toEqual([
      '新單7',
      '待收款(匯款)3',
      '待訂貨0',
      '到貨待出貨5',
      '退款待處理2',
    ]);
    expect(links[4]!.querySelector('p')!.className).toContain('text-destructive');
    expect(links[2]!.querySelector('p')!.className).not.toContain('text-destructive');
    // 版面順序:今天要做的事 → 今日對帳 → 發票月統計 → details(工程數字)
    const html = container.innerHTML;
    const at = (needle: string) => html.indexOf(needle);
    expect(at('data-testid="today-todo"')).toBeLessThan(at('今日對帳'));
    expect(at('今日對帳')).toBeLessThan(at('data-testid="invoice-month"'));
    expect(at('data-testid="invoice-month"')).toBeLessThan(at('data-testid="engineering-readouts"'));
    const details = container.querySelector('details[data-testid="engineering-readouts"]')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('[data-testid="cron-health"]')).not.toBeNull();
    expect(details.querySelector('[data-testid="data-freshness"]')).not.toBeNull();
  });

  it('🔴 退款兩個旗標要講出來:截斷 ⇒ 黏 +、更正紀錄讀不到 ⇒ 小字說含已判定(codex must-fix 3)', async () => {
    mocks.loadTodaySummary.mockResolvedValue({ ...SUMMARY, refundExceptionCount: 50, refundExceptionTruncated: true });
    let { container } = render(await AdminHomePage());
    let refund = container.querySelector('a[href="/orders/refund-exceptions"]')!;
    expect(refund.textContent).toBe('退款待處理50+已達上限,實際可能更多');
    cleanup();
    mocks.loadTodaySummary.mockResolvedValue({ ...SUMMARY, refundExceptionCount: 1, refundExceptionVerdictsUnavailable: true });
    ({ container } = render(await AdminHomePage()));
    refund = container.querySelector('a[href="/orders/refund-exceptions"]')!;
    expect(refund.textContent).toBe('退款待處理1含已判定的(更正紀錄讀不到)');
  });

  it('🔴 發票月統計截斷 ⇒ 差額不算、印「不完整,不算」+ 截斷警語(codex must-fix 4:兩個下限相減不是下限)', async () => {
    mocks.loadInvoiceMonthStats.mockResolvedValue({
      month: '2026-09', invoicedAmount: 1001, revenueAmount: 1002, issuedWithoutDateCount: 0, truncated: true,
    });
    const { container } = render(await AdminHomePage());
    const box = container.querySelector('[data-testid="invoice-month"]')!;
    expect(box.textContent).toContain('NT$ 1,001');
    expect(box.textContent).toContain('NT$ 1,002');
    expect(box.textContent).not.toMatch(/NT\$ 1(?![,\d])/);
    expect(box.textContent).toContain('差額(營業額 − 開票金額)不完整,不算');
    expect(box.textContent).toContain('查詢上限');
  });

  it('退款待處理 = 0 ⇒ 不走紅', async () => {
    mocks.loadTodaySummary.mockResolvedValue({ ...SUMMARY, refundExceptionCount: 0 });
    const { container } = render(await AdminHomePage());
    const refund = container.querySelector('a[href="/orders/refund-exceptions"]')!;
    expect(refund.textContent).toBe('退款待處理0');
    expect(refund.querySelector('p')!.className).not.toContain('text-destructive');
  });

  it('發票月統計:三個數、差額 = 營業額 − 開票、兩行常駐字(0 張也印)', async () => {
    const { container } = render(await AdminHomePage());
    const box = container.querySelector('[data-testid="invoice-month"]')!;
    expect(box.textContent).toContain('發票月統計(2026 年 9 月)');
    expect(box.textContent).toContain('NT$ 1,000');
    expect(box.textContent).toContain('NT$ 4,500');
    expect(box.textContent).toContain('NT$ 3,500');
    expect(box.textContent).toContain('發票作廢重開會讓過去月份的數字跟著變');
    expect(box.textContent).toContain('另有 0 張已開立而沒填開立日期,不計入');
    expect(box.textContent).not.toContain('查詢上限');
  });

  it('今天要做的事那支整支拋 ⇒ 三格印「讀取失敗」不印 0,連結仍可點;其餘照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadTodayTodoLists.mockRejectedValue(new Error('boom'));
    const { container } = render(await AdminHomePage());
    const todo = container.querySelector('[data-testid="today-todo"]')!;
    const links = Array.from(todo.querySelectorAll('a'));
    expect(links).toHaveLength(5);
    expect(links[1]!.textContent).toBe('待收款(匯款)讀取失敗');
    expect(links[1]!.getAttribute('href')).toContain('/orders?');
    expect(links[0]!.textContent).toBe('新單7');
    expect(container.textContent).toContain('今日實收');
    spy.mockRestore();
  });

  it('發票月統計那支整支拋 ⇒ 那一區印失敗句;今天要做的事照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadInvoiceMonthStats.mockRejectedValue(new Error('boom'));
    const { container } = render(await AdminHomePage());
    const box = container.querySelector('[data-testid="invoice-month"]')!;
    expect(box.textContent).toContain('這一區讀取失敗');
    expect(box.textContent).not.toContain('NT$');
    expect(container.querySelector('[data-testid="today-todo"]')!.textContent).toContain('新單7');
    spy.mockRestore();
  });

  it('對帳整支拋 ⇒ 新單 / 退款兩格印「讀取失敗」、新單連結退回 /orders,另外三格照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadTodaySummary.mockRejectedValue(new Error('boom'));
    const { container } = render(await AdminHomePage());
    const links = Array.from(container.querySelectorAll('[data-testid="today-todo"] a'));
    expect(links[0]!.textContent).toBe('新單讀取失敗');
    expect(links[0]!.getAttribute('href')).toBe('/orders');
    expect(links[4]!.textContent).toBe('退款待處理讀取失敗');
    expect(links[1]!.textContent).toBe('待收款(匯款)3');
    spy.mockRestore();
  });
});

describe('AdminHomePage', () => {
  it('正常時:三格數字與身分選單都在(正向對照,證明下一格的斷言真的看得到東西)', async () => {
    const { container } = render(await AdminHomePage());
    expect(container.textContent).toContain('今日實收');
    expect(container.textContent).toContain('NT$ 12,345');
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.textContent).toContain('切換');
    expect(container.textContent).not.toContain('今日對帳載入失敗');
    // 🔴 灰字那一行是【常亮的值】⇒ 正常時它就要在畫面上,不是只有出事才出現。
    expect(container.textContent).toContain('供應商資料最後更新:3 小時前');
    expect(container.querySelector('[data-testid="data-freshness"]')?.className).toContain(
      'text-muted-foreground',
    );
    // 🔵 `⟦b4-FIT1⟧`:第二行(車款搜尋)也是常亮的值 ⇒ 正常時它就要在畫面上。
    expect(container.textContent).toContain('車款搜尋同步:已 1 天沒有成功過');
    expect(container.querySelector('[data-testid="fitment-freshness"]')?.className).toContain(
      'text-muted-foreground',
    );
  });

  // ══ 資料新鮮度那一行的兩個世界(`q1: 甲`,Sean 2026-08-28)══════════════════
  it('🔴 資料舊了 ⇒ 同一行字轉成 destructive 色(而字照樣在)', async () => {
    mocks.loadDataFreshness.mockResolvedValue({ hoursAgo: 40, stale: true, abnormal: true, unreadableReason: null });
    const { container } = render(await AdminHomePage());
    expect(container.textContent).toContain('供應商資料最後更新:40 小時前');
    expect(container.querySelector('[data-testid="data-freshness"]')?.className).toContain(
      'text-destructive',
    );
  });

  it('🔴🔴 R1 must-fix:時間戳在未來 ⇒ 也要用警示色(它【不是】stale,而它是唯一確定有東西寫錯的世界)', async () => {
    // 這一格是補上來的:原本三發突變沒有任何一發碰到這條路,
    // 而漏掉它的時候「文字層印了、顏色層把它藏回去」全綠。
    mocks.loadDataFreshness.mockResolvedValue({
      hoursAgo: -3.2,
      stale: false,
      abnormal: true,
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const line = container.querySelector('[data-testid="data-freshness"]');
    expect(line?.textContent).toContain('未來');
    expect(line?.className).toContain('text-destructive');
    expect(line?.className).not.toContain('text-muted-foreground');
  });

  // ══ 車款搜尋那一行的兩個世界(`⟦b4-FIT1⟧`,門檻 7 天 = Sean 2026-08-29 逐字 `A: 7天`)══
  it('🔴 車款搜尋資料超過 7 天 ⇒ 那一行轉 destructive(而【供應商那一行仍是灰的】)', async () => {
    mocks.loadFitmentFreshness.mockResolvedValue({
      hoursAgo: 8 * 24, stale: true, abnormal: true, unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const fit = container.querySelector('[data-testid="fitment-freshness"]');
    expect(fit?.textContent).toContain('車款搜尋同步:已 8 天沒有成功過');
    expect(fit?.className).toContain('text-destructive');
    // 🔴🔴 **這一格才是「兩行分開」的判別力所在** —— 合成一行的話, 這個斷言寫不出來:
    //    供應商那半今天是新鮮的(3 小時前), 而車搜那半已經 8 天沒更新。
    //    ⇒ 一行的世界裡, 這兩件事只能印同一個顏色。
    const sup = container.querySelector('[data-testid="data-freshness"]');
    expect(sup?.textContent).toContain('供應商資料最後更新:3 小時前');
    expect(sup?.className).toContain('text-muted-foreground');
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🆕 2026-09-03 線 `-db`:系統放棄的付款 —— **接線那一半的守門**
  // 🔴🔴 這三格在的理由:模組層的測試證得了「函式回 0」, **證不到「畫面上有那行字」**。
  //    而本片要防的病正好就住在那個縫裡:**東西算出來了, 而沒有人的眼睛看得到它。**
  // ══════════════════════════════════════════════════════════════════════
  it('🔴🔴 零張 ⇒ 畫面上【印「0 張」】而不是消失(本片存在的全部理由)', async () => {
    const { container } = render(await AdminHomePage());
    const el = container.querySelector('[data-testid="stuck-payment-count"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('扣款重試已放棄:0 張');
    // 🔴 零張是好消息 ⇒ 灰的, 不搶注意力。而它【還是印出來了】—— 那才是重點。
    expect(el?.className).toContain('text-muted-foreground');
  });

  it('🔴 有卡單 ⇒ 同一行轉警示色(而字照樣在)', async () => {
    mocks.loadStuckPaymentCount.mockResolvedValue({ count: 2, unreadableReason: null });
    const { container } = render(await AdminHomePage());
    const el = container.querySelector('[data-testid="stuck-payment-count"]');
    expect(el?.textContent).toBe('扣款重試已放棄:2 張');
    expect(el?.className).toContain('text-destructive');
  });

  it('🔴🔴 那支拋錯 ⇒ 印「量不到」並【亮燈】, 而不是印 0 也不是留白', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadStuckPaymentCount.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    const el = container.querySelector('[data-testid="stuck-payment-count"]');
    expect(el?.textContent).toContain('量不到');
    expect(el?.textContent?.trim()).not.toBe('');
    // 🔴 這一格最重:**「量不到」不可以長得像「0 張」** —— 一個是我們壞了, 一個是好消息。
    expect(el?.textContent).not.toContain('0 張');
    expect(el?.className).toContain('text-destructive');
    // 失敗隔離:它掛掉不得把隔壁那些行帶走
    expect(container.textContent).toContain('供應商資料最後更新:3 小時前');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⟦b9-RELEASEDSTALL1⟧ 顯示層三格(2026-09-06;code-reviewer R1 must-fix:本來零格)
  //
  // 🔴🔴 **為什麼模組層那三格不夠**:那三格證得了「函式回幾」, **證不到「畫面上有那一行」** ——
  //    而這一整片要防的病正好住在那個縫裡:**數字算出來了, 而沒有人的眼睛看得到它。**
  //    📌 形狀照前一顆同型片 `be2a6367c` 抄, 不自創第二種寫法。
  // ══════════════════════════════════════════════════════════════════════
  it('🔴🔴 released 零張 ⇒ 畫面上【印「0 張」】而不是消失', async () => {
    const { container } = render(await AdminHomePage());
    const el = container.querySelector('[data-testid="released-stuck-count"]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('3DS 釋鎖後待人工:0 張');
    // 🔴 零張是好消息 ⇒ 灰的。而它【還是印出來了】—— 那才是重點。
    expect(el?.className).toContain('text-muted-foreground');
  });

  it('🔴 released 有卡單 ⇒ 同一行轉警示色(而字照樣在)', async () => {
    mocks.loadReleasedStuckCount.mockResolvedValue({ count: 2, unreadableReason: null });
    const { container } = render(await AdminHomePage());
    const el = container.querySelector('[data-testid="released-stuck-count"]');
    expect(el?.textContent).toBe('3DS 釋鎖後待人工:2 張');
    expect(el?.className).toContain('text-destructive');
    // 🔴 而【隔壁那一行不受影響】—— 兩個數各自獨立, 這一格是它在顯示層的證據。
    expect(container.querySelector('[data-testid="stuck-payment-count"]')?.textContent).toBe(
      '扣款重試已放棄:0 張',
    );
  });

  it('🔴🔴 released 那支拋錯 ⇒ 印「量不到」並【亮燈】, 而不是印 0 也不是留白', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadReleasedStuckCount.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    const el = container.querySelector('[data-testid="released-stuck-count"]');
    expect(el?.textContent).toContain('量不到');
    expect(el?.textContent?.trim()).not.toBe('');
    // 🔴 這一格最重:**「量不到」不可以長得像「0 張」**。
    expect(el?.textContent).not.toContain('0 張');
    expect(el?.className).toContain('text-destructive');
    // 失敗隔離:它掛掉不得把隔壁那一行帶走
    expect(container.querySelector('[data-testid="stuck-payment-count"]')?.textContent).toBe(
      '扣款重試已放棄:0 張',
    );
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 車款搜尋那支拋錯 ⇒ 印「量不到」不留白,而供應商那行與對帳照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadFitmentFreshness.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    const fit = container.querySelector('[data-testid="fitment-freshness"]');
    expect(fit).not.toBeNull();
    expect(fit?.textContent).toContain('量不到');
    expect(fit?.textContent?.trim()).not.toBe('');
    expect(fit?.className).toContain('text-destructive');
    // 失敗隔離:它掛掉不得把隔壁那行或對帳帶走
    expect(container.textContent).toContain('供應商資料最後更新:3 小時前');
    expect(container.textContent).toContain('今日實收');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 新鮮度讀取拋錯 ⇒ 印「量不到」,**不得留白**,而其他區照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadDataFreshness.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    const line = container.querySelector('[data-testid="data-freshness"]');
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain('量不到');
    expect(line?.textContent?.trim()).not.toBe(''); // 空白 = 與「還沒載完」同形,那是這片在修的病
    expect(line?.className).toContain('text-destructive');
    // 這一格掛掉不得把對帳與身分帶走
    expect(container.textContent).toContain('今日實收');
    expect(container.querySelector('select#actor_id')).not.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // ══ 排程心跳那一區(3a)══════════════════════════════════════════════════
  it('🔴 正常時那一區就在畫面上(常亮的值,不是只有出事才出現)', async () => {
    const { container } = render(await AdminHomePage());
    expect(container.querySelector('[data-testid="cron-health"]')).not.toBeNull();
    const row = container.querySelector('[data-testid="cron-job-pcm-settle-sweep"]');
    expect(row?.textContent).toContain('結帳掃描');
    expect(row?.className).toContain('text-muted-foreground');
  });

  it('🔴 某一支異常 ⇒ 那一列轉 destructive 色(而字照樣在)', async () => {
    mocks.loadCronHeartbeats.mockResolvedValue({
      jobs: [
        { jobName: 'pcm-settle-sweep', label: '結帳掃描', minutesAgo: 99, consecutiveFailures: 0, abnormal: true, note: '已經 99 分沒成功(門檻 6 分)' },
      ],
      neverBeat: [],
      unknownJobs: [],
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const row = container.querySelector('[data-testid="cron-job-pcm-settle-sweep"]');
    expect(row?.textContent).toContain('99 分沒成功');
    expect(row?.className).toContain('text-destructive');
    expect(row?.className).not.toContain('text-muted-foreground');
  });

  it('🔴 兩種漂移印【不同的句子】,而且各自附「該怎麼辦」', async () => {
    mocks.loadCronHeartbeats.mockResolvedValue({
      jobs: [],
      neverBeat: ['pcm-expire-unpaid-orders'],
      unknownJobs: ['pcm-brand-new-job'],
      unreadableReason: null,
    });
    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="cron-health"]')?.textContent ?? '';
    expect(t).toContain('從來沒寫過心跳');
    expect(t).toContain('pcm-expire-unpaid-orders');
    expect(t).toContain('接線了沒');            // 該怎麼辦①
    expect(t).toContain('沒在看的心跳');
    expect(t).toContain('pcm-brand-new-job');
    expect(t).toContain('白名單過期');          // 該怎麼辦②
  });

  it('🔴 心跳讀取拋錯 ⇒ 印「量不到」,不得留白,而其他區照舊', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadCronHeartbeats.mockRejectedValue(new Error('boom'));
    const { container } = render(await AdminHomePage());
    const box = container.querySelector('[data-testid="cron-health"]');
    expect(box?.textContent).toContain('量不到');
    expect(box?.textContent?.trim()).not.toBe('');
    expect(container.textContent).toContain('今日實收'); // 沒有把別區帶走
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 MF6:對帳讀取拋錯 ⇒ 只有那一區變失敗卡,身分選單照樣可用', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.loadTodaySummary.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());

    expect(container.textContent).toContain('今日對帳載入失敗');
    // 🔴 這三條才是 MF6 的本體:身分那塊**沒有**被一起帶走。
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('select#actor_id')).not.toBeNull();
    expect(container.textContent).toContain('切換');
    // 數字不得留在畫面上(免得員工看到一個沒更新的舊值當今天的)。
    expect(container.textContent).not.toContain('今日實收');

    // 失敗要留痕:靜默吞掉的話,線上永遠不知道這一區壞了。
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── `:247`(⟦b4-MGR0-COPY⟧)三個世界,三句話 ────────────────────────────────
//
// 🔴 **改之前這些格全部會綠** —— 那句話是無條件印的,而每個世界印同一句。
//    ⇒ 下面每一格都附「它在哪個世界翻面」,不要只讀斷言。
//
// ✅ **這一節有多少判別力,是【量到的】不是估的**(2026-08-29,codex 關卡2 R3 角度B 要求):
//    把 `{ACTOR_SOURCE_COPY[copyKey]}` 換回舊的無條件字串、其餘一律不動,實跑 ⇒
//    **本檔 6 紅 / 17 過**(紅的是下面除「第 3 層 + 已選人」之外的每一格)。
// 🔴 **而 `b5a-identity-acceptance.test.ts` 同一發是【40 全過、0 紅】** ——
//    那 10 格守的是 `actor.ts` 的 `source`,**與文案分岔一格都不相干**。
//    📌 **⇒ 不要把兩邊的格數加起來當成「守這句話的有 N 格」** ——
//    那是兩個不同的宣稱,而它們印同一種綠。
// ⚠️ 「第 3 層 + 已選人」那格**不紅是對的**:它守的正是「那個世界一個字都沒變」。
describe(':247 具名身分那句話 —— 六個世界各講各的話', () => {
  const copyOf = async (
    source: 'ticket' | 'self-selected' | 'none' | 'stale-ticket',
    actor: unknown,
  ) => {
    mocks.getSessionActorWithSource.mockResolvedValue({ actor, source });
    const { container } = render(await AdminHomePage());
    return container.textContent ?? '';
  };

  it('第 1 層(票是 v:2)⇒ 說身分來自那張票,而【不再】說是你自己選的', async () => {
    const text = await copyOf('ticket', { id: 's1', label: '小陳' });
    expect(text).toContain('經過簽章驗證的票');
    // 🔴 這一行才是本片的本體:舊字面**不得**出現在這個世界。
    //    翻面條件:把分岔拆掉、或把三句合回一句 ⇒ 紅。
    expect(text).not.toContain('這個身分是你自己選的');
  });

  it('第 3 層(旗標關、票非 v:2)+ 已選人 ⇒ 一個字都不改,舊字面照舊', async () => {
    const text = await copyOf('self-selected', { id: 's1', label: '小陳' });
    // 🔴 這格是**負向守門**:本片宣稱「今天正式站那個世界零改動」,而這裡就是那句宣稱的量具。
    expect(text).toContain('這個身分是你自己選的、系統並未驗證');
    expect(text).not.toContain('經過簽章驗證的票');
  });

  it('none(共用密碼 / 首次建置)⇒ 選單不會生效,而復原步驟是【改用個人帳號】', async () => {
    const text = await copyOf('none', null);
    expect(text).toContain('選了不會生效');
    // 🔴 codex R3 角度D:這半的人**重登沒有用** ⇒ 不得叫他去重登。
    expect(text).toContain('請改用個人帳號登入');
    expect(text).not.toContain('請登出後重新登入');
    // 🔴 codex 關卡2 must-fix:只守前半 ⇒ 有人把「會被擋下」那句刪掉或說反,這格照樣綠。
    //    而那半才是員工需要知道的後果。
    expect(text).toContain('會被擋下');
    expect(text).not.toContain('這個身分是你自己選的');
    // 這個世界 actor 是 null ⇒ 畫面照舊印「尚未選擇」(那一格本片沒動)。
    expect(text).toContain('尚未選擇');
  });

  // 🔴🔴 codex 關卡2 must-fix:`source==='ticket'` **不保證票上那個人還在**
  //    (`lib/staff.ts` 的 `resolveStaff` 對停用/查無回 null)。
  //    翻面條件:把 `copyKey` 那一行拿掉 ⇒ 畫面同時印「尚未選擇」與「這個身分來自那張票」⇒ 紅。
  it('🔴 票上有身分而現在對不到人(actor=null)⇒ 不得說「身分來自那張票」,也不得斷言原因', async () => {
    const text = await copyOf('ticket', null);
    expect(text).toContain('系統現在對不到那個人');
    expect(text).toContain('會被擋下');
    // 🔴 codex 關卡2 R2 must-fix:**不得斷言原因** —— DB 名單這一趟沒讀到也走這條路,
    //    而那個人的帳號其實好好的。翻面條件:有人把話改回「你的帳號被停用了」⇒ 紅。
    expect(text).not.toMatch(/帳號(已)?被停用了/);
    // 這一句是矛盾的來源:畫面上方已經印「尚未選擇」,不得再說「這個身分來自…那張票」。
    expect(text).not.toContain('這個身分來自你登入時那張經過簽章驗證的票');
    expect(text).not.toContain('這個身分是你自己選的');
  });

  // 🔴🔴 codex 關卡2 R2 must-fix:第五個世界 —— `self-selected` 而還沒選人。
  //    舊字面在這裡也是假的:畫面連著印「尚未選擇。稽核 log 會把【這個身分】記成操作者」。
  //    翻面條件:把 `self-selected-unset` 那一支拿掉、退回共用 B 版 ⇒ 紅。
  it('🔴 還沒選人(self-selected + actor=null)⇒ 不得說「會把這個身分記成操作者」', async () => {
    const text = await copyOf('self-selected', null);
    expect(text).toContain('尚未選擇');
    expect(text).toContain('你還沒有選具名身分');
    expect(text).toContain('會被擋下');
    // 🔴 這一行是本格的本體:沒有身分可記,就不能說會記。
    expect(text).not.toContain('稽核 log 會把這個身分記成操作者');
  });

  // 🔴🔴 codex 關卡2 R3「災難當天」must-fix:第 2 層(旗標開 + 舊 v:1 票)**重登就會拿到新票**,
  //    而 `none`(共用密碼/首次建置)重登沒有用。合成一句 ⇒ **兩邊各被叫去做錯的事一半。**
  // 🔴🔴 codex 關卡2 R4 must-fix:**不得叫他直接登出重登**。
  //    `app/api/sso/callback/route.ts:156-163`:旗標開而上游沒送 `sub` ⇒ **500、不發新票**
  //    ⇒ 他登出就回不來,而他現在這張舊票還讀得到東西。
  //    翻面條件:有人把話改回無條件「請登出後重新登入一次」⇒ 紅。
  it('🔴 stale-ticket(舊票)⇒ 要先叫他【不要登出】,不得無條件叫他重登', async () => {
    const text = await copyOf('stale-ticket', null);
    expect(text).toContain('請先不要登出');
    expect(text).toContain('會被擋下');
    expect(text).not.toContain('請改用個人帳號登入');
    // 🔴🔴 **這一句釘【整段逐字】,不是釘關鍵字**(codex 關卡2 R5 must-fix)。
    //    上一版只禁「請登出後重新登入」這六個字 ⇒ 改寫成「請登出再登入一次」**照樣全綠**,
    //    而那個改寫**一樣會把人鎖在門外**。📌 **一把綁單一字面的尺,防得住還原、防不住同義改寫。**
    //    ⚠️ **代價明寫**:這一格對**任何**字面改動都會紅,包含無害的潤稿 ——
    //    **那是刻意的**:這句話的安全性住在「先不要登出」那個前提上,
    //    ⇒ 動它就該有人重新讀一遍,而不是靜悄悄通過。改文案 = 連這一格一起改。
    expect(text).toContain(
      '🔴 請先不要登出:要等你的個人帳號在報價單端接上之後,重新登入才會拿到新票。先找管理員確認,確認了再登出重登。',
    );
  });

  it('🔴 六個世界必須印【六句不一樣的話】—— 合併回一句就紅', async () => {
    const [a, b, c, d, e, f] = await Promise.all([
      copyOf('ticket', { id: 's1', label: '小陳' }),
      copyOf('self-selected', { id: 's1', label: '小陳' }),
      copyOf('none', null),
      copyOf('ticket', null),
      copyOf('self-selected', null),
      copyOf('stale-ticket', null),
    ]);
    // 🔴 為什麼要這一格:上面每一格是**各自**檢查一個字串在不在。
    //    有人把四句話改成同一句、而那句話剛好同時含每一個關鍵字 ⇒ 上面每一格**全綠**。
    //    這一格量的是「它們互不相同」,那是上面那些格合起來也答不出的問題。
    expect(new Set([a, b, c, d, e, f]).size).toBe(6);
  });

  it('🔴 本頁不得自己讀那顆旗標 —— 決定文案的是【票】不是 ADMIN_REQUIRE_REAL_IDENTITY', async () => {
    // 翻面條件:有人把分岔改寫成 `requireRealIdentity() ? A : B` ⇒ 紅。
    // 那個寫法在「旗標關而票已是 v:2」的世界會印錯,而**畫面看起來完全正常** ——
    // 沒有這一格,那個回歸沒有任何東西會叫。
    // 🔴 **必須 `stripComments`** —— 本檔的說明註解**本來就會提到那顆旗標的名字**
    //    (它在講「不要照旗標分岔」)⇒ 不剝註解,這一格會因為一段正確的註解而紅。
    //    做法逐字抄同 repo 既有形狀 `lib/session/actor-actions.test.ts:126-128`,不自創第二種。
    // ⚠️ **不能用 `import.meta.url`** —— 本檔是 `@vitest-environment jsdom`,
    //    那顆在 jsdom 下不是 `file:` scheme(實測 `TypeError: The URL must be of scheme file`);
    //    `actor-actions.test.ts` 用得成是因為它跑 node 環境。**同一句話在兩個環境不同義。**
    //    改用 vitest root(= repo 根)。路徑打錯 ⇒ `readFileSync` 直接拋 ⇒ 紅得很大聲,不會靜默恆真。
    const src = stripComments(
      readFileSync(resolve(process.cwd(), 'apps/admin/src/app/page.tsx'), 'utf8'),
    );
    // 正對照先跑:確定真的讀到那支檔、而且是改過的那一版(否則下面兩條恆真)。
    expect(src).toContain('ACTOR_SOURCE_COPY');
    expect(src).toContain('actorSource');
    expect(src).not.toContain('requireRealIdentity');
    expect(src).not.toContain('ADMIN_REQUIRE_REAL_IDENTITY');
  });
});

// ⟦f3-DEADLETTERCOUNT⟧ — 首頁那張「寄不出去的信」卡片。
//
// 🔴 這三格驗的都是**兩個世界要印不同的東西**,不是「數字有出現」:
//    ① 讀不到 ≠ 一封都沒有 ② 被截斷的「已放棄」不可以印得像精確值
//    ③ 而總數要來自 DB 的 count(那一格在 read 層驗,這裡驗它有被畫出來)。
describe('死信計數卡片', () => {
  it('should show both the total and how many have been given up', async () => {
    mocks.loadDeadLetterCount.mockResolvedValue({
      total: 7,
      dead: 5,
      deadExact: true,
      unreadableReason: null,
    });

    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="dead-letter-count"]')?.textContent ?? '';

    expect(t).toContain('7');
    expect(t).toContain('5');
    expect(t).toContain('已放棄');
  });

  // 🔴🔴 ⟦15-SHIPGATE-F1⟧ 2026-09-14:**這一格守的是「按了鈕之後會發生什麼」有沒有寫在卡片上。**
  //   為什麼需要它:`total` 的述詞是 `status IN ('pending','failed')` ⇒ **一封剛進佇列、
  //   一次都沒失敗的信也算進去**;而按重排只讓 `dead` 少一封、`total` 一動也不動
  //   (鑽機實測 2026-09-14:total 3→3、dead 2→1)。
  //   ⇒ 📌 沒有這句話, 人按了鈕盯著大數字沒動, 會以為那顆鈕壞了 —— 而這是**文字的病, 不是數字的病**。
  //   ⛔ 這一格紅掉時**不要改成刪掉那句話**;要改的是把話說得更清楚。
  it('🔴 要說清楚兩個數字的行為相反:按重排「已放棄」會降、總數不會', async () => {
    mocks.loadDeadLetterCount.mockResolvedValue({
      total: 7,
      dead: 5,
      deadExact: true,
      unreadableReason: null,
    });

    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="dead-letter-count"]')?.textContent ?? '';

    // ① 總數不可以再被叫成「卡住」—— 它含正常排隊中的信。
    expect(t).not.toContain('卡住 7');
    expect(t).toContain('含正常排隊中的');
    // ② 按下去會發生什麼, 以及不會發生什麼, 兩半都要在。
    expect(t).toContain('按重排');
    expect(t).toContain('已放棄」當場少一封');
    expect(t).toContain('總數不會因此下降');
  });

  it('should say it cannot read rather than showing a zero', async () => {
    // 🔴 「量不到」印成 0 ⇒ 我們壞了會長得像好消息。
    mocks.loadDeadLetterCount.mockResolvedValue({
      total: 0,
      dead: 0,
      deadExact: false,
      unreadableReason: '查詢失敗',
    });

    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="dead-letter-count"]')?.textContent ?? '';

    expect(t).toContain('量不到');
    expect(t).not.toContain('目前沒有卡住的信');
  });

  it('should mark the given-up figure as a lower bound once the scan cap is passed', async () => {
    mocks.loadDeadLetterCount.mockResolvedValue({
      total: 9999,
      dead: 2000,
      deadExact: false,
      unreadableReason: null,
    });

    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="dead-letter-count"]')?.textContent ?? '';

    expect(t).toContain('下界');
  });

  it('should still render the card when the count loader rejects', async () => {
    mocks.loadDeadLetterCount.mockRejectedValue(new Error('boom'));

    const { container } = render(await AdminHomePage());
    const box = container.querySelector('[data-testid="dead-letter-count"]');

    expect(box).not.toBeNull();
    expect(box?.textContent ?? '').toContain('量不到');
  });
});

/**
 * ⟦mail-KEYRETIRECOUNT⟧ 退休鍵計數卡片(2026-09-07, 主視窗 B 批准 plan 後做)。
 * 🔴 數的**不是壞事** —— 換鍵是設計;缺的是沒有人在數。
 * ⇒ 這三格守的是:數字有被畫出來 / 讀不到不准長得像零 / 零的時候要主動說好消息。
 */
/**
 * ⟦f3-REDNEEDSEXIT⟧ 乙案那一句話的守門。
 * 🔴 **它守的是【點名的那幾格真的在】** —— 而不是「那句話印出來了」。
 *    有人刪掉某一格 / 改掉 `data-testid` ⇒ 那句話會**靜靜地指向一個不存在的東西**,
 *    而畫面看起來完全正常(它只是一行字)。
 * 🔵 **兩份東西**:名字在 `lib/dashboard/needs-you-cards.ts` 一份, 而畫面上那三格是**各自手寫**的
 *    ⇒ 對不上就紅。(若名字是從 DOM 反推的, 這一格就是在驗它自己。)
 */
describe('⟦f3-REDNEEDSEXIT⟧ 「等你處理的單」那一句', () => {
  it('🔴 它點名的每一格都要真的在畫面上', async () => {
    const { container } = render(await AdminHomePage());
    for (const card of NEEDS_YOU_CARDS) {
      expect(
        container.querySelector(`[data-testid="${card.testId}"]`),
        `那句話點名了「${card.名稱}」(${card.testId}), 而畫面上找不到它`,
      ).not.toBeNull();
    }
    // 🟢 正對照:那個清單不得是空的, 否則上面那圈恆綠。
    expect(NEEDS_YOU_CARDS.length).toBeGreaterThan(0);
    // 🔵 負對照:同一把尺問一個現造的 testid ⇒ 必須找不到(證明它真的在查 DOM)。
    expect(container.querySelector('[data-testid="zzz-never-a-card"]')).toBeNull();
  });

  it('🔴 那句話要說出【不是全部】—— 少了它, 讀的人會以為這三格就是全部', async () => {
    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="needs-you-summary"]')?.textContent ?? '';
    expect(t).toContain('不是全部');
    // 🛑 而它【不可以】用「下界」這種字 —— 那是給我們看的字, 不是給 Sean 看的字。
    expect(t).not.toContain('下界');
    /**
     * 🔴🔴 **[這四行是【一發活下來的突變】改寫的 —— 今天第五次同族]**
     * ⛔ ~~`for (const card of NEEDS_YOU_CARDS) expect(t).toContain(card.名稱);`~~
     *    🛑 **那是拿它驗它自己**:`t` 是用 `NEEDS_YOU_CARDS` 的名字組出來的, 右邊也是同一份
     *    ⇒ 把名字改成 `'ZZZ 改過的名字'`, **兩邊一起動、照樣綠**(實測 rc=0, 35 passed)。
     * ✅ **修法:拿那個名字去比【那一格自己畫出來的字】** —— 那是另一份東西,
     *    寫在 `stuckPaymentLabel()` / `releasedStuckLabel()` / 那一格的 `<p>` 標題裡。
     *    ⇒ 名字對不上畫面就紅, 而那正是「點名不泛指」要防的事。
     */
    for (const card of NEEDS_YOU_CARDS) {
      expect(t, `那句話裡少了「${card.名稱}」`).toContain(card.名稱);
      const el = container.querySelector(`[data-testid="${card.testId}"]`);
      expect(
        el?.textContent ?? '',
        `那句話叫它「${card.名稱}」, 而 ${card.testId} 那一格畫出來的字裡沒有這幾個字`,
      ).toContain(card.名稱);
    }
  });
});

describe('退休鍵計數卡片', () => {
  it('🔴 兩個數字都要畫出來, 而且不會互相蓋掉', async () => {
    // 🔵 兩個數**故意不相等** —— 相等的話「印錯欄」這種錯它看不出來。
    mocks.loadRetiredKeyCount.mockResolvedValue({
      superseded: 3,
      voided: 8,
      unreadableReason: null,
    });

    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="retired-key-count"]')?.textContent ?? '';

    /**
     * 🔴🔴 **[這四行是【一發活下來的突變】改寫的]**
     * ⛔ ~~`toContain('3')` + `toContain('8')` + 兩個標籤各 `toContain`~~
     *    🛑 **那證不到【配對】** —— 突變:把畫面上兩個數字對調 ⇒ 四個字串**全都還在**
     *    ⇒ 這一格**活下來(rc=0, 32 passed)**, 而畫面上「單號被更正 8 次」是錯的。
     * ✅ 修法:釘**標籤與數字的相鄰關係**, 不是各自存在。
     */
    expect(t).toMatch(/單號被更正\s*3\s*次/);
    expect(t).toMatch(/箱被作廢\s*8\s*次/);
    // 🔵 負對照:對調之後的那兩句**不可以**出現(否則上面兩行可能是靠整段很長蒙到的)。
    expect(t).not.toMatch(/單號被更正\s*8\s*次/);
    expect(t).not.toMatch(/箱被作廢\s*3\s*次/);
  });

  it('🔴 讀不到 ⇒ 說「量不到」, 不准印成零把', async () => {
    // 🔴 與死信那格同一個理由:我們壞了會長得像好消息。
    mocks.loadRetiredKeyCount.mockResolvedValue({
      superseded: 0,
      voided: 0,
      unreadableReason: '查詢失敗',
    });

    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="retired-key-count"]')?.textContent ?? '';

    expect(t).toContain('量不到');
    // 🔴 **理由字串要真的印出來**(R1 nit-5:拿掉它突變活下來)——
    //    「量不到」三個字答不出「量不到什麼」, 而看的人要憑它決定去查哪裡。
    expect(t).toContain('查詢失敗');
    expect(t).not.toContain('目前沒有被換掉的識別鍵');
  });

  /**
   * 🔴🔴 **[code-reviewer R1 nit-1 —— 這是【第三個】同型的, 而它是【突變活下來】找到的]**
   *    把畫面那道 `superseded === 0 && voided === 0` 退成單邊 ⇒ **rc=0, 39 格全綠**。
   * 🛑 失敗情境:`(0, 5)` 這種**不對稱世界**畫面印「目前沒有被換掉的識別鍵」, 而實際有 5 把
   *    ⇒ 📌 **這一片存在的理由被印成好消息。**
   * 🔴 **成因是 fixture 的形狀**:我只餵過 `(3,8)` 與 `(0,0)` —— **兩個都是對稱的**
   *    ⇒ 那道 `&&` 的兩邊在我的測試裡從來沒有分歧過。
   */
  it('🔴 一邊 0 一邊非 0 ⇒ 不准說「沒有被換掉」', async () => {
    mocks.loadRetiredKeyCount.mockResolvedValue({
      superseded: 0,
      voided: 5,
      unreadableReason: null,
    });

    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="retired-key-count"]')?.textContent ?? '';

    expect(t).not.toContain('目前沒有被換掉的識別鍵');
    expect(t).toMatch(/箱被作廢\s*5\s*次/);
    // 🔵 而另一邊的 0 要照樣印出來 —— 不是整格消失。
    expect(t).toMatch(/單號被更正\s*0\s*次/);
  });

  it('🔵 正對照:真的零把 ⇒ 主動說好消息(而不是留白)', async () => {
    // 🟢 沒有這一格, 上面那格可以靠「永遠印量不到」通過。
    const { container } = render(await AdminHomePage());
    const t = container.querySelector('[data-testid="retired-key-count"]')?.textContent ?? '';

    expect(t).toContain('目前沒有被換掉的識別鍵');
    expect(t).not.toContain('量不到');
  });
});
