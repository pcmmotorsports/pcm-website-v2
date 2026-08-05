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

describe('首頁 CSS · 品牌清單(D3c-2 兩型別列)', () => {
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
  //    ① 退回只寫 `a` ⇒ 泛白那幾列整個沒有 grid(五格擠成一行)。
  //    ② 寫成**後代**選擇器 `.ed-brand-list :is(a, span)` ⇒ 列內每一個 `<span>`
  //       (編號/名稱/標語/國別)也被套上 `display:grid` + 26px padding,整排爆掉。
  //       ②是本片第一版真的寫錯的形狀,不是假想。
  it('🔴 品牌清單的版面規則吃 `<a>` 與 `<span>` 兩種,而且是**子**選擇器', () => {
    const layout = [
      ...CSS.matchAll(/([^{}]*\.ed-brand-list[^{}]*)\{([^}]*grid-template-columns[^}]*)\}/g),
      // 🔴 正規化空白再比(關卡2 R1 nit):逐字比 `:is(a, span)` 的話,把 CSS 排版成
      //    `:is(a,span)` 會轉紅 —— 行為零變化的假紅會訓練人忽略這條守門。
    ].map((m) => m[1]!.trim().replace(/\s+/g, ' ').replace(/,\s*/g, ', '));
    expect(layout.length, '找不到 .ed-brand-list 的欄寬規則').toBe(2); // 基礎 + ≤900
    for (const selector of layout) {
      expect(
        selector,
        `${selector} 不是 \`> li > :is(a, span)\` ⇒ 泛白列沒有 grid、或列內 span 被誤套`,
      ).toBe('.ed-brand-list > li > :is(a, span)');
    }
  });

  it('🔴 兩條裡有一條在 `@media (max-width: 900px)` 內(手機欄寬 jsdom 完全看不到)', () => {
    // 🔴 與上一條同樣要**正規化空白再比**(關卡2 R2 nit:R1 那次只補進上一條,
    //    這條還留著含空白的逐字比對 ⇒ 把 ≤900 那條排版成 `:is(a,span)` 會誤紅)。
    const narrow = mediaBlock('(max-width: 900px)').replace(/\s+/g, ' ').replace(/,\s*/g, ', ');
    expect(narrow.length, '找不到 ≤900 區塊').toBeGreaterThan(0);
    expect(narrow, '≤900 區塊裡的品牌清單規則不是兩型別子選擇器').toContain(
      '.ed-brand-list > li > :is(a, span)',
    );
    // 宣告這一半用 `\s*`(正規化只收斂了空白數量,沒有替我補上冒號後的空格)。
    expect(narrow).toMatch(/grid-template-columns:\s*36px/);
  });

  // 🔴 泛白那一半原本零守門:整段刪掉,元件測試(語意層)仍全綠、列看起來與可點列一模一樣,
  //    但語意上不可點 = 對客人最糟的組合(同 brand-page.css `.is-empty` 那條的理由)。
  it('🔴 `.is-empty` 的泛白規則都在,且形狀是「同前綴 + 多一個 class」(嚴格更高、不靠順序)', () => {
    const rules = [...CSS.matchAll(/([^{}]*\.is-empty[^{}]*)\{([^}]*)\}/g)]
      .map((m) => ({ selector: m[1]!.trim(), body: m[2]! }))
      .filter((r) => r.selector.includes('.ed-brand-list'));
    expect(rules.length, '.ed-brand-list 的 .is-empty 規則不見了').toBe(3);
    for (const r of rules) {
      // 每一段(逗號清單要逐段看,不能只看第一段 —— 關卡2 R1 nit:第二段被改成裸
      // `.is-empty .ed-brand-country` 這種會跨檔洩漏的形狀時,只檢查第一段仍全綠)
      // 都必須以 `.ed-brand-list .is-empty` 起頭 —— 這個形狀嚴格包含競爭者
      // (`.ed-brand-name` 等 (0,1,0)),所以勝負與規則順序無關,不會像 D3c-1 那樣反轉。
      for (const part of r.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '))) {
        expect(part.startsWith('.ed-brand-list .is-empty'), `${part} 前綴不對`).toBe(true);
      }
    }
    const body = rules.map((r) => r.body).join(' ');
    expect(body, '游標沒有改掉').toMatch(/cursor\s*:\s*default/);
    expect(body, '品牌名沒有轉淡').toMatch(/color\s*:\s*var\(--ed-c-ink-mute\)/);
    // 🔴 標語與國別那條原本零斷言(關卡2 R1 nit:把 `.6` 改成 `1` ⇒ 兩格不再轉淡、
    //    而 11 條新守門全綠)。這是本支唯一「拿掉之後真缺陷會靜默通過」的洞。
    expect(body, '標語 / 國別沒有轉淡').toMatch(/opacity\s*:\s*\.6/);
  });

  // 🔴 收**全部**碰到 `.ed-sr-only` 的規則、不是 `match()` 拿第一條(關卡2 R1 nit;
  //    姊妹檔 `brand-page.test.ts` 逐字記過同一個坑):日後補一條更具體的覆寫
  //    (例如 `.ed-brand-list .ed-sr-only { position: static }`)會把那句只給報讀器的話
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
    // 🔴 scope 是承重的:home.css 由 layout.tsx **全域** import,少了 `.ed-finder ` 前綴,
    //    A10b/A10c 把 inline 掛上 PDP §7 與購物車之後,這段捲動與 gutter 出血會潑到那兩處去。
    for (const sel of ['.cat-garage-chips', '.cat-garage-chip']) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(narrow, `${sel} 的規則沒有鎖在 .ed-finder 底下`)
        .toMatch(new RegExp(`\\.ed-finder\\s+\\.cat-garage--inline\\s+${esc}`));
    }
    // R2 追加(scope 收緊):**@media 外**那條外距規則同樣承重 —— 少了 `.ed-finder` 前綴,
    // PDP §7(自己已有 .pfc-picker 的 10px)與購物車(.cvf-edit 的 gap:10px)會被多疊一層 12px。
    // 上面的迴圈只掃 ≤900px 區塊、掃不到它。
    expect(CSS, '行內密度的外距規則沒有鎖在 .ed-finder 底下 ⇒ 會潑到 PDP 與購物車')
      .toMatch(/\.ed-finder\s+\.cat-garage--inline\s*\{[^}]*margin-bottom/);
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
    expect(rule, '服務宣言不是石墨 #202225').toMatch(/background:\s*#202225/);
    expect(rule, '還留著重排前的純黑').not.toMatch(/background:\s*#0a0a0a/);
  });

  it('🔴 N°06 授權代理 = 淺灰白 --ed-c-paper-2(不是純白)', () => {
    const rule = CSS.match(/\.ed-brands\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 .ed-brands 規則').not.toBe('');
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

  // 🔴 頁尾**還不能**動:回石墨屬 D7(母計畫 §1 切片表)。
  //    這條擋的是「順手把三塊深色一起改掉」——那會讓 D7 變成沒東西可做、而且跳過 D7 自己的驗收。
  it('🔴 頁尾仍是重排前的 #0a0a0a(回石墨是 D7 的事,D5a 不得順手改)', () => {
    const rule = CSS.match(/\.ed-footer\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule, '找不到 .ed-footer 規則').not.toBe('');
    expect(rule, '頁尾被提前改成石墨了 ⇒ 跨了 D5a/D7 的片界').toMatch(/background:\s*#0a0a0a/);
  });
});
