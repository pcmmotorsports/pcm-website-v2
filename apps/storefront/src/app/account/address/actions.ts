'use server';

// app/account/address/actions.ts — 收件地址 新增 / 更新 / 刪除 server action(M-1-14e-g-5b 新增、g-5c 更新+刪除)
//
// 鏡像 g-4a updateProfileAction 信任邊界 pattern(已過 codex 雙關卡):
// - ① server session getUser 取 user.id(不從表單 body 取 customerUserId)
// - ② AddressInput zod safeParse(strip 未知欄 + invoice superRefine:company→title/taxId、donate→donateCode)
// - ③ addAddress use-case 用 currentUserId 填 customerUserId、收窄型別 AddressCreateInput(不信 input id/customerUserId)
// - ④ RLS addresses_*_own(auth.uid()=customer_user_id 守自己 row、跨 user 寫入被 DB 擋)
// - ⑤ DB CHECK addresses_invoice_company_has_data / _donate_has_code(superRefine 已對齊、最後防線)
// - addAddress isDefault=true → unsetCurrentDefaultExcept(先 unset 舊預設→create、best-effort swap、e-2a 已實作)
//
// #181 雙通道 + ok 標(g-5b InlineAddressForm 收 ok 後 router.refresh + onClose):
// - fieldErrors 逐欄,**含巢狀 invoice 路徑**:AddressInput superRefine issue.path 為 ['invoice','taxId'] 等,
//   對應到表單 company/donate tab 下的 invoice 欄;頂層 name/phone/line 走 fieldErrors[欄]。
// - formError 帳號層級(請重新登入 / 儲存失敗);不洩 Supabase 原始 error。

import { addAddress, updateAddress, deleteAddress } from '@pcm/use-cases';
import { AddressInput } from '@pcm/schemas';
import { getAddressRepo } from '@/lib/auth/composition';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// invoice 巢狀 fieldErrors(對齊 AddressInput superRefine path ['invoice', 'title'|'taxId'|'donateCode'])。
export type AddressInvoiceFieldErrors = Partial<
  Record<'carrier' | 'title' | 'taxId' | 'donateCode', string>
>;
// 頂層三欄(name/phone/line)+ 巢狀 invoice;對齊 design InlineAddressForm 各欄。
export type AddressFieldErrors = {
  name?: string;
  phone?: string;
  line?: string;
  invoice?: AddressInvoiceFieldErrors;
};

// #181 雙通道 + ok 標(同 updateProfileAction 形狀;client 收 ok=true 後 router.refresh + 收合表單)。
export type AddAddressActionResult = {
  fieldErrors?: AddressFieldErrors;
  formError?: string;
  ok?: true;
};

// g-5c 更新結果同新增形狀(InlineAddressForm onSubmit 共用此型別、編輯重用同表單)。
export type UpdateAddressActionResult = AddAddressActionResult;

// g-5c 刪除結果:無表單驗證(ownership 靠 use-case + RLS)、只回 formError / ok。
export type DeleteAddressActionResult = {
  formError?: string;
  ok?: true;
};

/**
 * 新增收件地址。成功 → { ok: true };驗證失敗 → { fieldErrors }(含巢狀 invoice);
 * 未登入 / DB 寫入失敗 → { formError }。caller 不需自取 user.id(server 內部從 session 取)。
 */
export async function addAddressAction(input: unknown): Promise<AddAddressActionResult> {
  // 信任邊界 ①:server session getUser 驗 JWT、user.id 為 customerUserId 來源(絕不從 input 取)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  // 信任邊界 ②:AddressInput safeParse(strip 未知欄 + invoice superRefine、fieldErrors 逐欄含巢狀)。
  const parsed = AddressInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: AddressFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const p0 = issue.path[0];
      const p1 = issue.path[1];
      if (
        p0 === 'invoice' &&
        (p1 === 'carrier' || p1 === 'title' || p1 === 'taxId' || p1 === 'donateCode')
      ) {
        (fieldErrors.invoice ??= {})[p1] = issue.message;
      } else if (p0 === 'name' || p0 === 'phone' || p0 === 'line') {
        fieldErrors[p0] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
    // input 非 object / path 為空 → formError fallback,不無聲失敗(對齊 updateProfileAction)。
    return { formError: '請填寫必要欄位' };
  }

  // 信任邊界 ③/④/⑤:addAddress 用 currentUserId 填 customerUserId(不信 input)、isDefault swap、
  // RLS / DB CHECK 守;parsed.data shape 等同 AddressCreateInput(已 strip id/customerUserId/時間欄)。
  try {
    await addAddress(await getAddressRepo(), user.id, parsed.data);
  } catch {
    // RLS / CHECK / 連線異常拋 PostgrestError;不上洩原始 error、formError 包用戶字面。
    return { formError: '儲存失敗,請稍後再試' };
  }

  return { ok: true };
}

/**
 * 更新收件地址(g-5c、編輯重用 InlineAddressForm)。成功 → { ok: true };驗證失敗 → { fieldErrors }(含巢狀 invoice);
 * 未登入 / DB 寫入失敗 → { formError }。`addressId` 由 caller(AddressTab parent closure)綁;
 * ownership 不從 input 信任,由 updateAddress use-case(isDefault 時 verifyOwnedThenUnsetOthers)+ RLS addresses_update_own 守。
 *
 * 信任邊界鏡像 addAddressAction(① getUser ② AddressInput safeParse 含巢狀 invoice ③ updateAddress 用 user.id + patch 白名單
 * ④ RLS ⑤ DB CHECK);parse / fieldErrors 流程刻意與 addAddressAction 對齊(禁止清單保護 addAddressAction、不抽共用 helper 改動它)。
 */
export async function updateAddressAction(
  addressId: string,
  input: unknown,
): Promise<UpdateAddressActionResult> {
  // 信任邊界 ①:server session getUser 驗 JWT、user.id 守 ownership(絕不從 input 取 customerUserId)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  // 信任邊界 ②:AddressInput safeParse(strip 未知欄 + invoice superRefine、fieldErrors 逐欄含巢狀)。
  const parsed = AddressInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: AddressFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const p0 = issue.path[0];
      const p1 = issue.path[1];
      if (
        p0 === 'invoice' &&
        (p1 === 'carrier' || p1 === 'title' || p1 === 'taxId' || p1 === 'donateCode')
      ) {
        (fieldErrors.invoice ??= {})[p1] = issue.message;
      } else if (p0 === 'name' || p0 === 'phone' || p0 === 'line') {
        fieldErrors[p0] = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
    return { formError: '請填寫必要欄位' };
  }

  // 信任邊界 ③/④/⑤:updateAddress 用 user.id 驗 ownership、patch 白名單(parsed.data 已 strip id/customerUserId/時間欄)、
  // RLS / DB CHECK 守;跨會員越權 / 不存在 id 由 use-case verify + RLS 擋。
  try {
    await updateAddress(await getAddressRepo(), user.id, addressId, parsed.data);
  } catch {
    return { formError: '儲存失敗,請稍後再試' };
  }

  return { ok: true };
}

/**
 * 刪除收件地址(g-5c)。成功 → { ok: true };未登入 / 刪除失敗(含 ownership 不符 use-case 拋)→ { formError }。
 * 無表單驗證;`addressId` 由 caller 綁,ownership 由 deleteAddress use-case(listByCustomer 驗 + 刪後遞補首筆預設)
 * + RLS addresses_delete_own 守。catch 不上洩原始 error。
 */
export async function deleteAddressAction(addressId: string): Promise<DeleteAddressActionResult> {
  // 信任邊界 ①:server session getUser、user.id 守 ownership(deleteAddress 內 listByCustomer 驗本人才刪)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  try {
    await deleteAddress(await getAddressRepo(), user.id, addressId);
  } catch {
    // ownership 不符(use-case 拋)/ RLS / 連線異常;不上洩原始 error、formError 包用戶字面。
    return { formError: '刪除失敗,請稍後再試' };
  }

  return { ok: true };
}
