export const CATALOG_SORT_VALUES = ['recommend', 'price-asc', 'price-desc'] as const;
export const CATALOG_PER_PAGE_VALUES = [25, 50, 75, 100] as const;

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

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VEHICLE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

function parsePositiveInteger(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseNonNegativeInteger(raw: string | null): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 將不受信任 URL 參數收斂為 catalog 的安全、可快取 query shape。
 * 不認得的值一律回預設；排序與每頁數只接受 UI 白名單。
 */
export function parseCatalogQuery(searchParams: SearchParamsLike): CatalogQuery {
  const page = parsePositiveInteger(searchParams.get('page'), 1);
  const requestedPerPage = parsePositiveInteger(searchParams.get('per'), 25);
  const perPage = (CATALOG_PER_PAGE_VALUES as readonly number[]).includes(requestedPerPage)
    ? requestedPerPage
    : 25;
  const requestedSort = searchParams.get('sort');
  const sort = (CATALOG_SORT_VALUES as readonly string[]).includes(requestedSort ?? '')
    ? (requestedSort as CatalogSort)
    : 'recommend';
  const brandSlugs = Array.from(
    new Set(searchParams.getAll('pbrand').filter((slug) => SAFE_SLUG.test(slug))),
  ).sort();
  const categoryValue = searchParams.get('category');
  const category =
    categoryValue && categoryValue.length <= 120 && !/[\u0000-\u001f%_]/.test(categoryValue)
      ? categoryValue
      : undefined;
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
