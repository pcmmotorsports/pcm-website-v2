import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 相對路徑(#606 前 vitest @ alias 只指 storefront 的歷史遺留;#612 更新:現可用 @/,既有不回改)。
import { stripComments } from '../../lib/test-support/strip-comments';

// app-sidebar.test.ts — M-4b E10 S3b-3(`[K1-M9]`)。
//
// 🔴 **為什麼一行 nav 值得一支測試**:整片 S3b 的三個 action、四個元件、一整頁都可以
//    完好無損,而員工**永遠找不到那一頁** —— 症狀是「功能不存在」,但三綠與其餘
//    292 支測試沒有一個會轉紅。這支的唯一工作是讓「刪掉那一行」變成看得見的事。
//
// 🔴🔴 **本檔是文字層斷言,不是渲染測試 —— 誠實邊界寫在這裡,不要讀成「導覽已驗證」**:
//    原本寫成 jsdom 渲染 `<AppSidebar />`,實跑失敗:`app-sidebar.tsx` 經
//    `@/components/ui/sidebar` 進入 shadcn 積木,那支自己還有 **9 個 `@/` import**
//    並繼續往下連鎖,而 vitest 的 `@` alias 指向 **`apps/storefront/src`**
//    (`vitest.config.ts:28`,admin 沒有自己的 alias)⇒ 整條依賴鏈 resolve 不到。
//    把那一串改成相對路徑遠超本片範圍(動的是 shadcn 抄來的 `ui/` 檔)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
//    ⇒ 本檔**擋得住**:那一行被刪掉、href 被改錯字、label 被改掉、整項被註解掉
//      (下方 `SOURCE` 先剝註解才解析,理由見該處)。
//      **擋不住**(逐條列,不要讀成「導覽已驗證」):
//        ①`<Link>` 沒接上 ②路徑對但頁面 404 ③active 態判斷寫錯
//        ④`NAV_ITEMS` 整段 `.map()` 被刪掉、或 `AppSidebar` 改吃另一份清單
//        ⑤**render 時被 runtime 條件濾掉**(例如 `.filter(...)` 或 feature flag)——
//          清單字面完好無缺,而畫面上就是沒有那一項(codex K2 nit 6 補;
//          ①-④ 都預設「這份清單有被完整 render」,⑤ 連那個前提都不成立)。
//      這五種只有真瀏覽器看得到(memory `feedback_text-level-tests-cannot-catch-runtime-wiring`)。
//    ✅ **D3=B 真機驗收已於 2026-08-02 執行**:本機 admin(指向正式站)實跑,截圖確認
//      側欄「供應商」是可點的 `<a href="/settings/suppliers">`、進得了頁面、且在該路徑下
//      呈 active 態 ⇒ ①②③ 已覆蓋。④⑤ 屬「日後有人這樣改」的假想退化,**未**單獨構造。

const RAW_SOURCE = readFileSync(
  fileURLToPath(new URL('./app-sidebar.tsx', import.meta.url)),
  'utf8',
);

/**
 * 🔴 **先剝註解再解析**(codex K2 nit 6):把整個供應商項包進 `/* … *​/`,
 *    runtime 的導覽會少一項,而 regex 照樣從註解裡抽得到它 ⇒ 測試全綠 = 假綠。
 *    這是 memory `feedback_ui-count-change-check-hardcoded-css-track-counts`
 *    記過的同一種形狀(「守門測試先剝註解」)。
 */
/**
 * 剝掉 block 與 line 註解。
 *
 * 🔴 行註解那一步用 `(?<!:)` 排除 `https://` 這種**字串裡的**雙斜線(codex K2 R2 nit:
 *    原本寫成裸 `\/\/[^\n]*`,會把 `href: 'https://example.com/x'` 截成 `href: 'https:`
 *    ⇒ 那一項會從 `navEntries()` 消失、測試假紅)。
 * 🔴 **抽成具名函式是為了讓那個 lookbehind 測得到**:目前 `NAV_ITEMS` 全是相對路徑,
 *    對 `app-sidebar.tsx` 做突變時兩種寫法行為完全相同 ⇒ 從導覽那條路**證不出**它的必要性。
 *    直接對本函式餵一行帶 `https://` 的輸入,判別力就有了 ——
 *    「我想不到怎麼構造」不等於「構造不出來」,這一片已經在這上面栽過兩次。
 */


const SOURCE = stripComments(RAW_SOURCE);

// 🔴 `#27` D1c-1:導覽清單本體搬到 `nav-items.ts`(理由見該檔檔頭:旗標的「有沒有被濾掉」
//    在 `app-sidebar.tsx` 這側測不到)。
//    ⚠️ **只換讀取來源,斷言一個字都沒放寬**(主視窗 2026-08-15 裁定的硬條件 1)。
//    🔴 **`SOURCE` 仍指 `app-sidebar.tsx`,不准一起改** —— 下面 `#380` 那兩格量的是
//    **側欄元件本身**(收合模式、`SidebarTrigger` 的位置),把 `SOURCE` 一起指過去會讓那兩格
//    改成掃一支根本沒有那些字面的檔 ⇒ **靜默恆紅或恆綠,兩種都不是守門。**
const NAV_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL('./nav-items.ts', import.meta.url)), 'utf8'),
);

/** 從 NAV_ITEMS 字面抽出 (label, href) 對;解析不到會得到空陣列 ⇒ 下面的斷言直接紅。 */
function navEntries(): Array<[string, string]> {
  return [
    ...NAV_SOURCE.matchAll(
      /\{\s*key:\s*'[^']+',\s*label:\s*'([^']+)',\s*icon:\s*[^,]+,\s*href:\s*'([^']+)'\s*\}/g,
    ),
  ].map((match) => [match[1] ?? '', match[2] ?? '']);
}

describe('stripComments', () => {
  it('should strip real comments without eating a url inside a string', () => {
    // 🔴 沒有這條,`(?<!:)` 那個 lookbehind 在本 repo **沒有任何判別力**
    //    —— 目前 nav 全是相對路徑,拿掉它對 `app-sidebar.tsx` 的解析結果逐字相同。
    expect(stripComments("  { href: '/orders' }, // 訂單\n")).toBe(
      "  { href: '/orders' }, \n",
    );
    expect(stripComments("  { href: 'https://example.com/x' },\n")).toBe(
      "  { href: 'https://example.com/x' },\n",
    );
    expect(stripComments('a /* 整段\n跨行 */ b')).toBe('a  b');
  });
});

describe('AppSidebar 導覽項', () => {
  it('should list every nav entry exactly once, including the supplier settings page', () => {
    // 🔴 斷言**完整清單**而不是「包含供應商那一項」:後者被任何超集滿足,
    //    連「每一項的 href 都被改成同一個路徑」這種退化都通得過。
    //    代價是日後加 nav 要同步改本行 —— 那本來就該是一個有意識的動作。
    expect(navEntries()).toEqual([
      ['總覽', '/'],
      ['訂單', '/orders'],
      ['退款異常', '/orders/refund-exceptions'],
      ['客戶', '/customers'],
      // M-4b #20 片1a:商品列表(唯讀)已接上頁面 ⇒ 這一格從此可點(plan 驗收 6)。
      ['商品', '/products'],
      ['員工管理', '/settings/staff'],
      ['供應商', '/settings/suppliers'],
      // A9w2:「設定」原指 `/settings/order-statuses`(九碼狀態詞彙 CRUD),該頁隨九碼退場已刪
      // ⇒ 改為無 href 的不可點格;`navEntries()` 的 regex 要求 `href:` 才匹配得到,
      // 所以它從本清單消失是**預期**的。本檔看守的正是「哪幾項是可點的」。
      // 🔴 `#27` D1c-1:稽核入口。**它在字面上永遠都在**(本檔量的是字面)——
      //    「旗標關的時候畫面上有沒有它」是 `nav-items.test.ts` 的行為層守門,不是本檔的職能。
      //    ⚠️ **「操作紀錄」是 Sean 2026-08-15 拍板的字**(`Q-選單名 = 乙`);**內部一律 audit,
      //    只有畫面上這幾個字不是,那是刻意的** —— 不要「順手統一」改回「稽核紀錄」。
      ['操作紀錄', '/settings/audit'],
    ]);
  });

  it('🔴 A9w2:設定那一格仍在、但不得有 href(頁面已下架,留著 href = 送員工去 404)', () => {
    // 與上一條互補而非蘊含:上面看守「可點清單」,這條看守「那一格沒被順手刪掉、
    // 也沒有人把死路徑接回來」—— 只刪頁不改 nav、或只改 nav 不刪頁,各紅一條。
    // 🔴 D1c-1:`icon` 由 `Icons.settings`(元件)改存字串鍵 `'settings'` —— **不是放寬斷言**,
    //    是 `nav-items.ts` 為了維持「runtime 依賴為零」必須存字串(理由見該檔檔頭)。
    expect(NAV_SOURCE).toContain("{ key: 'settings', label: '設定', icon: 'settings' }");
    expect(NAV_SOURCE).not.toContain('/settings/order-statuses');
  });

  // 🔴 **刪掉了第二條**(R1 nit):它原本斷言「供應商那項有 href、不是 disabled button」,
  //    但 `navEntries()` 的 regex 本來就要求 `href:` 存在才匹配得到 ⇒ 若那項變成無 href 的
  //    disabled 分支,上面那條 `toEqual` 已經先紅。被嚴格蘊含的斷言寫不出只紅它的負測
  //    (memory `feedback_unconstructible-negative-test-means-noop-guard`),留著只是假裝多一道。
});

// ── #350a:側欄寬度釘值 ──────────────────────────────────────────────────────
// 🔴 **為什麼需要這一格**:#350 的偵察實查結果是「root layout 零測試、側欄寬度零斷言」——
//    也就是說,**把寬度改回 16rem、或改到會截字的 6rem,全 repo 沒有一格會紅**。
//    Sean 的需求(「跟文字對齊、放大訂單空間」)與那個下限(截字)都只活在一個常數裡,
//    沒有守門就等於沒寫下來。
const SIDEBAR_UI_SOURCE = stripComments(
  readFileSync(fileURLToPath(new URL('../ui/sidebar.tsx', import.meta.url)), 'utf8'),
);

/**
 * 從 `ui/sidebar.tsx` 抽某個寬度常數的 rem 值(抽不到 = 常數被改名/刪掉,回 null 讓斷言紅)。
 *
 * 🔴 **先剝註解**(同本檔 `SOURCE` 的既有理由):`SIDEBAR_WIDTH` 的 docstring 裡就有 `16rem`
 * 這個字面(在講「原本是多少」)。今天的 regex 要求 `const X = '` 前綴、不會誤命中,
 * 但只要有人把舊那行註解掉再新增一行,`.exec` 就會抓到註解裡的那個 ⇒ 假綠。不留這個縫。
 */
function widthRem(name: string): number | null {
  const m = new RegExp(`const ${name} = '([0-9.]+)rem'`).exec(SIDEBAR_UI_SOURCE);
  return m ? Number(m[1]) : null;
}

describe('#350a 側欄寬度(Sean:窄到跟文字對齊、放大訂單空間)', () => {
  it('🔴 桌機展開寬 = 9rem(比原本的 16rem 還給內容區 7rem)', () => {
    // 🔴 **下限 ≈119px(header 溢出)、選單截字 ≈113px** —— 推導表在 `ui/sidebar.tsx` 的
    //    `SIDEBAR_WIDTH` docstring。要調這個值的人請先讀那張表:往下走**先撞 header 溢出**,
    //    而 header 沒有 truncate ⇒ 是蓋到內容區,不是靜默截字。
    // ⚠️ **刻意只有這一格、沒有另立「>= 下限」那格**:`toBe(9)` 綠 ⇒ 任何 `>=` 恆綠
    //    = 被嚴格蘊含、寫不出只紅它的負測(memory `feedback_unconstructible-negative-test-means-noop-guard`,
    //    也正是本檔上面剛刪掉一條斷言的同一個理由)。下限寫在 docstring 給人讀,不假裝是一道守門。
    expect(widthRem('SIDEBAR_WIDTH')).toBe(9);
  });

  it('🔴 手機寬度**不得**被順手一起改(Q5=維持現狀:手機是 Sheet 覆蓋、不是分割)', () => {
    expect(widthRem('SIDEBAR_WIDTH_MOBILE')).toBe(18);
  });

  it('🔴 桌機展開寬那顆常數本身要存在(抽不到 = 被改名/刪掉,上面兩格會靜默拿到 null)', () => {
    expect(widthRem('SIDEBAR_WIDTH')).not.toBeNull();
  });

  // 🔴 **這一格的理由被 #380 弄過期了,標題同步改掉**(原文是「⌘B 收合仍是既有行為,本片不動」)。
  //    #380 之後 admin 的收合模式是 `offcanvas` ⇒ **圖示態在後台已經走不到了**,
  //    `SIDEBAR_WIDTH_ICON` 只剩 fork 來的 `ui/sidebar.tsx` 自己還支援(通用能力,非 admin 路徑)。
  //    保留這條斷言的唯一理由 = 有人把 `collapsible` 改回 `'icon'` 時,寬度不會同時被亂動;
  //    **它不再是「後台收合行為」的守門** —— 那個守門是下面 #380 那一組。
  it('圖示態寬度常數不變(#380 後 admin 走不到此模式,僅守 fork 元件的通用能力)', () => {
    expect(widthRem('SIDEBAR_WIDTH_ICON')).toBe(3);
  });
});

// ── #380:收合 = 整條收起,而且收起後開得回來 ────────────────────────────────────
//
// 🔴 **這一片修的不是「鈕不見了」**:S-010 唯讀診斷證明 `SidebarTrigger` 從後台骨架那顆 commit
//    之後**沒有任何 commit 動過**;Sean 按得到,只是 `collapsible='icon'` 收完只剩一條
//    3rem 圖示列,他讀成「沒收起來」。⇒ 真正的修法是換模式。
//
// 🔴🔴 **誠實邊界(照本檔既有紀律,不要讀成「收合行為已驗證」)**:本檔是**文字層**斷言。
//    擋得住:`collapsible` 被改回 `'icon'` / 被整個拿掉(拿掉 = 落回元件預設值,恰好也是
//    `offcanvas`,所以下面第二條**另外**釘住那個字面必須寫出來)、以及 `SidebarTrigger`
//    被搬進側欄子樹裡。
//    擋不住:①收合動畫實際跑不跑得起來 ②收起後內容區有沒有真的拿回那 9rem
//    ③那顆鈕在收合狀態下有沒有被別的東西蓋住 ⇒ **這三條只有 Sean 的肉眼驗算數**
//    (本檔檔頭記過同一個坑:vitest 的 `@` alias 指向 storefront,渲染 `<AppSidebar />` 進不去)。
describe('#380 側欄收合模式', () => {
  it('🔴 收合模式 = offcanvas(整條滑走),不是 icon(留一條圖示列)', () => {
    expect(SOURCE).toContain("<Sidebar collapsible='offcanvas'>");
    // 負向對照:沒有這一條,把 `icon` 那個字面留在檔案別處(例如註解外的死碼)也不會被發現。
    expect(SOURCE).not.toContain("collapsible='icon'");
  });

  it('🔴 收起後開得回來:SidebarTrigger 在 header、不在側欄子樹內', () => {
    // 這是本片唯一「改壞了會把員工鎖在收合狀態」的不變式:側欄整條滑走時,
    // 唯一的重新展開入口必須活在**沒有被收起的那棵子樹**裡。
    const headerSource = stripComments(
      readFileSync(fileURLToPath(new URL('./header.tsx', import.meta.url)), 'utf8'),
    );
    expect(headerSource).toContain('<SidebarTrigger');
    expect(SOURCE).not.toContain('<SidebarTrigger');
  });
});
