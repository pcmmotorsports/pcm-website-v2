// Turnstile.tsx — Cloudflare Turnstile 人機驗證(2026-09-26 資安修正片 1)
//
// 為什麼要有它:註冊最後走 Supabase 的公開註冊入口, 拿網頁裡公開的 anon key 就能直接呼叫、繞過網站的 BotID
// (計畫 ~/pcm-mailbox/計畫-資安修正-註冊登入-20260926.md §三)。Supabase 開啟 CAPTCHA 之後, 註冊、登入、
// 重設密碼、重寄確認信都要帶這裡拿到的驗證碼, 直接呼叫的人拿不到就過不了。
//
// - `appearance: 'interaction-only'`:大多數時候自動通過、畫面上看不到;只有可疑連線才會出現勾選框。
// - 驗證碼只能用一次 ⇒ 呼叫端每送出一次都要 `reset()`, 下一次 `getToken()` 會拿新的。
// - 🔴 沒設 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ⇒ 什麼都不顯示、`getToken()` 回 undefined:網站那一側的開關
//   (Cloudflare 腳本出問題時, 先在 Supabase 關 CAPTCHA、再刪這個 env 重新部署;計畫 §八)。
// - 拿不到驗證碼(腳本被擋、逾時)也回 undefined:網站本身不擋, 由 Supabase 決定;
//   它擋下時客人看到的是 `AUTH_ERR_CAPTCHA_FAILED`。
// - 不新增 npm 套件, 直接載入 Cloudflare 的腳本(explicit render)。

'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** 送出時還沒拿到驗證碼, 最多等這麼久;逾時就不帶, 由 Supabase 決定。 */
export const TURNSTILE_TOKEN_WAIT_MS = 8000;

type TurnstileApi = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  /** 目前可用的驗證碼;還沒拿到就等(最多 `TURNSTILE_TOKEN_WAIT_MS`), 拿不到回 undefined。 */
  getToken(): Promise<string | undefined>;
  /** 驗證碼用過了:清掉並重新驗證。每次送出後都要呼叫。 */
  reset(): void;
};

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null; // 下次重新整理頁面或重新掛載時再試
        reject(new Error('turnstile script failed to load'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export const Turnstile = forwardRef<TurnstileHandle>(function Turnstile(_props, ref) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | undefined>(undefined);
  const waiters = useRef<Array<(t: string | undefined) => void>>([]);

  const settle = (t: string | undefined) => {
    const pending = waiters.current;
    waiters.current = [];
    for (const w of pending) w(t);
  };

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !boxRef.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(boxRef.current, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (t: string) => {
            token.current = t;
            settle(t);
          },
          'expired-callback': () => {
            token.current = undefined;
          },
          'error-callback': () => {
            token.current = undefined;
            settle(undefined);
          },
        });
      })
      .catch(() => settle(undefined));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      token.current = undefined;
      settle(undefined);
    };
  }, [siteKey]);

  useImperativeHandle(
    ref,
    () => ({
      getToken() {
        if (!siteKey) return Promise.resolve(undefined);
        if (token.current) return Promise.resolve(token.current);
        return new Promise<string | undefined>((resolve) => {
          let done = false;
          const finish = (t: string | undefined) => {
            if (done) return;
            done = true;
            resolve(t);
          };
          waiters.current.push(finish);
          setTimeout(() => finish(undefined), TURNSTILE_TOKEN_WAIT_MS);
        });
      },
      reset() {
        token.current = undefined;
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      },
    }),
    [siteKey],
  );

  if (!siteKey) return null;
  return <div ref={boxRef} className="auth-turnstile" />;
});
