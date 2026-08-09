// auth-account.test.ts — /login、/register、/account 的文字層守門(全站重設計 第4批;2026-08-06)
//
// 🔴 **這支特別重要,因為 `/account` 在本 worktree 完全無法渲染**(需登入、無 DB ⇒ HTTP 500)。
//    前三批每一批都靠真瀏覽器抓到文字層看不見的 bug(70px 白條、重複頁尾、font 簡寫被丟棄);
//    這一批的 `/account` **沒有那道防線**,所以守門要盡量把「文字層釘得住的」全部釘住,
//    並且明確標出「哪些只有肉眼才驗得到」交給 Sean。
//
// ⚠️ **它擋不住什麼**:cascade 實際勝負、渲染尺寸、SVG 長相。
//    `/login` `/register` 的平板 cascade 我用真瀏覽器兩條 UA 路徑都量過(見下方註解),
//    `/account` 的**完全沒有量過** —— 那是這一批最大的驗證缺口,已寫進 STOP。

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const AUTH = strip(read('auth.css'));
const ACCOUNT = strip(read('account.css'));
const CART = strip(read('cart.css'));
const LAYOUT = read('../app/layout.tsx');
const ACCOUNT_VIEW = read('../components/account/AccountView.tsx');
const MOBILE_TABBAR = read('../components/MobileTabBar.tsx');

/** 從指定位置切一個大括號區塊。🔴 **不要用 `[\s\S]*?` 去跨 `@media`** ——
 *  它是 lazy 的沒錯,但只要目標字串在區塊**外面**更近的地方出現,它照樣命中。
 *  本檔第一版就是這樣假綠:斷言「@media 內有把圖示翻回墨色」,實際命中的是區塊外
 *  `[data-mobile]` 那一條 ⇒ 把 @media 內那行整條刪掉,測試全綠(突變 M1 抓到)。 */
function mediaBlockAt(src: string, header: string, from = 0): string {
  const at = src.indexOf(header, from);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return '';
}

function block(src: string, label: string, selector: string): string {
  const i = src.indexOf(selector);
  expect(i, `${label} 找不到選擇器 ${selector}`).toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  expect(close, `${label} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  return src.slice(open + 1, close);
}

/** 從 anchor 之後找最近一個 `<svg>...</svg>`,回傳內層 markup(不含 `<svg>` 標籤本身)。
 *  2026-08-07 補:用來把「兩邊是不是同一支 path」的比對建立在**實際讀到的原始碼**上,
 *  不是各自手抄第三份字面(手抄字面的舊版本就是這條守門「理由欄是假的」的病根)。 */
function svgInnerAfter(src: string, anchor: string, label: string): string {
  const at = src.indexOf(anchor);
  expect(at, `${label}:找不到 anchor「${anchor}」`).toBeGreaterThan(-1);
  const svgOpen = src.indexOf('<svg', at);
  expect(svgOpen, `${label}:anchor 後找不到 <svg`).toBeGreaterThan(-1);
  const tagClose = src.indexOf('>', svgOpen);
  const svgClose = src.indexOf('</svg>', tagClose);
  expect(svgClose, `${label}:找不到對應的 </svg>`).toBeGreaterThan(-1);
  return src.slice(tagClose + 1, svgClose);
}

/** 抹平 JSX 自閉合(` />`)與 innerHTML 字串(`/>`)之間的空白差異,只留元素/屬性本身可比對。 */
function normalizeSvgMarkup(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/ \/>/g, '/>').replace(/>\s+</g, '><').trim();
}

/** 從 AccountView NAV 陣列的原始碼字面抓某個 id 的 `path:` 字串內容。 */
function navPathById(src: string, id: string): string {
  const re = new RegExp(`id:\\s*'${id}'[\\s\\S]*?path:\\s*'([^']*)'`);
  const m = re.exec(src);
  const captured = m?.[1];
  expect(captured, `AccountView NAV 抓不到 id='${id}' 的 path`).not.toBeUndefined();
  return captured ?? '';
}

describe('第4批 · IBM Plex Mono 家族(DESIGN-HANDOFF §4-3 逐字「不要改回去」)', () => {
  // 設計端 §4-3:「原本多處寫死 `IBM Plex Mono`,但該字體**全站從未載入**,實際 fallback 到
  // 系統 generic monospace,與頁尾的 JetBrains Mono 不同臉。已全數改吃 `var(--f-mono)`、
  // 字距統一 `0.14em`。**不要改回去。**」
  it('🔴 面層 — 全站 styles/ 不得再出現寫死的 "IBM Plex Mono"', () => {
    const offenders = readdirSync(HERE)
      .filter((f) => f.endsWith('.css'))
      .filter((f) => /IBM Plex Mono/.test(strip(read(f))));
    expect(offenders, `這些檔案還寫死 IBM Plex Mono(該字體從未載入):${offenders.join(', ')}`)
      .toEqual([]);
  });

  it('🔴 前提 — IBM Plex Mono 確實沒有被載入(它哪天被載入了,上面那條的理由就不成立)', () => {
    // `layout.tsx` 的 Google Fonts `<link>` 是全站唯一的字體載入處。
    expect(LAYOUT, 'layout.tsx 找不到 Google Fonts 的 link').toMatch(/fonts\.googleapis\.com\/css2/);
    expect(LAYOUT, 'IBM Plex Mono 被載入了 ⇒ 回頭重新評估這一族的改動').not.toMatch(/IBM\+Plex\+Mono/);
    // 反面:JetBrains Mono 必須在(`--f-mono` 的第一順位靠它)。
    expect(LAYOUT, 'JetBrains Mono 沒被載入 ⇒ --f-mono 會整族 fallback 到系統字體').toMatch(
      /JetBrains\+Mono/,
    );
  });

  it.each([
    ['auth.css · .ap-mono', AUTH, '.ap-mono {'],
    ['auth.css · .auth-field > span', AUTH, '.auth-field > span {'],
    ['cart.css · .cart-item-brand', CART, '.cart-item-brand {'],
    ['account.css · .acc-profile span', ACCOUNT, '.acc-profile span {'],
  ])('🔴 %s 吃 --f-mono 且字距統一 0.14em', (_l, src, sel) => {
    const body = block(src, sel, sel);
    expect(body, '沒吃 --f-mono').toMatch(/font-family:\s*var\(--f-mono\)/);
    expect(body, '字距沒統一到 0.14em(§4-3 逐字)').toMatch(/letter-spacing:\s*0\.14em/);
  });
});

describe('第4批 · /login /register 主 CTA 熔橘(§4-1「主 CTA 一律熔橘」)', () => {
  it('🔴 .auth-submit 底熔橘、hover 深熔橘', () => {
    expect(block(AUTH, 'auth.css', '.auth-submit {'), '登入/建立帳號鈕不是熔橘').toMatch(
      /background:\s*var\(--c-red\)/,
    );
    expect(AUTH, 'hover 沒跟著走深熔橘').toMatch(
      /\.auth-submit:hover\s*\{\s*background:\s*var\(--c-red-dark\)/,
    );
  });

  it('🔴 disabled 態有視覺回饋(設計稿有、真站原本沒有;交接單三節都沒列)', () => {
    // 沒有它的話,送出中 / 表單未填完的 `<button disabled>` 看起來仍是可按的熔橘鈕。
    expect(AUTH, '.auth-submit:disabled 沒有樣式').toMatch(
      /\.auth-submit:disabled\s*\{[^}]*opacity:\s*0\.6[^}]*cursor:\s*not-allowed/,
    );
  });

  it('🔴 註冊頁「服務條款 / 隱私政策」兩個連結看得出來可以點', () => {
    // 原本與周圍灰字同色同樣式。設計稿有、真站沒有(交接單沒列,結構比對比出來的)。
    expect(AUTH, '.auth-check a 沒有底線樣式').toMatch(
      /\.auth-check a\s*\{[^}]*text-decoration:\s*underline/,
    );
  });
});

describe('🔴 第4批 · auth 平板段的「位置」與「提權」(兩個都是被真站環境逼出來的)', () => {
  // 真瀏覽器 820px 兩條 UA 路徑都量過:card 36px 32px / max-width 480 / h1 29px /
  // main 48px 24px 56px / sub 15px / submit 15px 15px / 底色 rgb(242,103,34)。
  const TABLET = '@media (min-width: 600px) and (max-width: 1079px)';
  const MOBILE = '@media (max-width: 1079px)';

  it('平板段存在且值對', () => {
    const i = AUTH.indexOf(TABLET);
    expect(i, '找不到 auth 的平板段').toBeGreaterThan(-1);
    const seg = AUTH.slice(i, AUTH.indexOf('\n}', i));
    expect(seg, '卡片內距/寬度不對').toMatch(/padding:\s*36px 32px;\s*max-width:\s*480px/);
    expect(seg, '標題字級不是 29px').toMatch(/font-size:\s*29px/);
    expect(seg, 'input 不是 16px ⇒ iOS Safari 聚焦會自動放大整頁').toMatch(
      /\.auth-field input\s*\{\s*font-size:\s*16px/,
    );
  });

  it('🔴 位置 — 平板段必須排在 mobile 覆寫**之後**(手機那組完整涵蓋平板區間)', () => {
    // `@media (max-width: 1079px)` 涵蓋 600-1079 的每一個寬度 ⇒ 同 specificity 時後載勝。
    // 我第一版排在它前面,平板值會被手機值整組蓋掉 —— 而畫面上只是「平板像放大的手機版」,
    // 不會有任何東西紅。
    const tabletAt = AUTH.indexOf(TABLET);
    expect(tabletAt, '找不到平板段').toBeGreaterThan(-1);
    // 🔴 R1 nit:初版只比「首次出現位置」。哪天有人在平板段**之後**再加一個
    //    `@media (max-width: 1079px)`,那條照樣綠、平板值照樣被蓋掉。
    //    改成:平板段之後**不得再出現任何**涵蓋整個平板區間的手機段。
    const after = AUTH.slice(tabletAt + TABLET.length);
    expect(after, '平板段之後又出現了 @media (max-width: 1079px) ⇒ 平板值會被它蓋掉').not.toMatch(
      /@media \(max-width:\s*1079px\)/,
    );
    expect(AUTH.indexOf(MOBILE), '找不到 mobile 覆寫段 ⇒ 本條前提已失效').toBeGreaterThan(-1);
    expect(tabletAt, '平板段被排到 mobile 覆寫之前').toBeGreaterThan(AUTH.indexOf(MOBILE));
  });

  it('🔴 提權 — 與 [data-mobile] 兜底撞到的三條必須同 specificity', () => {
    // `[data-mobile="true"] .auth-card`(0,2,0)贏過裸 `.auth-card`(0,1,0)、**與順序無關**。
    // Android 平板的 UA 含 `Android` ⇒ `layout.tsx` 的 regex 判 data-mobile=true
    // ⇒ 不提權的話 Android 平板照樣吃手機值(iPad 的 UA 不含那三個關鍵字、走 @media 這一路)。
    const i = AUTH.indexOf(TABLET);
    const seg = AUTH.slice(i, AUTH.indexOf('\n}', i));
    for (const sel of ['.auth-main', '.auth-card', '.auth-card h1']) {
      expect(seg, `${sel} 沒提權 ⇒ Android 平板會吃到手機值`).toMatch(
        new RegExp(`\\[data-mobile\\][^,{]*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`),
      );
    }
  });

  it('🔴 前提 — 那組 [data-mobile] 兜底還在(它沒了,提權就是多餘的複雜度)', () => {
    expect(AUTH, '[data-mobile] 的 .auth-card 兜底不見了 ⇒ 回頭把提權拆掉').toMatch(
      /\[data-mobile="true"\] \.auth-card\s*\{/,
    );
  });
});

describe('第4批 · /account R1 比例(⚠️ 這頁本 worktree 無法渲染,只有文字層)', () => {
  it('🔴 主體與殼切齊(R1 9-3 本輪最大的一筆)', () => {
    const body = block(ACCOUNT, 'account.css', '.acc-main {');
    expect(body, '主體沒吃 --shell-bar-max ⇒ 比殼窄 240px、內容視覺懸空').toMatch(
      /max-width:\s*var\(--shell-bar-max\)/,
    );
    expect(body, '左右內距沒吃 --shell-x ⇒ 左右緣仍與頁首頁尾對不齊').toMatch(
      /padding:\s*40px var\(--shell-x\) 80px/,
    );
    expect(body, '退回寫死的 1200').not.toMatch(/1200px/);
  });

  it('🔴 頭像格線 72px(原本寫 80、實際頭像 72 ⇒ 文字塊左緣多出 8px 錯位)', () => {
    expect(block(ACCOUNT, 'account.css', '.acc-head {'), '頭像欄寬不是 72px').toMatch(
      /grid-template-columns:\s*72px 1fr auto/,
    );
  });

  it('🔴 三格 stat 等高 + 副標貼底(原本高矮不一)', () => {
    const stat = block(ACCOUNT, 'account.css', '.acc-stat {');
    expect(stat, 'stat 沒設等高').toMatch(/min-height:\s*132px/);
    expect(stat, 'stat 不是 flex column ⇒ margin-bottom:auto 不會生效').toMatch(
      /flex-direction:\s*column/,
    );
    const v = block(ACCOUNT, 'account.css', '.acc-stat-v {');
    expect(v, '數字沒縮到 30px ⇒ 與頁面主標同級、主標沒有層級').toMatch(/font-size:\s*30px/);
    expect(v, '少了 margin-bottom:auto ⇒ 三格副標不會貼齊卡片底').toMatch(/margin:\s*10px 0 auto/);
  });

  it('🔴 主標必須明顯大於 stat 數字(R1 驗收 #7)', () => {
    const h1 = block(ACCOUNT, 'account.css', '.acc-head h1 {');
    const m = /font-size:\s*(\d+)px/.exec(h1)?.[1];
    const v = /font-size:\s*(\d+)px/.exec(block(ACCOUNT, 'account.css', '.acc-stat-v {'))?.[1];
    expect(Number(m), '主標字級抽不到').toBeGreaterThan(0);
    expect(Number(m), `主標 ${m}px 沒有大於 stat 數字 ${v}px ⇒ 頁面沒有層級`).toBeGreaterThan(
      Number(v),
    );
  });

  it('🔴 訂單狀態標有可見框線(純灰底在近似灰的頁面上讀不出是狀態標)', () => {
    expect(block(ACCOUNT, 'account.css', '.acc-order-status {'), '狀態標沒有框線').toMatch(
      /border:\s*1px solid var\(--c-border\)/,
    );
  });

  it('🔴 全檔零半像素字級(§4-3;含手機段與 [data-mobile] 兜底那兩處)', () => {
    expect(ACCOUNT, 'account.css 仍有 .5px 字級').not.toMatch(/font-size:\s*\d+\.\d+px/);
    expect(AUTH, 'auth.css 仍有 .5px 字級').not.toMatch(/font-size:\s*\d+\.\d+px/);
  });
});

describe('第4批 · /account 側欄圖示改 inline SVG(R1 9-2)', () => {
  it('🔴 七顆幾何字元全數退場', () => {
    for (const ch of ['◉', '□', '◈', '♡', '◎', '▸', '✎']) {
      expect(ACCOUNT_VIEW, `側欄還留著幾何字元 ${ch}(字體覆蓋率不一、會顯示成豆腐或大小不齊)`)
        .not.toContain(`icon: '${ch}'`);
    }
  });

  it('🔴 七顆都有 path,且規格與殼一致', () => {
    const paths = [...ACCOUNT_VIEW.matchAll(/^\s*path:\s*'/gm)];
    expect(paths.length, `NAV 的 path 不是 7 筆(實際 ${paths.length})`).toBe(7);
    // 🔴 R1 nit:初版只釘 strokeWidth + stroke,沒釘 viewBox / fill,也沒釘任何 path 字面
    //    ⇒ 把 path 內容整組換掉照樣綠。補上四個規格 + 兩條「共用同一支 path」的字面。
    for (const attr of ['viewBox="0 0 24 24"', 'fill="none"', 'stroke="currentColor"', 'strokeWidth="1.6"']) {
      expect(ACCOUNT_VIEW, `SVG 規格少了 ${attr}(殼的 header / mobile-tabbar 是這一組)`).toContain(attr);
    }
    expect(ACCOUNT_VIEW, '圖示沒對讀屏隱藏(旁邊已經有文字 label)').toMatch(
      /className="acc-nav-icon" aria-hidden="true"/,
    );
  });

  it('🔴 vehicles 的 path 與 MobileTabBar「找車」是同一支(2026-08-07 Sean 拍板 Q2=A:機車零件站選車/愛車圖示統一用重機;實際讀出兩邊字面比對,不再手抄第三份字面)', () => {
    // 舊版本這條斷言的訊息宣稱「與 tabbar 不再是同一支」,但比對對象其實是寫死在測試裡
    // 的汽車 path 字面、根本沒有讀 MobileTabBar.tsx——理由欄是假的(兩者從來沒真的比對過)。
    // 這裡改成從 MobileTabBar.tsx 實際讀出「找車」tab 的 SVG 內容,正規化空白差異後比對。
    // 🔴 R2 nit:原本從 `label: '找車'` 起算「之後最近一個 <svg>」。只要有人在 label 與 icon
    //    之間插一顆 svg、或把 `icon:` 搬到 `label:` 之前,這條就會**靜默比到別支**而不是紅。
    //    改成先把該 tab 的物件字面切出來(`id: 'vehicle-search'` 到下一個 `id: '`),再在裡面找。
    const tabStart = MOBILE_TABBAR.indexOf("id: 'vehicle-search'");
    expect(tabStart, "MobileTabBar 找不到 id: 'vehicle-search' ⇒ 本條前提失效").toBeGreaterThan(-1);
    const nextTab = MOBILE_TABBAR.indexOf("id: '", tabStart + 5);
    const tabObject = MOBILE_TABBAR.slice(tabStart, nextTab > -1 ? nextTab : undefined);
    expect(
      (tabObject.match(/<svg/g) ?? []).length,
      '「找車」那筆物件裡不是剛好一顆 <svg> ⇒ 比對對象有歧義',
    ).toBe(1);
    const tabbarMoto = normalizeSvgMarkup(
      svgInnerAfter(tabObject, "label: '找車'", 'MobileTabBar 找車 icon'),
    );
    const accountVehicles = normalizeSvgMarkup(navPathById(ACCOUNT_VIEW, 'vehicles'));
    expect(accountVehicles, 'AccountView vehicles 的 path 與 MobileTabBar「找車」不是同一支').toBe(
      tabbarMoto,
    );
  });

  it('🔴 查證(2026-08-07):profile 的舊斷言訊息「與 header 會員鈕不再是同一支」也是假的,已改成誠實的字面鎖定', () => {
    // 實查:Header.tsx 會員鈕 = `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    // AccountView profile = `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>`——
    // circle cy(7 vs 8)、身體線條公式(header 用直線+arc、這裡用三次貝茲弧)都不同,兩邊從來
    // 不是同一支 path,只是視覺上都畫成「頭圓+肩弧」。舊斷言用的比對字面就是 AccountView 自己
    // 當下的 path、從沒讀過 Header.tsx,是與 vehicles 那條同形狀的假理由欄。
    // 對齊 header 不在本次 Q2=A 範圍、不動 production code,這裡退回純字面鎖定(regression pin),
    // 訊息不再宣稱跨檔同支。
    expect(ACCOUNT_VIEW, 'profile 的 path 字面被改動了(僅鎖字面防誤改,不宣稱與 header 同一支——查證後從來不是)').toContain(
      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    );
  });

  it('🔴 圖示容器三階顏色(active 是半透明白,不是純白也不是灰)', () => {
    expect(ACCOUNT, '圖示容器不是 18×18').toMatch(
      /\.acc-nav-icon\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/,
    );
    // 🔴 **R1 must-fix**:初版寫成「全域比對半透明白」,那等於把一個 bug 釘成正確答案 ——
    //    未來有人加手機段修它,這條會轉紅逼他改回來。
    //    守的不變量其實是「**圖示顏色要與它所在的底色有對比**」。
    //    ⚠️ 這行原本接著寫「≤1079px active = 透明底(白)⇒ 墨色」—— 那是 2026-08-07 之前的事實,
    //    翻向後與下方斷言直接矛盾(審查抓到)。**現況:三個斷點的 active 全是黑底 ⇒ 全部半透明白。**
    //    透明底那段歷史留在下面「前提」測試裡,不在這裡重述。
    const desktopIcon = /\n\.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*rgba\(255,\s*255,\s*255,\s*0\.75\)/;
    expect(ACCOUNT, '桌機 active(黑底)的圖示不是半透明白').toMatch(desktopIcon);
    // 🔴 2026-08-07 翻向:手機分頁列改成 OD 的黑底網格(見下面「前提」測試),原本這裡斷言
    // 兩條手機路徑「翻回墨色」——那是配透明底才需要的修法,底色已經翻回黑底,守的不變量
    // 沒變(圖示要與所在底色有對比),但底色翻了、對比的那一側也要跟著翻回半透明白。
    const mobileSeg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    expect(mobileSeg.length, '切不出 @media (max-width: 1079px) 區塊 ⇒ 本條前提失效').toBeGreaterThan(0);
    expect(mobileSeg, '@media 那一路沒把 active 圖示翻回半透明白 ⇒ 黑底上墨色圖示看不清').toMatch(
      /\.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*rgba\(255,\s*255,\s*255,\s*0\.75\)/,
    );
    expect(ACCOUNT, '[data-mobile] 那一路沒把 active 圖示翻回半透明白').toMatch(
      /\[data-mobile="true"\] \.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*rgba\(255,\s*255,\s*255,\s*0\.75\)/,
    );
    // 反面:身分色規則 —— 側欄 active 的**黑底**不得改熔橘(R1 9-5 明文)。
    expect(block(ACCOUNT, 'account.css', '.acc-nav button.is-active {'), 'active 的黑底被改成熔橘了')
      .not.toMatch(/var\(--c-red/);
  });

  it('🔴 前提 — 手機 active 是設計稿的黑底網格(2026-08-07 翻向;歷史見下方)', () => {
    // 【歷史,保留給下一個人看】第4批當時這條斷言的是「手機 active 真的是透明底」——
    // 設計稿 OD `pcm-home-redesign/pcm-account.css`(grep `repeat(2, minmax`)把手機導覽整條改成 2 欄網格
    // + 黑底 active,那樣半透明白圖示就重新成立;但那個改版當時不在交接單任何一列、
    // 真站現況是橫捲列 + 透明底,所以上面兩條圖示測試改守「翻回墨色」,並在這裡寫死
    // 「哪天真站跟上了,這條會紅」當作伏筆。
    // 【2026-08-07 兌現】Sean 手機實測後親自拍板推翻緩議 ⇒ 真站跟上了 OD 的網格 + 黑底 active,
    // 上面兩條圖示測試已經改守「翻回半透明白」——這條前提測試同步翻向,改守黑底、不是透明底。
    const seg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    expect(seg, '手機 active 不是黑底 ⇒ 分頁列改版沒跟上、上面兩條圖示測試的前提不成立').toMatch(
      /\.acc-nav button\.is-active\s*\{[^}]*background:\s*var\(--c-text\)/,
    );
    expect(seg, '手機 active 還留著舊的透明底(改版沒做乾淨)').not.toMatch(
      /\.acc-nav button\.is-active\s*\{[^}]*background:\s*transparent/,
    );
  });

  it('🔴 `dangerouslySetInnerHTML` 的來源必須是本檔寫死的常數(沒有使用者輸入路徑)', () => {
    // 這條不是形式主義:哪天有人把 `path` 改成從 props / DB 來,這裡就是一個 XSS 入口。
    expect(ACCOUNT_VIEW, 'NAV 不再是 as const ⇒ path 可能從外部來').toMatch(/\] as const;/);
    const usages = [...ACCOUNT_VIEW.matchAll(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]+)\}\}/g)];
    expect(usages.length, `dangerouslySetInnerHTML 的用量不是 1(實際 ${usages.length})`).toBe(1);
    expect(usages[0]?.[1]?.trim(), 'dangerouslySetInnerHTML 的來源不是 NAV 的 t.path').toBe('t.path');
  });
});

describe('2026-08-07 · 分頁列改成 OD 網格(Sean 手機實測後拍板推翻緩議)', () => {
  it('🔴 手機段 .acc-nav 是 2 欄網格', () => {
    const mobileSeg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    const nav = block(mobileSeg, '手機段 .acc-nav', '.acc-nav {');
    expect(nav, '手機 .acc-nav 不是 grid').toMatch(/display:\s*grid/);
    expect(nav, '手機 .acc-nav 不是 2 欄').toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it('🔴 平板段 .acc-nav 覆寫成 4 欄網格', () => {
    const tabletSeg = mediaBlockAt(ACCOUNT, '@media (min-width: 600px) and (max-width: 1079px)');
    expect(tabletSeg.length, '切不出平板段 ⇒ 本條前提失效').toBeGreaterThan(0);
    expect(tabletSeg, '平板段沒有把 .acc-nav 覆寫成 4 欄(且沒對 [data-mobile] 提權)').toMatch(
      /\[data-mobile\] \.acc-nav,\s*\.acc-nav\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  // 🔴 審查抓到:`[data-mobile="true"]` 那一路的 grid **完全沒有守門** —— 把它的 `display: grid`
  //    與 `repeat(2, …)` 兩行刪掉,5440 條照樣全綠。而 account.css 那裡的註解自稱「逐條鏡像」,
  //    MF1/MF7 兩次事故都是「只改一路、漏改另一路」這個形狀。⇒ 兩路的 grid 各釘一次。
  it('🔴 [data-mobile] 兜底那一路也是 2 欄網格(不能只有 @media 那路)', () => {
    const nav = block(ACCOUNT, '[data-mobile] .acc-nav', '[data-mobile="true"] .acc-nav {');
    expect(nav, '[data-mobile] 那路的 .acc-nav 不是 grid ⇒ Android 手機 UA 走這條、會看到舊版面').toMatch(
      /display:\s*grid/,
    );
    expect(nav, '[data-mobile] 那路的 .acc-nav 不是 2 欄').toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it('🔴 兩路都不得再出現橫向捲動殘留(overflow-x / scrollbar-width / ::-webkit-scrollbar)', () => {
    const mobileSeg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    expect(mobileSeg, '手機段還留著 overflow-x(橫捲殘留)').not.toMatch(/overflow-x/);
    expect(mobileSeg, '手機段還留著 scrollbar-width(橫捲殘留)').not.toMatch(/scrollbar-width/);
    expect(mobileSeg, '手機段還留著 ::-webkit-scrollbar(橫捲殘留)').not.toMatch(/::-webkit-scrollbar/);
    // 審查抓到:上面三條只掃 @media 區塊,`[data-mobile]` 那一路的橫捲殘留回來不會紅。
    const dmNav = ACCOUNT.slice(ACCOUNT.indexOf('[data-mobile="true"] .acc-nav {'));
    const dmSeg = dmNav.slice(0, dmNav.indexOf('[data-mobile="true"] .acc-stats'));
    expect(dmSeg.length, '切不出 [data-mobile] 的 .acc-nav 段 ⇒ 本條前提失效').toBeGreaterThan(0);
    expect(dmSeg, '[data-mobile] 那路還留著 overflow-x / scrollbar 殘留').not.toMatch(
      /overflow-x|scrollbar-width|::-webkit-scrollbar/,
    );
  });

  // 🔴 審查抓到並**用真瀏覽器證明**:768px + data-mobile=true 下,把平板段任一條 nth-child 的
  //    雙選擇器改回單選擇器,`[data-mobile="true"]` 那組(未加斷點限制、specificity 較高)就壓過來
  //    —— 實測第 2、6 顆的 border-right 由 1px 變 0px,欄 2|3 的分隔線整條消失,而文字層不會紅。
  //    既有的提權迴圈清單漏了這四條 ⇒ 補上。
  it('🔴 平板段四條 nth-child 規則都必須雙選擇器提權(否則 Android 平板格線錯位)', () => {
    const tabletSeg = mediaBlockAt(ACCOUNT, '@media (min-width: 600px) and (max-width: 1079px)');
    expect(tabletSeg.length, '切不出平板段 ⇒ 本條前提失效').toBeGreaterThan(0);
    // 選擇器字面直接拿來組正規式會被 `(2n)` 這種括號當成群組(第一版就是這樣紅的)⇒ 先跳脫。
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const sel of [
      'button:nth-child(2n)',
      'button:nth-child(4n)',
      'button:nth-last-child(-n+3)',
      'button:last-child',
    ]) {
      const e = esc(sel);
      expect(
        tabletSeg,
        `平板段的 .acc-nav ${sel} 沒有對 [data-mobile] 提權 ⇒ Android 平板會被兜底那組壓過去`,
      ).toMatch(new RegExp(`\\[data-mobile\\] \\.acc-nav ${e},\\s*\\.acc-nav ${e}\\s*\\{`));
    }
  });

  // 🔴 上面整組 nth-child 數學硬綁「剛好 7 顆分頁」:2 欄下最後一顆落單、4 欄下最後一顆 span 2。
  //    加第 8 顆會讓邊框錯亂,而文字層全綠(同 memory feedback_ui-count-change-check-hardcoded-css-track-counts)。
  //    ⇒ 把 NAV 長度釘成前提;哪天要加分頁,這條會先紅、逼人回頭重算格線。
  it('🔴 前提 — AccountView 的 NAV 剛好 7 顆(CSS 的 nth-child 格線數學綁死這個數字)', () => {
    const paths = [...ACCOUNT_VIEW.matchAll(/^\s*id:\s*'/gm)];
    expect(
      paths.length,
      `NAV 不是 7 筆(實際 ${paths.length})⇒ account.css 的 :nth-child(2n)/(4n)/:nth-last-child(-n+3)/:last-child span 2 那組格線數學要重算`,
    ).toBe(7);
  });

  it('🔴 [data-mobile] 那一路與 @media 那一路的 active 底色 / 圖示色一致(這個檔歷史上出過事的地方)', () => {
    // 兩路各自獨立維護(SSR UA 兜底 vs @media),歷史上不只一次只改一路、漏改另一路
    // (MF1/MF7 都是這個形狀)。這裡直接比對兩邊實際字面,而不是各自對常數斷言。
    const mobileSeg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    const mediaActiveBg = /\.acc-nav button\.is-active\s*\{[^}]*background:\s*([^;]+);/.exec(
      mobileSeg,
    )?.[1]?.trim();
    const dmActiveBg = /\[data-mobile="true"\] \.acc-nav button\.is-active\s*\{[^}]*background:\s*([^;]+);/.exec(
      ACCOUNT,
    )?.[1]?.trim();
    expect(mediaActiveBg, '@media 路徑抓不到 active 底色 ⇒ 本條前提失效').toBeTruthy();
    expect(dmActiveBg, '[data-mobile] 路徑抓不到 active 底色 ⇒ 本條前提失效').toBeTruthy();
    expect(dmActiveBg, '兩路 active 底色不一致').toBe(mediaActiveBg);

    const mediaIcon = /\.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*([^;]+);/.exec(
      mobileSeg,
    )?.[1]?.trim();
    const dmIcon = /\[data-mobile="true"\] \.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*([^;]+);/.exec(
      ACCOUNT,
    )?.[1]?.trim();
    expect(mediaIcon, '@media 路徑抓不到 active 圖示色 ⇒ 本條前提失效').toBeTruthy();
    expect(dmIcon, '[data-mobile] 路徑抓不到 active 圖示色 ⇒ 本條前提失效').toBeTruthy();
    expect(dmIcon, '兩路 active 圖示色不一致').toBe(mediaIcon);
  });
});

describe('🔴 第4批 · 突變 M3/M4/M5 抓到的三組「我根本沒寫斷言」', () => {
  // 這三條不是補強,是**補缺**:對應的修法我做了,但完全沒有守門
  // ⇒ 拿掉修法測試照樣全綠。突變跑出來才發現。

  it('M3 — 手機兩路都要解除桌機的等高與貼底(否則單欄每張卡多出約 60px 空白)', () => {
    const mobileSeg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    expect(mobileSeg, '@media 那一路沒解除 .acc-stat 的 min-height').toMatch(
      /\.acc-stat\s*\{[^}]*min-height:\s*0/,
    );
    expect(mobileSeg, '@media 那一路沒解除 .acc-stat-v 的 margin-bottom: auto').toMatch(
      /\.acc-stat-v\s*\{[^}]*margin:\s*8px 0 0/,
    );
    expect(ACCOUNT, '[data-mobile] 那一路沒解除 .acc-stat 的 min-height').toMatch(
      /\[data-mobile="true"\] \.acc-stat\s*\{[^}]*min-height:\s*0/,
    );
    expect(ACCOUNT, '[data-mobile] 那一路沒解除 .acc-stat-v 的貼底').toMatch(
      /\[data-mobile="true"\] \.acc-stat-v\s*\{[^}]*margin:\s*8px 0 0/,
    );
  });

  it('M4 — account 也要有平板段(SITE-MAP 與 DESIGN-HANDOFF §4-4 把它與 auth 並列)', () => {
    const TABLET = '@media (min-width: 600px) and (max-width: 1079px)';
    const seg = mediaBlockAt(ACCOUNT, TABLET);
    expect(seg.length, 'account.css 沒有平板段 ⇒ iPad 整頁吃 390px 的手機值').toBeGreaterThan(0);
    expect(seg, '平板段沒把主標從手機的 22px 撈回').toMatch(/\.acc-head h1[^{]*\{[^}]*font-size:\s*28px/);
    // 🔴 收割確認輪 MF2:不綁選擇器會被上一行的 h1 28px 供給(整條 .acc-stat-v 平板規則刪掉照樣綠,
    //    突變實測證實)⇒ 綁死 .acc-stat-v 自己那條。
    expect(seg, '平板段沒把 stat 數字從手機的 26px 撈回').toMatch(
      /\.acc-stat-v[^{]*\{[^}]*font-size:\s*28px/,
    );
    // 位置:與 auth 同一條規矩 —— 平板段之後不得再出現涵蓋整個平板區間的手機段。
    const at = ACCOUNT.indexOf(TABLET);
    expect(ACCOUNT.slice(at + TABLET.length), '平板段之後又出現 @media (max-width: 1079px)').not.toMatch(
      /@media \(max-width:\s*1079px\)/,
    );
    // 提權:與 [data-mobile] 撞到的選擇器要同 specificity(Android 平板 UA 判 data-mobile=true)。
    for (const sel of ['.acc-head h1', '.acc-stats', '.acc-stat-v']) {
      expect(seg, `${sel} 沒提權 ⇒ Android 平板會吃到手機值`).toContain(`[data-mobile] ${sel},`);
    }
  });

  it('M5 — 會員等級徽章用 lg(與旁邊 30px 的數字同列時 md 太小)', () => {
    const overview = read('../components/account/tabs/OverviewTab.tsx');
    expect(overview, '徽章退回 md ⇒ R1 9-3 那一列的意圖失效').toMatch(
      /<TierBadge tier=\{stats\.tier\} size="lg" \/>/,
    );
    // 前提:`lg` 這一階真的存在且是 40px/14px(對上設計稿的 padding 7px 14px / font-size 14px)。
    const tier = strip(read('tier.css'));
    expect(tier, 'tier-badge-lg 不再是 40px/14px ⇒ 上面那條選的階要重想').toMatch(
      /\.tier-badge-lg\s*\{[^}]*height:\s*40px[^}]*font-size:\s*14px/,
    );
  });

  // 🔴 M6(2026-08-06 cssdiff 補漏,不是突變抓到的 —— 是**結構比對**抓到的)
  //    第4批當時逐點對照舊稿,結論寫成「.acc-address 容器 design 無規則、不發明」並落成註解。
  //    對現行真權威(OD `pcm-account.css:392`)那句是錯的:它有 12px 的 column gap。
  //    症狀=地址卡零間距貼在一起,而所有既有斷言(全是逐點值)對「少了一整條規則」全盲。
  it('M6 — .acc-address 是 12px column gap 的 flex 欄(OD pcm-account.css:392 直搬)', () => {
    const body = ACCOUNT.slice(ACCOUNT.indexOf('.acc-address'));
    expect(ACCOUNT.indexOf('.acc-address'), 'account.css 找不到 .acc-address 容器規則').toBeGreaterThan(-1);
    expect(body.slice(0, body.indexOf('}')), '.acc-address 不是 column flex + 12px gap ⇒ 地址卡貼在一起').toMatch(
      /display:\s*flex[\s\S]*flex-direction:\s*column[\s\S]*gap:\s*12px/,
    );
  });

  // g-5c/g-6c 手機捲動修復(2026-08-07):.acc-inline-form 沒有 scroll-margin-top 的話,
  // JS 把表單捲到視窗頂端後,表單仍會被 position:sticky 的 header(header.css:3)蓋住開頭幾列。
  it('🔴 .acc-inline-form 有 scroll-margin-top(沒有它,表單捲到位仍會被 sticky header 蓋住)', () => {
    const body = block(ACCOUNT, 'account.css', '.acc-inline-form {');
    const m = /scroll-margin-top:\s*(\d+)px/.exec(body);
    expect(m, '.acc-inline-form 沒有 scroll-margin-top ⇒ 表單捲到位仍會被 sticky header 蓋住').not.toBeNull();
    // 🔴 只斷言「> 0」擋不住這條守門自己宣稱要擋的事:1px 也是正數、照樣被 header 蓋住。
    //    下限要釘**兩個斷點裡較高的那顆** header,不是較矮的:
    //      桌機 = padding 14×2 + .pcm-icon-btn 44 + border-bottom 1 = 73px
    //      手機 = padding 12×2 + 44 + 1 = 69px
    //    🔴 R1 抓到我第一版釘 69(較小者)—— 那樣填 70/71/72 會全綠,但桌機 73px 的 header
    //    照樣蓋住表單開頭。「至少不被任何一個斷點蓋住」的下限是 max(73, 69) = 73。
    //    數值來源:header.css 的 `.pcm-header-inner` padding 兩條、`.pcm-icon-btn` 44px、
    //    `.pcm-header` 的 border-bottom(用 grep 這幾個選擇器找,不引行號)。
    expect(
      Number(m?.[1]),
      'scroll-margin-top 小於桌機 header 實高 73px ⇒ 表單捲到位、開頭仍被蓋住',
    ).toBeGreaterThanOrEqual(73);
    // 🔴 base 值對了不代表沒被推翻:任何 @media 把它覆寫成更小值,上面那條照樣綠。
    //    R2 nit:原本用 `\.acc-inline-form\s*\{`,對 `.acc-inline-form.is-x {`、
    //    `.acc-inline-form,\n.foo {` 這兩種寫法全盲 ⇒ 放寬成「選擇器串裡含 .acc-inline-form」。
    const smaller = [...ACCOUNT.matchAll(/\.acc-inline-form[^{;]*\{[^}]*scroll-margin-top:\s*(\d+)px/g)]
      .map((mm) => Number(mm[1]))
      .filter((v) => v < 73);
    expect(smaller, `有 .acc-inline-form 規則把 scroll-margin-top 覆寫成 <73px:${smaller}`).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2026-08-09 Q3=A 觸控救援:會員中心兩個小連結
//
// 🔴 **為什麼這裡的內容高是「實測值」而不是算出來的**:這兩處都吃 `line-height: normal`
//    (tokens.css 的 `body` 沒有宣告 line-height),文字層**推不出**實際行高。
//    2026-08-09 用真瀏覽器在真站字體(Inter, "Noto Sans TC", …)下量:
//      12px → 17.5px、13px → 18.5px。
//    ⇒ 下面把**當時量的 font-size 前提一起釘住**:字級被改動 ⇒ 這組直接紅、
//      強迫重新量,而不是讓一個過期的實測常數安靜地繼續當基準。
//
// ⚠️ **它擋不住什麼**:`/account` 在本 worktree 渲染不了(要登入 + DB),
//    所以「改完真的沒位移」是用**同字面規則在真頁面複刻 DOM** 量的
//    (17.5→25.5 / 18.5→26.5,文字 top 位移 0、section-head 列高 29px 不變),
//    不是在真的會員中心頁量的。真頁面那一格仍是主視窗/Sean 的格。
// ───────────────────────────────────────────────────────────────────────────
describe('Q3=A 觸控救援 · 會員中心小連結(Sean 2026-08-09 拍板,最小兩處之一)', () => {
  const WCAG_MIN = 24; // WCAG 2.2 SC 2.5.8 Target Size (Minimum)
  /** 2026-08-09 真瀏覽器實測(Inter + Noto Sans TC,line-height:normal)。改字級必須重量。 */
  const MEASURED: Record<number, number> = { 12: 17.5, 13: 18.5 };

  /** 取 `padding` / `padding-block` / `margin` / `margin-block` 的上下兩值。 */
  function vertical(body: string, prop: 'padding' | 'margin', label: string): [number, number] {
    const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}(?:-block)?:\\s*([^;}]+)`));
    expect(m, `${label} 沒有 ${prop} 宣告 ⇒ 命中區外擴根本沒發生`).toBeTruthy();
    const parts = (m?.[1] ?? '').trim().split(/\s+/).map((v) => Number(v.replace('px', '')));
    expect(parts.every((v) => Number.isFinite(v)), `${label} 的 ${prop} 含非 px 值,本守門算不了:${m?.[1]}`).toBe(true);
    return [parts[0]!, parts.length >= 3 ? parts[2]! : parts[0]!];
  }

  function assertHit(body: string, fontPx: number, label: string) {
    const base = MEASURED[fontPx]!;
    const [top, bottom] = vertical(body, 'padding', label);
    const hit = base + top + bottom;
    expect(
      hit,
      `${label} 命中區算出來 ${hit}px(實測內容 ${base} + 上 ${top} + 下 ${bottom})< ${WCAG_MIN}px ⇒ ` +
        '手機上這個連結會很難點到。Sean 2026-08-09 Q3=A 就是挑了這兩處。',
    ).toBeGreaterThanOrEqual(WCAG_MIN);
    const [marTop, marBottom] = vertical(body, 'margin', label);
    expect(marTop, `${label} 上 margin ${marTop} ≠ -${top} ⇒ 外擴沒被收回,版面會被推開`).toBe(-top);
    expect(marBottom, `${label} 下 margin ${marBottom} ≠ -${bottom} ⇒ 同上`).toBe(-bottom);
  }

  it('前提 — 實測基準對應的字級沒有被改掉(改了就要重新量,不能沿用舊實測值)', () => {
    const shared = block(ACCOUNT, 'account.css', '.acc-section-head a,');
    const sharedFont = Number(shared.match(/font-size:\s*([\d.]+)px/)?.[1]);
    expect(
      sharedFont,
      `「＋ 新增地址 / 查看全部」那條規則的 font-size 是 ${sharedFont}px、不是 13px ⇒ ` +
        '本組的 18.5px 實測基準已過期,請用真瀏覽器重量後更新 MEASURED',
    ).toBe(13);

    const sub = block(ACCOUNT, 'account.css', '.acc-stat-sub');
    const subFont = Number(sub.match(/font-size:\s*([\d.]+)px/)?.[1]);
    expect(
      subFont,
      `.acc-stat-sub 的 font-size 是 ${subFont}px、不是 12px ⇒ .acc-link-btn 吃的是 inherit,` +
        '本組的 17.5px 實測基準已過期,請重量',
    ).toBe(12);

    const linkBtn = block(ACCOUNT, 'account.css', '.acc-link-btn');
    expect(
      linkBtn,
      '.acc-link-btn 不再是 font-size: inherit ⇒ 它的字級不再等於 .acc-stat-sub,上一條前提失效',
    ).toMatch(/font-size:\s*inherit/);
  });

  it('🔴「＋ 新增地址 / 查看全部 →」命中區 ≥ 24px、且外擴被等量收回', () => {
    assertHit(block(ACCOUNT, 'account.css', '.acc-section-head a,'), 13, '`.acc-section-head a / .acc-add`');
  });

  it('🔴「查看明細 →」命中區 ≥ 24px、且外擴被等量收回', () => {
    assertHit(block(ACCOUNT, 'account.css', '.acc-link-btn'), 12, '`.acc-link-btn`');
  });
});
