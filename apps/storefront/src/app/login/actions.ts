'use server';

// app/login/actions.ts — 登入 server action(M-1-14e-f1-a、架構決策 A delivery 層信任邊界)
//
// 對齊 plan v4 §3:
// - server 端重新驗證、不信 client(CLAUDE.md「會員等級驗證必在 server 端重新檢查」)。
// - LoginInput.parse 驗證 + strip 未知欄(zod 預設剝除 schema 外 key、防 client 夾帶 tier/wallet_balance)。
// - 收結構化 object(非 raw FormData)→ remember 已是 boolean、避開 FormData checkbox 'on'/缺值地雷(finding-9)。
// - 委派 loginCustomer(getAuthService(), creds)(getAuthService = composition root async per-request)。
// - 失敗映射 domain AuthError → 用戶字面(finding-9(c)、不上洩 Supabase 原始 error)。
// - 成功 redirect(POST_AUTH_REDIRECT)(plan §4 [D]、三處 redirect 共用 '/').

import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { LoginInput } from '@pcm/schemas';
import { AuthError } from '@pcm/domain';
import { loginCustomer } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';
import { POST_AUTH_REDIRECT } from '@/lib/auth/constants';

export type LoginActionResult = { error: string };

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
 * 登入。成功 → redirect(POST_AUTH_REDIRECT)(不回傳);失敗 → 回 { error } 給 client 顯示 auth-err。
 *
 * @param input client 端傳入的結構化物件(email/password/remember);server 端 LoginInput.parse 重驗 + strip。
 */
export async function loginAction(input: unknown): Promise<LoginActionResult> {
  let creds: { email: string; password: string };
  try {
    const parsed = LoginInput.parse(input); // 驗證 + strip 未知欄(tier/wallet 等被剝除)
    creds = { email: parsed.email, password: parsed.password }; // remember 屬 session 持久化、不進 use-case
  } catch (e) {
    if (e instanceof ZodError) {
      return { error: e.issues[0]?.message ?? '請輸入有效的 Email 與密碼' };
    }
    throw e;
  }

  try {
    await loginCustomer(await getAuthService(), creds);
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: authErrorCopy(e.code) };
    }
    throw e;
  }

  redirect(POST_AUTH_REDIRECT);
}
