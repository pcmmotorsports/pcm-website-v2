// @vitest-environment jsdom
//
// OrdersTab smoke(M-3:接真訂單摘要清單)。
//
// 驗:
// - 標題「訂單記錄」+ acc-section 殼(data-tab="orders")
// - 多單 props → 渲染 displayId / 日期(YYYY-MM-DD)/ itemCount 件商品 / 金額 NT$ / 狀態中文 + .acc-order-full + 查看詳情鈕
// - 空陣列 → acc-empty 空狀態
// - 查看詳情鈕(Q1=A)為 <button>、無導頁(明細頁 backlog #240)
// - 反洩 guard:orders={[]} 空渲染不含 design mock 字面(PCM-2026-0042 / NT$ 18,600)= 證元件無 hardcode mock
//   (真資料合法含 PCM-YYYY-NNNN / 已出貨,故不再 blanket 禁該類字面,改鎖「特定 design mock 值」)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { toMoneyAmount, type OrderListItem } from '@pcm/domain';
import { OrdersTab } from './OrdersTab';
import { ORDER_ITEM_COUNT_TRUNCATED_NOTE } from '@/lib/account-order-copy';

afterEach(cleanup);

// 測試用訂單(刻意非 design mock 字面;2099 年 + 中性值,防與反洩 guard 混淆)
const ORDERS: OrderListItem[] = [
  {
    id: 'ord-1',
    displayId: 'PCM-2099-0007',
    createdAt: '2099-04-15T10:00:00Z', // +8h 同日 → 2099-04-15
    paymentStatus: 'paid',
    fulfillmentStatus: 'shipped',
    total: { amount: toMoneyAmount(12345), currency: 'TWD' },
    itemCount: 3,
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

  it('查看詳情鈕(Q1=A):為 <button>、每單一顆、無 href 導頁(明細頁 backlog #240)', () => {
    const { container } = render(<OrdersTab orders={ORDERS} />);
    const detailBtns = container.querySelectorAll('button.acc-order-detail');
    expect(detailBtns).toHaveLength(2);
    const first = detailBtns[0] as HTMLButtonElement;
    expect(first.tagName).toBe('BUTTON');
    expect(first.textContent).toBe('查看詳情 →');
    // 非 <a>、無 href(button-not-href、對齊 design)
    expect(container.querySelector('a.acc-order-detail')).toBeNull();
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
