import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `manual-customer.ts` 第一行是 `import 'server-only'` ⇒ 在 vitest 底下會直接丟
// 「This module cannot be imported from a Client Component module」而**一格測試都不跑**。
// 抄同目錄 `manual-customer-actions.test.ts:5` 的既有做法, 不自己發明。
vi.mock('server-only', () => ({}));

import { MANUAL_CUSTOMER_SEARCH_ACTION } from './manual-customer';

// ⟦b9-ENUMWATCH⟧ 跨檔守門:SQL 那一支數的 action 字面, 必須與應用層寫的那一顆常數同源。
//
// 🔴 **為什麼非要有這一支**(2026-09-01 拋棄式 PG 實測, 不是推的):
//    把 migration 裡的 action 字面改一個字元 ⇒
//      · `psql -v ON_ERROR_STOP=1` apply **rc=0**(A-D 四道斷言全過)
//      · 而函式回 `{"manual_customer_search_count": 0, …}`
//    ⇒ **SQL 層的斷言抓不到改名** —— 它們驗的是「函式對不對、ACL 收沒收」,
//      **沒有一道驗「它數的是不是我們在寫的那個事件」**。
//    📌 ⇒ 而那個 0 與「今天沒有人搜尋客戶」**印同一個東西**。
//
// 🛑 **而這正是那一族的形狀**:一個【跨檔的假設】沒有任何一支測試守得住它,
//    因為**每一支測試的分母都是自己那支檔** —— SQL 那邊驗 SQL、TS 這邊驗 TS,
//    兩邊各自全綠, 而中間那條線沒有主人。**本檔就是那條線的主人。**
//
// ⚠️ **本檔的天花板(第二版,codex R1 補上一格我漏寫的)**:
//    ① 它證的是【兩處字面相同】,**證不到**「寫入端真的用這顆常數寫進 admin_audit_log」
//       —— 那由片 1 的 `manual-customer-actions.test.ts` 負責(它驗寫入)。**兩支缺一不可。**
//    ② 🔴 **它讀的是【檔案文字】,不是資料庫裡真的那一支函式** ——
//       正式庫若跑的是別一代(帳本與現況是兩個宣稱),本檔一格都答不出來。
//    ③ 🔴 而它比對的是【剝掉註解後的碼】—— 剝的邏輯本身若壞掉,它會退化成比對全文
//       ⇒ 所以下面第二格專門在驗「剝這一步有沒有作用」。
//    ④ 🛑 **剝註解的 regex【不理解 SQL 字串常值】**(codex R2 指出, 我確認成立):
//       字串裡若出現 `--` 或 `/*`(例如 COMMENT 的內文), 它會被誤剝。
//       ⇒ **方向是【假紅】不是假綠**:少了一段碼, 述詞那一格會找不到而紅 —— 吵, 但安全。
//       ⇒ 而「藏一個第二述詞」那條路被下面「述詞形狀」那一格擋住了:集合恰為 `['=']`
//         ⇒ **多一個述詞就多一個元素 ⇒ 紅。**
//       ⚠️ 要真的解掉它得寫一個 SQL 詞法器, 而那是一支測試不該長成的東西。**明寫, 不假裝。**

const MIGRATION = join(
  __dirname,
  '../../../../../supabase/migrations/20260901160000_m4b_enumwatch_manual_customer_search_summary.sql',
);

describe('⟦b9-ENUMWATCH⟧ SQL 的 action 字面 = 應用層常數', () => {
  const raw = readFileSync(MIGRATION, 'utf8');

  // 🔴🔴 **codex R1 must-fix:第一版的 regex【不排除註解】** ——
  //    它實測示範了一個假綠:把真的述詞改成錯的 `l.action IN (…)`,
  //    而旁邊留一行 `-- l.action = '正確字面'` ⇒ **四格全綠。**
  //    📌 ⇒ 而那正是這一族的形狀:**一支檔會對它自己說謊,而說謊那句讀起來最像已經做到了。**
  //    ⇒ 所以先把 `--` 行註解與 `/* */` 區塊註解剝掉,再去比對【碼】。
  const sql = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  it('🟢 先證這把尺撈得到東西(否則下面那格會在讀不到檔時假綠)', () => {
    // 🔴 抄 `refund-alert-threshold-parity.test.ts` 踩過的坑:那支原本用**不帶 `/g`**
    //    的 `.match()` ⇒ 只釘住第一個 ⇒ 改第二個三格全綠。所以這裡一律用 `matchAll`。
    expect(raw.length).toBeGreaterThan(1000);
    expect(sql).toContain('get_manual_customer_search_summary');
  });

  it('🟢 剝註解這一步本身要有作用(否則上面那個修法等於沒做)', () => {
    // 檔頭有大量 `--` 註解 ⇒ 剝完一定要短一截。短不了 = 剝的邏輯沒接上。
    expect(sql.length).toBeLessThan(raw.length - 500);
    // 而註解裡確實提到那個字面(所以「剝掉註解」不是空動作)
    expect(raw).toContain(MANUAL_CUSTOMER_SEARCH_ACTION);
  });

  it('碼裡(非註解)出現的 action 字面, 集合恰為那顆常數', () => {
    const found = [...sql.matchAll(/l\.action\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(found.length).toBeGreaterThan(0); // 🟢 撈到東西才算數
    expect(new Set(found)).toEqual(new Set([MANUAL_CUSTOMER_SEARCH_ACTION]));
  });

  it('🔴 而述詞的【形狀】也要釘住 —— 不得改成 IN / LIKE / <> 之類', () => {
    // codex 那一發假綠靠的就是換掉述詞形狀。只比字面擋不住它。
    // 🔵 `m[1] ?? ''`:capture group 在型別上是 `string | undefined` ⇒ 直接 `.toUpperCase()`
    //    **vitest 全綠而 typecheck 紅(TS2532)**。今天第三次撞到同一件事:**綠的那個不是尺。**
    const predicates = [...sql.matchAll(/l\.action\s*(=|IN|LIKE|<>|!=|~)/gi)].map((m) =>
      (m[1] ?? '').toUpperCase(),
    );
    expect(predicates).toEqual(['=']);
  });

  it('🔵 負對照:同一把尺對一個現造欄名撈不到', () => {
    expect([...sql.matchAll(/l\.zzq9field\s*=\s*'([^']+)'/g)]).toHaveLength(0);
  });

  it('COMMENT 裡也要提到常數名字(有人改名時, 讀 COMMENT 的人找得到另一端在哪)', () => {
    expect(raw).toContain('MANUAL_CUSTOMER_SEARCH_ACTION');
  });
});
