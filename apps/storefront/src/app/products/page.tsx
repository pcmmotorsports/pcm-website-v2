// app/products/page.tsx — 商品列表頁 route(M-1-12b)
//
// /products 對齊 Header navItem「商品目錄」(href: /products)+ HomeFooter 連結。
// 實際版面 / 篩選 / 商品 grid 由 client 元件 ProductsPage 負責。
//
// S1 變體補足(2026-07-12):車款篩選下推 DB —— URL 有車輛參數(短版 ?vehicle= / 長版
// ?brand=&model=)→ server 走 fetchProductsByVehicle(RPC = product_fitments ∪
// product_fitments_effective 去重,繼承件也命中、MT-09 SP 2021 實測 74→124);無 → 全目錄
// fetchCatalogProducts。slug→原始名解析與 PDP 同源(fetchVehicleTaxonomy + parseVehicleFromUrl、
// id 空間一致);client 端 vehicle 過濾同步移除(F4:client 只認 direct、會濾掉繼承命中)。
// 車輛下拉清單(motoBrands)改由本 route 傳 prop:products 現在可能是「已按車過濾」子集、
// 不能再用 buildVehicleTaxonomy(products) 衍生(選了車後下拉會塌縮成只剩該車)。

import type { Metadata } from 'next';
import { ProductsPage } from '@/components/ProductsPage';
import {
  fetchCatalogProducts,
  fetchCategories,
  fetchProductsByVehicle,
  fetchVehicleTaxonomy,
} from '@/lib/products';
import { parseVehicleFromUrl } from '@/lib/vehicle-url';

// useSearchParams 在 client component 需 route 端標 dynamic、否則 production build 報
// Static Generation 錯;對齊首頁 page.tsx L31-34 既有慣例(Phase 1 dev 真資料動態)。
// #220:本 route server 端撈真目錄 → 傳 client ProductsPage(對齊詳情頁/首頁 server-fetch→client)。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '商品目錄 — PCM Motorsports',
  description: '高端機車零件選品 · 依車款 / 分類 / 品牌篩選',
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProductsRoute({ searchParams }: Props) {
  // searchParams shim(對齊 PDP route 既有 idiom:重複參數取首值)
  const sp = await searchParams;
  const spGet = (name: string): string | null => {
    const v = sp[name];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v[0] ?? null;
    return null;
  };
  // 短版 ?vehicle= 或長版 ?brand=&model=(?brand= 單獨=商品品牌 filter 語意、不當車輛;
  // 對齊 PDP route hasVehicleParam 判準)。⚠️ 例外:品牌-only 車輛選擇由 client 同步寫短版
  // ?vehicle=brandId(單段),仍走短版分支、長版不支援品牌-only(歷史書籤語意不變)。
  const hasVehicleParam =
    spGet('vehicle') != null || (spGet('brand') != null && spGet('model') != null);

  // 車輛下拉清單:恆撈全目錄 taxonomy(unstable_cache 900s、輕量 fitments 投影),
  // 兼作 URL slug→原始名對照表(與 client deep-link restore 同一份、id 空間一致)。
  const motoBrands = await fetchVehicleTaxonomy();
  const vehicle = hasVehicleParam ? parseVehicleFromUrl({ get: spGet }, motoBrands) : null;

  // 🔴 fetchCatalogProducts / fetchProductsByVehicle 內部釘 'general'(經銷價零外洩;見 lib/products)。
  // C2:分類樹 server 端撈真資料、與商品並行 fetch;side/top/drawer 側欄共用。
  const [{ products, error }, categories] = await Promise.all([
    vehicle ? fetchProductsByVehicle(vehicle) : fetchCatalogProducts(),
    fetchCategories(),
  ]);
  return (
    <ProductsPage
      products={products}
      error={error}
      categories={categories}
      motoBrands={motoBrands}
    />
  );
}
