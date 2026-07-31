export const CATALOG_SORT_VALUES = ['recommend', 'price-asc', 'price-desc'] as const;
export const CATALOG_PER_PAGE_VALUES = [25, 50, 75, 100] as const;
/**
 * 每頁筆數預設(Sean 2026-07-31:25 → 50)。
 * 🔴 單一定義點:client 的 `products-url-state.DEFAULT_PER_PAGE` 也讀這個常數 ——
 *    兩邊各寫一個數字時,沒帶 `?per=` 的網址會變成「server 給 25 筆、client 以為一頁 50 筆」
 *    ⇒ 總頁數與「顯示第 X-Y 筆」全錯。
 */
export const CATALOG_DEFAULT_PER_PAGE = 50;

export type CatalogSort = (typeof CATALOG_SORT_VALUES)[number];

export type CatalogQuery = {
  page: number;
  perPage: number;
  sort: CatalogSort;
  brandSlugs: string[];
  category?: string;
  priceMin?: number;
  priceMax?: number;
  vehicle?: string;
};

const PRICE_LABEL_BOUNDS: Record<string, readonly [number, number | null]> = {
  'NT$ 0 – 3,000': [0, 3000],
  'NT$ 3,000 – 10,000': [3000, 10000],
  'NT$ 10,000 – 30,000': [10000, 30000],
  'NT$ 30,000 – 100,000': [30000, 100000],
  'NT$ 100,000 以上': [100000, null],
};

export function priceBoundsForLabel(label: string | null): readonly [number, number | null] | null {
  return label ? PRICE_LABEL_BOUNDS[label] ?? null : null;
}

type SearchParamsLike = Pick<URLSearchParams, 'get' | 'getAll'>;

/**
 * `?category=` 可接受的字面白名單(單一定義點)。
 *
 * 🔴 #306:facet 取數端(`api/catalog/facet-counts`)與點擊後的列表端必須用**同一道**白名單 ——
 *   否則會出現「面板算得出數字、但點進去那個 `?category=` 被這裡靜默丟掉 ⇒ 看到未過濾的整頁」。
 *   `%` 與 `_` 另有第二個理由:RPC 的 rollup 比對是 `category_raw LIKE p_category || ' · %'`,
 *   分類名裡的 LIKE 萬用字元會讓件數**多算**。
 */
export function isSafeCategoryValue(value: string): boolean {
  return value.length <= 120 && !/[\u0000-\u001f%_]/.test(value);
}

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VEHICLE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

function parsePositiveInteger(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseNonNegativeInteger(raw: string | null): number | undefined {
  // 🔴 缺參數/空白必回 undefined:Number(null) / Number('') / Number(' '|'\t'|'+') 皆為 0,
  //    且 0 通過 value>=0 檢查,會讓「無 pmax」誤傳 priceMax=0 → RPC 過濾 price_general<=0
  //    → 整頁 0 筆(P4 回歸)。故先 trim、空字串即視為缺參數(涵蓋 ?pmax= 與 ?pmax=%20)。
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 將不受信任 URL 參數收斂為 catalog 的安全、可快取 query shape。
 * 不認得的值一律回預設；排序與每頁數只接受 UI 白名單。
 */
export function parseCatalogQuery(searchParams: SearchParamsLike): CatalogQuery {
  const page = parsePositiveInteger(searchParams.get('page'), 1);
  const requestedPerPage = parsePositiveInteger(searchParams.get('per'), CATALOG_DEFAULT_PER_PAGE);
  const perPage = (CATALOG_PER_PAGE_VALUES as readonly number[]).includes(requestedPerPage)
    ? requestedPerPage
    : CATALOG_DEFAULT_PER_PAGE;
  const requestedSort = searchParams.get('sort');
  const sort = (CATALOG_SORT_VALUES as readonly string[]).includes(requestedSort ?? '')
    ? (requestedSort as CatalogSort)
    : 'recommend';
  const brandSlugs = Array.from(
    new Set(searchParams.getAll('pbrand').filter((slug) => SAFE_SLUG.test(slug))),
  ).sort();
  const categoryValue = searchParams.get('category');
  const category = categoryValue && isSafeCategoryValue(categoryValue) ? categoryValue : undefined;
  const sliderMin = parseNonNegativeInteger(searchParams.get('pmin'));
  const sliderMax = parseNonNegativeInteger(searchParams.get('pmax'));
  const labelBounds = priceBoundsForLabel(searchParams.get('price'));
  const priceMin = Math.max(sliderMin ?? 0, labelBounds?.[0] ?? 0);
  const candidateMax = [sliderMax, labelBounds?.[1]].filter(
    (value): value is number => value !== undefined && value !== null,
  );
  const priceMax = candidateMax.length > 0 ? Math.min(...candidateMax) : undefined;
  const vehicleValue = searchParams.get('vehicle');
  const vehicle = vehicleValue && SAFE_VEHICLE.test(vehicleValue) ? vehicleValue : undefined;

  return {
    page,
    perPage,
    sort,
    brandSlugs,
    ...(category ? { category } : {}),
    ...(priceMin > 0 || labelBounds ? { priceMin } : {}),
    ...(priceMax !== undefined ? { priceMax } : {}),
    ...(vehicle ? { vehicle } : {}),
  };
}
