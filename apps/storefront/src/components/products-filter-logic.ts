// products-filter-logic.ts — ProductsPage 商品篩選 / 排序純函式
//
// ⚠️⚠️ **本檔的函式在正式頁面上【沒有呼叫者】。**(2026-09-07 量:`grep -rn 'filterProducts|sortProducts'
//    apps packages` ⇒ 唯一的呼叫者是本檔自己的測試檔。)
//    `ProductsPage.tsx:288` 逐字:「**P4:products 已是 server 依 URL 篩選、排序、分頁的當頁資料;
//    禁止再在 client 對當頁二次篩選/排序**」⇒ 篩選與排序早就下推到 server/DB 了。
// 🛑 **⇒ 本檔的測試【不構成正式行為的證據】。**
//    📌 病史:2026-09-07 我在這裡做 ⟦b4-DEALERSIGNUPUNSEEN⟧ 的「篩選排序吃經銷價」那一半 ——
//       24 格全綠、四發突變全殺到、三綠全綠, **而那些格測的是一條沒有人走的路**。
//       codex 對抗審查 must-fix ② 抓到的。
// 🎯 **判別法(寫測試【之前】問, 不是寫完之後)**:`grep -rn '<函式名>' apps packages`
//    —— **呼叫者裡有沒有非測試檔?** 沒有 ⇒ 你即將產出的是一份【看起來比真的還可信】的證據,
//    因為真正在跑的碼還有生產環境會反駁它, **而死碼不會**。
// ✅ **本檔留著的理由**:它是 design-reference `ProductsPage.jsx` L85-126 的對齊參照, 不是死碼清理的漏網。
//    要動真的篩選排序 ⇒ **改 server 查詢**(RPC/SQL 的 `ORDER BY` 與價格 `WHERE`), 不是這裡。
//
// M-1-12 Codex review 修正:自 ProductsPage.tsx 拆出(AGENTS.md 鐵則 6:元件檔
// >400 行必拆);並修正品牌篩選 id→name 解析(Codex finding 3)。
//
// 對齊 design-reference/components/ProductsPage.jsx L85-126。
//
// 🔴🔴 **2026-09-06 起:走型錄那條路的商品, `fitments` 恆為 `undefined`。**(線 `front`,板列 ⟦search-CATALOGPAGE2MB⟧)
//   `lib/catalog-page.ts` 的 `catalogRowToUIProduct` **不再帶 fitments 陣列**, 只帶算好的 `fits` 字串 ——
//   那整包在正式站把該頁的 `unstable_cache` 條目推過 2 MB 上限(逐字
//   `items over 2MB can not be cached (2679379 bytes)`), 而它的唯一用途是印「N 款車型」。
//   量到的:選了車的那一頁 `motoBrand` 出現 40,278 次 / 4,477,365 bytes;沒選車 239 次 / 693,655 bytes。
//
// 🛑 **⇒ 要在本檔重啟任何吃 `fitments` 的 client 端過濾之前, 先去改那個 mapper** ——
//   不然它會拿到 `undefined` 而**靜靜地過濾不到任何東西**(不會 throw、不會紅)。
//   ⚠️ 本檔今天**沒有**任何一處讀 `fitments` ⇒ 這是**給未來的人**的路標, 不是現有缺陷。
//   🔴 **而【怎麼數】比那個 0 重要 —— 我寫這段話的當下, 連續數錯兩次**:
//   · `grep -c fitments` ⇒ 7, 而**其中 6 筆是這一段文字自己** ⇒ 記錄變成下一次的假命中。
//   · 改成濾掉 `//` 開頭 ⇒ 仍剩 `:50`, 那是 JSDoc 的 ` * ` 濾不掉, **而它講的是 DB 表名
//     `product_fitments`, 不是這個屬性** ⇒ 📌 兩個不同的東西共用一個字面, grep 分不出來。
//   ✅ **成立的說法**:`grep -n '\.fitments' <本檔>` 的每一筆都在註解裡
//     (一筆是**這一句自己**, 另一筆是下面那段講舊 `matchesVehicle` 的註解)⇒ **執行碼零處讀它。**
//   🛑 **這裡刻意不寫行號** —— 上一版寫了 `:18`, 而**加完這幾行它就變成 `:21`**:
//     一個指向自己的行號, 在寫下的那一刻就過期了。

import type { CascadeFilterState } from '@pcm/ui';
import type { MockProduct } from '@/data/mock-products';
import type { MockBrand } from '@/data/mock-brands';
import type { ProductExtraFilters } from './filter-state';

/**
 * 分類路徑分隔符:子類 raw_path = `大類{SEP}子類` 麵包屑。
 * 🔴 必與(1)網站分類 seed / sync-categories 的 raw_path 組法(2)報價單 taxonomy 一致;
 * 與 design mock category 既有格式 `'操控部品 · 腳踏後移'` 同。改此值須三處同步。
 */
export const CATEGORY_PATH_SEP = ' · ';

// 價格區間字串標籤 → [低, 高](對齊 design ProductsPage.jsx L100-106)
const PRICE_RANGE_TABLE: Record<string, [number, number]> = {
  'NT$ 0 – 3,000': [0, 3000],
  'NT$ 3,000 – 10,000': [3000, 10000],
  'NT$ 10,000 – 30,000': [10000, 30000],
  'NT$ 30,000 – 100,000': [30000, 100000],
  'NT$ 100,000 以上': [100000, Infinity],
};

/**
 * 商品篩選 — 依品牌 / 現貨 / 新品 / 特價 / 顏色 / 價格過濾。
 *
 * **品牌:** cascade.brands 持品牌 id;經 brands 對照表解析為品牌名後與 p.brand
 * 比對(大小寫不敏感)。design 原以 `id.replace(/-/g,'').substring(0,4)` 模糊
 * 比對,對含空格品牌名(如 `cnc-racing` → `cncr` vs "CNC RACING")會誤判無結果
 * → M-1-12 Codex finding 3 修正為正規 id→name 解析。
 *
 * **車輛過濾:S1(2026-07-12)起不在本函式** —— 下推 DB(page.tsx 依 ?vehicle= 走 RPC
 * `search_products_by_vehicle` = product_fitments ∪ product_fitments_effective〔報價單家族樹
 * 展開〕去重,繼承件也命中);products prop 即相容子集。舊 `matchesVehicle`(client、只認
 * direct)已移除(adversarial F4:留著會濾掉繼承命中)。#152 車輛半仍關閉(過濾真的生效、
 * 只是換到 server)。cascade.vehicle 僅供 chips/標題/URL 同步。
 *
 * **分類過濾(cascade.category):** C2 接線補上(見 `matchesCategory`;關閉 #152 分類半 + #147/#205)。
 * 比對鍵 = 選取分類名稱(`sub ?? main`),對齊 `product.category`(= `product.category.raw`);
 * 真分類註冊表 name = raw_path(P0-B seed)、與 p.category 同源。未選分類(category=null)不過濾。
 *
 * @param products 商品來源清單
 * @param cascade  階層篩選狀態(brands + vehicle + category)
 * @param extras   價格 / 顏色 / 旗標篩選
 * @param brands   品牌對照表(id → name 解析用)
 */
/**
 * 分類比對(兩層階層涵蓋、#212 子類上架):
 * - 選子類(`sub` 有值):商品分類 === 「大類 · 子類」麵包屑(精確)。
 * - 只選大類(`sub` undefined):商品分類 === 大類名(大類自身直掛、罕見)
 *   或以「大類 · 」開頭 → **rollup 涵蓋該大類底下所有子類商品**。
 * `product.category` = 該商品所屬分類 raw_path(adapter JOIN `categories.raw_path`);
 * 子類 raw_path 存麵包屑「大類 · 子類」、大類 raw_path 存純大類名。選取名 `main`/`sub`
 * 來自 buildCategoryTree 節點(大類 name=大類名、子類 name=葉名),故重組麵包屑 = 精確子類鍵。
 * 🔴 分隔符 `CATEGORY_PATH_SEP` 須與網站分類 seed(sync-categories 組 raw_path)+ 報價單一致。
 * 車款零回歸:獨立分支、不觸 matchesVehicle;未選分類不過濾。
 */
function matchesCategory(
  product: MockProduct,
  category: NonNullable<CascadeFilterState['category']>,
): boolean {
  if (category.sub != null) {
    return product.category === `${category.main}${CATEGORY_PATH_SEP}${category.sub}`;
  }
  return (
    product.category === category.main ||
    product.category.startsWith(`${category.main}${CATEGORY_PATH_SEP}`)
  );
}

export function filterProducts(
  products: MockProduct[],
  cascade: CascadeFilterState,
  extras: ProductExtraFilters,
  brands: MockBrand[],
): MockProduct[] {
  // 品牌比對兩端皆 trim 後 lowercase(對稱、對齊 matchesVehicle 的 trim 慣例):
  // 選取名來自 buildBrandTaxonomy(已 trim)/ MOCK_BRANDS(乾淨),p.brand 亦 trim,
  // 防未來髒資料(brand 帶頭尾空白)造成「側欄 count 說有、選了結果變少」的靜默不一致。
  const selectedBrandNames = cascade.brands.map(
    (id) => brands.find((b) => b.id === id)?.name.trim().toLowerCase() ?? '',
  );
  return products.filter((p) => {
    // 🔴 S1(2026-07-12、adversarial F4):vehicle 不再 client 過濾 —— 車款篩選已下推 DB
    //   (page.tsx 依 ?vehicle= 走 RPC search_products_by_vehicle = direct ∪ 家族樹展開去重、
    //   products prop 即相容子集)。舊 matchesVehicle 只認 products.fitments(direct),留著會把
    //   繼承命中(掛母款 MT-09 的通用件 × 選 MT-09 SP)靜默濾掉 = 74→124 白做。
    //   cascade.vehicle 仍持狀態(chips/標題/URL 同步用)、僅不在此過濾。
    if (cascade.category && !matchesCategory(p, cascade.category)) return false;
    if (selectedBrandNames.length && !selectedBrandNames.includes(p.brand.trim().toLowerCase())) {
      return false;
    }
    if (extras.inStock && !p.inStock) return false;
    if (extras.isNew && !p.isNew) return false;
    if (extras.isSale && !p.isSale) return false;
    if (extras.colors.length && !extras.colors.includes(p.color)) return false;
    if (extras.price) {
      const [lo, hi] = PRICE_RANGE_TABLE[extras.price] ?? [0, Infinity];
      // 🔴 經銷會員選 5,000-10,000 要看到他自己那個 4,800 —— 用有效價不用牌價。
      const ep = effectiveUnitPrice(p);
      if (ep === null || ep < lo || ep > hi) return false;
    }
    if (extras.priceRange) {
      const [lo, hi] = extras.priceRange;
      const ep = effectiveUnitPrice(p);
      if (ep === null || ep < lo || ep > hi) return false;
    }
    return true;
  });
}

/**
 * 這一列對【這個看的人】而言的價 —— 篩選與排序都要用它,不要用 `p.price`。
 *
 * 🔴 **判準是「有沒有 `dealerPrice` 這個欄位」, 不是「它大不大」**(主視窗 B 2026-09-07 裁甲):
 *    `dealerPrice` 只在 `tier === 'store'` 時由 route 端蓋上(`products/page.tsx`);
 *    無差價時 RPC 自己 coalesce 回 general ⇒ **回來的永遠不是 0**
 *    ⇒ 🛑 而**真 0 元是合法價** ⇒ 用 `> 0` 會把它讀成「沒有經銷價」而退回一般價。
 *    ⇒ ✅ `??` 正好是「在不在」的語意:`0 ?? x` 是 `0`。
 *
 * 🔵 `price` 可能是 `null`(`CatalogCardProduct` 逐字:null = **查不到價**, 不是 0 元)
 *    ⇒ 回 `null`, 由呼叫端決定怎麼辦。**不要在這裡 `?? 0`** —— 那是把「查不到」偽造成「免費」。
 */
export function effectiveUnitPrice(p: {
  readonly price: number | null;
  readonly dealerPrice?: number;
}): number | null {
  return p.dealerPrice ?? p.price;
}

/** 商品排序 — 對齊 design sortProducts(L117-126)。 */
export function sortProducts(products: MockProduct[], sort: string): MockProduct[] {
  const arr = [...products];
  switch (sort) {
    case 'new':
      return arr.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
    // 🔴 排序也吃有效價 —— 否則經銷會員看到的是【照別人的價排好】的一頁。
    //   `price === null`(查不到價)排到最後, 兩個方向都是:一個不知道價的東西
    //   不該因為排序方向而跳到最前面。
    case 'price-asc':
      return arr.sort((a, b) => cmpPrice(a, b, 1));
    case 'price-desc':
      return arr.sort((a, b) => cmpPrice(a, b, -1));
    case 'sale':
      return arr.sort((a, b) => (b.isSale ? 1 : 0) - (a.isSale ? 1 : 0));
    default:
      return arr;
  }
}

/** 價格比較 —— `null`(查不到價)恆排最後, 不隨方向翻面。 */
function cmpPrice(
  a: { readonly price: number | null; readonly dealerPrice?: number },
  b: { readonly price: number | null; readonly dealerPrice?: number },
  dir: 1 | -1,
): number {
  const pa = effectiveUnitPrice(a);
  const pb = effectiveUnitPrice(b);
  if (pa === null && pb === null) return 0;
  if (pa === null) return 1;
  if (pb === null) return -1;
  return (pa - pb) * dir;
}
