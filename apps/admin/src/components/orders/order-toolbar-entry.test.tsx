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
    //
    //    🔴🔴 **而這條教訓【正本已經有了】,本檔不重寫一份 —— 去讀它:**
    //       `docs/patterns/guard-and-instrument-traps.md:22399`
    //       逐字標題「**一個負對照,只要被公開就會被消耗掉 —— 而消耗它的正是它做對事的那一次**」
    //       (2026-08-25,線2 發現)。它連處置都寫好了:
    //         「負對照的靶不要固定、也不要公告;每次量測**當場挑一個**,並在同一發裡驗它回 0。」
    //         「寫下負對照時,同一行寫『**這個靶的乾淨度要當場重驗**』,
    //           不要寫『⇒ 0』當成一個永久事實。」
    //       ⚠️ 它自己標了一個**沒解的矛盾**,原樣轉述:不公告 ⇒ 每個人各挑各的
    //         ⇒ 沒有人知道別人的靶乾不乾淨。**目前沒有解法。**
    //
    //    📌 **而「我怎麼找到它的」值得記,因為排名沒找到它**:
    //       `python3 scripts/traps-neighbours.py <草稿>` 的前 8 名**沒有這一條**
    //       (最高 0.3920,是另一族);撈到它的是工具自己叫我補跑的那一步 ——
    //       **拿機制關鍵字 grep 標題行**(`grep -n '^#.*負對照' <正本>` ⇒ 11 行,`:22399` 在裡面)。
    //       ⇒ 那支工具的檔頭把這件事列為已知失效①/②,而它**這次真的發生了**。
    //         **排名沒撞,不代表沒撞。**
    //
    //    ⚠️ **關於 `c1a48918` 我先前寫過一句假話,更正在這裡**(原句已刪,因為它會誤導):
    //       我曾寫「它是今晚唯一通過自指測試的範本」。**它是一半對一半錯**,而那是
    //       **兩個不同的字串、短版是長版的前綴**(所以用短版 grep 會命中長版,反過來不會)。
    //       我自己複量(不是照抄轉述):
    //         body  `git show c1a48918 --format='%b' -s` ⇒ `:37` 靶是 `IZzzFakeMailCannonXYZ`(帶 XYZ)
    //         檔案  `git grep -n 'IZzzFakeMailCannon' c1a48918 -- <正本>` ⇒ `:16357`(不帶 XYZ)
    //         在那棵樹上分開量:長版 ⇒ rc=1(**沒被污染,body 那個靶還活著**)
    //                          短版 ⇒ rc=0(命中,就是 `:16357` 那一行自己)
    //       ⇒ 而**不要把它讀成「body 那一半做對了」** —— 它活著是**運氣,不是設計**:
    //         寫進檔案的剛好是**短一截**的那個字串,而 body 用的是長版。
    //
    //    🔴🔴 **今晚三顆被重掃,三顆【全部】把靶寫進了檔案 —— 0 顆通過。**
    //       (cf 對抗審查掃 9 顆,主視窗複量;我自己複跑了其中兩顆,見下。)
    //       ```
    //       顆        靶                         父  本顆  照 body 量法重跑  它為什麼還活著
    //       fc6a1edf  orders/definitely-not-here  0   1    🔴 1(body 說 0)  沒活 = 本檔這一格
    //       4713a0c4  enqueueOrderZzzFakeEmails   0   1    ✅ 0             body 量法帶 `-- apps`
    //                                                                        而它寫進的檔在 docs/
    //       c1a48918  IZzzFakeMailCannonXYZ       0   0    ✅ 0             寫進檔的是【短版】
    //       ```
    //       我自己複跑的那兩顆(不是照抄):
    //         `git grep -l 'enqueueOrderZzzFakeEmails' 4713a0c4^ -- .`     ⇒ rc=1 父不在
    //         `git grep -l 'enqueueOrderZzzFakeEmails' 4713a0c4  -- .`     ⇒ rc=0
    //                             命中 `docs/specs/2026-07-25-admin-backend-rebuild-spec.md`
    //         `git grep -l 'enqueueOrderZzzFakeEmails' 4713a0c4  -- apps`  ⇒ rc=1 被 pathspec 排掉
    //       ⇒ 🔴 **兩顆「重跑仍回 0」的理由都不是設計:一個是 pathspec 剛好排除了 `docs/`,
    //         一個是字串剛好短一截。任何一個下次不帶 pathspec、或用短版去 grep 的人,
    //         都會拿到 1 而不知道為什麼。**
    //       ⇒ **不要拿任何一顆當範本。「量法帶 pathspec」不算保護,那是運氣。**
    //       🔴 而我第一次複量時 `git grep … | head -3` 然後讀 `$?` ——
    //          **那個 `$?` 是 `head` 的**,兩發都印 0。改成 `cmd > file 2>&1 ; RC=$?` 才拿到真值。
    //    ⇒ 要重驗那一發,請換一個**沒有寫進任何檔案**的新字串。
    //
    //    ⚠️ 同族的第二格:`fc6a1edf` body 另有「排除建單片後 ⇒ 0」,**今天是 2** ——
    //       而多出來的兩支正是 `order-toolbar.tsx` 與本檔,**也就是那顆 commit 自己**。
    //
    //    ~~本行的斷言本身沒有問題(它比的是 render 出來的 HTML,不是 repo 檔案),照留。~~
    //
    // 🔴🔴 **上面那句話是錯的, 2026-08-27 補審抓到(`fc6a1edf` / `fdcc15d2` / `4054b80d` 補跑 code-reviewer)。**
    //    原本這一格只有 `not.toContain('href="/orders/definitely-not-here"')`。
    //    ⚠️ **精確講**(2026-08-27 codex nit 訂正我上一版的措辭):它**不是**「對任何輸入都綠」——
    //       真的畫出那個 href 它就會紅。**而那個世界不存在**:沒有任何一條路會讓這支元件吐出
    //       一個誰都沒寫過的路徑 ⇒ 它守的是一個**構造不出來的失敗**。
    //    ⇒ 實際的缺陷是:**大量真的會發生的壞輸出全部通過** ——
    //       `html` 是 `''`、元件回 `null`、href 打錯成 `/orders/newx`… 它一格都不紅。
    //    ⇒ 它自稱「對照組:這把尺要能印紅」,而**它印得出紅的那一發, 是永遠不會來的那一發**。
    //
    //    📌 **而這一格最該記的不是「有一條恆真斷言」, 是【誰沒抓到它】:**
    //       `fdcc15d2` 與 `4054b80d` 兩顆 commit **就是專程來修這把尺的**,
    //       兩顆合計 67 行全在談上面那個字串的自指性 —— **而沒有一顆問過「這一格印得出紅嗎」。**
    //       ⇒ **修尺的兩刀, 一刀都沒落在尺上。** 而兩顆的三綠全綠、訊息都說修好了。
    //
    // ⇒ 補成真的能印紅的形狀(下面三發, 缺一發這一格就退回恆真):
    //    ① `html` 非空 —— 沒有這一發, 下面兩個 `not.toContain` 在空字串上恆綠
    //    ② 近似靶:真路徑後面多一個字元 ⇒ 證明比對是**貼著那個 href 值**,
    //       不是「只要 HTML 裡有 `orders/` 就算」
    //    ③ 原本那一發留著(它擋的是「畫了一條不該存在的路徑」)
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain(`href="${MANUAL_ORDER_PATH}x"`);
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
