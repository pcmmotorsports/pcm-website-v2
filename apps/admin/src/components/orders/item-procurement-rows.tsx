import { Fragment } from 'react';
import type { AdminOrderDetailItem, AdminOrderItemProcurement } from '@pcm/domain';
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
import { REPLY_STATUS_LABEL } from '../../lib/orders/procurement-view';
import { ReceiptRecordForm } from './receipt-record-form';

// item-procurement-rows.tsx — 採購列表格(`#649` 從 `item-procurement-section.tsx` 搬出來)。
//
// 🔴 **搬家,不是重寫**:`TH` / `TD` 兩個 class 常數**跟著這裡的表格走**(它們只有這裡用),
//    而 `CARD` 留在原檔(只有那邊用)⇒ **三個常數各自仍只有一處定義**。
//    ⚠️ 這件事**沒有守門**(該族測試只斷言過 `opacity-60`)⇒ 拆檔時重打會靜默壞版面,
//       所以是 cut-paste 不是重打。理由與驗收清單見 backlog `#649`。

const TH = 'px-2 py-1.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-2 py-1.5 text-sm align-top';

const VOID_REASON_INLINE_MAX = 60;

/**
 * 作廢原因那一格(`#476` 片4)。
 *
 * 三件事,每件都有理由:
 * ① **`null` 誠實顯示缺、不留白** —— DB 的配對 CHECK 讓「已作廢」必有原因
 *   (`20260813120000_m4b_e10_452_procurement_void_schema.sql:347-350`)⇒ 這裡拿到 `null`
 *   代表**投影沒帶回來**,不是「當初沒填」。留白會讓員工以為是後者。
 * ② **長原因要能收起來,但收起來之後要能展開** —— 它是自由文字、長度無上限
 *   (`void_reason text`,同檔 `:343`),一列塞進來會把整張表擠爛;
 *   而只切掉尾巴(`…`)等於把員工需要的那半藏起來還告訴他沒有更多。
 *   ⇒ 用原生 `<details>`:預設收合、點一下展開,**零 JS、零依賴**。
 * ③ **門檻取 60 字** —— 一列大約放得下的長度。⚠️ 這個數字是**估的、沒有量過**:
 *   沒有真瀏覽器可以量(本 repo 跑不起 admin ⇒ 缺口記在 `~/pcm-mailbox/V-007-CHECKLIST.md`,
 *   **那是信箱不是 repo,git 裡 grep 不到**),等有人肉眼看過再調。
 */
function VoidReasonCell({ reason }: { reason: string | null }) {
  if (reason === null) {
    return <>作廢原因:(沒有帶回來)</>;
  }
  if (reason.length <= VOID_REASON_INLINE_MAX) {
    return <>作廢原因:{reason}</>;
  }
  return (
    <details>
      <summary className='cursor-pointer'>
        作廢原因:{reason.slice(0, VOID_REASON_INLINE_MAX)}…(點開看完整)
      </summary>
      <span className='mt-1 block break-words whitespace-pre-wrap'>{reason}</span>
    </details>
  );
}

export function ProcurementRows({
  item,
  rows,
  unreadable,
  orderId,
  returnTo,
  truncated,
}: {
  item: AdminOrderDetailItem;
  /**
   * 🔴 `#646`:已解過 `null` 的採購列。**呼叫端負責解**(`item.procurements ?? []`),
   * 因為「讀不到」與「零筆」的**分流發生在呼叫端**(要不要走那個 `<details>` 快樂路徑)。
   * 本元件只收結果,不重算 —— 重算 = 第二個真相源。
   */
  rows: readonly AdminOrderItemProcurement[];
  /** `true` = 讀不到(`procurements === null`);與「零筆」是兩件事,見下面第一個分支。 */
  unreadable: boolean;
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
  // 🔴 `#646`:先分「讀不到」再分「零筆」,而兩句話的**下一步動作不同**。
  //    ⚠️ 順序不可對調:`unreadable` 時 `rows` 也是空的,先判零筆會把它講成「沒有採購」。
  if (unreadable) {
    // 🔴 `#646`:上面那張 `UnreadableWarning` 已經按「固定/暫時」講過話了
    //    ⇒ 這一句**不再重複給指示**(重複而且可能不一致,是比沒講更壞的狀態)。
    return (
      <p className='text-muted-foreground text-sm'>
        這個品項的採購紀錄這次沒有讀到(不是「沒有採購」),詳見上方說明。
      </p>
    );
  }
  if (rows.length === 0) {
    // 🔴 片1(2026-08-18)之後,**這一行只剩「被截斷」那條路走得到** ——
    //    零列且沒截斷的品項已經走上面那個 `<details>` 分支了。
    //    ⚠️ 這是**片1 造成的語意轉移**,不是原作者寫錯:在片1 之前這一行兩種情況都會走到。
    //    🔴 `#646` 之後**又收窄一次**:「讀不到」已經被上面那個分支接走
    //    ⇒ 走到這裡只剩【觸及固定上限】,所以這句不再叫他重新整理(那會是白工)。
    return (
      <p className='text-muted-foreground text-sm'>
        這個品項的採購紀錄超過一次能載入的上限,這裡列不出來;請找負責人處理。
      </p>
    );
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
          {rows.map((p) => {
            // 🔴 `#476` 片3:作廢與否**從資料算、不寫死** —— 理由逐字同 `shipment-section.tsx`
            //    那條(「寫死的話它會變成過濾條件的第二個真相源」)。
            //    ⚠️ 用 `!= null` 而非 `!== null`,與 `procurement-view.ts:findActiveProcurement`
            //    **同一個方向**(缺欄時退回「當生效」而不是「全部當作廢」)。兩處若不一致,
            //    同一列會在表格上寫「已作廢」、在表單裡卻被當生效 hydrate 出來。
            const voided = p.voidedAt != null;
            return (
            // 🔴 `key` 必須掛在 Fragment 上(一列採購現在可能渲染兩個 `<tr>`)⇒ 用具名 Fragment,
            //    `<>` 短語法吃不了 key。
            <Fragment key={p.id}>
            <tr className={voided ? 'border-t opacity-60' : 'border-t'}>
              <td className={TD}>
                {/* 🔴 label 為 null = 內嵌沒回來(A9a-2),不是「這家沒有名字」⇒ 誠實顯示缺 */}
                <span className={voided ? 'line-through' : undefined}>
                  {p.supplierLabel ?? (
                    <span className='text-muted-foreground'>(查不到這家供應商)</span>
                  )}
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
            {/* 🔴 `#476` 片4:作廢**原因**。片3 只說了「它撤了」,而 `#476` 的病灶逐字是
                「兩個數字互相矛盾而**沒有任何一行字解釋**」⇒ 不說為什麼就只解了一半。
                形狀抄 shipments 樣板(`shipment-section.tsx` 逐字「作廢原因:…」)。
                ⚠️ 用**跨欄的第二列**而不是加第十欄:原因是自由文字、長度不可控,
                塞進一欄會把整張表擠爛,而它只在少數列出現。 */}
            {voided && (
              <tr className='border-t-0 opacity-60'>
                <td className={`${TD} text-muted-foreground text-xs`} colSpan={9}>
                  <VoidReasonCell reason={p.voidReason} />
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
