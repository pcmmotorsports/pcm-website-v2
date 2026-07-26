'use client';

import { useFormStatus } from 'react-dom';
import { WALLET_DIRECTION_FIELD } from '../../lib/customers/wallet-form';

// 儲值金調整 submit 鈕(client island;codex 關卡2 F1 縮減=D1 選項 B 前端縱深):
// action pending 期間兩鈕 disable → 防雙擊重複入帳。僅縱深、非 DB 級去重
// (DB UNIQUE 去重=schema 改動、D1 決策題待 Sean;back-resubmit 由 PRG redirect 吸收)。
// 🔴 本檔零資料存取:只碰 useFormStatus + 欄名常數,無任何 service key/價格面。
//
// 🔴 **兩顆的 DOM 順序是承重的、不是排版偏好**(backlog #296、Sean 2026-07-26 拍 A):
// HTML 隱式提交規則=在單行文字欄按 Enter,瀏覽器選 form 內**第一顆 submit** 當 submitter。
// 「加值」必須排第一 ⇒ 員工在金額欄打完數字直接按 Enter 落在**安全方向**(加值),
// 而不是把錢扣掉(`wallet-form.ts:74` direction==='use' 會寫成負數入帳)。
// 改這裡的順序前先讀 #296;守門斷言在 shared/admin-form-consumers.test.tsx。
// 真正危險的迴歸是**有人把加值移走或改排序**,讓扣款變成第一顆 —— 這正是守門測試鎖的。
// (單純 disable 加值不危險:第一顆 submit 被 disable 時,規範與 Blink 都是**整個放棄
//  隱式提交、不往後找下一顆**,Enter 會什麼都不做。實證=Blink `HTMLFormElement::
//  SubmitImplicitly` 的 `// Default (submit) button is not activated; no implicit
//  submission.` 分支〔親讀 chromium/main 原始碼〕。)

export function WalletAdjustSubmitButtons() {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type='submit'
        name={WALLET_DIRECTION_FIELD}
        value='deposit'
        disabled={pending}
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
      >
        {pending ? '處理中…' : '加值'}
      </button>
      <button
        type='submit'
        name={WALLET_DIRECTION_FIELD}
        value='use'
        disabled={pending}
        className='border-destructive/40 text-destructive h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50'
      >
        扣款
      </button>
    </>
  );
}
