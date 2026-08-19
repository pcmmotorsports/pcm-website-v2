import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { ProductMediaRow } from './product-media';
import type { BrandOptionRow, CategoryOptionRow } from './product-taxonomy-options';

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
 * 列表一列 = 基底欄位 **+ 兩個內嵌 to-one 關聯**。
 *
 * 🔴 **為什麼另立一個型別而不是加進 `AdminProductRow`**:`AdminProductDetailRow extends
 *    AdminProductRow` —— 加進基底型別會**連帶要求詳情頁也撈這兩欄**,而詳情頁走的是
 *    `getProductTaxonomyNames` 那條(兩發獨立查詢,理由見檔頭,一個字沒改)。
 *    ⇒ `tsc` 當場把這件事指出來了(`product-repository.ts` 的 `getProductForAdmin` 回傳型別不合)
 *      —— 那不是型別噪音,是它在說「你把列表的形狀強加給詳情頁了」。
 */
export interface AdminProductListRow extends AdminProductRow {
  /**
   * PostgREST **內嵌 to-one 關聯**的品牌名(`brands(name)`)。
   *
   * 🔴 **檔頭那條「品牌/分類用另外兩支查詢、不用內嵌關聯」的理由已經【失效】,而它失效得有憑據**:
   *    那條逐字寫著「內嵌關聯的實際回傳形狀**我沒有正式庫可實跑**(plan §4 R2)」——
   *    ⇒ 它擋的是**未知**,不是內嵌本身。2026-08-19 已對**真 PostgREST 14.16 + 真 migration
   *    種下的 107 個分類**實跑,形狀量到了:**to-one 回的是物件不是陣列**
   *    (`"brands": {"name": "BREMBO"}`),查無回 `null`。
   *    ⇒ 那個未知數消失 ⇒ 這裡用內嵌,而**檔頭那條仍然適用於詳情頁**
   *      (`getProductTaxonomyNames` 一個字沒改 —— 單筆頁面多兩趟往返本來就可接受)。
   *    ⚠️ **效度限定**:量的是本機 PostgREST 14.16,不是正式站的版本。
   *      這是「to-one 內嵌回物件」這個 PostgREST 的**基本語意**,不是邊角行為
   *      ⇒ 版本差異的風險低,但**它就是低不是零**,寫出來。
   *    🔴 **而它壞掉的症狀寫在這裡(R1 nit-5)**:下面那個 `as unknown as` 把 wire 形狀的
   *      型別檢查整個關掉 ⇒ 正式站若把 to-one 回成**陣列**,`row.brands?.name` 會恆為
   *      `undefined` ⇒ **品牌與分類兩欄每一列都印「—」,而不會有任何一格紅**
   *      (typecheck 綠、測試綠 —— 測試餵的是我量到的那個形狀)。
   *      ⇒ **看到滿欄「—」的人,第一個要查的是回傳形狀,不是資料。**
   *
   * 🔴 **為什麼不做第二發查詢**:列表一頁最多 1000 列,逐列查品牌 = N+1。
   *    內嵌是**同一發 SQL**(單一 HTTP 請求)⇒ 查詢發數不隨列數增加。
   */
  readonly brands: { readonly name: string } | null;
  /** 內嵌 to-one 的分類完整路徑(`categories(raw_path)`),例 `'引擎部品 · 排氣管'`。理由同 `brands`。 */
  readonly categories: { readonly raw_path: string } | null;
}

/**
 * 🔴 逐欄指名。**不得改成 `*`**,也不得加入 `price_store` / `price_by_tier` / `cost` 任一欄。
 * 這串字面被 product-repository.test.ts 釘住。
 */
const PRODUCT_LIST_COLUMNS =
  'id, title, external_id, price_general, delisted_at, listing_set_by, source_missing_at, brands(name), categories(raw_path)' as const;

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
  readonly items: readonly AdminProductListRow[];
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

/**
 * `listProductsForAdmin` 吃的篩選軸。**一個物件而不是四個位置參數,這是刻意的。**
 *
 * 🔴 **理由**:加上 `brandId` 之後,`setBy` / `keyword` / `brandId` / `categoryIds` 之中有三個
 *    是 `string | undefined` ⇒ 位置參數排錯順序**型別完全過得去**,而症狀是
 *    「篩選軸悄悄對到別的欄位」—— 那正是 `product-list-view.ts` 檔頭整段在講的那個病
 *    (「翻頁時那一軸靜默消失,而畫面上的選擇還在」)的近親。
 *    ⇒ 具名欄位讓那個錯不可能寫出來。
 */
export interface AdminProductQuery {
  readonly setBy?: ProductSetByFilter;
  /**
   * `#661`:料號 + 商品名的文字搜尋。已由 `parseProductKeyword` trim 過、不會是空字串。
   *
   * 🔴 **用 `ilike` 不用 `pg_trgm` / 全文檢索,而這是【刻意的】**:
   *    `pg_trgm` 在 macOS 的 libc 下對中文抽出**零 trigram**
   *    (memory `reference_pg-trgm-cjk-zero-on-macos-libc`)⇒ 本機測中文會**恆假綠**。
   *    `ilike` 是純子字串比對、不經過 trigram ⇒ **對 CJK 與 ASCII 行為一致**。
   *    ⚠️ 而這一句是**機制推論**:我沒有在 Linux 或正式站實跑過 `ilike` 對中文的行為(未驗)。
   * 🔴 **前置 `%` ⇒ 走不了 btree index ⇒ 全表掃描。** 現況約 2 萬列(G3 量、我沒重量),
   *    單次查詢在毫秒級 ⇒ **現在不需要索引**。判別線:**列數到十萬級再回頭看**。
   */
  readonly keyword?: string;
  /**
   * 品牌 uuid。**必為合法 uuid**(由 `parseProductBrandId` 把關)——
   * 非 uuid 會讓 PostgREST 回 400,而那在畫面上是「商品列表載入失敗」。
   */
  readonly brandId?: string;
  /**
   * 要命中的分類 id 集合(選了大類 ⇒ 含它自己 + 它的子類),由
   * `resolveCategoryIds`(`product-taxonomy-options.ts`)解出。
   *
   * 🔴 **空陣列與 `undefined` 是兩件事,而這裡只收得到後者**:`resolveCategoryIds` 認不得
   *    `raw_path` 時回 `null`,呼叫端要傳 `undefined`(= 不套用分類條件)。
   *    傳空陣列會變成 `.in('category_id', [])` ⇒ **0 件**,而網址被亂改時
   *    「看到全部」比「看到空的」更不會誤導員工(理由逐字在 `resolveCategoryIds` 檔頭)。
   */
  readonly categoryIds?: readonly string[];
  /**
   * 貼進來的料號清單(由 `parseProductSkus` 正規化、去重、上限過)。
   *
   * 🔴🔴 **空集合的意思與 `categoryIds` 【方向相反】,不要照抄上面那一段。**
   * ```
   * categoryIds 空 ⇒「網址被亂改、我認不得」⇒ 看到全部(不套用條件)
   * skus        空 ⇒「你貼的這些料號一個都不存在」⇒ **看到 0 件才是對的答案**
   * ```
   * ⇒ 差別在**誰造成的**:分類是我們解析失敗,料號是使用者輸入的事實。
   *   把「查無此料號」顯示成「全部商品」,員工會以為貼上沒生效而重貼一次。
   * ⇒ 本欄 `undefined` = 不篩;而**解析出的 id 集合是空的時候要真的查 0 件**,
   *   那一段在 `listProductsForAdmin` 裡,不在這裡。
   */
  readonly skus?: readonly string[];
}

/**
 * 料號清單 → 商品 id 集合。**回空陣列是一個合法答案**(= 這些料號一個都不存在)。
 *
 * 🔴 一個 SKU 對到一個 variant、多個 variant 可能對到同一個商品 ⇒ 這裡要去重。
 * 🔴 `.in()` 的上限由呼叫端保證(`MAX_SKU_COUNT`),本函式**不再設第二道** ——
 *    兩個地方各設一個上限,改一邊的那天不會有東西紅。
 */
async function resolveProductIdsBySkus(skus: readonly string[]): Promise<string[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('product_variants')
    .select('product_id')
    .in('sku', [...skus]);
  // 🔴 出錯【不得】回空陣列 —— 那會把「查詢失敗」顯示成「查無此料號」,而兩者要分得開。
  //    往上丟,由 `app/products/page.tsx` 既有的 try/catch 顯示「商品列表載入失敗」。
  if (error) throw new Error(`resolveProductIdsBySkus 失敗: ${error.message}`);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const id = (row as { product_id: string | null }).product_id;
    if (id) ids.add(id);
  }
  return [...ids];
}

export async function listProductsForAdmin(
  limit: number,
  offset: number,
  query: AdminProductQuery = {},
): Promise<AdminProductPage> {
  let q = createSupabaseServiceClient()
    .from('products')
    .select(PRODUCT_LIST_COLUMNS, { count: 'exact' });

  // 🔴 **篩選一定要走 DB,不能在頁面上過濾陣列。**
  //    `.range()` 是先分頁再回列 ⇒ 客戶端過濾只會過濾「這一頁」,
  //    而分頁列顯示的 `count` 仍是全表數 ⇒ 「共 20,334 件」配上一頁 3 筆,且翻頁翻不完。
  if (query.setBy) q = q.eq('listing_set_by', query.setBy);

  // 🔴 `#661` 搜尋同樣走 DB,理由同上那條 —— 而它多一個:
  //    在客戶端過濾會讓「共 N 件」是**全表數**,員工看到「共 20341 件」配一頁 2 筆。
  if (query.keyword) q = q.or(buildProductKeywordOrFilter(query.keyword));

  // 🔴 品牌與分類同理走 DB。兩欄都有索引
  //    (`20260507004826_init_products.sql:59-60` idx_products_brand_id / idx_products_category_id)。
  if (query.brandId) q = q.eq('brand_id', query.brandId);

  // 🔴 **用 `.in(id)` 不用 `raw_path` 的 `LIKE` 前綴** —— 前綴比對在 DB 端吃不到
  //    `idx_products_category_id`,而 id 集合已經在呼叫端從**撈下來的分類清單**解好了
  //    ⇒ 零額外查詢、走得到索引。
  //    ⚠️ `length > 0` 這個判斷不是防禦性寫法:見 `AdminProductQuery.categoryIds` 檔頭 ——
  //       空陣列會查出 0 件,而那不是任何呼叫端想要的意思。
  if (query.categoryIds && query.categoryIds.length > 0) {
    q = q.in('category_id', [...query.categoryIds]);
  }

  // 🔴 料號清單。SKU 住在 `product_variants`(子表)⇒ 先解成 product_id 集合再 `.in('id', …)`。
  //    形狀照 categoryIds 那條(呼叫端解好 id 再進來),而**空集合的處置相反** ——
  //    見 `AdminProductQuery.skus` 檔頭:貼了不存在的料號,正確答案是【0 件】不是【全部】。
  //
  //    ⚠️ **多一次往返 DB**,代價我量過(正式庫 `EXPLAIN ANALYZE`):
  //      5 個料號 ⇒ 16ms / 500 個真料號 ⇒ 92ms,走
  //      `Index Scan using product_variants_supplier_sku_key`(Index Cond: `sku = ANY …`)。
  //    🔴 **而我原本預測它吃不到那個索引**(唯一的 sku 索引是 `(supplier_slug, sku)`、sku 排第二)
  //      —— **執行計畫推翻了我的預測**。寫在這裡是因為下一個人也會這樣預測。
  if (query.skus) {
    const productIds = await resolveProductIdsBySkus(query.skus);
    // 空集合 ⇒ 真的查 0 件。`.in('id', [])` 就是這個意思,不要改成「不套用」。
    q = q.in('id', productIds);
  }

  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { items: (data ?? []) as unknown as AdminProductListRow[], total: count ?? 0 };
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

// ── 篩選下拉的選項來源(2026-08-19 品牌/分類篩選片)────────────────────────

/**
 * 品牌與分類的下拉選項。**兩發查詢,不是三發** —— 而「有商品的分類」那一格是靠
 * PostgREST 的**內嵌聚合**在同一發裡拿到的,不另外掃 `products`。
 *
 * 🔴🔴 **plan §7 ⑤ 把這件事列為「未確認」,而它現在【量到了】:**
 *    plan 逐字寫著「PostgREST 嵌入式聚合 `categories?select=…,products(count)` 一發解決,
 *    **而 repo 內零先例** … 那是【我以為它支援】,不是量到的 ⇒ 接線前要實跑一次才算數」。
 *    ⇒ 2026-08-19 依 `docs/runbooks/local-admin-with-real-data-probe.md` 起拋棄式 PG +
 *      **真 PostgREST 14.16**,套 repo 全部 migration(ok=174 / fail=13,而 `products` /
 *      `brands` / `categories` 三張表全在)、用 migration 自己種的**真分類資料**(107 個,
 *      與正式庫同數)實跑:
 *
 *        GET /categories?select=id,products(count)   ⇒ HTTP 200
 *        回傳形狀:{"id": "...", "products": [{"count": 12}]}   ← **陣列包一個物件**
 *        正向對照:REST 算出「有商品的分類」= 41
 *        真值對照:SQL `select count(distinct category_id) from products` = 41   ✅ 相等
 *
 *    ⇒ 🔴 **兩個世界都表演過**:有商品的回正數、沒商品的回 `0`(不是缺欄位、不是 `null`)。
 *    ⚠️ **效度限定(照 runbook §5 不放寬)**:量的是**本機**的 PostgREST 14.16 與**本機**種的
 *      503 件商品,**不是正式站**。它證得了「這個查詢寫法回什麼形狀」,
 *      證不了正式站的效能(plan §0-d 逐字:「效能未量 … 若量出來慢 ⇒ **回報,不自己加快取**」)。
 *
 * 🔴 **`idsWithProducts` 是從資料算的,不得寫死**(plan §0-d 逐字)——
 *    今天 41(本機)/ 81(正式庫),明天同步跑完就變了。
 *
 * 讀取失敗照樣 throw,由呼叫端決定怎麼降級(見 `app/products/page.tsx`)。
 *
 * ⚠️ **天花板(R1 nit-6,刻意不修)**:這兩發都**沒有分頁,也沒有截斷偵測** ——
 *    而同一頁為了 `db-max-rows`(Dashboard 點一下就變小、變小當天不會有東西紅)
 *    特地做了 `detectPageTruncation`(`lib/shared/list-params.ts`)。
 *    今天的量:分類 107 列、品牌 **24** 列(正式庫 / 2026-08-19 / 角色 postgres,W2 量;本機量到 107 / 23)
 *      ~~品牌 16 列~~ ⇒ 🔴 **那個 16 從一開始就不是這一發回的數字**:它是拿 `products` 數出來的
 *      「有商品的品牌數」,而 `from('brands').select(...)` 回的是**整張表**。
 *      ⇒ 這不是「數字過期了」,是**推導方式錯了** —— 改數字不會修好它,要改的是「數哪一張表」。
 *      (而那個 16 正好是本片之後下拉會剩的數量級,所以它讀起來一直很合理。)
 *      —— 離預設上限 1000 很遠
 *    ⇒ **潛在、非現行**,而它壞掉時是**下拉少了幾個選項,完全安靜**。
 *    判別線:**這兩張表任一逼近數百列時回來加一發 `count` 對照**,不是「以後有空再說」。
 */
export interface ProductFilterOptions {
  readonly brands: readonly BrandOptionRow[];
  readonly categories: readonly CategoryOptionRow[];
  readonly categoryIdsWithProducts: ReadonlySet<string>;
  /** 同 `categoryIdsWithProducts`,但對品牌(`MAIN-063` D)。 */
  readonly brandIdsWithProducts: ReadonlySet<string>;
}

/** 內嵌聚合的 wire shape —— **`products` 是陣列包一個 `{count}`**(2026-08-19 實跑量到,見上)。 */
type CategoryOptionWireRow = CategoryOptionRow & {
  readonly products: readonly { readonly count: number }[] | null;
};

/**
 * 品牌側的同一個形狀。
 *
 * 🔴 **量到的是它的【鄰居】,不是它本身。** 兩個證據,關係不同、方向一致:
 *      · `categories` → `products`         既有實測(本檔上方那段,2026-08-19)
 *      · `brands`     → `products_public`   2026-08-19 W2 於正式庫 PostgREST 實打,逐字回:
 *          有商品 `[{"count": 1146}]` / **零商品 `[{"count": 0}]`** ← 不是 `[]`、不是 `null`
 *    ⇒ 一對多內嵌聚合在**本專案的正式 PostgREST** 上,零子列回的是 `[{"count":0}]`
 *      —— ⚠️ **(兩個鄰居皆如此;本條未量)**。這句是從兩個鄰居**推廣**出來的一般命題,
 *      而上一版把它寫成了斷言語氣(W6 `W6-051` F3 nit)。
 * ⚠️ **而 `brands` → `products` 這一條【本身】沒有人量過。** W2 打的是 `products_public`,
 *    因為 `products` 表 anon 讀不到(他實打回 `401 / 42501 permission denied`;
 *    🔴 那個 `GRANT SELECT ON public.products TO anon` **不要去做**,它現在擋著是對的)。
 *    這條路要 `service_role` ⇒ 只有 admin 這條路徑打得到。
 * 📌 要把它升級成「量到」,最便宜的做法是在**這一發**把原始回應 log 出來看一次。
 * ✅ 而 `countOf()` 對三種回法(`[{count:N}]` / `[]` / `null`)**落到同一個結論**
 *    ⇒ 就算鄰居推錯了,行為仍是「這個品牌不進下拉」,不會靜默放行。
 */
type BrandOptionWireRow = BrandOptionRow & {
  readonly products: readonly { readonly count: number }[] | null;
};

/** 內嵌聚合那一格 → 件數。三種回法(`[{count:N}]` / `[]` / `null`)收到同一個結論。 */
function countOf(row: { readonly products: readonly { readonly count: number }[] | null }): number {
  return row.products?.[0]?.count ?? 0;
}

export async function listProductFilterOptions(): Promise<ProductFilterOptions> {
  const supabase = createSupabaseServiceClient();
  const [brands, categories] = await Promise.all([
    supabase.from('brands').select('id, name, products(count)'),
    supabase
      .from('categories')
      .select('id, name, raw_path, parent_category_id, sort_order, products(count)'),
  ]);

  if (brands.error) throw brands.error;
  if (categories.error) throw categories.error;

  const rows = (categories.data ?? []) as unknown as CategoryOptionWireRow[];
  const idsWithProducts = new Set<string>();
  for (const row of rows) {
    // 🔴 `?? 0` 不是防禦性寫法:實跑量到沒商品時回的是 `[{count: 0}]`,
    //    而「查無列」與「count 為 0」在這裡要落到**同一個結論**(這個分類不進下拉)。
    if (countOf(row) > 0) idsWithProducts.add(row.id);
  }

  const brandRows = (brands.data ?? []) as unknown as BrandOptionWireRow[];
  const brandIdsWithProducts = new Set<string>();
  for (const row of brandRows) {
    if (countOf(row) > 0) brandIdsWithProducts.add(row.id);
  }

  return {
    brands: brandRows,
    categories: rows,
    categoryIdsWithProducts: idsWithProducts,
    brandIdsWithProducts,
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
