import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isoBackToTaipeiYmd, taipeiDayStartIso } from '@pcm/domain';

// invoice-month-read.ts — 首頁「發票月統計」(規格 v3 `~/pcm-mailbox/0912-後台UX/規格-發票金額月統計-v3.md`;
//    plan `docs/plans/2026-09-13-invoice-issued-at-monthly-stats-plan.md` §P3)。
//
// 兩個數並排 + 差額(Sean 逐字「我的營業額跟我開發票的金額是覺得不一樣的」⇒ 價值就在看得出差多少):
//    · 本月開票金額 = Σ `orders.invoice_amount`,`invoice_status = 'issued'` 且 `invoice_issued_at` 在本月
//      (🔴 按**開立日**分月,不是登記日、不是建單日 —— Sean Q3 乙)。
//    · 本月營業額   = Σ (`subtotal` − `discount_total`),`created_at` 台北月在本月,扣掉已取消 / 已退款
//      (🔴 不含運費、不含稅 ⇒ **不能用 `total`**:`orders_total_balances` 是
//       `total = subtotal + shipping_fee - discount_total + tax_total`,`20260828100000:278-281`)。
//      ⚠️ 「含稅單 subtotal 已含稅、稅另計單 subtotal 未稅」這條算式通吃的前提是 `inclusive` 單 `tax_total = 0`
//         —— 那是**今天成立的事實、不是 DB 保證**。2026-09-13 正式庫唯讀重跑:`inclusive AND tax_total <> 0` = **0 張**。
//         哪天不是 0,算式要改 `subtotal − discount_total − tax_total` 並回頭問 Sean 那種單怎麼來的。
//    · 另有 X 張已開立而沒填開立日期,不計入 —— 🔴 **恆印**,連 0 也印:`20260913080000` 的 CHECK 落地後
//      它理論上恆為 0,而這一行是那道 CHECK 還活著的唯一可見證據。
//
// 🔴 撈列再加總,不走 RPC:`service_role` 對 `orders` 有 SELECT(2026-09-13 正式庫 `has_table_privilege` = t),
//    而月單量兩位數(正式庫 2026-09 共 9 張)。**撈列就要帶截斷旗標**(`today-read.ts` 檔頭那條:
//    不帶 `.limit` 會在 PostgREST `db-max-rows`(實測 2000)處**靜默截斷、金額只會偏小**)
//    ⇒ `.limit(N+1)`、超過就把 `truncated` 送到畫面,寧可說「不完整」也不給安靜的錯數字。
//    🔴 `INVOICE_MONTH_ROW_LIMIT` 必須**嚴格小於 2000**,否則 `length > N` 恆假、旗標恆不亮(`today-read.ts` 記過)。
//
// 🔴 `null` = 沒讀到,不是 0。「這個月還沒開發票」是 0,是月初的常態。

export const INVOICE_MONTH_ROW_LIMIT = 1000;

export type InvoiceMonthStats = {
  /** 台北曆面的本月,`YYYY-MM`。 */
  month: string;
  /** Σ invoice_amount(整數元);`null` = 讀取失敗。 */
  invoicedAmount: number | null;
  /** Σ (subtotal − discount_total),整數元;`null` = 讀取失敗。 */
  revenueAmount: number | null;
  /** 已開立而沒填開立日期的張數(不計入上面);`null` = 讀取失敗。 */
  issuedWithoutDateCount: number | null;
  /** 任一支撈列查詢撞到上限 ⇒ 對應那個數是**下限**。 */
  truncated: boolean;
};

/** 台北月界:`[本月 1 日, 下月 1 日)`,曆面日 + 絕對時刻各一份。 */
export function taipeiMonthRange(now: Date): {
  month: string;
  fromYmd: string;
  toYmd: string;
  fromIso: string;
  toIso: string;
} {
  const ymd = isoBackToTaipeiYmd(now);
  const [y, m] = ymd.split('-').map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const fromYmd = `${y}-${pad(m)}-01`;
  const toYmd = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const fromIso = taipeiDayStartIso(fromYmd);
  const toIso = taipeiDayStartIso(toYmd);
  if (fromIso === null || toIso === null) {
    throw new Error(`invoice-month-read: 台北月界換算失敗(ymd=${ymd})`);
  }
  return { month: `${y}-${pad(m)}`, fromYmd, toYmd, fromIso, toIso };
}

function sumSafe(rows: unknown[] | null, pick: (r: Record<string, unknown>) => number): number | null {
  if (rows === null) return null;
  let sum = 0;
  for (const r of rows) {
    const v = pick(r as Record<string, unknown>);
    if (!Number.isSafeInteger(v)) return null;
    sum += v;
  }
  return Number.isSafeInteger(sum) ? sum : null;
}

export async function loadInvoiceMonthStats(now: Date = new Date()): Promise<InvoiceMonthStats> {
  const { month, fromYmd, toYmd, fromIso, toIso } = taipeiMonthRange(now);
  const supabase = createSupabaseServiceClient();
  const settle = <T,>(p: PromiseLike<T>) =>
    Promise.resolve(p).then(
      (v) => v,
      (error: unknown) => ({ data: null, count: null, error }) as T,
    );

  const [issued, revenue, missing] = await Promise.all([
    settle(
      supabase
        .from('orders')
        .select('invoice_amount')
        .eq('invoice_status', 'issued')
        .gte('invoice_issued_at', fromYmd)
        .lt('invoice_issued_at', toYmd)
        .limit(INVOICE_MONTH_ROW_LIMIT + 1),
    ),
    settle(
      supabase
        .from('orders')
        .select('subtotal, discount_total')
        .gte('created_at', fromIso)
        .lt('created_at', toIso)
        .is('cancelled_at', null)
        .neq('payment_status', 'refunded')
        .limit(INVOICE_MONTH_ROW_LIMIT + 1),
    ),
    settle(
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('invoice_status', 'issued')
        .is('invoice_issued_at', null),
    ),
  ]);

  const fail = (what: string, error: unknown): null => {
    console.error(`[invoice-month-read] ${what} 讀取失敗`, error);
    return null;
  };

  const issuedRows = issued.error ? fail('開票金額', issued.error) : (issued.data ?? []);
  const revenueRows = revenue.error ? fail('營業額', revenue.error) : (revenue.data ?? []);
  const truncated =
    (issuedRows?.length ?? 0) > INVOICE_MONTH_ROW_LIMIT ||
    (revenueRows?.length ?? 0) > INVOICE_MONTH_ROW_LIMIT;

  return {
    month,
    // 🔴 `invoice_amount` 是 nullable(員工可能只登記狀態沒填金額)⇒ 當 0 加,不當失敗。
    invoicedAmount: sumSafe(issuedRows, (r) => (r.invoice_amount === null ? 0 : Number(r.invoice_amount))),
    revenueAmount: sumSafe(revenueRows, (r) => Number(r.subtotal) - Number(r.discount_total)),
    issuedWithoutDateCount: missing.error
      ? fail('沒填日期張數', missing.error)
      : Number.isSafeInteger(missing.count)
        ? (missing.count as number)
        : fail('沒填日期張數', new Error(`count 不是安全整數(收到 ${String(missing.count)})`)),
    truncated,
  };
}
