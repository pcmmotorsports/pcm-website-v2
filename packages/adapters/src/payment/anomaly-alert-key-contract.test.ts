import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ⟦b4-SQLKEY1⟧ · **SQL 的 key 與 TS 的 key,今天沒有任何機制在維護它們一致** —— 本檔就是那個機制。
 *
 * ## 為什麼需要它(而這一格不是我推的,是那一列量出來的)
 * `PgAnomalyAlertReaderAdapter.ts` 的 `parseDisplayIds` 逐字:
 * > 缺鍵 → 回 `[]`,不 throw —— **刻意的**,理由是部署順序(程式先上、migration 後 apply 的窗口裡,
 * > 舊版 RPC 回不出這五個鍵;此時 throw ⇒ 整支告警 503)。
 *
 * 🔴 **而那個 fail-soft 是對的, 卻同時是【key 名唯一的守門】被關掉的原因**:
 * 一個 typo 的後果是「**那一格永遠是空的**」—— **三綠不紅、測試不紅、畫面不報錯。**
 * ⇒ 📌 **所以修法不是「改成 throw」**(那會把部署窗口變成 503),**是把守門搬到【編譯/測試時】。**
 *
 * ## 本檔擋什麼、擋不住什麼(先寫清楚,免得被讀寬)
 * ```
 * ✅ 擋:TS 讀的 key 在【那支 migration 的函式本體】裡找不到字面
 * ✅ 擋:`parseDisplayIds(d.A, 'B')` —— 屬性名與錯誤訊息用的字面不一致(訊息會指向錯的欄)
 * 🛑 擋不住:正式庫【現在跑的】那一版與 repo 裡這一支不同(那要連正式庫讀 pg_proc)
 * 🛑 擋不住:key 對而【型別/形狀】錯(那是 parseDisplayIds 自己 throw 的那一半)
 * 🛑 擋不住:有人只加一支 migration 而沒跑測試 —— 本檔是「有人跑測試時會叫」的那種守門,
 *          不是 commit 前的閘(同族說明見 `packages/schemas/src/synthetic-domain-sql-contract.test.ts`)
 * ```
 *
 * ## 🔴 兩側都【機械抽取】,不寫死清單
 * 寫死一份清單的話,**兩側同時加一個 key 而我忘了更新清單 ⇒ 本檔恆綠**。
 * ⇒ 所以 TS 那側從 `parseDisplayIds(d.X, 'X')` 抽,SQL 那側從函式本體的 `'…_display_ids'` 字面抽。
 */

const ADAPTER = fileURLToPath(new URL('./PgAnomalyAlertReaderAdapter.ts', import.meta.url));
const MIGRATION = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260819130000_m3_250_anomaly_alert_display_ids.sql',
    import.meta.url,
  ),
);
const RPC = 'get_payment_anomaly_alert_display_ids';

/** `parseDisplayIds(d.X, 'Y')` / `parseDisplayIdPairs(d.X, 'Y')` ⇒ [X, Y] 逐對抽出來。 */
function tsKeyPairs(src: string): Array<[string, string]> {
  const re = /parseDisplayIds?\s*\(\s*d\.([a-z_]+)\s*,\s*'([a-z_]+)'|parseDisplayIdPairs\s*\(\s*d\.([a-z_]+)\s*,\s*'([a-z_]+)'/g;
  const out: Array<[string, string]> = [];
  for (const m of src.matchAll(re)) {
    const prop = m[1] ?? m[3];
    const literal = m[2] ?? m[4];
    // 🔴 兩個都拿不到 ⇒ regex 與這裡的取值對不上了 ⇒ **拋, 不要靜靜地 push 一組 undefined**
    //    (靜靜地放行的話, 前置那一格數到的長度仍然對, 而每一對的內容是空的。)
    if (prop === undefined || literal === undefined) {
      throw new Error(`抽取器與 regex 對不上:${m[0]}`);
    }
    out.push([prop, literal]);
  }
  return out;
}

/** 那支 RPC 的本體裡出現過的 `'…_display_ids'` / `'…_display_id_pairs'` 字面(剝掉 `--` 註解行)。 */
function sqlKeys(src: string): Set<string> {
  const body = src
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
  const from = body.indexOf(`FUNCTION public.${RPC}`);
  if (from < 0) throw new Error(`找不到 ${RPC} 的定義 —— 本檔的前提已經不成立,不要改期望值`);
  // 🔴 **只切到函式本體結束為止** —— 第一版切到【檔尾】, 於是把後置斷言區塊裡
  //    (`:304` 那張 `v_pairs` 對照表)出現的同一批字面也算了進來。
  //    ⇒ 突變「把 `jsonb_build_object` 裡的 key 改名」**沒有紅** —— 因為斷言區塊裡那份還在。
  //    📌 **一把切太寬的尺, 會把【被測物旁邊那份描述被測物的東西】算成被測物。**
  const endMarker = body.indexOf('$fn$;', from);
  const end = endMarker >= 0 ? endMarker : body.indexOf('$$;', from);
  if (end < 0) throw new Error(`找不到 ${RPC} 本體的結尾 —— 尺切不出範圍, 不要讓它切到檔尾`);
  const seg = body.slice(from, end);
  const out = new Set<string>();
  for (const m of seg.matchAll(/'([a-z_]+_(?:display_ids|display_id_pairs))'/g)) {
    if (m[1] === undefined) throw new Error(`抽取器與 regex 對不上:${m[0]}`);
    out.add(m[1]);
  }
  return out;
}

const adapter = readFileSync(ADAPTER, 'utf8');
const migration = readFileSync(MIGRATION, 'utf8');
const pairs = tsKeyPairs(adapter);
const sql = sqlKeys(migration);

describe('⟦b4-SQLKEY1⟧ jsonb key 的兩側字面合約', () => {
  it('🔵 前置:兩側都抽得到東西(否則下面每一格都恆真)', () => {
    // 🔴 沒有這一格, 一個「regex 壞掉抽到 0 個」的世界與一個「兩側完全一致」的世界印同一個綠。
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    expect(sql.size).toBeGreaterThanOrEqual(5);
  });

  it.each(pairs.map(([prop, literal]) => ({ prop, literal })))(
    'TS 讀的 $prop 在那支 migration 的 RPC 本體裡找得到字面',
    ({ prop }) => {
      expect(sql.has(prop), `TS 讀 d.${prop},而 ${RPC} 沒有吐這個 key`).toBe(true);
    },
  );

  it('🔴 屬性名與錯誤訊息的字面必須一致 —— 不一致的話,那句話會指向錯的欄', () => {
    // 成因:`parseDisplayIds(d.open_display_ids, 'refunding_stuck_display_ids')` 會編譯過、會跑過,
    //       而它壞掉時吐的訊息會讓接手的人去查【另一個】欄位。
    for (const [prop, literal] of pairs) {
      expect(literal, `parseDisplayIds(d.${prop}, '${literal}') 兩個字面不一樣`).toBe(prop);
    }
  });

  it('🔵 負對照:一個現造的 key 不在 SQL 那側(證明 sqlKeys 不是回一個什麼都有的集合)', () => {
    expect(sql.has('zzq_no_such_display_ids')).toBe(false);
  });
});
