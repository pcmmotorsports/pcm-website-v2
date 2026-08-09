import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 🔴 相對路徑不用 `@/`:vitest 的 `@` alias 指向 `apps/storefront/src`(本檔檔頭記過的同一個坑)。
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

/** 從 NAV_ITEMS 字面抽出 (label, href) 對;解析不到會得到空陣列 ⇒ 下面的斷言直接紅。 */
function navEntries(): Array<[string, string]> {
  return [
    ...SOURCE.matchAll(
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
      ['員工管理', '/settings/staff'],
      ['供應商', '/settings/suppliers'],
      // A9w2:「設定」原指 `/settings/order-statuses`(九碼狀態詞彙 CRUD),該頁隨九碼退場已刪
      // ⇒ 改為無 href 的不可點格;`navEntries()` 的 regex 要求 `href:` 才匹配得到,
      // 所以它從本清單消失是**預期**的。本檔看守的正是「哪幾項是可點的」。
    ]);
  });

  it('🔴 A9w2:設定那一格仍在、但不得有 href(頁面已下架,留著 href = 送員工去 404)', () => {
    // 與上一條互補而非蘊含:上面看守「可點清單」,這條看守「那一格沒被順手刪掉、
    // 也沒有人把死路徑接回來」—— 只刪頁不改 nav、或只改 nav 不刪頁,各紅一條。
    expect(SOURCE).toContain("{ key: 'settings', label: '設定', icon: Icons.settings }");
    expect(SOURCE).not.toContain('/settings/order-statuses');
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

  it('圖示態寬度不變(⌘B 收合仍是既有行為,本片不動)', () => {
    expect(widthRem('SIDEBAR_WIDTH_ICON')).toBe(3);
  });
});
