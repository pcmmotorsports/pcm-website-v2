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
  /** B2B 5d:經銷會員而取不到經銷價 ⇒ 疊層印「價格暫時無法取得」(沒有這個旗標的 null 印「—」)。 */
  dealerPriceMissing?: true;
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


// ── ⟦search-PROBEPOLLUTION⟧ 2026-09-16:探針退出鍵 ─────────────────────────
// 🔴 **它住在這裡而不是 `search-log.ts`, 理由與本檔開頭那段【完全同一個】**:
//    `search-log.ts` 檔頭是 `import 'server-only'` ⇒ 從 jsdom 測試環境載入即 throw
//    「This module cannot be imported from a Client Component」。
//    🔬 **而這不是我推的, 是實跑紅出來的**:先把它放在 `search-log.ts` 並用 `importOriginal`
//       ⇒ `page.test.tsx` **整支 0 test、載入期就炸**(不是斷言紅)。
//    ⇒ 📌 一個純函式放錯檔, 代價是**測試連跑都跑不起來**, 而那個紅看起來像頁面壞了。

/**
 * 🔴 **探針流量的退出鍵**(⟦search-PROBEPOLLUTION⟧ 2026-09-16)。網址帶 `?probe=1` ⇒ 這一發不記語料。
 *
 * 🔬 **為什麼要有它(數字是量出來的, 正式庫唯讀, 2026-09-16)**:
 *   `search_queries` 301 列裡 **235 列(78%)** 是 9/15 上線【前】我們自己測的;
 *   而**單一個字 `DBK SPECIAL` 就佔 127 列 = 全表 42%** —— 那是 `e2e-prod` 在每次 push 時打的。
 *   ⇒ 📌 語料表是「缺貨商機」的分母, 而**那個分母裡有四成是我們自己**。
 *
 * ⛔ ~~原本的修法是「探針改用固定前綴的字, 查的時候排掉」~~ ⇒ 🛑 **那個修法是錯的, 而錯在資料面**:
 *   ① 探針要證的正是「**真的詞**搜得到真的結果」⇒ 換成 `__probe__xxx` 會回 0 筆, **斷言當場紅**。
 *   ② 🔴 **而更致命的是 `DBK SPECIAL` 是一個【真品牌】** —— 真客人會打這個字。
 *      **按字串排掉它 = 把真客人的訊號一起刪掉**, 而那正是我們想留的東西。
 *   ⇒ ✅ 所以認的是**「這一發請求是誰打的」, 不是「打了什麼字」**。
 *
 * 🔵 客人自己加 `?probe=1` 只會讓他自己這一發不進語料 —— **沒有安全面**(不洩漏、不繞過任何閘)。
 */
export const SEARCH_LOG_PROBE_PARAM = 'probe';

/**
 * 這一發是不是探針。吃 `searchParams` 的原值(字串 / 陣列 / null / undefined 都收),
 * 因為兩個呼叫端拿到的形狀不同:`/products` 有 `spGet`(回 `string | null`)、
 * `/search` 直接讀 `sp.probe`(可能是陣列)。
 * 🔵 重複鍵取首值 —— 與 `/products` 與 `/search` 既有的 idiom 一致, 不新發明一套。
 */
export function isProbeTraffic(raw: string | readonly string[] | null | undefined): boolean {
  return (Array.isArray(raw) ? raw[0] : raw) === '1';
}
