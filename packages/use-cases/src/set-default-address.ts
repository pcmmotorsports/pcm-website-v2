import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress, AddressId, CustomerId } from '@pcm/domain';
import { verifyOwnedThenUnsetOthers } from './_address-default';

/**
 * setDefaultAddress:把指定地址設為預設 use-case(M-1-14e-2a)。
 *
 * 兩步(Sean Q2=A best-effort、非 DB transaction):
 * - 先驗 addressId 屬本 customer + unset 該 customer 其他 is_default、再 set 本筆。順序固定 unset→set
 *   (反序撞 customer_addresses_one_default_per_customer)。對齊 design L352/L356 邏輯。
 * - set 失敗向上拋讓 UI 重試;最壞「零預設」可接受(= 新用戶未設狀態、Sean 拍板)。**不做補償 re-set**。
 *
 * 信任邊界:`currentUserId` server session;`addressId` 須屬本 customer(verifyOwnedThenUnsetOthers
 * 取自己清單比對、否則拋)+ RLS 守。
 */
export async function setDefaultAddress(
  addressRepo: IAddressRepository,
  currentUserId: CustomerId,
  addressId: AddressId,
): Promise<CustomerAddress> {
  await verifyOwnedThenUnsetOthers(addressRepo, currentUserId, addressId);
  return addressRepo.update(addressId, { isDefault: true });
}
