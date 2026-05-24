import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress, AddressId, CustomerId } from '@pcm/domain';
import { verifyOwnedThenUnsetOthers } from './_address-default';

/**
 * AddressPatch:更新地址的白名單欄(信任邊界 — 不含 id / customerUserId / 時間欄,codex 關卡1 finding 4)。
 */
export type AddressPatch = Partial<Pick<CustomerAddress, 'isDefault' | 'name' | 'phone' | 'line' | 'invoice'>>;

/**
 * updateAddress:更新收件地址 use-case(M-1-14e-2a)。
 *
 * 信任邊界:`currentUserId` server session;`patch` 白名單(不含 owner / id / 時間欄);
 *   跨會員由 RLS(auth.uid() = customer_user_id)守、只能改自己 row。
 *
 * 行為對齊 design AccountPages.jsx saveAddress update 路徑(L352):
 * - `patch.isDefault=true` → 先驗 addressId 屬本 customer + unset 其他預設(except 本筆)→ 再 update
 *   (best-effort 兩步、Sean Q2=A)。先驗 ownership 才 unset(codex 關卡2 must-fix):避免越權/不存在
 *   id 觸發 unset 舊預設後 update 失敗、留「零預設」。
 * - 非預設 patch:直接 update,跨會員越權由 RLS 擋(無前置 unset、無零預設風險,故不重複查清單省 round-trip)。
 */
export async function updateAddress(
  addressRepo: IAddressRepository,
  currentUserId: CustomerId,
  addressId: AddressId,
  patch: AddressPatch,
): Promise<CustomerAddress> {
  if (patch.isDefault) {
    await verifyOwnedThenUnsetOthers(addressRepo, currentUserId, addressId);
  }
  return addressRepo.update(addressId, patch);
}
