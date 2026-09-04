// @vitest-environment jsdom
// shipment-hct-submit-button.test.tsx — ⟦ship-HCTAPI⟧ 步驟②
//
// 🔴 **本檔最重要的一格是那個【負對照】**:開關關著時,鈕**必須仍然在畫面上**。
//    plan 逐字:消失時「還沒開通」/「這張單不能送」/「我沒權限」印同一個畫面。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const submitShipmentToHctAction = vi.fn();
vi.mock('../../lib/shipping/shipment-actions', () => ({ submitShipmentToHctAction }));

const { ShipmentHctSubmitButton } = await import('./shipment-hct-submit-button');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = () =>
  render(<ShipmentHctSubmitButton shipmentId='s1' shipmentReference='BCDFGH' />);

describe('三態', () => {
  it('預設:鈕在、可以按', () => {
    mount();
    const b = screen.getByRole('button', { name: /送新竹 BCDFGH/ });
    expect(b).toBeTruthy();
    expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it('🔴 負對照:server 回 disabled ⇒ 鈕【仍然在畫面上】, 而且旁邊寫著那句話', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'disabled',
      message: '新竹未開通(缺 HCT_API_ENDPOINT …)',
    });
    mount();
    const b = screen.getByRole('button', { name: /送新竹/ });
    b.click();
    // 🔵 nit① 之後這裡印的是 **server 給的那句**(含「缺哪一顆 env」), 不是寫死的四個字
    //    ⇒ 逐字比對會紅, 而**它紅得對**:那正是這次改動的內容。
    await vi.waitFor(() => expect(screen.getByText(/新竹未開通/)).toBeTruthy());
    // 🔴 而「缺哪一顆」必須真的出現 —— 否則 nit① 等於沒修
    //    (兩種完全不同的原因印同一句話)。
    expect(screen.getByText(/HCT_API_ENDPOINT/)).toBeTruthy();
    // 🔴 這一行是本檔的重點:它證的是「鈕沒有消失」。
    expect(screen.getByRole('button', { name: /送新竹/ })).toBeTruthy();
    // disabled 不鎖 —— Sean 放了 env 之後不必重整頁面。
    expect((screen.getByRole('button', { name: /送新竹/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('unknown ⇒ 鎖住不給再按, 而且畫面逐字有「不要重按」', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'unknown',
      message: '送出去了而不知道結果 —— 不要重按,請用查詢補問新竹貨號',
    });
    mount();
    screen.getByRole('button', { name: /送新竹/ }).click();
    await vi.waitFor(() =>
      expect(screen.getByText(/不要重按/)).toBeTruthy(),
    );
    expect((screen.getByRole('button', { name: /送新竹/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('needs_confirm ⇒ 不鎖, 文字換成「知道了, 還是要送」, 第二次帶 confirmTruncated', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'needs_confirm',
      message: '這幾欄超長、送出去會被截掉:ercsig —— 看過再按一次就送',
      truncated: ['ercsig'],
      confirmToken: 'ercsig',
    });
    mount();
    screen.getByRole('button', { name: /送新竹/ }).click();
    await vi.waitFor(() => expect(screen.getByText(/會被截掉/)).toBeTruthy());
    const b2 = screen.getByRole('button', { name: /送新竹/ });
    expect((b2 as HTMLButtonElement).disabled).toBe(false);
    expect(b2.textContent).toContain('還是要送');
    b2.click();
    // 🔴 第二次必須帶 confirmTruncated —— 少了它, 員工按第二次還是送不出去(死循環)。
    await vi.waitFor(() =>
      // 🔴 第二次要把 **server 給的那個 token** 原樣帶回去 —— 不是一個寫死的 true。
      //    codex:`true` 是一張空白支票, 它證明不了員工看過【這一次】的內容。
      expect(submitShipmentToHctAction).toHaveBeenLastCalledWith({
        shipmentId: 's1',
        confirmTruncated: 'ercsig',
      }),
    );
  });

  it('failed ⇒ 不鎖(新竹回失敗是可以重試的那一種)', async () => {
    submitShipmentToHctAction.mockResolvedValue({
      ok: false,
      kind: 'failed',
      message: '新竹回了失敗 —— 可以再按一次',
    });
    mount();
    screen.getByRole('button', { name: /送新竹/ }).click();
    await vi.waitFor(() => expect(screen.getByText(/可以再按一次/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /送新竹/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('submitted ⇒ 顯示貨號並鎖住', async () => {
    submitShipmentToHctAction.mockResolvedValue({ ok: true, kind: 'submitted', requestId: 'R1' });
    mount();
    screen.getByRole('button', { name: /送新竹/ }).click();
    await vi.waitFor(() => expect(screen.getByText(/已送出 R1/)).toBeTruthy());
    expect((screen.getByRole('button', { name: /送新竹/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
