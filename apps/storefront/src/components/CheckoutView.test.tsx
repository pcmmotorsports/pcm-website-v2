// @vitest-environment jsdom
//
// CheckoutView smoke test(M-3-S2-b2-e1 結帳殼;②-④b 接 TapPay 刷卡流程)。
//
// 驗:① 載入態 ② 空車 ③ ready:3 步 + Step1 + 配送 + 右側摘要(②-④b 抽 CheckoutSummaryAside、字面不變)
//     ④ 地址選擇 ⑤ 導航 ⑤b step3 勾同意 + canGetPrime → 確認付款 enabled;canGetPrime false → disabled
//     ⑥ member block ⑦ 🔴 經銷零洩漏 ⑧ 無地址 disabled
//     ②-④b 刷卡接線:⑨ 確認付款 → getPrime → chargePaymentAction 收零價線+prime + paid 終態 + 清車
//     ⑩ 失敗(formError)→ 通用錯誤 + 不清車 ⑪ 🔴 線缺 variantId → client 拒、零 action 呼叫
//     ⑫ getPrime null → 友善錯誤、零 action ⑬ processing → 終態+清車 ⑭ in_flight/wait → 留頁+不清車
//     ⑮ Step3 渲染 TapPay 卡欄容器(tpfield、零 <input> 收卡資料)
// mock CartContext + cart/actions + charge-actions + useTapPayCard(SDK 不進 jsdom)+ next/navigation。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';
import type { ResolvedCartLine } from '@/app/cart/actions';
import type { CustomerAddress, MemberTier } from '@pcm/domain';

const { cartRef, resolveMock, pushMock, chargeMock, getPrimeMock, tapRef } = vi.hoisted(() => ({
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
  tapRef: {
    current: {
      ready: 'ready' as const,
      canGetPrime: true,
      fieldStatus: { number: 0 as const, expiry: 0 as const, ccv: 0 as const },
    },
  },
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
  useTapPayCard: () => ({ ...tapRef.current, getPrime: getPrimeMock }),
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
  tapRef.current = {
    ready: 'ready',
    canGetPrime: true,
    fieldStatus: { number: 0, expiry: 0, ccv: 0 },
  };
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
    unitPrice: 14600,
    ...over,
  };
}

const ADDR: CustomerAddress = {
  id: 'addr-1',
  isDefault: true,
  name: '王小明',
  phone: '0912345678',
  line: '新北市新莊區化成路 736 巷 18 號',
} as unknown as CustomerAddress;

function renderCheckout(over: { addresses?: CustomerAddress[]; memberTier?: MemberTier } = {}) {
  return render(
    <CheckoutView
      addresses={over.addresses ?? [ADDR]}
      memberName="王小明"
      memberTier={over.memberTier ?? 'general'}
    />,
  );
}

describe('CheckoutView(M-3-S2-b2-e1)', () => {
  it('hydrate 前 → 載入態', () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }], { isHydrated: false });
    renderCheckout();
    expect(screen.getByText('載入結帳資料…')).toBeTruthy();
  });

  it('空車 → 導購物車提示', async () => {
    setCart([]);
    renderCheckout();
    expect(await screen.findByText('購物車是空的')).toBeTruthy();
  });

  it('ready:3 步指示器 + Step1 地址 + 配送 + 右側摘要', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 2 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    const { container } = renderCheckout();
    expect(await screen.findByText('貨運宅配')).toBeTruthy();
    // 步指示器 3 步
    expect(screen.getByText('付款方式')).toBeTruthy();
    expect(screen.getByText('確認訂單')).toBeTruthy();
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

  it('地址選擇 radio → is-on', async () => {
    const addr2 = { ...ADDR, id: 'addr-2', isDefault: false, name: '李大華' } as unknown as CustomerAddress;
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

  it('導航:step1→step2(發票/付款)→step3(確認複查)→上一步、返回購物車→/cart', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    renderCheckout();
    await screen.findByText('貨運宅配');

    // → step2:發票 + 付款方式(e2)
    fireEvent.click(screen.getByRole('button', { name: /下一步:付款方式/ }));
    expect(screen.getByText('發票資訊')).toBeTruthy();
    expect(screen.getByText('信用卡(TapPay)')).toBeTruthy();

    // → step3:確認複查(e3a:同意條款 + 商品複查 + 確認付款鈕)
    fireEvent.click(screen.getByRole('button', { name: /下一步:確認訂單/ }));
    expect(screen.getByText(/我已閱讀並同意/)).toBeTruthy();
    expect(screen.getByText(/商品清單/)).toBeTruthy();
    // 未勾同意 → 確認付款 disabled(co-actions + buybar 兩顆都 disabled)
    const payButtons = screen.getAllByRole('button', { name: /確認付款/ }) as HTMLButtonElement[];
    expect(payButtons.length).toBeGreaterThanOrEqual(1);
    expect(payButtons.every((b) => b.disabled)).toBe(true);

    // 上一步 → 回 step2
    fireEvent.click(screen.getByRole('button', { name: /上一步/ }));
    expect(screen.getByText('發票資訊')).toBeTruthy();

    // 上一步 → 回 step1
    fireEvent.click(screen.getByRole('button', { name: /上一步/ }));
    expect(screen.getByText('貨運宅配')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /返回購物車/ }));
    expect(pushMock).toHaveBeenCalledWith('/cart');
  });

  it('step3 勾同意 → 確認付款 enabled(送出 e3b 接線、e3a 僅 UI gate)', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1' })]);
    const { container } = renderCheckout();
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:付款方式/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步:確認訂單/ }));

    const agree = container.querySelector('.co-agree input') as HTMLInputElement;
    fireEvent.click(agree);
    const payButtons = screen.getAllByRole('button', { name: /確認付款/ }) as HTMLButtonElement[];
    expect(payButtons.every((b) => b.disabled)).toBe(false);
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
    const next = screen.getByRole('button', { name: /下一步:付款方式/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  // ===== ②-④b:刷卡接線(getPrime → chargePaymentAction → 六態)=====
  async function gotoStep3Agreed(container: HTMLElement) {
    await screen.findByText('貨運宅配');
    fireEvent.click(screen.getByRole('button', { name: /下一步:付款方式/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步:確認訂單/ }));
    fireEvent.click(container.querySelector('.co-agree input') as HTMLInputElement);
  }

  it('⑮ Step3 渲染 TapPay 卡欄容器(tpfield 三欄、零 <input> 收卡資料)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await gotoStep3Agreed(container);
    expect(container.querySelector('#tappay-card-number.tpfield')).toBeTruthy();
    expect(container.querySelector('#tappay-card-expiration-date.tpfield')).toBeTruthy();
    expect(container.querySelector('#tappay-card-ccv.tpfield')).toBeTruthy();
    // 🔴 卡資料零進我方 input:tpfield 容器內無 input 元素(iframe 由 SDK 注入、jsdom mock 下為空)
    expect(container.querySelectorAll('.tpfield input').length).toBe(0);
    expect(screen.getByText(/TapPay 安全欄位加密處理/)).toBeTruthy();
  });

  it('⑤c canGetPrime=false → 勾同意後確認付款仍 disabled(雙鈕)', async () => {
    tapRef.current = { ...tapRef.current, canGetPrime: false };
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
    const { container } = renderCheckout();
    await gotoStep3Agreed(container);
    const payButtons = screen.getAllByRole('button', { name: /確認付款/ }) as HTMLButtonElement[];
    expect(payButtons.every((b) => b.disabled)).toBe(true);
  });

  it('🔴 ⑨ 確認付款 → getPrime → chargePaymentAction 收零價線 + prime + paid 終態 + 清車', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 2 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0007' });
    const { container } = renderCheckout();
    await gotoStep3Agreed(container);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);

    expect(await screen.findByText('訂單已成立')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0007')).toBeTruthy();
    expect(chargeMock).toHaveBeenCalledOnce();
    const payload = chargeMock.mock.calls[0]![0] as {
      lines: Array<Record<string, unknown>>;
      addressId: string;
      shippingMethod: string;
      prime: string;
    };
    expect(payload.lines).toEqual([{ variantId: 'v1', quantity: 2 }]); // 零價
    expect(payload.lines[0]).not.toHaveProperty('unitPrice');
    expect(payload.prime).toBe('prime_test');
    expect(payload.shippingMethod).toBe('home');
    expect(payload.addressId).toBe('addr-1');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('cardholder'); // 🔴 client 零送 cardholder
    expect(payload).not.toHaveProperty('amount'); // 🔴 client 零送價
    expect(cartRef.current.clear).toHaveBeenCalledOnce(); // paid 才清車
  });

  it('🔴 ⑯ 同輪快速雙擊 → getPrime 只進一次(primeBusyRef 同步鎖;codex 關卡2 r1)', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1', unitPrice: 15200 })]);
    getPrimeMock.mockResolvedValue('prime_test');
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0008' });
    const { container } = renderCheckout();
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(container);
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
    await gotoStep3Agreed(c2);
    fireEvent.click(screen.getAllByRole('button', { name: /確認付款/ })[0]!);
    expect(await screen.findByText(/未扣款;系統忙碌中/)).toBeTruthy();
    expect(cartRef.current.clear).not.toHaveBeenCalled();
  });
});
