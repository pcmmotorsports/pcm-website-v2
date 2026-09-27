'use client';

// 快速編輯側邊欄:按 Esc 關閉(同「關閉」那一顆, 只拿掉 ?edit=, 不捲動)。
// 焦點在輸入框、文字區、下拉選單時不關:員工可能正在打字, 關掉會丟掉沒存的字。

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function QuickEditEscape({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      router.push(closeHref, { scroll: false });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router, closeHref]);
  return null;
}
