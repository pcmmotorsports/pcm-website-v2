// @vitest-environment jsdom
//
// CheckoutMobileBuybar.test.tsx — 手機底部操作列(U3b 自 CheckoutView 抽出、行為零變更)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CheckoutMobileBuybar } from './CheckoutMobileBuybar';

afterEach(cleanup);

const base = {
  step: 1 as const,
  total: 29200,
  submitting: false,
  nextDisabled: false,
  payDisabled: false,
  onNext: vi.fn(),
  onSubmit: vi.fn(),
};

describe('CheckoutMobileBuybar', () => {
  it('step1 → 顯示「目前金額」與下一步鈕', () => {
    render(<CheckoutMobileBuybar {...base} />);
    expect(screen.getByText('目前金額')).toBeTruthy();
    expect(screen.getByText('NT$ 29,200')).toBeTruthy();
    expect(screen.getByRole('button', { name: /下一步/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /確認付款/ })).toBeNull();
  });

  it('step2 → 顯示「應付總額」與確認付款鈕', () => {
    render(<CheckoutMobileBuybar {...base} step={2} />);
    expect(screen.getByText('應付總額')).toBeTruthy();
    expect(screen.getByRole('button', { name: /確認付款/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /下一步/ })).toBeNull();
  });

  it('金額走 toLocaleString 千分位(與桌機付款鈕同源格式)', () => {
    render(<CheckoutMobileBuybar {...base} total={1234567} />);
    expect(screen.getByText('NT$ 1,234,567')).toBeTruthy();
  });

  it('submitting → 文案改「處理中…」', () => {
    render(<CheckoutMobileBuybar {...base} step={2} submitting />);
    expect(screen.getByRole('button', { name: '處理中…' })).toBeTruthy();
  });

  it('🔴 兩顆按鈕各自吃自己的 disabled 旗標(不得共用、不得 || 混用)', () => {
    // 正向:自己的旗標為 true → disabled
    const { unmount } = render(<CheckoutMobileBuybar {...base} nextDisabled payDisabled={false} />);
    expect((screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    const { unmount: u2 } = render(<CheckoutMobileBuybar {...base} step={2} nextDisabled={false} payDisabled />);
    expect((screen.getByRole('button', { name: /確認付款/ }) as HTMLButtonElement).disabled).toBe(true);
    u2();

    // 🔴 反向(殺 `nextDisabled || payDisabled` 混用;codex 關卡2 指出正向案例擋不住這種寫法):
    //    **另一顆**的旗標為 true 時,自己必須仍然可按。
    const { unmount: u3 } = render(<CheckoutMobileBuybar {...base} nextDisabled={false} payDisabled />);
    expect((screen.getByRole('button', { name: /下一步/ }) as HTMLButtonElement).disabled).toBe(false);
    u3();
    render(<CheckoutMobileBuybar {...base} step={2} nextDisabled payDisabled={false} />);
    expect((screen.getByRole('button', { name: /確認付款/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('點擊各自呼叫對應 handler(step1 → onNext、step2 → onSubmit)', () => {
    const onNext = vi.fn();
    const onSubmit = vi.fn();
    const { unmount } = render(<CheckoutMobileBuybar {...base} onNext={onNext} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(0);
    unmount();
    render(<CheckoutMobileBuybar {...base} step={2} onNext={onNext} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /確認付款/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
