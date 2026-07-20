// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerAddress } from '@pcm/domain';
import { CheckoutStep1 } from './CheckoutStep1';

afterEach(cleanup);

const ADDR = {
  id: '00000000-0000-4000-8000-000000000001',
  isDefault: true,
  name: '測試會員',
  phone: '0900000000',
  line: '測試市測試路 1 號',
} as unknown as CustomerAddress;

function renderStep1(notificationEmailEnabled: boolean) {
  const onNotificationEmailChange = vi.fn();
  const onNext = vi.fn();
  const onBack = vi.fn();

  render(
    <CheckoutStep1
      addresses={[ADDR]}
      shippingAddrId={ADDR.id}
      onShippingAddressChange={vi.fn()}
      shipping={0}
      notificationEmailEnabled={notificationEmailEnabled}
      notificationEmail="Member@EXAMPLE.COM"
      notificationEmailError={null}
      onNotificationEmailChange={onNotificationEmailChange}
      onBack={onBack}
      onNext={onNext}
      nextDisabled={false}
    />,
  );

  return { onNotificationEmailChange, onNext, onBack };
}

describe('CheckoutStep1', () => {
  it('flag off 時完全不顯示 Email 欄與揭露文案', () => {
    renderStep1(false);
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByText('此信箱也可能用於信用卡付款驗證')).toBeNull();
  });

  it('flag on 時顯示預填 Email、揭露文案，並回傳使用者輸入', () => {
    const { onNotificationEmailChange } = renderStep1(true);
    const input = screen.getByLabelText('Email') as HTMLInputElement;

    expect(input.value).toBe('Member@EXAMPLE.COM');
    expect(screen.getByText('此信箱也可能用於信用卡付款驗證')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'new@example.com' } });
    expect(onNotificationEmailChange).toHaveBeenCalledWith('new@example.com');
  });

  it('沿用地址、配送與上下步驟操作', () => {
    const { onNext, onBack } = renderStep1(false);
    expect(screen.getByText('測試會員')).toBeTruthy();
    expect(screen.getByText('貨運宅配')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /返回購物車/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步:付款方式/ }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
