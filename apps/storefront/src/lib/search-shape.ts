// apps/storefront/src/lib/search-shape.ts — 搜尋疊層 API 的回傳形狀(client 與 server 共用)
//
// 🔴 **為什麼這個型別不住在 `app/api/search/route.ts` 裡**:那支 route import `@/lib/search`,
//    而 `lib/search.ts` 檔頭是 `import 'server-only'` ⇒ 從 client component `import type`
//    它會踩到 bundler 的模組解析(型別雖然編譯期被抹掉,解析仍可能發生)。
// 🔴 **也不在 SearchOverlay.tsx 裡自己再寫一份** —— 同一個契約散成兩份,下次改欄位時它們會分岔
//    (`ProductCard.tsx:40` 那條 nit 逐字警告過同一件事)。
// ⇒ 抽一支只有型別、零 import 的檔:兩端都指向同一份契約。

export type SearchOverlayItem = {
  slug: string;
  brand: string;
  name: string;
  /**
   * 🔴 `null` = 查不到價格,**不是 0 元**。畫的人要印「—」不是「NT$ 0」。
   * 兩者處置相反的拍板在 `lib/catalog-page.ts:80`(Sean 2026-08-25):
   *   · `null`(查不到)⇒ 價格印「—」
   *   · `0`(贈品 / 買一送一的那個「送」)⇒ 印「NT$ 0」
   * ⚠️ 加任何 `?? 0` / `|| 0` 都會把這兩半重新黏起來,而**畫面上看不出來**。
   */
  price: number | null;
  image: string | null;
};

/**
 * 關鍵字長度上限。超過就截斷 —— **不回 400**:貼一段長文不該讓搜尋框整個壞掉。
 *
 * 🔴 **它住在這支(client 也讀得到)是刻意的**:截斷發生在 server 端的 `searchProducts`,
 *    而**疊層必須用同一個值來顯示** —— 否則它會畫「沒有找到『<300 個字>』」,
 *    而真正被搜的只有前 100 個字 ⇒ **畫面上那句話指的不是實際跑的那個查詢**。
 * 📌 判別句:顯示用的字串與實際查詢的字串,只要不是同一個運算式,它們就會分岔。
 */
export const SEARCH_MAX_QUERY_LENGTH = 100;
