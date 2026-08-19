import type { ProductSetByFilter } from './product-repository';

// product-list-view.ts — 商品列表的**網址狀態**:解析 `?set_by=` / `?q=` / `?page=`,以及組回連結。
//
// 🔴 **為什麼要有這支檔(`#661` §0-a)**:在它之前,網址是**各組各的** ——
//    `product-filter-chips.tsx` 自己拼 `/products?set_by=…&page=1`,
//    而 `app/products/page.tsx:106` 的分頁 `buildHref` 逐字只寫
//    `` (p) => (p <= 1 ? '/products' : `/products?page=${p}`) `` ⇒ **它把 `set_by` 丟掉了**。
//    症狀:員工按「手動」→ 按「下一頁」⇒ 回到全部商品的第 2 頁,而 chip 高亮跳回「全部」。
//    ⇒ 本檔是**唯一組網址的地方**,三個呼叫端(chip / 分頁 / 搜尋框)全部走它。
//    形狀對照 orders 那一面既有的 `buildOrderListHref`(`lib/orders/order-list-view.ts:664`),不發明。
//
// 🔴 **搜尋詞走網址、不走 cookie —— 這是刻意的,理由與 orders/customers 相反**:
//    那兩面用 cookie + PRG,而**整套機制的前提是「搜尋詞是 PII」**
//    (`lib/orders/keyword-search-action.ts:19,26` 逐字「搜尋詞不進 URL」「絕不落 log」;
//     `lib/customers/keyword-search-action.ts:52-57` 白名單擋 `?q=王小明` 進 URL/log/Referer)。
//    **商品搜尋打的是料號 / 商品名 / 品牌 —— 不是 PII,那個前提不成立。**
//    而**網址派本來就是這一頁自己的模型**(`product-filter-chips.tsx:11` 逐字
//    「選中態靠網址不靠 state」)⇒ 在這一頁上 cookie 派才是不一致的那個。
//    ⚠️🔴 **解除條件(這句是這個決定的出口,不要刪)**:
//    若日後商品搜尋要支援「**用客人姓名/電話反查他買過什麼**」⇒ **那一刻起搜尋詞就是 PII**
//    ⇒ 必須改回 cookie + PRG。**判別句:這個輸入框收得到人名或電話嗎?**

export const SET_BY_PARAM = 'set_by';
export const KEYWORD_PARAM = 'q';
export const PAGE_PARAM = 'page';
export const SIZE_PARAM = 'size';
export const BRAND_PARAM = 'brand';
export const CATEGORY_PARAM = 'category';
/**
 * 子分類的 param。**只有【表單送出】時會出現在網址上,`buildProductListHref` 永遠不產生它。**
 *
 * 🔴 **為什麼需要第二個 param(而不是兩顆下拉共用 `?category=`)**:
 *    HTML 表單對**同名欄位**的行為是「兩個都送」⇒ `?category=大類&category=子類`
 *    ⇒ Next 把它解析成**陣列** ⇒ `parseProductCategoryPath` 對陣列回 `undefined`
 *    ⇒ 🔴 **篩選整個失效,而畫面上沒有任何異常**(下拉還顯示著你選的東西)。
 *    零 JS 的前提下沒辦法在送出前關掉其中一個 ⇒ **改成兩個名字**。
 *
 * 🔴 **而它不進 `AdminProductFilter`** —— 分類在查詢層**只有一軸**(`categoryPath`),
 *    因為 `raw_path` 本身(`'引擎部品 · 排氣管'`)已經含著大類 ⇒ 不需要記兩個值。
 *    ⇒ `parseProductListParams` 讀 `subcategory ?? category`(子的優先),
 *      而產生連結時一律只寫 `?category=<raw_path>` ⇒ **網址是正規化的、只有一種寫法**。
 */
export const SUBCATEGORY_PARAM = 'subcategory';

/**
 * 每頁筆數的**白名單**。🔴 **不收任意整數** —— 這個值會直接變成 `.range()` 的頁大小。
 *
 * 🔴🔴 **為什麼封頂 1000 而不是 2000(下一個人一定會問,所以答案寫在這裡)**:
 *    分頁準則 1(`docs/patterns/pagination-loop-review.md` §1)要求頁大小**嚴格小於**
 *    伺服器的 `db-max-rows`,而該檔量到的現值是 **2000**
 *    (V 窗 2026-08-18:`products?select=id&limit=5000` ⇒ 206、`content-range: 0-1999/19777`)。
 *    ⇒ 放 2000 = **零餘裕**,而該段逐字說那是「現在能動、伺服器一調就死」。
 *    ⇒ 1000 留了一倍餘裕。
 * ⚠️ **而那個 2000 是二手的**(該檔自陳「主視窗與 I 窗均未自驗」)⇒ 本片**不靠它**:
 *    真正的守門是 `detectPageTruncation()`(`lib/shared/list-params.ts`),它不讀任何上限設定。
 *
 * 下緣 20 = 改造前的既有值(`PRODUCTS_PAGE_SIZE`),留著讓習慣舊畫面的人回得去。
 */
export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500, 1000] as const;

/**
 * 預設每頁筆數。
 *
 * Sean 逐字規格:「**單頁要能看到 200-500 以上**」⇒ 預設踩在他講的範圍**下緣**。
 * (20,341 件 ÷ 200 = 102 頁;改造前是 20 筆 ⇒ 1,018 頁。)
 * **不預設 1000** 的理由 = 那個量級的 DOM 成本,見 plan §6;而 1000 仍然選得到。
 */
export const DEFAULT_PAGE_SIZE = 200;

/** 網址能表達的商品列表篩選狀態。**加一軸就要同時改 `buildProductListHref`,由型別強制。** */
export interface AdminProductFilter {
  /** `?set_by=`;`undefined` = 不篩。 */
  readonly setBy: ProductSetByFilter | undefined;
  /** `?q=`;`undefined` = 沒搜尋(**不是搜尋空字串**)。已 trim,不會是空字串。 */
  readonly keyword: string | undefined;
  /**
   * `?brand=`;品牌的 uuid。`undefined` = 不篩。
   *
   * 🔴 **必為合法 uuid 字面** —— 見 `parseProductBrandId`,那不是潔癖:
   *    這個值會直接進 `.eq('brand_id', …)`,而 PostgREST 對非 uuid 回 **400**
   *    (2026-08-19 對本機真 PostgREST 14.16 實測:`brand_id=eq.notauuid`
   *     ⇒ `{"code":"22P02", … invalid input syntax for type uuid}` / HTTP 400)
   *    ⇒ 沒擋的話,員工把網址的品牌 id 改壞 = **整頁「商品列表載入失敗」**。
   *    這與 `#661` 分頁片那個 must-fix(`?page=1e21` 變錯誤頁)是**同一個病**。
   */
  readonly brandId: string | undefined;
  /**
   * `?category=`;分類的 `raw_path`(例 `'引擎部品 · 排氣管'`)。`undefined` = 不篩。
   *
   * 🔴 **用 `raw_path` 不用 id,是刻意的**:`raw_path` 在 DB 上 UNIQUE、人看得懂,
   *    而網址裡出現 `?category=引擎部品 · 排氣管` 比一串 uuid 更能被員工分享與檢查。
   *    認不得的 `raw_path` 由 `resolveCategoryIds` 回 `null` ⇒ **不套用分類條件**
   *    (看到全部,不是看到空的)⇒ 本層不需要白名單,**而 `brandId` 需要**:
   *    差別在 `raw_path` 是 text 欄、亂值只會查無,`brand_id` 是 uuid 欄、亂值會 400。
   */
  readonly categoryPath: string | undefined;
}

/**
 * 網址能表達的**檢視**狀態(「怎麼看」,不是「篩什麼」)。
 *
 * 🔴🔴 **為什麼 `size` 不放進 `AdminProductFilter`** —— 這是本片唯一一個設計層的決定:
 *    `AdminProductFilter` 的每一軸都會變成一個 **DB where 條件**(`.eq` / `.or`);
 *    `page` 與 `size` 一個都不是,它們決定的是 `.range()`。
 *    混在一起會有兩個具體後果:
 *      ① 型別說謊 —— 之後有人照著 `keyof AdminProductFilter` 去組 where,會撈到 `size`。
 *      ② 🔴 **`buildProductListHrefResetPage` 會被污染** —— 換篩選要重設 `page`,
 *         **但絕不該重設 `size`**(員工把每頁調成 500,按一下「手動」就跳回 200 = 改動消失)。
 */
export interface AdminProductView {
  /** `?page=`;1-indexed,已下界 1。 */
  readonly page: number;
  /** `?size=`;必為 `PAGE_SIZE_OPTIONS` 之一。 */
  readonly size: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `?page=` 解析。🔴 只收正整數;`?page=a&page=b` 會被 Next 解析成**陣列** ⇒ 當作沒給。
 * (原本住在 `app/products/page.tsx`,搬過來是為了與 `buildProductListHref` 一起被往返測試釘住。)
 */
/**
 * `?page=` 的**上界**。
 *
 * 🔴🔴 **為什麼需要它(2026-08-19 審查 must-fix)**:本函式原本只有下界。
 *    而 `Number.isInteger(1e21) === true` ⇒ **`?page=1e21` 整個過關**,
 *    然後 `offset = (1e21 - 1) * 200`,而 postgrest-js 送出時用的是樣板字串
 *    (`PostgrestTransformBuilder.ts:526` 逐字 `searchParams.set(keyOffset, \`${from}\`)`)
 *    ⇒ JS 對 ≥1e21 的數字轉字串會給 **`"2e+23"`** 這種指數形 ⇒ 伺服器不收
 *    ⇒ `app/products/page.tsx` 的 try/catch 接住 ⇒ **畫面變成「商品列表載入失敗」**。
 *
 * 🔴 **而判準是這支檔自己寫的**(下方 `parseProductSetBy` 與 `parseProductPageSize` 的檔頭逐字):
 *    「網址是使用者可以手改的,亂改的後果應該是【看到全部/預設的樣子】而不是一頁錯誤」、
 *    「更不是把 `?size=999999` 送進 `.range()`」。
 *    ⇒ **`size` 有白名單擋著,`page` 沒有 —— 同一支檔、同一個原則,只守了一半。**
 *
 * 🔴 **上界取 1e12,而那個數字是【被既有測試逼出來的】,不是我挑的**:
 *    `app/products/page.test.tsx` 的 `N5` 已經釘住「`?page=999999999` 算出的 offset 是**安全整數**」,
 *    而真正的約束有兩條,兩條都要滿足:
 *      ① `String(offset)` 不得是指數形(JS 在 ≥1e21 轉指數)⇒ offset < 1e21
 *      ② `offset` 必須是 **safe integer**(既有 N5 斷言的就是這個)⇒ offset ≤ 9.007e15
 *    最大每頁 1000 ⇒ `offset_max = (MAX_PAGE - 1) × 1000`
 *    ⇒ 1e12 ⇒ offset_max ≈ **1e15**,同時滿足①②,而且**離 1e9 那個既有測試還有三個數量級**
 *    ⇒ **`?page=999999999` 的行為一個字都沒變**(它 < 1e12 ⇒ 不被 clamp)。
 *    ⚠️ 我原本寫 1e7 —— 那會把 `N5` 那格弄紅,而**那格紅掉不是進步,是我改掉了一個刻意的行為**。
 * ⚠️ 超過上界是 **clamp 不是歸 1**:`?page=999`(總共 102 頁)這種「超界但合理」的網址,
 *    既有行為就是顯示空頁 + 可以退回(`lib/shared/list-params.ts` 的 `computePagination` 檔頭),
 *    歸 1 會把那個刻意的行為一起改掉。
 */
export const MAX_PAGE = 1_000_000_000_000;

export function parseProductPage(value: string | string[] | undefined): number {
  if (typeof value !== 'string') return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

/**
 * `?size=` 解析。**白名單**,認不得的值(含 3000 / `abc` / 陣列 / 缺)→ `DEFAULT_PAGE_SIZE`。
 *
 * 🔴 與 `parseProductSetBy` 同一條理由:網址是使用者可以手改的,
 *    亂改的後果應該是「看到預設的樣子」而不是一頁錯誤 —— **更不是把 `?size=999999` 送進 `.range()`**。
 */
export function parseProductPageSize(value: string | string[] | undefined): number {
  if (typeof value !== 'string') return DEFAULT_PAGE_SIZE;
  const n = Number(value);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/**
 * `?set_by=` 解析。**白名單,不是直接轉型** ——
 * 🔴 這個值會被送進 `.eq('listing_set_by', …)`;不過白名單等於讓網址決定查詢條件。
 * 認不得的值(含陣列)→ `undefined` = 不篩,**不是報錯**:網址是使用者可以手改的,
 * 亂改的後果應該是「看到全部」而不是一頁錯誤。
 */
export function parseProductSetBy(
  value: string | string[] | undefined,
): ProductSetByFilter | undefined {
  if (value === 'staff' || value === 'sync') return value;
  return undefined;
}

/**
 * `?q=` 解析。
 *
 * 🔴 **trim 之後是空字串 ⇒ `undefined`(= 沒搜尋),不是「搜尋空字串」。**
 *    差別是實質的:空字串若被當成搜尋詞送進 `ilike '%%'`,那會**比對到每一列**
 *    —— 結果看起來跟「沒搜尋」一樣,而**分頁列的「共 N 件」也一樣** ⇒ 兩個世界印同一個畫面,
 *    於是「搜尋沒生效」這件事永遠不會被任何人發現。
 * 🔴 **上限 100 字元**:再長對比對結果沒有意義,而它會進網址、進 server log 的 URL 欄。
 *    超過就截斷,不報錯(同上,網址是使用者可以手改的)。
 */
export function parseProductKeyword(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  // 🔴 `Array.from(...)` 而不是 `slice(0, 100)`(`#661` R1 nit-1,GR 抓到):
  //    `slice` 切的是 **UTF-16 code unit** ⇒ 100 的邊界可能切在一個 emoji 的
  //    surrogate pair 中間 ⇒ 產出**孤兒 surrogate**,而 `encodeURIComponent` 對它會 throw
  //    ⇒ 整頁 500。`Array.from` 走的是 code point,切不斷。
  const trimmed = Array.from(value.trim()).slice(0, 100).join('');
  return trimmed === '' ? undefined : trimmed;
}

/**
 * `?brand=` 解析。**uuid 白名單**,認不得的值(含陣列)→ `undefined` = 不篩。
 *
 * 🔴 **理由是量到的,不是防禦性寫法**:這個值直接進 `.eq('brand_id', …)`,
 *    而非 uuid 會讓 PostgREST 回 **400**(2026-08-19 本機真 PostgREST 14.16 實測,
 *    見 `AdminProductFilter.brandId` 的檔頭)⇒ `app/products/page.tsx` 的 try/catch 接住
 *    ⇒ **畫面變成「商品列表載入失敗」**,而員工只是把網址改壞了。
 *    ⇒ 同 `parseProductSetBy` 的原則:亂改網址的後果是「看到全部」,不是一頁錯誤。
 *
 * ⚠️ **這道只驗【形狀】不驗【存在】** —— 一個格式正確但不存在的品牌 id 會查到 0 件。
 *    那是對的:查無結果與錯誤頁是兩件事,而「這個品牌沒有商品」本來就是一個合法的答案。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseProductBrandId(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  return UUID_RE.test(value) ? value : undefined;
}

/**
 * `?category=` 解析:分類的 `raw_path`。
 *
 * 🔴 **不在這一層做白名單** —— 合法的 `raw_path` 集合要查 DB 才知道,而本檔是純函式層。
 *    白名單發生在 `resolveCategoryIds`(`product-taxonomy-options.ts`):它比對**已經撈下來的
 *    分類清單**,認不得就回 `null` ⇒ 呼叫端不套用分類條件。
 *    ⇒ 本層只做兩件不需要 DB 的事:trim,以及長度上限。
 *
 * 上限 200 字元:`raw_path` 是 `'大類 · 子類'`,實際最長遠低於此
 *    (2026-08-19 對本機拋棄式庫的**真 migration 種子分類**量到最長 **21** 字元;
 *     ⚠️ 那是本機的量測值、不是正式庫的 —— 上限 200 留了近十倍餘裕,結論不靠這個數字精確)。
 *    它會進網址與 server log 的 URL 欄
 *    ⇒ 截斷而不報錯(同 `parseProductKeyword`)。
 *    🔴 `Array.from` 而非 `slice`:理由同 `parseProductKeyword` —— `slice` 切 UTF-16 code unit,
 *    會在 surrogate pair 中間切斷、產出孤兒 surrogate,而 `encodeURIComponent` 對它會 throw。
 *    分類名是中文,**中文在 BMP 內不會踩到**,但這條路徑不該靠「現在的資料剛好安全」。
 */
export function parseProductCategoryPath(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = Array.from(value.trim()).slice(0, 200).join('');
  return trimmed === '' ? undefined : trimmed;
}

/**
 * 分隔 `raw_path` 層級的字串。**值抄自 DB 的字面**
 * (`supabase/migrations/20260505130758_init_brands_categories.sql:38-47` 的 `raw_path` 註解,
 *  例 `'引擎部品 · 排氣管'`);顧客站同一個常數在
 *  `apps/storefront/src/components/products-filter-logic.ts:18` `CATEGORY_PATH_SEP`。
 *
 * 🔴 **不 import 顧客站那支** —— 照 `product-taxonomy-options.ts` 檔頭那條既有紀律
 *    (「不是重用元件,是照抄做法」);那支綁死 storefront 的型別。
 *
 * 🔴🔴 **而「子類的 raw_path 一定以父的 raw_path + 這個分隔符開頭」不是我的假設,是既有契約**
 *    (`resolveCategoryPath` 的前綴比對整個踩在它上面,所以依據寫在這裡):
 *    · `scripts/rpm-import.ts:166-171` 逐字 ——「每群依 major_category_v2_zh +
 *      sub_category_v2_zh 組麵包屑 raw_path『大類 · 子類』解析到『子類』id」,
 *      同段並逐字聲明「🔴 分隔符 ' · ' 須與 seed raw_path + storefront
 *      products-filter-logic.ts CATEGORY_PATH_SEP **三處一致**」。
 *    · `supabase/migrations/20260505130758_init_brands_categories.sql:42` 欄位註解逐字
 *      「例:'引擎部品 · 排氣管'(根→葉路徑、design 字面)」。
 *    ⇒ 本檔是那個「三處一致」的**第四處**。
 * ⚠️ **而它就是四份拷貝**:DB 哪天改了分隔符,四邊都要改,而**不會有任何東西紅**。
 *
 * 🔴 **兩個判別句,不是一個**(R2 nit-B:我原本只寫了第一個,而承重的是第二個):
 *    ① 分隔符漂移 —— **`raw_path` 的長相變了嗎?**
 *    ② 🔴 **子類的 `raw_path` 還是父親的前綴嗎?**
 *       （某一列 `parent_category_id` 對、但 `raw_path` 沒照「父 · 子」慣例 ⇒ 前綴比對認不出它。)
 *    ⇒ 現在有**兩套**「誰是誰的子類」的定義在跑:本函式用**字串前綴**,
 *      而 `buildCategoryOptions` / `resolveCategoryIds` / 篩選元件用 **`parent_category_id`**。
 *      兩者分岔的症狀與剛修掉的那個 bug 同一類:**子分類選了等於沒選,而畫面完全正常。**
 *
 * ✅ **今天成立,而且是量到的**(寫下來,免得下一個人再量一次):對 seed migration
 *    `20260712120000_seed_taxonomy_v2_categories.sql` 全量比對
 *    `raw_path == 父的 raw_path + ' · ' + name` ⇒ **78 列子類、違反 0**
 *    (78 對得上正式庫量到的子類數);大類名字**含分隔符的 = 0** ⇒ 誤殺路徑構造不出來。
 *    且 `categories` 全樹零 `.insert(` / `.upsert(` ⇒ **只有 migration 寫得進去**,
 *    沒有第二個寫入者會繞過慣例。
 *    ⚠️ **效度限定**:量的是 **migration 原始碼**,不是正式庫那 107 列 ——
 *      要讓它不成立,得有人手動改過 DB,而**那條路我量不到**。
 * ⚠️ **失效時的症狀(先寫下來)**:某個子類的 `raw_path` 若不以父的開頭,
 *    選它會**靜默落回大類**(看到的是更寬的一批,不是錯誤)——
 *    而下拉上大類會顯示成選中,子分類顯示「全部子分類」⇒ 畫面自洽、不會有人回報。
 */
const CATEGORY_PATH_SEP = ' · ';

/**
 * 大類 + 子類兩個欄位 → **一個**分類路徑。
 *
 * 🔴🔴 **不是單純的「子的優先」(`sub ?? top`)—— 那是 R1 審查抓到的 must-fix。**
 *    零 JS 表單會把**兩顆下拉都送出去**,包含**員工沒有動過的那一顆**。
 *    ⇒ 網址停在某個子類時,員工去改「分類」那顆:
 *      送出的是 `?category=服務與其他&subcategory=引擎部品 · 排氣管`
 *      ⇒ `sub ?? top` 讓**舊的子類**勝 ⇒ **清單一筆沒變,而大類下拉又跳回原本那個**。
 *    ⇒ 第二個症狀更糟:選中子類時,「分類 → 全部分類」**清不掉篩選**。
 *
 * 🔴 **這與本檔檔頭那個病是同一個母題的【反方向】**:檔頭防的是「那一軸被靜默洗掉」,
 *    這裡是「那一軸被舊值靜默蓋過去」。**兩個方向都會讓畫面上的選擇與實際查詢不一致**,
 *    而窮舉守門只看得到「有沒有做過決定」,看不到決定對不對。
 *
 * ⇒ 規則:**`sub` 只在它真的是 `top` 的子孫時才勝出**(前綴比對,對齊顧客站
 *   `products-filter-logic.ts:63-74` 的 `matchesCategory`:子類=全等、大類=前綴)。
 *   `top` 不存在時 `sub` 一定不是它的子孫 ⇒ 一律回 `top`(= 不篩)。
 */
function resolveCategoryPath(
  top: string | undefined,
  sub: string | undefined,
): string | undefined {
  // 📌 R2 nit-C 留痕:`top === undefined` 時一律回 `undefined`,
  //    ⇒ `?subcategory=X` 單獨出現(不帶 `category`)不再生效。
  //    ~~這條路**不可達**~~ ⇒ 🔴 **2026-08-19 起可達**(W6 `W6-046` 順帶抓到):
  //    篩選改成「選了就自動送出」之後,把大類選回「全部分類」而子分類下拉還停在 A1 的那一瞬間
  //    就會送出 `?category=&subcategory=A1` ⇒ 空字串被解析成 `undefined` ⇒ 走到這條分支。
  //    **結果仍然正確**(回 `undefined` = 不套用分類條件),改的只是那句「沒有真實入口」——
  //    留著它會讓下一個人以為這條分支沒人走,而它現在每天都有人走。
  if (top === undefined || sub === undefined) return top;
  return sub.startsWith(top + CATEGORY_PATH_SEP) ? sub : top;
}

/** 一次把網址參數解析成型別化的狀態。 */
export function parseProductListParams(raw: SearchParams): {
  filter: AdminProductFilter;
  view: AdminProductView;
} {
  return {
    filter: {
      setBy: parseProductSetBy(raw[SET_BY_PARAM]),
      keyword: parseProductKeyword(raw[KEYWORD_PARAM]),
      brandId: parseProductBrandId(raw[BRAND_PARAM]),
      categoryPath: resolveCategoryPath(
        parseProductCategoryPath(raw[CATEGORY_PARAM]),
        parseProductCategoryPath(raw[SUBCATEGORY_PARAM]),
      ),
    },
    view: {
      page: parseProductPage(raw[PAGE_PARAM]),
      size: parseProductPageSize(raw[SIZE_PARAM]),
    },
  };
}

type HrefEntry = readonly [param: string, value: string | undefined];

/**
 * 組商品列表連結。**這是唯一組它的地方。**
 *
 * 🔴🔴 **編譯期窮舉守門**(照 `buildOrderListHref` 的既有做法,`order-list-view.ts:683-689`):
 *    型別是 `Record<keyof AdminProductFilter, HrefEntry>` ⇒ **`AdminProductFilter` 加一軸
 *    而這裡沒列,`tsc` 直接紅**。在 orders 那面,這道守門是在**同一個坑踩過兩次之後**才裝的
 *    (那兩次的症狀逐字:「翻頁時那一軸靜默消失、畫面上的選擇還在」)——
 *    本檔一出生就帶著它,理由是本頁**已經在流血**(見檔頭)。
 *    ⚠️ 這道**只保證「每個軸都被做過決定」**,保證不了那個決定是對的:
 *      對到錯的 param 名、或該帶卻寫 `undefined`,型別一樣過。那半靠往返測試。
 */
export function buildProductListHref(
  filter: AdminProductFilter,
  view: AdminProductView,
): string {
  const byFilterKey: Record<keyof AdminProductFilter, HrefEntry> = {
    setBy: [SET_BY_PARAM, filter.setBy],
    keyword: [KEYWORD_PARAM, filter.keyword],
    brandId: [BRAND_PARAM, filter.brandId],
    categoryPath: [CATEGORY_PARAM, filter.categoryPath],
  };

  // 🔴🔴 **第二道窮舉守門(2026-08-19 新增),而它同時關掉一個既有缺口。**
  //    在它之前,`page` 是函式尾端一個**裸 `if`** —— 不受任何守門管;
  //    ⇒ 加 `size` 這一軸時若照抄那個形狀,就會有**兩個沒人看著的軸**,
  //      而症狀正是本檔頭寫的那一種:「翻頁時那一軸靜默消失,而畫面上的選擇還在」。
  //    ⇒ 把 `page` 一起收編進來:**`AdminProductView` 加一軸而這裡沒列,`tsc` 直接紅**。
  //    ⚠️ 同檔頭那條限定照樣適用:這道只保證「每個軸都被做過決定」,
  //       保證不了那個決定是對的(對到錯的 param 名一樣過)—— 那半靠往返測試。
  const byViewKey: Record<keyof AdminProductView, HrefEntry> = {
    // 🔴 第 1 頁不寫 `page=1`:網址短、可讀,而且與既有行為**逐字一致**
    //    (原 `buildHref` 逐字 `p <= 1 ? '/products' : …`)。
    page: [PAGE_PARAM, view.page > 1 ? String(view.page) : undefined],
    // 🔴 預設筆數不寫進網址,理由同上;而它也讓「沒選過」與「選了預設值」產生同一個網址
    //    ⇒ 書籤與分享出去的連結不會把一個【當時的預設值】凍在裡面。
    size: [SIZE_PARAM, view.size === DEFAULT_PAGE_SIZE ? undefined : String(view.size)],
  };

  const params = new URLSearchParams();
  for (const [param, value] of [
    ...Object.values(byFilterKey),
    ...Object.values(byViewKey),
  ]) {
    if (value !== undefined) params.set(param, value);
  }

  const qs = params.toString();
  return qs === '' ? '/products' : `/products?${qs}`;
}

/**
 * 換篩選 / 換搜尋詞時用的連結:**`page` 一律回 1**。
 *
 * 🔴 理由與 `product-filter-chips.tsx:16` 既有那條同源:換條件卻停在第 3 頁,
 *    常常直接看到空白頁 —— 而那看起來像「查無結果」,不像「你還在第 3 頁」。
 */
export function buildProductListHrefResetPage(
  filter: AdminProductFilter,
  size: number,
): string {
  // 🔴 `page` 回 1、而 **`size` 原封不動帶著走**(見 `AdminProductView` 檔頭那條理由 ②):
  //    員工把每頁調成 500 之後按一下「手動」,不該跳回 200。
  return buildProductListHref(filter, { page: 1, size });
}
