// @vitest-environment jsdom
//
// OrdersTab smoke(g-2:空狀態)。
//
// 驗:
// - 標題「訂單記錄」+ acc-section-head 殼
// - acc-empty 「目前尚無訂單紀錄」+ sub「您的購買紀錄會顯示在此」
// - 不洩 design mock 訂單字面(PCM-2026-XXXX / 已出貨 / NT$ 18,600 等)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OrdersTab } from './OrdersTab';

afterEach(cleanup);

describe('OrdersTab(g-2 空狀態)', () => {
  it('標題「訂單記錄」+ acc-section 殼', () => {
    const { container } = render(<OrdersTab />);
    expect(screen.getByText('訂單記錄')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="orders"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
  });

  it('acc-empty 文案「目前尚無訂單紀錄」+ sub「您的購買紀錄會顯示在此」', () => {
    const { container } = render(<OrdersTab />);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(screen.getByText('目前尚無訂單紀錄')).toBeTruthy();
    expect(screen.getByText('您的購買紀錄會顯示在此')).toBeTruthy();
  });

  it('不洩 design mock 訂單字面(防 g-2 反走樣)', () => {
    const { container } = render(<OrdersTab />);
    expect(container.textContent).not.toMatch(/PCM-2026-/);
    expect(container.textContent).not.toContain('已出貨');
    expect(container.textContent).not.toContain('已完成');
  });
});
