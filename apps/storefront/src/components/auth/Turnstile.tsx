// Turnstile.tsx — Cloudflare Turnstile 人機驗證(2026-09-26 資安修正片 1)
//
// 為什麼要有它:註冊最後走 Supabase 的公開註冊入口, 拿網頁裡公開的 anon key 就能直接呼叫、繞過網站的 BotID
// (計畫 ~/pcm-mailbox/計畫-資安修正-註冊登入-20260926.md §三)。Supabase 開啟 CAPTCHA 之後, 註冊、登入、
// 重設密碼、重寄確認信都要帶這裡拿到的驗證碼, 直接呼叫的人拿不到就過不了。
//
// - `appearance: 'interaction-only'`:大多數時候自動通過、畫面上看不到;只有可疑連線才會出現勾選框。
// - 驗證碼只能用一次 ⇒ 呼叫端每【真的送出】一次都要 `reset()`, 下一次 `getToken()` 會拿新的。
// - 🔴 沒設 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ⇒ 什麼都不顯示、`getToken()` 回 { ready: true, token: undefined }:
//   網站那一側的開關(Cloudflare 腳本出問題時, 先在 Supabase 關 CAPTCHA、再刪這個 env 重新部署;計畫 §八)。
// - Cloudflare 腳本載入失敗(被擋)或瀏覽器不支援(unsupported-callback)也回 { ready: true, token: undefined }:
//   照送, 由 Supabase 決定。保留這一條是為了退回方案:腳本載入失敗時 Sean 在 Supabase 關掉 CAPTCHA, 登入就能馬上恢復。
// 🔴 退回方案的範圍(Fable R1 consider 1):腳本載到了、但 Cloudflare 一直出錯或卡住不回時, 這裡逾時回 ready:false,
//    呼叫端不送出 ⇒ 只關 Supabase 的 CAPTCHA 救不回來, 要照計畫 §八刪掉 NEXT_PUBLIC_TURNSTILE_SITE_KEY 並重新部署兩站。
// 🔴 2026-09-26 上線後修正(正式站 auth log:captcha_failed「no captcha_token found」):
//    以前元件出錯(error-callback)或等超過 8 秒就回 undefined, 呼叫端照送 ⇒ 空的驗證碼一定被 Supabase 擋。
//    可是元件出錯時 Cloudflare 會自己重試(retry 預設 auto), 需要勾選時也在等客人勾。
//    ⇒ 現在這兩種情況回 { ready: false, message }:呼叫端顯示那一句、不送出、也不 reset(reset 會把勾選框清掉)。
// - 不新增 npm 套件, 直接載入 Cloudflare 的腳本(explicit render)。

'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** 送出時還沒拿到驗證碼, 最多等這麼久;逾時就不帶, 由 Supabase 決定。 */
export const TURNSTILE_TOKEN_WAIT_MS = 10000;
/** 元件出錯後多久重試一次(Cloudflare 預設 8 秒, 比等待上限還久, 等於等不到重試)。 */
const RETRY_INTERVAL_MS = 2500;

/** 需要客人勾選、但還沒勾。 */
export const TURNSTILE_NEEDS_INTERACTION = '請先完成下方的人機驗證（勾選方框），再按一次。';
/** 元件出錯重試中、或等太久還沒拿到驗證碼。 */
export const TURNSTILE_NOT_READY = '人機驗證還沒完成，請稍等幾秒再按一次。若一直出現這句，請重新整理頁面。';

/**
 * ready:true ⇒ 照送(token 是 undefined 代表這一站沒開人機驗證, 或腳本載入失敗, 由 Supabase 決定)。
 * ready:false ⇒ 不要送出, 把 message 顯示給客人;也不要 reset。
 */
export type TurnstileResult = { ready: true; token: string | undefined } | { ready: false; message: string };

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
  /** 目前可用的驗證碼;還沒拿到就等(最多 `TURNSTILE_TOKEN_WAIT_MS`)。見 TurnstileResult。 */
  getToken(): Promise<TurnstileResult>;
  /** 驗證碼用過了:清掉並重新驗證。每次真的送出後都要呼叫;getToken 回 ready:false 時不要呼叫。 */
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
  // loading = 等驗證碼;interactive = 出現勾選框在等客人;error = 出錯, Cloudflare 會自己重試;unavailable = 腳本載入失敗
  const status = useRef<'loading' | 'interactive' | 'error' | 'unavailable'>('loading');
  const waiters = useRef<Array<(r: TurnstileResult) => void>>([]);

  const settle = (r: TurnstileResult) => {
    const pending = waiters.current;
    waiters.current = [];
    for (const w of pending) w(r);
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
          'retry-interval': RETRY_INTERVAL_MS,
          callback: (t: string) => {
            token.current = t;
            status.current = 'loading';
            settle({ ready: true, token: t });
          },
          'expired-callback': () => {
            token.current = undefined; // refresh-expired 預設 auto, 會自己換一顆
          },
          // 🔴 不回 true、也不結束等待:讓 Cloudflare 自己重試, 等待中的送出繼續等下一顆驗證碼
          'error-callback': () => {
            token.current = undefined;
            status.current = 'error';
          },
          'before-interactive-callback': () => {
            status.current = 'interactive';
            settle({ ready: false, message: TURNSTILE_NEEDS_INTERACTION });
          },
          'after-interactive-callback': () => {
            status.current = 'loading';
          },
          // 瀏覽器不支援 Turnstile ⇒ 等再久也拿不到, 照送由 Supabase 決定(同腳本載入失敗)
          'unsupported-callback': () => {
            status.current = 'unavailable';
            settle({ ready: true, token: undefined });
          },
        });
      })
      .catch(() => {
        status.current = 'unavailable';
        settle({ ready: true, token: undefined });
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      token.current = undefined;
      settle({ ready: false, message: TURNSTILE_NOT_READY }); // 呼叫端會先看元件還在不在, 不會顯示
    };
  }, [siteKey]);

  useImperativeHandle(
    ref,
    () => ({
      getToken() {
        if (!siteKey) return Promise.resolve({ ready: true, token: undefined });
        if (token.current) return Promise.resolve({ ready: true, token: token.current });
        if (status.current === 'unavailable') return Promise.resolve({ ready: true, token: undefined });
        if (status.current === 'interactive') return Promise.resolve({ ready: false, message: TURNSTILE_NEEDS_INTERACTION });
        return new Promise<TurnstileResult>((resolve) => {
          let done = false;
          const finish = (r: TurnstileResult) => {
            if (done) return;
            done = true;
            resolve(r);
          };
          waiters.current.push(finish);
          setTimeout(() => finish({ ready: false, message: TURNSTILE_NOT_READY }), TURNSTILE_TOKEN_WAIT_MS);
        });
      },
      reset() {
        token.current = undefined;
        status.current = 'loading';
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      },
    }),
    [siteKey],
  );

  if (!siteKey) return null;
  return <div ref={boxRef} className="auth-turnstile" />;
});
