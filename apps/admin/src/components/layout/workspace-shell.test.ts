import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// 相對路徑(#606 前 vitest @ alias 只指 storefront 的歷史遺留;#612 更新:現可用 @/,既有不回改)。
import { stripComments } from '../../lib/test-support/strip-comments';
import { MIN_CONTENT_WIDTH, MIN_PANEL_WIDTH } from '../../lib/layout/workspace-panel';

// workspace-shell.test.ts — #350b 工作區殼的**接線字面**守門。
//
// 🔴 **為什麼這些東西需要一支測試**:本片接的東西壞掉時**都沒有執行期訊號**——
//   ①`app/@panel/default.tsx` 不見了 ⇒ 開發時全程軟導航一路正常,**使用者按 F5 才 404**
//   ②layout 的 `panel` prop 名與資料夾名 `@panel` 對不上 ⇒ 面板永遠不出現、**零錯誤**
//   ③TSX 的 class 名與 `globals.css` 的 `:has()` 選擇器對不上 ⇒ 沒有面板時每頁留一條孤把手
//   而 #350 的偵察實查結論是:**root layout 零測試**、這一整層本來沒有任何守門。
//
// 🔴 **共用 `lib/test-support/strip-comments`,不自己寫一支**(code-reviewer R1 must-fix):
//   我第一版自寫的只剝 `//` 與 doc 續行 ⇒ 把 `panel={panel}` 用 `{/* … */}` 包起來就全綠;
//   而共用那支會剝 `/* */`(codex K2 nit 6 修過的同一形狀)、還帶 `https://` 的 lookbehind。
//   ⚠️ 它原本 `export` 在 `app-sidebar.test.ts` 裡,但 import 一支 `.test.ts` 會讓**它的 describe
//   一起被註冊進來、整組測試跑兩次**(R2 nit 實測)⇒ 已搬到非 test 檔。
//   CSS 那份**也要剝** —— `/* */` 是 CSS 唯一的註解形式,不剝就是把規則註解掉照樣綠。
//
// ⚠️⚠️ **本檔擋得住什麼、擋不住什麼(不要讀成「分割視窗已驗證」)**:
//   擋得住 —— 上面三樣的**檔案/字面**被刪、改名、或註解掉。
//   **擋不住** —— `default.tsx` 內容被改成會炸的東西、拖曳實際上會不會動、`:has()` 在真瀏覽器的切換、
//   重整後寬度真的還在、面板有內容後會不會把列表擠爆、**以及殼多包一層對既有頁面版面的影響**。
//   那些要**真瀏覽器**,已掛 350c 驗收清單 + Sean 肉眼驗清單(主視窗 `D-393-A:12` 核准這個分工)。

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const LAYOUT = stripComments(read('../../app/layout.tsx'));
const SHELL_RAW = read('./workspace-shell.tsx');
const SHELL = stripComments(SHELL_RAW);
const GLOBALS = stripComments(read('../../app/globals.css'));
const PANEL_DEFAULT_PATH = fileURLToPath(new URL('../../app/@panel/default.tsx', import.meta.url));

describe('#350b 平行路由槽的接線', () => {
  it('🔴🔴 `app/@panel/default.tsx` **必須存在** —— 沒有它,使用者一按 F5 就 404', () => {
    // 這個坑的惡劣之處是它**只在硬導航/重整時發作**:開發時一路點都是軟導航、全部正常。
    expect(existsSync(PANEL_DEFAULT_PATH)).toBe(true);
  });

  it('🔴 layout 收 `panel` prop,且名字與資料夾 `@panel` 一致(對不上 = 面板永遠不出現、零錯誤)', () => {
    expect(LAYOUT).toMatch(/panel:\s*React\.ReactNode/);
    expect(LAYOUT).toContain('panel={panel}');
  });

  it('🔴 layout **在 server 端讀 cookie** 並把初值傳下去(否則「持久化」只寫不讀)', () => {
    expect(LAYOUT).toContain('parsePanelWidthCookie');
    expect(LAYOUT).toContain('initialPanelWidth={initialPanelWidth}');
  });

  // 🔴🔴 **`forcedTheme='light'` 是「關閉深色」的唯一機制**(2026-08-16 Sean 拍板)。
  //    ⚠️ **`defaultTheme='light'` 擋不住** —— `next-themes` 的 `setTheme` 無條件寫 localStorage,
  //    而 `defaultTheme` 只在**沒存過**時生效 ⇒ 拿掉這個 prop,**曾經切過深色的人會留在深色**,
  //    而切換入口已經移除 ⇒ **沒有出口**。
  //    🔴 **這條沒有守門的話,刪掉它三綠全綠、CI 全綠、沒存過的人全部看不到** ——
  //    症狀只在「存過 dark 的那一台機器」上出現。同 `print:hidden` 那三顆的論證:
  //    **擋得住刪除,而刪除是唯一沒人守的一條路。**
  it("🔴 layout 掛 `forcedTheme='light'`(拿掉 = 存過深色的人鎖死在深色且無出口)", () => {
    expect(LAYOUT).toContain("forcedTheme='light'");
  });
});

describe('#350b TSX 的 class 名 × CSS 的 `:has()` 選擇器 —— 唯一的接點', () => {
  // 🔴🔴 **這一格是 code-reviewer 抓到的洞**(memory `feedback_assertion-measures-the-wrong-thing`
  //    第四形狀:兩端各有測試、中間透傳一跳無人守):
  //    原本只斷言「CSS 檔裡有那兩條選擇器」+「TSX 裡有 role='separator'」——
  //    把 TSX 的 `workspace-panel` / `workspace-row` / `workspace-handle` 任一個改名或刪掉,
  //    `:has()` 規則就永遠不匹配 ⇒ **每一頁都常駐一條孤零零的可拖拉線 + 一塊空欄,而測試全綠。**
  const PREFIX = '.workspace-row:not(:has(.workspace-panel > *:not(template)))';

  it.each(['workspace-row', 'workspace-panel', 'workspace-handle'])(
    '🔴 class `%s` 在 TSX 與 CSS **兩邊都在**',
    (cls) => {
      // 🔴 用詞邊界找,不要求它是 className 的第一個 token(R2 nit:換順序會假紅)。
      expect({ [`tsx:${cls}`]: new RegExp(`\\b${cls}\\b`).test(SHELL) }).toEqual({
        [`tsx:${cls}`]: true,
      });
      expect({ [`css:${cls}`]: GLOBALS.includes(`.${cls}`) }).toEqual({ [`css:${cls}`]: true });
    },
  );

  it('🔴 空槽時面板欄**與**把手**兩者**都要被收起來(刪掉其中一條選擇器也要紅)', () => {
    expect(GLOBALS).toContain(`${PREFIX} > .workspace-panel`);
    expect(GLOBALS).toContain(`${PREFIX} > .workspace-handle`);
  });
});

describe('#350b 寬度夾範圍:CSS 與 TS 常數是同一組規則的兩個落點', () => {
  // 🔴 夾範圍改在 CSS 做之後(第一幀就正確、不會因縮視窗把偏好永久改小),
  //    同一組數字就有了**兩個落點** ⇒ 改一邊不改另一邊,兩者會靜默分歧:
  //    CSS 說最少 320、TS 說最少 400 的話,拖曳夾出來的值與畫面實際寬度不一致,
  //    而 `aria-valuemin` 報的是 TS 那個 = 對輔具說謊。
  it('🔴 `min-width` / `max-width` 的數字與 `workspace-panel.ts` 的常數一致', () => {
    expect(GLOBALS).toContain(`min-width: ${MIN_PANEL_WIDTH}px`);
    expect(GLOBALS).toContain(`max-width: calc(100% - ${MIN_CONTENT_WIDTH}px)`);
  });

  it('🔴 `:has()` 要排除 `<template>`(React streaming 會插它,否則面板永遠收不起來)', () => {
    expect(GLOBALS).toContain('*:not(template)');
  });
});

describe('#350b 殼是共用基礎設施,不得為業務量身訂做', () => {
  it('🔴 殼的原始碼不得出現任何業務概念(wave-plan `:23`:E 的取消畫面與 B 的收款讀面都要掛進來)', () => {
    // 一旦殼認得 `order`,E/B/347-3 接進來時就要拆掉重做 —— 而那時它已經上線、動它要付回歸的代價。
    // 🔴 **詞邊界比對,不能用 `includes`**:Tailwind 的 `bg-border` 裡就含 `order` ⇒ 子字串會假紅,
    //    而一個只會誤報的守門,下一個人會直接把它刪掉 = 這條規則等於沒存在過。
    const code = SHELL.toLowerCase();
    for (const word of ['order', 'shipment', 'refund', 'customer']) {
      expect({ [word]: new RegExp(`\\b${word}\\b`).test(code) }).toEqual({ [word]: false });
    }
    expect({ 訂單: SHELL.includes('訂單') }).toEqual({ 訂單: false });
  });
});

describe('#350b 捲動模型:殼不得順手改掉全站的捲動行為', () => {
  // 🔴🔴 **這一格守的是一條「不要做某件事」的規則**(code-reviewer 抓到的第一條 must-fix):
  //    第一版把 row 寫成 `min-h-0 flex-1`、main 加 `overflow-auto` —— 看起來只是排版,實際上
  //    `sidebar-wrapper` 有 `min-h-svh` ⇒ row 一旦 `min-h-0` 就拿到確定高度、`overflow-auto` 真的生效
  //    ⇒ **全站從「document 捲」變成「main 內捲」**,而 `multi-check-filter` 那種非 portal 的
  //    `absolute` 下拉(訂單列表篩選在用)會被新的 scroll container **裁切**。
  //    ⇒ 殼只負責「多切一欄」,不順手改每一個既有頁面的行為;面板自己的捲動留 350c(那時看得見)。
  // 🔴🔴 **兩格都要哨兵**(code-reviewer R2 must-fix:第一格原本恆真):
  //    `?? ''` 之後 `''.not.toContain('overflow')` **會通過** ⇒ 把 className 改成雙引號、
  //    或改成 `className={cn(...)}`,regex 抽不到、斷言照樣綠,而它要擋的回歸原封不動存在。
  //    抽不到就是「守門瞎了」,必須紅 —— 這是 memory 記過的恆真形狀,我在同一支檔裡犯了一次。
  it('🔴 內容區不得成為新的 scroll container(抽不到 class 也要紅)', () => {
    const content = /className='workspace-content([^']*)'/.exec(SHELL)?.[1] ?? 'MISS';
    expect(content).not.toBe('MISS');
    expect(content).not.toContain('overflow');
  });

  it('🔴 workspace-row 不得帶 `min-h-0`(那是讓 overflow 真的生效的那一半)', () => {
    const row = /className='workspace-row([^']*)'/.exec(SHELL)?.[1] ?? 'MISS';
    expect(row).not.toBe('MISS');
    expect(row).not.toContain('min-h-0');
  });
});

describe('#350b 無障礙:分隔線不能只有滑鼠拖得動、也要報得出位置', () => {
  it('🔴 handle 有 separator 語意 + 可聚焦 + 鍵盤可調', () => {
    expect(SHELL).toContain("role='separator'");
    expect(SHELL).toContain('tabIndex={0}');
    expect(SHELL).toContain('onKeyDown');
    expect(SHELL).toMatch(/aria-label=/);
  });

  it('🔴 可聚焦的 separator 依 ARIA **必須**報得出 valuenow/min/max(只有 label 等於讀不到拖到哪)', () => {
    for (const attr of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) {
      expect({ [attr]: SHELL.includes(attr) }).toEqual({ [attr]: true });
    }
  });
});
