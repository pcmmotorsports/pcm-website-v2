import type { CustomerAddress, AddressId, CustomerId } from '@pcm/domain';

/**
 * IAddressRepository: 收件地址 + 發票 CRUD port(M-1-14 新)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §5。
 * 客人讀寫自己 row(DB RLS auth.uid() = customer_user_id 守、authenticated 全 CRUD GRANT)。
 *
 * 實作:M-1-14d SupabaseAddressAdapter。
 */
export interface IAddressRepository {
  listByCustomer(customerId: CustomerId): Promise<CustomerAddress[]>;
  create(addr: Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomerAddress>;
  update(id: AddressId, patch: Partial<CustomerAddress>): Promise<CustomerAddress>;
  delete(id: AddressId): Promise<void>;
}
