// vehicle-url.ts — URL vehicle 參數解析(純函式、無 React hooks)。
//
// 🔴 R3 抽出理由:parseVehicleFromUrl 原在 components/products-url-state.tsx,但該檔含 React hooks
//   (useState/useEffect)、無 'use client' directive;商品詳情頁 route(Server Component)需 server 端
//   解 ?vehicle slug→原始名(推薦引擎 Case A),import 含 hooks 的模組進 Server Component 會被 Next
//   擋(「hooks 只能在 Client Component」)。故把純解析邏輯搬到本無 hooks 模組,client(products-url-state
//   內部 hook)與 server(詳情頁 route)共用同一份=id 空間一致(對齊 buildVehicleTaxonomy 共用精神)。
//   邏輯自 products-url-state.tsx 原樣搬入、零動。

import type { MockMotoBrand } from '@/data/mock-moto-brands';

/** 只認 name/value 讀取介面(相容 ReadonlyURLSearchParams、URLSearchParams 與 route 的 shim) */
export type SearchParamsLike = { get(name: string): string | null };

// 解析 URL vehicle 參數 → VehicleSelection(name-based、對齊 reducer 介面;#6 拆檔時自
// ProductsPage.tsx 原樣搬入、邏輯零動)
// Q1=C 雙格式:短版 ?vehicle=brandId:modelId[:year] 優先、長版 ?brand=&model=&year= fallback
// S2(2026-07-03)起 VehicleFinder 亦改 push 短版(id 空間統一衍生清單)→ 站內兩個
// producer(ProductCard href / VehicleFinder)皆短版;長版分支僅吸收書籤舊連結、可日後刪。
export function parseVehicleFromUrl(
  searchParams: SearchParamsLike,
  motoBrands: MockMotoBrand[],
): { brand: string; model?: string; year?: number } | null {
  const v = searchParams.get('vehicle');
  let brandId: string | null = null;
  let modelId: string | null = null;
  let yearStr: string | null = null;
  if (v) {
    const parts = v.split(':');
    brandId = parts[0] || null;
    modelId = parts[1] || null;
    yearStr = parts[2] || null;
  } else {
    brandId = searchParams.get('brand');
    modelId = searchParams.get('model');
    yearStr = searchParams.get('year');
  }
  if (!brandId) return null;
  const brandObj = motoBrands.find((b) => b.id === brandId);
  if (!brandObj) return null;
  const modelObj = modelId
    ? brandObj.models?.find((m) => m.id === modelId)
    : null;
  const year = yearStr ? Number.parseInt(yearStr, 10) : undefined;
  return {
    brand: brandObj.name,
    model: modelObj?.name,
    year: year != null && Number.isFinite(year) ? year : undefined,
  };
}

/**
 * URL → 車輛短版 slug 參數字串(`brandId:modelId[:year]`),供「查看全部相容商品」CTA 連車輛 filter。
 *
 * 短版 `?vehicle=` 優先、否則由長版 `?brand=&model=(&year=)` 合成短版(codex R3 r2:長版書籤 Case A 的
 * CTA 不可退成商品品牌 filter=文案「相容」卻連品牌 filter 誤導)。需 brand+model 同在才算車輛(`?brand=`
 * 單獨=商品品牌 filter 語意、不合成)。無 → null。與 parseVehicleFromUrl 同源(brandId/modelId 為 URL slug id)。
 */
export function vehicleUrlParam(searchParams: SearchParamsLike): string | null {
  const short = searchParams.get('vehicle');
  if (short) return short;
  const brand = searchParams.get('brand');
  const model = searchParams.get('model');
  const year = searchParams.get('year');
  if (!brand || !model) return null;
  return [brand, model, year].filter(Boolean).join(':');
}
