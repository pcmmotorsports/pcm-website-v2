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
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';

const { cartRef, chargeMock, setInflightMock, clearInflightMock, reconcileMock } = vi.hoisted(() => ({
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
  setInflightMock: vi.fn(),
  clearInflightMock: vi.fn(),
  reconcileMock: vi.fn(),
}));

vi.mock('@/contexts/CartContext', () => ({
  useCart: () => cartRef.current,
}));
vi.mock('@/app/checkout/charge-actions', () => ({
  chargePaymentAction: chargeMock,
}));
vi.mock('@/lib/payment/inflight-marker', () => ({
  setPaymentInflight: setInflightMock,
  clearPaymentInflight: clearInflightMock,
}));
// S1b-2:useChargePayment 內部組合 useReconcilePayment(→ reconcile-actions);mock 避免載入 server 依賴。
vi.mock('@/app/checkout/reconcile-actions', () => ({
  reconcileCartSession: reconcileMock,
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
  agreed: true, // 🔴 #241:同意條款(送 server action 重驗)
  // 🔵 段 1-B:tappay = 今天線上唯一的付款方式 ⇒ 既有測項的世界不變。
  //   🛑 而它是【一個世界不是中性預設】—— 匯款那個世界要有自己的測項。
  paymentChannel: 'tappay' as const,
};

afterEach(() => {
  cleanup();
  chargeMock.mockReset();
  setInflightMock.mockReset();
  clearInflightMock.mockReset();
  reconcileMock.mockReset();
});

describe('useChargePayment', () => {
  it('🔴 #241:submit payload 帶 agreed → chargePaymentAction(server 重驗同意)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0001' });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(chargeMock).toHaveBeenCalledWith(expect.objectContaining({ agreed: true }));
    // 🔴 段 1-B:**這一行是為了一個真的漏掉而加的**(codex plan 關卡1 must-fix ①)——
    //    hook 收了 `paymentChannel` 而**沒有轉送**, 而全套 7090 格是綠的。
    //    📌 它守的是「**收了 ≠ 送了**」, 而那個差別只在【這一支檔】看得見。
    expect(chargeMock).toHaveBeenCalledWith(expect.objectContaining({ paymentChannel: 'tappay' }));
    expect(chargeMock.mock.calls[0]![0]).not.toHaveProperty('notificationEmail');
  });

  it('B-3:只有 caller 明確帶入時，payload 才帶 notificationEmail', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0001' });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit({ ...ARGS, notificationEmail: 'Member@example.com' });
    });

    expect(chargeMock).toHaveBeenCalledWith(
      expect.objectContaining({ notificationEmail: 'Member@example.com' }),
    );
  });

  it('V-3a:cart item 帶 vehicle → lines 逐列帶入;未帶列無 vehicle 鍵(選填)', async () => {
    setCart([
      { productId: 'p1', variantId: 'v1', qty: 1, vehicle: { kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search' } },
      { productId: 'p2', variantId: 'v2', qty: 2 },
    ]);
    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0001' });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    const payload = chargeMock.mock.calls[0]![0] as { lines: Record<string, unknown>[] };
    expect(payload.lines).toEqual([
      { variantId: 'v1', quantity: 1, vehicle: { kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search' } },
      { variantId: 'v2', quantity: 2 },
    ]);
    expect(Object.keys(payload.lines[1]!)).not.toContain('vehicle');
  });

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

  it('🔴 R3 preflight hold(processing **無 displayId**)→ **不清車** + 終態鎖(§2.3 保留 cart、Q2=B 防連按)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({
      ok: false,
      payment: 'processing', // 無 displayId = hold
      message: '訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認',
    });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(result.current.state.status).toBe('processing');
    expect(cartRef.current.clear).not.toHaveBeenCalled(); // 🔴 無單號 → 保留 cart(sibling 確定 failed 後可再結帳)
    expect(cartRef.current.regenerateCartSession).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(chargeMock).toHaveBeenCalledTimes(1); // 🔴 終態鎖:按鈕鎖死、第二次 submit 不再呼 action(防焦慮連按再打 Record)
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

  /**
   * 🔴🔴 **⟦b4-BANKCHARGESCARD⟧ 片 1 的新變體 —— 而它原本【零測試】**(codex 關卡 2 must-fix)。
   *
   * 🛑 為什麼窮舉 typecheck 不夠:那道 `res satisfies never` 只證「有人寫了一個分支」,
   *    **證不到那個分支做了什麼** ⇒ 📌 把它改成清車 / 換 session / 顯示 `res.message`,
   *    **action 那邊的測試仍然全綠** —— 而這是**錢與重複建單**的行為。
   * ⚠️ 而本組釘的是**今天刻意的中間狀態**(走與失敗相同的路);
   *    front 片 2 接手時**這幾格會紅, 而那是對的** —— 到時連同這段註解一起改。
   */
  it('🔴 awaiting_remittance:清車 + 換 cart key + 帶單號進終態(片 2 ③ 接住之後)', async () => {
    // ⛔ ~~片 1 的期望:不清車、釋放鎖、顯示【通用】失敗文案~~
    // 🔴🔴 **2026-09-06 片 2 ③ 把這一格改成期望【新的行為】** —— 主視窗裁「建好單就清車 + 立刻導明細頁」。
    //    🛑 而改的理由不是「片 1 寫錯了」:**片 1 那個行為是【明寫的中間狀態】**,
    //       它的註解自己寫著「這不是修好了」⇒ 📌 **這一格改動是【預期內的】, 不是回歸。**
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({
      ok: false,
      payment: 'awaiting_remittance',
      displayId: 'PCM-2026-0001',
      message: '訂單已成立,尚未付款;請依匯款資訊完成轉帳',
    });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    // 🔵 它是**終態**, 不是 error —— 走錯誤畫面正是片 1 明寫要換掉的那件事。
    expect(result.current.state.status).toBe('awaiting_remittance');
    // 🔴 單號**要帶著** —— 導頁需要它, 而它是匯款客人唯一的把手(片 1 刻意不帶, 因為那時沒地方可去)。
    expect((result.current.state as { displayId: string }).displayId).toBe('PCM-2026-0001');
    // 🔴 清車:單已成立, 不清 ⇒ 他手上還有商品 ⇒ 再按一次會建第二張。
    expect(cartRef.current.clear, '沒清車 ⇒ 他會以為沒買成而再建一張').toHaveBeenCalled();
    // 🔴 **換新 cart key 也要釘** —— reviewer 2026-09-06 抓到:少了這一格,
    //    誰把 `regenerateCartSession()` 那行刪掉, **三綠仍然全綠**。
    //    🔵 它守的是【下一次合法購買】不被 server dedup 綁回這張未付款的單。
    expect(
      cartRef.current.regenerateCartSession,
      '沒換 cart key ⇒ 他下次買東西會被 dedup 綁回這張沒付錢的單',
    ).toHaveBeenCalledTimes(1);
  });

  it('🔴 awaiting_remittance:鎖【不】釋放 ⇒ 他再按一次送不出第二發(片 2 ③ 修掉的就是這個)', async () => {
    // ⛔ ~~片 1:鎖有釋放 ⇒ 再按一次會再送一發(而那正是片 2 要修的)~~
    // ✅ **2026-09-06 反過來釘**:它是終態、畫面即將整頁換掉 ⇒ 維持上鎖。
    //    🛑 **「不擋第二張」是被授權的形狀, 而那講的是【客人隔天再下一單】** ——
    //       不是「他在同一個畫面上因為以為沒買成而連按兩下」。兩件事不要混。
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({
      ok: false,
      payment: 'awaiting_remittance',
      displayId: 'PCM-2026-0001',
      message: 'm',
    });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(chargeMock, '鎖釋放了 ⇒ 第二發送得出去 ⇒ 客人會建出第二張單').toHaveBeenCalledTimes(1);
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

  it('fieldErrors.notificationEmail → 優先顯示 Email 欄位訊息', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    chargeMock.mockResolvedValue({ fieldErrors: { notificationEmail: 'Email 格式不正確' } });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit({ ...ARGS, notificationEmail: 'invalid-email' });
    });
    expect(result.current.state).toEqual({ status: 'error', message: 'Email 格式不正確' });
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
    expect(setInflightMock).toHaveBeenCalledWith('cart-sess-default'); // 🔴 codex must-fix:回應遺失同設跨分頁記號

    chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0003' });
    await act(async () => {
      await result.current.submit(ARGS); // 終態上鎖 → 不得再呼 action
    });
    expect(chargeMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('unknown');
  });

  it('🔴 S1a F5:送出逾時無回應 → unknown 終態(掀遮罩給出口;清車、不 regenerate、不釋鎖防雙扣)', async () => {
    vi.useFakeTimers();
    try {
      setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
      chargeMock.mockReturnValue(new Promise(() => {})); // 永不 resolve:模擬網路黑洞(server 收到、回應永不回)
      const { result } = renderHook(() => useChargePayment());
      let terminal: Promise<boolean> | undefined;
      act(() => {
        terminal = result.current.submit(ARGS);
      });
      expect(result.current.state.status).toBe('submitting'); // 送出當下:submitting、遮罩仍蓋
      await act(async () => {
        await vi.advanceTimersByTimeAsync(89_999); // 逾時前一刻:仍 submitting(釘住 90s 門檻、不得回退到更短)
      });
      expect(result.current.state.status).toBe('submitting');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1); // 跨過 90s 邊界 → reject → catch → unknown
      });
      expect(result.current.state).toEqual({
        status: 'unknown',
        message: '付款狀態未知,請勿重複付款,客服 LINE 將協助確認',
      });
      expect(cartRef.current.clear).toHaveBeenCalledTimes(1); // 清車
      expect(cartRef.current.regenerateCartSession).not.toHaveBeenCalled(); // 🔴 模糊態保留 key 防雙扣
      expect(setInflightMock).toHaveBeenCalledWith('cart-sess-default'); // 🔴 codex must-fix:跨分頁 in-flight 軟提醒
      await expect(terminal!).resolves.toBe(true); // 終態:呼叫端不得釋放自身鎖
      chargeMock.mockResolvedValue({ ok: true, displayId: 'PCM-2026-0010' });
      await act(async () => {
        await result.current.submit(ARGS); // 終態鎖:第二次 submit 不得再呼 action
      });
      expect(chargeMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

  it('🔴 P3:redirect → setPaymentInflight(cartSessionId) 設記號一次(另開分頁防呆)', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }], 'cart-xyz');
    chargeMock.mockResolvedValue({ redirect: true, redirectUrl: 'https://x/pay?token=t' });
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    expect(setInflightMock).toHaveBeenCalledWith('cart-xyz');
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

  // 🔴 S1b-2 MF7 接線守門:useReconcilePayment 組合於此、注入私有 setState → reconcile 結果必須驅動**同一份**
  //   ChargeState(若 View 自行實例化獨立 state,charge.state 會永停 unknown、終態畫面不觸發)。
  it('🔴 S1b-2 MF7:reconcile paid → charge.state 切 paid + 清車 + 換 key + 清 in-flight 記號', async () => {
    setCart([{ productId: 'p1', variantId: 'v1', qty: 1 }]);
    reconcileMock.mockResolvedValue({ status: 'paid', displayId: 'PCM-2026-0011' });
    const { result } = renderHook(() => useChargePayment());

    act(() => result.current.reconcile());

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'paid', displayId: 'PCM-2026-0011' }),
    );
    expect(cartRef.current.clear).toHaveBeenCalledTimes(1);
    expect(cartRef.current.regenerateCartSession).toHaveBeenCalledTimes(1);
    expect(clearInflightMock).toHaveBeenCalledTimes(1);
  });

  it('🔴 S1b-2:reconcile failed → charge.state 切 reconciled_failed(全頁失敗態驅動)', async () => {
    reconcileMock.mockResolvedValue({ status: 'failed', displayId: 'PCM-2026-0012' });
    const { result } = renderHook(() => useChargePayment());

    act(() => result.current.reconcile());

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'reconciled_failed',
        displayId: 'PCM-2026-0012',
      }),
    );
  });
});

// ⟦b9-Q15GAP⟧ Sean 2026-09-03 拍 `Q15 = 甲`:那句擋人的話要指名是哪一件。
// 🔴 **本 describe 存在的理由**:上面 ④ 那格只驗「缺 variantId ⇒ 整單拒、零 action」,
//    而**它對「訊息裡有沒有名字」「有幾件被列出來」完全盲** —— 突變證過:
//    把 `missing` 改成 `.slice(0, 1)`(= 退回舊行為「撞到第一件就 return」)⇒ **23 格全綠。**
describe('缺規格那句話 —— 指名 + 一次講完(Q15 = 甲)', () => {
  it('🔴 兩件都缺 ⇒ 訊息把【兩件】都列出來, 不是只講第一件', async () => {
    setCart([
      { productId: 'p1', qty: 1 },
      { productId: 'p2', qty: 1 },
    ]);
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit({
        ...ARGS,
        lineName: ({ productId }) => (productId === 'p1' ? '碳纖維護蓋' : '全段排氣'),
      });
    });
    const state = result.current.state;
    expect(state.status).toBe('error');
    const msg = state.status === 'error' ? state.message : '';
    // 🎯 判別點:**兩個名字都要在**。舊行為(撞到第一件就 return)只會有一個。
    expect(msg).toContain('碳纖維護蓋');
    expect(msg).toContain('全段排氣');
    expect(msg).toContain('2 件');
  });

  // 🔴 **叫得出一半 ⇒ 整句退回不指名版**(code-reviewer must-fix 1)。
  //    少了這一格, `canNameAll` 那個判斷可以整個刪掉而全綠 —— 而它擋的是:
  //    訊息說「1 件」而實際擋下 2 件 ⇒ **客人處理完那一件, 以為好了, 再按又被擋。**
  //    📌 一個**少報件數**的訊息, 比一個不指名的訊息更會讓他以為他處理完了。
  it('🔴 兩件被擋而只叫得出一件的名字 ⇒ 整句退回不指名版, 不得講「1 件」', async () => {
    setCart([
      { productId: 'p1', qty: 1 },
      { productId: 'p2', qty: 1 },
    ]);
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit({
        ...ARGS,
        // p2 叫不出名字(模擬它不在 cart.lines 裡 —— useResolvedCart 會濾掉 !found 的列)
        lineName: ({ productId }) => (productId === 'p1' ? '碳纖維護蓋' : undefined),
      });
    });
    const state = result.current.state;
    const msg = state.status === 'error' ? state.message : '';
    // 🎯 判別點:**不得出現「1 件」那種少報**, 也不得只列一個名字當成全部。
    expect(msg).not.toContain('1 件');
    expect(msg).not.toContain('碳纖維護蓋');
    expect(msg).toContain('購物車有商品缺少規格資訊');
    expect(msg, '退回不指名版也要留著出路').toContain('聯繫客服 LINE');
  });

  // 🔴🔴 **codex must-fix 1 的守門, 而它【差一點沒被加上】——**
  //    我跑突變時把 try/catch 拿掉 ⇒ **27 格全綠** ⇒ 那一格原本零守門。
  //    而同一發突變的「還原」我用了一個**過期的備份**(它早於 try/catch 那次修改)
  //    ⇒ 🛑 **修法被靜靜還原掉了, 而測試不會紅** —— 兩個病剛好互相掩護。
  //    ⇒ 📌 **一個沒有守門的修法, 在還原出錯時連「它不見了」都沒有訊號。**
  it('🔴 lineName 自己 throw ⇒ 仍要擋下、仍要有訊息(不可以把整條路弄啞)', async () => {
    setCart([{ productId: 'p1', qty: 1 }]);
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      const ok = await result.current.submit({
        ...ARGS,
        lineName: () => {
          throw new Error('呼叫端的解析壞了');
        },
      });
      // 🎯 判別點一:**不可以往上丟** —— 丟出去 ⇒ 付款 action 零呼叫而畫面一句話都沒有。
      expect(ok).toBe(false);
    });
    const state = result.current.state;
    // 🎯 判別點二:畫面上要有話, 而且是退回不指名的那一版 + 出路還在。
    expect(state.status).toBe('error');
    const msg = state.status === 'error' ? state.message : '';
    expect(msg).toContain('購物車有商品缺少規格資訊');
    expect(msg).toContain('聯繫客服 LINE');
  });

  // 🔴🔴 **這一格是 code-reviewer must-fix 3 —— 而它守的是【錢】那一側,不是文案。**
  //    本片把 `inFlightRef.current = false` 搬到新分支上, 而**缺規格三格各只呼叫一次 `submit`**
  //    ⇒ 把那一行刪掉 ⇒ **三格全綠**。而它掉了的後果:
  //    第二發 `submit` 走 `return true`(已上鎖)⇒ `CheckoutView` 的 `finally if (!terminal)`
  //    不解鎖 ⇒ **付款鈕永久 disabled** —— 本檔上方逐字記著的那個「永久鎖死」。
  //    ⇒ 📌 **一行搬家, 而承重的是它;而三綠對它零判別力。**
  it('🔴 被擋下之後【鎖要放掉】—— 客人改完再按一次要能真的送出(不是永久 disabled)', async () => {
    setCart([{ productId: 'p1', qty: 1 }]);
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      expect(await result.current.submit(ARGS), '第一發:缺規格 ⇒ 擋下, 回 false').toBe(false);
    });
    // 🎯 第二發是判別點:鎖沒放掉的話這裡會拿到 `true`(= 「已上鎖, 呼叫端不得釋放自身鎖」),
    //    而畫面上的付款鈕就再也按不下去。
    await act(async () => {
      expect(await result.current.submit(ARGS), '第二發:鎖已放掉 ⇒ 仍走驗證、仍回 false').toBe(false);
    });
  });

  it('🔵 負對照:呼叫端沒給 lineName ⇒ 退回不指名的版本, 而**仍然擋下來**', async () => {
    setCart([{ productId: 'p1', qty: 1 }]);
    const { result } = renderHook(() => useChargePayment());
    await act(async () => {
      await result.current.submit(ARGS);
    });
    const state = result.current.state;
    expect(state.status).toBe('error');
    const msg = state.status === 'error' ? state.message : '';
    expect(msg).toContain('購物車有商品缺少規格資訊');
    // 🔴 而出路那半在兩個世界都要有 —— 少了這行, 一個「叫不出名字就不給出路」的實作會全綠。
    expect(msg).toContain('聯繫客服 LINE');
  });
});
