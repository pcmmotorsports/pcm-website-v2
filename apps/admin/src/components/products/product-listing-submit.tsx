'use client';

import { useFormStatus } from 'react-dom';

// M-4b `#20` 上下架 submit 鈕(client island;鏡像 `customers/tier-edit-submit.tsx`)。
// action pending 期間 disable → 防雙擊;同值重送已由 RPC `NO_CHANGE` 冪等吸收(零寫入),
// 此處純 UX 縱深。back-resubmit 由 PRG redirect 吸收。
// 🔴 本檔零資料存取:只碰 `useFormStatus`,無任何 service key / 價格面。
//
// 🔴 **鈕上的字就是它要做的事,不是現在的狀態** —— 「上架中」是狀態(那在基本資料那格已經有了),
//    而按鈕要回答的是「我按下去會發生什麼」。誤按的代價是一件商品從店裡消失 ⇒ 這句要精確。

export function ListingToggleSubmitButton({ listed }: { listed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type='submit'
      disabled={pending}
      className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
    >
      {pending ? '處理中…' : listed ? '下架這件商品' : '重新上架'}
    </button>
  );
}
