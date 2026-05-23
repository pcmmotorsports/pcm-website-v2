import type { CustomerVehicle, VehicleId, CustomerId } from '@pcm/domain';

/**
 * IVehicleRepository: 會員愛車 CRUD port(M-1-14 新)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §5(類似 IAddressRepository 結構)。
 * 客人讀寫自己 row(DB RLS auth.uid() = customer_user_id 守、authenticated 全 CRUD GRANT)。
 *
 * 實作:M-1-14d SupabaseVehicleAdapter。
 */
export interface IVehicleRepository {
  listByCustomer(customerId: CustomerId): Promise<CustomerVehicle[]>;
  create(vehicle: Omit<CustomerVehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<CustomerVehicle>;
  update(id: VehicleId, patch: Partial<CustomerVehicle>): Promise<CustomerVehicle>;
  delete(id: VehicleId): Promise<void>;
}
