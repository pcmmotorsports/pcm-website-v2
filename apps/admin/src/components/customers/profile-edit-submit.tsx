'use client';

import { useFormStatus } from 'react-dom';

// 基本資料編輯 submit 鈕(client island;鏡像 tier-edit-submit 的 pending disable 縱深):
// action pending 期間 disable → 防雙擊。back-resubmit 由 PRG redirect 吸收。
// 🔴 本檔零資料存取:只碰 useFormStatus,無任何 service key / 客人 PII。

export function ProfileEditSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type='submit'
      disabled={pending}
      className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
    >
      {pending ? '處理中…' : '儲存基本資料'}
    </button>
  );
}
