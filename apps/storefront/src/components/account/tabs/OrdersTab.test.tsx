// @vitest-environment jsdom
//
// OrdersTab smoke(M-3:接真訂單摘要清單)。
//
// 驗:
// - 標題「訂單記錄」+ acc-section 殼(data-tab="orders")
// - 多單 props → 渲染 displayId / 日期(YYYY-MM-DD)/ itemCount 件商品 / 金額 NT$ / 狀態中文 + .acc-order-full + 查看詳情鈕
// - 空陣列 → acc-empty 空狀態
// - 查看詳情鈕(`#240` 後)為 <a>、href = /account/orders/<displayId>、encodeURIComponent 有守
// - 反洩 guard:orders={[]} 空渲染不含 design mock 字面(PCM-2026-0042 / NT$ 18,600)= 證元件無 hardcode mock
//   (真資料合法含 PCM-YYYY-NNNN / 已出貨,故不再 blanket 禁該類字面,改鎖「特定 design mock 值」)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { toMoneyAmount, type OrderListItem } from '@pcm/domain';
import { OrdersTab } from './OrdersTab';
import { ORDER_ITEM_COUNT_TRUNCATED_NOTE } from '@/lib/account-order-copy';

afterEach(cleanup);

// 測試用訂單(刻意非 design mock 字面;2099 年 + 中性值,防與反洩 guard 混淆)
// 🔴🔴 `#249`(2026-08-24):**這一格是這片在客人清單那一半的核心。**
//    取消**不動** `payment_status` ⇒ 已取消單走到列表時是 `unpaid`
//    ⇒ 舊碼會在這張卡上印「待付款」⇒ **客人去付一張已作廢的單。**
//    Sean 拍板逐字:「甲 也顯示, 但標清楚「已取消」/「已逾期」, 不能點去付款」
const CANCELLED_ORDER: OrderListItem = {
  id: 'ord-cancelled',
  displayId: 'PCM-2099-0099',
  createdAt: '2099-02-01T10:00:00Z',
  paymentStatus: 'unpaid',
  fulfillmentStatus: 'notOrdered',
  total: { amount: toMoneyAmount(3280), currency: 'TWD' },
  cancelledAt: '2099-02-03T02:00:00Z',
  cancelKind: 'cancelled',
  itemCount: 1,
  itemCountTruncated: false,
};

const ORDERS: OrderListItem[] = [
  {
    id: 'ord-1',
    displayId: 'PCM-2099-0007',
    createdAt: '2099-04-15T10:00:00Z', // +8h 同日 → 2099-04-15
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    total: { amount: toMoneyAmount(12345), currency: 'TWD' },
    itemCount: 3,
    cancelledAt: null,
    cancelKind: 'none' as const,
    itemCountTruncated: false,
  },
  {
    id: 'ord-2',
    displayId: 'PCM-2099-0003',
    createdAt: '2099-03-28T10:00:00Z',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'notOrdered',
    total: { amount: toMoneyAmount(980), currency: 'TWD' },
    itemCount: 1,
    cancelledAt: null,
    cancelKind: 'none' as const,
    itemCountTruncated: false,
  },
];

describe('OrdersTab(M-3 真訂單清單)', () => {
  it('標題「訂單記錄」+ acc-section 殼', () => {
    const { container } = render(<OrdersTab orders={[]} />);
    expect(screen.getByText('訂單記錄')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="orders"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
  });

  it('空陣列 → acc-empty 空狀態「目前尚無訂單紀錄」+ sub', () => {
    const { container } = render(<OrdersTab orders={[]} />);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(screen.getByText('目前尚無訂單紀錄')).toBeTruthy();
    expect(screen.getByText('您的購買紀錄會顯示在此')).toBeTruthy();
    // 空陣列不渲染清單容器
    expect(container.querySelector('.acc-orders')).toBeNull();
  });

  it('多單 → 渲染 displayId / 日期 / 件數 / 金額 / 狀態中文 + .acc-order-full', () => {
    const { container } = render(<OrdersTab orders={ORDERS} />);
    // 列數 = 訂單數
    expect(container.querySelectorAll('.acc-order.acc-order-full')).toHaveLength(2);
    // displayId(訂單號)
    expect(screen.getByText('PCM-2099-0007')).toBeTruthy();
    expect(screen.getByText('PCM-2099-0003')).toBeTruthy();
    // 日期(formatOrderDate YYYY-MM-DD)+ 件數(Σquantity 件商品)
    expect(screen.getByText('2099-04-15 · 3 件商品')).toBeTruthy();
    expect(screen.getByText('2099-03-28 · 1 件商品')).toBeTruthy();
    // 金額(整數 Money toLocaleString)
    expect(screen.getByText('NT$ 12,345')).toBeTruthy();
    expect(screen.getByText('NT$ 980')).toBeTruthy();
    // 狀態中文:paid → A9f row47 固定「處理中」(不再細分出貨軸);unpaid → 待付款
    expect(screen.getByText('處理中')).toBeTruthy();
    expect(screen.getByText('待付款')).toBeTruthy();
    // 有單時不顯空狀態
    expect(container.querySelector('.acc-empty')).toBeNull();
  });

  // 🔴 `#240`(2026-08-23):~~原本這一格釘的是「為 <button>、無 href 導頁」~~ ——
  //    **那個斷言在 `#240` 之後【必須】反過來**,而它反過來是這一片的重點:
  //    那顆鈕從 2026-06 起就是一顆點下去沒反應的死鈕(design 自己就是死的、我們忠實照搬)。
  //    ⇒ 保留原句在這裡,是為了讓下一個人看得出**這不是測試壞掉、是行為被刻意改掉的**。
  it('查看詳情鈕(`#240`):為 <a>、每單一顆、href 指向 /account/orders/<displayId>', () => {
    const { container } = render(<OrdersTab orders={ORDERS} />);
    const detailLinks = container.querySelectorAll('a.acc-order-detail');
    expect(detailLinks).toHaveLength(2);
    const first = detailLinks[0] as HTMLAnchorElement;
    expect(first.tagName).toBe('A');
    expect(first.textContent).toBe('查看詳情 →');
    // 🔴 網址段是 displayId、**不是 orders.id 那個 UUID**(OD 稿檔頭定的契約)。
    expect(first.getAttribute('href')).toBe(`/account/orders/${ORDERS[0]!.displayId}`);
    // 🔴 **反向那半**:死鈕不得復活 —— 沒有任何 <button class="acc-order-detail"> 殘留。
    expect(container.querySelector('button.acc-order-detail')).toBeNull();
  });

  // 🔴 displayId 兩種格式並存(6 碼亂碼 / `PCM-YYYY-NNNN`),而它是**使用者可見的識別碼**、
  //    不保證只有 URL-safe 字元 ⇒ encodeURIComponent 不可省。這一格用一個會被編碼的字面釘住它。
  //    (負對照:上面那格用的 displayId 不含特殊字元 ⇒ 編不編碼都一樣 ⇒ **那格擋不住這個 bug**。)
  // ⚠️ **這個 fixture 刻意【不符合】現行兩種 DB 格式**(6 碼亂碼 / `PCM-YYYY-NNNN`)——
  //    codex 關卡2 nit 指出這點,而**它是刻意的**:合格式的值全是 URL-safe
  //    ⇒ 拿它當 fixture,`encodeURIComponent` 加不加都一樣 ⇒ **那格會恆綠**。
  //    這一格守的是「格式日後放寬時不會靜默壞掉」,不是「今天有這種單」。
  //    🔴 而 codex 另一半說對了:它**只驗產生端**。接收端(路由的二次解碼)那一半
  //       由 `page.tsx` 拿掉 `decodeURIComponent` 修掉,理由寫在那支檔上。
  it('查看詳情鈕:displayId 含 URL 特殊字元時走 encodeURIComponent(格式放寬的預防針)', () => {
    const tricky = [{ ...ORDERS[0]!, id: 'x-1', displayId: 'PCM 2026/0042#a' }];
    const { container } = render(<OrdersTab orders={tricky} />);
    const link = container.querySelector('a.acc-order-detail') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/account/orders/PCM%202026%2F0042%23a');
  });

  // 正對照:**現行兩種真實格式**都要原樣出現在 href 裡(不被過度編碼)。
  it('查看詳情鈕:兩種現行 displayId 格式(6 碼亂碼 / PCM-YYYY-NNNN)原樣進 href', () => {
    const real = [
      { ...ORDERS[0]!, id: 'r1', displayId: 'B3XA91' },
      { ...ORDERS[0]!, id: 'r2', displayId: 'PCM-2099-0007' },
    ];
    const { container } = render(<OrdersTab orders={real} />);
    const hrefs = Array.from(container.querySelectorAll('a.acc-order-detail')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/account/orders/B3XA91', '/account/orders/PCM-2099-0007']);
  });

  it('反洩 guard:空渲染不含 design mock 字面(證元件無 hardcode mock 訂單)', () => {
    const { container } = render(<OrdersTab orders={[]} />);
    expect(container.textContent).not.toContain('PCM-2026-0042');
    expect(container.textContent).not.toContain('18,600');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q-EMBED-1:件數可能少算時,不印那個數字(2026-08-16,Sean 批)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴🔴 **這一面的後果與後台那條【不同】,不要當成同一件事**:
//    後台 `itemsTruncated` ⇒ 整單**狀態**被算錯(`.every()` 對子集單調)
//    這裡 `itemCountTruncated` ⇒ 印一個**少算的件數**
//    ⇒ **客人看到「3 件」而實際訂了 600 件,他不會知道、也不會回報**(沒有第二個來源可以對)。
//
// ⚠️ **顯示法也不同**:後台那格印「未知」蓋掉整格;這裡**只換掉那個不可信的數字**,
//    單號與日期照常 —— 蓋掉整格等於拿走客人辨識自己訂單的資訊。
describe('itemCountTruncated ⇒ 件數印「?」', () => {
  it('🔴 旗標為真 ⇒ 印「? 件商品」,不印那個少算的數', () => {
    // 🔴 **fixture 從檔內既有的 `ORDERS[0]` 衍生,不自己造一個** ——
    //    我第一版憑印象寫了不存在的 `baseOrder` ⇒ `ReferenceError`(本輪第五次同一個病)。
    //    `ORDERS[0].itemCount` 本來就是 3,反向斷言那個 `3 件商品` 因此是真的會出現的字面。
    render(<OrdersTab orders={[{ ...ORDERS[0]!, itemCountTruncated: true }]} />);
    expect(screen.getByText(/\? 件商品/), '應改印問號').toBeDefined();
    // 🔴 反向:那個不可信的數字一個字都不准出現。
    expect(screen.queryByText(/3 件商品/), '少算的數字不得出現').toBeNull();
  });

  // 🔴 `#636` 接線格:那個「?」旁邊掛的必須**就是**共用常數。
  //    沒有這一格,常數可以寫得完美而**根本沒被用到**(或某天被人在這裡寫回一句 inline 字面),
  //    而 `account-order-copy.test.ts` 那六格照樣全綠 —— 它測的是常數,不是畫面。
  it('🔴 `#636`+`#639甲` 說明文字 = 共用常數,而且印在【畫面上】不是 title 裡', () => {
    // 🔴 **這一格 2026-08-18 改過期望值,而改法本身就是驗收點。**
    //    原本斷言 `getByText(/\? 件商品/).getAttribute('title')` 等於那個常數
    //    ⇒ 它**把「說明住在 title 裡」寫成了規格**,而 `#639` 立案的正是這件事:
    //    `title` 是 hover-only、觸控裝置沒有 hover ⇒ 手機客人四段一段都拿不到(實測 0/4)。
    //    Sean 2026-08-18 拍 `#639 甲`(整段直接印在畫面上)⇒ 期望值換成「畫面文字」。
    render(<OrdersTab orders={[{ ...ORDERS[0]!, itemCountTruncated: true }]} />);
    expect(screen.getByText(ORDER_ITEM_COUNT_TRUNCATED_NOTE)).toBeDefined();
  });

  it('🔴🔴 那段說明【不得】再掛回任何 `title` 屬性上(`#639` 這條病的定義)', () => {
    const { container } = render(
      <OrdersTab orders={[{ ...ORDERS[0]!, itemCountTruncated: true }]} />,
    );
    const titles = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title'));
    expect(titles).not.toContain(ORDER_ITEM_COUNT_TRUNCATED_NOTE);
  });

  it('正向對照:旗標關掉 ⇒ 那段說明**不出現**(⇒ 上面兩格不是恆真)', () => {
    render(<OrdersTab orders={[{ ...ORDERS[0]!, itemCountTruncated: false }]} />);
    expect(screen.queryByText(ORDER_ITEM_COUNT_TRUNCATED_NOTE)).toBeNull();
  });

  /**
   * 🔴 **正向對照** —— 同一筆、只把旗標關掉,「3 件商品」就該回來。
   * 沒有這一格,上面那條 `queryByText(/3 件商品/)` 為 null 可能只是因為選擇器打錯。
   */
  it('正向對照:旗標為假 ⇒ 「3 件商品」照常印出來', () => {
    render(<OrdersTab orders={[{ ...ORDERS[0]!, itemCountTruncated: false }]} />);
    expect(screen.getByText(/3 件商品/), '正常情況要印真實件數').toBeDefined();
  });
});

// ── 🔴🔴 `#249`(2026-08-24):取消單在客人清單上的樣子 ──────────────────────────
describe('`#249` 已取消的單:清單上不得印「待付款」', () => {
  it('🔴 這片的核心:取消單是 `unpaid` ⇒ 舊碼印「待付款」⇒ 客人去付一張作廢單', () => {
    const { container } = render(<OrdersTab orders={[CANCELLED_ORDER]} />);
    const status = container.querySelector('.acc-order-status');
    expect(status?.textContent).toBe('已取消');
    // 🔴 負對照:同一張卡、**沒有取消** ⇒ 仍要印「待付款」。
    //    少了這一格,「狀態欄整個壞掉」時上面那格也會綠。
    cleanup();
    const { container: c2 } = render(
      <OrdersTab orders={[{ ...CANCELLED_ORDER, cancelledAt: null, cancelKind: 'none' as const }]} />,
    );
    expect(c2.querySelector('.acc-order-status')?.textContent).toBe('待付款');
  });

  it('逾期單 ⇒「已逾期」(與人工取消分開,Sean 那一板的兩個字面)', () => {
    const { container } = render(
      <OrdersTab orders={[{ ...CANCELLED_ORDER, cancelKind: 'expired' as const }]} />,
    );
    expect(container.querySelector('.acc-order-status')?.textContent).toBe('已逾期');
    // 🔴 機器碼不得出現在客人畫面上的任何地方
    expect(container.innerHTML).not.toContain('payment_expired');
  });

  it('🔴 這張卡上【沒有付款入口】—— Sean 那句「不能點去付款」在這一頁是這樣成立的', () => {
    // ⚠️ 它是**現況**不是保證:誰日後在這張卡加付款鈕,這一格會紅、逼他回來讀 `#249` 那一板。
    const { container } = render(<OrdersTab orders={[CANCELLED_ORDER]} />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toContain('查看詳情');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
