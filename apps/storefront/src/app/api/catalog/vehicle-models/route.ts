// app/api/catalog/vehicle-models/route.ts — 一個廠牌底下的車款 + 年份(plan
// `docs/plans/2026-09-14-products-payload-vehicle-tree-on-demand-plan.md` P1)。
//
// 為什麼要有這支 route:`/products` 今天把整棵車款樹(66 牌 / 3,824 款 / 12,335 列,約 464KB)
//   當 prop 送給 client component ⇒ 整棵進 HTML。客人第一屏只需要牌子清單;車款與年份
//   **選了牌子才要、而且一次只要一個牌子的**。這支就是「選了牌子再抓」的那個入口。
//
// 唯讀、無 auth、零寫入、零新 DB 查詢:資料就是 `fetchVehicleTaxonomy()` 那一份
//   (`unstable_cache` 3600s,0911 Q1 乙那顆),這裡只切一個牌子出來。
//   ⇒ 資料更新節奏一個字沒變(還是那個 TTL、還是隔天生效);本 route 只改「送多少到瀏覽器」。
//
// 🔴 `brand` 參數過 SAFE_SLUG 形狀白名單 + 必須在字典裡找到(公開端點,不讓亂字串進來);
//   形狀不合 400、找不到 404、字典讀不到 503 —— 三種世界三個碼,client 端分得開
//   (404 = 真的沒這牌子;503 = 這次查不到,要走 `VehicleTaxonomyNotice` 那扇門)。
//
// 🔴 `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`:
//   s-maxage 與 `VEHICLE_TAXONOMY_REVALIDATE_SECONDS`(3600)對齊 ⇒ CDN 那層不會比 server
//   那層更舊;66 個牌子 = 66 個 URL,CDN 擋掉重複請求。
//   ⚠️ 404 / 503 一律 `no-store` —— 一次瞬時 DB 錯不能被 CDN 記住一小時。

import { NextResponse } from 'next/server';

import { fetchVehicleTaxonomy } from '@/lib/products';
import { VEHICLE_TAXONOMY_REVALIDATE_SECONDS } from '@/lib/products';
import type { MockMotoModel } from '@/data/mock-moto-brands';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const CDN_CACHE = {
  'Cache-Control': `public, s-maxage=${VEHICLE_TAXONOMY_REVALIDATE_SECONDS}, stale-while-revalidate=86400`,
} as const;

// 與 `lib/catalog-query.ts` 的 SAFE_SLUG 同一個形狀(小寫英數 + 連字號),牌子 id 就是這種 slug。
const SAFE_BRAND_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type VehicleModelsResponse = { brandId: string; models: MockMotoModel[] };

export async function GET(request: Request) {
  const brandId = new URL(request.url).searchParams.get('brand');
  if (!brandId || !SAFE_BRAND_ID.test(brandId)) {
    return NextResponse.json({ error: 'invalid_brand' }, { status: 400, headers: NO_STORE });
  }

  let motoBrands: Awaited<ReturnType<typeof fetchVehicleTaxonomy>>;
  try {
    motoBrands = await fetchVehicleTaxonomy();
  } catch (err) {
    console.error('[vehicle-models] 車輛字典讀取 throw:', err);
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }
  // `tryVehicleTaxonomy` 失敗時回 `[]` 不 throw ⇒ 空字典要當「這次查不到」,不能當「沒有牌子」。
  if (motoBrands.length === 0) {
    console.error('[vehicle-models] 車輛字典為空(視為讀取失敗)');
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }

  const brand = motoBrands.find((b) => b.id === brandId);
  if (!brand) {
    return NextResponse.json({ error: 'brand_not_found' }, { status: 404, headers: NO_STORE });
  }

  const body: VehicleModelsResponse = { brandId: brand.id, models: brand.models };
  return NextResponse.json(body, { status: 200, headers: CDN_CACHE });
}
