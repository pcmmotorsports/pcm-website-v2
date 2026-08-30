import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 這一格防的是**一個已經在這片發生過的病**:寫一個 `print-a4.css` 裡不存在的 class。
//
// 🔴 **為什麼需要它** —— 那個錯的症狀是「畫面沒有樣式」,而
//   `typecheck` / `lint` / `build` / 既有的 render 測試**沒有一把尺會 parse class 有沒有對應規則**。
//   實錘:`statement/page.tsx` 2026-08-29 第一版用了 `mx-auto max-w-2xl px-4 py-16` 那類 Tailwind class,
//   **10 格測試全綠、三綠也全綠**,而 storefront 根本沒有 Tailwind
//   (`grep tailwind apps/storefront/package.json` ⇒ 0)⇒ 那些 class 一條 CSS 都產不出來。
//
// ⚠️ **射程(照實寫,不要把它讀得比它大)**:
//   · 它只掃**字面上的 `className='…'`**;動態拼出來的 class 它看不到。
//   · 它只證「這個名字在某支 CSS 裡出現過」,**證不了那條規則畫出來是對的** —— 那要開瀏覽器。
//   · 🔴 短名子類(`k` / `v` / `big` / `code` / `addr` / `grand` / `n`)**有掃,而它們是【弱】的一格**:
//     `.v` 這種一個字母的比對很容易在 1000 行 CSS 裡撞到別的東西 ⇒ 它們過了**不代表接對了**。
//     真正的判別力集中在 `pd-*` 與 `stmt-*` 那些長名字上。

const HERE = join(__dirname);
const REPO = join(__dirname, '../../../../..');

const SOURCES = [
  join(HERE, 'statement-doc.tsx'),
  join(HERE, 'statement-print-button.tsx'),
];
const STYLESHEETS = [
  join(REPO, 'apps/storefront/src/styles/print-a4.css'),
  join(REPO, 'apps/storefront/src/styles/statement.css'),
  join(REPO, 'apps/storefront/src/styles/account.css'),
];

/** `className='a b c'` → ['a','b','c'];只吃單引號字面(本 repo 的 JSX 慣例)。 */
function classNamesIn(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/className='([^']+)'/g)) {
    for (const name of m[1]!.split(/\s+/)) if (name !== '') out.add(name);
  }
  return [...out].sort();
}

// 🔴 **白名單:掛在 markup 上而【CSS 本來就沒有規則】的類。**
//    每一條都要寫得出「為什麼它是對的」—— 一個沒有理由的白名單條目,
//    與一個「我改不動所以把它關掉」的條目在檔案上長得一樣。
const HOOK_ONLY: Record<string, string> = {
  // 純結構包裝:`.pd-contact{display:flex}` 需要一個子節點裝那三行字,
  // 而三個子類(`.pd-ch` / `.pd-cu` / `.pd-cp`)各自有規則。OD 稿自己也是零規則。
  // 後台那張的同款白名單:`apps/admin/src/app/print/print-a4-css.test.ts:261`(逐字同理由)。
  'pd-ctxt': '純結構包裝;稿與 print-a4.css 都零規則,三個子類才帶樣式。',
  // 🔴 這一個是**本格自己抓到的**,而它在後台那張紙上【也是死的】:
  //    `print-a4.css` 有 `.pd-money tr.grand td`(3 條),而 `tr.line` **零條**。
  //    後台那道 orphan 守門只掃 `pd-*` 開頭的名字 ⇒ 這個名字在它的分母外,一直沒有人看到。
  //    🛑 **不刪掉它** —— Sean 拍的是「一模一樣」,兩張紙的 markup 要對得起來;
  //       而它今天不產生任何視覺差異。已回報主視窗 `-48`(那一格歸後台那條線)。
  line: '後台那張同樣掛著它而 CSS 零規則(只有 tr.grand 有);不產生視覺差異,為對齊 markup 保留。',
};

// 🔴 **比對前先剝掉 CSS 註解**(R1 nit):`print-a4.css` 裡住著大量**劃掉的** `.pd-*` 名字
//    (那支檔的慣例是「舊字面留著不刪」)⇒ 不剝的話,一個**從註解裡復活**的 class
//    會安靜地通過這一格 —— 而那正是它要防的那種錯。
const stripCssComments = (css: string) => css.replace(/\/\*[^]*?\*\//g, ' ');
const css = STYLESHEETS.map((p) => stripCssComments(readFileSync(p, 'utf8'))).join('\n');
/** CSS 裡有沒有一條規則用到這個名字(`.name` 後面必須是分界字元,避免 `.pd-num` 命中 `.pd-number`)。 */
const hasRule = (name: string) => new RegExp(`\\.${name}(?![\\w-])`).test(css);

describe('statement 版面用到的 class 都有對應 CSS 規則', () => {
  const used = SOURCES.flatMap(classNamesIn);

  // 🔴 分母先釘住:掃不到任何 class 時,下面那個 `for` 會跑 0 次而**印一個綠的**
  //    —— 這正是「一發紅零格」的鏡像(鐵則 11 那條「我餵幾條 vs 它跑幾支」)。
  it('掃到的 class 數量 > 10(證明抽取器沒有失效)', () => {
    expect(used.length).toBeGreaterThan(10);
  });

  it.each(used)('%s 有規則(或在白名單裡)', (name) => {
    expect(hasRule(name) || name in HOOK_ONLY).toBe(true);
  });

  // 🔴 白名單本身要是活的 —— 規則補上之後它必須被移除,
  //    否則下一個人會以為那個類仍然沒有樣式。
  it.each(Object.entries(HOOK_ONLY))('白名單 %s 必須【真的】還零規則', (name, why) => {
    expect(why.length, `${name} 的白名單理由是空的`).toBeGreaterThan(10);
    expect(hasRule(name), `${name} 已經有 CSS 規則了 ⇒ 請把它從白名單移除`).toBe(false);
  });

  it('負對照:一個現造的名字必須查無(證明這把尺不是恆真)', () => {
    expect(hasRule('zzz-not-a-real-class')).toBe(false);
  });
});
