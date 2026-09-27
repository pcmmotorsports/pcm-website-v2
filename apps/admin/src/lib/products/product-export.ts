import 'server-only';
import { toCsv } from '../orders/order-export';
import { taipeiParts } from '../orders/order-list-view';
import { queryProductsForAdmin, type AdminProductQuery } from './product-repository';
import { readProductOverrides } from './product-overrides-view';

// product-export.ts — 商品清單匯出(M-4a-24 第二片;Sean 2026-09-27 F1 甲 / F2 甲 CSV / F3「都放」)。
// 計畫:~/pcm-mailbox/計畫-後台匯出訂單與商品報表-20260927.md §三第二片。
//
// 做法照訂單匯出第一片(`order-export-all.ts`):員工按下去才由 `/products/export` 在 server 端分批讀、組檔;
// 欄位逃脫與 BOM 走同一支 `toCsv`,「資料截至」由 route 呼叫同一支 `taipeiDataAsOf`。
// 篩選走 `resolveProductListQuery` + `queryProductsForAdmin`,與後台商品列表同一段 ⇒ 匯出的就是員工眼前那批。
//
// 🔴 店家價(F3:所有員工匯出都有)。讀法照經銷目錄 view `products_list_dealer`(20260925040000:119-125):
//    商品的店家價 = 【基準款變體】的 `product_variants.price_store`;基準款 = 一般價最低、同價取 sku 最小(COLLATE "C")。
//    `products.price_store` 同步程式永遠寫 NULL(20260924100000 檔頭)⇒ 不能讀那一欄。
//    ⚠️ 不讀 view:view 只有上架中的商品,而匯出含已下架。所以在這裡照同一條規則挑,兩邊規則改了要一起改。
//    ⚠️ 基準款沒有經銷價 ⇒ 這裡留空白。view 從 20260925050000(B2B D1)起也是 NULL:經銷會員看到「價格暫時無法取得」、不能下單
//       (2026-09-27 正式庫唯讀確認 view 已是 D1 版;原本這行寫「view 退回一般價」,那是 D1 之前的事,Fable R1 抓到)。
//    ⚠️ 不含每位經銷商各自的品牌折扣(那是每位客人不同的數字,不是商品的價格)。
// 🔴 不含成本(計畫 §三第二片:成本不在網站資料庫)。

/** 一次最多匯出幾件。超過 ⇒ 擋下並請員工先篩選,不偷偷截斷。 */
// 上限是怕檔案超過 Vercel 回應上限 4.5MB。2026-09-27 正式庫唯讀量:商品 27,667 件(含已下架),
// 整份約 3.6MB(一件約 130 bytes)⇒ 30,000 件約 3.9MB。商品再多就要改成分段下載或先篩選。
export const PRODUCT_EXPORT_CAP = 30000;
/** 每一批讀幾件。低於 PostgREST 預設 max-rows 1000,被砍的話下面的總數核對會擋下。 */
export const PRODUCT_EXPORT_BATCH = 500;
export const PRODUCT_CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
/** 給不認得 RFC 5987 `filename*` 的舊瀏覽器用的 ASCII 檔名。 */
export const PRODUCT_ASCII_FILENAME = 'products.csv';

const PRODUCT_EXPORT_COLUMNS =
  'id, title, external_id, price_general, delisted_at, staff_overrides, brands(name), categories(raw_path), product_variants(sku, price_general, price_store, sale_price_general)' as const;

export interface ProductExportVariant {
  readonly sku: string;
  readonly price_general: number | null;
  readonly price_store: number | null;
  /** 商品頁乙 P13:特價(一般會員,含稅);沒有特價 ⇒ null。 */
  readonly sale_price_general?: number | null;
}

export interface ProductExportRow {
  readonly id: string;
  readonly title: string;
  readonly external_id: string;
  readonly price_general: number | null;
  readonly delisted_at: string | null;
  readonly staff_overrides: unknown;
  readonly brands: { readonly name: string } | null;
  readonly categories: { readonly raw_path: string } | null;
  readonly product_variants: readonly ProductExportVariant[] | null;
}

export const PRODUCT_EXPORT_HEADER = ['品牌', '料號', '品名', '分類', '上架狀態', '一般價', '店家價', '特價'] as const;

type ListFn = (limit: number, offset: number) => Promise<{ items: ProductExportRow[]; total: number }>;

export type ProductCollectResult =
  | { kind: 'ok'; rows: ProductExportRow[]; total: number }
  | { kind: 'too_many'; total: number }
  | { kind: 'changed_while_reading'; got: number; total: number };

export function listProductsForExport(query: AdminProductQuery): ListFn {
  return (limit, offset) => queryProductsForAdmin<ProductExportRow>(PRODUCT_EXPORT_COLUMNS, limit, offset, query);
}

/**
 * 照同一個篩選,從第 0 件分批讀到最後一件。
 * 🔴 每一批都核對總數、讀完核對「不重複件數 = 總數」:同步程式剛好在跑時會新增商品,排序是建立時間新到舊,
 *    整串往後推一格 ⇒ 某件讀兩次、最後一件沒讀到,而每一批看起來都正常。對不上就整份不交(同訂單匯出)。
 */
export async function collectProductsForExport(list: ListFn): Promise<ProductCollectResult> {
  const first = await list(PRODUCT_EXPORT_BATCH, 0);
  const total = first.total;
  if (total > PRODUCT_EXPORT_CAP) return { kind: 'too_many', total };
  const rows = [...first.items];
  for (let offset = PRODUCT_EXPORT_BATCH; offset < total; offset += PRODUCT_EXPORT_BATCH) {
    const r = await list(PRODUCT_EXPORT_BATCH, offset);
    if (r.total !== total) return { kind: 'changed_while_reading', got: new Set(rows.map((p) => p.id)).size, total };
    rows.push(...r.items);
  }
  const distinct = new Set(rows.map((p) => p.id)).size;
  if (distinct !== total || rows.length !== total) return { kind: 'changed_while_reading', got: distinct, total };
  return { kind: 'ok', rows, total };
}

/** 基準款變體的店家價;沒有變體或基準款沒設經銷價 ⇒ null。規則見檔頭。 */
export function basisDealerPrice(variants: readonly ProductExportVariant[] | null): number | null {
  if (!variants || variants.length === 0) return null;
  const basis = [...variants].sort((a, b) => {
    if (a.price_general !== b.price_general) {
      if (a.price_general === null) return 1;
      if (b.price_general === null) return -1;
      return a.price_general - b.price_general;
    }
    // 字元碼比較 = COLLATE "C"(sku 全 ASCII,20260924100000 檔頭量過)
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  })[0]!;
  return basis.price_store;
}

/**
 * 商品頁乙 P13:客人在商品卡上看到的特價。規則同前台 view(20260928230000):
 * 代表款 = 實際一般價(一般價與特價取較低、一般價空 ⇒ 空)最低那一款,空值排最後,同價取 sku 最小(COLLATE "C");
 * 它的特價正在生效(比一般價低)⇒ 特價;否則 null(這一欄留空)。「一般價」那一欄照舊是原價。
 */
export function representativeSalePrice(variants: readonly ProductExportVariant[] | null): number | null {
  if (!variants || variants.length === 0) return null;
  const effective = (v: ProductExportVariant) =>
    v.price_general === null
      ? null
      : v.sale_price_general == null || v.sale_price_general >= v.price_general
        ? v.price_general
        : v.sale_price_general;
  const rep = [...variants].sort((a, b) => {
    const ea = effective(a);
    const eb = effective(b);
    if (ea !== eb) {
      if (ea === null) return 1;
      if (eb === null) return -1;
      return ea - eb;
    }
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  })[0]!;
  const e = effective(rep);
  return e !== null && e !== rep.price_general ? e : null;
}

function money(v: number | null): string {
  return v === null ? '' : String(v);
}

/** 一件商品 ⇒ 一列。品名 = 客人在網站上看到的(員工改過標題就用改過的,同 `products_public`)。 */
export function productExportRow(p: ProductExportRow): string[] {
  return [
    p.brands?.name ?? '',
    p.external_id,
    readProductOverrides(p.staff_overrides).title?.trim() ?? p.title,
    p.categories?.raw_path ?? '',
    p.delisted_at === null ? '上架中' : '已下架',
    money(p.price_general),
    money(basisDealerPrice(p.product_variants)),
    money(representativeSalePrice(p.product_variants)),
  ];
}

export type ProductExportContext = { total: number; filterNote: string; dataAsOf: string };

/** 整份 CSV:第一列 = 檔案說明(同訂單匯出的慣例),第二列表頭,之後每件商品一列。 */
export function buildProductExportCsv(rows: readonly ProductExportRow[], ctx: ProductExportContext): string {
  const describe =
    `本檔 = 後台商品列表 篩選結果(不分頁) 共 ${ctx.total} 件 · 篩選:${ctx.filterNote} · 資料截至 ${ctx.dataAsOf}` +
    ' · 品名是客人在網站上看到的名稱 · 店家價是經銷會員的基本價,未含個別經銷商的品牌折扣;空白表示還沒設定經銷價,經銷會員目前看不到價格、無法下單 · 特價是客人在商品卡上看到的特價,空白表示沒有特價;一般價那一欄是原價。';
  return toCsv([describe], [[...PRODUCT_EXPORT_HEADER], ...rows.map(productExportRow)]);
}

export interface ProductExportFilterFacts {
  readonly keyword?: string;
  readonly setBy?: 'sync' | 'staff';
  readonly brandNames: readonly string[];
  readonly categoryPath?: string;
  readonly skuCount: number;
  /** 商品頁乙 A2:「要處理」條件的名稱(畫面上的字)。 */
  readonly attentionLabels?: readonly string[];
  readonly brandFilterDropped: boolean;
  readonly categoryFilterDropped: boolean;
}

/** 這份套了什麼篩選(進檔案第一列)。只寫【真的有套用】的;網址帶了卻沒套上的也講出來。 */
export function productExportFilterNote(f: ProductExportFilterFacts): string {
  const parts: string[] = [];
  if (f.keyword) parts.push(`搜尋「${f.keyword}」`);
  if (f.setBy) parts.push(f.setBy === 'staff' ? '上架狀態手動設定' : '上架狀態自動');
  if (f.brandNames.length > 0) parts.push(`品牌 ${f.brandNames.join('、')}`);
  if (f.categoryPath && !f.categoryFilterDropped) parts.push(`分類 ${f.categoryPath}`);
  if (f.skuCount > 0) parts.push(`料號批次 ${f.skuCount} 個`);
  if (f.attentionLabels && f.attentionLabels.length > 0) parts.push(`要處理 ${f.attentionLabels.join('或')}`);
  if (f.brandFilterDropped) parts.push('網址帶的品牌有找不到的,那部分沒有套用');
  if (f.categoryFilterDropped) parts.push('網址帶的分類套用不上,沒有依分類篩選');
  return parts.length === 0 ? '無篩選' : parts.join(' · ');
}

export function productExportFilename(now: Date): string {
  const { year, month, day } = taipeiParts(now);
  return `商品清單-${year}${month}${day}.csv`;
}

/** 列表網址(`buildProductListHref` 產的 `/products?…`)⇒ 同一組篩選參數的匯出網址。 */
export function productExportHref(listHref: string): string {
  return listHref.replace(/^\/products(?=\?|$)/, '/products/export');
}

/** 擋下時給員工看的話:說清楚為什麼、該怎麼做。 */
export function productExportBlockedMessage(r: Exclude<ProductCollectResult, { kind: 'ok' }>): string {
  switch (r.kind) {
    case 'too_many':
      return `篩選結果共 ${r.total} 件,超過一次匯出的上限 ${PRODUCT_EXPORT_CAP} 件。請先用品牌或分類縮小範圍後再匯出。`;
    case 'changed_while_reading':
      return `讀取途中商品有變動(讀到 ${r.got} 件,開始時為 ${r.total} 件),這份檔可能不完整所以沒有產生。請重新匯出。`;
  }
}
