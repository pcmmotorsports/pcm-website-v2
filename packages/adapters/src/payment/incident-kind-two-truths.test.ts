/**
 * ⟦b4-TWOTRUTHS1⟧ —— **兩份真相各自正確、各自綠, 而分歧住在【沒有人比較它們】的那一格**
 *
 * 🔴 **這支檔存在的理由**(2026-09-05 深夜, 線【DB】`-db` 與線【帳務】`-d8` 同一夜各撞一次):
 *   · DB 那一側:`public.pcm_incident.kind` 有一個 **CHECK 封閉集**
 *   · TS 那一側:`PgAnomalyAlertReaderAdapter` 有一份 **`KNOWN_INCIDENT_KINDS` 白名單**
 *   ⇒ 📌 **兩份都是真相, 而它們各自在自己那一側是對的** —— 錯的是「沒有人把它們放在一起比」。
 *
 * 🛑 **而漂移時【原本沒有任何東西會叫】**:
 *   我在 adapter 裡加了一行 `console.error`(認不得的 kind ⇒ 印出來), 而它有一個致命射程:
 *   🔴 **新 kind 若還沒有任何 open 列, 它根本不會出現在 `open_by_kind`** ⇒ **那行永遠不會印。**
 *   ⇒ 它是**事後線索**, 不是**事前守門**。**這支檔才是那個守門。**
 *
 * 🔵 形狀照隔壁 `anomaly-alert-key-contract.test.ts`:從 **migration 的最新一代**抽事實,
 *   拿去對 **TS 的常數**。兩邊都是「當下的碼」, 不需要連任何資料庫。
 *
 * ⚠️ **它答不出什麼**(照實列, 不寫成「應該不會」):
 *   · 它比的是 **repo 裡的 migration** 與 **repo 裡的 TS** —— 🔴 **不是正式庫。**
 *     正式庫的 CHECK 若被人手動改過, 這支檔**完全看不到**(那一格屬 ACL 漂移那條線)。
 *     📌 **而這不是本檔獨有的缺陷, 是一個【已經記過的母題】**:
 *        `memory/feedback_guards-pin-repo-text-not-real-world-fact.md` 逐字
 *        「守門釘的是 repo 裡的字面, 不是真實世界的事實 —— 事實漂移時全套恆綠、宣稱靜默變假」。
 *        ⇒ 🛑 **所以本檔全綠只證得了「兩份 repo 內的真相一致」, 證不了「線上那一份也是這樣」。**
 *        (2026-09-06 `scripts/traps-neighbours.py` 查重時撞到它 ⇒ **不另開條目, 在這裡指過去**。)
 *   · 它只認 `CHECK (kind IN ('a','b'))` 與 `CHECK ((kind = 'a'))` 這兩種形狀;
 *     有人寫成 `CHECK (kind = ANY(ARRAY[...]))` 的**原始碼**形狀 ⇒ 下面的正規式抓得到,
 *     而任何第三種寫法會讓「抽到 0 個」⇒ 那一格**大聲丟例外**, 不靜靜回空集合。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const ADAPTER = path.resolve(__dirname, 'PgAnomalyAlertReaderAdapter.ts');

/** SQL 的註解要在每一把尺之前先剝掉(同隔壁那支的理由:註解裡的字面會冒充碼)。 */
function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * 找【最新一代】定義 `pcm_incident.kind` 那個 CHECK 的 migration。
 * 🔴 **不寫死檔名** —— 寫死的話, 有人再加一支放寬 CHECK 的 migration, 這支檔會恆綠。
 */
function latestKindCheckFile(): string {
  const re = /CONSTRAINT\s+pcm_incident_kind_check[\s\S]{0,200}?CHECK\s*\(/i;
  const hits = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => re.test(stripSqlComments(readFileSync(path.join(MIG_DIR, f), 'utf8'))))
    .sort();
  if (hits.length === 0) {
    throw new Error('找不到任何定義 pcm_incident_kind_check 的 migration —— 這把尺沒有接上');
  }
  return path.join(MIG_DIR, hits[hits.length - 1]!);
}

/** 從那一代抽出封閉集裡的值。 */
function sqlKinds(file: string): string[] {
  const src = stripSqlComments(readFileSync(file, 'utf8'));
  // 只取【最後一個】CHECK —— 一支檔可能先 DROP 舊的再 ADD 新的, 而我們要的是它留下的那個。
  const blocks = [...src.matchAll(/CONSTRAINT\s+pcm_incident_kind_check\s+CHECK\s*\(([\s\S]*?)\)\s*;/gi)];
  if (blocks.length === 0) {
    throw new Error(`${path.basename(file)}:抓不到 pcm_incident_kind_check 的 CHECK 述詞 —— 這把尺沒有接上`);
  }
  const body = blocks[blocks.length - 1]![1]!;
  const vals = [...body.matchAll(/'([a-z0-9_]{3,})'/g)].map((m) => m[1]!);
  if (vals.length === 0) {
    throw new Error(
      `${path.basename(file)}:CHECK 述詞裡抽到 0 個值 —— 可能有人換了寫法(本尺認 IN(...) 與 = '...')。`
      + '🔴 不要把這個 0 讀成「封閉集是空的」, 那兩件事在這裡印同一個東西。',
    );
  }
  return [...new Set(vals)].sort();
}

/** 從 adapter 抽 TS 那一側的白名單。 */
function tsKinds(): string[] {
  const src = readFileSync(ADAPTER, 'utf8');
  const m = /KNOWN_INCIDENT_KINDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) {
    throw new Error('adapter 裡找不到 KNOWN_INCIDENT_KINDS —— 這把尺沒有接上(有人改了名字?)');
  }
  const vals = [...m[1]!.matchAll(/'([a-z0-9_]{3,})'/g)].map((x) => x[1]!);
  if (vals.length === 0) throw new Error('KNOWN_INCIDENT_KINDS 抽到 0 個值 —— 尺沒接上');
  return [...new Set(vals)].sort();
}

describe('⟦b4-TWOTRUTHS1⟧ pcm_incident.kind:DB 的 CHECK 封閉集 vs TS 的白名單', () => {
  it('🔵 兩把尺都要撈得到東西(先證明尺接上了, 再去斷言)', () => {
    const f = latestKindCheckFile();
    expect(sqlKinds(f).length, `SQL 側抽到 0 個 —— 讀的是 ${path.basename(f)}`).toBeGreaterThanOrEqual(2);
    expect(tsKinds().length, 'TS 側抽到 0 個 —— 尺窄掉了而它照樣會印綠').toBeGreaterThanOrEqual(2);
  });

  it('🔴 兩份【逐字相同】—— 差一個字就是一份真相在說謊', () => {
    const f = latestKindCheckFile();
    const sql = sqlKinds(f);
    const ts = tsKinds();
    expect(
      ts,
      `TS 白名單與 DB 封閉集對不上。\n`
      + `   SQL(${path.basename(f)}):${sql.join(', ')}\n`
      + `   TS (PgAnomalyAlertReaderAdapter):${ts.join(', ')}\n`
      + '   🔴 **SQL 多而 TS 少** ⇒ 新事故種類進信時 adapter 印一行 error, 而那行只在【已經有事故】之後才印\n'
      + '      ⇒ 📌 清單漂移了而那行永遠不會印。\n'
      + '   🔴 **TS 多而 SQL 少** ⇒ 有人在 TS 端預告了一個 DB 還收不下的值 ⇒ 真的寫入時 check_violation,\n'
      + '      而它在 pcm_noncard_settle_recompute 裡【被內層 handler 吞掉】⇒ 事故安靜地不留痕。',
    ).toEqual(sql);
  });

  it('🔵 負對照:尺分得開「多一個」與「少一個」(不是恆綠)', () => {
    const sql = sqlKinds(latestKindCheckFile());
    expect([...sql, 'zzq9_never_defined'].sort()).not.toEqual(sql);
    expect(sql.slice(1)).not.toEqual(sql);
  });

  it('🔵 那兩個值本身要在(釘住, 免得兩邊【一起】掉光而仍然相等)', () => {
    // 📌 上面那格比的是「兩邊一樣」—— 而【兩邊一起變空】也會通過。這一格釘住內容。
    const sql = sqlKinds(latestKindCheckFile());
    expect(sql).toContain('pending_refund_open_failed');
    expect(sql).toContain('refund_over_total');
  });
});
