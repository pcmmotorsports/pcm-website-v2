import {
  taipeiYmdFromDayEndExclusive,
  taipeiYmdFromInstantIso,
  type AdminOrderFilter,
  type AdminOrderListResult,
  type AdminOrderSummary,
  type PaginationParams,
} from '@pcm/domain';
import { ORDER_EXPORT_COLUMNS, buildOrderExportRows, orderExportFilename, toCsv } from './order-export';
import { readOrderKeywordCookie } from './order-keyword-cookie';
import { hasOrderFilterParams, parseOrderListSearchParams } from './order-list-view';
import { STATUS_CHIPS, applyStatusChip } from './order-toolbar-view';

// order-export-all.ts — 訂單匯出第一片:一次匯出【目前篩選的全部訂單】(M-4a-24, Sean 2026-09-27 F1 甲)。
// 計畫:~/pcm-mailbox/計畫-後台匯出訂單與商品報表-20260927.md §三第一片。
//
// 與「匯出這一頁」(`order-export-page.ts`)的差別:那一份是頁面 render 時就組好、跟著頁面送到瀏覽器;
// 這一份量大(上限 ORDER_EXPORT_ALL_CAP 張單), 改成員工按下去才由 `/orders/export` 在 server 端分批讀、組檔。
// 🔴 欄位、逃脫、BOM 全走 `order-export.ts` 的同一套(`toCsv` / `buildOrderExportRows`), 不另寫一份。

/** 一次最多匯出幾張單。超過 ⇒ 擋下並請員工縮小日期範圍, 不偷偷截斷。 */
export const ORDER_EXPORT_ALL_CAP = 2000;
/** 每一批讀幾張單(每張單的品項另有內嵌上限, 見 adapter 的 ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT)。 */
export const ORDER_EXPORT_ALL_BATCH = 100;
export const ORDER_CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
/** 給不認得 RFC 5987 `filename*` 的舊瀏覽器用的 ASCII 檔名。 */
export const ORDER_ALL_ASCII_FILENAME = 'orders-all.csv';

type ListFn = (filter: AdminOrderFilter, pagination: PaginationParams) => Promise<AdminOrderListResult>;

export type CollectResult =
  | { kind: 'ok'; orders: AdminOrderSummary[]; total: number }
  | { kind: 'too_many'; total: number }
  | { kind: 'keyword_truncated' }
  | { kind: 'changed_while_reading'; got: number; total: number }
  | { kind: 'items_truncated'; displayIds: string[] };

/**
 * 下載網址收到的網址參數 + 關鍵字 cookie ⇒ 與後台列表**同一個**篩選。
 * 🔴 規則逐條照 `app/orders/page.tsx`:沒帶任何篩選鍵 ⇒ 套第一顆快選(未完成);關鍵字從 httpOnly cookie 合進來。
 *    兩邊不一致的話, 員工匯出的會跟他眼前的列表不是同一批單。
 */
export function resolveOrderExportFilter(
  raw: Record<string, string | string[] | undefined>,
  now: Date,
  keywordCookie: string | undefined,
): AdminOrderFilter {
  const { filter: parsed } = parseOrderListSearchParams(raw, { now });
  const urlFilter = hasOrderFilterParams(raw) ? parsed : applyStatusChip(parsed, STATUS_CHIPS[0]!);
  const keyword = readOrderKeywordCookie(keywordCookie);
  return keyword === null ? urlFilter : { ...urlFilter, keyword };
}

/**
 * 照同一個篩選, 從第 0 張分批讀到最後一張。
 * 🔴 讀完一定核對「不重複的張數 = 第一批回報的總數」:排序是建立時間新到舊, 匯出途中進來一張新單
 *    整串就會往後推一格 ⇒ 某張讀兩次、最後一張沒讀到, 而每一批看起來都正常。對不上就整份不交。
 */
export async function collectOrdersForExport(list: ListFn, filter: AdminOrderFilter): Promise<CollectResult> {
  const first = await list(filter, { limit: ORDER_EXPORT_ALL_BATCH, offset: 0 });
  if (first.keywordTruncated) return { kind: 'keyword_truncated' };
  const total = first.total;
  // 沒有總數就無法核對「讀全了沒」⇒ 不猜, 當讀取失敗(route 回 500、不給檔)
  if (typeof total !== 'number') throw new Error('訂單列表沒有回總筆數, 無法確認匯出完整');
  if (total > ORDER_EXPORT_ALL_CAP) return { kind: 'too_many', total };
  const orders = [...first.items];
  for (let offset = ORDER_EXPORT_ALL_BATCH; offset < total; offset += ORDER_EXPORT_ALL_BATCH) {
    const r = await list(filter, { limit: ORDER_EXPORT_ALL_BATCH, offset });
    if (r.keywordTruncated) return { kind: 'keyword_truncated' };
    orders.push(...r.items);
  }
  const distinct = new Set(orders.map((o) => o.id)).size;
  if (distinct !== total || orders.length !== total) {
    return { kind: 'changed_while_reading', got: distinct, total };
  }
  // 單張單的品項超過內嵌上限時列表只帶前幾項(同單頁匯出的 `orderExportBlockedReason`)⇒ 匯出會少品項
  const truncated = orders.filter((o) => o.itemsTruncated).map((o) => o.displayId);
  if (truncated.length > 0) return { kind: 'items_truncated', displayIds: truncated };
  return { kind: 'ok', orders, total };
}

/**
 * 這一份套了什麼篩選(進檔案第一列與畫面)。
 * 🔴 只算【真的有設】的條件:undefined / false / 空陣列都不算 —— 舊版「鍵在就算有篩選」恆真, 連裸 `/orders` 都寫「已套用篩選」。
 * 🔴 關鍵字只說「有」, 不寫內容:搜尋詞是客人個資(所以它走 httpOnly cookie、不進網址)。
 */
export function orderExportFilterNote(filter: AdminOrderFilter): string {
  const parts: string[] = [];
  const from = filter.createdFrom ? taipeiYmdFromInstantIso(filter.createdFrom) : null;
  const to = filter.createdTo ? taipeiYmdFromDayEndExclusive(filter.createdTo) : null;
  if (from || to) parts.push(`建立日期 ${from ?? '最早'} 至 ${to ?? '今天'}`);
  if (filter.keyword) parts.push('含關鍵字搜尋(內容不列出)');
  const { createdFrom: _f, createdTo: _t, keyword: _k, ...rest } = filter;
  const other = Object.values(rest).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false));
  if (other) parts.push('另有其他篩選(狀態、付款方式等, 與後台列表相同)');
  return parts.length === 0 ? '無篩選' : parts.join(' · ');
}

export type OrderAllExportContext = { total: number; filterNote: string; dataAsOf: string };

/** 整份 CSV:第一列 = 檔案自述(同單頁匯出的慣例), 第二列表頭, 之後每個品項一列。 */
export function buildOrderAllCsv(orders: AdminOrderSummary[], ctx: OrderAllExportContext): string {
  const describe =
    `本檔 = 後台訂單列表 全部篩選結果 共 ${ctx.total} 張單 · 篩選:${ctx.filterNote} · 資料截至 ${ctx.dataAsOf}` +
    ' · ⚠️ 「狀態」欄是給人看的文字,不是系統對出來的判斷;要判斷收款/退款狀態請回後台看。';
  return toCsv([describe], [[...ORDER_EXPORT_COLUMNS], ...buildOrderExportRows(orders)]);
}

export function orderAllExportFilename(now: Date): string {
  return orderExportFilename(now).replace(/\.csv$/, '-全部.csv');
}

/** 列表網址(`buildOrderListHref` 產的 `/orders?…`)⇒ 同一組篩選參數的匯出網址。關鍵字不在網址裡(走 cookie)。 */
export function orderExportAllHref(listHref: string): string {
  return listHref.replace(/^\/orders(?=\?|$)/, '/orders/export');
}

/** 擋下時給員工看的話:說清楚為什麼、該怎麼做。 */
export function orderExportAllBlockedMessage(r: Exclude<CollectResult, { kind: 'ok' }>): string {
  switch (r.kind) {
    case 'too_many':
      return `篩選結果共 ${r.total} 張單,超過一次匯出的上限 ${ORDER_EXPORT_ALL_CAP} 張。請縮小日期範圍後再匯出。`;
    case 'keyword_truncated':
      return '關鍵字搜尋的結果超過 100 張,只載入了前 100 張,匯出會少東西。請改用日期或狀態篩選後再匯出。';
    case 'items_truncated':
      return `有 ${r.displayIds.length} 張單的品項沒有全部載入(單號 ${r.displayIds.join('、')}),匯出會少東西。請先點進那幾張單查看,不要拿這份檔對帳。`;
    case 'changed_while_reading':
      return `匯出途中訂單有變動(讀到 ${r.got} 張,應為 ${r.total} 張),這份檔不完整所以沒有產生。請再按一次匯出。`;
  }
}
