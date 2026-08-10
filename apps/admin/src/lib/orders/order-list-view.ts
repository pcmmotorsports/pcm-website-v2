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
  InvoiceStatus,
} from '@pcm/domain';
import { normalizeOrderNumberSearch, normalizeSupplierOrderNoSearch } from '@pcm/domain';
import type { SupplierOrderNoSearch } from '@pcm/domain';
import {
  pickEnum,
  pickEnumMulti,
  firstValue,
  parsePage,
  buildListHref,
  type FilterOption,
} from '../shared/list-params';
// #350d:面板判準要 uuid 閘;一次性參數清單與 `order-return-to.ts` 共用單一來源
// (兩邊各寫一份 = 補了 `rt` 卻只補一邊,症狀是重複鍵讓取消面板永遠讀不到)。
import { isUuid } from './note-action-state';
import { ORDER_PANEL_PARAM, RESULT_ONLY_PARAMS } from './order-return-to';
// #347-3c-1:曆面日 ↔ 絕對時刻的換算只有 domain 一份(自己拼 `new Date(ymd)` 是 UTC 午夜、差 8 小時)。
import {
  taipeiDayEndExclusiveIso,
  taipeiDayStartIso,
  recentTaipeiMonthsRange,
  taipeiYmdFromDayEndExclusive,
  taipeiYmdFromInstantIso,
} from '@pcm/domain';

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
/** 供應商單號搜尋 query param(M-4b E10 A10c2;與 A9b1 的 `order_no` **分立**、語意完全不同)。 */
export const SUPPLIER_ORDER_NO_PARAM = 'supplier_no';
/**
 * 「連刷卡未付款一起顯示」切換(M-4b 生命週期 L6)。
 * 🔴 **只有字面 `'1'` 才算開**:任何其他值(`'true'` / `'0'` / 空字串 / 未知字串)一律當關 ——
 * 預設隱藏是 Sean 要的行為,解析出錯時要倒向**預設**,不是倒向「全顯示」。
 * ⚠️ 同鍵重複(`?show_unpaid_card=1&show_unpaid_card=x`)**取首值後再比對** —— 與其他軸一致;
 *    直接拿陣列比字串會恆 false,那會讓「勾打開後一翻頁就失效」(測試 L6-4 釘住)。
 */
export const SHOW_UNPAID_CARD_PARAM = 'show_unpaid_card';
export const SHOW_UNPAID_CARD_ON = '1';

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

// ── 狀態膠囊配色(M-4b E10 A11b,2026-08-07:訂單列表付款軸/訂貨軸從純文字改膠囊上色)──
// 出貨軸本片不做(A11b plan §1:`AdminOrderItemQuantitySummary` 無 shipped 欄,前置 = A11a-6)。
// 形狀逐字元同 `notes-timeline.tsx:89`(含 `font-medium`);`customer-detail-sections.tsx:23` 那族
// 少一個 `font-medium`、不是同款。Record 驅動配色的先例 =
// `notes-timeline.tsx:15-19`,語彙 = 綠完成 / 琥珀進行中或要注意 / 灰中性或未開始 / 紅要處理。

/** 共用膠囊形狀。桌機與卡片兩份 markup 都套同一顆 class 常數,不各自組一份字串。 */
export const STATUS_CAPSULE = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';

/**
 * 付款軸五態配色。**訊號塌陷解除**的精確意思 = `refunded` / `partiallyRefunded` 不再與 `paid`
 * 同灰(那正是 A11a-1 登記的病)。`unpaid` 沿用既有唯一上紅那態的顏色,顏色本身不變。
 *
 * 🔴 **不是「五態兩兩可辨」** —— 本表只有 **4 個色相**,`partiallyPaid` 與 `partiallyRefunded`
 *    **同為琥珀**(兩者標籤不同、讀得出來,且都屬「未結、要看一下」)。要五色互異得引入
 *    repo 目前沒有的第 5 色相 = 視覺決定,未經 Sean 拍板不要自己加。
 */
export const PAYMENT_STATUS_CAPSULE: Record<PaymentStatus, string> = {
  paid: 'bg-emerald-100 text-emerald-700',
  unpaid: 'bg-destructive/10 text-destructive',
  partiallyPaid: 'bg-amber-100 text-amber-700',
  refunded: 'bg-muted text-muted-foreground',
  partiallyRefunded: 'bg-amber-100 text-amber-700',
};

/**
 * 訂貨軸完成度配色(依 `orderedQuantity` vs `quantity` 三段):
 * `ordered === 0` 灰(還沒開始)/ `0 < ordered < quantity` 琥珀(部分)/
 * `ordered >= quantity` 綠(齊了)。回傳**已組好含 `STATUS_CAPSULE` 的完整 class**,
 * 呼叫端直接套用、不用自己拼字串(桌機/卡片一致性由此保證)。
 *
 * ⚠️ **誠實邊界:兩個分支邊界在可達資料上構造不出來,`>=` 是 fail-safe、不是因為測過** ——
 *    超訂(`ordered > quantity`)被 A1 的 `oiqs_ordered_le_quantity` CHECK 擋在 DB;
 *    `quantity === 0` 被 `order_items.quantity > 0` CHECK 擋住。日後那兩道 CHECK 若鬆綁,
 *    這裡的行為(超訂顯綠 / 0/0 顯灰)要重新評估。
 */
export function orderedCapsuleClass(ordered: number, quantity: number): string {
  const color =
    ordered === 0
      ? 'bg-muted text-muted-foreground'
      : ordered >= quantity
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-amber-100 text-amber-700';
  return `${STATUS_CAPSULE} ${color}`;
}

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

/**
 * 開票紀錄狀態標籤(`orders.invoice_status`;DB CHECK 三值)。
 *
 * 🔴 **明細與列表共用**(A11a-5 起):原本住在 `order-detail-view.ts`,但該檔檔頭逐字宣告
 * 「列表共用標籤(付款/出貨/來源/管道)仍在 `order-list-view.ts`、本檔不重定義」——
 * 發票欄進列表之後它就成了共用標籤,依那條慣例搬過來。
 * ⇒ **不要在任何一邊另抄一份三態中文**:A11a plan V11 要的是「三態各自可辨識、且 `voided`
 * 不與 `not_issued` 同字面」,共用一個 `Record<InvoiceStatus, string>` 讓這件事結構上成立。
 */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  not_issued: '未開立',
  issued: '已開立',
  voided: '已作廢',
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

/**
 * 日期範圍下拉的選項(#347-3c-2)。
 *
 * 🔴🔴 **區間由 server 算好、連同 label 一起傳給 client** —— client 一個字都不碰時鐘。
 *    理由:①`new Date()` 在 server 與 client 各算一次會 hydration 不一致(而症狀是
 *    「重整之後選中的選項跳掉」這種沒人查得出來的東西)②算得出來才測得到:
 *    這支是純函式、吃 `now`,邊界(月界、跨年)在單測裡構造得出來。
 * 🔴 **沒有「全部」選項**:那是 plan §1-1 認列過的誠實代價 —— 要看更早的單就選「自訂」
 *    給一個很早的起日。沒有逃生口的預設等於把舊單藏起來,所以**自訂與預設必須同片**。
 */
const ORDER_DATE_PRESETS = [
  { key: 'm1', label: '近一個月', months: 1 },
  { key: 'm3', label: '近三個月', months: 3 },
  { key: 'm6', label: '近半年', months: 6 },
  { key: 'y1', label: '近一年', months: 12 },
] as const;

/** 「自訂」那一格的 key —— 它沒有預先算好的區間,由員工自己填兩個日期。 */
export const ORDER_DATE_CUSTOM_KEY = 'custom';

/**
 * 「未選」時的預設 —— Sean Q14=A 逐字「未選預設近半年」。
 * 🔴 它是**下拉的預設選項**(看得見、改得動),不是隱形過濾:
 *    `parseOrderListSearchParams` 套它的同時,`buildOrderListHref` 會把日期寫進 URL、
 *    篩選列也會把「近半年」顯示成選中 ⇒ 員工看得到自己正在看的是哪段期間。
 *    這條的來由與被推翻的舊方案見 plan §1-1 的推翻框。
 */
export const ORDER_DATE_DEFAULT_KEY = 'm6';

export type OrderDatePresetOption = {
  key: string;
  label: string;
  fromYmd: string;
  toYmd: string;
};

/** 把每個預設算成具體的曆面日區間(台北曆面;`now` 由呼叫端注入)。 */
export function buildOrderDatePresetOptions(now: Date): OrderDatePresetOption[] {
  return ORDER_DATE_PRESETS.map(({ key, label, months }) => {
    const { fromYmd, toYmd } = recentTaipeiMonthsRange(now, months);
    return { key, label, fromYmd, toYmd };
  });
}

/**
 * 目前選中的是哪一格 —— 拿當下的 from/to 去比對每個預設算出來的區間。
 *
 * 🔴 **這是「選中的選項」與「生效的區間」之間唯一的連結**:比對不上就顯示「自訂」,
 *    而不是硬選一個 —— 顯示「近半年」卻篩著別的區間,比顯示「自訂」糟得多。
 * ⚠️ 誠實邊界:區間是**相對今天**算的 ⇒ 昨天分享的一條「近半年」網址,今天打開會顯示「自訂」
 *    (因為它的迄日停在昨天)。那是對的:它篩的**確實**不是今天的近半年。
 */
function matchOrderDatePreset(
  options: readonly OrderDatePresetOption[],
  fromYmd: string,
  toYmd: string,
): string {
  return (
    options.find((o) => o.fromYmd === fromYmd && o.toYmd === toYmd)?.key ?? ORDER_DATE_CUSTOM_KEY
  );
}

// ── searchParams 解析(白名單守門 + 分頁頁碼)──

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * 解析 searchParams → { filter(白名單守門後的雙軸+次要), page }。
 * 非法篩選值一律忽略(等同不篩選);多勾選軸(D-1b:來源/管道)收同鍵重複 param、
 * 逐值守門+去重、全非法/缺 → undefined;page 下界 1(parsePage 共用)。
 */
export function parseOrderListSearchParams(
  raw: RawSearchParams,
  options?: {
    orderNumberSearchEnabled?: boolean;
    supplierOrderNoSearchEnabled?: boolean;
    /**
     * #347-3c-2「未選預設近半年」用的**現在時刻**。
     *
     * 🔴 **不給就不套預設**(= 3c-1 的行為,不限期間)。刻意做成 opt-in 而不是 `?? new Date()`:
     *    ①本函式是純函式,內建時鐘就測不出邊界;②「有沒有套預設」變成呼叫端明講的事,
     *    而不是某個檔案深處的預設值 —— 這一軸會**藏掉半年前的單**,那個決定要看得見。
     */
    now?: Date;
  },
): {
  filter: AdminOrderFilter;
  page: number;
  /**
   * 供應商單號搜尋的正規化結果(M-4b E10 A10c2)。
   *
   * 🔴 **為什麼要一起回傳、而不是讓頁面自己再 normalize 一次**:Sean Q1=A 要求
   * 「非 ASCII 要**明示**是什麼問題」,而 adapter 對三種 invalid 一視同仁(都回零筆)——
   * 理由只有正規化那一刻知道。若頁面自己再跑一次,就變成**兩個呼叫點各自正規化**,
   * 哪天其中一邊改了參數(例如 flag 判斷)兩邊就會不一致 ⇒ 顯示的理由與實際篩的東西對不上。
   * flag 未開時恆為 `empty`(與 `filter.supplierOrderNo` 同一個閘)。
   */
  supplierOrderNoSearch: SupplierOrderNoSearch;
  /** #347-3c-2:日期下拉的選項(server 算好;沒給 `now` 時為空陣列 = 不顯示下拉)。 */
  datePresetOptions: OrderDatePresetOption[];
  /** #347-3c-2:選中的那一格(`custom` = 兩個日期輸入)。 */
  selectedDatePresetKey: string;
} {
  const supplierOrderNoSearch: SupplierOrderNoSearch = options?.supplierOrderNoSearchEnabled
    ? normalizeSupplierOrderNoSearch(firstValue(raw[SUPPLIER_ORDER_NO_PARAM]))
    : { kind: 'empty' };
  const dateRange = resolveOrderDateRange(raw, options?.now);
  const filter: AdminOrderFilter = {
    paymentStatus: pickEnum(raw[PAYMENT_STATUS_PARAM], PAYMENT_STATUS_VALUES),
    fulfillmentStatus: pickEnum(raw[FULFILLMENT_STATUS_PARAM], FULFILLMENT_STATUS_VALUES),
    orderSources: pickEnumMulti(raw[ORDER_SOURCE_PARAM], ORDER_SOURCE_VALUES),
    paymentChannels: pickEnumMulti(raw[PAYMENT_CHANNEL_PARAM], PAYMENT_CHANNEL_VALUES),
    orderNumber: options?.orderNumberSearchEnabled
      ? parseOrderNumberParam(raw[ORDER_NUMBER_PARAM])
      : undefined,
    supplierOrderNo: supplierOrderNoToFilterValue(supplierOrderNoSearch),
    // L6:唯一開關值 '1';其餘一律 false(fail-safe 倒向預設隱藏)。
    includeUnpaidCardOrders: firstValue(raw[SHOW_UNPAID_CARD_PARAM]) === SHOW_UNPAID_CARD_ON,
    // #347-3c-1:曆面日 → 絕對時刻。形狀不合 ⇒ `undefined`(該側不限)、不是回零筆
    //    —— 日期打錯字只是「這一軸不篩」,其他軸照舊生效,不會造出假的查無
    //    (與 `orderNumber` / `supplierOrderNo` 相反,理由在 domain `date-range.ts`)。
    // 🔴 **#347-3c-2 起這裡有預設了**(3c-1 那句「本片沒有預設」已被推翻,不要照舊讀):
    //    呼叫端給 `options.now` 才套(見 `resolveOrderDateRange`)—— 給不給是呼叫端明講的事,
    //    因為這一軸會**藏掉半年前的單**。可見性由同一份結果的 `selectedDatePresetKey` 保證。
    createdFrom: dateRange.createdFrom,
    createdTo: dateRange.createdTo,
  };
  return {
    filter,
    page: parsePage(raw.page),
    supplierOrderNoSearch,
    datePresetOptions: dateRange.options,
    /** 篩選列要把哪一格顯示成選中(= 真正生效的那段期間;兩者同源,不可能對不上)。 */
    selectedDatePresetKey: dateRange.selectedKey,
  };
}

/**
 * 日期軸:URL → 生效區間 + 下拉狀態(#347-3c-2)。
 *
 * 三種狀態,**只有這裡決定**(選中的選項與生效的區間同源 ⇒ 結構上不可能對不上):
 * ① URL 帶了合法日期 ⇒ 用它,選中的格子由 `matchOrderDatePreset` 比對(對不上 = 自訂);
 * ② URL 沒帶、且呼叫端給了 `now` ⇒ **套預設近半年**(看得見:下拉顯示「近半年」、
 *    而 `buildOrderListHref` 會把日期寫進 URL);
 * ③ URL 沒帶、也沒給 `now` ⇒ 不限期間、不顯示下拉(= 3c-1 的行為)。
 *
 * 🔴 **只帶一邊也算「帶了」**:員工用自訂只填起日是合理的(「這天之後的全部」),
 *    那時不得把另一邊補成預設 —— 補了就是「我只設了起日,迄日卻被系統偷偷設成今天」。
 */
function resolveOrderDateRange(
  raw: RawSearchParams,
  now: Date | undefined,
): {
  createdFrom: string | undefined;
  createdTo: string | undefined;
  options: OrderDatePresetOption[];
  selectedKey: string;
} {
  const fromYmd = firstValue(raw[DATE_FROM_PARAM]) ?? '';
  const toYmd = firstValue(raw[DATE_TO_PARAM]) ?? '';
  const fromIso = taipeiDayStartIso(fromYmd);
  const toIso = taipeiDayEndExclusiveIso(toYmd);
  const options = now === undefined ? [] : buildOrderDatePresetOptions(now);

  if (fromIso !== null || toIso !== null) {
    return {
      createdFrom: fromIso ?? undefined,
      createdTo: toIso ?? undefined,
      options,
      selectedKey: matchOrderDatePreset(options, fromYmd, toYmd),
    };
  }
  if (now === undefined) {
    return { createdFrom: undefined, createdTo: undefined, options, selectedKey: ORDER_DATE_CUSTOM_KEY };
  }
  const preset = options.find((o) => o.key === ORDER_DATE_DEFAULT_KEY);
  // 🔴 找不到預設那一格 = `ORDER_DATE_PRESETS` 與 `ORDER_DATE_DEFAULT_KEY` 不同步
  //    ⇒ 不靜默降級成「不限期間」(那會讓預設默默消失、而畫面上沒人說),直接當自訂空區間。
  if (preset === undefined) {
    return { createdFrom: undefined, createdTo: undefined, options, selectedKey: ORDER_DATE_CUSTOM_KEY };
  }
  return {
    createdFrom: taipeiDayStartIso(preset.fromYmd) ?? undefined,
    createdTo: taipeiDayEndExclusiveIso(preset.toYmd) ?? undefined,
    options,
    selectedKey: preset.key,
  };
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

/**
 * 供應商單號搜尋參數解析(M-4b E10 A10c2)。
 *
 * 🔴 **flag 未開時整個不解析**(同 A10c1 的理由,但前置不同):本功能的 DB 前置是
 * A9b2-M 的產生欄 `order_item_procurement.supplier_order_no_upper`
 * (`supabase/migrations/20260807130000_…`)。未 apply 就開 ⇒ PostgREST 42703 ⇒
 * **整個訂單列表**(不只搜尋)進錯誤態。⇒ A9b2-M apply 之前 flag 一律 off。
 *
 * 🔴 **`invalid` 不吞掉、原樣往下傳**:adapter 對 invalid 會 fail-closed 回零筆。
 * 這裡若把它當成 `undefined`,就變成「打錯字 = 不篩選 = 列出全部訂單」的 fail-open。
 *
 * 🔴 **`firstValue` 是必要的、不是排版**:`?supplier_no=a&supplier_no=b` 解析出來是**陣列**,
 * 而 `normalizeSupplierOrderNoSearch` 對非字串回 `empty` = 不篩選 = **列出全部訂單**。
 * 少了這道收斂,一條手打的 URL 就能把搜尋變成 fail-open(Fable F6)。
 */
function supplierOrderNoToFilterValue(parsed: SupplierOrderNoSearch): string | undefined {
  if (parsed.kind === 'empty') return undefined;
  return parsed.kind === 'ok' ? parsed.value : parsed.input;
}

/**
 * 右側面板要開哪一張單(#350c;主視窗 2026-08-10 裁 A 案)。
 *
 * 🔴 面板**不是** intercepting route —— v1 走過那條,真瀏覽器實測「軟導航回列表時面板黏著不放」,
 * 而 Next 文件的兩種標準修法(槽 catch-all、槽精確空頁)實測**皆無效**(`D-403-Q` §①)。
 * 改成 searchParams 驅動之後 **URL 一變槽頁就重算**,黏住問題從根消失。
 *
 * ⚠️ **定義搬到 `order-return-to.ts`**(#350d):那支要拿它比對「`return_to` 指的是不是同一張單」
 * (契約 §6-1),而它不能反向 import 本檔(會成環)。這裡 re-export 讓既有 import 路徑不變 ——
 * 兩邊各寫一份字面才是真的坑。
 */
export { ORDER_PANEL_PARAM } from './order-return-to';

/**
 * 建立日期範圍(#347-3c-1)。URL 上帶的是**曆面日 `YYYY-MM-DD`**(員工看得懂、網址可分享),
 * filter 裡放的是**絕對時刻** —— 兩者的換算只有 `@pcm/domain` 的 `date-range.ts` 一份。
 * 🔴 `date_to` 是**含當天**的結束日(進 filter 時變成下一個台北午夜,見 domain 檔頭)。
 */
export const DATE_FROM_PARAM = 'date_from';
export const DATE_TO_PARAM = 'date_to';

/**
 * 面板要不要開,**唯一判準**(#350d)。
 *
 * 🔴🔴 **列表要停畫自己那條橫幅時,必須問這一支、不得自己看 `panel` 有沒有出現**
 *    (契約 §2 C2 的「有 `panel` 時列表零橫幅、面板恰一條」)。
 *    `?panel=not-a-uuid&r=saved` 時槽頁回 `null`(面板不開)⇒ 若列表用「`panel` 這個 key 在不在」
 *    當判準就會**同時停畫** ⇒ **零橫幅**:動作做完了,畫面上一個字都不說。
 *    兩邊共用同一支函式,那個分岔就不存在(memory `feedback_verify-anchor-with-the-guards-own-command`
 *    的同型:判準要用守門自己那條命令去數)。
 */
export function readOpenPanelOrderId(
  raw: Record<string, string | string[] | undefined>,
): string | null {
  const value = raw[ORDER_PANEL_PARAM];
  // 🔴 **正規化成小寫**(R2 F1):`isUuid` 是 `/i`(`note-action-state.ts:42`)⇒ 大寫 UUID 過閘,
  //    但表單送的 `order_id` 是 `detail.id`(DB 出來一律小寫)⇒ `parseOrderReturnTo` 的
  //    §6-1 比對會判「不同單」⇒ 動作做完**靜默把面板關掉**。觸發只要一條大寫的書籤網址。
  //    在**入口**折平比在比對處放寬安全:後者等於讓兩個不同字串被當成同一張單。
  return typeof value === 'string' && isUuid(value) ? value.toLowerCase() : null;
}

/**
 * 關閉面板時要一起丟掉的**一次性**參數:面板本身,加上只對「剛剛那個動作」有意義的三個。
 * `r` = 結果碼橫幅;`rt` = 取消結果的核對 token;`correct` = A10a-3 更正模式目標。
 * 留著它們的話,關掉面板後重整會莫名其妙又進更正模式 / 又跳一次橫幅。
 *
 * 🔴 **`rt` 是 #350d 補的**(原本漏了)。在 #350c 它只是「網址上多一個沒用的參數」,
 *    但 #350d 起這份清單被 `buildPanelSelfHref` 拿去當 `return_to` 的來源 ——
 *    夾帶舊 `rt` 的話 action 再接一顆新的 ⇒ `?rt=舊&rt=新` 重複鍵 ⇒ D3 classifier fail-closed
 *    ⇒ 面板永遠只說「查不到取消紀錄」。第二道守門在 `order-return-to.ts` 的 `RESULT_ONLY_PARAMS`
 *    (那支是五支 action 的共同 choke point,擋的是手打 / 偽造的 `return_to`)。
 */
const ONE_SHOT_PARAMS = new Set<string>([ORDER_PANEL_PARAM, ...RESULT_ONLY_PARAMS]);

/**
 * 關閉面板的連結 = **拿掉一次性參數之後的當下 URL**(#350c)。
 *
 * 🔴 為什麼是「刪 param」而不是「重跑一次 `buildOrderListHref`」:重建要再讀一次兩個搜尋啟用旗標
 * 並重新解析篩選 = 把列表的解析規則抄第二份。抄錯的那天,症狀是員工按「返回」之後篩選條件被靜默洗掉
 * —— 正是下面 `buildOrderListHref` 那兩條 🔴 註記過兩次的坑。刪 param 則**逐字保留**當下所有查詢條件,
 * 連本支不認得的參數也不會弄丟。
 *
 * 🔴 放在本檔(不是放在槽頁裡)是為了**測得到**:它原本是 `app/@panel/orders/page.tsx` 的私有函式,
 * 而 page 檔不能隨便多開具名 export(Next 對 page 模組的 export 形狀有規定)⇒ 沒有任何測試碰得到它。
 * codex 關卡2(2026-08-10)實測擊破:把它改成固定回 `/orders`(= 關閉面板就把篩選全洗掉),
 * 當時六組守門**全綠**。
 */
export function buildPanelCloseHref(
  raw: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (ONE_SHOT_PARAMS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }
  const qs = params.toString();
  return qs ? `/orders?${qs}` : '/orders';
}

/**
 * **面板這個視圖的網址、扣掉一次性狀態**(#350d;五支 action 的 `return_to` 值)。
 *
 * ⚠️ 措辭精確(code-reviewer R1 nit-7):不是「當下網址原封不動」—— `r`/`rt`/`correct` 會被剝掉。
 *    `correct`(更正模式)被剝是對的:動作做完那筆備註已經更正了,回到更正模式等於叫他再改一次;
 *    整頁版今天的行為也是丟掉它(`/orders/{id}?r=…`)。
 *
 * ⚠️ **它逐字複製 raw 的每一個參數**(連本支不認得的也留)⇒ 網址上的垃圾參數會一起被帶進
 *    `return_to`,而 `parseOrderReturnTo` 對「整串超過 512」與「含 `..`」都是 fail-closed
 *    ⇒ 症狀是**動作做完靜默跳回整頁版、面板關掉**(R2 F2)。兩條都不是安全問題,
 *    但下次有人回報「面板偶爾自己關掉」,先來看這裡而不是去查 React。
 *
 * = 關閉連結 **再把 `panel` 加回去**。復用 `buildPanelCloseHref` 而不是另寫一份掃描:
 * 那支已經被 codex 擊破過一次、也已經有測試釘著「篩選逐字保留」,重抄一份只會多一個會漂移的規格。
 *
 * 🔴 **不要拿 `back.href` 當 `return_to`**(契約字面更正,`D-420-NOTE` §1):
 *    `back.href` 在面板版就是**關閉**連結 ⇒ 動作做完面板會被關掉,C1 的目的直接落空。
 * ⚠️ `panelOrderId` 呼叫端要先過 uuid 閘(`readOpenPanelOrderId`);本支只負責拼。
 */
export function buildPanelSelfHref(
  raw: Record<string, string | string[] | undefined>,
  panelOrderId: string,
): string {
  const base = buildPanelCloseHref(raw);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${ORDER_PANEL_PARAM}=${panelOrderId}`;
}

/**
 * 建 `/orders?...` 連結(分頁 / 篩選保留;page=1 省略);多勾選軸=同鍵重複 param;走共用 buildListHref。
 *
 * 🔴 **面板連結一定要走本支、不得在元件裡自己拼字串**(#350c):下方那兩條 🔴 註警告的
 * 「漏帶參數 = 搜尋詞被靜默丟掉、列表 fail-open 變全部訂單」對面板連結同樣成立 ——
 * 員工點開一張單就把篩選條件洗掉,是同一個坑的第三次。
 */
/** `buildListHref` 吃的一組 `[param, value]`。 */
type HrefEntry = readonly [string, string | readonly string[] | undefined];

/**
 * `keyword` 那一格的 param 名 —— **一個不存在的鍵**,值恆為 `undefined` ⇒ 永遠不會進 URL。
 * 🔴 用具名常數而不是空字串:讓「為什麼這一軸沒有 param」在 grep 得到的地方留下答案。
 */
const ORDER_KEYWORD_URL_EXCLUDED = '__keyword_lives_in_httponly_cookie__';

export function buildOrderListHref(
  filter: AdminOrderFilter,
  page: number,
  /** 有值 = 這條連結把該訂單開進右側面板;不給 = 關閉面板(列表狀態照舊保留)。 */
  panelOrderId?: string,
): string {
  // 🔴🔴 **編譯期窮舉守門(#347-3c-1;機制優先律 —— 不是再寫一條「記得列進來」的規則)**:
  //    型別是 `Record<keyof AdminOrderFilter, …>` ⇒ **filter 加一軸而這裡沒列,`tsc` 直接紅**。
  //    在這之前是手抄列舉,而漏列的症狀是「翻頁時那一軸靜默消失、畫面上的選擇還在」——
  //    本檔已為不同的軸記過**兩次**同一個坑(下面兩條 🔴),第三次改用機制擋。
  //    ⚠️ 這道**只保證「每個軸都被做過決定」**,保證不了那個決定是對的:對到錯的 param 名、
  //      或該帶卻寫 `undefined`,型別一樣過。那半靠 `order-list-view.test.ts` 的往返測試。
  const byFilterKey: Record<keyof AdminOrderFilter, HrefEntry> = {
    paymentStatus: [PAYMENT_STATUS_PARAM, filter.paymentStatus],
    fulfillmentStatus: [FULFILLMENT_STATUS_PARAM, filter.fulfillmentStatus],
    orderSources: [ORDER_SOURCE_PARAM, filter.orderSources],
    paymentChannels: [PAYMENT_CHANNEL_PARAM, filter.paymentChannels],
    // 🔴 分頁與 returnTo 都走這裡:漏列 = 翻頁或改狀態回跳時搜尋詞被靜默丟掉、
    //    列表突然變成全部訂單(fail-open)。
    orderNumber: [ORDER_NUMBER_PARAM, filter.orderNumber],
    supplierOrderNo: [SUPPLIER_ORDER_NO_PARAM, filter.supplierOrderNo],
    // 🔴 L6 的開關同理必須帶著走:漏列 = 員工打開「連未付款一起看」之後一翻頁
    //    就被打回預設隱藏,而畫面上的勾還打著 = 顯示與實際篩的東西不一致。
    includeUnpaidCardOrders: [
      SHOW_UNPAID_CARD_PARAM,
      filter.includeUnpaidCardOrders ? SHOW_UNPAID_CARD_ON : undefined,
    ],
    // 🔴🔴 **`keyword` 刻意不進 URL**(#347-2b;Sean Q-a=B 紅線):搜尋詞是 PII
    //    (客人姓名 / 電話 / 地址),它住在 httpOnly cookie 裡。寫在這裡是為了讓
    //    「這一軸被做過決定」留下字面,而不是看起來像漏掉。
    keyword: [ORDER_KEYWORD_URL_EXCLUDED, undefined],
    // #347-3c-1:URL 帶曆面日、filter 帶絕對時刻 ⇒ 這裡換回曆面日(換算只有 domain 一份)。
    createdFrom: [
      DATE_FROM_PARAM,
      // 🔴 走帶 NaN 閘的那支(R1 must-fix 1):`isoBackToTaipeiYmd(new Date(''))` 會擲 RangeError
      //    ⇒ 型別上合法的空字串會把整個 `/orders` 打成 500,而不是這一格失效。
      filter.createdFrom === undefined
        ? undefined
        : (taipeiYmdFromInstantIso(filter.createdFrom) ?? undefined),
    ],
    createdTo: [
      DATE_TO_PARAM,
      filter.createdTo === undefined
        ? undefined
        : (taipeiYmdFromDayEndExclusive(filter.createdTo) ?? undefined),
    ],
  };
  return buildListHref(
    '/orders',
    [
      ...Object.values(byFilterKey),
      // #350c:面板目標(**不是 filter 的軸**,所以不在上面那個 Record 裡)。
      //    `undefined` 會被 buildListHref 略過 ⇒ 不給 = 關閉面板。
      [ORDER_PANEL_PARAM, panelOrderId] as HrefEntry,
    ],
    page,
  );
}

// 🔴 **`formatOrderDate` 已於 A9c(2026-08-06)刪除**(主視窗裁定,`E-116-A`)。
// A11a-2 把列表日期格改接 `formatOrderListDate` 之後,它的 production consumer 歸零;
// A11a plan `:185` 保留它的理由「明細頁在用」是**錯的前提** —— 明細頁走的是
// `order-detail-view.ts` 的 `formatOrderDateTime`(到分),從來不是本支(只到日)。
// 會員側 `apps/storefront/src/lib/orders/order-display.ts` 有同名但**另一份**函式,不受影響。

const TAIPEI_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Asia/Taipei 曆面的年/月/日(讀 `formatToParts`,不切任何格式化字串 —— 那會在格式一改就靜默切錯)。 */
function taipeiParts(d: Date): { year: string; month: string; day: string } {
  const parts = TAIPEI_YMD.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * formatOrderListDate:**列表專用**日期字面(M-4b E10 A11a-2)。
 * 母 plan §5.1a「改寫 | 日期 → `07/25`」那列逐字:**同年 `07/25`、跨年才補年份**(`2025/06/27`);
 * 完整時間戳仍在 DB。
 *
 * 🔴 A11a-2 新增本支時 plan `:185` 要求「不改 `formatOrderDate`(明細頁在用)」;實查那個前提是錯的,
 * A9c 已依主視窗裁定把 `formatOrderDate` 刪除(見上方註)。本支現為 admin 列表日期的唯一格式化面。
 *
 * 🔴 非法 iso **不 throw**:`formatToParts(Invalid Date)` 會擲 `RangeError`,而本函式在 server component
 * 內呼叫 ⇒ 會把「一格顯示垃圾」升級成「整個 `/orders` 500」。照 `note-timeline.ts:85` 既有慣例原樣回傳。
 *
 * 🔴 `now` 可注入:「同年」是相對**當下**的判斷,綁死真時鐘會讓斷言在跨年那天自己變色,
 * 而且跨年那一格根本構造不出來。production 呼叫端不帶第二參數、走真時鐘。
 * 🔴 年份比較在 **Asia/Taipei 曆面**做、不是拿 UTC 年份比:UTC `2025-12-31T16:30Z` 在台北已是 2026-01-01,
 * 用 UTC 年份會把它誤判成跨年、多印一個 `2025/`。
 */
export function formatOrderListDate(iso: string, now: Date = new Date()): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const t = taipeiParts(parsed);
  const current = taipeiParts(now);
  return t.year === current.year ? `${t.month}/${t.day}` : `${t.year}/${t.month}/${t.day}`;
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
