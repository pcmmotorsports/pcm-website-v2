// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// 🔴 **片 C 之後本元件不再是純顯示** —— 它 render 那顆鈕, 而那顆鈕 import server actions
//    ⇒ 直接 import 會炸「This module cannot be imported from a Client Component module.」
//    📌 **一個「只是多畫一顆鈕」的改動, 把這支檔從【零依賴】變成【拉進 server-only】。**
//    ⇒ 而它的症狀是【整支測試檔載不起來】, 不是某一格紅 —— 兩者在「紅了幾格」上長得不一樣:
//      前者印「Test Files 1 failed」而 Tests 那一行【少算了整支檔】。
const resetHctUnknownToDraftAction = vi.fn();
vi.mock('../../lib/shipping/shipment-actions', () => ({ resetHctUnknownToDraftAction }));

const { ShipmentHctUnknownNotice } = await import('./shipment-hct-unknown-notice');

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

describe('⟦ship-HCTUNKNOWNSTUCK⟧ 片 C · 出口只給【甲型】', () => {
  it('🔴🔴 乙型(新竹回過話)⇒ 那顆鈕【不出現】—— 不是 disabled', () => {
    render(
      <ShipmentHctUnknownNotice
        hctStatus='unknown'
        shipmentId='sid-1'
        shipmentReference='BCDFGH'
        placeholderStuck={false}
      />,
    );
    // 🛑 **不出現, 不是 disabled** —— 一顆 disabled 的鈕會讓人去找「怎麼把它變成可按」,
    //    而乙型今天沒有安全的答案(等 Q-新竹傳輸方式)。
    expect(screen.queryByText(/放回草稿/)).toBeNull();
    // 🟢 而那句「查詢功能未接」要留著 —— 它是乙型今天唯一的說明。
    expect(screen.getByText(/查詢功能未接/)).toBeTruthy();
  });

  it('🟢 正對照:甲型 ⇒ 那顆鈕出現(證明上面那個 null 不是因為它永遠不畫)', () => {
    render(
      <ShipmentHctUnknownNotice
        hctStatus='unknown'
        shipmentId='sid-1'
        shipmentReference='BCDFGH'
        placeholderStuck
      />,
    );
    expect(screen.getByText(/放回草稿/)).toBeTruthy();
  });

  it('🔴 甲型而【少了座標】⇒ 也不出現 —— 一顆按了會炸的鈕比沒有鈕糟', () => {
    render(<ShipmentHctUnknownNotice hctStatus='unknown' placeholderStuck />);
    expect(screen.queryByText(/放回草稿/)).toBeNull();
  });

  it('🔴 展開之後【空白就不給按】—— 而 server 與 DB 那兩層也各擋一次', () => {
    // 🔵 用 `fireEvent` 不用 `user-event` —— **後者沒裝, 而這一格不值得加一顆新依賴。**
    render(
      <ShipmentHctUnknownNotice
        hctStatus='unknown'
        shipmentId='sid-1'
        shipmentReference='BCDFGH'
        placeholderStuck
      />,
    );
    fireEvent.click(screen.getByText(/放回草稿/));
    const confirm = screen.getByRole('button', { name: '確認放回草稿' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    // 🟢 正對照:打了字 ⇒ 才可以按(證明上面那個 disabled 不是永遠的)。
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '14:30 電話向新竹確認查無此單' },
    });
    expect(screen.getByRole('button', { name: '確認放回草稿' }).hasAttribute('disabled')).toBe(
      false,
    );
    // 🔴 而【到這裡為止 action 一次都沒被呼叫】—— 打字不等於送出。
    expect(resetHctUnknownToDraftAction).not.toHaveBeenCalled();
  });

  it('🔴 那段警告要講得出【代價】, 不是只說「請確認」', () => {
    render(
      <ShipmentHctUnknownNotice
        hctStatus='unknown'
        shipmentId='sid-1'
        shipmentReference='BCDFGH'
        placeholderStuck
      />,
    );
    // 展開前只有那一行鈕的字 —— 代價那段在展開之後。
    expect(screen.getByText(/我已向新竹確認/)).toBeTruthy();
  });
});
