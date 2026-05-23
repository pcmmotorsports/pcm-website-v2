import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAddressRepository } from '@pcm/ports';
import type { AddressId, CustomerAddress, CustomerId } from '@pcm/domain';
import {
  mapAddressPatchToRow,
  mapAddressToInsertRow,
  mapSupabaseAddressToDomain,
  type SupabaseAddressRow,
} from './mappers/address';

/** customer_addresses 表投射(對齊 migration 13 欄、invoice 攤平 5 欄)。 */
const ADDRESS_SELECT =
  'id, customer_user_id, is_default, name, phone, line, invoice_type, invoice_carrier, invoice_title, invoice_tax_id, invoice_donate_code, created_at, updated_at';

/**
 * SupabaseAddressAdapter:Supabase 真實 IAddressRepository 實作(M-1-14d)。
 *
 * 對齊:
 * - `packages/ports/src/IAddressRepository.ts`(listByCustomer / create / update / delete 合約)
 * - `docs/specs/m-1-14-customer-schema.md` §5 + §7
 *
 * **單一 authenticated client**:全 CRUD 走 authenticated client(RLS addresses_*_own:
 * auth.uid() = customer_user_id 守自己 row、GRANT L236 authenticated 全 CRUD)。
 *
 * **Thin adapter 邊界(codex 關卡1 consider #5)**:create / update 寫第二筆 is_default=true 會撞
 * customer_addresses_one_default_per_customer partial unique index → DB 丟 violation、本 adapter 直接
 * throw 不吞。「先 unset 舊 default 再設新」的 transaction 邏輯歸 M-1-14e use-case、不在本 adapter。
 *
 * 型別 cast `as unknown as SupabaseAddressRow`:對齊 SupabaseProductAdapter、待 backlog #106 typed schema 消除。
 */
export class SupabaseAddressAdapter implements IAddressRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /** 列出某會員所有地址(created_at asc 穩定排序)。error → throw。 */
  async listByCustomer(customerId: CustomerId): Promise<CustomerAddress[]> {
    const { data, error } = await this.supabase
      .from('customer_addresses')
      .select(ADDRESS_SELECT)
      .eq('customer_user_id', customerId)
      .order('created_at', { ascending: true });
    if (error) {
      throw error;
    }
    return (data as unknown as SupabaseAddressRow[]).map(mapSupabaseAddressToDomain);
  }

  /** 新增地址(invoice 攤平)。回 DB 還原的完整 entity。error → throw。 */
  async create(
    addr: Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CustomerAddress> {
    const { data, error } = await this.supabase
      .from('customer_addresses')
      .insert(mapAddressToInsertRow(addr))
      .select(ADDRESS_SELECT)
      .single();
    if (error) {
      throw error;
    }
    return mapSupabaseAddressToDomain(data as unknown as SupabaseAddressRow);
  }

  /** 更新地址(只改 present 欄;invoice present 攤平全 5 欄)。查無 row 或其他 error → throw。 */
  async update(id: AddressId, patch: Partial<CustomerAddress>): Promise<CustomerAddress> {
    const { data, error } = await this.supabase
      .from('customer_addresses')
      .update(mapAddressPatchToRow(patch))
      .eq('id', id)
      .select(ADDRESS_SELECT)
      .single();
    if (error) {
      throw error;
    }
    return mapSupabaseAddressToDomain(data as unknown as SupabaseAddressRow);
  }

  /** 刪除地址。error → throw。 */
  async delete(id: AddressId): Promise<void> {
    const { error } = await this.supabase.from('customer_addresses').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }
}
