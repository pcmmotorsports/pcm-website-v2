// brand-page.test.ts — 品牌頁 CSS 的文字層守門(D2b / D2c-1 / D2c-2;2026-08-04)
//
// 對齊 `styles/products-mobile.test.ts` 的既有慣例:有些 CSS 性質**只在特定資料或
// 特定視窗下才看得見**,jsdom 不套 media query、也不算 CSS 權重,元件測試一律綠。
// 這支直接讀 CSS 原文斷言。
//
// 🔴 這支擋的是「現在的資料剛好走不到、所以壞了也沒人知道」那一類:
//    20 家目前**全部都有橫幅照**,所以 `.no-photo` 那條路在正式資料下不可達。
//    但元件支援 band 缺席(D2b 測試有覆蓋),而設計稿對這條路徑留了一個明確的權重陷阱。
//    等哪天真的上架一家沒有官方授權照的品牌,才發現窄螢幕整條帶變全黑 —— 太晚了。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CSS_RAW = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'brand-page.css'),
  'utf8',
);

// 🔶 2026-08-06 升級片:--c-graphite / --f-serif 同時定義在 tokens.css 的 :root。
// 分岔守門(見檔尾)要比對兩處字面值,故也讀這個檔。
const TOKENS_CSS_RAW = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
);
const TOKENS_CSS = TOKENS_CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 🔴 剝掉 `/* … *\/` 註解後再做任何結構斷言。
 *
 * 為什麼:本檔的註解**大量引用選擇器名稱**(那是刻意的,坑要寫在坑旁邊)。
 * 直接對原文做 indexOf / 正規式,命中的可能是註解裡的那串字而不是真的規則 ——
 * 實測就發生過:「no-photo 必須排在 @media 之後」那條第一版量到的是舊位置留下的
 * 一句「`.bp-band.no-photo::after` 不在這裡」的說明文字,於是斷言在規則已經搬對之後
 * **仍然紅**。反過來也一樣危險:規則被整段註解掉,而測試照樣綠。
 */
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, '');

describe('品牌頁 CSS · 檔案本身沒壞', () => {
  it('🔴 註解符號成對(未閉合的 /* 會讓瀏覽器吞掉後半個檔,而剝註解的守門照樣全綠)', () => {
    // 主視窗 C-05-A nit-1:上面那個 strip 正規式碰到未閉合的 `/*` 就從該處起不匹配,
    // 於是 CSS 常數保留了原文 ⇒ 順序/存在性斷言全部照樣綠。
    // 但真正的瀏覽器會把 `/*` 之後直到檔尾都當成註解 —— 包含 no-photo 規則本體。
    // ⇒ 「守門全綠、頁面壞掉」。這一條先確認檔案本身是完整的,其餘斷言才有意義。
    const open = CSS_RAW.match(/\/\*/g)?.length ?? 0;
    const close = CSS_RAW.match(/\*\//g)?.length ?? 0;
    expect(open, `/* 有 ${open} 個、*/ 有 ${close} 個 — 註解沒閉合`).toBe(close);
    expect(open).toBeGreaterThan(0); // 前提:這個檔本來就有註解,數到 0 代表 regex 壞了
  });
});

/**
 * 取某個 @media 查詢的**全部**區塊內容(串接),大括號配對計數、不是抓到第一個 `}` 就停。
 *
 * 🔴 為什麼要收「全部」而不是第一塊:同一個查詢會出現不只一次 ——
 *    D2c-2 就讓 `(max-width: 1180px)` 變成兩塊(欄位釘死 + 直式片滿版)。
 *    只取第一塊的話,第二塊零覆蓋 —— 那正是「規則明明在檔裡、守門卻看不到」的假綠形狀。
 *    ⚠️ D2c-1 的原註解把這個例子寫成「D2c-2 會再帶一個 `@media (min-width:961px)`」,
 *       實際帶進來的是 `(min-width:1181px)` 與 `(min-width:961px) and (max-width:1180px)`
 *       —— 後者反而是上面那條前綴比對修正在防的東西。已依實際落地更正。
 */
function mediaBlock(query: string): string {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    // 🔴 比對到 `{` 為止,不是前綴比對:D2c-2 帶進 `@media (min-width: 961px) and
    //    (max-width: 1180px)`,而 `(min-width: 961px)` 是它的前綴。前綴比對會把那一塊
    //    也算進 `(min-width: 961px)` 的結果 ⇒ 有人把 `.no-aside` 搬進「961-1180」那塊
    //    (>1180 當場失效)守門照樣綠。這是這支檔案在防的同一種假綠,只是從查詢那一端進來。
    const start = CSS.indexOf(`@media ${query} {`, from);
    if (start === -1) break;
    const open = CSS.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    blocks.push(CSS.slice(open + 1, end));
    from = end + 1;
  }
  return blocks.join('\n');
}

/**
 * 收**全部** `.bp-page {` 區塊的內容(串接)。D2e-1 讓本檔有兩塊(色票 + 分類色碼),
 * 沿用既有那套 `indexOf('.bp-page {')` 只會拿到第一塊。
 * 🔴 用大括號配對計數,不是抓第一個 `}` 就停 —— 理由同上面的 mediaBlock()。
 */
function bpPageScopes(): string {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = CSS.indexOf('.bp-page {', from);
    if (start === -1) break;
    const open = CSS.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break;
    blocks.push(CSS.slice(open + 1, end));
    from = end + 1;
  }
  return blocks.join('\n');
}

/**
 * 把 CSS 拆成 { 選擇器, 宣告區, 所在的 at-rule 堆疊 } —— 大括號配對走訪,不是正規式。
 *
 * 🔴 **為什麼不用正規式**(D2e-2 關卡2 R2 一口氣打掉四個洞,全部出在同一族 `[^}]*` 寫法):
 *   · `animation:\s*[a-zA-Z]` 要求值的第一個字元是字母 ⇒ `animation: 620ms … bp-rise`
 *     這種 **duration-first 的 shorthand 靜默通過**(而那是最常見的寫法)
 *   · `[^}]*` 跨得過內層 `{` ⇒ **任何 @media 內的動畫完全隱形**,捕獲到的是 `@media (…)` 本身
 *   · `CSS.split(mediaBlock(...)).join('')` 想切掉 reduce 區塊 —— 但 mediaBlock() 回傳的是
 *     **兩塊串接**、那個字串在 CSS 裡並不存在 ⇒ split 是 **no-op**(實測 24730 === 24730),
 *     於是「區塊外」其實包含區塊本身 ⇒ reduce 裡的規則自我滿足
 *   · `transform:\s*(?!none)` 的 `\s*` 會回溯成零寬 ⇒ lookahead 看到空格而非 `none`
 *     ⇒ **`transform: none` 也被當成位移**
 *   走訪器一次把這四個洞全部關掉,而且之後新增的守門不必再各自防一遍。
 */
type CssRule = { selector: string; body: string; at: string[] };

function cssRules(): CssRule[] {
  const out: CssRule[] = [];
  const stack: string[] = [];
  let i = 0;
  let buf = '';
  while (i < CSS.length) {
    const ch = CSS[i];
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) { stack.push(prelude); i++; continue; }
      let depth = 1;
      let j = i + 1;
      while (j < CSS.length && depth > 0) {
        if (CSS[j] === '{') depth++;
        else if (CSS[j] === '}') depth--;
        j++;
      }
      out.push({ selector: prelude, body: CSS.slice(i + 1, j - 1), at: [...stack] });
      i = j;
      continue;
    }
    if (ch === '}') { stack.pop(); buf = ''; i++; continue; }
    buf += ch;
    i++;
  }
  return out;
}

const inReduce = (r: CssRule) => r.at.some((a) => a.includes('prefers-reduced-motion'));
/** 該選擇器在 reduce 區塊裡有沒有被真的「關掉」(不是只出現過)。 */
function neutralisedIn(rules: CssRule[], selector: string, prop: 'animation' | 'transform'): boolean {
  return rules.filter(inReduce).some(
    (r) => r.selector.split(',').map((x) => x.trim()).includes(selector)
      && new RegExp(`${prop}\\s*:\\s*none`).test(r.body),
  );
}

describe('品牌頁 CSS · 窄螢幕橫幅', () => {
  const narrow = mediaBlock('(max-width: 960px)');

  it('前提斷言:≤960 區塊抓得到、且大括號有配對到底', () => {
    // 🔴 沒有這條,下面幾條在 mediaBlock 回空字串時會全部「找不到 = 通過」。
    // 也擋「只抓到第一個 } 就停」的切片 bug(切壞的話這個長度會明顯偏小)。
    expect(narrow.length).toBeGreaterThan(400);
    expect(narrow).toContain('.bp-band-inner');
  });

  it('🔴 窄螢幕的幕必須用兩個 class 選擇器 .bp-band.bp-band::after', () => {
    // 設計稿逐字:少寫一個 class 就會被 `.bp-band.no-photo::after`(0-2-0)蓋掉,
    // 窄螢幕變回全黑。20 家目前全有照片 ⇒ 這條路在正式資料下不可達 ⇒ 只能靠這裡守。
    expect(narrow).toContain('.bp-band.bp-band::after');
    // 反面:同一區塊裡不得出現只寫一個 class 的版本(那就是被蓋掉的那種寫法)
    expect(/(^|[^.\w])\.bp-band::after/.test(narrow)).toBe(false);
  });

  it('🔴 no-photo 那段必須排在 ≤960 的 @media **之後**(同權重靠順序決勝)', () => {
    // ⚠️ 這條是關卡2 抓到的漏洞:上一條只驗「單/雙 class」那一軸,
    //    對「兩段的先後」零斷言 —— 所以順序寫反了它照樣全綠,
    //    而順序寫反的後果跟少寫一個 class 一樣嚴重(窄螢幕的 no-photo 品牌變整條平黑),
    //    只是從另一個方向壞掉。
    // 設計稿的順序:brand-page.html 的 @media 在 :883、no-photo 在 :952。
    const mediaIndex = CSS.indexOf('@media (max-width: 960px)');
    const noPhotoIndex = CSS.indexOf('.bp-band.no-photo::after');
    expect(mediaIndex, '找不到 ≤960 的 @media').toBeGreaterThan(-1);
    expect(noPhotoIndex, '找不到 .bp-band.no-photo::after').toBeGreaterThan(-1);
    expect(
      noPhotoIndex,
      'no-photo 規則跑到 @media 前面了 ⇒ 窄螢幕的無照片品牌會吃到「照片版」漸層 = 整條平黑',
    ).toBeGreaterThan(mediaIndex);
  });

  it('照片高度與 inner 的 padding-top 綁在一起(220 / 246)', () => {
    // 漸層停點用 px 不用 %,因為帶子高度會隨文案長度變;停點跟 220px 綁死。
    // 改了其中一個沒改另一個 ⇒ 文字會壓在照片上或浮在空白裡,兩個尺寸都要在。
    expect(narrow).toContain('height: 220px');
    expect(narrow).toContain('padding-top: 246px');
    // 幕的停點也必須是 px(用 % 就跟照片對不齊)。
    // ⚠️ 這裡不要用 /linear-gradient\(180deg[^)]*0px/ —— `[^)]*` 跨不過 rgba(...) 自己的
    //    右括號,恆不命中(本條第一版就是這樣紅的,是斷言錯不是 CSS 錯)。
    //    改成直接斷言設計稿的四個字面停點。
    for (const stop of ['.10) 0px', '.26) 128px', '.88) 196px', '#202225 226px']) {
      expect(narrow, `窄螢幕幕的停點 ${stop} 不見了`).toContain(stop);
    }
    // 反面:停點不得改用 %(帶子高度會隨文案長度變,用 % 就跟照片對不齊)
    expect(/linear-gradient\(180deg[\s\S]{0,200}?\d+%\s*,/.test(narrow)).toBe(false);
  });

  it('logo 收到 190px、不得低於 180(細線描邊的 mark 會糊成一團)', () => {
    const m = narrow.match(/\.bp-band-logo img\s*\{[^}]*max-width:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(180);
  });
});

describe('品牌頁 CSS · 深底元件的 fallback', () => {
  it('🔴 每一處 var(--c-graphite) 都要帶 fallback(scope 漏掛 ⇒ 深底配白字變全白)', () => {
    // 🔶 2026-08-06 升級:`--c-graphite` 現在**也**定義在 tokens.css 的 `:root`
    // (首頁 N°04 要用)——但這些品牌頁元件是 fragment、scope 由外層路由掛,
    // 不能保證 `.bp-page` 一定包住它們;fallback 是縱深防禦、不是唯一防線。
    // D3 接線漏掛的話 var() 無值 ⇒ 背景失效、配上寫死的 color:#fff = 整塊看不見。
    // 一個 fallback 換掉那個失敗模式;逐處數,不是只驗「有一處有」。
    const uses = CSS.match(/var\(--c-graphite[^)]*\)/g) ?? [];
    expect(uses.length, '一處都沒有 ⇒ 這條在守一個不存在的東西').toBeGreaterThan(0);
    for (const u of uses) expect(u, `${u} 少了 fallback`).toContain(',');
  });
});

describe('品牌頁 CSS · 色票 scope', () => {
  it('🔴 設計色票掛在 .bp-page,不是 :root', () => {
    // ⚠️ **原本的理由已於 2026-08-05 第0批 0c 消失**:當時 `--c-red` 在正式站是 `#dc2626`、
    //    與設計的熔橘 `#f26722` 值不同,寫進 `:root` 會讓每一頁的按鈕/價格當場變色。
    //    0c 把站台換成熔橘之後兩者**同值** ⇒ 這條反面斷言不再擋得住視覺缺陷,
    //    現在守的是**架構分離**(品牌頁色票不外洩到 `:root`)。仍留著:
    //    本檔 scope 內還有 `--cat-*` / `--ease` 等**不是**站台 token 的東西,
    //    一旦有人把整塊搬進 `:root`,那些才是真的會污染全站。
    //    🔶 2026-08-06:`--f-serif` 已從這份例子清單移除 —— 它與下面斷言的
    //    `--c-graphite` 一起升上 tokens.css 的 :root 了,不再是「不是站台 token」的例子。
    expect(CSS).toContain('.bp-page {');
    expect(CSS).not.toMatch(/^\s*:root\s*\{/m);
    // 🔴 D2e-1 起本檔有**兩塊** `.bp-page {`(色票 + 分類色碼)⇒ 改用 bpPageScopes()。
    //    原本的 `slice(indexOf(...), indexOf('}', ...))` 只取第一塊:今天不假綠,
    //    但色票塊哪天被排到第二塊就會假紅(R2 nit)。
    const scope = bpPageScopes();
    expect(scope).toContain('--c-red: #f26722');
    expect(scope).toContain('--c-graphite: #202225');
  });
});

describe('品牌頁 CSS · About 欄線(D2c-1)', () => {
  it('🔴 no-aside 的欄寬規則必須包在 min-width: 961px 裡', () => {
    // `.bp-about-inner.no-aside` 是 0-2-0,而 ≤960 的單欄規則 `.bp-about-inner` 只有 0-1-0。
    // 不設限的話它會蓋過單欄規則 ⇒ 手機版標籤與正文變左右並排(設計稿 :960 逐字警告)。
    const wide = mediaBlock('(min-width: 961px)');
    expect(wide, '找不到 min-width:961 區塊').toContain('.bp-about-inner.no-aside');
    // 反面:同一條選擇器不得出現在任何 @media 之外(那就等於無條件生效)
    const outsideMedia = CSS.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
    expect(outsideMedia).not.toContain('.bp-about-inner.no-aside');
  });

  it('🔴 ≤960 必須把 .bp-aside 的 grid-column 收回 auto', () => {
    // ≤1180 把 aside 釘在第 2 欄;≤960 容器已收成單欄,忘了收回 auto 會生出隱式欄位
    // ⇒ 正文被擠成 242px 的細長條(設計稿 §4b 記載的實際事故,用 getComputedStyle 才量到)。
    const narrow = mediaBlock('(max-width: 960px)');
    expect(narrow).toMatch(/\.bp-aside\s*\{[^}]*grid-column:\s*auto/);
    // 前提斷言:≤1180 真的有把它釘在第 2 欄,否則上面那條在守一個不存在的問題
    expect(mediaBlock('(max-width: 1180px)')).toMatch(/\.bp-aside\s*\{[^}]*grid-column:\s*2/);
  });

  it('手機置中的例外:About 正文不得被列入置中清單', () => {
    // 中文長段落置中會兩邊都毛毛的、每行起點對不齊
    // (brand-page-integration.md §4b:204-208:可讀性不是品味)。
    const narrow = mediaBlock('(max-width: 960px)');
    // 前提斷言:置中規則**真的存在**。原本只驗 narrow 含 `.bp-sec-label` 這串字 ——
    // 但 `.bp-sec-label::after` 也含那串,把整條置中刪掉測試照樣綠(審查 nit)。
    expect(narrow).toMatch(/\.bp-sec-label\s*\{[^}]*text-align:\s*center/);
    // 反面①:正文自己不得被置中
    expect(narrow).not.toMatch(/\.bp-body[^{]*\{[^}]*text-align:\s*center/);
    // 反面②:也不得靠**繼承**把正文吃掉 —— 置中掛在祖先(.bp-about-inner / .bp-about)
    //   一樣會讓中文長段落置中,而反面①抓不到(審查 nit)。
    expect(narrow).not.toMatch(/\.bp-about(-inner)?\s*\{[^}]*text-align:\s*center/);
  });
});

describe('品牌頁 CSS · 影片右欄(D2c-2)', () => {
  it('🔴 has-portrait-media 的欄寬規則必須包在 min-width 裡', () => {
    // 與 .no-aside 同一個陷阱:`.bp-about-inner.has-portrait-media` 是 0-2-0,
    // ≤960 的單欄規則 `.bp-about-inner` 只有 0-1-0 ⇒ 不設限會蓋過它,
    // 手機版標籤與正文變左右並排(設計稿 :996-997 逐字警告)。
    const outsideMedia = CSS.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
    expect(outsideMedia).not.toContain('.bp-about-inner.has-portrait-media');
    // 正面:>1180 收窄第三欄、961-1180 跨滿整列,兩塊都要在(少一塊 = 那個區間失效)
    expect(mediaBlock('(min-width: 1181px)')).toContain('.bp-about-inner.has-portrait-media');
    expect(mediaBlock('(min-width: 961px) and (max-width: 1180px)'))
      .toMatch(/\.bp-about-inner\.has-portrait-media \.bp-media\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });

  it('🔴 ≤960 必須把 .bp-media 的 grid-column 收回 auto,且排在 ≤1180 之後', () => {
    // ≤1180 把影片欄釘在第 2 欄,而該查詢在 ≤960 同樣命中;兩條都是 0-1-0
    // ⇒ 勝負只看順序。順序反了 ⇒ 單欄容器為它生出隱式欄位,正文被擠成細長條
    //   (與 .bp-aside 在 §4b 記載的實際事故同一個形狀)。
    expect(mediaBlock('(max-width: 960px)')).toMatch(/\.bp-media\s*\{[^}]*grid-column:\s*auto/);
    // 前提斷言:≤1180 真的有把它釘在第 2 欄,否則上面那條在守一個不存在的問題
    expect(mediaBlock('(max-width: 1180px)')).toMatch(/\.bp-media\s*\{[^}]*grid-column:\s*2/);
    // 順序:同權重靠先後決勝(這一條抓的是「兩個 @media 區塊被對調」)。
    // 🔴 比的是「真的寫著 grid-column: 2 的那一塊」的位置,不是第一塊 ——
    //    本片讓 (max-width: 1180px) 變成兩塊,拿第一塊比會被繞過去:
    //    把 `.bp-media{grid-column:2}` 搬進第二塊、第二塊再移到 ≤960 之後,
    //    mediaBlock() 串接後仍含那串字、indexOf 仍指向第一塊 ⇒ 全綠而 cascade 已壞(關卡2 nit)。
    const pinIndex = CSS.search(/\.bp-media\s*\{[^}]*grid-column:\s*2/);
    const autoIndex = CSS.search(/\.bp-media\s*\{[^}]*grid-column:\s*auto/);
    expect(pinIndex, '找不到把 .bp-media 釘在第 2 欄的規則').toBeGreaterThan(-1);
    expect(autoIndex, '≤960 收回 auto 的規則必須排在釘死那條之後').toBeGreaterThan(pinIndex);
  });

  it('🔴 直式片滿版的三個坑:100vw / 負 margin / svh 沒有 vh 墊底', () => {
    const tablet = mediaBlock('(max-width: 1180px)');
    expect(tablet).toContain('.bp-media:has(.bp-film-frame.is-portrait)');
    expect(tablet).not.toContain('100vw');
    // 置中用 margin-left:50% + translateX(-50%);負 margin 在寬度被 svh 夾住時會偏左
    expect(tablet).toContain('margin-left: 50%');
    // 縮寫也要擋:`margin: 0 0 0 -50%` 與 `margin-left: -50%` 是同一個坑(關卡2 nit)
    expect(tablet).not.toMatch(/margin(-left)?:[^;}]*-\d/);
    // svh 版本前面必須留一行 vh 墊底:舊瀏覽器不認 svh,整條 width 會失效
    expect(tablet).toMatch(/58vh\)[\s\S]{0,80}58svh\)/);
    expect(tablet).toMatch(/46vh\)[\s\S]{0,80}46svh\)/);
  });

  it('🔴 播放鈕的焦點框:負 offset(不被裁)+ 換成 --c-red(黑框壓在深色封面上看不見)', () => {
    // 兩條都沒有畫面症狀 —— 滑鼠使用者永遠看不到,截圖也看不出「本來該有一圈」。
    // ②是真機截圖抓到的:第一版只修了 offset,結果近黑的框畫在深色影片封面上仍然無效。
    const rule = CSS.match(/\.bp-film-poster:focus-visible\s*\{([^}]*)\}/)?.[1];
    expect(rule, '找不到 .bp-film-poster:focus-visible').toBeDefined();
    const offset = rule?.match(/outline-offset:\s*(-?[\d.]+)px/)?.[1];
    expect(Number(offset), '正的 offset 會被 overflow:hidden 整圈裁掉').toBeLessThan(0);
    expect(rule, '焦點色沒換 ⇒ 吃全站的 --c-text(近黑),壓在深色封面上等於沒有')
      .toMatch(/outline-color:\s*var\(--c-red/);
    // 前提斷言:①框真的是 overflow:hidden ②按鈕真的是 inset:0(撐滿整個框)
    //   —— 少了任一個,上面兩條都在守一個不存在的問題。
    expect(CSS).toMatch(/\.bp-film-frame\s*\{[^}]*overflow:\s*hidden/);
    expect(CSS).toMatch(/\.bp-film-poster[^{]*\{[^}]*inset:\s*0/);
  });

  it('封面 7:3 / 播放 16:9 / 直式 3:4 → 9:16 四個比例齊全', () => {
    // 少任何一個都是「畫面正常但比例不對」:封面用 16:9 會比正文高 75px、
    // 直式片展成 16:9 會被裁掉上下(設計稿 :981-995 逐字量過)。
    expect(CSS).toMatch(/\.bp-film-frame\s*\{[^}]*aspect-ratio:\s*7\/3/);
    expect(CSS).toMatch(/\.bp-film-frame\.is-playing\s*\{[^}]*aspect-ratio:\s*16\/9/);
    expect(CSS).toMatch(/\.bp-film-frame\.is-portrait\s*\{[^}]*aspect-ratio:\s*3\/4/);
    expect(CSS).toMatch(/\.bp-film-frame\.is-portrait\.is-playing\s*\{[^}]*aspect-ratio:\s*9\/16/);
    // 反面:比例不得走 transition —— aspect-ratio 是佈局屬性,過渡會讓底下整頁位移
    expect(CSS).not.toMatch(/transition:[^;}]*aspect-ratio/);
  });
});

describe('品牌頁 CSS · Why 與數字條(D2d-1)', () => {
  it('🔴 數字條欄數吃 --num-n(寫死 4 會讓只有 3 個數字的 6 家多一格空白 + 斷掉的分隔線)', () => {
    expect(CSS).toContain('repeat(var(--num-n, 4)');
    expect(CSS).not.toMatch(/\.bp-nums\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  });

  it('🔴 ≤1024 兩欄版的「最後一列」要依 data-n 分流,不是寫死最後兩個', () => {
    // 4 個排 2×2 時最後一列是第 3、4 個;3 個排成 2+1 時只有第 3 個。
    // 寫死 `-n+2` 的話 3 個數字的第 2 格會提早收掉底線 → 第一列變成半條線
    // (設計稿 :1164-1168 逐字)。這只在那 6 家 × ≤1024 才看得到。
    const mid = mediaBlock('(max-width: 1024px)');
    expect(mid, '找不到 ≤1024 區塊').toContain('.bp-nums');
    expect(mid).toMatch(/\.bp-num:last-child\s*\{[^}]*border-bottom:\s*0/);
    expect(mid).toMatch(/\.bp-nums\[data-n="4"\] \.bp-num:nth-last-child\(2\)/);
    // 反面:不得退回寫死的 -n+2 版本
    expect(mid).not.toContain('-n+2');
    // 兩欄下右緣那條:偶數格必須收掉右線,否則第 2、4 格右邊各多一條懸空的線(關卡2 N1)
    expect(mid).toMatch(/\.bp-num:nth-child\(2n\)\s*\{[^}]*border-right:\s*0/);
  });

  it('數字條與卡片之間那條分隔線(.bp-nums 的 border-top)必須在', () => {
    // 關卡2 N1:整條 border-top 刪掉時 32 條測試全綠 —— 它是「卡片區」與「數字區」之間
    // 唯一的視覺分界,沒有它兩塊會黏成一團。用 --c-border-strong(比卡片格線深一階)。
    expect(CSS).toMatch(/\.bp-nums\s*\{[^}]*border-top:\s*1px solid var\(--c-border-strong\)/);
  });

  it('🔴 ≤1024 必須排在 ≤620 之前(同權重靠順序;反了手機收不成單欄)', () => {
    // 前提斷言:兩塊都真的存在。少了這兩行,≤1024 被整段刪掉時 indexOf 回 -1,
    // 而「620 的位置 > -1」恆真 ⇒ 這條會空過(關卡2 R2 nit)。
    const mid = CSS.indexOf('@media (max-width: 1024px) {');
    const small = CSS.indexOf('@media (max-width: 620px) {');
    expect(mid, '找不到 ≤1024 區塊').toBeGreaterThan(-1);
    expect(small, '找不到 ≤620 區塊').toBeGreaterThan(-1);
    expect(small).toBeGreaterThan(mid);
    // 前提斷言:≤620 真的有把數字條收成單欄,否則上面那條在守一個不存在的問題
    expect(mediaBlock('(max-width: 620px)'))
      .toMatch(/\.bp-nums\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it('🔴 ≤620 單欄要把 data-n=4 第 3 格的底線**還回來**(#310)', () => {
    // ≤1024 的 `[data-n="4"] .bp-num:nth-last-child(2){border-bottom:0}` 守的是**兩欄版**
    // 的「最後一列有兩格」;它在 ≤620 仍然命中(max-width:1024 涵蓋 620),而單欄下最後
    // 一列只有最後一格 ⇒ 4 個數字的 8 家在手機上第 3、4 格黏成一團(390 實測修前
    // data-n=4 → [1px,1px,0px,0px];data-n=3 → [1px,1px,0px] 本來就對)。
    const small = mediaBlock('(max-width: 620px)');
    expect(small, '找不到 ≤620 區塊').toContain('.bp-nums');
    expect(small).toMatch(
      /\.bp-nums\[data-n="4"\] \.bp-num:nth-last-child\(2\)\s*\{[^}]*border-bottom:\s*1px solid var\(--c-border\)/,
    );
    // 🔴 兩條反面缺一不可,各擋一種「看起來修好了但沒修好」:
    //   ① 還原規則不得寫成無條件(拿掉 [data-n="4"] ⇒ 3 個數字那 6 家的第 2 格會多一條線,
    //      而正面那條照樣綠 —— 它只查有沒有那個選擇器,不查有沒有多出別的)。
    //      🔴 用走訪器逐條看 selector,不用 `(?!…)` lookahead:`[data-n="4"]` 在
    //         `nth-last-child(2)` **前面**,往後看的 lookahead 永遠幫不上忙
    //         —— 第一版就是這樣寫的,而它對自己那條正確的規則誤紅。
    //      🔴 用**正面**條件(必須含 `[data-n="4"]`),不是「不含 `[data-n=`」——
    //         後者放行 `[data-n="3"] .bp-num:nth-last-child(2){border-bottom:1px}`,
    //         而那正是註解說不能做的那件事(3 個數字的 6 家會多一條線)。關卡2 nit。
    const restorers = cssRules().filter(
      (r) =>
        r.at.some((a) => a.includes('max-width: 620px')) &&
        r.selector.includes('nth-last-child(2)') &&
        /border-bottom:\s*1px/.test(r.body),
    );
    expect(restorers.length, '前提:≤620 真的有一條還原規則').toBe(1);
    expect(
      restorers.filter((r) => !r.selector.includes('[data-n="4"]')).map((r) => r.selector),
      '單欄還原只能掛在 data-n=4 上',
    ).toEqual([]);
    //   ② 順序:同權重 (0,3,1),≤620 必須排在 ≤1024 之後才蓋得掉(上一條測 ≤1024 在前,
    //      這裡直接量「還原那一行」自己的位置,免得有人把它搬進別的區塊)
    const restore = CSS.indexOf('.bp-nums[data-n="4"] .bp-num:nth-last-child(2) { border-bottom: 1px');
    const zeroed = CSS.indexOf('.bp-nums[data-n="4"] .bp-num:nth-last-child(2) { border-bottom: 0');
    expect(restore, '找不到還原那一行(格式被改過就會抓不到,請一起更新這條)').toBeGreaterThan(-1);
    expect(zeroed, '找不到 ≤1024 收線那一行').toBeGreaterThan(-1);
    expect(restore, '還原那一行排到收線那一行前面了 ⇒ 同權重下被蓋回 0').toBeGreaterThan(zeroed);
  });

  it('🔴 .bp-sr-only 真的是「看不見但唸得到」(#312 年表關鍵事件的載體)', () => {
    // display:none / visibility:hidden 會讓報讀器一起看不到 = 完全沒效果 ——
    // 而元件測試只查 `.bp-sr-only` 這個 class 在不在,對「它其實把內容也藏掉了」全盲。
    // 🔴 先用走訪器確認「**恰一條、且不在任何 @media 裡**」:規則被搬進斷點區塊、
    //    或多出第二條把它蓋回去,下面那組宣告斷言全部照樣綠(關卡2 nit)。
    //    🔴 用 `selector.includes` 不是逐段完全相等(關卡2 R2 殘留):完全相等只擋得住
    //       「第二條同名規則」,而 `.bp-time-body h3 .bp-sr-only{position:static}` 這種
    //       **更具體的覆寫**特異度更高、選擇器不相等 ⇒ 不入計數,而字就此變成看得見。
    const srRules = cssRules().filter((r) => r.selector.includes('.bp-sr-only'));
    expect(
      srRules.map((r) => r.selector),
      '整份只能有一條規則碰 .bp-sr-only(含更具體的覆寫)',
    ).toEqual(['.bp-sr-only']);
    expect(srRules[0]!.at, '.bp-sr-only 不得包在 @media 裡(斷點外就失效)').toEqual([]);
    const rule = CSS.match(/\.bp-sr-only\s*\{([^}]*)\}/);
    expect(rule, '找不到 .bp-sr-only 規則').not.toBeNull();
    const body = rule![1]!;
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/width:\s*1px/);
    expect(body).toMatch(/height:\s*1px/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    // 🔴 反面:這三個任一出現都會把內容從無障礙樹上一起拿掉
    expect(body, 'display:none 會讓報讀器也讀不到').not.toMatch(/display:\s*none/);
    expect(body, 'visibility:hidden 會讓報讀器也讀不到').not.toMatch(/visibility:\s*hidden/);
    expect(body, 'font-size:0 會讓部分報讀器跳過').not.toMatch(/font-size:\s*0/);
  });

  it('🔴 產品照卡標題吃 .bp-aside-title(#311 改成 <p> 後,舊的 h3 選擇器會靜默失效)', () => {
    // 元件端把 `<h3>` 換成 `<p class="bp-aside-title">`;CSS 若還寫 `.bp-aside-card h3`,
    // 三綠全綠、元件測試全綠,只有真站上那行字會掉回 UA 預設的 16px 黑字。
    expect(CSS).toMatch(/\.bp-aside-card \.bp-aside-title\s*\{[^}]*font-size:\s*14px/);
    expect(CSS, '整份不得再有指向 h3 的產品照卡規則').not.toMatch(/\.bp-aside-card h3/);
    // ≤960 的置中那條**不需要**跟著改名:標題現在是 `<p>`,`.bp-aside-card p` 本來就命中它。
    // (第一版在這裡多要求一個 `.bp-aside-title`,而那是冗餘 —— 關卡2 nit 打掉;
    //  對應的突變「≤960 置中只留 p」其實視覺零改變,是個假突變。)
    // 🔴 `\s*\{` 不是 `[^{]*\{`(關卡2 R2 新 finding):後者會**一起吃掉後綴**,
    //    `.bp-aside-card p:not(.bp-aside-title){text-align:center}`(= 標題在 ≤960 不再置中)
    //    與 `.bp-aside-card p em{…}` 兩種都照樣通過 —— 正好是這條要防的事情的鏡像。
    expect(mediaBlock('(max-width: 960px)'))
      .toMatch(/\.bp-aside-card p\s*\{[^}]*text-align:\s*center/);
  });

  it('🔴 卡片編號用 --c-ember-ink 不是 --c-red(白底上的熔橘過不了 AA)', () => {
    // 白底 #f26722 只有 3.12:1,11px 小字要 4.5:1;ember-ink 是同色系深階 4.94:1。
    // 深色底的年表(D2d-2)才仍用 --c-red(5.12:1)—— 順手「統一色票」會直接打掉一條 AA。
    // 🔴 用 `[^}]*` 不是 `[\s\S]*?` —— 後者會越過 `}` 一路找到別條規則裡的 ember-ink
    //    (`.bp-num-n sup` 就有)⇒ 把 .bp-why-num 的顏色改壞了測試照樣全綠(關卡2 M1 實測)。
    //    反面那條同理:跨規則比對會在 D2d-2 帶進 `.bp-time-y{color:var(--c-red)}` 時誤紅。
    expect(CSS).toMatch(/\.bp-why-num\s*\{[^}]*color:\s*var\(--c-ember-ink\)/);
    expect(CSS).not.toMatch(/\.bp-why-num\s*\{[^}]*color:\s*var\(--c-red/);
  });

  it('🔴 Why 的基礎規則必須排在 ≤960 收單欄之前(同權重靠順序)', () => {
    // 設計稿為了這件事特地開了第二個 ≤960 區塊(:1171-1173,它的 why/craft/time
    // 基礎規則排在第一個 ≤960 之後)。本檔把基礎規則全放在 RWD 之前,所以不需要第二塊
    // —— 但那個前提本身要被守住,否則手機版會退回 200px 兩欄。
    expect(CSS.indexOf('.bp-why-inner {'))
      .toBeLessThan(CSS.indexOf('@media (max-width: 960px) {'));
    // ⚠️ D2d-2 把收欄併成 `.bp-why-inner, .bp-craft-inner, .bp-time-inner` 一條列表
    //    ⇒ 這裡不能再比對「`.bp-why-inner {`」的單選擇器形狀(D2d-2 當場轉紅過)。
    //    收欄本身是否成立由上面那條與 D2d-2 的 three-in-one 那條共同守。
    expect(mediaBlock('(max-width: 960px)'))
      .toMatch(/\.bp-why-inner[^{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});

describe('品牌頁 CSS · Craft 與年表(D2d-2)', () => {
  it('🔴 .bp-craft-inner 吃 200px 標籤欄(三份文件互相矛盾,以設計稿為準)', () => {
    // 🔴 判準與完整考據(三份文件互相矛盾 + 版本史 + 為什麼不能用 mtime)寫在
    //    `brand-page.css` 那條規則正上方,**一處全文**;這裡不重抄(00-work-rules §4:
    //    同一教訓不寫兩處全文)。一句話版:設計稿自 v0011(08-02 16:44)起連續 19 版都是
    //    `200px`,而 integration.md 與計畫 §5.2 那一列從寫下當天就是錯的。
    expect(CSS).toMatch(/\.bp-craft-inner\s*\{[^}]*grid-template-columns:\s*200px minmax\(0, 1fr\)/);
  });

  it('🔴 hover 放大只套 img、不套 video(原生控制列會跟著縮放、按鈕位置會跑掉)', () => {
    expect(CSS).toMatch(/\.bp-craft-panel:hover \.bp-craft-media img\s*\{[^}]*transform:\s*scale/);
    // 反面:同一條選擇器不得把 video 一起列進去(順手補齊 = 直接弄壞控制列)
    expect(CSS).not.toMatch(/\.bp-craft-panel:hover[^{]*video[^{]*\{[^}]*transform:\s*scale/);
    // reduced-motion 要關掉它,且必須排在基礎規則之後(選擇器相同、權重 0-3-1、靠順序)
    const reduce = mediaBlock('(prefers-reduced-motion: reduce)');
    expect(reduce, '找不到 reduced-motion 區塊').toContain('.bp-craft-media img');
    expect(reduce).toMatch(/transform:\s*none/);
    expect(CSS.indexOf('@media (prefers-reduced-motion: reduce) {'))
      .toBeGreaterThan(CSS.indexOf('.bp-craft-panel:hover .bp-craft-media img'));
  });

  it('🔴 深色場的兩條標籤覆寫必須在(漏了就是深底黑字 + 看不見的黑短線)', () => {
    // `.bp-sec-label` 是共用的深色字 + 深色短線,直接放進 .bp-time 的石墨底 = 整格看不見。
    // 元件測試看不到這個(jsdom 不算 cascade),只能靠文字層守。
    expect(CSS).toMatch(/\.bp-time \.bp-sec-label\s*\{[^}]*color:\s*#fff/);
    expect(CSS).toMatch(/\.bp-time \.bp-sec-label::after\s*\{[^}]*background:\s*var\(--c-red\)/);
    // opacity 也要還原:共用規則把短線壓到 .85,深底上會更糊
    expect(CSS).toMatch(/\.bp-time \.bp-sec-label::after\s*\{[^}]*opacity:\s*1/);
  });

  it('🔴 年表用 --c-red、Why 的卡片編號用 --c-ember-ink —— 兩邊不得互換', () => {
    // 深色底 --c-red 是 5.12:1;白底只有 3.12:1(Why 那條守門的反面)。
    expect(CSS).toMatch(/\.bp-time-item\.is-key \.bp-time-body::before\s*\{[^}]*background:\s*var\(--c-red\)/);
    expect(CSS).toMatch(/\.bp-why-num\s*\{[^}]*color:\s*var\(--c-ember-ink\)/);
  });

  it('🔴 ≤960 的收欄是**一條**選擇器列表,three-in-one(不是各自另開一條)', () => {
    // 另開的話同權重靠順序決勝,三區的收欄會在不同時機發生。
    // ⚠️ **不綁順序**:設計稿 :1173 寫的是 why→time→craft,照它重排不該紅(關卡2 R2 nit)。
    //    只要三者在同一條選擇器列表裡、且那條列表設了單欄即可。
    const narrow = mediaBlock('(max-width: 960px)');
    const rule = narrow.match(/([^{};]*\.bp-craft-inner[^{]*)\{([^}]*)\}/);
    expect(rule, '找不到含 .bp-craft-inner 的 ≤960 規則').not.toBeNull();
    const [, selector, body] = rule!;
    for (const s of ['.bp-why-inner', '.bp-craft-inner', '.bp-time-inner']) {
      expect(selector, `${s} 不在同一條選擇器列表裡`).toContain(s);
    }
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it('🔴 craft / time 的基礎規則必須排在 ≤960 之前(設計稿實測「768/390 左邊界跑掉」)', () => {
    // 關卡2 R2:`brand-page.css` 檔內明文宣告了這個要求,設計稿 :1171-1172 還記著實際事故,
    // 但守門只有 `.bp-why-inner` 那一條 ⇒ D2e 在檔尾追加基礎規則就會靜默重現。
    const media = CSS.indexOf('@media (max-width: 960px) {');
    for (const sel of ['.bp-craft-inner {', '.bp-time-inner {', '.bp-why-inner {']) {
      const at = CSS.indexOf(sel);
      expect(at, `找不到 ${sel} 的基礎規則`).toBeGreaterThan(-1);
      expect(at, `${sel} 的基礎規則排到 ≤960 後面了 ⇒ 同權重下會把收欄蓋掉`).toBeLessThan(media);
    }
  });

  it('🔴 手機年表:軸線收掉時圓點也要收(否則圓點掛在文字左邊界外)', () => {
    const small = mediaBlock('(max-width: 620px)');
    expect(small).toMatch(/\.bp-time-body\s*\{[^}]*border-left:\s*0/);
    // 圓點是 left:-4.5px 定位在那條線上的 ⇒ 線沒了它必須一起 display:none
    expect(small).toMatch(/\.bp-time-body::before\s*\{[^}]*display:\s*none/);
    // 前提斷言:桌機版真的有那條線與那個圓點,否則上面兩條在守不存在的東西
    expect(CSS).toMatch(/\.bp-time-body\s*\{[^}]*border-left:\s*1px solid/);
    expect(CSS).toMatch(/\.bp-time-body::before\s*\{[^}]*left:\s*-4\.5px/);
  });

  it('🔴 Craft 媒體 16:9 —— 這是 Sean 08-02 的拍板,不是預設值', () => {
    // 5:4 會把兩側裁掉、切掉官方燒在畫面裡的工序字幕(設計稿 :1121-1123 記的事故)。
    // 沒有這條守門的話改回 5:4 是全綠的(關卡2 nit:同檔已為色票拍板設守門,標準要一致)。
    expect(CSS).toMatch(/\.bp-craft-media img,\s*\.bp-craft-media video\s*\{[^}]*aspect-ratio:\s*16\/9/);
  });

  it('🔴 Craft 的下沉底色不得拿掉(整頁節奏靠它與前後白區分開)', () => {
    expect(CSS).toMatch(/\.bp-craft\s*\{[^}]*background:\s*var\(--c-sunken\)/);
  });

  it('🔴 年表最後一列的軸線是「轉透明」不是「刪掉」', () => {
    // border-left:0 會讓 border-box 少 1px、padding-left 失去依據
    // ⇒ 最後一列的文字往左跳。順手「簡化」成 0 是三綠全綠的(關卡2 nit)。
    expect(CSS).toMatch(/\.bp-time-item:last-child \.bp-time-body\s*\{[^}]*border-left-color:\s*transparent/);
    expect(CSS).not.toMatch(/\.bp-time-item:last-child \.bp-time-body\s*\{[^}]*border-left:\s*0/);
  });

  it('🔴 ≤620 的年份紅字必須輸給 is-key 的白字(選擇器權重寫死在字面裡)', () => {
    // 設計稿 :1154(`.bp-time-item.is-key .bp-time-y` = 三個 class = **0-3-0**)恆勝
    // :1192(`.bp-time-y` = 0-1-0)⇒ 手機上 key 列仍是白字、只有非 key 變橘。
    // (關卡2 R2 更正:原本把它寫成 0-2-0,少數了一個 class;結論不變、字面要對。)
    // 有人把 ≤620 那條寫成 `.bp-time-item .bp-time-y`(0-2-0)⇒ 全部變橘、強調關係消失,
    // 而畫面「看起來還是有顏色」、沒有任何測試會紅。
    const small = mediaBlock('(max-width: 620px)');
    expect(small).toMatch(/(^|\n)\s*\.bp-time-y\s*\{[^}]*color:\s*var\(--c-red\)/);
    expect(small, '≤620 不得用更高權重的選擇器蓋過 is-key').not.toMatch(/\.bp-time-item[^,{]*\.bp-time-y\s*\{/);
    // 前提斷言:基礎規則真的有那條 0-3-0 的 is-key 白字
    expect(CSS).toMatch(/\.bp-time-item\.is-key \.bp-time-y\s*\{[^}]*color:\s*#fff/);
  });

  it('Craft 的 gap 在 ≤1024 收到 26、≤960 放回 34(順序不能對調)', () => {
    expect(mediaBlock('(max-width: 1024px)')).toMatch(/\.bp-craft-grid\s*\{[^}]*gap:\s*26px/);
    expect(mediaBlock('(max-width: 960px)')).toMatch(/\.bp-craft-grid\s*\{[^}]*gap:\s*34px/);
    // 單欄下上下相鄰的面板要更多呼吸 ⇒ ≤960 那條要贏 ⇒ 必須排在 ≤1024 之後
    expect(CSS.indexOf('@media (max-width: 960px) {'))
      .toBeGreaterThan(CSS.indexOf('@media (max-width: 1024px) {'));
  });
});

describe('品牌頁 CSS · 分類 chips 與磚牆(D2e-1)', () => {
  it('🔴 chip 邊框用 --c-border-control 不是 --c-border(1.26:1 過不了 WCAG 1.4.11)', () => {
    // 分隔線用的 #e5e5e7 對白底只有 1.26:1;當它是「這是可點的東西」的唯一視覺線索時
    // 需要 3:1(非文字對比)。#909093 = 3.18:1。順手「跟其他線一致」= 打掉一條 AA,
    // 與 .bp-why-num 的 --c-ember-ink 同族的坑。
    // 🔴 一定要帶 fallback:正式站 tokens.css 沒有 --c-border-control(實查 0 命中)
    //    ⇒ D3 漏掛 .bp-page 時整條 border 作廢、chip 變一行沒框的字(WCAG 1.4.11 的唯一線索)。
    expect(CSS).toMatch(/\.bp-chip\s*\{[^}]*border:\s*1px solid var\(--c-border-control, #909093\)/);
    expect(bpPageScopes(), '--c-border-control 沒帶進 .bp-page scope').toContain('--c-border-control: #909093');
  });

  it('🔴 chip hover 必須比靜止態更深(指回 --c-border-strong 是反方向的)', () => {
    // 設計稿 :699-700 逐字記著這個修正:--c-border-strong 是 1.48:1,
    // 比靜止態的 --c-border-control(3.18:1)還淺 —— 滑上去反而變弱。
    expect(CSS).toMatch(/\.bp-chip:hover\s*\{[^}]*border-color:\s*var\(--c-text-3\)/);
    expect(CSS).not.toMatch(/\.bp-chip:hover\s*\{[^}]*border-color:\s*var\(--c-border/);
  });

  it('🔴 預設 chip 有左側色塊(colorIndex 0 的 2 筆靠它,拿掉會比別人少一條線)', () => {
    expect(CSS).toMatch(/\.bp-chip\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--cat-8\)/);
    // 11 個色碼規則要齊(缺哪個,那個分類的 chip 會靜默退回中性灰)
    for (let i = 1; i <= 11; i++) {
      expect(CSS, `缺 [data-cat="${i}"]`)
        .toMatch(new RegExp(`\\.bp-chip\\[data-cat="${i}"\\]\\s*\\{[^}]*var\\(--cat-${i}\\)`));
    }
    // 對應的 11 個 token 也要在 **.bp-page 這個 scope 裡**(規則在、變數不在 = 整條
    // box-shadow 失效;掛到別的選擇器上則是掛在錯的地方 ⇒ 只在該選擇器底下才有色)。
    // 🔴 用 bpPageScopes() 收**全部** `.bp-page {` 區塊:本檔有兩塊(色票 + 分類色碼),
    //    只取第一塊會讓這 11 條恆紅、只對整份 CSS 比對又會讓「搬到別的選擇器」照樣綠(R1 nit)。
    const scopes = bpPageScopes();
    expect(scopes.length, '一個 .bp-page 區塊都沒抓到 ⇒ 下面 11 條會恆紅').toBeGreaterThan(0);
    for (let i = 1; i <= 11; i++) {
      expect(scopes, `--cat-${i} 不在 .bp-page scope 裡`).toMatch(new RegExp(`--cat-${i}:\\s*#[0-9a-f]{6}`));
    }
    // 反面:不得出現 [data-cat="0"] —— 元件端刻意不輸出 0,補了這條會讓那 2 筆突然變色
    expect(CSS).not.toContain('[data-cat="0"]');
  });

  it('🔴 磚牆是 flex-wrap 不是 grid(家數變動時 grid 最後一列會靠左留破口)', () => {
    expect(CSS).toMatch(/\.bp-others-list\s*\{[^}]*display:\s*flex/);
    expect(CSS).toMatch(/\.bp-others-list\s*\{[^}]*justify-content:\s*center/);
    expect(CSS).not.toMatch(/\.bp-others-list\s*\{[^}]*display:\s*grid/);
  });

  it('🔴 logo 固定框 + 逐家 --logo-scale(20 檔長寬比 1.32-8.0 差 6 倍,兩層都不能省)', () => {
    expect(CSS).toMatch(/\.bp-others-logo\s*\{[^}]*height:\s*58px/);
    expect(CSS).toMatch(/\.bp-others-logo img\s*\{[^}]*object-fit:\s*contain/);
    expect(CSS).toMatch(/\.bp-others-logo img\s*\{[^}]*transform:\s*scale\(var\(--logo-scale, 1\)\)/);
    // 灰階三件組:少任何一個,淺 logo(EVOTECH / EXTREME)就會比別家輕
    expect(CSS).toMatch(/\.bp-others-logo img\s*\{[^}]*filter:\s*grayscale\(1\) brightness\(\.45\) contrast\(1\.08\)/);
    // 品牌名固定兩行高:不固定的話同一列的磚不一樣高、基線對不齊
    expect(CSS).toMatch(/\.bp-others-name\s*\{[^}]*min-height:\s*32px/);
  });

  it('🔴 欄數與 gap 的算式綁在一起(只改一個,最後一列會多擠一格或開一個洞)', () => {
    // 基礎 5 欄:gap 12 × 4 道 = 48
    expect(CSS).toMatch(/\.bp-others-list > \*\s*\{[^}]*flex:\s*0 1 calc\(\(100% - 48px\) \/ 5\)/);
    expect(CSS).toMatch(/\.bp-others-list\s*\{[^}]*gap:\s*12px/);
    // ≤1180 與 ≤960 都是 4 欄(gap 仍 12 ⇒ 3 道 = 36)
    for (const q of ['(max-width: 1180px)', '(max-width: 960px)']) {
      expect(mediaBlock(q), `${q} 缺 4 欄規則`)
        .toMatch(/\.bp-others-list > \*\s*\{[^}]*flex-basis:\s*calc\(\(100% - 36px\) \/ 4\)/);
    }
    // ≤620 收 3 欄,gap 同時收到 10 ⇒ 2 道 = 20;logo 框與品牌名也一起收
    const small = mediaBlock('(max-width: 620px)');
    expect(small).toMatch(/\.bp-others-list\s*\{[^}]*gap:\s*10px/);
    expect(small).toMatch(/\.bp-others-list > \*\s*\{[^}]*flex-basis:\s*calc\(\(100% - 20px\) \/ 3\)/);
    expect(small).toMatch(/\.bp-others-logo\s*\{[^}]*height:\s*46px/);
    expect(small).toMatch(/\.bp-others-name\s*\{[^}]*min-height:\s*30px/);
  });

  it('🔴 長品牌名要 overflow-wrap: anywhere(break-word 在 min-content 階段不生效,欄數照爆)', () => {
    // 手機 3 欄時「EVOTECH PERFORMANCE」「EXTREME COMPONENTS」的 min-content 寬度會超過
    // 1/3 的 flex-basis,那一列被擠成 2 格、中間開一個洞(設計稿 :1307-1314)。
    expect(CSS).toMatch(/\.bp-others-name\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(CSS).not.toMatch(/\.bp-others-name\s*\{[^}]*overflow-wrap:\s*break-word/);
    expect(CSS).toMatch(/\.bp-others-list > \*\s*\{[^}]*min-width:\s*0/);
  });

  it('🔴 is-cur 那磚的兩處 var(--c-graphite) 帶 fallback,且是「標記」不是「移除」', () => {
    // 上面「每一處 var(--c-graphite) 都要帶 fallback」那條已經逐處數過;這裡確認
    // is-cur 這條規則本身存在 —— 元件把當前品牌留在清單裡,靠的就是它被看得見。
    expect(CSS).toMatch(/\.bp-others-list > :is\(a, span\)\.is-cur\s*\{[^}]*border-color:\s*var\(--c-graphite, #202225\)/);
    expect(CSS).toMatch(/\.bp-others-list > :is\(a, span\)\.is-cur\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--c-graphite, #202225\)/);
    expect(CSS).toMatch(/\.bp-others-list > :is\(a, span\)\.is-cur img\s*\{[^}]*filter:\s*none/);
  });

  it('🔴 cats / others 的基礎規則必須排在**所有 max-width 區塊**之前(追加在後面會靜默失效)', () => {
    // 與 D2d-2 那條同款,只是換成本片的 class。設計稿 :906 把 about/cats/products/
    // others/craft 收單欄寫成一條列表 ⇒ 基礎規則排到後面就會把收欄蓋掉。
    // 🔴 R1 補:除了兩個 `-inner`,**磚本身的四條基礎規則**也靠順序 —— 它們與
    //    ≤1180/≤960/≤620 裡的同名規則同權重(都是 0-1-0 / 0-2-0),整段搬到檔尾的話
    //    三個斷點的欄數/框高/字級全部失效(手機退回 5 欄),而所有「存在性」斷言照樣綠。
    // 🔴 用「規則本體的特徵宣告」定位,**不是** `indexOf('.bp-others-list a {')` ——
    //    同一個選擇器在 ≤1180 / ≤960 / ≤620 各出現一次,而 ≤1180 那塊排在 ≤960 之前
    //    ⇒ 純字串 indexOf 會在基礎規則被搬到檔尾時命中 ≤1180 那一塊、照樣通過。
    //    (這正是「斷言量錯東西」的形狀:量到的是另一條同名規則。)
    // 🔴🔴 邊界用**第一個 `@media (max-width:`**,不是 ≤960(R2 must-fix)——
    //    `.bp-others-list > *` 的第一個覆寫在 **≤1180**,拿 ≤960 當界時,把基礎規則搬到
    //    「≤1180 之後、≤960 之前」那 1594 字元的空隙裡,1180-961px 會退回 5 欄而守門照樣綠。
    //    六條的覆寫全在 max-width 區塊 ⇒ 基礎規則必須排在**所有** max-width 之前。
    //    ⚠️ 不能用「第一個 @media」:檔內更早有 `@media (min-width: 961px)`(D2c-1 的 .no-aside),
    //       那一塊本來就允許排在這些基礎規則之前。
    const media = Math.min(
      ...[...CSS.matchAll(/@media \(max-width:/g)].map((m) => m.index!),
    );
    expect(Number.isFinite(media), '一個 max-width 區塊都沒有 ⇒ 下面六條在守空氣').toBe(true);
    const bases: [string, RegExp][] = [
      ['.bp-cats-inner', /\.bp-cats-inner\s*\{[^}]*grid-template-columns:\s*200px minmax\(0, 1fr\)/],
      ['.bp-others-inner', /\.bp-others-inner\s*\{[^}]*grid-template-columns:\s*200px minmax\(0, 1fr\)/],
      // gap 12 ← ≤620 收 10
      ['.bp-others-list', /\.bp-others-list\s*\{[^}]*display:\s*flex/],
      // flex 0 1 …/5 ← ≤1180 與 ≤960 收 /4、≤620 收 /3(媒體查詢裡用的是 flex-basis)
      ['.bp-others-list > *', /\.bp-others-list > \*\s*\{[^}]*flex:\s*0 1 calc/],
      // 框高 58 ← ≤620 收 46
      ['.bp-others-logo', /\.bp-others-logo\s*\{[^}]*height:\s*58px/],
      // 字級 12 / 兩行高 32 ← ≤620 收 11 / 30(檔尾那條只有 overflow-wrap)
      ['.bp-others-name', /\.bp-others-name\s*\{[^}]*font-family/],
    ];
    for (const [sel, re] of bases) {
      const at = CSS.search(re);
      expect(at, `找不到 ${sel} 的基礎規則(特徵宣告被改掉或整條搬走)`).toBeGreaterThan(-1);
      expect(
        at,
        `${sel} 的基礎規則排到第一個 max-width 區塊後面了 ⇒ 它覆蓋的斷點會被基礎規則蓋回去`,
      ).toBeLessThan(media);
    }
  });

  it('🔴 ≤960 的收欄把 cats / others 併進**同一條**選擇器列表(不是各自另開一條)', () => {
    // 另開的話同權重靠順序決勝,五區的收欄會在不同時機發生;設計稿 :906 本來就是一條列表。
    const narrow = mediaBlock('(max-width: 960px)');
    const rule = narrow.match(/([^{};]*\.bp-others-inner[^{]*)\{([^}]*)\}/);
    expect(rule, '找不到含 .bp-others-inner 的 ≤960 規則').not.toBeNull();
    const [, selector, body] = rule!;
    for (const s of ['.bp-why-inner', '.bp-craft-inner', '.bp-time-inner', '.bp-cats-inner', '.bp-others-inner']) {
      expect(selector, `${s} 不在同一條選擇器列表裡`).toContain(s);
    }
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    // 手機置中:chips 與磚牆標題(About 正文的例外不受影響,那條已有獨立守門)
    expect(narrow).toMatch(/\.bp-chips\s*\{[^}]*justify-content:\s*center/);
    expect(narrow).toMatch(/\.bp-others h2\s*\{[^}]*text-align:\s*center/);
  });

  // 🔴 **D3b 更新:這條原本擋的是整組商品區 class,前提已經改變。**
  //    D2e-1 寫它的時候商品區還沒有元件 ⇒ 搬進來就是一批沒有消費端的死 class。
  //    D3b 落地後 `.bp-products` / `.bp-prod-head` / `.bp-grid` **都有元件了**
  //    (`BrandPageProducts.tsx`),真正永遠不該進本檔的只剩**骨架槽**那兩族。
  //    清單縮小、不是整條刪掉 —— 刪掉的話「有人把假卡片外觀也搬進來」就沒有東西擋了。
  it('🔴 設計稿的骨架槽 class 永遠不得混進本檔(那五張灰卡是佔位、正式站用 ProductCard)', () => {
    // 設計稿 :1468-1469 逐字:「正式頁面這一區直接用既有的商品列表元件,不是新做的」。
    for (const dead of ['.bp-slot', '.bp-bar']) {
      expect(CSS, `${dead} 不該出現在本檔`).not.toContain(dead);
    }
    // 反面前提:商品區的外殼**必須在**,否則上面那句「清單縮小」是在描述一個不存在的狀態。
    for (const live of ['.bp-products', '.bp-products-inner']) {
      expect(CSS, `${live} 不見了 ⇒ 商品區樣式被整段拿掉`).toContain(live);
    }
    // 🔴 2026-08-07 R-2:`.bp-prod-head` / `.bp-grid` 由「必須在」翻成「**不得再有規則**」——
    //    商品區改用共用 `ProductRail`,表頭與版位都歸它,那兩族已成死 CSS 整組刪除。
    //    只比字串會被註解裡的歷史說明騙到 ⇒ 用解析出來的**規則選擇器**判。
    const parsed = cssRules(); // `rules` 是另一個 describe 的區域變數,這裡就地解析
    // 🔴 前提:解析器要真的解得出規則,否則下面 `[]` 是因為沒東西可比 ⇒ 恆真(審查抓到)。
    expect(parsed.length, 'cssRules() 解析不出任何規則 ⇒ 本條恆真、失去判別力').toBeGreaterThan(20);
    for (const dead of ['.bp-prod-head', '.bp-grid']) {
      // 🔴 用**詞邊界**比而不是 `startsWith`(審查抓到兩個洞):
      //    `startsWith` 讓 `.bp-products-inner .bp-grid { … }` 這種「重生在後代位置」溜過去,
      //    而且 `.bp-gridxyz` 會誤報。
      const re = new RegExp(`\\${dead}(?![\\w-])`);
      const live = parsed.filter((r) => r.selector.split(',').some((x) => re.test(x.trim())));
      expect(
        live.map((r) => r.selector),
        `${dead} 又長回規則了 ⇒ 與 rail 版位並存會有兩套版位`,
      ).toEqual([]);
    }
  });
});

describe('品牌頁 CSS · 動效層(D2e-2)', () => {
  it('🔴 互動 transition 必須排在基礎規則**之後**(選擇器相同、靠順序決勝)', () => {
    // 搬到前面的話整頁退回 .15s/.18s/.2s/.3s 四種時長混用(設計稿 :837 記的原始問題),
    // 而畫面「看起來還是會動」、沒有任何測試會紅。
    // 🔴 兩邊都用「規則本體的特徵宣告」定位,不是選擇器字串 —— 同一個選擇器在檔內出現兩次,
    //    純 indexOf 兩次都會命中第一個(= 基礎規則)⇒ 恆真、零判別力。
    const pairs: [string, RegExp, RegExp][] = [
      ['.bp-chip',
        /\.bp-chip\s*\{[^}]*transition:\s*border-color \.15s/,
        /\.bp-chip\s*\{[^}]*transition:\s*border-color var\(--dur-hover\)/],
      ['.bp-others-list > *',
        /\.bp-others-list > \*\s*\{[^}]*transition:\s*border-color \.18s/,
        /\.bp-others-list > \*\s*\{[^}]*transition:\s*border-color var\(--dur-hover\)/],
      ['.bp-others-name',
        /\.bp-others-name\s*\{[^}]*transition:\s*color \.18s/,
        /\.bp-others-name\s*\{[^}]*transition:\s*color var\(--dur-hover\)/],
      ['.bp-cta',
        /\.bp-cta\s*\{[^}]*transition:\s*background \.15s/,
        /\.bp-cta\s*\{[^}]*transition:\s*background var\(--dur-hover\)/],
      // 關卡2 R1 nit 補:原本漏了這兩條,而它們與上面四條是同一個失效模式
      ['.bp-cta-ghost',
        /\.bp-cta-ghost\s*\{[^}]*transition:\s*border-color \.15s/,
        /\.bp-cta-ghost\s*\{[^}]*transition:\s*border-color var\(--dur-hover\)/],
      // ⚠️ 這一組**不是**同選擇器覆寫:基礎是 `.bp-others-logo img`(0-1-1)、
      //    動效層是 `.bp-others-list a img`(0-1-2)⇒ 靠權重贏。順序仍要對(可讀性),
      //    但即使順序反了畫面也不會壞 —— 這條記錄的是「兩者不同」這件事本身。
      ['.bp-others-list a img',
        /\.bp-others-logo img\s*\{[^}]*transition:\s*filter \.22s/,
        /\.bp-others-list a img\s*\{[^}]*transition:\s*filter var\(--dur-hover\)/],
    ];
    for (const [sel, baseRe, animRe] of pairs) {
      const base = CSS.search(baseRe);
      const anim = CSS.search(animRe);
      expect(base, `找不到 ${sel} 的基礎 transition`).toBeGreaterThan(-1);
      expect(anim, `找不到 ${sel} 的動效層 transition`).toBeGreaterThan(-1);
      expect(anim, `${sel} 的動效層版本排到基礎規則前面了 ⇒ 時長會退回混用`).toBeGreaterThan(base);
    }
  });

  it('🔴 三個時長 token 在 .bp-page scope 裡,不是 :root(設計稿放 :root = 必要偏離)', () => {
    const scopes = bpPageScopes();
    for (const t of ['--dur-press: 110ms', '--dur-hover: 200ms', '--dur-enter: 620ms']) {
      expect(scopes, `${t} 不在 .bp-page scope 裡`).toContain(t);
    }
    // --ease 是**曲線不是時長**,由 D2b 帶進第一塊色票,動效層不重複宣告
    // (重複不會壞,但值會有兩個來源)。⚠️ 原標題把它湊成「四個時長」= 字面不實(關卡2 R3 nit)。
    expect(scopes).toContain('--ease: cubic-bezier(.2, 0, 0, 1)');
    expect((CSS.match(/--ease:\s*cubic-bezier/g) ?? []).length, '--ease 宣告了不只一次').toBe(1);
    // 🔴 --dur-reveal **不得**出現:捲動揭示 Sean 拍板 C 不做 ⇒ 它沒有消費端
    expect(CSS, '--dur-reveal 沒有消費端(捲動揭示不做)').not.toContain('--dur-reveal');
  });

  it('🔴 橫幅入場用 both + reduced-motion 用 animation:none(不是 duration:0)', () => {
    // `both` 讓 from{opacity:0} 在 delay 期間就生效(少了它文字會先閃完整版再跳回起點);
    // 反面代價 = 關掉時必須整條 animation 拿掉,不能只把時間縮到 0。兩個理由:
    //   ① backwards fill 只押 **delay 期間** ⇒ 縮短 duration 不影響 delay,
    //      五段仍會各自隱形 60/130/200/270/340ms 才閃出來
    //      (關卡2 R1 更正:我原本寫「內容永遠停在 opacity:0、整個橫幅變空白」= 誇大)
    //   ② 無單位的 `0` 對 `<time>` 不合法,整條宣告會被丟掉、連降級都不會發生
    expect(CSS).toMatch(/@keyframes bp-rise \{ from \{ opacity: 0/);
    expect(CSS).toMatch(/@keyframes bp-settle \{ from \{ transform: scale\(1\.045\)/);
    expect(CSS).toMatch(/\.bp-band-photo \{ animation: bp-settle 1100ms var\(--ease\) both/);
    expect(CSS).toMatch(/animation: bp-rise var\(--dur-enter\) var\(--ease\) both/);
    const reduce = mediaBlock('(prefers-reduced-motion: reduce)');
    expect(reduce).toMatch(/\.bp-band-photo[^{]*\{\s*animation: none/);
    // 反面:不得用 duration:0 / .01ms 那種「保留 fill-mode」的關法
    expect(reduce).not.toMatch(/animation-duration:\s*(0|\.01ms)/);
  });

  it('🔴 五段入場的 delay 必須遞增(全部同時動 = 沒有層次,而畫面「有動」看不出錯)', () => {
    const want: [string, number][] = [
      ['.bp-eyebrow', 60], ['.bp-title', 130], ['.bp-lede', 200],
      ['.bp-actions', 270], ['.bp-band-logo', 340],
    ];
    let prev = -1;
    for (const [sel, ms] of want) {
      // ⚠️ 不綁死單空格排版(關卡2 R1 nit:prettier 換行就假紅)
      const m = CSS.match(new RegExp(`\\${sel}\\s*\\{\\s*animation-delay:\\s*(\\d+)ms`));
      expect(m, `找不到 ${sel} 的 animation-delay`).not.toBeNull();
      expect(Number(m![1]), `${sel} 的 delay 不是設計稿的值`).toBe(ms);
      expect(Number(m![1]), `${sel} 的 delay 沒有比前一段大`).toBeGreaterThan(prev);
      prev = Number(m![1]);
    }
    // 照片跑得比文字久,才會是「畫面先安頓、字再落下」(1100ms vs --dur-enter 620ms)
    expect(CSS).toContain('--dur-enter: 620ms');
  });

  it('🔴 reduced-motion 逐條點名,四類位移一個都不能漏', () => {
    // 這一層是**點名制**(沒有 `*` 選擇器)⇒ 漏掉哪一條,哪一條就完全沒保護,
    // 而且開了「減少動態」的人看不到錯誤、只會覺得網站還在動。
    const reduce = mediaBlock('(prefers-reduced-motion: reduce)');
    expect(reduce.length, '找不到 reduced-motion 區塊').toBeGreaterThan(100);
    for (const sel of [
      '.bp-band-photo', '.bp-eyebrow', '.bp-title', '.bp-lede', '.bp-actions', '.bp-band-logo',
      '.bp-chip:hover', '.bp-chip:active', '.bp-others-list a:hover', '.bp-others-list a:active',
      '.bp-cta:active', '.bp-cta-ghost:active',
      '.bp-craft-panel:hover .bp-craft-media img',
      '.bp-film-frame > iframe', '.bp-film-frame > video',
    ]) {
      expect(reduce, `${sel} 沒有被 reduced-motion 點到`).toContain(sel);
    }
  });

  it('🔴 每一條 animation 都要在 reduced-motion 裡被關掉(反向守門)', () => {
    // 上面那條驗的是「這 15 個選擇器有被點到」——清單寫死 ⇒ 新增動畫時它不會紅。
    // 這一條反過來從**動畫宣告本身**出發,所以新增才會被抓到。
    // 🔴 走訪器版(關卡2 R2 重寫):`@media` 內、duration-first shorthand、
    //    `animation-name` longhand 全部涵蓋;`@keyframes` 內的 from/to 不算規則。
    // 🔴 而且驗的是「**真的被關掉**」不只是「選擇器出現在 reduce 裡」——
    //    原本寫 `.bp-title { color: red }` 進 reduce 就能讓守門變綠(關卡2 R2 N-3)。
    const rules = cssRules();
    const animated = rules.filter(
      (r) => !inReduce(r)
        && !r.at.some((a) => a.startsWith('@keyframes'))
        && /animation(-name)?\s*:/.test(r.body)
        && !/animation(-name)?\s*:\s*none\b/.test(r.body),
    );
    expect(animated.length, '一條 animation 都沒抓到 ⇒ 這條在守空氣').toBeGreaterThan(0);
    for (const rule of animated) {
      for (const one of rule.selector.split(',').map((x) => x.trim()).filter(Boolean)) {
        expect(
          neutralisedIn(rules, one, 'animation'),
          `${one} 有 animation,但 reduced-motion 沒有把它關成 animation: none`,
        ).toBe(true);
      }
    }
  });

  it('🔴 每一條 hover/active/focus 的位移也要被關掉(補 animation 那條的盲區)', () => {
    // 關卡2 R1 指出:animation 那條看不到 transform 過渡,而本檔的動態主要就是它。
    // 🔴 刻意**只看互動狀態選擇器**:靜態定位用的 transform(`.bp-film-play` 的
    //    `translate(-50%,-50%)`、`.bp-media` 直式滿版的 `translateX(-50%)`)不是動態,
    //    把它們一起要求進 reduced-motion 會逼出錯誤的修法(關掉它們版面就歪了)。
    // ⚠️ **已知盲區**(關卡2 R2 N-2,誠實列出而不是假裝涵蓋):狀態 class 上的位移
    //    (`.is-open` 那種)不在本條範圍內 —— 它與靜態 transform 在字面上分不開。
    const rules = cssRules();
    const moving = rules.filter(
      (r) => !inReduce(r)
        && /:(hover|active|focus|focus-visible)/.test(r.selector)
        && /(^|[;\s])transform\s*:/.test(r.body)
        && !/(^|[;\s])transform\s*:\s*none\b/.test(r.body),
    );
    expect(moving.length, '一條互動位移都沒抓到 ⇒ 這條在守空氣').toBeGreaterThan(0);
    for (const rule of moving) {
      for (const one of rule.selector.split(',').map((x) => x.trim()).filter(Boolean)) {
        expect(
          neutralisedIn(rules, one, 'transform'),
          `${one} 有位移,但 reduced-motion 沒有把它關成 transform: none`,
        ).toBe(true);
      }
    }
  });

  // 🔴 **D3b 更新:`.bp-prod-head` / `ed-link-arrow` 從黑名單移出。**
  //    原本的理由逐字是「本檔沒有那個 class ⇒ 搬過來就是死規則」—— 商品區落地後前提消失,
  //    那兩條動效規則現在有真的消費端(設計稿 :858 與 reduce 區塊 :867,見商品區那個 describe)。
  //    捲動揭示那半條**維持不動**:Sean 2026-08-04 拍板 C 先不做(backlog #316)。
  it('🔴 捲動揭示的東西不得混進來(Sean 拍板 C、backlog #316)', () => {
    // ⚠️ `is-in` 不能裸著比對(關卡2 R1 nit):未來任何 `is-inline` / `is-inactive` 都會誤紅。
    //    改成帶 class 邊界的 `.is-in`,後面不得再接識別字元。
    expect(CSS, '捲動揭示的 .is-in 混進來了').not.toMatch(/\.is-in(?![-\w])/);
    for (const dead of ['.js-reveal', 'data-reveal-delay']) {
      expect(CSS, `${dead} 不該出現在本檔`).not.toContain(dead);
    }
  });

  it('🔴 全域的 `*` + !important 那層**不得**進本檔(影響全站 = 鐵則 8;Sean 拍板 Q1=B)', () => {
    // 設計稿 :461-465 有一條全域版,搬進來會蓋掉全站每一頁的 transition。
    // Sean 2026-08-04 拍 B:改用 scope 版、只作用在品牌頁;全站級記 backlog #318。
    expect(CSS).not.toMatch(/\*\s*,\s*\*::before/);
    expect(CSS, '本檔不得出現 !important').not.toContain('!important');
  });

  it('🔴 設計稿 :855 的 var(--var(--ease)) 打字錯誤已修(照搬會讓整條宣告被丟掉)', () => {
    // `var(--var(--ease))` 不是合法的自訂屬性名 ⇒ 瀏覽器丟掉整條 transition,
    // 磚牆品牌名 hover 變成直接跳色。主視窗已裁:那是打字錯誤、不是設計決定。
    expect(CSS, '把設計稿的打字錯誤照搬進來了').not.toContain('var(--var(');
    expect(CSS).toMatch(/\.bp-others-name \{\s*transition: color var\(--dur-hover\) var\(--ease\);/);
  });
});

describe('品牌頁 CSS · var() 語法(D2e-2 關卡2 R3 C2 的輕量版)', () => {
  it('🔴 每個 var( 都要是合法的自訂屬性引用 —— 巢狀寫錯會讓整條宣告被瀏覽器丟掉', () => {
    // 🔴 這一整類失效**本檔既有的守門在設計上都看不到**(關卡2 R3 指出的方法論盲區):
    //    原文字串斷言只比對「字面與設計稿一致」,而一條**字面一致但語法非法**的宣告
    //    會被瀏覽器整條丟棄、測試照樣全綠。
    //    活例就在本片:設計稿 :855 的 `var(--var(--ease))` —— 若當初照鐵則 1 逐字搬,
    //    「與設計稿一致」的斷言會 PASS,瀏覽器卻丟掉整條 transition(hover 變直接跳色)。
    //    **那次是人眼抓到的,不是測試。** 這條把它變成機制(機制優先律)。
    // ⚠️ 這是 R3 建議的 parse-pass 的輕量版:不引入 postcss(它在本 repo 只是傳遞相依,
    //    測試直接 import 會綁到一個沒人宣告的版本),只守「var() 的形狀」這一軸 ——
    //    涵蓋面小於完整 parser,但零相依、零維護,且正好蓋住已經真的發生過的那一種。
    const uses = CSS.match(/var\(/g) ?? [];
    expect(uses.length, '一個 var() 都沒有 ⇒ 這條在守空氣').toBeGreaterThan(0);
    // 合法形狀:var(--name) 或 var(--name, fallback)
    const wellFormed = CSS.match(/var\(\s*--[a-zA-Z0-9_-]+\s*[,)]/g) ?? [];
    expect(
      wellFormed.length,
      `有 ${uses.length - wellFormed.length} 處 var( 不是合法的自訂屬性引用` +
        '(最常見:把 var(--x) 巢狀寫成 var(--var(--x)))',
    ).toBe(uses.length);
  });
});

describe('品牌頁 CSS · 事實列欄數', () => {
  it('欄數吃 --fact-n(3 或 4 都要成立),不是寫死 4', () => {
    expect(CSS).toContain('repeat(var(--fact-n, 4)');
    expect(CSS).not.toMatch(/\.bp-facts-inner\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  });
});

// ── 商品區(D3b)────────────────────────────────────────────────
// 🔴 這一段守的是**兩件在瀏覽器以外看不見的事**:
//   ① 窄螢幕是「少顯示幾格」不是「換行成兩排」—— 換行的話磚牆會被推下去,而版面測試、
//      三綠、元件測試全部不會紅(元件永遠渲染 5 張,是 CSS 決定看得到幾張)。
//   ② 設計稿那組**骨架槽**(`.bp-slot` / `.bp-bar`)永遠不該進本檔:它們是假卡片的外觀,
//      搬進來會蓋在真 `ProductCard` 上,或更糟 —— 靜靜地誰也沒蓋到、變成一坨死規則。
// 🔴 **D3b 實錘:註解提早關閉,而本檔全部的守門照樣綠。**
//    我在 ≤960 那段寫了 `about/cats/**products**/others` —— `**products**/` 裡的 `*/`
//    直接把該則註解關掉,後面半句中文變成 CSS 規則空間裡的垃圾。
//    `next build` 當場紅(`Parsing CSS source code failed / Unexpected token Delim('/')`),
//    但**這支測試全綠** —— 因為 `CSS` 是用同一套非貪婪的 `/\*[\s\S]*?\*/` 剝註解,
//    它在那個提早的 `*/` 停下、剝掉的範圍與瀏覽器/打包器認定的一模一樣,於是雙方一起被騙。
//    ⚠️ 而且 CSS-only 的片按鐵則 11 **不必跑 build**(只有動 .ts/.tsx 才跑)⇒ 這一類壞法
//       有機會整片溜過去。故補這條不變式當機制。
//    不變式:本檔所有中文都在註解裡 ⇒ **剝掉註解之後不該剩任何中文**。
//    (真要在 CSS 值裡寫中文的那天〔例如 `content: "…"`〕,這條要改成排除 content 值,
//     而不是刪掉它。)
describe('品牌頁 CSS · 註解沒有提早關閉(D3b)', () => {
  it('🔴 剝掉註解之後零中文 —— 有中文殘留 = 某則註解的 `*/` 提早出現', () => {
    const leaked = CSS.match(/[\u4e00-\u9fff]+/g) ?? [];
    expect(leaked, `這些中文掉進規則空間了:${leaked.slice(0, 3).join(' / ')}`).toHaveLength(0);
  });

  it('🔴 前提:本檔真的有大量中文註解(否則上一條是拿空的比空的)', () => {
    expect((CSS_RAW.match(/[\u4e00-\u9fff]/g) ?? []).length).toBeGreaterThan(2000);
  });
});

describe('品牌頁 CSS · 商品區(D3b)', () => {
  const rules = cssRules();
  // (R-2:原本這裡有個 `gridRules`,三條 `.bp-grid` 守門移除後已零使用 ⇒ 一併刪,不留死碼。)

  // 🔴 2026-08-07 R-2:原本這裡有三條守 `.bp-grid` 的測試(三斷點各一條欄數規則 / 欄數 5→3→2 /
  //    多出來的格 display:none)。商品區改用共用 `ProductRail` 橫捲之後,**判別對象整組不存在**
  //    ⇒ 三條一併移除,改由上面那條「`.bp-grid` 不得再長回規則」接手。
  //    ⚠️ 連帶的**行為變更**已在 `BrandPageProducts.tsx` 申報:原本窄螢幕是**隱藏**多出來的格
  //    (≤1180 剩 3、≤620 剩 2),客人在手機上看不到第 4 筆之後;rail 化之後手機也滑得到全部。

  it('🔴 骨架槽的 class 一條都沒搬(設計稿 :730-740 刻意不搬)', () => {
    for (const dead of ['.bp-slot', '.bp-slot-img', '.bp-slot-info', '.bp-bar']) {
      expect(
        rules.some((r) => r.selector.includes(dead)),
        `${dead} 出現在 brand-page.css ⇒ 有人把設計稿的假卡片外觀也搬進來了`,
      ).toBe(false);
    }
  });

  it('🔴 `.bp-products-inner` 有進 ≤960 那條共用的收單欄列表(不是自己另開一條)', () => {
    // 另開一條的話同權重靠順序決勝,五個區塊的收欄就不再保證一起發生(檔內 :890 記過這條)。
    const shared = rules.find(
      (r) => r.at.join('|').includes('960') && r.selector.includes('.bp-products-inner'),
    );
    expect(shared, '≤960 找不到含 .bp-products-inner 的規則').toBeDefined();
    expect(shared!.selector).toContain('.bp-cats-inner');
    expect(shared!.selector).toContain('.bp-others-inner');
    expect(shared!.body).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/);
  });

  // 🔴 關卡2 R2 must-fix 2:`.ed-link` 的 `color` 與 `border-bottom` 都吃 `--ed-c-ink`,
  //    而那個 token 只宣告在 `home.css:8` 的 `.ed-page` 內 —— 本頁刻意不掛 `.ed-page`
  //    ⇒ 沒補的話 `border-bottom` 整條 IACVT、底線消失,而**所有 CSS 文字守門照樣綠**
  //    (它們看得到「規則在不在」,看不到「token 有沒有值」)。
  // 🔴 2026-08-07 R-2 更正:這條原本的失敗訊息是「否則『查看全部』的底線會整條消失」——
  //    **現在為假**。品牌頁唯一的 `.ed-link` 已搬進 rail,而 `.b-select-inset` 自己就宣告了
  //    `--ed-c-ink`(`home.css`,grep `b-select-inset`),它是更近的祖先 ⇒ `.bp-page` 那份被完全遮蔽。
  //    ⇒ 這條不是刪掉,是**把守的東西換成仍然成立的那個**:品牌頁上讀得到 `--ed-c-ink` 的
  //    來源必須存在(現在是 `.b-select-inset` 供的;`.bp-page` 那份留著當兜底、不強制)。
  it('🔴 品牌頁上的 `.ed-link` 讀得到 `--ed-c-ink`(供給者是 rail 的 inset 作用域)', () => {
    const home = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'home.css'), 'utf8');
    const inset = home.match(/\.b-select-inset\s*\{[^}]*\}/);
    expect(inset, 'home.css 找不到 .b-select-inset ⇒ 品牌頁的 rail token 作用域不見了').not.toBeNull();
    expect(
      inset![0],
      '.b-select-inset 沒宣告 --ed-c-ink ⇒ 品牌頁「查看全部」的底線會退回 none',
    ).toMatch(/--ed-c-ink\s*:/);
  });

  // 🔴 **合約的另一半**(R3 Fable consider F2):上一條釘的是「`.bp-page` 有宣告 `--ed-c-ink`」,
  //    但那份宣告存在的**唯一理由**是 `home.css` 的 `.ed-link` 會去讀它。哪天有人重排頁尾時
  //    把 `.ed-link` 改成別的 token,我補的那份宣告就變成無人消費的死碼、而沒有東西會說一聲。
  //    (D5/D7 已於 2026-08-05 落地,兩者都沒碰 `.ed-link` ⇒ 本條合約至今成立。)
  //    這條讀 `home.css` 原始碼、把消費端釘住:兩邊任一改動都會紅。
  it('🔴 `home.css` 的 `.ed-link` 確實消費 `--ed-c-ink`(否則 .bp-page 那份宣告就成死碼)', () => {
    const home = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'home.css'), 'utf8');
    const rule = home.match(/\.ed-link\s*\{[^}]*\}/);
    expect(rule, 'home.css 找不到 .ed-link 規則').not.toBeNull();
    expect(rule![0], '.ed-link 不再讀 --ed-c-ink ⇒ brand-page.css 那份宣告可以刪了').toContain(
      'var(--ed-c-ink)',
    );
  });

  // 🔴 關卡2 R1 must-fix 1:`.is-cur` 的選擇器必須維持 (0,2,1) 才壓得過 `a:hover` 的 (0,2,1)+順序。
  //    寫成 `> *.is-cur`(0,2,0)的話,hover 當前品牌那磚會把石墨邊框與 inset 環整組吃掉,
  //    而所有測試照樣綠(這是真瀏覽器 hover 前後對照才量到的)。
  it('🔴 `.is-cur` 用 `:is(a, span)` 保住特異度,不是 `> *`', () => {
    const cur = rules.filter((r) => r.selector.includes('.is-cur') && r.selector.includes('bp-others-list'));
    expect(cur.length, '找不到 is-cur 規則').toBeGreaterThanOrEqual(3);
    for (const r of cur) {
      expect(r.selector, `${r.selector} 用了 > * ⇒ 特異度掉一階、會輸給 a:hover`).not.toMatch(/>\s*\*\.is-cur/);
      expect(r.selector).toContain(':is(a, span)');
    }
  });

  // 🔴 關卡2 R1 must-fix 3:拍板的「泛白」那一半原本零守門 —— 整段刪掉,4631 測仍全綠、
  //    磚看起來與可點磚一模一樣,但語意上仍不可點 = 對客人最糟的組合。
  it('🔴 `.is-empty` 三條都在(泛白那一半的守門)', () => {
    const empty = rules.filter((r) => r.selector.includes('.is-empty'));
    expect(empty.length, '.is-empty 規則不見了 ⇒ 零商品的磚會長得跟可點的一模一樣').toBe(3);
    const body = empty.map((r) => r.body).join(' ');
    expect(body, 'logo 沒有去飽和').toMatch(/filter\s*:\s*grayscale\(1\)/);
    expect(body, 'logo 沒有轉淡').toMatch(/opacity\s*:\s*\.55/);
    expect(body, '品牌名沒有轉淡').toMatch(/color\s*:\s*var\(--c-text-3\)/);
    expect(body, '游標沒有改掉').toMatch(/cursor\s*:\s*default/);
  });

  // 🔴 關卡2 R2 must-fix 1:上面兩條各自只數「規則在不在」,對**兩族之間的勝負反轉全盲**。
  //    實錘:`.is-cur` 為了壓 `a:hover` 升成 `> :is(a, span)`(img 那條 = 0,2,2),而 `.is-empty`
  //    還留在 `> *`(0,2,1)⇒ `.is-cur` 反過來壓過 `.is-empty`,那 5 家看自己的品牌頁時
  //    logo 變回全彩、名字變回深色,只剩 opacity 還在 —— 4645 測全綠。
  //    ⇒ 這條釘的是「同階 + 順序」這個真正決勝的東西,不是任一族自己的形狀。
  //    ⚠️ **它擋不住什麼**:比的是選擇器**字面前綴**,不是算出來的特異度。兩族同時改成
  //       另一種同形寫法(例如都用 `> a`)仍會過,但那樣勝負關係不變 —— 反轉才是要擋的。
  it('🔴 `.is-cur` 與 `.is-empty` 兩族選擇器同階,且 `.is-empty` 排在後面(順序決勝)', () => {
    const PREFIX = '.bp-others-list > :is(a, span)';
    const idx = (cls: string) =>
      rules.reduce<number[]>((acc, r, i) => {
        if (r.selector.includes(cls) && r.selector.includes('bp-others-list')) acc.push(i);
        return acc;
      }, []);
    const cur = idx('.is-cur');
    const empty = idx('.is-empty');
    expect(cur.length, '找不到 is-cur 規則').toBe(3);
    expect(empty.length, '找不到 is-empty 規則').toBe(3);
    for (const i of [...cur, ...empty]) {
      expect(
        rules[i]!.selector.startsWith(PREFIX),
        `${rules[i]!.selector} 前綴與另一族不同階 ⇒ 兩族勝負會反轉(泛白或當前磚其一失效)`,
      ).toBe(true);
    }
    // 同階之後就只剩順序:`.is-empty` 的每一條都必須排在**所有** `.is-cur` 之後。
    expect(
      Math.min(...empty) > Math.max(...cur),
      '.is-empty 被搬到 .is-cur 前面 ⇒ 泛白會被 `filter: none` 整條吃掉',
    ).toBe(true);
  });

  // 🔴 2026-08-07 R-2 **更正**:我一度把這條整條刪掉,理由寫「rail 的箭頭動效屬
  //    `.b-select-arrow` 家族」——**那是錯的,而且那個錯誤判斷正是回歸沒被發現的原因**。
  //    被守的是 `.ed-link-arrow`(「查看全部」那顆箭頭),`.b-select-arrow` 是左右導覽鈕、
  //    它只 transition background/border-color、沒有 transform。兩顆是不同的東西,
  //    而 rail 仍然渲染同一顆 `.ed-link-arrow` ⇒ 刪掉等於讓 reduced-motion 使用者的位移回來。
  //    ⇒ 保護留著、選擇器跟著表頭換成 `.b-select-inset`。
  it('「查看全部」箭頭的 hover 位移在 reduced-motion 下被關掉(R-2 後選擇器換成 rail 的)', () => {
    expect(
      neutralisedIn(rules, '.b-select-inset .ed-link:hover .ed-link-arrow', 'transform'),
      'reduced-motion 下箭頭仍會位移 ⇒ 站台層那條 translateX 全站沒有 reduce 保護,品牌頁這道是唯一的',
    ).toBe(true);
  });
});

/**
 * 取 tokens.css 第一個 `:root { … }` 區塊的內容(大括號配對計數,同 bpPageScopes() 的做法)。
 * 🔴 不能用整檔正規式硬撈:tokens.css 還有 `[data-theme="dark"] { … }` 與
 *    `@media (max-width: 1079px) { :root { --shell-header-h: 69px; } }` 兩塊——
 *    後者字面上也含 `:root {`,但 indexOf 抓到的是**第一個**出現位置(檔案開頭那個),
 *    不會誤取到 media query 裡嵌套的那份。
 */
function tokensRootScope(): string {
  const start = TOKENS_CSS.indexOf(':root {');
  if (start === -1) return '';
  const open = TOKENS_CSS.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < TOKENS_CSS.length; i++) {
    if (TOKENS_CSS[i] === '{') depth++;
    else if (TOKENS_CSS[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return '';
  return TOKENS_CSS.slice(open + 1, end);
}

/** 從一段 CSS scope 文字裡抽出某顆 token 的宣告值(不含結尾分號)。 */
function tokenValue(scope: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = scope.match(new RegExp(`${escaped}:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
}

describe('品牌頁 CSS · tokens.css :root 分岔守門(2026-08-06 token 升級片)', () => {
  it('🔴 --c-graphite 與 --f-serif 在 tokens.css :root 與 brand-page.css .bp-page 必須逐字同值', () => {
    // 兩處分岔 ⇒ 品牌頁與其他頁的同一顆 token 會是不同值,而且兩邊各自的測試都會是綠的
    // (brand-page.test.ts 只驗 .bp-page 那份、home.test.ts 只驗 :root 那份,誰都看不到對方)。
    const rootScope = tokensRootScope();
    expect(rootScope, 'tokens.css 抓不到 :root 區塊 ⇒ 下面的比對是空字串比空字串,恆真').not.toBe('');
    const bpScope = bpPageScopes();
    expect(bpScope, 'brand-page.css 抓不到 .bp-page 區塊 ⇒ 下面的比對恆真').not.toBe('');
    for (const name of ['--c-graphite', '--f-serif']) {
      const rootVal = tokenValue(rootScope, name);
      const bpVal = tokenValue(bpScope, name);
      expect(rootVal, `tokens.css :root 沒有 ${name} ⇒ 升級片沒做完`).not.toBeNull();
      expect(bpVal, `brand-page.css .bp-page 沒有 ${name} ⇒ 本地定義被誤刪`).not.toBeNull();
      expect(
        rootVal,
        `${name} 兩處分岔(tokens.css :root = ${rootVal}, brand-page.css .bp-page = ${bpVal})` +
          ' ⇒ 品牌頁與其他頁的同一顆 token 會是不同值,而且兩邊各自的測試都會是綠的',
      ).toBe(bpVal);
    }
  });
});

/**
 * 取 tokens.css `[data-theme="dark"] { … }` 區塊的內容(大括號配對計數,
 * 同 tokensRootScope() 的做法)。`indexOf('[data-theme="dark"] {')` 抓精確帶大括號的
 * 字面,不會誤取到 `[data-theme="dark"] .ph { … }` 那條巢狀選擇器不同的規則。
 */
function tokensDarkScope(): string {
  const start = TOKENS_CSS.indexOf('[data-theme="dark"] {');
  if (start === -1) return '';
  const open = TOKENS_CSS.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < TOKENS_CSS.length; i++) {
    if (TOKENS_CSS[i] === '{') depth++;
    else if (TOKENS_CSS[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return '';
  return TOKENS_CSS.slice(open + 1, end);
}

describe('tokens.css · 深色模式不得覆寫固定深色場 token(R1 nit)', () => {
  it('🔴 [data-theme="dark"] 區塊內不得出現 --c-graphite 或 --f-serif', () => {
    // --c-graphite 是固定的品牌深色場(搭配寫死的 color:#fff),不是隨主題翻轉的介面色;
    // --f-serif 是字體、無深淺變體。日後有人往 [data-theme="dark"] 加同名 token 會讓
    // 這兩顆在深色模式下悄悄變成別的值,而分岔守門(上面那個 describe)只比對
    // :root 與 .bp-page,看不到 [data-theme="dark"] 這一層。
    const darkScope = tokensDarkScope();
    expect(darkScope, 'tokens.css 抓不到 [data-theme="dark"] 區塊 ⇒ 下面的負向斷言恆真').not.toBe('');
    expect(darkScope, '[data-theme="dark"] 不該覆寫 --c-graphite').not.toContain('--c-graphite');
    expect(darkScope, '[data-theme="dark"] 不該覆寫 --f-serif').not.toContain('--f-serif');
  });
});
