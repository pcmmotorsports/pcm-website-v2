import type { OrderStatusOption } from '@pcm/domain';
import { updateOrderItemWorkflowAction } from '../../lib/orders/order-actions';
import {
  WF_CLEAR_VALUE,
  ITEM_ID_FIELD,
  VERSION_FIELD,
  RETURN_TO_FIELD,
  WF_STATUS_FIELD,
} from '../../lib/orders/workflow-form';
import { buildWorkflowSelectOptions } from '../../lib/orders/workflow-select-options';
import { WorkflowStatusSelect } from './workflow-status-select';

// M-4a Slice D-2:per-item inline 改狀態(單格帶色下拉+存;Sean 07-15 開站回饋拍板合併、左 badge 刪)。
// 下拉閉合態依已存值上色、改選即變色(WorkflowStatusSelect 小型 client 元件,只收 code/label/色值
// 非敏感;寫入仍走 <form action={serverAction}> 的「存」鈕、樂觀鎖 version 不變)。
// item 層=唯一操作真相(Sean 2026-07-15 拍板 Q-A=A),整單狀態=OrdersTable 彙總 badge、不在此。

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
  // 孤兒落點/上色規則在 buildWorkflowSelectOptions(純函式、有單測)。
  const selectOptions = buildWorkflowSelectOptions(workflowStatus, optionsByCode, activeOptions);

  return (
    <form action={updateOrderItemWorkflowAction} className='flex items-center gap-1'>
      <input type='hidden' name={ITEM_ID_FIELD} value={itemId} />
      <input type='hidden' name={VERSION_FIELD} value={version} />
      <input type='hidden' name={RETURN_TO_FIELD} value={returnTo} />
      <WorkflowStatusSelect
        name={WF_STATUS_FIELD}
        defaultValue={workflowStatus ?? WF_CLEAR_VALUE}
        options={selectOptions}
        ariaLabel='商品狀態'
      />
      <button
        type='submit'
        className='border-input text-muted-foreground hover:text-foreground h-8 rounded-md border px-2 text-xs'
      >
        存
      </button>
    </form>
  );
}
