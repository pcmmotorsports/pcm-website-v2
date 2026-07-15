import type { SupabaseClient } from '@supabase/supabase-js';
import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerId, CustomerVehicle, VehicleId } from '@pcm/domain';
import type { Database } from './database.types';
import {
  mapSupabaseVehicleToDomain,
  mapVehiclePatchToRow,
  mapVehicleToInsertRow,
} from './mappers/vehicle';

/** customer_vehicles 表投射(對齊 migration 11 欄+V-1d 字典鍵兩欄)。 */
const VEHICLE_SELECT =
  'id, customer_user_id, is_primary, name, year, engine, km, mods, service, dict_brand_name, dict_model_name, created_at, updated_at';

/**
 * SupabaseVehicleAdapter:Supabase 真實 IVehicleRepository 實作(M-1-14d)。
 *
 * 對齊:
 * - `packages/ports/src/IVehicleRepository.ts`(listByCustomer / create / update / delete 合約)
 * - `docs/specs/m-1-14-customer-schema.md` §5 + §7
 *
 * **單一 authenticated client**:全 CRUD 走 authenticated client(RLS vehicles_*_own:
 * auth.uid() = customer_user_id 守自己 row、GRANT L240 authenticated 全 CRUD)。
 *
 * **Thin adapter 邊界(codex 關卡1 consider #5)**:create / update 寫第二筆 is_primary=true 會撞
 * customer_vehicles_one_primary_per_customer partial unique index → DB 丟 violation、本 adapter 直接
 * throw 不吞。「先 unset 舊 primary 再設新」的 transaction 邏輯歸 M-1-14e use-case、不在本 adapter。
 *
 * #106:client 注入 `SupabaseClient<Database>` generic、select 回 typed row、消除舊
 * `data as unknown as SupabaseVehicleRow` 雙 cast(SupabaseVehicleRow 已 derive 自生成型別)。
 */
export class SupabaseVehicleAdapter implements IVehicleRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /** 列出某會員所有愛車(created_at asc 穩定排序)。error → throw。 */
  async listByCustomer(customerId: CustomerId): Promise<CustomerVehicle[]> {
    const { data, error } = await this.supabase
      .from('customer_vehicles')
      .select(VEHICLE_SELECT)
      .eq('customer_user_id', customerId)
      .order('created_at', { ascending: true });
    if (error) {
      throw error;
    }
    return data.map(mapSupabaseVehicleToDomain);
  }

  /** 新增愛車。回 DB 還原的完整 entity。error → throw。 */
  async create(
    vehicle: Omit<CustomerVehicle, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CustomerVehicle> {
    const { data, error } = await this.supabase
      .from('customer_vehicles')
      .insert(mapVehicleToInsertRow(vehicle))
      .select(VEHICLE_SELECT)
      .single();
    if (error) {
      throw error;
    }
    return mapSupabaseVehicleToDomain(data);
  }

  /** 更新愛車(只改 present 欄)。查無 row 或其他 error → throw。 */
  async update(id: VehicleId, patch: Partial<CustomerVehicle>): Promise<CustomerVehicle> {
    const { data, error } = await this.supabase
      .from('customer_vehicles')
      .update(mapVehiclePatchToRow(patch))
      .eq('id', id)
      .select(VEHICLE_SELECT)
      .single();
    if (error) {
      throw error;
    }
    return mapSupabaseVehicleToDomain(data);
  }

  /** 刪除愛車。error → throw。 */
  async delete(id: VehicleId): Promise<void> {
    const { error } = await this.supabase.from('customer_vehicles').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }
}
