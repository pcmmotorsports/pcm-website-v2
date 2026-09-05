import type { AuthErrorCode } from '@pcm/domain';

// auth-copy.ts — 登入/驗證那條路上【兩邊都要用到】的字面(`⟦b4-SIGNUPOPEN1⟧` 前置片,2026-09-05)
//
// 🔴🔴 **[2026-09-05 訂正 · 本段原本的理由在「丙」之後【不再成立】]**
//    ⛔ ~~`LoginPage.tsx` 要靠**那一句**判斷「該不該顯示重寄按鈕」;兩邊各打一份的話,
//       改了 A 沒改 B ⇒ 按鈕永遠不出現,而三綠全綠、畫面也不會壞。~~
//    🔴 **那正是「丙」要殺掉的病** —— 而它現在**已經被殺掉了**:
//       `LoginPage.tsx` 改讀 `formErrorCode`(碼),**不再讀那一句**。
//    ⇒ 🛑 **留著舊句會給下一個人一個與現況【相反】的指引**(他會以為改文案會關掉按鈕)。
//
// ✅ **這支檔今天的存在理由(換了一個)**:
//    `AUTH_RESEND_*` 那幾句與 `KNOWN_AUTH_ERROR_CODES` 是 action 與元件**都要用到**的常數,
//    而 `login/actions.ts` 帶 `'use server'` ⇒ 它**只能 export async function**
//    ⇒ 常數不能住在那裡。**這一支檔就是為了那個限制而存在的。**
//

/**
 * 未完成 Email 驗證時,登入被擋的那一句。
 * ⛔ ~~**LoginPage 用它決定要不要給重寄按鈕。**~~ —— 🔴 **2026-09-05「丙」之後不再是**:
 * 按鈕改讀 `AUTH_CODE_NEEDS_CONFIRMATION`(碼)。**這一句現在只給客人看。**
 */
export const AUTH_ERR_NEEDS_CONFIRMATION = '請先收信完成 Email 驗證後再登入';

/**
 * 🔴 **重寄按鈕的判準 —— 用【錯誤碼】不用【字面】**(2026-09-05,主視窗 `-f8` 裁「丙」)。
 * ⛔ ~~舊做法:`formError === AUTH_ERR_NEEDS_CONFIRMATION`(逐字比對那句話)~~
 * **為什麼換掉**:那讓「字面」同時扛兩個工作 —— 給客人看、以及決定按鈕出不出現
 * ⇒ 📌 **要改文案就會順手關掉那顆按鈕, 而三綠全綠、畫面也不會壞。**
 * ⇒ ✅ 換成碼之後,**文案改了按鈕照樣在** —— 而那是【行為】的敘述,不是【安全】的敘述。
 * 🛑🛑 **[code-reviewer R1] 而「甚至可以統一成一句」那半有後果, 要一起讀**:
 *    兩句一旦統一(13.甲 的另一案),**那顆按鈕就是畫面上【唯一】分得出
 *    「這個 Email 存在且未驗證」的東西** ⇒ 📌 **洩漏不會消失, 它會【搬到按鈕上】,
 *    而且比今天兩句不同的文案【更集中、更好判讀】。**
 * 🔴 ⇒ **本常數讓「統一文案」變成做得到, 而它【沒有】讓統一變成安全。**
 *    要真的關掉那條列舉路是另一題(回應時間、有沒有寄信也分得出來)。
 */
export const AUTH_CODE_NEEDS_CONFIRMATION = 'email_confirmation_required' satisfies AuthErrorCode;

/**
 * 🔴 **允許跨 server→client 邊界回去的碼 —— 白名單, 今天只有一個成員**
 * (codex 關卡2 must-fix ①,2026-09-05)。
 * ⛔ ~~原本直接回 `e.code`~~ —— 那把七個 `AuthErrorCode` 原封送過邊界,
 *    而 client 只需要「是不是未驗證」**一個 bit** ⇒ 其餘六個是**白給的**。
 * 🛑 **加第二個成員要是一個【刻意的動作】** —— 而它一加, 那個碼就從 server 漏到 client,
 *    請先問:「client 拿它去做什麼?那件事非得知道這個碼才做得到嗎?」
 */
export const UI_BRANCHABLE_CODES = [AUTH_CODE_NEEDS_CONFIRMATION] as const;

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
