// @vitest-environment jsdom
//
// useTapPayCard hook test(M-3 ②-④a;SDK 以 window.TPDirect stub 注入、零真 script 載入)。
// 驗:
// ① env 缺 → ready:'error'(fail-safe、不掛頁)。
// ② active=false → 不 setupSDK(只在 step3 啟用)。
// ③ active=true + TPDirect 已在 → setupSDK(appId 數字化, key, 'sandbox' fallback)+ card.setup
//    (design placeholder 字面)+ onUpdate 映 state(canGetPrime/fieldStatus)。
// ④ getPrime:canGetPrime false → null;status≠0 → null(log 僅 status、零 msg/prime);
//    status 0 → 回 prime。
// ⑤ 容器殘留 iframe 於 setup 前被清(StrictMode/步驟往返防重)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';

import { useTapPayCard, TAPPAY_FIELD_IDS } from './useTapPayCard';

type OnUpdateCb = (u: {
  canGetPrime: boolean;
  status: { number: 0 | 1 | 2 | 3; expiry: 0 | 1 | 2 | 3; ccv: 0 | 1 | 2 | 3 };
}) => void;

function stubTPDirect(opts: { canGetPrime?: boolean; primeResult?: { status: number; msg?: string; card?: { prime: string } } } = {}) {
  const setupSDK = vi.fn();
  const setup = vi.fn();
  // SDK 無解除 API → 收集所有註冊過的 callback(驗 generation 戳棄舊輪)。
  const cbs: OnUpdateCb[] = [];
  const onUpdate = vi.fn((cb: OnUpdateCb) => {
    cbs.push(cb);
  });
  const getTappayFieldsStatus = vi.fn(() => ({
    canGetPrime: opts.canGetPrime ?? true,
    status: { number: 0, expiry: 0, ccv: 0 },
  }));
  const getPrime = vi.fn((cb: (r: unknown) => void) => {
    cb(opts.primeResult ?? { status: 0, card: { prime: 'prime_from_sdk' } });
  });
  window.TPDirect = {
    setupSDK,
    card: { setup, onUpdate, getTappayFieldsStatus, getPrime },
  } as unknown as typeof window.TPDirect;
  return { setupSDK, setup, onUpdate, getPrime, cbs, fireUpdate: (u: Parameters<OnUpdateCb>[0]) => cbs.at(-1)?.(u) };
}

function mountContainers() {
  for (const id of Object.values(TAPPAY_FIELD_IDS)) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TAPPAY_APP_ID', '11327');
  vi.stubEnv('NEXT_PUBLIC_TAPPAY_APP_KEY', 'app_test_key');
  vi.stubEnv('NEXT_PUBLIC_TAPPAY_ENV', '');
  mountContainers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (window as { TPDirect?: unknown }).TPDirect;
  document.body.innerHTML = '';
});

describe('useTapPayCard', () => {
  it('① env 缺(APP_ID 空)→ ready:error、零 setupSDK', async () => {
    vi.stubEnv('NEXT_PUBLIC_TAPPAY_APP_ID', '');
    const tp = stubTPDirect();
    const { result } = renderHook(() => useTapPayCard(true));
    await waitFor(() => expect(result.current.ready).toBe('error'));
    expect(tp.setupSDK).not.toHaveBeenCalled();
  });

  it('② active=false → 不 setupSDK(只在 step3 啟用)', async () => {
    const tp = stubTPDirect();
    renderHook(() => useTapPayCard(false));
    await act(async () => {});
    expect(tp.setupSDK).not.toHaveBeenCalled();
  });

  it('③ active → setupSDK(11327 數字, key, sandbox fallback)+ card.setup design placeholder + onUpdate 映 state', async () => {
    const tp = stubTPDirect();
    const { result } = renderHook(() => useTapPayCard(true));
    await waitFor(() => expect(result.current.ready).toBe('ready'));
    expect(tp.setupSDK).toHaveBeenCalledWith(11327, 'app_test_key', 'sandbox'); // ENV 空 → fallback sandbox
    const setupArg = tp.setup.mock.calls[0]![0] as {
      fields: Record<string, { element: string; placeholder: string }>;
      styles?: Record<string, Record<string, string>>;
    };
    expect(setupArg.fields.number).toEqual({
      element: `#${TAPPAY_FIELD_IDS.number}`,
      placeholder: '•••• •••• •••• ••••', // design L406 字面
    });
    expect(setupArg.fields.expirationDate!.placeholder).toBe('MM / YY');
    expect(setupArg.fields.ccv!.placeholder).toBe('•••');
    // 🔴 iOS 卡欄字級 ≥16px 防 Safari 自動放大(review-log §3 #1;regression guard)
    expect(setupArg.styles!.input!['font-size']).toBe('16px');

    await act(async () => {
      tp.fireUpdate({ canGetPrime: true, status: { number: 0, expiry: 0, ccv: 2 } });
    });
    expect(result.current.canGetPrime).toBe(true);
    expect(result.current.fieldStatus.ccv).toBe(2);
  });

  it('④ getPrime:status 0 → prime;status≠0 → null + log 僅 status;canGetPrime false → null', async () => {
    const tp = stubTPDirect();
    const { result } = renderHook(() => useTapPayCard(true));
    await waitFor(() => expect(result.current.ready).toBe('ready'));
    await expect(result.current.getPrime()).resolves.toBe('prime_from_sdk');

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    tp.getPrime.mockImplementation((cb: (r: unknown) => void) =>
      cb({ status: 2, msg: 'secret sdk message', card: { prime: 'leak_prime' } }),
    );
    await expect(result.current.getPrime()).resolves.toBeNull();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('2');
    expect(logged).not.toContain('secret sdk message'); // 零 msg 原文
    expect(logged).not.toContain('leak_prime'); // 零 prime

    (window.TPDirect!.card.getTappayFieldsStatus as ReturnType<typeof vi.fn>).mockReturnValue({
      canGetPrime: false,
      status: { number: 1, expiry: 1, ccv: 1 },
    });
    await expect(result.current.getPrime()).resolves.toBeNull();
  });

  it('⑤ setup 前清容器殘留(StrictMode/步驟往返防重)', async () => {
    document.getElementById(TAPPAY_FIELD_IDS.number)!.innerHTML = '<iframe title="stale"></iframe>';
    stubTPDirect();
    const { result } = renderHook(() => useTapPayCard(true));
    await waitFor(() => expect(result.current.ready).toBe('ready'));
    expect(document.getElementById(TAPPAY_FIELD_IDS.number)!.innerHTML).toBe('');
  });

  it('⑥ 步驟往返重 setup、舊輪 onUpdate callback 失效(generation 戳;codex 關卡2 r1+r2)', async () => {
    const tp = stubTPDirect();
    const { result, rerender } = renderHook(({ active }) => useTapPayCard(active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.ready).toBe('ready'));
    const oldCb = tp.cbs[0]!;
    rerender({ active: false });
    rerender({ active: true }); // 步驟往返 → effect 進場即翻新世代

    // 🔴 r2 must-fix 空窗:第二輪 setup 的 async 尚未必完成(新 callback 未必已註冊)、
    // mountedRef 已回 true —— 舊輪殘留此刻就必須被棄、不得把舊 canGetPrime 寫回誤開付款鈕。
    act(() => {
      oldCb({ canGetPrime: true, status: { number: 0, expiry: 0, ccv: 0 } });
    });
    expect(result.current.canGetPrime).toBe(false);

    await waitFor(() => expect(tp.cbs.length).toBe(2));
    await waitFor(() => expect(result.current.ready).toBe('ready'));
    await act(async () => {
      oldCb({ canGetPrime: true, status: { number: 0, expiry: 0, ccv: 0 } }); // setup 完成後舊輪仍棄
    });
    expect(result.current.canGetPrime).toBe(false);

    await act(async () => {
      tp.cbs[1]!({ canGetPrime: true, status: { number: 0, expiry: 0, ccv: 0 } }); // 最新一輪 → 放行
    });
    expect(result.current.canGetPrime).toBe(true);
  });

  it('⑦ active→false 即清 state(canGetPrime=false;step3 重入首 render 不顯 stale enabled 鈕;審查側 MUST-FIX)', async () => {
    const tp = stubTPDirect();
    const { result, rerender } = renderHook(({ active }) => useTapPayCard(active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.ready).toBe('ready'));
    await act(async () => {
      tp.fireUpdate({ canGetPrime: true, status: { number: 0, expiry: 0, ccv: 0 } });
    });
    expect(result.current.canGetPrime).toBe(true);

    rerender({ active: false }); // 離開 step3 → 同步清(重入首 render 讀到的就是 false)
    expect(result.current.canGetPrime).toBe(false);
    expect(result.current.ready).toBe('loading');
  });
});
