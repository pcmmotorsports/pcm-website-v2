// @vitest-environment jsdom
// 箱子彈窗裡的「新竹物流叫車」(2026-09-27 出貨流程乙第 1 項)。寫入走既有 dispatchShipmentAction, 這裡只守畫面行為。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ dispatch: vi.fn(), refresh: vi.fn() }));
vi.mock('../../lib/shipping/shipment-dispatch-hct-action', () => ({ dispatchShipmentAction: h.dispatch }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import { ShipmentHctDispatchButton } from './shipment-hct-dispatch-button';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShipmentHctDispatchButton', () => {
  it('🔴 按下去呼叫一次叫車, 叫到了顯示貨號並重新整理', async () => {
    h.dispatch.mockResolvedValue({ ok: true, kind: 'dispatched', edelno: '8947081999' });
    render(<ShipmentHctDispatchButton shipmentId='s1' shipmentReference='9X2ZD7' />);
    fireEvent.click(screen.getByRole('button', { name: /新竹物流叫車/ }));
    await waitFor(() => expect(screen.getByText(/已叫到車/)).toBeTruthy());
    expect(h.dispatch).toHaveBeenCalledWith({ shipmentId: 's1' });
    expect(h.refresh).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /新竹物流叫車/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('🔴 結果不確定 ⇒ 印出那段話, 鈕鎖住不給再按(再按可能叫兩台)', async () => {
    h.dispatch.mockResolvedValue({ ok: false, kind: 'needs_human', message: '這一箱已向新竹送出叫車，但無法確認' });
    render(<ShipmentHctDispatchButton shipmentId='s1' shipmentReference='9X2ZD7' />);
    fireEvent.click(screen.getByRole('button', { name: /新竹物流叫車/ }));
    await waitFor(() => expect(screen.getByText(/無法確認/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /新竹物流叫車/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('閘關著(沒送出) ⇒ 印原因, 鈕仍可按', async () => {
    h.dispatch.mockResolvedValue({ ok: false, kind: 'disabled', message: '新竹物流叫車功能尚未開通' });
    render(<ShipmentHctDispatchButton shipmentId='s1' shipmentReference='9X2ZD7' />);
    fireEvent.click(screen.getByRole('button', { name: /新竹物流叫車/ }));
    await waitFor(() => expect(screen.getByText(/尚未開通/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /新竹物流叫車/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
