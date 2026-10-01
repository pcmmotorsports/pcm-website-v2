// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ManualOrderNotificationEmail, SHOPEE_NO_EMAIL_NOTE } from './manual-order-notification-email';
import { MANUAL_ORDER_NOTIFICATION_EMAIL_FIELD, MANUAL_ORDER_SOURCE_FIELD } from '../../lib/orders/manual-order-form';

// 貼板 260 之後(Sean 2026-10-01):選「蝦皮」⇒ 通知 email 清空並鎖住, 旁邊寫「蝦皮訂單不寄通知信」;換回其他來源 ⇒ 恢復可填。
afterEach(cleanup);

function Harness() {
  return (
    <form>
      <select name={MANUAL_ORDER_SOURCE_FIELD} aria-label='來源' defaultValue='manual_phone'>
        <option value='manual_phone'>電話</option>
        <option value='manual_line'>LINE</option>
        <option value='manual_other'>其他</option>
        <option value='manual_shopee'>蝦皮</option>
      </select>
      <ManualOrderNotificationEmail />
    </form>
  );
}

const email = (c: HTMLElement) => c.querySelector<HTMLInputElement>(`input[name="${MANUAL_ORDER_NOTIFICATION_EMAIL_FIELD}"]`)!;

describe('ManualOrderNotificationEmail', () => {
  it('其他來源 ⇒ 可以填, 沒有蝦皮那句說明', () => {
    const { container } = render(<Harness />);
    expect(email(container).readOnly).toBe(false);
    expect(container.textContent).not.toContain(SHOPEE_NO_EMAIL_NOTE);
  });

  it('🔴 選蝦皮 ⇒ 清空、鎖住、出現說明;而且照樣送出一個空值(解析端把缺欄當錯)', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.change(email(container), { target: { value: 'a@b.co' } });
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_shopee' } });
    const input = email(container);
    expect(input.value).toBe('');
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(container.textContent).toContain(SHOPEE_NO_EMAIL_NOTE);
    expect(new FormData(container.querySelector('form')!).getAll(MANUAL_ORDER_NOTIFICATION_EMAIL_FIELD)).toEqual(['']);
  });

  it('🔴 換回其他來源 ⇒ 恢復可填, 說明消失', () => {
    const { container, getByLabelText } = render(<Harness />);
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_shopee' } });
    fireEvent.change(getByLabelText('來源'), { target: { value: 'manual_line' } });
    expect(email(container).readOnly).toBe(false);
    expect(email(container).getAttribute('aria-disabled')).toBeNull();
    expect(container.textContent).not.toContain(SHOPEE_NO_EMAIL_NOTE);
    fireEvent.change(email(container), { target: { value: 'x@y.co' } });
    expect(email(container).value).toBe('x@y.co');
  });
});
