// coupon-reject.ts — DB 的券拒絕理由 ⇒ 客人看到的那一句(⟦b4-COUPONFIELD⟧ 片 D 的 TS 半)。
//
// `create_order` 第 8 代(migration 20260915100000)被拒時回 `ERRCODE P2C20` +
// `DETAIL = 'coupon_rejected:<reason>'`,而 PostgREST 把 `detail` 原樣放進 HTTP JSON。
//
// 🔴 **枚舉防線在 SQL 那一側,不在這裡**:DB 把**每一種**被拒理由都收斂成 `unavailable`
//    (唯一例外是 `zero_total_unsupported`)—— 因為登入者可以直接打 `/rpc/create_order`,
//    不經過這個檔。⇒ 這裡**只做翻譯**,不做安全判斷。
//
// 🔴🔴 **2026-09-14 跨片審查(high)訂正**:⛔ ~~原本只收斂查無 / 停用 / 用完三種,
//    已過期 / 未達低消 / 不適用會員價 / 已用過四種照講~~ —— 那四種在 `redeem_coupon` 裡
//    **全部排在「查無」那一關之後**(`20260831160000:275,279,289,344` vs `:212`)
//    ⇒ 回得到其中任何一種,就等於回答了「這個券碼存在嗎」。⇒ **一律收成一句。**
//    🛑 所以本檔【不得】為那六種各寫一句:DB 根本不會告訴我們是哪一種,而它是刻意的。

/** DB 的 `DETAIL` 前綴;action 靠它把理由切出來。 */
export const COUPON_REJECTED_PREFIX = 'coupon_rejected:';

/**
 * 客人看得到的那一句。
 *
 * 🔵 `unavailable` = DB 收斂過的**每一種**被拒理由 ⇒ 一句籠統的。
 * 🔵 `zero_total_unsupported` = 這張券把整筆折到 0,而零元結帳今天沒打開(migration 檔頭寫著天花板)。
 * 🔵 認不得的理由 ⇒ 也回那句籠統的:**不要把 DB 的原字串印給客人**(可能夾內部字面)。
 */
export function checkoutCouponFieldMessage(reason: string): string {
  switch (reason) {
    // 🔵 唯一講得出細節的那一種:它是「這一車 × 這張券」的算術結果。
    //    ⚠️ 它【確實】證明「這張券對這一車可用」(codex R3 important)—— 產品上接受:
    //    只在「可用 + 折到 0」時出現, 不揭露過期 / 停用 / 用完那些;不講客人會卡在「請稍後再試」。
    case 'zero_total_unsupported':
      return '這張券會把整筆金額折到 0,目前沒辦法這樣結帳 —— 請先拿掉券,或多買一件';
    // 🔴 其餘一律同一句 —— 包含已過期 / 未達低消 / 不適用會員價 / 已用過。
    //    ⛔ ~~原本這四種各講一句~~(2026-09-14 主視窗裁、當天被跨片審查推翻)。
    case 'unavailable':
    default:
      return '這張券不能用';
  }
}
