// order-list-view.ts — 後台訂單列表「顯示層」純工具(M-4a 訂單線第一片)。
//
// 純函式:searchParams 解析 / 篩選值域守門 / 分頁數學 / 中文標籤 / 日期格式化。
// 無 server-only、無 @/、無 @pcm/adapters(型別 import 自 @pcm/domain 會被抹除)→ 可單測。
// (root vitest.config 的 @ alias 指 storefront;admin 內部 import 一律相對路徑、跨 app 型別走 @pcm/domain。)

import type {
  AdminOrderFilter,
  PaymentStatus,
  FulfillmentStatus,
  OrderSource,
  PaymentChannel,
} from '@pcm/domain';

/** 每頁筆數(server 端 .range 分頁)。 */
export const ORDERS_PAGE_SIZE = 20;

/** 查詢字串鍵名(與 DB 欄對齊、URL 可讀)。 */
export const PAYMENT_STATUS_PARAM = 'payment_status';
export const FULFILLMENT_STATUS_PARAM = 'fulfillment_status';
export const ORDER_SOURCE_PARAM = 'order_source';
export const PAYMENT_CHANNEL_PARAM = 'payment_channel';
export const PAGE_PARAM = 'page';

// ── 值域(對齊 domain enum + DB CHECK;解析時白名單守門,非法值忽略)──

export const PAYMENT_STATUS_VALUES: readonly PaymentStatus[] = [
  'paid',
  'unpaid',
  'partiallyPaid',
  'refunded',
];
export const FULFILLMENT_STATUS_VALUES: readonly FulfillmentStatus[] = [
  'notOrdered',
  'ordered',
  'inStock',
  'shipped',
];
export const ORDER_SOURCE_VALUES: readonly OrderSource[] = [
  'web',
  'manual_phone',
  'manual_line',
  'manual_other',
];
export const PAYMENT_CHANNEL_VALUES: readonly PaymentChannel[] = [
  'tappay',
  'bank_transfer',
  'cash',
  'none',
];

// ── 中文標籤(admin 分軸顯示:付款軸 / 出貨軸各自獨立,非會員側合併字串)──
// 會員側 order-display.ts orderStatusLabel 把雙軸合成一句(給客人看);admin 要 granular 分欄查「已付未出」,
// 故付款 / 出貨各自一張表。文案 admin 視角、與會員側刻意不同(L2 hardcode、未來移後台 CMS)。

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: '已付款',
  unpaid: '待付款',
  partiallyPaid: '付款確認中',
  refunded: '已退款',
};

export const FULFILLMENT_STATUS_LABEL: Record<FulfillmentStatus, string> = {
  notOrdered: '未訂貨',
  ordered: '已向廠商訂貨',
  inStock: '已到貨',
  shipped: '已出貨',
};

export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
  web: '網站',
  manual_phone: '電話',
  manual_line: 'LINE',
  manual_other: '其他',
};

export const PAYMENT_CHANNEL_LABEL: Record<PaymentChannel, string> = {
  tappay: '線上刷卡',
  bank_transfer: '銀行轉帳',
  cash: '現金',
  none: '未指定',
};

/** 下拉選項(value + label);置頂「全部」= 不篩選(空 value)。 */
export type FilterOption = { value: string; label: string };

function toOptions<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): FilterOption[] {
  return values.map((v) => ({ value: v, label: labels[v] }));
}

export const PAYMENT_STATUS_OPTIONS = toOptions(PAYMENT_STATUS_VALUES, PAYMENT_STATUS_LABEL);
export const FULFILLMENT_STATUS_OPTIONS = toOptions(
  FULFILLMENT_STATUS_VALUES,
  FULFILLMENT_STATUS_LABEL,
);
export const ORDER_SOURCE_OPTIONS = toOptions(ORDER_SOURCE_VALUES, ORDER_SOURCE_LABEL);
export const PAYMENT_CHANNEL_OPTIONS = toOptions(PAYMENT_CHANNEL_VALUES, PAYMENT_CHANNEL_LABEL);

// ── searchParams 解析(白名單守門 + 分頁頁碼)──

type RawSearchParams = Record<string, string | string[] | undefined>;

/** 取單一字串(searchParams 值可能是 string[];取首個)。 */
function firstValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/** 若 value 在白名單內回該值(narrow 成 enum);否則 undefined(非法忽略、不篩選)。 */
function pickEnum<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T | undefined {
  const v = firstValue(raw);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** page 解析:正整數、預設 1、下界 1(非法 / 缺 → 1)。 */
export function parsePage(raw: string | string[] | undefined): number {
  const v = firstValue(raw);
  if (v === undefined) return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

/**
 * 解析 searchParams → { filter(白名單守門後的雙軸+次要), page }。
 * 非法篩選值一律忽略(等同不篩選);page 下界 1。
 */
export function parseOrderListSearchParams(raw: RawSearchParams): {
  filter: AdminOrderFilter;
  page: number;
} {
  const filter: AdminOrderFilter = {
    paymentStatus: pickEnum(raw[PAYMENT_STATUS_PARAM], PAYMENT_STATUS_VALUES),
    fulfillmentStatus: pickEnum(raw[FULFILLMENT_STATUS_PARAM], FULFILLMENT_STATUS_VALUES),
    orderSource: pickEnum(raw[ORDER_SOURCE_PARAM], ORDER_SOURCE_VALUES),
    paymentChannel: pickEnum(raw[PAYMENT_CHANNEL_PARAM], PAYMENT_CHANNEL_VALUES),
  };
  return { filter, page: parsePage(raw[PAGE_PARAM]) };
}

// ── 分頁 ──

export type PaginationView = {
  totalPages: number;
  /** 目前頁 clamp 到 [1, totalPages](顯示「第 X／Y 頁」用) */
  currentPage: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** 本頁第一筆的 1-indexed 序(本頁無列 → 0) */
  rangeStart: number;
  /** 本頁最後一筆的 1-indexed 序(本頁無列 → 0) */
  rangeEnd: number;
};

/**
 * 依 total / 目前頁 / 每頁筆數 / **本頁實際回傳筆數** 算分頁狀態(page 已下界 1)。
 *
 * 🔴 range 由「真實 offset + shownCount」推導(非 clamp 頁的理論範圍)→ footer 顯示永遠與表格一致:
 * URL 竄改成超界頁(如 page=999)時本頁 shownCount=0 → rangeStart/End=0(footer 不謊報「第 21–37 筆」);
 * hasPrev/hasNext 用未 clamp 的 page 判(超界頁 hasNext=false、hasPrev=true 可退回)。total 0 → totalPages 1、range 0。
 */
export function computePagination(
  total: number,
  page: number,
  pageSize: number = ORDERS_PAGE_SIZE,
  shownCount: number = 0,
): PaginationView {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const rangeStart = shownCount === 0 ? 0 : offset + 1;
  const rangeEnd = shownCount === 0 ? 0 : offset + shownCount;
  return {
    totalPages,
    currentPage: Math.min(page, totalPages),
    hasPrev: page > 1,
    hasNext: page < totalPages,
    rangeStart,
    rangeEnd,
  };
}

/**
 * 建 `/orders?...` 連結(分頁 / 篩選保留);只帶有值的鍵、page=1 省略(乾淨 URL)。
 * 篩選值來自 filter(已白名單);page 由 caller 指定(prev/next)。
 */
export function buildOrderListHref(filter: AdminOrderFilter, page: number): string {
  const params = new URLSearchParams();
  if (filter.paymentStatus) params.set(PAYMENT_STATUS_PARAM, filter.paymentStatus);
  if (filter.fulfillmentStatus) params.set(FULFILLMENT_STATUS_PARAM, filter.fulfillmentStatus);
  if (filter.orderSource) params.set(ORDER_SOURCE_PARAM, filter.orderSource);
  if (filter.paymentChannel) params.set(PAYMENT_CHANNEL_PARAM, filter.paymentChannel);
  if (page > 1) params.set(PAGE_PARAM, String(page));
  const qs = params.toString();
  return qs ? `/orders?${qs}` : '/orders';
}

/**
 * formatOrderDate:ISO timestamptz → `YYYY-MM-DD`(en-CA locale + Asia/Taipei 時區)。
 * 對齊會員側 order-display.formatOrderDate(避免 UTC 邊界 off-by-one);admin 跨 app 不共用該檔、此處重定。
 */
export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

/** 金額顯示:orders 金額為 integer 元位(非分;migration 20260604120000 註解「金額一律 integer 元位」)→ 千分位。 */
export function formatOrderAmount(amount: number): string {
  return amount.toLocaleString('en-US');
}
