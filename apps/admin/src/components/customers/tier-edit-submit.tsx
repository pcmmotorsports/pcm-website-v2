'use client';

import { useFormStatus } from 'react-dom';

// tier 變更 submit 鈕(client island;鏡像 wallet-adjust-submit 的 pending disable 縱深):
// action pending 期間 disable → 防雙擊;同值重送已由 RPC NO_CHANGE 冪等吸收(零寫入),
// 此處純 UX 縱深。back-resubmit 由 PRG redirect 吸收。
// 🔴 本檔零資料存取:只碰 useFormStatus,無任何 service key/價格面。

export function TierEditSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type='submit'
      disabled={pending}
      className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
    >
      {pending ? '處理中…' : '變更等級'}
    </button>
  );
}
