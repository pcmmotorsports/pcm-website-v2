// select-filter.tsx — 後台列表通用「帶標籤的下拉篩選」(訂單 / 客戶等 filter bar 共用)。
// server-render、native <select>(form GET);置頂「全部」= 不篩選(空 value)。

import type { FilterOption } from '../../lib/shared/list-params';

export function SelectFilter({
  name,
  label,
  value,
  options,
  allLabel = '全部',
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: FilterOption[];
  allLabel?: string;
}) {
  return (
    <label className='flex flex-col gap-1 text-sm'>
      <span className='text-muted-foreground text-xs font-medium'>{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
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
