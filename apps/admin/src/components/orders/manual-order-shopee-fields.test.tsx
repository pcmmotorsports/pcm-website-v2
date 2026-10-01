// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualOrderShopeeFields } from './manual-order-shopee-fields';
import {
  MANUAL_ORDER_SHOPEE_ORDER_NO_FIELD,
  MANUAL_ORDER_SHOPEE_USERNAME_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '../../lib/orders/manual-order-form';

// 貼板 261(Sean 2026-10-01 蝦皮帳號):選「蝦皮」才出現蝦皮帳號、蝦皮訂單編號兩格;換回其他來源 ⇒ 兩格消失、不送出。
afterEach(cleanup);

function Harness() {
  return (
    <form>
      <select name={MANUAL_ORDER_SOURCE_FIELD} aria-label='來源' defaultValue='manual_phone'>
        <option value='manual_phone'>電話</option>
        <option value='manual_shopee'>蝦皮</option>
      </select>
      <ManualOrderShopeeFields />
    </form>
  );
}

const sent = (c: HTMLElement) => {
  const fd = new FormData(c.querySelector('form')!);
  return [fd.getAll(MANUAL_ORDER_SHOPEE_USERNAME_FIELD), fd.getAll(MANUAL_ORDER_SHOPEE_ORDER_NO_FIELD)];
};

describe('ManualOrderShopeeFields', () => {
  it('其他來源 ⇒ 沒有這兩格, 也不送出', () => {
    const { container, queryByLabelText } = render(<Harness />);
    expect(queryByLabelText('蝦皮帳號')).toBeNull();
    expect(sent(container)).toEqual([[], []]);
  });

  it('🔴 選蝦皮 ⇒ 出現兩格, 填的值會送出', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_shopee' } });
    fireEvent.change(getByLabelText('蝦皮帳號'), { target: { value: 'moto_wang' } });
    fireEvent.change(getByLabelText('蝦皮訂單編號'), { target: { value: '240901ABCD' } });
    expect(sent(container)).toEqual([['moto_wang'], ['240901ABCD']]);
  });

  it('換回其他來源 ⇒ 兩格消失, 不送出', () => {
    const { container, getByLabelText, queryByLabelText } = render(<Harness />);
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_shopee' } });
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_phone' } });
    expect(queryByLabelText('蝦皮帳號')).toBeNull();
    expect(sent(container)).toEqual([[], []]);
  });
});
