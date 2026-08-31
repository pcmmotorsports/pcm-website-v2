// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildStatementHtml, codepointsOfHtml, parseFontFaces } from './statement-html';

// 片 C2 的單元尺。**全部餵合成資料** —— 不讀 `.next`、不開瀏覽器。
// 🛑 **它證得了什麼、證不了什麼**:
//    ✅ 證得了:子集挑選、萬用字元展開、標籤剝除、三個計數、`uncovered` 這個訊號會叫
//    🔴 證不了:組出來的 HTML 在真瀏覽器裡畫得對 —— 那是
//       `components/print/statement-cascade-browser.test.tsx` 那一節的事(真 chromium + 真產物)。

/** 造一個 face。`range` 給 `null` = 不宣告 unicode-range。 */
const face = (url: string | null, range: string | null, weight = 400) =>
  `@font-face{font-family:Fake;font-weight:${weight};` +
  `${url === null ? 'src:local(Arial)' : `src:url(${url})format("woff2")`}` +
  `${range === null ? '' : `;unicode-range:${range}`}}`;

const FONT_BYTES = new Uint8Array([1, 2, 3, 4]);
const readAll = () => FONT_BYTES;
const readNone = () => null;

describe('parseFontFaces', () => {
  it('拆得出 url 與區間', () => {
    const [f] = parseFontFaces(face('../media/a.woff2', 'U+4E00-9FFF'));
    expect(f?.url).toBe('../media/a.woff2');
    expect(f?.ranges).toEqual([[0x4e00, 0x9fff]]);
  });

  it('`src:local(...)` ⇒ url 是 null(沒有東西可以內嵌)', () => {
    expect(parseFontFaces(face(null, null))[0]?.url).toBeNull();
  });

  it('🔴 萬用字元 `U+1F9?` 要展開成【區間】,不是一個 codepoint', () => {
    // 沒展開的話 U+1F95 會被判成「沒人涵蓋」⇒ 少內嵌一支 ⇒ 畫面豆腐而程式不叫。
    const [f] = parseFontFaces(face('../media/a.woff2', 'U+1F9?'));
    expect(f?.ranges).toEqual([[0x1f90, 0x1f9f]]);
  });

  it('單點與多段混著也拆得開', () => {
    const [f] = parseFontFaces(face('../media/a.woff2', 'U+3000,U+4E00-4E10,U+FF0C'));
    expect(f?.ranges).toEqual([
      [0x3000, 0x3000],
      [0x4e00, 0x4e10],
      [0xff0c, 0xff0c],
    ]);
  });

  it('🔴 `src:local(...),url(...)` 併存時也要抓得到 url(codex R1)', () => {
    // 第一版只認「src: 後面【緊接著】url」⇒ 這種合法寫法會被判成沒有 url
    // ⇒ 我們會丟掉一支其實嵌得進去的子集 ⇒ 那些字豆腐, 而程式不叫。
    const css = '@font-face{font-family:F;src:local(Arial),url(../media/a.woff2);unicode-range:U+4E00}';
    expect(parseFontFaces(css)[0]?.url).toBe('../media/a.woff2');
  });

  it('🔴 小寫 `u+` 也要解得出來, 而且 declaredRanges 要跟著對(codex R1)', () => {
    const [f] = parseFontFaces('@font-face{src:url(a.woff2);unicode-range:u+4e00-9fff}');
    expect(f?.ranges).toEqual([[0x4e00, 0x9fff]]);
    expect(f?.declaredRanges).toBe(true);
  });

  it('🔴 宣告了 unicode-range 但一段都解不出來 ⇒ declaredRanges 仍是 true', () => {
    // 這一格是「空陣列 = 不限」那個假設的解藥:兩者長得一樣, 而意義相反。
    const [f] = parseFontFaces('@font-face{src:url(a.woff2);unicode-range:???}');
    expect(f?.ranges).toEqual([]);
    expect(f?.declaredRanges).toBe(true);
  });

  it('沒有宣告 unicode-range ⇒ declaredRanges 是 false(負對照)', () => {
    expect(parseFontFaces('@font-face{src:url(a.woff2)}')[0]?.declaredRanges).toBe(false);
  });

  it('負對照:沒有 @font-face 的 CSS ⇒ 空陣列(證明它不是恆真)', () => {
    expect(parseFontFaces('.a{color:red}')).toEqual([]);
  });
});

describe('codepointsOfHtml', () => {
  it('標籤與屬性不算數 —— 只算畫得出來的字', () => {
    const cps = codepointsOfHtml('<div class="pd-sheet" data-x="zz">訂</div>');
    expect(cps.has('訂'.codePointAt(0)!)).toBe(true);
    // 🔴 `class` / `pd-sheet` / `zz` 那些字母**不該**進來
    expect(cps.has('z'.codePointAt(0)!)).toBe(false);
    expect(cps.has('p'.codePointAt(0)!)).toBe(false);
  });

  it('內嵌的 data URI 不會被當成要畫的字', () => {
    const cps = codepointsOfHtml('<img src="data:image/png;base64,QQQQ">中');
    expect(cps.has('Q'.codePointAt(0)!)).toBe(false);
    expect(cps.has('中'.codePointAt(0)!)).toBe(true);
  });
});

describe('buildStatementHtml', () => {
  const pageCss = '.pd-sheet{color:#000}';

  it('✅ 只內嵌【這張紙用得到】的那幾支', () => {
    const fontCss = [
      face('../media/cjk.woff2', 'U+4E00-9FFF'), // 訂 在這裡
      face('../media/greek.woff2', 'U+0370-03FF'), // 用不到
    ].join('');
    const r = buildStatementHtml({ bodyHtml: '<p>訂</p>', pageCss, fontCss, readFont: readAll });
    expect(r.embedded).toBe(1);
    expect(r.skippedUnused).toBe(1);
    expect(r.skippedMissing).toBe(0);
    expect(r.fontBytes).toBe(4);
    expect(r.html).toContain('data:font/woff2;base64,');
    // 🔴 負對照:用不到的那一支**不可以**出現在輸出裡(否則「只內嵌用得到的」是空話)
    expect(r.html).not.toContain('greek.woff2');
    // 版面 CSS 要在, 而且排在字型前面(字型是後補的一層)
    expect(r.html.indexOf(pageCss)).toBeGreaterThan(-1);
    expect(r.html.indexOf(pageCss)).toBeLessThan(r.html.indexOf('data:font/woff2'));
  });

  it('🔴 拿不到字型檔 ⇒ 記進 skippedMissing, 而【不是】丟例外', () => {
    // 少一支子集不該讓整張單產不出來 —— 那是母 plan §6「產檔失敗不得讓既有流程死」的同一條。
    const fontCss = face('../media/cjk.woff2', 'U+4E00-9FFF');
    const r = buildStatementHtml({ bodyHtml: '<p>訂</p>', pageCss, fontCss, readFont: readNone });
    expect(r.skippedMissing).toBe(1);
    expect(r.embedded).toBe(0);
    // 🔴 而它必須**說出來** —— 那個字沒有人畫得了
    expect(r.uncovered).toEqual(['訂']);
  });

  it('🔴 `uncovered` 只算非 ASCII —— 否則它每次都非空, 等於沒有警報', () => {
    const fontCss = face('../media/cjk.woff2', 'U+4E00-9FFF');
    const r = buildStatementHtml({
      bodyHtml: '<p>訂 ABC 123</p>',
      pageCss,
      fontCss,
      readFont: readAll,
    });
    expect(r.embedded).toBe(1);
    expect(r.uncovered).toEqual([]); // ABC/123 是 ASCII ⇒ 不算
  });

  it('🔴 正對照:一個沒有任何 face 涵蓋的中文字, `uncovered` 必須叫', () => {
    // 不加這一格的話, 上面那格的 `[]` 有可能是因為這個訊號**永遠是空的**。
    const fontCss = face('../media/cjk.woff2', 'U+4E00-4E10');
    const r = buildStatementHtml({ bodyHtml: '<p>一龥</p>', pageCss, fontCss, readFont: readAll });
    expect(r.uncovered).toEqual(['龥']); // U+9FA5,不在 4E00-4E10 裡
  });

  it('`src:local(...)` 那種 face 直接丟掉(容器裡沒有本機字型)', () => {
    const fontCss = face(null, null);
    const r = buildStatementHtml({ bodyHtml: '<p>訂</p>', pageCss, fontCss, readFont: readAll });
    expect(r.embedded).toBe(0);
    expect(r.skippedUnused).toBe(1);
    expect(r.html).not.toContain('local(Arial)');
  });

  it('🔴 一個 face 有多個 url ⇒ 輸出只留【一個】來源, 而且是 data(codex R1)', () => {
    // 原本用 regex 只換第一個 url ⇒ 第二個外部來源會留著,
    // 而它只在 data 那支載失敗時才被抓 ⇒ 那一刻就是一個對外請求。
    const fontCss =
      '@font-face{font-family:F;src:url(../media/a.woff2),url(https://evil.example/b.woff2);unicode-range:U+4E00-9FFF}';
    const r = buildStatementHtml({ bodyHtml: '<p>訂</p>', pageCss, fontCss, readFont: readAll });
    expect(r.embedded).toBe(1);
    expect(r.html).not.toContain('evil.example');
    expect((r.html.match(/url\(/g) ?? []).length).toBe(1);
  });

  it('🔴 HTML entity 要被【解碼】—— 刪掉的話那個字會少嵌一支子集(codex R1)', () => {
    // `&#x20AC;` 是 €(U+20AC)。第一版把 entity 整個換成空白 ⇒ 它從來沒進過集合。
    const fontCss = '@font-face{font-family:F;src:url(a.woff2);unicode-range:U+4E00-9FFF}';
    const r = buildStatementHtml({ bodyHtml: '<p>&#x20AC;</p>', pageCss, fontCss, readFont: readAll });
    expect(r.uncovered).toEqual(['€']); // 有叫 = 它真的進了集合
  });

  it('🔴 宣告了範圍卻解不出來的 face:照嵌(安全方向), 但不替任何字背書', () => {
    const fontCss = '@font-face{font-family:F;src:url(a.woff2);unicode-range:???}';
    const r = buildStatementHtml({ bodyHtml: '<p>訂</p>', pageCss, fontCss, readFont: readAll });
    expect(r.embedded).toBe(1); // 多嵌只是浪費
    expect(r.uncovered).toEqual(['訂']); // 而它仍然要叫 —— 沒有人【宣稱】涵蓋這個字
  });

  it('🔴 組出來的東西不得含任何 http(s) 來源 —— 那是本設計的核心承諾', () => {
    const fontCss = [face('../media/cjk.woff2', 'U+4E00-9FFF'), face(null, null)].join('');
    const r = buildStatementHtml({ bodyHtml: '<p>訂</p>', pageCss, fontCss, readFont: readAll });
    expect(r.html).not.toMatch(/https?:\/\//);
  });
});
