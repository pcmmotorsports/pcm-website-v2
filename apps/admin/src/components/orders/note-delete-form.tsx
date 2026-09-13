'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { softDeleteOrderNoteAction } from '../../lib/orders/note-actions';
import {
  DELETE_KEEPS_RECORD_NOTICE,
  NOTE_DELETE_ID_FIELD,
  NOTE_DELETE_REASON_FIELD,
  NOTE_ORDER_ID_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  type NoteDeleteActionState,
} from '../../lib/orders/note-action-state';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';

// 貼板 138:把一則備註「收起來」的表單(client island;server action 在 `note-actions.ts`)。
//
// 🔴🔴 **這顆鈕不是安全邊界** —— 它只在 `canDelete === 'yes'` 時被渲染,
//    而真正擋得住的是 server action 那道 `authorizeManagerMutation()`。
//    📌 **「看不到」與「擋得住」是兩件事**,兩格驗法都要有:
//      ①非 manager 看不到這顆鈕(`notes-timeline.test.tsx`)
//      ②授權閘回 null ⇒ action **不進寫入路徑**(`note-actions.test.ts`)
//    ⚠️ **而 ② 的射程要講準**(codex 2026-09-13 nit 2 收窄我第一版的說法):
//       那一格是**把 `authorizeManagerMutation` mock 成 null**、再斷言 repository 沒被呼叫
//       ⇒ 它證的是「**閘拒絕之後**不會寫入」,**不是**「真實的非 manager 身分會被閘拒絕」,
//       也**沒有連 DB**。後者要真登入才驗得到,今天沒有人驗過。
//       ⛔ ~~第一版寫「DB 零改動」~~ —— 那句話在一個 mock 掉 repository 的測試裡是空的。
//
// 🔴 **`requestToken` 由 server 渲染期產、原樣帶回** —— 與新增備註那支同一條規矩
//    (`note-action-state.ts` 的 `generateNoteRequestToken` docstring):
//    失敗後重按若換一把新 token,RPC 就認不出這是重送。
//    ⚠️ 刪除這一支的重按代價比新增小(同 token ⇒ DUPLICATE_REQUEST;不同 token ⇒ ALREADY_DELETED,
//       兩者都不會二次寫入)—— 但「認得出重送」仍然是讓員工看到正確訊息的前提。

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type='submit'
      disabled={pending}
      className='bg-muted text-foreground h-8 rounded-md px-3 text-xs font-medium disabled:opacity-50'
    >
      {pending ? '處理中…' : '收起這則'}
    </button>
  );
}

export function NoteDeleteForm({
  orderId,
  noteId,
  seq,
  returnTo,
  serverToken,
}: {
  orderId: string;
  noteId: string;
  /** 時間軸上的編號,只拿來讓 summary 說清楚在收哪一則 */
  seq: number;
  returnTo: string;
  serverToken: string;
}) {
  const [state, formAction] = useActionState<NoteDeleteActionState, FormData>(
    softDeleteOrderNoteAction,
    { status: 'idle', requestToken: serverToken },
  );
  // 🔴 失敗時用 state 帶回的那一把,沒失敗過才用 server 那一把(R2-2 同一條規矩)。
  const token = state.requestToken;

  return (
    <details className='mt-1'>
      <summary className='text-muted-foreground cursor-pointer text-xs underline'>
        收起 #{seq}
      </summary>
      <form action={formAction} className='mt-2 flex flex-wrap items-center gap-2'>
        <input type='hidden' name={NOTE_ORDER_ID_FIELD} value={orderId} />
        <input type='hidden' name={NOTE_DELETE_ID_FIELD} value={noteId} />
        <input type='hidden' name={NOTE_REQUEST_TOKEN_FIELD} value={token} />
        <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
        {/* 🔵 理由**選填**(Sean 2026-09-13 答乙)⇒ **不加 `required`**。
            ⚠️ 而 placeholder 刻意寫「可以不填」而不是留空 —— 一個沒有任何提示的輸入框
               在員工眼裡就是「該填的」,那會讓選填在畫面上退化成必填。 */}
        <input
          type='text'
          name={NOTE_DELETE_REASON_FIELD}
          defaultValue={state.status === 'failed' ? state.reason : ''}
          maxLength={500}
          placeholder='理由(可以不填)'
          className='border-input bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-xs'
        />
        <SubmitButton />
      </form>
      {/* 🔴🔴 Sean 2026-09-13 逐字定案那一句,住在**鈕的旁邊**(按之前)——
          與 `result-banner.tsx` 那句「備註已收起。」(按之後)是**兩格,刻意不共用**。
          合掉省的是一行小字,失去的是員工敢不敢按。 */}
      <p className='text-muted-foreground mt-1 text-xs'>{DELETE_KEEPS_RECORD_NOTICE}</p>
      {state.status === 'failed' && (
        <p role='alert' className='text-destructive mt-1 text-xs'>
          {state.message}
        </p>
      )}
    </details>
  );
}
