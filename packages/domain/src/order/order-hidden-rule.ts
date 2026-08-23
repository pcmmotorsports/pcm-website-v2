// order-hidden-rule.ts — M-4b `#841`:**訂單列表預設隱藏規則的【唯一】一份定義。**
//
// ── 為什麼這支檔存在(codex 2026-08-23 M7)────────────────────────────────────
// 這條規則原本有**兩份人工邏輯**,而它們互不認識:
// ```
// SQL 側  packages/adapters/…/SupabaseOrderAdapter.ts  的 `.or()` 字串(下推給 PostgREST)
// UI 側   apps/admin/…/order-hidden-notice.tsx         的 if 判斷(決定要不要講「它被藏起來了」)
// ```
// 兩邊各自有自己的測試、各自驗自己的副本 ⇒ **改了 SQL 側,UI 側的測試一格都不會紅**,
// 而畫面會開始對一批「其實看得見」的單說「它被藏起來了」,或反過來對被藏的單沉默。
//
// 🔴 **修法不是「加一格互比的測試」** —— 本 repo 對這個形狀有明確立場
// (`20260816050000` 檔頭逐字):「守門不能做成**兩邊互比**:兩邊【一起】用錯分母時,
// 互比對同一組輸入會得到同一個錯答案、**一致通過**。」
// ⇒ 所以這裡走的是**消除重複**,不是「測試重複」:UI 直接呼叫本檔的函式,
//   SQL 側直接用本檔的字串常數。
//
// 🔴 **而「沒有第二份」要限縮成【沒有第二份 production 來源】**(codex 第二輪 nit,他是對的):
//    `SupabaseOrderAdapter.test.ts` 的 `L6_HIDE_OR` **仍然是一份手打的完整副本**。
//    ⚠️ **那一份是刻意的,而且不是同一個病**:它是 **byte-equal 絆線**(house 對
//    `ORDER_LIST_SELECT` 等字面的既有做法)—— 改了本檔的字串,那一格會紅、逼人回來看。
//    ⇒ 兩者的差別:**副本在【測試】裡 = 絆線;副本在【production】裡 = 會漂的第二份真相。**
//      前者的漂移會被自己叫出來,後者不會。
//
// ⚠️ 而兩邊仍然是**兩種表述**(一個給 PostgREST、一個給 TS)——
//    那個對齊由 `order-hidden-rule.test.ts` 的**真值表**當第三方看著,見該檔。

/**
 * 🔴 下推給 PostgREST 的隱藏述詞(`.or()` 的參數,逐字)。
 *
 * `or()` 寫的是【**顯示**】條件 ⇒ 在這裡加一項 OR = 在【隱藏】面加一項 AND(De Morgan):
 * ```
 * 顯示 ⟺ channel≠tappay ∨ status≠unpaid ∨ (已收≠0 ∧ 未取消)
 * 隱藏 ⟺ channel=tappay ∧ status=unpaid ∧ (已收=0 ∨ 已取消)
 * ```
 * 🔴 第三項 `and(...)` 是**復活條件**,不是第三個獨立的隱藏軸。拆成平鋪的
 * `paid_total.neq.0` 會讓**已取消的單跑出來**(2026-08-23 PostgREST 14.16 實測,六張測試單)。
 *
 * ⚠️ `paid_total` 由 `supabase/migrations/20260823030000_m4b_841_order_paid_total_view.sql`
 * 提供,而它 **NOT NULL 靠 view 裡的 `COALESCE`** —— 那支 migration 的斷言 ⑦c 釘住它。
 */
export const ORDER_LIST_HIDE_PREDICATE =
  'payment_channel.neq.tappay,payment_status.neq.unpaid,and(paid_total.neq.0,cancelled_at.is.null)';

/** 判斷一張單是否落在「預設列表會藏起來」那一面。 */
export function isHiddenFromDefaultOrderList(input: {
  paymentChannel: string;
  paymentStatus: string;
  /**
   * 帳本淨額 = `SUM(order_payments.amount)`,沖銷列帶負值。
   *
   * 🔴 **直接加總、不得過濾負列、不得 ABS、不得只算非沖銷列**
   * (`supabase/migrations/20260815010000_m4b_e10_16_admin_today_payment_total.sql:18-20` 逐字)。
   * 🔴 **加總看正負是對的;分類看正負是錯的** —— 要認哪一列是沖銷只准看 `isReversal`
   * (`apps/admin/src/lib/orders/payment-list-view.ts:28-31`)。本函式只吃算好的淨額。
   */
  netPaid: number;
  cancelled: boolean;
}): boolean {
  const { paymentChannel, paymentStatus, netPaid, cancelled } = input;
  // 逐項對齊上面那句述詞的隱藏面。改這裡就要改那裡,而真值表會同時打兩邊。
  if (paymentChannel !== 'tappay') return false;
  if (paymentStatus !== 'unpaid') return false;
  return netPaid === 0 || cancelled;
}
