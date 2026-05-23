import type { SupabaseClient } from '@supabase/supabase-js';
import type { ICustomerRepository } from '@pcm/ports';
import type { Customer, CustomerId } from '@pcm/domain';
import {
  mapCustomerPatchToRow,
  mapSupabaseCustomerToDomain,
  type SupabaseCustomerRow,
} from './mappers/customer';

/** PostgREST not-found error code(`.single()` 找不到 row)。 */
const PGRST_NOT_FOUND = 'PGRST116';

/** customers 表投射(對齊 PRD §7 CUSTOMER_SELECT + migration customers 10 欄)。 */
const CUSTOMER_SELECT =
  'user_id, email, name, phone, birthday, tier, wallet_balance, total_deposit, created_at, updated_at';

/**
 * SupabaseCustomerAdapter:Supabase 真實 ICustomerRepository 實作(M-1-14d)。
 *
 * 對齊:
 * - `packages/ports/src/ICustomerRepository.ts`(findById / findByEmail / update 合約)
 * - `docs/specs/m-1-14-customer-schema.md` §7 adapter 骨架 + §5 邊界
 * - `SupabaseProductAdapter` pattern(constructor DI、PGRST_NOT_FOUND → null)
 *
 * **單一 authenticated client**:findById / findByEmail / update 全走 authenticated client
 * (RLS customers_select_own / customers_update_own:auth.uid() = user_id 守自己 row)。
 *
 * 邊界(對齊 M-1-14 拍板 + migration GRANT):
 * - update patch 只寫 name / phone / birthday(ICustomerRepository.update Pick + mapCustomerPatchToRow 白名單)。
 *   migration GRANT L231 實際為 `UPDATE (name, phone, birthday, updated_at)`(含 updated_at):本 adapter 不送
 *   updated_at,且即使 user 送值,customers_set_updated_at BEFORE UPDATE trigger(L262-264)也會強制覆寫 now()、user 值無效。
 * - tier / wallet_balance / total_deposit 不在 GRANT、不經本 adapter(走 service_role / ledger trigger;
 *   tier admin 寫走 M-4a IAdminCustomerRepository)。
 *
 * 型別 cast `data as unknown as SupabaseCustomerRow`:對齊 SupabaseProductAdapter、
 * 待 backlog #106 typed Database schema 落地後改 generic 消除。
 */
export class SupabaseCustomerAdapter implements ICustomerRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /** 依 id(= auth.users.id)查單筆會員。找不到 → null;其他 error → throw。 */
  async findById(id: CustomerId): Promise<Customer | null> {
    const { data, error } = await this.supabase
      .from('customers')
      .select(CUSTOMER_SELECT)
      .eq('user_id', id)
      .single();
    if (error) {
      if (error.code === PGRST_NOT_FOUND) {
        return null;
      }
      throw error;
    }
    return mapSupabaseCustomerToDomain(data as unknown as SupabaseCustomerRow);
  }

  /** 依 email 查單筆會員(customers_email_idx + UNIQUE)。找不到 → null;其他 error → throw。 */
  async findByEmail(email: string): Promise<Customer | null> {
    const { data, error } = await this.supabase
      .from('customers')
      .select(CUSTOMER_SELECT)
      .eq('email', email)
      .single();
    if (error) {
      if (error.code === PGRST_NOT_FOUND) {
        return null;
      }
      throw error;
    }
    return mapSupabaseCustomerToDomain(data as unknown as SupabaseCustomerRow);
  }

  /**
   * 更新會員 name / phone / birthday(其他欄位不可經本 method 改)。
   *
   * 查無 row(error PGRST116)或其他 error → throw(port 簽名回非 null Customer)。
   */
  async update(
    id: CustomerId,
    patch: Partial<Pick<Customer, 'name' | 'phone' | 'birthday'>>,
  ): Promise<Customer> {
    const { data, error } = await this.supabase
      .from('customers')
      .update(mapCustomerPatchToRow(patch))
      .eq('user_id', id)
      .select(CUSTOMER_SELECT)
      .single();
    if (error) {
      throw error;
    }
    return mapSupabaseCustomerToDomain(data as unknown as SupabaseCustomerRow);
  }
}
