import Link from 'next/link';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import type { OrderRefundRow } from '../../lib/payment/refund-read';
import {
  isRefundException,
  refundFailedReasonLabel,
  refundStatusLabel,
} from '../../lib/payment/refund-ledger-view';

// refund-ledger-section.tsx — M-3 A7c RW3:訂單頁退款帳本呈現(server-render、唯讀)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 存在理由:deferred/rejected 的結果原本只活在送出當下的 action state(重新整理就沒了),
// 值班要能事後看到「這單退過什麼、卡在哪」。plan §1 RW3 列 + §3 表 UI 欄。
//
// 🔴 顯示不吃退款入口旗標(refund-ui-flag.ts;字面刻意不寫 —— wiring oracle 只准兩檔命中):
//    旗標控制的是「發起入口」;帳本列是既成事實,有列就得讓人看見
//    (尤其 processing 滯留列 —— 藏起來 = 值班不知道有錢卡在路上)。
//
// 🔴🔴 措辭鐵律(refund-ledger-view.ts 檔頭;測試掛負向格):「帳本未登記額」
//    不得寫成「還能退」「剩餘可退」—— Portal 場外退款不在帳本,真實剩餘 ≤ 此值。

export function RefundLedgerSection({
  rows,
  unregisteredAmount,
  unregisteredFailed = false,
  rowsTruncated = false,
  loadFailed = false,
  nowMs,
}: {
  rows: readonly OrderRefundRow[];
  /** `pcm_order_refundable_remaining`;查無訂單 → null(顯示「查無」而非 0)。 */
  unregisteredAmount: number | null;
  /** RPC 讀取失敗(codex MF2:不得壓成 null 假裝查無 —— 那是會被照著操作的狀態)。 */
  unregisteredFailed?: boolean;
  /** 帳本列被上限截斷(codex MF1:平台 max-rows 會靜默截,顯式旗標=截斷可見)。 */
  rowsTruncated?: boolean;
  /** 帳本讀取失敗(不靜默:processing 滯留列被藏起來比沒有這區塊更糟)。 */
  loadFailed?: boolean;
  /** 列級異常判定的「現在」;由呼叫端(server component render 期)供給,可測。 */
  nowMs: number;
}) {
  if (loadFailed) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>退款紀錄</h2>
        <p className='text-destructive'>
          退款帳本載入失敗 —— 這張單可能有看不見的退款紀錄(含處理中的),
          請重新整理;持續失敗請通知系統維護,勿在此期間發起退款。
        </p>
      </section>
    );
  }
  // 🏁 #445a-3 兌現了這個檔自己寫的交辦。原文(保留備查):
  //    「零列時本區回 null ⇒『零列 && unregisteredFailed』若可達,值班會看到
  //     『按鈕不見了、又沒有任何說明』。目前不可達的保證住在呼叫端(僅 rows.length>0
  //     才打 RPC)—— 若日後改成無條件打 RPC,這裡要先於零列早退補一個失敗顯示分支。」
  // ⚠️ 原註解把呼叫端寫成 `[id]/page.tsx`,**那是過期字面** —— 實際在
  //    `order-detail-route.tsx`(該檔自己就是被改的那一支)。引用前一律用字面 anchor。
  // 🔴 445a-3 做的正是它說的「改成無條件打 RPC」⇒ 「零列 && 讀取失敗」**現在可達了**,
  //    所以這個分支必須**排在零列早退之前**。順序反了 = 症狀原樣復活,而且測試若只造
  //    「有列 + 失敗」是驗不到的(那條路徑本來就會渲染)。
  if (unregisteredFailed && rows.length === 0) {
    return (
      <section className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
        <h2 className='text-destructive mb-1 text-sm font-semibold'>退款紀錄</h2>
        {/* 🔴 Sean 08-13 定調「使用上直覺、好用即可」⇒ 要回答:發生什麼 / 錢有沒有動 / 他該做什麼。
            ⚠️ **不得宣稱「退款按鈕被關掉了」** —— 本區塊刻意不吃退款入口旗標(見檔頭 :17-19),
            也看不到 channel 與 payment status ⇒ 轉帳/現金單、未付款單、或旗標關著時,
            入口**本來就不存在**,不是被這個錯誤關掉的。講了就是對值班說一句假話。
            (code-reviewer 抓到;我第一版真的寫了「退款按鈕暫時收起來了」。)
            ⚠️ **不得混 Markdown 星號** —— 這是 `<p>` 純文字輸出,`**` 會原樣顯示。
            我在同一天的 `refund-action-state.ts` 才被 codex 抓過一次,一小時後又犯。 */}
        <p className='text-destructive'>
          查不到這張單的退款金額參考(系統讀取失敗,不是這張單不能退)。
          這張單目前沒有任何退款紀錄,也沒有任何退款被發起、錢沒有動。
          請先重新整理頁面;如果重新整理幾次都一樣,請通知系統維護。
        </p>
      </section>
    );
  }
  if (rows.length === 0) return null;

  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';

  return (
    <section className='bg-card text-card-foreground rounded-lg border p-4'>
      <div className='mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1'>
        <h2 className='text-muted-foreground text-xs font-medium'>退款紀錄</h2>
        <span className='text-sm'>
          帳本未登記額:
          {/* 四態(codex MF2/MF3):讀失敗≠查無(前者=系統問題勿操作、後者=資料不在);
              負值=帳本登記已超過訂單總額 —— 「真實可退 ≤ 此數」的宣稱對負值不成立,
              當普通金額顯示會被照著操作,一律標對帳異常。 */}
          {unregisteredFailed ? (
            <span className='text-destructive font-medium'>
              讀取失敗(勿依本頁發起退款,請通知系統維護)
            </span>
          ) : unregisteredAmount === null ? (
            <span className='font-medium tabular-nums'>查無</span>
          ) : unregisteredAmount < 0 ? (
            <span className='text-destructive font-medium tabular-nums'>
              對帳異常(帳本登記已超過訂單總額 NT$ {formatOrderAmount(-unregisteredAmount)};
              請以 TapPay Record 對帳,勿再發起退款)
            </span>
          ) : (
            <span className='font-medium tabular-nums'>
              NT$ {formatOrderAmount(unregisteredAmount)}
            </span>
          )}
        </span>
        <span className='text-muted-foreground text-xs'>
          僅計本系統帳本(處理中+已受理佔額);Portal 場外退款不在其中,
          真實可退額以 TapPay Record 對帳為準、只會 ≤ 此數。
        </span>
      </div>

      {rowsTruncated && (
        <p className='text-destructive mb-2 text-xs font-medium'>
          ⚠ 帳本列超過顯示上限,更舊的紀錄未列出 —— 完整清單請以資料庫對帳為準。
        </p>
      )}

      <div className='overflow-x-auto'>
        <table className='w-full border-collapse'>
          <thead>
            <tr>
              <th className={TH}>發起時間</th>
              <th className={TH}>種類</th>
              <th className={`${TH} text-right`}>金額</th>
              <th className={TH}>狀態</th>
              <th className={TH}>原因/說明</th>
              <th className={TH}>發起人</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const exception = isRefundException(
                {
                  status: row.status,
                  createdAt: row.createdAt,
                  providerEvidence: row.providerEvidence,
                },
                nowMs,
              );
              const failedLabel = refundFailedReasonLabel(row.failedReason);
              return (
                <tr key={row.id} className='border-t'>
                  <td className={`${TD} whitespace-nowrap`}>{formatOrderDateTime(row.createdAt)}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {row.kind === 'full' ? '全額' : '部分'}
                  </td>
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                    NT$ {formatOrderAmount(row.refundAmount)}
                  </td>
                  <td className={TD}>
                    {refundStatusLabel(row.status)}
                    {exception && (
                      <div className='mt-1'>
                        {/* G7-hold(有受理證據)= 當下已知異常;滯留逾閾 = 保守異常(plan §4-1)。 */}
                        <Link
                          href='/orders/refund-exceptions'
                          className='text-destructive text-xs font-medium underline'
                        >
                          ⚠ 已進退款異常清單(勿重複發起,待對帳處理)
                        </Link>
                      </div>
                    )}
                  </td>
                  <td className={TD}>
                    <div>{row.reason}</div>
                    {failedLabel && (
                      <div className='text-muted-foreground mt-0.5 text-xs'>{failedLabel}</div>
                    )}
                    {row.failedDetail && (
                      <div className='text-muted-foreground mt-0.5 text-xs break-all'>
                        {row.failedDetail}
                      </div>
                    )}
                  </td>
                  <td className={`${TD} text-muted-foreground whitespace-nowrap text-xs`}>
                    {row.actor}
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
