'use client';

import type { FilterOption } from '../../lib/shared/list-params';

// auto-apply-select.tsx — 單選下拉、選了即時生效(M-4a D-1b;Sean「免按篩選鈕」)。
// 付款/出貨軸維持單選(拍板字面只升級商品狀態+來源/管道為多勾選)、但同步免按鈕。
// presentational:值與導航由父層 OrderFilterControls 單一 state 持有(MF-1:消 stale 快照
// 競態與延遲窗視覺回彈)。
// 🔴 經銷價紅線:props 只收 label/enum 選項/當前值,零敏感序列化。

export function AutoApplySelect({
  label,
  value,
  options,
  onChange,
  allLabel = '全部',
}: {
  label: string;
  /** '' = 全部(不篩) */
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  return (
    <label className='flex flex-col gap-1 text-sm'>
      <span className='text-muted-foreground text-xs font-medium'>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className='border-input bg-background h-9 min-w-36 rounded-md border px-3 text-sm'
      >
        <option value=''>{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
