import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle, VehicleId, CustomerId } from '@pcm/domain';
import { NotOwnedError } from '@pcm/domain';

/**
 * unsetCurrentPrimaryExcept:把該 customer「目前的主要車輛」清成非主車(至多一筆、DB partial unique
 * index customer_vehicles_one_primary_per_customer 守)。供 addVehicle(isPrimary=true)共用,確保
 * 「先 unset 舊 → 再 set 新」順序(反序會撞 unique index)。
 *
 * 鏡像 _address-default.ts(isDefault→isPrimary);對齊 design AccountPages.jsx saveVehicle
 * 的 unset-others-when-primary 邏輯(L388 update 路徑 / L391-393 add 路徑)。
 * best-effort 兩步(Sean Q2=A):兩次 repo 呼叫非單一 DB transaction、單人風險可忽略。
 */
export async function unsetCurrentPrimaryExcept(
  vehicleRepo: IVehicleRepository,
  currentUserId: CustomerId,
  exceptId?: VehicleId,
): Promise<void> {
  const list = await vehicleRepo.listByCustomer(currentUserId);
  const current = list.find((v) => v.isPrimary && v.id !== exceptId);
  if (current) await vehicleRepo.update(current.id, { isPrimary: false });
}

/**
 * verifyVehicleOwned:`listByCustomer` 確認 `vehicleId` 屬本 customer(否則拋、不動任何資料),
 * 回傳該 customer 愛車清單供呼叫端複用(免重複 round-trip)。鏡像 _address-default.ts verifyAddressOwned。
 *
 * RLS 是 ownership 邊界(Sean Q2=A),本 app 層檢查為其上 defense-in-depth。供 updateVehicle 兩分支共用
 * (isPrimary 的 verifyOwnedThenUnsetOtherPrimary + #199 plain-update backstop);三寫入路徑一致。
 */
export async function verifyVehicleOwned(
  vehicleRepo: IVehicleRepository,
  currentUserId: CustomerId,
  vehicleId: VehicleId,
): Promise<CustomerVehicle[]> {
  const list = await vehicleRepo.listByCustomer(currentUserId);
  if (!list.some((v) => v.id === vehicleId)) {
    throw new NotOwnedError('vehicle', `vehicle ${vehicleId} 不屬於目前 customer`);
  }
  return list;
}

/**
 * verifyOwnedThenUnsetOtherPrimary:對「設既有車輛為主車」的寫入路徑(setPrimaryVehicle / updateVehicle
 * 的 isPrimary 分支)用。先驗 `vehicleId` 屬本 customer(verifyVehicleOwned),再 unset 其他主車(except 本筆)。
 *
 * 鏡像 _address-default.ts 的 verifyOwnedThenUnsetOthers(codex 關卡2 must-fix:先驗 ownership 才 unset,
 * 避免越權/不存在 id 觸發 unset 舊主車後 update 失敗留「零主車」;三寫入路徑一致)。
 */
export async function verifyOwnedThenUnsetOtherPrimary(
  vehicleRepo: IVehicleRepository,
  currentUserId: CustomerId,
  vehicleId: VehicleId,
): Promise<void> {
  const list = await verifyVehicleOwned(vehicleRepo, currentUserId, vehicleId);
  const current = list.find((v) => v.isPrimary && v.id !== vehicleId);
  if (current) await vehicleRepo.update(current.id, { isPrimary: false });
}
