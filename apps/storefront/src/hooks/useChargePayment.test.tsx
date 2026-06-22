// @vitest-environment jsdom
//
// useChargePayment hook test(M-3 ②-④b;鎖回歸防線 + 六態映射/清車政策)。
// 驗:
// ① 🔴 連點兩次只呼叫一次 chargePaymentAction(inFlightRef 同步原子鎖);paid 終態保持上鎖 + 清車一次。
// ② processing → 清車 + 終態保持上鎖(勿重複付款)。
// ③ in_flight / charge_failed_wait / charge_failed / formError → 不清車、釋放鎖可重試。
// ④ 缺 variantId → 整單拒、零 action、釋放鎖(client fail-closed)。
// ⑤ fieldErrors.addressId → 以該欄訊息顯示。
// ⑥ 🔴 action throw(回應遺失層)→ unknown 終態:清車 + 不釋鎖(可能已扣款、防雙扣;審查側 BLOCKER)。
// mock '@/contexts/CartContext' + '@/app/checkout/charge-actions'。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';

const { cartRef, chargeMock } = vi.hoisted(() => ({
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
  chargeMock: vi.fn(),
}));

vi.mock('@/contexts/CartContext', () => ({
  useCart: () => cartRef.current,
}));
vi.mock('@/app/checkout/charge-actions', () => ({
  chargePaymentAction: chargeMock,
}));

import { useChargePayment } from './useChargePayment';

function setCart(items: CartItem[], cartSessionId: string | null = 'cart-sess-default') {
  cartRef.current = {
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    isHydrated: true,
    cartSessionId,
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQty: vi.fn(),
    clear: vi.fn(),
    regenerateCartSession: vi.fn(),
  };
}

const ARGS = {
  addressId: 'addr-1',
  shippingMethod: 'home' as const,
  invoice: { type: 'personal' as const, carrier: '', title: '', taxId: '', donateCode: '' },
  prime: 'prime_test',
};

afterEach(() => {
  cleanup();
  chargeMock.mockReset();
});

describe('useChargePayment', () => {
  it('🔴 連點兩次只呼一次 action;paid → 清車一次 + 終態保持上鎖(第三次也不呼)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0001' });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      void result.current.submit(ARGS);
      void result.current.submit(ARGS); // 同步雙擊
    });
    expect(chargeMock).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'paid', displayId: 'PCM-2026-0001' });
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.submit(ARGS); // 終態上鎖
    });
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it('processing → 清車 + 終態上鎖(勿重複付款;帶 displayId+message)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({
      ok: false,
      payment: 'processing',
      displayId: 'PCM-2026-0002',
      message: '付款已收或處理中,請勿重複付款,客服 LINE 將協助確認',
    });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(result.current.state).toMatchObject({ status: 'processing', displayId: 'PCM-2026-0002' });
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(chargeMock).toHaveBeenCalledTimes(1); // 上鎖
  });

  it.each([
    ['in_flight', { ok: false, payment: 'in_flight', message: 'm1' }, 'in_flight'],
    ['charge_failed_wait', { ok: false, payment: 'charge_failed_wait', displayId: 'D', message: 'm2' }, 'wait'],
    ['charge_failed', { ok: false, payment: 'charge_failed', displayId: 'D', message: 'm3' }, 'error'],
    ['formError', { formError: 'm4' }, 'error'],
  ])('%s → 不清車 + 釋放鎖可重試', async (_label, res, expectedStatus) => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue(res);
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(result.current.state.status).toBe(expectedStatus);
    expect(cartRef.current.clear).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.submit(ARGS); // 釋放鎖 → 可重送
    });
    expect(chargeMock).toHaveBeenCalledTimes(2);
  });

  it('缺 variantId → 整單拒、零 action、釋放鎖', async () => {
    setCart([{ productId: 'p1', qty: 1 }]);
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(chargeMock).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ status: 'error' });
    expect((result.current.state as { message: string }).message).toContain('缺少規格資訊');
  });

  it('fieldErrors.addressId → 以該欄訊息顯示(引導補手機等)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({ fieldErrors: { addressId: '收件地址缺少手機號碼,請補齊後再試' } });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(result.current.state).toEqual({
      status: 'error',
      message: '收件地址缺少手機號碼,請補齊後再試',
    });
  });

  it('submit 回傳 terminal:paid/processing → true、error → false(View 據此維持 primeBusyRef;r2)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0009' });
    const { result } = renderHook(() => useChargePayment());
    let terminal: boolean | undefined;
    await act(async () => {
      terminal = await result.current.submit(ARGS);
    });
    expect(terminal).toBe(true);
    await act(async () => {
      terminal = await result.current.submit(ARGS); // 終態上鎖早退 → 同樣回 true(呼叫端不得釋放)
    });
    expect(terminal).toBe(true);

    const { result: r2 } = renderHook(() => useChargePayment());
    chargeMock.mockResolvedValue({ ok: false, payment: 'charge_failed', displayId: 'D', message: 'm' });
    await act(async () => {
      terminal = await r2.current.submit(ARGS);
    });
    expect(terminal).toBe(false);
  });

  it('🔴 action throw(回應遺失層)→ unknown 終態:清車 + 不釋鎖 + 勿重複付款(審查側 BLOCKER 修)', async () => {
    // 回應遺失時 server 可能已完成扣款(order paid → per-user 閘不再攔)→ 絕不可釋鎖重試造雙扣。
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useChargePayment());
    let terminal: boolean | undefined;
    await act(async () => {
      terminal = await result.current.submit(ARGS);
    });
    expect(terminal).toBe(true); // 終態:呼叫端不得釋放自身鎖
    expect(result.current.state).toEqual({
      status: 'unknown',
      message: '付款狀態未知,請勿重複付款,客服 LINE 將協助確認',
    });
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1); // 清車(防殘留 cart 誘導重刷)

    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0003' });
    await act(async () => {
      await result.current.submit(ARGS); // 終態上鎖 → 不得再呼 action
    });
    expect(chargeMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('unknown');
  });

  it('🔴 3DS-6b redirect(3DS 啟動成功)→ state=redirect + redirectUrl;不清車;submit 回 true(UI 鎖維持)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    const PAY = 'https://sandbox.tappaysdk.com/tpc/3ds/pay?token=abc123';
    chargeMock.mockResolvedValue({ redirect: true, redirectUrl: PAY });
    const { result } = renderHook(() => useChargePayment());
    let terminal: boolean | undefined;
    await act(async () => {
      terminal = await result.current.submit(ARGS);
    });
    expect(terminal).toBe(true); // 即將整頁導向 → 呼叫端不釋放 UI 鎖
    expect(result.current.state).toEqual({ status: 'redirect', redirectUrl: PAY });
    expect(cartRef.current.clear).not.toHaveBeenCalled(); // 🔴 redirect 不清車(callback 成功頁才清、abandon 可回頭)

    // UI 鎖維持(導向中):再 submit 不重呼 action。
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0005' });
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(chargeMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('redirect');
  });

  it('🔴 3DS-7:paid → regenerateCartSession 換新 key 一次;payload 帶 client cartSessionId', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }], 'cart-abc');
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0001' });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(cartRef.current.regenerateCartSession).toHaveBeenCalledTimes(1); // DB 確定 paid → 換新 key
    expect(chargeMock).toHaveBeenCalledWith(expect.objectContaining({ cartSessionId: 'cart-abc' }));
  });

  it('🔴 3DS-7:processing(模糊態)→ 清車但**不** regenerate(保留 key 防雙扣)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({ ok: false, payment: 'processing', displayId: 'D', message: 'm' });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1);
    expect(cartRef.current.regenerateCartSession).not.toHaveBeenCalled();
  });

  it('🔴 3DS-7:action throw(unknown=回應遺失)→ 清車但**不** regenerate(保留 key 防雙扣)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1);
    expect(cartRef.current.regenerateCartSession).not.toHaveBeenCalled();
  });
});
