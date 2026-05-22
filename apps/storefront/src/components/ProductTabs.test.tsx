// @vitest-environment jsdom
//
// ProductTabs smoke test — 前台 regression 安全網(M-1-13f-2)。
// 驗「4 tab buttons + 預設 description active + 點切換 + ARIA roles + 預約安裝 router.push」。
// useRouter 走 vi.mock(同 Header.test.tsx / ProductPage.test.tsx 慣例)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { ProductTabs } from './ProductTabs';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(() => {
  cleanup();
  mockPush.mockReset();
});

describe('ProductTabs', () => {
  it('renders 4 tab buttons with design 字面 labels', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    expect(screen.getByRole('tab', { name: '商品介紹' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '規格與相容性' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '安裝須知' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '保固與退換' })).toBeDefined();
  });

  it('defaults to description tab with aria-selected=true', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const descTab = screen.getByRole('tab', { name: '商品介紹' });
    expect(descTab.getAttribute('aria-selected')).toBe('true');
    // 其他三個 tab 應該 aria-selected="false"
    expect(
      screen.getByRole('tab', { name: '規格與相容性' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('shows description pane by default, hides others', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const descPane = document.getElementById('pd-panel-description');
    const specsPane = document.getElementById('pd-panel-specs');
    expect(descPane?.hasAttribute('hidden')).toBe(false);
    expect(specsPane?.hasAttribute('hidden')).toBe(true);
  });

  it('switches to specs pane when specs tab clicked', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByRole('tab', { name: '規格與相容性' }));
    expect(
      screen.getByRole('tab', { name: '規格與相容性' }).getAttribute('aria-selected'),
    ).toBe('true');
    const descPane = document.getElementById('pd-panel-description');
    const specsPane = document.getElementById('pd-panel-specs');
    expect(descPane?.hasAttribute('hidden')).toBe(true);
    expect(specsPane?.hasAttribute('hidden')).toBe(false);
  });

  it('wires tab aria-controls to matching panel id', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const tabs = screen.getAllByRole('tab');
    for (const t of tabs) {
      const controls = t.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      const panel = document.getElementById(controls!);
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute('aria-labelledby')).toBe(t.id);
    }
  });

  it('renders install CTA that pushes /install on click', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByRole('tab', { name: '安裝須知' }));
    fireEvent.click(screen.getByRole('button', { name: /預約安裝/ }));
    expect(mockPush).toHaveBeenCalledWith('/install');
  });

  it('renders product brand / name / fits in description lead', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductTabs product={product} />);
    const descPane = document.getElementById('pd-panel-description');
    expect(descPane?.textContent).toContain(product.brand);
    expect(descPane?.textContent).toContain(product.name);
  });

  it('renders product id padded to 5 in specs', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductTabs product={product} />);
    const expected = `PCM-${String(product.id).padStart(5, '0')}`;
    fireEvent.click(screen.getByRole('tab', { name: '規格與相容性' }));
    expect(screen.getByText(expected)).toBeDefined();
  });

  // M-1-13H-6 Codex Fix 1:鍵盤導覽 regression(W3C WAI-ARIA Tabs、Sean Q1=B 完整版)
  it('ArrowRight moves to next tab + selects it (description → specs)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const descTab = screen.getByRole('tab', { name: '商品介紹' });
    fireEvent.keyDown(descTab, { key: 'ArrowRight' });
    expect(
      screen.getByRole('tab', { name: '規格與相容性' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(descTab.getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowLeft from first tab wraps to last tab (循環)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const descTab = screen.getByRole('tab', { name: '商品介紹' });
    fireEvent.keyDown(descTab, { key: 'ArrowLeft' });
    expect(
      screen.getByRole('tab', { name: '保固與退換' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('Home selects first tab, End selects last tab', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    // 先切到 specs、再按 Home 回第一個
    fireEvent.click(screen.getByRole('tab', { name: '規格與相容性' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: '規格與相容性' }), { key: 'Home' });
    expect(
      screen.getByRole('tab', { name: '商品介紹' }).getAttribute('aria-selected'),
    ).toBe('true');
    // 按 End 切最後一個
    fireEvent.keyDown(screen.getByRole('tab', { name: '商品介紹' }), { key: 'End' });
    expect(
      screen.getByRole('tab', { name: '保固與退換' }).getAttribute('aria-selected'),
    ).toBe('true');
  });
});
