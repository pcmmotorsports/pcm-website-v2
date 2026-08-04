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
    // `--c-graphite` 只存在於 `.bp-page` 這個 scope,而這些元件是 fragment、scope 由外層路由掛。
    // D3 接線漏掛的話 var() 無值 ⇒ 背景失效、配上寫死的 color:#fff = 整塊看不見。
    // 一個 fallback 換掉那個失敗模式;逐處數,不是只驗「有一處有」。
    const uses = CSS.match(/var\(--c-graphite[^)]*\)/g) ?? [];
    expect(uses.length, '一處都沒有 ⇒ 這條在守一個不存在的東西').toBeGreaterThan(0);
    for (const u of uses) expect(u, `${u} 少了 fallback`).toContain(',');
  });
});

describe('品牌頁 CSS · 色票 scope', () => {
  it('🔴 設計色票掛在 .bp-page,不是 :root', () => {
    // --c-red 在正式站 tokens.css 已存在且值不同(#dc2626 vs 設計的熔橘 #f26722)。
    // 寫進 :root 會讓現有每一頁的按鈕/價格當場變色 = 未經批准的全站視覺改動。
    expect(CSS).toContain('.bp-page {');
    expect(CSS).not.toMatch(/^\s*:root\s*\{/m);
    const scope = CSS.slice(CSS.indexOf('.bp-page {'), CSS.indexOf('}', CSS.indexOf('.bp-page {')));
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
    expect(mediaBlock('(max-width: 960px)'))
      .toMatch(/\.bp-why-inner\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});

describe('品牌頁 CSS · 事實列欄數', () => {
  it('欄數吃 --fact-n(3 或 4 都要成立),不是寫死 4', () => {
    expect(CSS).toContain('repeat(var(--fact-n, 4)');
    expect(CSS).not.toMatch(/\.bp-facts-inner\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  });
});
