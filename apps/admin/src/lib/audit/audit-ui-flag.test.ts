import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuditUiEnabled } from './audit-ui-flag';
// 🔴 相對路徑不用 `@/`(vitest 的 `@` 指向 `apps/storefront/src`);沿用 `app-sidebar.test.ts` 的既有剝註解工具。
import { stripComments } from '../test-support/strip-comments';

// audit-ui-flag.test.ts — 證明這個開關**預設是關的**。
//
// 🔴 **為什麼這三格值得寫**(主視窗 2026-08-15 裁定,理由是今晚自己得出的結論):
//   > **如果某個檢查從來沒紅過,它的綠沒有資訊量。**
//   這個 flag 是用來擋「Sean 先 push、後 apply ⇒ 正式站壞」的**機制**
//   (事故先例:2026-08-07 A9h,正式站壞約 8 小時,而**審查看不到它** —— 單測 mock 掉 rpc、hook 看不到 deploy)。
//   ⇒ **一個沒有人證明過會關的開關,保護的是我們的心情,不是正式站。**
//
// 🔴 **每格都先驗 stub 真的生效再斷言結果**(house 範本 `lib/orders/payment-list-view.test.ts:96-107`)。
//   不驗前提的話,`vi.stubEnv` 沒改到時下面那句在「env 本來就沒設」的環境下**恆綠** ——
//   那正是「偵測器根本沒吐東西」的假綠。

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAuditUiEnabled — 預設關(這是機制,不是配置)', () => {
  it('env 未設 ⇒ false', () => {
    vi.stubEnv('AUDIT_UI_ENABLED', undefined as unknown as string);
    expect(process.env.AUDIT_UI_ENABLED, '前提:stub 後該欄應為 undefined').toBeUndefined();
    expect(isAuditUiEnabled()).toBe(false);
  });

  /**
   * 🔴 `'true'` 那格是這一族裡最重要的:
   * 下一個人**很可能**設 `AUDIT_UI_ENABLED=true` 然後以為開了 —— 而判定式只認 `'1'`。
   * 失敗方向是**安全的**(以為開了其實關著),但**排錯會很久**,所以要有一格明說。
   */
  it.each(['0', 'true', 'TRUE', 'yes', '', ' 1', '1 '])('env=%o ⇒ false(只認逐字 "1")', (value) => {
    vi.stubEnv('AUDIT_UI_ENABLED', value);
    expect(process.env.AUDIT_UI_ENABLED, '前提:stub 應真的寫進 process.env').toBe(value);
    expect(isAuditUiEnabled()).toBe(false);
  });

  // 🔴 正向對照:證明上面那些 false **不是因為這個函式恆回 false**。
  //    少了這一格,把 `isAuditUiEnabled` 改成 `return false` 也會全綠 —— 那就是恆綠格。
  it('🔴 env="1" ⇒ true(正向對照:證明上面那些 false 有判別力)', () => {
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
    expect(process.env.AUDIT_UI_ENABLED, '前提:stub 應為 "1"').toBe('1');
    expect(isAuditUiEnabled()).toBe(true);
  });
});

// ── 🔴 `#27` D1c-1(E 窗 R1 must-fix):client component 不得 import 這支旗標 ──────────
//
// **我原本寫的是「這件事寫不成測試 ⇒ 那段註解是唯一的載體」—— 那句是錯的,而且錯得有方向。**
// E 窗先量分母再落筆:**本 repo 已有 21 支測試檔用 `readFileSync` 當守門**,其中一支正是本片
// 親手改過的 `app-sidebar.test.ts` ⇒ **分母非 0,不准寫「做不到」。**
//
// 🔴 **病灶 = 我把兩件事併成一件**:
//   · **「bundler 把 env 編成什麼」** —— 難用單元測試複現(要真跑 `next build`),**這半我沒說錯**;
//   · **「repo 裡有沒有人寫出那條 import」** —— **純文字事件,10 行內守得住,還有 21 個現成前例。**
//   ⇒ 我真正要防的是後者,卻拿前者的成本當理由把它整個放掉。
//   **判別刀(主視窗給的)**:要那個環境的**狀態**,還是那個引擎的**行為**?——**兩個都不是,是倉庫裡的一行字。**
//
// ⚠️ **這確實是「釘 repo 字面」,而這次剛好正中目標** —— 要防的事件本身就是「有人寫下那行 import」。
//   (對照 memory `feedback_guards-pin-repo-text-not-real-world-fact`:那條防的是**拿字面冒充事實**;
//    這裡字面**就是**事實,不是它的替身。)
const ADMIN_SRC = fileURLToPath(new URL('../..', import.meta.url));

/** 走訪 `apps/admin/src` 下所有 ts/tsx(寫法照抄既有前例 `lib/payment/composition-tappay-wiring.test.ts:41-43`)。 */
function allSourceFiles(): string[] {
  return readdirSync(ADMIN_SRC, { recursive: true, encoding: 'utf8' })
    .filter((rel) => /\.(m|c)?[jt]sx?$/.test(rel))
    .map((rel) => path.join(ADMIN_SRC, rel));
}

/**
 * 「**真的 import 了**」的判準 —— **不是「檔案裡出現這串字」**。
 *
 * 🔴 **第一版就是寫成 `includes('audit-ui-flag')`,而它在乾淨的樹上立刻紅** ——
 *    紅的是 `app-sidebar.tsx`,因為那支的**註解**裡寫著「守門在 `…/audit-ui-flag.test.ts` 檔尾」。
 *    ⇒ **子字串命中 ≠ import**。這一版兩層:**先剝註解**(手法同 `app-sidebar.test.ts` 的既有慣例,
 *    否則註解裡貼一行範例 import 就假紅)、**再要求它出現在 `from '…'` 子句裡**。
 * ⚠️ **擋不住**(誠實邊界,別讀成「不可能繞過」):動態 `await import(…)` 拼接字串、
 *    或透過第三支檔轉手 re-export。**那兩種都不是「順手寫錯」的形狀**,而這道守門防的正是順手寫錯。
 */
const IMPORTS_FLAG = /\bfrom\s+['"][^'"]*audit-ui-flag['"]/;

/** 開頭是 `'use client'` 的檔(只看前幾行,避免把字串裡出現該字面的檔誤判成 client)。 */
function clientComponentFiles(): string[] {
  return allSourceFiles().filter((file) =>
    /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(readFileSync(file, 'utf8')),
  );
}

describe('🔴 旗標不得被 client component 讀取(讀了會靜默恆關,而三綠全綠)', () => {
  it('前提:走訪真的抓得到 client 檔(抓到 0 支 = 走訪壞了,下一格會恆綠)', () => {
    // 🔴 **沒有這一格,整組就是「什麼都沒有 ⇒ 當成檢查過了」那個形狀**
    //    (memory `feedback_absence-read-as-verified`:零也要停)。
    //    量到的分母:2026-08-15 為 **30 支**;此處只斷言「非零」,不釘 30 ——
    //    釘死的話每加一個 client 元件就假紅,而**這一格要守的是「走訪沒壞」,不是「有幾支」。**
    //
    // ✅ **已實測接得住的失效**(E 窗 R2 親手構造):`{ recursive: true }` → `false`
    //    (**忘了加 `recursive` 是真的會發生的 bug**)⇒ 本格紅、訊息 `expected 0 to be greater than 0`。
    // 🔴🔴 **但它同時標了一條仍然存在的缺口,原樣抄在這裡,不要當它已經關掉**(E 窗逐字):
    //    > **我構造的是「走訪回空」。「走訪回了東西但漏掉某個子樹」我沒構造** ——
    //    > **前提格只斷言 `> 0`,那種看不到。這條缺口是真的還在。**
    //    ⇒ **例:走訪只掃到 `lib/` 而漏掉整個 `components/`** ⇒ 本格照樣綠、下一格也照樣綠,
    //      而**真正該被檢查的那些 client 元件根本沒被看過。** 本格擋不住這種。
    expect(clientComponentFiles().length).toBeGreaterThan(0);
  });

  it('前提:判準真的抓得到 import(正向對照,證明下一格的 0 是活的 0)', () => {
    // 🔴 直接餵**保證命中**與**保證不命中**的兩個字串,不依賴樹上剛好有什麼 ——
    //    樹上的檔會變,而這一格要證明的是「這條判準本身是活的、而且不是恆真」。
    expect(IMPORTS_FLAG.test("import { isAuditUiEnabled } from '../lib/audit/audit-ui-flag';")).toBe(true);
    // 負向:光是在文字裡提到檔名不算 import —— **這正是第一版寫成 `includes()` 時的假紅來源。**
    expect(IMPORTS_FLAG.test('守門在 lib/audit/audit-ui-flag.test.ts 檔尾')).toBe(false);
  });

  it('🔴 沒有任何 client component import `audit-ui-flag`', () => {
    const offenders = clientComponentFiles().filter((file) =>
      IMPORTS_FLAG.test(stripComments(readFileSync(file, 'utf8'))),
    );
    // 失敗訊息帶出檔名 —— 紅的時候要看得出「紅在哪一支」,不是只知道紅了。
    expect(offenders.map((f) => path.relative(ADMIN_SRC, f))).toEqual([]);
  });
});
