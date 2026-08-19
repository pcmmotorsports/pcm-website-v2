// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, type Browser } from 'playwright';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrderToolbar } from './order-toolbar';
import { ORDER_DENSITY_DEFAULT, PANEL_CLOSED } from '../../lib/orders/order-list-view';

// order-toolbar-browser.test.tsx — `#485` 片5b:工具列的**真瀏覽器**量測。
//
// 🔴🔴 **為什麼非真瀏覽器不可 —— 這一列的每一個既有守門都看不到它要守的東西:**
//    · `order-filter-chips.test.tsx` 的 postcss 那族 = **CSS 檔裡的字面**
//    · 同檔片4 的容量那族 = **算式模型**(我自己乘出來的寬度)
//    ⇒ 兩者都**不是瀏覽器算出來的用值**。跨選擇器特異性、`box-sizing`、字體實際字身寬,
//      它們一個都看不到。**實錘 `#486`:CSS 字面寫 36、瀏覽器用值是 30。**
//
// 🔴 **harness 形狀**(沿用 `cancel-forms-browser.test.tsx` 那條既有的路):
//    `postcss(globals.css)` → `renderToStaticMarkup(<OrderToolbar/>)` → node http → playwright。
//    全程在一個測試程序內、**無 fixture 檔** ⇒ 不會有「HTML 或 CSS 過期」那種假綠。
//
// 🔴 **CSS 是當場編的,不讀 `.next` 建置產物** —— 讀建置產物會把這支測試綁死在
//    「有沒有 build 過」+「每次 build 都在變的檔名」上,那是**會在別人機器上壞掉、
//    在我機器上永遠是綠的**依賴。當場編實測 ~120ms。
//
// ⚠️ **被合成的東西,逐條列出(誠實邊界)**:
//    ① **沒有真的 Next 頁面**:沒有側欄 DOM、沒有 header、沒有資料列。
//       版面幾何用一個寬度 = `視窗 − 側欄` 的容器 + `p-6` 合成,兩個常數的出處見 `SHELL_*`。
//    ② **沒有 React runtime**(靜態 HTML)⇒ 任何需要 hydration 才會發生的事,本檔測不到。
//    ③ 量的是**這一列自己**,不是它在整頁裡跟別的區塊的互動。
const DEN = { density: ORDER_DENSITY_DEFAULT } as const;

/**
 * 版面幾何 —— **兩個常數都有出處,不是挑的**(同片4 那族,刻意用同一組來源):
 * · 內容容器 `p-6` ⇒ 左右各 24 ⇒ 扣 48 —— `components/layout/workspace-shell.tsx`
 *   的 `workspace-content min-w-0 flex-1 p-6`
 * · 側欄 9rem = 144 —— `components/ui/sidebar.tsx` 的 `SIDEBAR_WIDTH`;
 *   而它掛 `hidden md:block` ⇒ **<768 的窄版側欄不佔寬**(變覆蓋式抽屜)
 */
const CONTENT_PADDING = 48;
const SIDEBAR_EXPANDED = 144;
const sidebarAt = (viewport: number) => (viewport < 768 ? 0 : SIDEBAR_EXPANDED);

const ADMIN_SRC = join(__dirname, '../..');

let browser: Browser;
let css = '';
beforeAll(async () => {
  const globals = join(ADMIN_SRC, 'app/globals.css');
  // 🔴 `as postcss.AcceptedPlugin[]`:`@tailwindcss/postcss` 的型別與 `postcss` 的
  //    `AcceptedPlugin` 比對會炸 `TS2321 Excessive stack depth`(遞迴型別過深),
  //    **不是型別真的不相容** —— 實跑產物 85,687 bytes、十個 utility 全命中。
  //    ⚠️ vitest 不跑型別檢查 ⇒ 這條只有 `typecheck`/`build` 抓得到(本片實際紅過一次)。
  const compiled = await postcss([tailwindcss()] as postcss.AcceptedPlugin[]).process(
    readFileSync(globals, 'utf8'),
    { from: globals },
  );
  css = compiled.css;
  browser = await chromium.launch();
}, 120_000);
// 🔴 `afterAll` 的 timeout 要跟 `beforeAll` 一樣長(`#334` 記過):沒給的話吃預設 10 秒,
//    機器忙的時候會出現「檔案紅、但零個測試紅」的收尾逾時,而且重跑就綠 ⇒ 最容易被誤記成 flake。
afterAll(async () => {
  await browser?.close();
}, 120_000);

type Measured = {
  可用寬: number;
  chip: { 文字: string; 寬: number; 高: number; 命中寬: number; 命中高: number }[];
  三顆總寬: number;
  整列高: number;
  chip獨佔一行: boolean;
  橫向捲軸: boolean;
};

/**
 * 把工具列掛上 server、用 playwright 在指定視窗寬量一次。
 * @param extraCss 只給「判別力自檢」那格用:注入一條**更高特異性**的規則,
 *                 讓 `globals.css` 的字面**一個字都沒變**而瀏覽器用值變掉。
 */
async function measure(viewport: number, extraCss = ''): Promise<Measured> {
  const markup = renderToStaticMarkup(
    <OrderToolbar
      filter={{}}
      display={DEN}
      page={1}
      total={13}
      loadFailed={false}
      panelTarget={PANEL_CLOSED}
    />,
  );
  const shellWidth = viewport - sidebarAt(viewport);
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>${extraCss ? `<style>${extraCss}</style>` : ''}</head>
<body class="bg-background text-foreground font-sans antialiased">
<div id="shell" style="width:${shellWidth}px"><div id="content" class="p-6">${markup}</div></div>
</body></html>`;

  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const page = await browser.newPage({ viewport: { width: viewport, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    return await page.evaluate((padding) => {
      const content = document.getElementById('content')!;
      const row = content.querySelector('div')!;
      const chips = [...content.querySelectorAll('a.fchip')] as HTMLElement[];
      const h1 = content.querySelector('h1')!;
      // 命中區 = 從視覺盒中心用 elementFromPoint 四向逐 px 探邊，回「最遠仍打得到自己」的距離。
      const reach = (el: HTMLElement, dx: number, dy: number) => {
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        let n = 0;
        for (let i = 1; i <= 80; i++) {
          if (document.elementFromPoint(cx + dx * i, cy + dy * i) === el) n = i;
          else break;
        }
        return n;
      };
      // 🔴 前提:chip 真的渲染出來了。少了這一道,`chips` 是空陣列時上面每一個
      //    `for (const c of m.chip)` 都會**跑零次而通過** —— 那是恆綠。
      const first = chips[0];
      if (!first) throw new Error('量測靶裡沒有任何 a.fchip —— markup 或 CSS 沒載到');
      const grp = first.parentElement;
      if (!grp) throw new Error('chip 沒有父層容器,版面結構與預期不符');
      const clone = grp.cloneNode(true) as HTMLElement;
      clone.style.cssText = 'width:max-content;position:absolute;visibility:hidden';
      document.body.appendChild(clone);
      const 三顆總寬 = Math.round(clone.getBoundingClientRect().width);
      clone.remove();
      return {
        可用寬: Math.round(content.getBoundingClientRect().width - padding),
        chip: chips.map((c) => {
          const r = c.getBoundingClientRect();
          return {
            文字: c.textContent ?? '',
            寬: Math.round(r.width),
            高: Math.round(r.height),
            命中寬: reach(c, -1, 0) + reach(c, 1, 0) + 1,
            命中高: reach(c, 0, -1) + reach(c, 0, 1) + 1,
          };
        }),
        三顆總寬,
        整列高: Math.round(row.getBoundingClientRect().height),
        chip獨佔一行:
          Math.round(first.getBoundingClientRect().top) >=
          Math.round(h1.getBoundingClientRect().bottom),
        橫向捲軸: document.documentElement.scrollWidth > window.innerWidth,
      };
    }, padding());
  } finally {
    await page.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const padding = () => CONTENT_PADDING;

describe('`#485` 片5b — 工具列真瀏覽器量測', () => {
  // 🔴 **前提斷言**:量到的可用寬必須等於「視窗 − 側欄 − 內距」。
  //    沒有這一道的話,容器寬設錯(例如 resize 後沒重設)會量出一個**看起來不荒謬的錯數字**
  //    —— 片5 前置實際發生過:390 視窗量到「可用寬 720」,而 358 對 342 就不夠荒謬到會被察覺。
  it.each([390, 393, 430])('前提:%i 的可用寬 = 視窗 − 側欄 − 內距', async (vw) => {
    const m = await measure(vw);
    expect(m.可用寬).toBe(vw - sidebarAt(vw) - CONTENT_PADDING);
  }, 60_000);

  it.each([390, 393, 430])('%i:三顆單行不折字、chip 獨佔一行、無橫向捲軸', async (vw) => {
    const m = await measure(vw);
    // 🔴 失敗形狀是「字在 chip 裡折」不是「掉行」(片3 之後):訊號是單顆高從 26 變 44。
    for (const c of m.chip) expect(c.高, `${c.文字} 的高度 —— 26 以外代表內文折行`).toBe(26);
    expect(m.chip獨佔一行).toBe(true);
    expect(m.橫向捲軸).toBe(false);
    expect(m.三顆總寬).toBeLessThanOrEqual(m.可用寬);
  }, 60_000);

  it.each([390, 393, 430])('%i:每顆 chip 的觸控命中區 ≥ 44×44', async (vw) => {
    const m = await measure(vw);
    for (const c of m.chip) {
      expect(c.命中寬, `${c.文字} 命中寬`).toBeGreaterThanOrEqual(44);
      expect(c.命中高, `${c.文字} 命中高`).toBeGreaterThanOrEqual(44);
    }
  }, 60_000);

  // 🔴 桌機不加熱區是 `#466` 的裁定(桌機是滑鼠、26×26 已過 WCAG AA 的 24×24;
  //    而擴熱區會吃到同一列的其他元素)⇒ 這一格守「熱區沒有外溢到桌機」。
  it('768 桌機:整列單行、chip 26px、熱區不進桌機', async () => {
    const m = await measure(768);
    expect(m.整列高).toBe(32);
    expect(m.chip獨佔一行).toBe(false);
    for (const c of m.chip) {
      expect(c.高).toBe(26);
      expect(c.命中高, `${c.文字} 桌機不該有 44 熱區`).toBe(26);
    }
  }, 60_000);

  /**
   * 🔴🔴 **判別力自檢 —— 這一格是本檔存在的理由。**
   *
   * 注入一條**更高特異性**的規則改掉 chip 的內距。
   * ⚠️ **`globals.css` 的字面一個字都沒有變** ⇒
   *   · postcss 那族(讀 CSS AST)**照樣全綠**
   *   · 片4 的算式模型(常數從 `.fchip` 頂層規則讀)**照樣全綠**
   *   · 而**瀏覽器的用值變了**。
   * **那正是 `#486` 的形狀**(CSS 字面 36、用值 30),也是本檔唯一抓得到、別人抓不到的那一類。
   */
  it('🔴 判別力自檢:字面沒變而用值變了 —— 只有本檔抓得到', async () => {
    const base = await measure(390);
    const mutated = await measure(390, 'body .fchip { padding: 3px 24px; }');
    const baseFirst = base.chip[0];
    const mutatedFirst = mutated.chip[0];
    if (!baseFirst || !mutatedFirst) throw new Error('兩次量測都要有 chip,否則這格是恆綠的');
    expect(baseFirst.寬, '基準:「全部」在未注入時的寬').toBe(48);
    expect(mutatedFirst.寬, '注入更高特異性的 padding 之後，寬必須變').toBeGreaterThan(
      baseFirst.寬,
    );
    expect(mutated.三顆總寬).toBeGreaterThan(base.三顆總寬);
    // 🔴 而 CSS 檔本身沒被動過 —— 這一行就是「字面沒變」的機械證據。
    expect(readFileSync(join(ADMIN_SRC, 'app/globals.css'), 'utf8')).toContain('padding: 3px 11px;');
  }, 60_000);
});
