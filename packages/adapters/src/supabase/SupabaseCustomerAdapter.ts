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

/**
 * `admin_search_customers` 的函式名 —— **逐字對 migration 簽章**。
 *
 * 🔴 GRANT 綁的是精確簽章,漂一個字 = 執行期 404/42501。
 * ⚠️ 函式名與參數名這一層由生成型別(`database.types.ts`)接手,**前提是這裡不做窄介面 cast**。
 */
const ADMIN_SEARCH_CUSTOMERS_FN = 'admin_search_customers' as const;

/**
 * 候選集上限 —— **與 migration 的硬夾值同值**(`p_limit` 硬夾 100)。
 * 🔴 兩邊不同步的症狀:RPC 回超過這裡的量 ⇒ 下面的形狀驗證會擲錯(**吵,不靜默截斷**)。
 */
const ADMIN_CUSTOMER_ID_IN_CAP = 100;

const CUSTOMER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RPC 回傳形狀與程式假設不符時擲出(`#525`)。 */
export class CustomerKeywordSearchShapeError extends Error {
  constructor(detail: string) {
    super(`admin_search_customers 回傳形狀不符:${detail}`);
    this.name = 'CustomerKeywordSearchShapeError';
  }
}

/** 只回型別名稱,**不回值** —— 值是搜尋結果、不該進 log。 */
function describeCustomerSearchType(v: unknown): string {
  if (v === null) return 'null';
  return Array.isArray(v) ? 'array' : typeof v;
}

/**
 * 把 RPC 的 `jsonb` 回傳**當外部輸入驗**(`#525`;形狀逐字對齊訂單側的同款函式)。
 *
 * 🔴 **為什麼是擲、不是把壞掉的部分濾掉**:濾掉 = 悄悄回零筆 = 員工看到「查無此人」,
 * 而**測試會全綠**(mock 餵的一定是符合假設的形狀)。
 * RPC 回的是 `jsonb`,PostgREST 原封轉成 JSON ⇒ **型別系統一個字都保證不了**。
 * ⇒ 唯一的防線就是執行期把它當外部輸入驗。**fail-closed 且吵。**
 */
function parseAdminSearchCustomersResult(data: unknown): { ids: string[]; truncated: boolean } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CustomerKeywordSearchShapeError(
      `回傳不是物件(拿到 ${describeCustomerSearchType(data)})`,
    );
  }
  const { ids, truncated } = data as { ids?: unknown; truncated?: unknown };
  if (typeof truncated !== 'boolean') {
    throw new CustomerKeywordSearchShapeError(
      `truncated 不是 boolean(拿到 ${describeCustomerSearchType(truncated)})`,
    );
  }
  if (!Array.isArray(ids)) {
    throw new CustomerKeywordSearchShapeError(
      `ids 不是陣列(拿到 ${describeCustomerSearchType(ids)})`,
    );
  }
  if (ids.length > ADMIN_CUSTOMER_ID_IN_CAP) {
    throw new CustomerKeywordSearchShapeError(
      `ids 有 ${ids.length} 筆、超過上限 ${ADMIN_CUSTOMER_ID_IN_CAP}(RPC 的硬夾值與呼叫端不同步?)`,
    );
  }
  if (!ids.every((id): id is string => typeof id === 'string' && CUSTOMER_UUID_RE.test(id))) {
    throw new CustomerKeywordSearchShapeError('ids 含非 UUID 形狀的元素');
  }
  // 🔴 唯一性:RPC 端用 `UNION`(非 `UNION ALL`)正是為了不吐重複 ⇒ **重複 = 那個保證破了**。
  //    不擋的話「找到 N 筆」的 N 會比真實客戶數大。**fail-closed 且吵,不靜默去重。**
  if (new Set(ids).size !== ids.length) {
    throw new CustomerKeywordSearchShapeError('ids 有重複(RPC 的 UNION 語意保證不該發生)');
  }
  return { ids, truncated };
}

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
    // 🔴🔴 **搜尋詞走 RPC(POST + JSON body),絕不走 `.or()`**(`#525`)。
    //    `.or()` 是**把值內插進 GET query string** ⇒ 值裡的字元會**改變 filter 的結構**;
    //    訂單側之所以不需要字元集守門,正是因為它走 `.rpc()`
    //    (理由全文 `packages/domain/src/order/keyword-search.ts:20-28` ——
    //     那兩支有守門的維度**連同威脅面一起被刪除**,改用 `.or()` 等於把威脅面裝回來而守門不在)。
    //    ⚠️ **不得**為了快取或好 debug 傳 `{ get: true }` / `{ head: true }` ——
    //       那兩個走 postgrest-js 的**同一個分支**,都會把 `p_query` 塞進網址,
    //       而網址會落進 access log / CDN log / 瀏覽器歷史 / Referer。**搜尋詞是 PII。**
    //    🔴 參數名逐字對 migration 簽章;**不做窄介面 cast、不用 spread** ——
    //       那一層由生成型別接手,spread 會讓型別檢查與參數名守門同時失效。
    // 🔴 **`truncated` 目前【刻意不往上帶】** —— `Paginated<T>` 沒有那個欄位,
    //    而訂單側是用專屬的 `AdminOrderListResult` 承載它。
    //    ⚠️ 加一個**零消費端**的回傳欄位是投機:UI 還沒做,型別要長什麼樣由那一片決定。
    //    ✅ **但它【有】被驗**:`parseAdminSearchCustomersResult` 斷言它是 boolean
    //       ⇒ RPC 若不回或回錯型別,這裡就炸,不會靜默。
    //    🔴 **UI 片必須把它接起來** —— migration 的 `COMMENT` 逐字要求
    //       「命中超過上限時 UI 必須顯示『結果太多請更精確』」,**靜默截斷會讓員工以為就這幾筆**。
    //       那一片要新增客戶側的結果型別(同 `AdminOrderListResult` 的形狀)。
    let keywordIds: string[] | null = null;
    if (filter.keyword !== undefined) {
      const { data, error } = await this.supabase.rpc(ADMIN_SEARCH_CUSTOMERS_FN, {
        p_query: filter.keyword,
        p_limit: ADMIN_CUSTOMER_ID_IN_CAP,
      });
      // 🔴 error 先處理、再碰 data —— 先讀 data 會讓「錯誤」變成「形狀錯誤」,指錯方向。
      if (error) {
        throw error;
      }
      const parsed = parseAdminSearchCustomersResult(data);
      keywordIds = parsed.ids;
      // 🔴 **零命中 ⇒ 直接回零筆,不打第二段查詢**:
      //    `.in('user_id', [])` 的行為不押(postgrest 對空陣列的語意不是我們的合約)。
      //    ⚠️ `truncated` **照實帶出去、不寫死 false** —— 「零命中且 truncated」在 RPC 合約下
      //       構造不出來,但**不靠「不可能」寫死值**:靠不可能寫死的東西,哪天可能了就是靜默降級。
      if (keywordIds.length === 0) {
        return { items: [], total: 0 };
      }
    }

    const offset = pagination.offset ?? 0;

    let query = this.supabase
      .from('customers')
      .select(ADMIN_CUSTOMER_LIST_SELECT, { count: 'exact' });
    if (filter.tier) query = query.eq('tier', filter.tier);
    // 🔴 搜尋與 tier 是 **AND**:員工先選「經銷商」再搜名字,不該把 tier 洗掉。
    if (keywordIds !== null) query = query.in('user_id', keywordIds);

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
