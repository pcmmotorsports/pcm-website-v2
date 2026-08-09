// content-pages.test.ts — 第1批(/info/shipping、/terms、/privacy、404)的文字層守門
// 全站重設計 · 2026-08-06
//
// 🔴 **這支存在的理由**:第1批的五筆改動裡有四筆是「改了也沒有任何東西會紅」的形狀 ——
//    font-family 修 typo、段落 margin、`<strong>` 的顏色、版寬換 token。既有測試不看 CSS 值,
//    真瀏覽器實看只發生一次。沒有這支的話,任何一筆被改回去都是零訊號的迴歸。
//
// ⚠️ **它擋不住什麼**:文字層只看得到「規則寫成什麼」,看不到 cascade 的實際勝負與實際渲染值。
//    404 主鈕那一組**特別倚賴 cascade**(見下面「前提」那個 describe),所以那裡除了值本身,
//    還把它依賴的兩個前提(`.btn-primary` 仍墨黑、error.css 仍後載)一起釘死 ——
//    前提消失時測試會紅,而不是靜默失效。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// 剝註解:本片的註解逐字引用了舊值(`var(--font-mono)`、`margin: 0`、`var(--c-text)`),
// 對原文比對會命中註解而不是規則本體。
const SHIPPING = strip(read('pages-shipping.css'));
const ERROR = strip(read('error.css'));
const CART = strip(read('cart.css'));
// 🔴 R1 nit N8:初版是拿 `indexOf('styles/cart.css')` 對整支 `layout.tsx` 比位置。
//    今天兩個字串只出現在 import 行所以量對了,但只要有人在前面的註解裡寫下這兩個路徑,
//    「誰先誰後」就會靜默量到註解的位置。改成**只抽 import 陳述本身**再比序 ——
//    對註解(不論 `/* */` 或 `//`)完全免疫,不用先猜要剝哪一種。
const LAYOUT_CSS_IMPORTS = read('../app/layout.tsx')
  .split('\n')
  .map((l) => /^\s*import\s+'\.\.\/styles\/([\w.-]+\.css)'\s*;/.exec(l)?.[1])
  .filter((f): f is string => f !== undefined);

/** 取某個選擇器的宣告區塊(平規則;內含巢狀 `{` 一律當前提失效直接紅)。 */
function block(src: string, label: string, selector: string): string {
  const i = src.indexOf(selector);
  expect(i, `${label} 找不到選擇器 ${selector}(被改名或刪了?)`).toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  expect(close, `${label} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  expect(body, `${label} 的 ${selector} 區塊內出現巢狀 {(平規則前提已失效)`).not.toMatch(/\{/);
  return body;
}

/** 取一個 @media 條件的整段內文(大括號走訪,不用正規式 —— `[^}]*` 跨不過內層 `{`)。 */
function mediaBlock(src: string, cond: string): string {
  const at = src.indexOf(cond);
  expect(at, `找不到 @media 段:${cond}`).toBeGreaterThan(-1);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  expect.fail(`@media 段 ${cond} 沒有閉合`);
}

describe('第1批 · /info/shipping 配送卡編號眉標', () => {
  it('🔴 .shipping-card-num 吃 --f-mono(修掉真站既有的 --font-mono typo)', () => {
    const body = block(SHIPPING, 'pages-shipping.css', '.shipping-card-num');
    expect(body, '編號眉標沒吃 --f-mono ⇒ 不是等寬字').toMatch(/font-family:\s*var\(--f-mono\)/);
    // 反面:退回 typo。`--font-mono` 只在 product-page.css 的 `.pd-page` scope 內定義、
    // 本頁取不到 ⇒ 宣告失效、靜默 fallback 成內文字體,肉眼要並排才看得出來。
    expect(body, '編號眉標退回 var(--font-mono) typo ⇒ 宣告失效、又變回內文字體').not.toMatch(
      /var\(--font-mono\)/,
    );
  });

  it('🔴 面層 — 整支 pages-shipping.css 不得再出現 var(--font-mono)', () => {
    // 逐點斷言只守得住現在這一個消費點;這條守的是「有人又寫了第二個」。
    expect(SHIPPING, 'pages-shipping.css 又出現 var(--font-mono)').not.toMatch(/var\(--font-mono\)/);
  });

  it('🔴 顏色仍吃 --c-accent(設計端逐字放行「不另外改字面」)', () => {
    const body = block(SHIPPING, 'pages-shipping.css', '.shipping-card-num');
    expect(body, '編號眉標的色被改了 ⇒ 偏離設計端明文放行的字面').toMatch(
      /color:\s*var\(--c-accent\)/,
    );
  });
});

describe('第1批 · 法律頁段落間距(設計端 §七 推薦 A)', () => {
  it('🔴 .policy-block p 有 10px 段距', () => {
    const body = block(SHIPPING, 'pages-shipping.css', '.policy-block p {');
    expect(body, '段距被改回 margin: 0 ⇒ 多段長文又擠成一整塊').toMatch(/margin:\s*0 0 10px/);
    // 反面:只比第一值會讓 `margin: 0` 也通過(shell-detail 那輪踩過的形狀),故釘完整 shorthand。
    expect(body, '段距退回 margin: 0').not.toMatch(/margin:\s*0\s*;/);
  });

  it('🔴 最後一段歸零(否則段距會疊到區塊自己的 padding-bottom 上)', () => {
    const body = block(SHIPPING, 'pages-shipping.css', '.policy-block p:last-child');
    expect(body, '最後一段沒歸零').toMatch(/margin-bottom:\s*0/);
  });

  it('🔴 .policy-block strong 吃 --c-text(粗體要比內文深,不是只有粗)', () => {
    const body = block(SHIPPING, 'pages-shipping.css', '.policy-block strong');
    expect(body, '法律頁粗體沒吃 --c-text ⇒ 繼承 --c-text-2 灰、強調力道被吃掉一半').toMatch(
      /color:\s*var\(--c-text\)/,
    );
  });
});

describe('第1批 · 版寬與殼切齊(DESIGN-HANDOFF §4-2)', () => {
  // §4-2 逐字:「其餘頁面主體吃 --shell-bar-max,與殼左右緣切齊」(只有商品列表主體維持拉滿)。
  it.each([['.page-hero-inner'], ['.shipping-body']])('%s 吃 --shell-bar-max', (sel) => {
    const body = block(SHIPPING, 'pages-shipping.css', sel);
    expect(body, `${sel} 沒與殼切齊`).toMatch(/max-width:\s*var\(--shell-bar-max\)/);
    expect(body, `${sel} 退回 --content-max(1600)⇒ 比殼寬 160px、右緣對不齊`).not.toMatch(
      /var\(--content-max\)/,
    );
  });

  it('🔴 前提 — --shell-bar-max 與 --content-max 仍是兩顆不同值的 token', () => {
    // 上面兩條的意義完全建立在「兩顆不同值」上。哪天有人把 --content-max 直接改成 1440,
    // 上面兩條照樣綠,但這條會紅 —— 提醒你那時候應該回頭把逐點換收斂回單顆 token。
    const tokens = strip(read('tokens.css'));
    expect(tokens, 'tokens.css 找不到 --shell-bar-max: 1440px').toMatch(
      /--shell-bar-max:\s*1440px/,
    );
    expect(tokens, '--content-max 已被改成 1440 ⇒ 逐點換的理由消失,該收斂回單一 token 了').toMatch(
      /--content-max:\s*1600px/,
    );
  });
});

describe('第1批 · 平板段(600-1079px)', () => {
  const TABLET = '@media (min-width: 600px) and (max-width: 1079px)';

  it('🔴 平板段存在且蓋掉手機值(900px 段是為手機寫的,平板整段吃到)', () => {
    const seg = mediaBlock(SHIPPING, TABLET);
    expect(seg, '平板段沒調頁首大標').toMatch(/\.page-hero-title\s*\{[^}]*font-size:\s*30px/);
    // 🔴 R1 nit N1:初版寫成對整段比 `/font-size:\s*15px/`,**沒綁選擇器** ⇒ 把
    //    `, .policy-block li` 拿掉(平板 `<li>` 就不放大)照樣全綠。改成連選擇器一起釘。
    // 🔴 R1 nit N2:`line-height: 1.85` 初版全程無斷言 ⇒ 改回 1.7 是零訊號迴歸,
    //    而行高正是「平板要好讀」的另一半。一起釘進同一條 regex。
    expect(seg, '平板段沒同時調 p 與 li 的字級/行高').toMatch(
      /\.policy-block p,\s*\.policy-block li\s*\{[^}]*font-size:\s*15px[^}]*line-height:\s*1\.85/,
    );
    expect(seg, '平板段沒調編號眉標').toMatch(/\.shipping-card-num\s*\{[^}]*font-size:\s*12px/);
    // 🔶 Sean 2026-08-06 拍板 Q1=A:FAQ 問 16 / 答 15。**綁選擇器**(我自己 nit N1 的教訓:
    //    只比 `font-size: 16px` 的話,套錯選擇器照樣綠)。
    expect(seg, '平板段 FAQ 的「問」沒加大到 16px').toMatch(
      /\.shipping-content \.faq-item summary\s*\{[^}]*font-size:\s*16px/,
    );
    expect(seg, '平板段 FAQ 的「答」沒加大到 15px').toMatch(
      /\.shipping-content \.faq-item p\s*\{[^}]*font-size:\s*15px/,
    );
  });

  it('🔴 平板段不含 .faq-q / .faq-a —— 那兩個 class 在真站與設計稿都是 0 命中(死規則)', () => {
    // 搬死規則進來的症狀是「看起來有守到、實際什麼都沒發生」,比不搬更糟:
    // 下一個人會以為平板 FAQ 字級已經處理過了。
    const seg = mediaBlock(SHIPPING, TABLET);
    expect(seg, '死規則 .faq-q 被搬進來了').not.toMatch(/\.faq-q\b/);
    expect(seg, '死規則 .faq-a 被搬進來了').not.toMatch(/\.faq-a\b/);
    // 前提:真站的 FAQ 選擇器確實不叫 faq-q/faq-a(哪天真站改名了,上面兩條就失去意義)。
    // 🔴 R1 nit:初版比整檔 ⇒ **被本批在平板段內新增的同一串選擇器自我滿足** ——
    //    就算桌機的基準規則被改名,這條前提照樣綠。改成只比平板段**以外**的區段。
    const outsideTablet = SHIPPING.slice(0, SHIPPING.indexOf(TABLET));
    expect(outsideTablet, '桌機基準的 .shipping-content .faq-item 規則不見了 ⇒ 上面兩條要重想').toMatch(
      /\.shipping-content \.faq-item summary\s*\{/,
    );
  });
});

describe('第1批 · 404 主 CTA 熔橘化', () => {
  it('🔴 .err-btn-primary 底色與框線同為亮熔橘(不是橘底黑框、也不是黑底橘框)', () => {
    const body = block(ERROR, 'error.css', '.err-btn-primary {');
    expect(body, '404 主鈕底色不是熔橘').toMatch(/background:\s*var\(--c-red\)/);
    expect(body, '404 主鈕框線不是熔橘').toMatch(/border:\s*1px solid var\(--c-red\)/);
    // 反面:只改一半 = 設計稿從未指定過的中間態。
    expect(body, '404 主鈕框線退回墨黑 ⇒ 橘底配黑框').not.toMatch(
      /border:\s*1px solid var\(--c-text\)/,
    );
  });

  it('🔴 hover 時底色與框線一起走深熔橘(否則 hover 剩一圈亮橘邊)', () => {
    const body = block(ERROR, 'error.css', '.err-btn-primary:hover');
    expect(body, 'hover 底色不是深熔橘').toMatch(/background:\s*var\(--c-red-dark\)/);
    expect(body, 'hover 框線沒跟著走深熔橘').toMatch(/border-color:\s*var\(--c-red-dark\)/);
  });
});

describe('🔴 第1批 · 404 主鈕那個 scope 的兩個前提(前提消失要紅,不是靜默失效)', () => {
  // 設計端的作法是「`.btn-primary` 全域熔橘 + `.err-btn-primary` 只補框線」。
  // 真站今天做不到那樣(`.btn-primary` 的消費點有 9 個在 /checkout,金流頁不在本批範圍),
  // 所以改成把底色也收進 `.err-btn-primary`。這個做法**倚賴兩個前提**,兩個都在這裡釘住。

  it('前提① — cart.css 的 .btn-primary 仍是墨黑,且白字仍由它提供', () => {
    const body = block(CART, 'cart.css', '.btn-primary {');
    expect(
      body,
      '.btn-primary 已熔橘化 ⇒ 去把 error.css 的 background 兩行刪掉(重複宣告),並重跑 404 實看',
    ).toMatch(/background:\s*var\(--c-text\)/);
    // 🔴 R1 nit N4:`.err-btn-primary` 折入了底色與框線,但白字 `color: #fff` **仍完全倚賴這裡**。
    //    熔橘底白字是這顆鈕的核心視覺,少了它就是熔橘底配墨黑字(且對比只剩 3.1 的反面)。
    //    這條讓「有人動了 cart.css 的 color」變成紅,而不是 404 頁悄悄變醜。
    // 🔴 2026-08-09 Q4=B:白字改由 `var(--c-text-inverse)` 提供(底色 `var(--c-text)` 是它的反相對,
    //    深色模式要一起翻)。本條守的是「**白字還在**」而非寫法 ⇒ 兩種都收、第三種顏色照樣紅。
    expect(body, '.btn-primary 不再提供白字 ⇒ 404 主鈕會變成熔橘底配深色字').toMatch(
      /color:\s*(#fff\b|var\(\s*--c-text-inverse\s*\))/i,
    );
  });

  it('前提② — layout.tsx 的 import 序:error.css 必須晚於 cart.css', () => {
    // `.btn-primary` 與 `.err-btn-primary` 同為單一 class(specificity 0,1,0)⇒ 平手時後載勝。
    // 有人把 import 重新排序 = 404 主鈕靜默變回墨黑,而所有值斷言照樣全綠。
    const cart = LAYOUT_CSS_IMPORTS.indexOf('cart.css');
    const err = LAYOUT_CSS_IMPORTS.indexOf('error.css');
    expect(cart, 'layout.tsx 抽不到 cart.css 的 import 陳述').toBeGreaterThan(-1);
    expect(err, 'layout.tsx 抽不到 error.css 的 import 陳述').toBeGreaterThan(-1);
    expect(
      err,
      'error.css 被排到 cart.css 前面 ⇒ .btn-primary 的墨黑會蓋掉 404 主鈕的熔橘',
    ).toBeGreaterThan(cart);
  });

  // 🔴 確認輪 N3:上一條只比了 cart.css 這**一個**已知的 `.btn-primary` 定義點。
  //    但真正的不變量是「error.css 之後,沒有任何檔再定義 `.btn-primary`」——
  //    `.btn-primary` 與 `.err-btn-primary` 同為 (0,1,0),平手時後載勝,
  //    所以第二個定義點只要出現在 error.css 之後,404 主鈕就靜默變回墨黑,
  //    而上一條(只看 cart↔error 的相對序)照樣綠。
  it('前提②b — layout.tsx 裡排在 error.css 之後的檔,都不得再定義 .btn-primary', () => {
    const err = LAYOUT_CSS_IMPORTS.indexOf('error.css');
    const after = LAYOUT_CSS_IMPORTS.slice(err + 1);
    expect(after.length, 'error.css 已是最後一支 CSS ⇒ 本條前提已失效,改守別的').toBeGreaterThan(0);
    after.forEach((f) => {
      // `\.btn-primary` 前面帶點 ⇒ 不會誤命中 `.cs-btn-primary` / `.err-btn-primary`;
      // 後面的 negative lookahead 擋掉 `.btn-primary-ghost` 之類的別的 class。
      expect(strip(read(f)), `${f} 排在 error.css 之後又定義了 .btn-primary ⇒ 404 主鈕會被蓋回墨黑`)
        .not.toMatch(/\.btn-primary(?![\w-])/);
    });
  });
});
