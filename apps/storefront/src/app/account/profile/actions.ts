'use server';

// app/account/profile/actions.ts — 個人資料更新 server action(M-1-14e-g-4a、Q1=B 拆 g-4a 後端、g-4b UI)
//
// 對齊 plan v2(Sean Q1=B/Q2=A/Q2-1=b/Q3=A/Q4=A、2026-05-28) + codex k1 round1 修法:
// - 信任邊界 5 層(codex k1 Important 3):
//   ① server session user.id(getUser 驗 JWT,不從表單 body 取 customerUserId)
//   ② ProfileInput zod safeParse(name min(1) / phone default '' / birthday default '';strip 未知欄如 tier/id/wallet_balance)
//   ③ use-case Pick 型別白名單(updateProfile patch: Partial<Pick<Customer, 'name'|'phone'|'birthday'>>)
//   ④ RLS customers_update_own(auth.uid()=user_id 守 own row,跨 user row 寫入被 DB 擋)
//   ⑤ column GRANT(migration L231 GRANT UPDATE (name, phone, birthday, updated_at)、tier/wallet_balance 不在 GRANT)
// - birthday 空字串 normalize null(codex k1 Critical 1):DB date 欄 `'' → Postgres invalid input syntax`、
//   domain Customer.birthday = string | null 接受 null;`parsed.data.birthday || null` 轉換、phone 不必動(domain string)。
// - #181 雙通道(fieldErrors 逐欄 / formError 帳號層級)+ ok 標(g-4b client 自己 setSaved)。
// - updateProfile 走 customerRepo.update、拋一般 DB error(非 AuthError、不 import AuthError 避 lint 紅)、
//   formError 包裝「儲存失敗,請稍後再試」、不上洩 Supabase 原始 error。

import { updateProfile } from '@pcm/use-cases';
import { ProfileInput } from '@pcm/schemas';
import { getCustomerRepo } from '@/lib/auth/composition';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// 三欄 fieldErrors keys(對齊 ProfileInput zod 三欄 + design profile L666-669)。
export type ProfileFieldErrors = Partial<Record<'name' | 'phone' | 'birthday', string>>;

// #181 雙通道 + ok 標(g-4b client 收 ok=true 後 setSaved)。
export type UpdateProfileActionResult = {
  fieldErrors?: ProfileFieldErrors;
  formError?: string;
  ok?: true;
};

/**
 * 更新會員 name / phone / birthday。成功 → { ok: true };驗證失敗 → { fieldErrors };
 * 未登入 / DB 寫入失敗 → { formError }。caller 不需自取 user.id(server 內部從 session 取)。
 */
export async function updateProfileAction(input: unknown): Promise<UpdateProfileActionResult> {
  // 信任邊界 ①:server session getUser 驗 JWT、user.id 為 customerUserId 來源(絕不從 input 取)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  // 信任邊界 ②:ProfileInput safeParse(strip 未知欄、fieldErrors 逐欄)。
  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: ProfileFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0];
      if (path === 'name' || path === 'phone' || path === 'birthday') {
        fieldErrors[path] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
    // input 非 object / zod path 為空 → formError fallback,不無聲失敗(codex k1 Consider 3)。
    return { formError: '請填寫必要欄位' };
  }

  // 信任邊界 ③:Pick 型別白名單 + birthday '' → null normalize(codex k1 Critical 1)。
  const patch = {
    name: parsed.data.name,
    phone: parsed.data.phone,
    birthday: parsed.data.birthday || null,
  };

  try {
    await updateProfile(await getCustomerRepo(), user.id, patch);
  } catch {
    // 信任邊界 ④/⑤:RLS / GRANT 違反拋 PostgrestError(極罕、攻擊者偽造 user.id 失敗即此);
    // 不上洩 Supabase 原始 error、formError 包用戶字面。
    return { formError: '儲存失敗,請稍後再試' };
  }

  return { ok: true };
}
