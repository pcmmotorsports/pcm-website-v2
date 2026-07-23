// @vitest-environment jsdom
//
// useReconcilePayment hook test(M-3 S1b-2)。驗黑洞「查詢付款結果」即時反查的結果映射 + 安全性:
// ① paid → clearPaymentInflight + clear + regenerateCartSession + setState(paid)(既有生命週期超集)。
// ② failed(帶/不帶 displayId)→ clearPaymentInflight + setState(reconciled_failed);不清車、不換 key。
// ③ pending → setState(unknown 提示)+ 冷卻;不清車、不換 key、不清 in-flight 記號。
// ④ 🔴 fail-closed:reject / 逾時(永不 resolve)→ 一律當 pending,**絕不** setState(paid/failed);
//    且 reconciling 於 finally 重置 = 按鈕**不永久鎖死**(重現 S1a 死路的負向守門)。
// ⑤ 冪等鎖:連點只呼叫 reconcileCartSession 一次。
// ⑥ 冷卻計時器逾時後 reconcileDisabled 解除。

import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';

const { reconcileMock, clearInflightMock } = vi.hoisted(() => ({
  reconcileMock: vi.fn(),
  clearInflightMock: vi.fn(),
}));

vi.mock('@/app/checkout/reconcile-actions', () => ({
  reconcileCartSession: reconcileMock,
}));
vi.mock('@/lib/payment/inflight-marker', () => ({
  clearPaymentInflight: clearInflightMock,
}));

import { useReconcilePayment } from './useReconcilePayment';

function renderReconcile(cartSessionId: string = 'cart-sess-1') {
  const setState = vi.fn();
  const clear = vi.fn();
  const regenerateCartSession = vi.fn();
  const { result, rerender, unmount } = renderHook(
    (props: { cartSessionId: string }) =>
      useReconcilePayment({ ...props, setState, clear, regenerateCartSession }),
    { initialProps: { cartSessionId } },
  );
  return {
    result,
    setState,
    clear,
    regenerateCartSession,
    unmount,
    rerenderSession: (next: string) => rerender({ cartSessionId: next }),
  };
}

afterEach(() => {
  cleanup();
  reconcileMock.mockReset();
  clearInflightMock.mockReset();
  vi.useRealTimers();
});

describe('useReconcilePayment', () => {
  it('paid → 清 in-flight 記號 + 清車 + 換新 key + setState paid(既有生命週期超集)', async () => {
    reconcileMock.mockResolvedValue({ status: 'paid', displayId: 'PCM-2026-0009' });
    const { result, setState, clear, regenerateCartSession } = renderReconcile();

    act(() => result.current.reconcile());

    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith({ status: 'paid', displayId: 'PCM-2026-0009' }),
    );
    expect(clearInflightMock).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(regenerateCartSession).toHaveBeenCalledTimes(1);
    // paid 是終態、非 pending → 不進冷卻
    await waitFor(() => expect(result.current.reconciling).toBe(false));
    expect(result.current.reconcileDisabled).toBe(false);
  });

  it('failed 帶 displayId → 清 in-flight 記號 + setState reconciled_failed(透傳單號);不清車、不換 key', async () => {
    reconcileMock.mockResolvedValue({ status: 'failed', displayId: 'PCM-2026-0010' });
    const { result, setState, clear, regenerateCartSession } = renderReconcile();

    act(() => result.current.reconcile());

    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'reconciled_failed', displayId: 'PCM-2026-0010' }),
      ),
    );
    expect(clearInflightMock).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled(); // 🔴 failed 不清車(車已被 S1a 清)、不換 key
    expect(regenerateCartSession).not.toHaveBeenCalled();
  });

  it('failed 不帶 displayId → setState reconciled_failed 無 displayId 欄位', async () => {
    reconcileMock.mockResolvedValue({ status: 'failed' });
    const { result, setState } = renderReconcile();

    act(() => result.current.reconcile());

    await waitFor(() => expect(setState).toHaveBeenCalled());
    const failedCall = setState.mock.calls.find((c) => c[0]?.status === 'reconciled_failed');
    expect(failedCall).toBeTruthy();
    expect(failedCall?.[0]).not.toHaveProperty('displayId');
  });

  it('pending → setState unknown 提示 + 進冷卻;不清車/不換 key/不清 in-flight', async () => {
    reconcileMock.mockResolvedValue({ status: 'pending' });
    const { result, setState, clear, regenerateCartSession } = renderReconcile();

    act(() => result.current.reconcile());

    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'unknown' }),
      ),
    );
    expect(clear).not.toHaveBeenCalled();
    expect(regenerateCartSession).not.toHaveBeenCalled();
    expect(clearInflightMock).not.toHaveBeenCalled(); // 🔴 pending 維持 unknown 鎖、不清記號
    await waitFor(() => expect(result.current.reconciling).toBe(false));
    expect(result.current.reconcileDisabled).toBe(true); // 冷卻中 → 鈕仍 disabled
  });

  it('🔴 fail-closed:reconcile reject → 當 pending(setState unknown)、絕不誤報 paid/failed、reconciling 重置', async () => {
    reconcileMock.mockRejectedValue(new Error('network-blackhole'));
    const { result, setState } = renderReconcile();

    act(() => result.current.reconcile());

    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' })),
    );
    // 絕不誤報成交/失敗
    const statuses = setState.mock.calls.map((c) => c[0].status);
    expect(statuses).not.toContain('paid');
    expect(statuses).not.toContain('reconciled_failed');
    // 🔴 finally 重置 → 按鈕不永久鎖死
    await waitFor(() => expect(result.current.reconciling).toBe(false));
  });

  it('🔴 fail-closed:reconcile 永不 resolve(黑洞)→ 逾時後當 pending、reconciling 重置(不永久死鎖)', async () => {
    vi.useFakeTimers();
    reconcileMock.mockReturnValue(new Promise(() => {})); // 永不 settle
    const { result, setState } = renderReconcile();

    act(() => result.current.reconcile());
    expect(result.current.reconciling).toBe(true); // 進行中

    // 推進到 client bounded timeout(15s)→ withReconcileTimeout reject → catch pending + finally 解鎖
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }));
    const statuses = setState.mock.calls.map((c) => c[0].status);
    expect(statuses).not.toContain('paid');
    expect(statuses).not.toContain('reconciled_failed');
    expect(result.current.reconciling).toBe(false); // 🔴 不永久鎖死
  });

  it('冪等鎖:連點兩次只呼叫 reconcileCartSession 一次', async () => {
    reconcileMock.mockReturnValue(new Promise(() => {})); // 維持進行中,鎖不釋放
    vi.useFakeTimers();
    const { result } = renderReconcile();

    act(() => {
      result.current.reconcile();
      result.current.reconcile();
    });

    expect(reconcileMock).toHaveBeenCalledTimes(1);
  });

  it('🔴 stale 守衛:unmount 後 late-paid → 不清車/不換 key/不清 in-flight(不誤清客人新車)', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    reconcileMock.mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      }),
    );
    const { result, clear, regenerateCartSession, unmount } = renderReconcile();

    act(() => result.current.reconcile());
    unmount(); // 客人點「繼續購物」離開終態頁 → 元件卸載,但反查請求仍在途

    await act(async () => {
      resolveFn({ status: 'paid', displayId: 'PCM-2026-0099' }); // 晚到 paid
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clear).not.toHaveBeenCalled(); // 🔴 不得清掉客人離開後新加的車
    expect(regenerateCartSession).not.toHaveBeenCalled();
    expect(clearInflightMock).not.toHaveBeenCalled();
  });

  it('🔴 stale 守衛:session 換 key 後 late-paid → 不動 cart、不誤切 paid(舊單結果不驅動新 session)', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    reconcileMock.mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      }),
    );
    const { result, clear, regenerateCartSession, setState, rerenderSession } =
      renderReconcile('sess-old');

    act(() => result.current.reconcile());
    rerenderSession('sess-new'); // 反查途中 session 改變

    await act(async () => {
      resolveFn({ status: 'paid', displayId: 'PCM-2026-0100' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(clear).not.toHaveBeenCalled();
    expect(regenerateCartSession).not.toHaveBeenCalled();
    const statuses = setState.mock.calls.map((c) => c[0]?.status);
    expect(statuses).not.toContain('paid'); // 不得以舊單結果切 paid
    // N1(Fable):stale-but-mounted 仍在 finally 解鎖(reconciling 回 false)→ 按鈕不死鎖。
    await waitFor(() => expect(result.current.reconciling).toBe(false));
  });

  it('🔴 StrictMode(dev 雙 invoke setup→cleanup→setup)下 reconcile 仍生效(mountedRef 設定/清理對稱)', async () => {
    reconcileMock.mockResolvedValue({ status: 'paid', displayId: 'PCM-2026-0200' });
    const setState = vi.fn();
    const clear = vi.fn();
    const regenerateCartSession = vi.fn();
    const { result } = renderHook(
      () =>
        useReconcilePayment({ cartSessionId: 'sess-sm', setState, clear, regenerateCartSession }),
      { wrapper: StrictMode },
    );

    act(() => result.current.reconcile());

    // 🔴 若 mountedRef 只在 cleanup 設 false、setup 未設回 true,StrictMode 首次模擬 cleanup 後恆 false →
    //   stale 守衛丟棄 paid → 此斷言轉紅(= dev 下按鈕全失效的守門)。
    await waitFor(() =>
      expect(setState).toHaveBeenCalledWith({ status: 'paid', displayId: 'PCM-2026-0200' }),
    );
    expect(clear).toHaveBeenCalledTimes(1);
    expect(regenerateCartSession).toHaveBeenCalledTimes(1);
  });

  it('冷卻計時器逾時後 reconcileDisabled 解除', async () => {
    vi.useFakeTimers();
    reconcileMock.mockResolvedValue({ status: 'pending' });
    const { result } = renderReconcile();

    await act(async () => {
      result.current.reconcile();
      await vi.advanceTimersByTimeAsync(0); // flush resolve → onPending + startCooldown
    });
    expect(result.current.reconcileDisabled).toBe(true); // 冷卻中

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000); // 冷卻窗
    });
    expect(result.current.reconcileDisabled).toBe(false);
  });
});
