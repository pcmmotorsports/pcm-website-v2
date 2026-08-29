import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * SupabaseCouponAdapter — 後台券列表的讀取(M-4b 券片 2b-2a)。
 *
 * 形狀逐支對齊 `SupabaseCustomerAdapter` 的 `listCustomerSummariesForAdmin`,
 * 而**兩個排序坑的處置逐字照抄它**(見下方 `order` 那一段)——那不是我想到的。
 *
 * 🔴 **本 adapter 只讀不寫。** 券的寫入唯一路是之後那幾片的 SECURITY DEFINER RPC
 *    (片1 的兩張底表對 `service_role` 是**零表權限**)。
 */

/**
 * 具名白名單投影。
 *
 * 🔴 **禁 `select('*')`** —— 逐顆列出才擋得住「view 加了欄而它自動流到前端」。
 * ⚠️ 而 `code`(券碼)在這裡**是要投影出來的** —— 後台列表本來就要顯示它,
 *    而 Sean 2026-08-26 逐字「沒關係, 猜到就猜到」(猜碼風險他接受)。
 */
export const ADMIN_COUPON_LIST_SELECT =
  'id, code, description, discount_type, discount_value, ends_on, max_redemptions, ' +
  'max_per_account, min_spend, stacks_with_tier, is_active, created_at, created_by, ' +
  'creator_label, used_count, coupon_level_blocks';

/** 讀的是那支 view,不是底表 —— `used_count` / `creator_label` / 擋住的理由只有那裡算得出來。 */
export const ADMIN_COUPON_LIST_VIEW = 'admin_coupon_list_blocks_v';

export type SupabaseAdminCouponRow = {
  id: string;
  code: string;
  description: string;
  discount_type: string;
  discount_value: number;
  ends_on: string | null;
  max_redemptions: number | null;
  max_per_account: number | null;
  min_spend: number;
  stacks_with_tier: boolean;
  is_active: boolean;
  created_at: string;
  created_by: string;
  creator_label: string | null;
  used_count: number;
  coupon_level_blocks: string[];
};

/**
 * 局部型別擴充 + **在 client 這一層 cast 一次**。
 *
 * 🔴 家法逐字照 `SupabaseCustomerAdapter.ts:145` 的 `DatabaseWithCustomerListView`:
 *    「cast 只發生在 client 這一層一次,`.from` / `.eq` / `.order` 的欄名檢查全部保留」。
 *
 * ⚠️ **而【不是】重生成 `database.types.ts`** —— 那支型別是從**真的資料庫**生成的,
 *    而本片這兩支 view **都還沒 apply** ⇒ 現在重生成, 產物裡不會有它們。
 *    📌 我的 plan 原本寫「重生成」, 那是錯的;已在 plan 裡劃掉並寫明家法。
 */
type DatabaseWithCouponListView = Database & {
  public: Database['public'] & {
    Views: Database['public']['Views'] & {
      admin_coupon_list_blocks_v: {
        Row: SupabaseAdminCouponRow;
        Relationships: [];
      };
    };
  };
};

export type AdminCouponFilter = { readonly isActive?: boolean };
export type AdminCouponSort = { readonly key: 'endsOn' | 'usedCount'; readonly ascending: boolean };

/** domain 排序鍵 → view 欄名。**唯一的對照表**(兩邊各一份會漂)。 */
const SORT_COLUMN: Record<AdminCouponSort['key'], string> = {
  endsOn: 'ends_on',
  usedCount: 'used_count',
};

export class SupabaseCouponAdapter {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * 後台券列表(唯讀、分頁、`count: 'exact'`)。
   */
  async listCouponsForAdmin(
    filter: AdminCouponFilter,
    pagination: { limit: number; offset?: number },
    sort?: AdminCouponSort,
  ): Promise<{ items: SupabaseAdminCouponRow[]; total: number }> {
    const offset = pagination.offset ?? 0;
    const db = this.supabase as unknown as SupabaseClient<DatabaseWithCouponListView>;

    let query = db
      .from(ADMIN_COUPON_LIST_VIEW)
      .select(ADMIN_COUPON_LIST_SELECT, { count: 'exact' });

    if (filter.isActive !== undefined) {
      query = query.eq('is_active', filter.isActive);
    }

    /**
     * 🔴🔴 **兩個排序坑, 而它們都【不會讓畫面看起來壞掉】** ——
     * 逐字照 `SupabaseCustomerAdapter` 那一段的處置, **不是我重新想的**。
     *
     * **坑 1 · `ends_on` 是 NULL, 而 Postgres `DESC` 預設 NULLS FIRST**
     *   那一欄 NULL = **不設結束日**(片1 檔頭逐字「刻意不 coalesce:沒有一個合理的零日期」)。
     *   ⇒ 員工按「結束日」想找**快到期的**, 而第一頁全是**永不到期**的券,
     *     **而畫面看起來完全正常** —— 他只會覺得這個排序沒用, 不會回報。
     *   ⇒ **`nullsFirst: false` 兩個方向都給**:升冪也要, 否則只是換一邊錯。
     *     **「沒有值」在兩個方向都排最後。**
     *
     * **坑 2 · 排序要帶唯一鍵**(`docs/patterns/pagination-loop-review.md` 第五條)
     *   🔴 而聚合欄讓它嚴重一個量級:`used_count = 0` 的券可能有幾十張,
     *     **它們之間完全沒有定序** ⇒ 翻頁時同一張券出現兩次、另一張永遠看不到。
     *   ⇒ 一律追加 `id` 當第二鍵(view 的主鍵, 唯一)。
     *
     * 📌 `sort` 省略 ⇒ 走 `created_at DESC`(最新建的先看)。**換預設是行為改動**, 不歸這一片。
     */
    if (sort === undefined) {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order(SORT_COLUMN[sort.key], {
        ascending: sort.ascending,
        nullsFirst: false,
      });
    }
    query = query.order('id', { ascending: true });

    const { data, error, count } = await query.range(offset, offset + pagination.limit - 1);
    if (error) throw error;

    return {
      items: (data ?? []) as unknown as SupabaseAdminCouponRow[],
      total: count ?? 0,
    };
  }
}
