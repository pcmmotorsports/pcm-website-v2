'use server';

// app/login/reset/actions.ts — 設定新密碼 server action(忘記密碼接線片)
//
// 對齊 plan(docs/specs/2026-08-07-forgot-password-wire-plan-draft.md)§4-E:
// - 逐欄驗證用 validateResetPassword(密碼規則沿用 LoginInput ≥8 碼;confirm 兩句 Sean Q24-e
//   拍板「照稿用」逐字文案,不改寫)。
// - resetPassword use-case 依賴注入 client 已帶有效 recovery session(由 /auth/callback
//   exchangeCodeForSession 交換而來;本片 code 交換不在本頁、見 app/login/reset/page.tsx)。
// - 失敗 AuthError → 用戶字面(對齊 app/login/actions.ts authErrorCopy 慣例、不上洩 Supabase 原始 error);
//   rate_limited / password_same_as_current 各有專屬字面。成功回空物件,client 切到狀態 C。

import { AuthError } from '@pcm/domain';
import { resetPassword } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';
import { validateResetPassword, type ResetPasswordFieldErrors } from '@/lib/auth/field-validation';
import { WEAK_PASSWORD_FIELD_ERROR } from '@/lib/auth/auth-copy';
import { getVerifiedUser } from '@/lib/auth/verified-user';
import { clearLoginAttempts } from '@/lib/auth/login-throttle';

export type ResetPasswordActionResult = {
  fieldErrors?: ResetPasswordFieldErrors;
  formError?: string;
  /** 密碼已更新, 但登入限次沒解除成功(資安修正片 3)。畫面要說明並給「重新解除限制」。 */
  unlockFailed?: boolean;
};

/** AuthError(domain code)→ 用戶可見字面;不洩漏 Supabase 原始 error(對齊 app/login/actions.ts 慣例)。 */
function authErrorCopy(code: AuthError['code']): string {
  switch (code) {
    case 'rate_limited':
      return '操作太頻繁，請稍後再試';
    case 'password_same_as_current':
      return '新密碼不能與目前密碼相同';
    default:
      return '設定新密碼失敗，請稍後再試';
  }
}

export async function resetPasswordAction(input: unknown): Promise<ResetPasswordActionResult> {
  const v = validateResetPassword(input);
  if (!v.ok || !v.data) {
    return { fieldErrors: v.fieldErrors };
  }

  try {
    await resetPassword(await getAuthService(), v.data.password);
  } catch (e) {
    if (e instanceof AuthError) {
      // client 只驗 ≥8 碼,而 Supabase 還有密碼政策與外洩密碼保護;沒有這條, 客人只看到「請稍後再試」,
      // 那句是錯的, 再試一百次也不會過。改顯示在密碼欄(2026-09-26, 與註冊頁同一句)。
      if (e.code === 'password_too_weak') return { fieldErrors: { password: WEAK_PASSWORD_FIELD_ERROR } };
      return { formError: authErrorCopy(e.code) };
    }
    throw e;
  }

  // 資安修正片 3(2026-09-26):密碼改好了就解除登入限次, 否則被鎖的客人改完密碼還是登不進去。
  // 🔴 Email 只取伺服器端登入狀態(重設信建立的那個登入), 不讀表單送來的任何值。
  return (await unlockSignedInEmail()) ? {} : { unlockFailed: true };
}

/**
 * 設定新密碼頁「重新解除限制」按鈕。回 true = 已解除。
 * 任何已登入的人都叫得動, 但只能清「自己登入帳號」的 Email:限次保護的就是那個帳號的密碼,
 * 已經登入的人本來就在裡面, 所以這不是繞過(Fable 片 3 R1 C1)。
 */
export async function retryUnlockAction(): Promise<boolean> {
  return unlockSignedInEmail();
}

async function unlockSignedInEmail(): Promise<boolean> {
  const { user } = await getVerifiedUser();
  // 登入狀態裡沒有 Email 的帳號本來就不會被依 Email 限次鎖住 ⇒ 當成成功
  if (!user?.email) return true;
  return clearLoginAttempts(user.email);
}
