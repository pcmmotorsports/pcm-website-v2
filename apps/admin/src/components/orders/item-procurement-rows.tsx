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

/**
 * 表頭欄位(2026-08-21 W4:從九行 JSX 收成陣列)。
 *
 * 🔴 **為什麼要收成陣列**:`colSpan` 以前是**寫死的 `9`**,而欄數哪天變了它不會跟著變
 *    ⇒ 表格會裂開,而**不一定有東西紅**。收成陣列之後 `colSpan={PROCUREMENT_COLS.length}`
 *    自己跟著走(主視窗 2026-08-21 明文要求:「不要寫死一個數字後靠肉眼對齊」)。
 *
 * 🔴🔴 **~~第九欄「到貨登錄」~~ 已拿掉(Sean 2026-08-21 拍板選 B)** ——
 *    到貨登錄表單改成**跨整張表寬的第二列**(見下方 `data-row='receipt'` 那一段)。
 *    他選 B 的時候知道「其餘八欄會變寬」,**那是他選項的一部分,不是副作用。**
 *    ⚠️ 選項原文:A 留著(標題寫著卻永遠空白)/ B 拿掉(其餘八欄會變寬)⇒ 他答 B。
 */
const PROCUREMENT_COLS = [
  { label: '供應商', className: TH },
  { label: '訂購', className: `${TH} text-right` },
  { label: '到貨', className: `${TH} text-right` },
  { label: '回覆狀態', className: TH },
  { label: '供應商單號', className: TH },
  { label: '預計到貨', className: TH },
  { label: '異常原因', className: TH },
  { label: '送出時間', className: TH },
] as const;

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
            {PROCUREMENT_COLS.map((c) => (
              <th key={c.label} className={c.className}>
                {c.label}
              </th>
            ))}
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
            <tr className={voided ? 'border-t opacity-60' : 'border-t'} data-row='procurement'>
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
            </tr>
            {/* 🔴🔴 #352-b 入口 1:「登錄到貨」**2026-08-21 從第九欄搬到這一列**(Sean 拍板選 B)。
                為什麼搬:那個表單住在最後一欄的格子裡,而**那個格子實測只有 128.4px 寬**
                (W4 2026-08-21 真瀏覽器量;form 112.4 → 內容 86.4)⇒ 表單怎麼排都是壞的:
                寫死兩欄 ⇒ 每欄 37.2px;給 180px 下限 ⇒ 仍是一欄,卻把整張表撐寬 91px。
                ⇒ **問題不在表單,在它住的地方。** 跨欄之後它拿到的是整張表寬。
                ⚠️ **這一列在 `truncated || voided` 時仍然要渲染**(內容換成「—」)——
                   整列消失會讓員工分不出「這筆不給登錄」與「這筆我漏看了」。
                🔴 **已知取捨(2026-08-21 W1 nit-2,明寫不隱藏)**:一筆【已作廢】的採購現在佔 **3 個 `<tr>`**
                   —— 採購列 + 只放一個「—」的到貨列 + 作廢原因列。
                   ⇒ 一張單如果有很多筆作廢採購,表格會明顯變長。
                   **接受它的理由**:上面那句(整列消失會讓員工分不出兩種情況)在作廢這一格同樣成立,
                   而「作廢很多筆」是少數情況。⚠️ **若日後有人回報表格太長,先看這裡,不要當成新問題。** */}
            <tr className={voided ? 'opacity-60' : undefined} data-row='receipt'>
              <td className={TD} colSpan={PROCUREMENT_COLS.length}>
                {/* `#476` 片3:作廢的採購不給到貨入口。**現在有【兩道】守門,而它們守的不是同一件事。**
                    ┌ 權威(擋得住寫入)  DB:`admin_record_item_receipt` 的「已作廢不得登錄到貨」,
                    │                    在 `20260814100000` 步 6b(該 migration `:34` 逐字),
                    │                    回新碼 `PROCUREMENT_VOIDED`;呼叫端認得它(`receipt-repository.ts:36`)
                    └ 本行(UX 前置)     不讓員工填完整張表才被 RPC 拒掉(Sean「操作直覺化」)+ 縱深

                    🔴🔴 **~~「這是目前唯一的守門」~~ 2026-08-21 更正 —— 而它【曾經】是對的:**
                    原句附的量法是 `grep -c 20260814100000 supabase/APPLIED.tsv` ⇒ **0**(還沒 apply)。
                    **當場重跑 ⇒ 1**(`supabase/APPLIED.tsv:230`,apply 於 **2026-08-14**;
                    負對照 `grep -c 29991231235959` ⇒ 0 ⇒ 量具分得開)。
                    ⇒ 三個下游宣稱跟著翻面:①「唯一的守門」為假 ②「拿掉它 = 真的寫得進去」為假
                      ③ ~~「在那之前不要照那個理由把它拿掉」~~ 的前提已經不存在。
                    🔴 **留著劃線不刪的理由**:一個過期的理由比沒有理由更貴 ——
                       它會讓下一個人為了「唯一的守門」而不敢動一個其實有 DB 兜底的東西。

                    ⇒ **拿掉本行今天會發生什麼(這才是要看的那一格)**:寫入仍然擋得住,
                      但員工要**填完整張表、按下送出、才被拒**。
                      ⚠️ 那不是資料安全問題,是**可用性退化** ⇒ 仍然不要拿掉,而**理由換了**。
                    ⚠️ 顯示「—」而不是整列不渲染:整列消失會讓員工分不出「這筆不給登錄」與「我漏看了」。 */}
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
                <td className={`${TD} text-muted-foreground text-xs`} colSpan={PROCUREMENT_COLS.length}>
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
