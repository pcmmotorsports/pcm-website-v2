// @vitest-environment jsdom
//
// usePlaceOrder hook test(M-3-S2-b2-e3b;codex 關卡2 round1 MUST-FIX 回歸防線)。
// 驗:
// ① 🔴 連點兩次只呼叫一次 placeOrderAction(inFlightRef 同步原子鎖防雙建單;送出前立即上鎖、
//    第二次同步即被擋)+ 成功保持上鎖 + 清車一次。
// ② 建單失敗 → 釋放鎖、可再次送出(失敗釋放)。
// ③ 缺 variantId → 整單拒、不呼叫 action、釋放鎖(client fail-closed)。
// mock '@/contexts/CartContext'(useCart)+ '@/app/checkout/actions'(placeOrderAction)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';

const { cartRef, placeOrderMock } = vi.hoisted(() => ({
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
  placeOrderMock: vi.fn(),
}));

vi.mock('@/contexts/CartContext', () => ({
  useCart: () => cartRef.current,
}));
vi.mock('@/app/checkout/actions', () => ({
  placeOrderAction: placeOrderMock,
}));

import { usePlaceOrder } from './usePlaceOrder';

function setCart(items: CartItem[]) {
  cartRef.current = {
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    isHydrated: true,
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQty: vi.fn(),
    clear: vi.fn(),
  };
}

const ARGS = {
  addressId: 'addr-1',
  shippingMethod: 'home' as const,
  invoice: { type: 'personal' as const, carrier: '', title: '', taxId: '', donateCode: '' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePlaceOrder(M-3-S2-b2-e3b)', () => {
  it('🔴 連點兩次只呼叫一次 placeOrderAction(inFlightRef 同步原子鎖)+ 成功保持上鎖 + 清車一次', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    let resolveAction: (v: unknown) => void = () => {};
    placeOrderMock.mockReturnValue(
      new Promise((r) => {
        resolveAction = r;
      }),
    );
    const { result } = renderHook(() => usePlaceOrder());

    await act(async () => {
      // 兩次 submit 同步連發(第二次在第一次 await 解析前)→ 第二次被同步鎖擋。
      const p1 = result.current.submit(ARGS);
      const p2 = result.current.submit(ARGS);
      resolveAction({ ok: true, displayId: 'PCM-2026-0001' });
      await Promise.all([p1, p2]);
    });

    expect(placeOrderMock).toHaveBeenCalledTimes(1);
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'success', displayId: 'PCM-2026-0001' });

    // 成功後鎖保持:再 submit 仍不呼叫 action(成功畫面取代表單、防殘留 onClick 建第二單)。
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(placeOrderMock).toHaveBeenCalledTimes(1);
  });

  it('建單失敗 → 釋放鎖、可再次送出', async () => {
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    placeOrderMock
      .mockResolvedValueOnce({ formError: '下單失敗,請稍後再試或聯繫客服 LINE' })
      .mockResolvedValueOnce({ ok: true, displayId: 'PCM-2026-0002' });
    const { result } = renderHook(() => usePlaceOrder());

    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(result.current.state.status).toBe('error');

    // 失敗已釋放鎖 → 第二次 submit 可成。
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(placeOrderMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ status: 'success', displayId: 'PCM-2026-0002' });
  });

  it('🔴 缺 variantId → 整單拒、不呼叫 placeOrderAction、釋放鎖', async () => {
    setCart([{ productId: 'rpm-1', qty: 1 }]); // 無 variantId
    const { result } = renderHook(() => usePlaceOrder());

    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(placeOrderMock).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toContain('缺少規格資訊');
    }

    // 釋放鎖後修正購物車 → 可再送出成功。
    setCart([{ productId: 'rpm-1', variantId: 'v1', qty: 1 }]);
    placeOrderMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0003' });
    const { result: result2 } = renderHook(() => usePlaceOrder());
    await act(async () => {
      await result2.current.submit(ARGS);
    });
    expect(placeOrderMock).toHaveBeenCalledTimes(1);
    expect(result2.current.state).toEqual({ status: 'success', displayId: 'PCM-2026-0003' });
  });
});
