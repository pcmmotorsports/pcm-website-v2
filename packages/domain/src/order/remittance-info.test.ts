import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PCM_REMITTANCE_ACCOUNT_NAME,
  PCM_REMITTANCE_ACCOUNT_NO,
  PCM_REMITTANCE_BANK_NAME,
  PCM_REMITTANCE_BRANCH,
  PCM_REMITTANCE_EXPIRE_DAYS,
  PCM_REMITTANCE_MEMO_INSTRUCTION,
} from './remittance-info';

/**
 * 🔴 **本檔存在的理由**:那個「5 天」有兩個消費者, 而它們在**兩種語言**裡
 * (SQL 的 `interval '5 days'` 真正在執行 · TS 的常數印給客人看)。
 * ⇒ 「只寫一次」物理上做不到 ⇒ ✅ **而做得到的是讓它們分岔的那一刻有東西會紅。**
 */
const MIGRATION = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260903080000_m4b_expire_unpaid_by_payment_channel.sql',
);

describe('匯款收款資訊 · 字面守門', () => {
  it('🔴 那串帳號是 12 碼純數字(Sean 2026-09-03 逐字確認的那一串)', () => {
    // 🛑 這一格不是形式:它是「印錯 = 客人把錢匯到別的地方」那個代價的最後一道機械檢查。
    expect(PCM_REMITTANCE_ACCOUNT_NO).toMatch(/^\d{12}$/);
    expect(PCM_REMITTANCE_ACCOUNT_NO).toBe('200540278354');
  });

  it('🔵 四樣字面都已 trim(他貼的原字面帶前後空白)', () => {
    for (const s of [
      PCM_REMITTANCE_BANK_NAME,
      PCM_REMITTANCE_BRANCH,
      PCM_REMITTANCE_ACCOUNT_NAME,
      PCM_REMITTANCE_ACCOUNT_NO,
      PCM_REMITTANCE_MEMO_INSTRUCTION,
    ]) {
      expect(s).toBe(s.trim());
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('🔴🔴 TS 的天數與 migration 裡 SQL 的 interval 必須一致(兩種語言的單一來源守門)', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // 🔵 **先證這把尺接上了**:那支檔必須真的含那個 CASE, 否則下面的斷言在量一個空字串。
    expect(sql).toContain("WHEN 'bank_transfer' THEN interval '");
    expect(sql).toContain("WHEN 'cash'          THEN interval '");

    // 🔴 抓【SQL 實際寫的天數】—— 不是抓我期望的那個數字。
    const days = [...sql.matchAll(/WHEN '(?:bank_transfer|cash)'\s*THEN interval '(\d+) days'/g)].map(
      (m) => Number(m[1]),
    );
    // 🛑 兩支 WHEN 都要抓到 —— 只抓到一支的話, 另一支漂掉時這一格不會叫。
    expect(days).toHaveLength(2);
    for (const d of days) expect(d).toBe(PCM_REMITTANCE_EXPIRE_DAYS);
  });

  it('🔵 負對照:那把正規表示式抓得到【不同的】數字(否則上一格恆綠)', () => {
    // 🔴 少了這一格, 一個永遠回 [] 或永遠回 [5] 的抓法會讓上面那格一直綠。
    const fake = "WHEN 'bank_transfer' THEN interval '9 days'\nWHEN 'cash'          THEN interval '9 days'";
    const days = [...fake.matchAll(/WHEN '(?:bank_transfer|cash)'\s*THEN interval '(\d+) days'/g)].map(
      (m) => Number(m[1]),
    );
    expect(days).toEqual([9, 9]);
    expect(days[0]).not.toBe(PCM_REMITTANCE_EXPIRE_DAYS);
  });
});
