import type { IAddressRepository } from '@pcm/ports';
import type { AddressId, CustomerId } from '@pcm/domain';
import { NotOwnedError } from '@pcm/domain';

/**
 * deleteAddress:刪除收件地址 use-case(M-1-14e-2a)。
 *
 * 行為對齊 design AccountPages.jsx deleteAddress(L361-368):刪掉後若剩餘非空、且已無任何預設
 * → 第一筆(listByCustomer 依 created_at 升冪、即最舊)自動遞補 is_default=true。
 *
 * 信任邊界(codex 關卡2):先 `listByCustomer(currentUserId)` 確認 addressId 屬本 customer 才刪
 * (否則拋、不刪不遞補)→ 避免越權 id 在 RLS-filtered delete「假成功」後仍跑遞補、誤改自己預設狀態;
 * 三條寫入路徑(setDefault / update-isDefault / delete)ownership 驗證一致。跨會員另由 RLS 守。
 * best-effort(Sean Q2=A):delete 與遞補 update 非單一 transaction;remaining 由刪前清單推算(省一次查詢)。
 */
export async function deleteAddress(
  addressRepo: IAddressRepository,
  currentUserId: CustomerId,
  addressId: AddressId,
): Promise<void> {
  const list = await addressRepo.listByCustomer(currentUserId);
  if (!list.some((a) => a.id === addressId)) {
    throw new NotOwnedError('address', `deleteAddress: address ${addressId} 不屬於目前 customer`);
  }
  await addressRepo.delete(addressId);
  const remaining = list.filter((a) => a.id !== addressId);
  const first = remaining[0];
  if (first && !remaining.some((a) => a.isDefault)) {
    await addressRepo.update(first.id, { isDefault: true });
  }
}
