// @vitest-environment node
//
// products-layout-grid-browser.test.tsx —— 型錄版面那個 grid 的**格位**量測(真 chromium + 真編譯後 CSS)。
//
// 🔴🔴 **存在的理由是一個真的 bug**(2026-09-06 code-reviewer R1 Critical):
//    我把 ⟦search-SILENTDOORS2⟧ 的兩顆 notice 直接掛在 `.pp-layout.has-side` 底下,
//    而那個容器是 `display:grid` ⇒ **每多一個直接子元素就吃掉一個格子**
//    ⇒ **只有一扇失敗時** notice 佔 r1c1、`FilterSide` 被推走、`main` 掉到第二列 ⇒ 桌機版面錯位。
//    🛑 **而那四支既有測試全綠**(jsdom 不做版面)⇒ 📌 **那一族的尺對「格位」零判別力。**
//
// 🔵 **CSS 取【編譯產物】不重打** —— 重打就是第二把尺;找不到就 throw、不 skip
//    (「沒有 CSS 所以跳過」與「CSS 正常所以通過」在報表上長得一樣)。
// ⚠️ **已知不決定性的【輸入】**(照抄 `print/statement-cascade-browser.test.tsx` 的自陳):
//    它讀共用的 `.next` 產物 ⇒ 別的視窗同時 build 時腳下的 CSS 會變
//    ⇒ **它的紅要先問「剛剛有沒有人在 build」**;連兩次同一格紅才當真。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from '@playwright/test';

const CHUNKS = join(__dirname, '../../.next/static/chunks');

/** 撈出所有含指定字面的編譯後 CSS(合併)。找不到 ⇒ throw。 */
function compiledCss(marker: string): string {
  let files: string[];
  try {
    files = readdirSync(CHUNKS).filter((f) => f.endsWith('.css'));
  } catch {
    throw new Error(`讀不到 ${CHUNKS} —— 先跑 \`TURBO_FORCE=1 pnpm build\``);
  }
  const hits = files
    .map((f) => readFileSync(join(CHUNKS, f), 'utf8'))
    .filter((css) => css.includes(marker));
  if (hits.length === 0) throw new Error(`編譯產物裡找不到 ${marker} —— 先跑 build`);
  return hits.join('\n');
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/**
 * 造一個與 `ProductsPage` 同結構的最小 DOM,量 `main` 落在哪一格。
 * `wrapped=true` = 本片的修法(notice 包在 `grid-column:1/-1` 的容器裡)。
 */
async function mainCell(opts: { noticeCount: number; wrapped: boolean; emptyWrapper?: boolean }) {
  const css = compiledCss('.pp-layout');
  const notices = Array.from(
    { length: opts.noticeCount },
    () => '<div role="alert">讀不到</div>',
  ).join('');
  // `emptyWrapper` = 【沒有任何一扇失敗】那個世界:兩顆 notice 各自回 null,
  //   而外面那層 `<div style="grid-column:1/-1">` **仍然被渲染**(React 不會因為子元素是 null 就不畫父層)
  //   ⇒ 它仍然是 grid 的一個子元素 ⇒ 問題是:**它會不會把 side/main 推掉一格?**
  const noticeBlock = opts.emptyWrapper
    ? '<div style="grid-column:1 / -1"></div>'
    : opts.wrapped
      ? `<div style="grid-column:1 / -1">${notices}</div>`
      : notices;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body>` +
        `<div class="pp-layout has-side">${noticeBlock}` +
        `<aside class="fs-side" id="side">側欄</aside>` +
        `<main class="pp-main" id="main">主區</main>` +
        `</div></body></html>`,
    );
    return await page.evaluate(() => {
      const g = (id: string) => {
        const el = document.getElementById(id);
        if (!el) throw new Error(`量不到 #${id} —— 選擇器沒接上, 這一發作廢`);
        const cs = getComputedStyle(el);
        // 🔴 2026-09-06 R2 nit:`gridRowStart` 在這裡是 `auto`(沒有明寫 row)⇒ 兩邊恆相等 ⇒ **恆真**。
        //   改量**幾何**:`top` 分得出「同一列」與「掉到下一列」, 而它是真的被排版算出來的。
        //   `gridColumnStart` 同理也是 `auto` ⇒ 一併拿掉, 不留死欄位。
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left) };
      };
      const layout = document.querySelector('.pp-layout') as HTMLElement;
      return { main: g('main'), side: g('side'), display: getComputedStyle(layout).display };
    });
  } finally {
    await page.close();
  }
}

describe('型錄版面 grid 格位(⟦search-SILENTDOORS2⟧ R1 Critical)', () => {
  it('🟢 正對照先跑:那個容器【真的是 grid】—— 否則下面每一格都零判別力', async () => {
    const r = await mainCell({ noticeCount: 0, wrapped: false });
    expect(r.display).toBe('grid');
  }, 60_000);

  it('🔴 只有一扇失敗 + 包了容器 ⇒ side 與 main 仍然【左右並排】(同一列, main 在 side 右邊)', async () => {
    const r = await mainCell({ noticeCount: 1, wrapped: true });
    expect(r.main.top).toBe(r.side.top); // 同一列 = 同一個 top
    expect(r.main.left).toBeGreaterThan(r.side.left); // main 在 side 右邊
  }, 60_000);

  it('🔵 負對照:同樣一扇失敗而【不包容器】⇒ 版面就錯位(證明這把尺分得出兩個世界)', async () => {
    const r = await mainCell({ noticeCount: 1, wrapped: false });
    // 🛑 少了這一格,「包了容器所以對」與「這個 CSS 本來就怎麼放都對」印同一個綠。
    const 錯位 = r.main.top !== r.side.top || r.main.left <= r.side.left;
    expect(錯位).toBe(true);
  }, 60_000);

  it('🔴 兩扇都失敗 + 包了容器 ⇒ 仍然並排(兩顆 notice 在同一個容器裡, 只佔一列)', async () => {
    const r = await mainCell({ noticeCount: 2, wrapped: true });
    expect(r.main.top).toBe(r.side.top); // 同一列 = 同一個 top
    expect(r.main.left).toBeGreaterThan(r.side.left); // main 在 side 右邊
  }, 60_000);
  // 🔴🔴 **R3 角度②(修法回歸):那層包裝在【沒有任何一扇失敗】時仍然存在於 DOM。**
  //   `TaxonomyNotice` 回 `null`, 而**外面那層 `<div>` 照樣被渲染** ⇒ 它仍是 grid 的子元素。
  //   ⇒ 問題不是「它在不在」, 是**它有沒有把 side / main 推掉一格** ——
  //     那會讓【每一個正常客人】的版面都被我這一片動到, 而三扇門都好的時候正是 99.9% 的情況。
  //   🔬 讀 CSS:`.pp-layout.has-side` 只有 `column-gap:32px`, **沒有 row-gap** ⇒ 推論它無害;
  //     🛑 **而推論不算** —— 下面這一格把它變成量到的。
  it('🔴🔴 三扇門都【沒有】失敗 ⇒ 那層空包裝不得改變 side/main 的位置(與完全沒有包裝那個世界逐字相同)', async () => {
    const 空包裝 = await mainCell({ noticeCount: 0, wrapped: false, emptyWrapper: true });
    const 沒包裝 = await mainCell({ noticeCount: 0, wrapped: false });
    expect(空包裝.side).toEqual(沒包裝.side);
    expect(空包裝.main).toEqual(沒包裝.main);
  }, 60_000);

});
