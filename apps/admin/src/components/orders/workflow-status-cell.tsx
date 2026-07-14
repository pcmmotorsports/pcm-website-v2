import type { AdminOrderSummary, OrderStatusOption } from '@pcm/domain';
import { updateOrderWorkflowAction } from '../../lib/orders/order-actions';
import {
  WF_CLEAR_VALUE,
  ORDER_ID_FIELD,
  VERSION_FIELD,
  RETURN_TO_FIELD,
  WF_STATUS_FIELD,
} from '../../lib/orders/workflow-form';
import { workflowStatusBadge } from '../../lib/orders/order-list-view';
import { WorkflowStatusBadge } from './workflow-status-badge';

// M-4a Slice C:列表 inline 改單(彩色 badge 顯示 + 下拉 form 改;server action、零 client JS)。
// 貼 Sean Google Sheet「一格彩色下拉」的操作:選新狀態 → 存 → PRG 回列表最新態。

export function WorkflowStatusCell({
  order,
  optionsByCode,
  activeOptions,
}: {
  order: AdminOrderSummary;
  optionsByCode: ReadonlyMap<string, OrderStatusOption>;
  activeOptions: OrderStatusOption[];
}) {
  const badge = workflowStatusBadge(order.workflowStatus, optionsByCode);
  const current = order.workflowStatus;
  // 當前值是停用/未知 code(不在 active 清單)→ 補一項讓下拉有落點(否則存時靜默改成別的)。
  const currentInActive = current !== null && activeOptions.some((o) => o.code === current);
  const orphanOption =
    current !== null && !currentInActive
      ? { code: current, label: optionsByCode.get(current)?.label ?? current }
      : null;

  return (
    <div className='flex items-center gap-2'>
      <WorkflowStatusBadge badge={badge} />
      <form action={updateOrderWorkflowAction} className='flex items-center gap-1'>
        <input type='hidden' name={ORDER_ID_FIELD} value={order.id} />
        <input type='hidden' name={VERSION_FIELD} value={order.version} />
        <input type='hidden' name={RETURN_TO_FIELD} value='/orders' />
        <select
          name={WF_STATUS_FIELD}
          defaultValue={current ?? WF_CLEAR_VALUE}
          aria-label='訂單狀態'
          className='border-input bg-background h-8 rounded-md border px-2 text-xs'
        >
          <option value={WF_CLEAR_VALUE}>未設定</option>
          {orphanOption && (
            <option value={orphanOption.code}>{orphanOption.label}(已停用)</option>
          )}
          {activeOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type='submit'
          className='border-input text-muted-foreground hover:text-foreground h-8 rounded-md border px-2 text-xs'
        >
          存
        </button>
      </form>
    </div>
  );
}
