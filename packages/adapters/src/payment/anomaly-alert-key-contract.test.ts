import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// anomaly-alert-key-contract.test.ts —— SQL 產出的 key 與 TS 讀取的 key 必須對得上。
//
// 🔴 **為什麼需要它(懲罰是【安靜】的)**:一支 SECDEF RPC 回 `jsonb`,TS 這一側用**字面 key** 去讀。
//    兩份字面**互不相認**,而 `PgAnomalyAlertReaderAdapter.ts` 對缺 key 是 **fail-soft**
//    (`if (v === undefined || v === null) return []`)——
//    ⇒ **一個 typo 的結果是「那一格永遠是空的」,而三綠不紅、測試不紅、畫面不報錯。**
//    ⚠️ 而那個 fail-soft **是刻意的、而且是對的**(`parseCount` 對照組刻意 fail-loud)
//    ⇒ 📌 **所以修法不是把它改成 fail-loud,是【在外面加一道對帳】。這一支就是那道。**
//    來源:板 `⟦b4-SQLKEY1⟧`(F-004 關卡1 R3 的 23 條 findings 裡**唯一會再發生**的那一條)。
//
// 🛑 **射程**:
//    · 只對 `get_payment_anomaly_alert_summary` 這一支(另一支 `..._display_ids` 的 key 由它自己那條路徑保證)
//    · 只答「TS 讀的每一個 key,SQL 都有產出」—— **不答反向**。
//      🔵 **不答反向是刻意的**:部署順序上 migration 先上、TS 後上 ⇒ 那個窗口裡 SQL **必然**多出 key
//      ⇒ 反向斷言會在**正常流程**中規律誤報,**而規律誤報會訓練人略過這道閘。**
//      ⚠️ **代價寫出來**:「SQL 產了而沒有人讀」的 key **沒有任何人在看** ⇒ 被 TS 拿掉的 key 會永遠留在 SQL 裡。
//      **那不是缺陷,是【已知未覆蓋】。**
//    · 只讀 **repo 裡的 migration**,答不出「正式庫現在跑的是哪一代」(那要 `pg_proc`)
//    · 🔴 **純 `.sql` 的 commit 不會跑 vitest** ⇒ **本支對「只改 migration」那種 commit 是隱形的**
//      (`docs/phase-1-backlog.md` `#863` 今天仍 open:「所有掃 migration 的閘對純 SQL commit 一律隱形」)
//      ⇒ **它不是 commit 前的閘,是【下一次有人跑測試時】才會叫。**
//
// 🔴 **而 `d` 那個物件(display_ids 那三支)【也是 fail-soft 而且無人守】** ——
//    `PgAnomalyAlertReaderAdapter.ts` 的 `parseDisplayIds` 同樣 `return []`。
//    ⚠️ 舊版射程註寫「由它自己那條路徑保證」—— **那句只成立一半**:
//    `20260819130000:304-321` 的 apply 期交叉斷言比對的是 **SQL 自己兩支函式**,
//    而 TS 那側是**第三份獨立字面**,沒有任何東西在對它。
//    ⇒ **本支【沒有】涵蓋它。那是同一族的下一個缺口,不是已解決的事。**
//    (`rf` / `em` 則不需要:它們走 `parseCount`,缺鍵 ⇒ `NaN` ⇒ throw = fail-**loud**。)
const MIG_DIR = path.resolve(__dirname, '../../../../supabase/migrations');
const TS_FILE = path.resolve(__dirname, 'PgAnomalyAlertReaderAdapter.ts');
const FN = 'get_payment_anomaly_alert_summary';

/** 🔴 找【最新一代】—— 不寫死檔名。
 *  寫死的話:有人日後 `CREATE OR REPLACE` 出新一代,這支測試會繼續讀舊的那一份 ⇒ **恆綠**。
 *  (同族實例:同日 `site-config-wiring.test.ts` 的 meta 守門第一版就是寫死檔名,被 code-reviewer 擋下。) */
function latestDefinitionFile(): string {
  const hits = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION[^;]*?${FN}`, 'i').test(
      readFileSync(path.join(MIG_DIR, f), 'utf8'),
    ))
    .sort();
  if (hits.length === 0) throw new Error(`找不到任何 ${FN} 的定義 —— 這把尺沒有接上`);
  return path.join(MIG_DIR, hits[hits.length - 1]!);
}

/** 從 `jsonb_build_object(` 區塊裡抓【獨佔一行】的 key。
 *  🔵 為什麼這條規則分得開:狀態值(`'open'` / `'refunding'`)出現在 `WHERE` 的**行內**,
 *     而 key 是**自己一行**。實測:此規則抽到 7 個 key,零個狀態值。 */
function sqlKeys(file: string): string[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  // 🔵 錨到【目標函式】那一行之後才起算 —— 一檔多函式在本 repo 是常態
  //    (`20260810220000` 一檔四支);不錨的話會抽到別支的 key。
  const fnLine = lines.findIndex((l) => new RegExp(`FUNCTION[^(]*${FN}`, 'i').test(l));
  if (fnLine < 0) throw new Error(`${path.basename(file)} 找不到 ${FN} 的定義行 —— 這把尺沒有接上`);
  const start = lines.findIndex((l, i) => i > fnLine && l.includes('jsonb_build_object('));
  if (start < 0) throw new Error(`${path.basename(file)} 找不到 jsonb_build_object( —— 這把尺沒有接上`);
  // 🔵 讀到【函式結尾】為止,不用魔術數 —— 舊版寫 120 行,而它越過函式尾 51 行,
  //    今天沒抽到東西是運氣;那 51 行日後多一個 key 形狀就會遮住真缺鍵。
  const endRel = lines.slice(start).findIndex((l) => /^\s*\$\$|^\s*\$function\$/.test(l));
  const end = endRel < 0 ? lines.length : start + endRel;
  const out: string[] = [];
  for (const l of lines.slice(start, end)) {
    const m = /^\s{4}'([a-z_]{3,})',\s*$/.exec(l);
    if (m) out.push(m[1]!);
  }
  return [...new Set(out)];
}

/** TS 這一側:`r.<key>` / `r['<key>']`(`r` = summary 那個物件)。 */
function tsKeys(): string[] {
  const src = readFileSync(TS_FILE, 'utf8');
  const dot = [...src.matchAll(/\br\??\.([a-z_]{3,})\b/g)].map((m) => m[1]!);
  const brk = [...src.matchAll(/\br\[['"]([a-z_]{3,})['"]\]/g)].map((m) => m[1]!);
  return [...new Set([...dot, ...brk])];
}

describe('anomaly alert:SQL 產出的 key 與 TS 讀的 key 要對得上', () => {
  const file = latestDefinitionFile();
  const fromSql = sqlKeys(file);
  const fromTs = tsKeys();

  it('🔵 兩把尺都要撈得到東西(先證明尺接上了,再去斷言)', () => {
    expect(fromSql.length, `SQL 側只抽到 ${fromSql.length} 個 key(讀的是 ${path.basename(file)},釘 7)—— 尺窄掉了`).toBeGreaterThanOrEqual(7);
    expect(fromTs.length, `TS 側只抽到 ${fromTs.length} 個 key(釘 7)—— 尺窄掉了,而它照樣會印綠`).toBeGreaterThanOrEqual(7);
  });

  it('🔴 TS 讀的每一個 key,SQL 都要產出(缺一個 ⇒ 那一格永遠是空的,而沒有東西會紅)', () => {
    const missing = fromTs.filter((k) => !fromSql.includes(k)).sort();
    expect(
      missing,
      `TS 讀了這幾個 key,而 ${path.basename(file)} 沒有產出:\n  ${missing.join('\n  ')}\n` +
        '⇒ 這幾格在正式站上會【永遠是空的】,而 fail-soft 讓它不 throw、不紅、畫面不報錯。',
    ).toEqual([]);
  });
});
