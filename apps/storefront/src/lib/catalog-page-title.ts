// lib/catalog-page-title.ts — 目錄頁(/products)的 <title> / description 衍生(M-4b SEO 第1.5片)
//
// 為什麼要有這支:目錄頁的每一種參數組合,`<title>` 與 description **逐字相同**
// (2026-09-09 線上實測:`/products`、`?sort=new`、`?filter=new`、`?category=排氣系統`、
//  `?page=2` 五個網址的 `<title>` 一字不差)。第 1 片讓它們收斂成正確的 canonical,
// 而**分類與新品是真的不同的頁** —— 它們該有自己的名字,搜尋結果上才分得出來。
//
// 🔵 **推導照著畫面走,不自己發明第二套。** 畫面那半住在
//   `components/ProductsPageHeader.tsx:26-34`(h1):
//     `分類.sub ?? 分類.main ?? 車款 ?? (新品 ? '最新上架' : '全部商品')`
//   ⇒ 本檔**只讀那支、不改那支**(它在窗 A 手上)。
//   ⇒ 🔴 `'最新上架'` 這四個字是**抄它的**,不是我另外取的名字。
//     兩處字面不一致的那天,就是下一個「同一件事兩種說法」。
//
// 🛑 **車款(`?vehicle=`)這一半刻意不做** —— 從網址只拿得到 slug,要中文車名得多打一次
//   `tryVehicleTaxonomy()`,而那支今天有三列板在講它慢(⟦search-TAXONOMY2MB⟧ /
//   ⟦search-TAXONOMYTIMEOUT⟧ / ⟦db-TAXONOMYVIEW⟧,都在窗 A 手上)。
//   ⇒ **在那三列有結論之前不多開一個呼叫端。**
//   ⇒ 🔴 而「不做」不等於「當它不存在」:有 `?vehicle=` 時本檔**退回通用標題**,
//     因為那時候 h1 印的是車名 —— 給一個「最新上架」會與畫面**互相矛盾**,
//     而一個矛盾的標題比一個通用的標題糟。
//
// 🛑 分類選了**兩顆以上**時也退回通用標題:h1 那支吃的是單一 `cascade.category`,
//   而「全段排氣管 + 尾段排氣管」要叫什麼是一個沒有答案的問題。通用是誠實的。

const SITE_SUFFIX = 'PCM重機零件販售';
const GENERIC_NAME = '商品目錄';
const DEFAULT_DESCRIPTION = '高端機車零件選品 · 依車款 / 分類 / 品牌篩選';
/** 🔴 逐字抄 `ProductsPageHeader.tsx` 的 `'最新上架'`,不另取名字。 */
const NEW_ARRIVALS_LABEL = '最新上架';

export type CatalogPageText = { title: string; description: string };

/**
 * 第 2 頁以後的頁碼字樣(第 1.5 片補遺)。
 *
 * 🔴 **第 1 頁不加** —— `/products` 與 `/products?page=1` 是同一頁,加了會多出一個
 *   只差在標題的分身。(canonical 那側已經把 `page=1` 省掉了,見 `catalog-canonical.ts`。)
 * 🔵 全形括號照本站 UI 文案的既有慣例(`RegisterPage.tsx` 的「（必填）」)。
 */
function withPageSuffix(name: string, page: number): string {
  return page > 1 ? `${name}（第 ${page} 頁）` : name;
}

/**
 * 目錄頁的標題與描述。只吃 URL 上拿得到的東西 —— **零 DB、零 taxonomy 查詢**。
 *
 * @param categories `CatalogQuery.categories`(已白名單化、已去重的分類聯集)
 * @param hasVehicle 網址上有沒有車款(短版 `?vehicle=` 或長版 `?brand=&model=`)
 * @param isNewArrivals `CatalogQuery.filter === 'new'`
 * @param page `CatalogQuery.page`(1 起算);>1 時標題帶頁碼,description 不帶
 *   —— 描述講的是「這一頁在賣什麼」,那件事不因為翻到第幾頁而改變。
 */
export function buildCatalogPageText(
  categories: readonly string[],
  hasVehicle: boolean,
  isNewArrivals: boolean,
  page = 1,
): CatalogPageText {
  // 分類優先 —— 與 h1 同一個順序(分類 › 車款 › 新品),因為分類是客人自己選的、最具體。
  if (categories.length === 1) {
    const category = categories[0]!;
    return {
      title: `${withPageSuffix(category, page)} — ${SITE_SUFFIX}`,
      description: `PCM 的${category}選品 · 依車款 / 分類 / 品牌篩選`,
    };
  }
  // 有車款(或多顆分類)⇒ 通用。理由見檔頭兩段 🛑。
  if (hasVehicle || categories.length > 1) {
    return { title: `${withPageSuffix(GENERIC_NAME, page)} — ${SITE_SUFFIX}`, description: DEFAULT_DESCRIPTION };
  }
  if (isNewArrivals) {
    return {
      title: `${withPageSuffix(NEW_ARRIVALS_LABEL, page)} — ${SITE_SUFFIX}`,
      description: `PCM ${NEW_ARRIVALS_LABEL}的高端機車零件 · 依車款 / 分類 / 品牌篩選`,
    };
  }
  return { title: `${withPageSuffix(GENERIC_NAME, page)} — ${SITE_SUFFIX}`, description: DEFAULT_DESCRIPTION };
}
