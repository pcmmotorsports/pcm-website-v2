import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// price-change-repository.ts —— 後台「價格變動」清單(地圖 M-5-08;主視窗 2026-09-29 派)。
// 資料來源:product_price_changes(20260929020000 的 trigger 在規格一般價真的變時寫一列;只 GRANT 給 service_role)。
// 只讀。讀取失敗一律 throw, 由頁面顯示「載入失敗」, 不印成「沒有變動」。

/** 一次最多讀幾列(依 id 新到舊);超過時畫面說明只列出最近這些。 */
export const PRICE_CHANGE_LIMIT = 1000;
const PAGE = 1000;
/** products 以 id 分批查, 避免 in() 網址過長。 */
const IN_CHUNK = 100;

export type PriceChangeDirection = 'up' | 'down';

export type PriceChangeFilter = {
  /** 最近幾天(7 或 30)。 */
  days: number;
  /** 品牌 id;缺 = 全部。 */
  brandId?: string;
  /** 漲 / 跌;缺 = 全部。 */
  direction?: PriceChangeDirection;
};

export type PriceChangeListRow = {
  id: number;
  changedAt: string;
  productId: string;
  /** 商品已被刪除時為 null(畫面印料號、不給連結)。 */
  productTitle: string | null;
  brandName: string | null;
  sku: string;
  oldPrice: number | null;
  newPrice: number | null;
  /** 舊價 > 0 且新價不是 null 才算得出;其餘 null。 */
  pct: number | null;
};

type ChangeRow = {
  id: number;
  product_id: string;
  sku: string;
  old_price: number | null;
  new_price: number | null;
  changed_at: string;
};
type ProductRow = { id: string; title: string | null; brand_id: string | null; brands: { name: string } | null };

/** 純函式:漲跌幅(小數一位);舊價不是正數或新價缺 ⇒ null(不印 Infinity / NaN)。 */
export function changePct(oldPrice: number | null, newPrice: number | null): number | null {
  if (oldPrice === null || oldPrice <= 0 || newPrice === null) return null;
  return Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10;
}

/** 純函式:這一列算不算「漲」/「跌」。舊價或新價缺(沒有價格 ⇔ 有價格)時兩邊都不算。 */
export function matchesDirection(row: Pick<PriceChangeListRow, 'oldPrice' | 'newPrice'>, direction?: PriceChangeDirection): boolean {
  if (direction === undefined) return true;
  if (row.oldPrice === null || row.newPrice === null) return false;
  return direction === 'up' ? row.newPrice > row.oldPrice : row.newPrice < row.oldPrice;
}

// ── 網址參數(頁面用)──────────────────────────────────────
const DAY_OPTIONS = [7, 30] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PriceChangeSearchParams = Record<string, string | string[] | undefined>;

/** 網址參數 → 篩選條件。不認得的值一律當成沒帶(不報錯, 畫面照預設)。 */
export function parsePriceChangeFilter(sp: PriceChangeSearchParams): PriceChangeFilter {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined);
  const days = Number(one('days'));
  const brand = one('brand');
  const dir = one('dir');
  return {
    days: (DAY_OPTIONS as readonly number[]).includes(days) ? days : 7,
    ...(brand && UUID.test(brand) ? { brandId: brand } : {}),
    ...(dir === 'up' || dir === 'down' ? { direction: dir as PriceChangeDirection } : {}),
  };
}


type LooseQuery<T> = PromiseLike<{ data: T[] | null; error: unknown }> & {
  select(cols: string): LooseQuery<T>;
  gte(col: string, v: string): LooseQuery<T>;
  in(col: string, vs: readonly string[]): LooseQuery<T>;
  order(col: string, opts: { ascending: boolean }): LooseQuery<T>;
  range(from: number, to: number): LooseQuery<T>;
};
type LooseClient = { from<T>(table: string): LooseQuery<T> };

function client(): LooseClient {
  return createSupabaseServiceClient() as unknown as LooseClient;
}

export async function listPriceChanges(
  filter: PriceChangeFilter,
  now: Date = new Date(),
): Promise<{ rows: PriceChangeListRow[]; truncated: boolean }> {
  const since = new Date(now.getTime() - filter.days * 24 * 60 * 60 * 1000).toISOString();
  const changes: ChangeRow[] = [];
  // 依 id 新到舊讀到上限為止(id 是寫入那一刻配的號, 比 changed_at 更接近實際順序)。
  for (;;) {
    const { data, error } = await client()
      .from<ChangeRow>('product_price_changes')
      .select('id, product_id, sku, old_price, new_price, changed_at')
      .gte('changed_at', since)
      .order('id', { ascending: false })
      .range(changes.length, changes.length + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    changes.push(...page);
    if (page.length === 0 || changes.length > PRICE_CHANGE_LIMIT) break;
  }
  const truncated = changes.length > PRICE_CHANGE_LIMIT;
  const kept = changes.slice(0, PRICE_CHANGE_LIMIT);

  const products = new Map<string, ProductRow>();
  const ids = [...new Set(kept.map((c) => c.product_id))];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await client()
      .from<ProductRow>('products')
      .select('id, title, brand_id, brands(name)')
      .in('id', ids.slice(i, i + IN_CHUNK))
      .order('id', { ascending: true })
      .range(0, IN_CHUNK - 1);
    if (error) throw error;
    for (const p of data ?? []) products.set(p.id, p);
  }

  const rows = kept
    .map((c): PriceChangeListRow & { brandId: string | null } => {
      const p = products.get(c.product_id);
      return {
        id: c.id,
        changedAt: c.changed_at,
        productId: c.product_id,
        productTitle: p ? p.title : null,
        brandName: p?.brands?.name ?? null,
        brandId: p?.brand_id ?? null,
        sku: c.sku,
        oldPrice: c.old_price,
        newPrice: c.new_price,
        pct: changePct(c.old_price, c.new_price),
      };
    })
    .filter((r) => (filter.brandId === undefined || r.brandId === filter.brandId) && matchesDirection(r, filter.direction))
    .map(({ brandId: _b, ...r }) => r);
  return { rows, truncated };
}

/** 篩選列的品牌選項(依名稱排序)。 */
export async function listBrandOptions(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await client()
    .from<{ id: string; name: string }>('brands')
    .select('id, name')
    .order('name', { ascending: true })
    .range(0, 999);
  if (error) throw error;
  return data ?? [];
}
