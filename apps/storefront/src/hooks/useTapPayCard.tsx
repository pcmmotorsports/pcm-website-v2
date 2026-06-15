'use client';

// useTapPayCard.tsx — TapPay Fields SDK 整合 hook(M-3 ②-④a;.tsx 取 react-hooks 規則守門)
//
// 🔴 卡資料零進 React state / 零進我方 DOM(kickoff §3 ①):卡號/有效期/CVV 由 TapPay 三個
// iframe(掛進 .tpfield 容器)收;本 hook 只持有「欄位狀態」(canGetPrime/各欄 status code)
// 與 getPrime 的一次性 token —— PAN/CVV 永不經過我方 JS context。
//
// SDK 機制(context7 對官方 example v5.19.2 確認、2026-06-12;plan ②-④ 頭註):
// - script `https://js.tappaysdk.com/sdk/tpdirect/v5.19.2` 動態注入(id 防重、Promise 化 onload)。
// - TPDirect.setupSDK(appId, appKey, env) → card.setup({fields:{number,expirationDate,ccv},…})
//   → onUpdate(update.canGetPrime / status) → getPrime(result.status===0 → result.card.prime)。
// - 容器 `.tpfield`;SDK 對 focus 容器注入 `tappay-field-focus` class。
//
// env(client、public by design):NEXT_PUBLIC_TAPPAY_APP_ID / NEXT_PUBLIC_TAPPAY_APP_KEY /
// NEXT_PUBLIC_TAPPAY_ENV(🔴 fallback 'sandbox' fail-safe —— 缺值/非法值絕不誤打 production)。
// APP_ID/KEY 缺 → ready:'error'(呼叫端渲染「付款模組未設定」、不掛頁)。
//
// React StrictMode 雙掛載防重:setup 前清容器 innerHTML(殘留 iframe 移除)+ 以 selector 重 setup;
// script 注入以 id 查重、loader promise 模組級共享(單次載入)。
//
// 🔴 getPrime:promise 化 + 15s timeout 兜底;失敗回 null + 友善錯誤(不洩 result.msg 原文、
// log 僅 status code;prime 不入 log)。

import { useCallback, useEffect, useRef, useState } from 'react';

const SDK_URL = 'https://js.tappaysdk.com/sdk/tpdirect/v5.19.2';
const SDK_SCRIPT_ID = 'tappay-sdk-v5';
const GET_PRIME_TIMEOUT_MS = 15_000;

/** 三個 iframe 容器的 DOM id(TapPayCardFields 渲染、本 hook setup 引用)。 */
export const TAPPAY_FIELD_IDS = {
  number: 'tappay-card-number',
  expirationDate: 'tappay-card-expiration-date',
  ccv: 'tappay-card-ccv',
} as const;

export type TapPayCardState = {
  /** 'loading' SDK 載入/設定中;'ready' 卡欄可用;'error' env 缺/SDK 載入失敗(渲染錯誤態、不掛頁)。 */
  ready: 'loading' | 'ready' | 'error';
  /** 三欄皆 valid → 可取 prime(確認付款鈕 gate;鏡像官方 example disabled 行為)。 */
  canGetPrime: boolean;
  /** 各欄狀態碼(2=error 時 UI 可標紅;0=valid/1=empty/3=typing)。 */
  fieldStatus: { number: TapPayFieldStatusCode; expiry: TapPayFieldStatusCode; ccv: TapPayFieldStatusCode };
};

export type UseTapPayCard = TapPayCardState & {
  /** 取一次性 prime token;欄位未齊/SDK 未就緒/TapPay 拒/timeout → null(呼叫端顯友善錯誤)。 */
  getPrime: () => Promise<string | null>;
};

// 模組級 script loader(單次載入、跨掛載共享)。
let sdkLoaderPromise: Promise<boolean> | null = null;
function loadSdkScript(): Promise<boolean> {
  if (window.TPDirect) return Promise.resolve(true);
  if (sdkLoaderPromise) return sdkLoaderPromise;
  sdkLoaderPromise = new Promise<boolean>((resolve) => {
    const existing = document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.id = SDK_SCRIPT_ID;
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => resolve(Boolean(window.TPDirect)), { once: true });
    script.addEventListener('error', () => {
      // 失敗不永久快取(code-reviewer minor):清 promise + 壞節點,SPA 內下次掛載可重試。
      sdkLoaderPromise = null;
      script.remove();
      resolve(false);
    }, { once: true });
  });
  return sdkLoaderPromise;
}

/** 讀 client env(public);ENV 非法/缺 → 'sandbox' fail-safe。 */
function readClientEnv(): { appId: number; appKey: string; env: 'sandbox' | 'production' } | null {
  const appId = Number(process.env.NEXT_PUBLIC_TAPPAY_APP_ID);
  const appKey = process.env.NEXT_PUBLIC_TAPPAY_APP_KEY ?? '';
  if (!Number.isInteger(appId) || appId <= 0 || !appKey) return null;
  const rawEnv = process.env.NEXT_PUBLIC_TAPPAY_ENV;
  return { appId, appKey, env: rawEnv === 'production' ? 'production' : 'sandbox' };
}

/**
 * @param active 卡欄容器是否在 DOM(View 的 step===3):false 不載 SDK 不 setup(容器不存在時
 *   card.setup 會失敗);true→false→true(步驟往返)重 setup(先清容器殘留 iframe)。
 */
export function useTapPayCard(active: boolean): UseTapPayCard {
  const [state, setState] = useState<TapPayCardState>({
    ready: 'loading',
    canGetPrime: false,
    fieldStatus: { number: 1, expiry: 1, ccv: 1 },
  });
  // onUpdate 無官方解除 API → 非 active/卸載後以 ref 擋 setState(防殘留更新)。
  const mountedRef = useRef(true);
  // 🔴 setup 世代戳(codex 關卡2 r1+r2):重 setup 後 SDK 內舊 onUpdate callback 仍存活,
  // 步驟往返再 active 時 mountedRef 重回 true、單靠它擋不住舊 callback → 每輪 effect **進場即**
  // 遞增 generation(r2 must-fix:若等 setup 後才遞增,「effect 已進、新 setup 未完」空窗內
  // 舊 callback 仍通過比對、可把舊輪 canGetPrime 寫回誤開付款鈕)、callback/await 後續比對
  // 自己那輪的值、不等於現值即棄(只留最新一輪有效)。
  const setupGenerationRef = useRef(0);

  useEffect(() => {
    // 進場即翻新世代(含 active=false 輪):上一輪 onUpdate/async 殘留自此刻起全失效。
    const generation = ++setupGenerationRef.current;
    if (!active) {
      mountedRef.current = false;
      // 🔴 離開即清 state(審查側 MUST-FIX):iframe 已隨容器卸載,殘留 canGetPrime=true 會讓
      // step3 重入的**首 render**(active 輪 effect 重置跑在 render 後)顯示 stale enabled 付款鈕;
      // 此處清掉 → 重入首 render 即 disabled、待新 setup onUpdate 再開。
      setState({ ready: 'loading', canGetPrime: false, fieldStatus: { number: 1, expiry: 1, ccv: 1 } });
      return;
    }
    mountedRef.current = true;
    let cancelled = false;
    // 重置(code-reviewer minor):步驟往返後 iframe 重建為空、canGetPrime 殘留 true 會令鈕先 enabled
    // (getPrime 內二道閘雖擋、但顯誤導錯誤);回到初始 loading/false、待 onUpdate 再開。
    setState({ ready: 'loading', canGetPrime: false, fieldStatus: { number: 1, expiry: 1, ccv: 1 } });

    async function init() {
      const env = readClientEnv();
      if (!env) {
        if (mountedRef.current) setState((s) => ({ ...s, ready: 'error' }));
        return;
      }
      const loaded = await loadSdkScript();
      if (cancelled || generation !== setupGenerationRef.current) return;
      const tp = window.TPDirect;
      if (!loaded || !tp) {
        if (mountedRef.current) setState((s) => ({ ...s, ready: 'error' }));
        return;
      }
      tp.setupSDK(env.appId, env.appKey, env.env);
      // StrictMode 雙掛載/返回頁重掛:先清容器殘留 iframe、再 setup(SDK 無 teardown API)。
      for (const id of Object.values(TAPPAY_FIELD_IDS)) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
      }
      tp.card.setup({
        fields: {
          // placeholder = design CheckoutPage.jsx L406/413/419 字面(鐵則 1)。
          number: { element: `#${TAPPAY_FIELD_IDS.number}`, placeholder: '•••• •••• •••• ••••' },
          expirationDate: { element: `#${TAPPAY_FIELD_IDS.expirationDate}`, placeholder: 'MM / YY' },
          ccv: { element: `#${TAPPAY_FIELD_IDS.ccv}`, placeholder: '•••' },
        },
        // 🔴 iOS 卡欄字級 ≥16px:iframe input 走 TapPay 預設常 <16px → iOS Safari 點卡欄自動放大、年長者迷失;
        //    釘 16px 杜絕自動放大(Gemini 廣度 + 審查側 review-log §3 #1 驗證屬實)。
        styles: {
          input: { 'font-size': '16px' },
        },
        isMaskCreditCardNumber: true,
        maskCreditCardNumberRange: { beginIndex: 6, endIndex: 11 },
      });
      tp.card.onUpdate((update) => {
        // 舊輪 callback(SDK 不提供解除)在新一輪 effect 進場即棄用;只放行最新一輪。
        if (!mountedRef.current || generation !== setupGenerationRef.current) return;
        setState({
          ready: 'ready',
          canGetPrime: update.canGetPrime,
          fieldStatus: update.status,
        });
      });
      if (mountedRef.current && generation === setupGenerationRef.current) {
        setState((s) => ({ ...s, ready: 'ready' }));
      }
    }

    void init();
    return () => {
      mountedRef.current = false;
      cancelled = true;
    };
  }, [active]);

  const getPrime = useCallback((): Promise<string | null> => {
    const tp = window.TPDirect;
    if (!tp || !tp.card.getTappayFieldsStatus().canGetPrime) {
      return Promise.resolve(null);
    }
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), GET_PRIME_TIMEOUT_MS);
      tp.card.getPrime((result) => {
        clearTimeout(timer);
        if (result.status !== 0 || !result.card?.prime) {
          // 🔴 只 log status code(不洩 msg 原文;prime 永不入 log)。
          console.error('[useTapPayCard] getPrime 失敗', { status: result.status });
          resolve(null);
          return;
        }
        resolve(result.card.prime);
      });
    });
  }, []);

  return { ...state, getPrime };
}
