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
 * **車輛過濾(cascade.vehicle):** 依 `product.fitments` 逐層比對(品牌→車型→年份),見
 * `matchesVehicle`。🔴 字面 vs 事實:design 的 filterProducts(ProductsPage.jsx L85-116)
 * **不**過濾 vehicle(design harness 用 mock 資料、cascade 選單只變標題不過濾 = 線上 #152 bug);
 * 本實作接真 fitment(每日同步自報價單、車種鐵律 fitment_parsed 直出)後補上此過濾、關閉 #152。
 * 車輛清單來源見 `@/lib/vehicle-taxonomy`(同源於 fitment、名稱精準吻合、無大小寫落差)。
 *
 * **不依 cascade.category 過濾**(對齊 design;全站單一分類「碳纖維部品」、分類樹無意義 → #152 剩餘、
 * 多分類上架後再議);design filterProducts 同樣不過濾 category。
 *
 * @param products 商品來源清單
 * @param cascade  階層篩選狀態(本函式用 brands + vehicle;category 不參與)
 * @param extras   價格 / 顏色 / 旗標篩選
 * @param brands   品牌對照表(id → name 解析用)
 */
/**
 * 車輛比對:商品某條 fitment 命中所選「品牌(→車型→年份)」才算適用。
 * 逐層漸進:只選品牌→品牌相符;+車型→品牌+車型;+年份→該車型 fitment 年份範圍涵蓋所選年。
 * 名稱 trim 後直接相等(清單端 vehicle-taxonomy 以 trim 後字串建節點、比對端同 trim = 兩端對稱;
 * 大小寫不做正規化、與清單同源故一致);年份三態同 vehicle-taxonomy 展開規則:
 *   yearEnd undefined=單年 / null=開放式(僅需 ≥yearStart) / number=明確範圍。
 * yearStart 缺(無年份資訊)時、選了年份即不命中(該 fitment 未貢獻任何可選年)。
 * 🔴 語意分歧揭示(待 Sean 拍板):domain matchFitmentYear(adapters/helpers/fitment.ts)對缺年
 * fitment 語意=「無年份限制、全命中」、與本處相反;本處採保守排除(選了年只信有年資料)。
 * 真資料 546/3484 fitment(15.7%)缺年、37/94 車型全缺年 → 影響非邊角、拍板後統一兩處。
 * 同理「無 fitments 商品」(通用款、現僅 1 件)選車後一律排除。
 */
function matchesVehicle(
  product: MockProduct,
  vehicle: NonNullable<CascadeFilterState['vehicle']>,
): boolean {
  return (product.fitments ?? []).some((f) => {
    if (f.motoBrand?.trim() !== vehicle.brand) return false;
    if (vehicle.model != null && f.modelCode?.trim() !== vehicle.model) return false;
    if (vehicle.year != null) {
      const ys = f.yearStart;
      if (typeof ys !== 'number' || vehicle.year < ys) return false;
      if (f.yearEnd === undefined) return vehicle.year === ys; // 單年
      if (f.yearEnd !== null && vehicle.year > f.yearEnd) return false; // 明確範圍上界(null=開放式不設上界)
    }
    return true;
  });
}

export function filterProducts(
  products: MockProduct[],
  cascade: CascadeFilterState,
  extras: ProductExtraFilters,
  brands: MockBrand[],
): MockProduct[] {
  const selectedBrandNames = cascade.brands.map(
    (id) => brands.find((b) => b.id === id)?.name.toLowerCase() ?? '',
  );
  return products.filter((p) => {
    if (cascade.vehicle && !matchesVehicle(p, cascade.vehicle)) return false;
    if (selectedBrandNames.length && !selectedBrandNames.includes(p.brand.toLowerCase())) {
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
