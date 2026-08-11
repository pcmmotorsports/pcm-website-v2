import { toPaymentListEntry, type OrderPaymentRow } from '../../lib/orders/payment-list-view';

// payment-list.tsx — M-4b E10 #15-B2-a:訂單收款列表(server-render、唯讀)。
// 語意全在 `lib/orders/payment-list-view.ts`,本檔只排版(同 A10a 的 notes-timeline 分工)。
//
// 🔴 **文案為暫定稿**,待 Sean 肉眼驗後定案(鎖結構不鎖字)。
// 本片(§8 主視窗裁 A)**只做「列出來」**:不算已收小計、不顯示結清狀態、不做沖銷入口。

/**
 * 三態必須分開畫。
 *
 * 🔴 `unreadable` 那格**排在最前面**,理由與 #328 逐字同款:
 *    「讀取失敗」與「真的沒有收款」的輸入**長得一模一樣**(都是沒有列可畫)——
 *    順序寫反就等於把讀取失敗顯示成「這單沒收過錢」,而員工會照著再登一次 ⇒ **重複入帳**。
 */
export type PaymentListData =
  | { status: 'ok'; rows: readonly OrderPaymentRow[] }
  /** RPC 回 SQL NULL = 這張訂單不存在(不是「沒有收款」)。 */
  | { status: 'order_not_found' }
  /** 讀取失敗:權限 / 連線 / 形狀不符。**不知道有沒有**,不是「沒有」。 */
  | { status: 'unreadable' };

function Row({ row }: { row: OrderPaymentRow }) {
  const e = toPaymentListEntry(row);
  return (
    <li className='border-t py-3 text-sm first:border-t-0'>
      <div className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        <span className='bg-muted text-foreground inline-flex rounded-full px-2 py-0.5 font-medium'>
          {e.railLabel}
        </span>
        {/* 🔴 沖銷只認具名旗標,不看金額正負(沖銷之沖銷可為正額)。 */}
        {e.isReversal && (
          <span className='bg-destructive/10 text-destructive inline-flex rounded-full px-2 py-0.5 font-medium'>
            沖銷更正
          </span>
        )}
        {/* 對帳看 received_at(欄 COMMENT 逐字);created_at 另外標「登錄」,兩者不可混用。 */}
        <span>
          收款於 {e.receivedAtDisplay ?? '(時間無法判讀)'}
        </span>
        <span>
          {e.actorLabel} 登錄於 {e.createdAtDisplay ?? '(時間無法判讀)'}
        </span>
        {e.referenceLabel !== null && <span>憑證 {e.referenceLabel}</span>}
        {/* 金額保留正負號原樣:沖銷列的負號本身就是資訊。 */}
        <span className='text-foreground ml-auto font-medium tabular-nums'>{e.amountLabel}</span>
      </div>
      {e.reversalReason !== null && (
        <p className='text-muted-foreground mt-1 break-words'>沖銷原因:{e.reversalReason}</p>
      )}
      {e.payerNote !== null && <p className='mt-1 whitespace-pre-wrap break-words'>{e.payerNote}</p>}
    </li>
  );
}

export function PaymentList({ data }: { data: PaymentListData }) {
  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <h2 className='text-muted-foreground text-xs font-medium'>已登錄的收款</h2>
        {/* 🔴 讀不到時**不可**顯示「0 筆」—— 那是這一族最短的一句謊話。 */}
        <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
          {data.status === 'ok' ? `${data.rows.length} 筆` : '筆數未知'}
        </span>
      </div>

      {data.status === 'unreadable' ? (
        <p className='mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800'>
          這一單的收款紀錄沒有載入(讀取失敗)—— 這<strong>不是</strong>「沒有收過款」,是「不知道有沒有」。
          請重新整理;若仍相同,請通知系統維護。
          <strong>在這之前不要據此再登錄一筆收款</strong>,那會變成重複入帳。
        </p>
      ) : data.status === 'order_not_found' ? (
        <p className='mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800'>
          查不到這張訂單 —— 收款紀錄無從查起。請重新整理確認訂單還在。
        </p>
      ) : data.rows.length === 0 ? (
        <p className='text-muted-foreground py-2 text-sm'>尚未登錄任何收款。</p>
      ) : (
        <ul>
          {data.rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
