'use server';

import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import {
  BATCH_KIND_FIELD,
  BATCH_KINDS,
  BATCH_ROWS_MAX,
  splitBatchRows,
  type BatchActionState,
  type BatchKind,
  type BatchRowOutcome,
} from './next-step-batch';
import { PROC_INLINE_FIELD } from './procurement-action-state';
import { upsertItemProcurementAction } from './procurement-actions';
import { RCPT_INLINE_FIELD } from './receipt-action-state';
import { recordItemReceiptAction } from './receipt-actions';

// next-step-batch-actions.ts — 「下一步」彈窗多列一次送(B9-b)。
//
// 🔴 **每一列走既有的單列 action**(inline 模式:成功回 state 不 redirect)⇒ 授權閘 / hydration 閘 / 歸屬閘 /
//    解析 / RPC / 稽核 / revalidate 全部是那兩支的,本檔零寫入邏輯。零新 RPC。
// 🔴 **逐列、不整批回滾**:第 3 列失敗時第 1、2 列已經寫進去了(RPC 各自一交易)。回給畫面的是每一列的結局,
//    成功的列畫面變唯讀打勾、失敗的留著印原因;員工只重送失敗的(成功的列不會再送:畫面不再渲染它的欄位)。
// 🔴 冪等:到貨每列自帶一把 request_id(表單 hidden,同單列);下訂是 upsert,重送是「改」不是「重複下訂」。
// 🔴 `denied`(session 失效 / Origin 不對):**不一定在第一列**(session 逐列驗當下時間,A 寫進去之後 B 才過期是真的會發生的)
//    ⇒ 停下不跑後面的列,但**前面成功的列要留著**(它們已經寫進去了,說「整批沒送」是假的);被拒那列印原因,
//    後面沒跑的列印「沒有送出」(codex 2026-09-14 R1 must-fix ②)。

const PROC_OK_TEXT = { CREATED: '已下訂(新增採購)', UPDATED: '已更新這筆採購', NO_CHANGE: '沒有變更(內容與原本相同)' } as const;
const RCPT_OK_TEXT = { recorded: '已登記到貨', duplicate: '這筆先前已經登錄過了(沒有重複記)' } as const;
const NOT_SENT = '沒有送出 —— 前面有一列被拒(可能登入過期)。重新登入之後再按一次「確認全部」,只會送還留著的列。';

export async function submitNextStepBatchAction(_prev: BatchActionState, formData: FormData): Promise<BatchActionState> {
  // ① 授權閘,絕對第一(每一列的單列 action 還會各自再驗一次;這一道是「每支 'use server' 檔自己要有守門」那把尺要的,
  //    `server-action-guard-sweep.test.ts`,不走白名單)。denied ⇒ 一列都沒跑,不對未授權者洩漏表單規則。
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return { status: 'rejected', message: '可能沒有權限,也可能登入過期了。整批都沒有送。先重新登入再試一次。' };
  }
  const kindRaw = readSingleString(formData, BATCH_KIND_FIELD);
  if (kindRaw === null || !(BATCH_KINDS as readonly string[]).includes(kindRaw)) {
    return { status: 'rejected', message: '表單內容不正確,整批都沒有送。關掉重新整理再試。' };
  }
  const kind = kindRaw as BatchKind;
  const rows = splitBatchRows(formData);
  if (rows.size === 0) return { status: 'rejected', message: '沒有可送的列。' };
  if (rows.size > BATCH_ROWS_MAX) {
    return { status: 'rejected', message: `一次最多 ${BATCH_ROWS_MAX} 列(這批有 ${rows.size} 列),整批都沒有送。少勾一些再試。` };
  }

  const outcomes: Record<string, BatchRowOutcome> = {};
  let okCount = 0;
  let failCount = 0;
  let halted = false;
  for (const [rowId, row] of rows) {
    let outcome: BatchRowOutcome;
    if (halted) {
      outcome = { ok: false, message: NOT_SENT };
    } else if (kind === 'receipt') {
      row.set(RCPT_INLINE_FIELD, '1');
      const st = await recordItemReceiptAction({ status: 'idle' }, row);
      if (st.status === 'failed' && st.code === 'denied') halted = true;
      outcome =
        st.status === 'recorded_inline'
          ? { ok: true, text: RCPT_OK_TEXT[st.outcome] }
          : { ok: false, message: st.status === 'failed' ? st.message : '沒有回應,狀態不明。重新整理確認。' };
    } else {
      row.set(PROC_INLINE_FIELD, '1');
      const st = await upsertItemProcurementAction({ status: 'idle' }, row);
      if (st.status === 'failed' && st.code === 'denied') halted = true;
      outcome =
        st.status === 'saved_inline'
          ? { ok: true, text: PROC_OK_TEXT[st.outcome] }
          : { ok: false, message: st.status === 'failed' ? st.message : '沒有回應,狀態不明。重新整理確認。' };
    }
    outcomes[rowId] = outcome;
    if (outcome.ok) okCount += 1;
    else failCount += 1;
  }
  return { status: 'done', rows: outcomes, okCount, failCount, halted };
}
