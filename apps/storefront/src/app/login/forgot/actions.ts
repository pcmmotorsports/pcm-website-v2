'use server';

// app/login/forgot/actions.ts — 忘記密碼 server action(忘記密碼接線片)
//
// 對齊 plan(docs/specs/2026-08-07-forgot-password-wire-plan-draft.md)§3-1(帳號列舉防護,本片最高風險點):
// - 只有驗證失敗才回 fieldErrors;只要通過驗證,不論 Supabase 回成功 / 帳號不存在 / AuthError(含
//   429 rate_limited),一律回同一個空物件 —— 任何分支差異都會讓這頁變成帳號探測器。
// - redirectTo 只能從 resolveSiteUrl() 組(plan §3-4 A 案:沿用已審過的 /auth/callback exchangeCodeForSession
//   + sanitizeNextParam 白名單,本頁只讀 session、不碰 code)。🔴 絕不可從 request header / host 組絕對 URL
//   (app/auth/callback/route.ts:9-12 記著同一條 codex 關卡2 must-fix)。
// - resolveSiteUrl() 回 undefined(prod 站台設定未完成)→ throw、不吞:那是「站台設定錯誤」不是帳號訊號,
//   吞掉的話每個客人都會看到「信寄出去了」而系統從頭到尾一封都沒寄 —— 對客人說謊,該讓它壞得看得見(500)。

import { requestPasswordReset } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';
import { validateForgot, type ForgotFieldErrors } from '@/lib/auth/field-validation';
import { resolveSiteUrl } from '@/lib/site-url';

export type ForgotActionResult = {
  fieldErrors?: ForgotFieldErrors;
};

export async function requestPasswordResetAction(input: unknown): Promise<ForgotActionResult> {
  const v = validateForgot(input);
  if (!v.ok || !v.data) {
    return { fieldErrors: v.fieldErrors };
  }

  const base = resolveSiteUrl();
  if (!base) {
    // 刻意例外(規格明訂、不是「優化」):站台設定錯誤要讓它壞得看得見,不可偽裝成「信已寄出」。
    throw new Error('NEXT_PUBLIC_SITE_URL 未設定,無法組出忘記密碼 redirectTo');
  }

  try {
    await requestPasswordReset(await getAuthService(), {
      email: v.data.email,
      redirectTo: `${base}/auth/callback?next=/login/reset`,
    });
  } catch {
    // 安全通道(§3-1):寄信成功 / 帳號不存在 / AuthError(含 rate_limited)一律回同一形狀,
    // 不上洩任何差異(連錯誤本身都不看一眼、故意不判斷 e 的內容)。
  }

  return {};
}
