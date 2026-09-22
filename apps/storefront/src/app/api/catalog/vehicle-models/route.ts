// app/api/catalog/vehicle-models/route.ts — 一個廠牌底下的車款 + 年份(plan
// `docs/plans/2026-09-14-products-payload-vehicle-tree-on-demand-plan.md` P1)。
//
// 為什麼要有這支 route:`/products` 今天把整棵車款樹(66 牌 / 3,824 款 / 12,335 列,約 464KB)
//   當 prop 送給 client component ⇒ 整棵進 HTML。客人第一屏只需要牌子清單;車款與年份
//   **選了牌子才要、而且一次只要一個牌子的**。這支就是「選了牌子再抓」的那個入口。
//
// 唯讀、無 auth、零寫入。
//   ⛔ ~~零新 DB 查詢:資料就是 `fetchVehicleTaxonomy()` 那一份(`unstable_cache` 3600s,0911 Q1 乙那顆),這裡只切一個牌子出來。~~
//   🔵 2026-09-22 ⟦db-TAXONOMYVIEW⟧ 接線片起:牌子查底盤樹(`get_vehicle_taxonomy_base`), 年份查
//   `get_vehicle_model_years(牌子)` 一個牌子一發;兩者都是 `unstable_cache` 3600s。年份失敗 ⇒ 退回舊的完整樹。
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

import { fetchModelsWithYearsOrFull, fetchVehicleTaxonomyBase } from '@/lib/products';
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

  // 🔵 2026-09-22 ⟦db-TAXONOMYVIEW⟧ 接線片:牌子 id 用【底盤樹】查 —— 與 `/products` 送出去的
  //   瘦身樹同一份來源, id 空間一致(撞名序號依排序而定, 兩邊要同源才不會對錯牌子)。
  let motoBrands: Awaited<ReturnType<typeof fetchVehicleTaxonomyBase>>;
  try {
    motoBrands = await fetchVehicleTaxonomyBase();
  } catch (err) {
    console.error('[vehicle-models] 車輛字典讀取 throw:', err);
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }
  // 空字典要當「這次查不到」,不能當「沒有牌子」。
  if (motoBrands.length === 0) {
    console.error('[vehicle-models] 車輛字典為空(視為讀取失敗)');
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }

  const brand = motoBrands.find((b) => b.id === brandId);
  if (!brand) {
    return NextResponse.json({ error: 'brand_not_found' }, { status: 404, headers: NO_STORE });
  }

  // 年份:`fetchModelsWithYearsOrFull`(K<M 對帳;失敗 ⇒ 退回舊的完整樹, 同樣過對帳)。
  // 🔴 **退回那份也要過同一道對帳**(Codex 接線片 R1 MF-3):舊樹是另一把快取, 可能比底盤舊、少幾款;
  //   不對帳就會帶著 s-maxage 把縮水的清單交給 CDN 留一小時。兩條都拿不到完整年份 ⇒ 503 no-store。
  let models: MockMotoModel[];
  try {
    models = await fetchModelsWithYearsOrFull(brand);
  } catch (err) {
    console.error('[vehicle-models] 完整車款樹也無法提供完整年份:', err);
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }

  const body: VehicleModelsResponse = { brandId: brand.id, models };
  return NextResponse.json(body, { status: 200, headers: CDN_CACHE });
}
