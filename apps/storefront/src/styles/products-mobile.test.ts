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

/**
 * 從**指定位置**開始切一個大括號區塊(給有重複 header 的情況用)。
 * 🔴 上面的 `mediaBlock` 用 `css.indexOf(header)` 找起點 ⇒ **同字面的 header 只認得第一個**。
 *    `filter-cascade.css` 現有兩個一模一樣的 `@media (max-width: 1023px)`(`.ft-bar` 那個
 *    與 `.vsc-input` 手機覆寫那個)⇒ 對第二個區塊完全盲。
 *    這個洞是 2026-08-06 第3批收窄手機守門時引進的,由 code-reviewer **實測突變證實**:
 *    把壓縮配方塞進第二個 1023 區塊,收窄後的守門**全綠**(原本整檔掃的版本會紅)。
 *    而那個區塊正是歷史上放手機 `.vsc-input` 覆寫的地方 = 壓縮配方最可能回歸的位置。
 */
function blockAt(css: string, headerStart: number): string {
  const open = css.indexOf('{', headerStart);
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

  // 🔶 **2026-08-06 第3批:這條的判準收窄了,不是放寬。**
  //    原本掃「整支 `filter-cascade.css` 裡任何 `.cft-cascade .vsc { flex: 1 }`」。
  //    R1-3(Sean 看稿**圈圖親自解鎖** B′ C1)把**桌機**選車欄由固定 184px 改成
  //    `flex: 1 1 0`,於是這條紅了 —— 但它守的不變量是
  //    **「不得讓桌機 markup/CSS 在手機寬度形成三個被壓縮的橫向輸入框」**,
  //    而那條桌機規則在手機上根本不可達(`.cft-bar` 在 ≤1023px 與 `[data-mobile]` 兩路
  //    都 `display: none`,上面兩條斷言正在守著)。
  //    ⇒ 原斷言是拿「整檔出現過」當「手機會生效」的**代理**,那個代理在 R1-3 之後失真了。
  //    改成畫在不變量真正的面上:**任何手機寬度的 @media 區塊內**都不得出現這個配方。
  //    這比原版**更強** —— 原版只認 `flex: 1`,新版任何 flex 寫法(`flex: 1 1 0` /
  //    `flex-grow`)在手機段裡都會紅。
  it('filter-cascade.css:手機寬度的任何 @media 內都不得把選車欄壓成三欄併排', () => {
    // 掃出所有「上限 <= 1024px」的 @media header(不只 1023 那個 —— 壓縮配方可以掛在任何斷點)。
    // 🔴 **用 `m.index` 從真實位置切,不要拿 header 字串再 `indexOf` 一次** ——
    //    同字面的 header 有兩個以上時,`indexOf` 會把它們全部解析成第一個那塊。
    const mobile = [...CASCADE.matchAll(/@media[^{]*max-width:\s*(\d+)px[^{]*/g)].filter(
      (m) => Number(m[1]) <= 1024,
    );
    expect(mobile.length, 'filter-cascade.css 一個手機斷點都找不到 ⇒ 本條前提已失效').toBeGreaterThan(0);
    // 前提:確認每一段真的是從**它自己那個 header** 切下來的 —— M1 那個洞的直接守門。
    // 🔴 確認輪 N2:初版比的是「切出來的**內文**有幾種相異」,拿內容當位置的代理。
    //    兩個手機斷點的內文若剛好相同(例:1023 與 1024 各寫一份一樣的關閉規則),
    //    切片明明是對的、這條卻會誤紅;而誤紅會逼下一個人放寬它,洞就這樣回來。
    //    ⚠️ 第一版修法(改比 `indexOf('{', m.index)` 的相異性)**實測是恆真的**:
    //    那條算式自己就是位置,不管 `segs` 怎麼切都成立 —— 突變(把 segs 改回
    //    `mediaBlock(CASCADE, m[0])`)照樣全綠。改成直接驗「seg 就長在該起點上」,
    //    退回 indexOf 時第 2 段會落到第 1 段的內文 ⇒ 當場紅。
    const segs = mobile.map((m) => blockAt(CASCADE, m.index));
    segs.forEach((seg, i) => {
      const open = CASCADE.indexOf('{', mobile[i]!.index);
      expect(
        CASCADE.startsWith(seg, open + 1),
        `手機段 #${i + 1}(${mobile[i]?.[0].trim()})切到的不是它自己那塊 ⇒ 切片又退回 indexOf 了`,
      ).toBe(true);
    });
    segs.forEach((seg, i) => {
      const where = `手機段 #${i + 1}(${mobile[i]?.[0].trim()})`;
      expect(seg, `${where} 內出現了選車欄的 flex 壓縮配方`).not.toMatch(
        /\.cft-cascade\s+\.vsc[^{]*\{[^}]*flex/,
      );
      expect(seg, `${where} 內出現了 .cft-select 的縮字級`).not.toMatch(/\.cft-select/);
    });
  });

  // 🔴 確認輪 N1:上面那條收窄成「只掃 @media 區塊」之後,`[data-mobile="true"]` 那一路
  //    **整條掉出掃描面** —— 它不在任何 @media 內(見 `:181` 那行),桌機寬度也生效,
  //    而它正是 dev-preview 強制手機殼的唯一入口。壓縮配方寫成
  //    `[data-mobile="true"] .cft-cascade .vsc { flex: 1 }` 的話,上面那條全綠。
  //    不用「`.cft-bar` 已 display:none 所以不可達」放行:那個推理正是上面收窄時
  //    **拿來說服自己**的那一個,而「今天不可達」跟「明天不會被改成可達」是兩件事;
  //    兩路都掃的成本是兩行。
  it('filter-cascade.css:[data-mobile="true"] 那一路同樣不得出現三欄壓縮配方', () => {
    expect(CASCADE, '[data-mobile] 那一路出現了選車欄的 flex 壓縮配方').not.toMatch(
      /\[data-mobile="true"\][^{}]*\.cft-cascade\s+\.vsc[^{}]*\{[^}]*flex/,
    );
    expect(CASCADE, '[data-mobile] 那一路出現了 .cft-select 的縮字級').not.toMatch(
      /\[data-mobile="true"\][^{}]*\.cft-select[^{}]*\{/,
    );
  });

  // ⚠️ 這條與上方 `:56-60` / `:96-98` 兩條**是同一件事的重述**(regex 一模一樣),
  //    留著是為了讓「收窄後的判準靠什麼成立」看得見 —— **它不是新增的保護面**,
  //    報告裡不要當成多守到一層(code-reviewer N7 點名)。
  it('前提(重述,非新增保護面)— 桌機選車列在手機兩路都關掉', () => {
    expect(mediaBlock(CASCADE, MOBILE_MAX), '手機 @media 沒關掉 .cft-bar').toMatch(
      /\.cft-bar\s*\{[^}]*display:\s*none/,
    );
    expect(CASCADE, '[data-mobile] 那一路沒關掉 .cft-bar').toMatch(
      /\[data-mobile="true"\]\s+\.cft-bar\s*\{[^}]*display:\s*none/,
    );
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
    // 🔴 這條原本斷言 `top: 64px`。**期望值是被改過的,理由不是「為了讓驗收過」**:
    //    64 這個數字從一開始就不等於手機頁首的實高(實量 65),而第0批 0b 把 `.pcm-icon-btn`
    //    由 40 改 44 之後手機頁首變成 69px ⇒ 差 5px、工具列會被頁首壓住。
    //    修法是把「頁首多高」收成單一來源 `--shell-header-h`(tokens.css,桌機 73 / ≤1079 為 69),
    //    所以這裡改成斷言「有吃那顆 token」而不是斷言某個字面數字 ——
    //    字面數字正是上一次讓它悄悄失準的原因。實際值的正確性由 `shell-detail.test.ts` 的
    //    「73/69 的算式成分還在」那條前提斷言守,兩邊合起來才是完整合約。
    expect(MOBILE).toMatch(/\.pmc-sticky\s*\{[^}]*top:\s*var\(--shell-header-h\)/);
    const mobile = mediaBlock(MOBILE, MOBILE_MAX);
    expect(mobile).toMatch(/\.pmc-root\s*\{[^}]*display:\s*contents/);
    // 大塊車輛資訊不得是 sticky(它要捲走;否則黏頂高度會吃掉手機近 1/4 畫面)
    const vehicleRule = MOBILE.match(/\.pmc-vehicle\s*\{[^}]*\}/)?.[0] ?? '';
    expect(vehicleRule).not.toMatch(/position:\s*sticky/);
  });

  it('頁面標題在手機不黏頂(修掉 cascade bar 退場後留下的 56px 幽靈偏移)', () => {
    // products-page.css 的手機規則是 `top: calc(var(--shell-header-h) + 56px)`(0b 之前寫死 120 = 64 header + 56 cascade bar),
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

// Part B(債④,2026-08-07 Q22=A):`ProductsMobileControls` 會渲染
// `<div className="pmc-skip-notice">`。元件測試守的是「提示有沒有出現」,守不到
// 「CSS 認不認帳」—— class 掛上但規則被刪掉時,提示會以裸文字畫出來、沒有任何測試會紅。
// 🔴 這裡**只釘規則存在與它承載的兩個決定**(次要文字色、字級小於車名那行),
//    不釘 padding / line-height —— 那些是我自己挑的值、沒有外部契約,釘了只是凍結任意選擇。
describe('債④ 略過提示的樣式(pmc-skip-notice)', () => {
  const rule = MOBILE.match(/\.pmc-skip-notice\s*\{[^}]*\}/)?.[0] ?? '';

  it('🔴 規則必須存在,且是次要文字色 + 比車名那行小一階', () => {
    expect(rule, '.pmc-skip-notice 的 CSS 規則不見了 ⇒ 提示會變成沒有樣式的裸文字').not.toBe('');
    expect(rule, '提示搶了主要文字色 ⇒ 會跟車名一樣重、看起來像錯誤而不是附註').toMatch(
      /color:\s*var\(--c-text-3\)/,
    );
    const size = Number(rule.match(/font-size:\s*(\d+)px/)?.[1] ?? NaN);
    expect(size, '提示字級沒有小於 .pmc-compact-name 繼承的 13px ⇒ 兩行同重、分不出主從').toBeLessThan(13);
  });
});
