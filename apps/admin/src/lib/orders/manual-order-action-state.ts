import type { ManualOrderSentCode } from './manual-order-repository';

// manual-order-action-state.ts — M12-A3-b:手動建單的**結果碼與路徑**(常數層)。
//
// 🔴🔴 **它為什麼必須是獨立一支檔,而不是住在 `manual-order-actions.ts` 裡**:
//    那支檔有 `'use server'`,而 Next 的規則是
//    **`Only async functions are allowed to be exported in a "use server" file.`**
//    ⇒ 常數 / 型別 / 純函式一個都不能從那裡匯出。
//
//    ⚠️ **而這件事我是【踩到才知道】的,寫下來免得下一個人重踩**:
//    M12-A2 交件時這五個東西就寫在 `manual-order-actions.ts` 裡,
//    **typecheck 綠、lint 綠、build 綠、admin 全套 4702 passed** ——
//    🔴 因為**那時沒有任何檔 import 它**。build 看不到一個沒有人載入的模組的匯出規則。
//    2026-08-24 一把它接進 `app/orders/new/page.tsx` ⇒ **當場 build 紅**,逐字:
//      `Error: Only async functions are allowed to be exported in a "use server" file.`
//    📌 這正是「**分階段的中間態沒有偵測器**」的一個實例 —— 而我自己就是那個中間態。
//    ⇒ 那個偵測器 = A3-c 要交的「action 有呼叫端」守門。
//
//    體例對照:`cancel-actions.ts` 只匯出一支 async(`:127`),常數全在 `cancel-action-state.ts`。
//    **那個拆法不是整理,是這條規則逼出來的。**

/** 表單頁路徑。 */
export const MANUAL_ORDER_PATH = '/orders/new';

/** 沒送到 RPC 的兩支:授權失敗 / 表單形狀不合。 */
export const MANUAL_ORDER_NOT_SENT_CODES = Object.freeze(['denied', 'invalid'] as const);
export type ManualOrderNotSentCode = (typeof MANUAL_ORDER_NOT_SENT_CODES)[number];

/** 送到 RPC 之後才失敗的六支(與 repository 的 `ManualOrderSentCode` 同一個集合)。 */
export const MANUAL_ORDER_SENT_CODES = Object.freeze([
  'concurrent',
  'mismatch',
  'exhausted',
  'rejected',
  'bug',
  'error',
] as const);

export const MANUAL_ORDER_RESULT_PARAM = 'r';

/**
 * 失敗導頁時把**冪等鍵**帶回表單頁的 query 參數。
 *
 * 🔴🔴 **它不是加值,是讓兩句話變成真的**:
 *   · `concurrent` 的文案叫員工「**再按一次送出**」—— 而那句話只有在【鍵沒變】時才成立。
 *     表單頁每次 render 都鑄一顆新 uuid ⇒ 他「再按一次」會拿到**新鍵** ⇒ **建出第二張真訂單**。
 *   · `error` 的文案逐字寫著「編號不變,不會建成兩張」—— 少了本參數,**那句話是假的**。
 *   ⇒ 這兩句文案與本參數是**同一件事的兩半**,不得只改一半。
 *
 * ⚠️ **可偽造性**:`?mrid=` 是任何人都能自己打的字。而它的最壞後果**有界**:
 *   同鍵同內容 ⇒ RPC 回 idempotent(不會多建);同鍵不同內容 ⇒ `P858B` 拒絕。
 *   ⇒ 它挑不出「多建一張單」這個結果。**而客人資料一個字都沒有進 URL**(這是我們自己產的 uuid)。
 */
export const MANUAL_ORDER_REQUEST_ID_PARAM = 'mrid';

/**
 * 結果碼加前綴。
 *
 * 🔴 **前綴不是裝飾**:`?r=` 是共用參數,同一批頁面上還有取消片 / 改金額片 / 上下架片的碼在跑。
 *    不加前綴的話 `denied` / `invalid` / `error` 會被多條線同時認領,
 *    而**各線的下一步不一樣** —— 那種撞號在畫面上長得像「訊息偶爾會不對」。
 *    零碰撞由 `result-banner.test.tsx` 的鍵集合比對釘住。
 */
export function manualOrderResultCode(
  code: ManualOrderNotSentCode | ManualOrderSentCode,
): string {
  return `manual_order_${code}`;
}

export function manualOrderResultQuery(
  code: ManualOrderNotSentCode | ManualOrderSentCode,
  /**
   * 🔴 有鍵就帶。
   * · 送到過 RPC 的六支:一定有(解析成功過)。
   * · `invalid`:**表單上那顆若是合法 uuid 就帶**(codex R1 must-fix 之後改的)——
   *   只缺一個必填欄就換新鍵的話,另一分頁若已用舊鍵送成功,他補完再送會建出第二張。
   * · `denied`:**沒有**。那條路上一個欄位都還沒讀(授權閘絕對第一)。
   */
  manualRequestId?: string,
): string {
  const base = `${MANUAL_ORDER_RESULT_PARAM}=${manualOrderResultCode(code)}`;
  return manualRequestId === undefined
    ? base
    : `${base}&${MANUAL_ORDER_REQUEST_ID_PARAM}=${encodeURIComponent(manualRequestId)}`;
}
