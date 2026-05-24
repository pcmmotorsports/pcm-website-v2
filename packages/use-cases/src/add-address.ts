import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress, CustomerId } from '@pcm/domain';
import { unsetCurrentDefaultExcept } from './_address-default';

/**
 * AddressCreateInput:新增地址的輸入(信任邊界 — 收窄型別,不讓 id / customerUserId / 時間欄進公開簽名;
 * customerUserId 由 use-case 用 currentUserId 填,codex 關卡1 finding 4)。
 */
export type AddressCreateInput = Omit<CustomerAddress, 'id' | 'customerUserId' | 'createdAt' | 'updatedAt'>;

/**
 * addAddress:新增收件地址 use-case(M-1-14e-2a、PRD §8.1)。
 *
 * 信任邊界(守 boundary A、比照 update-profile):
 * - `currentUserId` 只由 server session 取(caller 傳)、絕不從表單 body;use-case 用它填 `customerUserId`、不信 input。
 * - 表單驗證 / @pcm/schemas re-parse / strip 未知欄在 delivery 層(f1 server action)。
 *
 * 行為對齊 design AccountPages.jsx saveAddress add 路徑(L353-358):
 * - `isDefault=true` → 先 unset 其他預設 → 再 create(best-effort 兩步、Sean Q2=A)。
 * - 非預設 → 直接 create,**不強制首筆預設**(同 design L356,只在旗標為真才 unset 其他)。
 */
export async function addAddress(
  addressRepo: IAddressRepository,
  currentUserId: CustomerId,
  input: AddressCreateInput,
): Promise<CustomerAddress> {
  if (input.isDefault) {
    await unsetCurrentDefaultExcept(addressRepo, currentUserId);
  }
  return addressRepo.create({ ...input, customerUserId: currentUserId });
}
