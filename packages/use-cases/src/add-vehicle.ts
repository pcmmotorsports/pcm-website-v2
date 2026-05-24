import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle, CustomerId } from '@pcm/domain';
import { unsetCurrentPrimaryExcept } from './_vehicle-primary';

/**
 * VehicleCreateInput:新增車輛的輸入(信任邊界 — 收窄型別,不讓 id / customerUserId / 時間欄進公開簽名;
 * customerUserId 由 use-case 用 currentUserId 填)。鏡像 AddressCreateInput。
 *
 * 註:`service`(string | null)空值 '' → null 的正規化屬 delivery/schema 層(backlog #177),use-case 直接 pass-through。
 */
export type VehicleCreateInput = Omit<CustomerVehicle, 'id' | 'customerUserId' | 'createdAt' | 'updatedAt'>;

/**
 * addVehicle:新增會員愛車 use-case(M-1-14e-2b、鏡像 addAddress)。
 *
 * 信任邊界:`currentUserId` 只由 server session 取(caller 傳)、use-case 用它填 `customerUserId`、不信 input;
 *   表單驗證 / @pcm/schemas re-parse 在 delivery 層(f1)。
 * 行為對齊 design AccountPages.jsx saveVehicle add 路徑(L391-394):
 * - `isPrimary=true` → 先 unset 其他主車 → 再 create(best-effort 兩步、Sean Q2=A)。
 * - 非主車 → 直接 create,**不強制首台主車**(L393,只在旗標真才 unset;UI 初始第一台預設 primary 屬 delivery 層)。
 */
export async function addVehicle(
  vehicleRepo: IVehicleRepository,
  currentUserId: CustomerId,
  input: VehicleCreateInput,
): Promise<CustomerVehicle> {
  if (input.isPrimary) {
    await unsetCurrentPrimaryExcept(vehicleRepo, currentUserId);
  }
  return vehicleRepo.create({ ...input, customerUserId: currentUserId });
}
