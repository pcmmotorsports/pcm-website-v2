import Link from 'next/link';
import type { AdminOrderSummary, OrderStatusOption } from '@pcm/domain';
import {
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  MEMBER_TIER_LABEL,
  formatOrderAmount,
  indexOrderStatusOptions,
} from '../../lib/orders/order-list-view';
import { WorkflowStatusCell } from './workflow-status-cell';

// M-4a Slice D-1a 訂單列表(server-render;每商品一列、同單分組)。
// 需求(Sean):一張訂單多商品 → 拆多列(各商品到貨時間不同、要個別看狀態);同單分組 = 訂單層欄
//   (單號 / 會員等級 / 客戶 / 訂單狀態 / 來源·管道)以 rowSpan 合併、品項層欄(品牌 / 料號 / 名稱 /
//   數量 / 單價 / 總金額)逐列。
// 🔴 鐵則 12:單價 / 總金額 + 會員等級同列 = 經銷價脈絡,全 server-render(WorkflowStatusCell 亦 server
//   component、<form action={serverAction}> 零 client JS)→ 敏感值不序列化進 client bundle;SSO 閘後 admin-only。
// 「年份廠牌車種」欄 = V-3(order_items.vehicle_snapshot)落地才點亮,D-1a 期間不出欄。
// 訂單狀態欄暫顯「所屬訂單」狀態(per-order、Slice C 既有 inline 改單);D-2 改 per-item 後拆成逐列各自狀態。

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm whitespace-nowrap align-top';

function OrderGroup({
  order,
  optionsByCode,
  activeOptions,
}: {
  order: AdminOrderSummary;
  optionsByCode: ReadonlyMap<string, OrderStatusOption>;
  activeOptions: OrderStatusOption[];
}) {
  const cancelled = order.cancelledAt !== null;
  // 品項展開;空陣列(理論不發生,create_order 保證 ≥1 line)→ 兜一列 null 佔位、顯示「—」。
  const rows = order.lines.length > 0 ? order.lines : [null];
  const rowSpan = rows.length;

  return (
    <tbody>
      {rows.map((line, i) => (
        <tr
          key={line ? `${line.variantSku}-${i}` : 'empty'}
          className={i === 0 ? 'border-t' : 'border-t border-dashed'}
        >
          {i === 0 && (
            <td className={TD} rowSpan={rowSpan}>
              <Link href={`/orders/${order.id}`} className='font-medium hover:underline'>
                {order.displayId}
              </Link>
              {cancelled && (
                <span className='bg-destructive/10 text-destructive ml-2 inline-flex rounded-full px-2 py-0.5 text-xs'>
                  已取消
                </span>
              )}
            </td>
          )}
          <td className={TD}>{line?.brand ?? '—'}</td>
          <td className={`${TD} font-mono text-xs`}>{line?.variantSku ?? '—'}</td>
          <td className={TD}>{line?.title ?? '—'}</td>
          <td className={`${TD} text-right tabular-nums`}>{line ? line.quantity : '—'}</td>
          <td className={`${TD} text-right tabular-nums`}>
            {line ? `NT$ ${formatOrderAmount(line.unitPrice.amount)}` : '—'}
          </td>
          <td className={`${TD} text-right tabular-nums`}>
            {line ? `NT$ ${formatOrderAmount(line.lineTotal.amount)}` : '—'}
          </td>
          {i === 0 && (
            <>
              <td className={TD} rowSpan={rowSpan}>
                {MEMBER_TIER_LABEL[order.tierAtCheckout]}
              </td>
              <td className={TD} rowSpan={rowSpan}>
                {order.customerName ?? '—'}
              </td>
              <td className={TD} rowSpan={rowSpan}>
                <WorkflowStatusCell
                  order={order}
                  optionsByCode={optionsByCode}
                  activeOptions={activeOptions}
                />
              </td>
              <td className={`${TD} text-muted-foreground text-xs`} rowSpan={rowSpan}>
                {ORDER_SOURCE_LABEL[order.orderSource]} · {PAYMENT_CHANNEL_LABEL[order.paymentChannel]}
              </td>
            </>
          )}
        </tr>
      ))}
    </tbody>
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
  const activeOptions = statusOptions.filter((o) => o.isActive);

  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>訂單編號</th>
            <th className={TH}>商品品牌</th>
            <th className={TH}>料號</th>
            <th className={TH}>物品名稱</th>
            <th className={`${TH} text-right`}>數量</th>
            <th className={`${TH} text-right`}>單價</th>
            <th className={`${TH} text-right`}>總金額</th>
            <th className={TH}>會員等級</th>
            <th className={TH}>客戶名稱</th>
            <th className={TH}>訂單狀態</th>
            <th className={TH}>來源 · 管道</th>
          </tr>
        </thead>
        {orders.map((order) => (
          <OrderGroup
            key={order.id}
            order={order}
            optionsByCode={optionsByCode}
            activeOptions={activeOptions}
          />
        ))}
      </table>
    </div>
  );
}
