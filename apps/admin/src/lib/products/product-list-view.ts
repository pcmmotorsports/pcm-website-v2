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

/** 一次把三個網址參數解析成型別化的狀態。 */
export function parseProductListParams(raw: SearchParams): {
  filter: AdminProductFilter;
  view: AdminProductView;
} {
  return {
    filter: {
      setBy: parseProductSetBy(raw[SET_BY_PARAM]),
      keyword: parseProductKeyword(raw[KEYWORD_PARAM]),
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
