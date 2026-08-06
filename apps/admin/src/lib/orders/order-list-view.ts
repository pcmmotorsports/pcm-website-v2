// order-list-view.ts — 後台訂單列表「顯示層」純工具(M-4a 訂單線第一片)。
//
// 訂單專屬:searchParams 白名單守門 / 篩選標籤 / 日期金額格式化。通用分頁數學 / param 解析 / 連結建構
// 走 ../shared/list-params(訂單與客戶列表共用)。無 server-only、無 @/、型別 import 自 @pcm/domain(抹除)→ 可單測。

import type {
  AdminOrderFilter,
  PaymentStatus,
  FulfillmentStatus,
  OrderSource,
  PaymentChannel,
  MemberTier,
  OrderItemVehicleSnapshot,
} from '@pcm/domain';
import { normalizeOrderNumberSearch } from '@pcm/domain';
import {
  pickEnum,
  pickEnumMulti,
  firstValue,
  parsePage,
  buildListHref,
  type FilterOption,
} from '../shared/list-params';

/** 每頁筆數(server 端 .range 分頁)。 */
export const ORDERS_PAGE_SIZE = 20;

/** 查詢字串鍵名(與 DB 欄對齊、URL 可讀)。 */
export const PAYMENT_STATUS_PARAM = 'payment_status';
export const FULFILLMENT_STATUS_PARAM = 'fulfillment_status';
export const ORDER_SOURCE_PARAM = 'order_source';
export const PAYMENT_CHANNEL_PARAM = 'payment_channel';
// A9w2(九碼退場):`workflow_status` 查詢鍵、`unset` 哨兵與其解析函式已下架 ——
// URL 帶 `?workflow_status=…` 自此**被忽略**(白名單只認下列鍵),不再進 `AdminOrderFilter`。
/**
 * 訂單編號搜尋(M-4b E10 A10c1)。同時比對 `display_id` 與 `legacy_display_id`,
 * 讓 D1 改號後客人手上的舊單號仍查得到(合約 = A9b1)。
 */
export const ORDER_NUMBER_PARAM = 'order_no';

// ── 值域(對齊 domain enum + DB CHECK;解析時白名單守門,非法值忽略)──

// 🔴 手抄清單、typecheck 抓不到漏抄(`readonly PaymentStatus[]` 少一個元素不是型別錯誤)。
//    漏抄的後果:新狀態不出現在後台篩選下拉,且 `?payment_status=<新值>` 會被 pickEnum 白名單靜默丟棄。
//    ⇒ PaymentStatus 每次加值必須手動同步本陣列(M-3 RF2a 的 partiallyRefunded 即為此類)。
export const PAYMENT_STATUS_VALUES: readonly PaymentStatus[] = [
  'paid',
  'unpaid',
  'partiallyPaid',
  'refunded',
  'partiallyRefunded',
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
  // M-3 RF2a:部分退款(退了一部分、訂單仍有保留品項)。與會員側 order-display.ts 同字面。
  partiallyRefunded: '已退部分',
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

/**
 * 會員等級標籤(orders.tier_at_checkout;M-4a Slice D-1a 列表「會員等級」欄)。
 * Sean 需求二分:一般 / 車行 —— store 與 premiumStore 皆歸「車行」(進階經銷仍是車行客)。
 */
export const MEMBER_TIER_LABEL: Record<MemberTier, string> = {
  general: '一般',
  store: '車行',
  premiumStore: '車行',
};

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

/**
 * 解析 searchParams → { filter(白名單守門後的雙軸+次要), page }。
 * 非法篩選值一律忽略(等同不篩選);多勾選軸(D-1b:來源/管道)收同鍵重複 param、
 * 逐值守門+去重、全非法/缺 → undefined;page 下界 1(parsePage 共用)。
 */
export function parseOrderListSearchParams(
  raw: RawSearchParams,
  options?: { orderNumberSearchEnabled?: boolean },
): {
  filter: AdminOrderFilter;
  page: number;
} {
  const filter: AdminOrderFilter = {
    paymentStatus: pickEnum(raw[PAYMENT_STATUS_PARAM], PAYMENT_STATUS_VALUES),
    fulfillmentStatus: pickEnum(raw[FULFILLMENT_STATUS_PARAM], FULFILLMENT_STATUS_VALUES),
    orderSources: pickEnumMulti(raw[ORDER_SOURCE_PARAM], ORDER_SOURCE_VALUES),
    paymentChannels: pickEnumMulti(raw[PAYMENT_CHANNEL_PARAM], PAYMENT_CHANNEL_VALUES),
    orderNumber: options?.orderNumberSearchEnabled
      ? parseOrderNumberParam(raw[ORDER_NUMBER_PARAM])
      : undefined,
  };
  return { filter, page: parsePage(raw.page) };
}

/**
 * 單號搜尋參數解析(M-4b E10 A10c1)。
 *
 * 🔴 **flag 未開時整個不解析**(見 {@link parseOrderListSearchParams} 的 options):
 * 本功能的 DB 前置是 D0 migration 的 `orders.legacy_display_id` 欄。D0 未 apply 時
 * 打這條 filter 會讓 PostgREST 回 42703(欄位不存在)⇒ **整個訂單列表**(不只搜尋)
 * 進錯誤態。⇒ D0 apply 之前 flag 一律 off。
 *
 * 🔴 **`invalid` 不吞掉、原樣往下傳**:adapter 對 invalid 會 fail-closed 回零筆。
 * 若這裡把 invalid 當成 `undefined`,就變成「打錯字 = 不篩選 = 列出全部訂單」的 fail-open。
 * (`normalizeOrderNumberSearch` 已把 invalid 的回傳值截到 32 字上限,不會把超長字串帶進 URL。)
 */
function parseOrderNumberParam(raw: string | string[] | undefined): string | undefined {
  const parsed = normalizeOrderNumberSearch(firstValue(raw));
  if (parsed.kind === 'empty') return undefined;
  return parsed.kind === 'ok' ? parsed.value : parsed.input;
}

/** 建 `/orders?...` 連結(分頁 / 篩選保留;page=1 省略);多勾選軸=同鍵重複 param;走共用 buildListHref。 */
export function buildOrderListHref(filter: AdminOrderFilter, page: number): string {
  return buildListHref(
    '/orders',
    [
      [PAYMENT_STATUS_PARAM, filter.paymentStatus],
      [FULFILLMENT_STATUS_PARAM, filter.fulfillmentStatus],
      [ORDER_SOURCE_PARAM, filter.orderSources],
      [PAYMENT_CHANNEL_PARAM, filter.paymentChannels],
      // 🔴 分頁與 returnTo 都走這裡:漏列 = 翻頁或改狀態回跳時搜尋詞被靜默丟掉、
      //    列表突然變成全部訂單(fail-open)。
      [ORDER_NUMBER_PARAM, filter.orderNumber],
    ],
    page,
  );
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

/**
 * 車款快照 → 列表顯示字面(V-3b「年份廠牌車種」欄;order_items.vehicle_snapshot 直出)。
 * dict=「年 品牌 車型」/ free=「年 自由輸入」;NULL(未帶車款)→ null,顯示端兜「—」。純顯示無價/tier 面。
 */
export function formatOrderItemVehicle(vehicle: OrderItemVehicleSnapshot | null): string | null {
  if (vehicle === null) return null;
  if (vehicle.kind === 'dict') {
    return [vehicle.year, vehicle.brand, vehicle.model].filter(Boolean).join(' ');
  }
  return [vehicle.year, vehicle.raw].filter(Boolean).join(' ');
}
