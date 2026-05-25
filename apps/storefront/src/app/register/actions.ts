'use server';

// app/register/actions.ts — 註冊 server action(M-1-14e-f1-b、架構決策 A delivery 層信任邊界)
//
// 對齊 plan v4 §3 + §5 f1-b:
// - server 端重新驗證、不信 client(CLAUDE.md「會員等級驗證必在 server 端重新檢查」)。
// - RegisterInput.parse 驗證 + strip 未知欄(zod 預設剝除 schema 外 key、防 client 夾帶 tier/wallet_balance);
//   agree 為表單同意欄、驗證後不傳 use-case(只 name/email/phone/password 映射成 AuthSignUpParams)。
// - 收結構化 object(非 raw FormData)→ agree 已是 boolean、避開 FormData checkbox 'on'/缺值地雷(finding-9)。
// - 委派 registerCustomer(await getAuthService(), params)(getAuthService = composition root async per-request)。
// - 直登:Confirm email OFF(D-c-(1)、Sean dashboard 前置)→ needsEmailConfirmation=false → redirect(POST_AUTH_REDIRECT)。
//   email confirm 重開後(backlog #173)needsEmailConfirmation=true → 回提示字面、不 redirect(防無 session 假導向)。
// - 失敗映射 domain AuthError → 用戶字面(finding-9(c)、不上洩 Supabase 原始 error)。

import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { RegisterInput } from '@pcm/schemas';
import { AuthError, type AuthSignUpParams } from '@pcm/domain';
import { registerCustomer } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';
import { POST_AUTH_REDIRECT } from '@/lib/auth/constants';

export type RegisterActionResult = { error: string };

/** AuthError(domain code)→ 用戶可見字面;不洩漏 Supabase 原始 error。 */
function authErrorCopy(code: AuthError['code']): string {
  switch (code) {
    case 'email_already_registered':
      return '此 Email 已註冊';
    default:
      return '註冊失敗，請稍後再試';
  }
}

/**
 * 註冊。成功(直登)→ redirect(POST_AUTH_REDIRECT)(不回傳);失敗 → 回 { error } 給 client 顯示 auth-err。
 *
 * @param input client 端傳入的結構化物件(name/email/phone/password/agree);server 端 RegisterInput.parse 重驗 + strip。
 */
export async function registerAction(input: unknown): Promise<RegisterActionResult> {
  let params: AuthSignUpParams;
  try {
    const parsed = RegisterInput.parse(input); // 驗證 + strip 未知欄(tier/wallet 等被剝除)
    // 只映射 use-case 契約欄(AuthSignUpParams);agree 不進 use-case(表單同意欄、非 signUp 參數)。
    params = {
      email: parsed.email,
      password: parsed.password,
      metadata: { name: parsed.name, phone: parsed.phone },
    };
  } catch (e) {
    if (e instanceof ZodError) {
      return { error: e.issues[0]?.message ?? '請填寫必要欄位' };
    }
    throw e;
  }

  let result;
  try {
    result = await registerCustomer(await getAuthService(), params);
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: authErrorCopy(e.code) };
    }
    throw e;
  }

  if (result.needsEmailConfirmation) {
    // Confirm email 重開後(backlog #173)走此分支;f1-b dashboard 前置為 OFF、預期不命中。
    return { error: '註冊成功，請至信箱完成 Email 驗證後再登入。' };
  }
  redirect(POST_AUTH_REDIRECT);
}
