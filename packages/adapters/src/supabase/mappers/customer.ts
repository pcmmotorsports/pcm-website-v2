import { narrowMemberTier } from './member-tier';
import type { Customer, AdminCustomerSummary } from '@pcm/domain';
import type { Database } from '../database.types';

/**
 * Supabase customers row schema —— **derive 自生成 Database 型別**(backlog #106、消雙 cast escape hatch)。
 *
 * 由 `supabase gen types`(database.types.ts)生成的 customers 表 Row 直接取用:schema 改欄位 / 改型 →
 * 重新 gen 後此型別自動跟著變 → mapper 讀 `row.xxx` 即 compile-time 抓 drift(取代手寫易 stale)。
 *
 * 對齊 ADR-0003 §3.4 wire 字串紀律:本 type 是 wire 字面、只在 mapper 邊界出現、不 leak 至 domain / ports / use-case。
 * Nullable / enum 由生成型別保證對齊 DB(phone / birthday nullable、tier member_tier enum =
 * general/store/premiumStore == domain MemberTier)。
 */
/**
 * 🔴 **本地補上 `gender`,而它是【有期限的】。**
 *
 * `database.types.ts` 是對正式庫生成的,而它**生成於 `20260831140000`(加 gender 欄)之前**
 * ⇒ 生成檔的 `customers.Row` 裡查無此欄(2026-09-01 實查:11 欄,沒有 gender)。
 * ⇒ 而那一欄**在正式庫上已經存在**(帳本 `:338`,Sean 08-31 手貼 + `-15` 唯讀複驗)。
 *
 * ⚠️ **重生 `database.types.ts` 之後這個 augment 就該刪掉** —— 留著不刪的話,
 *    它會變成「型別說有、DB 說了算」的第二份真相。
 * 🔵 形狀照本 repo 既有先例:`SupabaseCustomerAdapter.ts` 對
 *    `admin_customer_list_v` 也是這樣補的(那裡逐字寫著同一條期限)。
 */
export type SupabaseCustomerRow = Omit<Database['public']['Tables']['customers']['Row'], never> & {
  /**
   * 🔴 **刻意是 optional(`?`)而不是必填** —— 那不是圖方便,是**型別層的誠實**:
   * 生成檔還不知道有這一欄 ⇒ 任何從 client 回來的 row,在型別上**就是沒有它**。
   * 寫成必填會逼每一個讀取點去假造一個值, 而那等於把「型別不新鮮」這件事藏起來。
   * ⇒ 而 `undefined` 由 `narrowGender` 接住(它把 null 與 undefined 都收成 null)。
   * ⚠️ 而代價要明寫:**`.select()` 沒撈這一欄時,domain 拿到的也是 `null`**
   *    —— 那與「這個人沒填」印同一個值。⇒ 要拿性別的讀取點, `select` 必須含 `gender`。
   */
  gender?: string | null;
};

/**
 * 本 patch 只寫 name / phone / birthday(對齊 ICustomerRepository.update Pick 簽名)。
 * migration GRANT L231 實際為 `UPDATE (name, phone, birthday, updated_at)`(另含 updated_at);
 * updated_at 不由本 patch 送、由 customers_set_updated_at trigger 強制覆寫(見 mapCustomerPatchToRow)。
 */
export type SupabaseCustomerUpdateRow = Partial<
  Pick<SupabaseCustomerRow, 'name' | 'phone' | 'birthday' | 'gender'>
>;

/**
 * DB 讀出來的 `gender` → domain 的三字面聯集。
 *
 * 🔵 值域正本是 `@pcm/schemas` 的 `GENDER_CODES`, 而 `packages/adapters` 依賴得到它;
 *    這裡仍然手寫三個字面, 理由是**這支函式要在型別不新鮮時仍然正確** ——
 *    它的輸入是 `string | null`(來自一個可能過期的生成型別), 而它的工作就是不信任那個型別。
 * ⚠️ 認不得 ⇒ 回 `null` + `console.error`(照 `narrowMemberTier` 的形狀:降級 + 留鑑識)。
 *    🔴 而這裡**沒有「安全的預設值」可以降** —— tier 可以降成 `general`(權限最小),
 *    而性別沒有一個「最小」的值。⇒ 只能回 `null`,而 `null` 的意思是「沒有值」。
 */
export function narrowGender(
  raw: unknown,
  where: string,
): 'male' | 'female' | 'undisclosed' | null {
  if (raw === null || raw === undefined) return null;
  if (raw === 'male' || raw === 'female' || raw === 'undisclosed') return raw;
  console.error(`[${where}] gender 是本版不認得的值,降成 null`, { raw });
  return null;
}

/**
 * wire customers row → domain Customer(snake_case → camelCase)。
 *
 * user_id → id / wallet_balance → walletBalance / total_deposit → totalDeposit /
 * created_at → createdAt / updated_at → updatedAt;phone nullable → `?? ''`。
 */
export function mapSupabaseCustomerToDomain(row: SupabaseCustomerRow): Customer {
  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    phone: row.phone ?? '',
    birthday: row.birthday,
    // 🔴 執行期收窄 —— 照同檔 `tier` 那一格的理由(`#879`:生成型別的新鮮度不保證),
    //    而這一欄**更需要它**:`gender` 在 DB 是 `text`(不是 enum),值域靠 CHECK 管
    //    ⇒ 型別層給的是 `string | null`, 而 domain 要的是三個字面的聯集。
    // 🛑 **認不得的值一律降成 `null`, 而不是原樣帶過去** ——
    //    `null` 的語意是「沒有值」, 那是誠實的;帶一個不認得的字串進 domain
    //    會讓下游每一個 `switch` 落到它沒寫的分支, 而那時已經離這裡很遠了。
    gender: narrowGender(row.gender, 'mappers/customer.mapSupabaseCustomerToDomain'),
    // 🔴 `#879`:runtime 收窄(生成型別新鮮度不保證,見 `./member-tier`)。
    tier: narrowMemberTier(row.tier, 'mappers/customer.mapSupabaseCustomerToDomain'),
    walletBalance: row.wallet_balance,
    totalDeposit: row.total_deposit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── 讀路徑(admin 摘要):customers row → domain AdminCustomerSummary(M-4a 客戶管理第一片)──

/**
 * admin 客戶摘要讀 row 型別 —— derive 自生成 Database Row(對齊 SupabaseCustomerRow 慣例)。
 *
 * 只取 `ADMIN_CUSTOMER_LIST_SELECT`(SupabaseCustomerAdapter)投影的欄。
 * 🔴 **不含** wallet_balance / total_deposit(#202 儲值金 HOLD)、birthday(列表不需);customers 表本身無成本欄。
 * `tier` 生成 member_tier enum 字面 = domain MemberTier(直送);`phone` nullable 直送(UI 顯 '—')。
 */
export type SupabaseAdminCustomerRow = Pick<
  SupabaseCustomerRow,
  'user_id' | 'name' | 'email' | 'phone' | 'tier' | 'created_at'
> & {
  // ── 客戶頁三欄:來自 `admin_customer_list_v`,**不是 `customers` 表** ──────────
  //
  // 🔴 **這三欄是手寫的,不是從 `database.types.ts` derive 來的** ——
  //    那支 view 的 migration(`20260816030000`)**還沒 apply 到正式庫**,
  //    而 `supabase gen types` 是對著正式庫跑的 ⇒ 生成檔裡查無此 view
  //    (`grep -c admin_customer_list_v database.types.ts` ⇒ **0**,2026-08-16 實查)。
  //
  // ⚠️ **這是一段【有期限的】手寫**:apply 之後要重生型別、把這三行換成 derive,
  //    否則「型別說有」與「DB 真的有」之間就永遠只靠這段註解連著。
  //    🔴 而在那之前,唯一驗這三個欄名真的存在的東西是
  //    `docs/probes/customer-list-select-probe.sh`(對真 view 打一次)。
  //
  // 型別依據:view 定義 `20260816030000_…:71-113`。`count`/`sum` 是 bigint,
  // PostgREST 送 JSON number;`max(created_at)` 是 timestamptz,零訂單時為 null。
  active_order_count: number;
  active_spend_total: number;
  last_active_ordered_at: string | null;
};

/** wire customers 摘要 row → domain AdminCustomerSummary(user_id → id;其餘直送)。 */
export function mapSupabaseAdminCustomerRowToSummary(
  row: SupabaseAdminCustomerRow,
): AdminCustomerSummary {
  return {
    id: row.user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    // 🔴 `#879`:同上。這一路流向 admin 客戶列表的 `Record<MemberTier, …>` 查表。
    tier: narrowMemberTier(row.tier, 'mappers/customer.adminCustomerRow'),
    createdAt: row.created_at,
    // 🔴 三欄來自 `admin_customer_list_v`(不是 `customers` 表)。
    //    `count`/`sum` 在 PG 回 bigint ⇒ PostgREST 送 JSON number ⇒ 這裡是 number。
    //    ⚠️ `Number()` 只是**顯式標明這裡期待數字**,**它擋不了什麼**(code-reviewer 2026-08-16):
    //    `Number(null)` / `Number('')` 都**靜默回 0**,只有非數字字串才 NaN。
    //    真正保證非 null 的是 view 那邊的 `count(*)` 與 `coalesce(sum(...), 0)`,不是這一行。
    activeOrderCount: Number(row.active_order_count),
    activeSpendTotal: Number(row.active_spend_total),
    // 🔴 **不要 `?? 0`** —— 零訂單的語意是「從來沒有」,不是「時間是 0」。
    lastActiveOrderedAt: row.last_active_ordered_at,
  };
}

/**
 * domain patch → wire customers update row(只含 present key)。
 *
 * name / phone / birthday 三欄 camelCase == snake_case、直接對應;
 * **不寫 updated_at** —— GRANT L231 雖含 updated_at,但 customers_set_updated_at BEFORE UPDATE trigger
 * (L262-264)強制覆寫 now()、user 送值無效,故本 patch 不送。
 * tier / wallet_balance / total_deposit 不在 GRANT、不在此 patch(走 service_role / ledger trigger)。
 */
export function mapCustomerPatchToRow(
  patch: Partial<Pick<Customer, 'name' | 'phone' | 'birthday' | 'gender'>>,
): SupabaseCustomerUpdateRow {
  const row: SupabaseCustomerUpdateRow = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.phone !== undefined) row.phone = patch.phone;
  // 🔴 `gender` 與上面三欄同一個形狀:**只有 `!== undefined` 才寫**。
  //    ⇒ 沒送這一欄 = 不動它, 而不是把它清成 null。兩者對一個「沒填過性別的人」
  //      看起來一樣, 而對一個「填過而這次沒改」的人差很多。
  if (patch.gender !== undefined) row.gender = patch.gender;
  if (patch.birthday !== undefined) row.birthday = patch.birthday;
  return row;
}
