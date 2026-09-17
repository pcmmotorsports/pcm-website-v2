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

import { parseCatalogQuery, type CatalogQuery } from './catalog-query';
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
/**
 * 🔴 **可索引的頁碼上界**(對抗審查 SF-1, 2026-09-17)。
 *
 * ⛔ **問題**:`page` 只過 `parsePositiveInteger`(`catalog-query.ts`), **沒有上界**,
 *   而翻過尾頁**不是 404** —— `lib/products.ts` 回 0 列但補上真 total,
 *   `ProductsPage.tsx` 的 `Math.min(page, totalPages)` 只夾**顯示**, 網址與 canonical 照吐。
 *   ⇒ `/products?pbrands=gilles&page=9999` = **空清單 + 可索引 + 自我指涉 canonical**, 而 N 無限大。
 *
 * 🔬 **為什麼是一個常數, 而不是「撈到 0 列就 noindex」**(審查與主視窗都提了後者):
 *   `generateMetadata` 與 route 本體是**兩個函式**, 而**本體要拿到列數需要**:
 *   車款分類表(`:185`)→ 解析車款(`:302`)→ 改寫查詢(`:387`)→ 會員等級(`:410`)。
 *   ⇒ 要在 metadata 裡知道列數, 就得**把那一整串推導複製一份**。
 *   🛑 **而本檔案的 route 自己就警告過那件事**(`page.tsx:77` 逐字:
 *     「`hasVehicle` 的判準與下面 route 本體的 `hasVehicleParam` 同一套 ——
 *      兩邊算法分岔的那天, `<title>` 會與畫面說不同的話」)。
 *   ⇒ 📌 **為了關掉一條低曝光的路, 去製造一份會分岔的推導 —— 那個交換不划算。**
 *
 * 🔵 **而這條路的曝光本來就低**:分頁連結只指向**真實存在的頁**
 *   ⇒ Google 走不到 `page=9999`, 除非站外有人連它。**它與「篩選組合」那一塊不同量級。**
 *
 * 🔬 **1000 這個數字怎麼來的**(2026-09-17 實量):
 *   全站 **25,402** 件 · 最小每頁 **100**(`CATALOG_PER_PAGE_VALUES` 的最小值)
 *   ⇒ 真實最大頁數 = ceil(25402 / 100) = **255**。取 1000 ≈ **四倍餘裕**。
 * ⚠️ **ponytail: 靜態上界。目錄成長到 100,000 件以上時, 真實頁會開始被誤判 noindex。**
 *   ⇒ 屆時要嘛調大這個數, 要嘛才值得去做「撈到 0 列就 noindex」那一版。
 *   🔵 而誤判的方向是**保守的**(少收錄, 不是多收錄)⇒ 它不會把真商品頁弄掉。
 */
export const CATALOG_MAX_INDEXABLE_PAGE = 1000;

const CANONICAL_PATH = '/products';

/**
 * 把一個 `CatalogQuery` 組回**正規化的路徑 + 查詢字串**(不含 host)。
 *
 * 🔵 **為什麼要獨立出來**:它有兩個用途,而第二個是後來才有的 ——
 *   ① `buildCatalogIndexing` 產 canonical
 *   ② ⟦seo-PROMOTEDLANDING⟧ **比對「這個網址是不是現在掛在首頁大圖上的那一個」**
 *      ⇒ 兩邊都走這一支 ⇒ **參數順序、編碼、新舊格式的差異全部被吃掉**。
 *      ⛔ 若改成比字串, `?pbrands=a&categories=b` 與 `?categories=b&pbrands=a`
 *        會被判成兩個網址, 而客人與 Sean 打出來的順序不會一樣。
 */
export function catalogCanonicalPath(query: CatalogQuery): string {
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
  return `${CANONICAL_PATH}${qs ? `?${qs}` : ''}`;
}

/**
 * 🔴 **這個目錄網址,是不是【現在正掛在首頁大圖上】的那一個**(⟦seo-PROMOTEDLANDING⟧)。
 *
 * 🔵 **為什麼是純函式而不是寫在 route 裡**(對抗審查 SF-1):
 *   第一版整段寫在 `generateMetadata` 裡 ⇒ **一格測試都沒有**
 *   ⇒ 把 `.some(...)` 換成 `const promoted = true`, 或改成比字串, **23 格照樣全綠**。
 *   ⇒ 📌 本片唯一的新邏輯就是這個比對器, 而它原本是零覆蓋的。
 *
 * @param selfPath  本頁的正規化路徑(`catalogCanonicalPath(query)`)
 * @param linkPaths 現行大圖的 `link_path` 清單。**讀不到就傳空陣列** ⇒ 回 false ⇒ 照舊 noindex。
 */
export function isPromotedCatalogLanding(
  selfPath: string,
  linkPaths: readonly string[],
): boolean {
  return linkPaths.some((linkPath) => {
    // 🔴 **不可以只寫 `startsWith('/products')`**(對抗審查 SF-2):
    //   那會吃到 PDP(`/products/akrapovic-slip-on`)與 `/products-xxx` ——
    //   而 PDP 是「新品大圖」最自然的連法。
    //   ⇒ 那種網址解析出空 query ⇒ `catalogCanonicalPath` 回 `/products`
    //   ⇒ 🔴 **客人開裸 `/products` 時會被判成 promoted。**
    //   ⚠️ 今天無害(裸 `/products` 是 0 個維度, 那條門檻碰不到), 而它是**留給下一個人的洞**:
    //     哪天例外多放行一條規則(價格 / 頁碼), 裸 `/products` 就跟著被放行。
    if (linkPath !== '/products' && !linkPath.startsWith('/products?')) return false;
    const qs = linkPath.includes('?') ? linkPath.slice(linkPath.indexOf('?') + 1) : '';
    const sp = new URLSearchParams(qs);
    return (
      catalogCanonicalPath(
        parseCatalogQuery({ get: (k) => sp.get(k), getAll: (k) => sp.getAll(k) }),
      ) === selfPath
    );
  });
}

/**
 * 目錄頁的 canonical + 該不該 noindex。
 *
 * @param query `parseCatalogQuery()` 的回傳值(已白名單化、已去重)。
 * @param base  `resolveSiteUrl()` 的回傳值;`undefined` ⇒ 不產 canonical。
 */
export function buildCatalogIndexing(
  query: CatalogQuery,
  base: string | undefined,
  /**
   * 🔴 **這個網址【現在正掛在首頁大圖上】**(⟦seo-PROMOTEDLANDING⟧ Sean 2026-09-17 Q15 甲)。
   *
   * true ⇒ **只放行「多重篩選」那一條**;價格區間 / 自由關鍵字 / 頁碼上界 **照樣 noindex**。
   * 🔬 **為什麼只放行那一條**:那三條擋的是「無限的組合空間」與「空的頁」,
   *   而它們**不會因為 Sean 推了一張大圖就變成值得收錄的頁**。
   *   ⇒ 📌 例外要窄到只解掉它造成的那個問題, 不是「掛了大圖就全部放行」。
   *
   * 🔵 **為什麼不是一個旗標**(主視窗原訂做法, 2026-09-17 改丙):
   *   那個網址是 Sean 在後台【打字】打出來的 ⇒ 產生它的地方不在碼裡 ⇒ 碼側沒有東西可以標;
   *   而一個「數全站有幾個旗標」的靜態閘, **數不到住在資料裡的那些**。
   *   ✅ 改用「它是不是現行大圖」⇒ **上限是結構性的**:`HOME_BANNER_MAX_SLIDES = 4`,
   *      而且**檔期一過自動失效** ⇒ 📌 **沒有旗標可以被誤用, 所以不需要一道數旗標的閘。**
   *
   * 🛑 **呼叫端要保證:算不出來就傳 `false`**(查詢失敗 / 超時 ⇒ 當作沒有例外)。
   *   失敗的方向必須保守:**少收錄一頁,而不是讓商品頁整個 500。**
   */
  isPromotedLanding = false,
): CatalogIndexing {
  //
  // 🔴🔴 **多重篩選也不收錄**(⟦seo-FILTERCRAWLBUDGET⟧ 2026-09-17, Sean「你們覺得對就做」)。
  //   🔬 **為什麼不是「以防萬一」, 是【現在正在發生的排擠】**:
  //     Search Console 2026-09-17:**24,200 頁「已找到 - 目前尚未建立索引」**
  //     ——我們有 **25,402 個真商品頁**在排隊等 Google 來收,
  //     而篩選組合是**實質無上限**的(2026-09-17 實量:含子類分類 85 × 品牌 23 ≈ 1,955,
  //     再乘車款分類表 12,482 列)。⇒ **Google 每爬一個篩選頁, 就少爬一個真商品頁。**
  //   ✅ **而單一篩選【保留可索引】** —— `?pbrands=gilles` 是「那個品牌的完整目錄」,
  //     那是最可能有人從 Google 搜進來的一種;被關掉的是「分類+品牌」那種組合頁。
  //   🛑 **這一格建立在一個【我們沒有量到】的前提上**:那些頁到底有沒有帶來流量。
  //     那要 GSC 的**查詢報表**, 不是索引狀態報表。⇒ 主視窗 2026-09-17 明示在沒有它的情況下決定,
  //     理由是「乙保住了最可能帶流量的那一種 ⇒ 風險上限低, 而維持現狀的成本正在累積」。
  //     ⇒ 📌 **拿到查詢報表後若打臉這個判斷, 改回來很便宜:本函式的一個門檻。**
  //   ⚠️ **`page` 不算一個維度** —— 它換的是同一組條件的第幾頁, 不是「多一個篩選」;
  //     而本檔下面那段(`page` 留在 canonical)講的就是「第 2 頁的內容跟第 1 頁不一樣」。
  //     ⇒ `?pbrands=gilles&page=2` **仍然可索引**, 那是刻意的。
  //   🔴🔴 **分類與品牌數的是【選了幾顆】, 不是【有沒有選】**(對抗審查 MF-1, 2026-09-17)。
  //     ⛔ ~~第一版寫 `categories.length > 0 ? 1 : 0`~~ ⇒ `?pbrands=akrapovic,gilles,dbk`
  //       只算 **1 個維度** ⇒ **仍可索引、還發自我指涉 canonical。**
  //     🔴 而多選是站上**真的在產**的網址:`use-catalog-filter-url-sync.tsx:99`
  //       `entries.push([BRANDS_PARAM, brands.join(',')])` —— 客人點三顆品牌膠囊就是它。
  //     🔬 **而那一邊的組合空間【大得多】**:23 個品牌的非空子集 = 8,388,607 個,
  //       而本條原本擋的 85×23 ≈ 1,955。
  //       ⇒ 📌 **第一版擋的是小的那一塊、放的是大的那一塊 —— 照它自己寫的理由判, 它做反了。**
  const filterDimensions =
    query.categories.length +
    query.brandSlugs.length +
    (query.vehicle ? 1 : 0) +
    (query.filter ? 1 : 0);

  // 🔴 價格區間(`?pmin` / `?pmax` / `?price`)與自由關鍵字(`?search`)⇒ 不收錄。
  //   `search` 與 `/search` 那條 route 現在的做法一致(線上實測 `noindex, follow`)——
  //   同一種東西同一種待遇。`follow` 保留:爬蟲仍然走得進結果裡的商品頁。
  const noindex =
    query.search !== undefined ||
    query.priceMin !== undefined ||
    query.priceMax !== undefined ||
    // 🔴 `!isPromotedLanding` 只掛在【這一條】上 —— 見上面那個參數的說明:
    //    大圖推的是「這一個網址」, 不是「這一頁上所有的篩選組合」。
    (filterDimensions >= 2 && !isPromotedLanding) ||
    // 🔴 沒有上界的頁碼也是一個無限的組合空間 —— 與本片要處理的是同一件事, 只是另一個維度。
    query.page > CATALOG_MAX_INDEXABLE_PAGE;

  // 🔴🔴 **noindex 的頁一律不產 canonical**(自審抓到,2026-09-09 本機實測後補):
  //   第一版讓 `?pmin=3000&pmax=10000` 同時吐 `noindex` **與** 指向 `/products` 的 canonical。
  //   ⛔ 那兩個訊號互相打架, 而打架的結果可能是**最壞的那個**:canonical 的意思是
  //     「請改收錄那一頁」, Google 已知會把 `noindex` **沿著 canonical 傳給目標頁**
  //     ⇒ 賠上的是 `/products` 本身。
  //   ⇒ 要不收錄就只說 `noindex`, **不要同時遞給它另一個網址**。
  if (noindex || !base) return { noindex };

  return { canonical: `${base}${catalogCanonicalPath(query)}`, noindex };
}
