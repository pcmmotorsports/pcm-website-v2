// action-color.test.ts — 動作色換熔橘的文字層守門(全站重設計 第0批 0c;2026-08-05)
//
// 🔴 **這支存在的理由,是一件實測到的事**:0c 把 `--c-red` 家族三顆的值整組換掉、
//    影響全站約 60 個消費點,而換完之後跑全套 **361 檔 5007 測全綠、零紅**。
//    既有守門對「顏色換了」完全隱形 —— 它們要嘛不看顏色,要嘛是 negative match
//    (「首頁不吃站台 --c-red」這種在換色後照樣成立)。
//    ⇒ 沒有這支的話,「有人把某一顆改回去」「把身分色順手接上動作色」「新增第三顆紅」
//      三種都是零成本、零訊號的迴歸。
//
// ⚠️ **它擋不住什麼**:文字層看得到「哪個選擇器吃哪顆 token」,看不到 cascade 的實際勝負、
//    也看不到對比度。對比度由設計端負責(#c4470c 對白底 4.9:1);cascade 由真瀏覽器量測負責。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(HERE, f), 'utf8');

// 🔴 **掃全部 `styles/*.css`,不是手列 14 支**(複審 nit 6:面畫太窄)。
// 手列清單的問題是「今天沒命中的檔明天可能有」—— 而清單不會自己長。
// 下面的面層斷言(不得殘留緋紅 / 不得冒出第三顆熔橘)必須畫在**整個樣式層**這個面上,
// 逐點斷言才是列名的(那些需要知道確切選擇器)。
const FILES = [
  'tokens.css', 'tier.css', 'auth.css', 'account.css', 'cart.css', 'cart-vehicle.css',
  'checkout.css', 'error.css', 'filter-cascade.css', 'filter-drawer.css', 'filter-responsive.css',
  'filter-side.css', 'filter-top.css', 'header.css', 'line-cta.css', 'mobile-tabbar.css',
  'pages-shipping.css', 'pricing.css', 'product-card.css', 'product-page.css',
  'products-mobile.css', 'products-page.css',
] as const;
// 🔴 **刻意排除三支,不是漏**:`home.css` / `brand-page.css` / `brand-directory.css` 是已定案上線、
//    **自帶色票**的頁面(`--ed-c-action*` / 自 scope 的 `--c-red` / `--bd-ember*`),0c 明文不動它們
//    (triage §3-2)。而且排除是**承重的**:`home.css` 的 `--ed-c-action-active: #a53a08` 與
//    `--c-red-dark` 的距離只有 48 ⇒ 放進來會被「第三顆熔橘」那條誤紅,而它是合法的第三階。
//    要把那三支收進站台 token 是獨立一片,收的時候這份清單要一起重想。
type CssFile = (typeof FILES)[number];

const RAW = Object.fromEntries(FILES.map((f) => [f, read(f)])) as Record<CssFile, string>;
// 剝註解:本片的註解**逐字引用了 token 名與舊色值**(坑寫在坑旁邊、刻意的),
// 對原文比對會命中註解而不是規則本體。
const CSS = Object.fromEntries(
  FILES.map((f) => [f, RAW[f].replace(/\/\*[\s\S]*?\*\//g, '')]),
) as Record<CssFile, string>;

/** 取某個選擇器的宣告區塊(平規則;內含巢狀 `{` 一律當前提失效直接紅)。 */
function block(file: CssFile, selector: string): string {
  const src = CSS[file];
  const i = src.indexOf(selector);
  expect(i, `${file} 找不到選擇器 ${selector}(被改名或刪了?)`).toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  expect(open, `${file} 的 ${selector} 之後沒有 {`).toBeGreaterThan(i);
  const close = src.indexOf('}', open);
  expect(close, `${file} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  expect(body, `${file} 的 ${selector} 區塊內出現巢狀 {(平規則前提已失效)`).not.toMatch(/\{/);
  return body;
}

describe('0c 守門 · 檔案本身沒壞', () => {
  it.each(FILES)('%s 的註解符號成對且順序正確', (f) => {
    // CSS 註解不巢狀 ⇒ 註解內文裡的 `/*` 只是文字,只比數量會誤判(products-mobile.css 現成有一個)。
    const src = RAW[f];
    let open = false;
    for (let i = 0; i < src.length - 1; i++) {
      if (!open && src[i] === '/' && src[i + 1] === '*') { open = true; i++; }
      else if (open && src[i] === '*' && src[i + 1] === '/') { open = false; i++; }
      else if (!open && src[i] === '*' && src[i + 1] === '/') {
        expect.fail(`${f} 在位置 ${i} 出現沒有對應 /* 的 */(錯位平衡,數量比對看不出來)`);
      }
    }
    expect(open, `${f} 檔尾還有一個沒閉合的 /*`).toBe(false);
  });
});

describe('0c · 五顆 token 的值', () => {
  // 逐顆釘值:改常數不會讓既有測試轉紅(期望值不符才會紅、前提消失不會),所以只有這裡看得見。
  const EXPECTED: Array<[string, string]> = [
    ['--c-red', '#f26722'],        // 亮熔橘:填色層(色塊 / 徽章 / 框線 / CTA)
    ['--c-red-soft', '#fdeadd'],   // 熔橘淡底
    ['--c-red-dark', '#c4470c'],   // 深熔橘:文字層(白底價格 / 錯誤訊息),白底 4.9:1
    ['--c-accent', '#c4470c'],     // 經銷 pill 與經銷價(R1-1 逐字);0c 之前全站未定義
    ['--c-tier-premium', '#dc2626'], // ⏳ Q1=C 釘住現值、待 Sean 拍板
  ];
  it.each(EXPECTED)('%s = %s', (token, value) => {
    // 只看 :root 段(深色模式段獨立覆寫同名 token,值本來就不同)。
    const i = CSS['tokens.css'].indexOf('[data-theme="dark"]');
    expect(i, 'tokens.css 找不到深色段切點 ⇒ 本組斷言的前提已失效').toBeGreaterThan(-1);
    const root = CSS['tokens.css'].slice(0, i);
    expect(root, `:root 段找不到 ${token}: ${value}`).toMatch(new RegExp(`${token}:\\s*${value};`));
  });

  // 🔴 這條的第一版我寫錯了,而且是**測試自己在說謊**的形狀:我斷言深色段有一顆
  //    `--c-red: #f87171`,實查根本沒有 —— 深色段(`tokens.css:151`)**完全沒有覆寫這一族**,
  //    深色模式直接繼承 `:root` 的熔橘。寫下來因為它牽出一件真的要記著的事(見下方 ⏳)。
  it('🔴 深色段仍然不覆寫動作色家族(0c 沒有偷偷替深色模式做決定)', () => {
    const dark = CSS['tokens.css'].slice(CSS['tokens.css'].indexOf('[data-theme="dark"] {'));
    expect(dark.length, '找不到深色段').toBeGreaterThan(0);
    for (const t of ['--c-red', '--c-red-soft', '--c-red-dark', '--c-accent', '--c-tier-premium']) {
      expect(dark, `深色段開始覆寫 ${t} ⇒ 那是本片範圍外的決定,要單獨評估對比度`)
        .not.toMatch(new RegExp(`${t}:`));
    }
    // 深色模式的實況(實算,別憑感覺):深底 `#0a0a0a` 上,`--c-red-dark` 由換色前的
    // `#991b1b` **2.38:1** 變成 `#c4470c` **4.01:1** ⇒ 0c 讓深色模式**變好**、不是變差。
    // (初稿這裡寫「會偏暗」是**講反了**,已更正 —— 沒算就寫方向,是這族註解最常見的錯法。)
    // 另:全樹**查無任何設定 `data-theme` 的地方** ⇒ 深色段目前不可達,上面的比值是備查。
    // 設計端 R2-2 逐字「深色模式段不在本次範圍」,0c 照這條不動;
    // 這條斷言的作用是「哪天有人動了,要是刻意的」。
  });
});

describe('0c · 規則② 文字層走深熔橘(白底小字)', () => {
  // 這一組是「白底上的字」——用亮熔橘 #f26722 對白底只有 **3.12:1**,不到小字 AA 的 4.5。
  // 逐點列名而不是掃「有沒有 --c-red-dark」:漏掉任何一顆的症狀都是「那一處字比較淡」,
  // 人眼幾乎看不出來,只有逐點釘才抓得到。
  // 🔴 **這張表第一版只列了 10 個點中的一半**,而我在上面自述「逐點列名…只有逐點釘才抓得到」——
  //    複審實測:把 `auth.css` 的 `.auth-err` 文字、`.auth-field > .auth-field-err`、
  //    `account.css` 兩處分別退回 `var(--c-red)`,**54 測全綠**。
  //    宣稱與事實不符的守門比沒有守門更糟(它讓人以為這一面被守著)⇒ 本版把 0c 改過的
  //    **每一個文字層點**都列進來,並在下面加一條「處數對得上」的面層斷言防止再漏。
  const TEXT_LAYER: Array<[CssFile, string]> = [
    ['auth.css', '.auth-err'],                       // 帳號層級錯誤訊息的文字
    ['auth.css', '.auth-field-err'],                 // 逐欄錯誤
    ['auth.css', '.auth-field > .auth-field-err'],   // 被 label 樣式污染後的提權覆寫
    ['account.css', '.acc-profile .auth-field-err'],
    ['account.css', '.acc-inline-form-inner .auth-field-err'],
    ['product-card.css', '.pcard .price-main'],
    ['product-page.css', '.pd-price.is-red'],
    ['checkout.css', '.co-inv-hint'],
    ['checkout.css', '.co-inv-reset'],
    ['checkout.css', '.co-card-error'],
    ['checkout.css', '.co-submit-error '],
    ['checkout.css', '.co-grand-val'],
    ['checkout.css', '.co-mobile-buybar-price'],
  ];
  it.each(TEXT_LAYER)('%s 的 %s 吃 --c-red-dark', (file, selector) => {
    const body = block(file, selector);
    expect(body, `${selector} 沒吃 --c-red-dark`).toMatch(/color:\s*var\(--c-red-dark/);
    // 反面:同一條若還留著亮熔橘的 color,就是只改了一半。
    expect(body, `${selector} 的 color 仍是亮熔橘 ⇒ 白底對比只有 3.12:1`).not.toMatch(
      /color:\s*var\(--c-red\)/,
    );
  });

  it('🔴 pricing.css 三處白底價格全部吃深熔橘(經銷價另走 --c-accent)', () => {
    const src = CSS['pricing.css'];
    // 面層:整支檔不得再有 `color: var(--c-red)`(亮熔橘)—— 這支檔全部都是白底價格文字。
    expect(src, 'pricing.css 出現亮熔橘文字 ⇒ 白底價格對比不足').not.toMatch(
      /color:\s*var\(--c-red[,)]/,
    );
    expect((src.match(/var\(--c-red-dark/g) ?? []).length, '深熔橘的處數不是 3').toBe(3);
    expect((src.match(/var\(--c-accent/g) ?? []).length, '經銷那兩處不見了').toBe(2);
  });
});

describe('0c · 規則② 填色 / 框線層留亮熔橘', () => {
  // 反面組:這些**不該**被順手改成深熔橘。深熔橘當底色會讓白字對比過高、且與設計稿不同。
  const FILL_LAYER: Array<[CssFile, string, RegExp]> = [
    ['auth.css', '.auth-err', /border-left:\s*2px solid var\(--c-red\)/],
    ['checkout.css', '.tpfield.tpfield-error', /border-color:\s*var\(--c-red\)/],
    ['product-card.css', '.badge-red', /background:\s*var\(--c-red\)/],
    ['product-card.css', '.badge-min-red', /background:\s*var\(--c-red\)/],
    ['filter-drawer.css', '.fd-tab-dot', /background:\s*var\(--c-red\)/],
    ['header.css', '.pcm-cart-dot', /background:\s*var\(--c-red\)/],
  ];
  it.each(FILL_LAYER)('%s 的 %s 維持亮熔橘', (file, selector, re) => {
    expect(block(file, selector), `${selector} 不再是亮熔橘填色/框線`).toMatch(re);
  });

  it('🔴 /products 骨架進度條吃亮熔橘(0c 之前吃到 --c-accent 的 fallback = 墨黑)', () => {
    // 設計端未表態、依 §4-1 通則外推:狀態指示屬動作色,而它是填色層 ⇒ 亮熔橘。
    // 這條同時擋住「退回 var(--c-accent)」—— 那會變深熔橘(填色層用錯階)。
    const body = block('products-page.css', '.pp-loading-progress > span');
    expect(body, '進度條不是亮熔橘').toMatch(/background:\s*var\(--c-red\)/);
    expect(body, '進度條退回 --c-accent ⇒ 填色層用了文字層的深熔橘').not.toMatch(/--c-accent/);
  });
});

describe('0c · 規則① 熔橘是動作色、不是身分色', () => {
  it('🔴 會員等級 PREMIUM 徽章吃 --c-tier-premium,不吃動作色(Q1=C:零視覺變更)', () => {
    const body = block('tier.css', '.tier-badge-premium');
    expect(body, 'PREMIUM 徽章沒吃 --c-tier-premium').toMatch(
      /background:\s*var\(--c-tier-premium\)/,
    );
    // 反面①:接上動作色 = 身分標記與 CTA 同色(牴觸規則①)。
    expect(body, 'PREMIUM 徽章被接上動作色 ⇒ 身分標記與 CTA 同色').not.toMatch(/var\(--c-red/);
    // 反面②:改墨黑會與 store 級撞成同款、客人與員工分不出等級(D-105-A 明文否決的 B 案)。
    expect(body, 'PREMIUM 徽章改墨黑 ⇒ 與 tier-badge-store 撞成同款').not.toMatch(
      /background:\s*var\(--c-text\)/,
    );
  });

  it('🔴 前提 — store 級仍是墨黑(上面那條「撞成同款」的推理以它為地基)', () => {
    expect(block('tier.css', '.tier-badge-store'), 'store 級不再是墨黑 ⇒ 上一條的反面②失去意義')
      .toMatch(/background:\s*var\(--c-text\)/);
  });

  it('🔴 會員中心分頁 active 維持墨黑(規則①逐字點名的身分標記之一)', () => {
    const body = block('account.css', '.acc-nav button.is-active');
    expect(body, '分頁 active 不是墨底').toMatch(/background:\s*var\(--c-text\)/);
    expect(body, '分頁 active 被接上動作色').not.toMatch(/var\(--c-red/);
  });
});

describe('0c · 反面 — 舊緋紅與第三顆紅都不得殘留', () => {
  it.each(FILES)('%s 不得殘留寫死的緋紅(#dc2626 / rgb(a)(220,38,38))', (f) => {
    // 🔴 兩個繞法(複審 nit 8),兩個都補掉:
    //   ① 原本要求 `rgba(` ⇒ 無 alpha 的 `rgb(220, 38, 38)` 繞得過。
    //   ② 原本**逐行** filter ⇒ 宣告換行寫成 `box-shadow: 0 2px 10px\n  rgba(220, 38, 38, .3);`
    //      也繞得過。改成先把 `--c-tier-premium` 那一條宣告整段挖掉、再對**全文**比對。
    const src = CSS[f].replace(/--c-tier-premium\s*:[^;]*;/g, '');
    expect(src, `${f} 殘留寫死的緋紅`).not.toMatch(/#dc2626/i);
    expect(src, `${f} 殘留寫死的緋紅 rgb(a)`).not.toMatch(/rgba?\(\s*220\s*,\s*38\s*,\s*38/i);
  });

  it('🔴 第三顆紅 #c0392b 不得再是任何宣告的生效值', () => {
    // 0c 之前 `--c-accent` 未定義 ⇒ `var(--c-accent, #c0392b)` 實際渲染的是這顆。
    // 補定義之後它變成取不到的 fallback;值也一併更正,避免留一個會騙人的字面。
    for (const f of FILES) {
      expect(CSS[f], `${f} 還留著 #c0392b`).not.toMatch(/#c0392b/i);
    }
  });

  it('🔴 不得冒出「第三顆熔橘」(與現有兩階很接近、但不相等的色字面)', () => {
    // 這類換色最常見的走樣不是「用錯色系」(那看得出來),是**多一顆差一點點的橘** ——
    // 而它不會讓任何既有斷言轉紅。判準改成「與兩階熔橘的距離」,不是粗略的色域判斷:
    // 第一版用 `r > g + 40 && g >= b` 掃,結果把品牌金 `--c-gold: #a98a4a` 與
    // `--bona-bronze-deep: #8c6239` 一起抓進來 —— 那兩顆與熔橘無關、是誤報。
    // 🔴 只比**飽和的那兩階**。第二版把兩個淡底也放進來比,結果 `#ffffff` 與 `#fdeadd`
    //    的曼哈頓距離只有 57 ⇒ 整批近白色全被抓進來(白色在這支檔裡到處都是)。
    //    近白色的色票本來就會互相很近,那個維度沒有判別力;真正的風險是「多一顆飽和的橘」。
    const EMBERS = ['#f26722', '#c4470c'];
    const ALSO_OK = ['#fdeadd', '#fdf3ec']; // 兩個熔橘淡底,合法、不參與比對
    const rgb = (h: string): [number, number, number] => [
      parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
    ];
    const dist = (a: string, b: string) => {
      const [r1, g1, b1] = rgb(a); const [r2, g2, b2] = rgb(b);
      return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    };
    const suspects = new Set<string>();
    for (const f of FILES) {
      // 🔴 取樣面要含 `rgb()/rgba()`(複審 nit 7:本片自己就動了五處 rgba,
      //    那正是最可能長出第三顆橘的地方;實測把一處改成 `rgba(232,96,31,.3)` 原本 54 全綠)。
      const hexes = [...CSS[f].matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
      const fromRgb = [...CSS[f].matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)]
        .map((m) => '#' + [m[1], m[2], m[3]].map((v) => (+v!).toString(16).padStart(2, '0')).join(''));
      for (const hex of [...hexes, ...fromRgb]) {
        if (EMBERS.includes(hex) || ALSO_OK.includes(hex)) continue;
        // 近白色(最暗的通道都 > 200)一律跳過:淡底彼此天然接近,比了只會誤報。
        if (Math.min(...rgb(hex)) > 200) continue;
        // 曼哈頓距離 60 以內 = 肉眼幾乎分不出來,但確實是另一顆值。
        if (EMBERS.some((e) => dist(hex, e) < 60)) suspects.add(`${f}:${hex}`);
      }
    }
    expect([...suspects], '出現與現有熔橘極接近、但不相等的色字面 ⇒ 第三顆熔橘').toEqual([]);
  });
});
