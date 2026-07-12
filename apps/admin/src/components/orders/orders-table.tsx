import type { AdminOrderSummary } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderDate,
  formatOrderAmount,
} from '../../lib/orders/order-list-view';

// M-4a 訂單線第一片:輕量訂單列表 table(server-render;無 TanStack、拖曳排序留訂單線-03)。
// 分軸顯示付款 / 出貨(admin 查「已付未出」);cancelled_at 非 null → 「已取消」標記(本片純顯示、取消功能留取消片)。

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm whitespace-nowrap';

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className='bg-secondary text-secondary-foreground inline-flex rounded-full px-2 py-0.5 text-xs'>
      {children}
    </span>
  );
}

function OrderRow({ order }: { order: AdminOrderSummary }) {
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
      <td className={TD}>{order.customerName ?? '—'}</td>
      <td className={`${TD} text-muted-foreground`}>{formatOrderDate(order.createdAt)}</td>
      <td className={TD}>
        <StatusPill>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</StatusPill>
      </td>
      <td className={TD}>
        <StatusPill>{FULFILLMENT_STATUS_LABEL[order.fulfillmentStatus]}</StatusPill>
      </td>
      <td className={`${TD} text-muted-foreground`}>{ORDER_SOURCE_LABEL[order.orderSource]}</td>
      <td className={`${TD} text-muted-foreground`}>
        {PAYMENT_CHANNEL_LABEL[order.paymentChannel]}
      </td>
      <td className={`${TD} text-right tabular-nums`}>NT$ {formatOrderAmount(order.total.amount)}</td>
    </tr>
  );
}

export function OrdersTable({ orders }: { orders: AdminOrderSummary[] }) {
  if (orders.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border bg-card p-10 text-center text-sm'>
        目前沒有符合條件的訂單。
      </div>
    );
  }

  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>訂單編號</th>
            <th className={TH}>客人</th>
            <th className={TH}>日期</th>
            <th className={TH}>付款</th>
            <th className={TH}>出貨</th>
            <th className={TH}>來源</th>
            <th className={TH}>管道</th>
            <th className={`${TH} text-right`}>金額</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
