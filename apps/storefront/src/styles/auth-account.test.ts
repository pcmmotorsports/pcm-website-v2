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
    // `vehicles` 與 tabbar「找車」、`profile` 與 header 會員鈕是**同一支** path(刻意的)。
    expect(ACCOUNT_VIEW, 'vehicles 的 path 與 tabbar「找車」不再是同一支').toContain(
      'M3 13l2-7h14l2 7M5 13h14M5 13v5a1 1 0 001 1h2a1 1 0 001-1v-1h6v1a1 1 0 001 1h2a1 1 0 001-1v-5',
    );
    expect(ACCOUNT_VIEW, 'profile 的 path 與 header 會員鈕不再是同一支').toContain(
      '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    );
    expect(ACCOUNT_VIEW, '圖示沒對讀屏隱藏(旁邊已經有文字 label)').toMatch(
      /className="acc-nav-icon" aria-hidden="true"/,
    );
  });

  it('🔴 圖示容器三階顏色(active 是半透明白,不是純白也不是灰)', () => {
    expect(ACCOUNT, '圖示容器不是 18×18').toMatch(
      /\.acc-nav-icon\s*\{[^}]*width:\s*18px[^}]*height:\s*18px/,
    );
    // 🔴 **R1 must-fix**:初版寫成「全域比對半透明白」,那等於把一個 bug 釘成正確答案 ——
    //    未來有人加手機段修它,這條會轉紅逼他改回來。
    //    守的不變量其實是「**圖示顏色要與它所在的底色有對比**」,而底色分兩種:
    //    桌機 active = 黑底 ⇒ 半透明白;≤1079px active = 透明底(白)⇒ 墨色。
    const desktopIcon = /\n\.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*rgba\(255,\s*255,\s*255,\s*0\.75\)/;
    expect(ACCOUNT, '桌機 active(黑底)的圖示不是半透明白').toMatch(desktopIcon);
    // 兩條手機路徑都要把它翻回墨色,否則白圖示畫在白底上 = 直接隱形。
    const mobileSeg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    expect(mobileSeg.length, '切不出 @media (max-width: 1079px) 區塊 ⇒ 本條前提失效').toBeGreaterThan(0);
    expect(mobileSeg, '@media 那一路沒把 active 圖示翻回墨色 ⇒ 手機上白圖示畫在白底、直接隱形').toMatch(
      /\.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*var\(--c-text\)/,
    );
    expect(ACCOUNT, '[data-mobile] 那一路沒把 active 圖示翻回墨色').toMatch(
      /\[data-mobile="true"\] \.acc-nav button\.is-active \.acc-nav-icon\s*\{\s*color:\s*var\(--c-text\)/,
    );
    // 反面:身分色規則 —— 側欄 active 的**黑底**不得改熔橘(R1 9-5 明文)。
    expect(block(ACCOUNT, 'account.css', '.acc-nav button.is-active {'), 'active 的黑底被改成熔橘了')
      .not.toMatch(/var\(--c-red/);
  });

  it('🔴 前提 — 手機 active 真的是透明底(設計稿把它改成黑底網格了,真站沒跟)', () => {
    // 設計稿 `pcm-account.css:626-633` 把手機導覽整條改成 2 欄網格 + 黑底 active,
    // 那樣半透明白圖示就重新成立。**那個改版不在交接單任何一列**,真站現況是橫捲列。
    // 哪天真站跟上了,上面兩條「翻回墨色」就該回頭改成半透明白 —— 這條會在那時候紅。
    const seg = mediaBlockAt(ACCOUNT, '@media (max-width: 1079px)');
    expect(seg, '手機 active 已改成黑底 ⇒ 回頭把圖示改回半透明白').toMatch(
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
});
