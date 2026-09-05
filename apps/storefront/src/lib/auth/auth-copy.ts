// auth-copy.ts — 登入/驗證那條路上【兩邊都要用到】的字面(`⟦b4-SIGNUPOPEN1⟧` 前置片,2026-09-05)
//
// 🔴🔴 **為什麼要有這一支檔,而不是各自寫一份字串**:
//    `login/actions.ts` 的 `authErrorCopy` 決定畫面上出現哪一句;
//    而 `LoginPage.tsx` 要靠**那一句**判斷「該不該顯示重寄按鈕」。
//    ⇒ 兩邊各打一份的話,**改了 A 沒改 B ⇒ 按鈕永遠不出現,而三綠全綠、畫面也不會壞**
//      —— 客人只會覺得「沒有那顆按鈕」,而沒有任何東西會叫。
//    ⇒ 📌 **把判準抽成一個具名常數,讓兩邊【不可能】漂。**
//
// 🛑 `login/actions.ts` 帶 `'use server'` ⇒ 它**只能 export async function**,
//    所以常數不能住在那裡 —— 這一支檔就是為了那個限制而存在的。

/** 未完成 Email 驗證時,登入被擋的那一句。**LoginPage 用它決定要不要給重寄按鈕。** */
export const AUTH_ERR_NEEDS_CONFIRMATION = '請先收信完成 Email 驗證後再登入';

/** 重寄之後的回覆。🔵 **不論 provider 成功或失敗都是這一句** —— 見 action 的帳號列舉防護。 */
export const AUTH_RESEND_SENT_NOTICE = '若那個 Email 有待驗證的帳號,我們已重新寄出驗證信。';

/**
 * 🔴 **系統面失敗**(站台設定錯 / 網路錯)時的那一句 —— 與上面那句**必須不同**。
 * 為什麼可以不同而不破壞帳號列舉防護:走到這一句的 throw 發生在**呼叫 provider 之前**,
 * 判準是站台設定不是那個 email ⇒ **對任何 email 都一樣**;
 * 而 provider 的 429 / 帳號不存在**不會走到這裡**(action 對它們回 `{}` 不 throw)。
 */
export const AUTH_RESEND_FAILED_NOTICE = '目前無法寄出驗證信,請稍後再試或聯絡客服。';

/**
 * 🔴 記進 log 的 `errorCode` 白名單(codex 關卡2 must-fix ③)。
 * 逐字同步 `packages/domain` 的 `AuthErrorCode`。**不在這張表上的一律記成 `unrecognized`** ——
 * 因為 `catch` 接得到的東西不只我們自己的 `AuthError`,而 provider 的自由字串可能含 email。
 * ⚠️ **這是快照**:`AuthErrorCode` 加了新成員而這裡沒跟上 ⇒ 那個新 code 會被記成
 * `unrecognized`(**往安全的方向失效**,不會洩漏,只會少一點資訊)。
 */
export const KNOWN_AUTH_ERROR_CODES = [
  'credentials_invalid',
  'email_already_registered',
  'password_too_weak',
  'email_confirmation_required',
  'rate_limited',
  'password_same_as_current',
  'unknown',
] as const;
