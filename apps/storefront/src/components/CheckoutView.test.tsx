// @vitest-environment jsdom
//
// CheckoutView smoke test(M-3-S2-b2-e1 結帳殼 + Step1;e2 接 Step2、e3a 接 Step3 後更新導航斷言)。
//
// 驗:① 載入態 ② 空車 → 導購物車提示 ③ ready:3 步指示器 + Step1 地址清單 + 配送(宅配)+ 右側摘要
//     ④ 地址選擇(radio is-on)⑤ 導航:step1→step2(發票/付款)→step3(確認複查)/ 上一步 / 返回購物車→/cart
//     ⑤b step3 勾同意 → 確認付款 enabled(送出 e3b 接)⑥ member block + TierBadge + 升級連結(general)
//     ⑦ 🔴 經銷零洩漏(general-only、無劃線價)⑧ 無地址 → 下一步 disabled
// (Step2 發票/付款細節在 CheckoutStep2.test.tsx、Step3 複查細節在 CheckoutStep3.test.tsx;本檔只驗殼接線 + 步驟導航。)
// mock '@/contexts/CartContext'(useCart)+ '@/app/cart/actions'(resolveCartLines)+ next/navigation + matchMedia。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';
import type { ResolvedCartLine } from '@/app/cart/actions';
import type { CustomerAddress, MemberTier } from '@pcm/domain';

const { cartRef, resolveMock, pushMock } = vi.hoisted(() => ({
  cartRef: {
    current: {
      items: [] as CartItem[],
      totalQty: 0,
      isHydrated: true,
      addItem: vi.fn(),
      removeItem: vi.fn(),
      updateQty: vi.fn(),
      clear: vi.fn(),
    },
  },
  resolveMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('@/contexts/CartContext', () => ({
  useCart: () => cartRef.current,
}));
vi.mock('@/app/cart/actions', () => ({
  resolveCartLines: resolveMock,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
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
});

function setCart(items: CartItem[], opts: { isHydrated?: boolean } = {}) {
  cartRef.current = {
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    isHydrated: opts.isHydrated ?? true,
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQty: vi.fn(),
    clear: vi.fn(),
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
});
