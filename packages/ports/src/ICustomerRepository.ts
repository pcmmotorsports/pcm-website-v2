import type {
  Customer,
  CustomerId,
  AdminCustomerFilter,
  AdminCustomerSummary,
  Paginated,
  PaginationParams,
} from '@pcm/domain';

/**
 * ICustomerRepository: 會員 profile 讀 + 有限欄位更新 port(M-1-14 改寫)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §5 + ADR-0003 §3.3。
 *
 * 邊界(對齊 M-1-14 拍板):
 * - register / login 走 Supabase Auth SDK、不經本 port(Q2=A:auth.users insert trigger
 *   handle_new_auth_user 自動建 customers row)。
 * - tier 寫入走 service_role-only、不在本 port 暴露(走 IAdminCustomerRepository M-4a)。
 * - update 只開 name / phone / birthday(對齊 design profile tab L666-669 + DB column GRANT)。
 *
 * 實作:M-1-14d SupabaseCustomerAdapter。
 */
export interface ICustomerRepository {
  findById(id: CustomerId): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  update(
    id: CustomerId,
    patch: Partial<Pick<Customer, 'name' | 'phone' | 'birthday'>>,
  ): Promise<Customer>;

  /**
   * admin 客戶列表「摘要」(M-4a 客戶管理第一片;後台營運找客 / 看等級)。
   *
   * 回 `Paginated<AdminCustomerSummary>`(摘要投影):**新增** admin 專用摘要方法、不動既有
   * findById / findByEmail / update(會員側零影響);service_role 全表(非 RLS own-only);
   * tier 篩選走 DB where 下推 + server 端分頁(`.range`)+ 排序 created_at DESC(新到舊)+ 總筆數 count。
   *
   * 🔴 投影具名白名單、**排除** wallet_balance / total_deposit(#202 儲值金 HOLD)、零成本欄(customers 表本身無)、禁 `select('*')`。
   */
  listCustomerSummariesForAdmin(
    filter: AdminCustomerFilter,
    pagination: PaginationParams,
  ): Promise<Paginated<AdminCustomerSummary>>;
}
