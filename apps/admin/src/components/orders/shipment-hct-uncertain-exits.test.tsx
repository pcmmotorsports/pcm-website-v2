// @vitest-environment jsdom
// 「叫車結果未確認」的兩個出口(2026-09-28 出貨流程乙第 8 項;計畫第二節第 8 項)。
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ mark: vi.fn(), redispatch: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock('../../lib/shipping/shipment-actions', () => ({ markShipmentShippedAction: h.mark }));
vi.mock('../../lib/shipping/shipment-redispatch-hct-action', () => ({ redispatchShipmentAction: h.redispatch }));

import { ShipmentHctUncertainExits } from './shipment-hct-uncertain-exits';

const LAST = { lastNo: 1, lastAt: '2026-09-28T01:00:00Z' };
const props = (over: Partial<Parameters<typeof ShipmentHctUncertainExits>[0]> = {}) => ({
  shipmentId: 's1',
  shipmentReference: '9X2ZD7',
  edelno: '8947081999',
  lastAttempt: LAST,
  serverNow: '2026-09-28T01:10:00Z',
  ...over,
});

beforeEach(() => {
  h.mark.mockResolvedValue({ ok: true });
  h.redispatch.mockResolvedValue({ ok: true, kind: 'dispatched', edelno: '8947081999' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShipmentHctUncertainExits', () => {
  it('🔴 新竹說已收走 ⇒ 一鍵標記出貨:單號用這一箱的新竹貨號、等同勾了「新竹已經把貨收走了」', async () => {
    render(<ShipmentHctUncertainExits {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /新竹說已收走/ }));
    await waitFor(() => expect(h.mark).toHaveBeenCalledTimes(1));
    expect(h.mark).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 's1', trackingNumber: '8947081999', hctPickedUpConfirmed: true }));
    expect(await screen.findByText('已標記出貨。')).toBeTruthy();
  });

  it('🔴 伺服器擋下(例如這張單已退款)⇒ 原話顯示;重按沿用同一把鍵', async () => {
    h.mark.mockResolvedValue({ ok: false, message: '這張單已退款，不能標記出貨。' });
    const { container } = render(<ShipmentHctUncertainExits {...props()} />);
    // 🔴 2026-09-28 全套測試偶發紅(第二次按下只呼叫到 1 次):原因是訊息先畫出來、按鈕過一次畫面才解除停用,
    //    負載高時第二次按下落在中間那一格(按在停用的按鈕上沒反應)。元件已改成同一次畫面一起更新;
    //    這裡逐次記錄畫面變化, 釘住「訊息出現的那一刻按鈕已經能按」。
    const disabledWhenMessageShown: boolean[] = [];
    const mo = new MutationObserver(() => {
      if (container.textContent?.includes('這張單已退款')) {
        disabledWhenMessageShown.push((screen.getByRole('button', { name: /新竹說已收走/ }) as HTMLButtonElement).disabled);
      }
    });
    mo.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    fireEvent.click(screen.getByRole('button', { name: /新竹說已收走/ }));
    expect(await screen.findByText('這張單已退款，不能標記出貨。')).toBeTruthy();
    mo.disconnect();
    expect(disabledWhenMessageShown).not.toContain(true);
    fireEvent.click(screen.getByRole('button', { name: /新竹說已收走/ }));
    await waitFor(() => expect(h.mark).toHaveBeenCalledTimes(2));
    expect(h.mark.mock.calls[1]![0].idempotencyKey).toBe(h.mark.mock.calls[0]![0].idempotencyKey);
  });

  it('🔴 上一次叫車未滿 10 分鐘 ⇒ 沒有重新叫車鈕, 說幾點以後可以', () => {
    render(<ShipmentHctUncertainExits {...props({ serverNow: '2026-09-28T01:09:59Z' })} />);
    expect(screen.queryByRole('button', { name: /重新叫車/ })).toBeNull();
    expect(screen.getByText(/上一次叫車在 09:00，09:10 以後/)).toBeTruthy();
  });

  it('🔴 讀不到叫車紀錄 ⇒ 沒有重新叫車鈕', () => {
    render(<ShipmentHctUncertainExits {...props({ lastAttempt: null })} />);
    expect(screen.queryByRole('button', { name: /重新叫車/ })).toBeNull();
    expect(screen.getByText(/讀不到這一箱的叫車紀錄/)).toBeTruthy();
  });

  it('🔴 滿 10 分鐘 ⇒ 按重新叫車先出現提醒, 按「確認」才送出(帶畫面看到的次數);取消就不送', async () => {
    render(<ShipmentHctUncertainExits {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /重新叫車/ }));
    expect(screen.getByTestId('redispatch-confirm').textContent).toContain('請確定新竹說沒派到車才按，否則可能來兩台車。');
    expect(h.redispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(h.redispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /重新叫車/ }));
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(h.redispatch).toHaveBeenCalledWith({ shipmentId: 's1', expectedAttemptNo: 1 }));
    expect(await screen.findByText(/已叫到車（貨號 8947081999）/)).toBeTruthy();
  });

  it('🔴 重新叫車送出後(不論結果)鈕鎖住, 不能連按', async () => {
    h.redispatch.mockResolvedValue({ ok: false, kind: 'needs_human', message: '無法確認是否叫到車' });
    render(<ShipmentHctUncertainExits {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /重新叫車/ }));
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(await screen.findByText('無法確認是否叫到車')).toBeTruthy();
    expect((screen.getByRole('button', { name: /重新叫車/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
