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

describe('首頁 CSS · 品牌清單(D3c-2 兩型別列)', () => {
  it('🔴 註解符號成對(未閉合的 /* 會讓瀏覽器吞掉後半個檔,而剝註解的守門照樣全綠)', () => {
    const open = RAW.match(/\/\*/g)?.length ?? 0;
    const close = RAW.match(/\*\//g)?.length ?? 0;
    expect(open, `/* 有 ${open} 個、*/ 有 ${close} 個 — 註解沒閉合`).toBe(close);
    expect(open).toBeGreaterThan(0);
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
    expect(CASCADE, 'nowrap 被寫成 .cat-garage-chip 全域基礎規則會撐爆手機面板的 2 欄格子')
      .not.toMatch(/^\.cat-garage-chip\s*\{[^}]*white-space\s*:\s*nowrap/m);
  });

  it('🔴 舊的 .ed-finder-garage* / .ed-finder-suggest* 家族已全數退場(不得兩套並存)', () => {
    // 留著=下一個人不知道該改哪一套,且首頁會有兩份互相打架的 chip 樣式
    expect(CSS).not.toMatch(/\.ed-finder-garage/);
    expect(CSS).not.toMatch(/\.ed-finder-suggest/);
  });
});
