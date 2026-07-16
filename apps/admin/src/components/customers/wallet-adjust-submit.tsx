'use client';

import { useFormStatus } from 'react-dom';
import { WALLET_DIRECTION_FIELD } from '../../lib/customers/wallet-form';

// 儲值金調整 submit 鈕(client island;codex 關卡2 F1 縮減=D1 選項 B 前端縱深):
// action pending 期間兩鈕 disable → 防雙擊重複入帳。僅縱深、非 DB 級去重
// (DB UNIQUE 去重=schema 改動、D1 決策題待 Sean;back-resubmit 由 PRG redirect 吸收)。
// 🔴 本檔零資料存取:只碰 useFormStatus + 欄名常數,無任何 service key/價格面。

export function WalletAdjustSubmitButtons() {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type='submit'
        name={WALLET_DIRECTION_FIELD}
        value='use'
        disabled={pending}
        className='border-destructive/40 text-destructive h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50'
      >
        扣款
      </button>
      <button
        type='submit'
        name={WALLET_DIRECTION_FIELD}
        value='deposit'
        disabled={pending}
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
      >
        {pending ? '處理中…' : '加值'}
      </button>
    </>
  );
}
