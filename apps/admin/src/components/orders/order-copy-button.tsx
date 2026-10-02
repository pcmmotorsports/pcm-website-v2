'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './order-copy-button.css';

/**
 * 只接待複製的文字，不接整包訂單、金額或會員等級。
 * `glyph`：按鈕只印這一個字（例如「複」），完整說明放在滑過提示與報讀（Sean 2026-10-02 列表變窄）。
 */
export function OrderCopyButton({ value, label, text = false, glyph, className = '' }: {
  value: string;
  label: string;
  text?: boolean;
  glyph?: string;
  className?: string;
}) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  useEffect(() => () => {
    generation.current += 1;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    // 拖曳選字後的 click 不能覆蓋使用者正在選取的內容。
    if (window.getSelection()?.toString()) return;
    const attempt = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setMessage('');
    let result: string;
    try {
      await navigator.clipboard.writeText(value);
      result = '已複製';
    } catch {
      result = '複製失敗，請選取文字後手動複製';
    }
    if (attempt !== generation.current) return;
    setMessage(result);
    timer.current = setTimeout(() => setMessage(''), 2400);
  };

  return (
    <>
      <button
        type='button'
        className={`order-copy ${text ? 'order-copy-text' : glyph ? 'order-copy-glyph' : 'order-copy-action'} ${className}`}
        data-order-copy={text ? 'text' : 'group'}
        data-copied={glyph && message === '已複製' ? '' : undefined}
        aria-label={label}
        title={glyph ? label : undefined}
        disabled={!value}
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail > 1) return;
          void copy();
        }}
      >
        {text ? value || '未填' : glyph ?? label}
      </button>
      {message ? createPortal(<div className='order-copy-feedback' role='status'>{message}</div>, document.body) : null}
    </>
  );
}
