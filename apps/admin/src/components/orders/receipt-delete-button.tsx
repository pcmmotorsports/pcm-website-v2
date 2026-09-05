'use client';

import { useActionState } from 'react';
import { undoItemReceiptAction } from '../../lib/orders/receipt-actions';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import {
  RCPT_ORDER_ID_FIELD,
  RCPT_ORDER_ITEM_ID_FIELD,
  RCPT_RECEIPT_ID_FIELD,
  type ReceiptUndoState,
} from '../../lib/orders/receipt-action-state';

// receipt-delete-button.tsx — 逐筆到貨列表上, **某一筆**的撤銷入口(backlog `#450`)。
//
// 🔵 與 `receipt-undo-bar.tsx` 的分工:
//    那一支撤的是「**剛剛那一次**登錄」(靠冪等鍵, 只活在那一次 render 的 state 裡);
//    這一支撤的是「**清單上這一筆**」(直接指名 receipt id)⇒ **離開頁面之後仍然撤得掉**。
//    🛑 兩支呼叫**同一個 action**、過**同一道**歸屬交叉檢查, 不各寫一份判定。
//
// 🔴 **兩段式(先按, 再確認)** —— 抄 `manual-refund-void-button.tsx` 的形狀, 不自創:
//    這是**不可逆**的動作, 而清單上每一列都有一顆鈕 ⇒ 誤按的機會比單一撤銷列高。
//    ⚠️ 而它不是防線 —— 真正擋住的是 action 那道歸屬檢查與 DB 那道包裹守門。

export function ReceiptDeleteButton({
  receiptId,
  orderId,
  orderItemId,
  returnTo,
  receivedAt,
  quantity,
}: {
  receiptId: string;
  orderId: string;
  orderItemId: string;
  returnTo: string;
  /** 只用來讓確認句說得出「撤哪一筆」—— 不參與任何判定。 */
  receivedAt: string;
  quantity: number;
}) {
  const [state, formAction, pending] = useActionState<ReceiptUndoState, FormData>(
    undoItemReceiptAction,
    { status: 'idle' },
  );

  // 🔴 終態是 `undone` 不是 `recorded` —— 我第一版憑印象寫了 `recorded`,
  //    而 **typecheck 當場說「這兩個型別沒有交集」** ⇒ 那一格是它抓的, 不是我想到的。
  if (state.status === 'undone' || state.status === 'already_gone') {
    // 🔵 撤掉了(或本來就不在)⇒ 這一列的入口收起來, 而**不說「成功」** ——
    //    整頁會重新讀, 那一列自己會消失;在這裡喊成功會變成兩個來源說同一件事。
    return <span className='text-muted-foreground text-xs'>已撤銷</span>;
  }

  return (
    <form action={formAction} className='inline'>
      <input type='hidden' name={RCPT_ORDER_ID_FIELD} value={orderId} />
      <input type='hidden' name={RCPT_ORDER_ITEM_ID_FIELD} value={orderItemId} />
      <input type='hidden' name={RCPT_RECEIPT_ID_FIELD} value={receiptId} />
      <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
      {/* 🔴 錯誤畫在鈕**前面** —— 抄 `receipt-undo-bar.tsx` 那格的理由逐字:
          畫在後面的話員工按完看到鈕還在、訊息在視線外, 最順手的反應是再按一次。 */}
      {state.status === 'failed' && (
        <span role='alert' className='text-destructive mr-1 text-xs'>
          {state.message}
        </span>
      )}
      <details className='inline'>
        <summary className='text-destructive cursor-pointer text-xs underline'>撤銷</summary>
        <span className='ml-1 text-xs'>
          撤掉 {receivedAt.slice(0, 10)} 那筆 {quantity} 件?
          <button
            type='submit'
            disabled={pending}
            className='text-destructive ml-1 font-medium underline disabled:opacity-50'
          >
            {pending ? '撤銷中…' : '確定撤銷'}
          </button>
        </span>
      </details>
    </form>
  );
}
