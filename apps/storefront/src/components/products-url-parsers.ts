// products-url-parsers.ts — #341-B:從 `products-url-state.tsx` **原樣搬出**的純解析層(零 hook)。
//
// 🔴 **本檔是純位移**(#341 拆檔片):函式本體一個字元都沒改,只換了住址。
//    回歸鎖在 `products-url-parsers.test.ts`(#341-A,拆檔前先立;突變四靶各只紅一格)。
// 🔴 副檔名 `.ts` 而非 `.tsx`:repo 的 eslint react-hooks plugin glob 只掛 `**/*.tsx`,
//    那條規則是給**含 hook 的檔**用的;本檔零 hook ⇒ 用 .ts 才誠實(拿 .tsx 會讓人以為裡面有 hook)。
// ⚠️ 舊路徑 `products-url-state.tsx` 仍 re-export 本檔全部匯出 ⇒ 既有 import 一行都不用改。

import type { SearchParamsLike } from '@/lib/vehicle-url';
import { CATALOG_DEFAULT_PER_PAGE, CATALOG_SORT_VALUES } from '@/lib/catalog-query';


/**
 * client 端可接受的 `?sort=` 值。
 *
 * 🔴 **直接沿用 server 白名單,不再自己寫一份**(codex 段二審查 MF-9)。
 *   這裡原本是**第三份**排序清單,而且還殘留著 `'sale'` —— 它早在 2026-08-11 #269-a
 *   就從 `SORT_OPTIONS` 移除了。後果:舊書籤 `?sort=sale` 會讓 **client 認為排序是 sale、
 *   server 卻回退成 recommend**,而 `<select>` 裡根本沒有那個選項 ⇒ 下拉顯示空白/錯位。
 *   ⚠️ 這也讓我 #391 那句「假選項歸零」是**過頭的宣稱** —— 那格只比對了三份裡的兩份。
 *   守門已擴成三份一起比(見 `catalog-query.test.ts`)。
 */
export const SORT_VALUES = CATALOG_SORT_VALUES;
export const PER_PAGE_VALUES = [25, 50, 75, 100] as const; // = Pagination #pp-perpage <option>
export const DEFAULT_SORT = 'recommend';
// 🔴 預設每頁筆數與 server 端(lib/catalog-query.parseCatalogQuery)必須是同一個數字,
//    故直接讀那邊的常數、不在這裡再寫一次(見該檔 CATALOG_DEFAULT_PER_PAGE 註解)。
export const DEFAULT_PER_PAGE: number = CATALOG_DEFAULT_PER_PAGE;


// SearchParamsLike + parseVehicleFromUrl 已抽到 @/lib/vehicle-url(見檔頭 import;server 共用);
// 本檔內部消費者(useBrowseUrlState 等)與外部(詳情頁 route)皆吃同一份、id 空間一致。

// ── Q4-S5(2026-07-05):?category= / ?brand= 入站深連結(首頁分類卡 / 品牌牆殘廢修復)──
// 背景:design 是 SPA in-memory nav(onNav('products',{category}))、Next port 產生了
// `/products?category=` 連結但全站無人讀此 key(遷移缺口)→ 首頁分類卡點了無過濾。
// 模式對齊 vehicle:mount 讀一次 → 對照真實清單驗證(查無=fail-safe 忽略、顯全部)→ dispatch。
// ⚠️ V-1a 字面校正(值班台 REQUIRED-1):「僅入站、不回寫 URL」已被 P4 推翻——category/pbrand/price
// 現由 useCatalogFilterUrlSync 回寫 URL、vehicle 由 useVehicleUrlSync 回寫;本段僅「入站水合」半邊仍為真。

/** #212 兩層分類的 URL 分隔符(seed 麵包屑 raw_path/useCatalogFilterUrlSync 寫出端同字面 ` · `)。 */
export const CATEGORY_URL_SEPARATOR = ' · ';

/**
 * ?category= 值:分類「名稱」(raw_path、人類可讀)為主;防禦性亦接受 DB id。
 * V-1a(2026-07-15):支援 #212 兩層 `大類 · 子類`(useCatalogFilterUrlSync 寫出端同格式;
 * 修「選子類→進商品→上一頁分類整個丟」=兩層字串對單層清單永遠 miss 的還原缺口)。
 * 子類查無 → 保守只還原大類;大類查無 → null(fail-safe、不套用)。
 */
export function parseCategoryFromUrl(
  searchParams: SearchParamsLike,
  categories: { id: string; name: string; children?: { id: string; name: string }[] }[],
): { mainId: string; main: string; subId?: string; sub?: string } | null {
  const raw = searchParams.get('category');
  if (!raw) return null;
  // 病態防護:大類名本身含分隔符時,先試全字串 exact match 再切分(現況 seed 無此名、零成本補洞)
  const exact = categories.find((c) => c.name === raw || c.id === raw);
  if (exact) return { mainId: exact.id, main: exact.name };
  const sepIndex = raw.indexOf(CATEGORY_URL_SEPARATOR);
  const mainRaw = sepIndex === -1 ? raw : raw.slice(0, sepIndex);
  const subRaw = sepIndex === -1 ? null : raw.slice(sepIndex + CATEGORY_URL_SEPARATOR.length);
  const hit = categories.find((c) => c.name === mainRaw || c.id === mainRaw);
  if (!hit) return null;
  if (subRaw) {
    const subHit = hit.children?.find((s) => s.name === subRaw || s.id === subRaw);
    if (subHit) return { mainId: hit.id, main: hit.name, subId: subHit.id, sub: subHit.name };
  }
  return { mainId: hit.id, main: hit.name };
}

/**
 * ?brand= 值:產品品牌 slug(= buildBrandTaxonomy 衍生 id,如 gb-racing/bonamici)。
 * ⚠️ 與 vehicle 長版 fallback(?brand=Yamaha&model=…)共用 key:各自對照表驗證、查無即 null。
 * 🔴 現況兩命名空間不相交(摩托車廠 id vs 產品品牌 slug),但**非結構保證**:日後多品牌若含
 *    OEM 副廠件(Yamaha/Honda 亦賣部品)、slug 'yamaha' 可能同時命中兩者 → 同一 ?brand= 雙重過濾。
 *    多品牌放量前需消歧(產品品牌深連結改獨立 key 如 ?pbrand=,或入站時 vehicle 優先互斥)。見 backlog #269。
 */
export function parseBrandFiltersFromUrl(
  searchParams: SearchParamsLike,
  productBrands: { id: string }[],
): string[] {
  const getAll = (searchParams as SearchParamsLike & { getAll?: (name: string) => string[] }).getAll;
  const requested = getAll ? getAll.call(searchParams, 'pbrand') : [];
  // 相容 P4 前的單一 ?brand= 深連結；新網址一律輸出不會和車款衝突的 ?pbrand=。
  if (requested.length === 0) {
    const legacy = searchParams.get('brand');
    if (legacy) requested.push(legacy);
  }
  return Array.from(new Set(requested)).filter((slug) => productBrands.some((b) => b.id === slug));
}

export function parseSortParam(raw: string | null): string {
  return raw && (SORT_VALUES as readonly string[]).includes(raw) ? raw : DEFAULT_SORT;
}
export function parsePerPageParam(raw: string | null): number {
  const n = Number(raw);
  return (PER_PAGE_VALUES as readonly number[]).includes(n) ? n : DEFAULT_PER_PAGE;
}
export function parsePageParam(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  // 只驗 ≥1;超出總頁數由 ProductsPage 既有 currentPage = min(page, totalPages) 收斂、
  // useBrowseUrlSync 會自癒回寫
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
