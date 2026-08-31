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
  /**
   * 🔴🔴 **這一格原本是假綠**(codex 2026-08-30 R1 must-fix 4):
   *    原本餵的是 `2026-02-30T00:00:00Z` —— 它滾成 3/2,而 **3/2 早於硬下界 2026-08-30**
   *    ⇒ **把滾日檢查整段刪掉,它照樣被下界擋住、照樣紅** ⇒ 它證不到滾日檢查存在。
   *    ✅ 年份改成 2027 ⇒ 滾出來的日子晚於下界 ⇒ **只有滾日檢查擋得住它**。
   *
   * 🔴🔴 **而 `+08:00` 那一格是 must-fix 3 本人**:舊實作的滾日檢查
   *    **只對 `Z` 結尾生效**(理由是「帶偏移時跨日是正常的」——那句話對,
   *    而它讓整個檢查對帶偏移的值失效)⇒ `2027-02-30T00:00:00+08:00` **被判合法**
   *    ⇒ cutoff 錯位一天 ⇒ 那一天的箱子漏寄或誤寄,**而沒有任何一格會紅**。
   */
  it.each(['2027-02-30T00:00:00Z', '2027-02-30T00:00:00+08:00', '2027-04-31T12:00:00+08:00'])(
    '🔴 那一天不存在(%s)⇒ 必須 bad-format —— V8 會靜默把它滾到下個月, 而 Postgres 會炸',
    (bad) => {
      expect(resolveShippedEmailCutoff(bad).kind).toBe('bad-format');
    },
  );

  it('🔵 負對照:同月份**真的存在**的那一天 ⇒ ok(證上面那三格不是把整個 2 月都擋掉)', () => {
    expect(resolveShippedEmailCutoff('2027-02-28T00:00:00+08:00').kind).toBe('ok');
    expect(resolveShippedEmailCutoff('2028-02-29T00:00:00+08:00').kind).toBe('ok'); // 2028 是閏年
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

/**
 * 🔴🔴 **錯誤說明【自己】不可以是一個可以貼上去的答案**(Fable 2026-08-30 R3 must-fix 3)。
 *
 * 構造:設值那天打成裸日期 ⇒ 503 ⇒ 去看 log ⇒ **把說明裡那個範例逐字貼進 env**
 * ⇒ 格式過、下界也過 ⇒ **把那個日期之後每一箱沒排過的一次全部排進去**
 * ⇒ 客人收到講幾週前那批貨的信,而信收不回來。
 * 📌 **⇒ 一段用來幫助設定的說明,提供了一個【設錯而看起來設對】的完整答案。**
 *
 * 🔴 **這一格是自我指涉的,所以它不會過期**:它把 `why` 自己餵回這支函式,
 *    不是比對一個寫死的字串 —— 下一個人改了範例、而改成一個合法的值,這一格會紅。
 */
describe('🔴 bad-format 的 why 本身不得含有一個【貼上去就會生效】的值', () => {
  /** 從一段文字裡撈出所有「看起來像完整 ISO 時刻」的子字串。 */
  function isoLikeIn(text: string): string[] {
    return text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})/g) ?? [];
  }

  it('每一個 bad-format 的 why,撈出來的候選值餵回去都不可以是 ok', () => {
    const bads = ['2026-09-01', '2026-09-01T21:30:00', '2026-09-01T21:30:00+0800', '1970-01-01T00:00:00Z', '2027-02-30T00:00:00+08:00'];
    let checked = 0;
    for (const bad of bads) {
      const r = resolveShippedEmailCutoff(bad);
      expect(r.kind).toBe('bad-format');
      if (r.kind !== 'bad-format') continue;
      for (const candidate of isoLikeIn(r.why)) {
        checked += 1;
        // 🔴 說明裡若還留著一個合法值 ⇒ 這一行紅。
        expect(resolveShippedEmailCutoff(candidate).kind, `why 裡的「${candidate}」貼上去會生效`).not.toBe('ok');
      }
    }
    // 🔵 **正對照:那把撈值的尺是活的** —— 沒有這一行,「why 裡一個候選都沒撈到」
    //    與「撈到而且都不合法」會印同一個綠(而前者也可能是 regex 壞掉)。
    expect(isoLikeIn('請填 2026-09-01T21:30:00+08:00 這種'), '撈值的 regex 必須撈得到東西').toEqual([
      '2026-09-01T21:30:00+08:00',
    ]);
    // ⚠️ `checked` 允許是 0(今天就是 0:範例已改成佔位形狀)——
    //    它記在這裡是為了讓下一個人看得出「這一格今天檢查了幾個候選」。
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it('🔴 小數位收到 3 位 —— 多打的會被 toISOString 截掉,而截掉是靜默的', () => {
    /**
     * 🔴 **成因(codex 2026-08-31 R1 nit)**:`resolveShippedEmailCutoff` 回的是
     * `new Date(t).toISOString()`,**只保留毫秒**。舊 regex 收 `(\.\d+)?` 任意位數
     * ⇒ `.123999Z` 靜靜變成 `.123Z` ⇒ **恰落在那 999 微秒裡的 shipment 會被分到 cutoff 錯的一側**。
     * ⚠️ **今天踩不踩得到:未數。** 我沒有量過有沒有人會打次毫秒,也沒量過 `shipped_at` 有沒有次毫秒值。
     * ✅ 失敗方向安全:多打 ⇒ 拒收要人重打,而不是收下一個會被截掉的值。
     */
    // 🔵 正對照:恰好 3 位 ⇒ ok,而且【正規化後逐字相同】(證明 3 位不會被動到)
    const ok = resolveShippedEmailCutoff('2026-08-31T00:00:00.123Z');
    expect(ok.kind).toBe('ok');
    if (ok.kind === 'ok') expect(ok.iso).toBe('2026-08-31T00:00:00.123Z');
    // 🔵 正對照:不帶小數 ⇒ 照樣 ok(收窄不得誤傷既有形狀)
    expect(resolveShippedEmailCutoff('2026-08-31T00:00:00Z').kind).toBe('ok');
    /**
     * 🔴 **1 位與 2 位小數也必須過**(codex 2026-08-31 R2 nit)。
     * 舊版這一格只測「3 位過 / 4 位不過」⇒ **一個誤寫成 `\.\d{3}`(恰好三位)的 regex
     * 會讓 `.1Z` / `.12Z` 被拒收,而那兩種【今天合法且不失精度】** —— 而舊測試全綠。
     * 📌 **⇒ 只測邊界的兩側,測不出邊界【形狀】錯了。**
     */
    expect(resolveShippedEmailCutoff('2026-08-31T00:00:00.1Z').kind).toBe('ok');
    expect(resolveShippedEmailCutoff('2026-08-31T00:00:00.12Z').kind).toBe('ok');
    // 🔴 本體:4 位以上 ⇒ 拒收
    expect(resolveShippedEmailCutoff('2026-08-31T00:00:00.1239Z').kind).toBe('bad-format');
    expect(resolveShippedEmailCutoff('2026-08-31T00:00:00.123999Z').kind).toBe('bad-format');
    expect(resolveShippedEmailCutoff('2026-08-31T00:00:00.123999+08:00').kind).toBe('bad-format');
  });

});
