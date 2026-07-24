// workflow-select-options.ts — 商品狀態帶色下拉的選項組裝(純函式;M-4a D-2 後續單格拍板)。
// 規則:①「未設定」哨兵恆在首位、中性無色 ②當前值不在 active 清單 → 補孤兒落點
//(停用 code 解析得到策展色、未知 code 中性不編造)③active 選項帶各自策展色
// ④付款↔狀態半邊過濾(已收未定 A 案、Sean 2026-07-24):paid 藏未收半邊、unpaid 藏已收半邊、
//   cancelled 雙邊恆在、partiallyPaid/refunded 不過濾;**當前值一律保留、不受過濾影響**。

import type { OrderStatusOption, PaymentStatus } from '@pcm/domain';
import { WF_CLEAR_VALUE, WF_RECEIVED_UNCONFIRMED } from './workflow-form';

export type WorkflowSelectOptionView = {
  value: string;
  label: string;
  /** null = 中性(未設定/未知 code,不編造顏色) */
  color: string | null;
  textColor: 'light' | 'dark' | null;
};

// ── 已收/未收半邊分類(design §6.1 的 2×4 矩陣;seed migration 20260714120000)──
// 未收半邊 = 4 個 unpaid_ 前綴(unpaid_confirmed/unconfirmed/shipped/instock);
// cancelled = 中性(取消是雙邊都可能的動作、Sean Q2=A 雙邊恆在);
// 其餘(received_*/shipped_done/instock_available/自訂 code)= 已收半邊。
const NEUTRAL_CODES = new Set(['cancelled']);

function isUnpaidSide(code: string): boolean {
  return code.startsWith('unpaid_');
}

/**
 * 某狀態選項是否應依付款狀態出現在下拉(當前值另在 build 內永遠保留、不經此判斷):
 * - cancelled → 恆 true(雙邊、Sean Q2=A);
 * - paid → 藏未收半邊(只留已收半邊 + 中性);
 * - unpaid → 藏已收半邊(只留未收半邊 + 中性);
 * - partiallyPaid / refunded → 不過濾(無對應詞彙、全給 Sean 手判、Q1=A)。
 */
function isVisibleForPayment(code: string, paymentStatus: PaymentStatus): boolean {
  if (NEUTRAL_CODES.has(code)) return true;
  if (paymentStatus === 'paid') return !isUnpaidSide(code);
  if (paymentStatus === 'unpaid') return isUnpaidSide(code);
  return true; // partiallyPaid / refunded
}

/**
 * 下拉的預設預選值(Q3=A):
 * - 已設值 → 該值;
 * - 未設值 + paid 且「已收未定」在 active 清單 → 預選「已收未定」(純顯示層、存才落庫);
 * - 未設值其餘情形(unpaid/partiallyPaid/refunded、或「已收未定」未 active)→ 「未設定」哨兵。
 * 抽純函式:防呆分支(received_unconfirmed 未 active → 退哨兵)可單測、不落 component。
 */
export function resolveDefaultWorkflowValue(
  workflowStatus: string | null,
  activeOptions: OrderStatusOption[],
  paymentStatus: PaymentStatus,
): string {
  if (workflowStatus !== null) return workflowStatus;
  if (paymentStatus === 'paid' && activeOptions.some((o) => o.code === WF_RECEIVED_UNCONFIRMED)) {
    return WF_RECEIVED_UNCONFIRMED;
  }
  return WF_CLEAR_VALUE;
}

export function buildWorkflowSelectOptions(
  workflowStatus: string | null,
  optionsByCode: ReadonlyMap<string, OrderStatusOption>,
  activeOptions: OrderStatusOption[],
  paymentStatus: PaymentStatus,
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
    // 當前值(在 active 且落在被藏的半邊)一律保留:o.code === workflowStatus 直接放行,
    // 否則 select 會顯示不在選項內的值(React 警告 + operator 看不到現值)。
    ...activeOptions
      .filter((o) => o.code === workflowStatus || isVisibleForPayment(o.code, paymentStatus))
      .map((o) => ({
        value: o.code,
        label: o.label,
        color: o.color,
        textColor: o.textColor,
      })),
  ];
}
