import Link from 'next/link';
import type { AdminOrderSummary, OrderStatusOption } from '@pcm/domain';
import {
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  MEMBER_TIER_LABEL,
  formatOrderAmount,
  formatOrderDate,
  formatOrderItemVehicle,
  indexOrderStatusOptions,
  summarizeOrderItemWorkflow,
  workflowStatusBadge,
} from '../../lib/orders/order-list-view';
import { ItemWorkflowStatusCell } from './item-workflow-status-cell';
import { WorkflowStatusBadge } from './workflow-status-badge';

// M-4a Slice D-1a 訂單列表(server-render;每商品一列、同單分組)+ D-2 per-item 狀態。
// 需求(Sean):一張訂單多商品 → 拆多列(各商品到貨時間不同、要個別看狀態);同單分組 = 訂單層欄
//   (單號 / 會員等級 / 客戶 / 來源·管道)以 rowSpan 合併、品項層欄(品牌 / 料號 / 名稱 /
//   數量 / 單價 / 總金額 / **商品狀態**)逐列。
// D-2(拍板 Q-A=A):狀態欄=per-item 逐列各自改(ItemWorkflowStatusCell、item 層樂觀鎖);
//   整單狀態=彙總顯示掛單號下方(全同→該色 badge、混合→「多狀態」中性)、不再手設。
// 🔴 鐵則 12:單價 / 總金額 + 會員等級同列 = 經銷價脈絡,全 server-render → 敏感值不序列化進
//   client bundle;SSO 閘後 admin-only。唯一 client 元件=狀態欄 WorkflowStatusSelect(帶色下拉、
//   只收 code/label/色值策展資料;寫入仍 <form action={serverAction}>)。
// V-3b:「年份廠牌車種」欄已點亮 = order_items.vehicle_snapshot(V-3a 落 prod)逐品項直出、
//   formatOrderItemVehicle 顯示(dict 年 品牌 車型 / free 年 raw);未帶車款/佔位列 → 「—」。純顯示無價/tier 面。

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm whitespace-nowrap align-top';

/** 整單彙總 badge(D-2:全同→該狀態色、混合→「多狀態」中性;orders.workflow_status 停寫、不讀)。 */
function OrderWorkflowSummaryBadge({
  order,
  optionsByCode,
}: {
  order: AdminOrderSummary;
  optionsByCode: ReadonlyMap<string, OrderStatusOption>;
}) {
  const summary = summarizeOrderItemWorkflow(order.lines.map((l) => l.workflowStatus));
  if (summary.kind === 'mixed') {
    return (
      <span className='bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs'>
        多狀態
      </span>
    );
  }
  return <WorkflowStatusBadge badge={workflowStatusBadge(summary.code, optionsByCode)} />;
}

function OrderGroup({
  order,
  optionsByCode,
  activeOptions,
  itemStatusFiltered,
  returnTo,
}: {
  order: AdminOrderSummary;
  optionsByCode: ReadonlyMap<string, OrderStatusOption>;
  activeOptions: OrderStatusOption[];
  itemStatusFiltered: boolean;
  returnTo: string;
}) {
  const cancelled = order.cancelledAt !== null;
  // 品項展開;空陣列(理論不發生,create_order 保證 ≥1 line)→ 兜一列 null 佔位、顯示「—」。
  const rows = order.lines.length > 0 ? order.lines : [null];
  const rowSpan = rows.length;

  return (
    <tbody>
      {rows.map((line, i) => (
        <tr
          key={line ? line.id : 'empty'}
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
              {/* 整單彙總(D-2;多品項才有資訊量,單品項與品項列狀態重複、不重複顯示)。
                  item 狀態篩選作用中不顯示:!inner 投影只回命中品項 → lines 不完整、
                  彙總會把混合單誤顯為全同(code-reviewer nit-1)。 */}
              {order.lines.length > 1 && !itemStatusFiltered && (
                <div className='mt-1'>
                  <OrderWorkflowSummaryBadge order={order} optionsByCode={optionsByCode} />
                </div>
              )}
            </td>
          )}
          {/* Q2=A(07-16 晨拍板):加回日期欄(created_at 已在投影、訂單層 rowSpan) */}
          {i === 0 && (
            <td className={`${TD} text-muted-foreground text-xs`} rowSpan={rowSpan}>
              {formatOrderDate(order.createdAt)}
            </td>
          )}
          <td className={TD}>{line?.brand ?? '—'}</td>
          <td className={`${TD} font-mono text-xs`}>{line?.variantSku ?? '—'}</td>
          <td className={TD}>{line?.title ?? '—'}</td>
          {/* V-3b:年份廠牌車種(order_items.vehicle_snapshot 直出;未帶車款/佔位列→「—」) */}
          <td className={`${TD} text-muted-foreground text-xs`}>
            {(line && formatOrderItemVehicle(line.vehicle)) || '—'}
          </td>
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
            </>
          )}
          {/* D-2:狀態欄=per-item 逐列(item 層樂觀鎖;佔位列無 item 可改 → 「—」) */}
          <td className={TD}>
            {line ? (
              <ItemWorkflowStatusCell
                itemId={line.id}
                workflowStatus={line.workflowStatus}
                version={line.version}
                returnTo={returnTo}
                optionsByCode={optionsByCode}
                activeOptions={activeOptions}
              />
            ) : (
              '—'
            )}
          </td>
          {i === 0 && (
            <td className={`${TD} text-muted-foreground text-xs`} rowSpan={rowSpan}>
              {ORDER_SOURCE_LABEL[order.orderSource]} · {PAYMENT_CHANNEL_LABEL[order.paymentChannel]}
            </td>
          )}
        </tr>
      ))}
    </tbody>
  );
}

export function OrdersTable({
  orders,
  statusOptions,
  itemStatusFiltered = false,
  returnTo = '/orders',
}: {
  orders: AdminOrderSummary[];
  statusOptions: OrderStatusOption[];
  /** item 狀態篩選作用中(!inner 投影、lines 只含命中品項)→ 整單彙總 badge 停顯(不完整資料不彙總)。 */
  itemStatusFiltered?: boolean;
  /** item 改狀態 PRG 回跳連結(帶當前篩選+頁碼、存後不丟狀態;Codex R1 nit-1);action 端站內守門再驗。 */
  returnTo?: string;
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
            <th className={TH}>日期</th>
            <th className={TH}>商品品牌</th>
            <th className={TH}>料號</th>
            <th className={TH}>物品名稱</th>
            <th className={TH}>年份廠牌車種</th>
            <th className={`${TH} text-right`}>數量</th>
            <th className={`${TH} text-right`}>單價</th>
            <th className={`${TH} text-right`}>總金額</th>
            <th className={TH}>會員等級</th>
            <th className={TH}>客戶名稱</th>
            <th className={TH}>商品狀態</th>
            <th className={TH}>來源 · 管道</th>
          </tr>
        </thead>
        {orders.map((order) => (
          <OrderGroup
            key={order.id}
            order={order}
            optionsByCode={optionsByCode}
            activeOptions={activeOptions}
            itemStatusFiltered={itemStatusFiltered}
            returnTo={returnTo}
          />
        ))}
      </table>
    </div>
  );
}
