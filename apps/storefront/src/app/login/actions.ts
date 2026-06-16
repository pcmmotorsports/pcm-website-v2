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
import { loginCustomer } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';
import { validateLogin, type LoginFieldErrors } from '@/lib/auth/field-validation';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';

// #181 Q2=B:雙通道回傳 — fieldErrors(逐欄驗證)/ formError(帳號層級、頂部)。成功 redirect 不回傳。
export type LoginActionResult = {
  fieldErrors?: LoginFieldErrors;
  formError?: string;
};

/** AuthError(domain code)→ 用戶可見字面;不洩漏 Supabase 原始 error。 */
function authErrorCopy(code: AuthError['code']): string {
  switch (code) {
    case 'credentials_invalid':
      return 'Email 或密碼錯誤';
    case 'email_confirmation_required':
      return '請先收信完成 Email 驗證後再登入';
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
      return { formError: authErrorCopy(e.code) };
    }
    throw e;
  }

  // #190:成功後導回 sanitize 過的 next(同源白名單、不安全→ '/')。
  redirect(sanitizeNextParam(next));
}
