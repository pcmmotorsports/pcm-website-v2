// workflow-select-options.ts — 商品狀態帶色下拉的選項組裝(純函式;M-4a D-2 後續單格拍板)。
// 規則:①「未設定」哨兵恆在首位、中性無色 ②當前值不在 active 清單 → 補孤兒落點
//(停用 code 解析得到策展色、未知 code 中性不編造)③active 選項帶各自策展色。

import type { OrderStatusOption } from '@pcm/domain';
import { WF_CLEAR_VALUE } from './workflow-form';

export type WorkflowSelectOptionView = {
  value: string;
  label: string;
  /** null = 中性(未設定/未知 code,不編造顏色) */
  color: string | null;
  textColor: 'light' | 'dark' | null;
};

export function buildWorkflowSelectOptions(
  workflowStatus: string | null,
  optionsByCode: ReadonlyMap<string, OrderStatusOption>,
  activeOptions: OrderStatusOption[],
): WorkflowSelectOptionView[] {
  const currentInActive =
    workflowStatus !== null && activeOptions.some((o) => o.code === workflowStatus);
  const orphan =
    workflowStatus !== null && !currentInActive ? optionsByCode.get(workflowStatus) : undefined;

  return [
    { value: WF_CLEAR_VALUE, label: '未設定', color: null, textColor: null },
    ...(workflowStatus !== null && !currentInActive
      ? [
          {
            value: workflowStatus,
            label: `${orphan?.label ?? workflowStatus}(已停用)`,
            color: orphan?.color ?? null,
            textColor: orphan?.textColor ?? null,
          },
        ]
      : []),
    ...activeOptions.map((o) => ({
      value: o.code,
      label: o.label,
      color: o.color,
      textColor: o.textColor,
    })),
  ];
}
