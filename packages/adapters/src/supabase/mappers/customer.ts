import type { Customer } from '@pcm/domain';
import type { Database } from '../database.types';

/**
 * Supabase customers row schema —— **derive 自生成 Database 型別**(backlog #106、消雙 cast escape hatch)。
 *
 * 由 `supabase gen types`(database.types.ts)生成的 customers 表 Row 直接取用:schema 改欄位 / 改型 →
 * 重新 gen 後此型別自動跟著變 → mapper 讀 `row.xxx` 即 compile-time 抓 drift(取代手寫易 stale)。
 *
 * 對齊 ADR-0003 §3.4 wire 字串紀律:本 type 是 wire 字面、只在 mapper 邊界出現、不 leak 至 domain / ports / use-case。
 * Nullable / enum 由生成型別保證對齊 DB(phone / birthday nullable、tier member_tier enum =
 * general/store/premiumStore == domain MemberTier)。
 */
export type SupabaseCustomerRow = Database['public']['Tables']['customers']['Row'];

/**
 * 本 patch 只寫 name / phone / birthday(對齊 ICustomerRepository.update Pick 簽名)。
 * migration GRANT L231 實際為 `UPDATE (name, phone, birthday, updated_at)`(另含 updated_at);
 * updated_at 不由本 patch 送、由 customers_set_updated_at trigger 強制覆寫(見 mapCustomerPatchToRow)。
 */
export type SupabaseCustomerUpdateRow = Partial<
  Pick<SupabaseCustomerRow, 'name' | 'phone' | 'birthday'>
>;

/**
 * wire customers row → domain Customer(snake_case → camelCase)。
 *
 * user_id → id / wallet_balance → walletBalance / total_deposit → totalDeposit /
 * created_at → createdAt / updated_at → updatedAt;phone nullable → `?? ''`。
 */
export function mapSupabaseCustomerToDomain(row: SupabaseCustomerRow): Customer {
  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? '',
    birthday: row.birthday,
    tier: row.tier,
    walletBalance: row.wallet_balance,
    totalDeposit: row.total_deposit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * domain patch → wire customers update row(只含 present key)。
 *
 * name / phone / birthday 三欄 camelCase == snake_case、直接對應;
 * **不寫 updated_at** —— GRANT L231 雖含 updated_at,但 customers_set_updated_at BEFORE UPDATE trigger
 * (L262-264)強制覆寫 now()、user 送值無效,故本 patch 不送。
 * tier / wallet_balance / total_deposit 不在 GRANT、不在此 patch(走 service_role / ledger trigger)。
 */
export function mapCustomerPatchToRow(
  patch: Partial<Pick<Customer, 'name' | 'phone' | 'birthday'>>,
): SupabaseCustomerUpdateRow {
  const row: SupabaseCustomerUpdateRow = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.birthday !== undefined) row.birthday = patch.birthday;
  return row;
}
