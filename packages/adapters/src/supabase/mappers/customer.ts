import type { Customer, AdminCustomerSummary } from '@pcm/domain';
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

// ── 讀路徑(admin 摘要):customers row → domain AdminCustomerSummary(M-4a 客戶管理第一片)──

/**
 * admin 客戶摘要讀 row 型別 —— derive 自生成 Database Row(對齊 SupabaseCustomerRow 慣例)。
 *
 * 只取 `ADMIN_CUSTOMER_LIST_SELECT`(SupabaseCustomerAdapter)投影的欄。
 * 🔴 **不含** wallet_balance / total_deposit(#202 儲值金 HOLD)、birthday(列表不需);customers 表本身無成本欄。
 * `tier` 生成 member_tier enum 字面 = domain MemberTier(直送);`phone` nullable 直送(UI 顯 '—')。
 */
export type SupabaseAdminCustomerRow = Pick<
  SupabaseCustomerRow,
  'user_id' | 'name' | 'email' | 'phone' | 'tier' | 'created_at'
>;

/** wire customers 摘要 row → domain AdminCustomerSummary(user_id → id;其餘直送)。 */
export function mapSupabaseAdminCustomerRowToSummary(
  row: SupabaseAdminCustomerRow,
): AdminCustomerSummary {
  return {
    id: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tier: row.tier,
    createdAt: row.created_at,
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
