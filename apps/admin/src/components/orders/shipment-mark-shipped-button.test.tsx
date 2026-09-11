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

/**
 * 展開輸入框(元件預設只畫一顆「填單號並標記出貨」)。
 * ⟦走查 F8⟧ 新竹的箱子從此要先勾「新竹已經把貨收走了」才按得下去(Sean 09-11 拍乙)
 *   ⇒ 本 helper 預設照真實流程把它勾起來, 讓下面那些「貨號格式擋不擋」的格子仍然只量貨號那一道;
 *   `confirm: false` 給專門量那一格的測試用。斷言一個都沒改。
 */
function open(carrierCode = 'hct', { confirm = true }: { confirm?: boolean } = {}) {
  render(
    <ShipmentMarkShippedButton shipmentId='s-1' shipmentReference='K7X2MP' carrierCode={carrierCode} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '填單號並標記出貨' }));
  const confirmBox = screen.queryByRole('checkbox', { name: /新竹已經把貨收走了/ });
  if (confirm && confirmBox !== null) fireEvent.click(confirmBox);
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

// ── ⟦走查 F8⟧ 2026-09-11:新竹要先勾「新竹已經把貨收走了」(server 那一側另有測試)──────
describe('⟦走查 F8⟧ 新竹手打標出貨要先勾確認', () => {
  it('🔴 新竹、單號合法、沒勾 ⇒ 按不下去, 而且說出要勾什麼', () => {
    const { type: t, submit } = open('hct', { confirm: false });
    t(VALID);
    expect(submit().hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(/要先勾「新竹已經把貨收走了」/)).not.toBeNull();
  });

  it('勾了 ⇒ 按得下去, 送出時帶 hctPickedUpConfirmed: true', async () => {
    markShipmentShippedAction.mockResolvedValue({ ok: true });
    const { type: t, submit } = open('hct');
    t(VALID);
    expect(submit().hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit());
    await vi.waitFor(() => expect(markShipmentShippedAction).toHaveBeenCalled());
    expect(markShipmentShippedAction.mock.calls.at(-1)?.[0]).toMatchObject({ hctPickedUpConfirmed: true });
  });

  it('對照:順豐 / 其他 ⇒ 沒有那一格, 也不擋', () => {
    open('sf', { confirm: false });
    expect(screen.queryByRole('checkbox', { name: /新竹已經把貨收走了/ })).toBeNull();
    cleanup();
    const other = open('other', { confirm: false });
    expect(screen.queryByRole('checkbox', { name: /新竹已經把貨收走了/ })).toBeNull();
    expect(other.submit().hasAttribute('disabled')).toBe(false);
  });

  it('🔴 沒勾時貨號格式警告照樣看得到(那一格不得把警告藏掉)', () => {
    const { type: t } = open('hct', { confirm: false });
    t('1234567890');
    expect(screen.queryByText(/檢查碼對不上/)).not.toBeNull();
  });
});
