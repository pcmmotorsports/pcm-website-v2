// @vitest-environment jsdom
//
// checkout-887-payment-in-flight.test.tsx — `#887` 的守門。
//
// ══════════════════════════════════════════════════════════════════════════════
// 🔴 這支檔在守什麼(一句話):**客人的錢正在飛的時候, 整個結帳頁不得被換掉。**
//
// `CheckoutView.tsx` 裡三道 cart 閘(`loading` / `error` / `empty`)都是**整頁 early return**,
// 而 `<CheckoutPaymentOverlay open={submitting} />` 住在它們的**下游** ⇒
// `submitting` 期間任一個狀態成立, 遮罩就跟著整頁一起卸載:
//   · `error` ⇒ 客人看到「暫時讀不到你的購物車 / 請重新整理頁面再試一次」⇒ 讀成「付款失敗了」⇒ **重按 ⇒ 重複扣款**
//   · `empty` ⇒ 畫面上還有一顆「繼續購物」**會把他導離結帳頁**
//
// 🔴 **這個不變量早就有前例, 而沒有人把它延伸到 `submitting`**:
//   `CheckoutView.test.tsx` 的「🔴 終態優先於空車」那一格, 註解逐字寫著
//   「剛刷完卡的客人會看到『購物車是空的』…… → **直接誘導重複付款**,
//     而既有 40 條 + 本片 10 條新測試**照樣全綠**」。
//   ⇒ `#887` = 那格守門只守了「終態」那一半。本檔補的是「進行中」那一半。
//
// ══════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ 本檔的效度限制 —— 先讀這段, 不然會把它當成比它更強的東西
//
// ① **本檔 mock 掉 `useResolvedCart`。** 它證的是
//      「給定 (submitting, cart.status), `CheckoutView` **決定渲染什麼**」
//    它**證不出**
//      「`useResolvedCart` 真的能在 `submitting` 期間走到 `error` / `loading` / `empty`」。
//    後者(可達性)在 `#887` 條目裡我標的是「**推出來的, 沒實走**」:
//      觸發鍵 = `lineSignature`(useResolvedCart deps),而付款中要它變, 得靠
//      `#375` 自我修復在 `.then()` 裡 `removeItem` 掉一行。**那條路沒有人跑過。**
//    🔴 **我自己造的替身, 只會照我理解的樣子回答我** —— 所以這一條寫在檔頭, 不在腳註。
//
// ② 三道閘裡, 渲染決策是 `CheckoutView` 的; 而 `#887` 要怎麼修是**產品題**(Sean 的)。
//    ⇒ 本檔**刻意不預設答案**。它分成兩半:
//      · 「該綠的綠」= 負對照。**甲/乙/丙 三案落地後這幾格都必須照樣綠。**
//      · 「乙案守門」= Sean 2026-08-24 拍板後的規格(第三段)。
//    📌 **這一段原本是「現況存證」**(斷言 bug 今天的樣子), 在 Sean 拍板當天翻面成規格。
//      翻面 = **改寫斷言**, 不是把紅的改綠 —— 後者是 R4 立即停止訊號, 而兩者在 diff 上很像。
//
// ③ jsdom 沒有實作 `<dialog>` 的 `showModal` / inert ⇒ 本檔補最小 stub(同 `CheckoutView.test.tsx`)。
//    ⇒ 「遮罩在不在 DOM 裡 / `.open` 是不是 true」量得到; 「背景真的被鎖住了嗎」**量不到**。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CustomerAddress, MemberTier } from '@pcm/domain';
import type { UseResolvedCart } from '@/hooks/useResolvedCart';

// 同 CheckoutView.test.tsx:jsdom 未實作 dialog。真 modal / inert 行為留真瀏覽器。
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    if (this.open) throw new DOMException('dialog already open', 'InvalidStateError');
    this.open = true;
  };
}
if (typeof HTMLDialogElement.prototype.close !== 'function') {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
  };
}

const { cartStateRef, getPrimeMock, chargeMock, pushMock } = vi.hoisted(() => ({
  // 🔴 本檔的方向盤:直接擺 `useResolvedCart` 的回傳值。見檔頭限制①。
  cartStateRef: { current: null as unknown },
  getPrimeMock: vi.fn(),
  chargeMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('@/hooks/useResolvedCart', () => ({
  useResolvedCart: () => cartStateRef.current,
}));
vi.mock('@/contexts/CartContext', () => ({
  useCart: () => ({
    items: [],
    totalQty: 0,
    isHydrated: true,
    cartSessionId: 'cart-sess-887',
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQty: vi.fn(),
    clear: vi.fn(),
    regenerateCartSession: vi.fn(),
  }),
}));
vi.mock('@/app/cart/actions', () => ({ resolveCartLines: vi.fn() }));
vi.mock('@/app/checkout/charge-actions', () => ({ chargePaymentAction: chargeMock }));
vi.mock('@/app/account/address/actions', () => ({
  addAddressAction: vi.fn(),
  updateAddressAction: vi.fn(),
  deleteAddressAction: vi.fn(),
}));
vi.mock('@/hooks/useTapPayCard', () => ({
  TAPPAY_FIELD_IDS: {
    number: 'tappay-card-number',
    expirationDate: 'tappay-card-expiration-date',
    ccv: 'tappay-card-ccv',
  },
  useTapPayCard: () => ({
    ready: 'ready' as const,
    canGetPrime: true,
    fieldStatus: { number: 0 as const, expiry: 0 as const, ccv: 0 as const },
    getPrime: getPrimeMock,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/components/CheckoutRedirecting', () => ({
  CheckoutRedirecting: () => <div>正在前往安全付款頁面</div>,
}));
vi.mock('@/lib/payment/inflight-marker', () => ({
  setPaymentInflight: vi.fn(),
  confirmProceedIfInflight: vi.fn(() => true),
  clearPaymentInflight: vi.fn(),
}));
vi.mock('@/app/checkout/reconcile-actions', () => ({
  reconcileCartSession: vi.fn().mockResolvedValue({ status: 'pending' }),
}));
vi.mock('@/lib/invoice-visibility', () => ({ INVOICE_FIELDS_HIDDEN: false }));

import { CheckoutView } from './CheckoutView';

const ADDR = {
  id: '11111111-1111-4111-8111-111111111111',
  isDefault: true,
  name: '王小明',
  phone: '0912345678',
  line: '新北市新莊區化成路 736 巷 18 號',
} as unknown as CustomerAddress;

const LINE = {
  item: { productId: 'rpm-1', variantId: 'v1', qty: 1 },
  resolved: {
    variantId: 'v1',
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
  lineTotal: 14600,
} as unknown as UseResolvedCart['lines'][number];

/** `useResolvedCart` 的回傳值。`status` 以外的欄位照真型別給滿(它是**扁平物件不是 union**)。 */
function cart(status: UseResolvedCart['status']): UseResolvedCart {
  const lines = status === 'ready' ? [LINE] : [];
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return { status, lines, subtotal, shipping: 0, freeShipRemaining: 0, total: subtotal };
}

function renderCheckout() {
  return render(
    <CheckoutView bankTransferEnabled={false}
      addresses={[ADDR]}
      memberName="王小明"
      memberTier={'general' as MemberTier}
      notificationEmailEnabled={false}
      initialNotificationEmail=""
    />,
  );
}

const overlayOf = (c: HTMLElement) =>
  c.querySelector('dialog.co-pay-overlay') as HTMLDialogElement | null;

/**
 * 把畫面推進到「錢正在飛」:走到 Step 2、勾同意、按付款,而 `getPrime` **永不 resolve**
 * ⇒ `primeBusy` 卡在 true ⇒ `submitting === true`。
 *
 * 🔴 回傳前先斷言遮罩**真的開了** —— 少了這一步, 下面每一格都可能是
 *   「其實沒進 submitting」造成的假綠, 而那種假綠與真綠長得一模一樣。
 */
async function enterSubmitting(container: HTMLElement) {
  getPrimeMock.mockImplementation(() => new Promise<string>(() => {}));
  // 🔴 字面要具體:`/下一步/` 會同時命中桌機 `.co-btn-next` 與手機 `.co-mobile-buybar-btn`
  //   ⇒ getByRole 直接拋「Found multiple elements」。沿用 `CheckoutView.test.tsx` 的既有慣例。
  fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
  const agree = container.querySelector('.co-agree input[type="checkbox"]') as HTMLInputElement;
  fireEvent.click(agree);
  // 「確認付款」同樣是桌機 + 手機兩顆 ⇒ getAllBy + 點第一顆(同既有慣例)。
  fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
  await waitFor(() => expect(overlayOf(container)?.open).toBe(true));
}

afterEach(() => {
  cleanup();
  getPrimeMock.mockReset();
  chargeMock.mockReset();
  pushMock.mockReset();
  cartStateRef.current = null;
});

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

// ─────────────────────────────────────────────────────────────────────────────
// 一、該綠的綠(負對照)—— **甲 / 乙 / 丙 三案落地後這幾格都必須照樣綠**
//
// 🔴 它們不是陪襯。`#887` 最可能的修法是在三道閘上面再加一道 `submitting` 判斷,
//   而**加閘最常見的壞法是把非付款中的路徑一起吃掉** ——
//   那時客人網路抖一下, 畫面會什麼都不說(比說錯話更糟, 因為連重試的指示都沒有)。
// ─────────────────────────────────────────────────────────────────────────────
describe('#887 負對照:【不在】付款中時, 三道 cart 閘的行為一個字都不許變', () => {
  it('沒在付款 + 讀不到 ⇒ 仍出「暫時讀不到你的購物車」, 且不得謊稱空車', () => {
    cartStateRef.current = cart('error');
    renderCheckout();
    expect(screen.getByText('暫時讀不到你的購物車')).toBeDefined();
    expect(screen.queryByText('購物車是空的')).toBeNull();
  });

  it('沒在付款 + 真空車 ⇒ 仍出「購物車是空的」+「繼續購物」', () => {
    cartStateRef.current = cart('empty');
    renderCheckout();
    expect(screen.getByText('購物車是空的')).toBeDefined();
    expect(screen.getByRole('button', { name: '繼續購物' })).toBeDefined();
    expect(screen.queryByText('暫時讀不到你的購物車')).toBeNull();
  });

  it('沒在付款 + 還在讀 ⇒ 仍出載入態', () => {
    cartStateRef.current = cart('loading');
    renderCheckout();
    expect(screen.getByText('載入結帳資料…')).toBeDefined();
  });

  it('沒在付款 + ready ⇒ 遮罩在 DOM 裡但【關著】(這是遮罩量具的活性自檢)', () => {
    // 🔴 少了這一格,「遮罩永遠不開」也會讓下面守門那幾格綠。
    cartStateRef.current = cart('ready');
    const { container } = renderCheckout();
    expect(overlayOf(container)).toBeTruthy();
    expect(overlayOf(container)!.open).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 二、量具活性:`enterSubmitting` 真的把畫面推進了付款中
// ─────────────────────────────────────────────────────────────────────────────
describe('#887 量具活性:submitting 真的到達得了(否則下面全是假綠)', () => {
  it('ready + 按下確認付款(getPrime 未決)⇒ 遮罩以 modal 開啟', async () => {
    cartStateRef.current = cart('ready');
    const { container } = renderCheckout();
    await enterSubmitting(container);
    expect(overlayOf(container)!.open).toBe(true);
    // 正向:付款中畫面上仍有結帳頁本體(遮罩不是整頁換掉)
    expect(screen.queryByText('暫時讀不到你的購物車')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 三、🔴🔴 乙案守門 —— **Sean 2026-08-24 拍「依照建議」= 乙案**
//
//   落點:`CheckoutView.tsx` 的 `if (submitting && cart.status !== 'ready')`, 排在三道 cart 閘【之前】。
//   畫面:`CheckoutCartNotice variant='paying'` + `CheckoutPaymentOverlay open`
//   文案:「付款處理中,請勿更新頁面或重複點擊」——
//     🔴 **逐字, 不得潤飾**。Sean 第一版只寫「請勿更新頁面」= 兩個動作只擋了一個;
//        這版兩個都擋 ⇒ 任何「讀起來更順」的改寫都可能又掉一個動作。
//
//   🔴 這三格**原本是「現況存證」**(斷言 bug 今天長什麼樣), 在拍板當天翻面成規格。
//     翻面 = 改寫斷言, **不是把紅的改綠**。
//   📌 每一格的承重斷言是那兩條**否定**(不得叫他重新整理 / 那顆導離鈕不得渲染)——
//     它們是三案(甲/乙/丙)的共同底線, 換案子也不該動它們。
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴🔴 #887 乙案守門:錢在飛的時候, 整頁不得被換成任何一句錯話', () => {
  it('付款中而車翻成 error ⇒ 出付款中專屬畫面, 【不得】叫客人重新整理', async () => {
    cartStateRef.current = cart('ready');
    const { container, rerender } = renderCheckout();
    await enterSubmitting(container);
    expect(overlayOf(container)!.open).toBe(true); // 飛在半空中

    // 錢還在飛, 而購物車解析掛了
    cartStateRef.current = cart('error');
    rerender(
      <CheckoutView bankTransferEnabled={false}
        addresses={[ADDR]}
        memberName="王小明"
        memberTier={'general' as MemberTier}
        notificationEmailEnabled={false}
        initialNotificationEmail=""
      />,
    );

    // ── 乙案(Sean 2026-08-24 拍「依照建議」)──
    // 🔴 承重的是這兩條**否定**:它們是三案的共同底線, 而它們攔的是【重複扣款】那條路。
    expect(screen.queryByText(/請重新整理頁面再試一次/)).toBeNull();
    expect(screen.queryByText('暫時讀不到你的購物車')).toBeNull();
    // 正向:專屬畫面在, 文案逐字(Sean 第二版, 兩個動作都擋)
    expect(screen.getByText('付款處理中,請勿更新頁面或重複點擊')).toBeDefined();
    // 遮罩不可省 —— Header/HomeFooter 自帶連結(離開入口), 靠 dialog 的 inert 鎖住
    expect(overlayOf(container)!.open).toBe(true);

    // 🔴 三案共同底線在上面那兩條否定;甲案在 jsdom 裡驗不到「鈕按不動」(inert), 乙案驗得到。
    //   乙(付款中專屬畫面):overlayOf 或專屬畫面存在, 且
    //                        screen.queryByText('暫時讀不到你的購物車') === null
    //   丙(凍結最後一份好的車):畫面與按下付款那一刻逐字相同, 遮罩 open === true
    //   ⇒ 三案的共同底線 = **`expect(screen.queryByText(/請重新整理頁面再試一次/)).toBeNull()`**
    //      這一句在三個答案底下都成立 ⇒ 修好之後至少要有它。
  });

  it('付款中而車翻成 empty ⇒ 那顆會導離結帳頁的「繼續購物」【根本不渲染】', async () => {
    cartStateRef.current = cart('ready');
    const { container, rerender } = renderCheckout();
    await enterSubmitting(container);

    cartStateRef.current = cart('empty');
    rerender(
      <CheckoutView bankTransferEnabled={false}
        addresses={[ADDR]}
        memberName="王小明"
        memberTier={'general' as MemberTier}
        notificationEmailEnabled={false}
        initialNotificationEmail=""
      />,
    );

    // ── 乙案 ──
    // 🔴 承重:乙案與甲案的差別就在這一條 —— 甲案那顆鈕【還在, 只是被 inert 鎖住】,
    //   而 jsdom 量不到 inert ⇒ 甲案在這裡是驗不了的。乙案直接不渲染 ⇒ 量得到。
    expect(screen.queryByRole('button', { name: '繼續購物' })).toBeNull();
    expect(screen.queryByText('購物車是空的')).toBeNull();
    expect(screen.getByText('付款處理中,請勿更新頁面或重複點擊')).toBeDefined();
    expect(overlayOf(container)!.open).toBe(true);
  });

  it('付款中而車翻成 loading ⇒ 不得只給一個沉默的載入態(他的錢正在飛)', async () => {
    // 🔴 這一格是三個裡**最可達的**:它不需要網路掛掉, 只需要一發 resolve 在付款中回來
    //   並且 `#375` 自我修復刪掉任何一行(⇒ lineSignature 變 ⇒ 重解析 ⇒ loading)。
    //   ⚠️ 而那條路我**沒有實走過**(檔頭限制①)—— 本格證的是「若走到了, 畫面會這樣」。
    cartStateRef.current = cart('ready');
    const { container, rerender } = renderCheckout();
    await enterSubmitting(container);

    cartStateRef.current = cart('loading');
    rerender(
      <CheckoutView bankTransferEnabled={false}
        addresses={[ADDR]}
        memberName="王小明"
        memberTier={'general' as MemberTier}
        notificationEmailEnabled={false}
        initialNotificationEmail=""
      />,
    );

    // ── 乙案 ──
    expect(screen.queryByText('載入結帳資料…')).toBeNull();
    expect(screen.getByText('付款處理中,請勿更新頁面或重複點擊')).toBeDefined();
    expect(overlayOf(container)!.open).toBe(true);
  });
});
