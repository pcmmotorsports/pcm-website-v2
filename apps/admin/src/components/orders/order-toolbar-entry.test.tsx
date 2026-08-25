// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OrderToolbar } from './order-toolbar';
import { ORDER_DENSITY_DEFAULT, PANEL_CLOSED } from '../../lib/orders/order-list-view';
import { MANUAL_ORDER_PATH } from '../../lib/orders/manual-order-action-state';

// order-toolbar-entry.test.tsx — `#858` 片4:**手動建單那一頁有沒有入口**。
//
// 🔴🔴 **這一格守的不是「鈕長得對不對」,是「那一頁到不到得了」。**
//    2026-08-25 量到的狀態:`/orders/new` 整片(RPC + repository + action + 表單 + 頁面)
//    2026-08-24 就上線了,而**全 admin 571 支 .ts/.tsx 裡沒有任何一支指向它**
//    (`git grep -ln "orders/new"` ⇒ 6 支,逐支開檔全是建單片自己;排除後 0、rc=1;
//     負對照 `git grep -lF` 一個必不存在的路徑 ⇒ 0、rc=1)。
//    ⇒ 那一片的 typecheck / lint / build / 全套測試**當時全綠** ——
//      因為**沒有一格在問「員工走得到嗎」**。這一格就是那一格。
//
// 🔴 **`href` 比對的是常數 `MANUAL_ORDER_PATH`,不是我在這裡打的字串。**
//    寫死字串的話,哪天路由搬家 ⇒ action 的失敗導頁跟著常數走、這顆鈕留在原地,
//    而**兩邊各自都是綠的**。
//
// ⚠️ **邊界(誠實列出,免得這個綠被讀得比它寬)**:靜態 markup、無 React runtime、
//    無 CSS、無真頁面 ⇒ 本檔**不保證**那顆鈕在真畫面上看得見、點得到、沒被蓋住。
//    那是 `order-toolbar-browser.test.tsx` 那條真瀏覽器 harness 的分母,不是本檔的。
const BASE = {
  filter: {},
  display: { density: ORDER_DENSITY_DEFAULT },
  page: 1,
  total: 13,
  panelTarget: PANEL_CLOSED,
} as const;

describe('訂單列表工具列 · 手動建單入口', () => {
  it('有一顆連到 MANUAL_ORDER_PATH 的入口', () => {
    const html = renderToStaticMarkup(<OrderToolbar {...BASE} loadFailed={false} />);
    expect(html).toContain(`href="${MANUAL_ORDER_PATH}"`);
    expect(html).toContain('新增訂單');
  });

  // 🔴 **對照組:這把尺要能印紅。** 沒有這一格,上面那兩個 `toContain` 在
  //    「真的有那顆鈕」與「我拿了一個恆真的字串去比」印同一種綠。
  it('負對照 —— 沒被畫上去的路徑不會命中', () => {
    const html = renderToStaticMarkup(<OrderToolbar {...BASE} loadFailed={false} />);
    expect(html).not.toContain('href="/orders/definitely-not-here"');
  });

  // 🔴 列表讀失敗時**入口仍在**(`order-toolbar.tsx` 那段註解的理由):
  //    把入口綁在列表健康上,會讓最需要補單的那一刻剛好沒有入口。
  //    ⚠️ 而同一發要看到「`共 N 筆` 真的不見了」—— 否則這一格證明不了
  //    `loadFailed` 這個 prop 有被讀,它可能只是**兩個世界都印同一份 HTML**。
  it('列表讀失敗時入口仍在,而共 N 筆消失', () => {
    const html = renderToStaticMarkup(<OrderToolbar {...BASE} loadFailed={true} />);
    expect(html).toContain(`href="${MANUAL_ORDER_PATH}"`);
    expect(html).not.toContain('共 13 筆');
  });
});
