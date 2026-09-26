'use client';

// copy-tracking-button.tsx — 訂單頁物流資訊的「複製單號」(09-27 Sean Q1 甲)。
// 新竹查詢頁不能用網址帶入單號 ⇒ 客人要自己貼上,這顆鈕省掉手抄。
// 🔴 剪貼簿不能用(非 https、瀏覽器擋)⇒ 明講「請手動選取單號」,不假裝成功。

import { useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

const LABEL: Record<CopyState, string> = {
  idle: '複製單號',
  copied: '已複製',
  failed: '請手動選取單號',
};

export function CopyTrackingButton({ value }: { value: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  // aria-label 帶單號:多箱時螢幕閱讀器才分得出是哪一顆(審查建議;畫面上的字不變)。
  return (
    <button
      type="button"
      className="btn-outline od-parcel-copy"
      onClick={copy}
      aria-label={`${LABEL[state]} ${value}`}
      aria-live="polite"
    >
      {LABEL[state]}
    </button>
  );
}
