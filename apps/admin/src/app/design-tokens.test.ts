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
    const ALLOWED_UNCOVERED = ['border', 'sidebar-border'];
    expect(uncovered, '這些 token 沒有任何一組配對在量 ⇒ 改它們不會有東西紅').toEqual(
      ALLOWED_UNCOVERED,
    );
    // 分母斷言:切片壞掉 ⇒ `declared` 變空 ⇒ 上面那格會拿 [] 去比而「看起來也對」。
    expect(declared.length, ':root 一顆 token 都沒數到 = 切片或正規式壞了').toBeGreaterThan(20);
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
