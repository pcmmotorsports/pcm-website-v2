// @vitest-environment jsdom
//
// Ilmberger「左右一對」出貨提示 —— 揀貨單【接線】、出貨單【不印】(2026-09-27;plan docs/plans/2026-09-27-ilmberger-pair-shipping-note-plan.md)。
// 提示字本身由 lib/orders/pair-split 決定(那裡有自己的測試);這裡證「揀貨單把那一行印在一對那一列的品名下、
// 一般品項那一列沒有」, 以及「出貨單(隨貨給客人)不印」。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';
import { PickingDoc } from './picking-doc';
import { ShippingDoc } from './shipping-doc';

afterEach(cleanup);

const money = (n: number) => ({ amount: n as never, currency: 'TWD' as const });
const NOTE = '一對：出貨時請拆成左、右各一件（左 CG.VFL.007、右 CM.VFR.008）';

const PAIR_ITEM = {
  id: 'i-pair',
  brand: 'Ilmberger',
  variantSku: 'ILM-VF.007-PAIR-G',
  title: '前土除',
  spec: { material: '碳纖', finish: '亮面', position: '左右一對' },
  quantity: 1,
  unitPrice: money(23280),
  lineTotal: money(23280),
  quantitySummary: null,
};
const NORMAL_ITEM = {
  ...PAIR_ITEM,
  id: 'i-normal',
  variantSku: 'LTC-BK-XL',
  title: '前叉防甩頭',
  spec: { color: '黑' },
  unitPrice: money(1200),
  lineTotal: money(1200),
};

function detail(): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    displayId: 'PCM-2099-0001',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'storefront',
    paymentChannel: 'tappay',
    paymentMethod: 'tappay',
    paidAt: '2099-04-15T10:00:00Z',
    subtotal: money(24480),
    shippingFee: money(0),
    discountTotal: money(0),
    taxTotal: money(0),
    total: money(24480),
    shippingMethod: 'home',
    shippingAddress: { name: '收件人', phone: '0912345678', line: '新北市新莊區化成路736巷18號' },
    customerUserId: '22222222-2222-4222-8222-222222222222',
    customer: { name: '王小明', email: 'a@b.c', phone: '0912345678' },
    invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: '/ABC1234', donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'pending',
    cancelledAt: null,
    cancelledReason: null,
    version: 1,
    items: [PAIR_ITEM, NORMAL_ITEM],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
  } as unknown as AdminOrderDetail;
}

const SHIPMENT = {
  id: 's1',
  shipmentReference: 'K7X2MP',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: '6412345678',
  shippedAt: '2026-08-16T02:00:00Z',
  voidedAt: null,
  voidReason: null,
  recipientSnapshot: { name: '王小明', phone: '0912345678', line: '台北市信義區松高路 1 號' },
} as never;

/**
 * 那一料號出現的每一列(取【最內層】的 tr:出貨單外框也是表格, 外層 tr 會包住整張紙)。
 * 出貨單同一個品項可能出現在兩區(這一箱 / 其他區), 每一列都要檢查。
 */
function rowsOf(container: HTMLElement, sku: string): string[] {
  const rows = [...container.querySelectorAll('tr')].filter(
    (tr) => tr.textContent?.includes(sku) && ![...tr.querySelectorAll('tr')].some((inner) => inner.textContent?.includes(sku)),
  );
  if (rows.length === 0) throw new Error(`找不到 ${sku} 那一列`);
  return rows.map((r) => r.textContent ?? '');
}

describe('揀貨單:一對那一列印出拆件提示', () => {
  it('🔴 一對那一列有那一行, 一般品項那一列沒有', () => {
    const { container } = render(<PickingDoc detail={detail()} pairNotes={{ [PAIR_ITEM.variantSku]: NOTE }} />);
    expect(rowsOf(container, PAIR_ITEM.variantSku)).toEqual([expect.stringContaining(NOTE)]);
    for (const r of rowsOf(container, NORMAL_ITEM.variantSku)) expect(r).not.toContain('一對：');
  });

  it('沒傳 pairNotes ⇒ 什麼都不多印(既有呼叫端行為不變)', () => {
    const { container } = render(<PickingDoc detail={detail()} />);
    expect(container.textContent).not.toContain('一對：');
  });
});

// 🔴 主視窗 2026-09-27 裁(Fable R1 之後):出貨單是隨貨給客人的紙 ⇒ 拆件提示【不印】在出貨單與它的 PDF,
//    只留出貨彈窗與揀貨單(員工看的)。這一格硬塞 pairNotes 進去:有人把那個 prop 加回來, 這裡就紅。
describe('出貨單:隨貨給客人, 不印拆件提示', () => {
  it('🔴 就算硬塞 pairNotes, 出貨單上也沒有「一對：」那一行', () => {
    const { container } = render(
      <ShippingDoc
        detail={detail()}
        items={[PAIR_ITEM, NORMAL_ITEM] as never}
        reportedTotal={2}
        shipment={SHIPMENT}
        lines={[{ orderItemId: 'i-pair', quantity: 1 }, { orderItemId: 'i-normal', quantity: 1 }] as never}
        {...({ pairNotes: { [PAIR_ITEM.variantSku]: NOTE } } as object)}
      />,
    );
    expect(rowsOf(container, PAIR_ITEM.variantSku).length, '一對那一列沒畫出來 ⇒ 下面的「沒有」恆真').toBeGreaterThan(0);
    expect(container.textContent).not.toContain('一對：');
  });
});
