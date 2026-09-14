// coupon-reject.ts — DB 的券拒絕理由 ⇒ 客人看到的那一句(⟦b4-COUPONFIELD⟧ 片 D 的 TS 半)。
//
// `create_order` 第 8 代(migration 20260915100000)被拒時回 `ERRCODE P2C20` +
// `DETAIL = 'coupon_rejected:<reason>'`,而 PostgREST 把 `detail` 原樣放進 HTTP JSON。
//
// 🔴 **枚舉防線在 SQL 那一側,不在這裡**:DB 已經把 `not_found` / `inactive` / `exhausted`
//    三種收斂成同一個公開值 `unavailable`(codex R1 must-fix ①)—— 因為登入者可以直接打
//    `/rpc/create_order`,不經過這個檔。⇒ 這裡**只做翻譯**,不做安全判斷。
//    🛑 所以本檔【不得】為那三種各寫一句:DB 根本不會告訴我們是哪一種。

import type { CouponRejectReason } from '@pcm/domain';

/** DB 的 `DETAIL` 前綴;action 靠它把理由切出來。 */
export const COUPON_REJECTED_PREFIX = 'coupon_rejected:';

/**
 * 客人看得到的那一句。
 *
 * 🔵 `unavailable` = DB 收斂過的那三種(查無 / 已停用 / 已被領完)⇒ 一句籠統的。
 * 🔵 `zero_total_unsupported` = 這張券把整筆折到 0,而零元結帳今天沒打開(migration 檔頭寫著天花板)。
 * 🔵 認不得的理由 ⇒ 也回那句籠統的:**不要把 DB 的原字串印給客人**(可能夾內部字面)。
 */
export function checkoutCouponFieldMessage(reason: string): string {
  switch (reason) {
    case 'expired':
      return '這張券已經過期了';
    case 'tier_conflict':
      return '這張券不適用你目前的會員價';
    case 'already_used_by_account':
      return '你已經用過這張券了';
    case 'below_min_spend':
      // 🔴 門檻與差額在這條路上拿不到(DB 只回理由,不回 min_spend)⇒ 講得出的只有這一句。
      //    要講「還差多少」得讓 DB 把數字帶進 DETAIL,而那是另一片(今天的券 min_spend = 0,走不到)。
      return '這張券有最低消費門檻,目前還沒達到';
    case 'zero_total_unsupported':
      return '這張券會把整筆金額折到 0,目前沒辦法這樣結帳 —— 請先拿掉券,或多買一件';
    case 'unavailable':
    default:
      return '這張券不能用';
  }
}

/**
 * 🔵 給元件那一側用的型別橋:`CouponFieldState.rejected.reason` 吃的是 domain 的 `CouponRejectReason`,
 * 而這條路拿到的是 DB 收斂過的字串 ⇒ 兩者**刻意不是同一個集合**(`unavailable` 不在 domain 那一組)。
 * 這個函式讓那件事在型別上看得見,而不是靠註解。
 */
export function isDomainCouponReason(reason: string): reason is CouponRejectReason {
  return (
    reason === 'expired' ||
    reason === 'tier_conflict' ||
    reason === 'already_used_by_account' ||
    reason === 'below_min_spend' ||
    reason === 'not_found' ||
    reason === 'inactive' ||
    reason === 'exhausted'
  );
}
