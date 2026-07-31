// vehicle-facet-counts.ts — 依「已選車款」算出各分類 / 各品牌的真實件數(backlog #306)。
//
// 病灶:分類件數來自 `listCategories()`(`products_public` head:true exact count)、品牌件數來自
//   `catalog_brand_counts()` RPC —— **兩者都不吃任何車輛參數** ⇒ 選了車仍顯示全站總數。
//   實測(backlog #306):選到 198 件商品的車,分類仍顯示 2130 / 1824 / 1076。
//
// 做法 = Sean 2026-07-30 拍板 **A 案(lazy、零 migration)**:改用既有 RPC
//   `search_catalog_by_vehicle` —— 它本來就接受 `p_category` 與 `p_brand_slugs` 並回 `total`
//   (本體 `supabase/migrations/20260719150000_catalog_product_image_trim.sql:73-137`)。
//   每個分類 / 品牌各發一次 `p_limit=1` 的查詢、只讀 `total`。
//   🔴 某分類 0 件時該 RPC 回**零列** ⇒ 讀不到 total ⇒ 直接當 0(正是要在 UI 灰掉的那些)。
//
// 未採用:B 頁面載入就查(每次進商品頁多 108 個查詢、TTFB 變慢)/ C 新增 GROUP BY RPC
//   (最省但要動 DB 結構 = 鐵則 12 ③)。C 是「A 實測太慢」時的升級路徑,先量再升。
//
// 🔴 **查詢數是 108、不是 plan 寫的 31**(2026-07-31 對正式資料實測):分類 facet key
//   實際有 92 個(15 大類 + **77 子類**),plan 的「15」只數了側欄收合時看得到的大類;
//   加上 16 個品牌 = 108。子類件數在 UI 展開大類時就要顯示,故本批一次算完。
//   下一級的省法(尚未做、也不預先做)= 兩段式:先算 15 大類 + 16 品牌,展開某大類時才算它的子類。
//
// 🔴 `p_brand` 是**車輛廠牌**(對 `product_fitments.moto_brand`)、`p_brand_slugs` 才是**商品品牌**;
//   兩者同時傳 = 「這台車 × 這個商品品牌有幾件」,正是品牌面板要的數字。
// 🔴 facet 語意刻意只吃「車輛 + 該面板自己那一維」:不疊價格 / 已選分類 / 已選品牌,
//   否則客人看到的會是「在目前篩選下還剩幾件」而不是他問的「這台車在這個分類有幾件」。
//
// 併發與快取:
//   - `FACET_CONCURRENCY` 分批,避免 108 條同時開佔滿 PostgREST 連線、與真實商品查詢互搶。
//   - 包 `unstable_cache`(同 `getCatalogPageCached` 慣例、900s、tag 'catalog')⇒ 同一台車
//     **全站共用一份**,不是每位訪客各打 108 次。
//   - 任一支查詢失敗 → throw ⇒ **不進快取**(對齊 products.ts 既有紀律:一次瞬時 DB 錯誤
//     不該把壞結果鎖 15 分鐘);外層 `fetchVehicleFacetCounts` catch 回 `null`,
//     UI 退回「不顯示件數」= #306 之前的現況,不會顯示錯的數字。

import 'server-only';

import { unstable_cache } from 'next/cache';

import { createSupabaseAnonClient } from '@pcm/adapters';
import { CATALOG_REVALIDATE_SECONDS } from '@/lib/products';

/**
 * 同時在跑的 facet 查詢數上限。
 *
 * 值的來源是量的、不是猜的(2026-07-31、production build、本機打正式 Supabase、108 條查詢):
 *   併發 6  → 冷 2.83 / 3.85 / 3.57 / 3.47 s
 *   併發 16 → 冷 2.57 / 1.62 / 1.57 / 2.27 s(命中 900s 快取後一律 ~0.19 s)
 * 🔴 這組數字含本機(住家網路)到 Supabase 的往返,每條約 150ms。正式站的延遲**完全沒量過**
 *   —— 連 Vercel(`vercel.json` 釘 `sin1`)與本專案 Supabase 叢集是否同區域,repo 內都查不到出處。
 *   不得把「上線後會更快」當成已驗證結論。要再快的下一步 = 上面說的兩段式,不是繼續調高這個數。
 */
export const FACET_CONCURRENCY = 16;

/**
 * 全 process 同時允許的 fan-out(冷查)數上限;超過直接拒絕、不排隊。
 *
 * 為什麼需要:route 的三道白名單擋的是 **key 空間**不是速率,而車輛字典本來就公開
 * (首頁 VehicleFinder 整份送到瀏覽器)⇒ 合法車款可被逐一枚舉,每個都是 108 條查詢。
 * 快取只擋得住「同一台車重複問」,擋不住「一台一台換著問」。
 *
 * 🔴 **這道閘的能力邊界(不得誇大)**:它是 **per-process** 的。Vercel 會跑多個 instance
 *   ⇒ 實際上限 = 本值 × instance 數,**不是**全站硬上限;它把放大係數從「無上限」壓到
 *   「有界但未知」,不是把濫用面關掉。真正的速率限制要靠平台層(WAF / rate limit),尚未做
 *   ⇒ 已列為殘餘風險交 Sean 判斷,不自宣接受。
 * 🔴 被擋下的請求回 `null` ⇒ route 回 503 ⇒ client 維持不顯示件數(fail-safe,不顯示錯數字)。
 */
export const MAX_CONCURRENT_FANOUTS = 3;

let activeFanouts = 0;

export type FacetVehicle = { brand: string; model?: string; year?: number };

export type VehicleFacetCounts = {
  /** key = 傳給 RPC 的 p_category 字面(大類 = 大類名;子類 = `大類 · 子類`)。 */
  categories: Record<string, number>;
  /** key = 商品品牌 slug(= `catalog_brand_counts()` 的 slug、UI 的 brand.id)。 */
  brands: Record<string, number>;
};

type FacetRpcClient = {
  rpc(
    fn: 'search_catalog_by_vehicle',
    args: {
      p_brand: string;
      p_model: string | null;
      p_year: number | null;
      p_offset: number;
      p_limit: number;
      p_sort: 'recommend';
      p_category: string | null;
      p_brand_slugs: string[] | null;
      p_price_min: null;
      p_price_max: null;
    },
  ): PromiseLike<{
    data: Array<{ total: number | string | null }> | null;
    error: { message: string } | null;
  }>;
};

/**
 * 固定併發數的 map;任一項 throw → 整批 throw(第一個錯誤原樣拋出)。
 *
 * 🔴 用 `allSettled` 收尾而非 `Promise.all` 的**真正理由 = 收乾淨**:`Promise.all` 在第一個
 *   reject 的當下就往外拋,其餘 worker 仍有查詢在飛;回應都送出去了,那些查詢還在打 DB。
 *   `allSettled` 保證「拋出時所有 worker 都已停止」。
 *   ⚠️ **不是**為了避免 unhandled rejection —— `Promise.all` 本來就會對陣列裡每一個 promise
 *   掛上處理器,後續的 reject 不會變成 unhandled(2026-07-31 實測:換成 `Promise.all` 後
 *   「多支同時失敗」一樣不噴 unhandled)。原本寫在這裡的那個理由是錯的,已更正。
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  // 🔴 一旦有人失敗就停發後續:整批結果反正會被丟掉(外層 throw),
  //    DB 已經在噴錯時不該再把剩下的 100 條打完。
  let aborted = false;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      if (aborted) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await run(items[index] as T);
      } catch (err) {
        aborted = true;
        throw err;
      }
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason;
  return results;
}

/**
 * 佔一個 fan-out 名額執行;滿了直接 throw(不排隊 —— 排隊只會把壓力變成延遲)。
 * 檢查與 +1 之間沒有 await ⇒ 單執行緒下不會有兩個請求同時通過檢查。
 */
async function withFanoutSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeFanouts >= MAX_CONCURRENT_FANOUTS) {
    throw new Error(
      `facet fan-out 併發已達上限 ${MAX_CONCURRENT_FANOUTS}(本 process),本次拒絕`,
    );
  }
  activeFanouts += 1;
  try {
    return await run();
  } finally {
    activeFanouts -= 1;
  }
}

/** 單一 facet 查詢:回「這台車 × 這一維」的件數;零列 = 0 件。 */
async function countOne(
  client: FacetRpcClient,
  vehicle: FacetVehicle,
  dimension: { category?: string; brandSlug?: string },
): Promise<number> {
  const { data, error } = await client.rpc('search_catalog_by_vehicle', {
    p_brand: vehicle.brand,
    p_model: vehicle.model ?? null,
    p_year: vehicle.year ?? null,
    p_offset: 0,
    p_limit: 1,
    p_sort: 'recommend',
    p_category: dimension.category ?? null,
    // 🔴 判 `!== undefined` 而非真假值:空字串的 brand slug 若退成 `null`,RPC 會**完全不過濾品牌**
    //    ⇒ 把整台車的總件數當成那個品牌的件數(fail-open 的錯誤方向)。
    p_brand_slugs: dimension.brandSlug !== undefined ? [dimension.brandSlug] : null,
    p_price_min: null,
    p_price_max: null,
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return 0;
  const total = Number(rows[0]?.total ?? 0);
  // 🔴 NaN 防線:`total` 是 bigint 走 JSON → 字串;非數值一律當 0,不讓 NaN 流進 UI。
  return Number.isFinite(total) ? total : 0;
}

/**
 * 未快取核心(單元測試直接打這支;正式路徑走 `fetchVehicleFacetCounts`)。
 *
 * @param categoryKeys 傳給 RPC 的 `p_category` 字面清單;大類名可直接用 —— RPC 的比對是
 *   `category_raw = p_category OR category_raw LIKE p_category || ' · %'` ⇒ 大類自動涵蓋子類。
 *   🔴 「面板數字 = 點進去的件數」的保證來自**同一支 RPC 的同一個 `p_category` 運算式**
 *   (列表端 = `products.ts` 的 `queryCatalogPage`),不是來自比對邏輯抄得一樣;
 *   `products-filter-logic.matchesCategory` 已無 production 呼叫端,不得拿它當同步基準。
 */
export async function queryVehicleFacetCounts(
  vehicle: FacetVehicle,
  categoryKeys: readonly string[],
  brandSlugs: readonly string[],
): Promise<VehicleFacetCounts> {
  const client = createSupabaseAnonClient() as unknown as FacetRpcClient;
  const jobs: Array<{ kind: 'category' | 'brand'; key: string }> = [
    ...categoryKeys.map((key) => ({ kind: 'category' as const, key })),
    ...brandSlugs.map((key) => ({ kind: 'brand' as const, key })),
  ];
  const counts = await mapWithLimit(jobs, FACET_CONCURRENCY, (job) =>
    countOne(client, vehicle, job.kind === 'category' ? { category: job.key } : { brandSlug: job.key }),
  );

  const categories: Record<string, number> = {};
  const brands: Record<string, number> = {};
  jobs.forEach((job, i) => {
    const value = counts[i] ?? 0;
    if (job.kind === 'category') categories[job.key] = value;
    else brands[job.key] = value;
  });
  return { categories, brands };
}

// unstable_cache 只吃純參數:車輛壓成固定順序的三元組(物件鍵序不參與 key)、
// 兩份清單序列化後當 key 的一部分(分類/品牌清單變動 = 新 key、不會讀到少一格的舊結果)。
const getVehicleFacetCountsCached = unstable_cache(
  async (
    serializedVehicle: string,
    serializedCategoryKeys: string,
    serializedBrandSlugs: string,
  ): Promise<VehicleFacetCounts> => {
    const [brand, model, year] = JSON.parse(serializedVehicle) as [string, string | null, number | null];
    // 閘放在快取**內側**:命中快取的請求不佔名額(它一條 DB 查詢都不發)。
    return withFanoutSlot(() =>
      queryVehicleFacetCounts(
        {
          brand,
          ...(model !== null ? { model } : {}),
          ...(year !== null ? { year } : {}),
        },
        JSON.parse(serializedCategoryKeys) as string[],
        JSON.parse(serializedBrandSlugs) as string[],
      ),
    );
  },
  ['vehicle-facet-counts-v1'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog'] },
);

/**
 * 正式取數入口。失敗回 `null` —— 呼叫端(route handler → client)據此退回
 * 「選了車就不顯示件數」的現況,**絕不用全站總數頂替**(那正是 #306 要修掉的誤導)。
 */
export async function fetchVehicleFacetCounts(
  vehicle: FacetVehicle,
  categoryKeys: readonly string[],
  brandSlugs: readonly string[],
): Promise<VehicleFacetCounts | null> {
  try {
    return await getVehicleFacetCountsCached(
      JSON.stringify([vehicle.brand, vehicle.model ?? null, vehicle.year ?? null]),
      JSON.stringify(categoryKeys),
      JSON.stringify(brandSlugs),
    );
  } catch (err) {
    console.error('[fetchVehicleFacetCounts] search_catalog_by_vehicle facet fan-out failed:', err);
    return null;
  }
}
