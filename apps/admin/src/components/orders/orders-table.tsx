import type { AdminOrderSummary, OrderStatusOption } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderDate,
  formatOrderAmount,
  workflowStatusBadge,
  indexOrderStatusOptions,
} from '../../lib/orders/order-list-view';
import { WorkflowStatusBadge } from './workflow-status-badge';

// M-4a 訂單列表 table(server-render;無 TanStack、拖曳排序留訂單線-03)。
// Slice A:主狀態欄 = workflow_status 彩色 badge(Sean 的收款×訂定×貨況合併標籤;order_status_options 策展);
// 舊雙軸(付款/出貨)降次要 → muted 純文字合一欄(granular 查「已付未出」仍走 filter bar 雙軸下拉);
// 來源/管道同樣合一 muted 欄。cancelled_at 非 null → 「已取消」標記(本片純顯示、取消功能留取消片)。

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm whitespace-nowrap';

function OrderRow({
  order,
  optionsByCode,
}: {
  order: AdminOrderSummary;
  optionsByCode: ReadonlyMap<string, OrderStatusOption>;
}) {
  const cancelled = order.cancelledAt !== null;
  return (
    <tr className='border-t'>
      <td className={TD}>
        <span className='font-medium'>{order.displayId}</span>
        {cancelled && (
          <span className='bg-destructive/10 text-destructive ml-2 inline-flex rounded-full px-2 py-0.5 text-xs'>
            已取消
          </span>
        )}
      </td>
      <td className={TD}>
        <WorkflowStatusBadge badge={workflowStatusBadge(order.workflowStatus, optionsByCode)} />
      </td>
      <td className={TD}>{order.customerName ?? '—'}</td>
      <td className={`${TD} text-muted-foreground`}>{formatOrderDate(order.createdAt)}</td>
      <td className={`${TD} text-muted-foreground text-xs`}>
        {PAYMENT_STATUS_LABEL[order.paymentStatus]} · {FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus]}
      </td>
      <td className={`${TD} text-muted-foreground text-xs`}>
        {ORDER_SOURCE_LABEL[order.orderSource]} · {PAYMENT_CHANNEL_LABEL[order.paymentChannel]}
      </td>
      <td className={`${TD} text-right tabular-nums`}>NT$ {formatOrderAmount(order.total.amount)}</td>
    </tr>
  );
}

export function OrdersTable({
  orders,
  statusOptions,
}: {
  orders: AdminOrderSummary[];
  statusOptions: OrderStatusOption[];
}) {
  if (orders.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border bg-card p-10 text-center text-sm'>
        目前沒有符合條件的訂單。
      </div>
    );
  }

  const optionsByCode = indexOrderStatusOptions(statusOptions);

  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>訂單編號</th>
            <th className={TH}>訂單狀態</th>
            <th className={TH}>客人</th>
            <th className={TH}>日期</th>
            <th className={TH}>付款 · 出貨</th>
            <th className={TH}>來源 · 管道</th>
            <th className={`${TH} text-right`}>金額</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} optionsByCode={optionsByCode} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
