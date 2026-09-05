/**
 * 「手動建單可以不填 email = 不寄」—— 這一條的**唯一判準來源**。
 *
 * ## 它從哪來
 * Sean 拍板(逐字):**「可以不填 = 不寄」**。而 2026-09-05 開檔量到那條拍板
 * **一行實作都沒有** —— 不是被 fallback 蓋過去,是**從來沒有被實作過**
 * (板列 `⟦f3-MAILFALLBACKVSRULING⟧`;plan `docs/plans/2026-09-05-manual-order-notification-email-plan.md`)。
 *
 * ## 🔴🔴 判準是【兩個條件】,不是一個
 * ```
 * 這張單是手動建的(order_source 是 manual_*)
 * 【而且】notification_email 為空
 * ⇒ 不寄(不退回 customers.email)
 * ```
 * 🛑 **今天只看第一個條件也會全對** —— 因為第二個在 `20260905130000`(手動建單加第 11 參)
 * 貼進去之前**恆真**(表單根本沒有那個欄位)。
 * ⇒ 📌 **那正是它危險的地方**:一個「今天怎麼寫都對」的判準,
 * 會在**別人補上那個欄位的那一刻**開始壓掉員工真的填進去的信箱,
 * 而**那一刻不會有任何東西叫**。(codex R3-C4 抓到的那一格。)
 *
 * ## 🔴 fail 方向現在就釘死
 * `orderSource` 是 `null`(view 沒把那一欄撈出來 / 舊資料)⇒ **照舊寄**。
 * 🛑 反過來寫(「不是 web 就不寄」)會讓一個 `null` 把**真的顧客站訂單靜默不寄** ——
 * 而「沒寄」這件事在畫面上沒有形狀。
 * 📌 **兩個方向都會錯,而錯的代價不對稱:多寄一封信看得見,少寄一封看不見。**
 *
 * ## ⚠️ 白名單,不是黑名單
 * 只有**明列的三個** `manual_*` 會走「不寄」。任何**未來新增的 order_source**
 * 一律走既有的 fallback。
 * 🔴🔴 **⛔ ~~而 test 有一格對著 `OrderSource` 的成員比,加第四種來源時它會紅~~ —— 那句是假的**
 *    (R6 抓到):那一格比的是**測試裡寫死的四元素陣列**,而型別在執行期不存在
 *    ⇒ 有人往 `OrderSource` 加第五種來源時,**沒有任何東西會紅**。
 *    ⇒ 📌 測試檔自己誠實寫了這一半,而**這個檔頭沒有** —— 讀檔頭的人會判這裡有機械守門。
 *    🛑 **一句宣稱有守門而其實沒有的話,比沒有守門更糟:它讓下一個人不去看。**
 *    ⚠️ 今天真正擋著的是【人】:加來源的人要自己回來這裡決定它走哪一邊。
 */

/**
 * 後台手動建單的三種來源(對齊 `orders.order_source` CHECK,migration `20260712203000`)。
 *
 * 🔴 **具名列出,不用 `startsWith('manual_')`** —— 前綴比對會讓一個未來的
 * `manual_whatever` **靜靜地**拿到「可以不寄」這個行為,而沒有人決定過它。
 */
export const MANUAL_ORDER_SOURCES_FOR_EMAIL = [
  'manual_phone',
  'manual_line',
  'manual_other',
] as const;

/**
 * 這張單的通知信,**在 `notification_email` 為空時,可不可以退回 `customers.email`**?
 *
 * @param orderSource `orders.order_source`;`null` = view 沒給(見檔頭 fail 方向)
 * @returns `true` = **不准退回**(手動單留白 = 不寄);`false` = 照舊退回
 */
export function suppressCustomerEmailFallback(orderSource: string | null | undefined): boolean {
  if (orderSource === null || orderSource === undefined) {
    // 🔴 不知道來源 ⇒ **照舊寄**。見檔頭「fail 方向」那一段:少寄一封看不見。
    return false;
  }
  return (MANUAL_ORDER_SOURCES_FOR_EMAIL as readonly string[]).includes(orderSource);
}
