// order-cancel-reason.ts — `orders.cancelled_reason` 裡那個【機器碼】的唯一一份定義。
//
// ── 為什麼它從 apps/admin 搬到這裡(`#249`,2026-08-24)────────────────────────
// 這個字面原本只住在 `apps/admin/src/lib/orders/cancel-view.ts`,而那時只有後台讀它。
// `#249` 之後**客人端也要讀**(訂單列表要把「已取消」與「已逾期」分開標,Sean 拍板逐字:
// 「甲 顯示但標「已取消」/「已逾期」, 不能點去付款」)。
// ⇒ storefront **不能** import apps/admin ⇒ 只有兩條路:搬進 domain,或在客人端再打一份。
//   後者正是 `order-hidden-rule.ts` 檔頭那個病(**兩份 production 真相互不認識**)。
// ⇒ 所以搬。admin 那支改成 re-export,**它的消費端與測試一行都不用動**。
//
// 🔴 **它不是 enum,是【一個特例值】** —— `cancelled_reason` 這一欄平常裝的是**對客中文**
//    (A8a1 依 §5.1d 七值映射表產出);只有 pg_cron 的自動失效那條路寫這個英文碼:
//    `20260809160000_..._expire_unpaid_orders_fn.sql:174` 逐字 `cancelled_reason = 'payment_expired'`。
//    ⇒ 判別式只能是「**等於**這個碼」,不得寫成「包含」或「開頭是」——
//      對客中文裡出現這串字的機率不是零,而那會把一張人工取消的單標成逾期。

/**
 * 未付款逾時,由 pg_cron 自動失效時寫進 `orders.cancelled_reason` 的字面。
 *
 * 來源(三來源律,①grep 本 repo 命中):
 * - 寫入端 `supabase/migrations/20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql:174`
 * - 排程端 `supabase/migrations/20260809170000_..._schedule.sql:62`
 * - 兩支**都已 apply**(`supabase/APPLIED.tsv` 命中 2;2026-08-24 當場量)
 *
 * 🔴 ~~「L3 施工中、尚未 apply ⇒ 這個值在正式庫不會出現」~~ —— **那句話已經過期了**
 *    (原文在 `apps/admin/src/lib/orders/cancel-view.ts:47-49`,寫於 2026-08-09)。
 *    Sean 2026-08-24 對正式庫跑的那發唯讀 SQL:**被自動失效的單 = 7 張**。
 *    ⇒ **它現在是真的會出現的值**,而客人端從 `#249` 起看得到那 7 張單。
 *    📌 這一條記在這裡是刻意的:那句過期的話**寫得很好、而沒有任何東西會在它到期那天紅**
 *      (全 repo 同族 25 句,backlog `#882`)。
 */
export const PAYMENT_EXPIRED_CANCEL_REASON = 'payment_expired';

/**
 * 一張單的「取消軸」落在哪一格 —— 客人端與後台共用的判別式。
 *
 * | `cancelledAt` | `cancelledReason` | 回傳 |
 * |---|---|---|
 * | `null` | (任意) | `'none'` |
 * | 非 null | `'payment_expired'` | `'expired'` |
 * | 非 null | 其餘(含 `null`) | `'cancelled'` |
 *
 * 🔴 **先看 `cancelledAt`、不是先看 reason**:reason 只是拿來分兩種取消,
 *    它**不負責回答「這單取消了沒」**。倒過來寫的話,一張 reason 為 null 的取消單會被判成沒取消。
 * 🔴 **`cancelledAt` 非 null 而 reason 是 `null` ⇒ `'cancelled'`,不是 `'unknown'`** ——
 *    那張單**確實被取消了**,我們只是不知道理由;對客人而言「已取消」就是正確答案。
 */
export type OrderCancelKind = 'none' | 'expired' | 'cancelled';

/**
 * 🔴🔴 **這支函式是【客人端與伺服器的邊界】,而那是它最重要的性質**(codex must-fix,2026-08-24)。
 *
 * `orders.cancelled_reason` **不是**一個安全的對客欄位 —— 它平常裝七值映射出來的中文,
 * 而 `p_reason_code = 'other'` 那條路裝的是**員工當場打的原文**:
 * ```
 * 20260804180000_..._admin_cancel_order.sql:135-136 逐字
 *   IF p_reason_code = 'other' THEN … v_reason_txt := v_detail;   ← v_detail = 員工輸入
 * ```
 * ⇒ 員工打「供應商欠款 / 內部失誤 / 這客人很盧」都會原樣進那一欄。
 * 🔴 **而 `#249` 之前沒有人看得到它** —— `#249` 做的正是「把這批單放回客人眼前」
 *   ⇒ **那不是 `#249` 撞到的既有缺陷,是 `#249` 親手打開的那扇門。**
 *
 * ⇒ **紀律(不可談判)**:客人端**永遠不得渲染自由文字**,只能渲染**枚舉映射出來的固定字串**。
 *   ⇒ 所以 mapper 在**伺服器端**就把那一欄收斂成本型別,**原文不進 `OrderListItem` /
 *     `MemberOrderDetail`、不進 RSC payload、不進瀏覽器**。
 *   ⚠️ **不要改成「叫員工小心一點」或在表單加一句警語** —— 那是把一道機制換成一句提醒。
 *   ⚠️ 後台的 `AdminOrderDetail.cancelledReason` **刻意保留原文**(員工要看得到自己寫了什麼)。
 */
export function orderCancelKindOf(input: {
  cancelledAt: string | null;
  cancelledReason: string | null;
}): OrderCancelKind {
  // 🔴🔴 **只認 `null`,而【缺鍵/undefined 會落到 `'cancelled'`】—— 那個方向是刻意的。**
  //    (2026-08-24 一發測試把它照出來:fixture 少寫 `cancelled_at` ⇒ 整筆被判成已取消。)
  //    兩個失效世界的代價不對稱:
  //    ```
  //    投影掉了這一欄 → 落 'cancelled' ⇒ 每一張單都印「已取消」⇒ 大聲、當天就有人回報
  //    投影掉了這一欄 → 落 'none'      ⇒ 已取消的單印回「待付款」⇒ 安靜,而那正是 `#249` 的傷害
  //    ```
  //    ⇒ **寧可吵,不要安靜地退回那個 bug。** 不要「順手」把它改成 `?? null` 或 `== null`。
  if (input.cancelledAt === null) return 'none';
  return input.cancelledReason === PAYMENT_EXPIRED_CANCEL_REASON ? 'expired' : 'cancelled';
}
