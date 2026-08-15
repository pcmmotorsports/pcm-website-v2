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
//    **它不經 `--radius`,而下面那格「禁裸圓角類別」抓不到它,因為那是 raw CSS、沒有 class 可釘。**
//    ⇒ **前兩輪審查加作者本人都漏了它,第三輪換模型才抓到。**
//    ⚠️ **⇒ 不要以為「這支綠了 = 全站圓角都對」。** 要確認全站,唯一可靠的做法是
//    **編譯 CSS 之後數產物裡的 `border-radius` 分佈**。
//    🔴 **2026-08-16 更正(R2 nit4:上一版這裡的數字已過期,而它是本片自己弄假的)**:
//       舊句寫「9×0、3×var(--radius)、1×calc(infinity*1px)、1×`0.25rem`=已無人使用的 utility 規則」——
//       **那條 `0.25rem` 本片已經讓它消失了**(它的唯一來源就是本檔的註解與標題)。
//       落筆當下實測(`grep -oE 'border-radius:[^;}]*' <產物> | sort | uniq -c`):
//       **6×`0`、3×`var(--radius)`、1×`calc(infinity*1px)`(狀態膠囊待 Sean 裁);無後綴那條 = 0。**
//       ⚠️ **`6` 與舊句的 `9` 不是漂移,是量法不同**(數宣告 vs 數選擇器;minifier 會併選擇器)——
//          **⇒ 引用前先講清楚在數哪一個,而且不要用「類別前綴加大括號」那種式子數(併選擇器就漏看)。**
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
// 🔴🔴 **判別器住在檔頂,兩格【共用同一份】**(R2 nit5:第一版回歸集自己重宣告了副本
//    ⇒ 動守門那格不會讓它紅 ⇒ 它自稱「驗收條件」而與守門【零因果】)。
const BARE = 'round' + 'ed';
const OFFEND = new RegExp(`(?<![-\\w])${BARE}(?![-\\w])|${BARE}-(?:[a-z]+-)*\\[`);

// 🔴🔴 **這一格是【定位器】,不是守門。** 主視窗 2026-08-16 R4 裁決,而這個名字本身就是誠實條款:
//    **它不宣稱涵蓋全站** —— 真正涵蓋全站的那道見下方「仍然沒守到」那節。
//    比對方式 = **整支檔的原始字元**,不剝註解、不抽引號 —— R4 換路後的定案,而前三輪都不是。
//
//    **四輪的軌跡(寫下來,因為每一輪的修法都製造了下一輪的缺陷)**:
//      R1 原版:讀原始字元。**正規式的字面本身命中它自己** ⇒ 本檔在結構上無法改成 `.tsx`
//      R2 修法:剝註解 ⇒ 🔴 **把真陽性重新分類成誤攔** —— 被註解掉的 `className` 從攔變放行,
//              而 `e44737c8` 逐字寫著「Tailwind 掃的是原始碼字串,不管那是不是註解」
//      R3 修法:只看引號內字面 ⇒ 🔴 **同一個錯,換一個方向又犯一次** ——
//              真 build 實測:**沒有引號的註解散文照樣產出規則**
//              (探針 `// <裸類別>-[29px]` 與 `/* …-[31px] */` 兩者都進了產物)
//      R4 定案:**退回原始字元比對,並把範圍從 `.tsx` 擴到 `.ts`**
//
//    🔴🔴 **為什麼接受誤攔 —— 這個取捨是刻意的,不是沒想到**:
//      誤攔(識別字)⇒ 有人被擋 ⇒ 改名 ⇒ 一分鐘,**而且他當場知道發生什麼事**
//      漏放(註解散文 / `.ts` 常數)⇒ 沒有人被擋 ⇒ 一條無效 CSS 進 bundle ⇒ **沒有人會發現**
//      **⇒ 兩者不對稱,而這格的存在理由正是抓漏放。**
//      ⚠️ **這是【刻意接受】的取捨,不是沒想到。8 種形態逐條列在回歸集的 `② 好輸入` 那半。**
//
//    ⚠️ **被它擋住而你確定自己沒寫 class 時,三選一**(8 種誤攔形態見回歸集 `② 好輸入` 那半):
//      甲 改名(`roundedValue` / `is_rounded` / 駝峰或蛇形都放行)—— 最省事
//      乙 註解或字串裡改寫成中文描述(本檔全段就是這樣寫的)
//      丙 真的需要固定圓角 ⇒ **那是設計決策要拍板,不是在這裡加豁免**
const hasOffendingRadius = (source: string): boolean => OFFEND.test(source);

describe('Tailwind v4 的裸圓角類別陷阱', () => {
  // 🔴 **本段刻意不寫出那個英文字的裸形,也不寫方括號圓角的完整字面。**
  //    這支檔踩過三次「偵測器打到自己的輸入」:①正規式字面 ②註解字面 ③🔴**掃描範圍**
  //    ——第三種最難看:`.tsx` 之外不掃,而本檔是 `.ts` ⇒ **範圍在替它擋,而範圍看不出來**(R3 MF1)。
  //    **本片擴到 `.ts` 之後那個豁免消失了**,並在擴之前先把本檔剩下的那處字面清掉。
  it('🔴 定位器:admin 的 `.ts` + `.tsx` 不得出現裸圓角類別或方括號寫死的圓角', () => {
    const { globSync } = require('node:fs') as typeof import('node:fs');
    const files = globSync(join(__dirname, '..', '**', '*.{ts,tsx}'));
    // 🔴 **分母斷言**:`globSync` 回 `[]` ⇒ `offenders` 也 `[]` ⇒ 這一格恆綠。
    //    2026-08-16 實測 374 支(`.tsx` 153 / `.ts` 221 —— **`.ts` 比 `.tsx` 還多**,
    //    而 class 常數真的住在裡面:`lib/orders/order-list-view.ts` 的 `STATUS_CAPSULE`)。
    expect(files.length, 'glob 掃到 0 個檔 = 這一格失去判別力,不是通過').toBeGreaterThan(300);
    const offenders = files.filter((f: string) => hasOffendingRadius(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  // 🔴🔴 **回歸集:守門自己的正向對照,兩半都要 —— 而它跑的是【同一個】判別器,不是副本。**
  it('🔴 定位器的誤攔面與漏放面 —— 逐案構造,壞輸入要響、好輸入要安靜', () => {
    const j = (...xs: string[]) => xs.join('');
    // [原始碼片段, 應該被攔嗎, 這是什麼]
    const CASES: Array<[string, boolean, string]> = [
      // ── ① 壞輸入要響 ────────────────────────────────────────────
      [j("className='", BARE, " border'"), true, '裸圓角類別'],
      [j("className='sm:", BARE, "'"), true, '斷點前綴 + 裸'],
      [j("className='hover:", BARE, "'"), true, '狀態前綴 + 裸'],
      [j("className='", BARE, "-[2px]'"), true, '方括號寫死'],
      [j("className='", BARE, "-t-[4px]'"), true, '方向段 + 方括號(R1 MF1 的漏放面)'],
      [j("className='", BARE, "-tl-[6px]'"), true, '雙字母方向段 + 方括號'],
      [j("className='", BARE, "-[.5rem]'"), true, '小數點開頭的方括號值'],
      [j("className='hover:", BARE, "-t-[8px]'"), true, '狀態前綴 + 方向段 + 方括號'],
      [j("// <div className='", BARE, "' />"), true, '🔴 被行註解掉的 class(真 build 實測會產出)'],
      [j('{/* ', "className='", BARE, "' */}"), true, '🔴 JSX 區塊註解裡的 class(同上)'],
      [j('// 這裡提到 ', BARE, '-[29px]'), true, '🔴🔴 【無引號】的註解散文 —— R3 MF3,真 build 實測會產出'],
      [j('/* 區塊註解散文 ', BARE, '-[31px] */'), true, '🔴🔴 同上,區塊註解版'],
      [j("const c = 'p-2 ", BARE, " m-1'"), true, '常數裡的 class 字串(`.ts` 也會有,故擴範圍)'],
      [j('const c = `p-2 ', BARE, ' m-1`'), true, '模板字串裡的 class'],
      [j('const c = `\n  p-2\n  ', BARE, '\n`'), true, '多行模板字串裡的 class'],
      [j("{ '", BARE, "': cond }"), true, 'clsx 物件語法的 key(本 repo `cn` = clsx + twMerge)'],
      [j("it('不得出現裸 ", BARE, "', () => {})"), true, '測試標題(`e44737c8` 的實錘來源)'],
      // ── ② 好輸入要安靜 ──────────────────────────────────────────
      [j("className='", BARE, "-md'"), false, '合規:有後綴'],
      [j("className='", BARE, "-full'"), false, '刻意豁免:狀態膠囊(見設計參照 §6.5.4)'],
      [j("className='", BARE, "-t-md'"), false, '方向段但無方括號'],
      [j("export const S = 'inline-flex ", BARE, "-full px-2'"), false, '🔴 `order-list-view.ts` 的 STATUS_CAPSULE 形狀 —— 擴範圍後的第一個正向對照'],
      [j('const ', BARE, 'Total = 1'), false, '駝峰識別字'],
      [j('const is_', BARE, ' = true'), false, '蛇形識別字'],
      [j('<div data-', BARE, '="true" />'), false, 'data 屬性'],
    ];

    // 🔴 **兩個數字都由程式數,不手寫**(R3 MF4:上一版標題寫 21 而實際 27,
    //    而我第一個計數式回「合計 0」—— **一個會印 0 的計數式與一個真的是 0 的清單長得一樣**)。
    const shouldCatch = CASES.filter(([, want]) => want).length;
    const shouldPass = CASES.length - shouldCatch;
    expect(shouldCatch + shouldPass).toBe(CASES.length);
    expect(CASES.length, '案例表被清空 = 這一格失去判別力').toBeGreaterThan(20);

    const wrong = CASES.filter(([src, want]) => hasOffendingRadius(src) !== want).map(
      ([src, want, what]) => `${want ? '漏放' : '誤攔'}: ${what}  |  ${src.replace(/\n/g, '\\n')}`,
    );
    expect(wrong, '本表是守門的驗收條件,任一不符 = 守門退步了').toEqual([]);

    // ⬜ **已知【仍然】沒守到的兩面(不要假裝全包)**:
    //    ① 🔴 **範圍仍不含 `.css` / `packages/` / 其他 app** —— `globals.css` 裡的 raw `border-radius`
    //       這格看不到(R3 MF1 在本方案下是【縮小但仍在】,不是解決)。**Tailwind 掃的範圍比這格大。**
    //    ② **第三方元件的布林 prop**(`<Btn ... />` 上的同名 prop)—— 改名改不了別人的 API。
    //       repo 現況查無實例(R1 nit4)。
    //    🔴🔴 **真正涵蓋全站的那道 = 對【真 build 產物】斷言 `border-radius` 的值集合** —— backlog `#544`。
    //       **本格是它落地之前的替代品,不是它的等價物。**
    //       ⚠️ **`#544` 明文【不在測試裡自建 Tailwind】** —— 本 session 自建探針三次、三次都是死量具
    //          (而三次都印出長得完全正常的結果)。**讀真 build 的產物則五次五次成功。**
  });
});
