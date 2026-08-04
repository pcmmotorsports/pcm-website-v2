import Link from 'next/link';
import { formatOrderAmount } from '../../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../../lib/orders/order-detail-view';
import { listRefundExceptions } from '../../../lib/payment/refund-read';
import {
  REFUND_EXCEPTION_STALL_MS,
  refundStatusLabel,
} from '../../../lib/payment/refund-ledger-view';

// /orders/refund-exceptions — M-3 A7c RW3:退款異常清單(RW4 前置 UI;唯讀)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 清單判準 = plan §4-1 逐字:processing 且(滯留 >30 分 或 已有 TapPay 受理證據)。
// 證據列(G7-hold)= 當下已知異常、不等 30 分(fable N4)。
// 🔴 本頁只「看」:人工結案(標記失敗 / Portal 真碼恢復)= RW4 的具名流程,
//    這裡刻意零操作按鈕 —— 沒有對帳依據的按鈕比沒有按鈕更危險。
// 🔴 靜態 route 優先於 /orders/[id] 動態段(Next 慣例);[id] 頁另有 isOrderId 閘。

export const dynamic = 'force-dynamic';

export default async function RefundExceptionsPage() {
  let rows: Awaited<ReturnType<typeof listRefundExceptions>>['rows'] = [];
  let truncated = false;
  let loadFailed = false;
  try {
    const result = await listRefundExceptions();
    rows = result.rows;
    truncated = result.truncated;
  } catch (error) {
    console.error('[admin/orders/refund-exceptions] 異常清單載入失敗', error);
    loadFailed = true;
  }

  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <div>
        <h1 className='text-2xl font-semibold'>退款異常清單</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          {/* 分鐘數由常數推導(opus R1:員工唯一看得到的那個 30 不得是第三份硬寫字面)。 */}
          處理中且滯留超過 {REFUND_EXCEPTION_STALL_MS / 60_000} 分鐘、或 TapPay
          已受理但帳本尚未結案的退款。
          這些單<span className='font-medium'>勿重複發起退款</span>;
          結案(人工對帳後標記)流程尚未上線,先以 TapPay Record/Portal 對帳並通知系統維護。
        </p>
      </div>

      {/* codex MF1:平台 max-rows 會靜默截斷,顯式上限+可見旗標;舊的排前=被截的是較新的 */}
      {truncated && (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'>
          ⚠ 清單超過顯示上限,較新的異常未列出 —— 這代表滯留量已異常龐大,請立即通知系統維護。
        </div>
      )}

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          清單載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : rows.length === 0 ? (
        <div className='bg-card text-muted-foreground rounded-lg border p-6 text-sm'>
          目前沒有滯留的退款。
        </div>
      ) : (
        <div className='overflow-x-auto rounded-lg border bg-card'>
          <table className='w-full border-collapse'>
            <thead>
              <tr>
                <th className={TH}>訂單</th>
                <th className={TH}>發起時間</th>
                <th className={TH}>種類</th>
                <th className={`${TH} text-right`}>金額</th>
                <th className={TH}>狀態</th>
                <th className={TH}>TapPay 受理證據</th>
                <th className={TH}>發起人</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className='border-t'>
                  <td className={`${TD} whitespace-nowrap`}>
                    <Link href={`/orders/${row.orderId}`} className='font-medium underline'>
                      {row.orderDisplayId}
                    </Link>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {formatOrderDateTime(row.createdAt)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {row.kind === 'full' ? '全額' : '部分'}
                  </td>
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                    NT$ {formatOrderAmount(row.refundAmount)}
                  </td>
                  <td className={TD}>{refundStatusLabel(row.status)}</td>
                  <td className={TD}>
                    {row.providerEvidence !== null ? (
                      <span className='text-destructive font-medium'>
                        有(TapPay 已受理,優先處理)
                      </span>
                    ) : (
                      <span className='text-muted-foreground'>無(滯留逾時)</span>
                    )}
                  </td>
                  <td className={`${TD} text-muted-foreground whitespace-nowrap text-xs`}>
                    {row.actor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
