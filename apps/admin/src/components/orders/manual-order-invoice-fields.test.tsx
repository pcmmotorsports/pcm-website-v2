// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/orders/invoice-title-lookup-action', () => ({ lookupInvoiceTitleAction: vi.fn() }));

import { ManualOrderInvoiceFields } from './manual-order-invoice-fields';

// Sean 2026-10-01 建單簡化 Q3 甲:勾了「這張單要開發票」才展開, 依發票類型只出對應的格子。
afterEach(cleanup);

function renderInForm() {
  render(
    <form data-testid='f'>
      <ManualOrderInvoiceFields />
    </form>,
  );
  const form = screen.getByTestId('f') as HTMLFormElement;
  const el = (name: string) => form.querySelector(`[name='${name}']:not([type='hidden'])`) as HTMLInputElement;
  return { form, el };
}
const visibleNames = (form: HTMLFormElement) =>
  ['invoice_type', 'invoice_carrier', 'invoice_title', 'invoice_tax_id', 'invoice_donate_code'].filter((n) => {
    const node = form.querySelector(`[name='${n}']`) as HTMLElement;
    return !node.hidden && !(node.parentElement as HTMLElement).hidden;
  });

describe('發票:勾了才展開、依類型只出對應的格子', () => {
  it('預設:沒勾 ⇒ 只看得到那顆勾選', () => {
    const { form } = renderInForm();
    expect(visibleNames(form)).toEqual([]);
  });

  it('🔴 收起不等於不送:沒勾時, 送出的資料與改版前相同(缺欄會被解析器擋)', () => {
    const { form } = renderInForm();
    const fd = new FormData(form);
    expect(fd.getAll('invoice_requested')).toEqual(['off']);
    expect(fd.get('invoice_type')).toBe('personal');
    for (const n of ['invoice_carrier', 'invoice_title', 'invoice_tax_id', 'invoice_donate_code']) {
      expect(fd.get(n)).toBe('');
    }
  });

  it('勾了 ⇒ 個人:出發票類型與載具', () => {
    const { form, el } = renderInForm();
    fireEvent.click(el('invoice_requested'));
    expect(visibleNames(form)).toEqual(['invoice_type', 'invoice_carrier']);
    expect(new FormData(form).getAll('invoice_requested')).toEqual(['off', 'on']);
  });

  it('公司 ⇒ 出抬頭、統編(含查抬頭), 載具收起', () => {
    const { form, el } = renderInForm();
    fireEvent.click(el('invoice_requested'));
    fireEvent.change(el('invoice_type'), { target: { value: 'company' } });
    expect(visibleNames(form)).toEqual(['invoice_type', 'invoice_title', 'invoice_tax_id']);
    expect(screen.getByRole('button', { name: '查抬頭' })).toBeTruthy();
  });

  it('捐贈 ⇒ 只出愛心碼', () => {
    const { form, el } = renderInForm();
    fireEvent.click(el('invoice_requested'));
    fireEvent.change(el('invoice_type'), { target: { value: 'donate' } });
    expect(visibleNames(form)).toEqual(['invoice_type', 'invoice_donate_code']);
  });

  it('🔴 打了抬頭再改回個人 ⇒ 抬頭【仍看得到】(它照樣會送出, 不能藏起來)', () => {
    const { form, el } = renderInForm();
    fireEvent.click(el('invoice_requested'));
    fireEvent.change(el('invoice_type'), { target: { value: 'company' } });
    fireEvent.input(el('invoice_title'), { target: { value: '大運資訊有限公司' } });
    fireEvent.change(el('invoice_type'), { target: { value: 'personal' } });
    expect(visibleNames(form)).toEqual(['invoice_type', 'invoice_carrier', 'invoice_title']);
    expect(new FormData(form).get('invoice_title')).toBe('大運資訊有限公司');
  });

  it('🔴 有字的格子在取消勾選後也看得到', () => {
    const { form, el } = renderInForm();
    fireEvent.click(el('invoice_requested'));
    fireEvent.input(el('invoice_carrier'), { target: { value: '/ABC1234' } });
    fireEvent.click(el('invoice_requested'));
    // 類型也一起看得到:員工才看得出那格是哪一類的
    expect(visibleNames(form)).toEqual(['invoice_type', 'invoice_carrier']);
  });

  it('🔴 hidden 在 checkbox 前面(解析端取最後一個值)', () => {
    const { form } = renderInForm();
    const both = [...form.querySelectorAll("[name='invoice_requested']")].map((n) => (n as HTMLInputElement).type);
    expect(both).toEqual(['hidden', 'checkbox']);
  });
});
