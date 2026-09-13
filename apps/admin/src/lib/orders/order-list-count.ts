import 'server-only';
import { cookies } from 'next/headers';
import type { AdminOrderFilter } from '@pcm/domain';
import { getAdminOrderRepository } from './order-repository';
import { ORDER_KEYWORD_COOKIE, readOrderKeywordCookie } from './order-keyword-cookie';
import {
  ORDER_DENSITY_DEFAULT,
  PANEL_CLOSED,
  buildOrderListHref,
  parseOrderListSearchParams,
} from './order-list-view';

// order-list-count.ts — 「這一條篩選,點進去會看到幾筆」**由構造保證**的計數(IO 層)。
//    首頁「今天要做的事」三格、側欄「未訂貨」、訂單頁工具列六顆 chip 的數字**全部走這一支**
//    (主視窗 2026-09-13:「chips 計數走你已經統一的那一族,同一數字只有一支查詢」)。
//
// 🔴 為什麼不直接拿 filter 去查:列表頁在 URL 之外還套三條規則 —— 「未選預設近半年」「刷卡未付款預設藏起來」
//    「httpOnly cookie 裡的搜尋詞」。少套任何一條就是「卡片說 12、點進去 9」(`today-summary.tsx` 檔頭記過三次)。
//    ⇒ ① filter → 網址(`buildOrderListHref`)② 網址 → 照列表頁 parser 讀回(套前兩條)③ 再產一次網址
//    (把近半年那段**日期寫死**,跨午夜點進去不會換一天算)④ 合併 cookie(第三條)⑤ 同一支
//    `listOrderSummariesForAdmin` 只取 `total`。卡片上的數字與點進去的「共 N 筆」是同一條網址、同一支查詢。
//
// 🔴 `null` = 沒讀到,不是 0。

export type OrderListCount = {
  /** 點進去看的那條網址(數字就是從它讀回來算的;日期已寫死)。 */
  href: string;
  /** `null` = 讀取失敗。 */
  count: number | null;
};

const DISPLAY = { density: ORDER_DENSITY_DEFAULT, boss: false } as const;

/** 網址 → parser 吃的形狀(同鍵多值收成陣列;`goods_axis` 會重複)。 */
export function hrefToRaw(href: string): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(href, 'http://localhost').searchParams) {
    const prev = raw[k];
    raw[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return raw;
}

/** filter → 網址 → 讀回(套預設)→ 再產網址(日期寫死)。純函式,給元件與測試用。 */
export function frozenListHref(filter: AdminOrderFilter, now: Date): string {
  const first = buildOrderListHref(filter, DISPLAY, 1, PANEL_CLOSED);
  const parsed = parseOrderListSearchParams(hrefToRaw(first), { now }).filter;
  return buildOrderListHref(parsed, DISPLAY, 1, PANEL_CLOSED);
}

export async function countOrderList(
  filter: AdminOrderFilter,
  now: Date = new Date(),
  repo = getAdminOrderRepository(),
  /** 失敗時 log 用的名字。 */
  label = '訂單列表計數',
): Promise<OrderListCount> {
  const keyword = readOrderKeywordCookie((await cookies()).get(ORDER_KEYWORD_COOKIE)?.value);
  const href = frozenListHref(filter, now);
  const parsed = parseOrderListSearchParams(hrefToRaw(href), { now }).filter;
  const effective: AdminOrderFilter = keyword === null ? parsed : { ...parsed, keyword };
  let count: number | null = null;
  try {
    const r = await repo.listOrderSummariesForAdmin(effective, { limit: 1, offset: 0 });
    count = Number.isSafeInteger(r.total) ? (r.total as number) : null;
  } catch (e) {
    console.error(`[order-list-count] ${label} 讀取失敗`, e);
  }
  return { href, count };
}
