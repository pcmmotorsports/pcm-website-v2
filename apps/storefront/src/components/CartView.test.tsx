// @vitest-environment jsdom
//
// CartView smoke test(M-3-S2-b2-d 購物車頁)。
//
// 驗:① 載入態(hydrate 前 / resolve 未完)→「載入購物車…」
//     ② 空車 → design 空狀態「購物車是空的」+「繼續購物」
//     ③ 有商品 → 渲染品牌/名稱/適用/變體標/單價/小計;件數;運費免運(滿門檻)/總計
//     ④ 運費未滿門檻 → NT$ 100 + 「再買 NT$ X 享免運」hint
//     ⑤ qty +/- → updateQty(item, qty±1);qty=1 minus disabled;移除 → removeItem(item)
//     ⑥ 前往結帳 → /checkout;繼續購物 → /products
//     ⑦ 🔴 經銷零洩漏:不顯「經銷」/ price_store(階段① general-only、無劃線價)
//     ⑧ stale line(found:false)→ 不渲染、退空狀態
// mock '@/contexts/CartContext'(useCart 直控 items/hydrate/updateQty/removeItem)
//   + '@/app/cart/actions'(resolveCartLines 受控)+ next/navigation(useRouter.push)+ matchMedia polyfill。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';
import type { ResolvedCartLine } from '@/app/cart/actions';

const { cartRef, resolveMock, pushMock } = vi.hoisted(() => ({
  cartRef: {
    current: {
      items: [] as CartItem[],
      totalQty: 0,
      isHydrated: true,
      addItem: vi.fn(),
      removeItem: vi.fn(),
      updateQty: vi.fn(),
      setItemVehicle: vi.fn(),
      setAllItemsVehicle: vi.fn(),
      clear: vi.fn(),
    },
  },
  resolveMock: vi.fn(),
  pushMock: vi.fn(),
}));

// 🔴 2026-08-24:改成 `importOriginal` 的**部分 mock** —— 只換掉 `useCart`,其餘一律用真的。
//   ~~原本是手列清單(`useCart` + `MAX_QTY: 99`)~~,而那份清單**會腐爛**:
//   本檔 2026-08-24 就因此紅了 8/8 —— 共用層新增了一個 `QTY_CAP_NOTICE`,
//   `CartQtyInput` 開始 import 它,而這份手列的 mock 不知道 ⇒
//   `No "QTY_CAP_NOTICE" export is defined on the mock`。
//   📌 而它紅的樣子**不像「mock 缺東西」**:表面上是「`updateQty` 被呼叫 0 次」,
//     真正的成因躲在輸出最底下的 `Unhandled Errors` 區塊。
//   ⇒ 常數與純函式**沒有理由**被 mock 掉 —— 它們沒有副作用,而假造它們只會讓測試與真值脫鉤。
vi.mock('@/contexts/CartContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/CartContext')>()),
  useCart: () => cartRef.current,
}));
vi.mock('@/app/cart/actions', () => ({
  resolveCartLines: resolveMock,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { CartView } from './CartView';

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  resolveMock.mockReset();
  pushMock.mockReset();
});

function setCart(items: CartItem[], opts: { isHydrated?: boolean } = {}) {
  const updateQty = vi.fn();
  const removeItem = vi.fn();
  const setItemVehicle = vi.fn();
  const setAllItemsVehicle = vi.fn();
  cartRef.current = {
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    isHydrated: opts.isHydrated ?? true,
    addItem: vi.fn(),
    removeItem,
    updateQty,
    setItemVehicle,
    setAllItemsVehicle,
    clear: vi.fn(),
  };
  return { updateQty, removeItem, setItemVehicle, setAllItemsVehicle };
}

function resolvedLine(over: Partial<ResolvedCartLine> & { productId: string }): ResolvedCartLine {
  return {
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
  };
}

describe('CartView(M-3-S2-b2-d)', () => {
  it('hydrate 前 → 載入態「載入購物車…」', () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }], { isHydrated: false });
    render(<CartView />);
    expect(screen.getByText('載入購物車…')).toBeTruthy();
  });

  it('空車 → design 空狀態 +「繼續購物」', async () => {
    setCart([]);
    render(<CartView />);
    expect(await screen.findByText('購物車是空的')).toBeTruthy();
    expect(screen.getByText('還沒選好部品嗎？去看看本週精選吧。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '繼續購物' })).toBeTruthy();
  });

  it('有商品 → 渲染品牌/名稱/適用/變體標/單價/小計 + 件數 + 免運(滿門檻)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 2 }]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1', variantLabel: 'Forged · Glossy', sku: 'DCC01-G-F', unitPrice: 15200 }),
    ]);
    const { container } = render(<CartView />);
    expect(await screen.findByText('碳纖維車台護蓋')).toBeTruthy();
    expect(screen.getByText('1 件商品')).toBeTruthy();
    expect(screen.getByText('RPM')).toBeTruthy();
    expect(screen.getByText('適用 Aprilia RSV4')).toBeTruthy();
    expect(screen.getByText('Forged · Glossy')).toBeTruthy();
    expect(screen.getByText('料號 DCC01-G-F')).toBeTruthy(); // V-2a2:料號恆顯行
    // 小計 = 15200 × 2 = 30,400(行小計 / 小計 / 總計 同值、用精準 selector 避撞)
    expect(container.querySelector('.cart-item-price-main')?.textContent).toBe('NT$ 30,400');
    expect(container.querySelector('.cart-grand span:last-child')?.textContent).toBe('NT$ 30,400');
    expect(screen.getByText('單價 NT$ 15,200')).toBeTruthy();
    // 運費免運(>=5000):運費值 span 文字 = 免運(perks「滿 NT$ 5,000 免運」非精確匹配、不撞)
    expect(screen.getByText('免運')).toBeTruthy();
    // 商品連結指向 /products/rpm-1
    expect(container.querySelector('a[href="/products/rpm-1"]')).toBeTruthy();
  });

  it('運費未滿門檻 → NT$ 100 +「再買 NT$ X 享免運」hint + 總計含運費', async () => {
    setCart([{ productId: 'rpm-2', qty: 1 }]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-2', name: '小料件', unitPrice: 2400 }),
    ]);
    render(<CartView />);
    expect(await screen.findByText('小料件')).toBeTruthy();
    expect(screen.getByText('NT$ 100')).toBeTruthy();
    expect(screen.getByText('再買 NT$ 2,600 享免運')).toBeTruthy();
    // 總計 = 2400 + 100 = 2,500
    expect(screen.getByText('NT$ 2,500')).toBeTruthy();
  });

  it('qty + → updateQty(item, qty+1);qty=1 時 minus disabled;移除 → removeItem(item)', async () => {
    const item: CartItem = { productId: 'rpm-1', variantId: 'v1', qty: 1 };
    const { updateQty, removeItem } = setCart([item]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');

    const plus = screen.getByRole('button', { name: '增加數量' });
    fireEvent.click(plus);
    expect(updateQty).toHaveBeenCalledWith(item, 2);

    const minus = screen.getByRole('button', { name: '減少數量' }) as HTMLButtonElement;
    expect(minus.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(removeItem).toHaveBeenCalledWith(item);
  });

  it('前往結帳 → /checkout;繼續購物 → /products', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');

    fireEvent.click(screen.getByRole('button', { name: /前往結帳/ }));
    expect(pushMock).toHaveBeenCalledWith('/checkout');

    fireEvent.click(screen.getByRole('button', { name: '繼續購物' }));
    expect(pushMock).toHaveBeenCalledWith('/products');
  });

  it('🔴 經銷零洩漏:階段① general-only、不顯「經銷」/ price_store', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 2 }]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 }),
    ]);
    const { container } = render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');
    expect(container.textContent).not.toContain('經銷');
    expect(container.textContent).not.toContain('price_store');
    expect(container.textContent).not.toContain('priceByTier');
    // 無劃線價 <s>
    expect(container.querySelector('s')).toBeNull();
  });

  it('V-2h/MF-5:登入唯一/主車 → 首載預填未填列(source:garage)、不覆蓋 search 帶入列', async () => {
    const searchItem: CartItem = {
      productId: 'rpm-1', variantId: 'v1', qty: 1,
      vehicle: { kind: 'dict', brand: 'Yamaha', model: 'MT-09', year: 2021, source: 'search' },
    };
    const emptyItem: CartItem = { productId: 'rpm-2', qty: 1 };
    const { setItemVehicle } = setCart([searchItem, emptyItem]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'rpm-2', name: '小料件' }),
    ]);
    const BRANDS = [{ id: 'yamaha', name: 'Yamaha', models: [{ id: 'mt-09-sp', name: 'MT-09 SP', years: [2021] }] }];
    const garage = [{ id: 'g1', name: 'MT-09 SP', year: '2021', dictBrandName: 'Yamaha', dictModelName: 'MT-09 SP', isPrimary: true }];
    render(<CartView motoBrands={BRANDS} garage={garage} />);
    await screen.findByText('碳纖維車台護蓋');
    await waitFor(() => expect(setItemVehicle).toHaveBeenCalledTimes(1)); // 只補未填 rpm-2、不碰 search 的 rpm-1
    const [calledItem, calledVehicle] = setItemVehicle.mock.calls[0]!;
    expect(calledItem.productId).toBe('rpm-2');
    expect(calledVehicle).toEqual({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'garage' });
  });

  it('V-2h/MF-5:未登入(garage=[])→ 不預填', async () => {
    const { setItemVehicle } = setCart([{ productId: 'rpm-2', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-2', name: '小料件' })]);
    render(<CartView />);
    await screen.findByText('小料件');
    expect(setItemVehicle).not.toHaveBeenCalled();
  });

  it('stale line(found:false)→ 不渲染、退空狀態', async () => {
    setCart([{ productId: 'gone', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'gone', found: false })]);
    render(<CartView />);
    await waitFor(() => expect(screen.getByText('購物車是空的')).toBeTruthy());
  });

  // W11-019 B1:數量改可鍵盤輸入(span → input),+/− 仍留。
  it('數量輸入框:打 0 失焦 → updateQty 收到 1,不是 0(context updateQty(key,0) 語意是移除該列)', async () => {
    const item: CartItem = { productId: 'rpm-1', variantId: 'v1', qty: 3 };
    const { updateQty } = setCart([item]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');

    const input = screen.getByRole('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(updateQty).toHaveBeenCalledWith(item, 1);
  });

  it('數量輸入框:打 >99 失焦 → 夾到 99 並顯示提示,updateQty 收到 99', async () => {
    const item: CartItem = { productId: 'rpm-1', variantId: 'v1', qty: 1 };
    const { updateQty } = setCart([item]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');

    const input = screen.getByRole('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    expect(updateQty).toHaveBeenCalledWith(item, 99);
    expect(screen.getByText('已達購買上限 99')).toBeTruthy();
  });
});

// ── A4:購物車圖片載不到就破圖(補洞窗)──────────────────────────────────────────
// 🔴 有實績:2026-08-22 發生過真實破圖(外部圖 + `Accept: image/webp`)⇒ 這不是假想敵。
// 三格是一組:載得到的**不准**被換掉(否則「永遠顯示佔位圖」會全綠)/ 載不到要換 / 根本沒圖也要有東西。
describe('CartView — A4 圖片 fallback', () => {
  const PLACEHOLDER = '/placeholder-product.png';

  async function renderOneLine(image: string | null) {
    setCart([{ productId: 'p1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'p1', image })]);
    render(<CartView />);
    return await screen.findByAltText('碳纖維車台護蓋');
  }

  it('載得到的圖**不動** —— 負對照(少了這格,「永遠回佔位圖」會全綠)', async () => {
    const img = await renderOneLine('https://cdn.example/img.jpg');
    expect(img.getAttribute('src')).toBe('https://cdn.example/img.jpg');
  });

  it('圖載不到 ⇒ 換成站內佔位圖(不是瀏覽器那個裂掉的圖示)', async () => {
    const img = await renderOneLine('https://cdn.example/img.jpg');
    fireEvent.error(img);
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
  });

  it('那一列根本沒有圖 ⇒ 也給佔位圖(原本是一個空白方框)', async () => {
    const img = await renderOneLine(null);
    expect(img.getAttribute('src')).toBe(PLACEHOLDER);
  });
});

// ── A2:讀不到 ≠ 空車(補洞窗)──────────────────────────────────────────────────
// 這一層驗的是**畫面**,不是 hook —— hook 那層在 `useResolvedCart.test.tsx`。
// 🔴 兩層都要:hook 回 `error` 而畫面沒接住(掉進 ready 分支)在 hook 測試裡是**看不見**的。
describe('CartView — A2 讀不到購物車', () => {
  it('resolve 掛掉 ⇒ 出「暫時讀不到你的購物車」,而**不是**「購物車是空的」', async () => {
    setCart([{ productId: 'p1', qty: 1 }]);
    resolveMock.mockRejectedValue(new Error('network down'));
    render(<CartView />);
    expect(await screen.findByText('暫時讀不到你的購物車')).toBeDefined();
    // 🔴 這一行是本格的重點:舊行為就是在這裡對客人說「你沒有東西」。
    expect(screen.queryByText('購物車是空的')).toBeNull();
  });

  it('負對照:真的空車仍出「購物車是空的」', async () => {
    setCart([]);
    resolveMock.mockResolvedValue([]);
    render(<CartView />);
    expect(await screen.findByText('購物車是空的')).toBeDefined();
    expect(screen.queryByText('暫時讀不到你的購物車')).toBeNull();
  });
});
