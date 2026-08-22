// @vitest-environment jsdom
// item-name-cell.test.tsx — 品名 hover 完整字的守門(Sean 2026-08-21 拍板)。
//
// 🔴 為什麼要這支測試:原生 `title` 沒有任何守門——拿掉它,畫面上看不出差別,也沒有測試
//    會紅(見 item-name-cell.tsx 檔頭)。改用 app 內 Tooltip 之後,內容真的進 DOM,
//    這裡才寫得出「拿掉會紅、現況會綠」的雙向斷言。
//
// 🔴🔴 斷言的是【內容是完整品名】,不是【某個屬性存在】——後者在裝著切過的字時一樣會過。
//
// 🔴 2026-08-22:品名改成【原地換行、不再切字】(Sean 看圖挑 ②)。
//    Tooltip 因此變成多餘的,而**刻意保留**——見 item-name-cell.tsx 檔頭「由他決定」那段。
//    ⇒ 下面那兩格 hover 的測試仍然有效,它們守的是「Tooltip 還在而且裝的是完整品名」。

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

  // 🔴🔴 **這一格 2026-08-22 被【故意】翻面了 —— 而翻面的是【規格】不是實作。**
  //    ~~原本斷言:「觸發元素外框帶 truncate class(視覺截斷仍在)」~~
  //    Sean 2026-08-21 拍「維持切字 + hover」,2026-08-22 看了八張實體版本的圖之後改挑
  //    「② 原地換行」⇒ **切字這件事本身被推翻了**,而這一格原本正在守著它。
  //    ⚠️ 我沒有偷偷改掉一個礙事的測試:**是它守的那個決定被上游改掉了。**
  //    ⇒ 這裡改成守【新的】決定,而且是雙向的:不准有 truncate、必須有換行。
  it('🔴 品名【不准】再切字:沒有 truncate,而且有 break-words(Sean 2026-08-22 挑 ②)', () => {
    const { container } = render(<ItemNameCell title={LONG_TITLE} />);
    expect(container.querySelector('.truncate')).toBeNull();
    expect(container.querySelector('.break-words')).not.toBeNull();
  });

  // ⚠️ **這一格量的是【形狀】不是【行為】,而我知道差別。**
  //    jsdom 沒有排版引擎 ⇒ `scrollWidth` / `clientWidth` 恆為 0
  //    ⇒ 「這段字有沒有被裁掉」在這裡**量不到**,量得到的只有 class 名。
  //    🔴 行為那半的證據是【真瀏覽器實量 + 截圖】,寫在
  //       `~/pcm-mailbox/E-026-品名原地換行-交件-20260822.md`,而**它不會每天重跑**。
  //    ⇒ 引用本檔的綠燈時請帶著這個限定:它擋得住「有人把 truncate 加回來」,
  //       擋不住「有別的 CSS 從外面把它裁掉」。
  it('完整品名整段都在 DOM 的可見文字裡(不是只存在於 Tooltip 那份)', () => {
    const { container } = render(<ItemNameCell title={LONG_TITLE} />);
    const trigger = container.querySelector('.break-words');
    expect(trigger?.textContent).toBe(LONG_TITLE);
  });

  // 🔴 codex 對抗審查 N2(2026-08-21 折入):空品名分支沒測過。
  // 這個分支的判斷在呼叫端(`order-detail-items-table.tsx` 的 `item.title ? <ItemNameCell.../> : <div>—</div>`),
  // 不在 `ItemNameCell` 內部——`ItemNameCell` 的 `title` prop 本身是必填 `string`,不接受空值。
  // 這裡照呼叫端實際寫的三元判斷重現一次,守的是「falsy 品名不會被硬塞進 Tooltip」。
  it('呼叫端的空品名分支:title 為空時不渲染 Tooltip,只顯示 —', () => {
    const title: string | null = null;
    const { container } = render(
      // 這一支 fallback 只裝一個破折號 ⇒ 它的 truncate 不影響品名那題, 刻意沒動。
      title ? <ItemNameCell title={title} /> : <div className='truncate text-[13px]'>—</div>,
    );
    expect(container.textContent).toBe('—');
    expect(container.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });
});
