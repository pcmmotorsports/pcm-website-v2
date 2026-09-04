import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 同一份名單住在兩個地方, 而只有一邊會被讀:
 *   · `supabase/rls-service-role-select-exclusions.txt` —— 人會讀的那份(有理由)
 *   · `20260904270000_…sql` 的 `NOT IN (…)` —— 資料庫會執行的那份
 * ⇒ 改一邊而忘了另一邊, **兩份各自都完全正確**, 而合起來的行為與文件不符。
 *   本檔讓那個世界紅。
 *
 * 🛑 它是【掃描型】測試(自己讀 `supabase/migrations/`, 不 import 被測的碼)
 *    ⇒ `vitest related` 的分母裡結構上沒有它 ⇒ 動 migration 時記得跑
 *    `bash scripts/run-migration-scan-tests.sh`(正本:docs/patterns/slice-checkpoint.md)。
 */
const ROOT = resolve(__dirname, '..');
const LIST = join(ROOT, 'supabase/rls-service-role-select-exclusions.txt');
const MIG = join(ROOT, 'supabase/migrations/20260904270000_m4b_rls_service_role_select_36.sql');

/** 🔴 剝掉 SQL 註解 —— 註解裡也寫得出表名, 掃到會多算。 */
function stripSqlComments(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

function listNames(): string[] {
  return readFileSync(LIST, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/**
 * migration 裡那份排除名單的字面。
 *
 * 🔴🔴 codex R1 must-fix:第一版用 `c\.relname\s+NOT\s+IN\s*\(([^)]*)\)` 抓【第一個】NOT IN。
 *    ⇒ migration 前面若多一個 `NOT IN (…)`, 它永遠抓錯區塊, 而**五格仍可能全綠**
 *      (假段剛好含正確 7 名時), 連突變格也只是在突變同一個錯區塊。
 *    🔬 而它現在【已經】不成立:改完之後那支 migration 有 **3 個** `NOT IN (`
 *      (目標名單 1 個 + 斷言裡的 `polcmd NOT IN` 與 `pg_get_expr(...) NOT IN`)。
 * ✅ 改成**具名錨**:`PCM-EXCLUSIONS-BLOCK-BEGIN` / `-END`。
 *    錨不見 ⇒ 回 null ⇒ 下面第一格會紅, **不會靜靜抓到別的東西**。
 */
function extractBetween(raw: string, a: string, b: string): string[] | null {
  const i = raw.indexOf(a);
  const j = raw.indexOf(b);
  if (i < 0 || j < 0 || j <= i) return null;
  // 🔴 R3 F7:**區塊裡面也要剝 SQL 註解** —— 把某一列改成 `-- ('x'),` 是「暫時解除排除」
  //    最自然的手勢, 而不剝註解的話這裡照樣抽得到它 ⇒ 兩邊一致而 DB 裡少插一列。
  const seg = stripSqlComments(raw.slice(i + a.length, j));
  return [...seg.matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]!);
}

function migNames(): string[] | null {
  return extractBetween(readFileSync(MIG, 'utf8'),
    'PCM-EXCLUSIONS-BLOCK-BEGIN', 'PCM-EXCLUSIONS-BLOCK-END');
}

describe('RLS service_role 排除名單:清單檔 與 migration 內嵌必須逐字相同', () => {
  it('🔴 前提:錨抓得到區塊(抓不到 ⇒ 是尺壞了, 不是「兩邊一致」)', () => {
    // 沒有這一格, migNames() 回 null 時下面每一格的錯誤訊息都會指錯方向。
    expect(migNames()).not.toBeNull();
    expect(listNames().length).toBeGreaterThan(0);
    expect(migNames()!.length).toBeGreaterThan(0);
  });

  it('🔴 兩邊的集合逐字相同', () => {
    expect([...migNames()!].sort()).toEqual([...listNames()].sort());
  });

  it('數量 = 8(7 張拍板排除 + 本支自己的前態快照表;改這個數字 = 你在改一個決定)', () => {
    // 🔴 第 8 個是 pcm_rls_rollback_20260904270000 —— 本支自己建的表。
    //    不扣掉它, 本支跑完之後【重跑會被自己中止】(它會變成「多出來的」那一張)。
    expect(listNames()).toHaveLength(8);
  });

  it('🔴 錨與【位置】無關 —— 在它前面插一個假的 NOT IN 區塊, 抓第一個的做法會抓錯而錨不會', () => {
    // ⚠️ 我第一版寫的是「第一個 NOT IN 現在就會抓錯」——**那個期望值是我想出來的, 不是量出來的**,
    //    實跑當場紅:排除區塊【剛好】就是檔案裡第一個 NOT IN。
    // ✅ 真正要證的宣稱不是「現在會不會抓錯」, 是「**位置變了會不會抓錯**」。
    const raw = readFileSync(MIG, 'utf8');
    const fake = "  AND c.relname NOT IN ('zzq_decoy_a', 'zzq_decoy_b')\n";
    const at = raw.indexOf('CREATE TEMP TABLE');
    expect(at).toBeGreaterThan(0);
    const mutated = raw.slice(0, at) + fake + raw.slice(at);

    // 舊做法(抓第一個 NOT IN)⇒ 抓到誘餌
    const first = stripSqlComments(mutated).match(/NOT\s+IN\s*\(([^)]*)\)/i);
    const firstNames = [...(first?.[1] ?? '').matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]!);
    expect(firstNames).toContain('zzq_decoy_a');
    expect([...firstNames].sort()).not.toEqual([...listNames()].sort());

    // 錨做法 ⇒ 仍抓到正確那 7 個
    const i = mutated.indexOf('PCM-EXCLUSIONS-BLOCK-BEGIN');
    const j = mutated.indexOf('PCM-EXCLUSIONS-BLOCK-END');
    const seg = mutated.slice(i, j);
    const anchored = [...seg.matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]!);
    expect([...anchored].sort()).toEqual([...listNames()].sort());
  });

  it('🔵 那支 migration 確實有多個 NOT IN 區塊(所以「抓第一個」本來就不該用)', () => {
    const notIns = [...stripSqlComments(readFileSync(MIG, 'utf8')).matchAll(/NOT\s+IN\s*\(/gi)].length;
    expect(notIns).toBeGreaterThan(1);
  });

  it('pattern 有判別力:區塊裡多一個名字 ⇒ 抽出來的集合要跟著變', () => {
    const raw = readFileSync(MIG, 'utf8');
    const mutated = raw.replace('PCM-EXCLUSIONS-BLOCK-BEGIN', "PCM-EXCLUSIONS-BLOCK-BEGIN\n 'zzq_bogus_table',");
    const i = mutated.indexOf('PCM-EXCLUSIONS-BLOCK-BEGIN');
    const j = mutated.indexOf('PCM-EXCLUSIONS-BLOCK-END');
    const seg = mutated.slice(i, j);
    const got = [...seg.matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]!);
    expect(got).toContain('zzq_bogus_table');
    expect(got).toHaveLength(listNames().length + 1);
  });

  it('🔵 錨不見時【真的】回 null —— 把錨拿掉再呼叫一次, 不是重驗錨還在', () => {
    // 🔴 codex R2 nit:前一版只斷言「錨存在」⇒ 它證的是現況, 不是「壞掉時會說自己壞了」。
    const raw = readFileSync(MIG, 'utf8');
    const noAnchor = raw.replace('PCM-EXCLUSIONS-BLOCK-BEGIN', 'ZZQ-REMOVED');
    expect(extractBetween(noAnchor, 'PCM-EXCLUSIONS-BLOCK-BEGIN', 'PCM-EXCLUSIONS-BLOCK-END')).toBeNull();
  });

  it('🔴 錨必須【各出現一次】—— 重複的錨會讓區間抓到錯的一段', () => {
    // codex R2 must-fix ⑥:錨只是註解, 沒人保證它唯一。
    const raw = readFileSync(MIG, 'utf8');
    expect(raw.split('PCM-EXCLUSIONS-BLOCK-BEGIN').length - 1).toBe(1);
    expect(raw.split('PCM-EXCLUSIONS-BLOCK-END').length - 1).toBe(1);
    expect(raw.split('PCM-EXPECTED-BLOCK-BEGIN').length - 1).toBe(1);
    expect(raw.split('PCM-EXPECTED-BLOCK-END').length - 1).toBe(1);
  });

  it('🔴 錨包住的必須是【真的會被執行的那一段】—— 它在 pcm_rls_exclusions 的 INSERT 裡', () => {
    // codex R2 must-fix ⑥ 的另一半:前置假錨可以保留正確 7 名而把真 SQL 改壞。
    // ⇒ 驗錨的位置落在 `INSERT INTO pcm_rls_exclusions(relname) VALUES` 與它的結束分號之間。
    const raw = readFileSync(MIG, 'utf8');
    const ins = raw.indexOf('INSERT INTO pcm_rls_exclusions(relname) VALUES');
    expect(ins).toBeGreaterThan(0);
    const end = raw.indexOf(';', raw.indexOf('PCM-EXCLUSIONS-BLOCK-END'));
    const b = raw.indexOf('PCM-EXCLUSIONS-BLOCK-BEGIN');
    expect(b).toBeGreaterThan(ins);
    expect(b).toBeLessThan(end);
  });

  it('🔴 排除名單只剩【一份】—— 沒有第二份【名單】(而不是「每個名字只出現一次」)', () => {
    // 🔴🔴 2026-09-05 訂正:第一版寫 `每個名字在全檔只出現 1 次` ⇒ 收割時當場紅
    //    (`pcm_rls_rollback_20260904270000` 出現 2 次:排除區塊 :131 與收權斷言的
    //     `v_relations text[] := ARRAY['pcm_rls_rollback_…']` :545)。
    //    🛑 **而那第二處【不是】第二份名單** —— 它是那張表在【另一個用途】上被點名一次。
    //    📌 我把「沒有第二份名單」這個宣稱, 量成了「沒有第二次提到任一個名字」——
    //       **後者比前者嚴, 而嚴的方向製造的是假指控。**
    // ✅ 真正的宣稱:**排除區塊以外, 沒有任何一個敘述同時列出 2 個以上的排除名字。**
    //    一份真的副本必然會列很多個;而一次合法的單獨點名只會列一個。
    const names = listNames();
    const raw = readFileSync(MIG, 'utf8');
    const i = raw.indexOf('PCM-EXCLUSIONS-BLOCK-BEGIN');
    const j = raw.indexOf('PCM-EXCLUSIONS-BLOCK-END');
    const outside = stripSqlComments(raw.slice(0, i) + raw.slice(j));
    const offenders = outside
      .split('\n')
      .map((l, n) => ({ n, hits: names.filter((x) => l.includes(`'${x}'`)) }))
      .filter((r) => r.hits.length >= 2);
    expect(offenders).toEqual([]);
    // 🔴 而排除區塊【以外】仍然不得出現 `IN (` 硬寫的排除名單 —— 要走那張暫存表
    expect(outside).toContain('c.relname IN (SELECT relname FROM pcm_rls_exclusions)');
  });

  it('🔵 上一格的尺會動:造一行同時列 3 個排除名字 ⇒ 必須被抓出來', () => {
    // 沒有這一格, 上一格在「判準寫壞」與「真的沒有第二份」兩個世界印同一個綠。
    const names = listNames();
    const fake = `  AND c.relname IN ('${names[0]}', '${names[1]}', '${names[2]}')`;
    const hits = names.filter((x) => fake.includes(`'${x}'`));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('🔴 期望名單(40 張)也要與它自己的錨一致, 且不得與排除名單重疊', () => {
    const expected = extractBetween(readFileSync(MIG, 'utf8'),
      'PCM-EXPECTED-BLOCK-BEGIN', 'PCM-EXPECTED-BLOCK-END');
    expect(expected).not.toBeNull();
    expect(expected!).toHaveLength(40);
    for (const n of listNames()) expect(expected!).not.toContain(n);
  });
});
