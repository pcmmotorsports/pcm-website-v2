import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle, VehicleId, CustomerId } from '@pcm/domain';
import { verifyOwnedThenUnsetOtherPrimary } from './_vehicle-primary';

/**
 * setPrimaryVehicle:把指定車輛設為主車 use-case(M-1-14e-2b、鏡像 setDefaultAddress)。
 *
 * 兩步(Sean Q2=A best-effort、非 DB transaction):
 * - 先驗 vehicleId 屬本 customer + unset 該 customer 其他 is_primary、再 set 本筆。順序固定 unset→set
 *   (反序撞 customer_vehicles_one_primary_per_customer)。對齊 design L388/L391-393 邏輯。
 * - set 失敗向上拋讓 UI 重試;最壞「零主車」可接受(= 新用戶未設狀態、Sean 拍板)。**不做補償 re-set**。
 *
 * 信任邊界:`currentUserId` server session;`vehicleId` 須屬本 customer(verifyOwnedThenUnsetOtherPrimary
 * 取自己清單比對、否則拋)+ RLS 守。
 */
export async function setPrimaryVehicle(
  vehicleRepo: IVehicleRepository,
  currentUserId: CustomerId,
  vehicleId: VehicleId,
): Promise<CustomerVehicle> {
  await verifyOwnedThenUnsetOtherPrimary(vehicleRepo, currentUserId, vehicleId);
  return vehicleRepo.update(vehicleId, { isPrimary: true });
}
