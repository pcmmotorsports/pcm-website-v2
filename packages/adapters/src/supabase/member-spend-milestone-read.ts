// 一般會員「這一班新滿 10 萬」人數(Sean 2026-09-27 更正 E 選丙:對象是一般會員 tier=general, 不是經銷會員;
// 滿了什麼都不改 —— 不升級、不設折扣, 只讓 Sean 知道有這位大客戶)。
// 計畫:docs/plans/2026-09-27-member-spend-milestone.md。
// 累積 = 已出貨且沒取消的訂單「小計 − 折扣」(不含運費、稅), 扣掉已確認且沒作廢的卡退款、沒作廢的人工退款;儲值不算。
// 只提醒一次(無狀態):現在累積 ≥ 10 萬, 而扣掉「上一班到這一班才出貨」的訂單後 < 10 萬 ⇒ 算這一班新滿。
// 只讀不寫。每張表分頁讀完(每頁 1000 列, PostgREST 單次上限), 不會因為列數多而少算。
// 🔵 住在 adapters(主視窗 2026-09-27 裁 Q1 甲):它要用退款兩本帳的作廢欄過濾, 而
//    scripts/storefront-projection-leak-guard.test.ts 禁止 storefront 原始碼出現那個欄名(防前台讀到採購作廢欄)。
//    這支讀的是退款表、只在顧客站排程(伺服器端)跑, 與採購無關;照 SupabaseOrderAdapter 的層放在這裡,
//    只經 `@pcm/adapters/server`(server-only subpath)匯出。那道守門本身不動。

export const SPEND_MILESTONE = 100_000;
const PAGE = 1000;
const HOUR_MS = 60 * 60 * 1000;

type Rows<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type Query<T> = Rows<T> & {
  select(cols: string): Query<T>;
  eq(col: string, v: unknown): Query<T>;
  is(col: string, v: null): Query<T>;
  in(col: string, vs: readonly string[]): Query<T>;
  gte(col: string, v: string): Query<T>;
  lt(col: string, v: string): Query<T>;
  order(col: string): Query<T>;
  range(from: number, to: number): Query<T>;
};
/** 只用得到 from().select() 加上面那幾個過濾與分頁;真的 service client 以 unknown 轉進來。 */
export type SpendReadClient = { from<T = Record<string, unknown>>(table: string): Query<T> };

type OrderRow = { id: string; customer_user_id: string; subtotal: number; discount_total: number };
type RefundRow = { order_id: string; refund_amount: number };

/**
 * 這一班的時間範圍 = [上一班, 這一班),對齊排程 `0 1,13 * * *`(UTC = 台北 09:00 / 21:00;
 * supabase/migrations/20260915120000_m4b_anomaly_alert_twice_daily.sql)。
 * 對齊整點而不是「現在往回 12 小時」:排程晚幾秒跑時, 相鄰兩班的範圍才會剛好接上, 不漏也不重疊。
 */
export function digestWindow(now: Date): { since: Date; until: Date } {
  const until = new Date(now);
  until.setUTCMinutes(0, 0, 0);
  const h = until.getUTCHours();
  until.setUTCHours(h >= 13 ? 13 : h >= 1 ? 1 : -11); // -11 = 前一天 13:00
  return { since: new Date(until.getTime() - 12 * HOUR_MS), until };
}

function spendTotals(orders: readonly OrderRow[], refunds: readonly RefundRow[]) {
  const net = new Map(orders.map((o) => [o.id, o.subtotal - o.discount_total]));
  for (const r of refunds) {
    const v = net.get(r.order_id);
    if (v !== undefined) net.set(r.order_id, v - r.refund_amount);
  }
  const total = new Map<string, number>();
  for (const o of orders) total.set(o.customer_user_id, (total.get(o.customer_user_id) ?? 0) + (net.get(o.id) ?? 0));
  return { net, total };
}

export function countNewlyOverMilestone(args: {
  orders: readonly OrderRow[];
  cardRefunds: readonly RefundRow[];
  manualRefunds: readonly RefundRow[];
  /** 這一班才出貨的訂單。 */
  recentOrderIds: ReadonlySet<string>;
  threshold: number;
}): number {
  const { net, total } = spendTotals(args.orders, [...args.cardRefunds, ...args.manualRefunds]);
  const before = new Map(total);
  for (const o of args.orders) {
    if (args.recentOrderIds.has(o.id)) before.set(o.customer_user_id, (before.get(o.customer_user_id) ?? 0) - (net.get(o.id) ?? 0));
  }
  return [...total].filter(([user, v]) => v >= args.threshold && (before.get(user) ?? 0) < args.threshold).length;
}

async function readAll<T>(make: () => Query<T>, orderBy = 'id'): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().order(orderBy).range(from, from + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export async function readNewMilestoneMemberCount(
  client: SpendReadClient,
  now: Date,
  threshold: number = SPEND_MILESTONE,
): Promise<number> {
  const members = await readAll(
    () => client.from<{ user_id: string }>('customers').select('user_id').eq('tier', 'general').is('disabled_at', null),
    'user_id',
  );
  const memberIds = new Set(members.map((m) => m.user_id));
  if (memberIds.size === 0) return 0;
  // 訂單不用 in(會員名單) 過濾:名單長了網址會太長;全讀已出貨的再在這裡篩。
  const orders = (
    await readAll(() =>
      client
        .from<OrderRow>('orders')
        .select('id, customer_user_id, subtotal, discount_total')
        .eq('fulfillment_status', 'shipped')
        .is('cancelled_at', null),
    )
  ).filter((o) => memberIds.has(o.customer_user_id));
  if (orders.length === 0) return 0;
  const [cardRefunds, manualRefunds] = await Promise.all([
    readAll(() =>
      client.from<RefundRow>('order_refunds').select('order_id, refund_amount').eq('status', 'confirmed').is('voided_at', null),
    ),
    readAll(() => client.from<RefundRow>('order_manual_refunds').select('order_id, refund_amount').is('voided_at', null)),
  ]);
  const { total } = spendTotals(orders, [...cardRefunds, ...manualRefunds]);
  const over = [...total].filter(([, v]) => v >= threshold).map(([user]) => user);
  if (over.length === 0) return 0;

  // 這一班出貨的包裹 → 包裹品項 → 訂單。整張訂單的出貨時間 = 它最後一箱的 shipped_at;
  // 目前已全部出貨的訂單, 「有一箱在這一班寄出」就等於「最後一箱在這一班」。
  const { since, until } = digestWindow(now);
  const shipments = await readAll(() =>
    client
      .from<{ id: string }>('shipments')
      .select('id')
      .in('customer_user_id', over)
      .is('deleted_at', null)
      .gte('shipped_at', since.toISOString())
      .lt('shipped_at', until.toISOString()),
  );
  if (shipments.length === 0) return 0;
  const items = await readAll(() =>
    client
      .from<{ order_item_id: string }>('shipment_items')
      .select('order_item_id')
      .in('shipment_id', shipments.map((s) => s.id)),
  );
  if (items.length === 0) return 0;
  const orderItems = await readAll(() =>
    client
      .from<{ order_id: string }>('order_items')
      .select('order_id')
      .in('id', [...new Set(items.map((i) => i.order_item_id))]),
  );
  return countNewlyOverMilestone({
    orders,
    cardRefunds,
    manualRefunds,
    recentOrderIds: new Set(orderItems.map((i) => i.order_id)),
    threshold,
  });
}
