// vehicle-facet-counts.ts — 目錄頁側欄的真實件數(backlog #306 起;2026-09-12 改一發 GROUP BY)。
//
// 病灶(#306):分類件數來自 `listCategories()`、品牌件數來自 `catalog_brand_counts()` RPC ——
//   兩者都是全站總數 ⇒ 選了車 / 選了品牌 / 選了分類,側欄仍顯示全站數。
//
// ⛔ ~~每個分類 / 品牌各發一次 `search_catalog_by_vehicle(p_limit=1)` 讀 total,共 108 發~~
//   (Sean 2026-07-30 拍 A 案;整段實作與量測在 git 歷史:`git log -p -- apps/storefront/src/lib/vehicle-facet-counts.ts`)
//   那一版只吃「車 + 自己那一維」,不疊已選品牌 / 分類 ⇒ Sean 2026-09-12 在 www 選「外觀與後視鏡」
//   + 「EAZI-GRIP」⇒ 右邊 0 件、左邊仍是 3887。原話「我以為會跟我們選車種的方式一樣」。
// ✅ 現在 = Sean 2026-09-12 拍乙:一發 `catalog_facet_counts`(migration `20260912010000`),
//   plan `docs/plans/2026-09-12-facet-counts-groupby-rpc-plan.md`。
//   語意:分類面板 = 車 ∧ 已選品牌;品牌面板 = 車 ∧ 已選分類(各面板不疊自己那一維)。
//   不疊價格(Sean 09-12 拍甲)、不疊關鍵字 / 新品(那兩種情況前端根本不印件數)。
//
// 🔴 「面板數字 = 點進去的件數」的保證來自**兩支函式抄同一組述詞**,由三道釘住:
//   `scripts/20260912010000-verify.sh`(拋棄式 PG 對照 + 突變)· `facet-predicate-parity.test.ts`
//   (靜態比對兩支最新定義)· migration 尾段的行為閘(正式資料逐格比對)。
//
// 快取與節流:
//   - 包 `unstable_cache`(60s、tag 'catalog'),key 帶車 + 兩份清單 + 兩份已選。
//   - `unstable_cache` 不是 single-flight(codex 關卡2 C3)⇒ 保留 process 內 `inFlight` map。
//   - 失敗 → throw ⇒ 不進快取;外層 catch 回 `null` ⇒ route 503 ⇒ 前端不顯示件數(fail-safe)。

import 'server-only';

import { unstable_cache } from 'next/cache';

import { createSupabaseAnonClient } from '@pcm/adapters';
import { CATALOG_REVALIDATE_SECONDS } from '@/lib/products';

/**
 * 全 process 同時允許的冷查數上限;超過直接拒絕、不排隊。
 *
 * 為什麼需要:route 的白名單擋的是 **key 空間**不是速率,而車輛字典 / 品牌 / 分類都是公開的
 * ⇒ 合法組合可被逐一枚舉。快取只擋得住「同一組重複問」。
 * 🔴 **per-process**:實際上限 = 本值 × instance 數,不是全站硬上限;真正的速率限制要靠平台層(未做)。
 * 🔵 2026-09-12 起一次冷查 = 一發 RPC(以前是 108 發)⇒ 同一個值的保護力變寬鬆了;
 *   要不要調整另議(plan 1c 明寫不在本片調)。
 */
export const MAX_CONCURRENT_FANOUTS = 3;

let activeFanouts = 0;

export type FacetVehicle = { brand: string; model?: string; year?: number };
/** 客人已選的篩選;route 已過白名單(品牌必須在品牌表、分類必須在分類樹)。 */
export type FacetSelection = { categories: readonly string[]; brandSlugs: readonly string[] };

// 🔴 型別單一定義點在 client 側的 `vehicle-facet-display`(審查 n5)。`import type` 會被 TS 抹掉。
export type { VehicleFacetCounts } from '@/lib/vehicle-facet-display';
import type { VehicleFacetCounts } from '@/lib/vehicle-facet-display';

type FacetRpcClient = {
  rpc(
    fn: 'catalog_facet_counts',
    args: {
      p_category_keys: string[];
      p_brand_keys: string[];
      p_brand: string | null;
      p_model: string | null;
      p_year: number | null;
      p_selected_categories: string[];
      p_selected_brand_slugs: string[];
    },
  ): PromiseLike<{
    data: Array<{ facet: string; key: string; n: number | string | null }> | null;
    error: { message: string } | null;
  }>;
};

/**
 * 查詢逾時上限(毫秒)。
 *
 * 🔴 存在理由 = **保證名額一定歸還**(codex 關卡2 C6):RPC 永遠不 settle ⇒ `finally` 不跑 ⇒
 *   名額被永久佔住 ⇒ 該 process 之後全部 503。
 *   ⚠️ 它**不會取消已經發出去的查詢**(supabase-js 需另接 `AbortSignal`,未做)。
 *   🔴 **真正先到的是 DB 那一道**:正式庫 anon `statement_timeout = 3s`(`retry-on-statement-timeout.ts:4`
 *     的 pg_roles 讀數)。有車只選 Ducati 的最壞實量 3,959.8 ms(2026-09-12 唯讀 EXPLAIN ANALYZE,
 *     部分冷快取)⇒ **那一格會被 DB 砍掉(57014)⇒ 503 ⇒ 件數不顯示**(fail-safe,不會印錯)。
 *     舊的 108 發在同一台車上每一發都付同一段 matched,一樣撞這道 ⇒ 不是本片變差;慢的是 matched 本身(另一題)。
 */
const FACET_QUERY_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`facet 查詢逾時 ${FACET_QUERY_TIMEOUT_MS}ms:${label}`)),
      FACET_QUERY_TIMEOUT_MS,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 佔一個名額執行;滿了直接 throw(不排隊 —— 排隊只會把壓力變成延遲)。
 * 檢查與 +1 之間沒有 await ⇒ 單執行緒下不會有兩個請求同時通過檢查。
 */
async function withFanoutSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeFanouts >= MAX_CONCURRENT_FANOUTS) {
    throw new Error(`facet 查詢併發已達上限 ${MAX_CONCURRENT_FANOUTS}(本 process),本次拒絕`);
  }
  activeFanouts += 1;
  try {
    return await run();
  } finally {
    activeFanouts -= 1;
  }
}

/**
 * 未快取核心(單元測試直接打這支;正式路徑走 `fetchFacetCounts`)。
 *
 * @param vehicle `null` = 沒選車(RPC 走全目錄)。
 * @param categoryKeys 要算的分類 key(大類名 + `大類 · 子類`);RPC 的比對是
 *   `category_raw = k OR category_raw LIKE k || ' · %'` ⇒ 大類自動涵蓋子類。
 */
export async function queryFacetCounts(
  vehicle: FacetVehicle | null,
  categoryKeys: readonly string[],
  brandSlugs: readonly string[],
  selection: FacetSelection,
): Promise<VehicleFacetCounts> {
  const client = createSupabaseAnonClient() as unknown as FacetRpcClient;
  const { data, error } = await withTimeout(
    client.rpc('catalog_facet_counts', {
      p_category_keys: [...categoryKeys],
      p_brand_keys: [...brandSlugs],
      p_brand: vehicle?.brand ?? null,
      p_model: vehicle?.model ?? null,
      p_year: vehicle?.year ?? null,
      // 🔵 空陣列 = 不過濾(RPC 判 cardinality = 0),與列表那支同一個語意
      p_selected_categories: [...selection.categories],
      p_selected_brand_slugs: [...selection.brandSlugs],
    }),
    'catalog_facet_counts',
  );
  if (error) throw new Error(error.message);

  const categories: Record<string, number> = {};
  const brands: Record<string, number> = {};
  for (const row of data ?? []) {
    const n = Number(row.n ?? 0);
    // 🔴 NaN 防線:bigint 可能以字串回來;非數值一律當 0,不讓 NaN 流進 UI。
    const value = Number.isFinite(n) ? n : 0;
    if (row.facet === 'category') categories[row.key] = value;
    else if (row.facet === 'brand') brands[row.key] = value;
  }
  // 🔴 沒回來的 key 不補 0:那是「算不出來」(例如空白 key),前端要當「沒有數字」而不是灰掉。
  return { categories, brands };
}

// unstable_cache 只吃純參數:車壓成固定順序的三元組、四份清單各自序列化。
const getFacetCountsCached = unstable_cache(
  async (
    serializedVehicle: string,
    serializedCategoryKeys: string,
    serializedBrandSlugs: string,
    serializedSelectedCategories: string,
    serializedSelectedBrandSlugs: string,
  ): Promise<VehicleFacetCounts> => {
    const parsed = JSON.parse(serializedVehicle) as [string, string | null, number | null] | null;
    const vehicle: FacetVehicle | null = parsed
      ? {
          brand: parsed[0],
          ...(parsed[1] !== null ? { model: parsed[1] } : {}),
          ...(parsed[2] !== null ? { year: parsed[2] } : {}),
        }
      : null;
    // 閘放在快取**內側**:命中快取的請求不佔名額(它一條 DB 查詢都不發)。
    return withFanoutSlot(() =>
      queryFacetCounts(
        vehicle,
        JSON.parse(serializedCategoryKeys) as string[],
        JSON.parse(serializedBrandSlugs) as string[],
        {
          categories: JSON.parse(serializedSelectedCategories) as string[],
          brandSlugs: JSON.parse(serializedSelectedBrandSlugs) as string[],
        },
      ),
    );
  },
  // 🔵 key 前綴換版:回傳語意變了(會疊已選),不得讀到 v1 的舊結果
  ['catalog-facet-counts-v2'],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ['catalog'] },
);

/** process 內 single-flight:同一組參數同時來多個 request 只跑一次(codex C3)。 */
const inFlight = new Map<string, Promise<VehicleFacetCounts>>();

/**
 * 正式取數入口。失敗回 `null` —— route 據此回 503,前端退回「不顯示件數」,
 * **絕不用全站總數頂替**(那正是 #306 要修掉的誤導)。
 */
export async function fetchFacetCounts(
  vehicle: FacetVehicle | null,
  categoryKeys: readonly string[],
  brandSlugs: readonly string[],
  selection: FacetSelection,
): Promise<VehicleFacetCounts | null> {
  const serializedVehicle = JSON.stringify(
    vehicle ? [vehicle.brand, vehicle.model ?? null, vehicle.year ?? null] : null,
  );
  const serializedCategoryKeys = JSON.stringify(categoryKeys);
  const serializedBrandSlugs = JSON.stringify(brandSlugs);
  // 已選的順序對結果零意義 ⇒ 排序後才當 key(同一組篩選不同點法共用一份快取)
  const serializedSelectedCategories = JSON.stringify([...selection.categories].sort());
  const serializedSelectedBrandSlugs = JSON.stringify([...selection.brandSlugs].sort());
  const key = [
    serializedVehicle,
    serializedCategoryKeys,
    serializedBrandSlugs,
    serializedSelectedCategories,
    serializedSelectedBrandSlugs,
  ].join('|');
  try {
    let pending = inFlight.get(key);
    if (!pending) {
      pending = getFacetCountsCached(
        serializedVehicle,
        serializedCategoryKeys,
        serializedBrandSlugs,
        serializedSelectedCategories,
        serializedSelectedBrandSlugs,
      ).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }
    return await pending;
  } catch (err) {
    console.error('[fetchFacetCounts] catalog_facet_counts failed:', err);
    return null;
  }
}
