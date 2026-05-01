import type { Customer, CustomerId } from '@pcm/domain';

/**
 * ICustomerRepository: 會員 CRUD port。
 *
 * 對齊 ADR-0003 §3.3。
 * `save` 模式:repo 純 persist、業務動作(register / tier 升級 / profile 改)走 use-case + entity method、
 * 不在 repo 介面出現業務語意方法(對比反例:`upgradeTier` / `register`)。
 *
 * 實作:M-1-14 MedusaCustomerAdapter(login / register)、M-2 起補 tier 相關 use-case。
 */
export interface ICustomerRepository {
  findById(id: CustomerId): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  save(customer: Customer): Promise<Customer>;

  // TODO M-4a-10: 補 listByTier(tier: MemberTier) — admin 會員列表用
}
