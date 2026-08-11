import type { AdminOrderDetail, AdminOrderDetailItem } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import {
  buildSupplierChoices,
  type SupplierOption,
} from '../../lib/orders/procurement-suppliers';
import { REPLY_STATUS_LABEL } from '../../lib/orders/procurement-view';
import { ItemProcurementForm } from './item-procurement-form';
import { ReceiptRecordForm } from './receipt-record-form';

// M-4b E10 A10b:訂單明細的採購區塊(server-render 清單 + 每個品項一份表單)。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 🔴 **內部資料**:供應商身分 / 單號 / 異常原因是 service_role only
//    (`20260729020000:16-18`「一個 byte 都不能進 orders / order_items」)⇒ 本元件**只**能出現在
//    admin 明細頁(SSO 閘後);絕不可被搬進 storefront 的任何頁面。
// ⚠️ **「server-render」不等於資料沒進瀏覽器**(關卡2 codex nit,誠實更正):本元件把整個
//    `procurements` 當 props 傳給 client 元件 `ItemProcurementForm` ⇒ 它會被序列化進 RSC payload、
//    真的到了瀏覽器。可接受的理由是**這一頁本來就在 SSO 閘後、只有員工看得到**,
//    不是「它沒離開伺服器」。真正的邊界是 storefront 零投影(A9a-2 守門測試盯著三條列表投影)。

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const TH = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-2 py-1.5 text-sm align-top';

function TruncationWarning({ scope }: { scope: 'item' | 'order' }) {
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      {scope === 'order'
        ? '這張單的品項清單這次沒有完整載入,下面看到的採購紀錄可能不是全部。'
        : '這個品項的採購紀錄這次沒有完整載入,下面看到的可能不是全部。'}
      請重新整理這張單;在完整載入之前不能編輯採購(避免用不完整的內容覆蓋既有紀錄)。
    </div>
  );
}

function ProcurementRows({
  item,
  orderId,
  returnTo,
  truncated,
}: {
  item: AdminOrderDetailItem;
  orderId: string;
  returnTo: string;
  /**
   * 🔴 採購清單可能不完整時**連「登錄到貨」也一起收起來**。
   *
   * 技術上到貨登錄是 append + 指名 `procurement_id`,截斷不會讓看得見的那一列變錯
   * ⇒ 送出去其實是安全的。收起來的理由是**文案與程式必須是同一條不變式**:
   * 上面那張警告逐字對員工說「在完整載入之前不能編輯採購」,而旁邊擺一顆按得下去的鈕
   * 就是當面打臉那句話。員工重新整理一次就好,代價遠低於「畫面自相矛盾」。
   */
  truncated: boolean;
}) {
  if (item.procurements.length === 0) {
    return <p className='text-muted-foreground text-sm'>這個品項還沒有採購紀錄。</p>;
  }
  return (
    <div className='overflow-x-auto'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>供應商</th>
            <th className={`${TH} text-right`}>訂購</th>
            <th className={`${TH} text-right`}>到貨</th>
            <th className={TH}>回覆狀態</th>
            <th className={TH}>供應商單號</th>
            <th className={TH}>預計到貨</th>
            <th className={TH}>異常原因</th>
            <th className={TH}>送出時間</th>
            <th className={TH}>到貨登錄</th>
          </tr>
        </thead>
        <tbody>
          {item.procurements.map((p) => (
            <tr key={p.id} className='border-t'>
              <td className={TD}>
                {/* 🔴 label 為 null = 內嵌沒回來(A9a-2),不是「這家沒有名字」⇒ 誠實顯示缺 */}
                {p.supplierLabel ?? <span className='text-muted-foreground'>(供應商資料缺)</span>}
                {p.supplierIsActive === false && (
                  <span className='text-muted-foreground ml-1 text-xs'>(已停用)</span>
                )}
                {p.supplierIsActive === null && (
                  <span className='text-muted-foreground ml-1 text-xs'>(狀態不明)</span>
                )}
              </td>
              <td className={`${TD} text-right tabular-nums`}>{p.allocatedQuantity}</td>
              <td className={`${TD} text-right tabular-nums`}>{p.receivedQuantity}</td>
              <td className={TD}>{REPLY_STATUS_LABEL[p.replyStatus]}</td>
              <td className={`${TD} text-xs`}>{p.supplierOrderNo ?? '—'}</td>
              <td className={`${TD} text-xs whitespace-nowrap`}>{p.expectedArrivalDate ?? '—'}</td>
              <td className={`${TD} text-xs`}>{p.exceptionReason ?? '—'}</td>
              <td className={`${TD} text-xs whitespace-nowrap`}>
                {p.submittedAt ? formatOrderDateTime(p.submittedAt) : '—'}
              </td>
              {/* #352-b 入口 1:每列尾端一顆「登錄到貨」(plan §5.2) */}
              <td className={TD}>
                {truncated ? (
                  <span className='text-muted-foreground text-xs'>—</span>
                ) : (
                  <ReceiptRecordForm
                    orderId={orderId}
                    orderItemId={item.id}
                    procurementId={p.id}
                    returnTo={returnTo}
                    remaining={Math.max(0, p.allocatedQuantity - p.receivedQuantity)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ItemProcurementSection({
  detail,
  returnTo,
  suppliers,
  suppliersFailed,
}: {
  detail: AdminOrderDetail;
  /**
   * #350d-3 C1:動作做完回哪裡 = **這個視圖自己的網址**。值不可信任:action 端一律再過
   * `parseOrderReturnTo`(站內白名單 + 剝一次性參數 + §6-1 同單比對)。
   */
  returnTo: string;
  /** S3a 讀模型(啟用中、zh-TW 排序);載入失敗時傳空陣列 + suppliersFailed */
  suppliers: readonly SupplierOption[];
  /** 供應商清單載入失敗 —— 🔴 不可靜默:選單空掉會讓員工以為「這家不存在」 */
  suppliersFailed: boolean;
}) {
  return (
    <section className={CARD}>
      <h2 className='text-muted-foreground mb-3 text-xs font-medium'>採購(向供應商訂貨)</h2>

      {detail.itemsTruncated && <TruncationWarning scope='order' />}

      {suppliersFailed && (
        <div
          role='alert'
          className='border-destructive/30 bg-destructive/5 text-destructive mb-3 rounded-md border p-2.5 text-xs'
        >
          供應商清單載入失敗,選單只會列出這張單已經用過的供應商。請重新整理;
          在清單載入成功之前不要新增供應商,避免建立重複的資料。
        </div>
      )}

      <div className='space-y-4'>
        {detail.items.map((item) => {
          // 🔴 兩個旗標要一起讀(A9a-2 domain 註解):品項本身被截掉時,per-item 旗標會
          //    連同品項一起消失 ⇒ 外層為 true 時,每個品項都當作不可信。
          const truncated = item.procurementTruncated || detail.itemsTruncated;
          return (
            <div key={item.id} className='rounded-md border p-3'>
              <div className='mb-2 flex flex-wrap items-baseline gap-2'>
                <span className='text-sm font-medium'>{item.title ?? item.variantSku}</span>
                <span className='text-muted-foreground text-xs'>{item.variantSku}</span>
                <span className='text-muted-foreground ml-auto text-xs'>
                  訂單數量 {item.quantity}
                </span>
              </div>

              {item.procurementTruncated && !detail.itemsTruncated && (
                <TruncationWarning scope='item' />
              )}

              <ProcurementRows
                item={item}
                orderId={detail.id}
                returnTo={returnTo}
                truncated={truncated}
              />

              <ItemProcurementForm
                orderId={detail.id}
                returnTo={returnTo}
                orderItemId={item.id}
                procurements={item.procurements}
                supplierChoices={buildSupplierChoices(suppliers, item.procurements)}
                truncated={truncated}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
