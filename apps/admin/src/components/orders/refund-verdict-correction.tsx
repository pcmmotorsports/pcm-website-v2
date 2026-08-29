'use client';

import { useActionState } from 'react';
import { correctVerdictAction } from '../../lib/payment/refund-correction-actions';
import {
  type CorrectionActionState,
  CORRECTION_EXPECTED_ID_FIELD,
  CORRECTION_REASON_FIELD,
  CORRECTION_REFUND_ID_FIELD,
  CORRECTION_REQUEST_TOKEN_FIELD,
  CORRECTION_VERDICT_FIELD,
} from '../../lib/payment/refund-correction-state';
import type { EffectiveVerdict } from '../../lib/payment/refund-correction-read';
import { MESSAGES } from './result-banner';

// refund-verdict-correction.tsx — `#890` 片3:卡住那一列的「更正判定」入口。
//
// 🔴🔴 **為什麼是新元件,而不是照 plan §1c #6 改 `refund-exception-resolve.tsx`**
//    (2026-08-29 施工時發現,plan v4 那一列與 A2 的折法**互相矛盾**):
//    `page.tsx:144` 逐字 `stuck ? <p>聯絡工程師</p> : <RefundExceptionResolve/>`
//    ⇒ **那支元件只在【不是 stuck】的時候渲染**,而我們要下手的正是 stuck 那一族
//    ⇒ 📌 **照 §1c #6 的字面做,那顆鈕會被加在一個【目標列永遠不會走到】的分支裡**
//      —— 而那正是 A2(原 R3-3)抓到的那個 bug 本身。
//    ⇒ 所以入口是**新元件 + 動 `page.tsx` 的那個三元**,而 §1c #6 那一列**已作廢**。
//
// 🔴 **表單是原生的、值不由 client state 產生**(抄 `manual-order-lines.tsx` 檔頭的不變式(i)):
//    這裡沒有 `value=`、沒有 `onChange` —— 送出去的就是員工在畫面上打的那個。
//
// ⚠️ **`corrected_to` 沒有預設選中**:預設一個值 = 幫他做了判斷,
//    而這張表單存在的理由就是「當初那個判斷可能錯了」。

export function RefundVerdictCorrection({
  refundId,
  serverToken,
  effective,
}: {
  refundId: string;
  /** server component 渲染期產,每列一把(冪等鍵;`refund-action-state.ts:41-43` 紀律)。 */
  serverToken: string;
  /**
   * 這一列**現行有效**的更正;`null` = 還沒有人更正過。
   * 🔴 而「還沒更正過」與「讀不到」是兩件事 —— 讀不到的列**根本不會渲染本元件**
   *    (那一格在 `page.tsx` fail-closed,見那裡的註解)。
   */
  effective: EffectiveVerdict | null;
}) {
  const [state, action, pending] = useActionState<CorrectionActionState, FormData>(
    correctVerdictAction,
    { ok: true },
  );

  return (
    <div className='space-y-2 rounded-md border p-3'>
      <p className='text-muted-foreground text-sm'>
        這一列當初被人工判定為「沒有動到錢」並結案。
        {effective === null ? (
          <> 目前<span className='font-medium'>沒有被更正過</span>。</>
        ) : (
          <>
            {' '}
            而它<span className='font-medium'>已經被更正過</span> —— 現行判定是
            <span className='font-medium'>
              {effective.correctedTo === 'money_moved' ? '「錢有動」' : '「錢沒有動」'}
            </span>
            (第 {effective.seq} 次更正,{effective.actor} 於 {effective.createdAt};理由:
            {effective.reason})。
          </>
        )}
      </p>

      <form action={action} className='space-y-2'>
        <input type='hidden' name={CORRECTION_REFUND_ID_FIELD} value={refundId} readOnly />
        <input type='hidden' name={CORRECTION_REQUEST_TOKEN_FIELD} value={serverToken} readOnly />
        {/* 🔴 CAS 鏈頭。**沒有更正過時這一欄整個不渲染** —— 送一個空字串會被解析器拒
            (見 `refund-correction-form.ts`:空字串是壞掉的表單,不是「尚未更正過」)。 */}
        {effective !== null && (
          <input
            type='hidden'
            name={CORRECTION_EXPECTED_ID_FIELD}
            value={effective.correctionId}
            readOnly
          />
        )}

        <fieldset className='space-y-1'>
          <legend className='text-sm font-medium'>更正成</legend>
          {/* 刻意兩顆都不預選 —— 見檔頭。 */}
          <label className='mr-4 text-sm'>
            <input type='radio' name={CORRECTION_VERDICT_FIELD} value='money_moved' /> 錢有動
          </label>
          <label className='text-sm'>
            <input type='radio' name={CORRECTION_VERDICT_FIELD} value='no_money_moved' /> 錢沒有動
          </label>
        </fieldset>

        <label className='block text-sm'>
          <span className='mb-1 block font-medium'>為什麼要改(必填,會寫進稽核)</span>
          <textarea
            name={CORRECTION_REASON_FIELD}
            rows={2}
            maxLength={500}
            className='block w-full rounded-md border px-2 py-1'
            placeholder='例:對過 TapPay 後台，這筆錢其實沒有動'
          />
        </label>

        <button
          type='submit'
          disabled={pending}
          className='rounded-md border px-3 py-1 text-sm disabled:opacity-50'
        >
          {pending ? '送出中…' : '更正這一筆的判定'}
        </button>

        {/* 🔴 **失敗在這裡說話,成功走 PRG**(與這條線既有的做法一致)。
            ⛔ ~~我第一版寫「詳細原因見上方提示」~~ **當場作廢**:失敗**不會** redirect
               ⇒ 沒有 `?r=` ⇒ 那一頁的 ResultBanner **什麼都不顯示**
               ⇒ 而畫面會叫員工去看一個不存在的東西。
            ✅ 文案**逐字沿用 `MESSAGES`,不在這裡另寫一份**(同取消線與改金額線的做法)
               ⇒ 同一個碼在 banner 與這裡說同一句話。 */}
        {!state.ok && (
          <p role='alert' className='text-destructive text-sm'>
            {MESSAGES[state.code]?.text ?? '沒有改到,而系統沒有給出原因。請聯絡工程師處理。'}
          </p>
        )}
      </form>
    </div>
  );
}
