// @vitest-environment jsdom
//
// CheckoutAwaitingRemittance — ⟦b4-BANKCHARGESCARD⟧ 片 2 ⑤。
// 🔬 **本檔守的是「他被送到了一個 reload 活得過的地方」** —— 而那正是這一片的全部意義:
//   停在結帳頁給連結 ⇒ 沒點就重整 ⇒ 單號與連結全消失(那個終態活在 React state 裡)。
// 🛑 本檔**不驗**「明細頁上印什麼」—— 那是 `OrderDetailView` 的守備範圍。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: hoisted.replace, push: hoisted.push, refresh: vi.fn() }),
}));
vi.mock('@/components/Header', () => ({ Header: () => null }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => null }));

import { CheckoutAwaitingRemittance } from './CheckoutAwaitingRemittance';

afterEach(() => { cleanup(); hoisted.replace.mockClear(); hoisted.push.mockClear(); });

describe('CheckoutAwaitingRemittance', () => {
  it('🔴 立刻導到訂單明細頁(而且是 replace 不是 push)', () => {
    // 🔵 `replace` 的理由:客人**不該用上一頁回到結帳頁** —— 那張單已經建好了, 回去只會讓他再送一次。
    render(<CheckoutAwaitingRemittance displayId="PCM-2026-0001" message="請依匯款資訊完成轉帳" />);
    expect(hoisted.replace).toHaveBeenCalledWith('/account/orders/PCM-2026-0001');
    expect(hoisted.push, 'push 會把結帳頁留在上一頁').not.toHaveBeenCalled();
  });

  it('🔴 displayId 要過 encodeURIComponent(它是使用者可見碼、不保證 URL-safe)', () => {
    // 🛑 上一格對這個突變是**瞎的**(`PCM-2026-0001` 編碼前後一模一樣)⇒ 所以要有這一格。
    render(<CheckoutAwaitingRemittance displayId="A/B 1&2" message="m" />);
    expect(hoisted.replace).toHaveBeenCalledWith('/account/orders/A%2FB%201%262');
  });

  it('🔵 導頁之前先給客人看見「訂單已成立,等待匯款」+ 單號(不是空白也不是錯誤畫面)', () => {
    // 📌 這一格擋的是「把它接成失敗畫面」那種改法 —— 片 1 明寫那是暫時的。
    render(<CheckoutAwaitingRemittance displayId="PCM-2026-0002" message="請於三日內完成匯款" />);
    expect(screen.getByText('訂單已成立,等待匯款')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0002')).toBeTruthy();
    expect(screen.getByText('請於三日內完成匯款')).toBeTruthy();
    expect(screen.queryByText('付款未完成'), '走成失敗畫面 ⇒ 與「已成立」前後矛盾').toBeNull();
  });
});
