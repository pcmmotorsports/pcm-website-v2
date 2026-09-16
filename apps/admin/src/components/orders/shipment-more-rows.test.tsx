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
const BACK = '/orders?date_from=2026-03-16&next=o1&do=receipt';
const renderWithBack = async () =>
  render(await ShipmentMoreRows({ orderId: 'o1', backToReceiptHref: BACK }));

/* 🔴🔴 **「登錯到貨」的回頭路**(2026-09-16, Sean 拍 乙′)。
   🔬 他的原話逐字:「我有做登陸到貨, 但是如果今天要取消, 我找不到入口取消到貨這一件,
      因為可能我登記錯商品, 要回頭取消到貨登記用」。
   🔴 根因是**那扇門不見了**:`orderNextStep()` 只回一個動作 ⇒ 登記到貨之後列表那格從
      「到貨登記」變「出貨」⇒ 再也生不出 `?do=receipt`。這條連結是把門補回來。
   🛑 **三個分支都要有它** —— 尤其「還沒建箱」, 那正是他最常在的狀態
      (剛到貨、正要出貨才發現登錯)。本組逐一釘住那三格。
   ⚠️ 擋得住的只有「連結在不在、指去哪」, **證不到他點下去真的撤得掉**
      —— 那一段由到貨彈窗與 `undoItemReceiptAction` 各自的守門顧。 */
describe('回到貨登記那條路(三個分支都要有)', () => {
  const back = (c: HTMLElement) => c.querySelector('[data-testid="shipment-more-back-to-receipt"]');

  it('🔴🔴 還沒建箱 ⇒ 回頭路要在(他最常在的狀態)', async () => {
    loadOrderShipments.mockResolvedValue([]);
    const { container } = await renderWithBack();
    expect(back(container), '沒建箱就沒有回頭路 ⇒ 剛到貨發現登錯的人卡在這裡').not.toBeNull();
    expect(back(container)!.getAttribute('href')).toBe(BACK);
  });

  it('🔴 讀不到這張單的箱 ⇒ 回頭路【仍然】要在(撤到貨與讀不讀得到箱子無關)', async () => {
    loadOrderShipments.mockRejectedValue(new Error('boom'));
    const { container } = await renderWithBack();
    expect(container.textContent).toContain('讀不到');
    expect(back(container), '讀箱子失敗就順手把回頭路一起吃掉了').not.toBeNull();
  });

  it('🔴 已經有箱 ⇒ 回頭路也要在(建完箱才發現登錯也是常有的事)', async () => {
    loadOrderShipments.mockResolvedValue([box()]);
    const { container } = await renderWithBack();
    expect(back(container)).not.toBeNull();
  });

  it('🟢 負對照:沒傳 href ⇒ 三個分支都【不畫】那一列(不是寫死一條連結)', async () => {
    loadOrderShipments.mockResolvedValue([]);
    expect(back((await renderRows()).container), '沒人傳還畫 ⇒ 上面三格全變恆真').toBeNull();
  });
});

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
