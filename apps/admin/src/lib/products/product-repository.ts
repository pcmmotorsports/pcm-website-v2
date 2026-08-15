import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { ProductMediaRow } from './product-media';

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

// ── #20 片1b-1 增補 ──
// 🔴 **`metadata` 進禁字、`supplier_slug` 出禁字**(片1a nit N2 + 片1b plan §1.2):
//    · `supplier_slug`:唯一鍵是複合的 `(supplier_slug, external_id)`(`20260602192455:53`)
//      ⇒ **料號不是全域唯一**,詳情頁不顯示供應商,員工分不出同料號的兩筆。它本來就投射在公開 view
//      的末欄(`20260602135934:116`;view 本體從 `:100` 起)⇒ 不是敏感欄。
//    · `metadata`:`20260602135934:80-82` 先洗掉 4 個敏感 key、`:88-90` 再加 CHECK,
//      但**那條 CHECK 只擋那 4 個具名 key**(`:84-86` 是 product_variants 的、不是 products 的 ——
//      第一版寫成 `:84-90` 一整段,橫跨了兩張表,R1 N-f 指出)
//      ⇒「整包印出來安不安全」等同於「它現在還裝著什麼」——**沒有人盤過** ⇒ 盤完之前不撈、不印。
//
// 🔴 **品牌/分類用「另外兩支查詢」而不是 PostgREST 內嵌關聯**:內嵌關聯的實際回傳形狀我沒有正式庫可實跑
//    (plan §4 R2)。改成對 `brands`/`categories` 各查一次 `id,name`(`20260505130758:24,41`)
//    ⇒ 形狀是已知的、R2 這個未知數整個消失。代價 = 詳情頁多兩趟往返,單筆頁面可接受。

/** 列表一列的原始 wire shape(逐欄對應下方 PRODUCT_LIST_COLUMNS)。 */
export interface AdminProductRow {
  readonly id: string;
  readonly title: string;
  readonly external_id: string;
  readonly price_general: number | null;
  readonly delisted_at: string | null;
  /** `#20` 片2c:誰決定了目前的上下架狀態(`sync`=每日同步 / `staff`=員工手動)。 */
  readonly listing_set_by: string | null;
  /** `#20` 片2c:來源端第一次不再吐這筆的時間;`null` = 來源仍有這筆。 */
  readonly source_missing_at: string | null;
}

/**
 * 🔴 逐欄指名。**不得改成 `*`**,也不得加入 `price_store` / `price_by_tier` / `cost` 任一欄。
 * 這串字面被 product-repository.test.ts 釘住。
 */
const PRODUCT_LIST_COLUMNS =
  'id, title, external_id, price_general, delisted_at, listing_set_by, source_missing_at' as const;

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

/**
 * 「這一列的上下架狀態是誰決定的」的 domain 形狀。
 *
 * 🔴 **三態,不是兩態。** `unknown` 存在的理由不是防禦性程式設計,是**畫面要看得出資料有問題**:
 * Sean 把文案從「員工設定」改成「手動 / 自動」,理由正是**兩種狀態都要有名字** ——
 * 只有一種有標記時,「沒標記」會同時代表「自動」與「資料壞了」,而那兩件事的處置完全不同。
 * ⇒ 值不在白名單(NULL、空字串、未來新增的來源如 `import`)一律落 `unknown`,
 *   由畫面顯示成看得出異常的樣子,**不得靜靜顯示成「自動」**。
 * 這條配了負測(`products-table.test.tsx`),不是靠這段註解自律。
 */
export type ProductListingSetBy = 'sync' | 'staff' | 'unknown';

export function resolveListingSetBy(row: AdminProductRow): ProductListingSetBy {
  if (row.listing_set_by === 'staff') return 'staff';
  if (row.listing_set_by === 'sync') return 'sync';
  return 'unknown';
}

/** 來源端已經沒有這筆了嗎(≠ 不能賣 —— 員工可能有現貨仍在賣,見 migration 20260815030000 的欄位註解)。 */
export function isSourceMissing(row: AdminProductRow): boolean {
  return row.source_missing_at !== null && row.source_missing_at !== undefined;
}

/** 工具列 chip 的篩選值。`undefined` = 不篩(「全部」)。 */
export type ProductSetByFilter = 'sync' | 'staff';

export interface AdminProductPage {
  readonly items: readonly AdminProductRow[];
  readonly total: number;
}

/**
 * 依頁碼讀一頁商品(**含已下架**)。
 *
 * 🔴 **排序 = `created_at DESC, id ASC`**(片1a nit N1,片1b-1 折)。
 *
 * · 為什麼不是 `id`:`id` 是 `gen_random_uuid()`(`20260507004826:24`)⇒ 升冪等於**亂序**,
 *   員工看不到「最近進了什麼」。
 * · 為什麼不是 `title`:排序結果取決於連線 collation(本機 C locale ≠ 正式站)
 *   ⇒ 同一頁在不同環境給不同結果(同 lib/supplier-repository.ts:23-25 的理由)。
 * · 🔴 **`id` 是必要的第二鍵**:`created_at` 同值時單靠它分頁會漂 —— 同一筆可能兩頁都出現、
 *   也可能兩頁都不出現。這不是理論,是 `.range()` 分頁對非唯一排序鍵的固有行為。
 * · **不需要 migration**:`products.created_at` 無索引,但 `20260811040000:130-136` 有正式庫
 *   `EXPLAIN(ANALYZE)` 實測 —— 全表 seq scan **4,389 buffers / 48.053 ms**,且 admin 走
 *   service_role(不吃 anon 的 3s statement_timeout)。
 *   ⚠️ 那是 **2026-08-11 的量測、量的是型錄那支 RPC 不是本函式** ⇒ 是量級參考,不是保證。
 *   真的慢了 → 退回 `id` 排序並開決策題,**不得默默加索引**(那是 migration、要 Sean)。
 *
 * `count: 'exact'` 取總數供分頁列顯示。
 */
export async function listProductsForAdmin(
  limit: number,
  offset: number,
  setBy?: ProductSetByFilter,
): Promise<AdminProductPage> {
  let q = createSupabaseServiceClient()
    .from('products')
    .select(PRODUCT_LIST_COLUMNS, { count: 'exact' });

  // 🔴 **篩選一定要走 DB,不能在頁面上過濾陣列。**
  //    `.range()` 是先分頁再回列 ⇒ 客戶端過濾只會過濾「這一頁」,
  //    而分頁列顯示的 `count` 仍是全表數 ⇒ 「共 20,334 件」配上一頁 3 筆,且翻頁翻不完。
  if (setBy) q = q.eq('listing_set_by', setBy);

  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { items: data ?? [], total: count ?? 0 };
}

// ─────────────────────────── 片1b-1:單筆詳情 ───────────────────────────

/** 詳情頁的原始 wire shape(逐欄對應下方 PRODUCT_DETAIL_COLUMNS)。 */
export interface AdminProductDetailRow extends AdminProductRow, ProductMediaRow {
  readonly subtitle: string | null;
  readonly supplier_slug: string;
  readonly handle: string;
  readonly brand_id: string;
  readonly category_id: string;
  readonly availability: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * 🔴 逐欄指名,理由同列表。**不得改成 `*`**,也不得加入
 * `price_store` / `price_by_tier` / `cost` / `metadata` 任一欄。這串字面被測試釘住。
 *
 * 片1b-2 加入內容與媒體七欄。**它們的 jsonb 元素形狀不保證**(見 `product-media.ts` 檔頭)
 * ⇒ wire 型別寬鬆、由 `toProductMedia()` 的 runtime guard 收斂,**不在這裡假設形狀**。
 */
const PRODUCT_DETAIL_COLUMNS =
  'id, title, subtitle, external_id, supplier_slug, handle, brand_id, category_id, price_general, availability, delisted_at, listing_set_by, source_missing_at, created_at, updated_at, description, highlights, fitments, images, video_url, manuals, sound_clips' as const;

/**
 * 讀單筆商品(**含已下架** —— 後台要能把它撈回來)。查無回 `null`,不 throw。
 *
 * `maybeSingle()`:查無回 `data === null` 且 `error === null`(不像 `single()` 會給 PGRST116)
 * ⇒ 「查無」與「讀取失敗」在呼叫端分得開,404 與錯誤態才不會混成同一條路。
 */
export async function getProductForAdmin(
  id: string,
): Promise<AdminProductDetailRow | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('products')
    .select(PRODUCT_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export interface ProductTaxonomyNames {
  readonly brandName: string | null;
  readonly categoryName: string | null;
}

/**
 * 品牌名 / 分類名。**兩支獨立查詢,不用 PostgREST 內嵌關聯**(理由見檔頭:內嵌的回傳形狀沒實跑驗過)。
 * 查無回 `null`(顯示層自己決定顯示什麼);讀取失敗照樣 throw,由呼叫端當成「這一區塊壞了」處理。
 *
 * ⚠️ **「單區塊容錯」的粒度是整個分類區塊,區塊內是全有全無**(code-reviewer R1 N-h):
 * brands 成功、categories 失敗時,**拿得到的品牌名也一起丟掉**、整塊顯示載入失敗。
 * 這是刻意的簡化(兩個名字一起顯示才有意義,只顯示一半更容易被誤讀成「這件沒分類」),
 * 但**它是簡化不是完備** —— 寫出來,免得下一個人以為已經逐欄容錯了。
 */
export async function getProductTaxonomyNames(
  brandId: string,
  categoryId: string,
): Promise<ProductTaxonomyNames> {
  const supabase = createSupabaseServiceClient();
  const [brand, category] = await Promise.all([
    supabase.from('brands').select('id, name').eq('id', brandId).maybeSingle(),
    supabase.from('categories').select('id, name').eq('id', categoryId).maybeSingle(),
  ]);

  if (brand.error) throw brand.error;
  if (category.error) throw category.error;
  return {
    brandName: brand.data?.name ?? null,
    categoryName: category.data?.name ?? null,
  };
}
