'use client';

import { useState } from 'react';
import type { WorkflowSelectOptionView } from '../../lib/orders/workflow-select-options';
import { BADGE_TEXT_COLOR } from './workflow-status-badge';

// workflow-status-select.tsx — 帶色狀態下拉(M-4a D-2 後續;Sean 07-15 開站回饋拍板「單格」)。
// 閉合態依「當前選中值」上色(bg=option.color、字色走 BADGE_TEXT_COLOR 同 badge)、改選即變色、
// 存前不寫入(仍靠外層 <form action={serverAction}> 的「存」鈕提交)。
// 🔴 經銷價紅線:本元件只收 code/label/色值(order_status_options 策展資料、本已 server-render 進 DOM)、
// 零價格/tier/PII 序列化 → 不觸犯「敏感值不進 client bundle」。

export function WorkflowStatusSelect({
  name,
  defaultValue,
  options,
  ariaLabel,
}: {
  name: string;
  defaultValue: string;
  options: WorkflowSelectOptionView[];
  ariaLabel: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const current = options.find((o) => o.value === value);
  const colored = current?.color
    ? {
        backgroundColor: current.color,
        color: BADGE_TEXT_COLOR[current.textColor ?? 'dark'],
        borderColor: 'transparent',
      }
    : undefined;

  return (
    <select
      name={name}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      aria-label={ariaLabel}
      className='border-input bg-background h-8 rounded-md border px-2 text-xs font-medium'
      style={colored}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
