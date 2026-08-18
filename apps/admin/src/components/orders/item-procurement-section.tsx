import { Fragment } from 'react';
import type { AdminOrderDetail, AdminOrderDetailItem, AdminOrderItemProcurement } from '@pcm/domain';
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

/**
 * 截斷警告。**三種情況的文案刻意不同,而差別不在語氣,在【我們有沒有證據】。**
 *
 * 🔴🔴 **本段 2026-08-18 傍晚由 `#646` 整段重寫;上一版(`#643` B)的論證已不適用,不要照它改。**
 * 舊字面(更早、`#643` B 之前)~~「請重新整理這張單;在完整載入之前不能編輯採購」~~
 * 已因下面這條紀律被撤:全陣紀律逐字(`apps/storefront/src/lib/account-order-copy.ts:16`)
 * > **「請重新整理」只准出現在【真的重整就會好】的地方。**
 *
 * ## `#646` 之後,這一區有三種情況(兩個欄位、三種說法)
 *
 * ```
 * ① item 讀到了但觸及上限   procurements=[…] + procurementTruncated=true
 *    ⇒ 證據是【品項級】的（mapper 自己算的 length >= 50）⇒ **講死**：固定限制、重整不會改變
 * ② item 一列都沒讀到       procurements=null
 *    ⇒ 🔴 **沒有證據說它是哪一種** ⇒ **不宣稱**，用條件句
 * ③ order 清單沒完整載入    detail.itemsTruncated=true
 *    ⇒ 這一欄併了兩個來源：mapper 的 length>=200（固定）
 *      與 mergeDetailItems 的【筆數對帳不符】（暫時）⇒ **不宣稱**，用條件句
 * ```
 *
 * ## 🔴 為什麼 ②③ 是條件句 —— 這是【證據到此為止】,不是偷懶
 *
 * 關卡2 codex 連兩輪抓到我在同一件事上犯三次:
 * ```
 * 第一版  ②③ 都改成講死「固定限制」        ⇒ ③ 的「筆數對帳不符」那條路重整會好 ⇒ 說謊（MF1）
 * 第二版  ② 的 fixed 吃 detail.itemsTruncated ⇒ 拿【訂單層】事實斷定【品項】 ⇒ 說謊（MF2）
 * 第三版  ② 的 fixed 吃 item.procurementTruncated
 *        ⇒ 而那一欄可能是 mergeDetailItems 拿訂單層事實填的 ⇒ 繞一圈同一個病（codex round2）
 * ```
 * ⇒ 現行版本:**② 完全不宣稱**,`mergeDetailItems` 也不再替品項猜(它填 `procurementTruncated: false`,
 *   意思是「我沒有證據說它固定」)。要讓 ② 也講得死,得先有**品項級**的截斷原因 —— **不在本片**。
 *
 * ## 兩句話都保留的那半句
 *
 * 🔴 「在完整載入之前不能編輯採購」描述的是【真的擋著的行為】:
 *    `item-procurement-form.tsx` 的 `<fieldset disabled={…}>`,而該檔自陳 action 端還有第二道
 *    (hidden `stale=1`)⇒ **兩道,不是文案自嗨。** 把一句描述真實限制的話當廢話刪掉,
 *    會製造一個新的靜默失敗。
 * ⚠️ 而伺服器端那則(`procurement-action-state.ts` 的 `stale`)`#646` 之後**刻意不複述下一步** ——
 *    hidden `stale` 只帶得上來一個 `1`,分不出是 ①②③ 哪一種,複述必然在另外兩種說謊。
 */
function TruncationWarning({ scope }: { scope: 'item' | 'order' }) {
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      {scope === 'order' ? (
        <>
          這張單的品項清單這次沒有完整載入,下面看到的採購紀錄可能不是全部。
          可以先重新整理看看;
          <strong>如果還是這樣,那是系統的固定限制、不會自己好</strong>,請找負責人處理。
        </>
      ) : (
        <>
          這個品項的採購紀錄太多,超過一次能載入的上限,下面看到的不是全部。
          <strong>這是系統的固定限制,重新整理不會改變</strong>,請找負責人處理。
        </>
      )}
      在完整載入之前不能編輯採購(避免用不完整的內容覆蓋既有紀錄)。
    </div>
  );
}

/**
 * 🔴 `#646` 的另一半:**讀不到**(`item.procurements === null`,內嵌鍵整個沒回來/投影退版)。
 *
 * 這是**另一個世界**,不是上面那個的變體:
 * ```
 * 讀不到（本元件）   → 暫時性 ⇒ **重整真的可能會好** ⇒ 唯一正確的指示就是「請重新整理」
 * 觸及上限（上面）   → 固定的 ⇒ 重整永遠不會好      ⇒ 說「請重新整理」就是叫他做白工
 * ```
 * 舊版兩者共用一顆布林 ⇒ 只能寫成條件句(「可以先重新整理看看;如果還是這樣…」)。
 * `#646` 把它們拆開之後,**兩邊都可以講死**,而這正是這一片全部的價值。
 * 📎 全陣紀律(`apps/storefront/src/lib/account-order-copy.ts:16`)逐字:
 *    **「請重新整理」只准出現在【真的重整就會好】的地方** —— 這裡就是那個地方。
 */
function UnreadableWarning() {
  return (
    <div
      role='alert'
      className='mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'
    >
      這個品項的採購紀錄這次<strong>沒有讀到</strong>(不是「沒有採購」)。
      可以先重新整理看看;
      <strong>如果還是這樣,那是系統的固定限制、不會自己好</strong>,請找負責人處理。
      在讀到之前不能編輯採購(避免用不完整的內容覆蓋既有紀錄)。
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

/** 一列大約放得下的原因長度;超過就收進 `<details>`(數字是估的,見 `VoidReasonCell`)。 */
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

function ProcurementRows({
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
          // 🔴 `#646`:三個狀態,而它們的【對員工的指示】不一樣,所以要分開算。
          //    · unreadable ⇒ 讀不到（暫時的）⇒ 重整真的可能會好
          //    · truncated  ⇒ 觸及固定上限     ⇒ 重整永遠不會好
          //    · blocked    ⇒ 兩者皆不得編輯（fail-closed 立場【沒有】變鬆:
          //      舊版 missing 會翻成 truncated=true 而擋住,拆開之後由 unreadable 接手擋)
          const unreadable = item.procurements === null;
          const rows = item.procurements ?? [];
          const truncated = item.procurementTruncated || detail.itemsTruncated;
          const blocked = unreadable || truncated;
          return (
            <div key={item.id} className='rounded-md border p-3'>
              <div className='mb-2 flex flex-wrap items-baseline gap-2'>
                <span className='text-sm font-medium'>{item.title ?? item.variantSku}</span>
                <span className='text-muted-foreground text-xs'>{item.variantSku}</span>
                <span className='text-muted-foreground ml-auto text-xs'>
                  訂單數量 {item.quantity}
                </span>
              </div>

              {/* 🔴 `#646`:兩個欄位回答兩個不同的問題,四種組合各有各的話要說。
                  `procurements === null` = 我手上沒有這份清單;`procurementTruncated` = 這是不是固定限制。
                  ⇒ 「沒讀到 + 固定」(品項落在 200 之外,`merge-detail-items.ts` 那條路)
                    **不可以叫員工重新整理** —— 重整永遠不會改變。 */}
              {/* 🔴🔴 `#646` 關卡2 codex 兩輪的結論:**「讀不到」這一種,我們沒有證據說它是哪個世界。**
                  第一版 `fixed={truncated}`(吃訂單層旗標)⇒ 把暫時的說成固定 —— MF2。
                  第二版改吃 `item.procurementTruncated` ⇒ 而那一欄可能是 `mergeDetailItems`
                  拿**訂單層**事實填的 ⇒ 繞一圈同一個病復發 —— codex round2。
                  ⇒ **不宣稱。** 這裡用條件句,而條件句在這裡是【證據到此為止】,不是偷懶。 */}
              {unreadable && <UnreadableWarning />}
              {!unreadable && item.procurementTruncated && !detail.itemsTruncated && (
                <TruncationWarning scope='item' />
              )}

              {/* 🔴 片1(Sean 2026-08-18 拍板 `08 訂單頁先批第一刀 = 甲`):
                  **零採購列的品項不再攤開一整組空白表單**,收進原生 `<details>`。
                  **為什麼**:一個什麼事都還沒發生的品項,原本佔 **475 px / 17 個表單控制項** ——
                  那個成本**與它有沒有事要做無關**。量測、環境限定與完整數字:
                  `docs/specs/2026-08-18-m4b-order-detail-product-card-plan.md` §2-b/§2-c、驗收 #4。

                  🔴 **條件是「零列【而且】沒被截斷」**:截斷時 `procurements` 也可能是空的,
                     而那是「**沒撈到**」不是「**沒有**」—— 兩者的下一步相反(下訂 vs 重整)。
                     ⚠️ **`truncated` 兩半都要**(`item.procurementTruncated || detail.itemsTruncated`):
                     `procurements: []` + `procurementTruncated: true` + `itemsTruncated: false`
                     是**真的生產路徑**(`merge-detail-items.ts:97-100`,品項落在 `ORDER_ITEMS_EMBED_LIMIT`
                     之外時逐字如此)⇒ **只擋訂單層那半會漏掉 Sean 那張 200 品項的單。**

                  🔴 **文案逐字取自 OD 定案稿** `pcm-admin-order-ui` / `overview-desktop.html:1061-1062`。
                     ⚠️ **形狀是【改過的】,不是照搬**:OD 那塊 tip 住在 `.segbody` 裡、CTA 是真 `<button>`,
                     開合器是另一顆 `.seghd`。本片**把 tip 本身變成開合器、CTA 變成 `<span>`** ——
                     因為片 2/3(商品卡外殼與三段接線)**Sean 沒批**,那兩層還不存在。
                     ⇒ **不要把這裡讀成「OD 就是這樣畫的」。** `▾` 是照 OD `:1042` 補回來的。

                  🔴🔴 **交棒給片 2/3 的一個地雷**:收合區內有 7 個 `required` 與 1 個 `<form>`,
                     而**唯一的送出鈕也在收合區內** ⇒ 今天產不出「送不出去又看不到錯在哪」那個死結。
                     **但只要有人照 OD 把 CTA 做成 `<details>` 外面的真 `<button>`(OD 正是那樣畫的),
                     或加任何 `form=` 的外部送出鈕,這條當場活過來。** 動它之前先想這件事。 */}
              {/* 🔴 `#646`:條件用 `blocked` 不是 `truncated` —— 讀不到時**不得**走這條路。
                  走了的話畫面會說「還沒跟任何供應商訂」,而真相是「我沒讀到」
                  ⇒ 那正是本片在修的病(「沒撈到」被講成「沒有」)。
                  舊版靠 missing 會翻成 truncated 才擋住,拆開之後這裡要自己擋。 */}
              {rows.length === 0 && !blocked ? (
                <details className='group'>
                  {/* 🔴 `UnsourcedNotice` 在這條路上**刻意不渲染**:它逐字說「請在下面補上要向誰訂」,
                      而「下面」現在是收起來的;件數也已經在卡頭的「訂單數量」那格。
                      ⇒ 兩塊琥珀框說同一件事 = Sean 這輪「**變少了沒有**」那個判準的反面。
                      **唯一保留的是它獨有的資訊**(自有庫存要選「店內現貨」),併進下面這一句。
                      ⚠️ 數量摘要**讀不到**時仍然要渲染它 —— 那句講的是「算不出來」,不是重複。 */}
                  <summary className='flex cursor-pointer flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700'>
                    <span className='transition-transform group-open:rotate-90'>▸</span>
                    <span>
                      還沒跟任何供應商訂,所以也還不能出貨。
                      <span className='text-muted-foreground ml-1'>(自有庫存選「店內現貨」)</span>
                    </span>
                    <span className='border-primary text-primary ml-auto rounded-md border px-2.5 py-1 font-medium'>
                      ＋ 跟供應商下訂
                    </span>
                  </summary>
                  <div className='mt-3'>
                    {unsourcedQuantity(item.quantitySummary) === null && (
                      <UnsourcedNotice item={item} />
                    )}
                    <ItemProcurementForm
                      orderId={detail.id}
                      returnTo={returnTo}
                      orderItemId={item.id}
                      procurements={rows}
                      supplierChoices={buildSupplierChoices(suppliers, rows)}
                      truncated={blocked}
                    />
                  </div>
                </details>
              ) : (
                <>
                  <UnsourcedNotice item={item} />

                  <ProcurementRows
                    item={item}
                    rows={rows}
                    unreadable={unreadable}
                    orderId={detail.id}
                    returnTo={returnTo}
                    truncated={blocked}
                  />

                  <ItemProcurementForm
                    orderId={detail.id}
                    returnTo={returnTo}
                    orderItemId={item.id}
                    procurements={rows}
                    supplierChoices={buildSupplierChoices(suppliers, rows)}
                    truncated={blocked}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
