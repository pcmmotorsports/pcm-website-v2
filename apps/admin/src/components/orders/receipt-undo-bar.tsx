'use client';

import { useActionState } from 'react';
import { undoItemReceiptAction } from '../../lib/orders/receipt-actions';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import {
  RCPT_ORDER_ID_FIELD,
  RCPT_ORDER_ITEM_ID_FIELD,
  RCPT_REQUEST_ID_FIELD,
  type ReceiptUndoState,
} from '../../lib/orders/receipt-action-state';

// receipt-undo-bar.tsx — 「撤銷剛剛登錄的那筆到貨」(「改軟」線片 1)。
//
// 🔴 **它只撤得掉「這個表單這次登錄的那筆」** —— 逐筆到貨沒有被投影到讀模型
//    (`packages/adapters/src/supabase/mappers/order-procurement.ts:16-20` 逐字
//    「本片不投影逐批到貨明細」)⇒ 畫面上沒有
//    receipt id 可拿,唯一來源是表單手上那把**已消費**的冪等鍵(由 action 反查冪等帳換 id)。
//    ⇒ Sean 那句「原本以為這個商品要給這個訂單,其實要先給另外一個訂單」= **事後**才發現,
//    本元件**不覆蓋**;那要等逐筆到貨列表。**這個限制要讓員工看得到**,不能只寫在 commit body ——
//    否則他會以為「這裡有撤銷鈕」= 到貨隨時都撤得掉,等真的要撤三天前那筆時才發現沒有入口。
//
// 🔴 **只在彈窗模式出現**:列表模式成功走 redirect、整個表單重新掛載,那把鍵就消失了
//    (`receipt-record-form.tsx:123` 逐字記過這件事)⇒ 那條路沒有撤銷入口。

export function ReceiptUndoBar({
  consumedKey,
  orderId,
  orderItemId,
  returnTo,
}: {
  /** 剛剛那次登錄用掉的冪等鍵。`null` = 這個表單還沒成功過 ⇒ 不畫。 */
  consumedKey: string;
  orderId: string;
  orderItemId: string;
  returnTo: string;
}) {
  const [state, formAction, pending] = useActionState<ReceiptUndoState, FormData>(
    undoItemReceiptAction,
    { status: 'idle' },
  );

  return (
    <div className='mt-2 rounded-md border border-dashed p-2.5 text-xs'>
      {/* 🔴 錯誤訊息畫在重試鈕**上面**:畫在下面的話,員工按完看到鈕還在、訊息在視線外,
          最順手的反應是再按一次(而 `error` 那條的正解是先去確認狀態、不是連按)。 */}
      {state.status === 'failed' && (
        <p role='alert' className='text-destructive mb-2'>
          {state.message}
        </p>
      )}

      {/* 🔴 **`failed` 與 `blocked` 都要留著表單**(R1 must-fix 3 + R2 must-fix 2):
          ①`error` 的文案叫他「確認之後再決定要不要重按」
          ②`blocked` 的 DB 原文逐字叫他「要先把那些包裹作廢…**才能刪掉**這筆到貨紀錄」
          —— 兩句都承諾了「處理完再回來按」。表單只在 `idle` 渲染的話那顆鈕就永遠消失:
          `blocked` 是**永久終態**(state 不會再變、`undoKey` 只在下一次登錄成功才換、
          重整會讓整條撤銷列消失)⇒ 員工照著文案去作廢包裹,回來卻沒有入口。
          🔴 `already_gone` **刻意不給表單**:終態、重按不可能改變結果、文案也沒承諾任何動作。 */}
      {(state.status === 'idle' || state.status === 'failed' || state.status === 'blocked') && (
        <form action={formAction} className='flex flex-wrap items-center gap-2'>
          <input type='hidden' name={RCPT_ORDER_ID_FIELD} value={orderId} />
          <input type='hidden' name={RCPT_ORDER_ITEM_ID_FIELD} value={orderItemId} />
          <input type='hidden' name={RCPT_REQUEST_ID_FIELD} value={consumedKey} />
          <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />
          <span className='text-muted-foreground'>剛剛登錄的那一筆記錯了?</span>
          <button
            type='submit'
            disabled={pending}
            className='rounded border px-2 py-1 disabled:opacity-50'
          >
            {pending ? '撤銷中…' : '撤銷剛剛那筆'}
          </button>
          {/* 🔴 界線要寫在畫面上,不能只寫在 commit body(見檔頭)。 */}
          <span className='text-muted-foreground w-full'>
            只能撤掉剛剛這一筆。更早的到貨紀錄目前還沒有撤銷入口。
          </span>
        </form>
      )}

      {state.status === 'undone' && <p role='status'>已撤銷剛剛那筆到貨。</p>}

      {/* 🔴 `already_gone` 不講成功也不講失敗:它可能是連點的第二下(第一下已經撤掉了),
          也可能是別人先撤掉了。講「撤銷成功」會讓員工以為是自己這一下生效的。 */}
      {state.status === 'already_gone' && (
        <p role='status'>那筆到貨紀錄已經不在了(可能剛剛已經撤過,或別人先撤掉了)。</p>
      )}

      {/* 🔴🔴 **DB 原文照畫,不改寫**(`receipt-repository.ts` 檔頭交辦):訊息裡逐箱列出未出貨的
          包裹編號與件數、還講了出路 ⇒ 壓成一句「刪不掉」等於把員工唯一能照做的資訊丟掉。
          `whitespace-pre-line` 是承重的:那段訊息是多行的,不保留換行會擠成一團。 */}
      {state.status === 'blocked' && (
        <p role='alert' className='text-destructive whitespace-pre-line'>
          {state.message}
        </p>
      )}

    </div>
  );
}
