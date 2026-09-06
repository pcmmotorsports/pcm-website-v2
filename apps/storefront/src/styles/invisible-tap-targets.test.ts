// invisible-tap-targets.test.ts — 「看不見的東西不准吃點擊」守門。
//
// 🔴 病(2026-08-18 修掉的那個):`.pcard-heart` 是 `opacity: 0` + 只有 `.pcard:hover` 才浮出來,
//    **而觸控裝置沒有 hover ⇒ 它永遠是隱形的**;它又缺 `pointer-events: none`,
//    而 `ProductCard.tsx:155` 的 onClick 會 `preventDefault()`
//    ⇒ 每張商品圖右上角一個 **32×32 看不見的洞,客人點下去商品不會打開**。
//    390×844 實測(6px 網格、1421 取樣點):修前陷阱點 **22**、修後 **0**。
//
// 🔴 **為什麼要用「讀 CSS 字面」守它**:這個 bug 對既有檢查全部隱形 ——
//    typecheck / lint / build / vitest 全綠,畫面上也看不出來(它本來就看不見)。
//    唯一抓得到它的是「在真瀏覽器上逐點問 elementFromPoint」,而那不在 CI 裡。
//
// ⚠️ **本檔守的是「別再被拿掉」,不是「版面現在是對的」** —— 後者要真瀏覽器量。
// ⚠️ 射程:只掃**下面那張具名表裡的 (檔名, 選擇器) 對**(2026-08-18 起 4 對,跨 2 支 css)。
//    它**不會**自動發現第 5 個 —— 那要靠真瀏覽器掃描,或有人記得把新的加進那張表。
//    🔴 **這句話 2026-08-18 當天成真了**:原本寫「只掃 product-card.css 裡已知的三個」,
//    而第四個(`.pd-hero-arrow`)正好落在射程外、**且不在同一支 css** ⇒ 表的形狀也得跟著改。
//    (誠實說:這正是這種守門的天花板,寫在這裡免得有人以為它保證了全站。)
// 📎 `design-reference/styles/product-card.css:78-95` 的 `.pcard-heart` **同樣沒有 pointer-events**
//    ⇒ 日後照鐵則 1 重搬那支檔的人會把這個洞搬回來,**這一格就是攔他的**。
//
// ═══════════════════════════════════════════════════════════════════════════
// ✅ **Q1(手機常駐顯示)已落地(2026-08-18)—— 而這 4 格【沒有紅】。**
// ═══════════════════════════════════════════════════════════════════════════
//   🔴 **本段是更正**:上一版檔頭寫著「這 4 格預期會紅、要改期望值」。
//   **那個預測沒有成真**,原因是落地的做法與預測時想的不一樣:
//   ```
//   預測時想的：把基底的 opacity: 0 拿掉 ⇒ 前三格的前提消失 ⇒ 紅
//   實際做的　：基底不動（桌機仍照 design 的 hover 才浮出），
//              另加一條 @media (hover: none) 讓【觸控裝置】常駐顯示
//              ⇒ 基底規則一個字沒改 ⇒ 這 4 格照樣綠
//   ```
//   ⚠️ 留著這段不刪,是因為**下一個人可能會走預測的那條路**(直接改基底)——
//   那時候前三格才會紅,而**那時候的正解仍然是「改期望值 + 重想它在守什麼」,不是刪掉**:
//   ```
//   它守的病 = 「看不見的東西不准吃點擊」
//   而那個病在 .pcard-dots 與 .pcard-quick 上仍然成立 ⇒ 那兩個不該跟著陪葬
//   ```
//   📎 背景:`Q1 = 手機上的愛心常駐顯示`(Sean 2026-08-18 親口確認「手機客人要能收藏」;
//   plan `docs/specs/2026-08-18-g3-favorites-plan.md` §1-h)。
//   ⇒ 新增的第 5 格盯的是**新做法自己的風險**:`@media (hover: none)` 那條裡
//   `opacity` 與 `pointer-events` 必須成對 —— 只開 `opacity` = 看得見卻按不到。
//
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 剝掉註解再比對 —— 否則上面那段說明自己就會命中(偵測字串自命中)。 */
const read = (f: string) => readFileSync(resolve(HERE, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 「平常隱形、只有 hover 才浮出來」的元素 —— **(檔名, 選擇器) 對,不是純選擇器清單**。
 *
 * 🔴 **2026-08-18 從單一檔案的清單改成這個形狀,而理由是本檔檔頭自己預告過的天花板成真了:**
 * `:14-16` 逐字寫著「只掃 `product-card.css` 裡已知的三個…**不會**自動發現新增的第四個」。
 * 那個第四個當天被量到了 —— `.pd-hero-arrow`,而且**不在同一支 css 裡**
 * ⇒ 舊的形狀連「加一列」都做不到,必須先帶上檔名。
 * 📎 **這不是本檔寫壞了,是它預告的事情成真** —— 而預告成真本身就是資訊。
 *
 * ⚠️ **刻意【不】改成「掃全部 css」**:2026-08-18 實跑過那把尺 —— 33 支 css、11 條原始命中,
 *   剔掉 keyframes 與純裝飾之後**真的只有 1 條**(誤報 10/11)。
 *   做成全掃守門會天天紅在 keyframes 上,**三天內就會被人加 skip** ⇒ 那比沒有守門更糟。
 *   **具名表 + 誠實聲明射程**才是對的形狀,只是表要長一列。
 */
const HOVER_GATED: [file: string, selector: string][] = [
  ['product-card.css', '.pcard-heart'],
  ['product-card.css', '.pcard-dots'],
  ['product-card.css', '.pcard-quick'],
  // 商品頁主圖的左右箭頭(72×72)。加進來的那一刻它是紅的,而**紅是對的** —— 修法同 `0a7988c9`。
  ['product-page.css', '.pd-hero-arrow'],
];

describe('看不見的東西不准吃點擊', () => {
  it.each(HOVER_GATED)('🔴 %s 的 %s 基底規則必須同時有 opacity: 0 與 pointer-events: none', (file, sel) => {
    const css = read(file);
    // 基底規則 = 選擇器單獨出現(不是 .pcard:hover xxx 那種)
    const rule = new RegExp(`(^|\\n)\\s*\\${sel}\\s*\\{[^}]*\\}`).exec(css)?.[0];
    expect(rule, `找不到 ${sel} 的基底規則 ⇒ 本條前提失效(被改名?)，不是通過`).toBeTruthy();
    expect(rule, `${sel} 不再是 opacity:0 ⇒ 本格的前提變了，回去重讀本檔檔頭再決定要不要改這張表`)
      .toMatch(/opacity:\s*0\s*;/);
    expect(
      rule,
      `${sel} 看不見卻沒有 pointer-events: none ⇒ 它會在隱形狀態下吃掉客人的點擊`,
    ).toMatch(/pointer-events:\s*none\s*;/);
  });

  it('🔴 `.pd-hero-arrow` 浮出來時要把點擊收回去(否則桌機的左右換圖按不到)', () => {
    const css = read('product-page.css');
    const hoverRule = /\.pd-hero-img:hover\s+\.pd-hero-arrow(:not\(:disabled\))?\s*\{[^}]*\}/.exec(css)?.[0];
    expect(hoverRule, '找不到 .pd-hero-img:hover .pd-hero-arrow ⇒ 前提失效').toBeTruthy();
    expect(hoverRule, 'hover 態沒有 pointer-events: auto ⇒ 桌機的左右換圖會按不到')
      .toMatch(/pointer-events:\s*auto\s*;/);
    // 🔴 GR/Fable R3:`:disabled` 那顆有 `opacity: 0 !important` ⇒ 它【看不見】,
    //   而 hover 規則若不排除它,它會拿回 pointer-events ⇒ 看不見卻擋在最上層。
    expect(
      hoverRule,
      'hover 規則沒排除 :disabled ⇒ 第一張/最後一張的那顆會【看不見卻吃點擊】',
    ).toContain(':not(:disabled)');
  });

  it('🔴 Q1:觸控裝置那條裡「看得見」與「可以按」必須成對出現', () => {
    const css = read('product-card.css');
    const touch = /@media\s*\(hover:\s*none\)\s*\{[\s\S]*?\n\}/.exec(css)?.[0];
    expect(
      touch,
      '找不到 @media (hover: none) 區塊 ⇒ 手機客人又沒有入口可以收藏了(Q1 被拿掉?)',
    ).toBeTruthy();
    expect(touch, '手機常駐顯示那條沒把 .pcard-heart 打開').toContain('.pcard-heart');
    expect(touch, '.pcard-heart 在觸控裝置沒有變成看得見').toMatch(/opacity:\s*1\s*;/);
    expect(
      touch,
      '看得見了卻沒有把 pointer-events 收回來 ⇒ 客人看得到愛心但按不下去',
    ).toMatch(/pointer-events:\s*auto\s*;/);
  });

  // 🔴🔴 **2026-09-06 線 `front`(⟦f3-CARDTAPUNMEASURED⟧):同一張卡上的「選擇規格」與「愛心」
  //   是【同一個病, 而只有一半有修法】—— 而這一格守的是那半個缺口的【兩條路】, 不是一條。**
  //
  //   ⛔ ~~我第一版寫「`.pcard-quick` 在手機上看不見也按不到」~~
  //   ⇒ 🔴 **那是【推論】, 而 R1(code-reviewer)把它推翻了** —— 它有**第二條路徑**:
  //     `ProductCard.tsx:188` `onMouseEnter → setHover(true)` ⇒ `:240` 加上 `is-visible`
  //     ⇒ `product-card.css:208` `.pcard-quick.is-visible { pointer-events: auto }`,
  //     而**真觸控會補發相容滑鼠事件** ⇒ 手指碰一下, 它就活了。
  //   🔬 **實測(`node scripts/tap-target-probe.mjs --reveal`, 自己重跑得出來)**:
  //   ```
  //   ① 什麼都還沒做       opacity=0  pointer-events=none
  //   ② 真 tap 卡片一下    opacity=1  pointer-events=auto   ← 它活過來了(被擋下的導航 1 次)
  //   ③ 再 tap 按鈕        那一下落在 button.pcard-quick-btn ← 按得到
  //   ```
  //   ✅ **所以精確的說法是**:它不是死的, 是**只有在客人按下那一下、
  //     而那一下【會把他帶去商品頁】的時候才亮起來** ⇒ 實務上客人拿不到這個狀態。
  //   📌 **⇒ 結論很像(用不到那顆鈕), 而機制完全不同 —— 而我把推論寫成了量到。**
  //
  //   🛑 **要不要讓它在手機上真的可用 = 產品決定(Sean 的)**, 不是我加一條 CSS 就好。
  //   ✅ **本格【釘住今天的狀態】, 而今天的狀態由【兩處】決定 —— 所以兩處都要釘**:
  //     · CSS 那條路:`@media (hover: none)` 區塊(**全部**, 不只第一個)不得含 `.pcard-quick`
  //     · TSX 那條路:`is-visible` 由 `hover` 驅動, 而 `hover` **只由 `onMouseEnter` 設**
  //       ⇒ 有人加 `onTouchStart` / 改成常駐, 本格才叫得出來。
  //       ⛔ ~~第一版三發突變全打在 CSS 那一半~~ ⇒ 🔴 **改 TSX 那一行, 手機上它就活了而本格全綠**(R1 Critical)。
  //   ⇒ 任何一格紅了, 正解是 **①確認那是 Sean 拍的 ②更新板列 ⟦f3-CARDTAPUNMEASURED⟧ ③才改期望值**, 不是刪掉本格。
  it('🔴 今天的狀態·CSS 那條路:所有 @media (hover: none) 區塊都不得把「選擇規格」打開', () => {
    const css = read('product-card.css');
    // 🔴 **`matchAll` 不是 `exec`** —— `exec` 只回第一個區塊;有人【新增第二個】hover:none 區塊
    //   把 `.pcard-quick` 放進去 ⇒ 全綠, 而本格標題那句當場變成假的(R1 must-fix)。
    const blocks = [...css.matchAll(/@media\s*\(hover:\s*none\)\s*\{[\s\S]*?\n\}/g)].map((m) => m[0]);
    expect(blocks.length, '找不到任何 @media (hover: none) 區塊 ⇒ 前提失效, 這一發作廢').toBeGreaterThan(0);
    for (const b of blocks) {
      expect(
        b,
        '有一個 @media (hover: none) 區塊把 `.pcard-quick` 打開了 ⇒ 手機客人現在看得到「選擇規格」。'
          + '這是【產品決定】—— 先確認是 Sean 拍的, 再更新板列 ⟦f3-CARDTAPUNMEASURED⟧, 最後才改本格。',
      ).not.toContain('.pcard-quick');
    }
    // 🟢 正對照:愛心【在】其中一個區塊裡 ⇒ 證明上面那圈 not.toContain 不是因為抓到空區塊而恆真。
    expect(
      blocks.some((b) => b.includes('.pcard-heart')),
      '正對照:所有 hover:none 區塊都沒有愛心 ⇒ 我抓到的不是那條規則, 上面的斷言作廢',
    ).toBe(true);
    // 🔵 基底仍是「看不見的東西不准吃點擊」—— 兩件事一起成立才是今天的狀態。
    const base = /\.pcard-quick\s*\{[^}]*\}/.exec(css)?.[0];
    expect(base, '找不到 .pcard-quick 基底規則 ⇒ 前提失效').toBeTruthy();
    expect(base, '基底沒有 pointer-events: none ⇒ 讀數的前提變了, 重跑探針').toMatch(
      /pointer-events:\s*none\s*;/,
    );
  });

  it('🔴 今天的狀態·TSX 那條路:「選擇規格」只由 onMouseEnter 亮起來(加 onTouchStart 或常駐 ⇒ 本格紅)', () => {
    const tsx = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../components/ProductCard.tsx'),
      'utf8',
    );
    // 🟢 正對照先跑:前提還在嗎(改了元件結構 ⇒ 下面兩個斷言可能恆真)
    expect(tsx, '找不到 `is-visible` ⇒ 前提失效, 這一發作廢').toContain('is-visible');
    expect(tsx, '`is-visible` 不再由 hover 驅動 ⇒ 機制變了, 重跑 --reveal 再改本格').toMatch(
      /pcard-quick \$\{hover \? 'is-visible' : ''\}/,
    );
    expect(tsx, 'onMouseEnter 那條不見了 ⇒ 前提失效').toMatch(/onMouseEnter=\{\(\) => setHover\(true\)\}/);
    // 🔴 真正在守的那一條:多了一條【觸控裝置也會觸發】的路 ⇒ 手機上它就活了。
    expect(
      tsx,
      '`ProductCard` 多了觸控事件 ⇒ 「選擇規格」在手機上可能變成真的可用。'
        + '這是【產品決定】—— 先確認是 Sean 拍的, 再更新板列 ⟦f3-CARDTAPUNMEASURED⟧, 最後才改本格。',
    ).not.toMatch(/onTouch(Start|End)=/);
  });

  it('🔴 `.pcard-heart` 浮出來時要把點擊收回去(否則桌機按不到)', () => {
    const css = read('product-card.css');
    const hoverRule = /\.pcard:hover\s+\.pcard-heart\s*\{[^}]*\}/.exec(css)?.[0];
    expect(hoverRule, '找不到 .pcard:hover .pcard-heart ⇒ 前提失效').toBeTruthy();
    expect(hoverRule, 'hover 態沒有 pointer-events: auto ⇒ 桌機的收藏鈕會按不到')
      .toMatch(/pointer-events:\s*auto\s*;/);
  });
});
