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
//    🔴🔴 **2026-08-16 片4b 再更正:上一行括號裡那句「狀態膠囊待 Sean 裁」【兩半都已經是假的】。**
//       ① Sean 當天就裁了「狀態膠囊 —— 方角」,而且已落地(`order-list-view.ts` 搜 `STATUS_CAPSULE`
//          ⇒ `'inline-flex px-2 py-0.5 text-xs font-medium'`,`rounded-full` 已不在裡面)。
//       ② 那顆「無限圓角」**仍然在產物裡,但它不再是狀態膠囊的**。
//       🔴🔴 **而且【產物裡它不叫 `calc(infinity*1px)`】** —— 上一行那個字面是**原始碼側**的寫法。
//          落筆當下實測(`grep -rho 'border-radius:[^;}]*' apps/admin/.next/static | sort | uniq -c`):
//            `6 border-radius:0` / `3 border-radius:var(--radius)` / **`1 border-radius:3.40282e38px`**
//          ⇒ 產物裡是 **`3.40282e38px`**(lightningcss 已把 `calc()` 求值成 Float32 上限)。
//          ⚠️ **同一件事在三層各有一個不同的字面,而三個都對**:
//            原始碼 `rounded-full` → 產物 `3.40282e38px` → **瀏覽器 computed `1.67772e+07px`**
//            (Chrome 再夾一次到 2^24)。
//          🔴 **⇒ 拿 `calc(infinity*1px)` 去 grep 產物會得到 0 命中,而那個 0 是【量錯層】不是【不存在】。**
//             本檔上面早就寫過「引用前先講清楚在數哪一個」—— 這是同一條規則在**同一個值**上第二次踩到。
//          現在那顆的來源是
//          客戶/收款/備註那族 `rounded-full` 徽章。**先分類再報數**(不分類的話下一個人會拿總數
//          當成「還有這麼多顆要直角化」的清單):
//          數法 `grep -rn 'rounded-full' apps/admin/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | wc -l`
//          ⇒ **15 = 14 處會渲染的 code + 1 處註解**。
//            · 14 處 code:客戶族 4(`customers/` 三支 + `customer-detail-sections` 的 `BADGE` 常數)/
//              收款族 4(`payment-list.tsx`)/ 備註族 3(`notes-timeline.tsx`)/ 訂單明細 1 /
//              關鍵字搜尋 chip 1(`order-keyword-search.tsx`;客戶那支已計入客戶族)/ 篩選計數 1
//              (`multi-check-filter.tsx`)。
//            · **第 15 處是【註解】**:`order-list-view.ts` 搜 `拿掉` ⇒ 那行正是**記錄
//              「狀態膠囊拿掉 `rounded-full`」這件事**的 docstring。
//          🔴 **⇒ 零處【真的會渲染】屬於狀態膠囊;唯一提到膠囊的那一處是它自己的訃聞。**
//          📎 **我上一版把這裡寫成 14,是【目視數 grep 輸出】少算了最後一行** ——
//             而本檔上面對 `shadow-` 就做了「預期 3 實得 4、+1 是註解」的同款留痕,我對這條沒做。
//             code-reviewer 重跑同一條 grep 當場抓到。
//             ⇒ **報 grep 數字讓 `wc -l` 數,不要用眼睛數輸出。**
//       🔴 **這正是「改了前件、後件沒跟著翻」**:膠囊改方角是機械的、這句括號不會跟著紅,
//          而它留下來的效果是**把一個仍然存在的數字掛在一個已經無關的原因上**
//          ⇒ 下一個人會以為「那顆 infinity 還在等 Sean」,於是不去查它真正是誰的。
//       📎 **量法(真瀏覽器 computed value,2026-08-16 片4b 實跑)**:本機 `ADMIN_DEV_BYPASS=1`
//          後台注入 `STATUS_CAPSULE + cap-n` ⇒ `borderRadius: "0px"`;
//          正向對照注入 `payment-list.tsx` 那顆真 `rounded-full` 徽章 ⇒ `"1.67772e+07px"`
//          ⇒ **量具看得見圓角,所以膠囊那個 0px 是真的量到、不是量不到。**
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
  it('🔴 `--input` 是 `oklch(0.631 0 0)` —— WCAG 1.4.11 那道 3.0 的落地值', () => {
    // 舊值 oklch(0.94) 對兩個底色只有 1.16 / 1.19;`oklch(0.65)` 是 BMW M 色票落地【之前】的選值。
    // 🔴 片1 把 `--background` 換成 `#f7f8fa`、並讓 `--accent` 成為暖填 `#eef3f8`
    //    ⇒ 它多了一個底色(`border-input hover:bg-accent` 三處),舊值在暖填上只有 2.90。
    // ⚠️ **這一格釘的是【字面】** —— 「底色改了而這個值沒重算」由下面那個 describe 的實算矩陣抓。
    expect(CSS).toMatch(/^\s*--input:\s*oklch\(0\.631 0 0\);/m);
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
// ══════════════════════════════════════════════════════════════════════════════
// BMW M 色票:**對比【實算】,不是把數字抄進註解**
//
// 🔴🔴 **為什麼這一段必須算而不是釘字面**:上面那些 `toMatch` 擋得住「有人把值改回去」,
//    擋不住**本片自己踩到的那個坑** —— **改的是 A(底色),而壞掉的是 B(在它上面的文字/邊框)**。
//    實錘:設計參照把 `--muted-foreground` 定為 `#64738a`,對頁底 **4.53**(剛好過);
//    片1 把 `--muted` 從灰換成暖填 `#eef3f8` 之後,同一顆值在**那個新底**上只有 **4.31**。
//    **沒有任何字面改變、沒有任何東西會紅** —— 除非有人真的把兩顆值放進同一個算式。
//
// ⚠️ **這一格算的是【token 之間】的關係,不是畫面** —— 它不知道哪個文字真的疊在哪個底上。
//    配對表是**人維護的**(下方 `PAIRS`),而它的來源是 `globals.css` 那張對映表下面逐處列出的消費點。
//    🔴 **⇒ 新增一個「文字 token 出現在新底色上」的用法時,要回來補一列。** 這是本表的已知邊界。
// ══════════════════════════════════════════════════════════════════════════════

// 🔴 只取 `:root`,不能連 `.dark` 一起吃(那 27 顆是刻意暫留的 inert 值,拿去算會得到假結果)。
//    邊界找不到就**硬失敗**,不切片、不靜默放行(與上面動效那格同一條教訓)。
const rootBlockOf = (css: string): string => {
  const start = css.indexOf(':root {');
  const end = css.indexOf('.dark {');
  expect(start, ':root { 區塊必須存在').toBeGreaterThanOrEqual(0);
  expect(end, '.dark { 區塊必須存在 —— 找不到就不能切片').toBeGreaterThan(start);
  return css.slice(start, end);
};

const ROOT = rootBlockOf(CSS);

const tokenOf = (name: string): string => {
  const captured = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'm').exec(ROOT)?.[1];
  expect(captured, `:root 裡找不到 --${name} —— 被改名或刪掉了`).toBeDefined();
  return String(captured).trim();
};

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const captured = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  expect(captured, `不是六碼 hex:${hex}`).toBeDefined();
  const n = parseInt(String(captured), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// oklch → sRGB(`--input` 是 :root 唯一保留 oklch 的一顆:它的選值方法是「只調明度」,
// 寫成 hex 會把那個方法藏起來)。矩陣 = Oklab 反變換,與 CSS Color 4 同一組常數。
const oklchToRgb = (L: number, C: number, hDeg: number): RGB => {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return [
    enc(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    enc(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    enc(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
};

const parseColor = (raw: string): RGB => {
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(raw);
  return ok ? oklchToRgb(Number(ok[1]), Number(ok[2]), Number(ok[3])) : hexToRgb(raw);
};

const luminance = ([r, g, b]: RGB): number => {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a: RGB, b: RGB): number => {
  // ⚠️ 不用 `.sort()` 解構 —— `noUncheckedIndexedAccess` 下索引回 `number | undefined`,
  //    而 `as number` 會把「算錯」變成「編得過」。`Math.max/min` 兩顆都是確定的 number。
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// 半透明**先疊回底色再算** —— 設計參照 §5 的 focus 環就是漏了這一步才把 1.43 誤判成合格。
const over = (fg: RGB, alpha: number, bg: RGB): RGB => [
  Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
  Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
  Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
];

describe('BMW M token:對比實算', () => {
  it('🔴🔴 量具自己要有判別力 —— 壞輸入要響、好輸入要安靜', () => {
    // 🔴 **一個永遠回「過」的對比函式,與一個真的全過的色票,長得一模一樣。**
    //    下面那格如果沒有這一格墊著,它綠了也證明不了任何事。
    // ① 壞輸入要響
    expect(contrast(hexToRgb('#cccccc'), hexToRgb('#ffffff'))).toBeLessThan(4.5);
    expect(contrast(hexToRgb('#ffffff'), hexToRgb('#ffffff'))).toBeCloseTo(1, 5);
    // ② 好輸入要安靜
    expect(contrast(hexToRgb('#000000'), hexToRgb('#ffffff'))).toBeCloseTo(21, 1);
    // ③ oklch 實作沒壞:零彩度必須得到中性灰(R=G=B),否則矩陣算錯而數字看起來仍正常
    const [r, g, b] = oklchToRgb(0.631, 0, 0);
    expect([g, b]).toEqual([r, r]);
    // ④ 疊色實作沒壞:alpha=1 必須精確回前景色
    expect(over(hexToRgb('#0066b1'), 1, hexToRgb('#ffffff'))).toEqual(hexToRgb('#0066b1'));
  });

  // [文字/邊框 token, 底色 token, 門檻, 這個組合出現在哪(為什麼要算它)]
  const PAIRS: Array<[string, string, number, string]> = [
    // ── 正文 4.5(WCAG 1.4.3)──
    ['foreground', 'background', 4.5, '頁面正文'],
    ['foreground', 'card', 4.5, '卡片內正文'],
    ['foreground', 'muted', 4.5, 'bg-muted 上的主文字(payment-list:57)'],
    ['muted-foreground', 'background', 4.5, '頁面次要文字'],
    ['muted-foreground', 'card', 4.5, '卡片內次要文字'],
    // 🔴 這一列就是本片差點漏掉的那個:5 處把次要文字放在暖填底上
    ['muted-foreground', 'muted', 4.5, 'bg-muted text-muted-foreground(notes-timeline:21,40 等 5 處)'],
    // ⚠️ **這兩列今天在 repo 是【零命中】的防呆,不是現況**(R1 nit6:我原本把它們寫得像現有用法)。
    //    留著的理由 = 三顆同值是**現在**才成立的;哪天有人把 `--secondary` 或 `--accent` 分岔出去,
    //    這兩列會先紅。**標清楚它是防呆,下一個人才不會拿它當「這裡有東西在用」的證據。**
    ['muted-foreground', 'secondary', 4.5, '防呆(今日零命中):secondary 底上的次要文字'],
    ['muted-foreground', 'accent', 4.5, '防呆(今日零命中):accent 底上的次要文字'],
    ['secondary-foreground', 'secondary', 4.5, '徽章(customers-table:44 等 5 處)'],
    ['accent-foreground', 'accent', 4.5, 'hover:bg-accent hover:text-accent-foreground'],
    ['primary-foreground', 'primary', 4.5, '主要按鈕白字(20 處)'],
    ['destructive-foreground', 'destructive', 4.5, '危險按鈕白字'],
    ['destructive', 'card', 4.5, '卡片內的危險文字'],
    ['destructive', 'background', 4.5, '頁面上的危險文字'],
    ['card-foreground', 'card', 4.5, '卡片自己的文字色(bg-card 39 處)'],
    ['fg-2', 'card', 4.5, '灰膠囊文字(片3b;它坐在卡片色兌出來的底上)'],
    ['popover-foreground', 'popover', 4.5, '防呆(今日零命中):浮層文字'],
    // 🔴🔴 **側欄那 9 顆是 R1 審查 MF3 補的 —— 漏它們的方式值得記。**
    //    我補配對表時是**照著我改過的那幾行 token 想**,而不是**照著 `:root` 有哪些 token 數**
    //    ⇒ 側欄整族(9 顆)一列都沒有,而 `app/layout.tsx` + `app-sidebar.tsx` **真的在 render 它**
    //    (`hover:bg-sidebar-accent hover:text-sidebar-accent-foreground` 在 `ui/sidebar.tsx` 9 處)。
    //    ⚠️ **最諷刺的一點**:`globals.css` 那張對映表拿「OD 導軌 hover/選中 `:137-138`」當
    //       三顆合一的靠山,**而導軌正是唯一沒有任何一格在量的地方。**
    //    **⇒ 配對表要從「`:root` 有哪些 token」推,不是從「我改了哪幾行」推。**
    // ⚠️ **哪幾列是現況、哪幾列是防呆,逐列標**(R2 MF5:我補側欄時又把零命中的寫成現有用法,
    //    而那正是 R1 nit6 指出、我在同一段自己寫下判別句的那個錯 —— **折 finding 只折了被指名的兩列**)。
    ['sidebar-foreground', 'sidebar', 4.5, '側欄文字(bg-sidebar / text-sidebar-foreground)'],
    ['sidebar-accent-foreground', 'sidebar-accent', 4.5, '側欄 hover/選中(ui/sidebar.tsx 9 處)'],
    ['sidebar-primary-foreground', 'sidebar-primary', 4.5, '防呆(今日零命中):側欄強調態文字'],
    ['sidebar-foreground', 'sidebar-accent', 4.5, '防呆(今日零命中):hover 只換底不換字'],
    ['sidebar-ring', 'sidebar', 3.0, '側欄焦點環(focus-visible:ring-2 ring-sidebar-ring)'],
    // ── 非文字 3.0(WCAG 1.4.11)──
    ['input', 'background', 3.0, '控制項邊界(頁面上)'],
    ['input', 'card', 3.0, '控制項邊界(卡片內)'],
    // 🔴 hover 態一樣受 1.4.11 管:`border-input hover:bg-accent` 三處
    ['input', 'accent', 3.0, 'border-input hover:bg-accent(order-keyword-search:68 等 3 處)'],
    ['ring', 'background', 3.0, '焦點描邊 focus-visible:border-ring'],
    ['ring', 'card', 3.0, '焦點描邊(卡片內)'],
    ['ring', 'accent', 3.0, '焦點描邊(暖填底上)'],
    ['primary', 'background', 3.0, '強調色當非文字標記'],
  ];

  it('🔴 每一組【文字 × 底色】都達標 —— 失敗時印出實測值,不要只說 false', () => {
    expect(PAIRS.length, '配對表被清空 = 這一格失去判別力').toBeGreaterThan(15);
    const fails = PAIRS.flatMap(([fg, bg, need, where]) => {
      const got = contrast(parseColor(tokenOf(fg)), parseColor(tokenOf(bg)));
      return got >= need
        ? []
        : [`--${fg} on --${bg} = ${got.toFixed(2)}(需 ${need})  ← ${where}`];
    });
    expect(fails, 'BMW M 色票有組合不達標').toEqual([]);
  });

  // 🔴🔴 **具名豁免,不是「跳過」** —— 豁免項仍然被【量】,只是門檻換成「值必須還是我們記錄的那個」。
  //    ⇒ 有人動了 `--destructive` 或 `--background`,這一格**照樣紅**,而且紅在「豁免的前提變了」。
  //    ⚠️ **一個 `.filter()` 掉的豁免會變成恆綠格**(本 repo 已經踩過:「什麼都沒有」被讀成「檢查過了」)。
  const THIN_EXEMPT: Record<string, { got: number; why: string }> = {
    'destructive on background': {
      got: 4.56,
      why:
        'OD `:27` 的品牌紅 `#e4002b`,設計參照 §1 已逐字記「✅ 但只差 0.06 過關」。' +
        '改它 = 動 BMW M 的品牌色,那是設計決策不是本片的算術題 ⇒ 具名豁免,待 Sean/設計裁。',
    },
  };

  it('🔴 剛好過標的值要有餘裕 —— 落在門檻上的數字會因捨入而翻面', () => {
    // 依據:`--input` 自己的註解「第一次算 3.00、重算 2.99」。
    // ⚠️ 這一格不是重複上一格 —— 上一格問「過不過」,這一格問「**過得夠不夠穩**」。
    //    `--muted-foreground` 從 `#64738a`(4.53)改成 `#606e85` 正是為了這條。
    const tight = PAIRS.flatMap(([fg, bg, need, where]) => {
      const got = contrast(parseColor(tokenOf(fg)), parseColor(tokenOf(bg)));
      if (got < need || got >= need + 0.08) return [];
      const ex = THIN_EXEMPT[`${fg} on ${bg}`];
      // 豁免的前提 = 「它還是我們當初記錄的那個值」。漂了就不再是同一件事,要重新裁。
      if (ex && Math.abs(got - ex.got) < 0.01) return [];
      return [
        `--${fg} on --${bg} = ${got.toFixed(2)},只比 ${need} 高 ${(got - need).toFixed(2)}  ← ${where}` +
          (ex ? `  🔴 具名豁免記的是 ${ex.got},實測已漂到 ${got.toFixed(2)} ⇒ 豁免前提變了,要重裁` : ''),
      ];
    });
    expect(tight, '這些組合過標但沒有餘裕,捨入就會翻面').toEqual([]);
  });

  it('🔴🔴 配對表要涵蓋 `:root` 每一顆顏色 token —— 新增 token 卻沒配對,這一格會紅', () => {
    // 🔴 **這一格是 R1 審查 MF3 的機制版。** 那條 finding 的病根不是「我漏了側欄」,是
    //    **我從「我改了哪幾行」推配對表,而不是從「`:root` 有哪些 token」推** ——
    //    ⇒ 漏掉的東西**照定義**不會出現在我的清單裡,再檢查幾次也找不到。
    //    **把「有沒有漏」交給程式數,才不用依賴我當下有沒有想到。**
    // 🔴🔴 **用「扣掉已知的非顏色」而不是「認得出哪些是顏色」**(R2 MF4)。
    //    上一版的正規式只認 `#rrggbb` 與 `oklch(…)` ⇒ 有人用 `rgb()` / `hsl()` / `color-mix()` /
    //    三碼 hex 新增一顆 token,**它不會被數,也不會紅** —— 而那一格正在宣稱「新增 token 會紅」。
    //    ⚠️ 差別是**預設方向**:認顏色 = 認不得就放行(靜默漏);扣非顏色 = 認不得就當顏色(會吵)。
    //    **守門的預設方向要選會吵的那個。**
    const NON_COLOR = new Set([
      'radius',
      'motion-fast',
      'motion-base',
      'ease-standard',
      'font-sans',
      'font-mono',
    ]);
    const declared = [...ROOT.matchAll(/^\s*--([a-z0-9-]+):/gim)].map((m) => String(m[1]));
    const colorTokens = new Set(declared.filter((t) => !NON_COLOR.has(t)));
    const covered = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
    const uncovered = [...colorTokens].filter((t) => !covered.has(t)).sort();

    // 🔴 **豁免的理由要寫實話,不要挑有利的說法**(R2 MF3)。
    //    上一版寫「只有裝飾性分隔線可以不進表」—— 而 `--border` **不只是分隔線**:
    //    `globals.css` 的 `@layer base` 有 `* { @apply border-border }` ⇒ 它是**全站預設邊框色**,
    //    而本檔上方 `--input` 那段自己就列了 6 處**表單欄位**吃它(對卡片 1.36 < 3.0)。
    //    ⇒ **這不是「不受 1.4.11 管」,是「本片沒有修它,而它確實有一批控制項在用」。**
    //    那 6 處要換吃 `--input` 還是把 `--border` 分階,是下一片的事;**在這裡先誠實標成缺口。**
    // 🔴 `border-soft`(片3 新增)一併列入:它是**裝飾性分隔**(表格列 hairline),
    //    對卡片 1.13 是**刻意**的 —— BMW M 是 hairline 語言,拉到 3.0 會變成一條中灰藍實線。
    //    📎 **這一格在片3 當場就紅了一次**,紅在「你加了一顆 token 但沒配對」——
    //       那正是它被寫出來要做的事,所以這裡是**明知地把它加進豁免**,不是繞過守門。
    //
    // 🔴🔴 `success` / `warning`(片3b 新增)**不是豁免,是「量在別的地方」**:
    //    它們從來不直接當顏色用,只當 `color-mix` 的輸入 ⇒ 拿 `--success on --card` 去斷言,
    //    量的是一個**畫面上不存在的組合**。它們真正的配對(兌淡之後的膠囊底與字)
    //    由上方「四顆膠囊的【算出來的】底與字都達標」那格實算。
    //    ⚠️ **下面那格會驗那個 describe 真的還在** —— 否則這裡就變成真的豁免了。
    const ALLOWED_UNCOVERED = ['border', 'border-soft', 'sidebar-border', 'success', 'warning'];
    expect(uncovered, '這些 token 沒有任何一組配對在量 ⇒ 改它們不會有東西紅').toEqual(
      ALLOWED_UNCOVERED,
    );
    // 分母斷言:切片壞掉 ⇒ `declared` 變空 ⇒ 上面那格會拿 [] 去比而「看起來也對」。
    expect(declared.length, ':root 一顆 token 都沒數到 = 切片或正規式壞了').toBeGreaterThan(20);
  });

  it('🔴🔴 「量在別的地方」必須真的還在別的地方 —— 否則它就是純豁免', () => {
    // 🔴 `success` / `warning` 不進配對表的理由是「膠囊那格在實算它們」。
    //    **那句話一旦不成立,這兩顆就變成沒有任何東西在量。**
    //    ⇒ 這一格把那句話釘住:膠囊實算那個 describe 與那一格的標題必須還在本檔。
    //    ⚠️ 這是**本檔在檢查自己**,所以讀的是自己的原始碼、不是別人的。
    const self = readFileSync(__filename, 'utf8');
    expect(self, '膠囊配色 describe 不見了 ⇒ success/warning 變成無人看管').toContain(
      "describe('BMW M:狀態膠囊配色(片3b)'",
    );
    expect(self, '膠囊實算那一格不見了 ⇒ 同上').toContain('四顆膠囊的【算出來的】底與字都達標');
  });

  it('🔴 具名豁免不得變成空殼 —— 豁免的對象必須真的還在配對表裡', () => {
    // 🔴 **這一格擋的是「豁免留著、被豁免的那一列卻被刪了」** ——
    //    那時上面那格會綠,而綠的原因是「沒有東西可以豁免」,不是「都達標」。
    const known = new Set(PAIRS.map(([fg, bg]) => `${fg} on ${bg}`));
    const orphan = Object.keys(THIN_EXEMPT).filter((k) => !known.has(k));
    expect(orphan, '豁免指向一個不存在的配對 = 它已經不守任何東西了').toEqual([]);
  });

  it('🔴🔴 面板把手:透明度是【相對值】,換底色就換了意思', () => {
    // 本片把 `--primary` 從純黑換成 BMW 藍 ⇒ 同一個 `/60` 的 focus 態從 5.65 掉到 2.65。
    // **字面一個字沒動、三綠不會紅** ⇒ 這一格把「那顆藍 + 那個透明度」真的算一次。
    const shell = readFileSync(
      join(__dirname, '..', 'components', 'layout', 'workspace-shell.tsx'),
      'utf8',
    );
    const primary = parseColor(tokenOf('primary'));
    const bg = parseColor(tokenOf('background'));

    // 焦點態 = 不透明(WCAG 2.4.7 可見焦點;把手是可聚焦的 window splitter)
    // ⚠️ 用**邊界**判「後面沒有 `/透明度`」,不要靠尾隨空白(R2 nit9:class 排序工具把它排到
    //    字串結尾時,`toContain('… ')` 會變成假紅 —— 那時紅的原因與這格要守的事無關)。
    expect(
      /focus-visible:bg-primary(?![\w/-])/.test(shell),
      'focus 態必須是不透明的 primary,不是任何透明度',
    ).toBe(true);
    expect(contrast(primary, bg)).toBeGreaterThanOrEqual(3.0);

    // hover 態 = 帶透明度,但疊回底色後仍要 ≥3.0
    const pct = /hover:bg-primary\/(\d+)/.exec(shell)?.[1];
    expect(pct, '把手的 hover 態不見了 —— 改名或刪掉都要回來重算').toBeDefined();
    const got = contrast(over(primary, Number(pct) / 100, bg), bg);
    expect(got, `hover:bg-primary/${pct} 疊回底色只有 ${got.toFixed(2)}`).toBeGreaterThanOrEqual(3.0);
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

// ── oklab 混色(片3b):狀態膠囊的底與字都是 `color-mix(in oklab, …)` 運算式 ──────────
//    🔴 **不能用 token 對 token 去量它們** —— `--success` / `--warning` 從來不直接當顏色用,
//       它們是**混色的輸入**。拿 `--success on --card` 去斷言,量的是一個畫面上不存在的組合
//       (本 repo 已有一整條教訓叫「量錯東西」)。⇒ 這裡把 CSS 真正會算出來的值算出來。
const M1 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.680699545, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const M2 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];
// 🔴 這兩個反矩陣**必須自己宣告** —— `oklchToRgb` 上面那支是把同樣的常數**寫在算式裡**,
//    沒有留下可重用的名字。我第一版直接寫 `M2inv` ⇒ `ReferenceError`,
//    **而它是被上面那格正向對照抓到的,不是被型別檢查抓到的**(vitest 不跑 tsc)。
//    📎 這正是「正向對照」存在的理由:少了它,`fromOklab` 壞掉時
//       下面那格會拿一堆爛數字去比對比,而**爛數字也可能剛好過 4.5**。
const M2inv = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
];
const M1inv = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];
const toOklab = (rgb: RGB): [number, number, number] => {
  const lin = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const lms = M1.map((r) => Math.cbrt(r[0]! * lin[0]! + r[1]! * lin[1]! + r[2]! * lin[2]!));
  return M2.map((r) => r[0]! * lms[0]! + r[1]! * lms[1]! + r[2]! * lms[2]!) as [
    number,
    number,
    number,
  ];
};
const fromOklab = (lab: [number, number, number]): RGB => {
  const lms = M2inv.map((r) => (r[0]! * lab[0]! + r[1]! * lab[1]! + r[2]! * lab[2]!) ** 3);
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return M1inv.map((r) => enc(r[0]! * lms[0]! + r[1]! * lms[1]! + r[2]! * lms[2]!)) as RGB;
};
/** `color-mix(in oklab, a pctA%, b)` —— CSS 規範:未標百分比者取剩餘量。 */
const mixOklab = (a: RGB, pctA: number, b: RGB): RGB => {
  const [la, lb] = [toOklab(a), toOklab(b)];
  const t = pctA / 100;
  return fromOklab([0, 1, 2].map((i) => la[i]! * t + lb[i]! * (1 - t)) as [number, number, number]);
};

describe('BMW M:狀態膠囊配色(片3b)', () => {
  const BLACK: RGB = [0, 0, 0];
  // 🔴🔴 **剝掉 CSS 註解再找規則 —— 我第一版沒剝,而正規式命中了【我自己註解裡的例子】。**
  //    那段註解為了解釋降級值,逐字寫了 `.cap-y{background:<降級>}` ——
  //    `\.cap-y\s*\{[^}]*\}` 先命中它,於是守門拿註解去當規則檢查 ⇒ **在正確的原始碼上就紅了。**
  //    ⚠️ 這是本 session 第三次踩「【提起】與【做了】字面相同」:
  //       前兩次是 `grep -c 'm-stripe'`(得 3)與 `grep -c "label:"`(得 11)。
  //       **修法一樣:用位置或結構判,不用出現判。**
  const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (cls: string) =>
    new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`, 's').exec(CSS_CODE)?.[0];

  it('🔴 混色實作要有正向對照 —— 100% 回原色、0% 回底色', () => {
    // 沒有這一格,下面那格算錯了也會是綠的(混色壞掉通常不會壞成「明顯錯的顏色」)。
    const a = hexToRgb('#0066b1');
    const b = hexToRgb('#ffffff');
    expect(mixOklab(a, 100, b)).toEqual(a);
    expect(mixOklab(a, 0, b)).toEqual(b);
  });

  it('🔴🔴 四顆膠囊的【算出來的】底與字都達標 —— 這是換配色的驗收條件', () => {
    const card = parseColor(tokenOf('card'));
    const cases: Array<[string, RGB, RGB, string]> = [
      // ⚠️ 百分比寫成 `--card` 那一側(84/82/87/84),**與 `globals.css` 的參數順序一致** ——
      //    `A 16%, B` ≡ `B 84%, A`,值相同;順序之所以重要見下一格(降級值)。
      [
        'cap-n 灰 還沒訂',
        mixOklab(card, 84, parseColor(tokenOf('muted-foreground'))),
        parseColor(tokenOf('fg-2')),
        'OD :207',
      ],
      [
        'cap-y 黃 訂了沒到',
        mixOklab(card, 82, parseColor(tokenOf('warning'))),
        mixOklab(BLACK, 38, parseColor(tokenOf('warning'))),
        'OD :208-209',
      ],
      [
        'cap-bl 藍 到了沒出',
        mixOklab(card, 87, parseColor(tokenOf('primary'))),
        parseColor(tokenOf('primary')),
        'OD :210',
      ],
      [
        'cap-g 綠 出去了',
        mixOklab(card, 84, parseColor(tokenOf('success'))),
        mixOklab(BLACK, 22, parseColor(tokenOf('success'))),
        'OD :211-212',
      ],
    ];
    const fails = cases.flatMap(([name, bg, fg, src]) => {
      const got = contrast(fg, bg);
      return got >= 4.5 ? [] : [`${name}(${src})= ${got.toFixed(2)},需 4.5`];
    });
    expect(fails, '膠囊配色有不達標的').toEqual([]);
  });

  it('🔴 實心紅那顆(未收出貨)的白字達標', () => {
    // OD :214 `.cap.risk{background:var(--danger);color:var(--accent-on)}`
    expect(
      contrast(hexToRgb('#ffffff'), parseColor(tokenOf('destructive'))),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('🔴🔴 底色混色的【第一個參數必須是 `var(--card)`】—— 這是老瀏覽器降級值的來源', () => {
    // 🔴 **這一格守的是一個【原始碼上看不出來】的行為。**
    //    lightningcss 會自動為 `color-mix` 產生降級版,**降級值 = 混色的第一個參數**。
    //    照 OD 的原順序寫(`var(--warning) 18%, var(--card)`),降級值就是 `var(--warning)`,
    //    而字色的降級值**也是** `var(--warning)` ⇒ **同色字疊同色底 = 膠囊整個看不見**
    //    (四顆裡有三顆會這樣)。把 `--card` 換到第一個參數即可 —— 值等價、降級值變白底。
    // ⚠️ **不要「照 OD 的順序改回去」** —— 那不是還原設計,那是把三顆膠囊在舊瀏覽器上關掉。
    // 📎 這個坑是**驗編譯產物**才看到的;而我第一次的修法(在前面多寫一行降級值)
    //    被 lightningcss 把它自己的降級值接在後面蓋掉 ⇒ **看原始碼會以為修好了。**
    for (const cls of ['cap-n', 'cap-y', 'cap-bl', 'cap-g']) {
      const rule = ruleOf(cls);
      expect(rule, `globals.css 找不到 .${cls}`).toBeDefined();
      expect(
        String(rule).replace(/\s+/g, ' '),
        `.${cls} 的底色混色第一個參數不是 var(--card) ⇒ 舊瀏覽器降級值會變成同色字疊同色底`,
      ).toContain('background: color-mix(in oklab, var(--card)');
    }
  });

  it('🔴🔴 值必須留成【運算式】—— 有人把 color-mix 求值成 hex 就紅', () => {
    // 設計參照 §5:求值之後,未來改主色時膠囊不會跟著動,而**沒有任何守門會紅**。
    // ⇒ 這一格就是那個會紅的東西。
    for (const cls of ['cap-n', 'cap-y', 'cap-bl', 'cap-g']) {
      const rule = ruleOf(cls);
      expect(rule, `globals.css 找不到 .${cls}`).toBeDefined();
      expect(String(rule), `.${cls} 的值被求成靜態色了`).toContain('color-mix(in oklab');
    }
  });

  it('🔴 膠囊是方角(Sean 2026-08-16 拍板),共用形狀常數不得再帶 pill', () => {
    const view = readFileSync(join(__dirname, '..', 'lib', 'orders', 'order-list-view.ts'), 'utf8');
    const decl = /export const STATUS_CAPSULE = '([^']*)'/.exec(view)?.[1];
    expect(decl, '找不到 STATUS_CAPSULE 宣告').toBeDefined();
    // 🔴 只看【宣告出來的那一串】,不看整支檔 —— 檔裡的註解正在解釋 pill 為什麼被拿掉。
    expect(String(decl), 'STATUS_CAPSULE 又帶回圓角了').not.toMatch(/round/);
  });
});

describe('BMW M:--border-soft 三階邊框(片3)', () => {
  // 🔴🔴 **這一組守的是「假落地」本身,不是某個值。**
  //    片1 刻意沒補這顆 token,理由是「宣告在、消費端 0」= 一個綠著的空殼
  //    (檔頭 `--motion-*` 那一列就是活教材)。⇒ **那條理由必須有機械載體,否則下次照樣發生。**
  //    這三格分別釘住鏈條的三個環:**宣告 → Tailwind 映射 → 真的有人用**。
  //    少任何一環,`border-border-soft` 都會變成「寫了但沒有邊框」,而且**不報錯、不會紅**。
  it('🔴 ① 宣告在 `:root`', () => {
    expect(ROOT).toMatch(/^\s*--border-soft:\s*#edf1f6;/m);
  });

  it('🔴 ② `@theme inline` 有映射 —— 少了它 class 根本不存在', () => {
    // Tailwind v4 只為 `@theme` 裡的 `--color-*` 產生 class。
    // ⚠️ 邊界要硬失敗,不能找不到就靜默切片(與動效 token 那格同一條教訓)。
    const themeMatch = /@theme\s+inline\s*\{/.exec(CSS);
    expect(themeMatch, '@theme inline 區塊必須存在').not.toBeNull();
    expect(CSS.slice(themeMatch!.index)).toContain('--color-border-soft: var(--border-soft);');
  });

  it('🔴🔴 ③ 真的有消費端 —— 這一格就是片1 當初不補它的那個理由', () => {
    const table = readFileSync(
      join(__dirname, '..', 'components', 'orders', 'orders-table.tsx'),
      'utf8',
    );
    // 🔴 要判的是【做了】不是【提起】——上面那段註解裡就提到 `border-soft` 好幾次。
    //    (本 session 已經踩過一次:`grep -c 'm-stripe'` 預期 1、實得 3,另外 2 個在註解裡。)
    //
    // 🔴🔴 **第一版我用 `className=` 正規式抓,而它【漏掉樣板字串的插值】** ——
    //    這一行的真實形狀是
    //      className={`hover:bg-muted relative ${'${'}first ? 'border-t' : 'border-t border-border-soft'}`}
    //    ⇒ 類別住在 `${'${…}'}` **裡面**的單引號字串,`className=` 那條抓不到它。
    //    **它紅了才發現,而紅的原因看起來像「消費端不存在」—— 與真的沒做長得一模一樣。**
    //    ⇒ 改用**剝註解**:本格問的是「這是不是真程式碼」,剝註解正是對的方向。
    //    ⚠️ **注意與同檔『裸圓角』那格方向相反,那不是矛盾**:
    //       那格問「Tailwind 會不會產出這條規則」(它連註解都掃)⇒ **不能**剝註解;
    //       本格問「有沒有人真的用了它」⇒ **必須**剝註解。**問題不同,量法就不同。**
    const stripped = table.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(stripped.length, '剝完註解幾乎沒東西了 = 剝過頭,這格會恆綠').toBeGreaterThan(2000);
    expect(
      stripped.includes('border-border-soft'),
      'orders-table 的程式碼(非註解)沒有用到 border-border-soft ⇒ token 又變成空殼',
    ).toBe(true);
  });

  it('🔴 列 hover 是全強度,不是被透明度稀釋掉的', () => {
    // OD `:176` 是 `background:var(--surface-warm)`,沒有透明度。
    // `/40` 疊回白底對比只有 1.02 ⇒ 滑過去看不出來,而整列可點時 hover 是唯一的落點訊號。
    const table = readFileSync(
      join(__dirname, '..', 'components', 'orders', 'orders-table.tsx'),
      'utf8',
    );
    expect(
      /hover:bg-muted(?![\w/-])/.test(table),
      '列 hover 必須是全強度 bg-muted(不得再被 /40 之類稀釋)',
    ).toBe(true);
  });
});

describe('BMW M:無陰影(片6;Sean 2026-08-16 批「3 可以做」)', () => {
  // 依據 = OD 原稿立場,不是品味:`grep -c 'var(--elev-raised)'` → 0(唯一的投影式陰影宣告在、用值 0);
  // `grep -c 'box-shadow'` → 10,全是 1px 描邊 / focus 環 / inset 色條 / none。
  const adminSources = (): Array<[string, string]> => {
    const { globSync } = require('node:fs') as typeof import('node:fs');
    const files = globSync(join(__dirname, '..', '**', '*.{ts,tsx}')) as string[];
    expect(files.length, 'glob 掃到太少檔 = 這一格失去判別力').toBeGreaterThan(300);
    return files
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .map((f) => [f, readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);
  };

  it('🔴 投影式陰影(`shadow-xs/sm/md/lg/xl`)全站零殘留', () => {
    // 🔴 剝註解:本片在 `button.tsx` 寫的理由段就逐字提到 `shadow-xs`。
    //    **要判的是【還有沒有人在用】,不是【有沒有人提到】。**
    const offenders = adminSources()
      .filter(([, src]) => /\bshadow-(xs|sm|md|lg|xl)\b/.test(src))
      .map(([f]) => f.replace(/.*\/src\//, 'src/'));
    expect(offenders, '投影式陰影復發 —— BMW M 用 1px 描邊分層,不用投影').toEqual([]);
  });

  it('🔴🔴 未收款標記與側欄描邊是承重的,不得被當成陰影一起掃掉', () => {
    // 🔴 這一格與上一格**方向相反**:上面禁止,這裡**要求存在**。
    //    合報「13 處 shadow」會讓下一個人一次 sed 掃掉,而這兩處掃掉會拿走真訊號:
    //      · 未收款標記 = 「這張單還沒收到錢」的唯一視覺載體
    //      · `ui/sidebar.tsx` 的 1px 描邊 = OD `--elev-ring` 的形狀本身
    //
    // 🔴🔴 **2026-08-17 片 A-1:未收款那半換了【載體】,沒有換【它守什麼】。**
    //    舊 = `order-status-axes.ts` 裡的 Tailwind 任意值 `shadow-[0_0_0_1.5px_var(--destructive)…]`(雙層**外**環)
    //    新 = 元件端只掛 class `cap-unpaid`,規則本體在 `globals.css`(OD `-bmw-m:218` 的 **inset 左緣紅槓**)
    //    ⇒ **這一格必須跟著移到新載體上** —— 不移的話它守的是一個已經不存在的字面,
    //       而那種格子的紅**不代表訊號不見了**,只代表「這格自己過期了」。
    //    ⚠️ **兩端都要釘**:只釘元件端 ⇒ CSS 規則被刪不會紅;只釘 CSS ⇒ 元件不掛 class 不會紅。
    const src = (p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
    expect(src(['lib', 'orders', 'order-status-axes.ts']), '未收款標記的 class 不見了').toMatch(
      /unpaid:\s*'cap-unpaid'/,
    );
    expect(CSS, '未收款標記的 CSS 規則不見了').toMatch(
      /\.cap-unpaid\s*\{[^}]*box-shadow:\s*inset\s+3px\s+0\s+0\s+var\(--destructive\)/,
    );
    // 🔴 **未收出貨那顆例外【不在 CSS 裡】,而那是刻意的** —— OD `-bmw-m:219` 是
    //    「掛上去再用 `.cap.risk.m-unpaid{box-shadow:none}` 蓋掉」;我方 `isRisk` 分支**不套 mark**。
    //    ⇒ 照 OD 寫會產生一條**永遠選不到元素的死 CSS**(片 A-1 試過、測試當場抓到)。
    //    ⇒ 「未收出貨不吃 mark」由 `order-status-axes.test.ts` 在**元件端**釘,不在這裡。
    expect(CSS, '死 CSS 復活:.cap-risk.cap-unpaid 選不到任何元素').not.toMatch(
      /\.cap-risk\.cap-unpaid/,
    );
    expect(src(['components', 'ui', 'sidebar.tsx']), '側欄 1px 描邊不見了').toMatch(
      /shadow-\[0_0_0_1px_var\(--sidebar-border\)\]/,
    );
  });

  it('🔴🔴 選中訂單的色塊:CSS 那半也要釘 —— DOM 那半綠不代表畫面上看得到', () => {
    // 🔴🔴 **這一格是 V 窗 R1 的 F-2,而它的份量不在「少一格」,在【我知道這條原則、
    //    在同一片裡對 `cap-unpaid` 執行了它(上一格的「兩端都要釘」)、而這個漏掉】。**
    //
    // **漏掉的世界長什麼樣**:把 `globals.css` 那條 `[data-selected]` 規則刪掉 ⇒
    //   · `orders-table.test.tsx` 的 4 格 DOM 守門**照樣全綠**(屬性還在 DOM 上)
    //   · 畫面回到「點開面板左邊沒反應」= 改版前的樣子
    //   ⇒ **綠燈 + 功能不見,而那正是 Sean 點名的第一件事。**
    //
    // ⚠️ **釘「存在 + 關鍵值」,不釘整條規則字面** —— 釘整條會在任何微調時假紅。
    //    兩個關鍵值各自承重:`inset` 少了會被 `.orders-grid td` 的 `overflow:hidden` 切掉;
    //    `var(--primary)` 少了就不是 M 藍。
    expect(CSS, '選中訂單的色塊規則不見了 ⇒ 點開面板左邊不會有任何變化').toMatch(
      /\.orders-group\[data-selected\][^{]*\{[^}]*box-shadow:\s*inset\s+3px\s+0\s+0\s+var\(--primary\)/,
    );
    // 🔴 底色那半分開釘:只有左緣條而沒有底色時,多品項單的第 2、3 列**看不出屬於同一組**
    //    (左緣條在每一格畫,但整組的「亮起來」是底色帶的)。
    //
    // 🔴🔴 **`var(--card)` 必須是【第一個參數】,而這一維是本片【刻意與 OD 相反】的承重設計。**
    //    OD `-bmw-m:177` 寫的是 `color-mix(in oklab, var(--accent) 8%, var(--surface))`(強調色在前);
    //    我方**故意對調**成 `var(--card) 92%, var(--primary)` —— **數學等值,降級行為相反**:
    //    lightningcss 會自動產老瀏覽器降級版,而它挑的降級值 = **第一個參數**
    //    ⇒ 照 OD 的順序寫,降級值就是純 `var(--primary)` ⇒ **整列變實心藍**。
    //
    //    ⚠️ **V 窗 R2 的 nit,而它守的是我自己的論證**:我第一版的 regex 是 `color-mix([^)]*var(--card)`,
    //    **只要 `--card` 出現在裡面就過** ⇒ 把兩個參數對調回 OD 序:
    //      · 這兩顆釘 **照樣綠**
    //      · 正常瀏覽器 **照樣亮**
    //      · 只有降級瀏覽器整列變實心藍 —— **而那台機器不在任何一條測試路徑上。**
    //    🔴 **通則**:釘「存在 + 關鍵值」時,「關鍵值」要包含**你刻意選擇的那些維度**,
    //       不只是看得到的視覺結果。**刻意的偏離沒被守住 = 那段論證遲早被還原掉。**
    expect(CSS, '選中訂單的淺藍底不見了 ⇒ 多品項單看不出整組被選中').toMatch(
      /\.orders-group\[data-selected\][^{]*\{[^}]*background:\s*color-mix\(\s*in oklab,\s*var\(--card\)/,
    );
  });

  it('🔴🔴 那條描邊不得用 `hsl()` 包 —— 包了整條 box-shadow 會被丟棄', () => {
    // 🔴 **它從 fork 進來就是壞的,不是本線弄壞的**:`--sidebar-border` 舊值是 `oklch(...)`,
    //    包成 `hsl(oklch(...))` 一樣不是合法顏色;片1 換成 hex 之後變 `hsl(#d7dee8)`,同樣無效。
    //    ⚠️ **機制是 computed-value time 失效,不是 parse 報錯**(自訂屬性不驗證內容)
    //    ⇒ **不會有任何 build 警告**,而畫面上就是「那條線一直都不存在」。
    const src = readFileSync(join(__dirname, '..', 'components', 'ui', 'sidebar.tsx'), 'utf8');
    expect(/shadow-\[[^\]]*hsl\(/.test(src), 'ring 又被 hsl() 包起來了 ⇒ 那條線會消失').toBe(false);
  });
});

describe('BMW M:表格內文色 --fg-2(片5)', () => {
  const CSS_CODE2 = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  it('🔴 `.orders-grid` 容器帶 `color: var(--fg-2)`(OD :167/:171)', () => {
    const rule = /\.orders-grid\s*\{[^}]*\}/s.exec(CSS_CODE2)?.[0];
    expect(rule, '找不到 .orders-grid 容器規則').toBeDefined();
    expect(String(rule)).toContain('color: var(--fg-2)');
  });

  it('🔴🔴 顏色【不得】下放到 `.orders-grid td` —— 那會靜默殺掉表格內 4 處刻意的次要色', () => {
    // 🔴 **這一格擋的是一個【看起來更直接、更像照 OD】的改法。**
    //    OD 寫的是 `table.g td{color:var(--fg-2)}`,所以「照搬」的直覺就是往 td 上放。
    //    但我方的 td 上有 6 個 utility `text-muted-foreground`,而
    //    `.orders-grid td` 是 (0,2,0)、utility 是 (0,1,0) ⇒ **類別選擇器贏,那 6 個全失效**,
    //    **而畫面只會「看起來顏色一致」,沒有任何東西會紅。**
    // ⚠️ 所以本片用【容器繼承】:繼承只提供初始值,格子上的顏色一定贏。
    const tdColorRules = [...CSS_CODE2.matchAll(/\.orders-grid\s+td\s*\{[^}]*\}/gs)]
      .map((m) => m[0])
      .filter((r) => /(^|[^-])color\s*:/.test(r.replace(/[a-z-]*color\s*:/g, (s) => s)));
    const offenders = tdColorRules.filter((r) => /[^-]color\s*:\s*var\(--fg-2\)/.test(r));
    expect(offenders, '有人把 --fg-2 下放到 .orders-grid td ⇒ 6 個次要色格會靜默失效').toEqual([]);
  });

  it('🔴 單號格保留主文字色(OD :181)—— 它是整列的主識別', () => {
    expect(CSS_CODE2).toMatch(/\.orders-grid\s+td\.col-oid\s*\{[^}]*color:\s*var\(--foreground\)/s);
  });

  it('🔴 那些刻意的次要色還在 —— 少了它們,上面兩格就失去對象', () => {
    // 分母斷言:數字掉了代表有人把次要欄的顏色拿掉,而那時「繼承 vs td」的整套理由都要重看。
    //
    // 🔴🔴 **這個數字我報錯過一次,而錯法值得留著**:第一版寫「6」,來源是 `grep -c`。
    //    那個 6 裡面有 **1 個是我自己的註解**(它逐字提到 `text-muted-foreground`),
    //    而且**還有 1 個是 `TH` 自己**(本片正是把它拿掉的那個)⇒ 落筆當下真值早就不是 6。
    //    **逐行分類後**(剝註解):**5 處** = 表格內 4(日期格 / 車種格 / 格內小字 / 破折號)
    //    + 空狀態區塊 1(**那一塊根本不在表格裡**,不受容器繼承影響)。
    //    ⇒ **`grep -c` 數的是【行】而且含註解,不是【真的用到幾次】。先分類再報數。**
    //
    // 🔴 **2026-08-18 由 5 改成 6**(07=甲「另有 N 項」那一列,Sean 08-18 中午拍板)。
    //    第 6 個 = 那一列的 `<td>`(`orders-table.tsx` 搜 `另有`)。
    //    ⚠️ **它與另外 5 個吃同一個機制** —— utility (0,1,0) 贏容器繼承 ⇒
    //    上面那兩格(「不得下放到 td」)守的對象從 5 個變成 6 個,理由一個字沒變。
    //    ⇒ 這是**分母長大**,不是守門被放寬。
    const table = readFileSync(
      join(__dirname, '..', 'components', 'orders', 'orders-table.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    //
    // 🏁 **2026-08-18(`#631` 甲):5 → 6。而這一格【不是被我調高的,是它叫我回去重看理由,我看完了】。**
    //    🔴 **改期望值本來就是停止訊號**(規則 R4)⇒ 所以把「看了什麼、結論是什麼」寫在這裡,
    //       而不是把數字一改了事:
    //       · 新增的第 6 處 = `#631` 那一列「另有 …,點進去看」的 `<td>`。
    //       · 回去看 `globals.css` `.orders-grid` 那段的理由(容器繼承 `--fg-2`、格子上的顏色一定贏):
    //         它要防的是「**次要欄的顏色被拿掉**」而讓「繼承 vs td」那套論證失去對象。
    //       · 本次是**新增一個本來就該是次要色的格**(整列的補充說明,不是資料格)
    //         ⇒ 與那套論證**同向**,不是把它推翻。
    //    ⚠️ **這一格的判別力沒有變**:它仍然在任何一次增減時紅,而紅了就要再做一次上面這件事。
    //       **不要把它改成 `toBeGreaterThan`** —— 那會讓「有人拿掉兩個、又加回兩個」永遠不紅。
    const n = (table.match(/text-muted-foreground/g) ?? []).length;
    expect(n, `刻意的次要色從 6 變成 ${n} ⇒ 回去重看 globals.css .orders-grid 那段的理由`).toBe(6);
  });
});

describe('BMW M:摘要卡髮絲線格(片4a)', () => {
  const cards = () =>
    readFileSync(
      join(__dirname, '..', 'components', 'orders', 'order-detail-summary-cards.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ''); // 剝註解:上面那段註解逐字寫了這些 class 名

  it('🔴🔴 `gap-px` 與 `bg-border` 是一組 —— 少一個,分隔線就不存在', () => {
    // OD `:251-253` 的髮絲線是「格線縫隙透出容器底色」:
    //   只有 gap-px ⇒ 四格緊貼、完全沒有線;只有 bg-border 而 gap=0 ⇒ 底色被格子蓋住、看不到。
    // 🔴 兩者拆開來看都像「無害的樣式類別」,所以要把它們釘在同一格,理由才跟著走。
    const src = cards();
    const grid = /className='grid[^']*'/.exec(src)?.[0];
    expect(grid, '找不到摘要卡的 grid 容器').toBeDefined();
    expect(String(grid), '髮絲線格少了 gap-px').toContain('gap-px');
    expect(String(grid), '髮絲線格少了 bg-border(縫隙沒有底色可透)').toContain('bg-border');
  });

  it('🔴 每一格要有自己的底色 —— 否則整塊都是 border 色', () => {
    expect(cards(), '卡片格少了 bg-card').toMatch(/const CARD = '[^']*bg-card/);
  });
});

describe('BMW M:三色條(片2)', () => {
  it('🔴 三個色停是【硬寫的 hex】,不得被「收進 token」', () => {
    // OD `:83-86` 明文:這三停不在 tokens.css、是品牌圖案、**絕不當按鈕底色**。
    // 🔴 這一格擋的是一個**看起來像在做好事**的改動:有人覺得「硬寫 hex 很髒」而改成
    //    `var(--primary)` 之類 ⇒ 日後調強調色會**把品牌條一起調掉**,
    //    而畫面上只會看起來「顏色變了」,沒有人會發現那是品牌錯誤。
    const rule = /\.m-stripe\s*\{[^}]*\}/s.exec(CSS)?.[0];
    expect(rule, 'globals.css 找不到 .m-stripe 規則').toBeDefined();
    for (const stop of ['#0066b1', '#1c69d4', '#e22718']) {
      expect(rule, `三色條少了色停 ${stop}`).toContain(stop);
    }
    // 順序也要對:藍 → 深藍 → 紅。反了就不是 M 的條紋了,而三個色都還在、上面那圈會全過。
    const order = ['#0066b1', '#1c69d4', '#e22718'].map((s) => String(rule).indexOf(s));
    expect(order, '三停順序錯了(應為 藍 → 深藍 → 紅)').toEqual([...order].sort((a, b) => a - b));
    // 🔴 分母:規則裡不得出現 `var(` —— 那代表有人把色停換成 token 了。
    expect(String(rule).includes('var('), '三色條的色停被換成 var() 了').toBe(false);
  });

  it('🔴 側欄真的有掛上三色條 —— CSS 在而沒人用,等於沒做', () => {
    // 同「宣告在、消費端 0」那條教訓:規則存在不代表畫面上看得到。
    const sidebar = readFileSync(
      join(__dirname, '..', 'components', 'layout', 'app-sidebar.tsx'),
      'utf8',
    );
    expect(sidebar, 'app-sidebar 沒有使用 m-stripe').toContain('m-stripe');
  });
});

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

// ── #640:有表格的頁面不得帶 `max-w-` ────────────────────────────────────────────
//
// 🔴 **來歷**:Sean 2026-08-17 逐字「網頁都沒有滿版」⇒ `7f6d0ac1` 把六支列表頁的 `max-w-6xl` 拿掉。
//    **那個修法是對的,而它旁邊有一個洞**:改完之後**零守門**
//    (`grep -rn 'max-w-' apps/admin/src --include='*.test.*'` 在本格落地前 ⇒ **0 命中**)。
//
// 🔴🔴 **為什麼一定要有這一格**(不是「順手多加一個」):
//    仍帶 `max-w-*` 的四支是 `app/page.tsx` / `customers/[id]` / `products/[id]` / `orders/[id]` ——
//    **而那四支正是要做一個新後台頁面時最順手的複製樣板。**
//    ⇒ 這不是「有一天可能有人手滑」,是**現行複製路徑的預設輸出就是壞的那一種**,
//      而症狀(畫面右邊一片空白)**看起來像設計選擇,不像 bug** ⇒ 沒有人會回報。
//
// ⚠️ **這一格會擋人,所以它的錯誤訊息要說得出規則** —— 光有守門而沒有理由,
//    被擋的人只會去繞過它(#640 條目裡「②不能省」講的就是這件事;那四支的理由已補在各自檔內)。
//
// ⚠️ **誠實邊界**:`/<table|Table/` 是**字面**判準,它會把「import 了某個 `Table` 元件」的頁面
//    也算成有表格。**今天沒有那種頁**(四支未改的逐支量 ⇒ 0 命中),而哪天有,
//    正確的動作是**問那頁需不需要寬**,不是把判準改窄 —— 有 Table 通常就是需要寬。
describe('#640 有表格的 admin 頁面不得帶 `max-w-`(滿版守門)', () => {
  const listPages = () => {
    const { globSync } = require('node:fs') as typeof import('node:fs');
    const pages = globSync(join(__dirname, '**', 'page.tsx')) as string[];
    // 🔴 分母①:glob 掃不到檔 ⇒ 下面每一格都恆綠。2026-08-18 實測 admin 共 15 支 page.tsx。
    expect(pages.length, 'glob 掃到 0 支 page.tsx = 這一格失去判別力,不是通過').toBeGreaterThan(8);
    const withTable = pages.filter((p) => /<table|Table/.test(readFileSync(p, 'utf8')));
    // 🔴 分母②:判準對不上任何檔 ⇒ offenders 也會是空的。2026-08-18 實測 6 支。
    expect(
      withTable.length,
      '一支「有表格」的頁都沒認出來 = 判準壞了(或頁面結構變了),不是通過',
    ).toBeGreaterThan(3);
    return withTable;
  };

  it('🔴 有 `<table` / `Table` 的頁面,外框不得帶 `max-w-`', () => {
    const offenders = listPages()
      .filter((p) => /max-w-/.test(readFileSync(p, 'utf8')))
      .map((p) => p.replace(/^.*\/apps\/admin\//, 'apps/admin/'));
    expect(
      offenders,
      '這幾支頁面有表格卻被 `max-w-` 夾住 ⇒ 表格右邊會被切、而畫面上沒有任何提示。' +
        '規則:有表格 = 列表頁 = 吃滿寬;沒有表格的詳情/表單頁才留 `max-w-`(長文字行過寬更難讀)。' +
        '若這頁真的是詳情頁而只是 import 了 Table 元件,請在該檔寫一行說明再來調整本格。命中:' +
        offenders.join(' / '),
    ).toEqual([]);
  });

  it('🔴 負向對照:判準本身認得出 `max-w-`(不然上一格是恆綠的)', () => {
    // 上一格是「零命中 = 通過」的形狀 ⇒ 必須證明那把尺在【該紅的世界】會紅。
    // 用**真的還帶著 `max-w-` 的那四支**當測資,不是自己編一段字串。
    const { globSync } = require('node:fs') as typeof import('node:fs');
    const all = globSync(join(__dirname, '**', 'page.tsx')) as string[];
    const withMaxW = all.filter((p) => /max-w-/.test(readFileSync(p, 'utf8')));
    expect(
      withMaxW.length,
      'repo 內一支帶 `max-w-` 的頁都找不到 ⇒ 上一格的「零命中」證明不了任何事',
    ).toBeGreaterThan(0);
    // 而它們必須全部是**沒有表格**的那一種 —— 否則上一格早該紅了,兩格會自相矛盾。
    const contradiction = withMaxW.filter((p) => /<table|Table/.test(readFileSync(p, 'utf8')));
    expect(contradiction, '兩格自相矛盾:同一支檔同時「有表格」與「帶 max-w-」').toEqual([]);
  });
});
