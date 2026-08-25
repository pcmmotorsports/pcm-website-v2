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
    // 🔴🔴 **這個字串【現在住在本檔裡】,而那件事有後果:**
    //    `fc6a1edf` 的 commit body 記著一發負對照,逐字
    //    「`git grep -lF "orders/definitely-not-here" -- apps/admin/src` ⇒ 0(rc=1)」——
    //    **那句話在 commit 當下是真的,而今天任何人回去重跑都會得到 1**,
    //    因為**同一顆 commit 把這個字串寫進了這一行**。
    //    ⇒ 那不是當時記錯。**是那發負對照在被寫下來的那一刻就被自己消耗掉了。**
    //
    //    🔴 **判別句(cf 對抗審查 2026-08-25 開的 must-fix,主視窗轉):**
    //       *我這個負對照字串,會不會因為我把它寫下來而變成命中?*
    //    ⇒ 以後負對照字串**只寫在 commit body,不寫進 code / 測試 / 註解**;
    //      要在檔裡留量法就留**量法的形狀**,不留那個具體字串。
    //      今晚的正確範本 = `c1a48918`(線3),它的負對照字串只活在 commit body 裡。
    //    ⇒ 要重驗那一發,請換一個**沒有寫進任何檔案**的新字串。
    //
    //    ⚠️ 同族的第二格:`fc6a1edf` body 另有「排除建單片後 ⇒ 0」,**今天是 2** ——
    //       而多出來的兩支正是 `order-toolbar.tsx` 與本檔,**也就是那顆 commit 自己**。
    //
    //    本行的斷言本身沒有問題(它比的是 render 出來的 HTML,不是 repo 檔案),照留。
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
