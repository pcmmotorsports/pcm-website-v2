import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARRIER_LABEL, CARRIER_OPTIONS, carrierLabelOf } from './carrier-label';

// #10 片3 驗收 ① ②(plan `2026-08-16-shipping-doc-carrier-tracking-plan.md` §6)。
//
// 🔴🔴 **本檔比 plan 承諾的多做一件,而那件正是 plan 自己標為「天生做不到」的**:
//    plan §2.2 逐字「**DB 加了第四個代碼時,這格【不會紅】**…真相在 migration 裡,而 TS 讀不到 migration」。
//    ⇒ **實作時發現那句話不成立**:本 repo 早有測試用 `readFileSync` 掃 migration
//      (`lib/products/product-repository.test.ts:1` 起,同款做法)⇒ 讀得到。
//    ⇒ 所以下面第一格**真的去讀 CHECK 述詞**,DB 那側加第四個代碼時**這格會紅**。
//
// ⚠️ **但它仍然不是「看得到線上 DB」** —— 縮小之後的洞要照實講:
//    它看得到的是 **repo 裡的 migration 檔**。有人繞過 migration 直接改線上 CHECK ⇒ 照樣看不到。
//    ⇒ 這就是 `carrierLabelOf` 的回退必須是「印代碼本身」而不是留白的理由(見該函式 docstring)。

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');

/**
 * 從 migration 撈出 `carrier_code IN ('a', 'b', …)` 的那個集合。
 *
 * 🔴 **檔名排序後取【最後一個】命中**:之後若有 migration 改了這條 CHECK,
 *    權威是新的那份,不是建表那份。落筆當下實測只有一個檔命中(下面第二格把它釘住)。
 */
function carrierDomainFromMigrations(): { codes: string[]; files: string[] } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const hits: { file: string; codes: string[] }[] = [];
  for (const file of files) {
    // 🔴 **先剝掉 SQL 註解**(R1 nit 6):不剝的話,哪份 migration 在檔頭的註解裡
    //    引用了這條 CHECK,`exec` 取檔內第一個命中 ⇒ **註解會贏過真的 DDL**。
    //    ⚠️ house 的 `lib/test-support/strip-comments.ts` 只剝 `//` 與 `/* */`,不剝 SQL 的 `--`
    //    ⇒ 這裡自己補那一種,而不是假設它涵蓋。
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8')
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // 🔴 `(?<!NOT\s)` :`carrier_code NOT IN (…)` 是**反過來的意思**,撈進來會把值域整個讀反。
    const m = /carrier_code\s+(?<!NOT\s)IN\s*\(([^)]*)\)/i.exec(sql);
    const inner = m?.[1];
    if (inner === undefined) continue;
    // 🔴 `?? ''` 不是防禦性補丁 —— capture group 1 在 `matchAll` 的型別上是 optional,
    //    而 pattern 保證它一定存在。給空字串的話下一格(標籤表比對)會紅,不會靜默通過。
    const codes = [...inner.matchAll(/'([^']*)'/g)].map((c) => c[1] ?? '');
    hits.push({ file, codes });
  }
  return { codes: hits.at(-1)?.codes ?? [], files: hits.map((h) => h.file) };
}

describe('CARRIER_LABEL 對 DB 的代碼集合是完備的', () => {
  it('🔴 分母不是空的 —— 掃不到 CHECK 的話下一格會恆綠', () => {
    // ⚠️ 沒有這一格的話:regex 哪天對不上(SQL 換寫法、檔案搬家)⇒ `codes` 變成 `[]`
    //    ⇒ 下一格的 `toEqual` 兩邊都在比空集合的方向…不,它會紅。但**紅在錯的地方**
    //    (訊息會說「標籤表多了三個代碼」而不是「我掃不到東西」)⇒ 先把分母釘出來。
    const { codes, files } = carrierDomainFromMigrations();
    expect(files.length).toBeGreaterThan(0);
    expect(codes.length).toBeGreaterThan(0);
    // 落筆當下實測:`grep -rn "carrier_code IN" supabase/migrations/` ⇒ 1 命中。
    // 這個 1 不是規格,只是現況;之後有人改 CHECK 會讓它變 2,而**那時取最後一個是對的**
    // ⇒ 所以這裡不釘死 1,只釘「至少有一個」。
    // 🔴 用 `at(-1)` + `toBe`,不用 `toContain`(R1 nit 7):
    //    `toContain` 在「有人新增一份 migration 改了 CHECK」時**照樣綠**,
    //    而下面那格驗的是最後一份 ⇒ 兩格會對著不同的東西講話。
    //    ⇒ 這格紅 = 「權威那份換了」,那時該來看一眼是不是真的要換。
    expect(files.at(-1)).toBe('20260805170000_m4b_e10_b2_s1a1_shipments.sql');
  });

  it('🔴 沒有別的 migration 用【本 regex 看不見的寫法】改掉這條 CHECK(R1 nit 7)', () => {
    // ⚠️ 上面那支 regex 只認得 `carrier_code IN (…)`。三種它看不見、而且會讓守門**綠著失效**的寫法:
    //    `DROP CONSTRAINT shipments_carrier_domain` / `= ANY (ARRAY[…])` / `ADD CONSTRAINT … CHECK (…)`
    //    ⇒ 這格不解析它們,只要求「它們沒出現」。真的出現時本格紅 = 有人來看一眼。
    const blind = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => {
        const sql = readFileSync(path.join(MIGRATIONS, f), 'utf8');
        return (
          /DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?shipments_carrier_domain/i.test(sql) ||
          /carrier_code\s*=\s*ANY/i.test(sql)
        );
      });
    expect(blind).toEqual([]);
  });

  it('標籤表的鍵 = DB CHECK 的代碼集合(多一個少一個都紅)', () => {
    const { codes } = carrierDomainFromMigrations();
    // 🔴 用集合比,不比順序 —— DB 那側的順序沒有意義,而標籤表的順序是給下拉選單用的。
    expect([...Object.keys(CARRIER_LABEL)].sort()).toEqual([...codes].sort());
    // 負向(plan §6 ①):從 CARRIER_LABEL 刪掉 'sf' ⇒ 本格紅。
  });

  it('每個代碼都有【非空】的中文標籤 —— 空字串會在紙上印成留白', () => {
    for (const [code, label] of Object.entries(CARRIER_LABEL)) {
      expect(label.trim(), `代碼 ${code} 的標籤是空的`).not.toBe('');
    }
  });
});

describe('carrierLabelOf 的回退方向', () => {
  it('已知代碼 → 中文標籤', () => {
    expect(carrierLabelOf('hct')).toBe('新竹物流');
    expect(carrierLabelOf('other')).toBe('其他');
  });

  it('🔴 未知代碼 → 印【代碼本身】,不是空白(plan §6 ②)', () => {
    // 這是回退的方向題:多報(醜但有人會問)vs 少報(客人以為沒有貨運商)。
    expect(carrierLabelOf('xyz')).toBe('xyz');
    expect(carrierLabelOf('xyz')).not.toBe('');
    // 負向(plan §6 ②):把實作改成 `?? ''` ⇒ 本格紅。
  });
});

describe('CARRIER_OPTIONS 是同一份表推出來的', () => {
  it('順序與內容與 CARRIER_LABEL 一致(抽出前 shipment-dialog.tsx:42 的順序)', () => {
    expect(CARRIER_OPTIONS.map((o) => o.code)).toEqual(['hct', 'sf', 'other']);
    expect(CARRIER_OPTIONS.map((o) => o.label)).toEqual(['新竹物流', '順豐', '其他']);
  });
});
