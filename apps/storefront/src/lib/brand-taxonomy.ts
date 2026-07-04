// brand-taxonomy.ts — 從已撈目錄商品「動態衍生」品牌側欄清單(#220c、C3 接線)
//
// 仿 vehicle-taxonomy(buildVehicleTaxonomy)/ category-taxonomy(buildCategoryTree):
// 側欄清單完全由「當下目錄商品」衍生,只列「真的有商品的品牌」(無死品牌:選了 0 結果),
// 商品匯入後自動更新、零手動維護。取代 ProductsPage 舊 `data.brands = MOCK_BRANDS`(17 家寫死、
// 選 RPM 以外 16 家 chip 靜默 0 結果 = #220c 病灶)。
//
// 回傳既有 `MockBrand[]` 型別(drop-in、篩選元件契約零改;同 buildVehicleTaxonomy 回 MockMotoBrand[]):
//   - id    = 品牌 slug(≡ 篩選 cascade.brands 存的 id、≡ MOCK_BRANDS.id;缺 brandSlug → brandToSlug(brand) 兜底)
//   - name  = 商品的 `brand` 顯示名(**必用 p.brand**:products-filter-logic filterProducts 解 id→name 後
//             與 `p.brand` 逐字比對〔大小寫不敏感〕,若改用 MOCK_BRANDS 顯示名可能與 p.brand 不同步 → 篩選失效)
//   - count = 該品牌真商品數(覆蓋 MOCK_BRANDS 的寫死 count)
//
// 🔴 顯示 metadata(country / tagline / since / hero / logo / logoBg / heroText):由 MOCK_BRANDS[slug]
//    fallback 帶入 —— curated 品牌(如 RPM CARBON)得真值、uncurated 品牌得最小 placeholder。**這些欄在
//    篩選路徑不渲染**(FilterSide / FilterDrawer / ActiveChips 只用 id / name / count,已核 filter 元件無存取),
//    僅為滿足 MockBrand 型別;真品牌 metadata 之單一真相仍為 mock-brands.ts(BrandIndex 首頁專用、
//    直接讀 MOCK_BRANDS、不吃本函式輸出),brands 表 CRUD 落地前不動(對齊「mock-brands 保留為型別/fallback」)。

import type { MockProduct } from '@/data/mock-products';
import { brandToSlug } from '@/data/mock-products';
import { MOCK_BRANDS, type MockBrand } from '@/data/mock-brands';

/** 衍生只需 brand / brandSlug 欄(server 端輕量查詢可餵、不必完整 MockProduct;ProductsPage 傳全型別自然相容)。 */
type BrandSource = Pick<MockProduct, 'brand' | 'brandSlug'>;

export function buildBrandTaxonomy(products: BrandSource[]): MockBrand[] {
  // brandSlug → { name(顯示名、取第一筆命中的 p.brand), count };以 slug 為鍵(≡ 篩選 id、≡ MOCK_BRANDS.id)。
  const groups = new Map<string, { name: string; count: number }>();
  for (const p of products) {
    const brand = p.brand?.trim();
    if (!brand) continue;
    // brandSlug 為真資料權威 id;mock/舊 fixture 省略時以 brandToSlug(brand) 兜底(與 slug 生成規則同源)。
    const slug = p.brandSlug?.trim() || brandToSlug(brand);
    if (!slug) continue;
    const g = groups.get(slug);
    if (g) {
      g.count += 1;
    } else {
      groups.set(slug, { name: brand, count: 1 });
    }
  }

  const out: MockBrand[] = [];
  for (const [slug, { name, count }] of groups) {
    const meta = MOCK_BRANDS.find((b) => b.id === slug); // curated 品牌 metadata fallback(uncurated → undefined)
    out.push({
      // 真資料(篩選實際用到的三欄):id=分組鍵、name=p.brand 比對鍵、count=真商品數
      id: slug,
      name,
      count,
      // 顯示 metadata(篩選路徑不渲染;curated 真值 / uncurated 最小 placeholder)
      country: meta?.country ?? '',
      tagline: meta?.tagline ?? '',
      since: meta?.since ?? 0,
      hero: meta?.hero ?? '',
      logo: meta?.logo ?? '',
      logoBg: meta?.logoBg ?? 'transparent',
      ...(meta?.heroText ? { heroText: meta.heroText } : {}),
    });
  }

  // name 升冪(locale 固定 'en':SSR / client 排序一致、防 hydration mismatch;同 buildVehicleTaxonomy 慣例)。
  // 中性預設,熱門/curated 排序 Sean 後續 design skill 可調。
  out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return out;
}
