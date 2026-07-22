// @vitest-environment jsdom
//
// CheckoutStep2 smoke test(M-3 兩步結帳 U2b:第二步唯一內容元件)。
//
// 驗:① 單欄五段順序=收件摘要 → 發票 → 付款 → 商品 → 條款(DOM 出現序,非只驗存在)
//     ② 發票三 tab + 各型別欄位 + override hint / 還原鈕(U2b 未改行為)
//     ③ 🔴 付款文案白話化(business override checkoutPaymentLabelPlainLanguage)
//     ④ 🔴 唯一真卡輸入表面:真 TapPay 容器掛在 .co-pay-body > .co-card-form、
//        三個容器 id 各恰 1 個、我方零 <input> 收卡資料、假卡欄(disabled input)已絕跡
//     ⑤ 🔴 編輯鈕接線守門(codex 關卡1 R1 must-fix):恰 2 顆,收件那顆只觸發 onEditAddress、
//        商品那顆只觸發 onEditItems —— 兩者互換接線會當場轉紅
//     ⑥ 🔴 收件地址完整字面仍在 DOM(單行截短只准用 CSS、不得 JS slice)
//     ⑦ 🔴 經銷零洩漏 + 無殘留的重複節點(發票資訊 / 付款方式 各恰 1 個)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CustomerAddress } from '@pcm/domain';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';
import { TapPayCardFields } from '@/components/TapPayCardFields';
import { TAPPAY_FIELD_IDS } from '@/hooks/useTapPayCard';
import { CheckoutStep2, type InvoiceDraft } from './CheckoutStep2';

afterEach(cleanup);

const EMPTY_INVOICE: InvoiceDraft = {
  type: 'personal',
  carrier: '',
  title: '',
  taxId: '',
  donateCode: '',
};

// 🔴 完整地址字面:U2b 以 CSS ellipsis 做單行視覺截短,DOM 內必須仍是這整串。
const FULL_ADDRESS = '新北市新莊區化成路 736 巷 18 號';

const ADDR: CustomerAddress = {
  id: 'addr-1',
  isDefault: true,
  name: '王小明',
  phone: '0912345678',
  line: FULL_ADDRESS,
} as unknown as CustomerAddress;

const LINE: ResolvedCartLineView = {
  item: { productId: 'rpm-1', variantId: undefined, qty: 2 },
  resolved: {
    productId: 'rpm-1',
    variantId: undefined,
    found: true,
    slug: 'rpm-1',
    brand: 'RPM',
    name: '碳纖維車台護蓋',
    image: 'https://cdn.example/img.jpg',
    fits: 'Aprilia RSV4',
    variantLabel: null,
    sku: null,
    unitPrice: 14600,
    fitments: [],
  },
  lineTotal: 29200,
};

/** 真 TapPay 卡欄(presentational、不進 SDK):用真元件才驗得到 .co-card-form 與三個容器 id。 */
const REAL_SLOT = (
  <TapPayCardFields ready="ready" fieldStatus={{ number: 0, expiry: 0, ccv: 0 }} />
);

type HarnessOver = Partial<Parameters<typeof CheckoutStep2>[0]>;

/** 受控測試殼:管理 invoice / invoiceOverride state,鏡像 CheckoutView 的提升狀態。 */
function Harness({ over = {} }: { over?: HarnessOver }) {
  const [invoice, setInvoice] = useState<InvoiceDraft>(EMPTY_INVOICE);
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
      paymentSlot={REAL_SLOT}
      lines={[LINE]}
      agreed={false}
      onAgreedChange={vi.fn()}
      onEditItems={vi.fn()}
      {...over}
    />
  );
}

describe('CheckoutStep2 單欄五段(U2b)', () => {
  it('🔴 順序=收件摘要 → 發票 → 付款 → 商品 → 條款(DOM 出現序)', () => {
    const { container } = render(<Harness />);
    // 🔴 .co-inv-hint 也帶 .ap-mono 且同在 .co-section-head 內 → 必須排除,否則順序斷言會誤判。
    const marks = Array.from(
      container.querySelectorAll(
        '.co-review-block-head .ap-mono, .co-section-head .ap-mono:not(.co-inv-hint), .co-agree',
      ),
    ).map((el) => (el.className.includes('co-agree') ? '條款' : el.textContent));
    expect(marks).toEqual([
      '收件資料',
      'N°03 · INVOICE',
      'N°04 · PAYMENT METHOD',
      'N°05 · REVIEW',
      '商品清單 (1)',
      '條款',
    ]);
  });

  it('🔴 重複節點已消滅:發票資訊 / 付款方式 各恰 1 個', () => {
    render(<Harness />);
    expect(screen.getAllByText('發票資訊').length).toBe(1);
    expect(screen.getAllByText('付款方式').length).toBe(1);
  });
});

describe('CheckoutStep2 收件摘要(U2b)', () => {
  it('🔴 完整地址字面仍在 DOM(截短只准用 CSS、不得 JS slice)', () => {
    const { container } = render(<Harness />);
    const node = screen.getByText(FULL_ADDRESS);
    expect(node.textContent).toBe(FULL_ADDRESS);
    expect(node.className).toContain('co-shipping-summary-address');
    expect(container.textContent).not.toContain('…');
    expect(container.textContent).not.toContain('...');
  });

  it('姓名 / 電話 / 配送方式', () => {
    render(<Harness />);
    expect(screen.getByText('王小明')).toBeTruthy();
    expect(screen.getByText(/0912345678/)).toBeTruthy();
    expect(screen.getByText('貨運宅配')).toBeTruthy();
  });
});

describe('CheckoutStep2 編輯鈕接線(U2b;codex 關卡1 R1 must-fix)', () => {
  it('🔴 恰 2 顆編輯鈕,收件→onEditAddress、商品→onEditItems,互不誤觸', () => {
    const onEditAddress = vi.fn();
    const onEditItems = vi.fn();
    render(<Harness over={{ onEditAddress, onEditItems }} />);

    const edits = screen.getAllByRole('button', { name: '編輯' });
    expect(edits.length).toBe(2); // 收件 / 商品(付款與發票不再有複查編輯鈕)

    fireEvent.click(edits[0]!);
    expect(onEditAddress).toHaveBeenCalledTimes(1);
    expect(onEditItems).not.toHaveBeenCalled(); // 誤接成 onEditItems 會在此轉紅

    fireEvent.click(edits[1]!);
    expect(onEditItems).toHaveBeenCalledTimes(1);
    expect(onEditAddress).toHaveBeenCalledTimes(1); // 誤接成 onEditAddress 會在此轉紅
  });
});

describe('CheckoutStep2 發票(U2b 未改行為)', () => {
  it('三 tab + personal 預設顯手機載具', () => {
    render(<Harness />);
    expect(screen.getByText('個人發票')).toBeTruthy();
    expect(screen.getByText('公司發票(三聯式)')).toBeTruthy();
    expect(screen.getByText('捐贈發票')).toBeTruthy();
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

    fireEvent.click(screen.getByText('捐贈發票'));
    expect(screen.queryByText('已從收件地址自動帶入 · 仍可修改')).toBeNull();
    const reset = screen.getByText('↻ 還原為地址預設發票');
    expect(reset).toBeTruthy();

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
});

describe('CheckoutStep2 付款(U2b)', () => {
  it('🔴 文案白話化:信用卡付款 + 保留卡別與 3D 驗證;技術字串全絕跡', () => {
    const { container } = render(<Harness />);
    expect(screen.getByText('信用卡付款')).toBeTruthy();
    expect(screen.getByText('VISA · Mastercard · JCB · AE，3D 驗證')).toBeTruthy();
    expect(container.textContent).not.toContain('信用卡(TapPay)');
    expect(container.textContent).not.toContain('後端串接 TapPay SDK');
    expect(container.textContent).not.toContain('信用卡 · TapPay');
    // ATM 仍不渲染(§3.2 隱藏)
    expect(screen.queryByText('ATM 轉帳')).toBeNull();
  });

  it('🔴 真卡欄落點:.co-pay-body > .co-card-form(A 案;放錯層會轉紅)', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('.co-pay-body > .co-card-form')).toBeTruthy();
    // 不得掛在複查區塊內(舊 B 案落點)
    expect(container.querySelector('.co-review-body .co-card-form')).toBeNull();
  });

  it('🔴 唯一真卡輸入表面:三個 TapPay 容器 id 各恰 1 個', () => {
    const { container } = render(<Harness />);
    for (const id of Object.values(TAPPAY_FIELD_IDS)) {
      expect(container.querySelectorAll(`#${id}`).length).toBe(1);
    }
  });

  it('🔴 假卡欄已絕跡:付款區零 <input> 收卡資料、無 disabled input', () => {
    const { container } = render(<Harness />);
    const payInputs = Array.from(container.querySelectorAll('.co-pay-body input'));
    // 只剩選項自己的 radio(卡資料一律在 iframe 內)
    expect(payInputs.length).toBe(0);
    expect(container.querySelector('.co-card-form input')).toBeNull();
    expect(container.querySelector('input[disabled]')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('paymentSlot 省略 → 付款選項仍在、卡欄不掛(不留半截 UI)', () => {
    const { container } = render(<Harness over={{ paymentSlot: undefined }} />);
    expect(screen.getByText('信用卡付款')).toBeTruthy();
    expect(container.querySelector('.co-card-form')).toBeNull();
  });
});

describe('CheckoutStep2 商品與條款(U2b)', () => {
  it('商品列 + 同意條款 checkbox → onAgreedChange(true)', () => {
    const onAgreedChange = vi.fn();
    const { container } = render(<Harness over={{ onAgreedChange }} />);
    expect(screen.getByText('RPM')).toBeTruthy();
    expect(screen.getByText('碳纖維車台護蓋')).toBeTruthy();
    expect(screen.getByText('× 2')).toBeTruthy();
    expect(screen.getByText('NT$ 29,200')).toBeTruthy();

    const cb = container.querySelector('.co-agree input') as HTMLInputElement;
    fireEvent.click(cb);
    expect(onAgreedChange).toHaveBeenCalledWith(true);
  });

  it('🔴 經銷零洩漏:無「經銷」/ price_store / priceByTier / 劃線價', () => {
    const { container } = render(<Harness over={{ invoice: { ...EMPTY_INVOICE, type: 'company' } }} />);
    expect(container.textContent).not.toContain('經銷');
    expect(container.textContent).not.toContain('price_store');
    expect(container.textContent).not.toContain('priceByTier');
    expect(container.querySelector('s')).toBeNull();
  });
});
