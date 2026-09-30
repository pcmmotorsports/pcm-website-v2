import Link from 'next/link';
import type { ReactNode } from 'react';
import type { OrderTodoRow } from '../../lib/orders/order-todo-view';
import { ORDER_TODO_EMPTY } from '../../lib/orders/order-todo';

// order-todo-list.tsx — 首頁格子點進來的**待辦模式**畫面(`/orders?…&todo=<格子>`)。
//    plan:`~/pcm-mailbox/計畫-後台今天要做的事-20260930.md` §2-3。
// 🔴 一張單一列、一顆鈕;鈕打開的是訂單列表**既有**的彈窗(`?pay=` / `?next=&do=`), 本元件零寫入、零 client JS。
//    做完那一步回到同一條網址(`todo=` 是顯示軸, `buildOrderListHref` 會帶著它), 那張單不符合篩選就不在清單裡。
// 🔴 工具列、狀態 chip、只看列、勾選列都不畫:這一頁只回答「這一格還有哪幾張要處理」。要看完整資訊點單號進明細頁。
// 🎨 鈕的長相抄 `orders-table.tsx` 下一步那顆(稿 v22 `.act`), 同一個動作在兩個畫面長一樣。
// 📱 窄螢幕先藏「商品」(< md)再藏「金額」(< sm):390 寬時鈕那一欄要看得到, 不用橫捲才找得到唯一那顆鈕。

const ACT =
  'relative z-10 inline-flex min-h-6 items-center rounded-lg border px-2 py-[3px] text-[12px] leading-[1.4] whitespace-nowrap';
const ACT_TONE = {
  default: 'border-border bg-card text-(--fg-2) hover:border-foreground/30',
  warn: 'border-orange-400 bg-orange-50 font-medium text-orange-800',
} as const;
const TH = 'px-3 py-2 text-left text-[12px] leading-[1.4] font-semibold text-(--fg-2)';
const TD = 'px-3 py-2 align-middle text-[13px] leading-[1.4]';

export function OrderTodoList({
  title,
  total,
  rows,
  fullListHref,
  keyword,
  description,
  tool,
}: {
  /** 標題與說明下面、清單上面的小工具(待收款兩格的匯款對帳);沒有就不印。 */
  tool?: ReactNode;
  /** 格子名稱(`ORDER_TODO_SPECS[todo].label`)。 */
  title: string;
  total: number;
  rows: readonly OrderTodoRow[];
  /** 同一組篩選的一般列表(不帶 `todo`)。 */
  fullListHref: string;
  /** 這個登入還留著的搜尋關鍵字(cookie);有的話清單只列符合的單 ⇒ 要講出來。 */
  keyword: string | null;
  /** 這一格的規則說明(例如逾期未到);沒有就不印。 */
  description?: string;
}) {
  return (
    <section aria-label={`${title}待辦清單`} data-testid='order-todo-list' className='space-y-3'>
      <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
        <h1 className='m-0 text-[18px] leading-[1.4] font-bold'>{title}</h1>
        <span className='text-[13px] leading-[1.4] text-(--fg-2) tabular-nums'>共 {total} 筆</span>
        <span className='ml-auto flex gap-3 text-[13px] leading-[1.4]'>
          <Link href='/' className='text-(--fg-2) underline-offset-2 hover:underline'>
            回首頁
          </Link>
          <Link href={fullListHref} className='text-(--fg-2) underline-offset-2 hover:underline'>
            看完整列表
          </Link>
        </span>
      </div>
      {description !== undefined && (
        <p className='m-0 text-[13px] leading-[1.4] text-(--fg-2)'>{description}</p>
      )}
      {tool}
      {/* 🔴 R1 F1:列表頁與首頁格子都套搜尋 cookie, 而待辦模式不畫工具列(看不到「搜尋「x」」那句)
          ⇒ 不講的話, 其他符合這一格的單會無聲地不在清單上。清除要到完整列表的搜尋框。 */}
      {keyword !== null && (
        <div className='rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-[1.4] text-amber-900'>
          目前只列出符合搜尋「{keyword}」的單。要看這一格全部的單，請到「看完整列表」清除搜尋。
        </div>
      )}
      {rows.length === 0 ? (
        <div className='border-border bg-card rounded-lg border p-6 text-[13px] leading-[1.4] text-(--fg-2)'>
          {ORDER_TODO_EMPTY}
        </div>
      ) : (
        <div className='border-border bg-card overflow-x-auto rounded-lg border'>
          <table className='w-full border-collapse'>
            <thead>
              <tr className='border-border border-b'>
                {/* 2026-09-30 名稱統一:欄名與訂單列表同一套(客戶 / 下一步;原 客人 / 要做的事)。 */}
                <th className={TH}>單號</th>
                <th className={TH}>客戶</th>
                <th className={`${TH} hidden md:table-cell`}>商品</th>
                <th className={`${TH} hidden text-right sm:table-cell`}>金額</th>
                <th className={TH}>下一步</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className='border-border border-b last:border-b-0' data-order-id={r.id}>
                  <td className={`${TD} font-mono whitespace-nowrap`}>
                    <Link href={`/orders/${r.id}`} className='underline-offset-2 hover:underline'>
                      {r.displayId}
                    </Link>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{r.customerName}</td>
                  <td className={`${TD} hidden max-w-[360px] truncate md:table-cell`} title={r.itemSummary}>
                    {r.itemSummary}
                  </td>
                  <td className={`${TD} hidden text-right whitespace-nowrap tabular-nums sm:table-cell`}>{r.money}</td>
                  <td className={TD}>
                    {r.action.kind === 'link' ? (
                      <Link href={r.action.href} className={`${ACT} ${ACT_TONE[r.action.tone]}`}>
                        {r.action.label}
                      </Link>
                    ) : (
                      <span className='text-[12px] leading-[1.4] text-(--fg-2)'>{r.action.label}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
