'use server';

// app/register/actions.ts — 註冊 server action(M-1-14e-f1-b、#181 逐欄錯誤強化、架構決策 A delivery 層信任邊界)
//
// 對齊 plan v4 §3 + §5 f1-b + backlog #181(Sean Q2=B):
// - server 端重新驗證、不信 client(CLAUDE.md「會員等級驗證必在 server 端重新檢查」)。
// - #181 Q2=B:逐欄驗證走共用 validateRegister(空欄專屬「請填寫…」+ 非空格式錯沿用 zod;client/server 同一份)。
//   驗證失敗 → 回 { fieldErrors }(逐欄、對應到 client 該欄下方顯示)。
// - validateRegister 成功回的 data 已 strip 未知欄(zod object 預設剝除 schema 外 key、防 client 夾帶 tier/wallet);
//   agree 為表單同意欄、驗證後不傳 use-case(只 name/email/phone/password 映射成 AuthSignUpParams)。
// - 直登:Confirm email OFF(D-c-(1)、Sean dashboard 前置)→ needsEmailConfirmation=false → redirect(POST_AUTH_REDIRECT)。
//   email confirm 重開後(backlog #173)needsEmailConfirmation=true → 回 formError 提示、不 redirect(防無 session 假導向)。
// - 帳號層級錯(此 Email 已註冊 / needsEmailConfirmation)走 formError 頂部通道、不被逐欄取代(#181 Sean 釘死 2)。
// - 失敗映射 domain AuthError → 用戶字面(finding-9(c)、不上洩 Supabase 原始 error)。

import { redirect } from 'next/navigation';
import { AuthError, type AuthSignUpParams } from '@pcm/domain';
import { registerCustomer } from '@pcm/use-cases';
import { getAuthService } from '@/lib/auth/composition';
import { validateRegister, type RegisterFieldErrors } from '@/lib/auth/field-validation';
import { sanitizeNextParam } from '@/lib/auth/safe-redirect';

// #181 Q2=B:雙通道回傳 — fieldErrors(逐欄驗證)/ formError(帳號層級、頂部)。成功 redirect 不回傳。
// 🔵 2026-08-31 `-15` 加第三個通道 formNotice —— **成功訊息不再穿錯誤的衣服**。
//    成因(`RegisterPage.tsx` clearErr 的 R1 must-fix 註解早就寫下來了,而它是【失效條件】不是缺陷):
//    confirm email 重開的那一刻,「註冊成功,請至信箱驗證」會走 formError ⇒ 它①用 .auth-err 紅底呈現
//    ②被 clearErr 在客人按下第一個鍵時清掉 ⇒ 客人重送 ⇒ 拿到「此 Email 已註冊」⇒ 以為註冊失敗。
//    ⇒ 分開通道之後:formNotice 不進 clearErr、走 .auth-ok。**這是客人看得到的錯,不是內部整潔。**
export type RegisterActionResult = {
  fieldErrors?: RegisterFieldErrors;
  formError?: string;
  /** 非錯誤的頂部訊息(目前唯一來源:confirm email 重開後的「請收信驗證」)。不被 clearErr 清掉。 */
  formNotice?: string;
};

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
 * 註冊。成功(直登)→ redirect(POST_AUTH_REDIRECT)(不回傳);
 * 驗證失敗 → 回 { fieldErrors };帳號層級失敗 → 回 { formError }。
 *
 * @param input client 端傳入的結構化物件(name/email/phone/password/agree);server 端 validateRegister 重驗 + strip。
 * @param next  #190 註冊直登後導回路徑;server 端 sanitizeNextParam 同源白名單(獨立參數、不安全→ '/')。
 */
export async function registerAction(input: unknown, next?: string | null): Promise<RegisterActionResult> {
  const v = validateRegister(input);
  if (!v.ok || !v.data) {
    // 有逐欄錯 → fieldErrors;否則(罕見:非顯示欄 schema error)→ formError fallback、不無聲失敗。
    if (Object.keys(v.fieldErrors).length > 0) {
      return { fieldErrors: v.fieldErrors };
    }
    return { formError: '請填寫必要欄位' };
  }

  // v.data 已 strip 未知欄;只映射 use-case 契約欄(AuthSignUpParams);agree 不進 use-case(表單同意欄、非 signUp 參數)。
  // 🔴 gender 走 `options.data` ⇒ `auth.users.raw_user_meta_data` ⇒ 由 trigger
  //    `handle_new_auth_user()` 搬進 `customers.gender`(migration 20260831150000)。
  //    ⚠️ **送的是代碼**(male / female / undisclosed), 不是畫面上的中文 ——
  //    對應表在 `@pcm/schemas` 的 `GENDER_LABEL`, 那是唯一真相。
  //    🔵 沒選 ⇒ `v.data.gender` 是 undefined ⇒ 這個 key 不會進 metadata
  //       ⇒ trigger 那側 `raw_user_meta_data->>'gender'` 取到 NULL ⇒ 收成 NULL。**選填就是這樣成立的。**
  //    🛑 而 **DB 那側不信任這裡** —— trigger 有 CASE 白名單, 送一個值域外的字串
  //       不會炸掉註冊, 只會被當成沒填。這一層與那一層是兩道, 不是重複。
  const params: AuthSignUpParams = {
    email: v.data.email,
    password: v.data.password,
    metadata: { name: v.data.name, phone: v.data.phone, gender: v.data.gender },
  };

  let result;
  try {
    result = await registerCustomer(await getAuthService(), params);
  } catch (e) {
    if (e instanceof AuthError) {
      return { formError: authErrorCopy(e.code) };
    }
    throw e;
  }

  if (result.needsEmailConfirmation) {
    // Confirm email 重開後(backlog #173)走此分支;f1-b dashboard 前置為 OFF、預期不命中。
    // 🔵 走 formNotice 不走 formError:它是【成功】訊息, 而且是客人唯一的成功訊號。
    return { formNotice: '註冊成功，請至信箱完成 Email 驗證後再登入。' };
  }
  // #190:直登成功後導回 sanitize 過的 next(同源白名單、不安全→ '/')。
  redirect(sanitizeNextParam(next));
}
