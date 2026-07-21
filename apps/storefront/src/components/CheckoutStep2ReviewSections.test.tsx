// @vitest-environment jsdom
//
// CheckoutStep2ReviewSections test(M-3 兩步結帳 U2a:抽第二步 presentational review sections)。
//
// 🔴 本檔是 U2a 的 RED 先行守門:三個 export 是自 CheckoutStep3.tsx **逐字搬出**的區塊,
//   抽取前後 DOM 語意、class、文案與 handler 契約必須不變。
//   CheckoutStep3.test.tsx / CheckoutView.test.tsx **完全不改**仍須全綠 = 「畫面不變」的真證據;
//   本檔額外把 U2b 要用到的契約逐條釘住(下一片改動時會當場轉紅)。
//
// 驗:① 收件摘要=姓名 + 電話 + **完整現況地址字面** + 配送方式 + 編輯鈕
//     ② 🔴 本片不得引入截短:地址以單一完整文字節點存在、無省略號、無 JS slice 痕跡
//     ③ 付款區=「信用卡 · TapPay」+ TapPay slot(唯一卡片輸入表面)+ 編輯鈕 optional
//     ④ 訂單複查=品牌 / 規格 / 數量 / 車款 / 行總額 + 編輯回購物車
//     ⑤ 同意條款 checkbox → onAgreedChange;服務條款 / 隱私政策連結仍為 no-op placeholder(#291)
//     ⑥ 🔴 經銷零洩漏(無 price_store / priceByTier /「經銷」/ 劃線價)
//     ⑦ 🔴 卡資料零洩漏:三區塊皆不得出現卡號 / 有效期 / CVV 我方 input

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CustomerAddress } from '@pcm/domain';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';
import {
  CheckoutOrderReview,
  CheckoutPaymentSection,
  CheckoutShippingSummary,
} from './CheckoutStep2ReviewSections';

afterEach(cleanup);

// 🔴 完整現況地址字面(U2b 才以 CSS ellipsis 做單行視覺截短、且不得用 JS slice 丟字)。
const FULL_ADDRESS = '新北市新莊區化成路 736 巷 18 號';

const ADDR: CustomerAddress = {
  id: 'addr-1',
  isDefault: true,
  name: '王小明',
  phone: '0912345678',
  line: FULL_ADDRESS,
} as unknown as CustomerAddress;

function line(
  over: Partial<ResolvedCartLineView['resolved']> & { productId: string },
  qty = 1,
  lineTotal = 14600,
): ResolvedCartLineView {
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

describe('CheckoutShippingSummary(U2a)', () => {
  it('姓名 / 電話 / 完整地址 / 配送方式 + 編輯鈕 → onEdit', () => {
    const onEdit = vi.fn();
    render(<CheckoutShippingSummary currentAddr={ADDR} shippingLabel="貨運宅配" onEdit={onEdit} />);

    expect(screen.getByText('收件資料')).toBeTruthy();
    expect(screen.getByText('王小明')).toBeTruthy();
    expect(screen.getByText(/0912345678/)).toBeTruthy();
    expect(screen.getByText('貨運宅配')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('🔴 U2a 不得引入截短:地址為單一完整文字節點、無省略號', () => {
    const { container } = render(
      <CheckoutShippingSummary currentAddr={ADDR} shippingLabel="貨運宅配" onEdit={vi.fn()} />,
    );

    // 完整字面必須整段存在(exact match、非 substring 容忍)
    const node = screen.getByText(FULL_ADDRESS);
    expect(node.textContent).toBe(FULL_ADDRESS);
    // JS slice / 手動截短會留下省略號;本片一律不得出現
    expect(container.textContent).not.toContain('…');
    expect(container.textContent).not.toContain('...');
  });

  it('currentAddr undefined → 不渲染 body(區塊頭與編輯鈕仍在)', () => {
    const { container } = render(
      <CheckoutShippingSummary currentAddr={undefined} shippingLabel="貨運宅配" onEdit={vi.fn()} />,
    );
    expect(container.querySelector('.co-review-body')).toBeNull();
    expect(screen.getByRole('button', { name: '編輯' })).toBeTruthy();
  });
});

describe('CheckoutPaymentSection(U2a)', () => {
  it('付款方式字面 + TapPay slot 渲染於複查 body 內', () => {
    const { container } = render(
      <CheckoutPaymentSection paymentSlot={<div data-testid="tappay-slot" />} />,
    );
    expect(screen.getByText('付款方式')).toBeTruthy();
    expect(screen.getByText('信用卡 · TapPay')).toBeTruthy();
    expect(container.querySelector('.co-review-body [data-testid="tappay-slot"]')).toBeTruthy();
    // 卡末四碼從未顯示(e2 起信用卡欄零卡資料)
    expect(container.textContent).not.toContain('****');
  });

  it('🔴 我方零卡片 input:區塊內不存在任何 input(唯一輸入表面是 TapPay iframe)', () => {
    const { container } = render(
      <CheckoutPaymentSection paymentSlot={<div data-testid="tappay-slot" />} />,
    );
    expect(container.querySelectorAll('input').length).toBe(0);
  });

  it('onEdit 省略 → 不渲染編輯鈕(兩步版同頁無處可跳、不留死鈕)', () => {
    render(<CheckoutPaymentSection paymentSlot={<div />} />);
    expect(screen.queryByRole('button', { name: '編輯' })).toBeNull();
  });

  it('onEdit 傳入 → 渲染編輯鈕並回呼', () => {
    const onEdit = vi.fn();
    render(<CheckoutPaymentSection onEdit={onEdit} paymentSlot={<div />} />);
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe('CheckoutOrderReview(U2a)', () => {
  function renderOrderReview(over: Partial<Parameters<typeof CheckoutOrderReview>[0]> = {}) {
    const props = {
      lines: [line({ productId: 'rpm-1' })],
      agreed: false,
      onAgreedChange: vi.fn(),
      onEditItems: vi.fn(),
      ...over,
    };
    const utils = render(<CheckoutOrderReview {...props} />);
    return { ...utils, props };
  }

  it('商品列:品牌 / 名稱 / 規格 / 數量 / 行總額', () => {
    renderOrderReview({ lines: [line({ productId: 'rpm-1', variantLabel: 'Forged · 亮面' }, 2, 30400)] });
    expect(screen.getByText(/商品清單/)).toBeTruthy();
    expect(screen.getByText('RPM')).toBeTruthy();
    expect(screen.getByText('碳纖維車台護蓋')).toBeTruthy();
    expect(screen.getByText('Forged · 亮面')).toBeTruthy();
    expect(screen.getByText('× 2')).toBeTruthy();
    expect(screen.getByText('NT$ 30,400')).toBeTruthy();
  });

  it('車款行:dict 與 free 皆顯、無 vehicle 者不顯(重用 formatCartVehicle)', () => {
    const dictLine: ResolvedCartLineView = {
      ...line({ productId: 'rpm-1' }),
      item: {
        productId: 'rpm-1',
        variantId: undefined,
        qty: 1,
        vehicle: { kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'picker' },
      },
    };
    const freeLine: ResolvedCartLineView = {
      ...line({ productId: 'rpm-2', name: '排氣管' }),
      item: {
        productId: 'rpm-2',
        variantId: undefined,
        qty: 1,
        vehicle: { kind: 'free', raw: '我的老車', source: 'freetext' },
      },
    };
    const { container } = renderOrderReview({ lines: [dictLine, freeLine, line({ productId: 'rpm-3' })] });
    expect(screen.getByText(/車款：2021 Yamaha MT-09 SP/)).toBeTruthy();
    expect(screen.getByText(/車款：我的老車/)).toBeTruthy();
    expect(container.querySelectorAll('.co-review-item-vehicle').length).toBe(2);
  });

  it('編輯鈕 → onEditItems(回購物車)', () => {
    const { props } = renderOrderReview();
    fireEvent.click(screen.getByRole('button', { name: '編輯' }));
    expect(props.onEditItems).toHaveBeenCalledTimes(1);
  });

  it('同意條款 checkbox → onAgreedChange(true)', () => {
    const { container, props } = renderOrderReview({ agreed: false });
    const cb = container.querySelector('.co-agree input') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(props.onAgreedChange).toHaveBeenCalledWith(true);
  });

  it('服務條款 / 隱私政策仍為 no-op placeholder(legal pages 未建、backlog #291)', () => {
    const { container } = renderOrderReview();
    expect(screen.getByText(/我已閱讀並同意/)).toBeTruthy();
    const links = Array.from(container.querySelectorAll('.co-agree a')) as HTMLAnchorElement[];
    expect(links.map((a) => a.textContent)).toEqual(['服務條款', '隱私政策']);
    expect(links.every((a) => a.getAttribute('href') === '#')).toBe(true);
  });

  it('🔴 經銷零洩漏:無「經銷」/ price_store / priceByTier / 劃線價', () => {
    const { container } = renderOrderReview({
      lines: [line({ productId: 'rpm-1', unitPrice: 15200 }, 2, 30400)],
    });
    expect(container.textContent).not.toContain('經銷');
    expect(container.textContent).not.toContain('price_store');
    expect(container.textContent).not.toContain('priceByTier');
    expect(container.querySelector('s')).toBeNull();
  });

  // 🔴 這條斷言的寫法本身踩過一次假綠:原本比對「兩者 parentElement 相同」——
  //    包了 wrapper <div> 之後兩者仍共用同一個新 parent,測試照樣綠(突變實測確認)。
  //    必須改成鎖「掛載點的直接子節點恰為這兩個」,wrapper 才會當場被抓出來。
  it('🔴 DOM 結構契約:回傳 fragment,商品區塊與同意條款直接掛在父層(包 wrapper 會改變 .co-review-block:last-child 命中對象)', () => {
    const { container } = renderOrderReview();
    expect(Array.from(container.children).map((el) => el.className)).toEqual([
      'co-review-block',
      'co-agree',
    ]);
  });
});
