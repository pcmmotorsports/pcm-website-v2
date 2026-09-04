import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `20260904050000` 的跨檔契約 —— 2026-09-05 補(板列 `⟦b4-PIECEBGATEGAPS⟧` 第 ⑤ 格)。
 *
 * 🔴 **而它比板上寫的大。** 板上寫「`updated_at` 有寫而沒有格子驗它」;當場量:
 * ```
 * grep -rl '20260904050000' --include='*.ts' apps packages scripts ⇒ **0 支**
 * 🟢 正對照:同一把尺找 20260903093000(已知有人讀)⇒ 2 支   ⇒ 尺會動
 * ```
 * ⇒ 🎯 **不是「那一項沒人驗」, 是【那支 migration 整支沒有任何測試在讀它】。**
 *    而它是「客人改用刷卡 ⇒ 取消那張匯款單」的核心, 含 Sean 2026-09-04 拍板的
 *    **「全部一起取消(沒有 LIMIT)」**(拍板檔第二十四題, 原話「甲 = 全部一起取消 (推薦, = 現在碼的行為)」)。
 *
 * 🛑 **本檔是【掃描型】測試** —— 它自己讀 `supabase/migrations/`, 不 import 被測的碼
 *    ⇒ `vitest related` 的分母裡結構上沒有它。動那支 migration 的人請跑
 *    `bash scripts/run-migration-scan-tests.sh`(正本:`docs/patterns/slice-checkpoint.md`)。
 */
const MIGRATION = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260904050000_m4b_supersede_bank_order_on_card.sql',
);

/**
 * 🔴 **剝註解的形狀【抄自 `cancel-email-gates-contract.test.ts`(origin/dev 版)】, 不重打一份判準。**
 *    先剝【區塊】再剝【行】—— 反過來會讓 `--` 吃掉區塊的結尾標記。
 *    病史:只剝 `--` 時, codex 交過一個可直接用的假綠字面 ——
 *    把真的閘整段包進 `/* … *\/` 裡, 測試照樣通過。
 *
 * 🛑 **而這把尺【還是】會壞**:`'--'` 或 `'/*'` 出現在 SQL【字串常值】裡時它會誤剝真碼。
 *    我不假裝修好了 —— 下面有一格把「今天剛好安全」釘住(同 `-auth` 的做法)。
 */
function codeOnly(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** 那段 supersede 的 UPDATE(從 `SET cancelled_reason = 'superseded_by_card'` 往後到分號)。 */
function supersedeStatement(code: string): string | null {
  const i = code.indexOf("'superseded_by_card'");
  if (i < 0) return null;
  const start = code.lastIndexOf('UPDATE', i);
  const end = code.indexOf(';', i);
  if (start < 0 || end < 0) return null;
  return code.slice(start, end);
}

describe('20260904050000 supersede 匯款單 · 跨檔契約(⟦b4-PIECEBGATEGAPS⟧ ⑤)', () => {
  it('🔵 前提:尺接上了(檔讀得到、剝完不是空的、抓得到那段 UPDATE)', () => {
    // 🔴 沒有這一格, 下面每一格都可能在量一個空字串而全綠。
    const code = codeOnly(readFileSync(MIGRATION, 'utf8'));
    expect(code.length).toBeGreaterThan(1000);
    expect(supersedeStatement(code)).not.toBeNull();
  });

  it('🔴 ⑤ `updated_at` 必須被寫 —— 少了它, 同步與稽核時間停在舊值', () => {
    // 板列點名的那一格。逾期那支(同檔 :186)同一行也寫它 ⇒ 這裡少寫就是兩支不一致。
    const stmt = supersedeStatement(codeOnly(readFileSync(MIGRATION, 'utf8')))!;
    expect(stmt).toMatch(/updated_at\s*=\s*pg_catalog\.now\(\)/);
  });

  it('🔴 Sean 拍板的「全部一起取消」還在 —— 那一段【不得】有 LIMIT', () => {
    // 拍板檔第二十四題甲。⇒ 格守的是【被批准的行為】, 不是「只鎖住現狀」。
    // 🛑 有人若哪天加上 LIMIT 1, 行為會變回單數, 而那需要【新的授權】。
    const stmt = supersedeStatement(codeOnly(readFileSync(MIGRATION, 'utf8')))!;
    expect(stmt).not.toMatch(/\bLIMIT\b/i);
  });

  it('🔴 四個收窄條件缺一不可 —— 少任一個都會多取消別人的單', () => {
    const stmt = supersedeStatement(codeOnly(readFileSync(MIGRATION, 'utf8')))!;
    // 逐字取自 20260904050000:207-212(抓 SQL 實際寫的, 不是抓我期望的)
    expect(stmt).toContain('o.customer_user_id = v_order.customer_user_id');
    expect(stmt).toContain('o.cart_session_id  = v_order.cart_session_id');
    expect(stmt).toContain('o.id              <> p_order_id');
    expect(stmt).toContain('o.cancelled_at IS NULL');
    expect(stmt).toContain("o.payment_channel  = 'bank_transfer'");
    expect(stmt).toContain("o.payment_status   = 'unpaid'::public.payment_status");
  });

  it('🔴 `cancelled_reason` 是那個具名值 —— 而不是被換成別的字面', () => {
    const stmt = supersedeStatement(codeOnly(readFileSync(MIGRATION, 'utf8')))!;
    expect(stmt).toContain("cancelled_reason = 'superseded_by_card'");
  });

  it('🔵 pattern 有判別力:把 `updated_at` 那一行剝掉 ⇒ 上面那一格必須翻面', () => {
    // 🔴 沒有這一格,「⑤ 那格是綠的」與「那格根本量不到東西」印同一個綠。
    const raw = readFileSync(MIGRATION, 'utf8');
    const mutated = raw.replace(/\n\s*updated_at\s*=\s*pg_catalog\.now\(\)/, '');
    expect(mutated).not.toBe(raw); // 突變真的套上了
    const stmt = supersedeStatement(codeOnly(mutated))!;
    expect(stmt).not.toMatch(/updated_at\s*=\s*pg_catalog\.now\(\)/);
  });

  it('🔵 pattern 有判別力:塞一個 LIMIT 進去 ⇒ 「不得有 LIMIT」那格必須翻面', () => {
    const raw = readFileSync(MIGRATION, 'utf8');
    const mutated = raw.replace("cancelled_reason = 'superseded_by_card'",
      "cancelled_reason = 'superseded_by_card' /*LIMIT 1*/").replace(
      'AND NOT EXISTS (', 'AND o.id IN (SELECT id FROM public.orders LIMIT 1) AND NOT EXISTS (');
    expect(mutated).not.toBe(raw);
    const stmt = supersedeStatement(codeOnly(mutated))!;
    expect(stmt).toMatch(/\bLIMIT\b/i);
  });

  it('🔴 剝【區塊】註解那一步真的在做事 —— 把條件整段包進 /* */ ⇒ 必須抓不到', () => {
    // 病史:只剝 `--` 時, 有人可以把真的閘包進區塊註解裡而測試照樣綠。
    const fake = "UPDATE public.orders o SET cancelled_reason = 'superseded_by_card'\n"
      + "/* AND o.cancelled_at IS NULL */ WHERE 1=1;";
    const stmt = supersedeStatement(codeOnly(fake))!;
    expect(stmt).not.toContain('o.cancelled_at IS NULL');
  });

  it('🛑 把「今天剛好安全」釘住:那支 migration 的【字串常值】裡沒有 `--` 也沒有 `/*`', () => {
    // 🔴 這把尺對【字串常值裡的註解符號】會誤剝真碼, 而我沒有修它(要修得寫個小 tokenizer, 那是另一片)。
    //    ⇒ 改成釘住現況:哪天那種字面出現了, 這一格會紅, 而不是安靜地誤剝。
    const raw = readFileSync(MIGRATION, 'utf8');
    const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    const literals = [...noComments.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
    expect(literals.length).toBeGreaterThan(5); // 🟢 正對照:真的抓到一批字串常值
    expect(literals.filter((s) => s.includes('--') || s.includes('/*'))).toEqual([]);
  });
});
