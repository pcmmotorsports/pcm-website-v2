import type { IVehicleRepository } from '@pcm/ports';
import type { VehicleId, CustomerId } from '@pcm/domain';
import { NotOwnedError } from '@pcm/domain';

/**
 * deleteVehicle:刪除會員愛車 use-case(M-1-14e-2b、鏡像 deleteAddress)。
 *
 * 行為對齊 design AccountPages.jsx deleteVehicle(L401-406):刪掉後若剩餘非空、且已無任何主車
 * → 第一筆(listByCustomer 依 created_at 升冪、即最舊)自動遞補 is_primary=true。
 *
 * 信任邊界(codex 關卡2):先 `listByCustomer(currentUserId)` 確認 vehicleId 屬本 customer 才刪
 * (否則拋、不刪不遞補)→ 避免越權 id 在 RLS-filtered delete「假成功」後仍跑遞補;三寫入路徑 ownership 一致。
 * 跨會員另由 RLS 守。best-effort(Sean Q2=A):delete 與遞補 update 非單一 transaction;remaining 由刪前清單推算。
 */
export async function deleteVehicle(
  vehicleRepo: IVehicleRepository,
  currentUserId: CustomerId,
  vehicleId: VehicleId,
): Promise<void> {
  const list = await vehicleRepo.listByCustomer(currentUserId);
  if (!list.some((v) => v.id === vehicleId)) {
    throw new NotOwnedError('vehicle', `deleteVehicle: vehicle ${vehicleId} 不屬於目前 customer`);
  }
  await vehicleRepo.delete(vehicleId);
  const remaining = list.filter((v) => v.id !== vehicleId);
  const first = remaining[0];
  if (first && !remaining.some((v) => v.isPrimary)) {
    await vehicleRepo.update(first.id, { isPrimary: true });
  }
}
