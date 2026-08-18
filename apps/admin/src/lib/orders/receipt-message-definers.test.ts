// receipt-message-definers.test.ts — `#451` P4A03 訊息的**回指補上 SQL 那一側**(M-4b / G2 / 2026-08-18)。
//
// 🔴 **這一格守的是什麼**:`admin_delete_item_receipt` 的 P4A03 業務拒絕訊息,在 TS 側有**手抄副本**當
//    fixture。`#451` 的病:提醒句只寫在 TS 側(`receipt-repository.ts:208-224`),而**改那段訊息的人
//    站在 SQL 側,他看不到那句話**。已 apply 的 migration 是凍結檔(`APPLIED.tsv` 釘 sha256、連註解都
//    不能動)⇒ 回指放不進去。本格把那個回指做成**機械的**:repo 裡一出現第二支重新定義這支函式的
//    migration,這格就紅,而紅的訊息會把他帶回本檔的登記表、並列出要回去對的那三個檔名。
//
// 🔴 **它【不】宣稱什麼(寫在旁邊,否則下一個人會多讀出東西)**:
//    ① **不宣稱「這份就是正式庫現在跑的那份」** —— `supabase/migrations/` 是【歷史】不是【現況】
//       (同 `subtotal-writers-allowlist.test.ts:11-14` 已立過的那條)。本格只回答
//       「**repo 裡多了一個會重新定義這支函式的檔嗎**」,不回答線上現在是哪一版。
//    ② **不做自動同步** —— fixture 仍是手抄的。`receipt-repository.test.ts:261` 逐字寫過為什麼:
//       「自動抓字串會讓『訊息被改壞』也一起同步過來、守門變恆真」。本格**一個字都不從 SQL 抄**,
//       它只數「有幾支檔在定義它」。
//    ③ **改名重寫繞得過** —— 若有人用**另一個函式名**重寫這條路徑,本格不會紅。
//       接住那種情況的是 TS 這側:呼叫端 `receipt-repository.ts` 也得跟著改,而 fixture 就在它旁邊。
//    ④ **正規式不是 SQL parser** —— 註解裡若出現 `CREATE FUNCTION …admin_delete_item_receipt`
//       會誤報。誤報=紅=有人來看,方向是安全的那一邊。
//    ⑤ 🔴 **識別字的其他合法寫法沒有窮舉。** 分三堆寫,免得下一個人去補一個已經不需要補的洞
//       (2026-08-18 R2 逐一實測):
//       **已收(會命中)**:關鍵字大小寫任意 / `"admin_delete_item_receipt"`(省 schema 加引號)/
//         `"public"."admin_delete_item_receipt"` / `FUNCTION` 之後換行。
//       **繞得過,而刻意留在限度段**:`public . admin_…`(點兩側空白)、`public.` 之後換行。
//         兩者都是合法 SQL 而**沒有人會這樣打**(repo 內零先例)⇒ 進 pattern 換來的複雜度大於價值。
//       **其餘沒有窮舉。** 這是「已知未窮舉」,不是「已窮舉」。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../supabase/migrations',
);

/**
 * 「重新定義這支函式」的寫法。三個刻意的設計:
 * ① `i` flag —— **SQL 關鍵字大小寫不敏感**。本 repo 現況全大寫,但下一個人打小寫
 *    `create or replace function …` 就會**靜默繞過**(2026-08-18 R1 實測:無 `i` ⇒ `false`)。
 * ② `"?` 容忍引號識別字 —— `public."admin_delete_item_receipt"` 是合法 SQL 且**本 repo 有前例**:
 *    `20260812130000_m4b_347_fuzzy_admin_search_orders.sql:606` 的掃描器自己就把它列進已知繞法。
 * ③ 刻意**不收** `DROP FUNCTION` —— `20260810233000:595` 的 rollback 註解裡就有一行 DROP,
 *    收了它會讓本格從第一天就誤報。而真的要換掉函式本體,DROP 之後仍必須有一支 CREATE。
 * 📌 加上 ①② 之後對 183 支 `.sql` 重跑,命中數仍是 **1**(沒有換來誤報)。
 */
const DEFINER_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?admin_delete_item_receipt"?\b/i;

/**
 * 目前定義這支函式的 migration(**登記制**)。
 *
 * 🔴 多一支沒登記的 ⇒ 本格紅 ⇒ **在把它加進這張表之前**,先去對這三份手抄副本:
 *    · `receipt-repository.test.ts:263` 的 `P4A03_MESSAGE` —— 完整版
 *    · `components/orders/receipt-undo-bar.test.tsx:38` 的 `P4A03_MESSAGE` —— 完整版
 *    · `receipt-actions.test.ts:495` 的 `msg` —— **節略版**(頭尾用 `…` 略過,但包裹清單逐字保留)
 *    ⚠️ 重現指令(**要限定副檔名**,否則 `.next` 產物與本檔自己的註解都會混進來):
 *      `grep -rn '刪不掉這筆到貨紀錄' --include='*.test.ts' --include='*.test.tsx' apps/`
 * 🔴 **把不想處理的檔直接丟進這張表 = 自己把判別力關掉。** 審查時盯這裡。
 */
const DEFINERS = ['20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql'] as const;

function scanDefiners(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => DEFINER_RE.test(readFileSync(join(dir, f), 'utf8')))
    .sort();
}

describe('#451 · P4A03 訊息的 SQL 側回指 —— 多一支重新定義的 migration 就紅', () => {
  it('掃描本身是活的(分母非 0,且正向對照命中那支已知的)', () => {
    // 🔴 先證量具在讀東西 —— 「零命中」與「掃錯目錄」在畫面上一模一樣。
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length).toBeGreaterThan(100);
    expect(scanDefiners(MIGRATIONS_DIR)).toContain(DEFINERS[0]);
  });

  it('🔴 掃出來的定義者恰好等於登記表(多一支 ⇒ 回去對那三份 fixture)', () => {
    // 🔴 這是承重的那一格。**紅訊息要自己講完該做什麼** —— 讀到紅的人不一定會往上捲看註解。
    //    刻意**只列檔名、不列行號**:再造三個會漂的指標,正是本片在治的那個病。
    expect(
      scanDefiners(MIGRATIONS_DIR),
      [
        '多了一支重新定義 admin_delete_item_receipt 的 migration。',
        '把它加進 DEFINERS 之前,先開這三個檔對 P4A03 訊息的手抄副本:',
        '  receipt-repository.test.ts(完整版)',
        '  components/orders/receipt-undo-bar.test.tsx(完整版)',
        '  receipt-actions.test.ts(節略版,包裹清單逐字保留)',
        '⚠️ 直接把新檔丟進 DEFINERS = 自己把這一格的判別力關掉。',
      ].join('\n'),
    ).toEqual([...DEFINERS].sort());
  });

  it('pattern 有判別力:兩個世界印不同的東西', () => {
    // 負向對照:只「提到」函式名的檔(註解 / COMMENT ON / GRANT / 近名函式)一律不該命中。
    expect(DEFINER_RE.test('-- DROP FUNCTION public.admin_delete_item_receipt(uuid,text,text);')).toBe(false);
    expect(DEFINER_RE.test("COMMENT ON FUNCTION public.admin_delete_item_receipt(uuid,text,text) IS 'x';")).toBe(false);
    expect(DEFINER_RE.test('GRANT EXECUTE ON FUNCTION public.admin_delete_item_receipt(uuid,text,text) TO r;')).toBe(false);
    expect(DEFINER_RE.test('CREATE FUNCTION public.admin_delete_item_receipt_v2(p uuid)')).toBe(false);
    // 正向對照:證明上面那四個 false 是「沒有定義」而不是 pattern 壞掉。
    expect(DEFINER_RE.test('CREATE FUNCTION public.admin_delete_item_receipt(p uuid)')).toBe(true);
    expect(DEFINER_RE.test('CREATE OR REPLACE FUNCTION admin_delete_item_receipt(p uuid)')).toBe(true);
  });

  it('🔴 兩條【實測繞得過】的寫法都要命中(R1 抓的 must-fix 3/4)', () => {
    // 這兩條在加 `i` 與 `"?` 之前實測都是 false ⇒ 會靜默失效。
    expect(
      DEFINER_RE.test('create or replace function public.admin_delete_item_receipt(p uuid)'),
      '小寫關鍵字繞過 ⇒ SQL 大小寫不敏感,守門卻敏感',
    ).toBe(true);
    expect(
      DEFINER_RE.test('CREATE OR REPLACE FUNCTION public."admin_delete_item_receipt"(p uuid)'),
      '引號識別字繞過 ⇒ 本 repo 已有前例把它列為已知繞法',
    ).toBe(true);
  });
});
