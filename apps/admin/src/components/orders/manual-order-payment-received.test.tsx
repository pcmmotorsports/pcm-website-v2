// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualOrderPaymentReceived, SHOPEE_PAYOUT_NOTE } from './manual-order-payment-received';
import { ManualOrderPaymentMethod } from './manual-order-payment-method';
import {
  MANUAL_ORDER_INVOICE_REQUESTED_FIELD,
  MANUAL_ORDER_LINE_QTY_BASE,
  MANUAL_ORDER_LINE_TAX_BASIS_BASE,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  MANUAL_ORDER_PAYMENT_CHANNEL_FIELD,
  MANUAL_ORDER_SHIPPING_FEE_FIELD,
  MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
  manualOrderLineField,
} from '../../lib/orders/manual-order-form';

// 貼板 263(Sean 2026-10-02「建單時登記收款」Q1–Q4 甲 + 蝦皮進帳搬進收款區):
//   一般單 ⇒ 勾「客人已付款」才展開;預設已收全額(金額 = 畫面上的總額, 只是預覽);取消全額才填金額;匯款要單號。
//   蝦皮單 ⇒ 直接展開:左「金額」(訂單總額)、右「蝦皮進帳金額」、下面一行說明。
afterEach(cleanup);

function Harness() {
  return (
    <form>
      <select name={MANUAL_ORDER_SOURCE_FIELD} aria-label='來源' defaultValue='manual_phone'>
        <option value='manual_phone'>電話</option>
        <option value='manual_shopee'>蝦皮</option>
      </select>
      <ManualOrderPaymentMethod />
      {/* 讓總額預覽算得出 7,900:一列 7700 × 1(未稅、不開發票)+ 運費 200 */}
      <input name={manualOrderLineField(MANUAL_ORDER_LINE_QTY_BASE, 0)} defaultValue='1' />
      <input name={manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, 0)} defaultValue='7700' />
      <input name={manualOrderLineField(MANUAL_ORDER_LINE_TAX_BASIS_BASE, 0)} defaultValue='untaxed' />
      <input name={MANUAL_ORDER_SHIPPING_FEE_FIELD} defaultValue='200' />
      <input name={MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD} defaultValue='untaxed' />
      <input type='hidden' name={MANUAL_ORDER_INVOICE_REQUESTED_FIELD} value='off' />
      <ManualOrderPaymentReceived />
    </form>
  );
}

const sent = (c: HTMLElement) => new FormData(c.querySelector('form')!);
const input = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const section = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="manual-order-payment-received"]')!;

describe('ManualOrderPaymentReceived', () => {
  it('一般單:預設沒勾 ⇒ 什麼收款欄位都不送(跟以前一樣)', () => {
    const { container, getByLabelText } = render(<Harness />);
    expect((getByLabelText('客人已付款，建單時一起登記收款') as HTMLInputElement).checked).toBe(false);
    expect([...sent(container).keys()].filter((k) => k.startsWith('paid_'))).toEqual([]);
    expect(input(container, 'shopee_payout')).toBeNull();
  });

  it('勾了 ⇒ 預設已收全額, 金額顯示畫面上的總額;只送 paid_at_create + paid_full', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.click(getByLabelText('客人已付款，建單時一起登記收款'));
    expect((getByLabelText('已收全額') as HTMLInputElement).checked).toBe(true);
    expect(section(container).textContent).toContain('NT$ 7,900');
    expect(input(container, 'paid_amount')).toBeNull();
    const f = sent(container);
    expect([f.get('paid_at_create'), f.get('paid_full'), f.has('paid_amount')]).toEqual(['on', 'on', false]);
  });

  it('取消已收全額 ⇒ 出現金額欄, 送填的金額(部分收款)', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.click(getByLabelText('客人已付款，建單時一起登記收款'));
    fireEvent.click(getByLabelText('已收全額'));
    fireEvent.change(input(container, 'paid_amount')!, { target: { value: '3000' } });
    const f = sent(container);
    expect([f.has('paid_full'), f.get('paid_amount')]).toEqual([false, '3000']);
    expect(input(container, 'paid_amount')!.autocomplete).toBe('off');
  });

  it('匯款才有銀行單號那一格;換成現金 ⇒ 那一格不見', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.click(getByLabelText('客人已付款，建單時一起登記收款'));
    expect(input(container, 'paid_bank_reference')).not.toBeNull();
    const channel = container.querySelector<HTMLSelectElement>(`select[name="${MANUAL_ORDER_PAYMENT_CHANNEL_FIELD}"]`)!;
    fireEvent.change(channel, { target: { value: 'cash' } });
    expect(input(container, 'paid_bank_reference')).toBeNull();
    expect(input(container, 'paid_note')).not.toBeNull();
  });

  it('蝦皮單 ⇒ 不用勾, 直接看到金額(總額)與蝦皮進帳金額和說明;不送 paid_*', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_shopee' } });
    expect(container.textContent).not.toContain('客人已付款，建單時一起登記收款');
    expect(section(container).textContent).toContain('NT$ 7,900');
    fireEvent.change(input(container, 'shopee_payout')!, { target: { value: '7016' } });
    expect(sent(container).get('shopee_payout')).toBe('7016');
    expect(section(container).textContent).toContain(SHOPEE_PAYOUT_NOTE);
    expect([...sent(container).keys()].filter((k) => k.startsWith('paid_'))).toEqual([]);

    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_phone' } });
    expect(input(container, 'shopee_payout')).toBeNull();
  });

  it('品項還沒填 ⇒ 全額那一格不編數字', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.change(input(container, manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, 0))!, { target: { value: '' } });
    fireEvent.click(getByLabelText('客人已付款，建單時一起登記收款'));
    expect(section(container).textContent).not.toContain('NT$');
  });
});
