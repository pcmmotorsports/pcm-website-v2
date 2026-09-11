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
import { logSearchQuery } from '@/lib/search-log';
import { retryOnceOnStatementTimeout } from '@/lib/retry-on-statement-timeout';

/** 疊層即時結果一次最多幾筆(對齊稿 `SearchOverlay.jsx:36` 的 `.slice(0, 8)`)。 */
export const SEARCH_OVERLAY_LIMIT = 8;

/** `/search` 結果頁一頁幾筆。與目錄頁 25 同級、不另開設定。 */
export const SEARCH_PAGE_LIMIT = 25;

// 🔴 上限本體住在 `search-shape.ts`(client 也讀得到)—— 疊層要用**同一個值**顯示,
//    否則畫面上那句「沒有找到『…』」指的不是實際跑的那個查詢。
//    ⚠️ **2026-09-03 訂正:截斷【不只】發生在本檔了。**
//    `lib/catalog-query.ts` 的 `parseCatalogQuery` **也截一次**,而那**不是遺留、是刻意**:
//      `/products?search=` 那條路的**顯示端**(`SearchKeywordChip`)讀的是 parser 的回傳值,
//      而它必須與被查的字串是**同一個運算式**(否則膠囊印 150 字而只查了前 100)。
//    ⇒ 📌 兩處吃**同一個常數**(`search-shape.ts`),對已截斷的字串再截一次是 idempotent。
//    ⇒ 🔵 本檔這一道**留著**的理由:疊層那條路**不經過 parser**。
//    而截斷【動作】在本檔仍然覆蓋所有經過本檔的路徑,因為疊層與 `/search` 兩條路都經過這裡
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
  /**
   * 🔴🔴 **要不要記進搜尋語料**(2026-09-07 Q47 code-reviewer must-fix 1)。
   * ⛔ ~~原本這件事搭在 `countTotal` 上~~ —— 那是**兩件事共用一個開關**:
   *    `countTotal` 問的是「要不要數總數」, 語料問的是「這是不是一次【客人的搜尋】」。
   * 🔬 而它們今天分家了:分類頁那一行「查看全部 N 筆」要數總數, **而那一發不是新的搜尋**
   *    —— 同一個詞在轉址時已經以 `path:'capsule'` 記過一筆。
   * ⇒ 📌 **不分家的話, 一次客人動線會把同一個詞灌進語料 4 列**, 而語料表正是
   *    「缺貨商機」的分母 ⇒ 那個分母會被我們自己的 UI 灌水。
   */
  logCorpus = true,
): Promise<SearchResult> {
  const q = query.trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
  if (q === '') {
    return { items: [], total: 0, error: false };
  }
  try {
    const adapter = new SupabaseProductAdapter(createSupabaseAnonClient());
    // 🔴 2026-09-11:撞到 anon 3 秒逾時(57014)再試一次 —— `/search` 與搜尋框建議都經過這一行。
    let page = await retryOnceOnStatementTimeout('searchProducts', () =>
      adapter.searchByKeyword(q, { limit, offset }, { countTotal }),
    );

    // ══ ⟦商品頁印的料號搜不到⟧ 2026-09-09:一筆都沒有 ⇒ 再問一次【變體料號】 ══════
    //
    // 🔬 **病是在鑽機上打出來的**:`/products/probe-dbk-3` 主標上方逐字印
    //   「DBK SPECIAL PARTS · 原廠料號 **DBK-3-BLK**」, 而 `?search=DBK-3-BLK` ⇒ **0 件商品**;
    //   同一頁的母料號 `PB-dbk-3` ⇒ 1 件。⇒ 📌 **畫面印 A、搜尋只認 B。**
    //   成因寫在 `SupabaseProductAdapter.searchByVariantSku` 的 JSDoc(兩個各自正確的決定撞在一起)。
    //
    // 🔴 **為什麼修在【這一層】而不是 `searchByKeyword` 裡面**:
    //   ① 站上三條搜尋路(`/products?search=` · `/search` · 疊層 `/api/search`)**全部經過本函式**
    //      (`grep -rn "searchProducts(" apps/storefront/src` ⇒ 三個呼叫端 + 定義)
    //      ⇒ 一條規矩放在所有路徑都會經過的那一層(本檔上方那句判別句, 換一個受詞)。
    //   ② `searchByKeyword` 有**兩個回空的出口**(RPC 路早退 / 舊路)⇒ 在那裡補要補兩處,
    //      而那支函式的每一段都帶著審查史。**這裡一處就蓋住兩條。**
    //
    // 🛑 **只在「一筆都沒有」時才問** —— 不是聯集:
    //   · 已經有結果的查詢 ⇒ **行為逐字不變**(不會因為某顆商品的變體料號剛好含這個字而插隊)。
    //   · 多付的那一發只發生在**今天回 0 件**的那條路上 ⇒ 它的對照組是「客人什麼都沒看到」。
    // 🛑 **只在第一頁問** —— 翻頁時本來就該是空的(翻過尾頁), 在那裡回一批新東西 =
    //   同一次瀏覽兩種清單(同 `products.ts` 的 `filter=new` 探查那一格記過的病)。
    //
    // ⚠️ **證到哪**:鑽機上 `DBK-3-BLK` / `DBK-3-RED` 由 0 件變 1 件、母料號與中文查詢逐字不變。
    //   🛑 **正式庫沒驗** —— 鑽機的 GRANT 是那支腳本自己下的(`scripts/storefront-probe/up.sh`
    //   檔頭逐字「GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ **證不了正式站的權限設定**」)
    //   ⇒ 📌 **正式站 anon 能不能【直接】讀 `product_variants_public`, 這一格我證不到。**
    //   🔵 今天它以 **embed** 的形式被 anon 讀到(`PRODUCT_SELECT_DETAIL_WITH_VARIANTS`),
    //     而 embed 與直讀走的是同一道 GRANT ⇒ **吻合但未證實。**
    //
    // 🔴🔴 **所以這一發【失敗就吞】, 而那與本檔其他地方的紀律【方向相反】—— 理由要寫出來**:
    //   · 這是一發**純加法**的第二發:它成功 ⇒ 客人多看到東西;它失敗 ⇒ 客人看到的
    //     **就是今天那個正確但不完整的答案**(「沒有找到『…』」)。
    //   · 若讓它掉進下面那個 catch ⇒ `error: true` ⇒ 📌 **站上【每一個】零結果查詢都會變成
    //     「搜尋暫時無法使用」** ⇒ 那比今天嚴格更差, 而它會在正式站第一天就發生。
    //   ⇒ 🎯 判準不是「錯誤要大聲」而是**哪一種錯比較貴** —— 這裡吞掉不會把對的變成錯的。
    //   📎 而這個形狀 repo 裡已經有先例:`SupabaseProductAdapter.trySearchIdsWithBrand` 逐字
    //     「客人搜得到(結果差一點)優先於『讓錯誤大聲』」。**同一條取捨, 換一個受詞。**
    //   ⚠️ **代價明寫**:權限沒開的話這條路會**安靜地不生效**, 只留一行 `console.error`
    //     ⇒ 要知道它有沒有活著, 得看 log 或在正式站打一次變體料號。
    // 🔴🔴 **[codex 對抗審查 2026-09-09 must-fix ② —— 這個旗標是它逼出來的]**
    //   吞掉錯誤之後, 下面那一發語料仍然會照著 `page.total`(= 0)記成
    //   **「客人搜這個字, 我們一件都沒有」** ⇒ 📌 **一次權限錯 / 查詢錯會被寫成一筆永久的假缺貨商機**,
    //   而語料表正是缺貨商機的分母。console 留痕**不會**阻止那筆錯資料寫進去。
    //   ⇒ ✅ 回查壞掉 ⇒ **這一次的零筆是「不知道」不是「沒有」** ⇒ 不記語料。
    let variantLookupFailed = false;
    if (page.items.length === 0 && offset === 0) {
      try {
        const byVariant = await adapter.searchByVariantSku(q, { limit });
        // 🔵 `total` **要一起接** —— 它是精確的(adapter 那兩道閘保證了),
        //    而 `null` 在呼叫端會被 `total ?? products.length` 當成當頁筆數印出來, 不是「不印」。
        if (byVariant.items.length > 0) page = byVariant;
      } catch (err) {
        variantLookupFailed = true;
        console.error('[searchProducts] 變體料號回查失敗(維持原本的零筆結果):', err);
      }
    }
    // 🔴🔴 **四個閘一起成立才記**(前三個 plan v5 §5;每一個都是量出來的, 不是想到的。
    //    ⛔ ~~原本寫「三個閘」~~ ⇒ 2026-09-09 多了 `!variantLookupFailed`, 理由在上面那段):
    //    `countTotal === true` 排掉【疊層】—— `/api/search` 逐字傳 `false`,
    //       而疊層是**邊打字邊呼叫** ⇒ 記它等於把「碳 / 碳纖 / 碳纖維」三筆前綴當成三次搜尋。
    //    `offset === 0`        排掉【翻頁】—— `products/page.tsx` 每翻一頁重呼一次 ⇒ 次數會灌水。
    //    (第三個閘 `error === false` 在結構上已經成立:這一行在 `try` 的成功路徑上,
    //       失敗那條走下面的 `catch` ⇒ 那裡不記。
    //       ⇒ 🛑 **理由要寫出來** —— 撈失敗回 `{total:0,error:true}`,
    //         記下去會存成「客人搜的我們都沒有」= 一筆假的缺貨商機。)
    // 🔵 而它**不 await** —— 記 log 不得讓客人多等(`logSearchQuery` 自己包 `after()`)。
    // 🔴🔴 **自己包一層 try** —— 而這一格是**測試逼出來的, 不是我想到的**:
    //    這一行在外層 `try` 裡面 ⇒ `logSearchQuery` 若同步 throw, 會被下面那個 `catch` 接走
    //    ⇒ **回 `{error:true}` ⇒ 客人看到「搜尋失敗」** ⇒ 📌 那正是 Sean 明令不准的
    //      「寫入失敗不得影響搜尋回應」。
    //    🛑 而 `logSearchQuery` 自己**已經**保證不 throw ⇒ 這一層看起來是多餘的 ——
    //       ✅ 它不是:兩道保證的差別在**誰壞掉時還撐得住**。內層那道由那支檔的作者維護,
    //          這一道由**這個呼叫點**維護, 而爆炸半徑落在這裡。
    if (logCorpus && countTotal && offset === 0 && !variantLookupFailed) {
      try {
        logSearchQuery({ query: q, path: 'keyword', resultCount: page.total ?? null });
      } catch (err) {
        console.error('[searchProducts] 記語料那一發 throw 了(搜尋不受影響):', err);
      }
    }
    return {
      // 🔴 **`productId` 要在這裡補上, 而 `toUIProduct` 不會給** —— 它回 `MockProduct`,
      //   而那個型別的 `id` 是 `hashIdToNumber(product.id)`(數字)⇒ **原始 uuid 到這裡就沒了**。
      //   ⇒ 少了它, 經銷會員在【搜尋結果頁】會看到**牌價**, 而畫面不會說
      //     (route 端拿不到 id ⇒ 送出空清單 ⇒ 一發價格 RPC 都不打)。
      //   🔵 不改 `toUIProduct` 的簽章:它呼叫者很多, 而只有這條路需要 uuid。
      //   📎 codex 對抗審查 2026-09-07 must-fix ①(⟦b4-DEALERSIGNUPUNSEEN⟧ 第二半)。
      items: page.items.map((p) => ({ ...toUIProduct(p, 'general'), productId: p.id })),
      total: page.total ?? null,
      error: false,
    };
  } catch (err) {
    // 前綴用發出它的那支:查 log 的人會拿這個字串去 grep 函式名。
    console.error('[searchProducts] searchByKeyword failed:', err);
    return { items: [], total: 0, error: true };
  }
}
