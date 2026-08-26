'use client';

// ⚠️⚠️ **2026-08-27:本檔【在正式站上跑的那一版】與你眼前這一版不一樣。**
//    `5276411e`(片二)欠兩場審查就被推上 `origin/dev`(= pcm-admin 的 production 分支),
//    而補審抓到 **15 條 must-fix**。修在 `bc61afe6`,**而那一顆還沒推**。
//    🔴 最會咬人的一條:staff 表抖一次 ⇒ 每個開著的分頁**永久**停止續期 ⇒ 15 分鐘內全體被踢。
//    🔴 **這一段話會過期, 而過期時【沒有任何訊號】** —— 所以不要相信它, 自己跑這一行:
//       `git merge-base --is-ancestor bc61afe6 origin/dev && echo 已推 || echo 未推`
//       印「已推」⇒ 本段已完成任務, **請連同這幾行一起刪掉**。
//    📌 我今晚修的毛病裡有一條就是「一段被推翻的註解還留在檔案裡」(`callback/route.ts` 那段
//      『停用後最多 12 小時』, 舊字面算出來的數字大 48 倍)⇒ 本段自帶判別法, 是為了不變成第二條。

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
//
// ── 2026-08-27 補審(code-reviewer FAIL 七條)改了什麼 ────────────────────────
// 🔴 M1 **死碼**:原本這裡有一個 `RENEW_WHEN_REMAINING_SEC = 300`,而它只被塞進一個
//    **server 端沒有人讀**的 header(`x-renew-remaining-hint`;全 repo grep 只有那一行)。
//    ⇒ 註解宣稱「剩 5 分鐘內才續」,而實際行為是**每 60 秒無條件續一次**(每次一發 staff 查詢)。
//    ⇒ 現在那個門檻住在 server(`ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC`),還早就回 `fresh` 且不碰 DB。
// 🔴 M2 **回應 body 從來沒被讀**:route 費工回三種可分辨的 outcome,而這裡只看狀態碼
//    ⇒ `chain-expired` 與 `not-active` 走同一支 `stopped = true` ⇒ 那份契約沒有消費者。
// 🔴 M3 **`not-active` 不得當終局**:`resolveActiveStaffById` 對「被停用」與「DB 掛掉」
//    回**同一個 null**(既有歧義 `#933`,`staff.ts` 逐字寫著它是刻意複製的)
//    ⇒ 把 403 當終局 = staff 表抖兩秒就讓全體分頁永久停止續期 ⇒ 15 分鐘後全被踢去跑完整 SSO。
// 🔴 M4 **睡醒那一格**:原本只有 `setInterval` ⇒ 筆電闔上 20 分鐘, 計時器不跑, 醒來票早死了。
//    ⇒ 補上 mount 立刻跑一次 + 分頁回到前景時跑一次。
//    ⚠️ 而這**不等於**解決了「表單填一半掉資料」—— 那一格仍然【未量】(見 commit body)。

/** 多久檢查一次要不要續。**不是 TTL** —— 是「巡邏」的間隔。 */
const CHECK_INTERVAL_MS = 60_000;

/**
 * 連續被閘擋下幾次才放棄。
 *
 * 🔴 **為什麼不是 1**:`opaqueredirect` 對「票真的死了」與「那台 instance 讀不到 env」
 *    是**同一個形狀**。第一發就永久停 ⇒ 一次瞬時故障 = 那個分頁的人 15 分鐘後被登出。
 * 🔴 **為什麼不是無限**:票真的死了的話,再敲一萬次答案也一樣。
 */
const MAX_CONSECUTIVE_REDIRECTS = 3;

/**
 * 靜默續期。**不渲染任何東西。**
 *
 * ⚠️ **本元件不讀票、也不解析票** —— 它不知道還剩幾秒。
 *    ⇒ 那個判斷在 server(`/api/session/renew` 自己驗)。
 *    ⇒ 📌 前端若自己解析票來判斷,就會有**兩個地方**決定「還剩多久」,而它們會漂。
 *      這裡的策略因此是**定期問一次**,由 server 回答「續了 / 還早 / 不能續」。
 */
export function SessionRenew(): null {
  useEffect(() => {
    let stopped = false;
    // 🔴 **連續幾發被閘擋下才放棄**(codex 補審 nit)。
    //    原本第一發 `opaqueredirect` 就永久停 —— 而那個形狀**不只代表票死了**:
    //    proxy 對「secret 缺 / env 沒配好 / 簽章壞 / 版本被拒」印的是**同一個 303**。
    //    ⇒ 一台 instance 抖一下 ⇒ 這個分頁永遠不再續期 ⇒ 15 分鐘後那個人被登出。
    //    📌 又是那個母題:**錯的那次和對的那次長得一樣。** 分不出來時,
    //      代價小的那一邊是「多試兩次」,不是「立刻放棄」。
    let consecutiveRedirects = 0;

    async function tick(): Promise<void> {
      if (stopped) return;
      try {
        const res = await fetch('/api/session/renew', {
          method: 'POST',
          // 🔴 見檔頭:沒有這一行,失敗會變成不透明的網路錯誤。
          redirect: 'manual',
        });

        // `opaqueredirect` = 我們被 proxy 的登入閘導走了。
        // 這種 response **讀不到 body**(那正是 `redirect: 'manual'` 的用途),
        // 所以要在讀 body 之前就分出來。
        if (res.type === 'opaqueredirect') {
          consecutiveRedirects += 1;
          if (consecutiveRedirects >= MAX_CONSECUTIVE_REDIRECTS) stopped = true;
          return;
        }
        consecutiveRedirects = 0;

        // 🔴 **讀 body** —— 光看狀態碼分不出 `chain-expired` 與 `not-active`,
        //    而它們的處置相反(一個停、一個要繼續試)。
        //    body 不是 JSON(例如被誰換成一頁 HTML)⇒ null ⇒ 落到 default ⇒ 下一輪再試。
        const outcome: unknown = await res
          .json()
          .then((b: { outcome?: unknown }) => b?.outcome)
          .catch(() => null);

        switch (outcome) {
          case 'renewed':
          case 'fresh':
            // 續到了 / 還早。兩種都是「一切正常」,下一輪照常。
            return;
          case 'chain-expired':
            // 🔴 **這一種才是終局**:12 小時鏈上限到頂,再敲幾次答案都一樣。
            //    ⚠️ 而我們**不主動導頁** —— 導頁會把使用者填到一半的表單丟掉,
            //       而那正是這一片最不該造成的事。停止巡邏,讓下一次導頁走完整登入。
            stopped = true;
            return;
          default:
            // `not-active`(403)/ `error`(500)/ 讀不到 / 沒看過的值。
            // 🔴 **全部都不當終局** —— `not-active` 對「被停用」與「DB 掛掉」是同一個值(`#933`)
            //    ⇒ 猜「他被停用了」而停下來,會讓一次兩秒的 DB 抖動變成全體重新登入。
            //    真的被停用的話,proxy 的登入閘會在下一次導頁擋住他,不需要這裡動手。
            return;
        }
      } catch {
        // 🔴 **網路錯誤 ⇒ 什麼都不做,下一輪再試。**
        //    這一支【不得】把使用者導走 —— 它不知道是票的問題還是網路的問題,
        //    而猜錯的那一半(網路抖一下就把人踢去登入)比不做更糟。
      }
    }

    // 🔴 **mount 立刻跑一次**:`setInterval` 的第一發要等一整個間隔,
    //    而使用者可能是從一個放了很久的分頁回來的。
    void tick();

    // 🔴 **回到前景時再跑一次** —— 分頁在背景 / 筆電闔上時計時器不保證會跑
    //    ⇒ 醒來的第一秒票可能已經死了,而下一發巡邏還要等 60 秒。
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    const id = setInterval(() => void tick(), CHECK_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
