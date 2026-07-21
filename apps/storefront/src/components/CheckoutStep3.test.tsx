// @vitest-environment jsdom
//
// CheckoutStep3 smoke test(M-3-S2-b2-e3a 結帳 Step3:確認複查 + 同意條款)。
//
// 驗:① 四 review block + 同意條款 render ② 收件 body(name/phone/line + shippingLabel)
//     ③ 付款顯「信用卡 · TapPay」(無卡末四碼)④ 發票 readonly 各型別 ⑤ 商品 readonly
//     (brand/name/variantLabel/qty/lineTotal)⑥ 同意 checkbox → onAgreedChange ⑦ 編輯鈕 → callbacks
//     ⑧ 🔴 經銷零洩漏(無 price_store/priceByTier/「經銷」/劃線價)

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CustomerAddress } from '@pcm/domain';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';
import type { InvoiceDraft } from './CheckoutStep2';
import { CheckoutStep3 } from './CheckoutStep3';

afterEach(cleanup);

const ADDR: CustomerAddress = {
  id: 'addr-1',
  isDefault: true,
  name: '王小明',
  phone: '0912345678',
  line: '新北市新莊區化成路 736 巷 18 號',
} as unknown as CustomerAddress;

const PERSONAL: InvoiceDraft = { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' };

function line(over: Partial<ResolvedCartLineView['resolved']> & { productId: string }, qty = 1, lineTotal = 14600): ResolvedCartLineView {
  return {
    item: { productId: over.productId, variantId: undefined, qty },
    resolved: {
      variantId: undefined,
      found: true,
      slug: over.productId,
      brand: 'RPM',
      name: '碳纖維車台護蓋',
      image: 'https://cdn.example/img.jpg',
      fits: 'Aprilia RSV4',
      variantLabel: null,
      sku: null,
      unitPrice: 14600,
      fitments: [],
      ...over,
    },
    lineTotal,
  };
}

function renderStep3(over: Partial<Parameters<typeof CheckoutStep3>[0]> = {}) {
  const props = {
    currentAddr: ADDR,
    shippingLabel: '貨運宅配',
    invoice: PERSONAL,
    lines: [line({ productId: 'rpm-1' })],
    agreed: false,
    onAgreedChange: vi.fn(),
    onEditAddress: vi.fn(),
    onEditStep2: vi.fn(),
    onEditItems: vi.fn(),
    ...over,
  };
  const utils = render(<CheckoutStep3 {...props} />);
  return { ...utils, props };
}

describe('CheckoutStep3(M-3-S2-b2-e3a)', () => {
  it('四 review block + 同意條款 + 收件 body', () => {
    renderStep3();
    expect(screen.getByText('收件資料')).toBeTruthy();
    expect(screen.getByText('付款方式')).toBeTruthy();
    expect(screen.getByText('發票資訊')).toBeTruthy();
    expect(screen.getByText(/商品清單/)).toBeTruthy();
    expect(screen.getByText(/我已閱讀並同意/)).toBeTruthy();
    // 收件 body
    expect(screen.getByText('王小明')).toBeTruthy();
    expect(screen.getByText(/0912345678/)).toBeTruthy();
    expect(screen.getByText('新北市新莊區化成路 736 巷 18 號')).toBeTruthy();
    expect(screen.getByText('貨運宅配')).toBeTruthy();
  });

  it('付款顯「信用卡 · TapPay」(信用卡欄純 UI、無卡末四碼)', () => {
    const { container } = renderStep3();
    expect(screen.getByText('信用卡 · TapPay')).toBeTruthy();
    expect(container.textContent).not.toContain('****');
  });

  it('發票 readonly:personal 無載具 → 寄至註冊 Email', () => {
    renderStep3({ invoice: PERSONAL });
    expect(screen.getByText(/個人電子發票.*寄至註冊 Email/)).toBeTruthy();
  });

  it('發票 readonly:company 抬頭 + 統編', () => {
    renderStep3({ invoice: { type: 'company', carrier: '', title: '賓士機車有限公司', taxId: '12345678', donateCode: '' } });
    expect(screen.getByText(/公司發票.*賓士機車有限公司.*統編 12345678/)).toBeTruthy();
  });

  it('發票 readonly:donate 愛心碼', () => {
    renderStep3({ invoice: { type: 'donate', carrier: '', title: '', taxId: '', donateCode: '8585' } });
    expect(screen.getByText(/捐贈發票.*愛心碼 8585/)).toBeTruthy();
  });

  it('商品 readonly:brand/name/variantLabel/qty/lineTotal', () => {
    renderStep3({ lines: [line({ productId: 'rpm-1', variantLabel: 'Forged · 亮面' }, 2, 30400)] });
    expect(screen.getByText('RPM')).toBeTruthy();
    expect(screen.getByText('碳纖維車台護蓋')).toBeTruthy();
    expect(screen.getByText('Forged · 亮面')).toBeTruthy();
    expect(screen.getByText('× 2')).toBeTruthy();
    expect(screen.getByText('NT$ 30,400')).toBeTruthy();
  });

  it('V-2h/MF-6:逐品項顯車款(dict + free、唯讀重用 formatCartVehicle)', () => {
    const dictLine: ResolvedCartLineView = {
      ...line({ productId: 'rpm-1' }),
      item: { productId: 'rpm-1', variantId: undefined, qty: 1, vehicle: { kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'picker' } },
    };
    const freeLine: ResolvedCartLineView = {
      ...line({ productId: 'rpm-2', name: '排氣管' }),
      item: { productId: 'rpm-2', variantId: undefined, qty: 1, vehicle: { kind: 'free', raw: '我的老車', source: 'freetext' } },
    };
    const { container } = renderStep3({ lines: [dictLine, freeLine] });
    expect(screen.getByText(/車款：2021 Yamaha MT-09 SP/)).toBeTruthy();
    expect(screen.getByText(/車款：我的老車/)).toBeTruthy();
    expect(container.querySelectorAll('.co-review-item-vehicle').length).toBe(2);
  });

  it('V-2h/MF-6:無 vehicle 的品項不顯車款行', () => {
    const { container } = renderStep3(); // 預設 line 無 item.vehicle
    expect(container.querySelector('.co-review-item-vehicle')).toBeNull();
  });

  it('同意 checkbox → onAgreedChange(true)', () => {
    const { container, props } = renderStep3({ agreed: false });
    const cb = container.querySelector('.co-agree input') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(props.onAgreedChange).toHaveBeenCalledWith(true);
  });

  it('🔴 U1:省略 onEditStep2(兩步版同頁)→ 付款/發票編輯鈕不渲染,收件/商品仍在', () => {
    renderStep3({ onEditStep2: undefined });
    const edits = screen.getAllByRole('button', { name: '編輯' });
    expect(edits.length).toBe(2); // 收件 / 商品
  });

  it('編輯鈕 → 對應 callback(收件→Address / 付款·發票→Step2 / 商品→Items)', () => {
    const { props } = renderStep3();
    const edits = screen.getAllByRole('button', { name: '編輯' });
    expect(edits.length).toBe(4); // 收件 / 付款 / 發票 / 商品
    fireEvent.click(edits[0]!); // 收件
    fireEvent.click(edits[1]!); // 付款 → step2
    fireEvent.click(edits[2]!); // 發票 → step2
    fireEvent.click(edits[3]!); // 商品 → /cart
    expect(props.onEditAddress).toHaveBeenCalledTimes(1);
    expect(props.onEditStep2).toHaveBeenCalledTimes(2);
    expect(props.onEditItems).toHaveBeenCalledTimes(1);
  });

  it('🔴 經銷零洩漏:無「經銷」/ price_store / priceByTier / 劃線價', () => {
    const { container } = renderStep3({ lines: [line({ productId: 'rpm-1', unitPrice: 15200 }, 2, 30400)] });
    expect(container.textContent).not.toContain('經銷');
    expect(container.textContent).not.toContain('price_store');
    expect(container.textContent).not.toContain('priceByTier');
    expect(container.querySelector('s')).toBeNull();
  });
});
