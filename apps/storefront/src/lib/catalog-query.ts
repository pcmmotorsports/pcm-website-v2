// 🔴 `'new'` 於 2026-08-11 #269-b 段二加入 —— 在那之前它列在 UI(`sort-options.ts`)卻不在這裡,
//    ⇒ 客人選「最新上架」會被靜默回退成 recommend、畫面完全沒變。守門見 `catalog-query.test.ts`。
//    server 端真正做得到它,是因為 migration `20260811040000` 讓 RPC 支援 `p_sort='new'`
//    (依 `created_at DESC`)。**這一行與那支 migration 是綁在一起的**:RPC 若被 rollback,這裡要一起退。
// 🔵 上限本體住在 `search-shape.ts`(client 也讀得到)—— **同一個常數**餵顯示端與查詢端。
import { SEARCH_MAX_QUERY_LENGTH } from './search-shape';

export const CATALOG_SORT_VALUES = ['recommend', 'price-asc', 'price-desc', 'new'] as const;

/**
 * `?filter=` 白名單。今天只有 `new`(新品)。
 *
 * 🔴 在 #269-b 段二之前,`?filter=` **全站沒有任何地方在讀** —— 導覽列/頁尾/麵包屑/首頁四個
 *   入口都指向 `/products?filter=new`,按下去等於未篩選的全目錄(backlog #269)。
 */
export const CATALOG_FILTER_VALUES = ['new'] as const;
export type CatalogFilter = (typeof CATALOG_FILTER_VALUES)[number];

/**
 * 「新品」的視窗天數 —— Sean 2026-08-11 `Q15b = rolling 近 7 天`(不是自然週)。
 *
 * ⚠️ 實測:照這個視窗,**有 44% 的日子完全沒有商品**(2026-06-01~08-11 模擬 72 天、
 *   排除批次日後 32 天為 0、平均 10.2 件)。Sean 看過這個數字後仍選 7 天,
 *   並拍 `Q20 = C 形狀`:**空的時候自動退回顯示最近上架**(見 `products.ts` 的退回邏輯),
 *   且明示**不要過度設計** —— 不加模式標示、不加說明文案。
 */
export const NEW_ARRIVAL_WINDOW_DAYS = 7;
export const CATALOG_PER_PAGE_VALUES = [25, 50, 75, 100] as const;
/**
 * 每頁筆數預設(Sean 2026-07-31:25 → 50)。
 * 🔴 單一定義點:client 的 `products-url-state.DEFAULT_PER_PAGE` 也讀這個常數 ——
 *    兩邊各寫一個數字時,沒帶 `?per=` 的網址會變成「server 給 25 筆、client 以為一頁 50 筆」
 *    ⇒ 總頁數與「顯示第 X-Y 筆」全錯。
 */
export const CATALOG_DEFAULT_PER_PAGE = 50;

export type CatalogSort = (typeof CATALOG_SORT_VALUES)[number];

export type CatalogQuery = {
  page: number;
  perPage: number;
  sort: CatalogSort;
  brandSlugs: string[];
  category?: string;
  /**
   * ⟦M-4b 多顆分類膠囊⟧ Sean 2026-09-04 拍甲(聯集)。`?categories=a,b` —— **單鍵逗號分隔**。
   * 🔵 形狀跟著 `pbrands` 走, 而那是有理由的:本檔 `BRANDS_PARAM` 上方那段註解逐字記著重複鍵 `?a=1&a=2` 會讓
   *    **Next segment cache key 碰撞 ⇒ `router.replace` 不重抓 RSC** ⇒ 當初才從重複鍵改單鍵。
   *    📌 同一個坑不踩第二次。
   * 🛑 **舊的 `category` 欄不動、繼續讀得懂** —— 客人分享出去的連結、站內既有連結都是舊格式。
   *    兩個同時出現時:`categories` 贏(它是新的、明確的), 而舊值**仍然被收進聯集**, 不丟掉。
   */
  categories: string[];
  priceMin?: number;
  priceMax?: number;
  vehicle?: string;
  /**
   * `?filter=new` ⇒ 只看新品。
   * 🔴 **這裡刻意存「filter」而不是算好的時間戳**:`CatalogQuery` 會被 `JSON.stringify` 當成
   *   `unstable_cache` 的鍵(`products.ts`),放時間戳進去等於每次請求都是新鍵、快取全失效。
   *   真正的 `p_new_since` 在 `products.ts` 的 cached callback 內才算(見該處)。
   */
  filter?: CatalogFilter;
  /**
   * `?search=` 自由關鍵字(⟦搜尋-落點換 /products⟧ 2026-09-03,Sean 逐字
   * 「我以為搜尋會直接在我們商品目錄顯示誒」)。
   *
   * 🔴🔴 **它與其他每一格【不同層】,而那個差別是這一整片的根**:
   *    其他格都送進 RPC `search_catalog_by_vehicle`,而**那支沒有關鍵字參數** ——
   *    10 個 migration 定義檔掃 `p_(keyword|search|q)`/`ILIKE` ⇒ 全 0
   *    (🟢 正對照同一批檔掃 `p_vehicle|p_brand|p_category` ⇒ 3~25 命中 ⇒ 尺是活的)。
   * ⇒ 📌 有 `search` 時 route 走**另一條資料路**(`lib/search.ts` 的 ILIKE),
   *    而那條路**吃不到 facet**。
   * 🛑 **所以它不能像其他格那樣靜靜地被塞進 query 就算數** ——
   *    呼叫端要把「現在是關鍵字結果、facet 沒生效」**畫在畫面上**
   *    (`SearchKeywordChip`)。理由是 2026-09-02 那個拍板的逐字:
   *    **「一個看得見的缺,永遠優於一個安靜的錯」**。
   */
  search?: string;
};

const PRICE_LABEL_BOUNDS: Record<string, readonly [number, number | null]> = {
  'NT$ 0 – 3,000': [0, 3000],
  'NT$ 3,000 – 10,000': [3000, 10000],
  'NT$ 10,000 – 30,000': [10000, 30000],
  'NT$ 30,000 – 100,000': [30000, 100000],
  'NT$ 100,000 以上': [100000, null],
};

export function priceBoundsForLabel(label: string | null): readonly [number, number | null] | null {
  return label ? PRICE_LABEL_BOUNDS[label] ?? null : null;
}

type SearchParamsLike = Pick<URLSearchParams, 'get' | 'getAll'>;

/**
 * `?category=` 可接受的字面白名單(單一定義點)。
 *
 * 🔴 #306:facet 取數端(`api/catalog/facet-counts`)與點擊後的列表端必須用**同一道**白名單 ——
 *   否則會出現「面板算得出數字、但點進去那個 `?category=` 被這裡靜默丟掉 ⇒ 看到未過濾的整頁」。
 *   `%` 與 `_` 另有第二個理由:RPC 的 rollup 比對是 `category_raw LIKE p_category || ' · %'`,
 *   分類名裡的 LIKE 萬用字元會讓件數**多算**。
 */
export function isSafeCategoryValue(value: string): boolean {
  return value.length <= 120 && !/[\u0000-\u001f%_]/.test(value);
}

// ── #287:品牌軸的 URL 表示(單一定義點,讀寫兩端都吃這裡)────────────────────────
/**
 * 新格式 = **單一鍵逗號分隔** `?pbrands=a,b`;舊格式 = **重複鍵** `?pbrand=a&pbrand=b`。
 *
 * 🔴 為什麼要換:Next 16.2.6 產 page segment cache key 走
 *   `Object.fromEntries(new URLSearchParams(...))` ⇒ **重複鍵只留最後一個值** ⇒
 *   `?pbrand=a&pbrand=b` 與 `?pbrand=b` 的 key 相同 ⇒ `router.replace` 判定同一 segment、
 *   重用舊 CacheNode、零 RSC 請求 ⇒ 取消非字母序最後那個品牌時畫面不變(Sean 2026-07-19 回報)。
 *   單值鍵讓每個組合的 key 天然不同 = 結構上消除碰撞,而非偵測到再補救。
 * 🔴 **舊格式必須繼續讀得懂**:客人已分享出去的連結,以及站內 `lib/brand-url.ts` 產的單一品牌
 *   連結(`/products?pbrand=X`,同時是 `BrandAboutRedirect` 的設計稿契約)都還是舊格式。
 *   ⇒ 讀取端兩種都吃、**寫出端只產新格式**。
 */
export const BRANDS_PARAM = 'pbrands';
/** ⟦M-4b 多顆分類膠囊⟧ 單鍵逗號分隔;理由與 `BRANDS_PARAM` 同一條(見 CatalogQuery.categories)。 */
export const CATEGORIES_PARAM = 'categories';
export const LEGACY_BRAND_PARAM = 'pbrand';

/**
 * 讀品牌軸:兩種格式都吃、取聯集、去重、保留出現順序(新格式在前)。
 * 不驗對照表也不排序 —— 那是各呼叫端自己的事(server 驗 slug 形狀、client 驗品牌對照表)。
 *
 * ⚠️ **不含 legacy 單值 `?brand=` 的 fallback**:那個 key 與選車長版 `?brand=Yamaha&model=…`
 *   共用(理由在 `products-url-parsers.ts` 的 `parseBrandFiltersFromUrl` 檔內註解),只有
 *   **驗得了產品品牌對照表**的 client 端吃得起;server 端只驗 slug 形狀,吃進來會把選車網址
 *   誤當品牌篩選 ⇒ 該頁 0 筆。故 fallback 留在 `parseBrandFiltersFromUrl` 內、不下放到這裡。
 *
 * ⚠️ **不 round-trip 的形狀只有一個:值本身含逗號**。`?pbrands=a%2Cb` 解析出的是兩個 slug
 *   `a` 與 `b`,不是一個叫 `a,b` 的品牌。真實品牌 slug 到不了這個形狀(`SAFE_SLUG` 只收
 *   `[a-z0-9-]`,見本檔下方),所以碰得到它的**只有 #315 那條「認不得的值原樣留著」的路徑**:
 *   客人手打 `?pbrands=dbk,x`,寫回時會變成 `dbk` 與 `x` 兩個未知值(仍然留著、仍然 0 筆,
 *   只是切成兩段)。判為可接受 —— #315 要保的是未知值**還在網址上**,不是它的分段方式。
 */
export function parseBrandSlugsFromUrl(
  searchParams: Pick<URLSearchParams, 'get'> & { getAll?: (name: string) => string[] },
): string[] {
  const joined = searchParams.get(BRANDS_PARAM);
  const fromNew = joined ? joined.split(',').filter(Boolean) : [];
  const fromLegacy = searchParams.getAll
    ? searchParams.getAll.call(searchParams, LEGACY_BRAND_PARAM)
    : [];
  return Array.from(new Set([...fromNew, ...fromLegacy]));
}

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VEHICLE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/;

function parsePositiveInteger(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseNonNegativeInteger(raw: string | null): number | undefined {
  // 🔴 缺參數/空白必回 undefined:Number(null) / Number('') / Number(' '|'\t'|'+') 皆為 0,
  //    且 0 通過 value>=0 檢查,會讓「無 pmax」誤傳 priceMax=0 → RPC 過濾 price_general<=0
  //    → 整頁 0 筆(P4 回歸)。故先 trim、空字串即視為缺參數(涵蓋 ?pmax= 與 ?pmax=%20)。
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 將不受信任 URL 參數收斂為 catalog 的安全、可快取 query shape。
 * 不認得的值一律回預設；排序與每頁數只接受 UI 白名單。
 */
export function parseCatalogQuery(searchParams: SearchParamsLike): CatalogQuery {
  const page = parsePositiveInteger(searchParams.get('page'), 1);
  const requestedPerPage = parsePositiveInteger(searchParams.get('per'), CATALOG_DEFAULT_PER_PAGE);
  const perPage = (CATALOG_PER_PAGE_VALUES as readonly number[]).includes(requestedPerPage)
    ? requestedPerPage
    : CATALOG_DEFAULT_PER_PAGE;
  const requestedSort = searchParams.get('sort');
  // 🔴 `?filter=new` 沒帶 `sort` 時預設 `'new'`,不是 `'recommend'`(codex 段二審查 MF-1)。
  //    ⚠️ **2026-08-27 更新(`#950`):`recommend` 不再是 `ORDER BY id ASC`。**
  //    ~~原句:`recommend` 在 RPC 裡是 `ORDER BY id ASC`~~ —— 那句在本行寫下時是對的,
  //    而 `#950` 把它換成「中高價位優先 + 各大類輪流」(`20260827150000_..._recommend_sort_mid_high_price.sql`)。
  //    🔴 **這段話原本的論點【不受影響、而理由換了】**:導覽列那顆「新品」若落到 `recommend`,
  //    現在拿到的是「依價格帶排的任意上架時間」—— 一樣不是 Sean `Q20 = C` 要的「最近上架」。
  //    退回清單同理:退回本來就是為了顯示「最近上架的」。
  //    📌 留下舊字面是刻意的 —— 不然下一個人會以為這條規則從來沒有別的理由。
  //    只在**沒有明確指定 sort** 時才套用 ⇒ 客人自己選了價格排序仍然有效。
  const filterValue = searchParams.get('filter');
  const filter = (CATALOG_FILTER_VALUES as readonly string[]).includes(filterValue ?? '')
    ? (filterValue as CatalogFilter)
    : undefined;
  const sortFallback: CatalogSort = filter === 'new' ? 'new' : 'recommend';
  const sort = (CATALOG_SORT_VALUES as readonly string[]).includes(requestedSort ?? '')
    ? (requestedSort as CatalogSort)
    : sortFallback;
  // #287:新舊兩種格式都吃(`parseBrandSlugsFromUrl` 已去重);排序是為了 `CatalogQuery` 當
  // `unstable_cache` 鍵時穩定,與 URL 上的順序無關。
  const brandSlugs = parseBrandSlugsFromUrl(searchParams)
    .filter((slug) => SAFE_SLUG.test(slug))
    .sort();
  const categoryValue = searchParams.get('category');
  const category = categoryValue && isSafeCategoryValue(categoryValue) ? categoryValue : undefined;
  // 🔴 **每一顆都要各自過同一道白名單** —— 不是整串過一次:
  //    `isSafeCategoryValue` 擋的是 `%` `_` 與控制字元(見本檔 `isSafeCategoryValue` 的定義), 而 RPC 那側是
  //    `category_raw LIKE vc || ' · %'`(**未跳脫**)⇒ 只要有一顆帶 `%`, 整組結果就會被它污染。
  // 🔵 壞的那一顆**只丟那一顆**, 不整組失效 —— 驗收⑤ 逐字要的就是這個。
  const categories = [
    ...new Set(
      [...(searchParams.get(CATEGORIES_PARAM) ?? '').split(','), ...(category ? [category] : [])]
        .map((value) => value.trim())
        .filter((value) => value !== '' && isSafeCategoryValue(value)),
    ),
  ];
  const sliderMin = parseNonNegativeInteger(searchParams.get('pmin'));
  const sliderMax = parseNonNegativeInteger(searchParams.get('pmax'));
  const labelBounds = priceBoundsForLabel(searchParams.get('price'));
  const priceMin = Math.max(sliderMin ?? 0, labelBounds?.[0] ?? 0);
  const candidateMax = [sliderMax, labelBounds?.[1]].filter(
    (value): value is number => value !== undefined && value !== null,
  );
  const priceMax = candidateMax.length > 0 ? Math.min(...candidateMax) : undefined;
  // 🔴 `trim()` 之後才判空 —— 只打空白送出時,`' '` 是 truthy 而它不是一個查詢
  //    ⇒ 沒有這一步,`?search=%20` 會走進關鍵字路、ILIKE `%%` ⇒ **撈回整張 view**
  //    ⇒ 而那正是主視窗點名不准的「安靜地給他全站」。
  // 🔴🔴 **長度截斷【也要在這裡】做一次 —— 而我第一版把它省掉了(自審抓到)。**
  //    ⛔ ~~原本寫「長度截斷不在這裡:它住在 `lib/search.ts`(兩條路都經過那一層)」~~
  //    🛑 那句話對【查詢】那半是對的, 對【顯示】那半是錯的:
  //       `SearchKeywordChip` 印的是**本函式回的這個值**, 而截斷發生在更下游
  //       ⇒ 搜 150 個字 ⇒ 膠囊印 150 個字, 而實際只查了前 100 個
  //       ⇒ 📌 畫面上那句「目前顯示『…』的關鍵字結果」**指的不是實際跑的那個查詢**。
  //    🔴 而這個病 `search-shape.ts:28-31` **逐字預言過**, 判別句也在那裡:
  //       **「顯示用的字串與實際查詢的字串, 只要不是同一個運算式, 它們就會分岔。」**
  //    ⇒ ✅ 所以截斷搬進來:回傳值**就是**被查的那個字串 ⇒ 顯示端與查詢端吃同一個運算式。
  //    🔵 `lib/search.ts` 那道**保留**(不是重複)—— 疊層那條路不經過本函式。
  const searchValue = (searchParams.get('search')?.trim() ?? '').slice(
    0,
    SEARCH_MAX_QUERY_LENGTH,
  );
  const search = searchValue === '' ? undefined : searchValue;
  const vehicleValue = searchParams.get('vehicle');
  const vehicle = vehicleValue && SAFE_VEHICLE.test(vehicleValue) ? vehicleValue : undefined;
  return {
    page,
    perPage,
    sort,
    brandSlugs,
    categories,
    ...(category ? { category } : {}),
    ...(priceMin > 0 || labelBounds ? { priceMin } : {}),
    ...(priceMax !== undefined ? { priceMax } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(filter ? { filter } : {}),
    ...(search ? { search } : {}),
  };
}
