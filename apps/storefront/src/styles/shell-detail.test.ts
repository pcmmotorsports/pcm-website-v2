// shell-detail.test.ts — 殼細節統一(R2-3 + §4-4 平板段)的文字層守門(全站重設計 第0批 0b;2026-08-05)
//
// 與 `shell-width.test.ts`(0a、版寬與色票)分檔:那支管「殼多寬」,這支管「殼長什麼樣」。
// 同樣走讀 CSS 原文的路子 —— 觸控目標尺寸、字級、斷點分段都是 media query 與 cascade 的產物,
// jsdom 不套 media query、也不做 cascade,元件測試對這三件事一律綠。
//
// 🔴 本檔最重要的一條不是「平板段存在」,是**平板段的選擇器清單有沒有帶上 `html[data-mobile="true"]` 那半**。
//    `mobile-tabbar.css` 有一組 `html[data-mobile="true"]` 的 SSR 兜底(權重 (0,2,1) / (0,1,2)),
//    而 `@media` 不加權重 ⇒ 平板段若照設計稿原字面只寫裸選擇器,會被兜底整段蓋回手機值。
//    觸發條件不是邊緣 case:`app/layout.tsx:84` 的 UA 判斷含 `Android`,Android 平板必中。
//    ⇒ 那半條選擇器被刪掉時,除了這裡沒有任何地方會紅(視覺上只是「平板字還是很小」,
//      而那正是這一片要修的原始症狀 —— 修法自己失效、看起來卻像做完了)。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(HERE, f), 'utf8');

const FILES = [
  'header.css',
  'mobile-tabbar.css',
  'tokens.css',
  'products-page.css',
  'filter-cascade.css',
  'filter-top.css',
  'filter-side.css',
  'products-mobile.css',
] as const;
// 🔴 鍵型別用**字面聯集**不是 `Record<string, string>`:本 repo 開了 `noUncheckedIndexedAccess`
//    (`tsconfig.base.json:14`),索引簽章取值一律 `string | undefined` ⇒ 每個 `.indexOf` 都是 TS 錯。
type CssFile = (typeof FILES)[number];
const RAW = Object.fromEntries(FILES.map((f) => [f, read(f)])) as Record<CssFile, string>;

// 🔴 剝註解後才斷言:本片的註解**逐字引用了選擇器名、px 值與權重數字**(坑寫在坑旁邊,刻意的),
//    對原文比對會命中註解而不是規則本體。
const CSS = Object.fromEntries(
  FILES.map((f) => [f, RAW[f].replace(/\/\*[\s\S]*?\*\//g, '')]),
) as Record<CssFile, string>;

/**
 * 取某個平規則的宣告區塊(到第一個 `}` 為止)。區塊內出現巢狀 `{` 一律當前提失效直接紅
 * —— 規則哪天被搬進 `@media`,切出來的片段會跨過內層 `{` 而斷言照樣「找得到」= 假綠。
 * (與 `shell-width.test.ts` 的 `block()` 同一支,刻意重寫而非跨檔 import:
 *  那支的前提是它自己那四支檔的形狀,兩邊各自成立、不互相綁死。)
 */
function block(file: CssFile, selector: string): string {
  const i = CSS[file].indexOf(selector);
  expect(i, `${file} 找不到選擇器 ${selector}(被改名或刪了?)`).toBeGreaterThan(-1);
  const open = CSS[file].indexOf('{', i);
  const close = CSS[file].indexOf('}', open);
  expect(close, `${file} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = CSS[file].slice(open + 1, close);
  expect(body, `${file} 的 ${selector} 區塊內出現巢狀 {(平規則前提已失效、切片邊界不可信)`)
    .not.toMatch(/\{/);
  return body;
}

/**
 * 取 `@media <query>` 的完整內容。**用大括號走訪器、不用 `[^}]*`**
 * —— media 區塊內一定有內層 `{`,正規式切法會停在第一條規則的 `}`、後面的斷言全部量不到
 * (memory `feedback_text-level-guard-blind-to-invalid-syntax` 那族)。
 * 比對字串到 `{` 為止,避免 `(min-width: 600px)` 前綴命中 `(min-width: 600px) and (…)`。
 */
function mediaBlock(file: CssFile, query: string): string {
  const src = CSS[file];
  const start = src.indexOf(`@media ${query} {`);
  if (start === -1) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

describe('殼細節守門 · 檔案本身沒壞', () => {
  it.each(FILES)('%s 的註解符號成對且順序正確(未閉合的 /* 會讓瀏覽器吞掉後半個檔,而剝註解的守門照樣全綠)', (f) => {
    // 🔴 **不能只比數量**:CSS 註解不巢狀,所以註解**內文**裡出現的 `/*` 只是文字
    //    (`products-mobile.css:435` 現成就有一個,實測 25 個 `/*` 對 24 個 `*/`、檔案完全合法)。
    //    改成掃一遍記狀態:已在註解內的 `/*` 忽略、每個 `*/` 前面必須有一個沒閉的 `/*`、掃完不得還開著。
    const src = RAW[f];
    let open = false;
    for (let i = 0; i < src.length - 1; i++) {
      if (!open && src[i] === '/' && src[i + 1] === '*') { open = true; i++; }
      else if (open && src[i] === '*' && src[i + 1] === '/') { open = false; i++; }
      else if (!open && src[i] === '*' && src[i + 1] === '/') {
        expect.fail(`${f} 在位置 ${i} 出現沒有對應 /* 的 */(錯位平衡,數量比對看不出來)`);
      }
    }
    expect(open, `${f} 檔尾還有一個沒閉合的 /*(其後的規則全被瀏覽器當註解吞掉)`).toBe(false);
  });
});

describe('R2-3 頁首細節', () => {
  it('🔴 .pcm-icon-btn 觸控目標兩軸都是 44px(iOS / WCAG 2.1 下限)', () => {
    const body = block('header.css', '.pcm-icon-btn');
    expect(body, '寬不是 44px').toMatch(/width:\s*44px/);
    expect(body, '高不是 44px').toMatch(/height:\s*44px/);
    // 反面:退回 40 就是低於觸控下限,而畫面上「只是小一點」、沒有任何流程會紅。
    expect(body, '.pcm-icon-btn 退回 40px ⇒ 低於 44px 觸控下限').not.toMatch(/:\s*40px/);
  });

  it('🔴 .pcm-nav-item 字級 14px,且全檔不得再有半像素字級(設計端 §4-3「字級只用整數 px」)', () => {
    expect(block('header.css', '.pcm-nav-item'), 'nav 字級不是 14px').toMatch(/font-size:\s*14px/);
    // 這條刻意掃**整支檔**不是只掃 .pcm-nav-item:R2-3 改的是那一顆,但「整數 px」是全站規則,
    // 只釘手碰過的那一行 = 下一顆半像素進來時零阻力(memory `feedback_claimed-sync-but-only-patched-touched-lines`)。
    expect(CSS['header.css'], 'header.css 出現半像素字級').not.toMatch(/font-size:\s*\d+\.\d+px/);
  });

  it('🔴 .pcm-logo 是圖檔容器不是文字:img 高 34px、寬 auto,且不再帶字級', () => {
    const logo = block('header.css', '.pcm-logo {');
    expect(logo, '.pcm-logo 仍帶 font-size ⇒ logo 退回文字了').not.toMatch(/font-size/);
    const img = block('header.css', '.pcm-logo img');
    expect(img, 'logo 圖高不是 34px').toMatch(/height:\s*34px/);
    // width 必須是 auto:寫死寬會把 1259×656 的比例拉歪,而「歪掉的 logo」沒有任何測試看得見。
    expect(img, 'logo 圖寬不是 auto ⇒ 比例會被拉歪').toMatch(/width:\s*auto/);
  });

  // 🔴 這條是突變測試逼出來的:第一版把 `.pcm-icon-btn svg { width:22px; height:22px }` 加進
  //    `header.css` 卻**沒有任何斷言**,整條刪掉全套 87 測全綠 —— 而症狀是「圖示在 44px 的
  //    按鈕裡縮回 20px」,人眼幾乎看不出來、也不會壞任何流程。
  //    ⚠️ 設計端這一項自相矛盾:`products-list-handoff.md:215` 的 R2-3 表列寫 20px,
  //       但它給的理由是「首頁同款」,而首頁定案稿 `direction-b…:101` 與殼單一來源
  //       `pcm-shell.css:74` 兩份 CSS 都是 **22px** ⇒ 以 CSS 兩份為準。這條把該判斷釘在檔案裡,
  //       下次有人照 R2-3 的字面改回 20 會當場紅、逼他重看這段理由。
  it('🔴 .pcm-icon-btn 內的圖示統一 22px(OD 兩份 CSS 逐字;R2-3 表列的 20px 是矛盾字面)', () => {
    const rule = block('header.css', '.pcm-icon-btn svg');
    expect(rule, '圖示寬不是 22px').toMatch(/width:\s*22px/);
    expect(rule, '圖示高不是 22px').toMatch(/height:\s*22px/);
    expect(rule, '圖示退回 20px ⇒ 與定案稿的比例不同').not.toMatch(/:\s*20px/);
  });

  it('🔴 .pcm-cart-dot 角落偏移隨按鈕收到 4px(6px 是配 40px 按鈕的值)', () => {
    const body = block('header.css', '.pcm-cart-dot');
    expect(body).toMatch(/top:\s*4px/);
    expect(body).toMatch(/right:\s*4px/);
  });
});

// 🔴 R2-3 把 `.pcm-icon-btn` 由 40 改 44 ⇒ 頁首總高由 69 長到 73(桌機)/ 65 長到 69(手機),
//    而全站有 **5 支 CSS、12 條規則**把「頁首高度」當 sticky 偏移**寫死成字面**。
//    (初稿寫「六支」是沒數就寫,D-111-A nit 1 更正。)實測(agent-browser、1440):
//    改 44 之後捲動時頁首(z-index 50)蓋住選車列(z-index 40)**4px**、`.pp-head` 再疊 1px,
//    而 typecheck / lint / 全套 4956 測**全綠** —— 沒有任何既有機制看得到這件事。
//    ⇒ 本組把「單一來源」這件事本身釘住:token 在、消費端沒有人再寫死、斷點兩處同步。
describe('頁首高度單一來源 --shell-header-h(0b:40→44 的連動)', () => {
  const CONSUMERS = [
    'products-page.css',
    'filter-cascade.css',
    'filter-top.css',
    'filter-side.css',
    'products-mobile.css',
  ] as const;

  it('🔴 token 定義:桌機 73px、≤1079 覆寫 60px', () => {
    expect(CSS['tokens.css'], '找不到 --shell-header-h 定義').toMatch(/--shell-header-h:\s*73px/);
    const mobile = mediaBlock('tokens.css', '(max-width: 1079px)');
    expect(mobile, 'tokens.css 找不到 ≤1079 的覆寫段').not.toBe('');
    // 🔴 2026-08-09:69 → 60(Sean 看過四張梯度截圖後挑 `3-`)。
    //    **斷言跟著行為改、不是放寬**:寫回 69 一樣紅。
    expect(mobile, '手機/平板沒把頁首高覆寫成 60px').toMatch(/--shell-header-h:\s*60px/);
  });

  // 前提:73 / 60 這兩個數字不是憑空來的,而是 padding + 44 + 1px 框線算出來的。
  // `header.css` 的 padding 或按鈕尺寸一改,token 就說謊了 —— 那時要當場紅在這裡。
  it('🔴 前提 — 73/60 的算式成分還在(padding 14/7.5、按鈕 44、下框線 1px)', () => {
    // 🔴 要比**整個 shorthand**,不是只比第一值(D-111-A nit 2):
    //    `/padding:\s*14px/` 對 `padding: 14px 20px 16px` 照樣命中,而那會讓實高變成
    //    14+44+16+1 = **75**、token 說謊 73,且沒有任何東西會紅。
    //    ⇒ 釘死成「兩值、上下同為 14px、左右吃 --shell-x」這個形狀。
    expect(block('header.css', '.pcm-header-inner'), '頁首桌機 padding 不是「14px + --shell-x」兩值形式')
      .toMatch(/padding:\s*14px\s+var\(--shell-x\)\s*;/);
    const mobileHeader = mediaBlock('header.css', '(max-width: 1079px)');
    // 🔴 2026-08-09 **刻意不再釘手機 padding 的數值**,只釘形狀(兩值、左右 16px)。
    //    理由:下面那條「算式自己算一次」如果連 padding 也被逐字釘死,它就被這幾條**嚴格蘊含**
    //    —— 四個成分都固定的話,加起來當然等於 token,那條會變成**恆真、零判別力**
    //    (寫不出只紅它的突變 = 守門是 no-op,本週已踩過三次)。
    //    把數值交給算式那條去守 ⇒ 「padding 改 8px 卻忘了同步 token」現在只有它會紅。
    expect(mobileHeader, '頁首 ≤1079 段的 padding 不是「上下 + 左右 16px」兩值形式')
      .toMatch(/padding:\s*[0-9.]+px\s+16px\s*;/);
    // 按鈕 44px 留逐字釘:它的理由**不是算式**,是觸控無障礙底線(獨立於頁首高度)。
    expect(block('header.css', '.pcm-icon-btn'), '按鈕高不是 44 ⇒ 破觸控無障礙底線(與頁首高度無關的獨立理由)')
      .toMatch(/height:\s*44px/);
  });

  // 🔴🔴 2026-08-09 新增:**算式自己算一次**,不是逐個比字面。
  //    上面那條釘的是「成分還在」,但成分對不代表加起來等於 token —— 有人把 padding 改成 9px、
  //    token 忘了跟著改,上面那條會紅沒錯;可是有人**兩邊都改、卻算錯**(例如 padding 8 配 token 60),
  //    上面那組逐字比對就完全看不出來。這條把加法真的做一遍。
  it('🔴 手機頁首:padding×2 + 鈕高 + 下框線 == --shell-header-h(token 不准說謊)', () => {
    const num = (re: RegExp, hay: string, what: string) => {
      const m = re.exec(hay);
      expect(m, `抓不到${what} ⇒ 本條前提失效`).not.toBeNull();
      return Number(m?.[1]);
    };
    const mobileHeader = mediaBlock('header.css', '(max-width: 1079px)');
    const pad = num(/padding:\s*([0-9.]+)px\s+[0-9.]+px\s*;/, mobileHeader, '手機 padding');
    const btn = num(/height:\s*([0-9.]+)px/, block('header.css', '.pcm-icon-btn'), '按鈕高');
    const border = num(/border-bottom:\s*([0-9.]+)px/, block('header.css', '.pcm-header {'), '下框線');
    const token = num(
      /--shell-header-h:\s*([0-9.]+)px/,
      mediaBlock('tokens.css', '(max-width: 1079px)'),
      '手機 token',
    );
    expect(
      pad * 2 + btn + border,
      `算出來是 ${pad * 2 + btn + border}px,token 卻宣告 ${token}px ⇒ 全站 sticky 偏移會差 ${Math.abs(pad * 2 + btn + border - token)}px,而畫面不會有任何錯誤`,
    ).toBe(token);
  });

  // 🔴 LOGO 置中(Sean 2026-08-09 拍板)。原本是 flex + space-between ⇒ 左邊兩顆鈕、右邊一顆,
  //    LOGO 落在剩餘空間的中央 = 對視窗**偏右 24px**(390 與 768 實測皆 24)。
  //    釘的是「三欄 grid + 左右各佔一等份」這個**結構**,不是某個位移數字 ——
  //    位移是結果、CSS 測不到;結構在,置中就成立,而且兩側鈕數量再變也不會失準。
  it('🔴 手機頁首 LOGO 對視窗置中(三欄 grid、左右等寬)', () => {
    const mobileHeader = mediaBlock('header.css', '(max-width: 1079px)');
    expect(mobileHeader, '頁首手機段不是 grid ⇒ 退回 flex 的話 LOGO 會再次偏右').toMatch(
      /\.pcm-header-inner\s*\{[^}]*display:\s*grid/,
    );
    expect(
      mobileHeader,
      '三欄不是「1fr auto 1fr」⇒ 左右不等寬,中欄就不是對視窗置中',
    ).toMatch(/grid-template-columns:\s*1fr\s+auto\s+1fr/);
    expect(mobileHeader, '左欄沒有靠左').toMatch(/\.pcm-header-left\s*\{[^}]*justify-self:\s*start/);
    expect(mobileHeader, '右欄沒有靠右').toMatch(/\.pcm-header-right\s*\{[^}]*justify-self:\s*end/);
  });

  // 🔴 兩處斷點必須同值:`header.css` 在 1079 收 padding,token 也在 1079 換值。
  //    只改一邊的話,中間那一段(例如改成 1023)token 會說謊 —— 症狀只有「sticky 差幾像素」。
  it('🔴 前提 — token 的斷點與 header padding 的斷點同為 1079px', () => {
    expect(mediaBlock('tokens.css', '(max-width: 1079px)'), 'token 斷點不是 1079').not.toBe('');
    expect(mediaBlock('header.css', '(max-width: 1079px)'), 'header padding 斷點不是 1079').not.toBe('');
  });

  it.each(CONSUMERS)('🔴 %s 不得再把頁首高度寫死(69 / 73 / 64 / 65 都不行)', (f) => {
    // 只掃 `top:` 與 `calc(100vh …)` 這兩種用途,避免誤傷跟頁首無關的 64px(如 TabBar 高)。
    // 🔴 已經吃了 token 的宣告要放行:`calc(var(--shell-header-h) + 64px)` 裡的 64
    //    是**那條 bar 自己的高度**、不是頁首高 —— 一律當違規會逼人把對的寫法改掉。
    const suspects = [
      ...(CSS[f].match(/top:\s*[^;]+;/g) ?? []),
      ...(CSS[f].match(/height:\s*calc\(100vh[^;]*;/g) ?? []),
    ].filter((d) => !d.includes('var(--shell-header-h)'));
    for (const d of suspects) {
      expect(d, `${f} 出現寫死的頁首高度偏移:${d.trim()}`).not.toMatch(/\b(69|73|64|65)px\b/);
    }
  });

  it('🔴 五支消費端真的都在吃這顆 token(不是「剛好沒寫死」而已)', () => {
    for (const f of CONSUMERS) {
      expect(CSS[f], `${f} 完全沒有消費 --shell-header-h ⇒ 它的偏移改吃了別的東西`)
        .toMatch(/var\(--shell-header-h\)/);
    }
  });

  // 🔴 D-111-A nit 3:composite 偏移裡的 `+ 64px` 是**選車列的實量高度**,而
  //    `.cft-bar` 的高度是內容撐出來的、CSS 裡沒有任何地方宣告它 ⇒ **文字層釘不住那個 64**。
  //    真瀏覽器量「重疊 = 0」也分不出 63 與 64(1px 差在 sticky 上看不出來)。
  //    ⚠️ 所以這條**不宣稱**「64 是對的」,它只釘一件釘得住的事:
  //       兩個吃 cascade bar 的地方**必須用同一個數字**。它們漂開的症狀是
  //       「側欄與標題的黏頂位置差一點」,而那不會有任何東西紅。
  //    這個數字的正確性靠真瀏覽器實量。
  //    🔶 **2026-08-06 第3批:64 → 70**。R1-3 把選車欄位改成 44px 高、列直距 10→12
  //       ⇒ 列本身變高。**這不是「為了讓測試過而改期望值」** —— 是被測的東西真的變了,
  //       而且新值同樣是**實量**的:真瀏覽器 `.cft-bar` height = 70、bottom = 143、
  //       兩處 sticky top = 143(頁首 73 + 列 70),重疊 = 0。
  //       ⚠️ 設計稿寫的是 139,那是它自己的頁首 69 + 70;真站頁首是 73 ⇒ **不能照抄設計稿的總和**。
  const CASCADE_BAR_H = '70'; // 實量;改這裡之前先在真瀏覽器重量一次 `.cft-bar` 的 height
  it('🔴 cascade bar 的高度在兩個消費點必須同值(文字層釘不住它對不對,但釘得住它一致)', () => {
    const offsets = [
      ...(CSS['products-page.css'].match(/calc\(var\(--shell-header-h\) \+ (\d+)px\)/g) ?? []),
      ...(CSS['filter-side.css'].match(/var\(--shell-header-h\)[^;]*?(\d+)px/g) ?? []),
    ];
    const cascade = new Set(
      offsets.map((o) => o.match(/(\d+)px/)?.[1]).filter((n) => n === CASCADE_BAR_H),
    );
    expect(
      cascade.has(CASCADE_BAR_H),
      `找不到任何 + ${CASCADE_BAR_H}px 的 cascade 偏移 ⇒ 本條的前提已失效(列高又變了?先重量再改這個常數)`,
    ).toBe(true);
    // 反面:`filter-side.css` 的 top 與 height 必須用同一個數字,否則側欄高度與位置對不上。
    const side = CSS['filter-side.css'];
    const sideTop = side.match(/top:\s*calc\(var\(--shell-header-h\) \+ (\d+)px\)/)?.[1];
    const sideH = side.match(/height:\s*calc\(100vh - var\(--shell-header-h\) - (\d+)px\)/)?.[1];
    expect(sideTop, 'filter-side 的 cascade top 不見了').toBeDefined();
    expect(sideH, 'filter-side 的 cascade height 不見了').toBeDefined();
    expect(sideH, `側欄 top 用 ${sideTop}、height 卻扣 ${sideH} ⇒ 兩者漂開了`).toBe(sideTop);
    // 同樣要與 .pp-head 的 cascade 偏移同值(它們黏在同一條 bar 底下)。
    const headCascade = CSS['products-page.css']
      .match(/\[data-filter-style="cascade"\] \.pp-head \{[^}]*\+ (\d+)px/)?.[1];
    expect(headCascade, '.pp-head 的 cascade 偏移不見了').toBeDefined();
    expect(headCascade, `.pp-head 用 ${headCascade}、側欄用 ${sideTop} ⇒ 兩者黏頂位置會差開`)
      .toBe(sideTop);
  });
});

describe('§4-4 TabBar 平板段(600-1079px)', () => {
  const TABLET = '(min-width: 600px) and (max-width: 1079px)';

  it('平板段存在(斷點字面 600-1079,不是隨手挑的數字)', () => {
    expect(mediaBlock('mobile-tabbar.css', TABLET), `找不到 @media ${TABLET}`).not.toBe('');
  });

  it('🔴 平板段的四個值:高 68 / 字級 12 / gap 4 / body 讓位 74', () => {
    const t = mediaBlock('mobile-tabbar.css', TABLET);
    expect(t, 'TabBar 高不是 68px').toMatch(/height:\s*68px/);
    expect(t, '分頁字級不是 12px(平板吃到 10px 手機值正是本段要修的症狀)').toMatch(/font-size:\s*12px/);
    expect(t, 'icon 與標籤的 gap 不是 4px').toMatch(/gap:\s*4px/);
    expect(t, 'body 讓位沒跟著長到 74px ⇒ 最後一列內容被 68px 的 bar 蓋住').toMatch(
      /padding-bottom:\s*calc\(74px \+ env\(safe-area-inset-bottom\)\)/,
    );
  });

  // 🔴 這條是本檔的核心。上一條「四個值都在」在兩種情況下都會綠:
  //    ①平板段真的生效 ②平板段被 `html[data-mobile="true"]` 兜底整段蓋掉、一個值都沒生效。
  //    ⇒ 只有這條分得出來。刪掉平板段裡任一條 `html[data-mobile="true"]` 選擇器 ⇒ 只有這條轉紅。
  it('🔴 平板段的兩條規則都帶上 data-mobile 兜底選擇器(否則被權重蓋回手機值、整段 no-op)', () => {
    const t = mediaBlock('mobile-tabbar.css', TABLET);
    expect(
      t,
      '平板段的 .mobile-tabbar 少了 html[data-mobile="true"] 那半 ⇒ 被 (0,2,1) 的 SSR 兜底蓋回 64px',
    ).toMatch(/html\[data-mobile="true"\]\s+\.mobile-tabbar\b/);
    expect(
      t,
      '平板段的 body 少了 html[data-mobile="true"] 那半 ⇒ 被 (0,1,2) 的 SSR 兜底蓋回 70px',
    ).toMatch(/html\[data-mobile="true"\]\s+body\b/);
  });

  // 前提斷言:上面那條的必要性建立在「兜底那組還在、而且權重比裸選擇器高」。
  // 兜底哪天被移除,這整組推理就換了地基 —— 那時該重想,不該讓斷言繼續假裝還在守同一件事。
  it('前提 — html[data-mobile="true"] 的 SSR 兜底仍存在(本段的權重推理以它為地基)', () => {
    expect(CSS['mobile-tabbar.css']).toMatch(/html\[data-mobile="true"\]\s+\.mobile-tabbar\s*\{/);
    expect(CSS['mobile-tabbar.css']).toMatch(/html\[data-mobile="true"\]\s+body\s*\{/);
  });

  it('前提 — 平板段序在 data-mobile 兜底之後(同權重時靠順序決勝)', () => {
    const src = CSS['mobile-tabbar.css'];
    // 🔴 用 indexOf 不用 lastIndexOf:平板段**自己**也含一條 `html[data-mobile="true"] body {`
    //    (就是上一條要求的那半)⇒ lastIndexOf 會抓到平板段內部那條、把「序在後」比成「序在自己之前」。
    //    第一次出現的才是最外層的 SSR 兜底。(初稿真的寫成 lastIndexOf、被這條斷言當場抓到。)
    const fallback = src.indexOf('html[data-mobile="true"] body {');
    const tablet = src.indexOf(`@media ${TABLET} {`);
    expect(fallback, '找不到 data-mobile 兜底').toBeGreaterThan(-1);
    expect(tablet, '找不到平板段').toBeGreaterThan(-1);
    expect(tablet, '平板段被搬到兜底之前 ⇒ 同權重下輸給兜底、整段失效').toBeGreaterThan(fallback);
  });
});
