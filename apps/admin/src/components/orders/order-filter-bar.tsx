import type { AdminOrderFilter, OrderStatusOption } from '@pcm/domain';
import { OrderFilterControls } from './order-filter-controls';
import {
  PAYMENT_STATUS_OPTIONS,
  FULFILLMENT_STATUS_OPTIONS,
  ORDER_SOURCE_OPTIONS,
  PAYMENT_CHANNEL_OPTIONS,
  workflowStatusFilterOptions,
  workflowStatusSelectedValues,
} from '../../lib/orders/order-list-view';

// M-4a 訂單篩選列(D-1b:選了即時生效免按鈕;Sean Q1=A)。
// 主篩選 = 商品狀態(item 層 workflow_status;多勾選+已勾數 badge)+ 來源/管道同款多勾選;
// 付款/出貨軸維持單選(拍板字面)、同步即時生效。互動核心=OrderFilterControls(單一 client
// state 導出 URL、router.replace → server 重讀 searchParams 重查、page 天然回 1);
// 「篩選」按鈕移除、「清除」保留(整頁載入=controls 重掛歸零)。

export function OrderFilterBar({
  filter,
  statusOptions,
  orderNumberSearchEnabled = false,
}: {
  filter: AdminOrderFilter;
  statusOptions: OrderStatusOption[];
  /** M-4b E10 A10c1 單號搜尋開關(§7.1 逐批啟用閘;D0 apply 前一律 false)。 */
  orderNumberSearchEnabled?: boolean;
}) {
  return (
    <div className='bg-card text-card-foreground flex flex-wrap items-end gap-3 rounded-lg border p-4'>
      <OrderFilterControls
        workflowOptions={workflowStatusFilterOptions(statusOptions, filter.workflowStatuses)}
        paymentOptions={PAYMENT_STATUS_OPTIONS}
        fulfillmentOptions={FULFILLMENT_STATUS_OPTIONS}
        sourceOptions={ORDER_SOURCE_OPTIONS}
        channelOptions={PAYMENT_CHANNEL_OPTIONS}
        orderNumberSearchEnabled={orderNumberSearchEnabled}
        initial={{
          wf: workflowStatusSelectedValues(filter.workflowStatuses),
          pay: filter.paymentStatus ?? '',
          ful: filter.fulfillmentStatus ?? '',
          src: filter.orderSources ?? [],
          ch: filter.paymentChannels ?? [],
          no: filter.orderNumber ?? '',
        }}
      />
      <a
        href='/orders'
        className='border-input text-muted-foreground hover:text-foreground flex h-9 items-center rounded-md border px-4 text-sm'
      >
        清除
      </a>
    </div>
  );
}
