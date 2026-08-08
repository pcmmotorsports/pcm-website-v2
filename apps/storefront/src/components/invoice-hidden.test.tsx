// @vitest-environment jsdom
//
// invoice-hidden.test.tsx — 發票欄位「先隱藏」的隱藏態守門(Sean 2026-08-08 拍板)。
//
// 🔴 **這支刻意不 mock `@/lib/invoice-visibility`**,用的是真的常數。
//    分工:`CheckoutStep2.test` / `InlineAddressForm.test` / 兩支 Checkout step 測試把開關 mock 成
//    `false`,守的是「重開之後該長什麼樣」;**本檔守的是「現在真的藏起來了」**。
//    兩支合起來才完整 —— 只有前者的話,把 `INVOICE_FIELDS_HIDDEN` 改回 false 沒有任何測試會紅。
//
// 最重要的一條在最後:**藏 UI 不准把資料路徑一起藏掉**。`orders.invoice` 是 NOT NULL Json,
// 表單送出的 payload 仍必須帶預設發票,否則建單會 23502。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { CustomerAddress } from '@pcm/domain';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { INVOICE_FIELDS_HIDDEN } from '@/lib/invoice-visibility';
import { InlineAddressForm, type InlineAddressFormProps } from '@/components/account/InlineAddressForm';
import { CheckoutStep2, type InvoiceDraft } from '@/components/CheckoutStep2';
import { CheckoutStepIndicator } from '@/components/CheckoutStepIndicator';
import { useInvoiceAutofill, DEFAULT_INVOICE } from '@/hooks/useInvoiceAutofill';

afterEach(cleanup);

const ADDR = {
  id: 'addr-1',
  isDefault: true,
  name: '王小明',
  phone: '0912345678',
  line: '新北市新莊區化成路 736 巷 18 號',
} as unknown as CustomerAddress;

const LINE: ResolvedCartLineView = {
  item: { productId: 'p1', variantId: undefined, qty: 1 },
  resolved: {
    productId: 'p1', variantId: undefined, found: true, slug: 'p1', brand: 'RPM',
    name: '護蓋', image: 'https://cdn.example/i.jpg', fits: 'RSV4', variantLabel: null,
    sku: null, unitPrice: 100, fitments: [],
  },
  lineTotal: 100,
};

function Step2Harness() {
  const [invoice, setInvoice] = useState<InvoiceDraft>({ ...DEFAULT_INVOICE });
  const [invoiceOverride, setInvoiceOverride] = useState(false);
  return (
    <CheckoutStep2
      currentAddr={ADDR}
      shippingLabel="貨運宅配"
      onEditAddress={vi.fn()}
      invoice={invoice}
      setInvoice={setInvoice}
      invoiceOverride={invoiceOverride}
      setInvoiceOverride={setInvoiceOverride}
      paymentSlot={<div />}
      lines={[LINE]}
      agreed={false}
      onAgreedChange={vi.fn()}
      onEditItems={vi.fn()}
      errors={{}}
      paymentAlert={null}
      onBack={vi.fn()}
      onSubmit={vi.fn()}
      submitting={false}
      payDisabled={false}
      total={100}
    />
  );
}

describe('發票欄位隱藏態(Sean 2026-08-08 拍板「先隱藏」)', () => {
  // 前提斷言:下面每一條都建立在「現在是隱藏」之上。開關翻回 false 時本檔整組會紅,
  // 那是**刻意的** —— 重開發票時本檔要被一起重寫,不該靜靜地繼續綠。
  it('🔴 開關現在是 true(重開發票時本檔整組會紅,那是刻意的提醒)', () => {
    expect(INVOICE_FIELDS_HIDDEN).toBe(true);
  });

  it('🔴 會員/結帳共用的地址表單:發票整段不在畫面上', () => {
    render(
      <InlineAddressForm
        addr={{ isDefault: false }}
        onSubmit={vi.fn<InlineAddressFormProps['onSubmit']>().mockResolvedValue({ ok: true })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByText('INVOICE · 此地址預設發票')).toBeNull();
    expect(screen.queryByRole('button', { name: '個人' })).toBeNull();
    expect(screen.queryByRole('button', { name: '公司(三聯式)' })).toBeNull();
    expect(screen.queryByRole('button', { name: '捐贈' })).toBeNull();
    expect(screen.queryByPlaceholderText('/ABCD123')).toBeNull();
    expect(screen.queryByPlaceholderText('8 碼數字')).toBeNull();
    // 基本欄不受影響(證明藏的是發票那段、不是把整張表單藏了)
    expect(screen.getByPlaceholderText('王小明')).toBeTruthy();
    expect(screen.getByText('設為預設地址')).toBeTruthy();
  });

  it('🔴 結帳 Step2:N°03 發票區整段不在畫面上(付款區仍在)', () => {
    render(<Step2Harness />);
    expect(screen.queryByText('發票資訊')).toBeNull();
    expect(screen.queryByText('N°03 · INVOICE')).toBeNull();
    expect(screen.queryByPlaceholderText('/ABCD123')).toBeNull();
    expect(screen.queryByText('未填載具者寄送電子發票至註冊 Email')).toBeNull();
    // 對照組:付款那段沒被一起藏掉
    expect(screen.getByText('N°04 · PAYMENT METHOD')).toBeTruthy();
  });

  it('🔴 步驟條第二步寫「付款」不寫「發票與付款」(藏了發票就不能還這樣寫)', () => {
    render(<CheckoutStepIndicator step={1} onStepChange={vi.fn()} />);
    expect(screen.getByText('付款')).toBeTruthy();
    expect(screen.queryByText('發票與付款')).toBeNull();
  });

  it('🔴 隱藏期間不從地址自動帶入發票(否則 company 的錯會落在看不見的欄位上)', () => {
    const setInvoice = vi.fn();
    const addrWithCompanyInvoice = {
      ...ADDR,
      invoice: { type: 'company', title: '', taxId: '123', carrier: '', donateCode: '' },
    } as unknown as CustomerAddress;
    renderHook(() =>
      useInvoiceAutofill({
        invoice: { ...DEFAULT_INVOICE },
        setInvoice,
        invoiceOverride: false,
        shippingAddrId: 'addr-1',
        addresses: [addrWithCompanyInvoice],
        clearInvoiceKeys: vi.fn(),
      }),
    );
    expect(
      setInvoice,
      '隱藏期間仍從地址帶入 ⇒ company 統編錯會出現在已看不見的欄位上,客人卡在付款鍵前面沒東西可修',
    ).not.toHaveBeenCalled();
  });

  // 🔴🔴 本檔最重要的一條:藏 UI 不准把**資料路徑**一起藏掉。
  //     `orders.invoice` 是 NOT NULL Json ⇒ 表單送出仍必須帶預設發票,否則建單 23502。
  it('🔴 地址表單送出的 payload **仍然帶發票**(預設個人;NOT NULL 防線)', async () => {
    const onSubmit = vi
      .fn<InlineAddressFormProps['onSubmit']>()
      .mockResolvedValue({ ok: true });
    render(
      <InlineAddressForm addr={{ isDefault: false }} onSubmit={onSubmit} onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '陳大文' } });
    fireEvent.change(screen.getByPlaceholderText('縣市 / 區 / 路 / 號 / 樓'), { target: { value: '台北市' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0] as { invoice?: { type?: string } } | undefined;
    expect(payload?.invoice, 'invoice 整個不見了 ⇒ orders.invoice 是 NOT NULL,建單會 23502').toBeTruthy();
    expect(payload?.invoice?.type).toBe('personal');
  });

  it('🔴 編輯既有地址時,原本存的發票設定仍原封帶回 payload(資料不因隱藏而被清掉)', async () => {
    const onSubmit = vi
      .fn<InlineAddressFormProps['onSubmit']>()
      .mockResolvedValue({ ok: true });
    render(
      <InlineAddressForm
        addr={{
          id: 'a1',
          isDefault: true,
          name: '甲',
          phone: '09',
          line: '台北',
          invoice: { type: 'company', title: '賓士機車', taxId: '12345678' },
        }}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0] as { invoice?: { type?: string; taxId?: string } } | undefined;
    expect(payload?.invoice?.type, '既有 company 設定被隱藏順手清成 personal ⇒ 重開時客人資料不見了').toBe('company');
    expect(payload?.invoice?.taxId).toBe('12345678');
  });
});
