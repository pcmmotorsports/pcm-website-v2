import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// money-column-width.test.ts — 守住「單價與小計共用一個寬度變數」這件事。
//
// 🔴🔴 **先讀限定,它決定你能不能信這支測試**:
//    **本檔是【字面守門】,守的是 CSS 原始碼,不是版面。**
//    這個 bug(金額溢出壓到隔壁欄)在 jsdom 裡**不存在** —— jsdom 不做版面計算。
//    ⇒ 拆回兩個數字、或把值改小 ⇒ 本檔會紅 ✅
//    ⇒ 但用**別的方式**讓金額擠不下(改字級、改 gap、改別的軌)⇒ **本檔全綠而畫面是壞的。**
//    真的版面守門缺口記在 `#824`(後台沒有真瀏覽器版面守門層)。
//
// 📎 病灶與實量:`~/pcm-mailbox/A-bc-006-診斷-小計欄裝不下金額-20260821.md`
//    一句話:小計軌 `64` 是**逐字搬設計稿**的舊常數,而 2026-08-21 A2 把字級 11px→13px
//    之後**沒有人回頭重量它**;隔壁 `76` 是我方自己加的、加的人量過 ⇒ 放得下。
//    **同一種內容,新做的軌道放得下、搬來的軌道放不下。**

const CSS = readFileSync(resolve(__dirname, 'globals.css'), 'utf8');

/** 剝掉 CSS 註解 —— 否則「有人在註解裡提到這個變數」會把尺推歪。 */
const stripCssComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 取 `.iline { … }` 那個宣告區塊。
 *
 * 🔴🔴 **2026-08-24 codex must-fix:唯一命中,而且必須是【行首】的 `.iline {`。**
 *    ~~舊版 `css.indexOf('.iline {')`~~ 取**第一個**命中 ⇒ 可以用誘餌繞過:
 *    ```
 *    在真規則【之前】插一條不生效的 `.__guard_decoy .iline { … }`(選擇器不同, 畫面零影響)
 *    再把真的規則改成任何值 ⇒ **本守門 10/10 全綠**
 *    ```
 *    📏 **那不是推測** —— 2026-08-24 本窗照 codex 給的形狀構造過一發,實測 `EXIT=0, 10 passed`。
 *    ⇒ 現在兩道:①錨在行首(誘餌那條前面有 `.__guard_decoy ` ⇒ 錨不到)
 *              ②**要求整份 CSS 裡剛好一處** ⇒ 有人再加一條同名規則就紅,而不是安靜地選一個。
 */
function ilineBlock(css: string): string {
  const hits = [...css.matchAll(/^\.iline\s*\{/gm)];
  if (hits.length === 0) throw new Error('找不到行首的 `.iline {` —— 結構變了,本守門要重寫');
  if (hits.length > 1)
    throw new Error(
      `行首的 \`.iline {\` 有 ${hits.length} 處 —— 本守門只讀得懂一處。` +
        '有人加了第二條同名規則(或誘餌)⇒ 先確認哪一條才是生效的那條,再改本守門。',
    );
  const i = hits[0]!.index;
  return css.slice(i, css.indexOf('}', i));
}

/**
 * 🔴🔴 **MW-3 的修法本體:不要釘結論,要釘算式。**
 *
 * 第一版斷言的是「`--pcm-money-w` 必須正好 76」—— 而 76 不是一個獨立的事實,
 * 它是**四個輸入算出來的**:
 * ```
 * 2v ≤ 容器653 − 品名地板120 − gap總和50 − 其餘三軌(158+128+44=330) = 153  ⇒ v ≤ 76.5
 * ```
 * ⇒ 有人把料號從 158 改成 200,**76 立刻不成立,而只釘 76 的守門全綠。**
 * ⇒ 所以下面這幾支 parser 把四個輸入**從 CSS 讀出來**,上限**當場算**。
 *   任一個輸入變動 ⇒ 算出來的上限跟著變 ⇒ 紅。
 *
 * ⚠️ **只有「容器寬」是寫死的**,因為它不是 CSS 常數 —— 它是版面算出來的。
 *
 * 🔴🔴 **2026-08-24:這個常數【失效過一次,而它不會叫】,所以現在它旁邊有一道閘。**
 *
 * 事件:Sean 把面板預設寬從 720 改成 520。容器寬跟著變,而本檔的常數不會知道。
 * 📏 而那不是推測 —— 2026-08-24 b4 兩個方向都實測過本守門對面板寬**失明**:
 * ```
 * 該綠 面板 720 → 520           ⇒ EXIT=0, 7 passed  ← 完全沒反應
 * 該紅 --pcm-money-w 76 → 999px ⇒ EXIT=1, 紅 1 格   ← 它只看得到 CSS 那幾個輸入
 * ```
 * 🔴 舊版在這裡寫了「前提變了要重量」—— **那是一句給人看的提醒,不是一道機制。**
 *    720 變 520 那天,沒有任何東西會叫。**下面那道閘就是把那句提醒換成一個動作。**
 *
 * ⚠️ **為什麼不乾脆把容器寬【算出來】**(我試過,答案是不行,而理由值得寫下來):
 * 📏 2026-08-24 真瀏覽器實量(viewport 1440,面板寬掃 11 個點:480/500/520/560/600/653/700/720/800/900/960):
 * ```
 * 容器寬 = 面板實際寬 − 67   ← 11 個點【全部】吻合, 含被 clamp 住的 900/960(面板實際 876)
 * ```
 * 而那個 67 拆開來是:**兩層 `p-4`(16×4)+ 兩道 `border`(1×2)+ 捲軸讓出的寬**。
 * 🔴 **捲軸那一份是環境相依的** —— macOS 的 overlay 捲軸可能是 0,而本次量到 1~2px。
 *    ⇒ 在 jsdom / node 裡**算不出**這個 67,它不是純 CSS 常數。
 *    ⇒ **所以它必須留在「實量」這個身分上。** 我沒有把它偽裝成算得出來的東西。
 */
/**
 * 🔴🔴 **2026-08-24 Sean 裁「乙」:前提改成【六軌真正生效的那個寬度】,不是預設面板寬。**
 *
 * 為什麼(這一段是本檔最容易被讀錯的地方,寫清楚):
 * ```
 * .iline 的【六軌】宣告被 globals.css 的 @container (max-width:820px) 覆蓋成【兩軌】
 * 而那個 container 量的是【面板】, 不是 .iline 自己
 * ⇒ 面板 ≤ 853 ⇒ 畫面上是 2 軌;面板 ≥ 854 ⇒ 才是 6 軌
 * ```
 * 📏 **實量(2026-08-24 真瀏覽器 + admin-probe 鑽機,viewport 1440,二分法收斂)**:
 * ```
 * 面板 853 ⇒ 容器 787 ⇒ 2 軌
 * 面板 854 ⇒ 容器 788 ⇒ 6 軌   ← 本檔用這一組
 * ```
 * 🔴 **而舊版用的是「面板預設寬換算出來的容器寬」(720 ⇒ 653)** ——
 *    可是面板 720 的時候畫面上只有 2 軌 ⇒ **它在算一個永遠不會同時出現的組合。**
 *    ⚠️ 那不是誰改壞的,是 `@container` 斷點與這個常數**從來沒有對過**。
 *    (2026-08-24 面板預設改 520 時量到;720 那一側就已經是這樣。)
 */
const 六軌門檻_面板寬 = 854; // 實量 2026-08-24:853 ⇒ 2 軌、854 ⇒ 6 軌(viewport 1440)
const 六軌門檻_容器寬 = 788; // 同一發量的:面板 854 時 .iline 的寬
/** 決定上面那兩個數字的 CSS 斷點。它一變,上面兩個就要重量 —— 下面「前提閘」在驗它。 */
const 覆蓋成兩軌的斷點 = 820;

/** 從 `.iline` 的 grid 宣告讀出六軌的字面。 */
function trackList(css: string): string[] {
  const block = ilineBlock(stripCssComments(css));
  const cols = /grid-template-columns:([^;]+);/.exec(block);
  if (!cols) throw new Error('讀不到 grid-template-columns');
  return (cols[1] ?? '').trim().split(/\s+(?![^(]*\))/);
}

/**
 * 讀一個 `--name: <n>px` 變數的數值。找不到 ⇒ throw(不得靜默回 0)。
 *
 * 🔴 **2026-08-24 codex must-fix:同名變數被【後面】重新定義時,舊版看不到。**
 *    單發 `exec()` 取第一個命中 ⇒ 在檔案後面附一個 `:root{--pcm-money-w:300px}`
 *    就能讓 cascade 的生效值與本守門讀到的值分家,而守門全綠。
 *    ⇒ 現在**要求整份 CSS 裡剛好一處定義**;多於一處就紅,由人去判哪一處生效。
 */
function cssVar(css: string, name: string): number {
  const hits = [...stripCssComments(css).matchAll(new RegExp(`--${name}:\\s*(\\d+)px`, 'g'))];
  if (hits.length === 0) throw new Error(`讀不到 --${name}`);
  if (hits.length > 1)
    throw new Error(
      `--${name} 在 CSS 裡有 ${hits.length} 處定義(值:${hits.map((h) => h[1]).join(', ')})。` +
        '🔴 本守門只讀第一處,而 cascade 生效的是最後一處 ⇒ 兩者會分家。先收斂成一處。',
    );
  return Number(hits[0]![1]);
}

/** 讀 `.iline` 的 `gap: <n>px`。 */
function ilineGap(css: string): number {
  const m = /gap:\s*(\d+)px/.exec(ilineBlock(stripCssComments(css)));
  if (!m) throw new Error('讀不到 .iline 的 gap');
  return Number(m[1]);
}

/** 品名軌的地板:`minmax(<floor>px, 1fr)`。 */
function nameFloor(css: string): number {
  const m = /minmax\(\s*(\d+)px\s*,\s*1fr\s*\)/.exec(trackList(css)[0] ?? '');
  if (!m) throw new Error('讀不到品名軌的地板');
  return Number(m[1]);
}

/** 把一個軌道字面解析成 px(支援 `NNpx` 與 `var(--x)`)。 */
function trackPx(css: string, literal: string): number {
  const v = /^var\(--([a-z0-9-]+)\)$/.exec(literal.trim());
  if (v) return cssVar(css, v[1]!);
  const n = /^(\d+)px$/.exec(literal.trim());
  if (!n) throw new Error(`解析不了軌道字面:${literal}`);
  return Number(n[1]);
}

/** 🔴 上限【當場算】:2v ≤ 容器 − 地板 − gap總和 − 其餘三軌。 */
function moneyUpperBound(css: string): number {
  const tracks = trackList(css);
  const others = [1, 2, 3].reduce((a, i) => a + trackPx(css, tracks[i] ?? ''), 0);
  const gaps = ilineGap(css) * (tracks.length - 1);
  return (六軌門檻_容器寬 - nameFloor(css) - gaps - others) / 2;
}

describe('訂單面板:單價與小計的軌道寬', () => {
  it('🔴 兩軌用【同一個】變數 —— 拆回兩個數字會紅', () => {
    const block = ilineBlock(stripCssComments(CSS));
    const cols = /grid-template-columns:([^;]+);/.exec(block);
    expect(cols).not.toBeNull();
    const tracks = (cols?.[1] ?? '').trim().split(/\s+(?![^(]*\))/);
    expect(tracks).toHaveLength(6);
    // 第 5、6 軌 = 單價、小計,必須逐字相同且是變數。
    // 用一次 toEqual 比整組,而不是兩次索引存取 —— 失敗訊息會直接印出實際的兩軌是什麼。
    expect(tracks.slice(4)).toEqual(['var(--pcm-money-w)', 'var(--pcm-money-w)']);
  });

  // 🔴🔴 **本格第一版【只擋了一個方向】,被審查線 MW-1 擊破:**
  //    ```
  //    76 →  70  ⇒ 🔴 紅(我跑的那一發)
  //    76 → 120  ⇒ 🟢 全綠   ← 該紅沒紅
  //    76 → 999  ⇒ 🟢 全綠   ← 該紅沒紅
  //    ```
  //    而**同一支檔的註解裡**我自己就寫著「76 同時是下限與上限」。
  //    ⇒ **註解說服的是讀的人;斷言擋的是改的人。而改的人不一定會讀。**
  //    失敗情境:有人覺得「金額還是有點擠,調寬一點」⇒ 改 120 ⇒ 五格全綠
  //             ⇒ 兩軌 240 > 可用 153 ⇒ **品名軌被擠破地板 = 正是本檔記載的那個 bug。**
  // 🔴🔴 **2026-08-24 改名(Sean 裁乙之後)—— 這一格【不再是】在釘 76。**
  //    ~~原名「值必須【正好】在 76 —— 下限與上限撞在同一個數字上」~~ 那句話在舊前提下才成立:
  //    ```
  //    舊前提 容器 653(面板 720 換算)⇒ 上限 76.5 ⇒ 與下限 76 撞在一起 ⇒「正好 76」
  //    新前提 容器 788(六軌真的生效的那一格)⇒ 上限 144  ⇒ **兩個界不再撞在一起**
  //    ```
  //    ⇒ 現在它問的是**兩個不同的問題**,而只有下限那半仍咬在 76 上:
  //      下限 76  ← 文字實寬(「NT$ 15,800」75.4px @700 13px)。**與容器寬無關,沒有變。**
  //      上限 144 ← 版面算出來的。**現值 76 離它很遠。**
  //    📌 **名字是給人讀的,斷言是給機器跑的** —— 所以名字跟著改,不留一個說在釘 76 而實際在問別的事的格。
  //    ✅ 而它**沒有變成「反正都會過」**:兩個方向 2026-08-24 各表演過一發(見本節末的註記)。
  it('🔴🔴 值要 ≥ 76(文字實寬,硬的)且 ≤ 上限(版面算的)—— 兩個方向都要擋', () => {
    // 兩個來源:
    //   下限 「NT$ 15,800」文字實寬 75.4px ⇒ 76 才剛好不溢出(實量 2026-08-21,與容器寬無關)
    //   上限 品名地板 120 + 其餘【三】軌 158+128+44 = 330 + gap 50
    //        ⇒ 2v ≤ 788−120−50−330 = 288 ⇒ v ≤ 144(前提=六軌門檻,見檔頭)
    const v = cssVar(CSS, 'pcm-money-w');
    // 🔴 下限:實量的字寬(「NT$ 15,800」= 75.4px @700 13px)⇒ 76 才剛好不溢出
    // 🔴 上限:**當場從 CSS 算**,不寫死 —— 四個輸入任一個變動,這個數就跟著變
    const 上限 = moneyUpperBound(CSS);
    expect({ 值: v, 上限: 上限, 下限成立: v >= 76, 上限成立: v <= 上限 }).toEqual({
      值: v,
      上限: 上限,
      下限成立: true,
      上限成立: true,
    });
  });

  // 🔴 **這兩格的判別力是【互相獨立】的,而我驗過了**(不然「上限那格有用」只是推論):
  //    ```
  //    料號 158→160,【並且】同步把本格的期望值改成 160
  //      ⇒ 只有上限那格紅(1 failed) ⇒ **上限那格自己有判別力**
  //    料號 158→160,不動本格
  //      ⇒ 兩格都紅(2 failed)
  //    ```
  //    ⚠️ 而這也解釋了為什麼「輸入 +1」那組負對照看起來像紅:
  //       紅的是本格(輸入變了),不是上限那格 —— **上限那格的翻面點是 +2,實測相符。**
  //
  // ── 📏 2026-08-24 消融(Sean 裁乙之後,主視窗指定「兩個方向各表演一發」)────────────
  //    改的是 `globals.css` 的 `--pcm-money-w`,跑完還原(還原後 9 綠、該檔 porcelain 0 行):
  //    ```
  //    76 → 150(超過上限 144)      ⇒ 🔴 EXIT=1, 1 failed   ← 上限那半活著
  //    76 → 100(在 76~144 之間)    ⇒ 🟢 EXIT=0, 9 passed   ← 🔴 這一發是重點:
  //                                     它證明本格【不是】只認 76。少了它,一個「值必須 === 76」
  //                                     的死格也會讓上面兩發看起來正常。
  //    76 →  70(低於文字實寬 75.4) ⇒ 🔴 EXIT=1, 1 failed   ← 下限那半活著
  //    ```
  //    ⚠️ 而前提閘那組也表演過:`@container (max-width:820px)` → `900px` ⇒ 🔴 EXIT=1。
  //
  // 🔴🔴 **MW-3:上一格釘的是【算式】,本格證明那個算式真的讀得到那四個輸入。**
  //    沒有本格的話,`moneyUpperBound` 若把某個輸入讀成常數,上一格照樣綠。
  it('🔴 四個輸入都真的從 CSS 讀得到(讀不到必須 throw,不得靜默回 0)', () => {
    expect(nameFloor(CSS)).toBe(120);
    expect(trackPx(CSS, trackList(CSS)[1] ?? '')).toBe(158);
    expect(cssVar(CSS, 'pcm-three-w')).toBe(128);
    expect(trackPx(CSS, trackList(CSS)[3] ?? '')).toBe(44);
    expect(ilineGap(CSS)).toBe(10);
    // 讀不到要吼,不要靜默 —— 靜默回 0 會讓上限被算大,而那正好是本片要防的方向
    expect(() => cssVar('', 'pcm-money-w')).toThrow();
    expect(() => ilineGap('.iline { display: grid; }')).toThrow();
    expect(() => nameFloor('.iline { grid-template-columns: 1fr; gap: 10px; }')).toThrow();
  });

  it('🔴 舊的 `--pcm-unit-w` 不得復活(它是被合併掉的那一半)', () => {
    expect(stripCssComments(CSS)).not.toContain('--pcm-unit-w');
  });

  // 🔴 **工具約束要問兩件事,而我一直只問前面那件**(審查線 2026-08-21 給的四行清單):
  //      ① 工具失效會紅嗎?   ② 🔴 **工具量到【錯的東西】會紅嗎?**
  //    ②那一列是我漏最多的(MF-1 與 R2-1 都是它)。所以本格兩個方向都餵。
  it('🔴 剝除器:該剝的要剝掉(否則註解會冒充程式碼)', () => {
    // 直接餵最小輸入 —— 不透過 CSS 去測工具(2026-08-21 R2-1 學到的)
    expect(stripCssComments('/* --pcm-unit-w: 76px; */x')).toBe('x');
    expect(stripCssComments('/* a */b/* c */')).toBe('b');
  });

  it('🔴 剝除器:**不該剝的不准剝** —— 剝過頭會讓上面那幾格量到一份空的 CSS', () => {
    expect(stripCssComments('.a{b:1}')).toBe('.a{b:1}');
    expect(stripCssComments('url(a/b)')).toBe('url(a/b)'); // 單斜線不是註解
    // 🔴 而剝過頭【不會靜默】:CSS 變空 ⇒ ilineBlock 找不到 `.iline {` ⇒ throw ⇒ 整檔紅
    expect(() => ilineBlock('')).toThrow();
  });

  it('⚠️ 天花板寫在 CSS 註解裡,不是只寫在信裡 —— 七位數會碰撞', () => {
    expect(CSS).toContain('1,280,000');
    expect(CSS).toContain('已知天花板');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔴🔴 前提閘(2026-08-24)—— 把「前提變了要重量」從一句提醒換成一個動作
// ════════════════════════════════════════════════════════════════════════════
// 上面那組 `六軌門檻_面板寬 = 854` / `六軌門檻_容器寬 = 788` 是**手量的**,
// 而決定它們的是 `globals.css` 的 `@container (max-width:820px)` —— 那個斷點一動,兩個數字就過期。
//
// 🔴 **舊版把前提寫在註解裡**(「前提變了要重量」)——
//    2026-08-24 b4 兩個方向實測過:面板 720 → 520 ⇒ 本檔 **EXIT=0、7 passed、完全沒反應**。
//    ⇒ **那是一句給人看的提醒,不是一道機制。**
//
// 🔴🔴 **這道閘的【射程】,寫在它自己旁邊(2026-08-24 code-reviewer I-3)**:
//    `六軌門檻_容器寬 = 788` 至少有【三個】輸入,而本閘只釘得住其中一個:
//    ```
//    ✅ 釘住  globals.css 的 @container 斷點(它決定「面板多寬才變六軌」)
//    🔴 沒釘  面板到 .iline 之間的 padding / border —— 例如 @panel/orders/page.tsx 的 `p-4`
//             改它 ⇒ 788 過期,而本閘【全綠】
//    🔴 沒釘  捲軸寬(環境相依,見上)
//    ```
//    ⇒ **不要把它讀成「前提被守住了」** —— 它守住的是**其中一條路**,而那條是最常被動的。
//      (原句「把提醒換成一個動作」讀起來像涵蓋整個前提,那句話比它做的事寬。)
// ⚠️ **這道閘算不出新的容器寬** —— 那要真瀏覽器(檔頭寫了為什麼算不出來:
//    容器寬 = 面板寬 − 67,而那個 67 含**環境相依的捲軸寬**,jsdom 裡沒有)。
//    ⇒ 它做的事很窄,而那就是全部:**當前提變了,它拒絕保持綠色。**
//    📌 一道守門有兩種存在方式 —— ①它知道正確答案 ②它不知道,但它知道前提變了。
//       ②比「沒有守門」強得多,而它常被跳過,因為它看起來不夠聰明。
describe('🔴 前提閘:手量的容器寬與決定它的那個 CSS 斷點必須對得上', () => {
  it('🔴 覆蓋成兩軌的 @container 斷點,必須還是本檔記的那個值', () => {
    // 🔴 抓的是【真的做事的那條規則】:它同時關掉 .ihead 並把 .iline 改成兩軌。
    const m = /@container\s*\(max-width:\s*(\d+)px\)\s*\{[^}]*\.ihead\{display:none\}/.exec(
      stripCssComments(CSS),
    );
    expect(m, '讀不到那條把 .iline 覆蓋成兩軌的規則 ⇒ 本閘失去判別力,不得當成通過').not.toBeNull();
    expect(
      Number(m?.[1]),
      `覆蓋成兩軌的斷點已改成 ${m?.[1]}px,而本檔的 六軌門檻_容器寬 = ${六軌門檻_容器寬} ` +
        `是在斷點 ${覆蓋成兩軌的斷點}px(⇒ 面板 ${六軌門檻_面板寬})之下量的。` +
        '🔴 請在真瀏覽器重量:起 admin-probe 鑽機、viewport 1440、開一張訂單面板,' +
        '掃面板寬找出「第一個變成 6 軌」的那一格,記下它的 .iline 寬,把三個常數一起更新。' +
        '⚠️ 參考:2026-08-24 量到【容器寬 = 面板寬 − 67】,11 個點都吻合,' +
        '但那 67 含環境相依的捲軸寬 ⇒ **拿它當 sanity check,不要拿它當公式**。',
    ).toBe(覆蓋成兩軌的斷點);
  });

  // 🔴 2026-08-24 code-reviewer I-2:上一格只抓【第一塊】820。
  //    實測:只把第二塊(`② FIX-18 窄面板裡的表格橫捲`)改成 900px ⇒ 上一格**仍回報 820 ⇒ 全綠**。
  //    而 `globals.css` 那段自己逐字寫著「門檻跟 ① 一起是 820」⇒ 兩塊會安靜漂開,
  //    而漂開之後會出現一個「六軌換版了、橫捲還沒開」(或反過來)的帶。
  // 📌 這一格不判「值該是多少」(上一格判了),它只判**還有幾塊用著這個值**。
  it('🔴 用著這個斷點的 @container 區塊必須【剛好兩塊】(globals.css 自己要求同步)', () => {
    const 塊數 = [
      ...stripCssComments(CSS).matchAll(
        new RegExp(`@container\\s*\\(max-width:\\s*${覆蓋成兩軌的斷點}px\\)`, 'g'),
      ),
    ].length;
    expect(
      塊數,
      `用著 ${覆蓋成兩軌的斷點}px 的 @container 區塊有 ${塊數} 塊,而 globals.css 逐字要求「門檻跟 ① 一起是 820」= 兩塊。` +
        '⇒ 有人只改了其中一塊,兩者會在「六軌換版」與「面板內表格橫捲」之間漂開。',
    ).toBe(2);
  });

  it('✅ 正對照:這道閘的 regex 餵【已知字串】時行為正確(不是恆綠)', () => {
    // 🔴 2026-08-24 code-reviewer N-1:~~原本這格重複上面的 not.toBeNull()~~,零額外判別力。
    //    改成餵已知輸入,兩個方向各一發。
    const re = /@container\s*\(max-width:\s*(\d+)px\)\s*\{[^}]*\.ihead\{display:none\}/;
    expect(re.exec('@container (max-width:820px){.ihead{display:none}')?.[1]).toBe('820');
    expect(re.exec('@container (max-width:820px){.foo{display:none}')).toBeNull();
  });
});
