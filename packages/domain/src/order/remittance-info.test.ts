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
  //    ⛔ ~~cron:`o.created_at < now() - interval '5 days'`~~ **2026-09-06 起不是現況**
  //    ✅ 現行 cron 是**台北日界**:`date_trunc('day', created_at AT TIME ZONE 'Asia/Taipei')`
  //       `+ interval '5 days' + interval '1 day'`(`20260906600000_m4b_expire_day_boundary.sql`)
  //    ⇒ 到期那一天(客人看的)= **下單那個台北日曆日 + 5 天**, 而它整天有效。
  //    🔵 下面每一格的期望值在新舊兩種算法下**碰巧相同**(2026 年無 DST)——
  //       📌 那正是為什麼「期望值沒變」不能被讀成「這段說明還是對的」(codex R2 nit)。
  // 🔴🔴 **這一格是 codex R3 #7 逼出來的, 而它是本檔唯一一格【分得出兩種算法】的測試。**
  //    前面每一格的下單時間都在 2026 年 ⇒ 那一年台北沒有 DST
  //    ⇒ 📌 「絕對時間 +120 小時」與「台北日曆日 +5 天」**算出同一個答案**
  //      ⇒ 🛑 **把程式改回舊算法, 前面每一格照樣綠。**
  //    ✅ 台灣 1945-1961 實施過夏令時間, 1946-05-15 起 +9 ⇒ 下面這一發跨過那個轉換點:
  //      · 下單 1946-05-10T15:30Z = 台北 **05-10 23:30**(當時 +8)⇒ 日曆日 05-10 ⇒ +5 天 = **5 月 15 日**
  //      · 舊算法 = 絕對時間 +120h = 1946-05-15T15:30Z = 台北 05-16 00:30(已 +9)⇒ 會答 **5 月 16 日**
  //    🔴 而 SQL 那一半算的是 `date_trunc('day', created_at AT TIME ZONE 'Asia/Taipei') + 5 days`
  //      ⇒ **05-15**, 05-16 00:00 就取消 ⇒ 📌 舊算法會叫客人在一個**已經過期**的日子匯款。
  it('🔴 跨 DST 轉換:日曆加法 = 5 月 15 日(舊的 +120h 算法會答 5 月 16 日)', () => {
    expect(remittanceDeadlineLabel('1946-05-10T15:30:00Z')).toBe('5 月 15 日');
  });

  it('🔵 負對照:同一支對【沒有跨轉換點】的鄰居仍答 +5 天那一天', () => {
    // 少了這一格, 一支「對 1946 恆回 5 月 15 日」的壞實作也會讓上面那格綠。
    expect(remittanceDeadlineLabel('1946-05-16T15:30:00Z')).toBe('5 月 22 日');
  });

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

// 🔴🔴 **2026-09-06 日界那一代 `20260906600000`(⟦b4-EXPIREDAYBOUND⟧)。**
//    上面兩個 describe 盯的是 `20260903080000` 與 `20260904230000` **兩支舊檔** ——
//    🛑 而日界住在**第三支**裡 ⇒ 有人把它改掉, 上面每一格照樣綠, **零訊號**。
//    ⇒ ✅ 所以這一段不是重複, 它盯的是**別的東西**:那三個零件與 tappay 的豁免。
const MIGRATION_DAYBOUND = path.resolve(
  __dirname,
  '../../../../supabase/migrations/20260906600000_m4b_expire_day_boundary.sql',
);

/**
 * 🔴🔴 **剝掉 `--` 註解再斷言 —— codex R1 #7 打回了第一版。**
 *   第一版直接讀整份 SQL ⇒ 📌 **把正確那一行【註解掉】、實際改用 `date_trunc('minute')`,
 *   正向 token 仍然全部命中** ⇒ 整組假綠。
 *   ⇒ ✅ 這一支只留「會被執行的那一半」。
 * ⚠️ **射程(codex R2 #7 訂正第二版的宣稱)**:它剝的是 `--` 到行尾,
 *   **不剝區塊註解**, 也**會誤剝字串常值裡的 `--`**。
 *   ⛔ ~~第二版寫「下面第一格會證『沒有含 `--` 的字串常值』」~~ **那是假的** ——
 *     第一格只證了「剝完沒有區塊註解」, **沒有**守住字串常值那一半。
 *   ⇒ 🔴 **字串常值那一半, 這支測試守不到, 而它【有人守】**:
 *     migration 自己的前置閘與事後⑨ 錨的是**原始 `prosrc` 的 md5**
 *     (`b91dc977…` / `7e1e6764…`)—— 那把尺一個位元都不放過, 不經過任何剝法。
 *   ⇒ 📌 所以這支測試的職責是「**檔案裡寫了什麼**」, 不是「**正式庫跑的是什麼**」。
 */
function sqlWithoutComments(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('🔴 日界那一代(20260906600000)—— Sean 2026-09-06 逐字「乙」', () => {
  it('🔵 先證這把尺接上了:剝註解之後檔案還在, 而註解真的被剝掉了', () => {
    const raw = readFileSync(MIGRATION_DAYBOUND, 'utf8');
    const bare = sqlWithoutComments(MIGRATION_DAYBOUND);
    // 正對照:碼還在(剝完不是空的)
    expect(bare).toContain('CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders');
    // 負對照:一段只出現在註解裡的字, 剝完必須不見
    expect(raw).toContain('Sean 2026-09-03 逐字');
    expect(bare).not.toContain('Sean 2026-09-03 逐字');
    // 射程前提:**剝完之後**不得再出現 `/*` —— 有的話就代表檔裡有區塊註解沒被處理到,
    // 上面那句「只留會被執行的那一半」就不成立。
    // 🔵 用 `bare` 不用 `raw`:`raw` 裡的 `/*` 可能只是**寫在 `--` 註解裡的一段文字**
    //    (本檔就有:③b 那段在解釋「這套正規化不剝 `/* */`」)⇒ 對 `raw` 問會誤紅。
    expect(bare).not.toContain('/*');
  });

  it('天數沒被日界改掉:仍逐字帶著 TS 常數那個天數', () => {
    const sql = sqlWithoutComments(MIGRATION_DAYBOUND);
    // 🔵 先證尺接上了:那個字面真的在(否則下一句是對空字串斷言)。
    expect(sql).toContain("WHEN 'bank_transfer' THEN interval '");
    expect(sql).toContain(`WHEN 'bank_transfer' THEN interval '${PCM_REMITTANCE_EXPIRE_DAYS} days'`);
    expect(sql).toContain(`WHEN 'cash'          THEN interval '${PCM_REMITTANCE_EXPIRE_DAYS} days'`);
  });

  it('🔴 日界的三個零件都在 —— 少任一個, 那一片就等於沒做', () => {
    const sql = sqlWithoutComments(MIGRATION_DAYBOUND);
    // 🛑 三個要一起在:時區 / 取日界 / 隔天。只有前兩個 = 第 5 天 00:00 就取消(比舊版更嚴)。
    expect(sql).toContain("pg_catalog.timezone('Asia/Taipei'");
    expect(sql).toContain("pg_catalog.date_trunc('day'");
    expect(sql).toContain("+ interval '1 day'");
  });

  it('🛑 tappay 仍走時戳比較 —— 它【沒有】被拉進日界(-f8 2026-09-06 裁甲)', () => {
    const sql = sqlWithoutComments(MIGRATION_DAYBOUND);
    expect(sql).toContain("WHEN 'tappay' THEN o.created_at < pg_catalog.now() - interval '1 day'");
  });

  it('🔵 負對照:換一個不等於常數的天數, 這三把尺都要找不到', () => {
    // 少了這一格, 一把「對任何內容都命中」的尺會讓上面三格恆綠。
    const sql = sqlWithoutComments(MIGRATION_DAYBOUND);
    expect(sql).not.toContain(
      `WHEN 'bank_transfer' THEN interval '${PCM_REMITTANCE_EXPIRE_DAYS + 1} days'`,
    );
    expect(sql).not.toContain("pg_catalog.timezone('Asia/Tokyo'");
    // 🔴 codex R1 #7:第一版漏了 `minute` —— 而那正是它構造出來的那一發突變。
    expect(sql).not.toContain("pg_catalog.date_trunc('hour'");
    expect(sql).not.toContain("pg_catalog.date_trunc('minute'");
    expect(sql).not.toContain("pg_catalog.date_trunc('week'");
  });
});
