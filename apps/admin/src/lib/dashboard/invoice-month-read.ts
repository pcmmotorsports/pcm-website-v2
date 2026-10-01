import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isoBackToTaipeiYmd, taipeiDayStartIso } from '@pcm/domain';

// invoice-month-read.ts — 首頁「發票月統計」(規格 v3 `~/pcm-mailbox/0912-後台UX/規格-發票金額月統計-v3.md`;
//    plan `docs/plans/2026-09-13-invoice-issued-at-monthly-stats-plan.md` §P3)。
//
// 兩個數並排 + 差額(Sean 逐字「我的營業額跟我開發票的金額是覺得不一樣的」⇒ 價值就在看得出差多少):
//    · 本月開票金額 = Σ `orders.invoice_amount`,`invoice_status = 'issued'` 且 `invoice_issued_at` 在本月
//      (🔴 按**開立日**分月,不是登記日、不是建單日 —— Sean Q3 乙)。
//    · 本月營業額   = 本月收到的錢 − 手續費 − 本月退出去的錢(2026-10-01 Sean Q33 乙 + Q41 甲,報價單Q1):
//      按【收款日】分月(不是建單日);運費與稅都算在內(= 實際進帳);刷卡 / TapPay 扣 2.5%、蝦皮扣蝦皮扣款;
//      手續費不退。算式在 DB 的 `admin_revenue_between`(20261001170000),這裡只讀它的結果。
//      🔴 舊算式(Σ subtotal − discount_total、按建單日、排除已退款)整個換掉:部分退款單原本整張全額計入。
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
  /** 本月收款 − 手續費 − 退款(整數元,`admin_revenue_between`);`null` = 讀取失敗。 */
  revenueAmount: number | null;
  /** 本月應收手續費而沒有費率的收款筆數(那幾筆手續費先當 0 ⇒ 營業額偏高);`null` = 讀取失敗。 */
  revenueMissingFeeCount: number | null;
  /** 已開立而沒填開立日期的張數(不計入上面);`null` = 讀取失敗。 */
  issuedWithoutDateCount: number | null;
  /** 開票撈列撞到上限 ⇒ 開票金額是**下限**(營業額在 DB 加總, 沒有上限問題)。 */
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
    settle(supabase.rpc('admin_revenue_between', { p_from: fromIso, p_to: toIso })),
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
  const truncated = (issuedRows?.length ?? 0) > INVOICE_MONTH_ROW_LIMIT;
  // RPC 回一列 { received, fees, refunds, revenue, missing_fee_count };bigint 經 PostgREST 可能是字串。
  const revenueRow = revenue.error
    ? fail('營業額', revenue.error)
    : (((Array.isArray(revenue.data) ? revenue.data[0] : revenue.data) ?? null) as Record<string, unknown> | null);
  const safeInt = (v: unknown, what: string): number | null => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isSafeInteger(n) ? n : fail(what, new Error(`不是安全整數(收到 ${String(v)})`));
  };
  if (revenueRow === null && !revenue.error) fail('營業額', new Error('RPC 沒有回任何列'));
  const revenueAmount = revenueRow === null ? null : safeInt(revenueRow.revenue, '營業額');
  const revenueMissingFeeCount = revenueRow === null ? null : safeInt(revenueRow.missing_fee_count, '沒有費率筆數');

  return {
    month,
    // 🔴 `invoice_amount` 是 nullable(員工可能只登記狀態沒填金額)⇒ 當 0 加,不當失敗。
    invoicedAmount: sumSafe(issuedRows, (r) => (r.invoice_amount === null ? 0 : Number(r.invoice_amount))),
    revenueAmount,
    revenueMissingFeeCount,
    issuedWithoutDateCount: missing.error
      ? fail('沒填日期張數', missing.error)
      : Number.isSafeInteger(missing.count)
        ? (missing.count as number)
        : fail('沒填日期張數', new Error(`count 不是安全整數(收到 ${String(missing.count)})`)),
    truncated,
  };
}
