import 'server-only';
import { cookies } from 'next/headers';
import type { AdminOrderFilter } from '@pcm/domain';
import { getAdminOrderRepository } from '../orders/order-repository';
import { ORDER_KEYWORD_COOKIE, readOrderKeywordCookie } from '../orders/order-keyword-cookie';
import {
  ORDER_DENSITY_DEFAULT,
  PANEL_CLOSED,
  buildOrderListHref,
  parseOrderListSearchParams,
} from '../orders/order-list-view';

// today-todo-read.ts — 首頁「今天要做的事」裡**走訂單列表篩選**的那三格(IO 層)。
//    另外兩格(今日新單 / 退款待處理)沿用 `today-read.ts` 的 `loadTodaySummary`,本檔不重查。
//
// 🔴🔴 **數字 = 連結打開後的筆數,由構造保證,不靠人記得同步**(Sean 2026-09-13 逐字
//    「用同一支查詢的計數,不另寫一套判準」):
//    ① 先用 `buildOrderListHref` 把篩選做成**列表頁的網址**;
//    ② 再用 `parseOrderListSearchParams` 把那條網址**照列表頁自己的讀法**讀回 filter
//       (含「未選預設近半年」與「刷卡未付款預設藏起來」這兩條列表頁的預設);
//    ③ 🔴 把讀回來的 filter **再產一次網址**當卡片的連結 —— 這一步讓「近半年」那段日期**寫死在網址裡**
//       (codex 2026-09-13 must-fix 2:不寫死的話,23:59 算的數字、00:01 點進去,列表頁會用新的一天
//       重算近半年 ⇒ 邊界那一天的單消失、卡片說 1 列表說 0)。
//    ④ 🔴 合併列表頁的**搜尋 cookie**(`orders/page.tsx:147-148` 同兩行;codex must-fix 1):
//       列表頁不管網址帶什麼都會套上 httpOnly cookie 裡的關鍵字 ⇒ 卡片不套就會「卡片 12、點進去 1」。
//       ⇒ 員工留著一個搜尋沒清,五格會跟著變小 —— 那是**列表頁的行為**,點進去搜尋框裡就看得到原因;
//       本檔選擇跟它一致,而不是自己另算一個「沒搜尋時」的數字(那又是第二套判準)。
//    ⑤ 拿那份 filter 打**同一支** `listOrderSummariesForAdmin`,只取 `total`。
//    ⇒ 卡片上的數字與點進去看到的「共 N 筆」是**同一條網址、同一支查詢**算出來的。
//    ⚠️ 直接拿 `SPEC.filter` 去查會漏掉 ② 那兩條預設 ⇒ 卡片說 12、點進去 9。那正是
//       `today-summary.tsx` 檔頭記過的「述詞漂移」,本檔用「先產網址再讀回」把它結構上關掉。
//
// 🔴 `total` 來自 `count: 'exact'`(`SupabaseOrderAdapter.listOrderSummariesForAdmin` 的 select),
//    `limit: 1` 只是少搬幾列,筆數不受影響。
//
// 🔴 `null` = 這一格沒讀到,**不是 0**(同 `today-read.ts` 的地基):零在這頁的意思是「今天沒事做」,
//    是好消息;讀取失敗偽裝成好消息是最壞的壞法。

/** 三格的定義;`filter` 是**未經列表頁預設**的原始篩選,真正查的是讀回來那份。 */
export const TODO_LIST_SPECS = {
  /** 待收款(匯款):未付款 × 銀行轉帳;`pendingOnly` 帶進列表那條「排除已取消 / 已退款」。 */
  unpaidBankTransfer: {
    label: '待收款(匯款)',
    filter: { paymentStatus: 'unpaid', paymentChannels: ['bank_transfer'], pendingOnly: true },
  },
  /** 待訂貨:貨品軸「未訂貨」(列表那條 chip;自帶排除已取消 / 已退款)。 */
  notOrdered: {
    label: '待訂貨',
    filter: { goodsAxes: ['none'] },
  },
  /** 到貨待出貨:貨品軸「已到貨」。 */
  instock: {
    label: '到貨待出貨',
    filter: { goodsAxes: ['instock'] },
  },
} as const satisfies Record<string, { label: string; filter: AdminOrderFilter }>;

export type TodoListKey = keyof typeof TODO_LIST_SPECS;

export type TodoListCount = {
  label: string;
  /** 點進去看的那條網址(數字就是從它讀回來算的)。 */
  href: string;
  /** `null` = 讀取失敗。 */
  count: number | null;
};

export type TodayTodoLists = Record<TodoListKey, TodoListCount>;

/** 網址 → `parseOrderListSearchParams` 吃的形狀(同鍵多值要收成陣列,`goods_axis` 會重複)。 */
function hrefToRaw(href: string): Record<string, string | string[]> {
  const raw: Record<string, string | string[]> = {};
  for (const [k, v] of new URL(href, 'http://localhost').searchParams) {
    const prev = raw[k];
    raw[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return raw;
}

const DISPLAY = { density: ORDER_DENSITY_DEFAULT } as const;

/** 一格:原始篩選 → 網址 → 照列表頁讀回(套預設)→ **再產一次網址**(日期寫死)。 */
export function todoListHref(key: TodoListKey, now: Date): string {
  const first = buildOrderListHref(TODO_LIST_SPECS[key].filter, DISPLAY, 1, PANEL_CLOSED);
  const { filter } = parseOrderListSearchParams(hrefToRaw(first), { now });
  return buildOrderListHref(filter, DISPLAY, 1, PANEL_CLOSED);
}

/** 整支載入拋掉時的替身:三格全部「讀取失敗」、連結仍指向列表頁本身(數字不藏、不假裝 0)。 */
export function unreadableTodoLists(now: Date = new Date()): TodayTodoLists {
  const keys = Object.keys(TODO_LIST_SPECS) as TodoListKey[];
  return Object.fromEntries(
    keys.map((key) => [key, { label: TODO_LIST_SPECS[key].label, href: todoListHref(key, now), count: null }]),
  ) as TodayTodoLists;
}

/**
 * 一格的完整路(網址 → 讀回 → cookie → 同一支查詢)。
 * 🔴 **側欄「未訂貨」也走這一支**(`lib/layout/sidebar-counts.ts`;主視窗 2026-09-13 裁):
 *    首頁「待訂貨 6」與側欄「未訂貨 7」並排就是兩份真相,現在兩邊只有這一條路、不可能對不上。
 *    `repo` 讓呼叫端傳進來是為了同一次 render 只建一個 client;不傳就自己建。
 */
export async function loadTodoListCount(
  key: TodoListKey,
  now: Date = new Date(),
  repo = getAdminOrderRepository(),
): Promise<TodoListCount> {
  const keyword = readOrderKeywordCookie((await cookies()).get(ORDER_KEYWORD_COOKIE)?.value);
  const href = todoListHref(key, now);
  const parsed = parseOrderListSearchParams(hrefToRaw(href), { now }).filter;
  const filter: AdminOrderFilter = keyword === null ? parsed : { ...parsed, keyword };
  let count: number | null = null;
  try {
    const r = await repo.listOrderSummariesForAdmin(filter, { limit: 1, offset: 0 });
    count = Number.isSafeInteger(r.total) ? (r.total as number) : null;
  } catch (e) {
    console.error(`[today-todo-read] ${TODO_LIST_SPECS[key].label} 讀取失敗`, e);
  }
  return { label: TODO_LIST_SPECS[key].label, href, count };
}

export async function loadTodayTodoLists(now: Date = new Date()): Promise<TodayTodoLists> {
  const repo = getAdminOrderRepository();
  const keys = Object.keys(TODO_LIST_SPECS) as TodoListKey[];
  const rows = await Promise.all(
    keys.map(async (key) => [key, await loadTodoListCount(key, now, repo)] as const),
  );
  return Object.fromEntries(rows) as TodayTodoLists;
}
