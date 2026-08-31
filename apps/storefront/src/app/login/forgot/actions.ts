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

  // 🔴🔴 **板 `:443` ⟦b4-AUTHMAIL1⟧ 半A(2026-09-01)** ——
  //   那一列的病逐字是:「**『還沒寄』與『寄不出去』在我們這一側【沒有任何欄位分得開】**」。
  //   而在這一片之前,這裡的 `catch {}` 把錯誤**整個丟掉,連看都不看**
  //   ⇒ 一個客人打電話說「我沒收到重設信」,我們**查不到任何東西**:
  //     不知道有沒有請 Auth 寄、不知道它有沒有回錯、不知道是不是被限流。
  //
  //   🛑 **而那個 `catch {}` 的理由是【對的】,本片一個字都不動它**:
  //     §3-1 帳號列舉防護 —— **回給瀏覽器的東西**不論成功 / 帳號不存在 / rate_limited
  //     都必須是同一形狀,任何分支差異都會讓這頁變成帳號探測器。
  //   ✅ **⇒ 而「回應不得有差異」與「伺服器不得留紀錄」是兩件事。**
  //     本片只加後者:**server log**,回應形狀逐字未改(下面 `return {}` 仍是唯一出口)。
  //
  //   ⚠️ **不記 email**(它是 PII,而 log 會流到 access log / 監控)——
  //     記的是**長度**,那足夠讓客服對得上「是不是同一個人打來的」,而不足以反查是誰。
  //   🔴 **而網域那一格我刻意【不記網域本身,只記它的長度】**:
  //     `gmail.com` 這種公開網域無妨,而**公司網域會把範圍縮到一間公司**
  //     ⇒ 兩者在程式裡長得一樣,所以一律只記長度。
  let outcome: 'requested' | 'provider_error' = 'requested';
  let errorCode: string | undefined;
  try {
    await requestPasswordReset(await getAuthService(), {
      email: v.data.email,
      redirectTo: `${base}/auth/callback?next=/login/reset`,
    });
  } catch (e) {
    outcome = 'provider_error';
    // 🔵 只取 `code`(`AuthErrorCode` 那個封閉集)—— **不取 message**,
    //    因為 message 是 provider 給的自由字串,而它可能含 email。
    errorCode = (e as { code?: string } | null)?.code ?? 'unknown';
  }

  // 🔴 **這一行是本片的全部產出。** 而它要在兩個世界印不同的東西:
  //    `requested`      = 我們請 Auth 寄了、而它沒回錯 ⇒ **「還沒寄」不成立**
  //    `provider_error` = 它回錯了 ⇒ **「寄不出去」,而且知道是哪一類**
  //    ⇒ 📌 在這一行之前,那兩個世界在我們這一側印**同一個東西:什麼都沒有**。
  // ⚠️ **而它證不到「客人的信箱真的收到了」** —— 那一段在 provider 手上,
  //    要它得開 Supabase 的 Send Email Hook(後台設定,只有 Sean 按得到)。
  //    ⇒ 本片刻意**不宣稱**那一格;板列上那半仍然開著。
  console.info('[auth/forgot] 重設密碼信請求', {
    outcome,
    ...(errorCode === undefined ? {} : { errorCode }),
    emailLength: v.data.email.length,
    emailDomainLength: v.data.email.slice(v.data.email.indexOf('@') + 1).length,
  });

  return {};
}
