import { describe, expect, it } from 'vitest';
import { toMoneyAmount, type AdminOrderLine, type AdminOrderSummary } from '@pcm/domain';
import { buildOrderTodoRows } from './order-todo-view';
import { orderNextStep, orderStatusView } from './order-status-axes';
import type { PendingBox } from '../shipping/box-progress';

// 待辦模式的每一列(2026-09-30;plan `~/pcm-mailbox/計畫-後台今天要做的事-20260930.md` §2-3)。
// 🔴 本組釘的是「待辦清單上的鈕 = 一般列表同一張單的鈕」:收款走收款欄規則、下訂 / 出貨走下一步那一格。

function line(title: string, axes: { ordered?: number; instock?: number; cancelled?: number } = {}): AdminOrderLine {
  const quantity = 1;
  return {
    id: `l-${title}`,
    variantSku: 'SKU-001',
    title,
    brand: 'Akrapovic',
    quantity,
    unitPrice: { amount: toMoneyAmount(10000), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(10000), currency: 'TWD' },
    workflowStatus: null,
    version: 1,
    vehicle: null,
    quantitySummary: {
      quantity,
      orderedQuantity: axes.ordered ?? 0,
      instockQuantity: axes.instock ?? 0,
      shippedQuantity: 0,
      cancelledQuantity: axes.cancelled ?? 0,
      cancellableQuantity: quantity - (axes.instock ?? 0) - (axes.cancelled ?? 0),
    },
  };
}

function order(over: Partial<AdminOrderSummary> & { lines: AdminOrderLine[] }): AdminOrderSummary {
  return {
    id: 'ord-1',
    itemsTruncated: false,
    displayId: 'PCM-0001',
    createdAt: '2026-09-30T02:00:00.000Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'bank_transfer',
    total: { amount: toMoneyAmount(10000), currency: 'TWD' },
    taxTotal: { amount: toMoneyAmount(0), currency: 'TWD' },
    customerUserId: 'cu-1',
    customerName: '王小明',
    shippingAddress: { name: '收件人', phone: '0912345678', line: '台北市' },
    tierAtCheckout: 'general',
    invoiceStatus: 'not_issued',
    invoiceRequested: true,
    balanceDue: 0,
    cancelledAt: null,
    displayPosition: null,
    ...over,
  };
}

const links = {
  pay: (id: string) => `/orders?pay=${id}`,
  next: (id: string, action: string) => `/orders?next=${id}&do=${action}`,
};

describe('buildOrderTodoRows', () => {
  it('待尾款:收款欄那句 + 「新增收款」鈕連到 ?pay=', () => {
    const [row] = buildOrderTodoRows(
      [order({ paymentStatus: 'partiallyPaid', balanceDue: 7000, lines: [line('排氣管')] })],
      'partial-paid',
      links,
      null,
    );
    expect(row).toEqual({
      id: 'ord-1',
      displayId: 'PCM-0001',
      customerName: '王小明',
      itemSummary: '排氣管',
      money: '還差 7,000',
      action: { kind: 'link', label: '新增收款', href: '/orders?pay=ord-1', tone: 'default' },
    });
  });

  it('🔴 收款欄是「需確認」的單(有取消過的品項)⇒ 不給鈕, 照印那句', () => {
    const [row] = buildOrderTodoRows(
      [order({ paymentStatus: 'partiallyPaid', balanceDue: 7000, lines: [line('排氣管', { cancelled: 1 })] })],
      'partial-paid',
      links,
      null,
    );
    expect(row!.action).toEqual({ kind: 'text', label: row!.money });
    expect(row!.money).toBe('需確認');
  });

  it('待訂貨:鈕 = 列表下一步「跟供應商下訂」, 連到 ?next=&do=order;金額印訂單總額', () => {
    const [row] = buildOrderTodoRows([order({ lines: [line('排氣管'), line('腳踏')] })], 'to-order', links, null);
    expect(row!.action).toEqual({ kind: 'link', label: '跟供應商下訂', href: '/orders?next=ord-1&do=order', tone: 'default' });
    expect(row!.money).toBe('NT$ 10,000');
    expect(row!.itemSummary).toBe('排氣管 等 2 樣');
  });

  it('🔴 到貨待出貨:鈕的字與去處跟列表下一步那一格同一支(有箱子時跟著箱子進度走)', () => {
    const o = order({ lines: [line('排氣管', { ordered: 1, instock: 1 })] });
    const [plain] = buildOrderTodoRows([o], 'ready-ship', links, null);
    expect(plain!.action).toEqual({ kind: 'link', label: '出貨', href: '/orders?next=ord-1&do=ship', tone: 'default' });
    const box: PendingBox = { progress: 'needs_number', shipmentId: 'shp-1', createdAt: '2026-09-30T02:00:00.000Z' };
    const expected = orderNextStep(orderStatusView(o), box);
    const [withBox] = buildOrderTodoRows([o], 'ready-ship', links, new Map([[o.id, box]]));
    // 有箱子 ⇒ 不再是「出貨」(正對照:證明這一格真的跟著箱子走, 不是恆等於上面那一格)
    expect(expected.kind === 'action' || expected.kind === 'goto').toBe(true);
    expect(withBox!.action.label).toBe((expected as { label: string }).label);
    expect(withBox!.action.label).not.toBe('出貨');
  });

  it('🔴 有貨可先出:鈕 = 列表下一步「出貨（已到 N 樣）」(兩樣都訂了、到一樣), 開出貨彈窗', () => {
    const o = order({ lines: [line('排氣管', { ordered: 1, instock: 1 }), line('腳踏', { ordered: 1 })] });
    const [row] = buildOrderTodoRows([o], 'partial-ship', links, null);
    expect(row!.action).toEqual({ kind: 'link', label: '出貨（已到 1 樣）', href: '/orders?next=ord-1&do=ship', tone: 'default' });
  });

  it('客人名字沒有時用收件人姓名', () => {
    const [row] = buildOrderTodoRows([order({ customerName: null, lines: [line('排氣管')] })], 'to-order', links, null);
    expect(row!.customerName).toBe('收件人');
  });
});
