import type { AdminOrderFilter } from '@pcm/domain';
import { taipeiDayEndExclusiveIso, taipeiDayStartIso, taipeiYmdFromDayEndExclusive, taipeiYmdFromInstantIso } from '@pcm/domain';
import {
  ORDER_SOURCE_LABEL,
  ORDER_SOURCE_VALUES,
  PAYMENT_CHANNEL_LABEL,
} from './order-list-view';

// order-toolbar-view.ts — 訂單頁工具列(v22 稿)的**純函式層**:chip 定義、選中判定、月份切換的日界。
//    元件 `components/orders/order-toolbar.tsx` 只排版;數字由 `lib/orders/order-list-count.ts` 算。
//
// 🔴 **chip 不是新的判準,是把既有 URL 參數(`order-list-view.ts` 的白名單)映到幾顆按鈕**
//    (主視窗 2026-09-13:「既有篩選參數語意保留、改成 URL 參數對映到 chips 與月份」):
//    · 第一列 6 顆「狀態」chip ⇒ `goods_axis` / `pending` / `payment_status`
//    · 第三列「只看」chip ⇒ `payment_status`(尾款未收 / 已退款)· `show_unpaid_card` · `order_source` · `payment_channel` · `tier`(Q5 乙)
//    · 月份切換 ⇒ `date_from` / `date_to`(台北曆面整月)
//    舊書籤帶任何合法參數進來照舊生效;只是畫面上可能沒有一顆 chip 亮(例:`payment_status=paid`)。
//
// ⛔ ~~🔴 **稿有、而今天沒有對應篩選軸的三顆(多樣的單 / 車行 / 直客)不畫**~~ ⇒ Q5 乙(2026-09-14)加軸:
//    車行 / 直客 / 經銷 = `customerTiers`(view 既有 `tier_at_checkout`,零 SQL);多樣的單 = `multiItemOnly`(S3,要 view 加 item_count)。
//
// 🔴 「未完成」= 貨品軸三值(none / ordered / instock)⇒ 本片同時把 `parseOrderListSearchParams` 的
//    `.slice(0, 1)` clamp 拿掉(那條註解逐字說「片 B 的 chip UI 才放開、兩件事必須同一片」,舊的單選下拉本片退場)。

/** 第一列 chip 擁有的鍵:換 chip 時**先清這三個**再套(少清一個就是「高亮跳了、清單沒跳」)。 */
export const STATUS_CHIP_KEYS = ['goodsAxes', 'pendingOnly', 'paymentStatus'] as const;
type StatusChipKey = (typeof STATUS_CHIP_KEYS)[number];
export type StatusChipFilter = Partial<Pick<AdminOrderFilter, StatusChipKey>>;

export type StatusChipSpec = {
  key: string;
  label: string;
  filter: StatusChipFilter;
  /** 稿 `.todo button.warn`(待收款的數字用警示色)/ `.done`(已完成整顆灰)。 */
  tone?: 'warn' | 'done';
};

export const STATUS_CHIPS: readonly StatusChipSpec[] = [
  { key: 'open', label: '未完成', filter: { goodsAxes: ['none', 'ordered', 'instock'] } },
  // 🔴 `pendingOnly` 帶進列表那條「排除已取消 / 已退款」(adapter goodsAxes/pendingOnly 兩段同一條);
  //    只給 `paymentStatus: 'unpaid'` 會把已取消的未付款單也數進來。
  { key: 'unpaid', label: '待收款', filter: { paymentStatus: 'unpaid', pendingOnly: true }, tone: 'warn' },
  { key: 'to-order', label: '待下訂', filter: { goodsAxes: ['none'] } },
  { key: 'ordered', label: '等到貨', filter: { goodsAxes: ['ordered'] } },
  { key: 'instock', label: '可出貨', filter: { goodsAxes: ['instock'] } },
  { key: 'shipped', label: '已完成', filter: { goodsAxes: ['shipped'] }, tone: 'done' },
];

export const CLEARED_STATUS_FILTER: StatusChipFilter = Object.fromEntries(
  STATUS_CHIP_KEYS.map((k) => [k, undefined]),
) as StatusChipFilter;

function norm(v: unknown): string {
  if (v === undefined || v === false || v === null) return '';
  if (Array.isArray(v)) return v.length === 0 ? '' : [...v].map(String).sort().join(',');
  return String(v);
}

export function statusChipActive(chip: StatusChipSpec, filter: AdminOrderFilter): boolean {
  return STATUS_CHIP_KEYS.every((k) => norm(filter[k]) === norm(chip.filter[k]));
}

/** 套一顆狀態 chip 之後的 filter(其他軸原樣帶著走)。 */
export function applyStatusChip(filter: AdminOrderFilter, chip: StatusChipSpec): AdminOrderFilter {
  return { ...filter, ...CLEARED_STATUS_FILTER, ...chip.filter };
}

/** 第三列「只看」chip 擁有的鍵。`paymentStatus` 與第一列共用 —— 按「尾款未收」會讓「待收款」熄掉,那是對的(兩者互斥)。 */
export const VIEW_CHIP_KEYS = [
  'paymentStatus',
  'includeUnpaidCardOrders',
  'orderSources',
  'paymentChannels',
  'customerTiers',
  'multiItemOnly',
] as const;
type ViewChipKey = (typeof VIEW_CHIP_KEYS)[number];
export type ViewChipFilter = Partial<Pick<AdminOrderFilter, ViewChipKey>>;

export type ViewChipSpec = {
  key: string;
  label: string;
  /** `all` = 清掉本列所有鍵。其餘 = 只動自己那一個鍵(可與別的 chip 疊)。 */
  filter: ViewChipFilter;
  /** 哪一個鍵是這顆 chip 的本體(疊加 / 判定選中用);`all` 沒有。 */
  owns?: ViewChipKey;
  group: 'view' | 'source' | 'channel' | 'tier';
};

export const VIEW_CHIPS: readonly ViewChipSpec[] = [
  { key: 'all', label: '全部', filter: {}, group: 'view' },
  { key: 'partial', label: '尾款未收', filter: { paymentStatus: 'partiallyPaid' }, owns: 'paymentStatus', group: 'view' },
  { key: 'refunded', label: '已退款', filter: { paymentStatus: 'refunded' }, owns: 'paymentStatus', group: 'view' },
  // Q5 乙:多樣的單 = 品項列數 > 1(view item_count,`20260914020000`)。稿的第三顆,放「尾款未收」旁。
  { key: 'multi-item', label: '多樣的單', filter: { multiItemOnly: true }, owns: 'multiItemOnly', group: 'view' },
  // 🔴 這一顆的字面要與 `orders/page.tsx` 的 `UNPAID_CARD_HIDDEN_HINT` 一致(page.test 釘著)。
  { key: 'show-unpaid-card', label: '含刷卡未付款', filter: { includeUnpaidCardOrders: true }, owns: 'includeUnpaidCardOrders', group: 'view' },
  ...ORDER_SOURCE_VALUES.map((v): ViewChipSpec => ({
    key: `src-${v}`,
    label: ORDER_SOURCE_LABEL[v],
    filter: { orderSources: [v] },
    owns: 'orderSources',
    group: 'source',
  })),
  ...(['tappay', 'bank_transfer', 'cash'] as const).map((v): ViewChipSpec => ({
    key: `ch-${v}`,
    label: PAYMENT_CHANNEL_LABEL[v],
    filter: { paymentChannels: [v] },
    owns: 'paymentChannels',
    group: 'channel',
  })),
  // Q5 乙(Sean 2026-09-14):稿的「車行 / 直客」+ 主視窗補「經銷」(系統三級,只做兩顆經銷單兩顆都看不到)。
  //    字面照稿(直客 = general,`MEMBER_TIER_LABEL` 印「會員」是列表欄位的字,這裡是篩選語意)。
  ...([
    ['store', '車行'],
    ['general', '直客'],
    ['premiumStore', '經銷'],
  ] as const).map(([v, label]): ViewChipSpec => ({
    key: `tier-${v}`,
    label,
    filter: { customerTiers: [v] },
    owns: 'customerTiers',
    group: 'tier',
  })),
];

export const CLEARED_VIEW_FILTER: ViewChipFilter = Object.fromEntries(
  VIEW_CHIP_KEYS.map((k) => [k, undefined]),
) as ViewChipFilter;

export function viewChipActive(chip: ViewChipSpec, filter: AdminOrderFilter): boolean {
  if (chip.owns === undefined) return VIEW_CHIP_KEYS.every((k) => norm(filter[k]) === '');
  return norm(filter[chip.owns]) === norm(chip.filter[chip.owns]);
}

/** 按「只看」chip:`all` 清整列;選中的再按一次 = 取消那一鍵;否則只換自己那一鍵(其他鍵原樣)。 */
export function applyViewChip(filter: AdminOrderFilter, chip: ViewChipSpec): AdminOrderFilter {
  if (chip.owns === undefined) return { ...filter, ...CLEARED_VIEW_FILTER };
  if (viewChipActive(chip, filter)) return { ...filter, [chip.owns]: undefined };
  return { ...filter, [chip.owns]: chip.filter[chip.owns] };
}

// ── 月份切換 ────────────────────────────────────────────────────────────────

export type MonthKey = { y: number; m: number };

const pad = (n: number) => String(n).padStart(2, '0');

export function monthLabel(k: MonthKey): string {
  return `${k.y} / ${pad(k.m)}`;
}

export function shiftMonth(k: MonthKey, delta: number): MonthKey {
  const idx = k.y * 12 + (k.m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** 台北曆面整月:`date_from` = 1 日、`date_to` = 該月最後一天(列表的 `date_to` 是**含**的曆面日)。 */
export function monthYmdRange(k: MonthKey): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(k.y, k.m, 0)).getUTCDate();
  return { from: `${k.y}-${pad(k.m)}-01`, to: `${k.y}-${pad(k.m)}-${pad(lastDay)}` };
}

/** 整月 ⇒ filter 的兩個絕對時刻(與 parser 對曆面日的換算同一支 domain 函式)。 */
export function monthFilterRange(k: MonthKey): Pick<AdminOrderFilter, 'createdFrom' | 'createdTo'> {
  const { from, to } = monthYmdRange(k);
  return {
    createdFrom: taipeiDayStartIso(from) ?? undefined,
    createdTo: taipeiDayEndExclusiveIso(to) ?? undefined,
  };
}

/** filter 現在的日期範圍**剛好**是台北某一整月 ⇒ 回那個月;否則 null(近半年 / 自訂 / 不限)。 */
export function monthOfFilter(filter: AdminOrderFilter): MonthKey | null {
  if (filter.createdFrom === undefined || filter.createdTo === undefined) return null;
  const from = taipeiYmdFromInstantIso(filter.createdFrom);
  const to = taipeiYmdFromDayEndExclusive(filter.createdTo);
  if (from === null || to === null) return null;
  const [y, m] = from.split('-').map(Number) as [number, number, number];
  const k = { y, m };
  const want = monthYmdRange(k);
  return from === want.from && to === want.to ? k : null;
}

export function currentTaipeiMonth(now: Date): MonthKey {
  const ymd = taipeiYmdFromInstantIso(now.toISOString());
  const [y, m] = (ymd ?? '1970-01-01').split('-').map(Number) as [number, number, number];
  return { y, m };
}
