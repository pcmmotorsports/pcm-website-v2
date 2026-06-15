// @vitest-environment jsdom
//
// ClearCartOnSuccess test(M-3 3DS-3、codex 關卡1 must-fix:hydrate-race 防覆寫)。
// 🔴 用**真 CartProvider**(非 mock)+ 預塞 localStorage + remount → 驗 hydrate 完成後才清、且 items/localStorage
//    三者皆清空。若清車未 gate isHydrated(在 hydrate 前 clear → 被 readStorage 覆寫回舊車),qty 會殘留非 0 → 本測抓出。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { CartProvider, useCart } from '@/contexts/CartContext';
import { ClearCartOnSuccess } from './ClearCartOnSuccess';

const STORAGE_KEY = 'pcm-cart-mock-v2';

function Probe() {
  const { totalQty, isHydrated } = useCart();
  return <div data-testid="probe">{isHydrated ? `qty:${totalQty}` : 'hydrating'}</div>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ClearCartOnSuccess', () => {
  it('預塞購物車 → hydrate 完成後清空 items + localStorage 寫回 []', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { productId: 'p1', variantId: 'v1', qty: 2 },
        { productId: 'p2', qty: 1 },
      ]),
    );

    const { getByTestId } = render(
      <CartProvider>
        <Probe />
        <ClearCartOnSuccess />
      </CartProvider>,
    );

    // hydrate(readStorage 回 3 件)→ ClearCartOnSuccess gate isHydrated 後 clear → qty:0(若 race bug 會殘 qty:3)。
    await waitFor(() => {
      expect(getByTestId('probe').textContent).toBe('qty:0');
    });
    // effect2(isHydrated 後)把空陣列寫回 localStorage。
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual([]);
  });

  it('空車 mount:穩定 qty:0、不 throw(無預塞亦安全)', async () => {
    const { getByTestId } = render(
      <CartProvider>
        <Probe />
        <ClearCartOnSuccess />
      </CartProvider>,
    );
    await waitFor(() => {
      expect(getByTestId('probe').textContent).toBe('qty:0');
    });
  });
});
