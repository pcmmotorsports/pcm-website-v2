import type { AdminOrderDetail, AdminOrderDetailItem } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import {
  buildSupplierChoices,
  type SupplierOption,
} from '../../lib/orders/procurement-suppliers';
import { REPLY_STATUS_LABEL, unsourcedQuantity } from '../../lib/orders/procurement-view';
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

/**
 * 「還有 N 件沒有登記來源」(#352-b-2 衍生指標;plan §5.4)。
 *
 * 🔴 **它是查出來的、不是記住的** ⇒ 重整、換裝置、隔天再看都還在。
 *    plan v3.2 原本要用「server action 記錄進行到哪一步 → 顯示未完成橫幅」,被 R3 打掉:
 *    那個橫幅**會蒸發**(員工關掉瀏覽器就沒了),而帳面短少**靜默留著**。
 *
 * 🔴 **`null` = 不知道,誠實說不知道** —— 不補 0(補 0 會讓畫面講一句它證明不了的話)。
 *
 * ⚠️ **文案不得寫「流程中斷」**:本值分不出「從沒開始採購」與「三步做到一半」,
 *    而那兩件事員工的下一步動作本來就一樣(都是去下面把來源補上)。
 */
function UnsourcedNotice({ item }: { item: AdminOrderDetailItem }) {
  const unsourced = unsourcedQuantity(item.quantitySummary);

  if (unsourced === null) {
    return (
      <p className='text-muted-foreground mb-2 text-xs'>
        這個品項的數量資料還沒就緒,暫時算不出「還有幾件沒有登記來源」。
      </p>
    );
  }
  if (unsourced === 0) return null;

  return (
    <p
      role='status'
      className='mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      這個品項還有 <strong>{unsourced}</strong> 件沒有登記來源。請在下面補上要向誰訂
      (或選「店內現貨」),再登錄到貨。
    </p>
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
          {item.procurements.map((p) => {
            // 🔴 `#476` 片3:作廢與否**從資料算、不寫死** —— 理由逐字同 `shipment-section.tsx`
            //    那條(「寫死的話它會變成過濾條件的第二個真相源」)。
            //    ⚠️ 用 `!= null` 而非 `!== null`,與 `procurement-view.ts:findActiveProcurement`
            //    **同一個方向**(缺欄時退回「當生效」而不是「全部當作廢」)。兩處若不一致,
            //    同一列會在表格上寫「已作廢」、在表單裡卻被當生效 hydrate 出來。
            const voided = p.voidedAt != null;
            return (
            <tr key={p.id} className={voided ? 'border-t opacity-60' : 'border-t'}>
              <td className={TD}>
                {/* 🔴 label 為 null = 內嵌沒回來(A9a-2),不是「這家沒有名字」⇒ 誠實顯示缺 */}
                <span className={voided ? 'line-through' : undefined}>
                  {p.supplierLabel ?? <span className='text-muted-foreground'>(供應商資料缺)</span>}
                </span>
                {/* 🔴 作廢標示排在停用標示**之前**:兩者可以同時成立,而「這筆撤了」比
                    「這家停用了」更決定員工的下一步(撤了就別再看這一列)。 */}
                {voided && <span className='text-muted-foreground ml-1 text-xs'>(已作廢)</span>}
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
                {/* 🔴🔴 `#476` 片3:作廢的列不給到貨入口。**這是目前唯一的守門,不是 UX 便利。**
                    ~~原註解寫「RPC 那端已經擋了 ⇒ 這裡不擋也不會寫壞資料」~~ **對現況為假**
                    (兩關審查各自抓到):那道 RPC 守門在 `20260814100000` 步 6b,而
                    `grep -c 20260814100000 supabase/APPLIED.tsv` = **0** ⇒ **甲片還沒 apply**。
                    該 migration 自己逐字寫著少了直接斷言會怎樣:「那筆到貨就靜默掛在一筆
                    已作廢的採購上,**沒有任何人擋**」(C5 只比品項層聚合,兄弟採購列撐著就撞不到)。
                    ⇒ 甲片 apply 之前,拿掉這個 `voided` 條件 = 真的寫得進去。
                    ✅ apply 之後它才降級成「不讓員工填完整張表才被拒」的 UX 前置(Sean「操作直覺化」),
                    **在那之前不要照那個理由把它拿掉。**
                    ⚠️ 顯示「—」而不是把整欄拿掉:欄位消失會讓表格對不齊,員工要數欄才知道少了哪個。 */}
                {truncated || voided ? (
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
            );
          })}
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
          {/* 🔴 `#476` 片3:原字面是「已經用過的供應商」,而片3 之後有一格例外
              (**已停用 × 只剩作廢列** ⇒ 不列)⇒ 補「而且沒被作廢的」,否則這句是謊話。
              ⚠️ 兩關審查抓到的字面,不是我自己想到要改的。 */}
          供應商清單載入失敗,選單只會列出這張單已經用過、而且沒被作廢的供應商。請重新整理;
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

              <UnsourcedNotice item={item} />

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
