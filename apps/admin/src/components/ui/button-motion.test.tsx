// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// button-motion.test.tsx — 守「BMW M 動效 token 有沒有【真的接在】按鈕上」。
//
// 🔴🔴 **這一格存在的理由,是它要擋的東西【完全看不出來】**:
//   動效 token 從 2026-08-16 宣告到 2026-08-22,**六天都是「宣告在、消費端 0」**,
//   而這段期間 typecheck / lint / build / 全套測試**每一次都全綠**。
//   `design-tokens.test.ts:111-113` 也一直是綠的 —— 因為**它只斷言那三行【宣告】還在**,
//   不問有沒有人用。⇒ **一個沒有人用的設計 token,和一個用得好好的,在所有既有的閘上長得一樣。**
//
// ⚠️ **本檔量的是【原始碼字面】,不是瀏覽器行為。**
//   jsdom 不解析 CSS 自訂屬性的層疊,`getComputedStyle` 拿不到 `var(--motion-fast)` 的實際值
//   ⇒ 「按下去真的過場 130ms」要真瀏覽器才驗得到,**本檔驗不到,不要讀成已驗**。
//   本檔擋得住的是:**有人把那兩個 class 拿掉 / 改回 Tailwind 預設**。

const BUTTON = resolve(__dirname, 'button.tsx');
const GLOBALS = resolve(__dirname, '../../app/globals.css');

const raw = () => readFileSync(BUTTON, 'utf8');
const css = () => readFileSync(GLOBALS, 'utf8');

/**
 * 🔴 **只看 class 字串,不看整支檔** —— 這一步是被自己的第一版逼出來的。
 *
 * 第一版寫 `expect(readFileSync(...)).not.toContain('transition-all')`,而**它當場紅了** ——
 * 紅的原因是我在檔頭註解裡寫了「為什麼從 `transition-all` 改成 `transition-colors`」。
 * ⇒ **grep 一支檔的分母是它的【全部字元】,註解、字串、錯誤訊息都算。**
 *   判別句:那一行是它**存在的原因**,還是只是**提到它**?
 *
 * ⇒ 把註解剝掉再比。留 `//` 與 `/* *\/` 兩種。
 */
const classText = () =>
  raw()
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');

describe('Button 的動效必須吃設計 token,不吃 Tailwind 預設', () => {
  it('🔴 兩個 class 都在(duration 與 ease 各自獨立,少一個就退回預設)', () => {
    const s = classText();
    // 🔴 **兩條分開斷言,不合成一條** —— 只寫 duration 的話,曲線悄悄退回
    //    Tailwind 的對稱緩動 `cubic-bezier(.4,0,.2,1)`,而**畫面上只是「感覺軟了一點」**。
    expect(s, 'duration 沒吃 --motion-fast ⇒ 退回 Tailwind 的 150ms').toContain(
      'duration-[var(--motion-fast)]',
    );
    expect(s, 'ease 沒吃 --ease-standard ⇒ 退回 Tailwind 的對稱緩動曲線').toContain(
      'ease-[var(--ease-standard)]',
    );
  });

  it('🔴 前提:那兩顆 token 真的在 `:root` 裡(不在的話上面兩格是指向空氣)', () => {
    // 🔴 這是**前提斷言**:`var(--x)` 指向一顆不存在的 token 時,CSS **不會報錯,只是無效**
    //    ⇒ 上面兩格照樣綠,而動效死掉。
    //    ⚠️ 而它們**必須在 `:root`、不能在 `@theme inline`** —— `globals.css:175-181` 逐字記著
    //    「放在 `@theme inline` 裡的自訂變數 Tailwind 不會輸出 ⇒ 編出來是【零位元組】」。
    const c = css();
    const rootStart = c.indexOf(':root {');
    const theme = /@theme\s+inline\s*\{/.exec(c);
    expect(rootStart, ':root 區塊要存在').toBeGreaterThanOrEqual(0);
    expect(theme, '@theme inline 區塊要存在 —— 找不到就不能切片').not.toBeNull();
    const rootBlock = c.slice(rootStart, theme!.index);
    expect(rootBlock).toContain('--motion-fast:');
    expect(rootBlock).toContain('--ease-standard:');
  });

  it('🔴 不得用 `transition-all` —— 它會去動版面屬性', () => {
    // `globals.css:186-187` 逐字:「用它們時**只准動 `transform` / `opacity`** ——
    // 動 `top/left/width/height` 會逐幀觸發版面重算,在 1,000 列的訂單表上是可見的卡頓」。
    // 而設計稿寫的也是 `transition:background`,不是 all。
    expect(classText(), 'transition-all 會連版面屬性一起動').not.toContain('transition-all');
    expect(classText()).toContain('transition-colors');
  });

  it('🔴 對照組:這把尺分得出「有寫」與「沒寫」(不是恆真)', () => {
    // 少了這格,上面三格若拿一個永遠找得到的字串去比,會全部恆綠。
    expect(classText()).not.toContain('duration-[var(--this-token-does-not-exist)]');
  });
});
