// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualOrderPaymentMethod, ManualOrderShopeePayout, SHOPEE_PAYOUT_NOTE } from './manual-order-payment-method';
import {
  MANUAL_ORDER_PAYMENT_CHANNEL_FIELD,
  MANUAL_ORDER_SHOPEE_PAYOUT_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '../../lib/orders/manual-order-form';

// 貼板 262(報價單Q1 2026-10-01):付款方式加刷卡;選蝦皮來源 ⇒ 只剩蝦皮, 並出現蝦皮進帳金額。
afterEach(cleanup);

function Harness() {
  return (
    <form>
      <select name={MANUAL_ORDER_SOURCE_FIELD} aria-label='來源' defaultValue='manual_phone'>
        <option value='manual_phone'>電話</option>
        <option value='manual_shopee'>蝦皮</option>
      </select>
      <ManualOrderPaymentMethod />
      <ManualOrderShopeePayout />
    </form>
  );
}

const methods = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLOptionElement>(`select[name="${MANUAL_ORDER_PAYMENT_CHANNEL_FIELD}"] option`)].map((o) => o.value);
const payout = (c: HTMLElement) => c.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_SHOPEE_PAYOUT_FIELD}"]`);
const sent = (c: HTMLElement) => new FormData(c.querySelector('form')!);

describe('ManualOrderPaymentMethod / ManualOrderShopeePayout', () => {
  it('一般來源 ⇒ 匯款 / 現金 / 刷卡, 預設匯款;沒有蝦皮進帳欄', () => {
    const { container } = render(<Harness />);
    expect(methods(container)).toEqual(['bank_transfer', 'cash', 'card_terminal']);
    expect(sent(container).get(MANUAL_ORDER_PAYMENT_CHANNEL_FIELD)).toBe('bank_transfer');
    expect(payout(container)).toBeNull();
  });

  it('選蝦皮 ⇒ 付款方式只剩蝦皮, 出現進帳金額與說明;換回來 ⇒ 恢復', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_shopee' } });
    expect(methods(container)).toEqual(['shopee']);
    expect(sent(container).get(MANUAL_ORDER_PAYMENT_CHANNEL_FIELD)).toBe('shopee');
    fireEvent.change(payout(container)!, { target: { value: '7016' } });
    expect(sent(container).get(MANUAL_ORDER_SHOPEE_PAYOUT_FIELD)).toBe('7016');
    expect(payout(container)!.autocomplete).toBe('off');
    expect(container.textContent).toContain(SHOPEE_PAYOUT_NOTE);

    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_phone' } });
    expect(methods(container)).toEqual(['bank_transfer', 'cash', 'card_terminal']);
    expect(payout(container)).toBeNull();
  });
});
