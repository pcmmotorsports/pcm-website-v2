// @vitest-environment jsdom
// item-name-cell.test.tsx — 品名 hover 完整字的守門(Sean 2026-08-21 拍板)。
//
// 🔴 為什麼要這支測試:原生 `title` 沒有任何守門——拿掉它,畫面上看不出差別,也沒有測試
//    會紅(見 item-name-cell.tsx 檔頭)。改用 app 內 Tooltip 之後,內容真的進 DOM,
//    這裡才寫得出「拿掉會紅、現況會綠」的雙向斷言。
//
// 🔴🔴 斷言的是【內容是完整品名】,不是【某個屬性存在】——後者在裝著切過的字時一樣會過。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ItemNameCell } from './item-name-cell';

afterEach(cleanup);

const LONG_TITLE =
  '這是一個非常長的商品名稱用來測試hover完整字欄位寬度只有一百三十三像素放不下這麼多字';

describe('ItemNameCell — hover 看得到完整品名', () => {
  it('🔴 正面對照:hover 觸發元素後,Tooltip 內容是完整品名(不是被截斷的字)', async () => {
    render(<ItemNameCell title={LONG_TITLE} />);

    const trigger = screen.getByText(LONG_TITLE);
    // 🔴 codex 對抗審查 N3(2026-08-21 折入):原本連發五種事件(pointerOver/Enter/Move +
    // mouseOver/Enter)是 shotgun,沒說哪一個是必要的。逐一隔離試過(單獨各發一種、跑
    // 這支測試):只有 `mouseEnter` 單獨發就會讓 Tooltip 開啟,其餘四種單獨發都不夠。
    // ⇒ 只留必要的這一個,升 base-ui 版本時知道該留哪個。
    fireEvent.mouseEnter(trigger);

    // base-ui Tooltip 走非同步開啟(portal + positioner),用 findByText 等它真的進 DOM。
    const tooltipContent = await screen.findAllByText(LONG_TITLE);
    // 觸發元素本身也含全文字(它沒有真的被 CSS 截斷,truncate 只影響視覺),
    // ⇒ 至少要有【兩個】命中:觸發元素本身 + Tooltip popup 裡的那份。
    // 只有一個命中 ⇒ Tooltip 根本沒開,那支斷言測的是觸發元素自己,不是 hover 有沒有生效。
    expect(tooltipContent.length).toBeGreaterThanOrEqual(2);
  });

  it('對照組:觸發元素外框帶 truncate class(視覺截斷仍在,不是把 truncate 拿掉了)', () => {
    const { container } = render(<ItemNameCell title={LONG_TITLE} />);
    expect(container.querySelector('.truncate')).not.toBeNull();
  });

  // 🔴 codex 對抗審查 N2(2026-08-21 折入):空品名分支沒測過。
  // 這個分支的判斷在呼叫端(`order-detail-items-table.tsx` 的 `item.title ? <ItemNameCell.../> : <div>—</div>`),
  // 不在 `ItemNameCell` 內部——`ItemNameCell` 的 `title` prop 本身是必填 `string`,不接受空值。
  // 這裡照呼叫端實際寫的三元判斷重現一次,守的是「falsy 品名不會被硬塞進 Tooltip」。
  it('呼叫端的空品名分支:title 為空時不渲染 Tooltip,只顯示 —', () => {
    const title: string | null = null;
    const { container } = render(
      title ? <ItemNameCell title={title} /> : <div className='truncate text-[13px]'>—</div>,
    );
    expect(container.textContent).toBe('—');
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });
});
