// Sean 2026-09-27 G1 甲:「改價待審」清單 —— 首頁「今天要做的事」那一格點進來。
// 只列、不審:審核照舊在各張訂單的明細頁做(改金額申請那一塊), 這一頁只負責讓人找得到。
import Link from 'next/link';
import { formatOrderAmount } from '../../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';
import { listPendingAmountRequests, type PendingAmountRequest } from '../../../lib/orders/amount-request-repository';

export const dynamic = 'force-dynamic';

const TH = 'border-b px-3 py-2 text-left text-xs font-medium text-muted-foreground';
const TD = 'border-b px-3 py-2 text-sm align-top';

export default async function AmountRequestsPage() {
  let rows: PendingAmountRequest[] = [];
  let truncated = false;
  let loadFailed = false;
  try {
    ({ rows, truncated } = await listPendingAmountRequests());
  } catch (error) {
    console.error('[admin/orders/amount-requests] 改價待審清單載入失敗', error);
    loadFailed = true;
  }

  return (
    <div className='pcm-plist space-y-3'>
      <div className='pcm-head'>
        <h1>改價待審</h1>
        <span className='pcm-count'>員工送出、還沒審核的改金額申請。請點訂單編號，到訂單頁審核。</span>
      </div>
      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          改價申請載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。
        </div>
      ) : rows.length === 0 ? (
        <div className='bg-card text-muted-foreground rounded-lg border p-6 text-sm'>目前沒有待審的改價申請。</div>
      ) : (
        <>
          {truncated && (
            <p className='text-muted-foreground text-xs'>只列出最早的 {rows.length} 筆，實際待審可能更多。</p>
          )}
          <div className='bg-card overflow-x-auto rounded-lg border'>
            <table className='w-full border-collapse'>
              <thead>
                <tr>
                  <th className={TH}>訂單</th>
                  <th className={TH}>品項</th>
                  <th className={TH}>單價</th>
                  <th className={TH}>原因</th>
                  <th className={TH}>申請人</th>
                  <th className={TH}>申請時間</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={TD}>
                      <Link href={`/orders/${r.orderId}`} className='text-primary underline underline-offset-2'>
                        {r.orderDisplayId ?? '（訂單編號讀不到）'}
                      </Link>
                    </td>
                    <td className={TD}>{r.itemTitle ?? '—'}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {`NT$ ${formatOrderAmount(r.fromUnitPrice)} → NT$ ${formatOrderAmount(r.toUnitPrice)}`}
                    </td>
                    <td className={TD}>{r.reason}</td>
                    <td className={TD}>{r.requestedBy}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatOrderDateTime(r.requestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
