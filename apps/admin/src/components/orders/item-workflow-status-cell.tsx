import type { OrderStatusOption } from '@pcm/domain';
import { updateOrderItemWorkflowAction } from '../../lib/orders/order-actions';
import {
  WF_CLEAR_VALUE,
  ITEM_ID_FIELD,
  VERSION_FIELD,
  RETURN_TO_FIELD,
  WF_STATUS_FIELD,
} from '../../lib/orders/workflow-form';
import { workflowStatusBadge } from '../../lib/orders/order-list-view';
import { WorkflowStatusBadge } from './workflow-status-badge';

// M-4a Slice D-2:per-item inline 改狀態(彩色 badge 顯示 + 下拉 form 改;server action、零 client JS)。
// 鏡像退場的 order 層 WorkflowStatusCell(Slice C),target 改 order_items.id + item 層樂觀鎖 version;
// item 層=唯一操作真相(Sean 2026-07-15 拍板 Q-A=A),整單狀態=OrdersTable 彙總顯示、不再手設。

export function ItemWorkflowStatusCell({
  itemId,
  workflowStatus,
  version,
  returnTo,
  optionsByCode,
  activeOptions,
}: {
  itemId: string;
  workflowStatus: string | null;
  version: number;
  /** PRG 回跳路徑(列表 '/orders' / 明細 `/orders/<orderId>`;action 端站內白名單再驗) */
  returnTo: string;
  optionsByCode: ReadonlyMap<string, OrderStatusOption>;
  activeOptions: OrderStatusOption[];
}) {
  const badge = workflowStatusBadge(workflowStatus, optionsByCode);
  // 當前值是停用/未知 code(不在 active 清單)→ 補一項讓下拉有落點(否則存時靜默改成別的)。
  const currentInActive =
    workflowStatus !== null && activeOptions.some((o) => o.code === workflowStatus);
  const orphanOption =
    workflowStatus !== null && !currentInActive
      ? { code: workflowStatus, label: optionsByCode.get(workflowStatus)?.label ?? workflowStatus }
      : null;

  return (
    <div className='flex items-center gap-2'>
      <WorkflowStatusBadge badge={badge} />
      <form action={updateOrderItemWorkflowAction} className='flex items-center gap-1'>
        <input type='hidden' name={ITEM_ID_FIELD} value={itemId} />
        <input type='hidden' name={VERSION_FIELD} value={version} />
        <input type='hidden' name={RETURN_TO_FIELD} value={returnTo} />
        <select
          name={WF_STATUS_FIELD}
          defaultValue={workflowStatus ?? WF_CLEAR_VALUE}
          aria-label='商品狀態'
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
