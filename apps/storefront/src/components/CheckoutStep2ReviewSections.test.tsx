// @vitest-environment jsdom
//
// CheckoutStep2ReviewSections test(M-3 兩步結帳 U2a 建、U2b 收斂)。
//
// 🔴 本檔守住兩個 export 的 presentational 契約(DOM 語意、class、文案、handler)。
//   U2b 變更:原第三個 export CheckoutPaymentSection 已刪除(真 TapPay 卡欄改掛
//   CheckoutStep2 的 .co-pay-body、該複查區塊與付款選項列重複),其斷言隨之移除;
//   付款落點與唯一性改由 CheckoutStep2.test.tsx 守門。
//
// 驗:① 收件摘要=姓名 + 電話 + **完整地址字面** + 配送方式 + 編輯鈕
//     ② 🔴 地址只准 CSS 單行截短:完整字面以單一文字節點存在、無省略號、無 JS slice 痕跡
//     ③ 訂單複查=品牌 / 規格 / 數量 / 車款 / 行總額 + 編輯回購物車
//     ④ 同意條款 checkbox → onAgreedChange;服務條款 / 隱私政策=真 route `/terms`、`/privacy`
//        (#291、2026-07-24 接線;target=_blank + rel=noopener noreferrer,避免結帳中途同頁導航丟狀態)
//     ⑤ 🔴 經銷零洩漏(無 price_store / priceByTier /「經銷」/ 劃線價)
//     ⑥ 🔴 DOM 結構契約:CheckoutOrderReview 回傳 fragment、不得包 wrapper

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CustomerAddress } from '@pcm/domain';
import type { ResolvedCartLineView } from '@/hooks/useResolvedCart';
import {
  CheckoutOrderReview,
  CheckoutShippingSummary,
} from './CheckoutStep2ReviewSections';

afterEach(cleanup);

// 🔴 完整地址字面(U2b 以 CSS ellipsis 做單行視覺截短、且不得用 JS slice 丟字)。
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

  it('🔴 截短只准用 CSS:地址為單一完整文字節點 + .co-shipping-summary-address、無省略號', () => {
    const { container } = render(
      <CheckoutShippingSummary currentAddr={ADDR} shippingLabel="貨運宅配" onEdit={vi.fn()} />,
    );

    // 完整字面必須整段存在(exact match、非 substring 容忍)
    const node = screen.getByText(FULL_ADDRESS);
    expect(node.textContent).toBe(FULL_ADDRESS);
    // 🔴 截短掛在 CSS 類名上;改成 JS slice 會同時弄丟這個 class 與完整字面
    expect(node.className).toContain('co-shipping-summary-address');
    // JS slice / 手動截短會留下省略號;一律不得出現
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

  it('服務條款 / 隱私政策已接真 route,且開新分頁(#291、2026-07-24)', () => {
    const { container } = renderOrderReview();
    expect(screen.getByText(/我已閱讀並同意/)).toBeTruthy();
    const links = Array.from(container.querySelectorAll('.co-agree a')) as HTMLAnchorElement[];
    expect(links.map((a) => a.textContent?.trim())).toEqual(['服務條款', '隱私政策']);
    // 🔴 真 route(舊值 '#' = 客人勾同意卻讀不到內容,已修)
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/terms', '/privacy']);
    // 🔴 結帳進行中同頁導航會丟掉結帳狀態 → 必須開新分頁
    expect(links.every((a) => a.getAttribute('target') === '_blank')).toBe(true);
    expect(links.every((a) => (a.getAttribute('rel') ?? '').includes('noopener'))).toBe(true);
  });

  // 🔴 **刻意不在此寫「點連結不會誤勾同意」的 jsdom 測試** —— 寫過、實測是假綠,已移除:
  //   ① jsdom 不實作 descendant 的 label activation:把元件的 onClick 保護整個拿掉,該測試仍全綠
  //      ⇒ 它證明不了任何事。
  //   ② 後續真瀏覽器(Chromium)實測給出真正的答案:a[href] 屬 interactive content、
  //      被 HTML 規格排除在 label activation 之外 → **本來就不會誤勾**,不需要任何 JS 保護
  //      (對照組:同結構下點純文字 <span> 會勾起來,證明 label activation 是活的)。
  //      元件端因此**移除**了原本掛的 stopPropagation(它不是保護來源、留著會誤導)。
  //   ⇒ 這條的真守門是「連結必須是 a[href]」這個結構事實,不是任何 jsdom 斷言。
  //      日後若把連結改成非互動元素(span + onClick),保護即失效 —— 那時才需要真瀏覽器回歸測試。

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

// ===== U3b:收件摘要與條款的非卡片錯誤契約 =====
//
// 🔴 誠實邊界:`shipping.address` 與 `notificationEmail` 在 CheckoutView 的正常流程**不可達**
//   (addressId 恆為 server UUID;Email 已被 goNext 擋在 Step1)。以下用 props 直接驗
//   **DOM / ARIA 契約**,不偽稱是使用者路徑 —— 但契約本身必須有守門,否則 U3b 六件套的
//   「shipping/email 錯顯於摘要附近」等於沒實作也沒人發現。
describe('CheckoutShippingSummary 錯誤顯示(U3b)', () => {
  it('🔴 currentAddr=undefined 且有地址錯誤 → 紅字仍必須看得見', () => {
    // 這正是 shipping.address 出錯的真實形狀(選不到地址 → currentAddr 為 undefined)。
    // body 若維持「只有 currentAddr 才渲染」,紅字會永遠顯示不出來 = 付款被擋卻無提示。
    render(
      <CheckoutShippingSummary
        currentAddr={undefined}
        shippingLabel="貨運宅配"
        onEdit={vi.fn()}
        shippingError="請選擇收件地址"
      />,
    );
    expect(screen.getByText('請選擇收件地址')).toBeTruthy();
  });

  it('紅字位於 .co-review-body 內(不得成為 .co-review-block 的同層 sibling)', () => {
    // checkout.css `.co-review-block:last-child { border-bottom: 0 }` —— 放錯層級會讓
    // 收件摘要多出一條底線,三綠與單元測試都看不見。
    const { container } = render(
      <CheckoutShippingSummary
        currentAddr={ADDR}
        shippingLabel="貨運宅配"
        onEdit={vi.fn()}
        shippingError="請選擇收件地址"
        emailError="Email 格式不正確"
      />,
    );
    for (const text of ['請選擇收件地址', 'Email 格式不正確']) {
      expect(screen.getByText(text).closest('.co-review-body')).not.toBeNull();
    }
    expect(Array.from(container.querySelectorAll('.co-review-block > .auth-field-err'))).toHaveLength(0);
  });

  it('有錯時「編輯」鈕以 aria-describedby 連到地址紅字(導引回 Step1 的無障礙關聯)', () => {
    render(
      <CheckoutShippingSummary
        currentAddr={ADDR}
        shippingLabel="貨運宅配"
        onEdit={vi.fn()}
        shippingError="請選擇收件地址"
      />,
    );
    const edit = screen.getByRole('button', { name: '編輯' });
    expect(edit.getAttribute('aria-describedby')).toBe('checkout-shipping-error');
    expect(document.getElementById('checkout-shipping-error')).not.toBeNull();
  });

  it('🔴 無錯 → 不掛 aria-describedby、不渲染任何紅字節點', () => {
    const { container } = render(
      <CheckoutShippingSummary currentAddr={ADDR} shippingLabel="貨運宅配" onEdit={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '編輯' }).hasAttribute('aria-describedby')).toBe(false);
    expect(container.querySelector('.auth-field-err')).toBeNull();
  });

  it('🔴 只有 emailError 時,aria-describedby 的每個 id 都必須解析得到(禁 dangling idref)', () => {
    // 舊寫法寫死指向 checkout-shipping-error,只有 emailError 時該節點根本不存在。
    render(
      <CheckoutShippingSummary
        currentAddr={ADDR}
        shippingLabel="貨運宅配"
        onEdit={vi.fn()}
        emailError="Email 格式不正確"
      />,
    );
    const ids = screen.getByRole('button', { name: '編輯' }).getAttribute('aria-describedby');
    expect(ids).toBe('checkout-notification-email-error');
    for (const id of (ids ?? '').split(' ')) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('兩種錯誤都有 → describedby 同時列出兩個 id,且都解析得到', () => {
    render(
      <CheckoutShippingSummary
        currentAddr={ADDR}
        shippingLabel="貨運宅配"
        onEdit={vi.fn()}
        shippingError="請選擇收件地址"
        emailError="Email 格式不正確"
      />,
    );
    const ids = (screen.getByRole('button', { name: '編輯' }).getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
  });

  it('地址存在且有錯 → 地址三行與紅字並存(錯誤不吃掉既有內容)', () => {
    render(
      <CheckoutShippingSummary
        currentAddr={ADDR}
        shippingLabel="貨運宅配"
        onEdit={vi.fn()}
        emailError="Email 格式不正確"
      />,
    );
    expect(screen.getByText('貨運宅配')).toBeTruthy();
    expect(screen.getByText('Email 格式不正確')).toBeTruthy();
  });
});
