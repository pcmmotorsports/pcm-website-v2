'use server';

// app/account/profile/actions.ts — 個人資料更新 server action(M-1-14e-g-4a、Q1=B 拆 g-4a 後端、g-4b UI)
//
// 對齊 plan v2(Sean Q1=B/Q2=A/Q2-1=b/Q3=A/Q4=A、2026-05-28) + codex k1 round1 修法:
// - 信任邊界 5 層(codex k1 Important 3):
//   🔴 **2026-09-01 訂正射程(codex R1 nit)**:這五層【不是每一個請求都依序經過】——
//      一個已登入的客人可以直接打 Supabase REST ⇒ 繞過 ①②③(zod / use-case / adapter)。
//      ⇒ **無論如何都擋得住的只有 ④RLS + ⑤欄級 GRANT + DB 的 CHECK**(那三道在 DB 裡)。
//      ⇒ 📌 ①②③ 的價值是【給得出逐欄錯誤訊息】,不是安全 —— 兩者常被寫成同一句話。
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
export type ProfileFieldErrors = Partial<Record<'name' | 'phone' | 'birthday' | 'gender', string>>;

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
      if (path === 'name' || path === 'phone' || path === 'birthday' || path === 'gender') {
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
    // 🔴 空字串 ⇒ `null`,同 birthday 那條:DB 那一欄的 CHECK 不收 `''`。
    //    ⚠️ 而**語意也不同**:`''` 是「這次沒選」,而我們要存的是「沒有值」。
    //    🛑 而它有一個代價:**選了之後再改回「不選擇」= 把值清成 null** ——
    //       而 `null` 同時代表「沒被問」。⇒ 那兩件事在 DB 裡分不開,而這是已知的
    //       (`Customer.gender` 的 docstring 逐字寫著同一句)。要分開得另立一個「拒答」值,
    //       而 `'undisclosed'` 就是為此存在的 ⇒ **想表達「我不說」的人該選它,不是清空。**
    // 🔴 **`undefined`(欄位缺席)與 `''`(選了不選擇)在這裡分岔** —— codex R1 must-fix:
    //    缺席 ⇒ **整個 key 不進 patch** ⇒ mapper 的 `!== undefined` 會跳過它 ⇒ DB 那一欄不動;
    //    `''`  ⇒ 進 patch 且值為 `null` ⇒ 真的把它清掉(那是使用者明確按的)。
    //    📌 少了這個分岔,一個舊分頁送出一次就會清掉他已經填好的性別。
    ...(parsed.data.gender === undefined ? {} : { gender: parsed.data.gender || null }),
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
