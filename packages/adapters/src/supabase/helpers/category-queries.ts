import type { SupabaseClient } from '@supabase/supabase-js';
import type { CategorySummary } from '@pcm/domain';
import type { Database } from '../database.types';
import { findSingle } from './product-query-support';

/**
 * categories 註冊表投射(listCategories 用)。segments 為 jsonb、生成型別給 Json、
 * 由 `as unknown as` narrow(對齊 findSingle JSDoc 的 rich-Json 邊界說明)。
 */
type CategoryRegistryRow = {
  id: string;
  name: string;
  raw_path: string;
  segments: unknown;
  parent_category_id: string | null;
  sort_order: number;
};

/**
 * `categories.raw_path` UNIQUE query 取 leaf node id。
 * 對齊 PRD §3.2 + supabase-schema-design.md §4.3。
 *
 * 注:只取 leaf node id;parent_id_chain 解析屬 save 路徑(對齊 PRD §5.1 末段)、
 * 不在本 helper 範圍。呼叫端:listByCategory / listAllByCategory / save。
 */
export async function resolveCategoryId(
  supabase: SupabaseClient<Database>,
  rawPath: string,
): Promise<string | null> {
  const row = await findSingle<{ id: string }>(
    supabase.from('categories').select('id').eq('raw_path', rawPath).single(),
  );
  return row?.id ?? null;
}

/**
 * 列出全部分類 + 各分類上架商品數(接線 plan C1、對齊 IProductRepository.listCategories contract)。
 *
 * 兩段查詢:
 * 1. `categories` 註冊表全部分類(依 sort_order 遞增;分類數遠低於 PostgREST 1000 上限、不分頁)。
 * 2. 逐分類走 `products_public` 取 exact count(head:true 零 row 傳輸、以 RLS-enforced
 *    anon/publishable client 實例化時天然只計上架 delisted_at IS NULL〔同既有 read methods〕、
 *    避開 listAllByCategory 需 .range 分頁繞的 1000-row 上限);
 *    只 select 'id'、絕不觸經銷價欄(price_store / price_by_tier / metadata)。
 *
 * 空分類回 productCount = 0(不過濾、消費端決定;對齊 port contract)。
 *
 * @TODO #51 / #247:目錄長大後改 server-side 聚合(view / RPC),避免逐分類 N 次 count 查詢。
 */
export async function listCategories(
  supabase: SupabaseClient<Database>,
): Promise<CategorySummary[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, raw_path, segments, parent_category_id, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as unknown as CategoryRegistryRow[];
  return Promise.all(
    rows.map(async (row): Promise<CategorySummary> => ({
      id: row.id,
      name: row.name,
      path: {
        raw: row.raw_path,
        // jsonb segments 退化:非陣列 → [];陣列含非 string 元素 → 濾除(守 CategoryPath.segments 契約)
        segments: Array.isArray(row.segments)
          ? row.segments.filter((s): s is string => typeof s === 'string')
          : [],
      },
      parentId: row.parent_category_id,
      sortOrder: row.sort_order,
      productCount: await countLiveProductsByCategory(supabase, row.id),
    })),
  );
}

/**
 * 單一分類的上架商品 exact count(listCategories 用)。
 * 走 products_public + head:true(零 row 傳輸)、RLS-enforced client 下只計 delisted_at IS NULL;
 * 只 select 'id'、不觸經銷價欄。
 */
async function countLiveProductsByCategory(
  supabase: SupabaseClient<Database>,
  categoryId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('products_public')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if (error) throw error;
  return count ?? 0;
}
