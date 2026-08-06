// home.test.ts — 首頁 CSS 的文字層守門(D3c-2;2026-08-04)
//
// 沿用 `brand-page.test.ts` / `products-mobile.test.ts` 的既有慣例:jsdom 不套 media query、
// 也不算 CSS 權重 ⇒ 元件測試對這一族恆綠。這支直接讀 CSS 原文斷言。
//
// 🔴 目前只守 D3c-2 動到的那一小塊(品牌清單的兩型別列),**不是** home.css 的完整守門 ——
//    D5 首頁重排會大動這個檔,屆時再按需要長。開一支新檔而不是塞進別支:
//    上面三支各自釘死自己那份 CSS 的路徑,混進去會讓「這條在守誰」變得要猜。
//
// ⚠️ **它擋不住什麼**:文字層看得到「規則在不在、形狀對不對」,看不到 cascade 的實際勝負
//    (D3b/D3c-1 三個真視覺缺陷全都是文字守門放行、真瀏覽器才抓到的)。
//    ⇒ 動到「站台層 class × 頁面 scope」交界時,仍要真瀏覽器量一次 computed 值。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RAW = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'home.css'), 'utf8');
// 先剝註解:本檔的註解大量引用選擇器字面,直接對原文比對會命中說明文字而不是真規則
// (brand-page.test.ts 記過這個實錘:規則被整段註解掉、守門照樣綠)。
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 取某個 @media 查詢的**全部**區塊內容(串接),大括號配對計數。
 * 🔴 兩個坑都是 `brand-page.test.ts` 已經記過、我這支第一版又踩了一次的:
 *    ①同一個查詢在檔裡會出現不只一次(home.css 的 `(max-width: 900px)` 就有多塊)——
 *      只取第一塊 = 其餘零覆蓋;②抓到第一個 `}` 就停會停在**內層規則**的收尾。
 */
function mediaBlock(query: string): string {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    // 比對到 `{` 為止、不是前綴比對:避免 `(max-width: 900px) and (…)` 被算進來。
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
 * 去掉所有 `@media` 區塊,只留**全斷點**(最外層)規則。
 * 🔴 R1 nit:本檔的斷言大多對整份 `CSS` 字串比對 —— 把一條規則整個搬進任一 `@media`,
 *    字串照樣命中 = **假綠**,而真實行為是「只有那個斷點才生效」(桌機悄悄退回舊值)。
 *    這與 `mediaBlock()` 是一組:那支問「這條在不在某斷點內」,這支問「這條是不是全斷點」。
 */
function topLevelCss(): string {
  let out = '';
  let i = 0;
  for (;;) {
    const at = CSS.indexOf('@media', i);
    if (at === -1) return out + CSS.slice(i);
    out += CSS.slice(i, at);
    const open = CSS.indexOf('{', at);
    if (open === -1) return out;
    let depth = 0;
    let end = -1;
    for (let j = open; j < CSS.length; j++) {
      if (CSS[j] === '{') depth++;
      else if (CSS[j] === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) return out;
    i = end + 1;
  }
}

describe('首頁 CSS · 品牌磚牆(D3c-2 兩型別 / D5f 磚牆重寫)', () => {
  it('🔴 註解符號成對(未閉合的 /* 會讓瀏覽器吞掉後半個檔,而剝註解的守門照樣全綠)', () => {
    const open = RAW.match(/\/\*/g)?.length ?? 0;
    const close = RAW.match(/\*\//g)?.length ?? 0;
    expect(open, `/* 有 ${open} 個、*/ 有 ${close} 個 — 註解沒閉合`).toBe(close);
    expect(open).toBeGreaterThan(0);
  });

  // 🔴 D5a 實錘:上面那條「數量成對」**擋不住註解提早關閉**。
  //    我在註解裡寫了 `白/**淺灰白**/深` —— 那串同時含一個 `/*` 和一個 `*/`,
  //    數量照樣配平、上面那條全綠,但 CSS 解析器在 `**/` 就把註解關掉了,後面的中文變成 CSS 內容
  //    ⇒ **Turbopack build 直接 parse 失敗**(typecheck / lint / 全套 vitest 當時全綠,
  //    只有 build 紅 = 鐵則 11 要求 build 的理由)。
  //
  //    判別法:`/*` 的出現次數,必須等於「非貪婪比對出來的完整註解區塊數」。
  //    註解**內部**多出一個 `/*`(提早關閉必然伴隨這個)會讓前者多、後者少 ⇒ 不相等。
  //    ⚠️ 這條刻意**不看中文** —— 第一版寫成「剝註解後不得殘留中文」,
  //    R1 實證它兩頭都不對:①合法的 `content: "中文"` 會被誤判 ②純 ASCII 的洩漏
  //    (`graphite/**paper-2**/dark`)完全抓不到。本版對兩種洩漏都會紅、且不碰 content。
  //    ⚠️ 仍擋不住:字串值裡合法出現 `/*`(例如 `content: "a/*b"`)會誤判 —— 本檔無此用法。
  //    真正的全族守門是 build 本身(lightningcss);本 repo 的 lightningcss 只能用
  //    版本釘死的 `.pnpm/lightningcss@1.32.0/...` 深路徑取得,Next 一升版就會為錯的理由變紅,故不採。
  it('🔴 註解沒有提早關閉(註解內出現 /* 或 */ 會讓後面的說明文字漏進 CSS)', () => {
    const opens = RAW.match(/\/\*/g)?.length ?? 0;
    const closes = RAW.match(/\*\//g)?.length ?? 0;
    const blocks = RAW.match(/\/\*[\s\S]*?\*\//g)?.length ?? 0;
    // 註解內多一個 `/*`(例如 `白/**淺灰白**/深`)⇒ opens 多於 blocks
    expect(
      opens,
      `/* 出現 ${opens} 次,但只湊得出 ${blocks} 個完整註解區塊 ⇒ 有註解提早關閉`,
    ).toBe(blocks);
    // 🔴 R2 補:註解內多一個**單獨的** `*/`(例如 `白*/深`)⇒ opens 與 blocks 仍然相等、
    //    上面那行照樣綠,只有 closes 會多出來。兩行合起來才蓋住整族。
    expect(
      closes,
      `*/ 出現 ${closes} 次,但只湊得出 ${blocks} 個完整註解區塊 ⇒ 有註解提早關閉`,
    ).toBe(blocks);
  });

  // 🔴 這條守兩件事,兩件都是「壞了也沒有任何其他測試會紅」:
  //    ① 退回只寫 `a` ⇒ 泛白那幾磚整個沒有 grid(三層塌成一行、min-height 也不生效)。
  //    ② 寫成**後代**選擇器 `.b-brand-wall :is(a, span)` ⇒ 磚內每一個 `<span>`
  //       (編號/產地/logo/品類描述)也被套上 `display:grid` + padding,整面牆爆掉。
  //       ②是 D3c-2 第一版真的寫錯的形狀,不是假想。
  //    ⚠️ D5f 起錨點從欄寬(`grid-template-columns`)換成**列高**(`grid-template-rows`):
  //       磚牆的欄數寫在 `.b-brand-wall` 自己身上,磚內版面是三列 —— 沿用舊錨點會零命中而恆綠。
  it('🔴 品牌磚的版面規則吃 `<a>` 與 `<span>` 兩種,而且是**子**選擇器', () => {
    const layout = [
      ...CSS.matchAll(/([^{}]*\.b-brand-wall[^{}]*)\{([^}]*grid-template-rows[^}]*)\}/g),
      // 🔴 正規化空白再比(關卡2 R1 nit):逐字比 `:is(a, span)` 的話,把 CSS 排版成
      //    `:is(a,span)` 會轉紅 —— 行為零變化的假紅會訓練人忽略這條守門。
    ].map((m) => m[1]!.trim().replace(/\s+/g, ' ').replace(/,\s*/g, ', '));
    expect(layout.length, '找不到 .b-brand-wall 的磚內列高規則').toBe(3); // 基礎 + ≤900 + ≤700
    for (const selector of layout) {
      expect(
        selector,
        `${selector} 不是 \`> li > :is(a, span)\` ⇒ 泛白磚沒有 grid、或磚內 span 被誤套`,
      ).toBe('.b-brand-wall > li > :is(a, span)');
    }
  });

  it('🔴 三條裡有兩條在窄斷點內(≤900 / ≤700;jsdom 對 media query 完全看不到)', () => {
    // 🔴 與上一條同樣要**正規化空白再比**(關卡2 R2 nit)。
    for (const [query, rows] of [
      ['(max-width: 900px)', /grid-template-rows:\s*auto 52px/],
      ['(max-width: 700px)', /grid-template-rows:\s*auto 50px/],
    ] as const) {
      const narrow = mediaBlock(query).replace(/\s+/g, ' ').replace(/,\s*/g, ', ');
      expect(narrow.length, `找不到 ${query} 區塊`).toBeGreaterThan(0);
      expect(narrow, `${query} 區塊裡的磚版面規則不是兩型別子選擇器`).toContain(
        '.b-brand-wall > li > :is(a, span)',
      );
      expect(narrow, `${query} 的磚內列高不對`).toMatch(rows);
    }
  });

  // 🔴 欄數是這面牆的承重值:20 家 ÷ 5 欄 = 剛好四列、CTA 另起一列跨滿(OD :464/:497)。
  //    欄數被改掉不會有任何元件測試轉紅,而版面會出現半空的最後一列。
  it('🔴 磚牆欄數 = 5 / ≤1200 → 4 / ≤700 → 2,且 CTA 磚在每一段都跨滿一列', () => {
    const cols = (css: string) =>
      css.replace(/\s+/g, ' ').match(/\.b-brand-wall\s*\{[^}]*grid-template-columns:\s*([^;}]+)/)?.[1]?.trim();
    expect(cols(topLevelCss()), '桌機欄數不是 5').toBe('repeat(5, minmax(0, 1fr))');
    expect(cols(mediaBlock('(max-width: 1200px)')), '≤1200 欄數不是 4').toBe('repeat(4, minmax(0, 1fr))');
    expect(cols(mediaBlock('(max-width: 700px)')), '≤700 欄數不是 2').toBe('1fr 1fr');
    // CTA 跨滿:欄數換了而它沒跟著,最後一列會出現一塊寬度不對的動作磚
    for (const css of [topLevelCss(), mediaBlock('(max-width: 1200px)'), mediaBlock('(max-width: 700px)')]) {
      expect(css.replace(/\s+/g, ' '), 'CTA 磚沒有跨滿一列')
        .toMatch(/\.b-brand-wall li\.is-cta\s*\{[^}]*grid-column:\s*1 \/ -1/);
    }
  });

  // 🔴 泛白那一半原本零守門:整段刪掉,元件測試(語意層)仍全綠、磚看起來與可點磚一模一樣,
  //    但語意上不可點 = 對客人最糟的組合(同 brand-page.css `.is-empty` 那條的理由)。
  it('🔴 `.is-empty` 的泛白規則都在,且形狀是「同前綴 + 多一個 class」(嚴格更高、不靠順序)', () => {
    const rules = [...CSS.matchAll(/([^{}]*\.is-empty[^{}]*)\{([^}]*)\}/g)]
      .map((m) => ({ selector: m[1]!.trim(), body: m[2]! }))
      .filter((r) => r.selector.includes('.b-brand-wall'));
    expect(rules.length, '.b-brand-wall 的 .is-empty 規則不見了').toBe(4);
    for (const r of rules) {
      // 每一段(逗號清單要逐段看,不能只看第一段 —— 關卡2 R1 nit:某一段被改成裸
      // `.is-empty .b-brand-tag` 這種會跨檔洩漏的形狀時,只檢查第一段仍全綠)
      // 都必須以 `.b-brand-wall .is-empty` 起頭 —— 這個形狀嚴格包含競爭者
      // (`.b-brand-tag` 等 (0,1,0)),所以勝負與規則順序無關,不會像 D3c-1 那樣反轉。
      for (const part of r.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '))) {
        expect(part.startsWith('.b-brand-wall .is-empty'), `${part} 前綴不對`).toBe(true);
      }
    }
    const body = rules.map((r) => r.body).join(' ');
    expect(body, '游標沒有改掉').toMatch(/cursor\s*:\s*default/);
    // 🔴 逐條都要有斷言:值被改成不生效的那一種(grayscale(0) / opacity 1)是**看得見**的回歸,
    //    而元件層完全看不到(它只驗語意)。這是「改壞值、保留選擇器」那種突變唯一會紅的地方。
    expect(body, 'logo 沒有轉灰').toMatch(/filter\s*:\s*grayscale\(1\)/);
    expect(body, 'logo 沒有降透明度').toMatch(/opacity\s*:\s*\.55/);
    expect(body, '品類描述沒有轉淡').toMatch(/color\s*:\s*var\(--ed-c-ink-mute\)/);
    expect(body, '編號 / 產地那一列沒有轉淡').toMatch(/opacity\s*:\s*\.6/);
  });

  // 🔴 hover 回饋(底色 + 熔橘頂線)**只能綁 `<a>`**:裸 `:hover` 對泛白磚的 `<span>` 照樣命中
  //    —— `brand-directory.css` 就是這樣翻過車的(真瀏覽器實測泛白卡 hover 底色會翻白)。
  //    這條同時是上面那族的配套:綁型別之後,`.is-empty` 不必再寫覆寫去搶權重。
  it('🔴 磚牆的 hover 一族綁 `a`,不得出現吃得到 `<span>` 的裸 `:hover`', () => {
    // 🔴 R1 F5:掃**整份 CSS**、不是只掃全斷點層 —— 裸 `:hover` 寫進任一 `@media` 一樣會
    //    讓泛白磚在那個斷點有回饋,而只掃 `topLevelCss()` 的版本對它全綠。
    const hovers = [...CSS.matchAll(/([^{}]*\.b-brand-wall[^{}]*:hover[^{}]*)\{/g)]
      .map((m) => m[1]!.trim().replace(/\s+/g, ' '));
    expect(hovers.length, '磚牆的 hover 規則不見了').toBeGreaterThanOrEqual(3);
    for (const sel of hovers) {
      expect(/(^|[\s>])a[.:]?[^\s>]*:hover/.test(sel), `${sel} 的 :hover 沒有綁在 a 上`).toBe(true);
    }
  });

  // 🔴 logo 展示格的幾何是**與校正值綁在一起**的:`data/brand-trim-logo-scale.ts` 那 20 個值
  //    是照「高 54px、寬 86%」目視校出來的,格子一改尺寸,20 家的目視大小就全部不對
  //    —— 而元件測試只看得到 inline style 的字串,對這件事全盲。
  it('🔴 logo 展示格 = 高 54px / 寬 86% / contain,且真的吃 `--logo-scale`', () => {
    const rule = topLevelCss().match(/\.b-brand-logo\s*\{[^}]*\}/)?.[0]?.replace(/\s+/g, ' ') ?? '';
    expect(rule, '找不到 .b-brand-logo 規則(全斷點層)').not.toBe('');
    expect(rule, '格高不是 54px').toMatch(/height:\s*54px/);
    expect(rule, '格寬不是 86%').toMatch(/width:\s*86%/);
    // `contain` 之外的值(cover)會把 logo 裁掉、而且每一家裁的位置不同
    expect(rule, 'background-size 不是 contain').toMatch(/background-size:\s*contain/);
    // 🔴 元件端逐家算出來的 `--logo-scale` 若沒人讀,20 個值就是白寫的(而畫面只是「都一樣大」)
    expect(rule, '沒有讀 --logo-scale ⇒ 逐家光學校正等於沒接上').toMatch(/transform:\s*scale\(var\(--logo-scale, 1\)\)/);
  });

  // 🔴 R1 F4:上面那條只讀全斷點層 ⇒ **窄斷點的 logo 尺寸零守門**,把 ≤900 / ≤700 改壞不會紅,
  //    而那條的訊息卻寫「格子一改尺寸,20 家目視大小全部不對」= 宣稱大於判別力。這條補上兩段。
  it('🔴 窄斷點的 logo 展示格尺寸照 OD(≤900 = 88%/52px、≤700 = 90%/50px)', () => {
    for (const [query, w, h] of [
      ['(max-width: 900px)', /width:\s*88%/, /height:\s*52px/],
      ['(max-width: 700px)', /width:\s*90%/, /height:\s*50px/],
    ] as const) {
      const rule = mediaBlock(query).replace(/\s+/g, ' ').match(/\.b-brand-logo\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, `${query} 裡找不到 .b-brand-logo 規則`).not.toBe('');
      expect(rule, `${query} 的 logo 格寬不對`).toMatch(w);
      expect(rule, `${query} 的 logo 格高不對`).toMatch(h);
    }
  });

  // 🔴 收**全部**碰到 `.ed-sr-only` 的規則、不是 `match()` 拿第一條(關卡2 R1 nit;
  //    姊妹檔 `brand-page.test.ts` 逐字記過同一個坑):日後補一條更具體的覆寫
  //    (例如 `.b-brand-wall .ed-sr-only { position: static }`)會把那句只給報讀器的話
  //    變成畫面上看得見的文字,而只看第一條的守門照樣綠。
  it('🔴 `.ed-sr-only` 是「看不見但唸得到」,不是 display:none / visibility:hidden,且全檔只有一條', () => {
    const all = [...CSS.matchAll(/([^{}]*\.ed-sr-only[^{}]*)\{([^}]*)\}/g)];
    expect(all.length, '碰到 .ed-sr-only 的規則不只一條 ⇒ 可能有覆寫把它變成看得見').toBe(1);
    const body = all[0]![2]!;
    expect(body, 'display:none / visibility:hidden 會讓報讀器一起看不到 = 完全沒效果')
      .not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
    expect(body).toMatch(/position\s*:\s*absolute/);
    expect(body).toMatch(/clip-path\s*:\s*inset\(50%\)/);
  });

  // 🔴 H5 突變證抓到的第二個洞(M53 一開始也是綠的):我把這條規則加進 CSS **卻沒寫斷言**。
  //    它承重的是鍵盤可用性 —— hero 是深色照片場,站台預設的焦點框色 `--ed-c-action-hover`(#c4470c)
  //    壓在暗照片上幾乎看不見,而切換條是鍵盤使用者**唯一**能操作的東西。
  it('🔴 hero 深色場的 :focus-visible 換成亮動作色(切換條的焦點框要看得見)', () => {
    const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.b-hero :focus-visible\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 hero 的 focus-visible 覆寫 ⇒ 焦點框會用站台預設色、在暗照片上看不見').not.toBe('');
    expect(rule, '沒有換成 --ed-c-action(亮熔橘)').toMatch(/outline-color:\s*var\(--ed-c-action\)/);
  });

  // 🔴 H5 真瀏覽器抓到的真缺陷的守門:入口板要讓位給固定 TabBar。
  //    OD 的 hero 高度算式沒把 TabBar 算進去 ⇒ 390×844 實測主 CTA 被蓋掉 33px。
  //    這條守的是「讓位還在、而且在對的斷點」——拿掉或把斷點寫成 900 都會讓 901-1079 那段回到被蓋住。
  it('🔴 入口板讓位給固定 TabBar,**兩級都要**(手機 70px / 平板 74px;主 CTA 不得被蓋住)', () => {
    // 🔴 R1 must-fix:第一版只寫了 70px 那一級 ⇒ 600-1079(TabBar 68px、body 讓位 74px)
    //    淨空只剩 2px。而且當時的斷言拿 `toMatch(/calc\(70px/)` 去掃整份 mobile-tabbar.css,
    //    被 ≤599 那一級滿足 ⇒ 對 74px 那一塊**完全盲**、「兩邊同字面」是恆真斷言。
    const TB = readFileSync(new URL('./mobile-tabbar.css', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    /** 從 mobile-tabbar.css 的指定 @media 區塊裡抓 body 的讓位值 —— 兩邊比的是**同一個來源**。
     *  用大括號走訪(同本檔 `mediaBlock`),不用 `[\s\S]*?\n\}` 那種寫法:後者會停在**內層規則**的收尾。 */
    const blockOf = (css: string, query: string): string => {
      const head = `@media ${query} {`;
      const start = css.indexOf(head);
      if (start === -1) return '';
      const open = css.indexOf('{', start);
      let depth = 0;
      for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') {
          depth -= 1;
          if (depth === 0) return css.slice(open + 1, i);
        }
      }
      return '';
    };
    const bodyPad = (query: string) =>
      blockOf(TB, query).replace(/\s+/g, ' ').match(/padding-bottom:\s*(calc\([^;}]+\))/)?.[1];
    const phone = bodyPad('(max-width: 1079px)');
    const tablet = bodyPad('(min-width: 600px) and (max-width: 1079px)');
    expect(phone, '在 mobile-tabbar.css 找不到手機那級的 body 讓位值 ⇒ 下面的比對會恆真').toBeTruthy();
    expect(tablet, '在 mobile-tabbar.css 找不到平板那級的 body 讓位值 ⇒ 下面的比對會恆真').toBeTruthy();
    expect(phone).not.toBe(tablet); // 前提:兩級真的是不同的值,否則這條測不出「少寫一級」

    const dockMargin = (query: string) => {
      const block = mediaBlock(query).replace(/\s+/g, ' ');
      return block.match(/\.b-dock[^{]*\{[^}]*margin-bottom:\s*(calc\([^;}]+\))/)?.[1]?.replace(/\s+/g, ' ');
    };
    expect(dockMargin('(max-width: 1079px)'), '手機級讓位不見了或與 body 讓位分家').toBe(phone);
    expect(dockMargin('(min-width: 600px) and (max-width: 1079px)'), '平板級讓位不見了或與 body 讓位分家').toBe(tablet);
    // `html[data-mobile="true"]` 兜底:media query 沒命中但 UA hint 命中時 TabBar 照樣 fixed
    expect(mediaBlock('(max-width: 1079px)').replace(/\s+/g, ' '), '缺 data-mobile 兜底 ⇒ 那條路徑上 CTA 又被蓋回去')
      .toContain('html[data-mobile="true"] .b-dock');
  });

  // 🔴 D-135 插單的守門:搜尋部品鈕照 OD 熔橘常駐,而**停用態要說實話**。
  //    這條擋兩個方向:①退回舊的「灰底、選到才墨黑」(那是整段沒跟稿的原狀)
  //    ②照 OD 字面搬色卻**忘了停用態** ⇒ 按不下去的按鈕長得跟可按的一樣(H6 死按鈕同型)。
  it('🔴 搜尋鈕:可按=熔橘常駐、hover 深橘、停用=灰且不吃 hover', () => {
    const top = topLevelCss().replace(/\s+/g, ' ');
    const base = top.match(/\.ed-finder-go\s*\{[^}]*\}/)?.[0] ?? '';
    expect(base, '找不到 .ed-finder-go 規則').not.toBe('');
    expect(base, '底色不是熔橘 ⇒ 整段又退回沒跟稿的灰').toMatch(/background:\s*var\(--ed-c-action\)/);
    expect(base, '字色不是白').toMatch(/color:\s*#fff/);
    expect(top, 'hover 不是深橘').toMatch(/\.ed-finder-go:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--ed-c-action-hover\)/);
    const dis = top.match(/\.ed-finder-go:disabled\s*\{[^}]*\}/)?.[0] ?? '';
    expect(dis, '沒有停用態 ⇒ 按不下去的按鈕長得跟可按的一樣').not.toBe('');
    expect(dis, '停用態沒有換底色').toMatch(/background:\s*var\(--ed-c-paper-2\)/);
    expect(dis, '停用態沒有換游標').toMatch(/cursor:\s*not-allowed/);
    // 🔴 hover 一族必須排除 disabled,否則停用中的按鈕滑過去會亮成深橘
    const hovers = [...top.matchAll(/([^{}]*\.ed-finder-go[^{}]*:hover[^{}]*)\{/g)].map((m) => m[1]!.trim());
    expect(hovers.length, '找不到 hover 規則').toBeGreaterThanOrEqual(2);
    for (const sel of hovers) {
      expect(sel.includes(':not(:disabled)'), `${sel} 沒有排除 disabled`).toBe(true);
    }
  });

  // 🔴 D-128 迴歸修的守門:hero **不得**裁切(裁切在媒體層)。
  //    這條擋的是「有人為了防溢出把 overflow:hidden 加回 .b-hero」——那會再一次把入口板的
  //    下拉選單切掉,而且**單元測試與截圖都看不到**(要下拉展開、而且要捲到 hero 底緣進入視窗才看得見)。
  //    ⚠️ 它擋不住什麼:文字層只知道宣告寫了什麼,不知道實際有沒有被裁 ——
  //       真正的判別力在真瀏覽器的 `elementFromPoint` 探針(本片已跑,結果寫在 commit body)。
  it('🔴 `.b-hero` 不得 overflow:hidden(下拉會被裁);裁切要在 `.b-hero-media`', () => {
    const top = topLevelCss().replace(/\s+/g, ' ');
    const hero = top.match(/\.b-hero\s*\{[^}]*\}/)?.[0] ?? '';
    expect(hero, '找不到 .b-hero 規則').not.toBe('');
    expect(hero, 'hero 又把 overflow 收成 hidden/clip ⇒ 入口板的下拉選單會被裁掉')
      .not.toMatch(/overflow:\s*(hidden|clip)/);
    const media = top.match(/\.b-hero-media\s*\{[^}]*\}/)?.[0] ?? '';
    expect(media, '找不到 .b-hero-media 規則').not.toBe('');
    expect(media, '媒體層沒有裁切 ⇒ 滿版底圖可能溢出 hero').toMatch(/overflow:\s*hidden/);
  });

  // 🔴 R1 must-fix:hero 高度必須吃站台 token,不得寫死頁首高。
  //    `tokens.css:25` 逐字要求「消費端一律 `var(--shell-header-h)`」—— 那顆 token 正是為了
  //    同款「兩處各寫一個數字、差 4px」的事故才立的。
  it('🔴 hero 高度吃 `--shell-header-h`,不得寫死頁首高(px)', () => {
    const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.b-hero\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 .b-hero 規則').not.toBe('');
    expect(rule, 'hero 高度沒有吃 --shell-header-h').toMatch(/height:\s*calc\(100svh - var\(--shell-header-h\)\)/);
    // 反面:任何斷點都不得再出現「100svh - 數字px」這種寫死法
    expect(CSS, '還有寫死頁首高的 hero 高度算式').not.toMatch(/height:\s*calc\(100svh - \d+px\)/);
  });

  // ── H6:N°02 最新商品橫捲軌道 ──────────────────────────────────────────
  // 🔴 這一族守的是「橫捲之所以能捲」的那幾個宣告 —— 少任何一個都會退回「看起來像橫捲、
  //    但捲不動 / 不對齊 / 露出捲軸」,而元件測試(jsdom 無 layout)對這些完全看不到。
  it('🔴 軌道能捲、會 snap、不露捲軸,而且格寬照 OD 的更正版算式', () => {
    const top = topLevelCss().replace(/\s+/g, ' ');
    const track = top.match(/\.b-carousel\s*\{[^}]*\}/)?.[0] ?? '';
    expect(track, '找不到 .b-carousel 規則').not.toBe('');
    expect(track, '沒有 overflow-x:auto ⇒ 根本捲不動').toMatch(/overflow-x:\s*auto/);
    expect(track, '沒有 scroll-snap ⇒ 停在半張卡上').toMatch(/scroll-snap-type:\s*x mandatory/);
    expect(track, '沒有 scroll-padding-left ⇒ snap 會把卡片切齊到 gutter 之外').toMatch(/scroll-padding-left:\s*var\(--ed-gutter\)/);
    expect(track, '沒藏捲軸(Firefox)').toMatch(/scrollbar-width:\s*none/);
    expect(track, '軌道不是 flex ⇒ 卡片會直接堆疊').toMatch(/display:\s*flex/);
    // 🔴 R1 nit:元件端的「捲一格 = 卡寬 + 16」把這個 16 抄了第二份 ⇒ 兩邊要一起釘,
    //    否則改 gap 會讓箭頭步進靜默錯位(每按一次偏 n px),而三綠全綠。
    //    (2026-08-07 R-1:那段程式碼由 `HomeSelect.tsx` 搬到 `ProductRail.tsx`,grep `+ 16` 找。
    //     🔴 本片驗收字面是「本檔一個字不改」——**動的只有這行註解、不是任何斷言**,
    //     斷言與測試數零變更(零變更的證據在改動前已錄)。不改的話這裡會留一句明知為假的
    //     跨檔指標,而那正是本窗這幾天反覆犯的錯。已在 STOP 申報,主視窗要還原可直接還原。)
    expect(track, '軌道間距不是 16px(元件端的步進 +16 會跟著錯)').toMatch(/gap:\s*16px/);
    expect(top, '沒藏捲軸(WebKit)').toMatch(/\.b-carousel::-webkit-scrollbar\s*\{[^}]*display:\s*none/);

    const item = top.match(/\.b-carousel-item\s*\{[^}]*\}/)?.[0] ?? '';
    // 🔴 OD :232-236 註解逐字更正過的算式:百分比相對**內容框**,padding 已扣過一次,
    //    再減 gutter*2 會讓每張卡少 16px、整列短 80px。5 格 4 道間距 = 64px。
    expect(item, '桌機格寬不是 OD 更正後的 5 格算式').toMatch(/flex:\s*0 0 calc\(\(100% - 64px\) \/ 5\)/);
    expect(item, '沒有 scroll-snap-align ⇒ snap 沒有對齊點').toMatch(/scroll-snap-align:\s*start/);
    expect(item, '沒有最小寬 ⇒ 窄螢幕會被壓成一條').toMatch(/min-width:\s*176px/);
    // 三個窄斷點的格寬(OD :238/:240/:241)
    expect(mediaBlock('(max-width: 1200px)').replace(/\s+/g, ' '), '≤1200 沒退成 4 格').toMatch(/flex:\s*0 0 calc\(\(100% - 48px\) \/ 4\)/);
    expect(mediaBlock('(max-width: 900px)').replace(/\s+/g, ' '), '≤900 沒退成 2.4 格(露出下一張的邊 = 可捲的訊號)').toMatch(/flex:\s*0 0 calc\(\(100% - 24px\) \/ 2\.4\)/);
    expect(mediaBlock('(max-width: 560px)').replace(/\s+/g, ' '), '≤560 沒退成 1.8 格').toMatch(/flex:\s*0 0 calc\(\(100% - 14px\) \/ 1\.8\)/);
  });

  // ── R-3:rail 在非首頁的 token 作用域 ────────────────────────────────
  // 🔴 這一條守的是**一個會無聲失效的東西**:`.b-select*` / `.b-carousel*` 吃的 `--ed-*` token
  //    只定義在 `.ed-page`(首頁專屬)。會員中心與品牌頁沒有那個作用域 ⇒ 少一顆 token,
  //    對應那條宣告就在計算值階段整條作廢 —— **不會報錯、不會有東西紅,只是版面悄悄不對**。
  //    ⇒ 清單**用推導的、不寫死**:實際掃出 rail 規則用到哪些 `--ed-*`,逐一要求 `.b-select-inset`
  //    有宣告。哪天有人往 rail 加一條吃新 token 的規則,這條會逼他同步補進 inset。
  it('🔴 .b-select-inset 補齊 rail 用到的每一顆 --ed-* token(非首頁沒有 .ed-page 作用域)', () => {
    // 🔴 掃描範圍走**整份 CSS**(含 @media)而不是 `topLevelCss()` —— 審查抓到:
    //    `topLevelCss()` 把 @media 剝掉,而 rail 在 @media 裡也有規則,漏掃就會有 token 沒被要求。
    const railStart = CSS.indexOf('.b-select {');
    const insetStart = CSS.indexOf('.b-select-inset {');
    expect(railStart, '找不到 .b-select 規則 ⇒ 本條前提失效').toBeGreaterThan(-1);
    expect(insetStart, '找不到 .b-select-inset ⇒ 非首頁的 rail 會整組無聲失效').toBeGreaterThan(railStart);
    const railCss = CSS.slice(railStart, insetStart);
    const used = [...new Set([...railCss.matchAll(/var\((--ed-[a-z-]+)/g)].map((m) => m[1]!))];
    // 🔴 審查抓到 `> 3` 太鬆(實際 7,掉 3 顆仍綠)⇒ 改成與「rail 區塊裡出現的 var() 種類數」對帳,
    //    手法沿用被本片刪掉的那條 `.acc-rec` 守門(解析數 vs 實際出現數,防「部分解析、靜默漏驗」)。
    const rawVarCount = new Set(
      [...railCss.matchAll(/var\(\s*(--ed-[a-z-]+)/g)].map((m) => m[1]!),
    ).size;
    expect(used.length, `掃到 ${used.length} 顆 token、原始比對得 ${rawVarCount} 顆 ⇒ 掃描漏了`).toBe(rawVarCount);
    expect(used.length, 'rail 規則裡一顆 --ed-* 都沒掃到 ⇒ 掃描範圍抓錯了').toBeGreaterThan(0);
    const insetBody = CSS.slice(insetStart, CSS.indexOf('}', insetStart));
    const missing = used.filter((t) => !insetBody.includes(`${t}:`));
    expect(
      missing,
      `.b-select-inset 少宣告這些 token:${missing.join(', ')} ⇒ 非首頁的對應宣告會無聲作廢`,
    ).toEqual([]);

    // 🔴 審查抓到:只驗「有宣告」不驗「值對」= 恆真族。`.ed-page` 那邊改了值、inset 沒跟,
    //    首頁與非首頁會靜默分岔而守門全綠。⇒ 顏色類 token 逐顆比值。
    //    (`--ed-gutter` / `--ed-max` 是**刻意不同**的版位值,見 home.css 那段註解 ⇒ 排除。)
    const LAYOUT_ONLY = new Set(['--ed-gutter', '--ed-max']);
    const edPageBody = CSS.slice(CSS.indexOf('.ed-page {'), CSS.indexOf('}', CSS.indexOf('.ed-page {')));
    const valueOf = (body: string, token: string) =>
      new RegExp(`${token}:\\s*([^;]+);`).exec(body)?.[1]?.trim();
    const drifted = used
      .filter((t) => !LAYOUT_ONLY.has(t))
      .map((t) => ({ t, page: valueOf(edPageBody, t), inset: valueOf(insetBody, t) }))
      .filter((r) => r.page === undefined || r.page !== r.inset);
    expect(
      drifted.map((r) => `${r.t}(.ed-page=${r.page} / inset=${r.inset})`),
      '這些 token 的值與 .ed-page 不一致 ⇒ 首頁與非首頁的 rail 會靜默長得不一樣',
    ).toEqual([]);

    // 🔴 序:inset 必須排在**所有** `.b-select {` 之後(同 specificity、靠後載勝)。
    //    審查抓到原本只比 top-level 的第一個 —— 而真正會打架的是
    //    `@media (max-width: 900px)` 裡那條 `.b-select { padding: 48px 0 52px }`。
    //    只比 top-level 的話,把 inset 搬到那條 @media 之前照樣綠,而 ≤900px 的 section
    //    留白會無聲跑回 48/52px。⇒ 用整份 CSS 的**最後一個** `.b-select {` 比。
    const lastSelectRule = CSS.lastIndexOf('.b-select {');
    expect(
      insetStart,
      '.b-select-inset 排在某條 .b-select 規則(含 @media 內那條)之前 ⇒ 它的 padding/背景會被蓋回去',
    ).toBeGreaterThan(lastSelectRule);
  });

  it('🔴 箭頭的 disabled 態有樣式(它是本 repo 自己接的線,OD 只畫沒接)', () => {
    const top = topLevelCss().replace(/\s+/g, ' ');
    expect(top, '箭頭沒有 disabled 樣式 ⇒ 到底了看起來還能按')
      .toMatch(/\.b-select-arrow:disabled\s*\{[^}]*opacity:\s*0?\.35/);
    expect(top, 'disabled 沒有換游標').toMatch(/\.b-select-arrow:disabled\s*\{[^}]*cursor:\s*not-allowed/);
    // 🔴 R1 nit:`:hover` 不排除 `:disabled` 的話,已停用的箭頭滑過去仍會亮起來配 `not-allowed` 游標
    expect(top, 'hover 沒有排除 disabled ⇒ 停用的箭頭滑過去還會亮').toMatch(/\.b-select-arrow:hover:not\(:disabled\)/);
  });

  // ── D5c/H3:N°03 分類 icon chip 磚面 ──────────────────────────────────
  // 🔴 這一族守的是「12 格磚面」的承重值:欄數、格線、色碼。全部是 jsdom 看不到、
  //    元件測試也看不到的東西(元件只知道 DOM 有沒有那個 class 與 attribute)。
  it('🔴 磚面欄數 = 6 / ≤1400 → 4 / ≤900 → 3 / ≤640 → 2(12 格要能整除,不然最後一列缺角)', () => {
    const cols = (css: string) =>
      css.replace(/\s+/g, ' ').match(/\.b-cat-list\s*\{[^}]*grid-template-columns:\s*([^;}]+)/)?.[1]?.trim();
    expect(cols(topLevelCss()), '桌機不是 6 欄').toBe('repeat(6, minmax(0, 1fr))');
    expect(cols(mediaBlock('(max-width: 1400px)')), '≤1400 不是 4 欄').toBe('repeat(4, minmax(0, 1fr))');
    expect(cols(mediaBlock('(max-width: 900px)')), '≤900 不是 3 欄').toBe('repeat(3, minmax(0, 1fr))');
    expect(cols(mediaBlock('(max-width: 640px)')), '≤640 不是 2 欄').toBe('1fr 1fr');
  });

  // 🔴 第 12 格是**另一個 class**(`.b-cat-more`,不是 `.b-cat-chip` 的修飾):
  //    格線與最小高度那條漏掉它,磚面右下角會塌一塊 —— 而 11 顆 chip 都是好的,
  //    截圖不看右下角就發現不了。OD :644 也是把兩個選擇器並列的。
  it('🔴 格線與最小高度同時吃 `.b-cat-chip` 與 `.b-cat-more`(第 12 格不能掉隊)', () => {
    const rule = topLevelCss().replace(/\s+/g, ' ')
      .match(/\.b-cat-chip,\s*\.b-cat-more\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到兩個選擇器並列的框線規則 ⇒ 第 12 格可能沒有格線').not.toBe('');
    expect(rule, '沒有右框線').toMatch(/border-right:\s*1px solid var\(--ed-c-rule\)/);
    expect(rule, '沒有下框線').toMatch(/border-bottom:\s*1px solid var\(--ed-c-rule\)/);
    expect(rule, '沒有最小高度 ⇒ 空一點的格子會比鄰居矮').toMatch(/min-height:\s*64px/);
  });

  // 🔴 色碼:11 條逐一比對,而且**必須綁 `[data-cat="N"]`**。
  //    退化成 `:nth-child(N)` 是最自然的寫法、也最錯:那會把顏色綁回**名次**,
  //    OD :927-929 逐字說「名次會變 → 色碼綁分類 id,不能綁位置」。
  it('🔴 11 條分類色碼綁 `data-cat`、逐條對到自己的 `--cat-N`,且不得改綁位置', () => {
    const css = topLevelCss().replace(/\s+/g, ' ');
    for (let n = 1; n <= 11; n += 1) {
      expect(
        css,
        `--cat-${n} 的色條規則不見了或對錯 token`,
      ).toMatch(new RegExp(`\\.b-cat-chip\\[data-cat="${n}"\\]\\s*\\{[^}]*inset 3px 0 0 var\\(--cat-${n}\\)`));
    }
    expect(css, '色碼被改綁位置選擇器 ⇒ 顏色會跟著名次跑').not.toMatch(/\.b-cat-chip:nth-(child|of-type)\([^)]*\)\s*\{[^}]*--cat-/);
  });

  // 🔴 兩份色票必須逐字相同:同一個分類在首頁 chip 與品牌頁 chips 上是同一個顏色。
  //    這條是「重複定義」的配套 —— 沒有它,兩邊分家不會有任何訊號。
  it('🔴 `--cat-1..11` 與 `brand-page.css` 的那份逐顆相同(11/11)', () => {
    const BP = readFileSync(new URL('./brand-page.css', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // 🔴 R1 nit:`Object.fromEntries` 對同名 key 靜默取最後一顆 ⇒ 同一檔裡出現兩次 `--cat-3`
    //    時,長度仍是 11、比到的是後寫的那顆。先擋重複,再比值。
    const grab = (s: string) => {
      const hits = [...s.matchAll(/--cat-(\d+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1]!, m[2]!.toLowerCase()] as const);
      expect(new Set(hits.map((h) => h[0])).size, `色票有重複定義的編號:${hits.map((h) => h[0]).join(',')}`).toBe(hits.length);
      return Object.fromEntries(hits);
    };
    const home = grab(CSS);
    const brand = grab(BP);
    // 前提斷言:兩邊都真的有 11 顆,否則下面的比對可能在比兩個空物件
    expect(Object.keys(home), 'home.css 的色票不是 11 顆').toHaveLength(11);
    expect(Object.keys(brand), 'brand-page.css 的色票不是 11 顆').toHaveLength(11);
    expect(home, '兩份分類色票分家 ⇒ 同名分類在首頁與品牌頁會是兩種顏色').toEqual(brand);
  });

  // 🔴 icon 方塊:底色若退回 `--ed-c-paper-2`(#f7f7f8)會與白底 chip 幾乎沒有分界,
  //    那個方塊就白畫了;`--ed-c-sunken` 是本片為此新增的一階深色(OD `--c-sunken` 字面)。
  it('🔴 icon 方塊 28×28、底色是 --ed-c-sunken 且該 token **的值**是 #f3f3f4', () => {
    const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.b-cat-icon\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 .b-cat-icon 規則').not.toBe('');
    expect(rule).toMatch(/width:\s*28px/);
    expect(rule).toMatch(/height:\s*28px/);
    expect(rule, 'icon 方塊沒有底色 ⇒ 與白底 chip 沒有分界').toMatch(/background:\s*var\(--ed-c-sunken\)/);
    // 🔴 R1 must-fix:上一版只驗「有定義而且是個 hex」= **恆真族** —— 把 `--ed-c-sunken` 的值
    //    改成 `#f7f7f8`(正是這條自己命名的那個威脅)選擇器全留、整組照樣全綠。
    //    值本身就是承重的:比 paper-2 深一階才看得出 icon 方塊的邊界。
    expect(CSS, '--ed-c-sunken 不是 OD 的 #f3f3f4 ⇒ icon 方塊與白底 chip 沒有分界').toMatch(/--ed-c-sunken:\s*#f3f3f4/i);
    // 🔴 icon 規格四件(OD :57 的全域 `svg{}` + :58 的線寬)。本 repo 沒有等價全域規則,
    //    少任何一項都會退回瀏覽器預設:fill 退成黑色實心、端點退成方頭。
    const svg = topLevelCss().replace(/\s+/g, ' ').match(/\.b-cat-icon svg\s*\{[^}]*\}/)?.[0] ?? '';
    expect(svg, 'icon 的 svg 沒有 fill:none ⇒ 線圖會變成實心色塊').toMatch(/fill:\s*none/);
    expect(svg, 'icon 的 svg 沒有 stroke:currentColor ⇒ 線條不會跟著文字色').toMatch(/stroke:\s*currentColor/);
    expect(svg, '線寬不是 OD :58 的 1.75(小尺寸補視覺重量那顆)').toMatch(/stroke-width:\s*1\.75/);
    expect(svg, '端點沒有圓頭 ⇒ 六角螺帽 / 護盾的尖角會變方頭(R1 抓到的真缺陷)')
      .toMatch(/stroke-linecap:\s*round/);
    expect(svg, '轉角沒有圓角 ⇒ 同上').toMatch(/stroke-linejoin:\s*round/);
  });

  // 🔴 R1 nit:磚面的**上緣與左緣**格線在 `.b-cat-list` 自己身上(右/下在每一格上)。
  //    掉了不會有任何測試紅,而畫面是「磚面缺了兩條邊」—— 與「右下角塌一塊」同族的鏡像。
  it('🔴 磚面的上緣 / 左緣格線在 `.b-cat-list` 上(右下在格子上,四邊要湊得齊)', () => {
    const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.b-cat-list\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 .b-cat-list 規則').not.toBe('');
    expect(rule, '磚面沒有上緣格線').toMatch(/border-top:\s*1px solid var\(--ed-c-rule\)/);
    expect(rule, '磚面沒有左緣格線').toMatch(/border-left:\s*1px solid var\(--ed-c-rule\)/);
    expect(rule, 'gap 不是 0 ⇒ 12 格之間會裂開、不是一塊完整磚面').toMatch(/gap:\s*0/);
  });

  // ── 2026-08-07 finder 窄幅修(Sean 488px 實測回報破版)────────────────
  // 🔴 這三條守的東西**原本一條守門都沒有**(偵察實查:`VehicleFinder.test.tsx` 只鎖 placeholder
  //    字面與 DOM 結構、jsdom 不跑 layout;`home.test.ts` 沒有任何 `.ed-finder-bar` 欄數斷言)。
  //    ⇒ 修完就有可能無聲回歸。
  it('🔴 .ed-finder-slot 有 min-width:0(OD 稿有、真站原本搬漏)', () => {
    const top = topLevelCss();
    const slot = /\.ed-finder-slot\s*\{[^}]*\}/.exec(top)?.[0] ?? '';
    expect(slot, '找不到 .ed-finder-slot 基礎規則 ⇒ 本條前提失效').not.toBe('');
    expect(slot, 'grid item 少了 min-width:0 ⇒ 收不到內容寬以下(OD 的 slot 與 slot input 兩處都有)')
      .toMatch(/min-width:\s*0/);
  });

  it('🔴 ≤900px:年份欄跨滿整排(OD 有 grid-column:span 2、真站原本搬漏 ⇒ 第二欄留空洞)', () => {
    const narrow = mediaBlock('(max-width: 900px)');
    expect(narrow, '年份欄沒有跨兩欄 ⇒ 第二排右半格是空洞(真瀏覽器 488px 量到 slot3 只佔 207/414)')
      .toMatch(/\.ed-finder-slot:nth-of-type\(3\)\s*\{[^}]*grid-column:\s*span 2/);
    // 前提:這條只在「兩欄」的前提下才有意義。
    expect(narrow, '≤900px 不是兩欄 ⇒ 本條前提失效')
      .toMatch(/\.ed-finder-bar\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  });

  it('🔴 ≤560px:三欄各自獨占一排(OD 沒涵蓋這個寬度、按稿意圖外推;不靠刪 placeholder 例字解決)', () => {
    const tiny = mediaBlock('(max-width: 560px)');
    // ⚠️ 審查抓到 `tiny.length > 0` 是恆真:`(max-width: 560px)` 這個查詢也命中本檔既有的
    //    `.b-carousel-item` 那塊 ⇒ 把 finder 的 ≤560 整段刪掉,那條照樣綠、失敗訊息會說謊。
    //    ⇒ 改成要求那個區塊**真的含有 finder 規則**。
    expect(tiny, '≤560px 區塊裡沒有 .ed-finder-bar ⇒ 窄幅單欄修正整條不見了(或被切到別的 560 區塊)')
      .toMatch(/\.ed-finder-bar/);
    expect(tiny, '≤560px 沒有收成單欄 ⇒ 車型欄的「例:R6」會被切掉')
      .toMatch(/\.ed-finder-bar\s*\{[^}]*grid-template-columns:\s*1fr\s*[;}]/);
    // 反面:單欄之後不得殘留「跨兩欄」——那會讓 grid 自動長出第二欄、破版換個方向再來一次。
    expect(tiny, '≤560px 仍留著 span 2 ⇒ 單欄會被撐成兩欄')
      .not.toMatch(/grid-column:\s*span 2/);
    // 單欄之後每一列右緣不該再有欄間分隔線(拿掉這條會多一條孤兒框線,而上面幾條都不會紅)。
    expect(tiny, '≤560px 沒有解除 slot 的 border-right ⇒ 單欄每列右緣多一條孤兒框線')
      .toMatch(/\.ed-finder-slot\s*\{[^}]*border-right:\s*0/);
    // 🔴 序:≤560 必須排在 ≤900 之後(同 specificity、靠後載勝),否則整段被 ≤900 蓋回兩欄。
    //    ⚠️ 審查抓到我第一版是**恆真**:`CSS.indexOf('@media (max-width: 900px)')` 命中的是
    //    檔案開頭 `.ed-page { --ed-gutter: 20px }` 那個 900 區塊(offset 幾百),
    //    根本不是 finder 的那個(offset 七千多)⇒ 把 ≤560 整段搬到 finder 的 900 之前,
    //    這條照樣綠,而 488px 已經被蓋回兩欄。
    //    ⇒ 改成比「**含 `.ed-finder-bar` 的那兩個區塊**」的位置。
    const finder900 = CSS.indexOf('.ed-finder-bar { grid-template-columns: 1fr 1fr; }');
    const finder560 = CSS.indexOf('.ed-finder-bar { grid-template-columns: 1fr; }');
    expect(finder900, '找不到 finder 的 ≤900 兩欄規則 ⇒ 本條前提失效').toBeGreaterThan(-1);
    expect(finder560, '找不到 finder 的 ≤560 單欄規則 ⇒ 本條前提失效').toBeGreaterThan(-1);
    expect(
      finder560,
      'finder 的 ≤560 單欄規則排在 ≤900 兩欄規則之前 ⇒ 會被兩欄那組蓋回去',
    ).toBeGreaterThan(finder900);
  });

  it('🔴 chips 的負邊距出血對齊 .b-dock 自己的內距(不是頁面 gutter)', () => {
    // 🔴 原本吃 `--ed-gutter`(≤900 是 20px),而 `.b-dock` 的左右內距是 16px
    //    ⇒ 多出 4px、chips 這一列伸出白卡右緣(真瀏覽器 488px 量到 +4)。
    //    出血要對齊的是**容器自己的內距**,兩者無關、只是碰巧接近。
    const narrow = mediaBlock('(max-width: 900px)');
    const pad = /\.b-dock\s*\{[^}]*--dock-pad:\s*([0-9]+px)/.exec(narrow)?.[1];
    expect(pad, '≤900px 的 .b-dock 沒有宣告 --dock-pad ⇒ 出血失去同源依據').toBeTruthy();
    // padding 必須真的吃那顆變數(否則兩者會各走各的)
    expect(narrow, '.b-dock 的 padding 沒有吃 --dock-pad ⇒ 改 padding 時出血不會跟著動')
      .toMatch(/\.b-dock\s*\{[^}]*padding:[^;]*var\(--dock-pad\)/);
    const chipsRule = /\.cat-garage--inline\s+\.cat-garage-chips\s*\{[^}]*\}/.exec(narrow)?.[0] ?? '';
    expect(chipsRule, '找不到 chips 那條規則 ⇒ 本條前提失效').not.toBe('');
    expect(chipsRule, 'chips 的負邊距沒有吃 --dock-pad ⇒ 又會與白卡邊緣對不齊')
      .toMatch(/margin-right:\s*calc\(var\(--dock-pad\) \* -1\)/);
    expect(chipsRule, 'chips 的 padding-right 沒有吃 --dock-pad').toMatch(/padding-right:\s*var\(--dock-pad\)/);
    // 反面:不得再出現用 gutter 做出血的舊寫法。
    expect(chipsRule, 'chips 又改回吃 --ed-gutter ⇒ 與 .b-dock 內距脫鉤').not.toMatch(/--ed-gutter/);
  });

  // ── A10:首頁自刻的愛車 chips 家族退場、換全站唯一的 GarageChips ──
  // 🔴 這條守的是「搬家時把行為弄丟」那一族。V-2d② 是 Sean 2026-07-15 真機回報的爆版
  //    (「我的愛車會被推到下一行」),修法是 ≤900px 改單行橫向捲動。換 class 時最容易發生的事
  //    就是規則留在舊 selector 上、新 selector 沒人套 ⇒ CSS 還在、對誰都不生效,jsdom 全綠。
  it('🔴 V-2d② 的 ≤900px 橫向捲動修正有跟著搬到 .cat-garage--inline(不是留在退場的舊 class)', () => {
    const narrow = mediaBlock('(max-width: 900px)');
    expect(narrow, '≤900px 區塊裡找不到愛車列的捲動規則')
      .toMatch(/\.cat-garage--inline\s+\.cat-garage-chips\s*\{[^}]*overflow-x\s*:\s*auto/);
    expect(narrow, '沒有 flex-wrap:nowrap 就還是會換行 = 修正等於沒搬')
      .toMatch(/\.cat-garage--inline\s+\.cat-garage-chips\s*\{[^}]*flex-wrap\s*:\s*nowrap/);
    expect(narrow, 'chip 要 flex:0 0 auto 才不會被壓扁')
      .toMatch(/\.cat-garage--inline\s+\.cat-garage-chip\s*\{[^}]*flex\s*:\s*0 0 auto/);
    // 🔴 scope 是承重的:home.css 由 layout.tsx **全域** import,少了 `.b-dock ` 前綴,
    //    A10b/A10c 把 inline 掛上 PDP §7 與購物車之後,這段捲動與出血會潑到那兩處去。
    //    (2026-08-07 更正:出血已改吃 `--dock-pad`、不再是 gutter,上一行的「gutter 出血」字面已過期。)
    // 🔴 H5 突變證抓到的洞(M52 一開始是綠的):上一版用 `toMatch` 找「**有沒有一條**帶前綴的規則」
    //    —— 而這一族有四條,其中 `::-webkit-scrollbar` 那條照樣帶著前綴 ⇒ 把**別條**的前綴拿掉,
    //    斷言仍被那條滿足、全綠。一個實例滿足全族 = 那正是本 repo 記過的假守門形狀。
    //    改成**逐條走訪**:narrow 區塊裡任何碰到 `.cat-garage--inline` 的規則,選擇器都必須以 `.b-dock` 起頭。
    const inlineRules = [...narrow.matchAll(/([^{}]*\.cat-garage--inline[^{}]*)\{/g)]
      .map((m) => m[1]!.trim());
    expect(inlineRules.length, '≤900 區塊裡找不到任何愛車列規則 ⇒ 下面那圈恆真').toBeGreaterThanOrEqual(3);
    for (const sel of inlineRules) {
      for (const part of sel.split(',').map((x) => x.trim())) {
        expect(part.startsWith('.b-dock '), `${part} 沒有鎖在 .b-dock 底下 ⇒ 會潑到 PDP §7 與購物車的同名 chips`).toBe(true);
      }
    }
    // R2 追加(scope 收緊):**@media 外**那條外距規則同樣承重 —— 少了 `.b-dock` 前綴,
    // PDP §7(自己已有 .pfc-picker 的 10px)與購物車(.cvf-edit 的 gap:10px)會被多疊一層 12px。
    // 上面的迴圈只掃 ≤900px 區塊、掃不到它。
    expect(CSS, '行內密度的外距規則沒有鎖在 .b-dock 底下 ⇒ 會潑到 PDP 與購物車')
      .toMatch(/\.b-dock\s+\.cat-garage--inline\s*\{[^}]*margin-bottom/);
    expect(CSS, '出現了無 scope 的 .cat-garage--inline 外距規則')
      .not.toMatch(/(^|\})\s*\.cat-garage--inline\s*\{[^}]*margin-bottom/m);
  });

  // 🔴 nowrap 必須是**全斷點**基礎規則,不能只活在 ≤900px:
  //    舊 `.ed-finder-garage-chip` 就是全斷點,只補窄螢幕 = 桌機長車名照樣折行撐高(V-2d② 原症狀)。
  //    ⚠️ 它刻意**不在** home.css,而在 filter-cascade.css 的 inline 家族規則 —— 故在那支檔驗。
  it('🔴 行內密度 chip 的 white-space:nowrap 是全斷點基礎規則(不得只在 ≤900px 內)', () => {
    const CASCADE = readFileSync(new URL('./filter-cascade.css', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(CASCADE, 'filter-cascade.css 找不到 inline 家族的 nowrap')
      .toMatch(/\.cat-garage--inline\s+\.cat-garage-chip\s*\{[^}]*white-space\s*:\s*nowrap/);
    // 卡片密度(手機面板 2 欄 grid + min-height)靠折行才排得下 ⇒ 不得被全域套上
    // ⚠️ 已知洞(R3 nit,文字層固定洞族、刻意不補):這條負向式抓不到**選擇器串接走私** ——
    //    `.cat-garage-chip,\n.foo { white-space: nowrap }` 這種寫法,`^\.cat-garage-chip` 後面
    //    接的是逗號不是 `{`,正規式不命中而規則照樣全域生效。要真的堵死需要 CSS 走訪器
    //    (products-mobile.test.ts 的 mediaBlock 那種等級);此處風險低、留註解讓下一個人知道邊界在哪。
    expect(CASCADE, 'nowrap 被寫成 .cat-garage-chip 全域基礎規則會撐爆手機面板的 2 欄格子')
      .not.toMatch(/^\.cat-garage-chip\s*\{[^}]*white-space\s*:\s*nowrap/m);
  });

  it('🔴 舊的 .ed-finder-garage* / .ed-finder-suggest* 家族已全數退場(不得兩套並存)', () => {
    // 留著=下一個人不知道該改哪一套,且首頁會有兩份互相打架的 chip 樣式
    expect(CSS).not.toMatch(/\.ed-finder-garage/);
    expect(CSS).not.toMatch(/\.ed-finder-suggest/);
  });

  // ── D5a:區塊底色(節奏 白/白/深/白/淺灰白/深)──
  // 🔴 這兩條與 `app/page.test.tsx` 的順序守門是**一組**:順序對、底色錯,節奏一樣是壞的
  //    (README 第 7 步「深色減重」處理的就是「深色堆在下半」而不是「順序不對」)。
  //    jsdom 完全看不到底色 ⇒ 只有文字層 + 真瀏覽器 computed 值抓得到。
  it('🔴 N°04 服務宣言 = 石墨 #202225(不是重排前的純黑 #0a0a0a)', () => {
    const rule = CSS.match(/\.ed-statement\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 .ed-statement 規則').not.toBe('');
    // 2026-08-06:background 已改吃 var(--c-graphite, #202225)(token 升 :root 片)——
    // 字面值不變,只是多了一層 var()/fallback,故放寬成兩種寫法都收、字面色值不放寬。
    expect(rule, '服務宣言不是石墨 #202225').toMatch(/background:\s*(?:#202225|var\(--c-graphite,\s*#202225\))/);
    expect(rule, '還留著重排前的純黑').not.toMatch(/background:\s*#0a0a0a/);
  });

  it('🔴 N°06 授權代理 = 淺灰白 --ed-c-paper-2(不是純白)', () => {
    // ⚠️ D5f 把這一區換成磚牆 ⇒ 錨點由 `.ed-brands` 改 `.b-brands`。OD 的**基礎層**這一格
    //    是 `var(--c-surface)`(純白),淺灰白來自套用層(:695)—— 折成一層時挑錯邊
    //    正好會退回純白、而「節奏」那條肉眼才看得出來,故這條守的是折疊結果。
    const rule = CSS.match(/\.b-brands\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 .b-brands 規則').not.toBe('');
    expect(rule, '授權代理不是淺灰白').toMatch(/background:\s*var\(--ed-c-paper-2\)/);
    // 前提:這個 token 真的有定義,否則 var() 會 fallback 成透明 = 看起來像白、守門卻綠
    expect(CSS, '--ed-c-paper-2 沒有定義 ⇒ var() 會落空').toMatch(/--ed-c-paper-2:\s*#[0-9a-f]{3,8}/i);
  });

  // ── Q6:finder placeholder 弱化色(Sean 拍板 A) ──
  // 🔴 這條原本零守門:placeholder 與已選值同色是**看得見**的缺陷,但沒有任何測試會紅
  //    (jsdom 不算 cascade、元件測試只看 `placeholder` 屬性字面、不看顏色)。
  it('🔴 finder placeholder = 弱化色 --ed-c-ink-mute(不得回到與已選值同色的 --ed-c-ink)', () => {
    // 🔴 收**全部**碰到 `vsc-input--finder` 的 `::placeholder` 規則、且只在**全斷點**層找
    //    (R1 nit 兩條):①`match()` 只取第一條 ⇒ 日後任何一條更具體的後置覆寫
    //    (例 `.ed-finder .vsc-input--finder::placeholder`)把顏色改回黑,守門照樣綠;
    //    ②整條搬進 `@media` ⇒ 只有那個斷點生效、桌機退回黑,對全檔字串比對照樣綠。
    const rules = [
      ...topLevelCss().matchAll(
        /([^{}]*vsc-input--finder[^{}]*::placeholder[^{}]*)\{([^}]*)\}/g,
      ),
    ].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
    // 2 條 = 一般態 + `:disabled` 態。多出第三條 ⇒ 有人加了覆寫,必須回來看它是不是把色改回去
    //(這條會為此假紅一次,是刻意的:比靜默放行好)。
    expect(
      rules.map((r) => r.selector),
      'finder placeholder 規則不是預期的兩條(一般 + :disabled)',
    ).toHaveLength(2);
    for (const r of rules) {
      expect(r.body, `${r.selector} 的 placeholder 不是弱化色`).toMatch(
        /color:\s*var\(--ed-c-ink-mute\)/,
      );
      // 🔴 收尾的 `\)` 是承重的:`var(--ed-c-ink-mute)` 這個字串**包含** `var(--ed-c-ink` 前綴,
      //    少了右括號的話這條負向斷言會把正確的寫法也判成違規(反向假紅)。
      //    這條**不**被上面那條蘊含 —— 兩個宣告並存(`…-mute); color: var(--ed-c-ink);`)時
      //    正向綠、後者在 CSS 勝出、只有這條會紅。該突變已親跑(R1 nit 4 要求的專屬突變)。
      expect(
        r.body,
        `${r.selector} 退回純黑 = 與已選好的值同色、客人分不出選了沒`,
      ).not.toMatch(/color:\s*var\(--ed-c-ink\)/);
    }
    // 前提:token 真的有定義,否則 var() 落空 ⇒ 吃站台層繼承色、守門卻綠(同 --ed-c-paper-2 那條的理由)
    // ⚠️ 已知邊界(R1 nit,不補):這條只證「檔內某處有定義」,不證它仍掛在 `.ed-page` scope 上。
    expect(CSS, '--ed-c-ink-mute 沒有定義 ⇒ var() 會落空').toMatch(/--ed-c-ink-mute:\s*#[0-9a-f]{3,8}/i);
  });

  // ── Q5:finder 停用態壓淡(Sean 拍板 A,2026-08-05) ──
  // 🔴 這條守的是一個**來回過兩次**的值,所以要釘死:
  //    ① 原本 `opacity: 1`,註解宣稱「對齊 design」——**那句是假的**,兩份 OD 稿都用降透明度。
  //    ② Q6 把 placeholder 轉成 ink-mute 之後,「啟用未選」與「停用」只剩 cursor 有差
  //       ⇒ 停用的 affordance 等於沒了(那是 Q6 揭示、Sean 據以拍板的副作用)。
  //    ③ 現在取設計稿的 `.45` —— OD `vehicle-picker-design.html` 逐字
  //      `.vsc-input-demo:disabled { opacity: 0.45; }`(不引行號、用 grep 找字串)
  //      (**不是**站台層 `.vsc-input:disabled` 的 `0.55`,也不是回到 `1`)。
  //    ⇒ 只要有人把它改回 1 或改成 0.55,這條就紅。
  it('🔴 finder 停用態 opacity = 0.45(設計稿值;不得回到 1、也不是站台層的 0.55)', () => {
    const rules = [
      ...topLevelCss().matchAll(
        /([^{}]*vsc-input--finder:disabled[^{}]*)\{([^}]*)\}/g,
      ),
    ].map((m) => ({ selector: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
    // 2 條 = 本體 + `::placeholder`。多出第三條 ⇒ 有人加了覆寫,要回來看它是不是把值改回去。
    // ⚠️ 邊界(R1 nit):`topLevelCss()` 已剝掉所有 `@media` 區塊 ⇒ 這條對**斷點內的覆寫全盲**
    //    (有人在 `@media` 裡把 opacity 改回 1,這裡照樣綠)。本檔 `:53-57` 記過這個洞的反向。
    expect(rules.map((r) => r.selector), 'finder 停用態規則不是預期的兩條').toHaveLength(2);
    const main = rules.find((r) => !r.selector.includes('::placeholder'));
    expect(main, '找不到 :disabled 本體規則').toBeDefined();
    // 🔴 量的是**生效值**,不是「本文裡有沒有出現某個字串」(R2 nit)。
    //    原本寫成一條正向 `.45` + 兩條負向(`1` / `0.55`)的字串比對,有一族固定的洞:
    //    `opacity: 1 !important` 與 `opacity: 1.0` 兩者都繞得過 `/opacity:\s*1\s*[;}]/`
    //    (前者 `1` 後面接的是空白+`!`,後者接的是 `.`)⇒ 正向的 `.45` 還在、負向不紅 = 假綠。
    //    改成取**同一條規則裡最後一個 `opacity` 宣告**(單一 rule 內後者覆蓋前者),
    //    一條斷言同時涵蓋「改回 1」「退回 0.55」「加 !important 蓋掉」「重複宣告」四種改法。
    //    🔴 `!important` **必須一起模擬**,不能只取「最後一條」:實測過 ——
    //    在 `.45` 那行**之前**插一條 `opacity: 1 !important`,瀏覽器生效值是 `1`
    //    (important 蓋過非 important、與順序無關),而「取最後一條」會讀到 `.45` = **假綠**。
    //    這正是本條要補的那個洞,拿「取最後一條」去補會原地踏步。
    // ⚠️ 它擋不住什麼:①`@media` 內的覆寫仍全盲(同上面那則邊界)。
    //    ②同 importance 的多條走 source order,跨 rule 的 specificity 不在本條射程
    //    (上面已釘死「這個選擇器只有兩條規則」,多一條就先紅在那裡)。
    const decls = [...main!.body.matchAll(/opacity:\s*([0-9]*\.?[0-9]+)\s*(!important)?/g)].map(
      (m) => ({ value: Number(m[1]), important: Boolean(m[2]) }),
    );
    expect(decls, '這條規則裡一個 opacity 宣告都沒有 ⇒ 停用態沒有壓淡').not.toHaveLength(0);
    // 生效值 = 有 important 就取最後一條 important,否則取最後一條。
    const importants = decls.filter((d) => d.important);
    const effective = (importants.length ? importants : decls).at(-1)!.value;
    expect(
      effective,
      `finder 停用態生效 opacity = ${effective},應為設計稿的 0.45`
        + '(1 = 又看不出停用了;0.55 = 退回站台層預設,不是設計稿的值)',
    ).toBe(0.45);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 D5e-2b 動線區。這一組守的是**兩個很容易被「順手修正」掉的決定**:
  //    ①主按鈕的熔橘 —— 對比 3.12:1 不到門檻,是 Sean 看過三個替代方案後**拍板保留**的
  //      殘餘風險(handoff §十一 + C-104-A 六不做 ⑤)。下一個看到對比警告的人很可能
  //      「順手」把它改深或改成墨色,而畫面看起來只會變好、不會有任何測試紅。
  //    ②分類列是**無框底線**不是盒子(OD §6-2 逐字)。加個 border 看起來也很正常。
  // ══════════════════════════════════════════════════════════════════════════
  describe('🔴 D5e-2b 動線區(主按鈕熔橘 + 分類無框底線)', () => {
    /**
     * 取某個選擇器的**全部**同選擇器區塊(串接)。
     *
     * 🔴 **第一版只取第一個匹配,而那是真的假綠**(R2 F5,M10-c 實測):
     *    在檔案後面**追加**一條 `.ed-feature-primary{background:var(--ed-c-ink)}`,
     *    CSS 後到者勝 ⇒ 按鈕真的變墨色,而只看第一個區塊的守門 **30 條全綠**
     *    —— 那正是這組守門自稱要擋的那件事。
     *    ⇒ 改成掃全部匹配並串接:任何後置覆寫都會進到被斷言的字串裡,
     *      「不得出現墨色」那種負向斷言因此才真的擋得住。
     */
    const ruleBlocks = (selector: string): string[] => {
      const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g');
      return [...topLevelCss().matchAll(re)].map((m) => m[1]!);
    };
    const rule = (selector: string): string => ruleBlocks(selector).join('\n');

    it('🔴 主按鈕填的是熔橘動作色,不是墨色、也不是站台的 --c-red', () => {
      const body = rule('.ed-feature-primary');
      expect(body, '找不到 .ed-feature-primary 規則').not.toBe('');
      // 走本檔自己的 token。
      // ⚠️ **這條反面斷言的效力在 2026-08-05 第0批 0c 之後變弱了,誠實記下來**:
      //    0c 之前站台 `--c-red` 是 `#dc2626` 緋紅 ⇒ 誤用站台那顆會**當場畫錯色**,這條擋的是真缺陷。
      //    0c 之後站台 `--c-red` = `#f26722` = 與 `--ed-c-action` **同值** ⇒ 誤用不再有視覺症狀,
      //    這條現在守的是**架構分離**(首頁自帶色票、不與站台耦合)而不是顏色正確性。
      //    仍然留著:`--ed-c-action-active`(`#a53a08`)站台沒有對應顆,整組收斂要一起做、
      //    而「先偷偷換掉其中一顆」正是最容易發生的走樣。
      expect(body, '主按鈕沒有填熔橘動作色').toMatch(/background:\s*var\(--ed-c-action\)/);
      expect(body, '主按鈕改用站台的 --c-red ⇒ 首頁色票與站台耦合(0c 後兩者同值、不再有視覺症狀)').not.toMatch(
        /background:\s*var\(--c-red/,
      );
      expect(body, '主按鈕被改成墨色 ⇒ 違反「熔橘才是動作色」(OD §6-2)').not.toMatch(
        /background:\s*var\(--ed-c-ink\)/,
      );
      // 觸控目標:桌機 44px(手機那段在 @media 內,由下一條守)
      expect(body, '主按鈕高度不足 44px').toMatch(/min-height:\s*44px/);
      // 🔴 **文字色也要釘住**(R1 實測突變:改成 `#000` 之後本檔與元件測試**全綠**)。
      //    這不是假想的改法 —— 白字對熔橘 3.12:1 不到門檻,下一個看到對比警告的人
      //    最自然的動作就是「把字改成黑的」,而畫面只會變好看。
      //    handoff §十一 明令那顆是 Sean 看過墨黑版之後**拍板保留白字**的,不得順手改。
      expect(body, '主按鈕的白字被改掉了 ⇒ 那是 Sean 拍板保留的,要改必須他重新拍板').toMatch(
        /color:\s*#fff\b/,
      );
    });

    it('🔴 熔橘三顆的值就是設計稿的值(改深一階也算改,要 Sean 重新拍板)', () => {
      const page = rule('.ed-page');
      expect(page, '找不到 .ed-page 色票').not.toBe('');
      expect(page, '熔橘填色值被改動').toMatch(/--ed-c-action:\s*#f26722/);
      expect(page, 'hover 值被改動').toMatch(/--ed-c-action-hover:\s*#c4470c/);
      expect(page, 'active 值被改動').toMatch(/--ed-c-action-active:\s*#a53a08/);
    });

    it('🔴 分類列是無框底線式:有 ::after 細線、且本體不得有 border', () => {
      const link = rule('.ed-feature-jump a');
      expect(link, '找不到 .ed-feature-jump a 規則').not.toBe('');
      // 盒子化的症狀就是本體長出 border ——「無框」是這個版位的語言(OD §6-2)。
      expect(link, '分類連結長出邊框 ⇒ 被做成盒子了,與資料條的細線語言打架').not.toMatch(/(^|[;\s])border/);
      expect(link, '分類連結的觸控高度不足').toMatch(/min-height:\s*36px/);
      // 🔴 `position: relative` 是**承重宣告**,不是排版習慣(R2 F6,M10-a 實測):
      //    底線是絕對定位的 `::after`,少了這行它會改用最近的定位祖先為基準
      //    ⇒ 實測 `::after` 寬度由 56.56px 變成 **1440px**,一條橫貫整個視窗的線,
      //      而當時 41 條全綠。看起來「只是刪一行沒用的宣告」,畫面卻整個壞掉。
      expect(link, '少了 position: relative ⇒ 底線會以外層為基準、橫貫整個視窗').toMatch(
        /position:\s*relative/,
      );
      const after = topLevelCss().match(/\.ed-feature-jump a::after\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(after, '找不到底線 ::after').not.toBe('');
      // 🔴 底線色 = 控制項邊界線(3.18:1),不是一般分隔線 --ed-c-rule(#e4e4e7,約 1.3:1)。
      //    這條線是靜止態唯一的「可點」訊號,handoff §十一 指名要確認它。
      expect(after, '底線改用一般分隔線色 ⇒ 對白底約 1.3:1,可點訊號看不見').toMatch(
        /background:\s*var\(--ed-c-rule-control\)/,
      );
      // 🔴 **`content` 也要斷言**(R1 實測突變:改成 `content: none` 底線整條消失、現有守門全綠)。
      //    偽元素沒有 `content` 就根本不生成 ⇒ 上面那條「背景色對不對」問的是一個
      //    **不存在的東西**的顏色,恆綠。這是「量錯東西」那一族:顏色對 ≠ 線畫得出來。
      expect(after, '底線的 content 不是空字串 ⇒ 偽元素不生成、整條底線消失').toMatch(
        /content:\s*""/,
      );
      expect(after, '底線高度不見了').toMatch(/height:\s*1px/);
    });

    it('🔴 圖說桌機也要 right:auto + max-width(不只手機;R2 F10 抓到只搬了半邊)', () => {
      const cap = rule('.ed-feature-caption');
      expect(cap, '找不到 .ed-feature-caption 規則').not.toBe('');
      expect(cap, '桌機圖說少了 right:auto ⇒ 會被拉成左右釘住的橫幅').toMatch(/right:\s*auto/);
      expect(cap, '桌機圖說少了 max-width ⇒ OD §6-3 的規格被丟掉').toMatch(/max-width:\s*calc\(/);
    });

    it('🔴「全部商品」是領頭:墨黑底線 + 字重 600(與其餘分類有別)', () => {
      const isAll = rule('.ed-feature-jump a.is-all');
      expect(isAll, '找不到 is-all 規則').not.toBe('');
      expect(isAll, '領頭沒有加重字重').toMatch(/font-weight:\s*600/);
    });

    it('🔴 手機:主按鈕拉滿整行 48px、分類列 44px(行動觸控目標)', () => {
      const mobile = mediaBlock('(max-width: 640px)');
      expect(mobile, '找不到 640px 斷點').not.toBe('');
      expect(mobile, '手機主按鈕沒拉高到 48px').toMatch(/\.ed-feature-primary\s*\{[^}]*min-height:\s*48px/);
      expect(mobile, '手機分類列沒拉高到 44px').toMatch(/\.ed-feature-jump a\s*\{[^}]*min-height:\s*44px/);
      // 🔴 圖說的 `max-width` = OD §6-3「貼一角、不要橫跨整張圖」的規格。
      //    ⚠️ **誠實標註射程**(R2 F7):這條是**規格釘住**,不是行為守門 ——
      //    實測 390px 下把它拿掉,圖說寬度 200.75px → 200.75px、**零變化**,
      //    因為今天最長的 origin(samco「英國 · 南威爾斯 Pontyclun · 自 1990」= 28 字;
      //    我原本註解寫「最長約 19 字」是錯的)在這個字級下本來就撐不到上限。
      //    ⇒ 它擋的是「有人把 OD 這條規格順手刪掉」,不是「今天畫面會壞」。
      //      真的要讓它有行為判別力,得等 origin 變長或字級變大 —— 屆時它會自己開始生效。
      expect(mobile, '手機圖說少了 max-width ⇒ 長產地會把它撐成橫跨整張圖的帶子').toMatch(
        /\.ed-feature-caption\s*\{[^}]*max-width:\s*calc\(100% - 24px\)/,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 D5g 捲動進場。這一組守的是**「動畫壞掉時內容還看不看得見」**,不是好不好看。
  //    起始隱藏一律掛在 `.js-reveal` 底下 —— 少了那個前綴,五個區塊會在**所有**情況下
  //    永久 `opacity:0`(JS 沒跑到也一樣),而元件測試全綠、內容也還在 DOM 裡。
  // ══════════════════════════════════════════════════════════════════════════
  describe('🔴 D5g 捲動進場(起始隱藏必須掛在 .js-reveal 底下)', () => {
    it('🔴 隱藏規則一定帶 `.js-reveal` 前綴(裸選擇器 = JS 沒跑到就整頁空白)', () => {
      const css = topLevelCss();
      // 找出所有「把 data-reveal 或 N°05 兩欄設成 opacity:0」的規則,逐條檢查前綴。
      const hiding = [...css.matchAll(/([^{}]*)\{([^}]*opacity:\s*0[^}]*)\}/g)]
        .map((m) => m[1]!.trim().replace(/\s+/g, ' '))
        .filter((sel) => /data-reveal|ed-feature-side|ed-feature-media/.test(sel));
      expect(hiding.length, '找不到任何起始隱藏規則 ⇒ 下面的迴圈是空跑').toBeGreaterThanOrEqual(2);
      for (const sel of hiding) {
        expect(
          sel.includes('.js-reveal'),
          `「${sel}」沒有 .js-reveal 前綴 ⇒ JS 掛掉 / 不支援 IO / 開了減少動效時,`
            + '這些區塊會永久隱形,而所有測試照樣綠。',
        ).toBe(true);
      }
    });

    // 🔴 R1 找到的第九種假綠:給起始隱藏那兩個屬性加上 `!important`,
    //    `vitest` **34/34 全綠**,但真瀏覽器實測 `is-in` 加上了、`opacity` 仍卡在 0
    //    —— 因為 `.is-in` 那條沒有 `!important`,永遠贏不了同選擇器的 `!important`。
    //    ⇒ 五個區塊永久看不到內容。文字層守門對 cascade 勝負是盲的,這條把它釘住。
    it('🔴 起始隱藏規則不得帶 !important(reveal 那條沒有,帶了就永遠贏不回來)', () => {
      const hiding = [...topLevelCss().matchAll(/([^{}]*)\{([^}]*opacity:\s*0[^}]*)\}/g)]
        .filter((m) => /data-reveal|ed-feature-side|ed-feature-media/.test(m[1]!));
      expect(hiding.length, '找不到起始隱藏規則 ⇒ 這條是空跑').toBeGreaterThanOrEqual(2);
      for (const m of hiding) {
        expect(
          /!important/.test(m[2]!),
          `「${m[1]!.trim()}」的起始隱藏帶了 !important ⇒ .is-in 那條(無 !important)`
            + '永遠蓋不過去,區塊會永久看不見,而所有文字層守門照樣綠。',
        ).toBe(false);
      }
    });

    // 🔴 R2 F2:藏是全域、掀是逐個 ⇒ 晚到 DOM 的元素永久隱形。修法是 CSS 只藏「已上膛」的,
    //    這條把那個修法釘住 —— 拿掉屬性選擇器就退回全域藏光的舊行為。
    it('🔴 起始隱藏只作用於已上膛(data-reveal-armed)的元素,不是全域藏光', () => {
      const hiding = [...topLevelCss().matchAll(/([^{}]*)\{([^}]*opacity:\s*0[^}]*)\}/g)]
        .map((m) => m[1]!.trim().replace(/\s+/g, ' '))
        .filter((sel) => /data-reveal|ed-feature-side|ed-feature-media/.test(sel));
      expect(hiding.length, '找不到起始隱藏規則 ⇒ 這條是空跑').toBeGreaterThanOrEqual(2);
      for (const sel of hiding) {
        expect(
          sel.includes('[data-reveal-armed]'),
          `「${sel}」沒有限定已上膛的元素 ⇒ mount 之後才進 DOM 的區塊會被藏住,`
            + '而沒有人會來掀它(observer 只認 mount 當下的快照)= 永久 opacity:0。',
        ).toBe(true);
      }
    });

    it('🔴 幅度與時長是設計稿的值(34px / 0.7s;調小到看不見等於沒做)', () => {
      const css = topLevelCss();
      expect(css, '位移幅度不是 34px').toMatch(/\.js-reveal \[data-reveal\][^{]*\{[^}]*translateY\(34px\)/);
      expect(css, '進場時長不是 0.7s').toMatch(/\.js-reveal \[data-reveal\][^{]*\.is-in\s*\{[^}]*0\.7s/);
      // 曲線沿用本頁既有那條,不新增第二條。
      expect(css, '進場曲線不是設計稿那條').toMatch(/cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
    });

    it('🔴 N°05 照片比文字晚 140ms(兩欄分開進場,不是整塊一起淡入)', () => {
      const css = topLevelCss();
      expect(css, 'N°05 媒體欄少了 140ms 延遲 ⇒ 兩欄同時進場、錯開就沒意義了').toMatch(
        /\.js-reveal \.ed-feature[^{]*\.is-in \.ed-feature-media\s*\{[^}]*transition-delay:\s*0\.14s/,
      );
    });

    it('🔴 Hero 不掛進場(它在首屏,載入當下就該可讀)', () => {
      // `.ed-hero` 不得出現在任何起始隱藏規則裡。
      const hiding = [...topLevelCss().matchAll(/([^{}]*)\{([^}]*opacity:\s*0[^}]*)\}/g)]
        .map((m) => m[1]!.trim())
        .filter((sel) => sel.includes('.js-reveal'));
      // 🔴 前提斷言(R2 nit):`hiding` 為空時下面的迴圈是空跑、恆綠 ——
      //    而「把起始隱藏整組搬進某個 @media」正好會讓它變空(`topLevelCss()` 掃不到)。
      expect(hiding.length, '找不到任何起始隱藏規則 ⇒ 下面的迴圈是空跑').toBeGreaterThanOrEqual(2);
      for (const sel of hiding) {
        expect(sel.includes('ed-hero'), `Hero 被掛上進場了(${sel})⇒ 首屏延遲可讀`).toBe(false);
      }
    });

    it('🔴 減少動效那道雙保險還在(位移是生理不適,不是喜好)', () => {
      const reduce = mediaBlock('(prefers-reduced-motion: reduce)');
      expect(reduce, '找不到 prefers-reduced-motion 區塊').not.toBe('');
      expect(reduce, '減少動效沒有把起始隱藏解除').toMatch(/opacity:\s*1\s*!important/);
      expect(reduce, '減少動效沒有把位移歸零').toMatch(/transform:\s*none\s*!important/);
      expect(reduce, '減少動效那組沒有涵蓋 data-reveal').toMatch(/\[data-reveal\]/);
    });
  });

  // ── D7 頁尾(2026-08-05,由第0批 0b 執行;主視窗 `D-107-A` 裁 A 案「0b 吸收整個 D7」)──
  //
  // 這裡原本是一條**反向**片界守門:「頁尾仍是重排前的 `#0a0a0a`(回石墨是 D7 的事,D5a 不得順手改)」。
  // 它的意圖是「D7 不得被順手跳過自己的驗收」—— 現在 D7 是**帶著自己的驗收在執行**,意圖已滿足,
  // 故翻成正向。理由一併改掉、不留過期字面(`D-107-A` ②1 明文要求;
  // memory `feedback_claimed-sync-but-only-patched-touched-lines` 同族)。
  describe('D7 頁尾回深 + 殼寬(真權威:direction-b 定案稿 = pcm-shell.css,兩份值相同)', () => {
    it('🔴 頁尾底色 = 石墨 #202225(不是重排前的純黑 #0a0a0a)', () => {
      const rule = CSS.match(/\.ed-footer\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-footer 規則').not.toBe('');
      expect(rule, '頁尾底色不是石墨').toMatch(/background:\s*#202225/);
      // 反面:退回純黑就是 D7 被回滾了,而深底 logo 放純黑上「看起來只是深一點」、沒人會發現。
      expect(rule, '頁尾退回重排前的 #0a0a0a').not.toMatch(/#0a0a0a/);
    });

    it('🔴 留白 52 / 40 / 22(Sean 2026-08-03 看過拍板的三個值)', () => {
      const footer = CSS.match(/\.ed-footer\s*\{[^}]*\}/)?.[0] ?? '';
      expect(footer, '.ed-footer padding-top 不是 52px').toMatch(/padding:\s*52px 0 0/);
      const inner = CSS.match(/\.ed-footer-inner\s*\{[^}]*\}/)?.[0] ?? '';
      expect(inner, '.ed-footer-inner padding-bottom 不是 40px').toMatch(/padding-bottom:\s*40px/);
      const base = CSS.match(/\.ed-footer-base\s*\{[^}]*\}/)?.[0] ?? '';
      expect(base, '.ed-footer-base padding 不是 22px').toMatch(/padding:\s*22px/);
    });

    // 🔴 `D-107-A` ②3 指名要釘的那條。R2-1 的兩條 max-width 是靠「改 `.ed-footer` 上的
    //    `--ed-max` 一行、兩條同時到位」達成的 —— 那個省事寫法的**前提**是兩條都真的還在吃
    //    `var(--ed-max)`。哪天有人把其中一條改成寫死值(或改吃別顆),`--ed-max` 那行看起來
    //    還是對的、`.ed-footer` 的斷言照樣綠,而那一條實際上已經脫鉤。前提要自己被釘住。
    it('🔴 --ed-max 指向殼寬,且 inner 與 base 兩條都真的吃得到它(一行帶兩條的前提)', () => {
      const footer = CSS.match(/\.ed-footer\s*\{[^}]*\}/)?.[0] ?? '';
      expect(footer, '--ed-max 沒指向 --shell-bar-max ⇒ 頁尾沒收 1440')
        .toMatch(/--ed-max:\s*var\(--shell-bar-max\)/);
      for (const sel of ['.ed-footer-inner', '.ed-footer-base']) {
        const rule = CSS.match(new RegExp(`\\${sel}\\s*\\{[^}]*\\}`))?.[0] ?? '';
        expect(rule, `找不到 ${sel} 規則`).not.toBe('');
        expect(rule, `${sel} 沒吃 var(--ed-max) ⇒ 它與 --ed-max 那一行已脫鉤`)
          .toMatch(/max-width:\s*var\(--ed-max\)/);
      }
    });

    it('🔴 頁尾 logo 是 56px 的圖檔,且 .ed-footer-logo 不再帶文字字級', () => {
      const wrap = CSS.match(/\.ed-footer-logo\s*\{[^}]*\}/)?.[0] ?? '';
      expect(wrap, '找不到 .ed-footer-logo 規則').not.toBe('');
      expect(wrap, '.ed-footer-logo 仍帶 font-size ⇒ logo 退回文字了').not.toMatch(/font-size/);
      const img = CSS.match(/\.ed-footer-logo img\s*\{[^}]*\}/)?.[0] ?? '';
      expect(img, '找不到 .ed-footer-logo img 規則').not.toBe('');
      expect(img, '頁尾 logo 高不是 56px').toMatch(/height:\s*56px/);
      expect(img, '頁尾 logo 寬不是 auto ⇒ 比例會被拉歪').toMatch(/width:\s*auto/);
    });

    // §4-4:1079 以下原本只有 `@media (max-width: 900px)` 那段、而它不調字級 ⇒ iPad 吃桌機值。
    it('🔴 頁尾平板段(600-1079px)存在且把字級放大', () => {
      const t = mediaBlock('(min-width: 600px) and (max-width: 1079px)');
      expect(t, '找不到頁尾平板段').not.toBe('');
      // 🔴 值要綁在**自己的選擇器**上。只斷言「區塊裡有 15px、有 14px」的話,
      //    兩組值對調(tagline 變 14、social 變 15)照樣全綠 —— 那是「量錯東西」的典型形狀。
      const rule = (sel: string) => t.match(new RegExp(`[^{}]*\\${sel}[^{}]*\\{[^}]*\\}`))?.[0] ?? '';
      const links = rule('.ed-footer-tagline');
      expect(links, '平板段沒涵蓋 .ed-footer-tagline').not.toBe('');
      expect(links, 'tagline / 連結那組字級不是 15px').toMatch(/font-size:\s*15px/);
      expect(links, '平板段那組沒同時涵蓋頁尾連結').toMatch(/\.ed-footer-cols a/);
      const social = rule('.ed-footer-social');
      expect(social, '平板段沒涵蓋 .ed-footer-social').not.toBe('');
      expect(social, 'social 字級不是 14px').toMatch(/font-size:\s*14px/);
    });

    // 設計端 §4-3「字級只用整數 px」。守門面畫在**整個頁尾家族**、不是只有我改到的那一行
    //(只釘手碰過的行 = 下一顆半像素進來時零阻力)。
    // ⚠️ 刻意**不**擴到整支 `home.css`:實查另有兩處半像素 `.ed-link-sm`(`home.css:62`)與
    //    `.ed-finder-hint`(`:228`),它們是首頁本體的元件、不屬「殼」⇒ 不在 R2-3 授權範圍
    //    (派工單:首頁是已定案上線的自包含稿,本輪只動殼與兩處文案)。這是**明說的縮範圍**,
    //    不是漏掉;要一起收要另外一片。
    it('🔴 頁尾家族沒有任何半像素字級,且連結是整數 14px(設計端 §4-3)', () => {
      const footerRules = CSS.match(/[^{}]*\.ed-footer[^{}]*\{[^}]*\}/g) ?? [];
      // 門檻取實測值 19 的下限 18:寫 8 的話刪掉 11 條頁尾規則仍不紅 —— 那只證明「迴圈非空」,
      // 不證明「掃過整族」。前提本身也要有判別力。
      expect(footerRules.length, '頁尾規則數掉到 18 以下 ⇒ 有一整批規則被刪了,這個迴圈已掃不到它們')
        .toBeGreaterThanOrEqual(18);
      for (const r of footerRules) {
        expect(r, `頁尾家族出現半像素字級:${r.slice(0, 60)}`).not.toMatch(/font-size:\s*\d+\.\d+px/);
      }
      const links = CSS.match(/\.ed-footer-cols a,[\s\S]*?\}/)?.[0] ?? '';
      expect(links, '找不到 .ed-footer-cols 連結規則').not.toBe('');
      expect(links, '頁尾連結字級不是 14px').toMatch(/font-size:\s*14px/);
    });
  });

  // ══ D-136 清尾片(2026-08-06):深對照報告點名的兩條 CSS 漏搬 ══
  describe('D-136 清尾片', () => {
    // 🔴 三顆服務 icon 的描邊規格。與 `.b-cat-icon svg` 是同一族的同一個坑:
    //    本 repo 沒有 OD 那條全域 `svg{}`,規格漏一項就退回瀏覽器預設 ——
    //    fill 退成黑色實心(徽章變一坨黑塊)、端點/轉角退成方頭 miter(緞帶尖角、扳手開口變方的)。
    //    N°03 的 R1 實錘:真瀏覽器只量了 fill 與線寬、沒量端點兩項 = 量錯東西。
    it('🔴 `.b-stat-icon` 34×34 描邊圓框,svg 五項描邊規格一項不缺', () => {
      const box = topLevelCss().replace(/\s+/g, ' ').match(/\.b-stat-icon\s*\{[^}]*\}/)?.[0] ?? '';
      expect(box, '找不到 .b-stat-icon 規則 ⇒ 三顆 icon 沒有框、貼著文字浮著').not.toBe('');
      expect(box, '尺寸不是 OD 的 34px').toMatch(/width:\s*34px/);
      expect(box, '尺寸不是 OD 的 34px').toMatch(/height:\s*34px/);
      // 深底上的框線與 icon 色都是低透明度白;掉了框線 = 圓框消失,掉了 color = icon 用繼承的純白、過亮
      expect(box, '沒有框線 ⇒ 圓框整個不見(icon 直接浮在黑底上)').toMatch(/border:\s*1px solid rgba\(255,255,255,0?\.22\)/);
      expect(box, 'icon 色不是 OD 的 rgba(255,255,255,.9)').toMatch(/color:\s*rgba\(255,255,255,0?\.9\)/);

      const svg = topLevelCss().replace(/\s+/g, ' ').match(/\.b-stat-icon svg\s*\{[^}]*\}/)?.[0] ?? '';
      expect(svg, '找不到 .b-stat-icon svg 規則 ⇒ 五項規格全退回瀏覽器預設').not.toBe('');
      expect(svg, 'svg 尺寸不是 OD 的 18px').toMatch(/width:\s*18px/);
      expect(svg, '沒有 fill:none ⇒ 線圖會變成實心黑塊').toMatch(/fill:\s*none/);
      expect(svg, '沒有 stroke:currentColor ⇒ 線條不跟著 .b-stat-icon 的色走').toMatch(/stroke:\s*currentColor/);
      expect(svg, '線寬不是 OD 對小尺寸 icon 的補重值 1.75').toMatch(/stroke-width:\s*1\.75/);
      expect(svg, '端點沒有圓頭 ⇒ 徽章緞帶與扳手開口的尖角變方頭').toMatch(/stroke-linecap:\s*round/);
      expect(svg, '轉角沒有圓角 ⇒ 同上').toMatch(/stroke-linejoin:\s*round/);
    });

    // 🔴 選車器格子的鍵盤焦點框(OD 明文的 WCAG 1.4.11 修正)。
    //    ⚠️ 它擋不住什麼:文字層只證「規則在、形狀對」,證不了 cascade 真的贏
    //    ——「格子裡的 input 自帶 outline:none 又蓋回去」這種只有真瀏覽器 Tab 一輪才看得到。
    it('🔴 `.ed-finder-slot:focus-within` 焦點框存在、有顏色、且 offset 是負的', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-finder-slot:focus-within\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到焦點框規則 ⇒ 鍵盤使用者選車時看不出焦點在哪一格').not.toBe('');
      // 「有 outline 宣告」不夠:`outline: none` 也是一條 outline 宣告,而那正是要防的那件事
      expect(rule, 'outline 被寫成 none / 0 ⇒ 等於沒修').not.toMatch(/outline:\s*(none|0)\b/);
      expect(rule, '焦點框不是 2px 實線').toMatch(/outline:\s*2px solid/);
      // 🔴 顏色也要釘:退成站台預設的近黑 `--c-text` 的話,框仍然「存在」但在白格線上幾乎看不見
      //    (`brand-page.css` 那組焦點框事故就是「畫出來了但看不見」)。
      //    ⚠️ 已知語意耦合(R1 nit):實作借用了 hover 那顆 `--ed-c-action-hover` 當焦點色
      //       —— 兩者在 OD 同值(`--c-ember-ink` #c4470c),但日後只改 hover 會讓焦點框跟著位移。
      //       token 的**值**另有守門(本檔「熔橘三顆」那條),此處只釘「焦點框吃的是熔橘那族、不是墨黑」。
      expect(rule, '焦點框沒吃熔橘動作色 ⇒ 退回近黑預設、壓在格線上看不出來')
        .toMatch(/outline:\s*2px solid var\(--ed-c-action(-hover)?\)/);
      // 🔴 負 offset 是必要的、不是品味:三格是共邊框線的格線,正 offset 會把框畫到隔壁格的線上
      const offset = rule.match(/outline-offset:\s*(-?\d+)px/)?.[1];
      expect(offset, '沒有寫 outline-offset ⇒ 吃站台預設的正 offset,框會壓到隔壁格').toBeDefined();
      expect(Number(offset), `outline-offset 是 ${offset}px(不是負值)⇒ 框畫在格線外`).toBeLessThan(0);
    });
  });

  describe('🔴 N°04 版面壓縮片:N°04 服務版面壓縮(OD `:438-464` 逐字)', () => {
    it('`.ed-statement` padding 是砍半後的 56px 0 60px,不是舊的 140px 0', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-statement\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-statement 規則').not.toBe('');
      expect(rule, 'padding 還是舊的 140px 0 ⇒ 壓縮沒生效').toMatch(/padding:\s*56px 0 60px/);
      expect(rule, 'padding 不該再出現舊值 140px').not.toMatch(/140px/);
    });

    it('`.b-statement-top` 存在且是 flex(標題與 CTA 併同一列)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.b-statement-top\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .b-statement-top ⇒ 標題與 CTA 還在各自佔一整段').not.toBe('');
      expect(rule, '不是 flex ⇒ 併不成同一列').toMatch(/display:\s*flex/);
    });

    it('`.b-statement-col-head` 存在且是 baseline 對齊的 flex(編號與 h3 併同一行)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.b-statement-col-head\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .b-statement-col-head ⇒ 編號還是獨佔一行').not.toBe('');
      expect(rule, '沒有 display:flex ⇒ 就算有 align-items:baseline 也不會生效,編號與 h3 各佔一行(本片要修的缺陷本身)').toMatch(/display:\s*flex/);
      expect(rule, '沒有 align-items:baseline ⇒ 編號與標題文字基線對不齊').toMatch(/align-items:\s*baseline/);
    });

    it('`.ed-statement-grid` 沒有 border-bottom(OD 只留 border-top)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-statement-grid\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-statement-grid 規則').not.toBe('');
      expect(rule, 'border-bottom 沒刪乾淨 ⇒ 三欄下面多一條不該有的線').not.toMatch(/border-bottom/);
      expect(rule, 'border-top 不見了 ⇒ OD 這條要留著').toMatch(/border-top:\s*1px solid/);
    });

    it('單欄斷點在 700、不在 900(平板 768 仍撐三欄)', () => {
      const at900 = mediaBlock('(max-width: 900px)').replace(/\s+/g, ' ');
      const at700 = mediaBlock('(max-width: 700px)').replace(/\s+/g, ' ');
      // 前提斷言(R1 nit):把 `@media (max-width: 900px) {` 手改成 `@media (max-width:900px) {`
      // (合法 CSS、只是少一個空格)會讓 mediaBlock() 的字面比對落空、回傳空字串,下面的負向
      // 斷言就會恆真通過。先證明真的抓到了 900 區塊。
      expect(at900, '900 斷點抓到空字串 ⇒ mediaBlock() 沒抓到區塊,下面的負向斷言恆真').toContain('.ed-statement');
      // 逐條掃(R1 nit):原本只取第一個 .ed-statement-grid,日後在 900 區塊較後面新增一條
      // 壓單欄的規則會被漏檢。改用 matchAll 逐條斷言。
      const gridIn900 = [...at900.matchAll(/\.ed-statement-grid\s*\{[^}]*\}/g)].map((m) => m[0]);
      const gridIn700 = [...at700.matchAll(/\.ed-statement-grid\s*\{[^}]*\}/g)].map((m) => m[0]);
      expect(gridIn900.length, '900 斷點裡找不到任何 .ed-statement-grid 規則 ⇒ 下面迴圈是空迴圈,負向斷言恆真').toBeGreaterThan(0);
      expect(gridIn700.length, '700 斷點裡找不到任何 .ed-statement-grid 規則').toBeGreaterThan(0);
      for (const rule of gridIn900) {
        expect(rule, '900 斷點裡 .ed-statement-grid 不該壓成單欄 ⇒ 平板還撐得住三欄')
          .not.toMatch(/grid-template-columns:\s*1fr\s*;/);
      }
      for (const rule of gridIn700) {
        expect(rule, '700 斷點裡找不到單欄 ⇒ 手機沒有壓成單欄')
          .toMatch(/grid-template-columns:\s*1fr\s*;/);
      }
    });

    it('🔴 `.ed-statement-h em` 照 OD 補齊字體(2026-08-06:token 升 :root 片)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-statement-h em\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-statement-h em 規則').not.toBe('');
      expect(rule, '沒有 font-family: var(--f-serif) ⇒ 沒吃到升上 :root 的字體 token').toMatch(/font-family:\s*var\(--f-serif\)/);
      expect(rule, '沒有 font-style: italic').toMatch(/font-style:\s*italic/);
      expect(rule, 'color 還是舊值 0.62,OD 字面是 0.64').toMatch(/color:\s*rgba\(255,\s*255,\s*255,\s*0\.64\)/);
      expect(rule, '還留著舊值 0.62').not.toMatch(/0\.62/);
    });

    it('🔴 `.ed-statement` background 吃 var(--c-graphite) 且帶 fallback', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-statement\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-statement 規則').not.toBe('');
      const bg = rule.match(/background:\s*([^;]+);/)?.[1] ?? '';
      expect(bg, 'background 沒有吃 var(--c-graphite)').toMatch(/^var\(--c-graphite/);
      // 🔴 R1 nit:只驗 toContain(',') 的話 var(--c-graphite, #000) 照樣綠(fallback 值錯也放行)。
      // 釘死字面值 #202225(石墨,本檔既有慣例)。
      expect(bg, 'fallback 不是 #202225 ⇒ token 讀不到時會退回錯的顏色').toMatch(/^var\(--c-graphite,\s*#202225\)$/);
    });

    it('🔴 `.ed-page em` 照升級後的 token 走(不是硬寫的字面值,2026-08-06 token 升 :root 片)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-page em\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-page em 規則').not.toBe('');
      expect(rule, '沒有 font-family: var(--f-serif) ⇒ 沒吃到升上 :root 的字體 token').toMatch(/font-family:\s*var\(--f-serif\)/);
      expect(rule, '還留著硬寫的字面值 ⇒ --f-serif 這顆值的第三份拷貝又漂走了').not.toMatch(/"Noto Serif TC"/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 N°05 本月聚焦版面壓縮片(2026-08-06;OD 逐字段落標題 `963px 砍半`)。
  //    本組只釘「版面/尺寸」類的值(padding/grid/字級/meta 條/圖片比例)。
  //    中文排版六值(標題 line-height/letter-spacing、內文 line-height/max-width)
  //    是 manifest 記過的「D5e-2b 刻意未搬」組,本片刻意不動 ⇒ 反過來釘住舊值,
  //    擋的是「有人在做版面壓縮時順手把那組也一起改了」。
  //    ⚠️ 解除條件:下面 `.ed-feature-title` / `.ed-feature-body` 兩條測試裡釘
  //    line-height / letter-spacing / max-width 舊值那四條斷言,釘的是「緩辦中」
  //    的狀態、不是拍板要永久維持——排到中文排版片(OD `N05-FOCUS-HANDOFF.md` §6-1)
  //    時要跟著一起改成新值,那時看到這四條轉紅是正常訊號,不是要回退改動。
  // ══════════════════════════════════════════════════════════════════════════
  describe('🔴 N°05 本月聚焦版面壓縮片:963px 砍半(OD 逐字段落標題 `963px 砍半`)', () => {
    it('`.ed-feature` padding 是砍半後的 52px 0 56px,不是舊的 140px 0;OD 逐字第三條 border-top 也要在', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-feature 規則').not.toBe('');
      expect(rule, 'padding 還是舊的直式長文版 140px 0 ⇒ 壓縮沒生效').toMatch(/padding:\s*52px 0 56px/);
      expect(rule, 'padding 不該再出現舊值 140px').not.toMatch(/140px/);
      expect(rule, '缺少 OD `.b-feature` 逐字第三條 border-top ⇒ N°05 上緣少一條區塊分隔線').toMatch(/border-top:\s*1px solid var\(--ed-c-rule\)/);
    });

    it('`.ed-feature-inner` gap 壓成 48px(不是舊的 80px),欄比例維持 OD 統一版面層的 5fr 7fr', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-inner\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-feature-inner 規則').not.toBe('');
      expect(rule, 'gap 還是舊值 80px').toMatch(/gap:\s*48px/);
      expect(rule, 'gap 不該再出現舊值 80px').not.toMatch(/80px/);
      expect(rule, '欄比例不是 OD 統一版面層生效值 5fr 7fr').toMatch(/grid-template-columns:\s*5fr 7fr/);
    });

    it('`.ed-feature-media` aspect-ratio 是 16/11(不是砍半前的 7/8)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-media\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-feature-media 規則').not.toBe('');
      expect(rule, 'aspect-ratio 不是 16/11 ⇒ 圖還是直式,沒壓成橫向').toMatch(/aspect-ratio:\s*16\s*\/\s*11/);
      expect(rule, 'aspect-ratio 不該再出現舊值 7/8').not.toMatch(/7\s*\/\s*8/);
    });

    it('`.ed-feature-num` / `.ed-feature-kicker` margin-bottom 砍成 12px(不是舊的 18px/22px)', () => {
      const num = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-num\s*\{[^}]*\}/)?.[0] ?? '';
      expect(num, '找不到 .ed-feature-num 規則').not.toBe('');
      expect(num, 'margin-bottom 還是舊值 18px ⇒ 壓縮沒生效').toMatch(/margin-bottom:\s*12px/);
      const kicker = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-kicker\s*\{[^}]*\}/)?.[0] ?? '';
      expect(kicker, '找不到 .ed-feature-kicker 規則').not.toBe('');
      expect(kicker, 'margin-bottom 還是舊值 22px ⇒ 壓縮沒生效').toMatch(/margin-bottom:\s*12px/);
    });

    it('`.ed-feature-title` 字級與留白砍半(clamp(30px,3.2vw,46px) / margin 0 0 18px),中文排版值刻意維持舊值', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-title\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-feature-title 規則').not.toBe('');
      expect(rule, 'font-size 還是舊的巨大字級 clamp(48px,5.4vw,80px)').toMatch(/font-size:\s*clamp\(30px,\s*3\.2vw,\s*46px\)/);
      expect(rule, 'margin 還是舊值 0 0 32px').toMatch(/margin:\s*0 0 18px/);
      // 🔴 這兩顆刻意不搬(manifest `last_modified_date` 敘述 + `home.css` 🔴🔴 開頭
      //    那段申報記的「D5e-2b 刻意未搬」中文排版組,非 technical_overrides 那組欄位)——
      //    有人在做版面壓縮時順手把它們也改掉,等於沒經過 Sean 肉眼驗就動了視覺重量。
      expect(rule, 'line-height 被順手改動 ⇒ 中文排版值屬待審範圍,不該在本片被動').toMatch(/line-height:\s*0\.98/);
      expect(rule, 'letter-spacing 被順手改動 ⇒ 同上').toMatch(/letter-spacing:\s*-0\.02em/);
    });

    it('`.ed-feature-body` 字級與留白砍半(font-size 15px / margin 0 0 24px),中文排版值刻意維持舊值', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-body\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-feature-body 規則').not.toBe('');
      expect(rule, 'font-size 還是舊值 16px').toMatch(/font-size:\s*15px/);
      expect(rule, 'margin 還是舊值 0 0 40px').toMatch(/margin:\s*0 0 24px/);
      expect(rule, 'line-height 被順手改動 ⇒ 中文排版值屬待審範圍,不該在本片被動').toMatch(/line-height:\s*1\.75/);
      expect(rule, 'max-width 被順手改動 ⇒ 同上').toMatch(/max-width:\s*34ch/);
    });

    it('`.ed-feature-meta` 從留白較寬的三欄條壓成單行資料條(gap 0 26px / padding 16px 0 / margin-bottom 18px)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-meta\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-feature-meta 規則').not.toBe('');
      expect(rule, 'gap 沒有壓成單行資料條的 0 26px').toMatch(/gap:\s*0 26px/);
      expect(rule, 'padding 還是舊值 24px 0').toMatch(/padding:\s*16px 0/);
      expect(rule, 'margin-bottom 還是舊值 36px').toMatch(/margin-bottom:\s*18px/);
    });

    it('`.ed-feature-meta-v` 字級提到 15px / 600 / line-height 1.3(OD 逐字)', () => {
      const rule = topLevelCss().replace(/\s+/g, ' ').match(/\.ed-feature-meta-v\s*\{[^}]*\}/)?.[0] ?? '';
      expect(rule, '找不到 .ed-feature-meta-v 規則').not.toBe('');
      expect(rule, 'font-size 還是舊值 14px').toMatch(/font-size:\s*15px/);
      expect(rule, 'font-weight 還是舊值 500').toMatch(/font-weight:\s*600/);
      expect(rule, '沒有補 line-height:1.3').toMatch(/line-height:\s*1\.3/);
    });

    it('1000px 斷點跟著壓(padding 40px 0 44px / gap 28px / meta 補單欄 / 圖比例 16/10)', () => {
      const at1000 = mediaBlock('(max-width: 1000px)').replace(/\s+/g, ' ');
      expect(at1000, '1000 斷點抓到空字串 ⇒ mediaBlock() 沒抓到區塊,下面斷言恆真').toContain('.ed-feature');
      const feature = at1000.match(/\.ed-feature\s*\{[^}]*\}/)?.[0] ?? '';
      expect(feature, '1000 斷點找不到 .ed-feature 規則').not.toBe('');
      expect(feature, 'padding 還是舊值 80px 0').toMatch(/padding:\s*40px 0 44px/);
      const inner = at1000.match(/\.ed-feature-inner\s*\{[^}]*\}/)?.[0] ?? '';
      expect(inner, '1000 斷點找不到 .ed-feature-inner 規則').not.toBe('');
      expect(inner, 'gap 還是舊值 40px').toMatch(/gap:\s*28px/);
      const meta = at1000.match(/\.ed-feature-meta\s*\{[^}]*\}/)?.[0] ?? '';
      expect(meta, '1000 斷點缺少 .ed-feature-meta 單欄覆寫 ⇒ 手機/平板資料條還是三欄擠成一團').not.toBe('');
      expect(meta, '沒有壓成單欄').toMatch(/grid-template-columns:\s*1fr/);
      expect(meta, 'gap 沒有補 16px').toMatch(/gap:\s*16px/);
      const media = at1000.match(/\.ed-feature-media\s*\{[^}]*\}/)?.[0] ?? '';
      expect(media, '1000 斷點找不到 .ed-feature-media 規則').not.toBe('');
      expect(media, 'aspect-ratio 不是 16/10').toMatch(/aspect-ratio:\s*16\/10/);
    });
  });
});
