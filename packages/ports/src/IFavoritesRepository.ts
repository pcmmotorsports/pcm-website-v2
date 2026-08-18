import type { CustomerId, FavoriteListItem, FavoriteProductId } from '@pcm/domain';

/**
 * IFavoritesRepository: 會員收藏 port(`#191`)。
 *
 * plan:`docs/specs/2026-08-18-g3-favorites-plan.md`(Sean 2026-08-18 批)。
 * DB:`customer_favorites`(複合主鍵、RLS own-only、`authenticated` 只有 SELECT/INSERT/DELETE)。
 * 客人讀寫自己那幾列(RLS `auth.uid() = customer_user_id` 守)。
 *
 * 🔴 **沒有 `update`** —— 一筆收藏沒有可改的東西;DB 那邊也**刻意沒給 `UPDATE` 權限**。
 *   要改變狀態走 `add` / `remove`。
 */
export interface IFavoritesRepository {
  /**
   * 列出某會員的收藏(新的在前)。
   * 🔴 **客人看不到的商品不會出現在結果裡**(Sean 2026-08-18 逐字「甲 = 不顯示(清單直接少一項)」)。
   *   實作上這是**自然結果**:`products_select_public` 的 RLS 已經把下架商品濾掉,
   *   inner join 之後那幾列就不見了 —— 不需要另外寫過濾邏輯。
   *   ⚠️ 而**收藏那一列還在 DB**,客人無法取消它;本片刻意不清理(理由見 plan §1-c-2)。
   */
  listByCustomer(customerId: CustomerId): Promise<FavoriteListItem[]>;

  /**
   * 加入收藏。
   * 🔴 **必須冪等** —— 重複收藏同一件**不得**丟錯。
   *   理由:雙擊 / 兩分頁競態的第二發會撞複合主鍵(`23505`),
   *   而若把它當失敗回報,畫面會把愛心**退回去** ⇒ 客人看到「收藏了又取消了」。
   *   ⚠️ 那正是本片要治的病(「畫面說成功、其實沒有」)的**鏡像**:實際成功了,而畫面說失敗。
   */
  add(customerId: CustomerId, productId: FavoriteProductId): Promise<void>;

  /**
   * 取消收藏。
   * 🔴 **同樣冪等** —— 取消一個本來就不在的,不得丟錯(兩個分頁各按一次)。
   */
  remove(customerId: CustomerId, productId: FavoriteProductId): Promise<void>;
}
