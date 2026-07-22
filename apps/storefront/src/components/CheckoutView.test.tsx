// @vitest-environment jsdom
//
// CheckoutView smoke test(M-3-S2-b2-e1 結帳殼;②-④b 接 TapPay 刷卡流程;U1 起兩步)。
//
// 驗:① 載入態 ② 空車 ③ ready:2 步 + Step1 + 配送 + 右側摘要(②-④b 抽 CheckoutSummaryAside、字面不變)
//     ④ 地址選擇 ⑤ 導航 ⑤b 🔴 U3b:未勾同意**仍可按**(design §7.3 用錯誤導引取代 disabled),
//        按下顯示 terms 紅字且零 getPrime/action。🔴 **U4a 起 canGetPrime 不再是按鈕鎖**:
//        付款鈕只看 submitting;卡欄未填妥改由 validateTapPayFields 擋在 getPrime 前並顯示紅字。
//     ⑥ member block ⑦ 🔴 經銷零洩漏 ⑧ 無地址 disabled
//     ②-④b 刷卡接線:⑨ 確認付款 → getPrime → chargePaymentAction 收零價線+prime + paid 終態 + 清車
//     ⑩ 失敗(formError)→ 通用錯誤 + 不清車 ⑪ 🔴 線缺 variantId → client 拒、零 action 呼叫
//     ⑫ getPrime null → 友善錯誤、零 action ⑬ processing → 終態+清車 ⑭ in_flight/wait → 留頁+不清車
//     ⑮ Step 2 渲染 TapPay 卡欄容器(tpfield、零 <input> 收卡資料)
//     🔴 U1:⑱ 步驟列只有兩步 + CTA 字面 + 無第三步入口 ⑲ TapPay active 序列 false→true→false→true
// mock CartContext + cart/actions + charge-actions + useTapPayCard(SDK 不進 jsdom)+ next/navigation。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';
import type { ResolvedCartLine } from '@/app/cart/actions';
import type { CustomerAddress, MemberTier } from '@pcm/domain';
import {
  CARD_NOT_READY_MESSAGE,
  TERMS_REQUIRED_MESSAGE,
} from '@/lib/checkout/validate-checkout-payment';


const {
  cartRef,
  resolveMock,
  pushMock,
  chargeMock,
  getPrimeMock,
  confirmInflightMock,
  setInflightMock,
  tapRef,
  tapActiveRef,
} = vi.hoisted(() => ({
  cartRef: {
    current: {
      items: [] as CartItem[],
      totalQty: 0,
      isHydrated: true,
      cartSessionId: 'cart-sess-default' as string | null,
      addItem: vi.fn(),
      removeItem: vi.fn(),
      updateQty: vi.fn(),
      clear: vi.fn(),
      regenerateCartSession: vi.fn(),
    },
  },
  resolveMock: vi.fn(),
  pushMock: vi.fn(),
  chargeMock: vi.fn(),
  getPrimeMock: vi.fn(),
  confirmInflightMock: vi.fn(() => true),
  setInflightMock: vi.fn(),
  tapRef: {
    // U4a:狀態碼要能被測試設成 1/2/3(空/格式錯/打一半),故不可釘成 `0 as const` 字面型別。
    current: {
      ready: 'ready',
      canGetPrime: true,
      fieldStatus: { number: 0, expiry: 0, ccv: 0 },
    } as {
      ready: 'loading' | 'ready' | 'error';
      canGetPrime: boolean;
      fieldStatus: { number: 0 | 1 | 2 | 3; expiry: 0 | 1 | 2 | 3; ccv: 0 | 1 | 2 | 3 };
    },
  },
  // U1:mock 必須真的接收 active 參數(舊 mock 忽略它 → step 對錯都綠 = 假綠)。
  // 只記「轉換序列」(同值連續 render 不重複記),供斷言 false → true → false → true。
  tapActiveRef: { current: [] as boolean[] },
}));

vi.mock('@/contexts/CartContext', () => ({
  useCart: () => cartRef.current,
}));
vi.mock('@/app/cart/actions', () => ({
  resolveCartLines: resolveMock,
}));
// ②-④b:刷卡 server action(mock 避免 jsdom 載入 server 依賴;真實信任邊界在 charge-actions.test.ts node env 驗)。
vi.mock('@/app/checkout/charge-actions', () => ({
  chargePaymentAction: chargeMock,
}));
// TapPay SDK hook(mock:SDK script/iframe 不進 jsdom;真行為在 useTapPayCard.test.tsx 驗)。
vi.mock('@/hooks/useTapPayCard', () => ({
  TAPPAY_FIELD_IDS: {
    number: 'tappay-card-number',
    expirationDate: 'tappay-card-expiration-date',
    ccv: 'tappay-card-ccv',
  },
  useTapPayCard: (active: boolean) => {
    const seq = tapActiveRef.current;
    if (seq[seq.length - 1] !== active) seq.push(active);
    return { ...tapRef.current, getPrime: getPrimeMock };
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
// 3DS-6b:CheckoutRedirecting 內含 window.location.assign 整頁導向副作用(jsdom 不可導航)→ stub;
//   真導向行為在 CheckoutRedirecting.test.tsx 驗。此處只驗 CheckoutView redirect 態 → 渲染它且帶對 redirectUrl。
vi.mock('@/components/CheckoutRedirecting', () => ({
  CheckoutRedirecting: ({ redirectUrl }: { redirectUrl: string }) => (
    <div data-testid="checkout-redirecting" data-url={redirectUrl}>
      正在前往安全付款頁面
    </div>
  ),
}));

// P3:in-flight 記號邏輯由 inflight-marker.test.ts 專測;此處中性化(confirm 預設不擋、set no-op)避免干擾既有 smoke。
vi.mock('@/lib/payment/inflight-marker', () => ({
  setPaymentInflight: setInflightMock,
  confirmProceedIfInflight: confirmInflightMock,
}));

import { CheckoutView } from './CheckoutView';

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
  chargeMock.mockReset();
  getPrimeMock.mockReset();
  confirmInflightMock.mockReset();
  confirmInflightMock.mockReturnValue(true); // 預設不擋(P3 軟提醒由 inflight-marker.test.ts 專測)
  setInflightMock.mockReset();
  tapRef.current = {
    ready: 'ready',
    canGetPrime: true,
    fieldStatus: { number: 0, expiry: 0, ccv: 0 },
  };
  tapActiveRef.current = [];
});

function setCart(items: CartItem[], opts: { isHydrated?: boolean } = {}) {
  cartRef.current = {
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    isHydrated: opts.isHydrated ?? true,
    cartSessionId: 'cart-sess-default',
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQty: vi.fn(),
    clear: vi.fn(),
    regenerateCartSession: vi.fn(),
  };
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

// 🔴 U3b:id 必須是真 UUID —— CheckoutInput.addressId 是 z.uuid(),U3b 起付款鈕會實際跑這道
//   驗證。舊 fixture 'addr-1' 會被判「請選擇收件地址」而擋下所有付款路徑測試。
//   正式站的 addressId 一律來自 DB(真 UUID),故此為 fixture 貼近現實、非放寬驗證。
const ADDR: CustomerAddress = {
  id: '11111111-1111-4111-8111-111111111111',
  isDefault: true,
  name: '王小明',
  phone: '0912345678',
  line: '新北市新莊區化成路 736 巷 18 號',
} as unknown as CustomerAddress;

function renderCheckout(
  over: {
    addresses?: CustomerAddress[];
    memberTier?: MemberTier;
    notificationEmailEnabled?: boolean;
    initialNotificationEmail?: string;
  } = {},
) {
  return render(
    <CheckoutView
      addresses={over.addresses ?? [ADDR]}
      memberName="王小明"
      memberTier={over.memberTier ?? 'general'}
      notificationEmailEnabled={over.notificationEmailEnabled ?? false}
      initialNotificationEmail={over.initialNotificationEmail ?? ''}
    />,
  );
}

describe('CheckoutView(M-3-S2-b2-e1)', () => {
  it('hydrate 前 → 載入態', () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }], { isHydrated: false });
    renderCheckout();
    expect(screen.getByText('載入結帳資料…')).toBeTruthy();
  });

  it('空車 → 導購物車提示 + 「繼續購物」實際導向 /products', async () => {
    setCart([]);
    renderCheckout();
    expect(await screen.findByText('購物車是空的')).toBeTruthy();
    // 🔴 U4a-0(codex 關卡1 R2 must-fix):空車畫面外移成 CheckoutCartNotice 後,導航是靠
    //   onContinueShopping prop 接回來的。只斷言文案的話,接線斷掉畫面照樣長一樣、DOM 比對也全綠
    //   → 必須真的點下去驗 router.push。
    fireEvent.click(screen.getByRole('button', { name: '繼續購物' }));
    expect(pushMock).toHaveBeenCalledWith('/products');
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('ready:2 步指示器 + Step1 地址 + 配送 + 右側摘要', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 2 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    const { container } = renderCheckout();
    expect(await screen.findByText('貨運宅配')).toBeTruthy();
    // 步指示器 2 步(U1)
    expect(screen.getByText('發票與付款')).toBeTruthy();
    // Step1 地址(王小明 同時為 member 名 → 用 .co-addr-name scoped 查避撞)
    expect(container.querySelector('.co-addr-name')?.textContent).toBe('王小明');
    expect(container.querySelector('.co-addr-phone')?.textContent).toBe('0912345678');
    expect(screen.getByText('DEFAULT')).toBeTruthy();
    // 配送方式宅配
    expect(screen.getByText('貨運宅配')).toBeTruthy();
    // 右側摘要:小計 15200×2=30,400、應付總額(>=5000 免運)
    expect(container.querySelector('.co-grand-val')?.textContent).toBe('NT$ 30,400');
    expect(screen.getByText('ORDER SUMMARY')).toBeTruthy();
  });

  it('Email flag off：欄位不出現，維持既有結帳畫面', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    renderCheckout();
    await screen.findByText('貨運宅配');
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('Email flag on：無效值留在 Step1 顯示欄位錯誤；有效值 canonical 後才前進', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    renderCheckout({ notificationEmailEnabled: true, initialNotificationEmail: '' });
    await screen.findByText('貨運宅配');

    const input = screen.getByLabelText('Email') as HTMLInputElement;
    const scrollIntoView = vi.fn();
    Object.defineProperty(input, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    fireEvent.change(input, { target: { value: 'invalid-email' } });
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    expect(screen.getByText('Email 格式不正確')).toBeTruthy();
    expect(screen.queryAllByText('發票資訊').length).toBe(0); // 擋在 Step1、未進 Step2
    expect(document.activeElement).toBe(input);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

    fireEvent.change(input, { target: { value: ' User.Name@EXAMPLE.COM ' } });
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    expect(screen.getAllByText('發票資訊').length).toBeGreaterThan(0); // canonical 後才前進 Step2
  });

  it('地址選擇 radio → is-on', async () => {
    const addr2 = { ...ADDR, id: '22222222-2222-4222-8222-222222222222', isDefault: false, name: '李大華' } as unknown as CustomerAddress;
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    const { container } = renderCheckout({ addresses: [ADDR, addr2] });
    await screen.findByText('貨運宅配');
    const labels = container.querySelectorAll('.co-addr');
    // 預設選 isDefault(addr-1)
    expect(labels[0]?.className).toContain('is-on');
    // 點第二個地址
    fireEvent.click(labels[1]!.querySelector('input[type="radio"]')!);
    expect(container.querySelectorAll('.co-addr')[1]?.className).toContain('is-on');
  });

  it('導航:step1→step2(發票/付款/複查/條款同頁)→上一步、返回購物車→/cart', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    renderCheckout();
    await screen.findByText('貨運宅配');

    // → step2:收件摘要 + 發票 + 付款 + 商品 + 條款(U2b 起單一元件、不再有第三步)
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    // 🔴 U2b:重複的發票 readonly 複查節點已刪除 → 同字面節點由 2 個回到 1 個。
    //    這條就是「重複區塊已消滅」的機械證據,不得為了讓它綠而繞過。
    expect(screen.getAllByText('發票資訊').length).toBe(1);
    expect(screen.getByText('信用卡付款')).toBeTruthy();
    expect(screen.getByText(/我已閱讀並同意/)).toBeTruthy();
    expect(screen.getByText(/商品清單/)).toBeTruthy();
    // 🔴 第三步入口已消滅
    expect(screen.queryByRole('button', { name: /下一步:確認訂單/ })).toBeNull();
    // 🔴 死鈕回歸守門:付款 / 發票不再有複查編輯鈕,「編輯」只剩收件 + 商品兩顆。
    expect(screen.getAllByRole('button', { name: '編輯' }).length).toBe(2);
    // 🔴 U3b:未勾同意**不再** disabled(design §7.3「未填完整時仍可按,用來觸發清楚的錯誤導引」)。
    //   舊斷言(every disabled === true)已被本片推翻,改為斷言「可按」;
    //   「按下去會發生什麼」由下方 U3b describe 專測。
    const payButtons = screen.getAllByRole('button', { name: /確認付款/ }) as HTMLButtonElement[];
    expect(payButtons.length).toBeGreaterThanOrEqual(1);
    expect(payButtons.every((b) => b.disabled)).toBe(false);

    // 上一步 → 直接回 step1(兩步之間唯一往返)
    fireEvent.click(screen.getByRole('button', { name: /上一步/ }));
    expect(screen.getByText('貨運宅配')).toBeTruthy();
    expect(screen.queryAllByText('發票資訊').length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /返回購物車/ }));
    expect(pushMock).toHaveBeenCalledWith('/cart');
  });

  it('🔴 ⑱ U1 步驟列只有兩步、CTA 字面「下一步:發票與付款」、無第三步入口', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    const { container } = renderCheckout();
    await screen.findByText('貨運宅配');

    const steps = container.querySelectorAll('.co-step');
    expect(steps.length).toBe(2);
    expect(Array.from(steps).map((s) => s.querySelector('.co-step-label')?.textContent)).toEqual([
      '收件資料',
      '發票與付款',
    ]);
    expect(screen.getByRole('button', { name: /下一步:發票與付款/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /下一步:確認訂單/ })).toBeNull();

    // 進 step2 後步驟列仍只有兩步、第一步可回點
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    expect(container.querySelectorAll('.co-step').length).toBe(2);
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.co-step')[0]!);
    expect(screen.getByText('貨運宅配')).toBeTruthy();
  });

  it('🔴 ⑲ TapPay active 只在 step 2:序列 false → true → false → true(mock 真收 active、防假綠)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await screen.findByText('貨運宅配');
    expect(tapActiveRef.current).toEqual([false]); // step1:不 setup
    expect(container.querySelector('#tappay-card-number')).toBeNull(); // 卡欄容器不在第一步

    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    expect(tapActiveRef.current).toEqual([false, true]); // step2:啟用

    fireEvent.click(screen.getByRole('button', { name: /上一步/ }));
    expect(tapActiveRef.current).toEqual([false, true, false]); // 回 step1:cleanup

    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    expect(tapActiveRef.current).toEqual([false, true, false, true]); // 重入 step2:重 setup
  });

  // 🔴 U3b 改寫 + U4a 再修正:`!agreed`(U3b)與 `!tappay.canGetPrime`(U4a)都已從 payDisabled 移除。
  //   本測試現在只守一件事:**勾不勾同意都不影響 enabled**(付款鈕不再是 consent 的鎖)。
  //   ⚠️ 它**不**證明「canGetPrime 那道鎖存在或不存在」—— 那由 ⑤c 獨立守(codex 關卡2 nit)。
  it('step2 未勾/已勾同意 → 確認付款皆 enabled(consent 不再鎖按鈕;U3b→U4a)', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    const { container } = renderCheckout();
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));

    const payButtons = () => screen.getAllByRole('button', { name: /確認付款/ }) as HTMLButtonElement[];
    expect(payButtons().every((b) => b.disabled)).toBe(false); // 未勾同意也 enabled
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    expect(payButtons().every((b) => b.disabled)).toBe(false); // 勾了仍 enabled
  });

  it('member block:名 + TierBadge + general 升級連結', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    const { container } = renderCheckout({ memberTier: 'general' });
    await screen.findByText('貨運宅配');
    expect(container.querySelector('.co-member-name')?.textContent).toBe('王小明');
    expect(container.querySelector('.tier-badge')).toBeTruthy();
    expect(screen.getByText(/升級店家會員/)).toBeTruthy();
  });

  it('🔴 經銷零洩漏:general-only、無「經銷」/ price_store / 劃線價', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 2 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    const { container } = renderCheckout({ memberTier: 'store' });
    await screen.findByText('貨運宅配');
    expect(container.textContent).not.toContain('經銷');
    expect(container.textContent).not.toContain('price_store');
    expect(container.textContent).not.toContain('priceByTier');
    expect(container.querySelector('s')).toBeNull();
  });

  it('無地址 → 下一步 disabled', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    renderCheckout({ addresses: [] });
    await screen.findByText('貨運宅配');
    const next = screen.getByRole('button', { name: /下一步:發票與付款/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  // ===== ②-④b:刷卡接線(getPrime → chargePaymentAction → 六態)=====
  async function gotoStep2Agreed(container: HTMLElement) {
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
  }

  it('⑮ Step 2 渲染 TapPay 卡欄容器(tpfield 三欄、零 <input> 收卡資料)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    expect(container.querySelector('#tappay-card-number.tpfield')).toBeTruthy();
    expect(container.querySelector('#tappay-card-expiration-date.tpfield')).toBeTruthy();
    expect(container.querySelector('#tappay-card-ccv.tpfield')).toBeTruthy();
    // 🔴 卡資料零進我方 input:tpfield 容器內無 input 元素(iframe 由 SDK 注入、jsdom mock 下為空)
    expect(container.querySelectorAll('.tpfield input').length).toBe(0);
    expect(screen.getByText(/TapPay 安全欄位加密處理/)).toBeTruthy();
    // 🔴 U2b 落點守門(codex 關卡1 must-fix):卡欄必須在付款方式選項 body 內,
    //    且三個容器全站各恰 1 個 —— 放錯層或重複渲染(= 多個真卡表面)都會當場轉紅。
    expect(container.querySelector('.co-pay-body > .co-card-form')).toBeTruthy();
    for (const id of ['tappay-card-number', 'tappay-card-expiration-date', 'tappay-card-ccv']) {
      expect(container.querySelectorAll(`#${id}`).length).toBe(1);
    }
  });

  it('🔴 U2b 編輯鈕接線:收件那顆回 Step 1(不呼 router)、商品那顆進 /cart', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));

    // 第 1 顆 = 收件:必須回到 Step 1,且不得呼叫 router.push
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[0]!);
    expect(screen.getByRole('button', { name: /下一步:發票與付款/ })).toBeTruthy();
    expect(screen.queryAllByText('發票資訊').length).toBe(0);
    expect(pushMock).not.toHaveBeenCalled(); // 誤接成 onEditItems 會在此轉紅

    // 回到 Step 2,第 2 顆 = 商品:必須進 /cart 且留在 Step 2
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[1]!);
    expect(pushMock).toHaveBeenCalledWith('/cart');
    expect(container.querySelector('.co-pay-body > .co-card-form')).toBeTruthy(); // 仍在 Step 2
  });

  // 🔴 U4a 語意反轉:`!tappay.canGetPrime` 已從 payDisabled 移除(design §7.3 未填完整仍可按)。
  //   舊語意「canGetPrime=false → 按鈕 disabled」不再成立;改守「按得下去、但擋在 getPrime 之前
  //   且一定有訊息」——沒有訊息的話,客人會遇到「按了完全沒反應」的死路。
  it('🔴 ⑤c canGetPrime=false → 雙鈕 enabled;按下去被擋、零 getPrime/action,且顯示原因(U4a)', async () => {
    tapRef.current = { ...tapRef.current, canGetPrime: false };
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    const payButtons = screen.getAllByRole('button', { name: /確認付款/ }) as HTMLButtonElement[];
    expect(payButtons.every((b) => b.disabled)).toBe(false); // 不再是死鎖

    fireEvent.click(payButtons[0]!);
    expect(confirmInflightMock).not.toHaveBeenCalled();
    expect(getPrimeMock).not.toHaveBeenCalled();
    expect(chargeMock).not.toHaveBeenCalled();
    // 三欄看似填妥卻不可取 prime = 矛盾態,必須有話講(否則按了沒反應)
    expect(screen.getAllByText(CARD_NOT_READY_MESSAGE).length).toBeGreaterThan(0);
  });

  // 🔴 canGetPrime 釘 **true** 以隔離變因(codex 關卡2 must-fix、同款假綠第 3 次):
  //   若同時設 false,View 就算被改成「只看 canGetPrime、完全忽略 fieldStatus」也照樣全綠。
  //   `canGetPrime=false` 那道鎖由下方 ⑤c 獨立守。
  it('🔴 U4a 卡片三欄未填 → 按下付款:三欄紅字 + 零 getPrime/action,且付款區只有一個 alert', async () => {
    tapRef.current = {
      ready: 'ready',
      canGetPrime: true,
      fieldStatus: { number: 1, expiry: 3, ccv: 2 },
    };
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(screen.getByText('請輸入完整卡號')).toBeTruthy();       // status 1
    expect(screen.getByText('請輸入完整有效期')).toBeTruthy();     // status 3(打一半,Q2=B 與空白同語)
    expect(screen.getByText('安全碼不正確,請重新確認')).toBeTruthy(); // status 2
    expect(getPrimeMock).not.toHaveBeenCalled();
    expect(chargeMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert')).toHaveLength(1); // design §7.2 唯一 assertive 出口
  });

  it('🔴 U4a 卡片 + 條款 + 發票錯誤**一次全顯示**,摘要數量 = 畫面實際紅字數(design §7.2)', async () => {
    tapRef.current = { ready: 'ready', canGetPrime: false, fieldStatus: { number: 1, expiry: 0, ccv: 0 } };
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    // 讓地址自帶一張「缺抬頭、統編合法」的公司發票 → 只留 invoice.title 一個錯(統編填合法值)
    const addrCompany = {
      ...ADDR,
      invoice: { type: 'company', carrier: '', title: '', taxId: '12345675', donateCode: '' },
    } as unknown as CustomerAddress;
    const { container } = renderCheckout({ addresses: [addrCompany] });
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    // 不勾同意 → terms 也錯
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(screen.getByText('請輸入完整卡號')).toBeTruthy();
    expect(screen.getByText('請填寫公司抬頭')).toBeTruthy();
    expect(screen.getByText(TERMS_REQUIRED_MESSAGE)).toBeTruthy();

    // 🔴 綁死「顯示端」與「摘要端」:摘要說 N 個,畫面上就必須真的有 N 條紅字。
    //   兩邊各自 spread 合併,少算/漏傳其中一半都會在這裡爆。
    const redTexts = container.querySelectorAll('.auth-field-err, .co-card-error');
    const alertText = screen.getByRole('alert').textContent ?? '';
    const n = Number(/還有 (\d+) 個項目/.exec(alertText)?.[1]);
    expect(n).toBe(redTexts.length);
    expect(n).toBe(3);
  });

  it('🔴 U4a 逐欄自清:卡號 2→0 後(不重按)只有 card.number 紅字消失,其餘保留', async () => {
    tapRef.current = { ready: 'ready', canGetPrime: false, fieldStatus: { number: 2, expiry: 1, ccv: 0 } };
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
    expect(screen.getByText('卡號不正確,請重新確認')).toBeTruthy();
    expect(screen.getByText('請輸入完整有效期')).toBeTruthy();
    expect(screen.getByText(TERMS_REQUIRED_MESSAGE)).toBeTruthy();

    // 客人把卡號改對(SDK 回報 status 0)→ 只有這一欄的紅字該消失,不需要重按付款。
    tapRef.current = { ...tapRef.current, fieldStatus: { number: 0, expiry: 1, ccv: 0 } };
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement); // 觸發一次 rerender
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    expect(screen.queryByText('卡號不正確,請重新確認')).toBeNull();
    expect(screen.getByText('請輸入完整有效期')).toBeTruthy(); // 其他卡片欄保留
  });

  it('🔴 U4a 送出失敗 → 回上一步 → 重入第二步:卡片紅字全消失,發票/條款紅字仍在', async () => {
    tapRef.current = { ready: 'ready', canGetPrime: false, fieldStatus: { number: 1, expiry: 1, ccv: 1 } };
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
    expect(screen.getByText('請輸入完整卡號')).toBeTruthy();
    expect(screen.getByText(TERMS_REQUIRED_MESSAGE)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /上一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));

    // 卡片錯誤衍生自「已隨 iframe 銷毀」的 SDK 狀態 → 重入後不得殘留(客人還沒重按付款)
    expect(screen.queryByText('請輸入完整卡號')).toBeNull();
    expect(screen.queryByText('請輸入完整有效期')).toBeNull();
    // 非卡片錯誤的值還在 React state、錯誤依然成立 → 刻意保留
    expect(screen.getByText(TERMS_REQUIRED_MESSAGE)).toBeTruthy();
  });

  it('🔴 ⑨ 確認付款 → getPrime → chargePaymentAction 收零價線 + prime + paid 終態 + 清車', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 2 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0007' });
    const { container } = renderCheckout({
      notificationEmailEnabled: true,
      initialNotificationEmail: 'Member@example.com',
    });
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(await screen.findByText('訂單已成立')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0007')).toBeTruthy();
    expect(chargeMock).toHaveBeenCalledOnce();
    const payload = chargeMock.mock.calls[0]![0] as {
      lines: Array<Record<string, unknown>>;
      addressId: string;
      shippingMethod: string;
      prime: string;
      notificationEmail?: string;
    };
    expect(payload.lines).toEqual([{ variantId: 'v1', quantity: 2 }]); // 零價
    expect(payload.lines[0]).not.toHaveProperty('unitPrice');
    expect(payload.prime).toBe('prime_test');
    expect(payload.shippingMethod).toBe('home');
    expect(payload.addressId).toBe(ADDR.id);
    expect(payload.notificationEmail).toBe('Member@example.com');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('cardholder'); // 🔴 client 零送 cardholder
    expect(payload).not.toHaveProperty('amount'); // 🔴 client 零送價
    expect(cartRef.current.clear).toHaveBeenCalledOnce(); // paid 才清車
  });

  // 🔴 U4a-0(code-reviewer must-fix):本片把終態 render 外移,而「終態必須優先於 loading/empty」
  //   是 CheckoutView 裡最高風險的一條不變量(註解自己寫了「clear() 後 cart 轉 empty 不可蓋掉終態」),
  //   卻**從來沒有測試守過** —— 因為既有測試的 `clear` 是 no-op `vi.fn()`,cartRef.items 永遠不會變空,
  //   `useResolvedCart` 的 status 因此恆為 'ready',四條終態測試全程走不到 empty 分支。
  //   後果:若有人把終態判斷挪到 loading/empty 之後(U4a/U4b 往這段插行時極易發生),
  //   剛刷完卡的客人會看到「購物車是空的」而不是「訂單已成立」+ 單號 → 直接誘導重複付款,
  //   而既有 40 條 + 本片 10 條新測試**照樣全綠**。這條補上以殺死該假綠。
  it('🔴 終態優先於空車:paid 後 clear() 真的清空購物車 → 仍顯示訂單已成立 + 單號,不得掉回「購物車是空的」', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0009' });
    // 與既有測試的差別:讓 clear() 真的把品項清掉(模擬正式環境 CartContext 的行為)。
    cartRef.current.clear = vi.fn(() => {
      cartRef.current.items = [];
      cartRef.current.totalQty = 0;
    });

    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
    expect(await screen.findByText('訂單已成立')).toBeTruthy();
    expect(cartRef.current.items).toHaveLength(0); // 前置成立:購物車此刻真的是空的

    // 🔴 上面 findByText 的那次 render 就已經是「cart 已空」狀態下重新評估的結果
    //   (clear() 在 charge.submit 內、早於 paid 的 setState)→ 終態必須贏過 empty。
    //   ⚠️ 不要在這裡補 fireEvent.click(container) 假裝「再觸發一次 render」:那不會觸發 React rerender
    //   (無 handler、無 state 變更),寫了只是讓後人誤解測試機制(codex 關卡2 nit)。
    expect(screen.getByText('訂單已成立')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0009')).toBeTruthy();
    expect(screen.queryByText('購物車是空的')).toBeNull();
    expect(screen.queryByText('載入結帳資料…')).toBeNull();
  });

  it('🔴 P3 in-flight 軟提醒取消(confirm false)→ 連 getPrime 都不進、零 chargePaymentAction(不送出)', async () => {
    confirmInflightMock.mockReturnValue(false); // 客人在「你有一筆付款進行中」確認框點取消
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    getPrimeMock.mockResolvedValue('prime_test');
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
    expect(confirmInflightMock).toHaveBeenCalled();
    expect(getPrimeMock).not.toHaveBeenCalled(); // handleSubmit 軟提醒在 getPrime 前 return
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it('🔴 ⑯ 同輪快速雙擊 → getPrime 只進一次(primeBusyRef 同步鎖;codex 關卡2 r1)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0008' });
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    const payBtn = screen.getAllByRole('button', { name: /確認付款/ })[0]!;
    // 原生連點包同一 act(fireEvent 各自包 act 會先 flush primeBusy → 第二擊打在 disabled 鈕、
    // 測不到 ref;單 act 內兩擊 = re-render 前、state 版擋不住、唯 primeBusyRef 同步擋)。
    act(() => {
      payBtn.click();
      payBtn.click();
    });
    expect(await screen.findByText('訂單已成立')).toBeTruthy();
    expect(getPrimeMock).toHaveBeenCalledTimes(1);
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it('⑩ 付款失敗(formError)→ 通用錯誤 + 不清車 + 不顯終態', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({ formError: '付款失敗,請稍後再試或聯繫客服 LINE' });
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(await screen.findByText('付款失敗,請稍後再試或聯繫客服 LINE')).toBeTruthy();
    expect(cartRef.current.clear).not.toHaveBeenCalled();
    expect(screen.queryByText('訂單已成立')).toBeNull();
  });

  it('🔴 ⑪ 線缺 variantId → client 拒整單、零 getPrime 後 action 呼叫 + 不清車', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]); // 無 variantId
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    getPrimeMock.mockResolvedValue('prime_test');
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(await screen.findByText(/缺少規格資訊/)).toBeTruthy();
    expect(chargeMock).not.toHaveBeenCalled();
    expect(cartRef.current.clear).not.toHaveBeenCalled();
  });

  it('⑫ getPrime 失敗(null)→ 友善錯誤、零 action 呼叫、可重試', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    getPrimeMock.mockResolvedValue(null);
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(await screen.findByText(/卡片資訊驗證失敗/)).toBeTruthy();
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it('⑬ processing(orphan/unknown)→ 付款處理中終態 + 單號 + 清車(勿重複付款)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({
      ok: false,
      payment: 'processing',
      displayId: 'PCM-2026-0008',
      message: '付款已收或處理中,請勿重複付款,客服 LINE 將協助確認',
    });
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(await screen.findByText('付款處理中')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0008')).toBeTruthy();
    expect(screen.getByText(/請勿重複付款/)).toBeTruthy();
    expect(cartRef.current.clear).toHaveBeenCalledOnce();
  });

  it('🔴 3DS-6b redirect(flag on 3DS 啟動成功)→ 渲染 CheckoutRedirecting(帶 redirectUrl)、無 step UI、不清車', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    getPrimeMock.mockResolvedValue('prime_test');
    const PAY = 'https://sandbox.tappaysdk.com/tpc/3ds/pay?token=abc123';
    chargeMock.mockResolvedValue({ redirect: true, redirectUrl: PAY });
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    const node = await screen.findByTestId('checkout-redirecting');
    expect(node.getAttribute('data-url')).toBe(PAY); // CheckoutView 把 redirectUrl 原樣交付
    expect(screen.queryByRole('button', { name: /確認付款/ })).toBeNull(); // 導向中畫面取代表單
    expect(cartRef.current.clear).not.toHaveBeenCalled(); // 🔴 redirect 不清車(callback 成功頁才清)
  });

  it('🔴 ⑰ action throw(回應遺失)→ unknown 終態畫面:勿重複付款 + 清車 + 無單號(審查側 BLOCKER)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockRejectedValue(new Error('network'));
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(await screen.findByText('付款狀態確認中')).toBeTruthy();
    expect(screen.getByText('付款狀態未知,請勿重複付款,客服 LINE 將協助確認')).toBeTruthy();
    expect(screen.queryByText('N°ORDER')).toBeNull(); // 無單號(回應遺失、client 不知 displayId)
    expect(screen.queryByRole('button', { name: /確認付款/ })).toBeNull(); // 終態畫面取代表單
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1); // 清車防殘留誘導重刷
  });

  it('⑭ in_flight / charge_failed_wait → 留頁訊息 + 不清車、不顯終態', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({
      ok: false,
      payment: 'in_flight',
      message: '您有一筆付款正在處理中,請稍候再試',
    });
    const { container } = renderCheckout();
    await gotoStep2Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
    expect(await screen.findByText(/正在處理中,請稍候再試/)).toBeTruthy();
    expect(cartRef.current.clear).not.toHaveBeenCalled();
    expect(screen.queryByText('付款處理中')).toBeNull(); // 留頁、非終態

    cleanup();
    chargeMock.mockResolvedValue({
      ok: false,
      payment: 'charge_failed_wait',
      displayId: 'PCM-2026-0009',
      message: '付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試',
    });
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    const { container: c2 } = renderCheckout();
    await gotoStep2Agreed(c2);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
    expect(await screen.findByText(/未扣款;系統忙碌中/)).toBeTruthy();
    expect(cartRef.current.clear).not.toHaveBeenCalled();
  });
});

// ===== U3b:非卡片全錯誤 state 與 ARIA =====
describe('CheckoutView 非卡片錯誤(U3b)', () => {
  /** 進 step2、不勾同意(U3b 起不影響按鈕可用性)。 */
  async function gotoStep2(container: HTMLElement) {
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:發票與付款/ }));
    return container;
  }
  const pay = () => screen.getAllByRole('button', { name: /確認付款/ })[0]!;
  const setupCart = () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
  };

  it('🔴 未勾同意按下付款 → 顯示 terms 紅字,且 confirm/getPrime/action 呼叫次數皆為 0', async () => {
    setupCart();
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(pay());

    expect(screen.getByText('請先閱讀並同意服務條款與隱私政策')).toBeTruthy();
    // 🔴 validation 有錯 → 絕不進入付款鏈的任何一環
    expect(confirmInflightMock).toHaveBeenCalledTimes(0);
    expect(getPrimeMock).toHaveBeenCalledTimes(0);
    expect(chargeMock).toHaveBeenCalledTimes(0);
  });

  it('🔴 全合法 → 仍沿原路徑,且呼叫「順序」為 confirm → getPrime → action(既有付款鏈未被切斷)', async () => {
    setupCart();
    const order: string[] = [];
    confirmInflightMock.mockImplementation(() => {
      order.push('confirm');
      return true;
    });
    getPrimeMock.mockImplementation(async () => {
      order.push('getPrime');
      return 'prime-ok';
    });
    chargeMock.mockImplementation(async () => {
      order.push('action');
      return { ok: true, displayId: 'PCM-2026-0001' };
    });
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(order).toEqual(['confirm', 'getPrime', 'action']);
  });

  it('🔴 跨類錯誤存活:只修發票抬頭 → title 紅字消失,terms 紅字與 ARIA 仍在(殺「全清」mutant)', async () => {
    setupCart();
    const { container } = renderCheckout();
    await gotoStep2(container);
    // 切公司發票 → 未填抬頭/統編,且未勾同意 → 一次產生三個 key
    fireEvent.click(screen.getByRole('button', { name: '公司發票(三聯式)' }));
    fireEvent.click(pay());
    expect(screen.getByText('請填寫公司抬頭')).toBeTruthy();
    expect(screen.getByText('統編需 8 碼數字')).toBeTruthy();
    expect(screen.getByText('請先閱讀並同意服務條款與隱私政策')).toBeTruthy();

    // 只修抬頭 → 只有它該消失
    fireEvent.change(container.querySelector('#checkout-invoice-title') as HTMLInputElement, {
      target: { value: '賓士機車有限公司' },
    });
    expect(screen.queryByText('請填寫公司抬頭')).toBeNull();
    expect(screen.getByText('統編需 8 碼數字')).toBeTruthy();
    expect(screen.getByText('請先閱讀並同意服務條款與隱私政策')).toBeTruthy();
    expect((container.querySelector('#checkout-agree') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');

    // 再勾同意 → terms 消失,統編錯誤仍在
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    expect(screen.queryByText('請先閱讀並同意服務條款與隱私政策')).toBeNull();
    expect(screen.getByText('統編需 8 碼數字')).toBeTruthy();
  });

  it('🔴 切換發票類型 → 隱藏欄位的錯誤從 state/DOM/ARIA 全消失,且不阻擋付款', async () => {
    setupCart();
    getPrimeMock.mockResolvedValue('prime-ok');
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0002' });
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(screen.getByRole('button', { name: '公司發票(三聯式)' }));
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    fireEvent.click(pay());
    expect(screen.getByText('請填寫公司抬頭')).toBeTruthy();

    // 切回個人發票 → 公司欄位錯誤必須完全消失(不只視覺隱藏)
    fireEvent.click(screen.getByRole('button', { name: '個人發票' }));
    expect(screen.queryByText('請填寫公司抬頭')).toBeNull();
    expect(screen.queryByText('統編需 8 碼數字')).toBeNull(); // 切類型 → 三個 invoice key 全清
    expect(container.querySelector('#checkout-invoice-title-error')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull(); // 摘要也一併消失

    // 且不再阻擋付款
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it('捐贈發票缺愛心碼 → 紅字;填入後消失', async () => {
    setupCart();
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(screen.getByRole('button', { name: '捐贈發票' }));
    fireEvent.click(pay());
    expect(screen.getByText('請填愛心碼')).toBeTruthy();
    fireEvent.change(container.querySelector('#checkout-invoice-donate-code') as HTMLInputElement, {
      target: { value: '8585' },
    });
    expect(screen.queryByText('請填愛心碼')).toBeNull();
  });

  it('🔴 付款區只有一個 role=alert(摘要),逐欄紅字不得各自成為 alert', async () => {
    setupCart();
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(screen.getByRole('button', { name: '公司發票(三聯式)' }));
    fireEvent.click(pay());
    // 🔴 誠實邊界:此斷言只在 TapPay ready==='ready' 的一般可達路徑成立;
    //   ready==='error' 時 TapPayCardFields 自帶一個 alert(既有債,U4a 收斂)。
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe('還有 3 個項目需要確認,已在上方標示');
    expect(container.querySelectorAll('.auth-field-err[role="alert"]')).toHaveLength(0);
  });

  it('🔴 殭屍訊息:付款失敗後改壞欄位再按 → 摘要取代舊訊息;修完欄位後舊訊息不得復活', async () => {
    setupCart();
    getPrimeMock.mockResolvedValue('prime-ok');
    chargeMock.mockResolvedValue({ formError: '付款失敗,請稍後再試' });
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.getByText('付款失敗,請稍後再試')).toBeTruthy();

    // 取消同意 → 再按 → 驗證擋下,摘要取代舊訊息
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    fireEvent.click(pay());
    expect(screen.queryByText('付款失敗,請稍後再試')).toBeNull();
    expect(screen.getByText('還有 1 個項目需要確認,已在上方標示')).toBeTruthy();

    // 修完欄位 → 摘要消失,但舊付款訊息**不得**幽靈重現
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    expect(screen.queryByText('還有 1 個項目需要確認,已在上方標示')).toBeNull();
    expect(screen.queryByText('付款失敗,請稍後再試')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('🔴 confirm 取消 → 舊付款訊息仍不得復活,且 getPrime/action 為 0', async () => {
    setupCart();
    getPrimeMock.mockResolvedValue('prime-ok');
    chargeMock.mockResolvedValue({ formError: '付款失敗,請稍後再試' });
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.getByText('付款失敗,請稍後再試')).toBeTruthy();

    // 驗證擋下一次(淘汰舊訊息)
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    fireEvent.click(pay());
    // 修好 → 再按,但這次使用者在「另一筆付款進行中」提醒按了取消
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    getPrimeMock.mockClear();
    chargeMock.mockClear();
    confirmInflightMock.mockReturnValue(false);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(getPrimeMock).toHaveBeenCalledTimes(0);
    expect(chargeMock).toHaveBeenCalledTimes(0);
    expect(screen.queryByText('付款失敗,請稍後再試')).toBeNull(); // 🔴 取消不得讓舊訊息復活
  });

  it('🔴 getPrime 待決期間,舊付款訊息不得現身(stale 解除不可早於送出前一刻)', async () => {
    setupCart();
    chargeMock.mockResolvedValue({ formError: '付款失敗,請稍後再試' });
    getPrimeMock.mockResolvedValue('prime-ok');
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.getByText('付款失敗,請稍後再試')).toBeTruthy();

    // 驗證擋下(淘汰舊訊息)→ 修好 → 再按,但 getPrime 卡住不 resolve
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    fireEvent.click(pay());
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    let releasePrime: (v: string) => void = () => {};
    getPrimeMock.mockImplementation(() => new Promise<string>((res) => { releasePrime = res; }));
    await act(async () => {
      fireEvent.click(pay());
    });
    // 🔴 取 prime 期間(真實最長可達 ~15 秒):舊 charge 訊息絕不可重新現身
    expect(screen.queryByText('付款失敗,請稍後再試')).toBeNull();
    await act(async () => {
      releasePrime('prime-ok');
    });
  });

  it('🔴 直接合法重試:取 prime 期間舊「付款失敗」必須立刻消失(不必先觸發 validation error)', async () => {
    // codex 關卡2 抓到的缺口:原本只在 validation 失敗那條路徑淘汰舊訊息,
    // 但客人最常見的動作是「什麼都沒改、直接再按一次」→ getPrime 可等 ~15 秒,舊訊息會一直掛著。
    setupCart();
    getPrimeMock.mockResolvedValue('prime-ok');
    chargeMock.mockResolvedValue({ formError: '付款失敗,請稍後再試' });
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.getByText('付款失敗,請稍後再試')).toBeTruthy();

    // 什麼都不改,直接再按一次;讓 getPrime 卡住不 resolve
    let releasePrime: (v: string) => void = () => {};
    getPrimeMock.mockImplementation(() => new Promise<string>((res) => { releasePrime = res; }));
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.queryByText('付款失敗,請稍後再試')).toBeNull();
    await act(async () => {
      releasePrime('prime-ok');
    });
  });

  it('🔴 淘汰後新的付款錯誤必須能重新顯示(殺「刪掉 resumeChargeMessage 仍全綠」的假綠)', async () => {
    setupCart();
    getPrimeMock.mockResolvedValue('prime-ok');
    chargeMock.mockResolvedValue({ formError: '付款失敗,請稍後再試' });
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    // 第二次送出:stale 已被第一次的 submit 設過 → 若 resume 被刪,新訊息會被永久吞掉
    chargeMock.mockResolvedValue({ formError: '卡片遭拒,請換一張卡' });
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.getByText('卡片遭拒,請換一張卡')).toBeTruthy();
  });

  it('🔴 in_flight 警語不得被 validation 擋下的 submit 淘汰(它描述的是當下仍成立的事實)', async () => {
    setupCart();
    getPrimeMock.mockResolvedValue('prime-ok');
    chargeMock.mockResolvedValue({ payment: 'in_flight', message: '另一筆付款進行中,請稍候再試' });
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.getByText('另一筆付款進行中,請稍候再試')).toBeTruthy();

    // 取消同意 → 再按(validation 擋下)→ 修好 → in_flight 警語必須還在
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    fireEvent.click(pay());
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    expect(screen.getByText('另一筆付款進行中,請稍候再試')).toBeTruthy();
  });

  it('🔴 getPrime 直接 throw → 仍顯示友善卡片錯誤(不得整個 handler 靜默結束、畫面全無提示)', async () => {
    setupCart();
    getPrimeMock.mockRejectedValue(new Error('SDK boom'));
    const { container } = renderCheckout();
    await gotoStep2(container);
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
    await act(async () => {
      fireEvent.click(pay());
    });
    expect(screen.getByText(/卡片資訊驗證失敗/)).toBeTruthy();
    expect(chargeMock).toHaveBeenCalledTimes(0);
  });

  it('🔴 地址物件參照變動但發票值沒變 → 既有發票錯誤不得被誤清(必須真的跑進 auto-fill effect)', async () => {
    setupCart();
    // 🔴 關鍵:錯誤必須在 `invoiceOverride === false` 下產生,否則 effect 會 early return、
    //   這條測試就變成什麼都沒驗的假綠(codex 關卡1 R2-5 明確點名)。
    //   → 讓**地址本身**帶一張欄位不齊的公司發票,使用者完全不碰發票分頁。
    const addrWithCompanyInvoice = {
      ...ADDR,
      invoice: { type: 'company', carrier: '', title: '', taxId: '', donateCode: '' },
    } as unknown as CustomerAddress;
    const props = {
      memberName: '王小明',
      memberTier: 'general' as MemberTier,
      notificationEmailEnabled: false,
      initialNotificationEmail: '',
    };
    const { container, rerender } = render(
      <CheckoutView addresses={[addrWithCompanyInvoice]} {...props} />,
    );
    await gotoStep2(container);
    // 自動帶入的公司發票缺抬頭/統編 → 未碰發票分頁,invoiceOverride 仍為 false
    expect(container.querySelector('.co-inv-hint')).not.toBeNull(); // 「已從收件地址自動帶入」= 未 override
    fireEvent.click(pay());
    expect(screen.getByText('請填寫公司抬頭')).toBeTruthy();
    expect(screen.getByText('統編需 8 碼數字')).toBeTruthy();

    // server props 重送:內容相同、物件參照不同 → effect 重跑(invoiceOverride 仍 false)
    rerender(
      <CheckoutView addresses={[{ ...addrWithCompanyInvoice }]} {...props} />,
    );
    // 🔴 值沒變 → 錯誤必須原封不動(若 effect 改成「一律清三個」,這兩行會轉紅)
    expect(screen.getByText('請填寫公司抬頭')).toBeTruthy();
    expect(screen.getByText('統編需 8 碼數字')).toBeTruthy();
  });
});
