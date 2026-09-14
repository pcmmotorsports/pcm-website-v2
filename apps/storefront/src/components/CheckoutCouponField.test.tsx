// @vitest-environment jsdom
// CheckoutCouponField.test.tsx — ⟦b4-COUPONFIELD⟧ 片 B。
//
// 🔵 被拒的文案不在這裡 —— 一律由 `lib/checkout/coupon-reject.ts` 翻(那支的測試守「全部同一句」)。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { CheckoutCouponField } from './CheckoutCouponField';

afterEach(cleanup);

describe('CheckoutCouponField · 片 B:框在、鈕還不能按', () => {
  it('🔴 沒給 onApply(片 B 的樣子)⇒ 鈕 disabled —— 不做按了沒反應的鈕', () => {
    render(<CheckoutCouponField code="SAVE10" onCodeChange={() => {}} />);
    expect((screen.getByRole('button', { name: '套用' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('🟢 給了 onApply 而有碼 ⇒ 按得下去, 且真的呼叫一次', () => {
    const onApply = vi.fn();
    render(<CheckoutCouponField code="SAVE10" onCodeChange={() => {}} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '套用' }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('🔵 空白 / 純空白的碼 ⇒ 鈕仍是關的(不送一個空碼去問 DB)', () => {
    const onApply = vi.fn();
    const { rerender } = render(<CheckoutCouponField code="" onCodeChange={() => {}} onApply={onApply} />);
    expect((screen.getByRole('button', { name: '套用' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<CheckoutCouponField code="   " onCodeChange={() => {}} onApply={onApply} />);
    expect((screen.getByRole('button', { name: '套用' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('🔴 在券碼欄按 Enter ⇒ 不送出整張表單(preventDefault), 只觸發套用', () => {
    const onApply = vi.fn();
    render(<CheckoutCouponField code="SAVE10" onCodeChange={() => {}} onApply={onApply} />);
    const input = screen.getByLabelText('優惠碼');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(input, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('🟢 打字會往上送, 而元件自己不改大小寫(正規化在 DB)', () => {
    const onCodeChange = vi.fn();
    render(<CheckoutCouponField code="" onCodeChange={onCodeChange} />);
    fireEvent.change(screen.getByLabelText('優惠碼'), { target: { value: ' save10 ' } });
    expect(onCodeChange).toHaveBeenCalledWith(' save10 ');
  });

  it('🟢 片 C:按了套用 ⇒ 畫面說「結帳時會套用這張券」(不謊稱已經折了多少)', () => {
    render(<CheckoutCouponField code="SAVE10" onCodeChange={() => {}} state={{ kind: 'pending' }} />);
    expect(screen.getByRole('status').textContent).toBe('結帳時會套用這張券');
  });

  it('🔴 片 D:結帳被拒 ⇒ 券碼欄印出那句話(不是只在付款區), 而「會套用」那句要消失', () => {
    const { container } = render(
      <CheckoutCouponField
        code="REVIEW100"
        onCodeChange={() => {}}
        state={{ kind: 'rejected-message', message: '這張券不能用' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('這張券不能用');
    expect(container.textContent).not.toContain('結帳時會套用');
  });

  it('🟢 套用成功 / 確認中各印各的', () => {
    const { rerender } = render(
      <CheckoutCouponField code="SAVE10" onCodeChange={() => {}} state={{ kind: 'applied', discount: 1200 }} />,
    );
    expect(screen.getByRole('status').textContent).toContain('NT$ 1,200');

    rerender(<CheckoutCouponField code="SAVE10" onCodeChange={() => {}} state={{ kind: 'checking' }} />);
    expect((screen.getByRole('button', { name: '確認中…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('優惠碼') as HTMLInputElement).disabled).toBe(true);
  });
});
