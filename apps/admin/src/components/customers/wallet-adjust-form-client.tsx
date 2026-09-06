'use client';

import { useActionState } from 'react';
import { adjustWalletAction } from '../../lib/customers/wallet-actions';
import type { WalletAdjustActionState } from '../../lib/customers/wallet-action-state';
import {
  WALLET_CUSTOMER_ID_FIELD,
  WALLET_AMOUNT_FIELD,
  WALLET_NOTE_FIELD,
  WALLET_RETURN_TO_FIELD,
  WALLET_REQUEST_TOKEN_FIELD,
  WALLET_NOTE_MAX,
} from '../../lib/customers/wallet-form';
import { ADMIN_INPUT_CLASS, AdminForm, AdminFormField } from '../shared/admin-form';
import { WalletAdjustSubmitButtons } from './wallet-adjust-submit';

// ⟦b4-WALLETDEDUPE⟧ 2026-09-06:儲值金調整表單的 client 半邊。
//
// ══ 🔴 為什麼是「失敗回 state」而不是「失敗 redirect」════════════════════════
// A6 `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §9 `Q1=A`(Sean 2026-08-02 拍板)逐字:
//   「失敗 state **必須原樣帶回 `requestToken`** … 失敗路也 `revalidatePath` ⇒ server component
//     重渲染 ⇒ hidden input 拿到**新 token** ⇒ 員工重按 = 新 token = 認不出是重送」
//   「失敗 state 必須帶回員工輸入的 body … 且**不得**把 body 塞進 URL」
// ⇒ 本片沿用同一個拍板(主視窗 `-f1` 2026-09-06 `Q-wallet4=甲`)。
//
// 🛑 **token 由 server 產、這裡只回送**(A6 §9 `Q2=C`)——
//    `serverToken` 是上層 server component 傳下來的。**這一支不得自己 `crypto.randomUUID()`**:
//    那會變成「瀏覽器自造」, 正是 Q2=C 拒絕的那個形狀。

export function WalletAdjustFormClient({
  customerId,
  serverToken,
}: {
  customerId: string;
  /** 🔴 server component 渲染時產的一次性 token(不是瀏覽器造的)。 */
  serverToken: string;
}) {
  const [state, formAction] = useActionState<WalletAdjustActionState, FormData>(
    adjustWalletAction,
    { status: 'idle' },
  );
  const failed = state.status === 'failed' ? state : null;

  // 🔴🔴 **這一行是整片的承重**:失敗之後**沿用原本那把 token**, 不是拿重渲染後的新 token。
  //    少了它 ⇒ 員工重按 = 新 token = 系統認不出是重送 = **再扣一次**。
  // 🔵 `|| serverToken` 是為了 `denied` / `invalid` 那兩條路 —— 它們帶回的是空字串
  //    (那時還沒有可信的 token, 回填一個假的比不回填危險)。
  const requestToken = failed?.requestToken || serverToken;

  return (
    <>
      {failed ? (
        <p
          role='status'
          className='border-destructive/30 bg-destructive/5 text-destructive mb-3 rounded-md border px-3 py-2 text-sm'
        >
          {failed.message}
          {/* 🔵 把「剛才那一筆是什麼」寫出來 —— 員工要用【同一個方向】重送才會被認成同一筆;
              方向是由下面兩顆 submit 決定的, 而他隔了一下子未必記得剛才按的是哪一顆。 */}
          {failed.amount ? (
            <span className='mt-1 block text-xs opacity-80'>
              剛才送出的是:{failed.direction === 'use' ? '扣款' : '加值'} NT$ {failed.amount}
              {failed.code === 'error' ? '(要再送一次,請按同一顆按鈕)' : null}
            </span>
          ) : null}
        </p>
      ) : null}

      <AdminForm
        action={formAction}
        variant='section'
        hidden={{
          [WALLET_CUSTOMER_ID_FIELD]: customerId,
          [WALLET_RETURN_TO_FIELD]: `/customers/${customerId}`,
          [WALLET_REQUEST_TOKEN_FIELD]: requestToken,
        }}
        footerHint='扣款可扣成負餘額(內部彈性)。'
        actions={<WalletAdjustSubmitButtons />}
      >
        <AdminFormField label='金額(元、正整數)'>
          <input
            type='text'
            inputMode='numeric'
            name={WALLET_AMOUNT_FIELD}
            maxLength={8}
            required
            defaultValue={failed?.amount}
            placeholder='例:500'
            className={ADMIN_INPUT_CLASS}
          />
        </AdminFormField>

        <AdminFormField label='備註(必填)'>
          <input
            type='text'
            name={WALLET_NOTE_FIELD}
            maxLength={WALLET_NOTE_MAX}
            required
            defaultValue={failed?.note}
            placeholder='例:門市儲值 / 電話訂單折抵'
            className={ADMIN_INPUT_CLASS}
          />
        </AdminFormField>
      </AdminForm>
    </>
  );
}
