import type { MemberTier } from '../shared/types';

export type CustomerId = string; // = auth.users.id uuid(M-1-14 customers PK)

/**
 * Customer: 會員 entity(M-1-14 擴自 M-0-04 type stub)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §4.1 + Supabase migration
 * `20260523034911_init_customers_and_subtables` customers 表(M-1-14a);
 * 逐欄對齊 design AccountPages.jsx L312-414 user 物件(email / name / phone / birthday)。
 *
 * 命名:DB snake_case ↔ domain camelCase(wallet_balance ↔ walletBalance 等)、由 adapter mapper 轉。
 * tier 由後台手動標記(Q1=A、design TierComponents L27)、客人不可自改(DB column GRANT + RLS 守);
 * tier 寫入不經 ICustomerRepository(走 service_role、見 IAdminCustomerRepository M-4a)。
 *
 * walletBalance / totalDeposit 用 number(非 shared/MoneyAmount brand):
 * brand type 強制非負、但這兩欄語意上由 ledger signed amount 累加而來(use entry 為負);
 * 整數性由 DB integer column + CHECK constraint 守(M-1-14a)、不在 domain 重複守門。
 *
 * 子 entity 分檔:[[address]] / [[vehicle]] / [[wallet]](identity/address.ts 等)。
 */
export type Customer = {
  id: CustomerId;
  email: string;
  name: string;
  phone: string;
  birthday: string | null; // ISO date 'YYYY-MM-DD' or null
  tier: MemberTier;
  walletBalance: number; // Q1=B:DB trigger 同步、authenticated 不可直寫
  totalDeposit: number; // Q1=B:累積儲值(後台參考門檻、非 auto-upgrade 觸發)
  createdAt: string; // ISO datetime
  updatedAt: string;
};
