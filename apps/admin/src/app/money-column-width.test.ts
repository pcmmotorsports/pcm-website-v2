import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// money-column-width.test.ts — 守住「單價與小計共用一個寬度變數」這件事。
//
// 🔴🔴 **先讀限定,它決定你能不能信這支測試**:
//    **本檔是【字面守門】,守的是 CSS 原始碼,不是版面。**
//    這個 bug(金額溢出壓到隔壁欄)在 jsdom 裡**不存在** —— jsdom 不做版面計算。
//    ⇒ 拆回兩個數字、或把值改小 ⇒ 本檔會紅 ✅
//    ⇒ 但用**別的方式**讓金額擠不下(改字級、改 gap、改別的軌)⇒ **本檔全綠而畫面是壞的。**
//    真的版面守門缺口記在 `#824`(後台沒有真瀏覽器版面守門層)。
//
// 📎 病灶與實量:`~/pcm-mailbox/A-bc-006-診斷-小計欄裝不下金額-20260821.md`
//    一句話:小計軌 `64` 是**逐字搬設計稿**的舊常數,而 2026-08-21 A2 把字級 11px→13px
//    之後**沒有人回頭重量它**;隔壁 `76` 是我方自己加的、加的人量過 ⇒ 放得下。
//    **同一種內容,新做的軌道放得下、搬來的軌道放不下。**

const CSS = readFileSync(resolve(__dirname, 'globals.css'), 'utf8');

/** 剝掉 CSS 註解 —— 否則「有人在註解裡提到這個變數」會把尺推歪。 */
const stripCssComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** 取 `.ihead,\n.iline { … }` 那個宣告區塊。 */
function ilineBlock(css: string): string {
  const i = css.indexOf('.iline {');
  if (i < 0) throw new Error('找不到 `.iline {` —— 結構變了,本守門要重寫');
  return css.slice(i, css.indexOf('}', i));
}

/**
 * 🔴🔴 **MW-3 的修法本體:不要釘結論,要釘算式。**
 *
 * 第一版斷言的是「`--pcm-money-w` 必須正好 76」—— 而 76 不是一個獨立的事實,
 * 它是**四個輸入算出來的**:
 * ```
 * 2v ≤ 容器653 − 品名地板120 − gap總和50 − 其餘三軌(158+128+44=330) = 153  ⇒ v ≤ 76.5
 * ```
 * ⇒ 有人把料號從 158 改成 200,**76 立刻不成立,而只釘 76 的守門全綠。**
 * ⇒ 所以下面這幾支 parser 把四個輸入**從 CSS 讀出來**,上限**當場算**。
 *   任一個輸入變動 ⇒ 算出來的上限跟著變 ⇒ 紅。
 *
 * ⚠️ **只有「容器 653」是寫死的**,因為它不是 CSS 常數 —— 它是版面算出來的。
 *    **它的前提寫在它旁邊**(面板 720 = Sean 拍板的預設寬)。前提變了要重量。
 */
const 容器寬_面板720時 = 653; // 實量 2026-08-21 @viewport 1440,面板 = 預設 720

/** 從 `.iline` 的 grid 宣告讀出六軌的字面。 */
function trackList(css: string): string[] {
  const block = ilineBlock(stripCssComments(css));
  const cols = /grid-template-columns:([^;]+);/.exec(block);
  if (!cols) throw new Error('讀不到 grid-template-columns');
  return (cols[1] ?? '').trim().split(/\s+(?![^(]*\))/);
}

/** 讀一個 `--name: <n>px` 變數的數值。找不到 ⇒ throw(不得靜默回 0)。 */
function cssVar(css: string, name: string): number {
  const m = new RegExp(`--${name}:\\s*(\\d+)px`).exec(stripCssComments(css));
  if (!m) throw new Error(`讀不到 --${name}`);
  return Number(m[1]);
}

/** 讀 `.iline` 的 `gap: <n>px`。 */
function ilineGap(css: string): number {
  const m = /gap:\s*(\d+)px/.exec(ilineBlock(stripCssComments(css)));
  if (!m) throw new Error('讀不到 .iline 的 gap');
  return Number(m[1]);
}

/** 品名軌的地板:`minmax(<floor>px, 1fr)`。 */
function nameFloor(css: string): number {
  const m = /minmax\(\s*(\d+)px\s*,\s*1fr\s*\)/.exec(trackList(css)[0] ?? '');
  if (!m) throw new Error('讀不到品名軌的地板');
  return Number(m[1]);
}

/** 把一個軌道字面解析成 px(支援 `NNpx` 與 `var(--x)`)。 */
function trackPx(css: string, literal: string): number {
  const v = /^var\(--([a-z0-9-]+)\)$/.exec(literal.trim());
  if (v) return cssVar(css, v[1]!);
  const n = /^(\d+)px$/.exec(literal.trim());
  if (!n) throw new Error(`解析不了軌道字面:${literal}`);
  return Number(n[1]);
}

/** 🔴 上限【當場算】:2v ≤ 容器 − 地板 − gap總和 − 其餘三軌。 */
function moneyUpperBound(css: string): number {
  const tracks = trackList(css);
  const others = [1, 2, 3].reduce((a, i) => a + trackPx(css, tracks[i] ?? ''), 0);
  const gaps = ilineGap(css) * (tracks.length - 1);
  return (容器寬_面板720時 - nameFloor(css) - gaps - others) / 2;
}

describe('訂單面板:單價與小計的軌道寬', () => {
  it('🔴 兩軌用【同一個】變數 —— 拆回兩個數字會紅', () => {
    const block = ilineBlock(stripCssComments(CSS));
    const cols = /grid-template-columns:([^;]+);/.exec(block);
    expect(cols).not.toBeNull();
    const tracks = (cols?.[1] ?? '').trim().split(/\s+(?![^(]*\))/);
    expect(tracks).toHaveLength(6);
    // 第 5、6 軌 = 單價、小計,必須逐字相同且是變數。
    // 用一次 toEqual 比整組,而不是兩次索引存取 —— 失敗訊息會直接印出實際的兩軌是什麼。
    expect(tracks.slice(4)).toEqual(['var(--pcm-money-w)', 'var(--pcm-money-w)']);
  });

  // 🔴🔴 **本格第一版【只擋了一個方向】,被審查線 MW-1 擊破:**
  //    ```
  //    76 →  70  ⇒ 🔴 紅(我跑的那一發)
  //    76 → 120  ⇒ 🟢 全綠   ← 該紅沒紅
  //    76 → 999  ⇒ 🟢 全綠   ← 該紅沒紅
  //    ```
  //    而**同一支檔的註解裡**我自己就寫著「76 同時是下限與上限」。
  //    ⇒ **註解說服的是讀的人;斷言擋的是改的人。而改的人不一定會讀。**
  //    失敗情境:有人覺得「金額還是有點擠,調寬一點」⇒ 改 120 ⇒ 五格全綠
  //             ⇒ 兩軌 240 > 可用 153 ⇒ **品名軌被擠破地板 = 正是本檔記載的那個 bug。**
  it('🔴🔴 值必須【正好】在 76 —— 下限與上限撞在同一個數字上,兩個方向都要擋', () => {
    // 76 的兩個來源(實量於 2026-08-21,前提:面板 720 / 容器 653 / 字型 700 13px):
    //   下限 「NT$ 15,800」文字實寬 75.4px ⇒ 76 才剛好不溢出
    //   上限 品名地板 120 + 其餘【三】軌 158+128+44 = 330 + gap 50
    //        ⇒ 2v ≤ 653−120−50−330 = 153 ⇒ v ≤ 76.5
    const v = cssVar(CSS, 'pcm-money-w');
    // 🔴 下限:實量的字寬(「NT$ 15,800」= 75.4px @700 13px)⇒ 76 才剛好不溢出
    // 🔴 上限:**當場從 CSS 算**,不寫死 —— 四個輸入任一個變動,這個數就跟著變
    const 上限 = moneyUpperBound(CSS);
    expect({ 值: v, 上限: 上限, 下限成立: v >= 76, 上限成立: v <= 上限 }).toEqual({
      值: v,
      上限: 上限,
      下限成立: true,
      上限成立: true,
    });
  });

  // 🔴 **這兩格的判別力是【互相獨立】的,而我驗過了**(不然「上限那格有用」只是推論):
  //    ```
  //    料號 158→160,【並且】同步把本格的期望值改成 160
  //      ⇒ 只有上限那格紅(1 failed) ⇒ **上限那格自己有判別力**
  //    料號 158→160,不動本格
  //      ⇒ 兩格都紅(2 failed)
  //    ```
  //    ⚠️ 而這也解釋了為什麼「輸入 +1」那組負對照看起來像紅:
  //       紅的是本格(輸入變了),不是上限那格 —— **上限那格的翻面點是 +2,實測相符。**
  //
  // 🔴🔴 **MW-3:上一格釘的是【算式】,本格證明那個算式真的讀得到那四個輸入。**
  //    沒有本格的話,`moneyUpperBound` 若把某個輸入讀成常數,上一格照樣綠。
  it('🔴 四個輸入都真的從 CSS 讀得到(讀不到必須 throw,不得靜默回 0)', () => {
    expect(nameFloor(CSS)).toBe(120);
    expect(trackPx(CSS, trackList(CSS)[1] ?? '')).toBe(158);
    expect(cssVar(CSS, 'pcm-three-w')).toBe(128);
    expect(trackPx(CSS, trackList(CSS)[3] ?? '')).toBe(44);
    expect(ilineGap(CSS)).toBe(10);
    // 讀不到要吼,不要靜默 —— 靜默回 0 會讓上限被算大,而那正好是本片要防的方向
    expect(() => cssVar('', 'pcm-money-w')).toThrow();
    expect(() => ilineGap('.iline { display: grid; }')).toThrow();
    expect(() => nameFloor('.iline { grid-template-columns: 1fr; gap: 10px; }')).toThrow();
  });

  it('🔴 舊的 `--pcm-unit-w` 不得復活(它是被合併掉的那一半)', () => {
    expect(stripCssComments(CSS)).not.toContain('--pcm-unit-w');
  });

  // 🔴 **工具約束要問兩件事,而我一直只問前面那件**(審查線 2026-08-21 給的四行清單):
  //      ① 工具失效會紅嗎?   ② 🔴 **工具量到【錯的東西】會紅嗎?**
  //    ②那一列是我漏最多的(MF-1 與 R2-1 都是它)。所以本格兩個方向都餵。
  it('🔴 剝除器:該剝的要剝掉(否則註解會冒充程式碼)', () => {
    // 直接餵最小輸入 —— 不透過 CSS 去測工具(2026-08-21 R2-1 學到的)
    expect(stripCssComments('/* --pcm-unit-w: 76px; */x')).toBe('x');
    expect(stripCssComments('/* a */b/* c */')).toBe('b');
  });

  it('🔴 剝除器:**不該剝的不准剝** —— 剝過頭會讓上面那幾格量到一份空的 CSS', () => {
    expect(stripCssComments('.a{b:1}')).toBe('.a{b:1}');
    expect(stripCssComments('url(a/b)')).toBe('url(a/b)'); // 單斜線不是註解
    // 🔴 而剝過頭【不會靜默】:CSS 變空 ⇒ ilineBlock 找不到 `.iline {` ⇒ throw ⇒ 整檔紅
    expect(() => ilineBlock('')).toThrow();
  });

  it('⚠️ 天花板寫在 CSS 註解裡,不是只寫在信裡 —— 七位數會碰撞', () => {
    expect(CSS).toContain('1,280,000');
    expect(CSS).toContain('已知天花板');
  });
});
