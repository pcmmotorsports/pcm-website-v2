// coupon.ts —— 優惠券驗券結果的 domain 型別與那個封閉集(M-4b 券片:兌換 / 執行那一半)。
//
// ⛔ ~~這支檔【只放型別】~~ —— codex nit:`COUPON_REJECT_REASONS` 是**匯出的執行期值**,
//    那句話比事實窄。✅ 正確說法:**這支檔不放【判斷】。**
//
// ══ 判斷住在哪裡 ═══════════════════════════════════════════════════════════
// 🔴 **驗券的判斷【唯一】住在 SQL 的 SECURITY DEFINER RPC 裡, 不在 TS。**
//    理由不是分層潔癖, 是**權限與原子性**兩件都只有那裡做得到:
//      · `20260829150000_m4b_coupon_p1_tables.sql:208-209` 把 `coupons` 與
//        `coupon_redemptions` 對 `PUBLIC/anon/authenticated/service_role` **REVOKE ALL**
//        ⇒ 同檔 `:203-204` 逐字「讀寫唯一路 = SECURITY DEFINER RPC」
//      · `max_redemptions`(限量券)要在**同一個交易**裡鎖券那一列再寫 redemption
//        ⇒ 兩個人同時結帳時, TS 這一層看到的都是「還有一張」(plan §1-5)
// ⇒ 📌 **所以 TS 這一層若也寫一份判斷, 那不是防禦縱深, 是【第二個事實來源】** ——
//    而它與 SQL 分岔的時候, **不會有任何東西叫**。
import type { MoneyAmount } from '../shared/types';

/**
 * 驗券被拒的理由 —— **封閉集**。
 *
 * 🔴🔴 **這七個值的權威在 SQL, 不在這裡**:
 * `supabase/migrations/20260829150000_m4b_coupon_p1_tables.sql:82` 的
 * `CREATE TYPE public.coupon_reject_reason AS ENUM (…)`(該 migration 已 apply)。
 * ⇒ 本型別是它的**鏡子**, 而鏡子會漂 ⇒ `coupon.test.ts` 有一道守門在比對兩邊。
 *
 * 🛑 **為什麼是封閉集不是字串**(plan §1-4 逐字):字串會長出第八種而沒有人發現。
 */
export type CouponRejectReason =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'exhausted'
  | 'already_used_by_account'
  | 'below_min_spend'
  | 'tier_conflict';

/**
 * 這七個值的執行期清單 —— 守門與 runtime 檢查用。順序刻意與 SQL 逐字相同。
 *
 * 🔴🔴 **`satisfies readonly CouponRejectReason[]` 只證【清單裡的每一個都屬於 union】,
 *    它【不證】union 裡的每一個都在清單裡**(codex must-fix):
 *    union 多長出第八個而清單沒加 ⇒ **tsc 綠、那六格測試也綠**。
 * ✅ 下面 `_exhaustive` 那一行就是補那個方向的 —— 它是**型別層**的斷言,
 *    少一個值時 **tsc 會紅**, 不用等測試跑。
 */
export const COUPON_REJECT_REASONS = [
  'not_found',
  'inactive',
  'expired',
  'exhausted',
  'already_used_by_account',
  'below_min_spend',
  'tier_conflict',
] as const satisfies readonly CouponRejectReason[];

/**
 * 🔴 反方向的窮盡檢查:union 裡**有而清單裡沒有**的值,會在這裡讓 `tsc` 紅。
 *
 * 作法:把 union 減掉清單的成員 —— 剩下的必須是 `never`。
 * ⇒ 它不是執行期的東西(`void` 一個型別別名),**它只在編譯期存在**。
 */
type _MissingFromList = Exclude<CouponRejectReason, (typeof COUPON_REJECT_REASONS)[number]>;
/**
 * ⛔ ~~`type _ExhaustiveCheck = _MissingFromList extends never ? true : [...]`~~
 * 🔴 **那一版是假的, 而我實測到它是假的**:條件型別**算出什麼都不會報錯**
 *    ⇒ 從清單刪掉 `tier_conflict`(union 不動)⇒ **`tsc` rc=0**。
 * 📌 **一個看起來像守門的型別別名, 與一個真的會擋的, 在原始碼上長得很像。**
 * ✅ 改成**帶約束的型別參數** —— `T extends never` 不成立時 `tsc` 直接報錯。
 */
type AssertNever<T extends never> = T;
type _NoMissingFromList = AssertNever<_MissingFromList>;

/**
 * 驗券結果。
 *
 * 🔴 **金額一律走 `MoneyAmount`**(codex must-fix;`CLAUDE.md` Server 端鐵則逐字
 *    「金額用整數(分/角)或 `Decimal`、**禁用 `number` 處理價格**」)——
 *    我第一版兩個欄位都寫成裸 `number`, 那**繞過了 `toMoneyAmount()` 那道集中守門**。
 *
 * 🛑 **`shortfall` 只屬於 `below_min_spend`**(codex must-fix;plan §1-4 也是這樣寫的)。
 *    我第一版把它放在整個 `valid: false` 分支上 ⇒ 型別允許 `{ reason:'expired', shortfall:50 }`
 *    ⇒ **契約沒有被封住**。✅ 現在把那一種拆成自己的成員。
 *
 * ⚠️ 而 `shortfall` **今天預設不回**(plan §1-4 逐字):「要不要把差額算給客人看」
 *    **Sean 還沒答** ⇒ 欄位留著、預設不回;他說要再開。**不要先做成回傳再拿掉。**
 *    ⇒ 所以它是 optional, 呼叫端**不得假設它一定在**。
 */
export type CouponValidation =
  | { valid: true; discountAmount: MoneyAmount }
  | { valid: false; reason: 'below_min_spend'; shortfall?: MoneyAmount }
  | { valid: false; reason: Exclude<CouponRejectReason, 'below_min_spend'> };
