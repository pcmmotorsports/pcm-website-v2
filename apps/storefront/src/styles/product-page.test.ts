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
