// lib/email/resolve-notification-recipient.ts — 訂單通知信的收件人解析(M-4a B-4)
//
// 🔴 **一個呼叫點、一份規則**:呼叫點是 `app/checkout/charge-actions.ts` 建 `PlaceOrderInput` 的那一處。
//    驗證一律走既有的 `NotificationEmailInput`(`packages/schemas/src/notification-email.ts`)——
//    **本片不長出第二套 email 規則**(canonicalize / printable ASCII / ≤254 octets / 基本形狀 / 禁 LINE 合成域)。
//
// ── 候選順位(現行:Sean 2026-09-19 拍甲)─────────────────────────────────────
//   ① **收件地址的 email**                 ← 客人要改通知地址, 就去改這一欄(表單上有附註「信件通知地址」)
//   ② session user.email(auth 現值)       ← 地址那欄沒有 / 不合格時的後備
//   （🔴 **每一個候選都各自跑一次那支 schema**，不是只有第一候選;codex 關卡2 nit 6）
//
// 🔴🔴 **順位本身住在呼叫端**(`app/checkout/charge-actions.ts` 那個陣列的次序),不在本檔 ——
//    本函式只是「依序試、回第一個過的」。⇒ 📌 **改本檔的測試改不動順位, 改呼叫端才會動。**
//
// ⛔ ~~2026-08-18 `Q-W5-3`=甲「LINE 客人用收件地址那欄的 Email、其他人用註冊信箱」~~
//    ⇒ **2026-09-19 Sean 拍甲推翻**, 逐字:「甲 = 翻過來, 收件地址的 email 優先。
//      然後再收件地址上面的 email 附註寫上 信件通知地址」。
//    ⛔ 同一天拿掉的還有舊候選①「flag-on 時客人自己在結帳頁填的值」—— 那一格整格退場
//      (Sean 2026-09-19 拍甲;理由逐字「客人要改, 就去改收件地址上的 email」)。
//    🔵 舊順位是 ①結帳頁填的 ②註冊信箱 ③收件地址;今天是 ①收件地址 ②註冊信箱。
//
// 🛑 **代價, 而 Sean 知情之後仍然選甲**:送禮 —— 收件地址是朋友的 ⇒ 通知信寄去朋友那邊,
//    下單的人收不到。⚠️ **不要自己加一道「如果收件人不是本人就改用註冊信箱」的防呆**:
//    那會把他拍的那件事(附註 + 地址優先)繞掉, 而且要再長一個「是不是本人」的判準。
//
// 🔴 **不要寫 `if (是 LINE 客人)`**:順序自己就會分流,而問那個問題會長出第二個要同步維護的 LINE 判準
//    (合成域字面目前 hardcode 在三處,見 plan §3.5)。LINE 客人的 session email 是合成假信箱、
//    會被 `NotificationEmailInput` 擋掉 ⇒ 新順位下他本來就吃①收件地址, 分流照樣成立。
//
// 🔴 **與 `cardholder.ts` 的關係(2026-09-19 起【不再是相反】, 但也【不是同一件事】)**:
//    兩條路今天都是地址優先, 而它們**不是同一段碼、不是同一把尺** ——
//    cardholder 走 `AddressEmailInput`(≤40, TapPay 的限制)、本檔走 `NotificationEmailInput`(≤254)。
//    ⇒ 地址 email 41-254 octets 時(表單擋得掉, **舊資料列擋不掉**)兩者仍會不同, 那是預期行為。
//    ⇒ ⛔ ~~plan §3.2「候選順位刻意相反」~~ 那句**已經過期**, 不要照著它推論。
//
// @see docs/specs/2026-08-18-m4a-b4-persist-notification-email-plan.md §3 / §3.2 / §3.5
import 'server-only';

import { NotificationEmailInput } from '@pcm/schemas';

/**
 * 依序試候選,回第一個通過 `NotificationEmailInput` 的 **canonical 值**;全不過回 `null`。
 *
 * 🔴 參數型別收 `null | undefined`:呼叫端的 `user.email` 是 `string | null | undefined`,
 *    在呼叫端補 `?? ''` 等於長出第二套正規化(`cardholder.ts` 檔頭明文禁止那件事)。
 */
export function resolveNotificationRecipient(
  candidates: readonly (string | null | undefined)[],
): string | null {
  for (const candidate of candidates) {
    const parsed = NotificationEmailInput.safeParse(candidate ?? '');
    if (parsed.success) {
      return parsed.data;
    }
  }
  return null;
}
