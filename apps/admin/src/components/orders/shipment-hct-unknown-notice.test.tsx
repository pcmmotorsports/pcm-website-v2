// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ShipmentHctUnknownNotice } from './shipment-hct-unknown-notice';

afterEach(cleanup);

describe('⟦ship-HCTUNKNOWNSTUCK⟧ 的紅字', () => {
  it('unknown ⇒ 出現, 而且逐字含「不要重送」', () => {
    render(<ShipmentHctUnknownNotice hctStatus='unknown' />);
    // 🔴 那四個字是這一片存在的理由 —— 員工看到卡住時唯一會做的事就是再按一次。
    expect(screen.getByText(/不要重送/)).toBeTruthy();
  });

  it('🔵 而它同時要說出「為什麼今天不能查」—— 否則員工會去找那顆不存在的鈕', () => {
    render(<ShipmentHctUnknownNotice hctStatus='unknown' />);
    expect(screen.getByText(/查詢功能未接/)).toBeTruthy();
  });

  it.each(['draft', 'submitted', 'failed'])('%s ⇒ 一個字都不畫(對每箱都說話的提示會被忽略)', (st) => {
    const { container } = render(<ShipmentHctUnknownNotice hctStatus={st} />);
    expect(container.textContent).toBe('');
  });

  // 🟢 負對照:值域外的東西不得被當成 unknown ——
  //    DB 的 CHECK 保證值域, 而**保證是別人給的**, 這裡自己再問一次。
  it('值域外的字串 ⇒ 不畫(不把未知當成 unknown)', () => {
    const { container } = render(<ShipmentHctUnknownNotice hctStatus='UNKNOWN' />);
    expect(container.textContent).toBe('');
  });
});
