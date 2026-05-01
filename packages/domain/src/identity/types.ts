import type { MemberTier } from '../shared/types';

export type CustomerId = string;

/**
 * Customer: 會員 entity(M-0-04 type stub、最小欄位集)。
 *
 * 對齊 ADR-0003 §3.1 命名規則 + ADR §4 #8 三級會員;
 * `vehicles` 欄位待 M-2-05 補(Phase 1 用 customer.metadata.vehicles 存儲、Phase 2 升級為獨立 Vehicle entity)。
 *
 * 業務新註冊預設:tier = 'general'(由 M-1-14 register use-case 設定、本 type 不管 default)。
 */
export type Customer = {
  id: CustomerId;
  email: string;
  tier: MemberTier;
};
