'use client';

import { useState } from 'react';
import type { FilterOption } from '../../lib/shared/list-params';

// multi-check-filter.tsx — 下拉內 checkbox 多勾選(M-4a D-1b;Sean Q1=A:多勾選+已勾數
// badge+選了即時生效免按鈕)。presentational:勾選值與導航由父層 OrderFilterControls 單一
// state 持有(MF-1:消 stale 快照競態),本元件只管面板開合與渲染。
// 🔴 經銷價紅線:props 只收 label/選項(enum 或 order_status_options 策展資料)/已勾值,零敏感序列化。

export function MultiCheckFilter({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: FilterOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className='relative flex flex-col gap-1 text-sm'>
      <span className='text-muted-foreground text-xs font-medium'>{label}</span>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup='true'
        className='border-input bg-background flex h-9 min-w-36 items-center justify-between gap-2 rounded-md border px-3 text-sm'
      >
        <span className={selected.length === 0 ? 'text-muted-foreground' : undefined}>
          {selected.length === 0 ? '全部' : '已選'}
        </span>
        <span className='flex items-center gap-1'>
          {selected.length > 0 && (
            <span className='bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium'>
              {selected.length}
            </span>
          )}
          <span aria-hidden className='text-muted-foreground text-xs'>
            ▾
          </span>
        </span>
      </button>
      {open && (
        <>
          {/* 透明遮罩:點面板外=關(無全域 listener、無 effect) */}
          <div className='fixed inset-0 z-10' onClick={() => setOpen(false)} />
          <div className='bg-background absolute top-full z-20 mt-1 max-h-64 w-56 overflow-auto rounded-md border p-1 shadow-md'>
            {options.map((o) => (
              <label
                key={o.value}
                className='hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm'
              >
                <input
                  type='checkbox'
                  checked={selected.includes(o.value)}
                  onChange={() => onToggle(o.value)}
                  className='accent-primary h-4 w-4'
                />
                {o.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
