// app/api/catalog/facet-counts/route.ts — 「已選車款 × 各分類 / 各品牌」件數(backlog #306)。
//
// 為什麼要有這支 route:件數目前是 `/products` 的 server props 一次帶下來的,面板內沒有取數管道;
//   而 Sean 拍板 A 案 = 選好車才算(不拖慢 `/products` 首次載入)⇒ client 需要一個能事後問的入口。
//
// 唯讀、無 auth、零寫入:只回計數,不回任何商品欄位、不碰價格 / tier / 訂單。
//   資料面等同已公開的 `search_catalog_by_vehicle`(SECURITY INVOKER + `products_list_public`),
//   本 route 不會讓客人看到他原本看不到的東西。
//
// 🔴 車輛參數三道白名單(公開端點、**放大係數 108**〔實測,見 vehicle-facet-counts.ts 檔頭〕
//   ⇒ 不可讓人隨手枚舉):
//   ① `parseCatalogQuery` 的 SAFE_VEHICLE 形狀白名單(既有、與 `/products` 同一支)
//   ② `parseVehicleFromUrl` 必須在真車輛字典裡找到該廠牌(+ 有給車型時必須找到車型)
//   ③ 年份必須落在該車型字典裡的年份清單(UI 的年份下拉就是由這份清單長出來的)
//   任一不過 → 400,client 端退回「不顯示件數」= #306 之前的現況(fail-safe,不顯示錯數字)。
//   🔴 **這三道擋的是 key 空間、不是速率**:車輛字典本來就會整份送到瀏覽器(首頁 VehicleFinder)
//   ⇒ 合法 key 全集是公開的、可被逐一枚舉。速率面的節流在 `vehicle-facet-counts.ts` 的
//   fan-out 閘(`MAX_CONCURRENT_FANOUTS`),且那道閘**只在單一 process 內有效**(見該檔說明)。
//
// 🔴 上游字典失敗一律 503、不得回 200 半套:`fetchCategories` / `fetchCatalogBrandTaxonomy` /
//   `fetchVehicleTaxonomy` 三支都是**自己 catch 掉回 `[]`**(products.ts)⇒ 一次瞬時 DB 錯
//   若照著往下跑,會回一份「分類全空」的成功結果,而 #306-b 依 Sean Q2=A 會把整個分類面板
//   灰掉且點不下去。空字典 ≠ 沒有分類,是「這次查不到」。

import { NextResponse } from 'next/server';

import { parseCatalogQuery, isSafeCategoryValue } from '@/lib/catalog-query';
import { parseVehicleFromUrl } from '@/lib/vehicle-url';
import { fetchCategories, fetchCatalogBrandTaxonomy, fetchVehicleTaxonomy } from '@/lib/products';
import { fetchVehicleFacetCounts } from '@/lib/vehicle-facet-counts';
import { CATEGORY_PATH_SEP } from '@/components/products-filter-logic';
import type { MockCategory } from '@/data/mock-categories';

// 件數隨每日目錄同步變動;server 端已有 900s 的 unstable_cache,瀏覽器不再另外存一份
// (否則同一台車在 CDN / browser 各留一份過期值、與商品頁對不起來)。
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * 分類樹 → 傳給 RPC 的 `p_category` 字面清單(大類名 + `大類 · 子類`)。
 *
 * 🔴 過 `isSafeCategoryValue` 同一道白名單:算得出來但點不進去的數字比沒有數字更糟
 *   (點擊端 `parseCatalogQuery` 會把同一個值丟掉 ⇒ 客人看到未過濾的整頁)。
 *   被濾掉的分類不會有 key ⇒ #306-b 對它就是「沒有數字」,不會顯示錯的。
 */
export function categoryFacetKeys(categories: MockCategory[]): string[] {
  return categories
    .flatMap((c) => [c.name, ...c.children.map((s) => `${c.name}${CATEGORY_PATH_SEP}${s.name}`)])
    .filter(isSafeCategoryValue);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // ① 形狀白名單(與 /products 同一支 parser;不認得的值一律被丟掉)
  const vehicleSlug = parseCatalogQuery(url.searchParams).vehicle;
  if (!vehicleSlug) {
    return NextResponse.json({ error: 'invalid_vehicle' }, { status: 400, headers: NO_STORE });
  }

  // 🔴 **先只讀車輛字典、驗完三道白名單,才去讀分類與品牌**(codex 關卡2 C5):
  //    原本三支並行讀 ⇒ 任何「形狀合法但不存在」的車款都能反覆觸發全站品牌聚合,
  //    白名單擋得住 fan-out、擋不住這兩支。
  // 🔴 這幾支「看起來」都自己 catch 掉了,但它們的 `createSupabaseAnonClient()` 寫在 try **外面**
  //    (`products.ts`)⇒ 環境變數缺漏時是**未捕捉的 throw**、直接 500、繞過 503 守門
  //    (2026-07-31 在沒有憑證的 worktree 實跑到 `NEXT_PUBLIC_SUPABASE_URL not set`)。
  let motoBrands: Awaited<ReturnType<typeof fetchVehicleTaxonomy>>;
  try {
    motoBrands = await fetchVehicleTaxonomy();
  } catch (err) {
    console.error('[facet-counts] 車輛字典讀取 throw:', err);
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }
  // 空陣列 = 這次讀不到(三支上游都吞錯回 `[]`),必須排在白名單比對**之前**:
  // 否則會被回報成 400 unknown_vehicle(永久錯誤語意)、client 不知道該重試。
  if (motoBrands.length === 0) {
    console.error('[facet-counts] 車輛字典為空(視為讀取失敗)');
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }

  // ② 字典白名單:廠牌(與車型,若有給)必須真的存在
  const vehicle = parseVehicleFromUrl(
    { get: (name) => (name === 'vehicle' ? vehicleSlug : null) },
    motoBrands,
  );
  if (!vehicle) {
    return NextResponse.json({ error: 'unknown_vehicle' }, { status: 400, headers: NO_STORE });
  }
  const [brandId, modelId, yearRaw] = vehicleSlug.split(':');
  if (modelId && vehicle.model === undefined) {
    // slug 有第二段但字典查無該車型 ⇒ parseVehicleFromUrl 會靜默退成「只有廠牌」,
    // 那會回一組「整個廠牌」的件數、與客人選的車不符 ⇒ 寧可 400。
    return NextResponse.json({ error: 'unknown_model' }, { status: 400, headers: NO_STORE });
  }
  // ③ 年份白名單:必須是該車型字典裡真的有的年份(擋年份枚舉放大)
  if (yearRaw) {
    // 用 slug 的 id 查(與 parseVehicleFromUrl 同一組鍵);名稱可能重複、id 才是唯一鍵。
    const years =
      motoBrands.find((b) => b.id === brandId)?.models?.find((m) => m.id === modelId)?.years ?? [];
    if (vehicle.year === undefined || !years.includes(vehicle.year)) {
      return NextResponse.json({ error: 'unknown_year' }, { status: 400, headers: NO_STORE });
    }
  }

  // 車輛確定合法之後,才讀分類與品牌(兩者都是全站聚合、都已包 900s + catalog tag)
  let categories, brands;
  try {
    [categories, brands] = await Promise.all([fetchCategories(), fetchCatalogBrandTaxonomy()]);
  } catch (err) {
    console.error('[facet-counts] 分類 / 品牌 taxonomy 讀取 throw:', err);
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }
  if (categories.length === 0 || brands.length === 0) {
    console.error('[facet-counts] 分類 / 品牌 taxonomy 為空(視為讀取失敗):', {
      categories: categories.length,
      brands: brands.length,
    });
    return NextResponse.json({ error: 'taxonomy_unavailable' }, { status: 503, headers: NO_STORE });
  }

  const counts = await fetchVehicleFacetCounts(
    vehicle,
    categoryFacetKeys(categories),
    brands.map((b) => b.id),
  );
  if (!counts) {
    // fan-out 失敗(已在 lib 層 console.error)⇒ 明確告訴 client「這次算不出來」,
    // 由它維持不顯示件數,不得退回全站總數頂替。
    return NextResponse.json({ error: 'facet_counts_unavailable' }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(counts, { headers: NO_STORE });
}
