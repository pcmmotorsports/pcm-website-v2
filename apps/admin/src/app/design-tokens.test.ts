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

describe('圓角 token(2026-08-23 由直角改回推導)', () => {
  it('🔴 根值 8px,四階【全部】回到 `calc()` 推導 —— 少一階就會出現「大致圓角但某一階不是」', () => {
    // 🏁 **2026-08-23 Sean 拍板「乙 —— 不算了,照 OD 新稿全部圓角」。**
    //
    // ~~原本:`--radius` 與四階全部釘 0~~
    // 🔴 **舊格的推理留著,因為它是【改回直角要付什麼代價】的說明書**:
    //    「`--radius: 0` 之下那組推導會產生 sm=−4px / md=−2px / **xl=+4px(根本不是直角)**」
    //    ⇒ 誰要再改回直角,**不能只把根值設 0,要連四階一起釘死**。
    //
    // 🔴 **8px 是數出來的**:掃 OD 產物 `orders-admin-v2.html` 的 `border-radius` 實際用值
    //    ⇒ `8px 22 次 / 4px 3 次 / 6px 2 次 / 12px 3 次`,**與 lg/sm/md/xl 逐一對上**。
    // ⚠️ **本格釘的是「四階由根值推導」這個結構,不是那四個數字** ——
    //    有人把某一階改成寫死值 ⇒ 紅(那正是「改根值卻有一階不動」的病)。
    expect(CSS).toMatch(/^\s*--radius:\s*8px;/m);
    expect(CSS).toMatch(/^\s*--radius-xs:\s*2px;/m);
    expect(CSS).toMatch(/^\s*--radius-sm:\s*calc\(var\(--radius\) - 4px\);/m);
    expect(CSS).toMatch(/^\s*--radius-md:\s*calc\(var\(--radius\) - 2px\);/m);
    expect(CSS).toMatch(/^\s*--radius-lg:\s*var\(--radius\);/m);
    expect(CSS).toMatch(/^\s*--radius-xl:\s*calc\(var\(--radius\) \+ 4px\);/m);
  });

  it('🔴 `.fchip` 是【全圓膠囊】—— 2026-08-23 照 OD 新稿', () => {
    // ~~原本:`.fchip` 跟著 `--radius` 走,依據設計參照 §6.5.4「形狀傳達的是可不可以互動」
    //   ⇒ 可以點的直角、只能看的 pill。~~
    // 🏁 **那條規則 2026-08-23 被 Sean 明文推翻(「乙 不算了」)** ——
    //    OD 新稿把 `.fchip` 畫成 `border-radius:9999px`,而拍板是「照稿」。
    // ⚠️ **舊依據留著**:它解釋了為什麼這一格曾經釘 `var(--radius)`,
    //    也是「如果哪天想把形狀語意找回來」的入口。
    expect(CSS).toMatch(/\.fchip\s*\{[^}]*border-radius:\s*9999px/s);
  });
});

describe('BMW M token:邊框與動效', () => {
  it('🔴 `--input` 是 `#8b93a1` —— OD 2026-08-23 改版稿的值', () => {
    // ~~舊值 `oklch(0.631 0 0)`~~ **2026-08-23 換成 OD 改版稿的 `#8b93a1`**
    // (Sean 拍板逐字「OD 現在設計稿用什麼,就用什麼」)。
    //
    // 🔴🔴 **舊值的來歷留著,因為它解釋了「為什麼這一格存在」**:
    //    更早的 `oklch(0.94)` 對兩個底色只有 1.16 / 1.19;`oklch(0.631)` 是為了過 WCAG 1.4.11
    //    那道 3.0 才選的,而且是**在 `--accent` 變成暖填之後重算過的**(舊值在暖填上只有 2.90)。
    //
    // ⚠️🔴 **代價要寫在這裡,不要只寫在豁免表**:
    //    新值 `#8b93a1` 對新底 `#f8fafc` = **2.96**、對 `--accent` `#f1f5f9` = **2.82**,
    //    **兩者都【未達】1.4.11 的 3.0** ⇒ 上方對比矩陣以 `BELOW_EXEMPT` 具名豁免放行。
    //    **那是 Sean 2026-08-23 拍板「甲:照 OD 的稿用,把那道檢查調鬆一點」的結果,
    //      不是這一格自己判定它合格。**
    //    ⇒ OD 若修稿,這裡與 `BELOW_EXEMPT` 兩處要一起改。
    //
    // ⚠️ **這一格釘的是【字面】** —— 「底色改了而這個值沒重算」由下面那個 describe 的實算矩陣抓。
    expect(CSS).toMatch(/^\s*--input:\s*#8b93a1;/m);
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

// 🔴🔴 **`matchAll` / `exec` 的捕獲組在本 repo 是 `string | undefined`**(`noUncheckedIndexedAccess`)。
//    2026-08-23 我在這支檔**同一晚踩了兩次 `TS2532`**,而兩次都是 `m[1]` 直接拿來用 ——
//    **紅的不是這支測試,是全 repo 的 `pnpm typecheck`**,別的窗會在自己沒動過的檔上看到紅。
//    ⇒ 落筆規則:`m[1]` 一律先處置 —— 捕獲組必然存在就用 `!`,可能不存在就先 `if (… === undefined) throw`。
//    ⚠️ **不要用 `?? ''` 收尾** —— 那會把「沒抓到」變成一個空字串混進結果裡,而它不會叫。
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

  // 🔴🔴 **未達標的具名豁免(2026-08-23 Sean 拍板「甲:照 OD 的稿用,把那道檢查調鬆一點」)。**
  //
  //    ⚠️ **我提醒過他這是「動驗證」,他重申選甲 ⇒ 照做,並把理由與代價寫在這裡。**
  //
  //    🔴 **做成【具名豁免】而不是把門檻從 3.0 調低**,理由與上方 `THIN_EXEMPT` 同一條:
  //       調低門檻 = 其他 7 組非文字配對【一起】被放寬,而沒有人決定過那件事。
  //       具名豁免只放行這兩格,其餘照舊守 3.0。
  //    🔴 **豁免項仍然被【量】**:門檻換成「值必須還是我們記錄的那個」——
  //       有人再動 `--input` / `--background` / `--accent`,這一格**照樣紅**,
  //       而且紅在「豁免的前提變了」,不是靜靜放行。
  //
  //    **來源**:值取自 OD 2026-08-23 改版稿 `orders-admin-v2.html` 的最終渲染值
  //    (`--input: #8b93a1`;Sean 拍板逐字「OD 現在設計稿用什麼,就用什麼」)。
  //    ⚠️ **這是 OD 稿的一個【已知缺口】,不是我們的設計選擇** —— 改版前我們是達標的
  //    (舊值 `oklch(0.631 0 0)`)。OD 自己那張對比表**沒有列到 `--input` 這一格**,
  //    所以他們不知道。**已回報,若他們修稿,這兩條豁免要一起撤掉。**
  const BELOW_EXEMPT: Record<string, { got: number; why: string }> = {
    'input on background': {
      got: 2.96,
      why: 'OD 改版稿 `--input:#8b93a1` 對新底 `#f8fafc`;差 0.04。Sean 2026-08-23 拍板照稿。',
    },
    'input on accent': {
      got: 2.82,
      why: 'same,對 `--accent:#f1f5f9`;差 0.18。hover 態(border-input hover:bg-accent)。',
    },
  };

  it('🔴 每一組【文字 × 底色】都達標 —— 失敗時印出實測值,不要只說 false', () => {
    expect(PAIRS.length, '配對表被清空 = 這一格失去判別力').toBeGreaterThan(15);
    // 🔴 豁免的分母也要守:清空 `BELOW_EXEMPT` 不會讓這格變綠,但**加一筆進去要被看見**。
    expect(
      Object.keys(BELOW_EXEMPT).length,
      '未達標豁免變多了 ⇒ 有人在放行新的不達標組合,這需要拍板不是順手加',
    ).toBe(2);
    const fails = PAIRS.flatMap(([fg, bg, need, where]) => {
      const got = contrast(parseColor(tokenOf(fg)), parseColor(tokenOf(bg)));
      if (got >= need) return [];
      const ex = BELOW_EXEMPT[`${fg} on ${bg}`];
      // 豁免的前提 = 「它還是我們當初記錄的那個值」。漂了就不再是同一件事,要重新裁。
      if (ex && Math.abs(got - ex.got) < 0.01) return [];
      return [
        `--${fg} on --${bg} = ${got.toFixed(2)}(需 ${need})  ← ${where}` +
          (ex
            ? `  🔴 具名豁免記的是 ${ex.got},實測已漂到 ${got.toFixed(2)} ⇒ 豁免前提變了,要重裁`
            : ''),
      ];
    });
    expect(fails, '色票有組合不達標(且不在具名豁免內)').toEqual([]);
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
  // 🔴 R1 nit 3:剝除器要認字串 —— 舊版正規式遇到 `content:"/*"` 會把後面整段吃掉
  //    (失敗形狀是 loud 的「找不到 .x」, 但量具自己就該對)。現行檔 11 處 content: 零個含 /*(R1 查)。
  const CSS_CODE = (() => {
    let out = '';
    for (let i = 0; i < CSS.length; i++) {
      const ch = CSS[i]!;
      if (ch === '/' && CSS[i + 1] === '*') {
        const end = CSS.indexOf('*/', i + 2);
        i = (end === -1 ? CSS.length : end + 2) - 1;
      } else if (ch === '"' || ch === "'") {
        const s0 = i;
        i++;
        while (i < CSS.length && CSS[i] !== ch) i += CSS[i] === '\\' ? 2 : 1;
        out += CSS.slice(s0, i + 1);
      } else out += ch;
    }
    return out;
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // 🔴🔴🔴 **級聯解析器 —— 這是同一個病的【第三次】修法,前兩次都只修掉一半。**
  //
  //    ① 第一次:守門讀到【死掉的規則】(`ruleOf` 用 `.exec` 只取第一筆,而贏的在後面)
  //    ② 第二次:守門讀到【我手打在測試裡的比例】(換了真相來源,沒換取得方式)
  //    ③ 第三次(本次):**我寫來修 ① 的求值器,自己用 `.exec` 只取第一筆。**
  //
  //    🔴 **R3 給了兩發突變,而它們【都是綠的】—— 缺陷成立,不是假想:**
  //       · `globals.css` 檔尾追加 `:root{--tint-warn:#f59e0b}`(級聯後者贏)
  //         ⇒ 真值對比 3.61,而求值器仍讀前面那筆算 6.93 ⇒ 44 passed
  //       · `.cap-n` 的 `88%` 改成 `20%`(真值 2.43)⇒ 守門照算 8.98 ⇒ 44 passed
  //       ⚠️ 而追加 `:root` **不是假想的用法** —— 這支檔本來就有第二個 `:root` 區塊。
  //
  //    📌 **判別句要升一級**:上一版寫「那個數字是【讀出來的】還是【我打的】?」——
  //       我通過了那一問,然後死在下一問:**讀出來的是【級聯之後會贏的那一筆】嗎?**
  //
  //    ④ 第四次(R4,2026-08-24):③那版的 winningValue 仍用「選擇器字串**全等**」當匹配
  //       ⇒ 具體度 / at-rule 條件 / !important 寫法變體 / longhand 屬性名 —— 四族全隱形。
  //       **那不是四個 bug,是一個判準的四個出口** ⇒ 整層重寫,不補洞
  //       (plan 與批覆:~/pcm-mailbox/06-PLAN-級聯解析器重寫-20260824.md / SUB2-008)。
  //
  //    ⇒ 新判準一句話:**凡是會影響「誰贏」的軸 —— 匹配、條件(at-rule/層)、重要性、
  //       屬性名 —— 要嘛算出來,要嘛 throw,要嘛【具名釘在清單裡】(模型外集合那格)。**
  //    🔴 第一版寫「不再存在看不到的出口」(R1 證偽);第二版寫「收斂到兩個具名處」(R2 再證偽:
  //       F1 繪製軸屬性、F2 重複字面通道 —— 同一句修過一次仍太寬 = 對射程估得太樂觀)。
  //       ⇒ 第三版只【列舉已知】並【明說清單開放】:
  //       已知的出口 —— ①模型外集合(標籤/`*`/:where 形狀;條數釘住)②plan §6 射程(產物層/
  //       Tailwind/inline style = 真瀏覽器領域)③繪製軸劫持屬性(已改 throw)④QUERYABLE 外的
  //       屬性軸(入口 throw 逼同步)。**這份清單是開放的**:R1 找到三種、78 補三發、作者自撞
  //       @apply、R2 又兩種、自查又一種 —— 沒有任何一種在原作者字集裡;下一種會再出現,
  //       判準只有「凡不確定 ⇒ 吵, 不要靜」。
  // ══════════════════════════════════════════════════════════════════════════════

  /** 一筆宣告:屬性、值、!important、全域可比的源序。 */
  type Decl = { prop: string; value: string; important: boolean; order: number };
  /** 一條規則:選擇器清單(已切開)、宣告區塊、源序、祖先 at-rule 鏈。 */
  type Rule = { selectors: string[]; body: string; order: number; ats: string[]; inAtRule: boolean };

  /**
   * 掃出所有規則。括號深度走訪 + **字串跳過**(R4 C1:`content:"}"` 曾讓整張規則表從那裡起錯位,
   * 量到 cap-g 假紅 2.22)。
   * 🔴 走訪結束驗 stack 殘量 = 0 —— 括號不平衡要當場吵(R4 點名舊版零自檢),不是靜默錯位。
   * 🔴 CSS nesting(style rule 裡再開 style rule)不解析、當場 throw —— 巢狀選擇器的匹配是
   *    另一個判準軸,隱形比不支援貴。
   */
  /** 括號/中括號深度 0 才切逗號(R2 F6:`:where(a,button,…):focus-visible` 是一個選擇器,不是三個)。 */
  const splitSelectors = (prelude: string): string[] => {
    const parts: string[] = [];
    let cur = '';
    let depth = 0;
    for (const ch of prelude) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    return parts.map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x !== '');
  };

  const parseRules = (css: string): Rule[] => {
    const out: Rule[] = [];
    const stack: Array<{ prelude: string; bodyStart: number }> = [];
    let preludeStart = 0;
    for (let i = 0; i < css.length; i++) {
      const ch = css[i]!;
      if (ch === '"' || ch === "'") {
        i++;
        while (i < css.length && css[i] !== ch) i += css[i] === '\\' ? 2 : 1;
        if (i >= css.length) throw new Error('CSS 有沒關上的字串 —— 解析器不硬吃');
      } else if (ch === '{') {
        stack.push({ prelude: css.slice(preludeStart, i).trim(), bodyStart: i + 1 });
        preludeStart = i + 1;
        if (stack.filter((f) => !f.prelude.startsWith('@')).length > 1)
          throw new Error('CSS nesting(巢狀 style rule)—— 解析器不解析,人來看(plan §8)');
      } else if (ch === '}') {
        const frame = stack.pop();
        preludeStart = i + 1;
        if (!frame) throw new Error('CSS 括號不平衡:多出來的 }');
        if (frame.prelude.startsWith('@')) continue; // at-rule 本身不是規則,它裡面的才是
        out.push({
          // 🔴 R2 F6:逗號切割要認括號 —— `:where(a,button,…)` 不然會被切成三個碎片
          selectors: splitSelectors(frame.prelude),
          body: css.slice(frame.bodyStart, i),
          // 🔴 源序 = body 起點位置,不靠「} 收合順序」隱含帶(R4 nit F10)
          order: frame.bodyStart,
          ats: stack.filter((f) => f.prelude.startsWith('@')).map((f) => f.prelude),
          // 🔴 **祖先鏈裡有沒有 at-rule** —— 少了這一欄,「宣告在頂層」那格分不出
          //    `:root{…}` 與 `@supports{ :root{…} }`,而那正是我 v1 犯的錯。
          inAtRule: stack.some((f) => f.prelude.startsWith('@')),
        });
      } else if (ch === ';' && stack.length === 0) {
        preludeStart = i + 1;
      }
    }
    if (stack.length !== 0)
      throw new Error(`CSS 括號不平衡:走訪結束 stack 殘 ${stack.length}(需 0)`);
    return out.sort((a, b) => a.order - b.order);
  };

  /**
   * 一段規則 body 切成宣告清單。先剝巢狀區塊(防衛;nesting 在 parseRules 已 throw),
   * 再以**括號深度 0 的 `;`** 切割 —— `url(a;b)` 與字串裡的 `;` 不會被切錯。
   * 🔴 important 判定 `/!\s*important\s*$/i` —— `!IMPORTANT` 與 `! important` 都是合法 CSS(R4 F5:
   *    舊版 `/!important$/` 認不得變體 ⇒ 真正會贏的那筆被丟出 pool)。
   * 🔴 有內容卻不是「prop: value」形狀的片段 ⇒ throw,不靜默跳過 —— 跳過會把新語法變隱形。
   */
  const parseDecls = (body: string, ruleOrder: number): Decl[] => {
    let flat = '';
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === '"' || ch === "'") {
        const s0 = i;
        i++;
        while (i < body.length && body[i] !== ch) i += body[i] === '\\' ? 2 : 1;
        if (depth === 0) flat += body.slice(s0, i + 1);
      } else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (depth === 0) flat += ch;
    }
    const segs: string[] = [];
    let cur = '';
    let paren = 0;
    for (let i = 0; i < flat.length; i++) {
      const ch = flat[i]!;
      if (ch === '"' || ch === "'") {
        const s0 = i;
        i++;
        while (i < flat.length && flat[i] !== ch) i += flat[i] === '\\' ? 2 : 1;
        cur += flat.slice(s0, i + 1);
      } else if (ch === ';' && paren === 0) {
        segs.push(cur);
        cur = '';
      } else {
        if (ch === '(') paren++;
        else if (ch === ')') paren--;
        cur += ch;
      }
    }
    segs.push(cur);
    return segs.flatMap((seg, k) => {
      if (seg.trim() === '') return [];
      // Tailwind 宣告級指令(`@apply …` 等):樣式在【編譯期】展開, 這裡看不到內容 ——
      // 存成 @ 開頭的假 prop, 由 cascadeWinner 對命中的規則 throw、模型外守門把它當「有宣告」計入
      const at = /^\s*(@[a-z-]+)\b([\s\S]*)$/.exec(seg);
      if (at)
        return [{ prop: at[1]!.toLowerCase(), value: at[2]!.trim(), important: false, order: ruleOrder + k }];
      const m = /^\s*(--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z-]*)\s*:\s*([\s\S]+?)\s*$/.exec(seg);
      if (!m) throw new Error(`認不得的宣告片段:\`${seg.trim().slice(0, 40)}\` —— 解析器不猜`);
      const rawVal = m[2]!;
      return [
        {
          prop: m[1]!.startsWith('--') ? m[1]! : m[1]!.toLowerCase(),
          value: rawVal.replace(/!\s*important\s*$/i, '').trim(),
          important: /!\s*important\s*$/i.test(rawVal),
          // 同規則內以片段序遞增;跨規則由 ruleOrder(字元位置)分開,k ≪ body 長度 ⇒ 不會撞區間
          order: ruleOrder + k,
        },
      ];
    });
  };

  const RULES: Rule[] = parseRules(CSS_CODE);

  /** at-rule 條件政策:頂層與【不含 not 的】`@supports` ⇒ 套用(現代瀏覽器兩者都套);
   *  `@media` / `@container` / `@layer` / 未知 ⇒ 呼叫端 throw(條件與層序不猜 —— plan §2 族②;
   *  `@layer` 的真語意是「無層恆勝層內」且 !important 反轉,半套實作比 throw 危險)。
   *  🔴 R1 must-fix 2:`@supports not (…)` 是現代瀏覽器【不會】套用的那一條 —— 舊版把它
   *     當成立套用 = 方向相反且靜默。否定式(前導 not / `(not (…)` 複合)一律落回 throw。
   *  🔴 R2 F3:`/\bnot\b/` 太寬 —— `@supports selector(:not(.foo))` 是【正向】query, 誤擋。
   *     收窄成「前導 not」或「( 後接 not」;`(:not(` 的 not 前是 `:` 不是 `(`, 不命中。 */
  const conditionalAts = (r: Rule): string[] =>
    r.ats.filter((a) => !(/^@supports\b/i.test(a) && !/^@supports\s+not\b|\(\s*not\b/i.test(a)));

  /**
   * 選擇器成員 vs 目標,四分類(R1 must-fix 1 之後的版本 —— 舊版只認「字面包含」,
   * `[class*="cap-"]` / `span` / `*` 這類【以形狀匹配、不寫出 class 名】的選擇器全部靜默漏掉):
   *   'hit'        全等 ⇒ 參與級聯
   *   'complex'    含目標字面但更複雜(後代/複合/:is/:where/偽元素)、或 subject 帶 `[class…]`
   *                (以 class【形狀】匹配)⇒ 宣告了查詢屬性就 throw
   *   'miss'       【證明得了不匹配】:subject 錨在別的 class 字面 / id / 偽元素(另一個盒)上
   *                —— 模型=「元素身分只由目標 class 給定」,錨在別的具名鉤子上就構不成命中
   *   'outofmodel' 標籤 / `*` / 非 class 屬性 / :where 形狀 —— 匹配與否取決於 DOM(膠囊用什麼
   *                標籤),那是真瀏覽器的射程(plan §6)⇒ 不參與級聯,但【不准靜默】:
   *                下方「模型外集合」那格把它們具名釘住,新增同形狀就紅
   */
  const subjectOf = (sel: string): string => {
    let depth = 0;
    let start = 0;
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i]!;
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) start = i + 1;
    }
    return sel.slice(start).trim();
  };
  const classifySel = (sel: string, target: string): 'hit' | 'miss' | 'complex' | 'outofmodel' => {
    if (sel === target) return 'hit';
    const esc = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`${esc}(?![A-Za-z0-9_-])`).test(sel)) return 'complex';
    const subject = subjectOf(sel);
    if (/\[\s*class/i.test(subject)) return 'complex'; // 以 class 形狀匹配 ⇒ 與含字面同級, 吵
    if (/::(before|after|marker|placeholder|selection|first-l)/.test(subject)) return 'miss'; // 偽元素=另一個盒
    // 🔴 R2 之後自查出的第 6 種形狀:`:not(.foo)` 的 class 是【反錨】不是錨 ——
    //    模型元素沒有 .foo ⇒ :not(.foo) 反而【命中】它。⇒ 判「錨在別的 class」之前,
    //    先把 :not/:is/:where/:has 的參數剝掉;class 只活在函式型偽類裡 ⇒ 不算錨, 落 outofmodel(被釘住)
    const anchor = subject.replace(/:(not|is|where|has)\([^)]*\)/gi, ':$1()');
    if (/\.[A-Za-z_\\-]/.test(anchor)) return 'miss'; // 錨在別的 class 字面(函式型偽類外)
    if (/#[A-Za-z_-]/.test(anchor)) return 'miss'; // 錨在 id
    return 'outofmodel';
  };

  /**
   * 級聯核心:蒐集所有【確定命中】目標選擇器、且宣告了查詢屬性(群)的宣告,
   * 依 (!important, 源序) 取贏家 —— 匹配層只放行「全等」⇒ 特異性必同,排序鍵不必含它。
   * 算不動的一律 throw:complex 選擇器宣告了查詢屬性 / 宣告住在條件式 at-rule 裡。
   */
  const cascadeWinner = (rules: Rule[], targetSel: string, props: string[], label: string): Decl => {
    if (!props[0]!.startsWith('--'))
      for (const p of props)
        if (!QUERYABLE.has(p))
          throw new Error(
            `查詢屬性 \`${p}\` 不在 QUERYABLE 封閉集合裡 —— 新增查詢要同步擴 QUERYABLE 與「模型外集合」守門的 QUERIED, 否則該屬性在標籤規則上既不參與級聯也不被釘住`,
          );
    const cands: Decl[] = [];
    for (const r of rules) {
      const vs = r.selectors.map((s) => classifySel(s, targetSel));
      if (!vs.includes('hit') && !vs.includes('complex')) continue; // miss / outofmodel(後者有具名守門釘住)
      const decls = parseDecls(r.body, r.order);
      const hitProps = decls.filter((d) => props.includes(d.prop));
      // 🔴 R1 nit 1:`all` 會重置一般屬性(不含自訂屬性)—— 命中的規則帶 `all` 就是算不動, 吵
      const hasAll = !props[0]!.startsWith('--') && decls.some((d) => d.prop === 'all');
      // `@apply` 等編譯期指令:展開後可能是任何屬性 —— 命中的規則帶它就是算不動, 吵
      const hasAtDirective = decls.some((d) => d.prop.startsWith('@'));
      // R2 F1:繪製軸劫持屬性(自訂屬性查詢不受影響)
      const hijack = props[0]!.startsWith('--') ? undefined : paintHijackIn(decls);
      if (hitProps.length === 0 && !hasAll && !hasAtDirective && !hijack) continue;
      if (!vs.includes('hit'))
        throw new Error(
          `${label} 被複雜選擇器 \`${r.selectors.join(',')}\` 宣告 —— ` +
            `本解析器只算「單一 class 全等」的匹配;:is/:where/後代/複合的特異度、與 \`[class…]\` 這種以 class 形狀匹配的選擇器, 它不猜(plan §2 族① + R1 must-fix 1)。` +
            `正確處置=【擴充解析器讓它算得動這個形狀】;刪掉這格測試或改寫那條選擇器去閃它=動驗證本身=立即停止訊號,回報協調窗`,
        );
      if (hasAll)
        throw new Error(
          `${label}:命中的規則 \`${r.selectors.join(',')}\` 宣告了 \`all\` —— 它會重置一般屬性而本解析器算不動它(R1 nit 1)。` +
            `正確處置=【擴充解析器】;刪掉這格測試或把 all 搬走去閃它=動驗證本身=立即停止訊號,回報協調窗`,
        );
      if (hasAtDirective)
        throw new Error(
          `${label}:命中的規則 \`${r.selectors.join(',')}\` 帶 @ 開頭的宣告級指令(@apply / 巢狀 @media 等)—— 內容在編譯期展開或另有條件, 本解析器看不到(R2 F6 更正:訊息不再只寫 @apply)。` +
            `正確處置=【擴充解析器或把該規則改寫成明文屬性】;刪掉這格測試去閃它=動驗證本身=立即停止訊號,回報協調窗`,
        );
      if (hijack)
        throw new Error(
          `${label}:命中的規則 \`${r.selectors.join(',')}\` 宣告了繪製軸劫持屬性 \`${hijack.prop}\`(R2 F1)—— ` +
            `它會蓋掉 background/color 的渲染結果而不經過這條級聯, 本解析器算不動它。` +
            `正確處置=【擴充解析器】;刪掉這格測試或把宣告搬走去閃它=動驗證本身=立即停止訊號,回報協調窗`,
        );
      const conds = conditionalAts(r);
      if (conds.length > 0)
        throw new Error(
          `${label} 有宣告住在 \`${conds[0]}\` 裡 —— ` +
            `@media/@container/@layer 的條件與層序、以及 @supports not 的否定條件, 本解析器不猜(plan §2 族② + R1 must-fix 2)。` +
            `正確處置=【擴充解析器讓它算得動這種條件】;刪掉這格測試或把宣告搬走去閃它=動驗證本身=立即停止訊號,回報協調窗`,
        );
      cands.push(...hitProps);
    }
    if (cands.length === 0) throw new Error(`globals.css 找不到 ${label}`);
    const imp = cands.filter((d) => d.important);
    const pool = imp.length > 0 ? imp : cands;
    return pool.reduce((a, b) => (b.order >= a.order ? b : a));
  };

  /**
   * 一顆自訂屬性【級聯之後】的值。取 `:root` 內最後一筆(同 `:root` ⇒ 特異性相同 ⇒ 源序決定)。
   * 🔴 限定 `:root`:`.dark { --card: … }` 的深色值不在淺色級聯裡 —— 這是舊版被自己的
   *    嚴格性抓到的坑,保留(classifySel 對 `.dark` 回 'miss';R2 F5:舊名 selVs 已改)。
   */
  const declaredValueIn = (rules: Rule[], name: string): string =>
    cascadeWinner(rules, ':root', [`--${name}`], `:root 的 --${name}`).value;
  const declaredValueOf = (name: string): string => declaredValueIn(RULES, name);

  /** 查詢屬性 ⇒ 參與同一個級聯的屬性群(R4 F6:`background-color` 蓋 `background` 的顏色分量;
   *  反向「簡寫重置長寫」同一張表就涵蓋 —— 贏家是誰就取誰的值)。 */
  const PROP_GROUP: Record<string, string[]> = {
    background: ['background', 'background-color'],
  };

  /**
   * 🔴 可查詢屬性的【封閉集合】—— cascadeWinner 只接受這裡列的(自訂屬性 --* 另計)。
   * 為什麼要封閉:「模型外集合」守門的分母掛在這張表上 —— 若未來有人新增一種查詢
   * (例 font-size)而這裡沒擴,標籤規則裡的那個屬性會【既不參與級聯、也不被釘住】=
   * 分母定義權又漂走(feedback_a-decoupled-guard-recouples-in-a-new-shape 那族)。
   * ⇒ 新查詢屬性在這裡不存在 ⇒ 當場 throw,強迫同步擴這張表+模型外守門的 QUERIED。
   */
  const QUERYABLE = new Set(['background', 'background-color', 'color']);

  /**
   * 🔴 R2 F1(must-fix):會【劫走繪製結果】而不經過 background/color 級聯的屬性 ——
   * `background-image:linear-gradient(黑,黑)` 蓋掉底色、`-webkit-text-fill-color` 直接取代渲染字色、
   * `opacity`/`filter` 整體改寫 —— 全部在查詢屬性群之外 ⇒ 舊版零 throw 零釘住, 真瀏覽器黑底黑字守門全綠。
   * 修法照 78 指定【throw 不釘住】(釘住需要名單, 而 F2 剛證明名單有免檢通道)。
   * `background-image:none` 豁免:它是「拿掉圖層」的無害值(SUB2-008 外-2 該綠對照建立在它上)。
   */
  const PAINT_HIJACKERS = new Set(['background-image', '-webkit-text-fill-color', 'opacity', 'filter']);
  const paintHijackIn = (decls: Decl[]): Decl | undefined =>
    decls.find(
      (d) => PAINT_HIJACKERS.has(d.prop) && !(d.prop === 'background-image' && d.value === 'none'),
    );

  /** 某個 class 的某個屬性,**級聯之後贏的那一個值**(單一 class 元素的視角)。 */
  const winningValueIn = (rules: Rule[], cls: string, prop: string): string =>
    cascadeWinner(rules, `.${cls}`, PROP_GROUP[prop] ?? [prop], `.${cls} 的 ${prop}`).value;
  const winningValue = (cls: string, prop: string): string => winningValueIn(RULES, cls, prop);

  it('🔴 混色實作要有正向對照 —— 100% 回原色、0% 回底色', () => {
    // 沒有這一格,下面那格算錯了也會是綠的(混色壞掉通常不會壞成「明顯錯的顏色」)。
    // ⚠️ **R3 F11 點名這一格的射程**:100%/0% 兩端其實驗的是 `fromOklab ∘ toOklab = 恆等`,
    //    **任何自洽但寫錯的矩陣對都會過**。真正的外部背書是真瀏覽器那四個數(見下方那格),
    //    以及審查用**獨立實作**重算得到一致 —— 而那個證據在 repo 外面。**這一格不假裝涵蓋它。**
    const a = hexToRgb('#0066b1');
    const b = hexToRgb('#ffffff');
    expect(mixOklab(a, 100, b)).toEqual(a);
    expect(mixOklab(a, 0, b)).toEqual(b);
  });

  /**
   * 把一段 CSS 顏色運算式求值。**只認本檔真的用到的形狀,其餘一律 throw。**
   * 🔴 不靜默回預設色 —— 那會讓「看不懂」與「算過了」長得一樣。
   */
  const evalColorExpr = (expr: string, seen: string[] = []): RGB => {
    const raw = expr.trim();
    if (raw === 'black') return BLACK;
    if (raw === 'white') return hexToRgb('#ffffff');
    // 🔴 R3 F13:上一版閘門收 3~8 碼,而 `hexToRgb` 只認六碼 ⇒ 合法的 `#fff` 會被誤讀。
    //    ⇒ 三碼在這裡展開成六碼,其餘長度 throw。
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
    if (short) return hexToRgb(`#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`);
    if (/^#[0-9a-f]{6}$/i.test(raw)) return hexToRgb(raw);
    const v = /^var\(\s*--([A-Za-z0-9_-]+)\s*\)$/.exec(raw);
    if (v) {
      const name = v[1]!;
      if (seen.includes(name)) throw new Error(`--${name} 的定義繞回自己`);
      return evalColorExpr(declaredValueOf(name), [...seen, name]);
    }
    const mix = /^color-mix\(in oklab,\s*(.+)\)$/.exec(raw);
    if (!mix) throw new Error(`求值器不認得這個形狀:\`${raw}\``);
    const parts = mix[1]!.split(/\s*,\s*/);
    if (parts.length !== 2) throw new Error(`color-mix 參數不是兩個:\`${raw}\``);
    const term = (t: string): [string, number | null] => {
      const pct = /\s(\d+(?:\.\d+)?)%$/.exec(t);
      return [pct ? t.slice(0, pct.index).trim() : t.trim(), pct ? Number(pct[1]) : null];
    };
    const [lBody, lPct] = term(parts[0]!);
    const [rBody, rPct] = term(parts[1]!);
    // 🔴 R3 F10:兩端都帶百分比時 CSS 規範要**正規化**(40%/80% ⇒ 33/67),
    //    而上一版直接吃第一個數 ⇒ **靜靜回一個算錯的顏色**。本檔沒有這種寫法 ⇒ 直接 throw。
    if (lPct !== null && rPct !== null)
      throw new Error(`兩端都帶百分比需要正規化,求值器不猜:\`${raw}\``);
    if (lPct === null && rPct === null) throw new Error(`兩端都沒有百分比,求值器不猜:\`${raw}\``);
    const lc = evalColorExpr(lBody, seen);
    const rc = evalColorExpr(rBody, seen);
    return lPct !== null ? mixOklab(lc, lPct, rc) : mixOklab(rc, rPct!, lc);
  };

  it('🔴🔴 求值器自己要能分辨 —— 這一格的每一條都對應一發【真的發生過】的漏網', () => {
    // 正對照:純 hex 原值回來。
    expect(evalColorExpr('#0066b1')).toEqual(hexToRgb('#0066b1'));
    // R3 F13:三碼 hex 是合法 CSS,不可以誤擋也不可以誤讀。
    expect(evalColorExpr('#fff')).toEqual(hexToRgb('#ffffff'));
    // R3 F10:兩端都帶百分比 ⇒ 必須 throw,不可以靜靜回一個算錯的顏色。
    expect(() => evalColorExpr('color-mix(in oklab, #ffffff 40%, #000000 80%)')).toThrow();
    // 認不得的形狀 ⇒ throw(不是回一個看起來合理的顏色)。
    expect(() => evalColorExpr('rgb(0 102 177)')).toThrow();
    expect(() => evalColorExpr('var(--radius)')).toThrow();
    // 🔴 級聯:同一顆 token 若在後面被覆寫,必須讀到【後面那一筆】。
    //    這一格用 `--card` 自身當載體 —— 它在本檔只宣告一次,所以下面那格是它的負對照。
    expect(evalColorExpr('var(--card)')).toEqual(parseColor(tokenOf('card')));
  });

  it('🔴🔴 級聯判準本身被【直接】測到 —— 合成 CSS 餵真的核心,不靠突變 globals.css', () => {
    // R4 F9:上一版這格「上半打手打字串、下半釘原始碼字面」—— 兩半都沒呼叫 declaredValueOf,
    //        F1/F2 那族發生時兩半都綠。⇒ 換成【真的呼叫】參數化核心。
    // R4 F8:靜止態 6 顆膠囊 × 2 屬性全部 cands=1 ⇒ pool 選擇與 last-wins 分支零覆蓋。
    //        ⇒ 下面每一格都走到那些分支;每一格對應一發【真的構造過】的突變(MAIN-143 §1)。
    const P = parseRules;
    // last-wins(R3 舊突變「檔尾追加 :root」的機制本體):同 token 兩筆,取後者
    expect(declaredValueIn(P(':root{--dup:#000000}:root{--dup:#ffffff}'), 'dup')).toBe('#ffffff');
    // !important 逆轉源序(pool 分支)
    expect(
      winningValueIn(P('.a{background:#000000!important}.a{background:#ffffff}'), 'a', 'background'),
    ).toBe('#000000');
    // !important 寫法變體(R4 F5):大小寫與空白都是合法 CSS,舊版 /!important$/ 兩個都丟 pool
    expect(
      winningValueIn(P('.a{background:#000000 !IMPORTANT}.a{background:#ffffff}'), 'a', 'background'),
    ).toBe('#000000');
    expect(
      winningValueIn(P('.a{background:#000000 ! important}.a{background:#ffffff}'), 'a', 'background'),
    ).toBe('#000000');
    // longhand 蓋 shorthand(R4 F6)與反向:簡寫重置長寫(78 外-2)—— 兩個方向是不同機制
    expect(
      winningValueIn(P('.a{background:#000000}.a{background-color:#ffffff}'), 'a', 'background'),
    ).toBe('#ffffff');
    expect(
      winningValueIn(P('.a{background-color:#000000}.a{background:#ffffff}'), 'a', 'background'),
    ).toBe('#ffffff');
    // 逗號清單成員(78 外-3;R3 F4 修過的那族,重寫後不得回退)
    expect(winningValueIn(P('.b,.a{background:#000000}'), 'a', 'background')).toBe('#000000');
    // 字串裡的 }(R4 C1):規則表不錯位,後面的規則照常查得到
    expect(
      winningValueIn(P('.x::after{content:"}"}.a{background:#000000}'), 'a', 'background'),
    ).toBe('#000000');
  });

  it('🔴🔴 算不動的形狀要【吵】,不要隱形 —— 每一發 throw 對應一族舊出口', () => {
    const P = parseRules;
    // 族①具體度/偽類(R4 F3、78 外-1):含目標 class 的複雜選擇器,宣告了查詢屬性就 throw
    expect(() => winningValueIn(P('.g .a{background:#000000}'), 'a', 'background')).toThrow(/不猜/);
    expect(() =>
      winningValueIn(P(':where(.a){background:#000000}'), 'a', 'background'),
    ).toThrow(/不猜/);
    // 該綠對照:複雜選擇器【不含】目標 ⇒ 不吵(誤擋那半也要驗 —— 它壞的頻率更高)
    expect(
      winningValueIn(P('.g .z{background:#111111}.a{background:#000000}'), 'a', 'background'),
    ).toBe('#000000');
    // 族② at-rule 條件(R4 F1/F2/F4):@media/@container/@layer 命中即 throw;@supports 套用
    expect(() =>
      winningValueIn(
        P('.a{background:#000000}@media print{.a{background:#ffffff}}'),
        'a',
        'background',
      ),
    ).toThrow(/不猜/);
    expect(() =>
      winningValueIn(
        P('.a{background:#000000}@container (max-width:520px){.a{background:#ffffff}}'),
        'a',
        'background',
      ),
    ).toThrow(/不猜/);
    expect(() =>
      declaredValueIn(P(':root{--t:#000000}@layer base{:root{--t:#ffffff}}'), 't'),
    ).toThrow(/不猜/);
    expect(
      winningValueIn(P('@supports (color:red){.a{background:#000000}}'), 'a', 'background'),
    ).toBe('#000000');
    // 括號不平衡 ⇒ 解析當場吵(R4 點名舊版零自檢)
    expect(() => P('.a{background:#000000')).toThrow(/括號不平衡/);
    // CSS nesting ⇒ 不解析,吵
    expect(() => P('.a{.b{background:#000000}}')).toThrow(/nesting/i);
    // ── R1 must-fix 1/2 + nit 1 的三形狀(SUB2-015;修法後必吵)──
    // [class…] 以 class【形狀】匹配、不寫出 class 名 —— 舊版靜默回舊值
    expect(() =>
      winningValueIn(
        P('.a{background:#000000}[class*="a"]{background:#ffffff!important}'),
        'a',
        'background',
      ),
    ).toThrow(/不猜/);
    // @supports not = 現代瀏覽器【不會】套用的那條 —— 舊版當成立套用, 方向相反且靜默
    expect(() =>
      winningValueIn(
        P('.a{background:#000000}@supports not (color:red){.a{background:#ffffff}}'),
        'a',
        'background',
      ),
    ).toThrow(/不猜/);
    // all 重置一般屬性 —— 舊版 decls 過濾後 continue, 整族隱形
    expect(() => winningValueIn(P('.a{all:unset}'), 'a', 'background')).toThrow(/all/);
    // 該綠對照:@supports【不帶 not】照舊套用(修 must-fix 2 不准把正向那半打壞)
    expect(
      winningValueIn(P('@supports (color:red){.a{background:#000000}}'), 'a', 'background'),
    ).toBe('#000000');
    // 標籤選擇器 = 模型外:合成層【刻意】不吵(匹配與否取決於 DOM)——
    // 真檔上的防線是下面「模型外集合」那格:新增同形狀 ⇒ 集合變動 ⇒ 紅
    expect(
      winningValueIn(
        P('.a{background:#000000}span{background:#ffffff!important}'),
        'a',
        'background',
      ),
    ).toBe('#000000');
    // 🔴 查詢屬性是封閉集合:沒列進 QUERYABLE 的查詢當場吵 ——
    //    否則新查詢的屬性在標籤規則上【既不參與級聯、也不被模型外守門釘住】(分母漂走那族)
    expect(() => winningValueIn(P('.a{font-size:14px}'), 'a', 'font-size')).toThrow(/QUERYABLE/);
    // ── R2 F1(must-fix):繪製軸劫持屬性 —— 蓋掉渲染結果而不經過 background/color 級聯
    expect(() =>
      winningValueIn(
        P('.a{background:#ffffff}.a{background-image:linear-gradient(#000,#000)}'),
        'a',
        'background',
      ),
    ).toThrow(/劫持/);
    expect(() =>
      winningValueIn(
        P('.a{color:#000000}.a{-webkit-text-fill-color:#0a0a0a!important}'),
        'a',
        'color',
      ),
    ).toThrow(/劫持/);
    // 該綠對照:background-image:none 是拿掉圖層的無害值(SUB2-008 外-2 該綠對照建立在它上)
    expect(
      winningValueIn(P('.a{background:#000000}.a{background-image:none}'), 'a', 'background'),
    ).toBe('#000000');
    // ── R2 F3:@supports selector(:not(.foo)) 是【正向】feature query ⇒ 照套, 不誤擋
    expect(
      winningValueIn(
        P('@supports selector(:not(.foo)){.a{background:#000000}}'),
        'a',
        'background',
      ),
    ).toBe('#000000');
    // 否定式(前導 not / 複合 (not …))仍 throw —— 修 F3 不准把 must-fix 2 打壞
    expect(() =>
      winningValueIn(
        P('.a{background:#000000}@supports (a) and (not (b)){.a{background:#ffffff}}'),
        'a',
        'background',
      ),
    ).toThrow(/不猜/);
    // ── 第 6 種形狀(自查):`:not(.foo)` 的 class 是反錨 —— 模型元素沒有 .foo ⇒ 它【命中】。
    //    不准判 miss;落 outofmodel(合成層刻意不吵, 真檔防線=條數釘住那格)
    expect(classifySel(':not(.foo)', '.a')).toBe('outofmodel');
    expect(classifySel('.text-xs:not([class*="leading-"])', '.a')).toBe('complex'); // [class 檢查優先, 行為不變(R2 F4 口徑照舊)
  });

  it('🔴🔴 模型外的規則是【具名集合】,不是靜默出口 —— 新增同形狀就紅(R1 must-fix 1 第二半)', () => {
    // 標籤/`*`/非 class 屬性/:where 形狀的選擇器, 匹配與否取決於 DOM(膠囊掛在什麼標籤上)——
    // 那是真瀏覽器的射程(plan §6), 本解析器【算不動】。但算不動不准是靜默:
    // 這一格把【現行檔裡所有這類、且宣告了查詢屬性】的選擇器釘成清單。
    // 有人新增一條(例:`span{background:…!important}`)⇒ 集合變動 ⇒ 這裡紅 ⇒ 人來歸類。
    // 🔴 這不是自動放行的豁免名單 —— 清單上每一條都是「看 DOM 的斷言」:它們今天不打膠囊,
    //    是因為膠囊不掛在 td/th/a/tr 上;哪天膠囊進了這些容器形狀, 真相只有真瀏覽器知道。
    // 🔴 同源:分母 = QUERYABLE(封閉集合)+ all + 繪製軸劫持屬性 + @ 指令 —— 不另打一份清單
    const counted = (r: Rule): boolean => {
      const ds = parseDecls(r.body, r.order);
      return (
        ds.some((d) => QUERYABLE.has(d.prop) || d.prop === 'all' || d.prop.startsWith('@')) ||
        paintHijackIn(ds) !== undefined
      );
    };
    // 🔴 R2 F2:釘【選擇器 → 條數】不是釘【集合】—— 集合版對「重複既有字面的新規則」全靜默
    //    (M-B:再加一條 body{…} ⇒ 集合不變 ⇒ 綠)。條數版:同字面第 2 條 ⇒ 數字變 ⇒ 紅。
    const outOfModel = new Map<string, number>();
    for (const r of RULES) {
      if (!counted(r)) continue;
      for (const s of r.selectors) {
        // canary class:不存在於檔內 ⇒ 'hit'/'complex' 不會誤觸, 量的就是形狀分類本身
        if (classifySel(s, '.cap-canary') === 'outofmodel')
          outOfModel.set(s, (outOfModel.get(s) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries([...outOfModel.entries()].sort())).toEqual({
      '#nav-rail nav a[aria-current="page"]': 1,
      '*': 1, // @layer base 的 @apply border-border … —— 編譯期展開, 內容只有產物層看得到
      '.orders-grid .col-ops a': 1,
      '.orders-grid .col-ops a:hover': 1,
      '.orders-grid tbody.orders-group[data-selected] td': 2,
      '.orders-grid thead th': 2,
      ':where(tbody tr:hover)': 2,
      "[data-od-id='panel-header']": 1,
      // 🔴 §12 組 19/20(2026-08-25 新增,**由我歸類,不是靜默通過**):收款分頁收合塊的標題列染色。
      //    形狀落 outofmodel 的原因:選擇器最後打在 `summary` **標籤**上,而本解析器算不動標籤。
      //    **今天不打膠囊的理由**:那兩條 `<summary>` 裡只有一顆 `▶` 的 span 與一顆 `h2`,沒有 `.cap-*`。
      //    🔴 **而它們宣告了 `color`** ⇒ 哪天有人把東西放進這兩條標題列裡,那個東西**若自己沒有字色**
      //       就會繼承到這裡的 `--ink-warn` / `--pill-danger`。
      //       ⚠️ **精確一點(codex 關卡2 nit)**:`.cap-*` / `.pcm-pill` 這幾顆**自己有明確字色**
      //       ⇒ 它們**蓋得過**父層的繼承值,不會被改掉;會被改到的是**沒宣告字色的後代**。
      //       ⇒ 真相只有真瀏覽器知道,與本清單其他條目同一個射程。
      "[data-od-panel='money'] summary:has(h2.text-destructive)": 1,
      "[data-od-panel='money'] summary:has(h2:not(.text-destructive))": 1,
      body: 1, // 同上:@apply bg-background text-foreground
    });
    // 對照組:集合不是空的 —— 「零新增」不是因為尺沒在量
    expect(outOfModel.size).toBeGreaterThan(0);
  });

  it('🔴🔴 五顆膠囊【級聯之後真正生效的】底與字都達標', () => {
    // 🔴🔴 **值全部從 `globals.css` 讀出來求值,測試裡不出現任何比例數字。**
    //    R3 F2 打的就是上一版:`.cap-n` 那一列還手打著 `mixOklab(card, 88, …)`,
    //    而我當時**還親手把它從 84 同步成 88** —— 需要人去同步的東西,就是沒有耦合起來的東西。
    // ✅ **外部交叉來源**(真瀏覽器 `getComputedStyle` + canvas 解析,`localhost:3871`,2026-08-23,
    //    自帶正對照「黑字白底 = 21」):cap-n 8.98 / cap-y 6.93 / cap-bl 4.98 / cap-g 4.90。
    //    ⚠️ `.cap-refund` 那一顆**沒有瀏覽器數** —— 它今天不在任何畫面上(見下方 F5 那格)。
    const caps = ['cap-n', 'cap-y', 'cap-bl', 'cap-g', 'cap-refund'];
    const fails = caps.flatMap((cls) => {
      const bg = evalColorExpr(winningValue(cls, 'background'));
      const fg = evalColorExpr(winningValue(cls, 'color'));
      const got = contrast(fg, bg);
      return got >= 4.5 ? [] : [`.${cls} = ${got.toFixed(2)},需 4.5`];
    });
    expect(fails, '膠囊配色有不達標的(值是級聯後真正生效的那一組)').toEqual([]);
  });

  it('🔴 實心紅那顆(未收出貨)的白字達標', () => {
    // 它是寫死的 `#a51022` + `#fff`,一樣走級聯解析,不手抄。
    const bg = evalColorExpr(winningValue('cap-risk', 'background'));
    const fg = evalColorExpr(winningValue('cap-risk', 'color'));
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('🔴🔴 底色混色的【第一個參數必須是 `var(--card)`】—— 這是老瀏覽器降級值的來源', () => {
    // 🔴 lightningcss 會自動為 `color-mix` 產生降級版,**降級值 = 混色的第一個參數**。
    //    照 OD 的原順序寫,底色與字色的降級值會是同一個顏色 ⇒ **同色字疊同色底 = 膠囊看不見。**
    // ✅ **實跑產物驗過**(`grep -rho -- '--tint-warn:[^;}]*' apps/admin/.next/static`):
    //    `--tint-warn:var(--card)` ← 降級 · `--ink-warn:#774800` ← 降級(白底可讀)。
    //
    // 🔴🔴 **R3 F3:上一版只圈四顆 token,而 `.cap-n` 的【行內】`color-mix` 不在任何一格視野裡**
    //    ⇒ 把它改寫成 `color-mix(in oklab, var(--muted-foreground), var(--card) 88%)`(值等價)
    //      ⇒ 降級 = 深灰底配深灰字,對比 1.53,而守門全綠。
    //    ⇒ 現在**兩邊都圈**:token 宣告 + 每一顆膠囊級聯後真正生效的 `background`。
    for (const token of ['tint-accent', 'tint-danger', 'tint-warn', 'tint-success']) {
      expect(
        declaredValueOf(token).replace(/\s+/g, ' '),
        `--${token} 的混色第一個參數不是 var(--card)`,
      ).toMatch(/^color-mix\(in oklab, var\(--card\)/);
    }
    // 🔴 **這份名單【少一顆是刻意的】—— `.cap-risk` 不在裡面, 不要「順手補齊」。**
    //    `globals.css:2130`(字面錨 `.cap-risk {background:#a51022!important`)是**刻意寫死的靜態色**,
    //    而下面那道斷言要求「必須含 var(」⇒ **把它加進來會當場誤紅一個設計決定**。
    //    它沒有失守:同檔上方「🔴 實心紅那顆(未收出貨)的白字達標」那格
    //    (字面錨 `winningValue('cap-risk', 'background')`)用對比度 >= 4.5 守著它。
    //    🔴 補齊一份清單看起來永遠像在做好事 —— 所以擋它的只有這行字。(#895 / b0 複驗撈出)
    for (const cls of ['cap-n', 'cap-y', 'cap-bl', 'cap-g', 'cap-refund']) {
      const bg = winningValue(cls, 'background').replace(/\s+/g, ' ');
      // 🔴 #895:上一版這裡是 `if (!bg.startsWith('color-mix')) continue`(走 token 或純色的
      //    一律靜默跳過)—— 而「純色」正是本格要擋的那件事:有人把 `.cap-n` 的行內 color-mix
      //    求值成等值 hex(看起來像【簡化】)⇒ 這格 continue · `--tint-*` 那格只圈 token ·
      //    對比守門算出同一個數 ⇒ **三格同時不紅**。
      // ✅ 修法是否定那個【動作】,不是列舉合法寫法:背景必須仍然參照 `var(…)`。
      //    列舉會賭「合法寫法只有 tint-* 與 color-mix 兩種」,而新膠囊換一顆別的 token 就被誤擋。
      expect(
        bg,
        `.${cls} 的 background 不含 var(…) ⇒ 它被求值成靜態色了(值:\`${bg}\`)。` +
          '正確動作:讓它保持 token 或 color-mix 運算式,或【擴充本判別式】—— 不是刪掉這格',
      ).toContain('var(');
      if (!bg.startsWith('color-mix')) continue; // 直取 token 者由上方 --tint-* 迴圈把關
      expect(bg, `.${cls} 的行內混色第一個參數不是 var(--card)`).toMatch(
        /^color-mix\(in oklab, ?var\(--card\)/,
      );
    }
    // 🔴 `--ink-*` / `--pill-*` 刻意**不**要求 card 在前 —— 那是字色,
    //    降級成該色本身配白底才是可讀的那一邊。
  });

  it('🔴🔴 八顆 token 真的宣告了,而且【在頂層】—— 放進 @supports 是我犯過的錯', () => {
    // 🔴 它們一度只活在註解裡。`var()` 解析不到 = invalid at computed-value time
    //    ⇒ 背景透明、字色掉回繼承值,而 **CSS 語法完全合法、三綠一格都不紅**。
    // 🔴🔴 **R3 F9:上一版只驗「剝註解後有宣告」,沒驗【在哪】**
    //    ⇒ 我自己記下的 v1 錯法(把八顆放進 `@supports`)在那一格是**綠的**。
    //    放進 `@supports` 為什麼不行:`var()` 失效**不會退回下一條規則**,屬性直接 unset
    //    ⇒ 不支援 `color-mix` 的瀏覽器上膠囊照樣透明。**`@supports` 在這裡防不到任何東西。**
    const declared = new Set([...CSS_CODE.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...CSS_CODE.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((k) => !declared.has(k)).sort();
    // ⚠️ **具名豁免,不是放寬門檻**:這一顆由 `workspace-shell.tsx` 的 inline style 供給,
    //    CSS 裡本來就查不到 —— 而它同時是這把尺的**對照組**:清單不是空的,「零缺」不是恆真。
    expect(missing, 'globals.css 有 var() 指向沒有宣告的 token').toEqual([
      '--workspace-panel-width',
    ]);

    // 位置:八顆都必須在**頂層** `:root`(不在任何 at-rule 內)。
    const topLevelRoot = RULES.filter((r) => r.selectors.includes(':root') && !r.inAtRule)
      .map((r) => r.body)
      .join('\n');
    // 對照組:分母不是空的 —— 否則下面每一格都是恆綠。
    expect(topLevelRoot.length, '頂層 :root 一個都沒掃到 ⇒ 這把尺壞了').toBeGreaterThan(200);
    for (const t of [
      'tint-accent',
      'tint-danger',
      'tint-warn',
      'tint-success',
      'ink-warn',
      'ink-success',
      'pill-accent',
      'pill-danger',
    ]) {
      expect(topLevelRoot, `--${t} 不在頂層 :root(可能被放進 @supports 了)`).toContain(`--${t}:`);
    }
  });

  it('🔴 值必須留成【運算式】—— 有人把 color-mix 求值成 hex 就紅', () => {
    // 設計參照 §5:求值之後,未來改主色時膠囊不會跟著動,而**沒有任何守門會紅**。
    for (const token of ['tint-accent', 'tint-danger', 'tint-warn', 'tint-success', 'ink-warn', 'ink-success']) {
      expect(declaredValueOf(token), `--${token} 的值被求成靜態色了`).toContain('color-mix(in oklab');
    }
  });

  it('🔴🔴 第 5 顆膠囊 `.cap-refund` —— 圓角名單漏了它,而【今天沒有人在用它】', () => {
    // 🔴 **R3 F5 兩半都成立,而第二半打的是我上一輪的宣稱。**
    //    ① 圓角名單(`border-radius:9999px!important`)原本只列四顆 + `.cap-risk`,不含它
    //       ⇒ 接上去那天它會是**方角**混在五顆膠囊裡。已補進名單。
    //    ② 我上一輪寫「守門一變誠實就抓到第 5 顆」—— **那顆是一個 token,不是畫面上的膠囊。**
    //       `grep 'cap-refund'` 去掉測試 ⇒ **0 個消費端**;
    //       對照組 `cap-n/y/bl/g` 命中 `order-status-axes.ts` ⇒ 那把尺會分辨。
    //    ⇒ 這一格把「它還沒有人用」變成**寫下來且會過期就紅**的東西:接上去的那天,下面那句要改。
    const radiusRule = RULES.find(
      (r) => r.selectors.includes('.cap-refund') && /border-radius/.test(r.body),
    );
    expect(radiusRule, '.cap-refund 不在任何 border-radius 規則裡 ⇒ 它會是方角').toBeDefined();

    const axes = readFileSync(join(__dirname, '..', 'lib', 'orders', 'order-status-axes.ts'), 'utf8');
    expect(axes, '對照組:其他膠囊應該有消費端,否則這把尺量錯了').toContain('cap-g');
    expect(
      axes.includes('cap-refund'),
      '.cap-refund 有消費端了 ⇒ 請把上面註解②那句「今天沒有人在用它」改掉,並補真瀏覽器對比',
    ).toBe(false);
  });

  it('🔴🔴 `globals.css` 不得有【空的區塊】—— 這是那次「整段搬丟」的通用載體', () => {
    // 🔴🔴 **這一格的來歷**:2026-08-23 搬 OD 樣式時掉了兩整段,而兩次的症狀一模一樣 ——
    //    **一個空的 `{}`,CSS 語法完全合法,三綠一格都不紅。**
    //      ① `@supports(color-mix){}`      ⇒ 八顆 token 沒宣告 ⇒ 狀態膠囊整排沒有顏色(R2-C2)
    //      ② `@container (max-width:719px){}` ⇒ 面板窄了不收單欄 ⇒ 電話 placeholder 被截(R3-F6)
    //    ⚠️ **空區塊在 diff 上長得像「這條刻意不搬」** —— 而那正是它躲過兩輪審查的方式。
    // 📌 前兩次都是逐條補;**這一格補的是【那個形狀】** ⇒ 下一次搬丟會在 commit 前就紅。
    // 🔴 `m[1]` 在 `noUncheckedIndexedAccess` 底下是 `string | undefined` ——
    //    這是我今晚**第二次**在這支檔用 `matchAll` 踩到 TS2532(第一次在求值器)。
    //    ⚠️ 不用 `?? ''` 收尾:那會把「沒抓到」變成一個空字串混進清單裡。捕獲組必然存在 ⇒ 用 `!`。
    const empties = [...CSS_CODE.matchAll(/([^{}]+)\{\s*\}/g)].map((m) =>
      m[1]!.trim().replace(/\s+/g, ' ').slice(0, 60),
    );
    expect(empties, 'globals.css 有空的規則/at-rule 區塊 ⇒ 極可能是搬運時整段掉了').toEqual([]);

    // 對照組:分母不是零 —— 這把尺確實掃得到區塊,「零空塊」不是因為它什麼都沒掃到。
    const allBlocks = [...CSS_CODE.matchAll(/\{/g)].length;
    expect(allBlocks, '一個 { 都沒掃到 ⇒ 這把尺壞了').toBeGreaterThan(100);
  });

  it('🔴 FIX-33 那個容器斷點真的在收單欄 —— 不是「有寫東西」就算', () => {
    // 空區塊那格擋得住「整段掉了」,擋不住「有人塞一條無關的規則進去」。
    // ⇒ 這一格釘住**它到底在做什麼**:≤719 的容器裡,兩欄 grid 要變一欄。
    // ✅ 真瀏覽器兩個世界都表演過(2026-08-23,`localhost:3871`):
    //    整頁容器 1152 ⇒ `grid-template-columns` 兩欄(553px 553px)
    //    面板容器 ~687 ⇒ 一欄
    //    ⇒ **它會分辨**,不是恆為一欄。
    const block = /@container \(max-width:719px\)\s*\{([\s\S]*?)\n\}/.exec(CSS_CODE)?.[1];
    expect(block, '找不到 @container (max-width:719px) 區塊').toBeDefined();
    expect(String(block), 'FIX-33 沒有在收單欄').toMatch(/grid-template-columns:\s*1fr/);
    expect(String(block), 'FIX-33 沒有指向兩欄的 grid').toContain('grid-cols-2');
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
    // ~~`#edf1f6`~~ ~~2026-08-23 換成 OD 改版稿的 `#e8ecf2`~~(Sean 拍板「稿用什麼就用什麼」)。
    // 🔴 2026-08-24 訂正為 `#f1f5f9` —— 而這【不是推翻 Sean 的拍板, 是照他的拍板重新執行一次】。
    //    他拍的是「稿用什麼就用什麼」= 一條規則, 不是一個值。
    //    而那份稿會層疊:`#e8ecf2` 在 `orders-admin-v2.html:4857`(FIX-10),
    //    被 `:5317`(FIX-38)的 `#f1f5f9` 覆蓋 —— 同特異性、文件順序更後 ⇒ 後者贏。
    //    ⇒ 08-23 落值的人讀到的是【沒贏的那一個宣告】。
    //    生效值表 `docs/design/od-cascade-winning-values.md`(commit `2d9cda0f`)。
    // ⚠️ 本格釘的是「這顆 token 還在 `:root`」,不是那個 hex 好不好看 —— 改值要連這裡一起改,
    //    這正是它存在的理由(下面 ②③ 兩格分別釘 `@theme inline` 映射與消費端)。
    expect(ROOT).toMatch(/^\s*--border-soft:\s*#f1f5f9;/m);
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
    // 🔴🔴 **2026-08-25:這一格原本用 `.exec()` —— 而 `.exec()` 只回【第一個】命中。**
    //    `\.orders-grid\s*\{` 在本檔命中 **6 處**(頂層 4 + 巢狀 2)⇒ 舊寫法讀的是第一處,
    //    而瀏覽器吃的是【最後一條宣告 color 的】那處。**兩者今天剛好是同一處,所以它是綠的
    //    —— 靠的是「目前只有一處宣告 color」這個外部事實,不是它自己有判別力。**
    // 📏 **量到的,不是推的**(把本格舊正則原樣搬到合成字串上跑,不碰真檔):
    //    ```
    //    該綠 .orders-grid{color:var(--fg-2)}                         ⇒ 讀到 var(--fg-2) ⇒ 🟢
    //    該紅 .orders-grid{color:var(--fg-2)} … .orders-grid{color:red}
    //         (瀏覽器實際吃 red)                                       ⇒ 讀到 var(--fg-2) ⇒ 🟢
    //    ```
    //    **兩個世界印同一句綠 = 失明。**
    // ⚠️ **為什麼不照 `money-column-width.test.ts` 的 `ilineBlock()` 那樣「命中 >1 就 throw」**:
    //    那個形狀直接套上來會【當場紅】—— `.orders-grid {` 本來就有 6 處(容器查詢、卡片化、
    //    列印各一份),那是正常結構,不是有人加了誘餌。
    //    ⇒ 改成**把閘收在「宣告 color 的那幾處」上** —— 那才是本格真正在問的東西。
    //    兩個方向都會叫:0 處 ⇒ 結構變了;>1 處 ⇒ 有人加了第二條 color,先確認哪條生效。
    const gridRules = [...CSS_CODE2.matchAll(/\.orders-grid\s*\{[^}]*\}/gs)].map((m) => m[0]);
    const withColor = gridRules.filter((r) => /(^|[;{])\s*color\s*:/.test(r));
    expect(
      gridRules.length,
      '找不到任何 `.orders-grid {` 規則 —— 結構變了,本守門要重寫',
    ).toBeGreaterThan(0);
    expect(
      withColor.length,
      `\`.orders-grid\` 有 ${withColor.length} 處宣告 color(期望剛好 1 處)。` +
        '有人加了第二條 ⇒ 先確認哪一條才是層疊生效的那條,再改本守門 —— ' +
        '不要讓它繼續讀第一條(那正是本格 2026-08-25 修掉的病)。',
    ).toBe(1);
    expect(String(withColor[0])).toContain('color: var(--fg-2)');
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
  it('🔴 條紋是【單色 var(--primary)】—— 三色停已於 2026-08-23 拍板移除', () => {
    // 🏁 **Sean 2026-08-23 看過並排實物後拍板「乙:改單色」** ⇒ 三色漸層 → `var(--primary)`。
    //    OD 改版稿的理由:紅色在後台是「未付款/取消」的語意色,品牌也用紅會互相稀釋
    //    ⇒ 賽車感拿掉、品牌痕跡(藍)留著。
    //
    // 🔴🔴 **本格【整個翻面了】,而舊版的推理要留著,因為它仍然是「改回去要付什麼代價」的說明書。**
    //    舊版擋的是一個看起來像在做好事的改動:有人覺得「硬寫 hex 很髒」而改成 `var(--primary)`
    //    ⇒ 日後調強調色會把**品牌條**一起調掉,而畫面上只看起來「顏色變了」。
    //    ⚠️ **那條推理在 BMW M 語言下是對的。被推翻的是【語言】,不是推理** ——
    //       三色條不再是品牌圖案、降級成一條分隔線 ⇒ 它的前提消失了,所以現在可以是 var。
    //
    // ⇒ 本格現在守的是**新的那一邊**:條紋必須是單色,而且**不得退回三色停**。
    const rule = /\.m-stripe\s*\{[^}]*\}/s.exec(CSS)?.[0];
    expect(rule, 'globals.css 找不到 .m-stripe 規則').toBeDefined();
    expect(rule, '條紋應為單色 var(--primary)').toContain('var(--primary)');
    // 🔴 反向:三個舊色停一個都不准回來 —— 沒有這圈,「有人偷偷加回漸層」不會紅。
    for (const stop of ['#0066b1', '#1c69d4', '#e22718']) {
      expect(rule, `三色停 ${stop} 回來了 ⇒ 2026-08-23 拍板被推翻,要重裁不是靜靜改回去`).not.toContain(
        stop,
      );
    }
    expect(String(rule).includes('linear-gradient'), '條紋又變回漸層了').toBe(false);
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

describe('黏住的面板摘要頭:兩條規則要一起在(2026-08-23 真瀏覽器量到才補的)', () => {
  // 🔴 **這一格釘的是一個【我推錯過的】結構事實,不是一個好看的值。**
  //    sticky 的貼齊基準是捲動容器的 **padding box**。面板容器有 `p-4` ⇒ 只寫 `top:0` 時
  //    黏住的 header 上緣停在 `panelTop + 16`,**上面那 16px 沒人蓋** ⇒ 內容從縫裡透出來。
  //    實測(Chromium、`/private/tmp/pcm-a06-browser` 起的 `localhost:3871`、面板捲到底):
  //      `top:0`    ⇒ 縫上 3/3 探點打到內容(漏)、header `top=72` / 面板 `top=56`
  //      `top:-1rem` ⇒ 縫上 3/3 探點打到 header(不漏)、header `top=56` = 面板 `top`
  //      改回 `top:0` ⇒ 漏又回來 3/3(**該紅真的會紅**)
  //
  // ⚠️ **它擋得住「有人把那一行刪掉」,擋不住「那一行在別的版面下夠不夠」** ——
  //    後者要真瀏覽器,不在這裡(本檔開頭那句界線同樣適用)。
  // 🔴🔴 **2026-08-23 R3-F14:上一版的 `BASE` 沒有錨定 ⇒ 它同時命中面板專屬那條**
  //    (`.panel-width-locked [data-od-id='panel-header'] {…}` 的**後半段**長得跟底規則一樣)。
  //    ⇒ 「底規則不得帶 margin」那一格,可能是在檢查另一條規則。
  //    修:前面必須是行首或 `}`/註解結尾之後的空白 —— 即**前面不可以有選擇器**。
  const BASE = /(?:^|[};])\s*\[data-od-id='panel-header'\]\s*\{([^}]*)\}/m;
  const SCOPED = /\.panel-width-locked\s+\[data-od-id='panel-header'\]\s*\{([^}]*)\}/;

  it('底規則存在,而且【不帶任何補償】—— 整頁版沒有 p-4,吃到補償就會左右各凸 16px', () => {
    const m = BASE.exec(CSS);
    expect(m, "globals.css 找不到 [data-od-id='panel-header'] 底規則").not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/top:\s*0\s*;/);
    // 🔴🔴 **2026-08-23 審查 Important-6**:上一版只把 `top` 搬進面板作用域,
    //    `margin`/`padding` 留在這裡 ⇒ **整頁版照樣吃到**。
    //    真瀏覽器實測(整頁 1440 寬):抬頭 `170/1354`、容器 `186/1338` ⇒ 左右各凸 16px;
    //    對照組(同容器的兄弟節點)量到 `186/1338` 剛好貼齊 ⇒ 尺會分辨。修完再量 ⇒ `0/0`。
    expect(body, '底規則不得帶負外距補償 —— 那是面板專屬的').not.toMatch(/margin\s*:/);
    expect(body, '底規則不得帶內距補償 —— 那是面板專屬的').not.toMatch(/padding\s*:/);
  });

  it('🔴 面板專屬覆寫【三個宣告都要在】—— 少任何一個都會壞在不同的地方', () => {
    const m = SCOPED.exec(CSS);
    expect(m, '面板專屬覆寫 `.panel-width-locked [data-od-id=\'panel-header\']` 不見了').not.toBeNull();
    const body = m![1];
    // `top` 管黏住的【位置】;`margin`/`padding` 管黏住時【蓋到哪】。分開壞、分開紅。
    expect(body, '少了 top:-1rem ⇒ 面板捲動時上緣會透出內容').toMatch(/top:\s*-1rem\s*;/);
    expect(body, '少了負外距 ⇒ 黏住的抬頭蓋不到面板內距,左右會露出底下的內容').toMatch(
      /margin:\s*-1rem -1rem 0\s*;/,
    );
    expect(body, '少了內距 ⇒ 抬頭本身的留白消失').toMatch(/padding:\s*1rem 1rem 0\s*;/);
  });

  it('🔴🔴 `-1rem` 這個數綁的是面板的 `p-4` —— 有人把它改成 p-6,兩邊都綠而縫回來', () => {
    // 審查 Important-7 逐字:「`top:-1rem` ↔ `p-4` 的耦合【零守門】」。
    // 上一版只釘「字面 `-1rem` 還在」⇒ `p-4` → `p-6` 時**兩格全綠、縫回來 8px**。
    // ⇒ 這一格把【另一端】也釘住。兩個數要一起改,不能只改一邊。
    const panelRoute = readFileSync(join(__dirname, '@panel', 'orders', 'page.tsx'), 'utf8');
    // 🔴🔴 **第一版這條正規式命中了【註解】** —— `[^']*` 會跨行吞掉整段說明文字,
    //    而那段說明裡就寫著 `panel-width-locked`。**「提起」與「做了」字面相同**,
    //    本檔已經記過三次同款(`m-stripe` 得 3、`label:` 得 11、`.cap-y` 讀到註解)。
    //    ⇒ 收窄成「同一行、不跨引號」:`[^'\n]*`。
    const locked = [
      ...panelRoute.matchAll(/className='([^'\n]*panel-width-locked[^'\n]*)'/g),
    ].map((m) => m[1]);
    expect(locked.length, '面板路由的 panel-width-locked 容器少於兩處').toBeGreaterThanOrEqual(2);
    for (const cls of locked) {
      expect(cls, `面板容器的內距不是 p-4,而 globals.css 的補償寫死 -1rem:${cls}`).toMatch(
        /(^|\s)p-4(\s|$)/,
      );
    }
  });

  it('🔴 借來的那個 class 還在它的本家 —— 名字被改掉的話,壞的不只寬度', () => {
    // 覆寫是掛在 `.panel-width-locked` 上的,而那個 class 的本職在別處。
    // 這一格是**耦合的機械載體**:註解講得再清楚,改名的人也不會來讀。
    const panelRoute = readFileSync(join(__dirname, '@panel', 'orders', 'page.tsx'), 'utf8');
    const shell = readFileSync(
      join(__dirname, '..', 'components', 'layout', 'workspace-shell.tsx'),
      'utf8',
    );
    // 面板路由兩個分支(客人卡 / 訂單)都要帶,否則其中一條路上的縫會單獨漏。
    const hits = panelRoute.match(/panel-width-locked/g) ?? [];
    expect(hits.length, '面板路由的 `panel-width-locked` 少於兩處').toBeGreaterThanOrEqual(2);
    expect(shell, 'workspace-shell 不再認得 `panel-width-locked`').toContain('panel-width-locked');
  });
});

// ── §12 組 19 / 組 20:收款分頁收合塊標題列整條染色(2026-08-25 Sean 拍「要補」)──────
//
// 🔴🔴 **這四顆 token 在本片之前是【定義了而沒有人用在這一格】** —— 2026-08-25 量:
//    `--tint-warn` / `--ink-warn` / `--tint-danger` / `--pill-danger` 在 admin 全部 `.tsx`/`.ts`
//    消費端 = **0**;在 `globals.css` 裡有被用,但用在 `.cap-y` / `.cap-refund` / `.pcm-pill`
//    —— 那是**膠囊**,不是標題列。⇒ 本組守的是「它們真的被接到標題列上了」。
//
// ⚠️ **本組是【字面哨兵】,不是行為驗證** —— `:has()` 的實際配對 jsdom 做不到。
//    真瀏覽器那半已量(真後台 `localhost:3091`):兩條選擇器都真的命中、
//    destructive ⇒ 紅底、手動拿掉 destructive ⇒ 翻黃底、加回去 ⇒ 回紅(三段都印不同的值)。
//    **本組擋的是「這兩條規則被靜默刪掉或改壞」。**
describe('§12 組19/20 收款分頁標題列染色', () => {
  const RULE_WARN =
    /\[data-od-panel='money'\]\s*summary:has\(h2:not\(\.text-destructive\)\)\s*\{([^}]*)\}/;
  const RULE_DANGER =
    /\[data-od-panel='money'\]\s*summary:has\(h2\.text-destructive\)\s*\{([^}]*)\}/;

  // 🔴 **抽【那個屬性的值】,不是「token 有沒有出現在這段裡」**(codex 關卡2 must-fix):
  //    只驗「出現過」的話,token 被搬到 `border-color`、或被移進註解,這幾格**照樣全綠**。
  // 🔴 收 `string | undefined`:`exec()[1]` 在 `noUncheckedIndexedAccess` 下是可選的。
  //    📌 這一格是 **typecheck 抓到的,不是 vitest** —— vitest 不跑 tsc,那 4 格測試全綠而型別是紅的。
  const declOf = (block: string | undefined, prop: string): string | null =>
    (block === undefined
      ? null
      : (new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm').exec(block)?.[1]?.trim() ?? null));

  it('🔴 正常態(h2 沒有 destructive)⇒ 黃底 `--tint-warn` + 字色 `--ink-warn`', () => {
    const m = RULE_WARN.exec(CSS);
    expect(m, '組19 那條規則不見了(選擇器或格式被改動)').not.toBeNull();
    expect(declOf(m![1], 'background'), 'background 沒有綁在 --tint-warn 上').toBe(
      'var(--tint-warn)',
    );
    expect(declOf(m![1], 'color'), 'color 沒有綁在 --ink-warn 上').toBe('var(--ink-warn)');
  });

  it('🔴 對帳異常(h2 帶 destructive)⇒ 紅底 `--tint-danger` + 字色 `--pill-danger`', () => {
    const m = RULE_DANGER.exec(CSS);
    expect(m, '組20 那條規則不見了').not.toBeNull();
    expect(declOf(m![1], 'background'), 'background 沒有綁在 --tint-danger 上').toBe(
      'var(--tint-danger)',
    );
    expect(declOf(m![1], 'color'), 'color 沒有綁在 --pill-danger 上').toBe('var(--pill-danger)');
  });

  it('🔴🔴 兩條的【底色與字色】不得相同 —— 一樣的話「異常」與「正常」在畫面上就分不開了', () => {
    const warn = RULE_WARN.exec(CSS)![1];
    const danger = RULE_DANGER.exec(CSS)![1];
    // 🔴 **比的是那兩個屬性的值,不是整段文字**(codex must-fix):
    //    比整段的話,兩條顏色明明一樣、只要多一個無關宣告或空白不同,這格就會綠。
    expect(declOf(warn, 'background')).not.toBe(declOf(danger, 'background'));
    expect(declOf(warn, 'color')).not.toBe(declOf(danger, 'color'));
  });

  it('🔴 四顆 token 都真的有定義(沒定義 ⇒ `var()` 靜靜地算不出顏色,而規則字面還在)', () => {
    for (const t of ['--tint-warn', '--ink-warn', '--tint-danger', '--pill-danger']) {
      expect(new RegExp(`${t}\\s*:`).test(CSS), `${t} 沒有定義`).toBe(true);
    }
  });
});
