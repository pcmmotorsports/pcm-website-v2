// @vitest-environment jsdom
// shipment-mark-shipped-button.test.tsx — `#551` R1 MF1 折出來的守門檔。
//
// 🔴🔴 **這支元件在本檔之前【一格測試都沒有】**
//    (數法:`ls apps/admin/src/components/orders/ | grep mark-shipped` ⇒ 落筆前只有 `.tsx` 一個檔)。
//    而它是「先建箱不出貨 → 之後填單號並標記出貨」那條路的**唯一入口**。
//
// ⚠️ **MF1 的形狀值得記**:我把貨號格式檢查裝進建箱彈窗、跑完三綠、跑完突變,
//    每一格都綠 —— 而**另外那半條路完全沒守**,因為我只看了自己動過的那個檔。
//    ⇒ 「這條規則裝好了」與「所有進得來的入口都裝了」是兩件事。
//    📎 數法:`git grep -ln 'trackingNumber' -- apps/admin/src/components` 列出所有碰單號的畫面,
//       再逐個問「它送不送單號」,而不是只看自己改的那支。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { markShipmentShippedAction } = vi.hoisted(() => ({ markShipmentShippedAction: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/shipment-actions', () => ({ markShipmentShippedAction }));

import { ShipmentMarkShippedButton } from './shipment-mark-shipped-button';

afterEach(cleanup);

/** 展開輸入框(元件預設只畫一顆「填單號並標記出貨」)。 */
function open(carrierCode = 'hct') {
  render(
    <ShipmentMarkShippedButton shipmentId='s-1' shipmentReference='K7X2MP' carrierCode={carrierCode} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '填單號並標記出貨' }));
  const input = screen.getByLabelText(/貨運單號/);
  return {
    input,
    /** 🔴 打完 blur —— R2 F-A 之後離開欄位才評價格式。 */
    type: (v: string) => {
      fireEvent.change(input, { target: { value: v } });
      fireEvent.blur(input);
    },
    submit: () => screen.getByRole('button', { name: '標記出貨' }),
  };
}
const VALID = '1234567891'; // 123456789 % 7 = 1

describe('🔴 #551 MF1:這條路也要有貨號守門(它是「先建箱、後出貨」的唯一入口)', () => {
  it('🔴🔴 超過上限 39 位 ⇒ 只警告,**按鈕仍然可以按**(本片不擋任何東西)', () => {
    const { type: t, submit } = open();
    t('1'.repeat(40));
    expect(screen.queryByText(/最長 39 位/)).not.toBeNull();
    expect(submit().hasAttribute('disabled')).toBe(false);
  });

  it('🔴🔴 檢查碼不對 ⇒ 警告但【不擋】(與建箱彈窗同一支 lib、同一個分級)', () => {
    const { type: t, submit } = open();
    t('1234567890');
    expect(submit().hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/檢查碼對不上/)).not.toBeNull();
  });

  it('合法貨號 ⇒ 可送、無警告', () => {
    const { type: t, submit } = open();
    t(VALID);
    expect(submit().hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/檢查碼對不上/)).toBeNull();
  });

  it('🔴 順豐不驗 —— 配同值餵 hct 的正向對照,證明不是測資剛好合法', () => {
    const sf = open('sf');
    sf.type('1234567890');
    expect(screen.queryByText(/檢查碼對不上/)).toBeNull();
    cleanup();
    // 正向對照:同一個值在 hct 下立刻被擋。
    const hct = open('hct');
    hct.type('1234567890');
    expect(screen.queryByText(/檢查碼對不上/)).not.toBeNull();
  });

  it('既有那道「非 other 必須有單號」沒有被我改壞', () => {
    const { submit } = open('hct');
    expect(submit().hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('請先填貨運單號。')).not.toBeNull();
    cleanup();
    // other:留空可送(DB CHECK `shipments_shipped_needs_tracking` 就是這樣寫的)。
    const other = open('other');
    expect(other.submit().hasAttribute('disabled')).toBe(false);
  });
});
