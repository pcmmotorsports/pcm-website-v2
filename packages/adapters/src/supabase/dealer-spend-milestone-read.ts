// 經銷會員累積消費滿 10 萬(Sean 2026-09-27 E2 甲:只通知 Sean, 由他在後台設品牌折扣;不自動升級、不動價格)。
// 計畫:docs/plans/2026-09-27-dealer-spend-milestone.md。
// 累積 = 已出貨且沒取消的訂單「小計 − 折扣」(不含運費、稅), 扣掉已確認且沒作廢的卡退款、沒作廢的人工退款;儲值不算。
// 只讀不寫。讀到 PostgREST 單次上限(1000 列)時 throw ⇒ 呼叫端當成讀不到, 不給偏少的數。
// 🔵 住在 adapters(主視窗 2026-09-27 裁 Q1 甲):它要用退款兩本帳的作廢欄過濾, 而
//    scripts/storefront-projection-leak-guard.test.ts 禁止 storefront 原始碼出現那個欄名(防前台讀到採購作廢欄)。
//    這支讀的是退款表、只在顧客站排程(伺服器端)跑, 與採購無關;照 SupabaseOrderAdapter 的層放在這裡,
//    只經 `@pcm/adapters/server`(server-only subpath)匯出。那道守門本身不動。

export const DEALER_SPEND_MILESTONE = 100_000;
const PAGE_CAP = 1000;

type Rows<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
type Query<T> = Rows<T> & {
  select(cols: string): Query<T>;
  eq(col: string, v: unknown): Query<T>;
  is(col: string, v: null): Query<T>;
  in(col: string, vs: readonly string[]): Query<T>;
  limit(n: number): Query<T>;
};
/** 只用得到 from().select().eq/is/in/limit 這一條鏈;真的 service client 以 unknown 轉進來。 */
export type SpendReadClient = { from<T = Record<string, unknown>>(table: string): Query<T> };

type OrderRow = { id: string; customer_user_id: string; subtotal: number; discount_total: number };
type RefundRow = { order_id: string; refund_amount: number };

export function countDealersOverMilestone(args: {
  orders: readonly OrderRow[];
  cardRefunds: readonly RefundRow[];
  manualRefunds: readonly RefundRow[];
  threshold: number;
}): number {
  const owner = new Map(args.orders.map((o) => [o.id, o.customer_user_id]));
  const total = new Map<string, number>();
  const add = (user: string | undefined, n: number) => {
    if (user) total.set(user, (total.get(user) ?? 0) + n);
  };
  for (const o of args.orders) add(o.customer_user_id, o.subtotal - o.discount_total);
  for (const r of [...args.cardRefunds, ...args.manualRefunds]) add(owner.get(r.order_id), -r.refund_amount);
  return [...total.values()].filter((v) => v >= args.threshold).length;
}

async function rows<T>(q: Rows<T>, what: string): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  const list = data ?? [];
  if (list.length >= PAGE_CAP) throw new Error(`${what} 讀到單次上限 ${PAGE_CAP} 列, 可能不完整`);
  return list;
}

export async function readDealerSpendMilestoneCount(
  client: SpendReadClient,
  threshold: number = DEALER_SPEND_MILESTONE,
): Promise<number> {
  const dealers = await rows(
    client.from<{ user_id: string }>('customers').select('user_id').eq('tier', 'store').is('disabled_at', null).limit(PAGE_CAP),
    'customers',
  );
  if (dealers.length === 0) return 0;
  const orders = await rows(
    client
      .from<OrderRow>('orders')
      .select('id, customer_user_id, subtotal, discount_total')
      .in('customer_user_id', dealers.map((d) => d.user_id))
      .eq('fulfillment_status', 'shipped')
      .is('cancelled_at', null)
      .limit(PAGE_CAP),
    'orders',
  );
  if (orders.length === 0) return 0;
  const ids = orders.map((o) => o.id);
  const [cardRefunds, manualRefunds] = await Promise.all([
    rows(
      client
        .from<RefundRow>('order_refunds')
        .select('order_id, refund_amount')
        .in('order_id', ids)
        .eq('status', 'confirmed')
        .is('voided_at', null)
        .limit(PAGE_CAP),
      'order_refunds',
    ),
    rows(
      client
        .from<RefundRow>('order_manual_refunds')
        .select('order_id, refund_amount')
        .in('order_id', ids)
        .is('voided_at', null)
        .limit(PAGE_CAP),
      'order_manual_refunds',
    ),
  ]);
  return countDealersOverMilestone({ orders, cardRefunds, manualRefunds, threshold });
}
