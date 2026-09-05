// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 🔴 **mock 要把參數型別寫出來** —— 不寫的話 `mock.calls[0][0]` 的型別是 `never`/空 tuple,
//    而下面那格「按下去送了什麼」就【斷言不到任何東西】(typecheck 會紅, 而那是它做對了)。
type UpdateArgs = { idempotencyKey: string; shipmentId: string; trackingNumber: string };
const mocks = vi.hoisted(() => ({
  updateShipmentTrackingAction: vi.fn(
    async (_args: { idempotencyKey: string; shipmentId: string; trackingNumber: string }) => ({
      ok: true as const,
    }),
  ),
}));
vi.mock('../../lib/shipping/shipment-actions', () => ({
  updateShipmentTrackingAction: mocks.updateShipmentTrackingAction,
}));

import { ShipmentEditTrackingButton } from './shipment-edit-tracking-button';

// shipment-edit-tracking-button.test.tsx — ⟦5b-TRACKNUMGAP1⟧ 片 B 的守門。
//
// 🔴🔴 **本檔存在的直接理由是一個【typecheck 全綠的 bug】**:
//    我第一版把 `trackingNumberIssue(tracking, carrierCode)` 傳反了。
//    兩個參數都是 `string` ⇒ **型別、lint、既有測試全部綠**, 而那三條單號規則靜靜地全失效。
//    ⇒ 📌 **一個「兩個同型別參數傳反」的錯, 只有【拿真的值去看它說什麼】抓得到。**
//    (codex 對抗審查 2026-09-04 R1 #5 抓到。)

afterEach(cleanup);

const open = () => fireEvent.click(screen.getByRole('button', { name: '更正單號' }));

describe('⟦5b-TRACKNUMGAP1⟧ 片 B · 單號格式檢查真的接上了', () => {
  /**
   * 🔴 **承重**:`hct` + 一個檢查碼對不上的 10 碼數字 ⇒ 會出現警告。
   * 參數傳反時 `carrierCode` 收到的是那串數字 ⇒ `carrierCode !== 'hct'` ⇒ **直接 return null**
   * ⇒ 一個字都不會印。
   */
  it('🔴 hct + 檢查碼對不上的 10 碼 ⇒ 印出警告(參數傳反時這裡是空的)', () => {
    render(
      <ShipmentEditTrackingButton
        shipmentId='sh-1'
        shipmentReference='BCDFGH'
        carrierCode='hct'
        currentTrackingNumber='6412345678'
      />,
    );
    open();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '1234567890' } });
    fireEvent.blur(input);
    expect(
      screen.queryByText(/檢查碼對不上/),
      'hct 的檢查碼規則沒有生效 ⇒ 多半是 trackingNumberIssue 的參數傳反了(兩個都是 string, 型別攔不住)',
    ).not.toBeNull();
  });

  /**
   * 🟢 **負對照**:同一個號碼配 `other` ⇒ **不該**有那個警告。
   * 少了這一格, 一個「對誰都印警告」的實作會通過上一格。
   */
  it('🟢 負對照:同一個號碼配 other ⇒ 沒有 hct 那條警告', () => {
    render(
      <ShipmentEditTrackingButton
        shipmentId='sh-1'
        shipmentReference='BCDFGH'
        carrierCode='other'
        currentTrackingNumber='6412345678'
      />,
    );
    open();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '1234567890' } });
    fireEvent.blur(input);
    expect(screen.queryByText(/檢查碼對不上/)).toBeNull();
  });
});

describe('⟦5b-TRACKNUMGAP1⟧ 片 B · 送不出去的那幾種, 要說得出為什麼', () => {
  it('🔴 單號沒有變 ⇒ 更正鈕是灰的, 而畫面說得出「單號沒有變」', () => {
    render(
      <ShipmentEditTrackingButton
        shipmentId='sh-1'
        shipmentReference='BCDFGH'
        carrierCode='hct'
        currentTrackingNumber='6412345678'
      />,
    );
    open();
    // 🔵 本 repo 沒裝 jest-dom ⇒ 用 DOM 屬性判, 不用 `toBeDisabled`(它會變成 Invalid Chai property)。
    expect((screen.getByRole('button', { name: '更正' }) as HTMLButtonElement).disabled, '該灰而它是亮的').toBe(true);
    expect(screen.queryByText('單號沒有變。')).not.toBeNull();
  });

  it('🔴 清空 + 非 other ⇒ 灰, 而它給的是【做得到的下一步】(去作廢那一箱)', () => {
    render(
      <ShipmentEditTrackingButton
        shipmentId='sh-1'
        shipmentReference='BCDFGH'
        carrierCode='hct'
        currentTrackingNumber='6412345678'
      />,
    );
    open();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
    // 🔵 本 repo 沒裝 jest-dom ⇒ 用 DOM 屬性判, 不用 `toBeDisabled`(它會變成 Invalid Chai property)。
    expect((screen.getByRole('button', { name: '更正' }) as HTMLButtonElement).disabled, '該灰而它是亮的').toBe(true);
    expect(screen.queryByText(/要改成沒有單號請作廢這一箱/)).not.toBeNull();
  });

  it('🟢 負對照:換一個【不一樣且非空】的單號 ⇒ 更正鈕是亮的', () => {
    render(
      <ShipmentEditTrackingButton
        shipmentId='sh-1'
        shipmentReference='BCDFGH'
        carrierCode='other'
        currentTrackingNumber='6412345678'
      />,
    );
    open();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NEW-1' } });
    expect((screen.getByRole('button', { name: '更正' }) as HTMLButtonElement).disabled, '該亮而它是灰的 ⇒ 員工改不了').toBe(false);
  });
});

describe('⟦5b-TRACKNUMGAP1⟧ 片 B · 🔴🔴 按下去要真的送出去', () => {
  /**
   * 🔴🔴 **這一格是 codex R2 E1 逼出來的。**
   * 先前那五格**沒有一格按下可用的「更正」鈕** ⇒ 把整個 `run()` 刪掉、
   * 或送錯 shipmentId / 單號 / 冪等鍵, **五格照樣全綠**。
   * ⇒ 📌 **一組只驗「什麼時候是灰的」的測試, 對「按下去做了什麼」零判別力。**
   */
  it('🔴 換一個新單號按下去 ⇒ action 收到【正確的三個值】', async () => {
    mocks.updateShipmentTrackingAction.mockClear();
    render(
      <ShipmentEditTrackingButton
        shipmentId='sh-42'
        shipmentReference='BCDFGH'
        carrierCode='other'
        currentTrackingNumber='6412345678'
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '更正單號' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  NEW-9  ' } });
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    await vi.waitFor(() => expect(mocks.updateShipmentTrackingAction).toHaveBeenCalledTimes(1));
    const arg = mocks.updateShipmentTrackingAction.mock.calls[0]?.[0] as UpdateArgs;
    expect(arg.shipmentId, '送錯箱 ⇒ 改到別人的單號').toBe('sh-42');
    // 🔴 前後空白要被去掉 —— 沒去掉的話 DB 存進一個帶空白的單號, 而客人拿它去查會查不到。
    expect(arg.trackingNumber, '沒有 trim ⇒ 存進一個帶空白的單號').toBe('NEW-9');
    // 🔴 冪等鍵要有值 —— 沒有的話 DB 那層的重放保護整條失效。
    expect(typeof arg.idempotencyKey === 'string' && arg.idempotencyKey.length > 0, '冪等鍵是空的').toBe(true);
  });

  it('🟢 負對照:鈕是灰的時候按下去 ⇒ action 一次都沒被呼叫', async () => {
    mocks.updateShipmentTrackingAction.mockClear();
    render(
      <ShipmentEditTrackingButton
        shipmentId='sh-42'
        shipmentReference='BCDFGH'
        carrierCode='other'
        currentTrackingNumber='6412345678'
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '更正單號' }));
    // 單號沒有變 ⇒ 灰
    fireEvent.click(screen.getByRole('button', { name: '更正' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.updateShipmentTrackingAction).toHaveBeenCalledTimes(0);
  });
});
