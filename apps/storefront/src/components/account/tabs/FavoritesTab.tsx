// FavoritesTab.tsx — 會員中心「收藏清單」分頁(M-4b #191:接真清單)
//
// 殼與空狀態沿用 g-3 的 `.acc-section[data-tab="favorites"]` + `.acc-empty`;
// 有收藏時改渲 design `AccountPages.jsx:561-578` 的 `.acc-fav-grid` / `.acc-fav`
// (圖 + 品牌 + 品名 + 價格,整張是連到商品頁的 `<a>`)。
//
// 🔴 **資料由 server 算好傳進來**(`app/account/page.tsx` → `getFavoritesRepo().listByCustomer`),
//   鏡像同頁的 addresses / vehicles / orders 三條。**不在這裡打 API** ——
//   會員中心其他分頁都是這個形狀,多開一條 client 取數路徑只會多一種失敗方式。
//   ⚠️ ⇒ 本分頁**不吃 FavoritesContext**(那是給兩顆愛心同步用的)。在會員中心取消收藏
//   要重整才會消失 —— 而**本分頁現在沒有取消鈕**(design 那張卡也沒有),所以今天碰不到這一格。
//
// 🔴 **看不到的商品不會出現在這裡**(Sean 2026-08-18 逐字「甲 = 不顯示(清單直接少一項)」)——
//   那是 adapter `products!inner` + RLS 的自然結果,本檔沒有、也不該有過濾邏輯。
//
// ~~後端無 favorites entity / port / use-case / adapter(backlog #191)~~
// ~~商品頁亦無「加入收藏」按鈕、無從產生真收藏~~
// 🔴 上面兩句 2026-08-18 起**都不成立**(留痕不刪):後端在 `20260818170000_m4b_g3_customer_favorites`
//   + `SupabaseFavoritesAdapter`;兩顆愛心(`ProductCard` / `ProductInfo`)已接 `FavoritesContext`。
//   ⚠️ 而 g-3 當年那句「不搬 design mock 6 件商品字面」**仍然有效** ——
//   守門 `FavoritesTab.test.tsx` 還在盯 LIGHTECH / RIZOMA / NT$ 那組字面,
//   它守的是「不要拿假資料裝成有收藏」,**不是**「不准出現商品」。

import Link from 'next/link';
import type { FavoriteListItem } from '@pcm/domain';

export type FavoritesTabProps = {
  /** page.tsx getFavoritesRepo→listByCustomer 算好傳入;讀取失敗退化 [](走空狀態)。 */
  favorites: FavoriteListItem[];
};

export function FavoritesTab({ favorites }: FavoritesTabProps) {
  return (
    <div className="acc-section" data-tab="favorites">
      <div className="acc-section-head">
        <h2>收藏清單</h2>
      </div>
      {favorites.length === 0 ? (
        <div className="acc-empty">
          目前尚無收藏商品
          <div className="acc-empty-sub">您的收藏會顯示在此</div>
        </div>
      ) : (
        <div className="acc-fav-grid">
          {favorites.map(({ favorite, product }) => (
            <Link key={favorite.productId} className="acc-fav" href={`/products/${product.handle}`}>
              {/* 沒有圖就不渲 <img>:`.acc-fav img` 有 `background: var(--c-surface-2)`,
                  空 src 會變成一塊「像是壞掉」的灰;少一張圖比一塊破圖好。 */}
              {product.imageUrl && <img src={product.imageUrl} alt={product.title} />}
              <div className="acc-fav-body">
                <div className="acc-fav-brand">{product.brandName}</div>
                <div className="acc-fav-name">{product.title}</div>
                {product.priceGeneral !== null && (
                  <div className="acc-fav-price">NT$ {product.priceGeneral.toLocaleString()}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
