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
  },
  {
    id: 'ord-2',
    displayId: 'PCM-2099-0003',
    createdAt: '2099-03-28T10:00:00Z',
    paymentStatus: 'unpaid',
    fulfillmentStatus: 'notOrdered',
    total: { amount: toMoneyAmount(980), currency: 'TWD' },
    itemCount: 1,
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
    // 狀態中文(雙軸映射):paid+shipped → 已出貨;unpaid → 待付款
    expect(screen.getByText('已出貨')).toBeTruthy();
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
