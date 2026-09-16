import { listOrderPayments } from '../../lib/orders/payment-repository';
import { getLedgerUnregisteredAmount } from '../../lib/payment/refund-read';
import { refundedTotalFromUnregistered } from '../../lib/orders/payment-list-view';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { PaymentSection } from './payment-section';
import { NextStepCancelButton } from './next-step-cancel-button';
import type { PaymentListData } from './payment-list';

// next-step-pay-body.tsx — 收款欄「還差 N」/「還沒收」點下去開的彈窗內容(2026-09-13,Sean 答甲)。
//
// 🔴🔴 **復用明細頁收款分頁那【整段】`PaymentSection`(清單 + 表單),不是只復用表單。**
//    codex R1 must-fix ①(2026-09-13):第一版只放 `PaymentRecordForm`,沒有收款列
//    ⇒ 首送已入帳但回應失敗時,**員工在彈窗裡看不到那一筆**,按「開始下一筆」換鍵重登 ⇒ **寫兩筆**。
//    明細頁不會這樣,因為它把收款清單畫在表單上面 —— 員工看得到「剛剛那筆已經在了」。
//    ⇒ 彈窗**整段**照抄明細頁:清單在上、表單在下、同一支 action、同一把 server 鑄的章、`key={orderId}`。
//    📌 「復用不重寫」的單位是【那一段的行為】,不是【那一個元件】—— 只搬一半就是第二份行為。
//
// 🔴 三個資料 prop 的來源,與明細頁差在哪,寫清楚:
//    · `payments`:同一支 `listOrderPayments`,同一套三態(`null`=單不存在 / throw=讀不到 / 陣列=讀到)
//      ⇒ 與 `order-detail-route.tsx:495` 逐字同款;讀不到就 fail-closed(表單自己鎖送出)。
//    · `amountDue`:page 傳來的 `total.amount`(在這一頁從 `orders[]`、不在就 `findAdminOrderDetail`;都是 `orders.total` 那一欄)。
//    · `refundedTotal`:與明細頁**同一條鏈**(`getLedgerUnregisteredAmount` RPC → `refundedTotalFromUnregistered`),
//      讀不到 ⇒ `null` ⇒ 彙總行印「未知」。⛔ ~~第一版刻意傳 `null`~~ —— 真瀏覽器一開:收款讀到了、卻印
//      「已收金額未知(收款或退款明細沒載入)」,而列表那格剛說「還差 22,760」⇒ 員工會以為壞了。
//      多一發 RPC 換一行對得上的「應收 / 已收 / 還差」,值得。
//    · `cancelled`:`false` —— 取消過的單沒有列表入口(`orderPayAmbiguous`);直接貼網址進來的也只是少藏一顆「還差」。
// 🛑 **零判斷「該不該收」在這裡**:要不要給入口在列表那格判;到了這裡就是「員工說他收到錢了」。

export async function NextStepPayBody({
  orderId,
  returnTo,
  amountDue,
  amountUncomputable,
}: {
  orderId: string;
  /** 動作做完回哪裡 = 列表、而且**展開這一張**(結果橫幅要掛在真的收款的那張單上,codex must-fix ③)。 */
  returnTo: string;
  /** 應收總額(整數元)= 那張單的 `total.amount`;`null` = page 這一刻讀不到 ⇒ 整段當「讀不到」(鎖送出、彙總印「未知」)。 */
  amountDue: number | null;
  /**
   * 🔴 **[R1 M1]** `true` = **系統算不出**這張單取消後還該收多少(Sean 2026-09-16 拍乙),
   *    **不是**「讀不到」。兩者都會讓 `amountDue` 是 `null`,而它們要員工做的事相反:
   *    這一種**重整幾次都不會變**,他要的是人工計算。
   * 🛑 **而收款列表這一態是【好的】** —— 只有應收不知道 ⇒ 不可以把整段打成 `unreadable`
   *    (那會把「不知道有沒有收過款」這個假訊息也一起印出去)。
   */
  amountUncomputable: boolean;
}) {
  const [paymentsSettled, unregisteredSettled, detailSettled] = await Promise.allSettled([
    listOrderPayments(orderId),
    getLedgerUnregisteredAmount(orderId),
    // B17:稿第一句「優惠券 / 儲值金折抵:這張單沒有」要 `discountTotal`;讀不到就印「讀不到」,不擋表單。
    getAdminOrderRepository().findAdminOrderDetail(orderId),
  ]);
  let payments: PaymentListData;
  if (paymentsSettled.status === 'fulfilled') {
    const rows = paymentsSettled.value;
    payments = rows === null ? { status: 'order_not_found' } : { status: 'ok', rows };
  } else {
    payments = { status: 'unreadable' };
  }
  // 🔴 codex R3 must-fix ①:page 補查應收 throw(`amountDue === null`)⇒ 彈窗照開但整段鎖成「讀不到」
  //    (表單實例與舊冪等鍵保住、送出停用;`toPaymentSummary` 對 null 應收印「未知」)。
  // 🔴 只有「真的讀不到」才把收款列表打成 unreadable;「算不出來」那一態列表是好的(見 prop 註解)。
  if (amountDue === null && !amountUncomputable) payments = { status: 'unreadable' };
  const refundedTotal =
    amountDue === null
      ? null
      : refundedTotalFromUnregistered(
          amountDue,
          unregisteredSettled.status === 'fulfilled' ? unregisteredSettled.value : null,
          unregisteredSettled.status === 'rejected',
        );
  /* B17:確認勾那句括號裡的「已收 MM/DD 收 X · 尾 Y」由 `PaymentList`(dialog 版面)用它手上那份彙總算、經 `renderForm` 餵給表單 ——
     不在這裡再呼一次 `toPaymentSummary`(`payment-amount-due-single-source.test` 釘著呼叫端名單)。 */
  const discount =
    detailSettled.status === 'fulfilled' && detailSettled.value !== null
      ? (detailSettled.value.discountTotal?.amount ?? null)  // `?.`:測試 fixture 常是半張 detail
      : null;
  const noteSlot = (
    <div className='pcm-paynotes'>
      <p>
        優惠券 / 儲值金折抵:
        {discount === null ? '讀不到' : discount === 0 ? '這張單沒有' : `${discount.toLocaleString('zh-TW')} 元(應收已扣掉)`}
      </p>
      <p>
        登完這筆之後,上面那顆「已收未定 / 已收已定」是<strong className='pcm-nw'>系統照收款總額自己算的</strong>,不是你改的。
      </p>
      <p>客人的錢真的收到,系統才算優惠券用掉;整單退款或取消,名額會自動還回來。</p>
    </div>
  );
  return (
    <div data-testid='next-step-pay-body'>
      <PaymentSection
        layout='dialog'
        noteSlot={noteSlot}
        orderId={orderId}
        returnTo={returnTo}
        payments={payments}
        amountDue={amountDue}
        amountUncomputable={amountUncomputable}
        refundedTotal={refundedTotal}
        // codex R1 must-fix ③:已取消的單不印「尾」—— 有明細就用真的取消狀態(讀不到才退回 false,那時彙總也是未知)。
        cancelled={detailSettled.status === 'fulfilled' && detailSettled.value !== null ? detailSettled.value.cancelledAt !== null : false}
        // codex R2 must-fix ①:明細讀不到 ⇒ 取消狀態【未知】,不是「沒取消」⇒ 尾款那半不印。
        cancelledUnknown={!(detailSettled.status === 'fulfilled' && detailSettled.value !== null)}
        // 這個彈窗整個就是為了這張表單開的 ⇒ 一進來就攤開,不用再點一次「新增收款」。
        formDefaultOpen
        // 稿的 [取消][確認] 同一排:取消鈕進表單那一排、殼的 footer 收掉(page 端 `inlineCancel`)。
        cancelSlot={<NextStepCancelButton />}
      />
    </div>
  );
}
