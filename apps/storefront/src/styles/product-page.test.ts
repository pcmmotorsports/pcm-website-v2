// product-page.test.ts — 商品頁 `product-page.css` 的文字層守門。
//
// 🔴 **這支為什麼在這一片誕生**:附件搬遷片把「安裝資源」面板從安裝段側欄搬到商品介紹下方,
//    而搬過去之後那塊要多寬,是 **Sean 拍板 Q11=A「維持現狀、不放大」**的結果(不是隨手選的數字)。
//    實作端跑過突變 M2:把 `.pd-desc-res` 的 `max-width` 從 480px 改成 960px,**28 條測試全綠** ——
//    因為 jsdom 不讀 CSS,整個測試套件對這個值**零判別力**。
//    ⇒ 一個「改了不會有任何東西紅」的拍板值,正是本 repo `styles/*.test.ts` 這一族存在的理由。
//    `product-page.css` 是商品頁的主樣式檔卻一直沒有自己的守門檔,本片補建。
//
// ⚠️ **它擋不住什麼**:文字層看不到 cascade 勝負、看不到真實渲染尺寸。
//    「面板實際上有沒有變寬」只有真瀏覽器量得到;這裡守的是**宣告字面沒有被改掉**。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const PAGE = strip(read('product-page.css'));
const TABS = read(resolve(HERE, '../components/ProductTabs.tsx'));
const INSTALL = read(resolve(HERE, '../components/InstallResources.tsx'));

function block(src: string, label: string, selector: string): string {
  const i = src.indexOf(selector);
  expect(i, `${label} 找不到選擇器 ${selector}(被改名或刪了?)`).toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  expect(close, `${label} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  expect(body, `${label} 的 ${selector} 區塊內出現巢狀 {`).not.toMatch(/\{/);
  return body;
}

describe('附件搬遷片 · 安裝資源面板寬度(Sean 2026-08-07 拍 Q11=A:維持現狀不放大)', () => {
  // 前提:選擇器還在、而且真的被用著(掛在 JSX className、不是只出現在註解裡)。
  // 🔴 code-reviewer must-fix:原本用 TABS.includes('pd-desc-res') 子字串比對,檔頭有 3 處註解
  //   含這個字串(即使 className 被改名成別的、註解沒動,這條仍會通過);子字串比對也讓
  //   `pd-desc-resX` 誤判命中。改成比對帶引號的完整 JSX 字面 `className="pd-desc-res"`,
  //   而且 TABS 讀的是未 strip 註解的原始檔內容,靠引號把註解排除在外。
  it('前提 — `.pd-desc-res` 這個 class 真的被 ProductTabs 掛在畫面上(不是死 CSS、不是只留在註解裡)', () => {
    expect(
      TABS,
      'ProductTabs.tsx 已經不再有 className="pd-desc-res" ⇒ 下面那條寬度守門守的是一段沒人用的死 CSS,' +
        '就算 class 被改名、只要註解沒動,舊的子字串比對仍會誤判通過',
    ).toMatch(/className="pd-desc-res"/);
  });

  it('🔴 `.pd-desc-res` 的 max-width 必須是 480px —— 這是拍板值,不是可自由調整的樣式偏好', () => {
    const body = block(PAGE, 'product-page.css', '.pd-desc-res');
    expect(
      body,
      'Q11=A 的字面是「壓回側欄原本的寬度(minmax(400px, 480px))、維持搬移前的視覺」;' +
        '要改請先確認 OD 正式稿已落地並取得 Sean 同意,不要當成一般樣式微調',
    ).toMatch(/max-width:\s*480px/);
  });

  // 負向:最可能的誤改就是「讓它填滿 .pd-sec-flow」——那正是 Q11 被否掉的 B 案。
  it('🔴 負向 — 不得被放寬成填滿 `.pd-sec-flow`(960px = Q11 的 B 案,Sean 否了)', () => {
    const body = block(PAGE, 'product-page.css', '.pd-desc-res');
    expect(
      body,
      '把面板放寬到與 .pd-sec-flow 同寬 = 影片比搬移前大一倍 = 視覺改動,而本片的定位是「位置搬移、' +
        '不重設計、等 OD 正式稿」',
    ).not.toMatch(/max-width:\s*960px/);
  });

  // 🔴 code-reviewer must-fix:480px 若無斷點,<900px(平板帶)也會被封頂 —— 但舊 .pd-sec-split
  //   的 minmax(400px, 480px) 只在 @media (min-width: 900px) 內生效,<900px 時無 grid template =
  //   單欄滿版無上限;520–899px 這段「維持搬移前」若不解除封頂就會變窄,是搬移後才有的新視覺改動。
  it('🔴 <900px 必須解除 480px 封頂(否則 Q11=A「維持搬移前」在平板帶不成立)', () => {
    expect(
      PAGE,
      '沒有 `@media (max-width: 899px) { .pd-desc-res { max-width: none; } }` 解除封頂 ⇒ ' +
        '520–899px 這段面板從舊的滿版變成 480px 封頂,是搬移後才有的新視覺改動,與 Q11=A 矛盾',
    ).toMatch(/@media\s*\(max-width:\s*899px\)\s*\{\s*\.pd-desc-res\s*\{\s*max-width:\s*none;?\s*\}\s*\}/);
  });

  // 🔴 R2 跨模型審查(Fable)抓到的繞過路徑:`block()` 用 `indexOf` 只取**第一個**命中的區塊,
  //    所以上面兩條(釘 480 / 擋 960)都只驗那一塊 —— 有人在同檔**後面**再追加一條
  //    `.pd-desc-res { max-width: 960px }` override,cascade 實際輸出 960,而 5 條守門全綠。
  //    「測試名說不得被放寬、斷言只擋原地改字面」= 測試名 > 斷言那一族。用出現次數把它封起來。
  it('🔴 `.pd-desc-res` 在本檔恰好只有 2 個定義點(主規則 + <900px 解除)—— 擋同檔後方 override 繞過', () => {
    const hits = PAGE.split('.pd-desc-res').length - 1;
    expect(
      hits,
      '多出來的定義點會在 cascade 裡蓋掉前面的拍板值,而逐塊比對的守門完全看不到;' +
        '真要新增定義點,請同步更新本條與上面兩條的守門策略',
    ).toBe(2);
  });

  it('前提 — `.pd-sec-flow` 仍是 960px(480 這個值的「窄」是相對它而言;它若變了要重新評估)', () => {
    const body = block(PAGE, 'product-page.css', '.pd-sec-flow');
    expect(body).toMatch(/max-width:\s*960px/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2026-08-09 Q3=A 觸控救援:麵包屑連結命中區
//
// 🔴 **這一組守的是「算出來的命中區」,不是「有沒有寫 padding」** —— 因為本片真瀏覽器實測
//    抓到一個致命形狀:只給連結加 padding、容器不同步撐開時,
//    `getBoundingClientRect().height` **照樣回報 25px**,但 `elementFromPoint` 打在
//    外擴後的上緣與下緣**兩端全部 false** ——`overflow-x: auto` 讓計算後的 `overflow-y`
//    也變成 `auto`(實測 getComputedStyle → "auto"),外擴出去的部分被 scrollport 裁掉了。
//    ⇒ 「量盒高說已修好」是這一片最容易踩的假綠。容器 padding 是**承重**的,不是排版偏好。
//
// ⚠️ **它擋不住什麼**:文字層算不出 `line-height: normal` 的實際行高。這裡之所以算得出來,
//    是因為 `.pd-crumbs` 用了 `font: 400 13px/1` **顯式行高 1**。帳號那兩處算不出來,
//    所以走「實測值 + 釘住 font-size 前提」那條路(見 auth-account.test.ts 同日那組)。
// ───────────────────────────────────────────────────────────────────────────
describe('Q3=A 觸控救援 · 商品頁麵包屑(Sean 2026-08-09 拍板,最小兩處之一)', () => {
  const WCAG_MIN = 24; // WCAG 2.2 SC 2.5.8 Target Size (Minimum)

  /** 取一個 shorthand 的「上/下」兩個值(支援 1-4 值寫法),回傳 [top, bottom]。 */
  function vertical(body: string, prop: 'padding' | 'margin', label: string): [number, number] {
    const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}:\\s*([^;}]+)`));
    expect(m, `${label} 沒有 ${prop} 宣告 ⇒ 命中區外擴根本沒發生`).toBeTruthy();
    const parts = (m?.[1] ?? '').trim().split(/\s+/).map((v) => Number(v.replace('px', '')));
    expect(parts.every((v) => Number.isFinite(v)), `${label} 的 ${prop} 含非 px 值,本守門算不了:${m?.[1]}`).toBe(true);
    // 1 值 → 四邊;2/3 值 → [0] 上、[2] ?? [0] 下;4 值 → [0] 上、[2] 下
    return [parts[0]!, parts.length >= 3 ? parts[2]! : parts[0]!];
  }

  const crumbs = block(PAGE, 'product-page.css', '.pd-crumbs');
  const link = block(PAGE, 'product-page.css', '.pd-crumbs a');

  it('前提 — `.pd-crumbs` 仍是 `font: …13px/1`(行高顯式為 1,下面的命中區才算得出來)', () => {
    const m = crumbs.match(/font:\s*\d+\s+([\d.]+)px\/([\d.]+)\s/);
    expect(m, '`.pd-crumbs` 的 font 簡寫不見了或改了形狀 ⇒ 內容高不再是可推導的,命中區算式失效').toBeTruthy();
    expect(Number(m?.[2]), '行高不再是顯式 1 ⇒ 內容高變成 line-height:normal 那族、文字層算不出來').toBe(1);
  });

  it('🔴 命中區算出來必須 ≥ 24px(WCAG 2.2 目標尺寸最小值)', () => {
    const m = crumbs.match(/font:\s*\d+\s+([\d.]+)px\/([\d.]+)\s/)!;
    const contentH = Number(m[1]) * Number(m[2]);
    const [padTop, padBottom] = vertical(link, 'padding', '`.pd-crumbs a`');
    const hit = contentH + padTop + padBottom;
    expect(
      hit,
      `連結命中區算出來 ${hit}px(內容 ${contentH} + 上 ${padTop} + 下 ${padBottom})< ${WCAG_MIN}px ⇒ ` +
        '手機上這排麵包屑會很難點到。這是 Sean 2026-08-09 Q3=A 挑的最小兩處之一。',
    ).toBeGreaterThanOrEqual(WCAG_MIN);
  });

  it('🔴 容器 padding 必須 ≥ 連結 padding —— 否則外擴的部分被 overflow 裁掉(盒高照報、點不到)', () => {
    const [linkTop, linkBottom] = vertical(link, 'padding', '`.pd-crumbs a`');
    const [navTop, navBottom] = vertical(crumbs, 'padding', '`.pd-crumbs`');
    const why =
      '`.pd-crumbs` 有 overflow-x:auto ⇒ 計算後的 overflow-y 也是 auto(真瀏覽器 getComputedStyle 實測),' +
      '連結外擴超出容器 padding box 的部分會被 scrollport 裁掉。' +
      '實測突變:只留連結 padding、拿掉容器 padding ⇒ getBoundingClientRect().height 仍回報 25px,' +
      'elementFromPoint 打上緣與下緣**兩端都 false**。盒高不是命中區。';
    expect(navTop, `容器上 padding ${navTop}px < 連結 ${linkTop}px ⇒ ${why}`).toBeGreaterThanOrEqual(linkTop);
    expect(navBottom, `容器下 padding ${navBottom}px < 連結 ${linkBottom}px ⇒ ${why}`).toBeGreaterThanOrEqual(linkBottom);
  });

  it('前提 — `.pd-crumbs` 仍有 overflow-x:auto(上一條「容器要撐開」的存在理由;它沒了要重估)', () => {
    expect(
      crumbs,
      'overflow-x 不見了 ⇒ 裁切前提消失,上一條守門變成沒有理由的約束、該重新評估而不是留著當包袱',
    ).toMatch(/overflow-x:\s*auto/);
  });

  it('🔴 外擴必須被等量負 margin 收回 —— 這是「視覺零變化」的機械保證', () => {
    const [linkPadTop, linkPadBottom] = vertical(link, 'padding', '`.pd-crumbs a`');
    const [linkMarTop, linkMarBottom] = vertical(link, 'margin', '`.pd-crumbs a`');
    expect(linkMarTop, `連結上 margin ${linkMarTop} ≠ -${linkPadTop} ⇒ 麵包屑會整排往下推、版面被改到`).toBe(-linkPadTop);
    expect(linkMarBottom, `連結下 margin ${linkMarBottom} ≠ -${linkPadBottom} ⇒ 同上`).toBe(-linkPadBottom);

    const [navPadTop, navPadBottom] = vertical(crumbs, 'padding', '`.pd-crumbs`');
    const [navMarTop, navMarBottom] = vertical(crumbs, 'margin', '`.pd-crumbs`');
    expect(navMarTop, `容器上 margin ${navMarTop} ≠ -${navPadTop} ⇒ 麵包屑整塊往下掉 ${navPadTop}px`).toBe(-navPadTop);
    expect(
      navPadBottom + navMarBottom,
      `容器下 padding+margin = ${navPadBottom + navMarBottom}px ≠ 24px ⇒ 麵包屑與下方主區的間距被改掉了` +
        '(24px 是這一片動手前的原值,真瀏覽器量到下一個元素 top=134 不變)',
    ).toBe(24);
  });
});

describe('說明書 chip 的長標籤(Sean 2026-08-19 親自報:手機商品頁可以往右滑)', () => {
  // 🔴 為什麼要守這兩條:標籤來自**供應商官方 PDF 檔名**,長度我們控制不了。
  //    正式站實測(390 視窗、repo 自己的 overflow-ruler、selfCheck.ok=true):
  //      修前  findings=[a.pd-ir-doc-sm over=301 w=656]   document.scrollWidth 691
  //      修後  findings=[]                                document.scrollWidth 390
  //    而**兩條宣告都在承重** —— 只加 max-width、留著 nowrap ⇒ 仍溢出 266px(scrollWidth 679)。
  // ⚠️ 本檔是文字層守門:它看不到 cascade 勝負、看不到真實渲染寬度(檔頭已聲明)。
  //    「真的不再撐寬」只有真瀏覽器量得到,那份量測寫在
  //    docs/specs/2026-08-19-g1-manual-label-overflow-plan.md。
  it('前提 — `.pd-ir-doc-n` 真的被 InstallResources 掛在畫面上(不是死 CSS)', () => {
    expect(
      INSTALL,
      'InstallResources.tsx 已經不再有 className="pd-ir-doc-n" ⇒ 下面兩條守的是沒人用的死 CSS',
    ).toMatch(/className="pd-ir-doc-n"/);
  });

  it('🔴 `.pd-ir-doc-n` 不得是 `white-space: nowrap` —— 82 字的標籤會把整頁撐寬', () => {
    const body = block(PAGE, 'product-page.css', '.pd-ir-doc-n');
    expect(
      body,
      'nowrap 是逐字搬 OD pcm-product.css:708 的結果,而 OD 的長標籤樣本只有 20 字、' +
        '真實世界那一筆 82 字 ⇒ design 是沉默不是決定(同 #309,代裁人 MAIN、可推翻)',
    ).not.toMatch(/white-space:\s*nowrap/);
    expect(body, '要能換行,否則單一個長 chip 仍取 max-content 寬').toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('🔴 `.pd-ir-doc-sm` 必須有 `max-width: 100%` —— flex-wrap 只換行、不會讓單一 chip 縮', () => {
    const body = block(PAGE, 'product-page.css', '.pd-ir-doc-sm');
    expect(
      body,
      '正式站實測:只留 overflow-wrap 而拿掉 max-width,chip 仍可寬過容器',
    ).toMatch(/max-width:\s*100%/);
  });

  it('前提 — `.pd-ir-doc-s`(PDF · 大小)維持 nowrap:它短、拆行反而醜,不在本次射程', () => {
    const body = block(PAGE, 'product-page.css', '.pd-ir-doc-s ');
    expect(body, '若它也被改動,表示有人把本次射程擴大了 ⇒ 回頭確認是不是誤改').toMatch(
      /white-space:\s*nowrap/,
    );
  });
});
