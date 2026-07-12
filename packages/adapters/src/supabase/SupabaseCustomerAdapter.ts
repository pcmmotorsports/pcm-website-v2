import type { SupabaseClient } from '@supabase/supabase-js';
import type { ICustomerRepository } from '@pcm/ports';
import type {
  Customer,
  CustomerId,
  AdminCustomerFilter,
  AdminCustomerSummary,
  Paginated,
  PaginationParams,
} from '@pcm/domain';
import type { Database } from './database.types';
import {
  mapCustomerPatchToRow,
  mapSupabaseCustomerToDomain,
  mapSupabaseAdminCustomerRowToSummary,
} from './mappers/customer';

/** PostgREST not-found error code(`.single()` 找不到 row)。 */
const PGRST_NOT_FOUND = 'PGRST116';

/** customers 表投射(對齊 PRD §7 CUSTOMER_SELECT + migration customers 10 欄)。 */
const CUSTOMER_SELECT =
  'user_id, email, name, phone, birthday, tier, wallet_balance, total_deposit, created_at, updated_at';

/**
 * admin 客戶摘要投影白名單(M-4a 客戶管理第一片、後台 /customers 列表;service_role 全表)。
 *
 * 🔴 具名白名單:**排除** wallet_balance / total_deposit(#202 儲值金台灣法規 HOLD、不進雛型)、birthday(列表不需);
 * customers 表本身無成本 / 經銷價欄(天生守);**禁** `select('*')`。tier=會員等級標籤(admin 需知經銷身分、非價格)。
 * module-level `export const` → SupabaseCustomerAdapter.test.ts byte-equal + 無 wallet/成本欄名 + 無 `*` 守門。
 */
export const ADMIN_CUSTOMER_LIST_SELECT = 'user_id, name, email, phone, tier, created_at';

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
 * #106:client 注入 `SupabaseClient<Database>` generic、`.from('customers').select().single()` 回 typed row、
 * 消除舊 `data as unknown as SupabaseCustomerRow` 雙 cast(SupabaseCustomerRow 已 derive 自生成型別)。
 */
export class SupabaseCustomerAdapter implements ICustomerRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

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
    return mapSupabaseCustomerToDomain(data);
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
    return mapSupabaseCustomerToDomain(data);
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
    return mapSupabaseCustomerToDomain(data);
  }

  /**
   * admin 客戶列表摘要(M-4a 客戶管理第一片;後台營運找客 / 看等級;service_role 全表、非 RLS own-only)。
   *
   * - 投影 `ADMIN_CUSTOMER_LIST_SELECT` 具名白名單(禁 `select('*')`、排除 wallet/儲值/成本欄);
   * - tier 篩選走 DB where 下推(缺 = 不限);server 端分頁 `.range(offset, offset+limit-1)`(offset 預設 0)+
   *   排序 `created_at` DESC(新到舊)+ `count: 'exact'` 取符合條件總筆數;
   * - error → 裸 throw(對齊既有 adapter 慣例;caller〔admin 頁〕try/catch 退錯誤態、頁面不 500)。
   *
   * 🔴 鐵則 12:customers 表無成本 / 經銷價欄(天生守)+ 白名單縱深;admin 走 service_role(BYPASSRLS 看全客人=預期)。
   */
  async listCustomerSummariesForAdmin(
    filter: AdminCustomerFilter,
    pagination: PaginationParams,
  ): Promise<Paginated<AdminCustomerSummary>> {
    const offset = pagination.offset ?? 0;

    let query = this.supabase
      .from('customers')
      .select(ADMIN_CUSTOMER_LIST_SELECT, { count: 'exact' });
    if (filter.tier) query = query.eq('tier', filter.tier);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pagination.limit - 1);
    if (error) {
      throw error;
    }
    return {
      items: data.map(mapSupabaseAdminCustomerRowToSummary),
      total: count ?? 0,
    };
  }
}
