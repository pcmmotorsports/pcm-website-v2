import type { Customer, CustomerId } from '@pcm/domain';

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

  // TODO M-4a-10: 補 listByTier(tier: MemberTier) — admin 會員列表用
  //   實作時 import type { MemberTier } from '@pcm/domain'(目前未 import、避免 unused)
}
