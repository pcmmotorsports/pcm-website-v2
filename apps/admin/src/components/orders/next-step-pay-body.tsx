import { listOrderPayments } from '../../lib/orders/payment-repository';
import { getLedgerUnregisteredAmount } from '../../lib/payment/refund-read';
import { refundedTotalFromUnregistered } from '../../lib/orders/payment-list-view';
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
}: {
  orderId: string;
  /** 動作做完回哪裡 = 列表、而且**展開這一張**(結果橫幅要掛在真的收款的那張單上,codex must-fix ③)。 */
  returnTo: string;
  /** 應收總額(整數元)= 那張單的 `total.amount`;`null` = page 這一刻讀不到 ⇒ 整段當「讀不到」(鎖送出、彙總印「未知」)。 */
  amountDue: number | null;
}) {
  const [paymentsSettled, unregisteredSettled] = await Promise.allSettled([
    listOrderPayments(orderId),
    getLedgerUnregisteredAmount(orderId),
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
  if (amountDue === null) payments = { status: 'unreadable' };
  const refundedTotal =
    amountDue === null
      ? null
      : refundedTotalFromUnregistered(
          amountDue,
          unregisteredSettled.status === 'fulfilled' ? unregisteredSettled.value : null,
          unregisteredSettled.status === 'rejected',
        );
  return (
    <div data-testid='next-step-pay-body'>
      <PaymentSection
        orderId={orderId}
        returnTo={returnTo}
        payments={payments}
        amountDue={amountDue}
        refundedTotal={refundedTotal}
        cancelled={false}
        // 這個彈窗整個就是為了這張表單開的 ⇒ 一進來就攤開,不用再點一次「新增收款」。
        formDefaultOpen
        // 稿的 [取消][確認] 同一排:取消鈕進表單那一排、殼的 footer 收掉(page 端 `inlineCancel`)。
        cancelSlot={<NextStepCancelButton />}
      />
    </div>
  );
}
