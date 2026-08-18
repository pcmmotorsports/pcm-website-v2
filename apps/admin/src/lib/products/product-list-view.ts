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

/** 網址能表達的商品列表篩選狀態。**加一軸就要同時改 `buildProductListHref`,由型別強制。** */
export interface AdminProductFilter {
  /** `?set_by=`;`undefined` = 不篩。 */
  readonly setBy: ProductSetByFilter | undefined;
  /** `?q=`;`undefined` = 沒搜尋(**不是搜尋空字串**)。已 trim,不會是空字串。 */
  readonly keyword: string | undefined;
}

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `?page=` 解析。🔴 只收正整數;`?page=a&page=b` 會被 Next 解析成**陣列** ⇒ 當作沒給。
 * (原本住在 `app/products/page.tsx`,搬過來是為了與 `buildProductListHref` 一起被往返測試釘住。)
 */
export function parseProductPage(value: string | string[] | undefined): number {
  if (typeof value !== 'string') return 1;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
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
  page: number;
} {
  return {
    filter: {
      setBy: parseProductSetBy(raw[SET_BY_PARAM]),
      keyword: parseProductKeyword(raw[KEYWORD_PARAM]),
    },
    page: parseProductPage(raw[PAGE_PARAM]),
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
export function buildProductListHref(filter: AdminProductFilter, page: number): string {
  const byFilterKey: Record<keyof AdminProductFilter, HrefEntry> = {
    setBy: [SET_BY_PARAM, filter.setBy],
    keyword: [KEYWORD_PARAM, filter.keyword],
  };

  const params = new URLSearchParams();
  for (const [param, value] of Object.values(byFilterKey)) {
    if (value !== undefined) params.set(param, value);
  }
  // 🔴 第 1 頁不寫 `page=1`:網址短、可讀,而且與既有行為一致
  //    (原 `buildHref` 逐字 `p <= 1 ? '/products' : …`)。
  if (page > 1) params.set(PAGE_PARAM, String(page));

  const qs = params.toString();
  return qs === '' ? '/products' : `/products?${qs}`;
}

/**
 * 換篩選 / 換搜尋詞時用的連結:**`page` 一律回 1**。
 *
 * 🔴 理由與 `product-filter-chips.tsx:16` 既有那條同源:換條件卻停在第 3 頁,
 *    常常直接看到空白頁 —— 而那看起來像「查無結果」,不像「你還在第 3 頁」。
 */
export function buildProductListHrefResetPage(filter: AdminProductFilter): string {
  return buildProductListHref(filter, 1);
}
