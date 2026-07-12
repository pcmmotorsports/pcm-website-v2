import type { AdminOrderFilter } from '@pcm/domain';
import {
  type FilterOption,
  PAYMENT_STATUS_OPTIONS,
  FULFILLMENT_STATUS_OPTIONS,
  ORDER_SOURCE_OPTIONS,
  PAYMENT_CHANNEL_OPTIONS,
  PAYMENT_STATUS_PARAM,
  FULFILLMENT_STATUS_PARAM,
  ORDER_SOURCE_PARAM,
  PAYMENT_CHANNEL_PARAM,
} from '../../lib/orders/order-list-view';

// M-4a 訂單線第一片:雙軸 + 次要下拉篩選(server-render、native form GET;無 client JS)。
// 主雙軸 = 付款狀態 × 出貨狀態(營運最常查「已付未出」);次要 = 來源 / 管道。
// 送出 → 瀏覽器組 query string 導回 /orders → server 重讀 searchParams 重查(page 天然回 1)。

type SelectFilterProps = {
  name: string;
  label: string;
  value: string | undefined;
  options: FilterOption[];
};

function SelectFilter({ name, label, value, options }: SelectFilterProps) {
  return (
    <label className='flex flex-col gap-1 text-sm'>
      <span className='text-muted-foreground text-xs font-medium'>{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className='border-input bg-background h-9 min-w-36 rounded-md border px-3 text-sm'
      >
        <option value=''>全部</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function OrderFilterBar({ filter }: { filter: AdminOrderFilter }) {
  return (
    <form
      method='get'
      action='/orders'
      className='flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 text-card-foreground'
    >
      <SelectFilter
        name={PAYMENT_STATUS_PARAM}
        label='付款狀態'
        value={filter.paymentStatus}
        options={PAYMENT_STATUS_OPTIONS}
      />
      <SelectFilter
        name={FULFILLMENT_STATUS_PARAM}
        label='出貨狀態'
        value={filter.fulfillmentStatus}
        options={FULFILLMENT_STATUS_OPTIONS}
      />
      <SelectFilter
        name={ORDER_SOURCE_PARAM}
        label='來源'
        value={filter.orderSource}
        options={ORDER_SOURCE_OPTIONS}
      />
      <SelectFilter
        name={PAYMENT_CHANNEL_PARAM}
        label='管道'
        value={filter.paymentChannel}
        options={PAYMENT_CHANNEL_OPTIONS}
      />
      <div className='flex items-center gap-2'>
        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
        >
          篩選
        </button>
        <a
          href='/orders'
          className='border-input text-muted-foreground hover:text-foreground flex h-9 items-center rounded-md border px-4 text-sm'
        >
          清除
        </a>
      </div>
    </form>
  );
}
