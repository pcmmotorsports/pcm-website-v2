import type { CustomerId } from './types';

/** 收藏指向的商品(products.id)。 */
export type FavoriteProductId = string;

/**
 * CustomerFavorite: 會員收藏 entity(`#191`)。
 *
 * 對齊 migration `20260818170000_m4b_g3_customer_favorites`
 * (複合主鍵 `(customer_user_id, product_id)`、RLS own-only)。
 * plan:`docs/specs/2026-08-18-g3-favorites-plan.md`(Sean 2026-08-18 批)。
 *
 * 🔴 **刻意沒有 `id`** —— DB 是複合主鍵,「同一人同一商品只能一筆」由 DB 保證,
 *   不靠應用層去重。給它一個 surrogate id 反而會讓人以為可以有兩筆。
 * 🔴 **刻意沒有商品快照欄**(標題 / 價格 / 圖)——
 *   收藏是「**指向一個商品**」,不是「**當時那個商品的樣子**」。
 *   ⚠️ 與 `order_items` 的 `product_snapshot` **相反**:訂單要記成交當下,收藏不要。
 */
export type CustomerFavorite = {
  customerUserId: CustomerId;
  productId: FavoriteProductId;
  createdAt: string;
};

/**
 * 收藏清單裡的一項。
 *
 * 🔴 **看不到的商品【不會出現在這裡】**(Sean 2026-08-18 拍板逐字「甲 = 不顯示(清單直接少一項)」)。
 * ```
 * 商品軟下架（products.delisted_at 有值）
 *   ⇒ products_select_public 的 RLS 是 USING (delisted_at IS NULL) ⇒ 客人端查不到它
 *   ⇒ 收藏清單自然就少一項（不必特別做「留著並標示」）
 * ```
 * ⚠️ **主視窗原本代裁「乙:顯示並標已下架」,Sean 看過理由之後推翻成甲** ——
 *   引用這一格要用他那句原文,不要引主視窗那版。
 *
 * 🔴 **而 DB 那一列還在**(軟下架不刪商品 ⇒ 沒有 cascade)——
 *   客人看不到它,也就**無法取消收藏它**。**本片刻意不清理**,理由見
 *   `docs/specs/2026-08-18-g3-favorites-plan.md` §1-c-2 陷阱二。
 *   一句話版:**軟下架是可逆的,清掉就回不來了。**
 */
export type FavoriteListItem = {
  favorite: CustomerFavorite;
  product: FavoriteProductSummary;
};

/** 收藏清單要用到的商品欄位(白名單;**絕不放經銷價或任何 tier 價**)。 */
export type FavoriteProductSummary = {
  id: FavoriteProductId;
  handle: string;
  title: string;
  brandName: string;
  /** 一般會員價(整數,單位同 products.price_general)。 */
  priceGeneral: number | null;
  /**
   * 代表圖 URL(= `products.images[0]`;沒有圖就是 `null`)。
   * design `AccountPages.jsx:568` 的收藏卡是**圖片主導**的(`.acc-fav img` 佔滿整個卡寬、
   * `aspect-ratio: 1`)⇒ 少了它那張卡會塌成一條字。
   */
  imageUrl: string | null;
};
