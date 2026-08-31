import type { AdminCustomerFilter } from '@pcm/domain';

// gender-filter-flag.ts — `:573` 段③ 的【部署順序閘】。
//
// ══ 🔴 這顆旗標存在的唯一理由:碼會比 DB 先上 ═══════════════════════════════
//   `.eq('gender', …)` 打的是 view `admin_customer_list_v`,而那一欄要等
//   `20260901010000` 被 Sean 手貼 apply 之後才存在。
//   ⇒ 中間那段期間,一個沒有閘的下拉 = **員工按下去 ⇒ PostgREST 42703 ⇒ 整頁炸掉**。
//
//   🛑 而**「等 apply 完再推」不是解法** —— 那是一句**要記得的話**,
//      而 2026-08-31 當晚已經發生過一次同型(3a/3b 的 apply 順序)。
//   ⇒ 判準是【忘記的時候會發生什麼】:
//        忘了推碼   ⇒ 下拉不出現 ⇒ 沒有人受傷
//        忘了開 env ⇒ 下拉不出現 ⇒ 沒有人受傷
//        沒有閘     ⇒ 炸頁
//      (Sean 的窗 `-24` 2026-09-01 裁 `Q-573-2`=甲,理由逐字採用。)
//
// ══ ⚠️ 而這顆閘【擋不到】什麼 ═══════════════════════════════════════════════
//   ① 它擋的是**我們自己的 UI 與查詢**。有人手打 `?gender=male` 進網址時,
//      擋住的是 `page.tsx` 那一行抹除,**不是這支檔** —— 這支只回答「開了沒」。
//   ② 🔴 **開了旗標而 view 上沒有那一欄 ⇒ 照樣炸。**
//      這顆旗標不會去查資料庫,它**只是一個開關**;
//      ⇒ **開它的人負責先確認 apply 過了。**那一步沒有機制盯著。
//   ③ 兩個呼叫端(顯示那半 / 查詢那半)各自呼叫本函式 ——
//      🔴 **「兩半呼叫同一支函式」不等於「兩半綁在一起」**。真正把它們綁住的是
//      `customer-gender-filter-flag.test.tsx` 那支:旗標關掉時,
//      **下拉不得出現 __且__ 查詢不得帶 gender**,兩件事在同一格裡驗。

/**
 * 段③ 性別篩選開了沒。
 *
 * 🔴 `'1'` 才算開 —— 白名單,不是「有設就算」。
 *    `ADMIN_CUSTOMER_GENDER_FILTER=0` / `=false` / `=""` 一律當關,
 *    因為「有設就算」會讓一個寫錯的值靜靜地把閘打開。
 */
export function genderFilterEnabled(): boolean {
  return process.env.ADMIN_CUSTOMER_GENDER_FILTER === '1';
}

/**
 * 閘關著時,把 `gender` 從 filter 上拿掉。
 *
 * 🔴🔴 **這支函式存在的理由是 codex R1 must-fix(2026-09-01)**:
 *    上一版這一行**寫在 `page.tsx` 裡**,而測試檔自己**重抄了一份一樣的邏輯**去驗。
 *    codex 逐字:「刪掉正式頁面的抹除,這支仍全綠,因此沒有真的綁住『顯示』與『查詢』」。
 *    📌 **⇒ 我測的是我自己抄的那一份,不是產品跑的那一份。**
 *       而那與「沒有測試」的差別是:**它會印一個綠,讓人停止檢查。**
 *    ⇒ 抽出來之後,測試碰得到產品那一份;而**「`page.tsx` 有沒有呼叫它」**
 *      是另一個宣稱,由 `gender-filter-flag.test.ts` 的原始碼掃描那一格盯著。
 *
 * ⚠️ 型別上它回 `AdminCustomerFilter`,而 `gender` 被設成 `undefined` 而不是刪除 key ——
 *    兩者對 `.eq()` 那一側等價(adapter 判的是 `!== undefined`),而保留 key
 *    讓「這一軸被閘關掉了」在 debug 時看得見。
 */
export function applyGenderGate(
  filter: AdminCustomerFilter,
  enabled: boolean,
): AdminCustomerFilter {
  return enabled ? filter : { ...filter, gender: undefined };
}
