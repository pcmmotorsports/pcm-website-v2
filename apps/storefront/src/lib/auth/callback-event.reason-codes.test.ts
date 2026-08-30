// callback-event.reason-codes.test.ts — 板 :395,TS 的九個 reason 對 SQL 的九個列舉【逐字交叉核】。
//
// 🔵🔵 **fable R3-F1(must-fix)。為什麼一句「DB 會擋」不夠:**
// ```
// migration 把 reason_code 從 regex 收成九個列舉，我當時寫的理由是「兩層漂開時 DB 會擋」
// ⇒ 而【被擋】的後果,在這條鏈上是這樣的：
//      TS 加了第十個 reason ⇒ RPC 被 CHECK 擋 ⇒ 回 { error }
//      ⇒ callback-event 是 fail-open ⇒ 吞掉、一句 console（保存 1 小時）
//      ⇒ ⇒ 🔴 那個 reason 的事件【從此零列】，而三綠全綠、登入正常。
//         🔵 codex R5:那是【補這支守門之前】的世界 —— 現在下面那格會紅,所以它不再成立。
//            留著描述是刻意的:它說明這支檔為什麼存在,而不是描述今天的現況。
// ⇒ ⇒ 📌 R1-9 把漂移的後果從「照樣記錄」變成【安靜全滅】——
//        它讓事情更嚴格，也讓失敗更安靜。**嚴格與可見不是同一件事。**
// ```
// ⇒ 所以那個「會擋」要在**寫碼的時候**擋,不是在正式庫的半夜擋。
//   本測試直接讀 migration 的字面,兩邊排序後必須相同。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { LineCallbackReason } from './callback-event';

/**
 * 🔴 TS 這一側必須手寫一次(型別在執行期不存在)。而它**不是**第三份清單 —— 兩道檢查夾住它:
 *
 * 🔵 **codex R5:~~原句「下面那個 `satisfies` 讓…少一個、多一個、拼錯一個字都會紅」~~ —— 寫大了。**
 *    `satisfies readonly LineCallbackReason[]` 只擋得住**多的與拼錯的**(不在 union 裡就紅);
 *    **少一個它不會紅** —— 子集合對它是合法的。
 *    ⇒ 少的那一半是下面 `AssertNever` 抓的(實測:拿掉 `state_mismatch` ⇒ `error TS2344`)。
 *    ⇒ 📌 兩道檢查各擋一個方向,而**把它們講成一道,就會有人以為拿掉一道還安全**。
 */
const TS_REASONS = [
  'missing_code',
  'missing_state_param',
  'missing_state_cookie',
  'missing_nonce_cookie',
  'state_mismatch',
  'invalid_sub',
  'collision_not_line',
  'session_verify_failed',
  'upstream_error',
] as const satisfies readonly LineCallbackReason[];

// 🔵🔵 **codex R4(must-fix):反向窮舉原本是【假的】。**
//    ~~`type Missing = Exclude<…>; const _exhaustive: Missing[] = [];`~~
//    ⇒ `Missing` 就算非空,**空陣列字面對任何陣列型別都合法** ⇒ 那一行**永遠編得過**
//    ⇒ TS 加第十個 reason 而漏改 `TS_REASONS` ⇒ typecheck 綠、regex 九碼對九碼也綠
//    ⇒ 📌 **兩把尺都綠,而正式庫靜默拒寫那第十個。**
//    ⇒ 改成真的會紅的形狀:`Exclude<…>` 非空時,它就不滿足 `extends never`,**當場 typecheck 紅**。
type AssertNever<T extends never> = T;
type _NoMissingReason = AssertNever<Exclude<LineCallbackReason, (typeof TS_REASONS)[number]>>;

const MIGRATION = join(
  __dirname,
  '../../../../../supabase/migrations/20260830130000_m4b_395_auth_callback_events.sql',
);

describe('reason_code:TS 與 SQL 逐字交叉核', () => {
  it('migration 檔讀得到(不然下面每一格都會是恆綠的)', () => {
    expect(readFileSync(MIGRATION, 'utf8').length).toBeGreaterThan(1000);
  });

  it('🔴 SQL 的 CHECK 列舉與 TS 的封閉集完全相同', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // 取 `reason_code text NULL CHECK (reason_code IN ( … ))` 那一段裡的字串常數。
    const block = sql.match(/reason_code\s+text\s+NULL\s+CHECK\s*\(reason_code IN \(([\s\S]*?)\)\)/);
    expect(block, 'migration 裡找不到 reason_code 的 CHECK 列舉 —— 形狀改了就要改這支測試').not.toBeNull();
    const sqlReasons = [...(block?.[1] ?? '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

    // 🔴 先證明這把尺抓得到東西:抓到 0 個的話下面的比對會是「兩個空集合相等」= 恆綠。
    expect(sqlReasons.length).toBe(TS_REASONS.length);
    expect([...sqlReasons].sort()).toEqual([...TS_REASONS].sort());
  });

  it('負對照:一個現造的碼不在任何一側(尺不是「什麼都說相同」)', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).not.toContain('zzz_not_a_real_reason_395');
    expect(TS_REASONS as readonly string[]).not.toContain('zzz_not_a_real_reason_395');
  });
});
