import { mintPaymentFormStamp } from '../../lib/orders/payment-form';
import { PaymentList, type PaymentListData } from './payment-list';
import { PaymentRecordForm } from './payment-record-form';
import type { ReactNode } from 'react';

// payment-section.tsx — M-4b E10 #15-B2-c 片2a:收款明細 + 登錄表單(同一張卡)。
//
// 🔴 **鑄章必須在這裡(server 元件)、每次 render 一組新的**:
//    `mintPaymentFormStamp()` 同時產冪等鍵與現金軌時點(`payment-form.ts:271-273`),
//    兩者同生共死;client 端補鑄任何一半都會讓 RPC 的 G8 逐欄比對對不上
//    (`payment-form.ts:264` 逐字警告,姊妹片 `receipt-record-form.tsx:81` 是反面教材)。
//    ⚠️ 本元件的兩個消費端都是 `force-dynamic`(`app/orders/[id]/page.tsx:18`、
//    `app/@panel/orders/page.tsx:23`)⇒ 章不會被快取層共用。**要新增第三個消費端前先確認這件事**:
//    落進任何快取層 = 多個員工共用同一把冪等鍵 = 第二筆收款被 G8 靜默吃掉。
//
// 🔴 **明細在上、表單在下、同一張卡**(Sean 拍板 Q-D2=A + H6②):
//    員工要登錄前先看得到「已經有哪幾筆」,關係一眼可見、不用人教。
//    ⇒ 表單當 `children` 塞進 `PaymentList` 那張卡裡,不是自己再開一張。

export function PaymentSection({
  orderId,
  returnTo,
  payments,
  amountDue,
  amountUncomputable = false,
  refundedTotal,
  cancelled,
  formDefaultOpen = false,
  cancelSlot,
  layout = 'page',
  noteSlot,
  cancelledUnknown = false,
  cancelAdjusted = false,
  openPendingRefund = null,
}: {
  /** 純轉傳 `PaymentList.cancelAdjusted`。 */
  cancelAdjusted?: boolean;
  /** 純轉傳 `PaymentList.openPendingRefund`。 */
  openPendingRefund?: number | null;
  cancelledUnknown?: boolean;
  /** B17:彈窗版版面(見 `PaymentList` / `PaymentRecordForm` 同名 prop)。 */
  layout?: 'page' | 'dialog';
  noteSlot?: ReactNode;
  orderId: string;
  returnTo: string;
  /** 純轉傳 `PaymentRecordForm.defaultOpen`(列表收款彈窗傳 true)。 */
  formDefaultOpen?: boolean;
  /** 純轉傳 `PaymentRecordForm.cancelSlot`(列表收款彈窗傳 `<NextStepCancelButton />`)。 */
  cancelSlot?: ReactNode;
  payments: PaymentListData;
  /** 應收總額(整數元)——#437 ④ 卡頂彙總行用;由 order-detail 從 `detail.total.amount` 直傳。 */
  amountDue: number | null;
  /** 🔴 [R1 M1] 純轉傳 `PaymentList.amountUncomputable`:算不出來 ≠ 讀不到(兩者都讓 amountDue 是 null)。 */
  amountUncomputable?: boolean;
  /** 🔴 帳本已退總額(**含尚未確定出款的 `processing`**);純轉傳給 `PaymentList`。`null` = 算不出來 ⇒ 彙總行印「未知」。 */
  refundedTotal: number | null;
  /** 🔴 這張單已取消嗎;純轉傳給 `PaymentList`(只關掉「還差 X 元」那一顆, 不動金額)。 */
  cancelled: boolean;
}) {
  const stamp = mintPaymentFormStamp(new Date());
  return (
    <PaymentList
      data={payments}
      amountDue={amountDue}
      amountUncomputable={amountUncomputable}
      refundedTotal={refundedTotal}
      cancelled={cancelled}
      cancelAdjusted={cancelAdjusted}
      openPendingRefund={openPendingRefund}
      orderId={orderId}
      returnTo={returnTo}
      layout={layout}
      cancelledUnknown={cancelledUnknown}
      // dialog:確認勾那句的「已收 …」摘要由 PaymentList 算(它手上那份彙總),餵進表單。
      renderForm={(receivedNote, historySlot) => (
        <PaymentRecordForm
          key={orderId}
          orderId={orderId}
          returnTo={returnTo}
          stamp={stamp}
          detailsReadable={payments.status === 'ok'}
          defaultOpen={formDefaultOpen}
          cancelSlot={cancelSlot}
          variant={layout}
          receivedNote={receivedNote}
          noteSlot={noteSlot}
          historySlot={historySlot}
        />
      )}
    >
      {/* 🔴 `key={orderId}`:換單必須換掉整個表單實例 —— 冪等鍵的作用域是**這張單**
          (`payment-action-state.ts:24-28` 逐字:同一把鍵用在另一張單上 DB 擋不到)。
          少了它,從 A 單的失敗態導覽到 B 單會把 A 的舊鍵帶過去。 */}
      <PaymentRecordForm
        key={orderId}
        orderId={orderId}
        returnTo={returnTo}
        stamp={stamp}
        // 🔴 只有 `ok` 算讀到了。`order_not_found` 與 `unreadable` 都是「不知道有沒有」
        //    ⇒ 一律 fail-closed 停用送出,不讓員工在看不到明細的情況下賭一把。
        detailsReadable={payments.status === 'ok'}
        defaultOpen={formDefaultOpen}
        cancelSlot={cancelSlot}
      />
    </PaymentList>
  );
}
