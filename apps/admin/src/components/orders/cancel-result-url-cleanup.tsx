'use client';

import { useEffect } from 'react';
import {
  CANCEL_REQUEST_TOKEN_PARAM,
  CANCEL_RESULT_PARAM,
} from '../../lib/orders/cancel-action-state';

// cancel-result-url-cleanup.tsx — M-4b E10 **A13b D5**:面板顯示過後把 `?r=` / `?rt=` 從網址上抹掉。
//
// 🔴🔴 **這是 UX,不是安全前提**(plan §1b v3 明改):v2 曾把「看過即清除」當成防重播的一環,
//    v3 把它**降級** —— 安全論證改成「重播/重整只會重跑帳本核對,看到的永遠是帳本的真話」。
//    ⇒ 這支檔壞掉、被 disable、或使用者關掉 JS,**都不會讓任何判定變不安全**,
//      只會讓網址上多留兩個參數、重整時面板再出現一次。
//
// 🔴 **為什麼是 client 而且只能是 client**(plan 要求「client/server 兩案實測後挑」的處置):
//    ⚠️ 我**沒有**跑真瀏覽器實測就下這個結論,理由是 server 案**在結構上就不成立**、不需要量:
//    server 端要清掉 query 只有 `redirect()` 一條路,而 redirect 發生在**渲染期** ——
//    面板還沒送到瀏覽器就被換頁了 ⇒ 員工**永遠看不到那則訊息**。
//    那不是「效果比較差」,是「把功能本身刪掉」⇒ 兩案不對等,沒有可比的量。
//    ⇒ 照 `E-031-A` 的先例(要起真 admin 才量得到的東西不在本線量),
//      **把「為什麼不用量」寫下來**,而不是宣稱量過。
//
// 🔴 **`replaceState` 不是 `pushState`**:用 push 會多塞一筆歷史 ⇒ 員工按返回鍵回到帶參數的網址、
//    面板再冒出來一次,而且那顆返回鍵原本要帶他回表單。
//
// ⚠️ **意圖是「只動網址列、不重新取資料」** —— 面板上的字是這次渲染就算好的,
//    清網址不該讓畫面重跑一次。
//    🔴 **「`replaceState` 不會觸發 Next 導航」這句我沒有實測、標未確認**(R1 nit 5):
//    Next 會 patch history API,jsdom 測不到(測試環境沒有 Next router)。
//    ⇒ 這條若不成立,症狀是**多一次無謂的資料重取**(UX 成本),不影響任何判定 ——
//    本檔整支都是 UX 層、不是安全前提(見上)。要確認得在真 admin 上看 network,
//    照 `E-031-A` 排在 #350 線下。
//    ⓘ `window.history.state` 原樣帶回是刻意的:不覆寫 Next 放在 state 裡的內部資料。

/**
 * 要從網址上抹掉的 query 參數。
 *
 * 🔴 **從 `cancel-action-state.ts` 取常數、不在這裡各打一次字面**:同一組 `r`/`rt`
 *    有三個角色(建構器**組**、面板**讀**、本檔**刪**)。三邊各寫一份字面時,
 *    改了任何一邊而漏掉另一邊 = 「網址永遠清不掉」,而**四閘全綠、沒有東西會轉紅**。
 */
const RESULT_PARAMS = [CANCEL_RESULT_PARAM, CANCEL_REQUEST_TOKEN_PARAM] as const;

export function CancelResultUrlCleanup() {
  useEffect(() => {
    const url = new URL(window.location.href);
    // 🔴 先判斷「真的有東西要刪」再動手:沒有這道的話,每次 render 都會寫一次 history,
    //    在 React 嚴格模式的雙呼叫下也會多寫一次 —— 沒有可見症狀,但那是白工。
    const hasAny = RESULT_PARAMS.some((key) => url.searchParams.has(key));
    if (!hasAny) return;
    for (const key of RESULT_PARAMS) url.searchParams.delete(key);
    // 🔴 保留其餘 query(例如 `?correct=`、分頁參數)—— 只刪自己這兩顆,不整段清空。
    window.history.replaceState(window.history.state, '', url.toString());
  }, []);

  return null;
}
