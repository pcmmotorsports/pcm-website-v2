import Link from 'next/link';
import type { TodaySummary } from '../../lib/dashboard/today-read';
import type { TodayTodoLists } from '../../lib/dashboard/today-todo-read';
import { newOrdersHref } from './today-summary';

// today-todo.tsx — 首頁最上面那一列「今天要做的事」五格(Sean 2026-09-13 拍:
//    新單 · 待收款(匯款) · 待訂貨 · 到貨待出貨 · 退款待處理,每格帶連結,零也印 0 不藏)。
//
// 🔴 五格數字**兩個來源、零自寫判準**:
//    · 新單 / 退款待處理 ⇐ `loadTodaySummary`(與下面「今日對帳」同一份,不重查)
//    · 另外三格 ⇐ `loadTodayTodoLists`:網址先產、再照列表頁讀回、再用同一支查詢算 total
//      ⇒ 卡片上的數字 = 點進去「共 N 筆」,由構造保證(理由在 `lib/dashboard/today-todo-read.ts` 檔頭)。
// 🔴 新單那條連結直接用 `today-summary.tsx` 的 `newOrdersHref`(當天 + 把刷卡未付款放回來),
//    因為那格數的是「今天建立的所有單」含未付款;不帶 `show_unpaid_card=1` 點進去會少幾張。一份,不抄。
// 🔴 退款待處理連 `/orders/refund-exceptions`(側欄那條 2026-09-13 拿掉了,首頁這格是唯一入口):
//    0 ⇒ 灰、非 0 ⇒ 紅(Sean 逐字)。
// 🎨 v20 稿 `.card`:padding 10/12、radius 8;`h4` 12.5/600 muted;`.big` 22/700 tracking −0.3px。
//    `leading-[1.4]` 不能省 —— globals.css FIX-27 會把沒帶 `leading-*` 的 `text-xs/sm` 撐大。

const CARD = 'border-border bg-card block rounded-lg border px-3 py-[10px]';

function TodoCard({
  label,
  count,
  href,
  tone,
  suffix = '',
  note,
}: {
  label: string;
  count: number | null;
  href: string;
  /** `alert` = 非 0 紅(只有退款待處理用);其餘一律前景色。 */
  tone?: 'alert';
  /** 數字後面黏的記號(`+` = 已達上限、是下限)。 */
  suffix?: string;
  /** 一行小字:這個數字為什麼不可盡信(codex must-fix 3:不可靠的數不能長得像精確值)。 */
  note?: string;
}) {
  const failed = count === null;
  const big =
    failed
      ? 'text-destructive text-[13px] leading-[1.4] font-semibold'
      : tone === 'alert' && count > 0
        ? 'text-destructive text-[22px] leading-[1.4] font-bold tracking-[-0.3px] tabular-nums'
        : 'text-foreground text-[22px] leading-[1.4] font-bold tracking-[-0.3px] tabular-nums';
  return (
    <Link
      href={href}
      aria-label={`${label} ${failed ? '讀取失敗' : `${count} 筆`},點這裡看清單`}
      className={`${CARD} hover:border-foreground/30 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none`}
    >
      <h4 className='m-0 text-[12.5px] leading-[1.4] font-semibold text-(--fg-2)'>{label}</h4>
      <p className={`m-0 mt-1 ${big}`}>{failed ? '讀取失敗' : `${count}${suffix}`}</p>
      {note !== undefined && <p className='m-0 text-[12px] leading-[1.4] text-(--fg-2)'>{note}</p>}
    </Link>
  );
}

export const REFUND_PENDING_HREF = '/orders/refund-exceptions';

export function TodayTodo({
  summary,
  lists,
}: {
  /** `null` = `loadTodaySummary` 整支拋 ⇒ 新單 / 退款兩格顯示讀取失敗。 */
  summary: TodaySummary | null;
  lists: TodayTodoLists;
}) {
  return (
    <section aria-label='今天要做的事' data-testid='today-todo'>
      <h2 className='mb-2 text-[13px] leading-[1.4] font-semibold text-(--fg-2)'>今天要做的事</h2>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5'>
        <TodoCard
          label='新單'
          count={summary?.newOrderCount ?? null}
          href={summary === null ? '/orders' : newOrdersHref(summary.ymd)}
        />
        <TodoCard {...lists.unpaidBankTransfer} />
        <TodoCard {...lists.notOrdered} />
        <TodoCard {...lists.instock} />
        {/* 🔴 兩個旗標跟 `today-summary.tsx` 同一份:截斷 ⇒ 數字是下限(黏 `+`);
            更正紀錄讀不到 ⇒ 這個數退化成全部筆數(含已判定的),要講出來。 */}
        <TodoCard
          label='退款待處理'
          count={summary?.refundExceptionCount ?? null}
          href={REFUND_PENDING_HREF}
          tone='alert'
          suffix={summary?.refundExceptionTruncated ? '+' : ''}
          note={
            summary?.refundExceptionVerdictsUnavailable
              ? '含已判定的(更正紀錄讀不到)'
              : summary?.refundExceptionTruncated
                ? '已達上限,實際可能更多'
                : undefined
          }
        />
      </div>
    </section>
  );
}
