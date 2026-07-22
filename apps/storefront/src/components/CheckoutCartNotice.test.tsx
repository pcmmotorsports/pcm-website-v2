// @vitest-environment jsdom
//
// CheckoutCartNotice 守門測試(M-3 兩步結帳 Slice U4a-0)。
//
// 🔴 codex 關卡1 R2 must-fix:光比對 DOM 字串相同**證不了導航接線**——
//    「繼續購物」按鈕如果被抽元件時接錯(或漏接),畫面長得一模一樣、DOM 比對照樣全綠。
//    所以這裡必須實際點下去、斷言 onContinueShopping 恰好被呼叫一次。

import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CheckoutCartNotice } from '@/components/CheckoutCartNotice';

// stub Header/HomeFooter(非受測、避其 useRouter/useCart/MobileContext 依賴;沿用 CheckoutSuccess.test 慣例)。
// 仍給 testid,才能斷言「結帳殼三件(Header + 內容 + 頁尾)有被搬完整」。
vi.mock('@/components/Header', () => ({ Header: () => <div data-testid="stub-header" /> }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => <div data-testid="stub-footer" /> }));

describe('CheckoutCartNotice', () => {
  it('loading → 載入文案 + 無空車按鈕', () => {
    const { container } = render(<CheckoutCartNotice variant="loading" />);
    expect(container.querySelector('.cart-loading')?.textContent).toBe('載入結帳資料…');
    expect(container.querySelector('.cart-empty')).toBeNull();
    expect(screen.queryByRole('button', { name: '繼續購物' })).toBeNull();
    cleanup();
  });

  it('empty → 空車文案 + 繼續購物按鈕 + 無載入文案', () => {
    const { container } = render(
      <CheckoutCartNotice variant="empty" onContinueShopping={vi.fn()} />,
    );
    expect(screen.getByText('購物車是空的')).toBeTruthy();
    expect(screen.getByText('先挑選部品再來結帳吧。')).toBeTruthy();
    expect(container.querySelector('.cart-loading')).toBeNull();
    cleanup();
  });

  it('🔴 點「繼續購物」→ onContinueShopping 恰好一次(守導航接線,DOM 比對抓不到)', () => {
    const onContinueShopping = vi.fn();
    render(<CheckoutCartNotice variant="empty" onContinueShopping={onContinueShopping} />);
    fireEvent.click(screen.getByRole('button', { name: '繼續購物' }));
    expect(onContinueShopping).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('兩個 variant 都保留結帳殼結構(data-screen-label / co-page / 頁尾)', () => {
    for (const el of [
      <CheckoutCartNotice key="l" variant="loading" />,
      <CheckoutCartNotice key="e" variant="empty" onContinueShopping={vi.fn()} />,
    ]) {
      const { container } = render(el);
      const shell = container.querySelector('.co-page');
      expect(shell?.getAttribute('data-screen-label')).toBe('Checkout');
      expect(screen.getByTestId('stub-header')).toBeTruthy();
      expect(screen.getByTestId('stub-footer')).toBeTruthy();
      cleanup();
    }
  });
});
