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
  OrderStatusOption,
} from '@pcm/domain';
import { pickEnum, parsePage, buildListHref, type FilterOption } from '../shared/list-params';

/** 每頁筆數(server 端 .range 分頁)。 */
export const ORDERS_PAGE_SIZE = 20;

/** 查詢字串鍵名(與 DB 欄對齊、URL 可讀)。 */
export const PAYMENT_STATUS_PARAM = 'payment_status';
export const FULFILLMENT_STATUS_PARAM = 'fulfillment_status';
export const ORDER_SOURCE_PARAM = 'order_source';
export const PAYMENT_CHANNEL_PARAM = 'payment_channel';
export const WORKFLOW_STATUS_PARAM = 'workflow_status';

/**
 * workflow_status 篩選的「未設定」哨兵值(URL `?workflow_status=unset` → filter.workflowStatus=null)。
 * ⚠️ 'unset' 本身是合法 code slug → Slice D 設定 UI 須保留字擋掉,避免真 code 撞哨兵被吞。
 */
export const WORKFLOW_STATUS_UNSET_VALUE = 'unset';

/** workflow_status code 合法形狀(對齊 DB CHECK orders_workflow_status_format;非法值忽略=不篩)。 */
const WORKFLOW_STATUS_CODE_RE = /^[a-z0-9_]{1,64}$/;

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
 * 非法篩選值一律忽略(等同不篩選);page 下界 1(parsePage 共用)。
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
    workflowStatus: parseWorkflowStatusParam(raw[WORKFLOW_STATUS_PARAM]),
  };
  return { filter, page: parsePage(raw.page) };
}

/**
 * workflow_status 篩選值解析(動態詞彙、無靜態 enum 可 pickEnum → 改「形狀守門」):
 * - 缺 / 陣列 / 空字串 / 非法形狀 → undefined(不篩;等同其他軸的非法值忽略);
 * - `'unset'` 哨兵 → null(只看未設定);
 * - 合法 slug → 原樣(不存在的 code 查回 0 筆、無注入面〔supabase-js 參數化〕、無害)。
 */
function parseWorkflowStatusParam(raw: string | string[] | undefined): string | null | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  if (raw === WORKFLOW_STATUS_UNSET_VALUE) return null;
  return WORKFLOW_STATUS_CODE_RE.test(raw) ? raw : undefined;
}

/** 建 `/orders?...` 連結(分頁 / 篩選保留;page=1 省略);走共用 buildListHref。 */
export function buildOrderListHref(filter: AdminOrderFilter, page: number): string {
  return buildListHref(
    '/orders',
    [
      [
        WORKFLOW_STATUS_PARAM,
        filter.workflowStatus === null ? WORKFLOW_STATUS_UNSET_VALUE : filter.workflowStatus,
      ],
      [PAYMENT_STATUS_PARAM, filter.paymentStatus],
      [FULFILLMENT_STATUS_PARAM, filter.fulfillmentStatus],
      [ORDER_SOURCE_PARAM, filter.orderSource],
      [PAYMENT_CHANNEL_PARAM, filter.paymentChannel],
    ],
    page,
  );
}

// ── workflow_status 彩色 badge 檢視模型(M-4a Slice A;純函式、單測)──────────
// Sean 的主操作狀態欄:label/color 來自 order_status_options(DB 策展),顯示端兜 NULL / 未知 code。

/** badge 檢視模型:known=true 用 DB 色(inline style);known=false 中性灰(Tailwind class)。 */
export type WorkflowStatusBadgeView = {
  label: string;
  /** 底色 hex(known=false 時空字串、元件走中性樣式) */
  color: string;
  /** 'light' 深底淺字 / 'dark' 淺底深字 */
  textColor: 'light' | 'dark';
  /** false = NULL(未設定)或 code 查無選項(被改碼/停用後刪?soft-delete 下罕見)→ 中性灰兜底 */
  known: boolean;
};

/**
 * workflow_status → badge 檢視模型:
 * - NULL → 「未設定」中性灰(新進線上單未 triage 態;對齊 Sean Sheet「新列他手動設狀態」心智);
 * - 選項命中(含 is_active=false 停用者;soft-delete 語意=舊單仍解析得到)→ DB label+color;
 * - 查無 code → 原樣顯示 code 的中性灰(誠實呈現、不編造 label)。
 */
export function workflowStatusBadge(
  code: string | null,
  optionsByCode: ReadonlyMap<string, OrderStatusOption>,
): WorkflowStatusBadgeView {
  if (code === null) {
    return { label: '未設定', color: '', textColor: 'dark', known: false };
  }
  const option = optionsByCode.get(code);
  if (!option) {
    return { label: code, color: '', textColor: 'dark', known: false };
  }
  return { label: option.label, color: option.color, textColor: option.textColor, known: true };
}

/** options 陣列 → code 索引 Map(頁面查一次、列表逐列 O(1) 解析)。 */
export function indexOrderStatusOptions(
  options: OrderStatusOption[],
): ReadonlyMap<string, OrderStatusOption> {
  return new Map(options.map((o) => [o.code, o]));
}

/**
 * 篩選下拉選項:active 選項 +「未設定」哨兵。
 * `current` = 目前 URL 篩選值:若為「合法但不在 active 清單」的 code(停用選項/未知 code),
 * 補一項讓 defaultValue 有落點 —— 否則下拉回顯「全部」、使用者重送 form 會靜默清掉篩選(code-reviewer nit)。
 */
export function workflowStatusFilterOptions(
  options: OrderStatusOption[],
  current?: string | null,
): FilterOption[] {
  const active = options.filter((o) => o.isActive).map((o) => ({ value: o.code, label: o.label }));
  if (typeof current === 'string' && !active.some((o) => o.value === current)) {
    const known = options.find((o) => o.code === current);
    active.push({ value: current, label: known ? `${known.label}(已停用)` : current });
  }
  return [...active, { value: WORKFLOW_STATUS_UNSET_VALUE, label: '未設定' }];
}

/** filter.workflowStatus(undefined|null|code)→ <select> defaultValue 字串。 */
export function workflowStatusSelectValue(
  workflowStatus: string | null | undefined,
): string | undefined {
  if (workflowStatus === undefined) return undefined;
  return workflowStatus === null ? WORKFLOW_STATUS_UNSET_VALUE : workflowStatus;
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
