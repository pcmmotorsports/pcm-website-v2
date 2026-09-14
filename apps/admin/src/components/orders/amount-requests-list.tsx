import type { OrderAmountRequest } from '../../lib/orders/amount-request-repository';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';

// amount-requests-list.tsx — M-4b-03 這張單的「改金額申請」列表(server component, 純顯示)。
// 🔴 「讀不到」與「沒有申請」分開講(本線鐵律);pending 排最前面, 終態灰字。
// 🔴 B 片只列;C 片在每條 pending 右邊掛核准 / 退回(`reviewSlot`)。actor 印 slug —— 這一頁沒有員工名單, 不假裝翻譯。

export const AMOUNT_REQUEST_STATUS_LABEL: Record<OrderAmountRequest['status'], string> = {
  pending: '待審',
  approved: '已核准',
  rejected: '已退回',
  superseded: '已作廢(單取消)',
};

export function AmountRequestsList({
  rows,
  readFailed,
  historyTruncated = false,
  itemLabel,
  reviewSlot,
}: {
  rows: readonly OrderAmountRequest[];
  readFailed: boolean;
  /** 終態列只拉了最新 N 條(pending 一定全);true ⇒ 尾巴印一句。 */
  historyTruncated?: boolean;
  /** 品項 id ⇒ 料號 / 名稱(列表裡的品項不一定還在 detail.items, 查不到印 id 前 8 碼)。 */
  itemLabel: (orderItemId: string) => string;
  /** C 片:pending 那條要掛的核准 / 退回表單;B 片不傳。 */
  reviewSlot?: (row: OrderAmountRequest) => React.ReactNode;
}) {
  if (readFailed) {
    return (
      <p className='text-destructive text-sm' role='alert' data-testid='amount-requests-read-failed'>
        改金額申請讀不到(不是沒有, 是讀不到)。重新整理;還是一樣請通知系統維護。
      </p>
    );
  }
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
  return (
    <ul className='space-y-2' data-testid='amount-requests-list'>
      {sorted.map((r) => (
        <li
          key={r.id}
          data-testid='amount-request-row'
          data-status={r.status}
          className={`border-border rounded-md border p-2 text-sm leading-[1.4] ${r.status === 'pending' ? '' : 'text-muted-foreground'}`}
        >
          <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${r.status === 'pending' ? 'bg-amber-100 text-amber-900' : 'bg-secondary text-secondary-foreground'}`}>
              {AMOUNT_REQUEST_STATUS_LABEL[r.status]}
            </span>
            <span className='font-medium'>{itemLabel(r.orderItemId)}</span>
            <span className='tabular-nums'>
              {formatOrderAmount(r.fromUnitPrice)} → {formatOrderAmount(r.toUnitPrice)}
            </span>
            <span className='text-muted-foreground text-xs'>
              {r.requestedBy} · {formatOrderDateTime(r.requestedAt)}
            </span>
          </div>
          <p className='mt-1'>原因:{r.reason}{r.zeroPriceReason ? `(0 元:${r.zeroPriceReason})` : ''}</p>
          {r.status !== 'pending' && r.reviewedBy && (
            <p className='mt-1 text-xs'>
              {AMOUNT_REQUEST_STATUS_LABEL[r.status]} · {r.reviewedBy}
              {r.reviewedAt ? ` · ${formatOrderDateTime(r.reviewedAt)}` : ''}
              {r.reviewNote ? ` · ${r.reviewNote}` : ''}
            </p>
          )}
          {r.status === 'pending' && reviewSlot ? <div className='mt-2'>{reviewSlot(r)}</div> : null}
        </li>
      ))}
      {historyTruncated && (
        <li className='text-muted-foreground text-xs' data-testid='amount-requests-history-truncated'>
          只列最新的歷史申請;更早的沒印(待審的一定都在)。
        </li>
      )}
    </ul>
  );
}
