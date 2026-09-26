// @vitest-environment jsdom
// Turnstile 元件(2026-09-26 資安修正片 1):沒設 site key 就完全不出現;有 site key 時驗證碼一次一用。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { Turnstile, TURNSTILE_NEEDS_INTERACTION, TURNSTILE_NOT_READY, TURNSTILE_TOKEN_WAIT_MS, type TurnstileHandle } from './Turnstile';

type RenderOptions = {
  sitekey: string;
  appearance: string;
  'retry-interval': number;
  callback: (t: string) => void;
  'error-callback': () => void;
  'before-interactive-callback': () => void;
  'after-interactive-callback': () => void;
};

let lastOptions: RenderOptions | null = null;
const api = {
  render: vi.fn((_el: HTMLElement, o: Record<string, unknown>) => {
    lastOptions = o as unknown as RenderOptions;
    return 'widget-1';
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  lastOptions = null;
  api.render.mockClear();
  api.reset.mockClear();
  api.remove.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete window.turnstile;
});

describe('Turnstile', () => {
  it('🔴 沒設 NEXT_PUBLIC_TURNSTILE_SITE_KEY ⇒ 不顯示任何東西, getToken 照送、不帶驗證碼', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    const ref = createRef<TurnstileHandle>();
    const { container } = render(<Turnstile ref={ref} />);
    expect(container.innerHTML).toBe('');
    await expect(ref.current!.getToken()).resolves.toEqual({ ready: true, token: undefined });
  });

  it('有 site key ⇒ 用 interaction-only 渲染;拿到驗證碼後 getToken 回它', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-1');
    window.turnstile = api;
    const ref = createRef<TurnstileHandle>();
    await act(async () => {
      render(<Turnstile ref={ref} />);
    });
    expect(lastOptions?.sitekey).toBe('site-key-1');
    expect(lastOptions?.appearance).toBe('interaction-only');
    const pending = ref.current!.getToken();
    act(() => lastOptions!.callback('token-A'));
    await expect(pending).resolves.toEqual({ ready: true, token: 'token-A' });
  });

  it('🔴 reset ⇒ 舊驗證碼不能再用, 並請 Turnstile 重新驗證', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-1');
    window.turnstile = api;
    const ref = createRef<TurnstileHandle>();
    await act(async () => {
      render(<Turnstile ref={ref} />);
    });
    act(() => lastOptions!.callback('token-A'));
    await expect(ref.current!.getToken()).resolves.toEqual({ ready: true, token: 'token-A' });
    ref.current!.reset();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    const next = ref.current!.getToken();
    act(() => lastOptions!.callback('token-B'));
    await expect(next).resolves.toEqual({ ready: true, token: 'token-B' });
  });

  // 🔴 2026-09-26 期望值改過:以前逾時回 undefined、呼叫端照送 ⇒ 送出空的驗證碼一定被 Supabase 擋
  //    (正式站 captcha_failed「no captcha_token found」)。現在逾時回 ready:false, 呼叫端不送出、顯示那一句。
  it('🔴 等不到驗證碼 ⇒ 逾時後回 ready:false(不送出), 不卡住畫面', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-1');
    window.turnstile = api;
    const ref = createRef<TurnstileHandle>();
    await act(async () => {
      render(<Turnstile ref={ref} />);
    });
    const pending = ref.current!.getToken();
    vi.advanceTimersByTime(TURNSTILE_TOKEN_WAIT_MS);
    await expect(pending).resolves.toEqual({ ready: false, message: TURNSTILE_NOT_READY });
    vi.useRealTimers();
  });
});

// 2026-09-26 上線後修正:正式站登入間歇性被 Supabase 以 captcha_failed「no captcha_token found」擋下。
// 瀏覽器實測(Cloudflare 測試 site key 2x…AB 永遠失敗):修正前 7 秒後送出 "$undefined";修正後不送出。
describe('Turnstile · 不交出空的驗證碼', () => {
  async function mount() {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-1');
    window.turnstile = api;
    const ref = createRef<TurnstileHandle>();
    await act(async () => {
      render(<Turnstile ref={ref} />);
    });
    return ref;
  }

  it('出錯時讓 Cloudflare 自己重試, 而且重試間隔比等待上限短', async () => {
    await mount();
    expect(lastOptions!['retry-interval']).toBeLessThan(TURNSTILE_TOKEN_WAIT_MS);
  });

  it('🔴 元件出錯(error-callback)⇒ 等待中的送出不會拿到空的驗證碼, 等重試成功後拿到新的', async () => {
    const ref = await mount();
    const pending = ref.current!.getToken();
    let settled = false;
    void pending.then(() => (settled = true));
    act(() => lastOptions!['error-callback']());
    await Promise.resolve();
    expect(settled).toBe(false);
    act(() => lastOptions!.callback('token-after-retry'));
    await expect(pending).resolves.toEqual({ ready: true, token: 'token-after-retry' });
  });

  it('🔴 元件出錯後一直沒恢復 ⇒ 逾時回 ready:false', async () => {
    vi.useFakeTimers();
    const ref = await mount();
    act(() => lastOptions!['error-callback']());
    const pending = ref.current!.getToken();
    vi.advanceTimersByTime(TURNSTILE_TOKEN_WAIT_MS);
    await expect(pending).resolves.toEqual({ ready: false, message: TURNSTILE_NOT_READY });
    vi.useRealTimers();
  });

  it('🔴 需要勾選 ⇒ 等待中與之後的送出立刻回「請先勾選」;勾完拿到驗證碼就照送', async () => {
    const ref = await mount();
    const pending = ref.current!.getToken();
    act(() => lastOptions!['before-interactive-callback']());
    await expect(pending).resolves.toEqual({ ready: false, message: TURNSTILE_NEEDS_INTERACTION });
    await expect(ref.current!.getToken()).resolves.toEqual({ ready: false, message: TURNSTILE_NEEDS_INTERACTION });
    act(() => lastOptions!['after-interactive-callback']());
    act(() => lastOptions!.callback('token-ticked'));
    await expect(ref.current!.getToken()).resolves.toEqual({ ready: true, token: 'token-ticked' });
  });

  it('瀏覽器不支援 Turnstile ⇒ 照送、不帶驗證碼(不讓客人每次等 10 秒)', async () => {
    const ref = await mount();
    const pending = ref.current!.getToken();
    act(() => (lastOptions as unknown as Record<string, () => void>)['unsupported-callback']!());
    await expect(pending).resolves.toEqual({ ready: true, token: undefined });
    await expect(ref.current!.getToken()).resolves.toEqual({ ready: true, token: undefined });
  });

  it('Cloudflare 腳本載入失敗 ⇒ 照送、不帶驗證碼(由 Supabase 決定;保留退回方案)', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-1');
    const ref = createRef<TurnstileHandle>();
    render(<Turnstile ref={ref} />);
    const pending = ref.current!.getToken();
    const s = document.head.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]');
    expect(s).not.toBeNull();
    act(() => s!.onerror!(new Event('error')));
    await expect(pending).resolves.toEqual({ ready: true, token: undefined });
    s!.remove();
  });
});
