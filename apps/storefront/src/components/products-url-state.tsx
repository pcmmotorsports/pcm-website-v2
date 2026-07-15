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

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { useRouter } from 'next/navigation';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  selectCategoryMain,
  selectCategorySub,
  toggleBrand,
  type CascadeFilterAction,
  type CascadeFilterState,
} from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { ProductExtraFilters } from './filter-state';
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
// ⚠️ V-1a 字面校正(值班台 REQUIRED-1):「僅入站、不回寫 URL」已被 P4 推翻——category/pbrand/price
// 現由 useCatalogFilterUrlSync 回寫 URL、vehicle 由 useVehicleUrlSync 回寫;本段僅「入站水合」半邊仍為真。

/** #212 兩層分類的 URL 分隔符(seed 麵包屑 raw_path/useCatalogFilterUrlSync 寫出端同字面 ` · `)。 */
const CATEGORY_URL_SEPARATOR = ' · ';

/**
 * ?category= 值:分類「名稱」(raw_path、人類可讀)為主;防禦性亦接受 DB id。
 * V-1a(2026-07-15):支援 #212 兩層 `大類 · 子類`(useCatalogFilterUrlSync 寫出端同格式;
 * 修「選子類→進商品→上一頁分類整個丟」=兩層字串對單層清單永遠 miss 的還原缺口)。
 * 子類查無 → 保守只還原大類;大類查無 → null(fail-safe、不套用)。
 */
export function parseCategoryFromUrl(
  searchParams: SearchParamsLike,
  categories: { id: string; name: string; children?: { id: string; name: string }[] }[],
): { mainId: string; main: string; subId?: string; sub?: string } | null {
  const raw = searchParams.get('category');
  if (!raw) return null;
  // 病態防護:大類名本身含分隔符時,先試全字串 exact match 再切分(現況 seed 無此名、零成本補洞)
  const exact = categories.find((c) => c.name === raw || c.id === raw);
  if (exact) return { mainId: exact.id, main: exact.name };
  const sepIndex = raw.indexOf(CATEGORY_URL_SEPARATOR);
  const mainRaw = sepIndex === -1 ? raw : raw.slice(0, sepIndex);
  const subRaw = sepIndex === -1 ? null : raw.slice(sepIndex + CATEGORY_URL_SEPARATOR.length);
  const hit = categories.find((c) => c.name === mainRaw || c.id === mainRaw);
  if (!hit) return null;
  if (subRaw) {
    const subHit = hit.children?.find((s) => s.name === subRaw || s.id === subRaw);
    if (subHit) return { mainId: hit.id, main: hit.name, subId: subHit.id, sub: subHit.name };
  }
  return { mainId: hit.id, main: hit.name };
}

/**
 * ?brand= 值:產品品牌 slug(= buildBrandTaxonomy 衍生 id,如 gb-racing/bonamici)。
 * ⚠️ 與 vehicle 長版 fallback(?brand=Yamaha&model=…)共用 key:各自對照表驗證、查無即 null。
 * 🔴 現況兩命名空間不相交(摩托車廠 id vs 產品品牌 slug),但**非結構保證**:日後多品牌若含
 *    OEM 副廠件(Yamaha/Honda 亦賣部品)、slug 'yamaha' 可能同時命中兩者 → 同一 ?brand= 雙重過濾。
 *    多品牌放量前需消歧(產品品牌深連結改獨立 key 如 ?pbrand=,或入站時 vehicle 優先互斥)。見 backlog #269。
 */
export function parseBrandFiltersFromUrl(
  searchParams: SearchParamsLike,
  productBrands: { id: string }[],
): string[] {
  const getAll = (searchParams as SearchParamsLike & { getAll?: (name: string) => string[] }).getAll;
  const requested = getAll ? getAll.call(searchParams, 'pbrand') : [];
  // 相容 P4 前的單一 ?brand= 深連結；新網址一律輸出不會和車款衝突的 ?pbrand=。
  if (requested.length === 0) {
    const legacy = searchParams.get('brand');
    if (legacy) requested.push(legacy);
  }
  return Array.from(new Set(requested)).filter((slug) => productBrands.some((b) => b.id === slug));
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
  const router = useRouter();
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
      // P4:改成 App Router 導覽，server 依 URL 只取當頁。不可再 replaceState 偽裝為已換頁。
      router.replace(next, { scroll: false });
    }
  }, [currentPage, sort, perPage, router]);
}

/** P4:品牌／分類／價格 UI state 變動時，寫入 URL 並讓 route 重跑 server catalog query。 */
export function useCatalogFilterUrlSync(
  cascade: CascadeFilterState,
  extras: ProductExtraFilters,
  // V-1a 還原窗口守衛的對照表(與 useDeepLinkRestore 同源清單;守窗口條件=「可還原」而非「參數存在」)
  restoreSources: {
    categories: { id: string; name: string; children?: { id: string; name: string }[] }[];
    productBrands: { id: string }[];
  },
): void {
  const router = useRouter();
  const initialized = useRef(false);
  // 🔴 還原窗口守衛(V-1a;同 useVehicleUrlSync idiom):useDeepLinkRestore 的 dispatch 未 flush 前,
  // 本 effect 若以「state 還空、URL 帶可還原 category/pbrand」執行(StrictMode 第二次 invoke 會繞過
  // initialized 首輪守衛),會把 URL 上待還原的參數整組洗掉=返回/深連結分類丟失。
  // 規則:state 對應軸仍空且 URL 參數**可還原**(parse 命中對照表、對齊 vehicle idiom)且還原未消化
  // → skip;查無(改名殘連結等)=restore 永不來 → 不 hold、照常同步(price 等其他軸不得被吞、
  // 垃圾參數同 vehicle 語意清掉);state 首次非空=消化、之後才允許清。
  const pendingRestoreRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const stateHasAny = cascade.category !== null || cascade.brands.length > 0;
    if (stateHasAny) {
      pendingRestoreRef.current = false; // 還原已消化(或使用者自選)
    } else if (pendingRestoreRef.current !== false) {
      const restorable =
        parseCategoryFromUrl(params, restoreSources.categories) !== null ||
        parseBrandFiltersFromUrl(params, restoreSources.productBrands).length > 0;
      if (restorable) {
        return; // 還原窗口:URL 參數待 restore dispatch flush、勿清
      }
    }
    params.delete('pbrand');
    for (const brand of [...cascade.brands].sort()) params.append('pbrand', brand);
    const category = cascade.category?.sub
      ? `${cascade.category.main}${CATEGORY_URL_SEPARATOR}${cascade.category.sub}`
      : cascade.category?.main;
    if (category) params.set('category', category);
    else params.delete('category');
    if (extras.price) params.set('price', extras.price);
    else params.delete('price');
    if (extras.priceRange) {
      params.set('pmin', String(extras.priceRange[0]));
      params.set('pmax', String(extras.priceRange[1]));
    } else {
      params.delete('pmin');
      params.delete('pmax');
    }
    params.delete('page');
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      router.replace(next, { scroll: false });
    }
  }, [cascade, extras, restoreSources, router]);
}

/**
 * S1(2026-07-12):cascade.vehicle → URL `?vehicle=brandId:modelId[:year]`(短版)→ server 重查。
 *
 * 車款篩選下推 DB 的 client 半邊:vehicle 變動時 `router.replace`(非 replaceState —— 這裡
 * **就是要** server 往返:/products force-dynamic、server 依 vehicle 走 RPC
 * `search_products_by_vehicle`〔product_fitments ∪ effective 去重、繼承件也命中〕重撈 products
 * prop;其餘瀏覽狀態 page/sort/per 仍走 useBrowseUrlSync 的零往返 replaceState、兩機制並存)。
 *
 * - 名稱→slug id:對照 motoBrands(= server fetchVehicleTaxonomy、與 parseVehicleFromUrl 同源;
 *   查無〔資料缺/清單未含〕→ 不寫不清、保守 no-op)。
 * - 品牌-only 選擇 → 單段 `?vehicle=brandId`(parseVehicleFromUrl parts[1] 空 → model null;
 *   RPC p_model NULL = 整品牌相容商品)。
 * - vehicle 清除 → 刪 `vehicle` key;長版遺留 key(?brand=&model=&year= 書籤)在兩方向皆一併清
 *   (`brand` 僅在與 `model` 同在=車輛長版語意時清;?brand= 單獨=商品品牌 filter、不可誤刪)。
 * - URL 無變化即 no-op(mount 還原波、StrictMode 雙跑安全);與現值比對後才 replace。
 */
export function useVehicleUrlSync(
  vehicle: CascadeFilterState['vehicle'],
  motoBrands: MockMotoBrand[],
): void {
  const router = useRouter();
  // 🔴 還原窗口守衛:mount 時 useDeepLinkRestore 的 dispatch 尚未 flush、本 effect 首輪
  // 閉包 vehicle 仍 null —— 若 URL 帶可解析的車輛參數,此時清 URL = 深連結被自己打掉。
  // 規則:vehicle=null 且 URL 車輛參數可解析且還原未消化(pendingRestore≠false)→ skip;
  // vehicle 首次非 null(還原 flush 或使用者自選)→ 標記消化,之後的 null 才是真清除。
  const pendingRestoreRef = useRef<boolean | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (vehicle) {
      pendingRestoreRef.current = false; // 還原已消化(或使用者自選)
    } else if (pendingRestoreRef.current !== false) {
      const restorable = parseVehicleFromUrl(
        { get: (n) => params.get(n) },
        motoBrands,
      );
      if (restorable) return; // 還原窗口:URL 車輛待 restore dispatch flush、勿清
    }
    let next: string | null = null;
    if (vehicle) {
      const brandObj = motoBrands.find((b) => b.name === vehicle.brand);
      if (!brandObj) return; // taxonomy 查無(清單空/資料缺)→ 保守不動 URL
      const modelObj =
        vehicle.model != null ? brandObj.models?.find((m) => m.name === vehicle.model) : null;
      if (vehicle.model != null && !modelObj) return;
      const segs = [brandObj.id];
      if (modelObj) {
        segs.push(modelObj.id);
        if (vehicle.year != null) segs.push(String(vehicle.year));
      }
      next = segs.join(':');
    }
    const hadLongVehicle = params.get('brand') != null && params.get('model') != null;
    if (next !== null) params.set('vehicle', next);
    else params.delete('vehicle');
    if (hadLongVehicle) params.delete('brand');
    params.delete('model');
    params.delete('year');
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      router.replace(url, { scroll: false });
    }
  }, [vehicle, motoBrands, router]);
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
  categories: { id: string; name: string; children?: { id: string; name: string }[] }[];
  productBrands: { id: string }[];
  dispatch: Dispatch<CascadeFilterAction>;
  skipPageResetOnce: MutableRefObject<boolean>;
  brandAppliedOnce: MutableRefObject<boolean>;
}): void {
  useEffect(() => {
    const { searchParams, motoBrands, categories, productBrands, dispatch, skipPageResetOnce, brandAppliedOnce } = opts;
    const v = parseVehicleFromUrl(searchParams, motoBrands);
    const urlCategory = parseCategoryFromUrl(searchParams, categories);
    const urlBrands = parseBrandFiltersFromUrl(searchParams, productBrands);
    if (!v && !urlCategory && urlBrands.length === 0) return;
    skipPageResetOnce.current = true;
    if (v) {
      dispatch(selectVehicleBrand(v.brand));
      if (v.model) dispatch(selectVehicleModel(v.model));
      if (v.year !== undefined) dispatch(selectVehicleYear(v.year));
    }
    if (urlCategory) {
      dispatch(selectCategoryMain(urlCategory.mainId, urlCategory.main)); // 空狀態直選、冪等
      // V-1a:#212 兩層還原補子類(mount 單次 dispatch、無 toggle 反覆問題)
      if (urlCategory.subId && urlCategory.sub) {
        dispatch(selectCategorySub(urlCategory.subId, urlCategory.sub));
      }
    }
    if (urlBrands.length > 0 && !brandAppliedOnce.current) {
      brandAppliedOnce.current = true;
      for (const brand of urlBrands) dispatch(toggleBrand(brand));
    }
    // 僅 mount 時讀一次;strict mode dev 雙跑由 brandAppliedOnce 守 toggle、select 類冪等可吸收
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
