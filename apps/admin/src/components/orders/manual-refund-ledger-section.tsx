import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import type { ManualRefundRow } from '../../lib/payment/manual-refund-read';
import { ManualRefundVoidButton } from './manual-refund-void-button';

// manual-refund-ledger-section.tsx — M-4b E10 D3:非卡退款登記列表(server-render、唯讀)。
//
// 🔴 與 `RefundLedgerSection`(TapPay 帳本)刻意並列、不合併(見主視窗批准的 plan
// W2-012 §1②):`order_manual_refunds` 沒有 status 欄、沒有「異常/滯留」判定 ——
// 這張表記的是一件已經發生的事,不是一個要發起的動作(D1 建表 migration header 段)。
// 硬塞進同一個型別/元件會製造出一堆對這張表永遠是同一個值的欄位。
//
// 🔴 這個區塊存在的理由:員工今天對現金/匯款訂單「按了退款登記」之後,**沒有任何地方能
// 確認他按成功了**(主視窗 2026-08-20 裁示原文)——他會再按一次,冪等閘會擋住,但他不知道
// 被擋了還是成功了。這裡就是那個「看得到」的地方。
//
// 🔴🔴 **D3-c:這裡多了「作廢」** —— 而它是 `#787` 的解除鍵。
//    #787 封印登記入口的理由逐字是「登記錯了改不掉」;這一欄就是「改得掉」的那條路。
//    ⇒ 作廢**不動錢**,它說的是「這筆登記本身記錯了」(D3-b 的 COMMENT 原話)。
//    ⚠️ 已作廢的列**不移除、不隱藏** —— 它是帳本,而帳本記的是發生過的事。
//       整列改成淡出 + 刪除線 + 一行「已作廢」,理由與金額原樣留著給對帳的人看。

export function ManualRefundLedgerSection({
  rows,
  orderId,
  returnTo,
  rowsTruncated = false,
  loadFailed = false,
}: {
  rows: readonly ManualRefundRow[];
  /** 只給作廢後重新驗證那張訂單頁用,**不進 RPC**(見 manual-refund-void-actions.ts)。 */
  orderId: string;
  returnTo: string;
  rowsTruncated?: boolean;
  loadFailed?: boolean;
}) {
  if (loadFailed) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>非卡退款登記</h2>
        <p className='text-destructive'>
          非卡退款登記載入失敗——這張單可能有看不見的登記紀錄,請重新整理;
          持續失敗請通知系統維護,勿在此期間重複登記。
        </p>
      </section>
    );
  }

  // 同 RefundLedgerSection 的立場(Sean 2026-08-17 Q2=甲):撈不完整時整區明確失敗、
  // 不顯示任何一列,不讓對帳的人照著一份缺漏的清單算。
  if (rowsTruncated) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>非卡退款登記</h2>
        <p className='text-destructive'>
          這張單的非卡退款登記太多,超過本頁一次能列出的上限,這一區塊不顯示任何一列。
          請通知系統維護直接從資料庫調這張單的完整登記紀錄。
        </p>
      </section>
    );
  }

  if (rows.length === 0) return null;

  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';

  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <h2 className='text-muted-foreground mb-3 text-xs font-medium'>非卡退款登記</h2>
      <div className='overflow-x-auto'>
        <table className='w-full border-collapse'>
          <thead>
            <tr>
              <th className={TH}>錢交回去的時間</th>
              <th className={TH}>管道</th>
              <th className={`${TH} text-right`}>金額</th>
              <th className={TH}>原因</th>
              <th className={TH}>經手人</th>
              <th className={TH}>登記時間</th>
              <th className={TH}>作廢</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const voided = row.voidedAt !== null;
              return (
                <tr key={row.id} className={`border-t ${voided ? 'text-muted-foreground' : ''}`}>
                  <td className={`${TD} whitespace-nowrap`}>
                    {formatOrderDateTime(row.occurredAt)}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {row.rail === 'cash' ? '現金' : '匯款'}
                  </td>
                  {/* 🔴 金額打刪除線是**唯一**一眼看得出「這筆不算數了」的地方 ——
                      對帳的人掃的是金額欄,不是最右邊那一欄。 */}
                  <td
                    className={`${TD} text-right tabular-nums whitespace-nowrap ${voided ? 'line-through' : ''}`}
                  >
                    NT$ {formatOrderAmount(row.refundAmount)}
                  </td>
                  <td className={TD}>{row.reason}</td>
                  <td className={`${TD} whitespace-nowrap text-xs`}>{row.actor}</td>
                  <td className={`${TD} whitespace-nowrap text-xs`}>
                    {formatOrderDateTime(row.createdAt)}
                  </td>
                  <td className={TD}>
                    {voided ? (
                      <div className='text-xs'>
                        <p className='font-medium'>已作廢</p>
                        <p>{formatOrderDateTime(row.voidedAt as string)}</p>
                        <p>由 {row.voidedBy ?? '(未記錄)'}</p>
                        <p className='max-w-[16rem]'>理由:{row.voidReason ?? '(未記錄)'}</p>
                      </div>
                    ) : (
                      <ManualRefundVoidButton
                        refundId={row.id}
                        orderId={orderId}
                        returnTo={returnTo}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
