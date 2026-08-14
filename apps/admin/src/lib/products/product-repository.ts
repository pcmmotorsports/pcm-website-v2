import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// M-4b #20 片1a:後台商品列表讀模型。plan = docs/specs/2026-08-14-products-admin-slice1a-plan.md。
//
// 🔴 **讀 base 表 `products`,不讀 `products_public` view,也不重用 storefront 的 SupabaseProductAdapter。**
//    理由 = **view 不投射 `delisted_at`**(`20260808000000:91` COMMENT 逐字「仍排除 … delisted_at」)
//    ⇒ 走 view 就算看得到列,也**判不出哪些是已下架的** ⇒ 後台永遠沒辦法把它上架回來。
//    admin 走 service_role(同 lib/customers/customer-repository.ts:12)讀得到 base 表。
//
//    ⚠️ **原本寫的理由是錯的,已更正**(code-reviewer MF3):第一版寫「view 濾掉下架品
//    (`20260510134708_products_public_view.sql`)」—— 該檔對 delist 零命中(`delisted_at` 欄要到
//    `20260602135934:47` 才存在);真正在濾的是 RLS `products_select_public USING (delisted_at IS NULL)`
//    (`20260602135934:64`),而 view 是 `security_invoker=true` ⇒ **service_role BYPASSRLS 走 view
//    一樣看得到下架列**。結論(讀 base 表)不變,但理由換掉 —— 下一個人會照理由決定要不要重看。
//
// 🔴 **server 端 .range() 分頁,不用 IProductRepository.listAllProducts()** —— 後者自陳是
//    「全量撈進 client」的 stopgap(packages/ports/src/IProductRepository.ts:59-60),後台列表用它會複製同一個 TTFB 坑。
//
// 🔴 **select 逐欄指名、禁 select('*')**:base 表含 `price_store`(經銷價)。本片唯讀不寫,
//    但讀路徑碰得到那張表 ⇒ 逐欄指名是唯一讓「沒撈到經銷價」可被機械檢查的寫法(plan 驗收 4)。

/** 列表一列的原始 wire shape(逐欄對應下方 PRODUCT_LIST_COLUMNS)。 */
export interface AdminProductRow {
  readonly id: string;
  readonly title: string;
  readonly external_id: string;
  readonly price_general: number | null;
  readonly delisted_at: string | null;
}

/**
 * 🔴 逐欄指名。**不得改成 `*`**,也不得加入 `price_store` / `price_by_tier` / `cost` 任一欄。
 * 這串字面被 product-repository.test.ts 釘住。
 */
const PRODUCT_LIST_COLUMNS = 'id, title, external_id, price_general, delisted_at' as const;

/** 上下架狀態的 domain 形狀(頁面與表格只認這個,不認 DB 欄)。 */
export type ProductListingState = 'listed' | 'delisted';

/**
 * 🔴 **售價的唯一取值落點**(plan §3 設計約束)。
 *
 * 為什麼要有這支:Q-B1 若拍 B 案(後台覆寫層),售價要改讀 `price_override ?? price_general`。
 * 把取值集中在這裡 ⇒ **B 案只改這一個函式**;頁面與表格直讀 `row.price_general` 的話,
 * 改動面會散開而沒有人數得出來有幾處。A/C 兩案本函式零改動。
 * 這條約束由 `product-repository.test.ts` 釘成測試,不是靠註解自律。
 */
export function resolvePrice(row: AdminProductRow): number | null {
  return row.price_general;
}

/**
 * 🔴 **上下架狀態的唯一取值落點**(理由同 `resolvePrice`)。
 *
 * Q-B1 拍 B 案時改讀 `delist_override ?? delisted_at`;A/C 兩案零改動。
 * 語意:`delisted_at` 非空 = 已下架(對齊 rpm-reconcile.ts:101 的軟下架寫法與全站
 * `delisted_at IS NULL` 判讀慣例)。
 */
export function resolveListingState(row: AdminProductRow): ProductListingState {
  return row.delisted_at === null ? 'listed' : 'delisted';
}

export interface AdminProductPage {
  readonly items: readonly AdminProductRow[];
  readonly total: number;
}

/**
 * 依頁碼讀一頁商品(**含已下架**)。
 *
 * 🔴 排序釘死 `id` 升冪:`title` 排序取決於連線 collation(本機 C locale ≠ 正式站),
 * 同一頁在不同環境會給不同結果 —— 同樣的理由見 lib/supplier-repository.ts:23-25。
 * `count: 'exact'` 取總數供分頁列顯示。
 */
export async function listProductsForAdmin(
  limit: number,
  offset: number,
): Promise<AdminProductPage> {
  const { data, error, count } = await createSupabaseServiceClient()
    .from('products')
    .select(PRODUCT_LIST_COLUMNS, { count: 'exact' })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { items: data ?? [], total: count ?? 0 };
}
