// @vitest-environment jsdom
//
// InfoShippingPage smoke test(A2)— 前台 regression 安全網。
// 驗「三 tab 渲染 + 運費字面接 SSoT 常數 + 退換貨渲染 rpm-policies 單一真相(非 design 7 天鑑賞期示意)」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/info/shipping',
  useSearchParams: () => new URLSearchParams(),
}));

import { InfoShippingPage } from './InfoShippingPage';
import { CartProvider } from '../contexts/CartContext';

// Header 內含 useCart → 需 CartProvider wrapper(對齊 ProductPage.test 慣例)
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

afterEach(() => {
  cleanup();
  // 清 CartProvider localStorage 殘留、避免 test 互染(對齊 ProductPage.test)
  if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('InfoShippingPage', () => {
  it('renders hero + shipping tab with SSoT fee figures (5,000 免運 / NT$100、非 design 4000/150)', () => {
    render(<InfoShippingPage />);
    expect(screen.getByText('配送 & 退貨政策')).toBeDefined();
    expect(screen.getByText('貨運宅配')).toBeDefined();
    // FREE_SHIPPING_THRESHOLD=5000 / HOME_SHIPPING_FEE=100(@pcm/domain、checkout 同源)
    expect(screen.getByText(/滿 NT\$ 5,000 免運，到府配送/)).toBeDefined();
    expect(screen.getByText(/運費 NT\$ 100/)).toBeDefined();
    // design 示意值不得出現
    expect(screen.queryByText(/4,?000/)).toBeNull();
    expect(screen.queryByText(/NT\$ ?150/)).toBeNull();
    // design「合作店家取貨」卡不搬(checkout Q1=A 只宅配)
    expect(screen.queryByText('合作店家取貨')).toBeNull();
  });

  it('returns tab renders rpm-policies 單一真相(不適用鑑賞期、非 design「7 天鑑賞期可退」)', () => {
    render(<InfoShippingPage />);
    fireEvent.click(screen.getByText('退換貨'));
    expect(screen.getByText('退換貨政策')).toBeDefined();
    // rpm-policies 法律主張字面(Sean 釘):客製代購不適用 7 天鑑賞期
    expect(screen.getByText('不適用 7 天鑑賞期')).toBeDefined();
    expect(screen.getByText('客製化委任代購')).toBeDefined();
    // design 示意「7 天鑑賞期」可退版本不得出現
    expect(screen.queryByText(/自商品送達日起 7 日內可申請退貨/)).toBeNull();
  });

  it('faq tab reuses ProductFAQ FAQ_ITEMS 單一真相', () => {
    render(<InfoShippingPage />);
    fireEvent.click(screen.getByText('常見問題'));
    expect(screen.getByText('如何訂購？（下單・付款・配送）')).toBeDefined();
    expect(screen.getByText('訂購要等多久？')).toBeDefined();
    expect(screen.getByText('保固與退換貨')).toBeDefined();
  });
});
