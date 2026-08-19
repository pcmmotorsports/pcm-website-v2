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
/**
 * `#661`:把員工打的搜尋詞組成 PostgREST `.or()` 的條件字串(料號 OR 商品名)。
 *
 * **抽成純函式是刻意的** —— 它有兩層跳脫,而兩層都不能靠「看起來對」驗:
 * 抽出來才測得到(`product-repository.test.ts` 直接對它斷言,不需要 DB)。
 *
 * 🔴 **第一層:ILIKE 的萬用字元** `\` `%` `_`
 *    ILIKE 預設的跳脫字元就是反斜線(寫法取自 Supabase 官方 `pg-meta` 的 `escapeIlikeLiteral`)。
 *    不跳脫的話,員工搜尋 `50%` 會變成「50 開頭的任何東西」,而**畫面上看起來只是命中很多**。
 *
 * 🔴 **第二層:PostgREST 的保留字元** `,` `(` `)` `"` `\`
 *    官方文件逐字:值含保留字元「必須 **PostgREST 風格雙引號**包起來,否則伺服器會把它讀成
 *    條件或清單的邊界」(例 `name=eq."Doe, Jane"`)。
 *    ⇒ **不是**用反斜線跳脫逗號 —— 那是本檔第一版寫的,**錯的**。
 *    不處理的話,員工搜尋 `A,B` 會被拆成兩個條件,而**畫面上看起來只是「找不到」**。
 *
 * ⚠️ **順序不可換**:先做 ILIKE 跳脫(它會產生反斜線),再做雙引號內跳脫
 *    (把那些反斜線再跳一次)。反過來做,第一層產生的反斜線就不會被第二層保護。
 *
 * 🔴🔴 **第三個字元 `*` —— 它【穿透兩層】,而且【本層處理不了】**(`#661` R1 must-verify,GR 抓到)
 *
 *    PostgREST 對 like/ilike 的值有「`*` 可代替 `%`」的別名替換,而**它發生在雙引號解掉之後**。
 *    2026-08-19 對正式庫實測(dev server 連正式站,SQL 跑在 Supabase 的 Linux Postgres):
 *    ```
 *    ?q=brembo   ⇒ 共 35 件
 *    ?q=brembo*  ⇒ 共 35 件
 *    ?q=bremb*o  ⇒ 共 35 件   ← 🔴 決定性的那一發
 *    ```
 *    `bremb*o` 若是字面比對,應該是 0(沒有商品名含「bremb*o」)⇒ **它被當成萬用字元了。**
 *
 *    🔴 **而它無法在這一層修掉**:替換發生在引號之後 ⇒
 *    - 不跳脫 ⇒ 員工打 `M4*` 得到「M4 開頭任何東西」(= `50%` 那個病從第三個門進來)
 *    - 用反斜線跳脫 ⇒ `\*` 會先被替換成 `\%` ⇒ 員工打 `*` 反而搜到**字面的 `%`**,更錯
 *    ⇒ **用 PostgREST 的 `.or()` 字串 API,字面的 `*` 是表達不出來的。**
 *
 *    **現行處置(刻意,不是遺漏)**:接受 `*` 是萬用字元,並**在輸入框的提示文字寫出來**
 *    (`product-keyword-search.tsx` 的 placeholder),讓它從「意外」變成「功能」。
 *    🔴🔴 **下面那格測試釘住的是【我方的處置】,不是 PostgREST 的行為 —— 這兩件不要混**
 *    (`#661` R2 must-fix;本檔上一版逐字寫「哪天 PostgREST 改掉別名,那一格會紅」,**那是假的**:
 *     那是單元測試,從頭到尾沒碰 PostgREST ⇒ 它改掉別名時 builder 的輸出不變 ⇒ **那格照樣綠**,
 *     而員工照 placeholder 打 `M4*` 會突然搜不到,零測試紅。)
 *    · **它真守得住的方向**:有人把 `*` 加進跳脫字集、或把它 strip 掉 ⇒ 那格紅(R2 兩發突變證過)。
 *    · **PostgREST 那一側只在 2026-08-19 被量過一次**(上面那三發)⇒
 *      **要再聽到它的行為變了,必須重跑 probe,不能等測試通知。**
 *    📎 同一個行為在顧客站也存在且同樣未處理(`product-query-support.ts:44-46`,GR 查)。
 *    ⚠️ 要不要改成「一律當字面」是產品面的取捨,不是這一片能定的(改法會是換查詢 API 走 RPC,另一片)。
 *       **落點 = 待主視窗裁(掛 `#110` 或開新條)** —— 🔴 寫「已回報主視窗」不算落點,
 *       **通道不是載體**(R2 nit)。
 */
export function buildProductKeywordOrFilter(keyword: string): string {
  const ilikeSafe = keyword.replace(/([\\%_])/g, '\\$1');
  const inner = ilikeSafe.replace(/(["\\])/g, '\\$1');
  // 前後各一個 `%` = 子字串比對;它們在引號**內**,是 pattern 的一部分。
  const pattern = `"%${inner}%"`;
  return `external_id.ilike.${pattern},title.ilike.${pattern}`;
}

export async function listProductsForAdmin(
  limit: number,
  offset: number,
  setBy?: ProductSetByFilter,
  /**
   * `#661`:料號 + 商品名的文字搜尋。已由 `parseProductKeyword` trim 過、不會是空字串。
   *
   * 🔴 **用 `ilike` 不用 `pg_trgm` / 全文檢索,而這是【刻意的】**:
   *    `pg_trgm` 在 macOS 的 libc 下對中文抽出**零 trigram**
   *    (memory `reference_pg-trgm-cjk-zero-on-macos-libc`)⇒ 本機測中文會**恆假綠**。
   *    `ilike` 是純子字串比對、不經過 trigram ⇒ **對 CJK 與 ASCII 行為一致**,
   *    本機測到的就是正式站會發生的。
   *    ⚠️ 而這一句是**機制推論**:我沒有在 Linux 或正式站實跑過 `ilike` 對中文的行為(未驗)。
   * 🔴 **前置 `%` ⇒ 走不了 btree index ⇒ 全表掃描。** 現況約 2 萬列(G3 量、我沒重量),
   *    單次查詢在毫秒級 ⇒ **現在不需要索引**。判別線:**列數到十萬級再回頭看**,
   *    不是「以後有空再優化」。
   */
  keyword?: string,
): Promise<AdminProductPage> {
  let q = createSupabaseServiceClient()
    .from('products')
    .select(PRODUCT_LIST_COLUMNS, { count: 'exact' });

  // 🔴 **篩選一定要走 DB,不能在頁面上過濾陣列。**
  //    `.range()` 是先分頁再回列 ⇒ 客戶端過濾只會過濾「這一頁」,
  //    而分頁列顯示的 `count` 仍是全表數 ⇒ 「共 20,334 件」配上一頁 3 筆,且翻頁翻不完。
  if (setBy) q = q.eq('listing_set_by', setBy);

  // 🔴 `#661` 搜尋同樣走 DB,理由同上那條 —— 而它多一個:
  //    在客戶端過濾會讓「共 N 件」是**全表數**,員工看到「共 20341 件」配一頁 2 筆。
  if (keyword) q = q.or(buildProductKeywordOrFilter(keyword));

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

// ── 寫入路徑(M-4b `#20`;**商品域的第一條**)────────────────────────────────
// 🔴 本檔在這一行之前是**純唯讀**的 —— 加這一支之前,`apps/admin/src/{lib,components,app}/products`
//    全樹零 `.update(` / `.upsert(` / `.insert(` / `.rpc(`(migration `20260819040000` 檔頭逐字記了這個量測)。
//    ⇒ 之後任何人在本檔加第二支寫入,請照同一條路:**走 RPC,不要在 app 層直接 `.update()` 表**
//      (直接寫表的那條路**不寫稽核、也不寫 `listing_set_by`**;那個代價 migration 檔頭逐字寫了)。

export type AdminListingSetResult = 'UPDATED' | 'NO_CHANGE' | 'NOT_FOUND';

/**
 * 後台上下架(M-4b `#20`)—— 走 `admin_set_product_listing` owner RPC。
 *
 * `delisted=true` ⇒ 下架(`delisted_at = now()`);`false` ⇒ 上架(`delisted_at = NULL`)。
 * 兩種都會把 `listing_set_by` 寫成 `'staff'` —— 那是 Sean 2026-08-15 拍板的載體,不是附帶。
 *
 * 🔴 `note` 可為 `null`(RPC 設計上選填,見 `product-listing-form.ts` 檔頭)。
 * 🔴 稽核由 RPC **同交易**寫 `admin_audit_log`(`action='product.listing.change'`),本層不另接。
 */
export async function setProductListing(args: {
  productId: string;
  delisted: boolean;
  note: string | null;
  actor: string;
  requestId: string;
}): Promise<AdminListingSetResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_set_product_listing', {
    p_product_id: args.productId,
    p_delisted: args.delisted,
    p_note: args.note,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) {
    throw error;
  }
  // RPC RETURNS text scalar → data 即固定碼;防腐壞收斂(鏡像 `setCustomerTier`)。
  if (data === 'UPDATED' || data === 'NO_CHANGE' || data === 'NOT_FOUND') {
    return data;
  }
  throw new Error('admin_set_product_listing RPC 回傳非預期碼');
}
