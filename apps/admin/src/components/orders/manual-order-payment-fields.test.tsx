// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ManualOrderPaymentFields } from './manual-order-payment-fields';

afterEach(cleanup);

// 2026-10-01 建單簡化(S3):只搬位置 ⇒ 送出的值與搬家前逐字相同(運費與稅別是錢)。
describe('付款與取貨:搬家後預設值不變', () => {
  it('🔴 預設送出:匯款 / 宅配 / 運費 0 / 運費稅別未稅;會員等級沒選客人時不送(由解析端擋)', () => {
    render(
      <form data-testid='f'>
        <ManualOrderPaymentFields />
      </form>,
    );
    const fd = new FormData(screen.getByTestId('f') as HTMLFormElement);
    expect(fd.get('payment_channel')).toBe('bank_transfer');
    expect(fd.get('shipping_method')).toBe('home');
    expect(fd.get('shipping_fee')).toBe('0');
    expect(fd.get('shipping_fee_tax_basis')).toBe('untaxed');
    expect(fd.get('tier_at_checkout')).toBeNull();
  });

  it('標籤:付款方式、取貨方式、運費、運費稅別、會員等級都在', () => {
    render(<ManualOrderPaymentFields />);
    for (const t of ['會員等級', '付款方式', '取貨方式', '運費', '運費稅別']) {
      expect(screen.getByLabelText(t)).toBeTruthy();
    }
  });
});
