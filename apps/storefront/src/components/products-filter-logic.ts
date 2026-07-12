// products-filter-logic.ts — ProductsPage 商品篩選 / 排序純函式
//
// M-1-12 Codex review 修正:自 ProductsPage.tsx 拆出(AGENTS.md 鐵則 6:元件檔
// >400 行必拆);並修正品牌篩選 id→name 解析(Codex finding 3)。
//
// 對齊 design-reference/components/ProductsPage.jsx L85-126。

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
      if (p.price < lo || p.price > hi) return false;
    }
    if (extras.priceRange) {
      const [lo, hi] = extras.priceRange;
      if (p.price < lo || p.price > hi) return false;
    }
    return true;
  });
}

/** 商品排序 — 對齊 design sortProducts(L117-126)。 */
export function sortProducts(products: MockProduct[], sort: string): MockProduct[] {
  const arr = [...products];
  switch (sort) {
    case 'new':
      return arr.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
    case 'price-asc':
      return arr.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return arr.sort((a, b) => b.price - a.price);
    case 'sale':
      return arr.sort((a, b) => (b.isSale ? 1 : 0) - (a.isSale ? 1 : 0));
    default:
      return arr;
  }
}
