// @vitest-environment jsdom
//
// CheckoutStep2 smoke test(M-3-S2-b2-e2 結帳 Step2:發票 + 付款方式)。
//
// 驗:① 三 tab(個人/公司/捐贈)+ personal 預設欄(手機載具)② tab 切換 → override + 對應欄
//     (company 抬頭+統編 maxLength8 / donate 愛心碼)③ override hint / 還原鈕切換 + 還原 callback
//     ④ 付款:TapPay 顯示、ATM 不渲染(§3.2)⑤ 🔴 信用卡欄 disabled(零捕獲)+ 經銷零洩漏

import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CheckoutStep2, type InvoiceDraft } from './CheckoutStep2';

afterEach(cleanup);

const EMPTY_INVOICE: InvoiceDraft = {
  type: 'personal',
  carrier: '',
  title: '',
  taxId: '',
  donateCode: '',
};

/** 受控測試殼:管理 invoice / invoiceOverride state,鏡像 CheckoutView 的提升狀態。 */
function Harness({ initial = EMPTY_INVOICE }: { initial?: InvoiceDraft }) {
  const [invoice, setInvoice] = useState<InvoiceDraft>(initial);
  const [invoiceOverride, setInvoiceOverride] = useState(false);
  return (
    <CheckoutStep2
      invoice={invoice}
      setInvoice={setInvoice}
      invoiceOverride={invoiceOverride}
      setInvoiceOverride={setInvoiceOverride}
    />
  );
}

describe('CheckoutStep2(M-3-S2-b2-e2)', () => {
  it('三 tab + personal 預設顯手機載具', () => {
    render(<Harness />);
    expect(screen.getByText('個人發票')).toBeTruthy();
    expect(screen.getByText('公司發票(三聯式)')).toBeTruthy();
    expect(screen.getByText('捐贈發票')).toBeTruthy();
    // personal 預設:手機載具欄
    expect(screen.getByText('手機載具(選填,以 / 開頭)')).toBeTruthy();
    expect(screen.getByText('未填載具者寄送電子發票至註冊 Email')).toBeTruthy();
  });

  it('切公司發票 → 抬頭 + 統編(maxLength 8)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('公司發票(三聯式)'));
    expect(screen.getByText('公司抬頭')).toBeTruthy();
    expect(screen.getByText('統一編號')).toBeTruthy();
    const taxId = screen.getByPlaceholderText('8 碼數字') as HTMLInputElement;
    expect(taxId.maxLength).toBe(8);
    // 手機載具欄不再顯示
    expect(screen.queryByText('手機載具(選填,以 / 開頭)')).toBeNull();
  });

  it('切捐贈發票 → 愛心碼', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('捐贈發票'));
    expect(screen.getByText('愛心碼')).toBeTruthy();
    expect(screen.getByText(/925.*伊甸/)).toBeTruthy();
  });

  it('override hint:預設顯自動帶入提示、無還原鈕;切 tab 後隱提示顯還原鈕', () => {
    render(<Harness />);
    expect(screen.getByText('已從收件地址自動帶入 · 仍可修改')).toBeTruthy();
    expect(screen.queryByText('↻ 還原為地址預設發票')).toBeNull();

    fireEvent.click(screen.getByText('捐贈發票')); // 觸發 override
    expect(screen.queryByText('已從收件地址自動帶入 · 仍可修改')).toBeNull();
    const reset = screen.getByText('↻ 還原為地址預設發票');
    expect(reset).toBeTruthy();

    // 還原 → 提示回來、還原鈕消失
    fireEvent.click(reset);
    expect(screen.getByText('已從收件地址自動帶入 · 仍可修改')).toBeTruthy();
    expect(screen.queryByText('↻ 還原為地址預設發票')).toBeNull();
  });

  it('輸入發票欄 → 寫回 invoice draft(personal carrier)', () => {
    render(<Harness />);
    const carrier = screen.getByPlaceholderText('/ABCD123') as HTMLInputElement;
    fireEvent.change(carrier, { target: { value: '/ABC1234' } });
    expect((screen.getByPlaceholderText('/ABCD123') as HTMLInputElement).value).toBe('/ABC1234');
  });

  it('付款:TapPay 顯示、ATM 不渲染(§3.2 隱藏)', () => {
    render(<Harness />);
    expect(screen.getByText('信用卡(TapPay)')).toBeTruthy();
    expect(screen.queryByText('ATM 轉帳')).toBeNull();
  });

  it('🔴 信用卡欄純 UI:卡號/有效期/CVV 全 disabled(零捕獲)+ 預覽說明', () => {
    const { container } = render(<Harness />);
    const cardInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('.co-card-form input'),
    );
    expect(cardInputs.length).toBe(3); // 卡號 + 有效期 + CVV
    for (const inp of cardInputs) {
      expect(inp.disabled).toBe(true);
      expect(inp.value).toBe(''); // 無 value 綁定、零 state 捕獲
    }
    expect(screen.getByText(/本頁不收集卡號/)).toBeTruthy();
  });

  it('🔴 經銷零洩漏:無「經銷」/ price_store / priceByTier / 劃線價', () => {
    const { container } = render(<Harness initial={{ ...EMPTY_INVOICE, type: 'company' }} />);
    expect(container.textContent).not.toContain('經銷');
    expect(container.textContent).not.toContain('price_store');
    expect(container.textContent).not.toContain('priceByTier');
    expect(container.querySelector('s')).toBeNull();
  });
});
