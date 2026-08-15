import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// design-tokens.test.ts — BMW M 設計 token 的守門(`docs/design/admin-design-system.md`)。
//
// 🔴🔴 **為什麼存在**:R2 審查 F4 逐字指出 ——
//    作者在 `globals.css` 註解裡寫了「想恢復圓角的人改 `--radius` 不夠,要連下面五行一起改」,
//    **而那句話沒有任何機械載體**:四階已寫死 0、不會跟著紅,`--radius`/`--input`/動效 token
//    在 154 個測試檔裡**零命中**(正向對照:釘 `border-radius` 的只有 `order-filter-chips.test.tsx` 一檔)。
//    ⇒ **註解不是載體。** 這一檔把那些「改了會靜默壞掉」的東西釘住。
//
// ⚠️ **這一檔釘的是【字面】,不是【視覺】** —— 它擋得住「有人把值改回去」,
//    擋不住「這個值在畫面上好不好看」。後者要真瀏覽器,不在這裡。
//
// 🔴🔴 **覆蓋界線(R3 實錘,務必先讀)**:
//    **這支守門涵蓋到哪,是由【它釘得到什麼】決定的,不是由【有哪些圓角】決定的。**
//    實例:`globals.css` 曾有一行寫死的 `.orders-grid .col-ops a { border-radius: 6px }` ——
//    **它不經 `--radius`,而下面那格「禁裸 `rounded`」抓不到它,因為那是 raw CSS、沒有 class 可釘。**
//    ⇒ **前兩輪審查加作者本人都漏了它,第三輪換模型才抓到。**
//    ⚠️ **⇒ 不要以為「這支綠了 = 全站圓角都對」。** 要確認全站,唯一可靠的做法是
//    **編譯 CSS 之後數產物裡的 `border-radius` 分佈**(本片實測:9×0、3×`var(--radius)`、
//    1×`calc(infinity*1px)`=狀態膠囊待裁、1×`0.25rem`=已無人使用的 utility 規則)。
const CSS = readFileSync(join(__dirname, 'globals.css'), 'utf8');

describe('BMW M token:圓角', () => {
  it('🔴 `--radius` 與四階【全部】是 0 —— 少釘一個就會出現「大致直角但某一階不是」', () => {
    // 🔴 **四階必須逐個釘,不能只釘根值**:本片把它們從 `calc(var(--radius) ± Npx)` 改成寫死,
    //    因為 `--radius: 0` 之下那組推導會產生 sm=−4px / md=−2px / **xl=+4px(根本不是直角)**。
    expect(CSS).toMatch(/^\s*--radius:\s*0;/m);
    for (const tier of ['xs', 'sm', 'md', 'lg', 'xl']) {
      expect(CSS).toMatch(new RegExp(`^\\s*--radius-${tier}:\\s*0;`, 'm'));
    }
  });

  it('🔴 `.fchip` 跟著 `--radius` 走,不寫死值(篩選 chip 是控制項 ⇒ 與其他控制項同形狀)', () => {
    // 依據:設計參照 §6.5.4「形狀傳達的是【可不可以互動】」。
    // ⚠️ 釘 `var(--radius)` 而不是釘 `0` —— 釘死 0 會讓日後恢復圓角時這格紅得莫名其妙。
    expect(CSS).toMatch(/\.fchip\s*\{[^}]*border-radius:\s*var\(--radius\)/s);
  });
});

describe('BMW M token:邊框與動效', () => {
  it('🔴 `--input` 是 `oklch(0.65 0 0)` —— 這是 WCAG 1.4.11 那道 3.0 的落地值', () => {
    // 舊值 oklch(0.94) 對兩個底色只有 1.16 / 1.19。
    // ⚠️ 這一格擋的是「有人把它調淡回去」,**擋不到「底色被改了而這個值沒重算」** ——
    //    後者沒有機械訊號,只有 globals.css 那段註解在講。
    expect(CSS).toMatch(/^\s*--input:\s*oklch\(0\.65 0 0\);/m);
  });

  it('🔴🔴 動效 token 住 `:root`,不在 `@theme inline` —— 後者編出來是【零位元組】', () => {
    // R1 審查 MF3:用本 repo 的 tailwind 實編後查證,放 `@theme inline` 的自訂變數不會被輸出。
    // ⚠️ **而它靜默失效**:三綠全綠、測試全過、沒有任何東西會紅。這一格就是那個「會紅的東西」。
    // ⚠️ **邊界要用 `@theme inline {`(帶大括號)** —— 只用 `@theme inline` 會命中
    //    `globals.css` 註解裡**提到**這四個字的地方,而那句話出現在 token 之前
    //    ⇒ 切片會把整段 token 切掉、這一格紅得莫名其妙。**第一版就是這樣紅的。**
    //    🔴 **偵測器打到自己的輸入,今晚已經是第 N 次。**
    const rootBlock = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('@theme inline {'));
    expect(rootBlock).toContain('--motion-fast: 130ms;');
    expect(rootBlock).toContain('--motion-base: 220ms;');
    expect(rootBlock).toContain('--ease-standard: cubic-bezier(0.16, 1, 0.3, 1);');
  });

  it('尊重「減少動態」,而載入指示器是例外(靜止的轉圈 = 看起來像當掉)', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    // ⚠️ 例外**刻意收窄到 `.animate-spin`**(審查 F3):全 repo 8 個 `role='status'` 裡 7 個是文字橫幅,
    //    不收窄的話它們底下未來任何動畫都會靜默繞過「減少動態」。
    expect(CSS).toContain("[role='status'].animate-spin");
  });
});

describe('Tailwind v4 的裸 `rounded` 陷阱', () => {
  it('🔴 admin 全樹不得再出現裸 `rounded` —— 它是靜態 0.25rem,`--radius` 蓋不掉', () => {
    // R2 審查 F5:編譯產物 `.rounded{border-radius:0.25rem}` vs `.rounded-md{border-radius:0}`。
    // 本片把 29 處(12 檔,集中在出貨流)改成 `rounded-md`;沒有這一格的話,
    // **下一個人再寫一個裸 `rounded` 就會在一片直角裡留 4px,而三綠全綠。**
    const { globSync } = require('node:fs') as typeof import('node:fs');
    const files = globSync(join(__dirname, '..', '**', '*.tsx'));
    const offenders = files.filter((f: string) =>
      /(?<![-\w])rounded(?![-\w])/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
