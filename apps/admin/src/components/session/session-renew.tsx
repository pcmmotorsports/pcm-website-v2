'use client';

import { useEffect } from 'react';

// B5-b′ 片二:**靜默續期**的前端那一半。
//
// 🔴 **它與 TTL 縮短【必須一起出】**:只縮短不續期 ⇒ 每人每天被打斷約 32 次(`8h ÷ 15min`)。
//    plan `docs/specs/2026-08-26-m4b-e8b-b5b-piece2-plan.md` §0。
//
// 🔴🔴 **`redirect: 'manual'` 不是風格,是這一片的承重件。**
//    2026-08-26 實測到的鏈:
//    ```
//    票過期 ⇒ proxy 回 303 ⇒ /api/sso/start ⇒ 302 ⇒ 跨來源到報價單站
//    ```
//    而 `fetch()` **預設會跟著 redirect 走** ⇒ 跟到跨來源那一跳 ⇒ CORS 擋住
//    ⇒ **失敗是不透明的**:拿不到狀態碼、看不出發生什麼。
//    ⇒ 用 `manual` ⇒ 那個 303 會變成一個**看得見的 `type: 'opaqueredirect'`**
//      ⇒ 我們就分得出「**我來晚了**」與「**網路壞了**」。
//    📌 **這兩件事的處置完全不同**:來晚了要讓他重新登入;網路壞了應該再試一次。
//      分不出來的話,只能二選一猜 —— 而猜錯的那一半會很難查。

/** 多久檢查一次要不要續。**不是 TTL** —— 是「巡邏」的間隔。 */
const CHECK_INTERVAL_MS = 60_000;

/**
 * 剩多少秒以內就去續。
 *
 * ⚠️ **這個值要大於 `CHECK_INTERVAL_MS`**,否則會有一整個巡邏週期落在窗口外面
 * ⇒ 票在兩次巡邏之間過期,而我們從來沒試過續它。
 * 🔴 而它也要**明顯小於 TTL(15 分鐘)**,否則等於每次巡邏都在續 —— 那是無謂的 DB 查詢。
 */
const RENEW_WHEN_REMAINING_SEC = 300; // 5 分鐘

/**
 * 靜默續期。**不渲染任何東西。**
 *
 * ⚠️ **本元件不讀票、也不解析票** —— 它不知道還剩幾秒。
 *    ⇒ 那個判斷在 server(`/api/session/renew` 自己驗)。
 *    ⇒ 📌 前端若自己解析票來判斷,就會有**兩個地方**決定「還剩多久」,而它們會漂。
 *      這裡的策略因此是**定期問一次**,由 server 回答「續了 / 不能續」。
 */
export function SessionRenew(): null {
  useEffect(() => {
    let stopped = false;

    async function tick(): Promise<void> {
      if (stopped) return;
      try {
        const res = await fetch('/api/session/renew', {
          method: 'POST',
          // 🔴 見檔頭:沒有這一行,失敗會變成不透明的網路錯誤。
          redirect: 'manual',
          headers: { 'x-renew-remaining-hint': String(RENEW_WHEN_REMAINING_SEC) },
        });

        // `opaqueredirect` = 我們被 proxy 導走了 = **票已經過期,我來晚了**。
        if (res.type === 'opaqueredirect') {
          stopped = true;
          return;
        }
        if (res.status === 401 || res.status === 403) {
          // 🔴 **不重試**:這兩種是「他不能續」,不是「這次沒成功」。
          //    重試只會每分鐘去敲一次 DB,而答案不會變。
          stopped = true;
          return;
        }
      } catch {
        // 🔴 **網路錯誤 ⇒ 什麼都不做,下一輪再試。**
        //    這一支【不得】把使用者導走 —— 它不知道是票的問題還是網路的問題,
        //    而猜錯的那一半(網路抖一下就把人踢去登入)比不做更糟。
      }
    }

    const id = setInterval(() => void tick(), CHECK_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
