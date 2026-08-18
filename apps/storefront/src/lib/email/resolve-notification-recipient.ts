// lib/email/resolve-notification-recipient.ts — 訂單通知信的收件人解析(M-4a B-4)
//
// 🔴 **一個呼叫點、一份規則**:呼叫點是 `app/checkout/charge-actions.ts` 建 `PlaceOrderInput` 的那一處。
//    驗證一律走既有的 `NotificationEmailInput`(`packages/schemas/src/notification-email.ts`)——
//    **本片不長出第二套 email 規則**(canonicalize / printable ASCII / ≤254 octets / 基本形狀 / 禁 LINE 合成域)。
//
// 候選依序(Sean 2026-08-18 `Q-W5-3`=甲「LINE 客人用收件地址那欄的 Email、其他人用註冊信箱」):
//   ① flag-on 時客人自己在結帳頁填的值    ← 為這件事親手填的，語意最強；flag-off 時該鍵不存在 ⇒ 自動跳過
//   ② session user.email(auth 現值)      ← 一般客人的「註冊信箱」
//   ③ 收件地址的 email                    ← LINE 客人的 session email 是合成假信箱、會被 `NotificationEmailInput` 擋掉，落到這裡
//                                          （🔴 **每一個候選都各自跑一次那支 schema**，不是只有第一候選;codex 關卡2 nit 6）
//
// 🔴 **不要寫 `if (是 LINE 客人)`**:順序自己就會分流,而問那個問題會長出第二個要同步維護的 LINE 判準
//    (合成域字面目前 hardcode 在三處,見 plan §3.5)。
//
// 🔴 **與 `cardholder.ts` 的候選順位【刻意相反】**(plan §3.2):
//    cardholder(送 TapPay)= 地址優先(2026-08-09 LINE 3DS 修復);本檔 = 註冊信箱優先(Sean 拍板)。
//    ⇒ **同一張單的 `cardholder.email` 與 `notification_email` 可能是不同信箱,那是預期行為。**
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
