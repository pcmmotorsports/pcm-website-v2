'use server';

// app/login/actions.ts — 登入 server action(M-1-14e-f1-a、#181 逐欄錯誤強化、架構決策 A delivery 層信任邊界)
//
// 對齊 plan v4 §3 + backlog #181(Sean Q2=B):
// - server 端重新驗證、不信 client(CLAUDE.md「會員等級驗證必在 server 端重新檢查」)。
// - #181 Q2=B:逐欄驗證走共用 validateLogin(空欄專屬「請填寫…」+ 非空格式錯沿用 zod;client/server 同一份)。
//   驗證失敗 → 回 { fieldErrors }(逐欄、對應到 client 該欄下方顯示)。
// - validateLogin 成功回的 data 已 strip 未知欄(zod object 預設剝除、防 client 夾帶 tier/wallet);
//   remember 屬 session 持久化、不進 use-case。
// - 帳號層級錯(Email 或密碼錯誤 等)走 formError 頂部通道、不被逐欄取代(#181 Sean 釘死 2)。
// - 成功 redirect(POST_AUTH_REDIRECT)(plan §4 [D]、三處 redirect 共用 '/').
// - 失敗映射 domain AuthError → 用戶字面(finding-9(c)、不上洩 Supabase 原始 error)。

import { redirect } from 'next/navigation';
import { AuthError } from '@pcm/domain';
import { loginCustomer, resendSignupConfirmation } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';
import {
  validateLogin,
  validateForgot,
  type LoginFieldErrors,
  type ForgotFieldErrors,
} from '@/lib/auth/field-validation';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';
import { resolveSiteUrl } from '@/lib/site-url';
import {
  AUTH_ERR_NEEDS_CONFIRMATION,
  KNOWN_AUTH_ERROR_CODES,
  UI_BRANCHABLE_CODES,
} from '@/lib/auth/auth-copy';

// #181 Q2=B:雙通道回傳 — fieldErrors(逐欄驗證)/ formError(帳號層級、頂部)。成功 redirect 不回傳。
export type LoginActionResult = {
  fieldErrors?: LoginFieldErrors;
  formError?: string;
  /**
   * 🔴 **帳號層級錯的【碼】**(2026-09-05,主視窗 `-f8` 裁「丙」)——
   * 讓 `LoginPage` 用**碼**而不是**那句話**決定要不要給重寄按鈕。
   * ⇒ 📌 文案改了按鈕還在;而舊做法(逐字比對)**改文案就會靜靜關掉按鈕**。
   * 🛑 **它比字面【細】, 而細的那幾格逐一列出來**(⛔ ~~原句寫「是那句話的子集」~~ ——
   *    **那是無條件斷言而它假**:`authErrorCopy` 只有 2 個 case + default
   *    ⇒ 七個 `AuthErrorCode` 裡有五個被壓成同一句「登入失敗,請稍後再試」,
   *    而碼把那個桶子**拆開**了):
   *    · 登入這條路上真的到得了的差 = `rate_limited` 與 `unknown` 分得出來了
   *    · 🟢 **而那兩個都不是「這個帳號存不存在」的訊號** —— 它們講的是站台狀態
   *    ⇒ 📌 **所以「不新增帳號列舉訊號」成立, 而「是子集」不成立。兩句話不一樣。**
   */
  formErrorCode?: typeof UI_BRANCHABLE_CODES[number];
};

/** AuthError(domain code)→ 用戶可見字面;不洩漏 Supabase 原始 error。 */
function authErrorCopy(code: AuthError['code']): string {
  switch (code) {
    case 'credentials_invalid':
      return 'Email 或密碼錯誤';
    case 'email_confirmation_required':
      // 🔴 字面住在 `lib/auth/auth-copy.ts` —— LoginPage 靠它判斷要不要給重寄按鈕,
      //    兩邊各打一份會漂而【沒有東西會叫】(見那支檔頭)。
      return AUTH_ERR_NEEDS_CONFIRMATION;
    default:
      return '登入失敗，請稍後再試';
  }
}

/**
 * 登入。成功 → redirect(sanitizeNextParam(next))(不回傳);
 * 驗證失敗 → 回 { fieldErrors };帳號層級失敗 → 回 { formError }。
 *
 * @param input client 端傳入的結構化物件(email/password/remember);server 端 validateLogin 重驗 + strip。
 * @param next  #190 登入後導回路徑(/login?next= 帶入);**server 端 sanitizeNextParam 同源白名單**
 *   (validateLogin 會 strip 未知欄、故 next 走獨立參數;不安全 / 缺值 → fallback '/')。
 */
export async function loginAction(input: unknown, next?: string | null): Promise<LoginActionResult> {
  const v = validateLogin(input);
  if (!v.ok || !v.data) {
    // 有逐欄錯 → fieldErrors;否則(罕見:非顯示欄 schema error 如 remember 型別)→ formError fallback、不無聲失敗。
    if (Object.keys(v.fieldErrors).length > 0) {
      return { fieldErrors: v.fieldErrors };
    }
    return { formError: '請輸入有效的 Email 與密碼' };
  }

  // remember 屬 session 持久化、不進 use-case。
  const creds = { email: v.data.email, password: v.data.password };

  try {
    await loginCustomer(await getAuthService(), creds);
  } catch (e) {
    if (e instanceof AuthError) {
      // 🔴 **[codex 關卡2 must-fix ①] 只回 UI 真的要分支的那一個碼, 不回整個七態。**
      //    ⛔ ~~`formErrorCode: e.code`~~ —— 那把七個碼原封送過邊界, 而 client 只需要
      //    「是不是未驗證」**一個 bit**;送過去的其餘六個都是**白給的**。
      //    ⇒ 📌 **最小權限:白名單今天只有一個成員, 要加第二個是一個【刻意的動作】。**
      const code = (UI_BRANCHABLE_CODES as readonly string[]).includes(e.code)
        ? (e.code as typeof UI_BRANCHABLE_CODES[number])
        : undefined;
      return { formError: authErrorCopy(e.code), formErrorCode: code };
    }
    throw e;
  }

  // #190:成功後導回 sanitize 過的 next(同源白名單、不安全→ '/')。
  redirect(sanitizeNextParam(next));
}

// ══════════════════════════════════════════════════════════════════════════
// 重寄註冊驗證信(`⟦b4-SIGNUPOPEN1⟧` 前置片,2026-09-05;主視窗 `-f8` 11:5x 裁准)
// ══════════════════════════════════════════════════════════════════════════
// 🔴 **為什麼在這一支檔**:它是「登入被擋」的正對面 —— 上面 `authErrorCopy` 的
//    `email_confirmation_required` 那一格就是本函式存在的理由。兩者分家會漂。
//    🔵 **[2026-09-05「丙」]** 而 `LoginPage` 現在靠的是**碼**不是那一句字面(見 `formErrorCode`)。
//
// 🛑 **下面四條【逐條沿用 `login/forgot/actions.ts` 檔頭】** —— 它們是別人踩出來的,
//    不是我發明的;而兩支同族(對外寄信、帳號列舉敏感)的 action 形狀不同,
//    那個不同本身就會變成下一個人要解釋的偏離。
//    ① 帳號列舉防護:通過驗證之後,不論成功 / 帳號不存在 / 已驗證過 / 429,
//       一律回【同一個空物件】—— 任何分支差異都會讓這支變成帳號探測器。
//    ② `redirectTo` 只能從 `resolveSiteUrl()` 組,絕不可從 request header / host
//       (`app/auth/callback/route.ts:9-12` 記著同一條 codex 關卡2 must-fix)。
//    ③ `resolveSiteUrl()` 回 undefined ⇒ throw、不吞:那是站台設定錯誤不是帳號訊號。
//    ④ 留痕但不記 PII:記 outcome 與**長度**,不記 email、不記網域
//       (公開網域無妨,而公司網域會把範圍縮到一間公司 ⇒ 兩者在程式裡長得一樣,一律只記長度)。
//
// ⚠️ **而本片【不宣稱】它讓登入頁不再洩漏帳號是否存在** ——
//    `authErrorCopy` 今天就分得出「Email 或密碼錯誤」與「請先收信…」(本檔的 switch)
//    ⇒ 📌 那個列舉訊號**比本片早**,本片一個字都沒動它;要不要修是板上另一列。
//    本函式照樣做 ① 的理由:**它可以被直接呼叫**,不是只有那顆按鈕會叫它。
export type ResendConfirmationResult = {
  fieldErrors?: ForgotFieldErrors;
};

export async function resendSignupConfirmationAction(
  input: unknown,
): Promise<ResendConfirmationResult> {
  const v = validateForgot(input);
  if (!v.ok || !v.data) {
    return { fieldErrors: v.fieldErrors };
  }

  const base = resolveSiteUrl();
  if (!base) {
    // 刻意例外(同 forgot):站台設定錯誤要讓它壞得看得見,不可偽裝成「信已寄出」。
    throw new Error('NEXT_PUBLIC_SITE_URL 未設定,無法組出驗證信 redirectTo');
  }

  let outcome: 'requested' | 'provider_error' = 'requested';
  let errorCode: string | undefined;
  try {
    await resendSignupConfirmation(await getAuthService(), {
      email: v.data.email,
      // 🔵 驗證完成後導回登入頁 —— 而**不是**導回 `/login/reset`(那是忘記密碼那條路的)。
      redirectTo: `${base}/auth/callback?next=/login`,
    });
  } catch (e) {
    outcome = 'provider_error';
    // 🔴🔴 **[codex 關卡2 must-fix ③]** ⛔ ~~原本直接取 `code`, 理由寫「code 是封閉集」~~
    //    ⇒ **那句話對【我們自己的 AuthError】成立, 而這個 `catch` 接的是【任何東西】**:
    //      transport / Supabase 內部若丟出一個 `code` 是自由字串的物件(極端情形甚至是 email),
    //      它會**原封不動寫進 log** ⇒ 📌 一句正確的前提, 套在一個它涵蓋不到的路徑上。
    //    ✅ 改成**白名單**:不在 `AuthErrorCode` 那個封閉集裡的一律記成 `unrecognized`。
    //    🔵 白名單而不是黑名單 —— 黑名單在跟下一個沒想到的形狀賽跑。
    const rawCode = (e as { code?: unknown } | null)?.code;
    errorCode =
      typeof rawCode === 'string' && (KNOWN_AUTH_ERROR_CODES as readonly string[]).includes(rawCode)
        ? rawCode
        : 'unrecognized';
  }

  // 🔴 這一行在兩個世界印不同的東西:`requested` = 請 Auth 寄了而它沒回錯;
  //    `provider_error` = 它回錯了、而且知道是哪一類(429 會落在這裡)。
  // ⚠️ **而回應形狀不受它影響** —— 下面 `return {}` 仍是通過驗證後的唯一出口。
  console.info('[auth/resend-confirmation] 重寄驗證信請求', {
    outcome,
    ...(errorCode === undefined ? {} : { errorCode }),
    emailLength: v.data.email.length,
    emailDomainLength: v.data.email.slice(v.data.email.indexOf('@') + 1).length,
  });

  return {};
}
