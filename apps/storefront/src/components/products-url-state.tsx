// products-url-state.tsx — #6:/products 瀏覽狀態(page/sort/perPage)URL round-trip
//
// 拆自 ProductsPage.tsx(鐵則 6:元件檔 >400 行必拆;本檔=純 parsers + 3 hooks + parseVehicleFromUrl,無 JSX)。
// 🔴 副檔名 .tsx(非 .ts):repo eslint react-hooks plugin glob 僅掛 apps/storefront/**/*.tsx,
//    含 hook 的檔須 .tsx 才受 rules-of-hooks / exhaustive-deps 保護(#6 code-reviewer nit-1)。
//
// 背景(Sean 2026-07-03 實測回報):商品頁按上一頁回列表,頁碼/排序/每頁筆數全重置。
// 根因:三狀態原只存 useState、/products 是 force-dynamic(每次進入全新 mount)。
// 修法:mount lazy init 讀 URL(page/sort/per)→ 變動時原生 history.replaceState 回寫。
// 白名單對齊實際 UI 選項(SortBar options / Pagination per-page options),非法值回預設(fail-safe)。

import { useEffect, useState, type Dispatch, type MutableRefObject } from 'react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  selectCategoryMain,
  toggleBrand,
  type CascadeFilterAction,
} from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
// 🔴 R3:SearchParamsLike + parseVehicleFromUrl 抽到無 hooks 的 @/lib/vehicle-url(供詳情頁 Server
//   Component 共用、本檔含 hooks 不可被 server import);本檔 re-export parseVehicleFromUrl 保 back-compat。
import { parseVehicleFromUrl, type SearchParamsLike } from '@/lib/vehicle-url';
export { parseVehicleFromUrl };

export const SORT_VALUES = ['recommend', 'new', 'price-asc', 'price-desc', 'sale'] as const; // = SortBar <option>
export const PER_PAGE_VALUES = [25, 50, 75, 100] as const; // = Pagination #pp-perpage <option>
export const DEFAULT_SORT = 'recommend';
export const DEFAULT_PER_PAGE = 25;

// SearchParamsLike + parseVehicleFromUrl 已抽到 @/lib/vehicle-url(見檔頭 import;server 共用);
// 本檔內部消費者(useBrowseUrlState 等)與外部(詳情頁 route)皆吃同一份、id 空間一致。

// ── Q4-S5(2026-07-05):?category= / ?brand= 入站深連結(首頁分類卡 / 品牌牆殘廢修復)──
// 背景:design 是 SPA in-memory nav(onNav('products',{category}))、Next port 產生了
// `/products?category=` 連結但全站無人讀此 key(遷移缺口)→ 首頁分類卡點了無過濾。
// 模式對齊 vehicle:mount 讀一次 → 對照真實清單驗證(查無=fail-safe 忽略、顯全部)→ dispatch。
// 僅入站、不回寫 URL(與 vehicle 同 idiom:useBrowseUrlSync 只回寫 page/sort/per、保留外來參數)。

/** ?category= 值:分類「名稱」(raw_path、人類可讀)為主;防禦性亦接受 DB id。單層 16 大類;子類深連結留 #212。 */
export function parseCategoryFromUrl(
  searchParams: SearchParamsLike,
  categories: { id: string; name: string }[],
): { mainId: string; main: string } | null {
  const raw = searchParams.get('category');
  if (!raw) return null;
  const hit = categories.find((c) => c.name === raw || c.id === raw);
  return hit ? { mainId: hit.id, main: hit.name } : null; // 查無 → null(fail-safe、不套用)
}

/**
 * ?brand= 值:產品品牌 slug(= buildBrandTaxonomy 衍生 id,如 gb-racing/bonamici)。
 * ⚠️ 與 vehicle 長版 fallback(?brand=Yamaha&model=…)共用 key:各自對照表驗證、查無即 null。
 * 🔴 現況兩命名空間不相交(摩托車廠 id vs 產品品牌 slug),但**非結構保證**:日後多品牌若含
 *    OEM 副廠件(Yamaha/Honda 亦賣部品)、slug 'yamaha' 可能同時命中兩者 → 同一 ?brand= 雙重過濾。
 *    多品牌放量前需消歧(產品品牌深連結改獨立 key 如 ?pbrand=,或入站時 vehicle 優先互斥)。見 backlog #269。
 */
export function parseBrandFilterFromUrl(
  searchParams: SearchParamsLike,
  productBrands: { id: string }[],
): string | null {
  const raw = searchParams.get('brand');
  if (!raw) return null;
  return productBrands.some((b) => b.id === raw) ? raw : null;
}

export function parseSortParam(raw: string | null): string {
  return raw && (SORT_VALUES as readonly string[]).includes(raw) ? raw : DEFAULT_SORT;
}
export function parsePerPageParam(raw: string | null): number {
  const n = Number(raw);
  return (PER_PAGE_VALUES as readonly number[]).includes(n) ? n : DEFAULT_PER_PAGE;
}
export function parsePageParam(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  // 只驗 ≥1;超出總頁數由 ProductsPage 既有 currentPage = min(page, totalPages) 收斂、
  // useBrowseUrlSync 會自癒回寫
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * page/sort/perPage 以 URL 為初值(back / refresh / 分享還原)。
 * server render 與 client 首繪同讀 searchParams、零 hydration 分歧;之後由 useBrowseUrlSync 回寫。
 */
export function useBrowseUrlState(searchParams: SearchParamsLike) {
  const [sort, setSort] = useState(() => parseSortParam(searchParams.get('sort')));
  const [page, setPage] = useState(() => parsePageParam(searchParams.get('page')));
  const [perPage, setPerPage] = useState(() => parsePerPageParam(searchParams.get('per')));
  return { sort, setSort, page, setPage, perPage, setPerPage };
}

/**
 * 篩選 / 排序 / 每頁數變動 → 回到第 1 頁(對齊 design ProductsPage.jsx L226)。
 * #6 改「值比較 + 首輪跳過」:原版 deps 直掛 [cascade, extras, sort, perPage] 會在 mount 首輪
 * 就 setPage(1)、殺掉 URL 還原的 page=N;改為序列化 key 真變動才重置(strict mode 雙跑安全:
 * 第二輪 key 未變、不觸發)。skipOnceRef=true 時跳過一次(URL 還原 vehicle 的 mount dispatch
 * 造成的首波 cascade 變更、非使用者改篩選;由 ProductsPage 的 vehicle 還原 effect 設旗)。
 */
export function usePageResetOnFilterChange(
  filterResetKey: string,
  skipOnceRef: MutableRefObject<boolean>,
  setPage: (n: number) => void,
  keyRef: MutableRefObject<string | null>,
): void {
  useEffect(() => {
    if (keyRef.current === null) {
      keyRef.current = filterResetKey; // mount 首輪:只記基準、不重置(保 URL page)
      return;
    }
    if (keyRef.current !== filterResetKey) {
      keyRef.current = filterResetKey;
      if (skipOnceRef.current) {
        skipOnceRef.current = false; // URL 還原 vehicle 的那一波、非使用者改篩選
        return;
      }
      setPage(1);
    }
    // deps 列全 4 個引用值(exhaustive-deps 完整、無 disable):filterResetKey 是唯一真變動源;
    // keyRef/skipOnceRef 是 useRef stable object、setPage 是 useState stable setter → identity 不變,
    // 列入零行為變化(effect 仍只在 filterResetKey 真變時有效觸發)。ref 以參數傳入(型別
    // MutableRefObject 非 useRef 直出)故 plugin 不自動略過、須顯式列。
    // 本檔 .tsx 而非 .ts:讓 react-hooks plugin(glob 僅 **/*.tsx)覆蓋此 hook(#6 code-reviewer nit-1)。
  }, [filterResetKey, setPage, keyRef, skipOnceRef]);
}

/**
 * page/sort/perPage 同步回 URL(非預設才寫、預設值刪 key 保持網址乾淨;保留外來參數
 * vehicle/brand/model/year/filter/from 等)。用原生 history.replaceState(Next 14.1+ 官方支援):
 * /products 是 force-dynamic,若走 router.replace 每次翻頁都會重打 server 重抓全量型錄;
 * replaceState 純改網址零往返,back/refresh/分享時由 useBrowseUrlState mount lazy init 讀回。
 */
export function useBrowseUrlSync(currentPage: number, sort: string, perPage: number): void {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (k: string, v: string | null) => {
      if (v === null) params.delete(k);
      else params.set(k, v);
    };
    setOrDelete('page', currentPage > 1 ? String(currentPage) : null);
    setOrDelete('sort', sort !== DEFAULT_SORT ? sort : null);
    setOrDelete('per', perPage !== DEFAULT_PER_PAGE ? String(perPage) : null);
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      // 保留 Next.js 內部 history state(比官方範例的 null 更保守、不干擾 scroll restoration)
      window.history.replaceState(window.history.state, '', next);
    }
  }, [currentPage, sort, perPage]);
}

/**
 * mount 時把 URL 深連結(vehicle / category / brand)還原成 cascade 篩選(#6 + Q4-S5;自 ProductsPage
 * 抽出=鐵則 6 檔案上限)。三來源各對照真實清單驗證、查無 fail-safe 忽略;只入站不回寫 URL。
 * 🔴 skipPageResetOnce:標記「本波 cascade 變更源自 URL 還原、非使用者操作」→ usePageResetOnFilterChange
 *    跳過一次(否則 ?vehicle=…&page=3 back 會被 mount dispatch 誤重置回第 1 頁)。
 * 🔴 brandAppliedOnce:toggleBrand 非冪等(strict mode dev effect 雙跑會 toggle 掉)→ 守一次;
 *    vehicle/category 為冪等 select、不需守(維持原行為)。
 */
export function useDeepLinkRestore(opts: {
  searchParams: SearchParamsLike;
  motoBrands: MockMotoBrand[];
  categories: { id: string; name: string }[];
  productBrands: { id: string }[];
  dispatch: Dispatch<CascadeFilterAction>;
  skipPageResetOnce: MutableRefObject<boolean>;
  brandAppliedOnce: MutableRefObject<boolean>;
}): void {
  useEffect(() => {
    const { searchParams, motoBrands, categories, productBrands, dispatch, skipPageResetOnce, brandAppliedOnce } = opts;
    const v = parseVehicleFromUrl(searchParams, motoBrands);
    const urlCategory = parseCategoryFromUrl(searchParams, categories);
    const urlBrand = parseBrandFilterFromUrl(searchParams, productBrands);
    if (!v && !urlCategory && !urlBrand) return;
    skipPageResetOnce.current = true;
    if (v) {
      dispatch(selectVehicleBrand(v.brand));
      if (v.model) dispatch(selectVehicleModel(v.model));
      if (v.year !== undefined) dispatch(selectVehicleYear(v.year));
    }
    if (urlCategory) dispatch(selectCategoryMain(urlCategory.mainId, urlCategory.main)); // 空狀態直選、冪等
    if (urlBrand && !brandAppliedOnce.current) {
      brandAppliedOnce.current = true;
      dispatch(toggleBrand(urlBrand));
    }
    // 僅 mount 時讀一次;strict mode dev 雙跑由 brandAppliedOnce 守 toggle、select 類冪等可吸收
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
