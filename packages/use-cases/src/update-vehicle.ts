import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle, VehicleId, CustomerId } from '@pcm/domain';
import { verifyOwnedThenUnsetOtherPrimary } from './_vehicle-primary';

/**
 * VehiclePatch:更新車輛的白名單欄(信任邊界 — 不含 id / customerUserId / 時間欄)。鏡像 AddressPatch。
 * 註:`service` 空值 '' → null 正規化在 schema 層 VehicleInput.transform 完成(#177、對齊 DB date 欄不接受空字串),use-case pass-through。
 */
export type VehiclePatch = Partial<
  Pick<CustomerVehicle, 'isPrimary' | 'name' | 'year' | 'engine' | 'km' | 'mods' | 'service'>
>;

/**
 * updateVehicle:更新會員愛車 use-case(M-1-14e-2b、鏡像 updateAddress)。
 *
 * 信任邊界:`currentUserId` server session;`patch` 白名單(不含 owner / id / 時間欄);跨會員由 RLS 守。
 * 行為對齊 design saveVehicle update 路徑(L388):
 * - `patch.isPrimary=true` → 先驗 vehicleId 屬本 customer + unset 其他主車(except 本筆)→ 再 update
 *   (codex 關卡2 must-fix:先驗 ownership 才 unset,避免越權 id 留「零主車」)。
 * - 非主車 patch:直接 update,跨會員越權由 RLS 擋(無前置 unset、無零主車風險,不重複查清單)。
 */
export async function updateVehicle(
  vehicleRepo: IVehicleRepository,
  currentUserId: CustomerId,
  vehicleId: VehicleId,
  patch: VehiclePatch,
): Promise<CustomerVehicle> {
  if (patch.isPrimary) {
    await verifyOwnedThenUnsetOtherPrimary(vehicleRepo, currentUserId, vehicleId);
  }
  return vehicleRepo.update(vehicleId, patch);
}
