import type { Customer, MemberTier } from '@pcm/domain';

/**
 * Supabase customers row schema(對齊 supabase/migrations/20260523034911_init_customers_and_subtables.sql
 * customers 表 + 20260523052537 patch)。
 *
 * 對齊 ADR-0003 §3.4 wire 字串紀律:本 type 是 wire 字面、只在 mapper 邊界出現、
 * 不 leak 至 domain / ports / use-case。
 *
 * Nullable 紀律(對齊 DB 實際欄位、codex 關卡1 must-fix #2):
 * - `phone` migration L18 僅 `DEFAULT ''`、無 `NOT NULL` → `string | null`、read 端 `?? ''` 還原 domain string。
 * - `birthday` migration L19 `date`(無 NOT NULL)→ `string | null`(domain birthday 本就 string | null、直送)。
 * - `name` migration L17 `NOT NULL DEFAULT ''` → 永不 null、`string`。
 * - `tier` member_tier enum、值 general / store / premiumStore 與 MemberTier 字面一致(migration COMMENT L32-33)、直送。
 */
export type SupabaseCustomerRow = {
  user_id: string;
  email: string;
  name: string;
  phone: string | null;
  birthday: string | null;
  tier: MemberTier;
  wallet_balance: number;
  total_deposit: number;
  created_at: string;
  updated_at: string;
};

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
