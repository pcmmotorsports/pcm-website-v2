'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './order-copy-button.css';

/** 只接待複製的文字，不接整包訂單、金額或會員等級。 */
export function OrderCopyButton({ value, label, text = false, className = '' }: {
  value: string;
  label: string;
  text?: boolean;
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
        className={`order-copy ${text ? 'order-copy-text' : 'order-copy-action'} ${className}`}
        data-order-copy={text ? 'text' : 'group'}
        aria-label={label}
        disabled={!value}
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail > 1) return;
          void copy();
        }}
      >
        {text ? value || '未填' : label}
      </button>
      {message ? createPortal(<div className='order-copy-feedback' role='status'>{message}</div>, document.body) : null}
    </>
  );
}
