// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// shipment-more-rows.test.tsx — B13-b:出貨彈窗「更多」六列。守的是【顯示條件逐字照明細頁出貨卡】與【零新寫入路】
//    (每一列的鈕都是既有元件;這裡把它們換成印名字的替身,只證「這一列在不在、給了哪一箱」)。

const { loadOrderShipments, findAdminOrderDetail } = vi.hoisted(() => ({
  loadOrderShipments: vi.fn(),
  findAdminOrderDetail: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/order-shipments', () => ({ loadOrderShipments }));
vi.mock('../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail }),
}));
vi.mock('./shipment-hct-submit-button', () => ({
  ShipmentHctSubmitButton: ({ shipmentReference }: { shipmentReference: string }) => <button type='button'>送新竹 {shipmentReference}</button>,
}));
vi.mock('./shipment-mark-shipped-button', () => ({
  ShipmentMarkShippedButton: ({ shipmentReference }: { shipmentReference: string }) => <button type='button'>標出貨 {shipmentReference}</button>,
}));
vi.mock('./shipment-edit-tracking-button', () => ({
  ShipmentEditTrackingButton: ({ shipmentReference }: { shipmentReference: string }) => <button type='button'>改單號 {shipmentReference}</button>,
}));
vi.mock('./shipment-void-button', () => ({
  ShipmentVoidButton: ({ shipmentReference }: { shipmentReference: string }) => <button type='button'>作廢 {shipmentReference}</button>,
}));
vi.mock('./shipment-hct-unknown-notice', () => ({ ShipmentHctUnknownNotice: () => null }));

import { ShipmentMoreRows } from './shipment-more-rows';

const box = (over: Record<string, unknown> = {}) => ({
  shipment: {
    id: 's1',
    shipmentReference: 'BCDFGH',
    carrierCode: 'hct',
    trackingNumber: 'HCT-1',
    shippedAt: null,
    voidedAt: null,
    ...over,
  },
  hctStatus: 'draft',
  hctPlaceholderStuck: false, hctLabelRefetchable: false, hctDispatchAttempted: false, hctDispatched: false,
  lines: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  findAdminOrderDetail.mockResolvedValue({ id: 'o1', items: [{ id: 'oi-1', title: 'x' }] });
});
afterEach(cleanup);

const renderRows = async () => render(await ShipmentMoreRows({ orderId: 'o1' }));

describe('ShipmentMoreRows', () => {
  it('沒箱 ⇒ 只有「這張單的箱:還沒建箱」,其餘五列不畫(沒有對象)', async () => {
    loadOrderShipments.mockResolvedValue([]);
    const { container } = await renderRows();
    expect(container.textContent).toContain('還沒建箱');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('讀不到 ⇒ 說讀不到,不假裝「還沒建箱」', async () => {
    loadOrderShipments.mockResolvedValue(null);
    const { container } = await renderRows();
    expect(container.textContent).toContain('讀不到');
    expect(container.textContent).not.toContain('還沒建箱');
  });

  it('未出貨的新竹箱:叫車 / 標已取件 / 列印(標籤灰)/ 作廢 在;改單號不在(只給已出貨)', async () => {
    loadOrderShipments.mockResolvedValue([box()]);
    const { container, getByText } = await renderRows();
    expect(getByText(/送新竹 BCDFGH/)).toBeTruthy();
    expect(getByText(/標出貨 BCDFGH/)).toBeTruthy();
    expect(getByText(/作廢 BCDFGH/)).toBeTruthy();
    expect(container.querySelector('a[href="/print/orders/o1/shipping/s1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/print/orders/o1/shipping/s1/label.pdf"]'), '沒送新竹不給標籤連結').toBeNull();
    expect(container.querySelector('[aria-disabled="true"]')?.textContent).toContain('託運標籤');
    expect(container.textContent).not.toContain('改單號');
    expect(container.textContent).toContain('未出貨');
  });

  it('已出貨 + 已送新竹:改單號在、標已取件不在、標籤 PDF 給連結、印出貨日', async () => {
    loadOrderShipments.mockResolvedValue([{ ...box({ shippedAt: '2026-09-09T02:00:00Z' }), hctStatus: 'submitted' }]);
    const { container, getByText } = await renderRows();
    expect(getByText(/改單號 BCDFGH/)).toBeTruthy();
    expect(container.textContent).not.toContain('標出貨');
    expect(container.querySelector('a[href="/print/orders/o1/shipping/s1/label.pdf"]')).not.toBeNull();
    expect(container.textContent).toContain('已出貨 09/09');
  });

  it('作廢的箱:只留「這張單的箱」那一列(已作廢、刪除線),一顆鈕都沒有', async () => {
    loadOrderShipments.mockResolvedValue([box({ voidedAt: '2026-09-10T00:00:00Z' })]);
    const { container } = await renderRows();
    expect(container.textContent).toContain('已作廢');
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('片 A:卡在「送出結果未知」的新竹箱 ⇒ 不給「送新竹」(出口是提示裡的查詢鈕)', async () => {
    loadOrderShipments.mockResolvedValue([box()]);
    expect((await renderRows()).container.textContent, '正對照:draft 箱有送新竹').toContain('送新竹');
    loadOrderShipments.mockResolvedValue([{ ...box(), hctStatus: 'unknown' }]);
    const { container } = await renderRows();
    expect(container.textContent).not.toContain('送新竹');
  });

  it('非新竹的箱:沒有叫車那一列', async () => {
    loadOrderShipments.mockResolvedValue([box({ carrierCode: 'sf' })]);
    const { container } = await renderRows();
    expect(container.textContent).not.toContain('送新竹');
    expect(container.textContent).toContain('標出貨');
  });

  it('兩箱 ⇒ 兩組,各自帶自己的箱號', async () => {
    loadOrderShipments.mockResolvedValue([box(), box({ id: 's2', shipmentReference: 'JKMNPQ' })]);
    const { container } = await renderRows();
    expect(container.querySelectorAll('[data-shipment-id]')).toHaveLength(2);
    expect(container.textContent).toContain('作廢 JKMNPQ');
  });
});
