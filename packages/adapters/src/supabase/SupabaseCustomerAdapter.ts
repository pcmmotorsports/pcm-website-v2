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
import type { SupabaseAdminCustomerRow } from './mappers/customer';
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
// 🔴 **必須是【單行字面】,不能用 `'…' + '…'` 拆行**(code-reviewer 2026-08-16 實測)。
//    `+` 會把常數從**字面型別**拓寬成 `string` ⇒ postgrest-js 的「select 字串 → row 型別」推導
//    整條斷掉,`data` 被推成 `never[]` ⇒ **下面那個手寫 row 型別沒有任何東西在檢查它**。
//    ⚠️ 我原本的註解寫「apply 之後重生型別、換成 derive 就好」——**那是錯的**:
//       `+` 不拆的話,apply 完 derive 也接不回來。
//    (repo 沒有 max-len 規則 —— 我原本加的那行 eslint-disable 是多餘的,lint 當場報 unused)
export const ADMIN_CUSTOMER_LIST_SELECT = 'user_id, name, email, phone, tier, created_at, active_order_count, active_spend_total, last_active_ordered_at';

/**
 * 🔴 讀的是 **view** 不是 `customers` 表(客戶頁三欄)。
 *
 * `admin_customer_list_v`(`supabase/migrations/20260816030000_…`)= `customers` 的六顆白名單欄
 * + 三顆聚合欄。**view 只 GRANT 給 `service_role`**,而 admin 全部走 service_role。
 *
 * ⚠️ **白名單的理由沒有變**:view 也是**逐顆列出**那六欄、刻意不用 `c.*`,
 *    所以 `wallet_balance` / `total_deposit` **連 view 裡都沒有**(不是「有但我們不選」)。
 */
export const ADMIN_CUSTOMER_LIST_VIEW = 'admin_customer_list_v';

/**
 * 🔴 **本地補上 view 的型別,取代 `as never`**(code-reviewer 2026-08-16 must-fix)。
 *
 * `database.types.ts` 是對**正式庫**生成的,而 `20260816030000` 還沒 apply ⇒ 生成檔裡查無此 view。
 * 初版用 `from(… as never)` 過關,而那個 cast **不只關掉 `from` 的檢查** ——
 * 實測:改動前 `.eq('totally_bogus_column', …)` 報 `TS2345`,改成 `as never` 之後**零錯誤**
 * ⇒ 連 `.eq()` / `.order()` 的欄名檢查一起關掉了,而 probe 只送 `select=`、蓋不到那兩個。
 *
 * ⚠️ **這段是【有期限的】**:apply 之後重生 `database.types.ts`,那支 view 會自己出現,
 *    這個 augment 就該刪掉。留著不刪的話,它會變成「型別說有、DB 說了算」的第二份真相。
 */
type DatabaseWithCustomerListView = Database & {
  public: Database['public'] & {
    Views: Database['public']['Views'] & {
      admin_customer_list_v: { Row: SupabaseAdminCustomerRow; Relationships: [] };
    };
  };
};

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

    // 🔴 `from` 換成 view —— 三欄的值只有那裡算得出來。
    //    型別走上面的 `DatabaseWithCustomerListView`(**不是 `as never`**):
    //    cast 只發生在 client 這一層一次,`.from` / `.eq` / `.order` 的欄名檢查全部保留。
    const db = this.supabase as unknown as SupabaseClient<DatabaseWithCustomerListView>;
    let query = db
      .from(ADMIN_CUSTOMER_LIST_VIEW)
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
