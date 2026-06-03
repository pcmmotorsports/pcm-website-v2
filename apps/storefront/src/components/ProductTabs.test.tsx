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
    expect(screen.getByRole('tab', { name: '規格 / 相容性' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '安裝須知' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '保固與退換' })).toBeDefined();
  });

  it('defaults to description tab with aria-selected=true', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const descTab = screen.getByRole('tab', { name: '商品介紹' });
    expect(descTab.getAttribute('aria-selected')).toBe('true');
    // 其他三個 tab 應該 aria-selected="false"
    expect(
      screen.getByRole('tab', { name: '規格 / 相容性' }).getAttribute('aria-selected'),
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
    fireEvent.click(screen.getByRole('tab', { name: '規格 / 相容性' }));
    expect(
      screen.getByRole('tab', { name: '規格 / 相容性' }).getAttribute('aria-selected'),
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

  // M-1-16c-4b:產品型號顯真主碼 productCode(取代 PCM-{id hash});無 productCode fallback slug
  it('renders productCode in specs when present', () => {
    const product = { ...MOCK_PRODUCTS[0]!, productCode: 'RPM-DCC01' };
    render(<ProductTabs product={product} />);
    fireEvent.click(screen.getByRole('tab', { name: '規格 / 相容性' }));
    expect(screen.getByText('RPM-DCC01')).toBeDefined();
  });

  it('falls back to slug in specs when productCode absent (no PCM-{id} hash)', () => {
    const product = MOCK_PRODUCTS[0]!; // 無 productCode
    render(<ProductTabs product={product} />);
    fireEvent.click(screen.getByRole('tab', { name: '規格 / 相容性' }));
    expect(screen.getByText(product.slug)).toBeDefined();
    expect(screen.queryByText(`PCM-${String(product.id).padStart(5, '0')}`)).toBeNull();
  });

  // M-1-16c-4b:產地泰國(Sean 拍、去義大利)
  it('renders 產地 泰國 (not 義大利) in specs', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByRole('tab', { name: '規格 / 相容性' }));
    expect(screen.getByText('泰國')).toBeDefined();
  });

  // OD-8 碳纖維化:確認舊 hardcoded 鋁合金規格殘留(7075-T6 / Hard Anodized / 義大利保固 / 重量)已清除、
  // 換 OD 碳纖字面。注意:不可斷言 textContent 無「鋁合金」三字 —— mock 目錄沿用舊品名
  // (如 MOCK_PRODUCTS[0] = "Lightech 鋁合金腳踏組"),「鋁合金」來自動態 product.name、非 hardcoded 文案;
  // 碳纖通用文案以 RPM production 資料為目標(同 OD-6/7a)、mock 名稱不符屬本機 dev 殘留、非 production 問題。
  it('description pane uses 真碳纖維 copy (no hardcoded 7075-T6 spec residue)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const pane = document.getElementById('pd-panel-description');
    expect(pane?.textContent).toContain('真碳纖維');
    expect(pane?.textContent).not.toContain('7075');
  });

  it('specs pane shows 真碳纖維 材質 + 紋路可選 + 特殊樣式 rows (no 7075 / Hard Anodized)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByRole('tab', { name: '規格 / 相容性' }));
    const pane = document.getElementById('pd-panel-specs');
    expect(pane?.textContent).toContain('真碳纖維');
    expect(pane?.textContent).toContain('紋路可選');
    expect(pane?.textContent).toContain('特殊樣式');
    expect(pane?.textContent).not.toContain('7075');
    expect(pane?.textContent).not.toContain('Hard Anodized');
  });

  it('install pane uses RPM 共用 carbon copy + drops 4-step pd-step cards', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByRole('tab', { name: '安裝須知' }));
    const pane = document.getElementById('pd-panel-install');
    expect(pane?.textContent).toContain('因品而異');
    expect(pane?.querySelector('.pd-steps')).toBeNull();
    expect(pane?.querySelector('.pd-step')).toBeNull();
  });

  it('warranty pane uses 客製訂製 policy 鑑賞期 clause (no 義大利 24 個月 residue)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    fireEvent.click(screen.getByRole('tab', { name: '保固與退換' }));
    const pane = document.getElementById('pd-panel-warranty');
    expect(pane?.textContent).toContain('不適用 7 天鑑賞期');
    expect(pane?.textContent).toContain('客製');
    expect(pane?.textContent).not.toContain('義大利');
  });

  // M-1-13H-6 Codex Fix 1:鍵盤導覽 regression(W3C WAI-ARIA Tabs、Sean Q1=B 完整版)
  it('ArrowRight moves to next tab + selects it (description → specs)', () => {
    render(<ProductTabs product={MOCK_PRODUCTS[0]!} />);
    const descTab = screen.getByRole('tab', { name: '商品介紹' });
    fireEvent.keyDown(descTab, { key: 'ArrowRight' });
    expect(
      screen.getByRole('tab', { name: '規格 / 相容性' }).getAttribute('aria-selected'),
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
    fireEvent.click(screen.getByRole('tab', { name: '規格 / 相容性' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: '規格 / 相容性' }), { key: 'Home' });
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
