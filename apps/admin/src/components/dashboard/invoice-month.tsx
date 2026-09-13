import type { InvoiceMonthStats } from '../../lib/dashboard/invoice-month-read';
import { formatOrderAmount } from '../../lib/orders/order-list-view';

// invoice-month.tsx — 首頁「發票月統計」(規格 v3;plan §P3)。兩個數並排 + 差額 + 兩行常駐字。
// 🔴 「發票作廢重開會讓過去月份的數字跟著變」**常駐**、不是滑過才出現(Sean 2026-09-13 答甲)。
// 🔴 「另有 X 張已開立而沒填開立日期,不計入」**連 0 也印**:它是 `20260913080000` 那道 CHECK
//    還活著的唯一可見證據(plan §P3)。
// 🔴 差額 = 營業額 − 開票金額;任一邊沒讀到、**或任一邊被截斷**就不算差額,不印一個半真半假的數
//    (codex must-fix 4:兩個下限相減不是差額的下限 —— 少讀 1 張開票,差額會比真值【大】)。
// 🎨 v20 稿:`h4` 12.5/600 muted;`.big` 22/700;`.sub2` 12 muted;`leading-[1.4]` 不省(FIX-27)。

const CARD = 'border-border bg-card rounded-lg border px-3 py-[10px]';
const BIG = 'text-foreground m-0 mt-1 text-[22px] leading-[1.4] font-bold tracking-[-0.3px] tabular-nums';
const FAIL = 'text-destructive m-0 mt-1 text-[13px] leading-[1.4] font-semibold';
const H4 = 'm-0 text-[12.5px] leading-[1.4] font-semibold text-(--fg-2)';
const SUB = 'm-0 text-[12px] leading-[1.4] text-(--fg-2)';

function Amount({ label, value, failText = '讀取失敗' }: { label: string; value: number | null; failText?: string }) {
  return (
    <div className={CARD}>
      <h4 className={H4}>{label}</h4>
      {value === null ? (
        <p className={FAIL}>{failText}</p>
      ) : (
        <p className={BIG}>{value < 0 ? '−' : ''}NT$ {formatOrderAmount(Math.abs(value))}</p>
      )}
    </div>
  );
}

export function InvoiceMonth({ stats }: { stats: InvoiceMonthStats | null }) {
  const [y, m] = (stats?.month ?? '').split('-');
  const title = stats === null ? '發票月統計' : `發票月統計(${y} 年 ${Number(m)} 月)`;
  const diff =
    stats !== null && !stats.truncated && stats.invoicedAmount !== null && stats.revenueAmount !== null
      ? stats.revenueAmount - stats.invoicedAmount
      : null;
  return (
    <section aria-label='發票月統計' data-testid='invoice-month'>
      <h2 className='mb-2 text-[13px] leading-[1.4] font-semibold text-(--fg-2)'>{title}</h2>
      {stats === null ? (
        <p className='text-destructive text-[13px] leading-[1.4]'>
          這一區讀取失敗,數字暫時看不到。請稍後重新整理。
        </p>
      ) : (
        <>
          <div className='grid gap-2 sm:grid-cols-3'>
            <Amount label='本月開了多少發票' value={stats.invoicedAmount} />
            <Amount label='本月營業額(不含運費、不含稅)' value={stats.revenueAmount} />
            <Amount label='差額(營業額 − 開票金額)' value={diff} failText={stats.truncated ? '不完整,不算' : undefined} />
          </div>
          {stats.truncated && (
            <p className='text-destructive mt-2 text-[12px] leading-[1.4]'>
              這個月的單超過查詢上限,上面的金額是不完整的下限。
            </p>
          )}
          <p className={`${SUB} mt-2`}>發票作廢重開會讓過去月份的數字跟著變。</p>
          <p className={SUB}>
            {stats.issuedWithoutDateCount === null
              ? '「已開立而沒填開立日期」的張數讀取失敗。'
              : `另有 ${stats.issuedWithoutDateCount} 張已開立而沒填開立日期,不計入。`}
          </p>
        </>
      )}
    </section>
  );
}
