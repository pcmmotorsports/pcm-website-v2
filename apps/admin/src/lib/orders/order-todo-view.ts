import type { AdminOrderSummary } from '@pcm/domain';
import type { PendingBox } from '../shipping/box-progress';
import { formatOrderAmount, formatOrderPayColumn, orderPayActionable, orderPayAmbiguous } from './order-list-view';
import type { NextStepDo } from './order-return-to';
import { orderNextStep, orderStatusView } from './order-status-axes';
import { ORDER_TODO_SPECS, type OrderTodoKey } from './order-todo';

// order-todo-view.ts — 待辦模式每一列要畫什麼(純函式;`order-todo-list.tsx` 只排版)。
// 🔴 動作鈕**不自己判斷**要做什麼:
//    · 收款那兩格 ⇒ 跟列表收款欄同一條規則(`orderPayActionable`:還差 N / 還沒收才可點;「需確認」不可點)
//    · 下訂 / 出貨那兩格 ⇒ 直接用列表「下一步」那一格的 `orderNextStep`(含出貨流程的箱子進度)
//    ⇒ 待辦清單上的鈕與一般列表同一張單的鈕,字與去處一定一樣。

export type OrderTodoAction =
  | { kind: 'link'; label: string; href: string; tone: 'default' | 'warn' }
  /** 這張單現在按不了(例如收款欄是「需確認」):照印那個字, 不給鈕。 */
  | { kind: 'text'; label: string };

export type OrderTodoRow = {
  id: string;
  displayId: string;
  customerName: string;
  /** 第一樣商品的名稱;多樣時後面接「等 N 樣」。 */
  itemSummary: string;
  /** 收款兩格印收款欄那句(還差 N / 還沒收 / 需確認);其餘印訂單金額。 */
  money: string;
  action: OrderTodoAction;
};

export function buildOrderTodoRows(
  orders: readonly AdminOrderSummary[],
  todo: OrderTodoKey,
  links: {
    pay: (orderId: string) => string;
    next: (orderId: string, action: NextStepDo) => string;
  },
  boxByOrderId: ReadonlyMap<string, PendingBox> | null,
): OrderTodoRow[] {
  const spec = ORDER_TODO_SPECS[todo];
  return orders.map((o) => {
    const first = o.lines[0];
    const title = first ? (first.title ?? first.variantSku ?? '') : '';
    const itemSummary = o.lines.length > 1 ? `${title} 等 ${o.lines.length} 樣` : title;
    const customerName = o.customerName ?? o.shippingAddress.name ?? '';
    if (spec.action === 'pay') {
      const ambiguous = orderPayAmbiguous(o);
      const money = formatOrderPayColumn(o.balanceDue, ambiguous, o.paymentStatus);
      const action: OrderTodoAction = orderPayActionable(o.balanceDue, ambiguous)
        ? { kind: 'link', label: spec.actionLabel, href: links.pay(o.id), tone: 'default' }
        : { kind: 'text', label: money };
      return { id: o.id, displayId: o.displayId, customerName, itemSummary, money, action };
    }
    const next = orderNextStep(orderStatusView(o), boxByOrderId?.get(o.id) ?? null);
    const action: OrderTodoAction =
      next.kind === 'goto'
        ? { kind: 'link', label: next.label, href: next.href, tone: 'default' }
        : next.kind === 'action'
          ? { kind: 'link', label: next.label, href: links.next(o.id, next.do), tone: next.tone === 'warn' ? 'warn' : 'default' }
          : { kind: 'text', label: next.kind === 'done' ? next.label : '' };
    return {
      id: o.id,
      displayId: o.displayId,
      customerName,
      itemSummary,
      money: `NT$ ${formatOrderAmount(o.total.amount)}`,
      action,
    };
  });
}
