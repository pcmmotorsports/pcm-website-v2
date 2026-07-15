import type { AdminOrderFilter, OrderStatusOption } from '@pcm/domain';
import { SelectFilter } from '../shared/select-filter';
import {
  PAYMENT_STATUS_OPTIONS,
  FULFILLMENT_STATUS_OPTIONS,
  ORDER_SOURCE_OPTIONS,
  PAYMENT_CHANNEL_OPTIONS,
  PAYMENT_STATUS_PARAM,
  FULFILLMENT_STATUS_PARAM,
  ORDER_SOURCE_PARAM,
  PAYMENT_CHANNEL_PARAM,
  WORKFLOW_STATUS_PARAM,
  workflowStatusFilterOptions,
  workflowStatusSelectValue,
} from '../../lib/orders/order-list-view';

// M-4a 訂單篩選列(server-render、native form GET;無 client JS)。
// Slice A:主篩選 = 訂單狀態(workflow_status;Sean 的合併彩色狀態、動態選項來自 order_status_options
// + 「未設定」哨兵);次要 = 舊雙軸(付款/出貨,granular 查「已付未出」)+ 來源/管道。
// 送出 → 瀏覽器組 query string 導回 /orders → server 重讀 searchParams 重查(page 天然回 1)。

export function OrderFilterBar({
  filter,
  statusOptions,
}: {
  filter: AdminOrderFilter;
  statusOptions: OrderStatusOption[];
}) {
  return (
    <form
      method='get'
      action='/orders'
      className='flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 text-card-foreground'
    >
      <SelectFilter
        name={WORKFLOW_STATUS_PARAM}
        label='商品狀態'
        value={workflowStatusSelectValue(filter.workflowStatus)}
        options={workflowStatusFilterOptions(statusOptions, filter.workflowStatus)}
      />
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
