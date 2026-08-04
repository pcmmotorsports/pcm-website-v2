import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 🔴 註解會污染 anchor 切片(checkout.test.ts 實際踩過):先剝掉所有 /* */ 再比對。
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const CASCADE = strip(readFileSync(new URL('./filter-cascade.css', import.meta.url), 'utf8'));
const RESPONSIVE = strip(readFileSync(new URL('./filter-responsive.css', import.meta.url), 'utf8'));
const MOBILE = strip(readFileSync(new URL('./products-mobile.css', import.meta.url), 'utf8'));

/**
 * 取某個 @media 區塊的內文 —— 以**大括號配對**切到它自己的結尾。
 *
 * 🔴 這裡踩過一次真的假綠(本片突變 M5 抓到):原本寫「切到下一個 @media 為止」,
 * 而 filter-cascade.css 有兩個 `@media (max-width: 1023px)`,中間夾著一行**不在 media
 * 內**的 `[data-mobile="true"] .cft-bar { display: none; }`。於是把 media 內的
 * `.cft-bar{display:none}` 整條刪掉後,斷言仍命中那行區塊外的規則 ⇒ 守門全綠、
 * 真手機上桌機三欄直接漏出來。切片邊界本身就是斷言的一部分。
 */
function mediaBlock(css: string, header: string): string {
  const start = css.indexOf(header);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════
// ADR-0007 的硬邊界之一(交接檔 Slice B 逐字):
//   「不得讓桌機 markup/CSS 在手機寬度形成三個被壓縮的橫向輸入框」
//
// 這條在 jsdom 測不到(jsdom 不套 media query、不算 cascade),而它回歸時不會壞任何測試
// —— 只會在真手機上長出三個 12px 的擠壓輸入框。
// 機制刻意只有一條:整個 `.cft-bar` 在手機關掉(不另立第二個 modifier 鉤子 —— 兩套關法
// 會讓審查時分不出哪條是現行)。markup 側由 CascadeFilterTop.test.tsx 鎖「三欄全在
// .cft-bar 內」、ProductsPage.test.tsx 鎖「手機入口不在 .cft-bar 內」,兩頭夾住。
// 🔴 兩條路徑都要守:`@media` 管真手機,`[data-mobile="true"]` 管 dev-preview 強制手機殼
// (後者不在 media query 內、桌機寬度也會生效;只守 media 會漏掉整個預覽環境)。
// ═══════════════════════════════════════════════════════════════
// 手機/桌機的交界只能有一個數字。ADR-0007 的驗收項逐字要求「1024×768 = 手機/平板版、
// 1025×768 = 桌機」⇒ MOBILE_MAX = 1024。
// 🔴 為何連數字本身都鎖:本片開工前,同一件事(手機關掉桌機選車列)在 filter-cascade.css
//    寫 1023、在 filter-responsive.css 寫 1079 —— 差 56px 的那一段由後者獨佔生效,
//    兩檔各自看起來都對。只鎖「有沒有這條規則」抓不到這種漂移,必須鎖「兩檔用同一個斷點」。
const MOBILE_MAX = '@media (max-width: 1024px)';

describe('手機不得出現被壓縮的桌機三欄選車列(ADR-0007)', () => {
  it(`filter-cascade.css:${MOBILE_MAX} 關掉整條桌機選車列`, () => {
    const mobile = mediaBlock(CASCADE, MOBILE_MAX);
    expect(mobile).not.toBe('');
    expect(mobile).toMatch(/\.cft-bar\s*\{[^}]*display:\s*none/);
  });

  it('桌機選車列的關閉與手機控制列的顯示用同一個斷點(不得再度漂移)', () => {
    expect(CASCADE.includes(MOBILE_MAX)).toBe(true);
    expect(MOBILE.includes(MOBILE_MAX)).toBe(true);
    // 關掉桌機列的那個區塊、與顯示手機列的那個區塊,必須是同一個 header
    expect(mediaBlock(CASCADE, MOBILE_MAX)).toMatch(/\.cft-bar\s*\{[^}]*display:\s*none/);
    expect(mediaBlock(MOBILE, MOBILE_MAX)).toMatch(/\.pmc-root\s*\{[^}]*display:\s*contents/);
  });

  // 🔴 Sean 2026-07-30 Q2=A 修掉的那條帶狀死區的守門。
  // 商品頁版面(側欄/兩欄/欄數鈕)原本掛 ≤1079,而選車列與手機工具列掛 1024/1025
  // ⇒ 1025-1079px 這 55px 寬的區間:側欄已藏、手機列未出現 = 分類/品牌/價格**零入口**。
  // 這個缺口 jsdom 完全看不到(不套 media query),只有真瀏覽器拉到那段才現形。
  // 故三個檔案的商品頁交界必須是同一個數字;任一條漂回 1079 就當場轉紅。
  it('商品頁版面的桌機/手機交界與選車列同一個斷點(1025-1079px 不得再出現無入口帶狀區)', () => {
    const block = mediaBlock(RESPONSIVE, MOBILE_MAX);
    expect(block).not.toBe('');
    expect(block).toMatch(/\.fs-side\s*\{[^}]*display:\s*none/);
    expect(block).toMatch(/\.pp-layout\.has-side\s*\{[^}]*grid-template-columns:\s*1fr/);
    expect(block).toMatch(/\.pp-grid-toggle\s*\{[^}]*display:\s*none/);

    // 反向:1079 區塊(對齊底部導覽、管品牌頁/分類頁)不得再含商品頁版面規則
    const tabbarBlock = mediaBlock(RESPONSIVE, '@media (max-width: 1079px)');
    expect(tabbarBlock).not.toMatch(/\.fs-side/);
    expect(tabbarBlock).not.toMatch(/\.pp-layout/);
    expect(tabbarBlock).not.toMatch(/\.pp-grid/);
  });

  // 退場的控制項不留樣式:有樣式沒元件的死路,審查時分不出是現行還是遺跡。
  it('已退場的手機篩選 FAB 不再留任何樣式', () => {
    expect(RESPONSIVE).not.toMatch(/\.pp-mobile-fab/);
    expect(RESPONSIVE).not.toMatch(/\.pp-fab-badge/);
    expect(RESPONSIVE).not.toMatch(/\.mobile-fab-slot/);
  });

  it('filter-cascade.css:[data-mobile="true"] 強制手機殼同樣關掉', () => {
    expect(CASCADE).toMatch(/\[data-mobile="true"\]\s+\.cft-bar\s*\{[^}]*display:\s*none/);
  });

  // 壓縮配方 = 「.cft-select 縮字級 + flex:1 + .cft-cascade nowrap」三件套。
  // 留著它 = 留一條沒人維護、隨時會被重新開啟的路;審查時分不出哪條是現行。
  it('filter-responsive.css:三欄壓縮配方已完全移除', () => {
    expect(RESPONSIVE).not.toMatch(/\.cft-select/);
    expect(RESPONSIVE).not.toMatch(/\.cft-cascade/);
  });

  it('filter-cascade.css:不再有把選車欄壓成三欄併排的手機規則', () => {
    expect(CASCADE).not.toMatch(/\.cft-cascade\s+\.vsc\s*\{[^}]*flex:\s*1/);
  });
});

// 手機控制列的反向條件:它只能在手機出現。桌機若同時長出兩套入口,
// 桌機版面會被塞進一條重複的工具列(而桌機測試看不到 CSS)。
describe('手機控制列只在手機出現(products-mobile.css)', () => {
  it('預設(桌機)隱藏', () => {
    expect(MOBILE).toMatch(/\.pmc-root\s*\{[^}]*display:\s*none/);
  });

  it(`${MOBILE_MAX} 顯示`, () => {
    const mobile = mediaBlock(MOBILE, MOBILE_MAX);
    // 🔴 必須是 contents 而不是 block:見下一條「黏得住」的守門。
    expect(mobile).toMatch(/\.pmc-root\s*\{[^}]*display:\s*contents/);
  });

  it('[data-mobile="true"] 強制手機殼也顯示', () => {
    expect(MOBILE).toMatch(/\[data-mobile="true"\]\s+\.pmc-root\s*\{[^}]*display:\s*contents/);
  });

  // ═══ Sean 2026-07-30 真機截圖抓到的兩個 bug 的守門 ═══
  // 兩個都是「元件測試 100% 綠、真手機上壞掉」的類型:jsdom 不做 layout、不算 sticky,
  // 所以只有 CSS 文字層 + 真瀏覽器捲動實測抓得到。
  it('工具列黏得住:sticky 掛在 .pmc-sticky,且 .pmc-root 必須是 contents(否則移動空間為 0)', () => {
    // sticky 只能在父層 box 內移動;.pmc-root 若是 block,它的高度剛好等於這條列
    // ⇒ 移動空間 0 ⇒ 一捲就跟著滑掉(第一版就是這樣壞的)。
    expect(MOBILE).toMatch(/\.pmc-sticky\s*\{[^}]*position:\s*sticky/);
    expect(MOBILE).toMatch(/\.pmc-sticky\s*\{[^}]*top:\s*64px/);
    const mobile = mediaBlock(MOBILE, MOBILE_MAX);
    expect(mobile).toMatch(/\.pmc-root\s*\{[^}]*display:\s*contents/);
    // 大塊車輛資訊不得是 sticky(它要捲走;否則黏頂高度會吃掉手機近 1/4 畫面)
    const vehicleRule = MOBILE.match(/\.pmc-vehicle\s*\{[^}]*\}/)?.[0] ?? '';
    expect(vehicleRule).not.toMatch(/position:\s*sticky/);
  });

  it('頁面標題在手機不黏頂(修掉 cascade bar 退場後留下的 56px 幽靈偏移)', () => {
    // products-page.css 的手機規則是 `top: 120px = 64 header + 56 cascade bar`,
    // 而手機的 cascade bar 已整條關閉 ⇒ 不覆蓋成 static 就會「標題卡畫面中間 + 上方空一條」。
    const mobile = mediaBlock(MOBILE, MOBILE_MAX);
    expect(mobile).toMatch(
      /\.pp-layout\[data-filter-style="cascade"\]\s+\.pp-head\s*\{[^}]*position:\s*static/,
    );
    expect(MOBILE).toMatch(
      /\[data-mobile="true"\]\s+\.pp-layout\[data-filter-style="cascade"\]\s+\.pp-head\s*\{[^}]*position:\s*static/,
    );
  });

  // 手機面板的輸入欄位 <16px 會讓 iOS Safari 聚焦時自動放大整頁(checkout 同款守門)。
  it('選車面板輸入欄位至少 16px(iOS 聚焦不自動放大)', () => {
    expect(MOBILE).toMatch(/\.mvs-field\s+input\s*\{[^}]*font-size:\s*1[6-9]px/);
  });
});

// ── A9(選車引擎統一 B′):GarageChips 副註推廣到四個掛載點之後的密度分家 ──
// 🔴 為什麼這條非有不可:`.cat-garage-heading` 原本是**無 scope 的全域規則**,而當時全站
//    只有 sheet 會渲染它 ⇒ 「它其實是卡片密度專用」這件事從來沒被寫下來,也沒有守門。
//    副註推廣之後 top/drawer 也會渲染它,不分家就是把手機的 17px/850 套到桌機面板上。
//    元件測試對這個**完全盲**(jsdom 不套 CSS、13 條 GarageChips 測試全綠)。
describe('GarageChips 副註的兩種密度(設計稿 §B)', () => {
  const headingBase = MOBILE.match(/\.cat-garage-heading\s*\{[^}]*\}/)?.[0] ?? '';
  const headingSheet =
    MOBILE.match(/\.cat-garage--sheet\s+\.cat-garage-heading\s*\{[^}]*\}/)?.[0] ?? '';

  it('基礎規則=行內密度:span 14px/700、不得有 space-between 或 margin-bottom', () => {
    expect(headingBase).not.toBe('');
    expect(MOBILE).toMatch(/\.cat-garage-heading\s+span\s*\{[^}]*font-size:\s*14px/);
    expect(MOBILE).toMatch(/\.cat-garage-heading\s+span\s*\{[^}]*font-weight:\s*700/);
    // 這兩條若留在基礎規則上,桌機/抽屜面板就會吃到卡片密度的排版
    expect(headingBase).not.toMatch(/justify-content:\s*space-between/);
    expect(headingBase).not.toMatch(/margin-bottom/);
  });

  it('卡片密度必須 scope 在 .cat-garage--sheet 底下(手機面板現狀不得退化)', () => {
    expect(headingSheet).toMatch(/justify-content:\s*space-between/);
    expect(headingSheet).toMatch(/margin-bottom:\s*10px/);
    expect(MOBILE).toMatch(
      /\.cat-garage--sheet\s+\.cat-garage-heading\s+span\s*\{[^}]*font-size:\s*17px/,
    );
  });
});
