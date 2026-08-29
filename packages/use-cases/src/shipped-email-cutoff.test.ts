import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveShippedEmailCutoff } from './shipped-email-cutoff';

describe('SHIPPED_EMAIL_CUTOFF 解析(Sean 2026-08-30「今天開始後才寄」+「甲 台北時間 +08:00」)', () => {
  it('🛑 沒設值 ⇒ not-configured(**不是**「用一個預設起點」)—— 那一讀會把所有歷史箱子一次寄出', () => {
    for (const v of [undefined, null, '', '   ']) {
      expect(resolveShippedEmailCutoff(v)).toEqual({ kind: 'not-configured' });
    }
  });

  it('🛑 裸日期 ⇒ bad-format(**拒收, 不幫他補 +08:00**)—— 補上去會讓設錯的值看起來設對了', () => {
    const r = resolveShippedEmailCutoff('2026-09-01');
    expect(r.kind).toBe('bad-format');
    if (r.kind === 'bad-format') expect(r.why).toContain('永遠不寄');
  });

  it('🛑 有時刻而沒有時區 ⇒ 一樣 bad-format(這一種最容易被當成「已經很精確了」)', () => {
    expect(resolveShippedEmailCutoff('2026-09-01T21:30:00').kind).toBe('bad-format');
  });

  /**
   * 🔴 code-reviewer 2026-08-30 must-fix 1/3 的證人:
   *    前一版的 regex **只錨結尾** ⇒ `2026-09-01Z` 通得過
   *    ⇒ 而那正是這支檔宣稱要擋的那一種輸入(UTC 午夜 = 台北 08:00
   *      ⇒ 台北當天 08:00 前出的箱子永遠不寄, 靜默)。
   *    📌 **它不是漏了一個邊界, 是那支檔宣稱擋住的那一種輸入自己走得過去。**
   */
  it('🔴 裸日期 + Z(`2026-09-01Z`)⇒ 必須 bad-format —— 只錨結尾的 regex 會放它過', () => {
    expect(resolveShippedEmailCutoff('2026-09-01Z').kind).toBe('bad-format');
  });

  /**
   * 🔴 must-fix 3/3 的證人:型別上不給「沒設值 ⇒ 預設起點」那條路,
   *    **而那只擋住了【沒設值】那一條** —— 設值那條路上一個打錯年份的 env
   *    就把全部歷史箱子一次寄出, 而三態不會叫。
   */
  it('🔴 epoch(`1970-01-01T00:00:00Z`)⇒ 必須 bad-format —— 最貴的失敗模式在【值】上也要擋', () => {
    const r = resolveShippedEmailCutoff('1970-01-01T00:00:00Z');
    expect(r.kind).toBe('bad-format');
    if (r.kind === 'bad-format') expect(r.why).toContain('全部歷史箱子');
  });

  /**
   * 🔴 must-fix 2/3 的證人:V8 與 Postgres 是**兩個 parser、兩個裁決** ——
   *    V8 對 2 月 30 日判 ok 並**靜默滾成 3/1**, 而 PG 的 timestamptz 直接 throw。
   */
  it('🔴 2 月 30 日(帶 Z)⇒ 必須 bad-format —— V8 會靜默把它滾到下個月, 而 Postgres 會炸', () => {
    expect(resolveShippedEmailCutoff('2026-02-30T00:00:00Z').kind).toBe('bad-format');
  });

  it('✅ 帶 +08:00 ⇒ ok, 而 `iso` 是**正規化後的 UTC**(交出去的是一個沒有歧義的時刻, 不是使用者打的字)', () => {
    expect(resolveShippedEmailCutoff('  2026-09-01T21:30:00+08:00  ')).toEqual({
      kind: 'ok',
      iso: '2026-09-01T13:30:00.000Z',
    });
  });

  it('✅ 帶 Z 也算(它與 +08:00 一樣是【明確的】偏移;被擋的只有「沒說是哪個時區」那一種)', () => {
    expect(resolveShippedEmailCutoff('2026-09-01T13:30:00Z').kind).toBe('ok');
  });

  /**
   * 🔴 code-reviewer nit 8:前一版**只量了 ok 那一支的回傳鍵** ——
   *    另外兩支哪天多帶一個 `iso` 出來, 沒有東西會紅。
   */
  it('三態的回傳鍵各自釘住(多帶一個欄要會紅, 不只 ok 那一支)', () => {
    expect(Object.keys(resolveShippedEmailCutoff(undefined)).sort()).toEqual(['kind']);
    expect(Object.keys(resolveShippedEmailCutoff('2026-09-01')).sort()).toEqual(['kind', 'why']);
    expect(Object.keys(resolveShippedEmailCutoff('2026-09-01T21:30:00+08:00')).sort()).toEqual(['iso', 'kind']);
  });

  /**
   * 🔴 code-reviewer nit 5 換來的:檔頭寫著「**本檔不掛任何 route、不寄任何東西**」,
   *    而**那句話今天零機械在守** —— 加一行 import 就變假, 而沒有訊號。
   *    ✅ 做法抄同目錄既有先例(`create-order-tier-tripwire.test.ts`:讀原始碼當守門)。
   *    📌 前一版這一格是 `Object.keys(...)`, 而它的**名字**宣稱「不掛 route」——
   *      `Object.keys` 量不到那件事 ⇒ **標題比判別句寬**(而它同時被上面那格涵蓋 ⇒ 零獨立判別力)。
   */
  it('🛑 本檔【零 import】—— 它碰不到 outbox / Resend / 任何 I/O(讀原始碼量, 不是宣稱)', () => {
    const src = readFileSync(new URL('./shipped-email-cutoff.ts', import.meta.url), 'utf8');
    const imports = src.split('\n').filter((l) => /^\s*import\s/.test(l));
    expect(imports).toEqual([]);
    // 正對照:這把尺量得到東西 —— 本測試檔自己就有 import
    const self = readFileSync(new URL('./shipped-email-cutoff.test.ts', import.meta.url), 'utf8');
    expect(self.split('\n').filter((l) => /^\s*import\s/.test(l)).length).toBeGreaterThan(0);
  });

  /**
   * 📌 **這一格是【文件格】,不是判別格**(code-reviewer nit 6 明說:7 個突變沒有一個打到它)。
   *    它留著的理由只有一個:**把那兩讀寫在會出現在失敗輸出上的地方**。
   *    ⚠️ 不得把它算進「兩讀有被測到」—— **哪一刻才對, 這支函式判不了**(見下)。
   */
  it('📄 文件格(非判別):起始線 = 【這一片上線的那一刻】(他選的選項逐字「從你設定的那一刻起」), **不是**「2026-08-30 零時起」', () => {
    // 兩個在【形狀上】都合法 ⇒ 本函式都回 ok
    expect(resolveShippedEmailCutoff('2026-09-01T21:30:00+08:00').kind).toBe('ok');
    expect(resolveShippedEmailCutoff('2026-08-30T00:00:00+08:00').kind).toBe('ok');
    // 🛑 誠實的射程宣告:**形狀對不代表【那個時刻】對**,
    //    而「該填哪一刻」只有設值的人知道 ⇒ 那條規矩住在檔頭與 3b 的驗收條裡, 不在這支函式裡。
  });
});
