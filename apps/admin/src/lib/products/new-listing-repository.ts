import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// new-listing-repository.ts —— 後台「最近 7 天新上架」清單(地圖 M-5-03;主視窗 2026-09-29 派)。
// 提案 ~/pcm-mailbox/提案-新商品審核-20260929.md 甲:新商品照舊自動上架, 上架後在這裡把可疑的排在最前面,
// 員工看完有問題就到商品頁下架。只讀, 不動資料庫。
// 來源:products(上架中、created_at 在 7 天內)。代表圖待補 / 標題無中文字 = 20260928030000 的兩個計算欄,
// 與商品列表「要處理」同一個判斷。讀取失敗一律 throw, 由頁面顯示「載入失敗」, 不印成「沒有新上架」。

export const NEW_LISTING_DAYS = 7;
/** 一次最多讀幾件(依建立時間新到舊);超過時畫面說明只列出最新的這些。 */
export const NEW_LISTING_LIMIT = 1000;
const PAGE = 1000;
/**
 * 一般價低於這個數字就標「價格低於 NT$1,000」(含 0 元)。
 * 起因:2026-09-28 Öhlins 工具與油品有 7 件台幣不到 1,000 元、明顯偏低(例:扳手 NT$100)。
 * ponytail: 固定門檻;若誤報太多, 改成「低於同分類中位數的 20%」。
 */
export const LOW_PRICE_THRESHOLD = 1000;
const UNCATEGORIZED = '未分類';

export type NewListingFlag = 'no_price' | 'low_price' | 'image_missing' | 'title_no_cjk' | 'uncategorized';

export const NEW_LISTING_FLAG_LABEL: Record<NewListingFlag, string> = {
  no_price: '沒有價格',
  low_price: `價格低於 NT$${LOW_PRICE_THRESHOLD.toLocaleString('en-US')}`,
  image_missing: '代表圖待補',
  title_no_cjk: '標題無中文字',
  uncategorized: '未分類',
};

export type NewListingRow = {
  id: string;
  createdAt: string;
  title: string;
  brandName: string | null;
  categoryName: string | null;
  priceGeneral: number | null;
  flags: NewListingFlag[];
};

/** 純函式:這件商品有哪些需要注意的地方(順序固定, 與畫面一致)。 */
export function newListingFlags(p: {
  priceGeneral: number | null;
  imageMissing: boolean;
  titleLacksCjk: boolean;
  categoryRawPath: string | null;
}): NewListingFlag[] {
  const flags: NewListingFlag[] = [];
  if (p.priceGeneral === null) flags.push('no_price');
  else if (p.priceGeneral < LOW_PRICE_THRESHOLD) flags.push('low_price');
  if (p.imageMissing) flags.push('image_missing');
  if (p.titleLacksCjk) flags.push('title_no_cjk');
  if (p.categoryRawPath === null || p.categoryRawPath === UNCATEGORIZED) flags.push('uncategorized');
  return flags;
}

/** 純函式:需要注意的項目多的在前;一樣多就新到舊。 */
export function sortNewListings<T extends Pick<NewListingRow, 'createdAt' | 'flags'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.flags.length - a.flags.length || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

type ProductRow = {
  id: string;
  title: string | null;
  price_general: number | null;
  created_at: string;
  admin_card_image_missing: boolean | null;
  admin_title_lacks_cjk: boolean | null;
  brands: { name: string } | null;
  categories: { name: string; raw_path: string | null } | null;
};

type LooseQuery<T> = PromiseLike<{ data: T[] | null; error: unknown }> & {
  select(cols: string): LooseQuery<T>;
  is(col: string, v: null): LooseQuery<T>;
  gte(col: string, v: string): LooseQuery<T>;
  order(col: string, opts: { ascending: boolean }): LooseQuery<T>;
  range(from: number, to: number): LooseQuery<T>;
};
type LooseClient = { from<T>(table: string): LooseQuery<T> };

export async function listNewListings(now: Date = new Date()): Promise<{ rows: NewListingRow[]; truncated: boolean }> {
  const since = new Date(now.getTime() - NEW_LISTING_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const db = createSupabaseServiceClient() as unknown as LooseClient;
  const products: ProductRow[] = [];
  // 依建立時間新到舊讀到上限為止(多讀一頁判斷有沒有超過)。
  for (;;) {
    const { data, error } = await db
      .from<ProductRow>('products')
      .select(
        'id, title, price_general, created_at, admin_card_image_missing, admin_title_lacks_cjk, brands(name), categories(name, raw_path)',
      )
      .is('delisted_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(products.length, products.length + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    products.push(...page);
    if (page.length < PAGE || products.length > NEW_LISTING_LIMIT) break;
  }
  const truncated = products.length > NEW_LISTING_LIMIT;
  const rows = products.slice(0, NEW_LISTING_LIMIT).map(
    (p): NewListingRow => ({
      id: p.id,
      createdAt: p.created_at,
      title: p.title ?? '',
      brandName: p.brands?.name ?? null,
      categoryName: p.categories?.name ?? null,
      priceGeneral: p.price_general,
      flags: newListingFlags({
        priceGeneral: p.price_general,
        imageMissing: p.admin_card_image_missing === true,
        titleLacksCjk: p.admin_title_lacks_cjk === true,
        categoryRawPath: p.categories?.raw_path ?? null,
      }),
    }),
  );
  return { rows: sortNewListings(rows), truncated };
}
