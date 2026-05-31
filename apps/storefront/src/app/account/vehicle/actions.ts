'use server';

// app/account/vehicle/actions.ts — 我的愛車 新增 server action(M-1-14e-g-6b;編輯/刪除/設主車 g-6c 接)
//
// 鏡像 g-5b addAddressAction 信任邊界 pattern(已過 codex 雙關卡):
// - ① server session getUser 取 user.id(不從表單 body 取 customerUserId)
// - ② VehicleInput zod safeParse(strip 未知欄;僅 name 必填、無巢狀欄位 → 比 AddressInput 簡單、無 invoice superRefine)
// - ③ addVehicle use-case 用 currentUserId 填 customerUserId、收窄型別 VehicleCreateInput(不信 input id/customerUserId)
// - ④ RLS vehicles_*_own(auth.uid()=customer_user_id 守自己 row、跨 user 寫入被 DB 擋)
// - ⑤ DB CHECK / partial unique(每 customer 至多一輛 isPrimary;e-2b unsetCurrentPrimaryExcept 先 unset→create swap)
// - addVehicle isPrimary=true → unsetCurrentPrimaryExcept(先 unset 舊主車→create、best-effort swap、e-2b 已實作)
//
// #181 雙通道 + ok 標(g-6b InlineVehicleForm 收 ok 後 router.refresh + onClose):
// - fieldErrors 逐欄(僅 name;VehicleInput 只 name.min(1)、無巢狀)。
// - formError 帳號層級(請重新登入 / 儲存失敗);不洩 Supabase 原始 error。

import { addVehicle } from '@pcm/use-cases';
import { VehicleInput } from '@pcm/schemas';
import { getVehicleRepo } from '@/lib/auth/composition';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// 逐欄 fieldErrors(僅 name;VehicleInput 只 name 必填、其餘選填無格式驗證、無巢狀 → 比 address invoice 簡單)。
export type VehicleFieldErrors = {
  name?: string;
};

// #181 雙通道 + ok 標(同 addAddressAction 形狀;client 收 ok=true 後 router.refresh + 收合表單)。
export type AddVehicleActionResult = {
  fieldErrors?: VehicleFieldErrors;
  formError?: string;
  ok?: true;
};

/**
 * 新增愛車。成功 → { ok: true };驗證失敗(車型空)→ { fieldErrors };
 * 未登入 / DB 寫入失敗 → { formError }。caller 不需自取 user.id(server 內部從 session 取)。
 */
export async function addVehicleAction(input: unknown): Promise<AddVehicleActionResult> {
  // 信任邊界 ①:server session getUser 驗 JWT、user.id 守 ownership(絕不從 input 取 customerUserId)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  // 信任邊界 ②:VehicleInput safeParse(strip 未知欄;僅 name 必填、無巢狀 superRefine)。
  const parsed = VehicleInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: VehicleFieldErrors = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'name') {
        fieldErrors.name = issue.message;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
    return { formError: '請填寫必要欄位' };
  }

  // 信任邊界 ③/④/⑤:addVehicle 用 user.id 填 customerUserId(不信 input)、isPrimary→unsetCurrentPrimaryExcept swap、
  // RLS / partial unique 守;catch 不上洩原始 error。
  try {
    await addVehicle(await getVehicleRepo(), user.id, parsed.data);
  } catch {
    return { formError: '儲存失敗,請稍後再試' };
  }

  return { ok: true };
}
