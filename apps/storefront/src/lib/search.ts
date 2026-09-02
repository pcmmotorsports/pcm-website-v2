// apps/storefront/src/lib/search.ts — 關鍵字搜尋的 server 端取數(搜尋線 第一刀)
//
// 🔴 **為什麼這支不長在 products.ts 的 `fetchCatalogPage` 上**(2026-09-02 量到、審這片前先讀):
//   `/products` 的商品資料走 RPC `search_catalog_by_vehicle`(products.ts:446),而那支
//   **11 個參數裡沒有關鍵字那一格** —— repo 裡 8 個定義點全掃零命中,數法:
//     grep -rln "search_catalog_by_vehicle" supabase/migrations/ | while IFS= read -r f; do
//       echo "$(grep -c -iE 'p_(keyword|search|q)\b|ILIKE' "$f")  $f"; done   # ⇒ 8 行全 0
//   ⇒ 想讓 `/products?search=` 出結果,只有「改 RPC(= migration)」或「同一頁塞第二條資料路」
//     兩條路。主視窗 2026-09-02 判 **A 案**:另開 `/search`、走本檔,`/products` 一個字不動。
//   ⚠️ **所以搜尋結果頁沒有側欄篩選 / 排序** —— 那是【被決定的缺】不是漏做。
//      理由逐字:「一個看得見的缺,永遠優於一個安靜的錯」——B 案會讓「關鍵字 + 品牌篩選」
//      安靜地丟掉一半條件,而畫面上完全正常。
//
// 🔴 **搜尋準確度的現況(commit body 同一句)**:本檔走 `SupabaseProductAdapter.searchByKeyword`
//   = **ILIKE on title / subtitle / description**(該檔 :504-546、SEARCHABLE_COLUMNS 在
//   helpers/product-query-support.ts:30),對齊 `ADR-0004` §2.1 Q3=A1 的**第一階**
//   (`docs/decisions/0004-m1-pre-launch-decisions.md:35` 逐字「dev 期 ILIKE / 上線後切」、
//    :131「M-1-03 啟動 = search 用 PG ILIKE 暫代」)。
//   ⇒ **中文【搜得到】**(ILIKE 是 `%子字串%`、不需分詞)、**【排不準】**(無詞頻無權重)。
//   ⚠️ 分詞路線本身**還沒有人重新拍** —— `ADR-0004:80` 逐字「`Q3` 的分詞路線需要 Sean 重新拍」
//      (原定的 `pg_jieba` 在 Supabase 裝不起來,同檔 §2.1-a)。那是 M-6 的題,不是這一刀的。
//
// server-only:本檔構造 adapter + anon client,與 products.ts 同紀律,絕不進 client bundle。

import 'server-only';

import { SupabaseProductAdapter, createSupabaseAnonClient } from '@pcm/adapters';
import type { MockProduct } from '@/data/mock-products';
import { SEARCH_MAX_QUERY_LENGTH } from '@/lib/search-shape';
import { toUIProduct } from '@/lib/products';

/** 疊層即時結果一次最多幾筆(對齊稿 `SearchOverlay.jsx:36` 的 `.slice(0, 8)`)。 */
export const SEARCH_OVERLAY_LIMIT = 8;

/** `/search` 結果頁一頁幾筆。與目錄頁 25 同級、不另開設定。 */
export const SEARCH_PAGE_LIMIT = 25;

// 🔴 上限本體住在 `search-shape.ts`(client 也讀得到)—— 疊層要用**同一個值**顯示,
//    否則畫面上那句「沒有找到『…』」指的不是實際跑的那個查詢。
//    而截斷【動作】只發生在本檔,因為疊層與 `/search` 兩條路都經過這裡
//    (codex 2026-09-02 must-fix 2:截斷做在 route ⇒ 兩個畫面對同一輸入給相反答案)。
// 📌 判別句:一條規矩要放在【所有路徑都會經過】的那一層,不是放在你剛好在改的那一層。
export { SEARCH_MAX_QUERY_LENGTH } from '@/lib/search-shape';

export type SearchResult = {
  items: MockProduct[];
  /**
   * 命中總數。🔴 **`null` = 不知道總數,不是 0** ——
   * `Paginated.total` 是 optional(`packages/domain/src/shared/types.ts:104`),
   * 而 `?? 0` 會讓「拿到 8 筆卻說共 0 件」這種畫面出現,**而卡片就在那個 0 的下面**。
   * ⇒ 不知道就說不知道:呼叫端 `null` 時不印件數,不要編一個。
   * (今天這條路上 `SupabaseProductAdapter.searchByKeyword` 恆回數字 —— 那是資料剛好,不是型別保證。)
   */
  total: number | null;
  /** 🔴 撈失敗回 `{items:[], total:0, error:true}` —— 與「真的沒東西」是**兩種**情況,
   *   呼叫端必須分開畫(對齊 `tryCatalogBrandTaxonomy` 那條同款判別句)。 */
  error: boolean;
};

/**
 * 依關鍵字撈商品。空字串 / 純空白 → `{items:[],total:0,error:false}`(不打 DB)。
 *
 * tier 固定 `'general'`:搜尋是**公開端**,不論登入與否都只給一般價。
 * (經銷價的物理防線在 `products_public` view —— 它排除 price_store / price_by_tier,
 *  adapter 拿不到那些欄位,不是靠這裡選對參數。)
 */
export async function searchProducts(
  query: string,
  limit: number,
  offset = 0,
  /**
   * 🔵 **要不要順便數命中總數**(預設 `true` = 既有行為)。
   * 疊層那條路傳 `false` —— 它畫面上沒有印總數的地方(`SearchOverlay.tsx` 全檔 `total` ⇒ 0 行),
   * 而 `count: 'exact'` 會讓 DB **數完整個命中集合**。
   * 🛑 `/search` 那條路**要它**(`app/search/page.tsx:85` 逐字 `共 {total} 件`)⇒ 不要一起關掉。
   */
  countTotal = true,
): Promise<SearchResult> {
  const q = query.trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
  if (q === '') {
    return { items: [], total: 0, error: false };
  }
  try {
    const adapter = new SupabaseProductAdapter(createSupabaseAnonClient());
    const page = await adapter.searchByKeyword(q, { limit, offset }, { countTotal });
    return {
      items: page.items.map((p) => toUIProduct(p, 'general')),
      total: page.total ?? null,
      error: false,
    };
  } catch (err) {
    // 前綴用發出它的那支:查 log 的人會拿這個字串去 grep 函式名。
    console.error('[searchProducts] searchByKeyword failed:', err);
    return { items: [], total: 0, error: true };
  }
}
