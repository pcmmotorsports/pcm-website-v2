import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAYMENT_CHANNEL_VALUES } from './index';

/**
 * 🔴 **本檔存在的理由**:付款管道的白名單有兩個消費者, 而它們在**兩種語言**裡 ——
 * SQL 那一份在【擋】, TS 這一份在【給客人選】。
 * ⇒ 「只寫一次」物理上做不到 ⇒ ✅ **而做得到的是讓它們分岔的那一刻有東西會紅。**
 *
 * 🛑 **而【同一欄有兩道白名單】, 值域【本來就不同】**(2026-09-04 `-auth` 補;板列 `⟦b4-CHANNELCASTWIDE⟧`):
 *    ① `create_order` 的**入口**白名單 —— **2 值**, 客人下單那條路。
 *    ② 欄位 CHECK `orders_payment_channel_check` —— **4 值**
 *       (`tappay` / `bank_transfer` / `cash` / `none`;`cash` 是後台手動建單寫的)。
 *    ⇒ 🎯 所以第二道釘的**不是「相等」, 是【那個差恰好是這兩個值】**。
 *    📌 為什麼要釘住一個差:`mappers/order.ts` 三處 `row.payment_channel as PaymentChannel`
 *       的理由逐字是「DB CHECK 保證值域」—— **理由是對的, 而它涵蓋的比它保證的少兩個值。**
 *
 * ⛔ **本檔證不到什麼(2026-09-04 code-reviewer R1 三條 must-fix 逐條收進來的)**:
 *    · 🔴 **它讀的是【repo 裡的 migration 檔字面】, 不是正式庫。** Sean 是 SQL Editor 手貼
 *      ⇒ **檔與庫可以分岔, 而分岔時本檔印綠。**
 *    · 🔴 改一道**已 apply** 的 CHECK, 唯一合法路徑是**新開一支 migration** `DROP` + `ADD`
 *      ⇒ 所以下面用的是「**掃全部 migration, 取最後一支定義它的**」, 不是寫死那一支。
 *      🛑 **而這仍然不保證關閉條件會叫** —— 只保證「**檔案裡最後那份定義**」與 TS 的差沒有變。
 *    · `mappers/order.ts` 那三處 `as PaymentChannel` **本身沒有任何測試在守**。
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

/** 剝掉 SQL 註解 —— 🔴 少了它, 一段【被註解掉的】DDL 會贏過真碼而無訊號(同檔 ROLLBACK 區就是那個形狀)。 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * 從 SQL 抽某個 `… IN ( … )` 的值域。
 * 🔴 **守門格與負對照格【呼叫同一支】** —— 各自重打一份 regex 的話,
 *    負對照證的是「我在那裡打的那串會分辨兩個集合」, **不是守門在用的那把尺會分辨**。
 * 🔵 值用 `[^']+` 不用 `[a-z_]+` —— 後者會**靜靜丟掉**含數字/大寫/連字號的新值,
 *    而「看不到新增的值」正是本檔要防的那件事。
 */
function valuesIn(sql: string, head: RegExp): string[] | null {
  const m = stripSqlComments(sql).match(head);
  if (!m) return null;
  return [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort();
}

const ENTRY_HEAD = /p_payment_channel NOT IN \(([^)]*)\)/;
const CHECK_HEAD = /CHECK \(payment_channel IN \(([^)]*)\)\)/;

/** 🔴 取**最後一支**定義欄位 CHECK 的 migration —— 後來的 `DROP` + `ADD` 才是現行定義。 */
function latestColumnCheckSql(): { file: string; sql: string; total: number } {
  const hits = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }))
    .filter((x) => CHECK_HEAD.test(stripSqlComments(x.sql)));
  const last = hits[hits.length - 1];
  return { file: last?.file ?? '', sql: last?.sql ?? '', total: hits.length };
}

describe('付款管道白名單 · 跨語言對帳', () => {
  it('🔴 【入口白名單】create_order 的 SQL 值域必須與 TS 的 enum 逐字相同', () => {
    const file = path.join(MIGRATIONS_DIR, '20260904020000_m4b_create_order_payment_channel.sql');
    const sqlValues = valuesIn(readFileSync(file, 'utf8'), ENTRY_HEAD);
    // 🔵 抓不到 ⇒ 明說, 不要讓 null 往下變成空陣列而兩個世界都綠。
    expect(sqlValues, '抓不到 create_order 的入口白名單 ⇒ 這一格沒有判別力').not.toBeNull();
    expect(sqlValues).toEqual([...PAYMENT_CHANNEL_VALUES].sort());
  });

  it('🔴 【欄位 CHECK】最後那份定義, 比 TS 多出來的值必須恰好是 cash / none', () => {
    const { file, sql, total } = latestColumnCheckSql();
    // 🔵 先證這把尺接上了 —— 一支都掃不到的話下面在量 null。
    expect(total, '全 migrations 掃不到任何欄位 CHECK 定義 ⇒ 這一格沒有判別力').toBeGreaterThan(0);
    const dbValues = valuesIn(sql, CHECK_HEAD);
    expect(dbValues, `在 ${file} 抓不到值域 ⇒ 這一格沒有判別力`).not.toBeNull();
    expect(dbValues).toEqual(['bank_transfer', 'cash', 'none', 'tappay']);

    // 🎯 差集 = DB 存得進去而 TS 認不得的值。動 enum、或新開 migration 改 CHECK ⇒ 這一格紅。
    const ts = [...PAYMENT_CHANNEL_VALUES] as string[];
    expect(
      dbValues!.filter((v) => !ts.includes(v)),
      `DB 存得進去而 TS 認不得的值變了(最後定義在 ${file})⇒ 先讀板列 ⟦b4-CHANNELCASTWIDE⟧, 再決定要不要動 mappers/order.ts 那三處 as PaymentChannel`,
    ).toEqual(['cash', 'none']);
  });

  it('🔵 負對照:上面兩格【真正在用的那支抽取器】分辨得出不同集合, 也看得到非小寫的值', () => {
    // 🛑 這一格呼叫的是 valuesIn 本人 —— 重打一份 regex 的話, 改壞上面那把尺這裡照樣綠。
    expect(valuesIn("p_payment_channel NOT IN ('line_pay', 'cash')", ENTRY_HEAD)).toEqual([
      'cash',
      'line_pay',
    ]);
    expect(valuesIn("CHECK (payment_channel IN ('tappay', 'ECPay2', 'x-y'))", CHECK_HEAD)).toEqual([
      'ECPay2',
      'tappay',
      'x-y',
    ]);
    // 🔴 註解掉的 DDL 不得贏過真碼。
    expect(
      valuesIn("-- CHECK (payment_channel IN ('fake'))\nCHECK (payment_channel IN ('real'))", CHECK_HEAD),
    ).toEqual(['real']);
    // 🔵 抓不到要回 null(不是空陣列)—— 空陣列會與「真的沒有值」印同一個東西。
    expect(valuesIn('沒有白名單', CHECK_HEAD)).toBeNull();
  });
});
/**
 * 🔴🔴 **2026-09-05 補:綁【domain 四值 ↔ DB CHECK 四值】—— 那一對才是 mapper 真的靠著的。**
 *
 * 病史(板列 `⟦b4-CHANNELCASTWIDE⟧` 的核心宣稱被證偽):
 *   那一列寫「`mappers/order.ts` 的 `as PaymentChannel` 比它的理由寬了兩個值,
 *   因為 TS 的 `PaymentChannel` 只有兩個」——
 *   🛑 **而那個名字有【兩個型別】**:`@pcm/schemas` 兩值(結帳輸入)· `@pcm/domain` **四值**,
 *      而 `mappers/order.ts` import 的是 **`@pcm/domain`** ⇒ 四值對四值 ⇒ **剛剛好, 不是寬。**
 *   📌 ⇒ 那一列**主詞錯了, 而它引的每一個字面都是真的。**
 *
 * 🔴 而它揭出一個真的缺口:**本檔上面兩格綁的是「DB ↔ schemas 兩值」**,
 *    而 `domain` 那四值 —— mapper 每一次讀單都靠它 —— **本檔一個字都沒讀。**
 *    (當場量:本檔提到 `domain` 的次數 **0**。)
 *
 * 🛑 **為什麼用讀【字面】而不是 import**:`@pcm/domain` 的 `PaymentChannel` 是**純型別 union**,
 *    執行期不存在 ⇒ 沒有東西可以 import 來比。讀字面是**唯一**的路, 不是偷懶。
 *    ⚠️ 代價:它讀的是 repo 裡的檔, **不是正式庫也不是編譯後的型別** ——
 *       與本檔上面兩格同一個天花板。
 */
const DOMAIN_TYPES = path.resolve(__dirname, '../../domain/src/order/types.ts');
const DOMAIN_HEAD = /export type PaymentChannel\s*=\s*([^;]*);/;

/** 從 domain 的型別宣告抽出那幾個字面值(`'a' | 'b'` ⇒ `['a','b']`)。 */
function domainChannelValues(): string[] | null {
  const m = readFileSync(DOMAIN_TYPES, 'utf8').match(DOMAIN_HEAD);
  if (!m) return null;
  return [...(m[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

describe('付款管道白名單 · domain ↔ DB CHECK(mapper 真的靠著的那一對)', () => {
  it('🔵 前提:兩把尺都抓得到東西(抓不到 ⇒ 是尺壞了, 不是「兩邊一致」)', () => {
    expect(domainChannelValues()).not.toBeNull();
    expect(domainChannelValues()!.length).toBeGreaterThan(0);
    expect(latestColumnCheckSql().sql.length).toBeGreaterThan(100);
  });

  it('🔴 domain 的 PaymentChannel 必須與【最後那份】欄位 CHECK 的值域逐字相同', () => {
    // 🔴 這一格釘的是【相等】, 不是「差恰好是兩個」——
    //    上面那格比的是 schemas(兩值, 結帳只給兩個選項, 差是刻意的);
    //    這裡比的是 domain, 而 mapper 直接把 DB 的值 cast 成它 ⇒ **多一個少一個都是缺陷。**
    const { sql, file } = latestColumnCheckSql();
    const dbValues = valuesIn(sql, CHECK_HEAD);
    expect(dbValues, `抓不到 CHECK 值域:${file}`).not.toBeNull();
    expect([...domainChannelValues()!].sort()).toEqual([...dbValues!].sort());
  });

  it('🔴 而那個相等【不是空對空】—— 兩邊都必須含 cash 與 none', () => {
    // 🔵 沒有這一格,「兩邊都被改成空的」也會讓上一格綠。
    const dbValues = valuesIn(latestColumnCheckSql().sql, CHECK_HEAD)!;
    for (const v of ['tappay', 'bank_transfer', 'cash', 'none']) {
      expect(domainChannelValues()).toContain(v);
      expect(dbValues).toContain(v);
    }
  });

  it('🔵 抽取器有判別力:domain 那行拿掉 cash ⇒ 抽出來的集合要跟著少', () => {
    // 🔴 沒有這一格, 上面兩格在「判準寫壞」與「真的一致」兩個世界印同一個綠。
    const raw = readFileSync(DOMAIN_TYPES, 'utf8');
    const mutated = raw.replace(" | 'cash'", '');
    expect(mutated).not.toBe(raw); // 突變真的套上了
    const got = [...(mutated.match(DOMAIN_HEAD)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    expect(got).not.toContain('cash');
    expect(got.length).toBe(domainChannelValues()!.length - 1);
  });

  it('🔵 抽取器剝註解:domain 檔裡若有被註解掉的舊宣告, 不得被抽到', () => {
    // ⚠️ 而本格是【對抽取器】的檢查, 不是對 domain 檔的 —— 那支檔今天沒有那種形狀。
    const fake = "// export type PaymentChannel = 'zzq_old';\nexport type PaymentChannel = 'a' | 'b';";
    const got = [...(fake.match(DOMAIN_HEAD)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    // 🔴 `match` 取【第一個】命中 ⇒ 註解那行會先中 ⇒ 這一格把那個弱點釘出來, 而不是假裝沒有。
    expect(got).toEqual(['zzq_old']);
    // ⇒ 📌 **所以上面那幾格的前提是「domain 檔裡沒有被註解掉的同名宣告」** ——
    //    今天成立(當場量:那支檔 `export type PaymentChannel` 只出現一次), 而它不是被保證的。
    expect(
      (readFileSync(DOMAIN_TYPES, 'utf8').match(/export type PaymentChannel\s*=/g) ?? []).length,
    ).toBe(1);
  });
});
