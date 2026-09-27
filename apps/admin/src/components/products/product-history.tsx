import Link from 'next/link';
import { PRODUCT_HISTORY_LIMIT, type ProductHistoryRow } from '../../lib/products/product-history';

// product-history.tsx — 商品頁「最近的變更」(商品編輯計畫片 9;Sean 2026-09-27 C4 甲:全員可改、留變更紀錄)。
// 版面照設計稿「最近的變更」:時間 / 誰 / 欄位 / 原本 / 改成。一份 DOM:桌機排成五欄,手機每筆疊成一塊(不左右捲)。
// 🔴 三種狀態分開講:讀不到(loadFailed)≠ 沒有紀錄(rows 空)≠ 有紀錄 —— 讀不到時不能印成「目前沒有變更紀錄」。

const COLS = 'md:grid md:grid-cols-[9rem_10rem_5rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-3';

export function ProductHistory({ rows, loadFailed }: { rows: readonly ProductHistoryRow[]; loadFailed: boolean }) {
  return (
    <section id='product-history' data-od-pe='card' data-product-history className='scroll-mt-4 rounded-lg border p-4'>
      <h3 className='mb-3 text-sm font-medium'>最近的變更</h3>
      {loadFailed ? (
        <p data-history-failed className='text-destructive text-sm'>
          變更紀錄載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
        </p>
      ) : rows.length === 0 ? (
        <p data-history-empty className='text-muted-foreground text-sm'>
          目前沒有變更紀錄。
        </p>
      ) : (
        <div className='text-sm'>
          <div className={`text-muted-foreground hidden border-b pb-2 text-xs ${COLS}`} aria-hidden='true'>
            <span>時間</span>
            <span>誰</span>
            <span>欄位</span>
            <span>原本</span>
            <span>改成</span>
          </div>
          <ol>
            {rows.map((r) => (
              <li key={r.id} data-history-row className={`border-b py-2 last:border-b-0 ${COLS}`}>
                {/* 手機:第一行小字「時間 · 誰」,第二行欄位;桌機各佔一欄 */}
                <span className='text-muted-foreground md:text-foreground text-xs md:text-sm'>{r.at}</span>
                <span className='text-muted-foreground md:text-foreground ml-2 text-xs md:ml-0 md:text-sm'>{r.actor}</span>
                <span className='mt-1 block font-medium md:mt-0'>{r.field}</span>
                {/* 「原本：」「改成：」手機看得到(沒有表頭);桌機有表頭就只留給螢幕閱讀器 */}
                <span className='mt-1 block break-words whitespace-pre-line md:mt-0'>
                  <span className='text-muted-foreground md:sr-only'>原本：</span>
                  <span data-history-from className='text-muted-foreground line-through'>
                    {r.from}
                  </span>
                </span>
                <span className='mt-1 block break-words whitespace-pre-line md:mt-0'>
                  <span className='text-muted-foreground md:sr-only'>改成：</span>
                  <span data-history-to>{r.to}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className='text-muted-foreground mt-3 text-xs'>
        {rows.length >= PRODUCT_HISTORY_LIMIT ? (
          <>
            {`只列出最近 ${PRODUCT_HISTORY_LIMIT} 筆，更早的紀錄請到`}
            <Link href='/settings/audit' className='text-primary mx-1 underline'>
              操作紀錄
            </Link>
            查看。
          </>
        ) : (
          '每次儲存標題、副標、賣點或上下架，都會記下誰、什麼時候、原本和改成什麼。'
        )}
      </p>
    </section>
  );
}
