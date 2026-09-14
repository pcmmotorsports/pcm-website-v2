// @vitest-environment jsdom
// CheckoutCouponField.test.tsx — ⟦b4-COUPONFIELD⟧ 片 B。
//
// 🔴 這支守的第一件事不是樣式,是**那三種理由講同一句**(Q1 的安全結論)——
//    有人哪天把 not_found / inactive / exhausted 拆開講,這裡要紅。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { CheckoutCouponField, couponRejectMessage } from './CheckoutCouponField';

afterEach(cleanup);

describe('couponRejectMessage · 講得出理由的講, 會洩漏券存在的收成同一句', () => {
  it('🔴 not_found / inactive / exhausted 三種【逐字相同】', () => {
    const a = couponRejectMessage('not_found');
    expect(couponRejectMessage('inactive')).toBe(a);
    expect(couponRejectMessage('exhausted')).toBe(a);
    expect(a).toBe('這張券不能用');
  });

  it('🟢 其餘四種各講各的, 而且不等於那句籠統的', () => {
    const vague = couponRejectMessage('not_found');
    for (const r of ['expired', 'tier_conflict', 'already_used_by_account'] as const) {
      expect(couponRejectMessage(r)).not.toBe(vague);
    }
    expect(couponRejectMessage('expired')).toBe('這張券已經過期了');
    expect(couponRejectMessage('tier_conflict')).toBe('這張券不適用你目前的會員價');
    expect(couponRejectMessage('already_used_by_account')).toBe('你已經用過這張券了');
  });

  it('🟢 低消:講門檻與還差多少;算不出來時只講門檻, 不亂猜', () => {
    expect(couponRejectMessage('below_min_spend', { minSpend: 3000, subtotal: 1200 })).toBe(
      '訂單滿 NT$ 3,000 才能用這張券,還差 NT$ 1,800',
    );
    expect(couponRejectMessage('below_min_spend', { minSpend: 3000 })).toBe('訂單滿 NT$ 3,000 才能用這張券');
    expect(couponRejectMessage('below_min_spend')).toBe('這張券有最低消費門檻,目前還沒達到');
  });
});

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

  it('🟢 三種結果各印各的:套用成功 / 被擋 / 確認中', () => {
    const { rerender } = render(
      <CheckoutCouponField code="SAVE10" onCodeChange={() => {}} state={{ kind: 'applied', discount: 1200 }} />,
    );
    expect(screen.getByRole('status').textContent).toContain('NT$ 1,200');

    rerender(
      <CheckoutCouponField
        code="SAVE10"
        onCodeChange={() => {}}
        state={{ kind: 'rejected', reason: 'expired' }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('這張券已經過期了');

    rerender(<CheckoutCouponField code="SAVE10" onCodeChange={() => {}} state={{ kind: 'checking' }} />);
    expect((screen.getByRole('button', { name: '確認中…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('優惠碼') as HTMLInputElement).disabled).toBe(true);
  });
});
