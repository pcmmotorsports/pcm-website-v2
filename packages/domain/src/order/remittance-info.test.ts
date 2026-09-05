import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  remittanceDeadlineLabel,
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
// 🔴🔴 **這一支盯的是【第一代】, 而現行那一代是 `20260904230000`。**
//    (2026-09-05 做「期限改寫日期」時撞到:我要找起算點, 而板上指的是第一代。)
//    🛑 **只盯第一代的後果**:有人在**新那一代**把 5 天改掉 ⇒ 這道閘**照樣綠**
//       ⇒ 而客人畫面上那個日期會與 cron 實際掃到的時刻分岔, **零訊號**。
//    ⇒ ✅ 兩代**都盯**。而不是把舊那支換掉 —— 舊那支仍在 repo 裡, 換掉等於放掉它。
const MIGRATION_CURRENT = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260904230000_m4b_noncardpaid_settle_and_expire_leg.sql',
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

describe('remittanceDeadlineLabel —— 匯款期限那一天(Sean 2026-09-05 第 3 題拍甲)', () => {
  // 🔴🔴 **期望值一律從 cron 的算式推, 不從我寫的那行碼推。**
  //    cron:`o.created_at < now() - interval '5 days'`(`20260904230000:451-455`)
  //    ⇒ 到期那一天 = 下單日 + 5 天。時區用 `Asia/Taipei`(客人看的日曆日)。
  it('台北時間中午下單 ⇒ 5 天後那一天', () => {
    // 2026-09-05 12:00 台北 = 2026-09-05T04:00Z ⇒ +5 天 = 2026-09-10
    expect(remittanceDeadlineLabel('2026-09-05T04:00:00Z')).toBe('9 月 10 日');
  });

  it('🔴 跨月:月底下單要滾到下個月', () => {
    // 2026-09-28 12:00 台北 ⇒ +5 天 = 2026-10-03
    expect(remittanceDeadlineLabel('2026-09-28T04:00:00Z')).toBe('10 月 3 日');
  });

  it('🔴 跨年:12/30 下單 ⇒ 隔年 1 月', () => {
    expect(remittanceDeadlineLabel('2026-12-30T04:00:00Z')).toBe('1 月 4 日');
  });

  it('🔴🔴 時區邊界:UTC 深夜下單, 台北已是隔天 ⇒ 用【台北的日曆日】算', () => {
    // 2026-09-05T17:00Z = 台北 2026-09-06 01:00 ⇒ +5 天 ⇒ 台北 2026-09-11
    // 🛑 若誤用 UTC 日曆日會算成 9/10 —— **早一天, 而那是對客人不利的方向。**
    expect(remittanceDeadlineLabel('2026-09-05T17:00:00Z')).toBe('9 月 11 日');
  });

  it.each([
    ['空字串', ''],
    ['不是日期', 'not-a-date'],
    // ⛔ ~~['半截', '2026-09']~~ —— 🔴 **`Date.parse('2026-09')` 是【合法的】**(= 2026-09-01T00:00Z),
    //    實測回 `'9 月 6 日'` 而不是 null ⇒ **那不是壞輸入, 是我以為它壞。**
    //    📌 一個「看起來明顯不合法」的字串, 在 JS 的日期解析裡完全合法。
    ['只有年份也是合法的所以改用真的壞字串', '2026-13-45T99:99:99Z'],
    ['亂碼', 'ㄅㄆㄇ'],
  ])('🔴 算不出來就回 null(%s)—— 算錯的日期比不算糟', (_n, v) => {
    // 🛑 呼叫端拿到 null 會退回「N 天內」那句, **不會印一個猜的日期**。
    expect(remittanceDeadlineLabel(v)).toBeNull();
  });

  it('🔵 負對照:一個【合法】的時間不得回 null', () => {
    // 少了這一格,一個「永遠回 null」的實作會讓上面三格全綠。
    expect(remittanceDeadlineLabel('2026-09-05T04:00:00Z')).not.toBeNull();
  });
});

describe('🔴 現行那一代的 interval 也要盯(不是只盯第一代)', () => {
  it('`20260904230000` 裡 bank_transfer 的 interval 與 TS 常數一致', () => {
    const sql = readFileSync(MIGRATION_CURRENT, 'utf8');
    // 🔵 先證明尺會動:那個字面真的在(不然下一句的 toContain 是對一個空字串斷言)。
    expect(sql).toContain("WHEN 'bank_transfer' THEN interval '");
    expect(sql).toContain(`WHEN 'bank_transfer' THEN interval '${PCM_REMITTANCE_EXPIRE_DAYS} days'`);
  });

  it('🔵 負對照:換一個不等於常數的天數, 這把尺要找不到', () => {
    // 少了這一格,一把「對任何天數都命中」的尺會讓上面那格恆綠。
    const sql = readFileSync(MIGRATION_CURRENT, 'utf8');
    expect(sql).not.toContain(
      `WHEN 'bank_transfer' THEN interval '${PCM_REMITTANCE_EXPIRE_DAYS + 1} days'`,
    );
  });
});
