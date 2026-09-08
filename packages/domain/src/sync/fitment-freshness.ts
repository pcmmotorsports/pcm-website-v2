/**
 * 車款搜尋(fitment)同步的**新鮮度門檻** —— 單一來源。
 *
 * 🔴🔴 **為什麼住在 `@pcm/domain` 而不是 `apps/admin`**(2026-09-08 · 主視窗 A 裁「甲」):
 *    這個數同時被**兩個消費端**要用:
 *      ① `apps/admin/src/lib/dashboard/freshness-read.ts` —— 首頁那句「已 N 天沒有成功過」
 *      ② `packages/use-cases/src/check-anomaly-alerts.ts` —— 告警(`⟦b4-FITSYNC1⟧` ③)
 *    而**套件不能 import 應用程式** ⇒ 留在 admin 的話, 告警那側只能自己再定一個。
 *    🛑 **而那正是規格明文反對的**(`~/pcm-mailbox/規格-fitment告警那半-20260907.md` 逐字):
 *       「**不要另外造一份新的『幾天沒動』算法 —— 兩份會分岔, 而分岔沒有人會發現。**」
 *    📌 **⇒ 兩份的代價是【它今天看起來完全沒問題】** —— 那是最難反對的那一種代價。
 */

/**
 * 車款搜尋資料超過幾小時算「舊了」= **7 天**。
 *
 * 🔴 **7 是 Sean 給的數,不是我們算的** —— 他 2026-08-29 逐字答 `A: 7天`
 *    (題目原文「資料幾天沒更新,就算太舊該通知你?」;
 *     落點 `~/pcm-mailbox/等Sean決策-20260829.md` 的「✅ 已答:資料多久沒更新算太舊」那一節)。
 *    ⚠️ 對照 `FRESHNESS_STALE_HOURS` = 26(它留在 `apps/admin/src/lib/dashboard/freshness-read.ts`,
 *     因為只有首頁那一側用得到):**那個 26 是推的、這個 7 天是拍的。**
 *    ⛔ ~~原本這裡寫 `{@link FRESHNESS_STALE_HOURS}`~~ —— 搬進 domain 之後那個連結指不到,
 *       而**指不到的連結會讓人以為那句對照不存在** ⇒ 改成寫出它住在哪。
 *    ⇒ 要改這個數,是回去問他,不是自己重算。
 *
 * 🛑 **本段註解是【逐字搬過來的】, 一個字都沒有壓縮** —— 鐵則 6 逐字:
 *    「拆檔時註解必須跟著它解釋的那段碼搬;不得以壓縮/刪減註解作為降行手段」
 *    —— **那些註解裡住著 Sean 的拍板紀錄**, 而「刪註解」在 diff 上與「搬移」長得一樣。
 */
export const FITMENT_STALE_DAYS = 7;
export const FITMENT_STALE_HOURS = FITMENT_STALE_DAYS * 24;
