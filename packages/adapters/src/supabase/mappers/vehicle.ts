import type { CustomerVehicle } from '@pcm/domain';
import type { Database } from '../database.types';

/**
 * Supabase customer_vehicles row schema —— **derive 自生成 Database 型別**(backlog #106)。
 *
 * 由 database.types.ts 生成的 customer_vehicles 表 Row 取用;schema 改 → 重新 gen → 此型別自動跟著變。
 * Nullable 由生成型別保證對齊 DB(year / engine / km / mods nullable、`?? ''` 還原;service date nullable 直送;
 * name NOT NULL)。
 */
export type SupabaseVehicleRow = Database['public']['Tables']['customer_vehicles']['Row'];

/** INSERT row(id / created_at / updated_at 走 DB default、不送)。 */
export type SupabaseVehicleInsertRow = Omit<
  SupabaseVehicleRow,
  'id' | 'created_at' | 'updated_at'
>;

/** UPDATE row partial(id / created_at / updated_at / customer_user_id 不可改 → 排除)。 */
export type SupabaseVehicleUpdateRow = Partial<
  Omit<SupabaseVehicleRow, 'id' | 'created_at' | 'updated_at' | 'customer_user_id'>
>;

/**
 * wire customer_vehicles row → domain CustomerVehicle(snake_case → camelCase)。
 *
 * customer_user_id → customerUserId / is_primary → isPrimary;year / engine / km / mods nullable → `?? ''`;
 * service 直送 string | null。
 */
export function mapSupabaseVehicleToDomain(row: SupabaseVehicleRow): CustomerVehicle {
  return {
    id: row.id,
    customerUserId: row.customer_user_id,
    isPrimary: row.is_primary,
    name: row.name,
    year: row.year ?? '',
    engine: row.engine ?? '',
    km: row.km ?? '',
    mods: row.mods ?? '',
    service: row.service,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * domain create input → wire INSERT row。
 */
export function mapVehicleToInsertRow(
  vehicle: Omit<CustomerVehicle, 'id' | 'createdAt' | 'updatedAt'>,
): SupabaseVehicleInsertRow {
  return {
    customer_user_id: vehicle.customerUserId,
    is_primary: vehicle.isPrimary,
    name: vehicle.name,
    year: vehicle.year,
    engine: vehicle.engine,
    km: vehicle.km,
    mods: vehicle.mods,
    service: vehicle.service,
  };
}

/**
 * domain patch → wire UPDATE row(只含 present key)。
 *
 * customerUserId / id / createdAt / updatedAt 不可改、即使 patch 帶到也忽略。
 */
export function mapVehiclePatchToRow(patch: Partial<CustomerVehicle>): SupabaseVehicleUpdateRow {
  const row: SupabaseVehicleUpdateRow = {};
  if (patch.isPrimary !== undefined) row.is_primary = patch.isPrimary;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.year !== undefined) row.year = patch.year;
  if (patch.engine !== undefined) row.engine = patch.engine;
  if (patch.km !== undefined) row.km = patch.km;
  if (patch.mods !== undefined) row.mods = patch.mods;
  if (patch.service !== undefined) row.service = patch.service;
  return row;
}
