// @vitest-environment jsdom
// Turnstile 元件(2026-09-26 資安修正片 1):沒設 site key 就完全不出現;有 site key 時驗證碼一次一用。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { Turnstile, type TurnstileHandle } from './Turnstile';

type RenderOptions = { sitekey: string; appearance: string; callback: (t: string) => void };

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
  it('🔴 沒設 NEXT_PUBLIC_TURNSTILE_SITE_KEY ⇒ 不顯示任何東西, getToken 回 undefined', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    const ref = createRef<TurnstileHandle>();
    const { container } = render(<Turnstile ref={ref} />);
    expect(container.innerHTML).toBe('');
    await expect(ref.current!.getToken()).resolves.toBeUndefined();
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
    await expect(pending).resolves.toBe('token-A');
  });

  it('🔴 reset ⇒ 舊驗證碼不能再用, 並請 Turnstile 重新驗證', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-1');
    window.turnstile = api;
    const ref = createRef<TurnstileHandle>();
    await act(async () => {
      render(<Turnstile ref={ref} />);
    });
    act(() => lastOptions!.callback('token-A'));
    await expect(ref.current!.getToken()).resolves.toBe('token-A');
    ref.current!.reset();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    const next = ref.current!.getToken();
    act(() => lastOptions!.callback('token-B'));
    await expect(next).resolves.toBe('token-B');
  });

  it('等不到驗證碼 ⇒ 逾時後回 undefined, 不卡住送出', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-1');
    window.turnstile = api;
    const ref = createRef<TurnstileHandle>();
    await act(async () => {
      render(<Turnstile ref={ref} />);
    });
    const pending = ref.current!.getToken();
    vi.advanceTimersByTime(8000);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
