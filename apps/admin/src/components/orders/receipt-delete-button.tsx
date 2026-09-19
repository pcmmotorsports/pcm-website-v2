'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { undoItemReceiptAction } from '../../lib/orders/receipt-actions';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { taipeiYmd } from '../../lib/orders/procurement-view';
import {
  RCPT_ORDER_ID_FIELD,
  RCPT_ORDER_ITEM_ID_FIELD,
  RCPT_RECEIPT_ID_FIELD,
  type ReceiptUndoState,
  RCPT_UNDO_REASON_FIELD,
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
  doneHref,
}: {
  receiptId: string;
  orderId: string;
  orderItemId: string;
  returnTo: string;
  /** 只用來讓確認句說得出「撤哪一筆」—— 不參與任何判定。 */
  receivedAt: string;
  quantity: number;
  /**
   * 撤銷成功後要不要導頁。明細頁不傳(留在原地、清單就地變「已撤銷」);
   * 列表的到貨彈窗傳 `doneHref`(= 列表 + `open=<這張單>`):action 只 revalidate、不 redirect,
   * 而彈窗殼只在「關閉」時走 closeHref ⇒ 沒有這條的話撤完仍停在 `?next=…&do=receipt`,結果不會回到那張單上
   * (codex 2026-09-14 must-fix A)。`already_gone` 也導 —— 那筆已經不在,留在彈窗裡沒有下一步。
   */
  doneHref?: string;
}) {
  const router = useRouter();
  // 🔴 導頁寫在 action 的【包裝】裡,不寫在 effect 裡(codex R2 must-fix A):server action 的 revalidate 會讓
  //    這一列從清單消失 ⇒ 本元件在終態進來的同一批更新裡被卸載,等 `state` 變了才導的 effect 根本沒機會跑。
  //    包裝閉包在 action 呼叫鏈上執行:action **成功 resolve** 的話,列卸載 / transition 被打斷都不會讓它停
  //    (reject / 斷線 / 整頁離開不保證 —— 而那幾種本來就不導;`failed` / `blocked` 也刻意不導)。仍是同一支 server action。
  // 🔴 導之前先看【現在的網址】還是不是這一張單的到貨彈窗(codex R3 must-fix):員工在 A 撤銷等回應的時候按 Esc 關窗、
  //    再開 B 的彈窗 ⇒ A 的回應回來時不能把他從 B 拉回 A。用網址判、不用 mounted 判(mounted 在 R2 那條就證明靠不住)。
  //    🔴 `next` 與 `do` 都要對(codex R4):同一張單換開「跟供應商下訂」的話,舊的撤銷回應不能把那張下訂表單關掉。
  const stillThisDialog = () => {
    if (typeof window === 'undefined') return false;
    const q = new URLSearchParams(window.location.search);
    return q.get('next') === orderId && q.get('do') === 'receipt';
  };
  const [state, formAction, pending] = useActionState<ReceiptUndoState, FormData>(
    async (prev, fd) => {
      const next = await undoItemReceiptAction(prev, fd);
      if (
        doneHref !== undefined &&
        (next.status === 'undone' || next.status === 'already_gone') &&
        stillThisDialog()
      ) {
        router.replace(doneHref);
      }
      return next;
    },
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
          撤掉 {taipeiYmd(receivedAt)} 那筆 {quantity} 件?
          {/* 🔵 **選填的「為什麼」** —— 不填照樣按得下去(`docs/plans/2026-09-17-receipt-undo-reason-plan.md`)。
              🔴 `placeholder` 要寫「可不填」,不要只寫例子 —— 只寫例子的話員工會以為那是必填,
                 而一個看起來必填的空格會讓人隨手打一個「.」,那比沒填更糟(它看起來像有理由)。
              🔴 **不設 `maxLength`**:截斷在 RPC 那一側(>500 截),前端再設一次就是兩個標準。 */}
          <input
            type='text'
            name={RCPT_UNDO_REASON_FIELD}
            aria-label='撤銷原因(可不填)'
            placeholder='為什麼撤銷?可不填'
            className='border-input ml-1 w-40 rounded-md border px-1 py-0.5 text-xs'
          />
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
