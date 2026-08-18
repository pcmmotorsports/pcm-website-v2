import type { SupabaseClient } from '@supabase/supabase-js';
import type { IFavoritesRepository } from '@pcm/ports';
import type { CustomerId, FavoriteListItem, FavoriteProductId } from '@pcm/domain';
import type { Database } from './database.types';

/**
 * 收藏清單的投射。
 *
 * 🔴 **`products!inner(...)` 的 `!inner` 是承重的,不是風格** ——
 * 它讓「查不到商品」那幾列**整列消失**,而那正是 Sean 2026-08-18 拍板的甲案
 * (逐字「甲 = 不顯示(清單直接少一項)」)。
 * ```
 * 商品軟下架（products.delisted_at 有值）
 *   ⇒ products_select_public 的 RLS 是 USING (delisted_at IS NULL) ⇒ 客人端查不到那一列
 *   ⇒ inner join 之後，該收藏就不在結果裡
 * ```
 * ⚠️ **改成非 inner(左外接)會讓下架商品以 `null` 出現** ⇒ **那是被推翻的乙案**,不要改。
 * ⚠️ 而 `brands` 也是 `!inner`:每個商品都有 `brand_id NOT NULL`(migration 建表時),
 *   所以它不會濾掉任何東西 —— 但**若日後 brand 變成可選,這裡會靜靜地少列**。
 *
 * 🔴 **白名單**:只投射清單畫面要用的欄。**絕不放 `price_store` 或任何 tier 價**
 * (鐵則:經銷價絕不傳到一般會員瀏覽器)。
 */
const FAVORITE_SELECT =
  'customer_user_id, product_id, created_at, products!inner(id, handle, title, price_general, images, brands!inner(name))';

type FavoriteRow = {
  customer_user_id: string;
  product_id: string;
  created_at: string;
  products: {
    id: string;
    handle: string;
    title: string;
    price_general: number | null;
    /** jsonb;來源 shape 不保證 ⇒ 型別標寬鬆、下方 runtime 收斂為 string | null。 */
    images: unknown;
    brands: { name: string };
  };
};

/**
 * SupabaseFavoritesAdapter:`IFavoritesRepository` 的 Supabase 實作(`#191`)。
 *
 * plan:`docs/specs/2026-08-18-g3-favorites-plan.md`(Sean 2026-08-18 批)。
 * migration:`20260818170000_m4b_g3_customer_favorites`(2026-08-18 已 apply)。
 *
 * **單一 authenticated client**:三個方法都走客人自己的 JWT。
 * DB 那邊 `authenticated` 只有 `SELECT / INSERT / DELETE`(**刻意沒有 UPDATE**),
 * RLS 三條 own-only(`auth.uid() = customer_user_id`)。
 * ⇒ **這支 adapter 不需要、也拿不到 `service_role`。**
 */
export class SupabaseFavoritesAdapter implements IFavoritesRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /** 列出某會員的收藏(新的在前)。error → throw。 */
  async listByCustomer(customerId: CustomerId): Promise<FavoriteListItem[]> {
    const { data, error } = await this.supabase
      .from('customer_favorites')
      .select(FAVORITE_SELECT)
      .eq('customer_user_id', customerId)
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }
    return (data as unknown as FavoriteRow[]).map((row) => ({
      favorite: {
        customerUserId: row.customer_user_id,
        productId: row.product_id,
        createdAt: row.created_at,
      },
      product: {
        id: row.products.id,
        handle: row.products.handle,
        title: row.products.title,
        brandName: row.products.brands.name,
        priceGeneral: row.products.price_general,
        // images 是 jsonb ⇒ 可能是 null / 非陣列 / 元素非 string。這裡**收斂不丟錯**:
        // 一張圖讀不出來不該讓整個收藏清單掛掉(對齊 `mappers/product.ts:326` 對 null 的處置)。
        imageUrl: Array.isArray(row.products.images) && typeof row.products.images[0] === 'string'
          ? row.products.images[0]
          : null,
      },
    }));
  }

  /**
   * 加入收藏 —— **冪等**。
   *
   * 🔴 `ignoreDuplicates: true` 是承重的,不是最佳化:
   * ```
   * 它讓 supabase-js 送 Prefer: resolution=ignore-duplicates ⇒ ON CONFLICT DO NOTHING
   * 🔴 而【預設的 upsert 是 ON CONFLICT DO UPDATE】，那需要 UPDATE 權限 ——
   *    我們刻意沒給（DB 那邊 authenticated 只有 SELECT/INSERT/DELETE）⇒ 預設寫法會直接紅
   * ```
   * ⚠️ **為什麼冪等是必要的,不是保險**:雙擊愛心 / 兩個分頁各按一次 ⇒ 第二發撞複合主鍵。
   * 若把它當失敗回報,畫面會把愛心**退回去** ⇒ 客人看到「收藏了又取消了」。
   * ⇒ 那是本片要治的病(「畫面說成功、其實沒有」)的**鏡像**:**實際成功了,而畫面說失敗。**
   */
  async add(customerId: CustomerId, productId: FavoriteProductId): Promise<void> {
    const { error } = await this.supabase
      .from('customer_favorites')
      .upsert(
        { customer_user_id: customerId, product_id: productId },
        { onConflict: 'customer_user_id,product_id', ignoreDuplicates: true },
      );
    if (error) {
      throw error;
    }
  }

  /**
   * 取消收藏 —— **同樣冪等**。
   * 刪一個本來就不在的,PostgREST 回 204、不是錯 ⇒ 兩個分頁各按一次不會炸。
   */
  async remove(customerId: CustomerId, productId: FavoriteProductId): Promise<void> {
    const { error } = await this.supabase
      .from('customer_favorites')
      .delete()
      .eq('customer_user_id', customerId)
      .eq('product_id', productId);
    if (error) {
      throw error;
    }
  }
}
