// lib/catalog-canonical.ts — 目錄頁(/products)的 canonical 與 noindex 判準(M-4b SEO 第1片)
//
// 為什麼要有這支:`/products` 吃 13 個參數(見 `catalog-query.ts` 的 `parseCatalogQuery`),
// 而在本片之前它**一個 canonical 都沒有**、每一種參數組合的 `<title>` 與 description 逐字相同
// ⇒ 線上實測 `/products`、`?sort=new`、`?filter=new`、`?category=排氣系統`、`?page=2`
//   五個網址的 `<title>` 一字不差、canonical 全部 NONE。對 Google 是大量重複頁。
//
// 🔴 **判準只有一句:換掉這個參數之後,回來的【商品集合】會不會變。**
//   會變 ⇒ 它是一個真的頁,進 canonical。
//   不會變(只是換排序 / 換每頁幾筆)⇒ 不進 canonical,讓它們併回同一個網址。
//
// 🔴🔴 **canonical 是從 `CatalogQuery`【組回去】的, 不是從原始網址刪參數。**
//   ⇒ 白名單只有一份 = `parseCatalogQuery`。它哪天多吃一個參數, 本檔不用跟著改,
//     而且新參數的預設行為是**保守的**(不進 canonical), 不會安靜地多出一堆可索引網址。
//   ⇒ 順帶把認不得的東西(`?from=catalog`、`?utm_source=…`)天然洗掉 —— 那不是特例, 是同一條規則。
//
// 🛑 **價格區間走 `noindex` 而【不是】「洗掉參數指回 /products」** —— 這一格是刻意的:
//   洗掉的話,一個「NT$ 3,000–10,000」的頁會宣告自己等於**未篩選的整頁**,而那是一個
//   Google 看得出來不成立的宣告(內容根本不同)⇒ 它會忽略我們的 canonical、自己挑一個。
//   而價格滑桿是連續值 ⇒ 組合無限 ⇒ 這裡要的是「不要收錄」。
//   📌 **要不收錄就直說 noindex,不要用 canonical 假裝。**
//
// 🔵 `page` **留在 canonical、不折回第 1 頁**:折回去等於說「第 2 頁的內容跟第 1 頁一樣」,而它不是。
//   而且目錄頁現在**完全沒有分頁連結**(2026-09-09 線上實測:`/products` 的 HTML 裡 `page=`
//   出現 0 次、也沒有 rel=next/prev)⇒ 第 51 個以後的商品站內走不到,再把 `page` 折掉會讓
//   那些頁連自我指涉都沒有。自我指涉的 canonical 在這裡是最誠實的選擇。

import type { CatalogQuery } from './catalog-query';
import { BRANDS_PARAM, CATEGORIES_PARAM } from './catalog-query';

export type CatalogIndexing = {
  /**
   * 絕對網址。`base` 沒值(prod 未設 `NEXT_PUBLIC_SITE_URL`)⇒ `undefined`,呼叫端整個省略
   * `alternates` —— 與 PDP(`app/products/[slug]/page.tsx`)逐字同一套,絕不吐 localhost。
   */
  canonical?: string;
  /** true ⇒ 呼叫端下 `robots: { index: false, follow: true }`。 */
  noindex: boolean;
};

/**
 * 進 canonical 的參數(換了它商品集合就變)。**輸出順序固定 = 本陣列的順序**,
 * 讓同一組條件不論客人的網址怎麼排,都收斂到同一個字串。
 *
 * 🔴 品牌與分類都**只寫新格式**(`pbrands` / `categories`)—— 讀取端兩種都吃(見
 *   `parseCatalogQuery`),寫出端只產一種。⇒ 舊的 `?category=排氣系統` 與
 *   `?pbrand=akrapovic` 會 canonical 到新格式,兩種網址收斂成一個。
 */
const CANONICAL_PATH = '/products';

/**
 * 目錄頁的 canonical + 該不該 noindex。
 *
 * @param query `parseCatalogQuery()` 的回傳值(已白名單化、已去重)。
 * @param base  `resolveSiteUrl()` 的回傳值;`undefined` ⇒ 不產 canonical。
 */
export function buildCatalogIndexing(
  query: CatalogQuery,
  base: string | undefined,
): CatalogIndexing {
  // 🔴 價格區間(`?pmin` / `?pmax` / `?price`)與自由關鍵字(`?search`)⇒ 不收錄。
  //   `search` 與 `/search` 那條 route 現在的做法一致(線上實測 `noindex, follow`)——
  //   同一種東西同一種待遇。`follow` 保留:爬蟲仍然走得進結果裡的商品頁。
  const noindex =
    query.search !== undefined || query.priceMin !== undefined || query.priceMax !== undefined;

  // 🔴🔴 **noindex 的頁一律不產 canonical**(自審抓到,2026-09-09 本機實測後補):
  //   第一版讓 `?pmin=3000&pmax=10000` 同時吐 `noindex` **與** 指向 `/products` 的 canonical。
  //   ⛔ 那兩個訊號互相打架, 而打架的結果可能是**最壞的那個**:canonical 的意思是
  //     「請改收錄那一頁」, Google 已知會把 `noindex` **沿著 canonical 傳給目標頁**
  //     ⇒ 賠上的是 `/products` 本身。
  //   ⇒ 要不收錄就只說 `noindex`, **不要同時遞給它另一個網址**。
  if (noindex || !base) return { noindex };

  const params = new URLSearchParams();
  // 排序讓 `?categories=b,a` 與 `?categories=a,b` 收斂到同一個 canonical。
  // (`brandSlugs` 在 `parseCatalogQuery` 就已經排過了,這裡再排一次不會錯、也不依賴那個細節。)
  if (query.categories.length > 0) {
    params.set(CATEGORIES_PARAM, [...query.categories].sort().join(','));
  }
  if (query.brandSlugs.length > 0) {
    params.set(BRANDS_PARAM, [...query.brandSlugs].sort().join(','));
  }
  if (query.vehicle) params.set('vehicle', query.vehicle);
  // `?filter=new`(近 7 天)換的是**商品集合**;`?sort=new` 換的只是同一份集合的排序。
  // 兩者長得像而語意不同 ⇒ 前者進 canonical、後者不進。
  if (query.filter) params.set('filter', query.filter);
  if (query.page > 1) params.set('page', String(query.page));

  const qs = params.toString();
  return { canonical: `${base}${CANONICAL_PATH}${qs ? `?${qs}` : ''}`, noindex };
}
