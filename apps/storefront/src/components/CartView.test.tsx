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
      // 🔴 `cartSessionId`:登出/換人時 CartContext 會把它一起收掉, 而自我修復的 removeItem 不碰它
      //    ⇒ 那是「換了一車」與「東西被移掉」唯一分得開的訊號(見 CartView 的歸零 effect)。
      cartSessionId: 'sess-default' as string | null,
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

function setCart(items: CartItem[], opts: { isHydrated?: boolean; cartSessionId?: string | null } = {}) {
  const updateQty = vi.fn();
  const removeItem = vi.fn();
  const setItemVehicle = vi.fn();
  const setAllItemsVehicle = vi.fn();
  cartRef.current = {
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    isHydrated: opts.isHydrated ?? true,
    cartSessionId: opts.cartSessionId ?? 'sess-default',
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
  // ═══ ⟦b4-NOVARIANT-CHECKOUTMSG⟧ 實例④:有東西被移掉了要說出來(2026-09-03 線 `-front`)═══
  //   🛑 **甲案 —— 只改購物車頁,`useResolvedCart` 零改動**(它的消費端含 `CheckoutView`,
  //      而它自己算 `subtotal`/`total` ⇒ 動它 = 動結帳與金額,主視窗-87 裁不做)。
  //   ⚠️ **已知缺口**:結帳頁若也發生同樣的移除,**它仍然沒有訊息** —— 而那一格【未驗】。
  //   🛑 字面是暫用的,等 Sean 題 25。

  it('🔴 有東西【不是他刪的】而消失 ⇒ 說出來', async () => {
    // 世界:hydrate 後先看到 2 筆 ⇒ 下一輪只剩 1 筆,而客人沒有按過刪除
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }, { productId: 'gone-1', variantId: 'v9', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { rerender } = render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');
    // hook 的自我修復把查無那筆移掉 ⇒ items 變 1 筆
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    rerender(<CartView />);
    await waitFor(() => expect(screen.getByText(/已為您移除/)).toBeTruthy());
    expect(screen.getByText(/1 件商品已不再供應/)).toBeTruthy();
  });

  it('🔴🔴 全車被移掉(空車那條路)⇒ 那句話【也要】出現 —— R1 Critical 1 的那個世界', async () => {
    // 🎯 這一格是本片存在的理由:production 實測就是這個世界(整車查無 ⇒ 畫面「購物車是空的」)。
    //    而第一版的通知掛在 `status!=='empty'` 那個 return 裡 ⇒ **對這個世界零效果, 而 22 格全綠。**
    // 🧬 突變:把 `<CartEmpty … prunedCount={prunedCount} />` 的傳值拿掉 ⇒ 本格必須紅。
    setCart([{ productId: 'gone-1', variantId: 'v9', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'gone-1', variantId: 'v9', found: false })]);
    const { rerender } = render(<CartView />);
    await waitFor(() => expect(screen.getByText('購物車是空的')).toBeTruthy());
    setCart([]); // hook 的自我修復把它移掉
    rerender(<CartView />);
    await waitFor(() => expect(screen.getByText(/已為您移除/)).toBeTruthy());
    // 🟢 而空車那句話還在 —— 兩句要並存, 不是互相取代
    expect(screen.getByText('購物車是空的')).toBeTruthy();
  });

  it('🔴🔴 登出 / 換帳號清空 ⇒ 那句話【不得】出現 —— R1 Critical 3', async () => {
    // 🛑 `CartContext.tsx:394-400` 登出走 setItems([]) 且把 cartSessionId 一起收掉,
    //    而自我修復的 removeItem 從不碰 cartSessionId ⇒ 那就是分得開的訊號。
    //    少了它:一個剛登出的客人會看到「有 N 件商品已不再供應」。
    // 🧬 突變:把 cartSessionId 那支歸零 effect 拿掉 ⇒ 本格必須紅。
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }, { productId: 'rpm-2', variantId: 'v2', qty: 1 }], { cartSessionId: 'sess-A' });
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'rpm-2', variantId: 'v2', name: '第二件' }),
    ]);
    const { rerender } = render(<CartView />);
    await screen.findByText('第二件');
    setCart([], { cartSessionId: null }); // 登出:品項清空 + 去重子收掉
    rerender(<CartView />);
    await waitFor(() => expect(screen.getByText('購物車是空的')).toBeTruthy());
    expect(screen.queryByText(/已為您移除/)).toBeNull();
  });

  it('🔵 負對照:沒有東西被移掉 ⇒ 那句話【不在】(否則它對每個客人都會出現)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');
    expect(screen.queryByText(/已為您移除/)).toBeNull();
  });

  it('🔴 客人【自己按刪除】⇒ 那句話不得出現(否則我們把他自己的動作說成是我們移的)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }, { productId: 'rpm-2', variantId: 'v2', qty: 1 }]);
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1' }),
      resolvedLine({ productId: 'rpm-2', variantId: 'v2', name: '第二件' }),
    ]);
    const { rerender } = render(<CartView />);
    await screen.findByText('第二件');
    fireEvent.click(screen.getAllByText('移除')[1]!); // 客人按的那一顆
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    rerender(<CartView />);
    await waitFor(() => expect(screen.queryByText('第二件')).toBeNull());
    expect(screen.queryByText(/已為您移除/)).toBeNull();
  });

  it('hydrate 前 → 載入態「載入購物車…」', () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }], { isHydrated: false });
    render(<CartView />);
    expect(screen.getByText('載入購物車…')).toBeTruthy();
  });

  // ── ⟦b4-NOVARIANT-OLDCART⟧ 2026-09-02 ────────────────────────────────────────
  // 🔴 **那一列問的第一格逐字:「購物車頁面會怎麼顯示它(價格?規格欄空白?)」**
  //    而在本片之前, `variantLabel: null` 只是 fixture 的預設值 —— **沒有一格在斷言它。**
  // 🎯 這一格釘三件事, 而它們是【客人看得到的】:
  //    ① 價格照顯(無變體商品取群代表價 —— `cart/actions.ts` 那條 `else` 分支)
  //    ② 規格那一行【整行不出現】, 不是出現一個空的
  //    ③ 畫面上不准出現 `null` / `undefined` 這種字 —— 那是最常見的「沒處理到」形狀
  it('🔴 無變體那一筆:價格照顯、規格行整行不出現、畫面沒有 null/undefined(⟦b4-NOVARIANT-OLDCART⟧ 第一格)', async () => {
    // 🔵 無變體那一筆解析回來的形狀:variantId / variantLabel / sku 全是空, 而 unitPrice 是【群代表價】
    //    (`apps/storefront/src/app/cart/actions.ts` 的 `else` 分支:variants 空 ⇒ unitPrice = product.price)
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'nv-1' })]);
    setCart([{ productId: 'nv-1', qty: 1 }]);
    render(<CartView />);
    // ① 價格 —— 🔵 用 findAll:單價與小計【兩個地方都會顯】(qty=1 ⇒ 同一個數字)
    //    findByText 在這裡會炸「Found multiple elements」⇒ 而那個炸法本身就是證據:它真的顯了
    expect((await screen.findAllByText(/14,600|14600/)).length).toBeGreaterThanOrEqual(1);
    // ③ 畫面上不准有 null / undefined
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/undefined/);
    expect(body).not.toMatch(/\bnull\b/);
    // ② 規格行不存在 —— 用 class 查, 因為它就是那一行的身分
    expect(document.querySelector('.cart-item-variant')).toBeNull();
  });

  it('🔵 正對照:有變體那一筆【要】有規格行 —— 否則上面那一格在「這個 class 根本不存在」時也會過', async () => {
    resolveMock.mockResolvedValue([
      resolvedLine({ productId: 'rpm-1', variantId: 'v1', variantLabel: 'Forged · Glossy' }),
    ]);
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    render(<CartView />);
    await screen.findByText(/Forged/);
    expect(document.querySelector('.cart-item-variant')).not.toBeNull();
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
    const { container } = render(<CartView />);
    expect(await screen.findByText('小料件')).toBeTruthy();
    expect(screen.getByText('NT$ 100')).toBeTruthy();
    expect(screen.getByText('再買 NT$ 2,600 享免運')).toBeTruthy();
    // 總計 = 2400 + 100 = 2,500
    // 🔴 2026-09-03 收窄成 `.cart-grand`(原本是 `getByText('NT$ 2,500')`)——
    //    ⟦f3-MOBCHECKOUTFOLD⟧ 之後同一個總計**印在兩個地方**(頁內 `.cart-grand` +
    //    手機固定列),`getByText` 會撞「找到多個」。**斷言的東西沒有變, 只是指名了哪一個。**
    //    🔵 而「兩處同源」由本檔下方那格獨立守(固定列不自己重算金額)。
    expect(container.querySelector('.cart-grand')?.textContent).toContain('NT$ 2,500');
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
    const { container } = render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');

    // 🔴 2026-09-03 收窄成 `.cart-checkout`(原本是 `getByRole(name:/前往結帳/)`)——
    //    ⟦f3-MOBCHECKOUTFOLD⟧ 之後頁上有**兩顆**「前往結帳」(頁內 + 手機固定列)。
    //    🛑 真站上兩顆不會同時看得到(固定列在桌機 `display:none`),而 **jsdom 不算
    //    media query** ⇒ 這裡兩顆都在。本格守的是**頁內那顆**, 固定列那顆由下方獨立一格守。
    fireEvent.click(container.querySelector<HTMLButtonElement>('.cart-checkout')!);
    expect(pushMock).toHaveBeenCalledWith('/checkout');

    fireEvent.click(screen.getByRole('button', { name: '繼續購物' }));
    expect(pushMock).toHaveBeenCalledWith('/products');
  });

  // 🔴 本格自 2026-08-29 起同時是【本類的正向錨】—— 格名跟著改, 否則金額格式壞掉時
  //    CI 印的是「經銷零洩漏」失敗, 診斷會指向錯的方向。
  it('🔴 經銷零洩漏:階段① general-only、不顯「經銷」/ price_store + 正向金額仍在', async () => {
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
    // 🔴🔴 正向的同伴(2026-08-29 線C 補;⟦b4-MONEY4⟧ 分母體檢逼出來的)
    //    上面那四行【全部是負向的】—— 它們守的是「不該出現的東西」,
    //    而沒有一行證明「該出現的出現了」⇒ **實作渲染空的時候, 那四行會同時變綠。**
    //    ✅ 已實測(本檔, 2026-08-29):把 `CartView.tsx` 的 `cart-item-price-main`
    //       改成渲染空的 ⇒ **本格紅在下面這一行**, 而它前面那四行【先跑過了】
    //       ⇒ 同一發同時證了「新行有效」與「那四行在空世界仍綠」。實作已逐字還原。
    //    ⚠️ 而「空 keys / 空投影 / 空 JSON / 空清單」那組數字**不是在本檔量的** ——
    //       它量在 ⟦b4-MONEY4⟧ 的 adapters 那批(落點 `~/pcm-mailbox/線C-⟦b4-MONEY4⟧分母體檢-20260829.md`)。
    //       📌 **本檔是 jsdom render, 沒有 JSON 也沒有投影層** ⇒ 數字要帶著它的量測範圍走。
    // 🔴 **一類補一格就夠** —— 上面那四行沒有壞, 刻意不動它們。
    //    判準只有一句:**在「實作渲染空的」那個世界, 這一行會不會紅?**
    //    ⇒ 用【精確相等】不用 `toContain`:`toContain('NT$')` 會被 **`NT$ 0`** 滿足
    //      ⇒ 一個把價格算成 0 的實作照樣過。(不是「別處的 NT$」—— 這裡的查詢範圍
    //       已經收到單一元素裡了, 那個理由不成立;真正的弱點是它**接受錯的金額**。)
    // ⚠️ **誠實邊界**:下面兩行與本檔 `:143` / `:145` 是同一組斷言、同一份 fixture
    //    ⇒ 🔴 **它們沒有新增任何一個原本無人守的世界**。
    //    它們新增的是:**這一格自己站得住** —— 一個只讀「經銷零洩漏」這一格的人,
    //    看得到正向錨就在同一格裡, 而不是隔壁那一格(而隔壁那一格顯然沒有阻止這個病)。
    expect(container.querySelector('.cart-item-price-main')?.textContent).toBe('NT$ 30,400');
    // qty>1 才渲染(CartView.tsx:202)—— 本格 fixture qty=2;誰把它改成 1, 這一行會紅而訊息不提 qty
    expect(container.querySelector('.cart-item-price-unit')?.textContent).toBe('單價 NT$ 15,200');
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

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    // 🔴 #886:失敗時把【輸入框當下的值】一起吐出來。**期望值一個字沒動** ——
    //   探針量到兩個機制造得出同一個指紋(恰好一次呼叫、值 1),而 CI 只留下次數與值 ⇒ 分不出來:
    //     r3 React 的 value tracker 脫鉤 ⇒ onChange 被吞 ⇒ 框裡留著 "150",state 是 '1'
    //     r4 blur 當下框是空的           ⇒ commit('') ⇒ NaN ⇒ 走 `: 1`,框裡留著 "1"
    //   ⇒ **`input.value` 是唯一分得出這兩個的東西**,而它下次紅的時候才拿得到。
    //   (值與五格探針:`~/pcm-mailbox/線C-交件-886探針結果-20260824.md` §2)
    expect(updateQty, `#886 診斷:input.value=${JSON.stringify(input.value)}`).toHaveBeenCalledWith(
      item,
      1,
    );
  });

  // 🔴 **fixture 的 `qty` 從 1 改成 3**(2026-08-29 Sean 順手指定, 而那句比它聽起來硬):
  //    這一格原本用 `qty: 1` ⇒ 而 `#886` 的錯誤行為送出的**也是 1**
  //    ⇒ **對的行為與錯的行為印同一個數字** ⇒ 這一格對那個 bug【恆綠】。
  //    ✅ 改成 3 ⇒ 兩個世界從此分得開。
  //    📌 而他是憑「1 看起來怪」講的 —— 那個直覺撞到的是一個量得出來的恆綠格。
  // 🔴🔴 **這個 `qty: 3` 被【另一支檔】的一段分析引用著** ——
  //    `components/CartQtyInput.tsx` 那段 `#886` 指紋推理拿這個值在推 r3/r4。
  //    ⚠️ 2026-09-04 實查:那段當時還寫著「它用 `qty: 1`」⇒ **有人改了這裡而那裡沒跟著改**
  //    ⇒ 🎯 **改這個值 ⇒ 一起去看那一段**(`grep -n '#886' components/CartQtyInput.tsx`)。
  //    📌 **⇒ 而這一行反向指標本身也會過期** —— 更耐久的做法是那段分析不要引用【值】,
  //       引用【值的來源座標】。這一行是便宜的補丁, 不是正解。
  it('數量輸入框:打 >99 失焦 → 夾到 99 並顯示提示,updateQty 收到 99', async () => {
    const item: CartItem = { productId: 'rpm-1', variantId: 'v1', qty: 3 };
    const { updateQty } = setCart([item]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    render(<CartView />);
    await screen.findByText('碳纖維車台護蓋');

    const input = screen.getByRole<HTMLInputElement>('textbox', { name: '數量' });
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    // 🔴 #886:失敗時把【輸入框當下的值】一起吐出來。**期望值一個字沒動** ——
    //   探針量到兩個機制造得出同一個指紋(恰好一次呼叫、值 1),而 CI 只留下次數與值 ⇒ 分不出來:
    //     r3 React 的 value tracker 脫鉤 ⇒ onChange 被吞 ⇒ 框裡留著 "150",state 是 '1'
    //     r4 blur 當下框是空的           ⇒ commit('') ⇒ NaN ⇒ 走 `: 1`,框裡留著 "1"
    //   ⇒ **`input.value` 是唯一分得出這兩個的東西**,而它下次紅的時候才拿得到。
    //   (值與五格探針:`~/pcm-mailbox/線C-交件-886探針結果-20260824.md` §2)
    expect(updateQty, `#886 診斷:input.value=${JSON.stringify(input.value)}`).toHaveBeenCalledWith(
      item,
      99,
    );
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

// ⟦f3-MOBCHECKOUTFOLD⟧ 手機底部固定結帳列(Sean 2026-09-03 拍 `Q26 = 乙`)。
// 🔴 **這裡只驗「有沒有渲染 + 顯示什麼 + 按了會不會走同一條路」** —— 它「在手機才出現」
//    那一半是 CSS(`cart.css` 的 `@media`),元件測試看不到 media query
//    ⇒ 📌 **那一半由 `apps/storefront/src/styles/cart-buybar.test.ts` 釘,不要在這裡假裝驗過。**
describe('CartView — 手機底部固定結帳列', () => {
  it('有商品 ⇒ 固定列在,且印的總計與頁面上那個 .cart-grand 是同一個數', async () => {
    setCart([{ productId: 'p1', qty: 2 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'p1', unitPrice: 1500 })]);
    const { container } = render(<CartView />);
    const bar = await waitFor(() => {
      const el = container.querySelector('.cart-mobile-buybar');
      if (!el) throw new Error('還沒渲染');
      return el;
    });
    // 🔴🔴 **第一版這一格是【假綠】**(對抗審查 MF4,實跑突變證出來的):
    //    原本斷言 `barPrice !== ''` 且 `grand.contains(barPrice)`
    //    ⇒ 把 `NT$ {total}` 改成只剩 `NT$`, `barPrice = "NT$"` ⇒ 兩條**都過**
    //    ⇒ 📌 **這一片存在的唯一理由(手機上看得到總計)被拔掉, 而四格全綠。**
    //    ✅ 改成**把數字抽出來比等值** —— 抽不到就是紅。
    const amount = (el: Element | null): string =>
      (el?.textContent ?? '').replace(/[^\d]/g, '');
    const grandAmt = amount(container.querySelector('.cart-grand'));
    const barAmt = amount(bar.querySelector('.cart-mobile-buybar-price'));
    // 🔴 先釘「真的有數字」—— 少了這行, 兩邊都空字串時 `toBe` 會過。
    expect(barAmt, '固定列要印得出金額數字').not.toBe('');
    expect(grandAmt, '頁內總計要印得出金額數字').not.toBe('');
    // 🎯 同源:固定列不自己重算一次金額(有人改成 subtotal ⇒ 這一格紅)。
    expect(barAmt).toBe(grandAmt);
  });

  it('🔵 負對照:空車 ⇒ 固定列**不在**(沒有東西可結帳、也不該讓位)', async () => {
    setCart([]);
    resolveMock.mockResolvedValue([]);
    const { container } = render(<CartView />);
    expect(await screen.findByText('購物車是空的')).toBeDefined();
    expect(container.querySelector('.cart-mobile-buybar')).toBeNull();
  });

  it('🔵 負對照:讀不到購物車 ⇒ 固定列也**不在**(錯誤態不給結帳入口)', async () => {
    setCart([{ productId: 'p1', qty: 1 }]);
    resolveMock.mockRejectedValue(new Error('network down'));
    const { container } = render(<CartView />);
    expect(await screen.findByText('暫時讀不到你的購物車')).toBeDefined();
    expect(container.querySelector('.cart-mobile-buybar')).toBeNull();
  });

  it('按固定列的鈕 ⇒ 走 /checkout(與頁面上那顆 .cart-checkout 同一條路, 不另開一條)', async () => {
    setCart([{ productId: 'p1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'p1', unitPrice: 1500 })]);
    const { container } = render(<CartView />);
    const btn = await waitFor(() => {
      const el = container.querySelector<HTMLButtonElement>('.cart-mobile-buybar-btn');
      if (!el) throw new Error('還沒渲染');
      return el;
    });
    fireEvent.click(btn);
    expect(pushMock).toHaveBeenCalledWith('/checkout');
  });
});
