import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress, AddressId, CustomerId } from '@pcm/domain';

/**
 * unsetCurrentDefaultExcept:把該 customer「目前的預設地址」清成非預設(至多一筆、DB partial unique
 * index customer_addresses_one_default_per_customer 守)。供 addAddress(isDefault=true)/ updateAddress
 * (patch.isDefault=true)共用,確保「先 unset 舊 → 再 set 新」順序(反序會撞 unique index)。
 *
 * 對齊 design AccountPages.jsx saveAddress 的 unset-others-when-default 邏輯(L352 update 路徑 / L356 add 路徑)。
 * best-effort 兩步(Sean Q2=A):兩次 repo 呼叫非單一 DB transaction、單一使用者管自己資料風險可忽略。
 */
export async function unsetCurrentDefaultExcept(
  addressRepo: IAddressRepository,
  currentUserId: CustomerId,
  exceptId?: AddressId,
): Promise<void> {
  const list = await addressRepo.listByCustomer(currentUserId);
  const current = list.find((a) => a.isDefault && a.id !== exceptId);
  if (current) await addressRepo.update(current.id, { isDefault: false });
}

/**
 * verifyAddressOwned:`listByCustomer` 確認 `addressId` 屬本 customer(否則拋、不動任何資料),
 * 回傳該 customer 地址清單供呼叫端複用(免重複 round-trip)。
 *
 * 為何需要 app 層驗 ownership(非只靠 RLS):RLS 是 ownership 邊界(Sean Q2=A),本檢查為其上
 * defense-in-depth —— 越權/不存在 id 在動任何資料前就拋、不依賴單一 RLS 防線。供 updateAddress 兩分支共用
 * (isDefault 的 verifyOwnedThenUnsetOthers + #199 plain-update backstop);三條寫入路徑一致。
 */
export async function verifyAddressOwned(
  addressRepo: IAddressRepository,
  currentUserId: CustomerId,
  addressId: AddressId,
): Promise<CustomerAddress[]> {
  const list = await addressRepo.listByCustomer(currentUserId);
  if (!list.some((a) => a.id === addressId)) {
    throw new Error(`address ${addressId} 不屬於目前 customer`);
  }
  return list;
}

/**
 * verifyOwnedThenUnsetOthers:對「設既有地址為預設」的寫入路徑(setDefaultAddress / updateAddress 的
 * isDefault 分支)用。先驗 `addressId` 屬本 customer(verifyAddressOwned),再 unset 其他預設(except 本筆)。
 *
 * 為何先驗 ownership(codex 關卡2 must-fix):若不驗就先 unset 舊預設、最後 update 又因 RLS/不存在失敗,
 * 會留「零預設」且越權 id 也能觸發 unset。先驗 → 越權/不存在 id 在動任何資料前就拋,三條寫入路徑一致。
 * (addAddress 是新增、無既有 id 可驗,故用 unsetCurrentDefaultExcept、不走本 helper。)
 */
export async function verifyOwnedThenUnsetOthers(
  addressRepo: IAddressRepository,
  currentUserId: CustomerId,
  addressId: AddressId,
): Promise<void> {
  const list = await verifyAddressOwned(addressRepo, currentUserId, addressId);
  const current = list.find((a) => a.isDefault && a.id !== addressId);
  if (current) await addressRepo.update(current.id, { isDefault: false });
}
