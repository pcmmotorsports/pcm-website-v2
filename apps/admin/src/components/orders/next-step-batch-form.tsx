'use client';

import { startTransition, useActionState, useRef, type ReactNode } from 'react';
import { BatchRowContext, PROC_SUBMITTED_AT_ORIGINAL_FIELD, type BatchCtx } from './next-step-batch-context';
import { submitNextStepBatchAction } from '../../lib/orders/next-step-batch-actions';
import { BATCH_KIND_FIELD, type BatchActionState, type BatchKind, type BatchRowOutcome } from '../../lib/orders/next-step-batch';
import { PROC_SUBMITTED_AT_FIELD, PROC_SUBMITTED_AT_LOCAL_FIELD } from '../../lib/orders/procurement-action-state';
import { composeSubmittedAt } from '../../lib/orders/procurement-submitted-at';

// next-step-batch-form.tsx — 「下一步」彈窗的**一張表單多列一次送**外殼(B9-b;Sean「一次做到完畢」)。
//
// 🔴 列本身仍是既有的 `ItemProcurementForm` / `ReceiptRecordForm`(batch 模式:不自帶 `<form>`、欄位名掛 `r.<id>.` 前綴、
//    沒有自己的送出鈕)—— 欄位 / hydrate / 冪等鍵 / 文案都是那兩支的,本檔只提供 `<form>`、一顆「確認全部」、
//    與每一列的結局(context)。
// 🔴 **不整批回滾**(RPC 各自一交易):畫面上寫明「每一列各自寫入」;成功的列變唯讀打勾、失敗的留著印原因,
//    再按一次只會送還留著的列(成功那列的欄位不再渲染 ⇒ 不會再送)。
// 🔴 下訂那條的「保秒」合成(`composeSubmittedAt`)原本在單列表單的 action wrapper 裡;批次模式那個 wrapper 不會跑,
//    ⇒ 這裡對每一列做同一件事(同一支函式),列自己多送一顆 `submitted_at_original` hidden 當基準。

function composeRows(formData: FormData): FormData {
  for (const key of [...formData.keys()]) {
    if (!key.endsWith(`.${PROC_SUBMITTED_AT_LOCAL_FIELD}`)) continue;
    const prefix = key.slice(0, -PROC_SUBMITTED_AT_LOCAL_FIELD.length);
    const locals = formData.getAll(key);
    const originals = formData.getAll(`${prefix}${PROC_SUBMITTED_AT_ORIGINAL_FIELD}`);
    formData.delete(`${prefix}${PROC_SUBMITTED_AT_ORIGINAL_FIELD}`);
    // 同單列 wrapper:讀不出恰一筆字串 ⇒ 不送 `submitted_at`(解析器走「這一欄沒送 ⇒ invalid」)。
    if (locals.length !== 1 || typeof locals[0] !== 'string') {
      formData.delete(`${prefix}${PROC_SUBMITTED_AT_FIELD}`);
      continue;
    }
    const original = originals.length === 1 && typeof originals[0] === 'string' && originals[0] !== '' ? originals[0] : null;
    formData.set(`${prefix}${PROC_SUBMITTED_AT_FIELD}`, composeSubmittedAt(locals[0], original));
  }
  return formData;
}

export function NextStepBatchForm({ kind, children }: { kind: BatchKind; children: ReactNode }) {
  const [state, formAction, pending] = useActionState<BatchActionState, FormData>(
    async (prev, formData) => submitNextStepBatchAction(prev, kind === 'order' ? composeRows(formData) : formData),
    { status: 'idle' },
  );
  // 🔴 成功的列**跨次累積**(codex 2026-09-14 R1 must-fix ①):第一次 A 成功 B 失敗,第二次只送 B ⇒ 回來的 rows 只有 B,
  //    若只看最新一發,A 的打勾會消失、欄位重新出現 ⇒ 第三次又把 A 送一次(下訂 = 用舊表單值覆蓋期間別人改的)。
  //    ⇒ 打過勾的列一律留著,之後任何一發(done / rejected)都不清。這只是畫面上的「不再送」,不是寫入授權。
  const okRows = useRef<Record<string, BatchRowOutcome>>({});
  if (state.status === 'done') {
    for (const [id, o] of Object.entries(state.rows)) if (o.ok) okRows.current[id] = o;
  }
  const ctx: BatchCtx = {
    kind,
    pending,
    outcomeOf: (rowId) => okRows.current[rowId] ?? (state.status === 'done' ? (state.rows[rowId] ?? null) : null),
  };
  return (
    <BatchRowContext.Provider value={ctx}>
      {/* 🔴 走 onSubmit + 手動 formAction,不掛 `action=`:掛 action 的表單在 action 跑完後 React 會**重設整張表單**
          (DOM 回到初始 attribute),受控的 checkbox 「全到」在「值沒變」的那次 render 不會被重寫 ⇒ 實測(admin-probe
          2026-09-14):到貨填 5、送出失敗後數字留 5 但「全到」變回勾著。手動呼叫 formAction 不觸發那個重設。
          瀏覽器的 required 驗證仍在(submit 事件在驗證通過後才發)。 */}
      <form
        data-testid='next-step-batch-form'
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
      >
        <input type='hidden' name={BATCH_KIND_FIELD} value={kind} />
        {children}
        <div className='mt-3 flex flex-wrap items-center justify-end gap-3 border-t pt-3'>
          <p className='text-muted-foreground mr-auto text-[12px] leading-[1.4]' data-testid='batch-note'>
            每一列各自寫入:有一列失敗,其他列不會退回。成功的列會打勾,失敗的留著印原因,再按一次只送還留著的列。
          </p>
          {state.status === 'rejected' && (
            <p role='alert' className='text-destructive w-full text-[13px] leading-[1.4]'>
              {state.message}
            </p>
          )}
          {state.status === 'done' && (
            <p className='text-[13px] leading-[1.4]' data-testid='batch-summary'>
              這一發成功 <b className='tabular-nums'>{state.okCount}</b> 列
              {state.failCount > 0 && (
                <>
                  ,失敗 <b className='text-destructive tabular-nums'>{state.failCount}</b> 列
                </>
              )}
              {state.halted && <span className='text-destructive'>;中途被拒(可能登入過期),後面的列沒送 —— 前面打勾的已經寫進去了</span>}
            </p>
          )}
          <button
            type='submit'
            disabled={pending}
            className='bg-primary text-primary-foreground inline-flex min-h-[30px] items-center rounded-lg px-3 text-[13px] leading-[1.4] font-semibold disabled:opacity-50'
          >
            {pending ? '送出中…' : '確認全部'}
          </button>
        </div>
      </form>
    </BatchRowContext.Provider>
  );
}
