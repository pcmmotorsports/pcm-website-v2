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
    // ⚠️ **邊界不能只用 `@theme inline`** —— 那會命中 `globals.css` 註解裡**提到**這四個字的地方,
    //    而那句話出現在 token 之前 ⇒ 切片把整段 token 切掉、這一格紅得莫名其妙(第一版就是這樣紅的)。
    //
    // 🔴🔴 **而「加大括號」這個修法【不夠】—— D 窗用突變證實**:
    //    `@theme inline{`(少一個空格,合法 CSS)⇒ `indexOf` 回 **-1**,
    //    **而 `slice(a, -1)` 不會炸,它切到倒數第二個字元 ⇒ rootBlock 從 5,812 變 36,068(幾乎整個檔)**
    //    ⇒ **token 就算真的被搬進 `@theme inline`,`includes()` 照樣 true ⇒ 這一格【綠】。**
    //    **它要擋的那件事真的發生時,只要順手改了一個空格,它就放行。**
    // ⇒ **修法:先斷言邊界存在,`-1` 硬失敗,不拿去 slice。** 並用正規式吃掉空白差異。
    const rootStart = CSS.indexOf(':root {');
    const themeMatch = /@theme\s+inline\s*\{/.exec(CSS);
    expect(rootStart, ':root { 區塊必須存在').toBeGreaterThanOrEqual(0);
    expect(themeMatch, '@theme inline 區塊必須存在 —— 找不到就不能切片,不能靜默放行').not.toBeNull();
    const rootBlock = CSS.slice(rootStart, themeMatch!.index);
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
  // 🔴🔴 **標題與註解裡不要寫出 `rounded-` 加方括號的完整字面** ——
  //    Tailwind v4 掃【原始碼字串】找 class,它不管那是不是註解:
  //    第一版標題寫了那個字面 ⇒ 編譯產物真的多出 `.rounded-\[Npx\]{border-radius:Npx}`
  //    —— **一條無效 CSS 進了 bundle,而三綠全綠、測試全過。**
  //    ⇒ **這是「偵測器打到自己的輸入」的反向版:我的【說明文字】變成了它的【輸入】。**
  it('🔴 admin 全樹不得再出現裸 `rounded`,或用方括號寫死的任意圓角 —— 兩者都是 `--radius` 蓋不掉的靜態值', () => {
    // R2 審查 F5:編譯產物 `.rounded{border-radius:0.25rem}` vs `.rounded-md{border-radius:0}`。
    // 本片把 29 處(12 檔,集中在出貨流)改成 `rounded-md`;沒有這一格的話,
    // **下一個人再寫一個裸 `rounded` 就會在一片直角裡留 4px,而三綠全綠。**
    const { globSync } = require('node:fs') as typeof import('node:fs');
    const files = globSync(join(__dirname, '..', '**', '*.tsx'));
    // 🔴 **分母斷言(D 窗 nit2)**:`globSync` 回 `[]` ⇒ `offenders` 也 `[]` ⇒ **這一格恆綠**。
    //    現在掃到 150+ 支,但沒有任何東西保證它不會變 0(改目錄結構、換 glob 實作都會)。
    expect(files.length, 'glob 掃到 0 個檔 = 這一格失去判別力,不是通過').toBeGreaterThan(100);
    // ⚠️ **`rounded-full` 刻意【不在】這格**:它編出 `calc(infinity * 1px)`、`--radius` 同樣蓋不掉,
    //    而 src 內 16 處在用 —— **但那是狀態膠囊,而「要不要跟 OD 一起變方角」是【待 Sean 裁】的題**
    //    (見設計參照 §6.5.4)。**他裁完之後,這一格要把 `rounded-full` 一起納進來或明文豁免。**
    //
    // 🔴🔴 **適用條款(2026-08-16 補;這一格【會誤傷】,也【有漏放】,被它擋住的人先讀這段)**
    //    正向對照有兩半,而本格原本只驗過①的一部分:
    //      ① 壞輸入要響   ⚠️ **只對三種驗過**:裸 `rounded`、帶前綴的裸 `rounded`(`sm:` `hover:`)、
    //                        以及**無方向段、數字開頭**的方括號寫法。
    //         🔴 **漏放面(code-reviewer R1 MF1 抓到,我複跑確認)**:第二段是逐字
    //            `rounded-` + `[` + 數字,**不吃方向段、不吃非數字開頭** ⇒ 下列全部【放行】:
    //            方向段版(`-t-` `-tl-` `-e-` 加方括號)、小數點開頭的方括號值、方向段配狀態前綴。
    //            ⚠️ repo 現況這幾型 0 命中(已實查)⇒ **是【字面】不足,不是線上破口。**
    //      ② 好輸入要安靜 🔴 **不成立** —— 17 個構造案例裡【8 個誤攔】
    //    誤攔面(實測,非推測):**本格讀的是整支檔的原始字元,不剝註解、不剝字串、不分語法角色**
    //      🔴 誤攔:單獨當識別字的 `rounded`(變數/回傳值/物件鍵/函式名)、`obj.rounded`、
    //               **註解裡提到它**、**字串常數裡提到它**、**測試標題裡提到它**
    //      ✅ 放行:`roundedTotal`(駝峰)、`is_rounded`(蛇形)、`data-rounded`、`rounded-md`、`rounded-full`
    //    ⇒ **判別線是【前後有沒有連著 `-` 或字母數字底線】,不是【它是不是一個 class】。**
    //
    //    **被它擋住而你確定自己沒寫裸 class 時,三選一**:
    //      甲 改名(`roundedValue` / `is_rounded`)—— 最省事,且不改守門行為
    //      乙 註解/字串裡改寫成「無圓角寫法」之類的中文描述,不要寫出那個英文字
    //         🔴🔴 **這不是龜毛,而且【現在進行式】,不是過去式**(R1 MF2 抓到):
    //            Tailwind 掃原始碼字串找 class,**它不管那是不是註解**。
    //            reviewer 用 repo 同版 `@tailwindcss/postcss` 逐源編譯查證:
    //            `src/**/*.tsx` 全樹產出 **零**個 `.rounded`、`globals.css` **零**,
    //            **只有本檔自己的註解與 `it()` 標題產得出來** ——
    //            而出貨 bundle 裡**現在就有** `.rounded{border-radius:.25rem}` 這條活的規則。
    //            ⇒ **本段文字在教別人守一條【它自己正在違反】的規則。** `e44737c8` 只修掉方括號那半。
    //            📎 已立案於盤點 §1-5;**修法屬「動比對方式」那一片,不在本次註解片**。
    //      丙 真的需要 4px ⇒ **那是設計決策,要拍板,不是在這裡加豁免**
    //      ⬜ **第四種:本格三條都解不了** —— 第三方元件的布林 prop(`<Btn rounded />`、
    //         `rounded={true}`、由外部型別解構的 `{ rounded }`)。**甲改不了別人的 prop 名、
    //         乙 不適用(那是 JSX 不是註解)、丙 不是設計題。** 唯一出路是 spread。
    //         ⚠️ **這一面【沒守到】,不要假裝全包**(R1 nit4;repo 現況查無實例,是構造出來的形狀)。
    //
    //    ⚠️ **現況(可重跑)**:153 支 `.tsx` 命中 **0**;而含 `rounded` 字樣的檔有 **76** 支
    //       ⇒ **這個 0 不是「沒有誤攔面」,是「誤攔面目前剛好沒被踩到」。** 兩者不同。
    //    🔴🔴 **本檔自己就在誤攔面上,而且比第一版寫的嚴重**(R1 MF3 更正:第一版寫「6 處」,
    //       那只算了新增段與 `it()` 標題;**全檔實測 12 處**,含 `:19 :81 :87 :88 :90` 等既有註解)。
    //       ⚠️ **而這個數【每次有人編輯本段就會變】** —— 折完 R1 那三條之後它就從 12 變成 16。
    //          **⇒ 不要引用一個定值。要用時當場數**(用下面那行正規式跑本檔),
    //          **本次 commit 落筆當下 = 16。這個數字唯一的用途是證明「不是零」。**
    //       **而最硬的一處不是註解**:**下面那行正規式的【字面本身】就命中它自己。**
    //       ⇒ **就算把全部註解清乾淨,本檔改成 `.tsx` 仍然過不了這一格。**
    //       **這道守門在結構上禁止用 `.tsx` 討論它自己。**
    const offenders = files.filter((f: string) =>
      /(?<![-\w])rounded(?![-\w])|rounded-\[[0-9]/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
