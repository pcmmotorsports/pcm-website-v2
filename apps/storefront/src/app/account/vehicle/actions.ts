'use server';

// app/account/vehicle/actions.ts — 我的愛車 新增 / 更新 / 刪除 server action(M-1-14e-g-6b 新增、g-6c 更新+刪除)
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

import { addVehicle, updateVehicle, deleteVehicle } from '@pcm/use-cases';
import { VehicleInput } from '@pcm/schemas';
import { getVehicleRepo } from '@/lib/auth/composition';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { fetchVehicleTaxonomy } from '@/lib/products';

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
 * V-1d server fail-closed 字典驗證(值班台 REQUIRED:client 選單只是便利、不可信):
 * dict 對有值 → 逐字驗 brand.name 存在於 taxonomy 且 model.name 屬該 brand;查無=拒寫。
 * taxonomy 載入失敗(fetchVehicleTaxonomy 內部 catch 回 [])→ dict 路徑一律拒(fail-closed)、
 * 自由輸入路徑(dict 雙 null)不受影響。成對性已由 schema refine+DB CHECK 雙層守、此處不重驗。
 */
async function validateDictPair(data: VehicleInput): Promise<AddVehicleActionResult | null> {
  if (data.dictBrandName === null) return null;
  const taxonomy = await fetchVehicleTaxonomy();
  if (taxonomy.length === 0) {
    return { formError: '車款清單暫時無法載入,請稍後再試或改用自行輸入' };
  }
  const brand = taxonomy.find((b) => b.name === data.dictBrandName);
  const model = brand?.models.find((m) => m.name === data.dictModelName);
  if (!brand || !model) {
    return { fieldErrors: { name: '所選車款不在清單中,請重新選擇或改用自行輸入' } };
  }
  return null;
}

// g-6c 更新結果同新增形狀(InlineVehicleForm onSubmit 共用此型別、編輯重用同表單)。
export type UpdateVehicleActionResult = AddVehicleActionResult;

// g-6c 刪除結果:無表單驗證(ownership 靠 use-case + RLS)、只回 formError / ok。
export type DeleteVehicleActionResult = {
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

  // V-1d:dict 對 fail-closed 字典驗證(查無/載入失敗=拒寫;自由輸入不受影響)。
  const dictReject = await validateDictPair(parsed.data);
  if (dictReject) return dictReject;

  // 信任邊界 ③/④/⑤:addVehicle 用 user.id 填 customerUserId(不信 input)、isPrimary→unsetCurrentPrimaryExcept swap、
  // RLS / partial unique 守;catch 不上洩原始 error。
  try {
    await addVehicle(await getVehicleRepo(), user.id, parsed.data);
  } catch {
    return { formError: '儲存失敗,請稍後再試' };
  }

  return { ok: true };
}

/**
 * 更新愛車(g-6c、編輯重用 InlineVehicleForm)。成功 → { ok: true };驗證失敗(車型空)→ { fieldErrors };
 * 未登入 / DB 寫入失敗 → { formError }。`vehicleId` 由 caller(VehiclesTab parent closure)綁;
 * ownership 不從 input 信任,由 updateVehicle use-case(isPrimary 時 verifyOwnedThenUnsetOtherPrimary)+ RLS vehicles_update_own 守。
 *
 * 信任邊界鏡像 addVehicleAction(① getUser ② VehicleInput safeParse 僅 name ③ updateVehicle 用 user.id + patch 白名單
 * ④ RLS ⑤ partial unique);plain-update(非 isPrimary)僅 RLS 守 ownership、app 層 backstop 同 address #199(defense-in-depth)。
 */
export async function updateVehicleAction(
  vehicleId: string,
  input: unknown,
): Promise<UpdateVehicleActionResult> {
  // 信任邊界 ①:server session getUser 驗 JWT、user.id 守 ownership(絕不從 input 取 customerUserId)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  // 信任邊界 ②:VehicleInput safeParse(strip 未知欄;僅 name 必填、無巢狀)。
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

  // V-1d:dict 對 fail-closed 字典驗證(同 add;REQUIRED-1 恆寫兩欄由 schema default(null) 保證
  // parsed.data 恆帶 dict 對 → mapper 恆寫入、dict→free 存檔=雙 null 覆蓋不殘留)。
  const dictReject = await validateDictPair(parsed.data);
  if (dictReject) return dictReject;

  // 信任邊界 ③/④/⑤:updateVehicle 用 user.id 驗 ownership、patch 白名單(parsed.data 已 strip id/customerUserId/時間欄)、
  // RLS / partial unique 守;跨會員越權 / 不存在 id 由 use-case verify(isPrimary)+ RLS 擋。
  try {
    await updateVehicle(await getVehicleRepo(), user.id, vehicleId, parsed.data);
  } catch {
    return { formError: '儲存失敗,請稍後再試' };
  }

  return { ok: true };
}

/**
 * 刪除愛車(g-6c)。成功 → { ok: true };未登入 / 刪除失敗(含 ownership 不符 use-case 拋)→ { formError }。
 * 無表單驗證;`vehicleId` 由 caller 綁,ownership 由 deleteVehicle use-case(listByCustomer 驗 + 刪後遞補首台主車)
 * + RLS vehicles_delete_own 守。catch 不上洩原始 error。
 */
export async function deleteVehicleAction(vehicleId: string): Promise<DeleteVehicleActionResult> {
  // 信任邊界 ①:server session getUser、user.id 守 ownership(deleteVehicle 內 listByCustomer 驗本人才刪)。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { formError: '請重新登入' };
  }

  try {
    await deleteVehicle(await getVehicleRepo(), user.id, vehicleId);
  } catch {
    // ownership 不符(use-case 拋)/ RLS / 連線異常;不上洩原始 error、formError 包用戶字面。
    return { formError: '刪除失敗,請稍後再試' };
  }

  return { ok: true };
}
