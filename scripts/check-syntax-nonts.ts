// check-syntax-nonts.ts — 非 TS 檔的語法守門(補鐵則 11「三綠」的結構缺口)。
//
// 🔴 為什麼需要這支:三綠 = typecheck + lint + build,三者**只讀 .ts/.tsx**;
//   `lint-staged` 原本也只有 `*.{ts,tsx}` 一個 entry。
//   ⇒ 純 .sql / .sh / .yaml 的 slice「三綠全過」是**恆真**,對那些檔零判別力。
//   實錘兩例(2026-08-07 夜跑):①B 線 W0b/W1 純 .sql/.sh 片三綠恆綠
//   ②D 線 manifest YAML 曾被插入未跳脫雙引號打壞、四綠仍全 exit=0。
//   偵察出處:docs/reviews/2026-08-07-night-legislation-draft.md §5.6 補-1/補-2。
//
// 介面:`tsx scripts/check-syntax-nonts.ts <檔案...>`(lint-staged 會把 staged 檔名 append)。
//   無檔名參數 → 直接綠(lint-staged 在無匹配檔時不會呼叫,但保留此路徑免誤紅)。
//   任一檔不過 → 印出「檔案:行號 + 原因」並 exit 1。
//
// 🔴 刻意不做的事(誠實邊界,不要事後被誤讀成「已覆蓋」):
//   - **不是** SQL / shell / YAML 的語意檢查,只抓「這個檔在語法層根本讀不進去」。
//   - `.sql` 沒有真正的語法檢查(見 checkSql 檔內說明),只做**配對平衡**這一格。

import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

type Failure = { file: string; line: number | null; reason: string };

/**
 * 守備範圍的副檔名 —— **單一來源**。
 * 🔴 `checkOne` 的分流與 CLI 的計數器必須讀同一份:兩邊各寫一份時,
 *   分歧會讓「檢查 N 檔」這個防假綠計數器**自己說謊**(算進沒檢查的檔 / 漏算檢查過的檔)。
 */
const GUARDED_EXT = /\.(sh|ya?ml|sql)$/i;

/**
 * .sh → `bash -n`(POSIX shell 內建的 noexec 語法檢查,零依賴)。
 *
 * 🔴 **一次只能餵一個檔**:`bash -n a.sh b.sh` 只會檢查 `a.sh`,`b.sh` 被當成位置參數 `$1`
 *   而完全不檢查。若圖方便寫成 `"*.sh": "bash -n"` 交給 lint-staged 批次帶入多檔,
 *   第二個檔起就是**恆真守門**(改壞了也全綠)。本函式逐檔呼叫即為此。
 *   對應負向測試:`check-syntax-nonts.test.ts` 的「兩個檔、只有第二個壞」那格。
 */
function checkShell(file: string): Failure | null {
  const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
  if (r.error) return { file, line: null, reason: `bash 無法執行:${r.error.message}` };
  if (r.status === 0) return null;
  // bash -n 的 stderr 形如 `path: line 12: syntax error near unexpected token ...`
  const stderr = (r.stderr || '').trim();
  const m = stderr.match(/line (\d+)/);
  return { file, line: m ? Number(m[1]) : null, reason: stderr || `bash -n exit ${r.status}` };
}

/**
 * .yaml/.yml → 用 repo 既有的 `yaml` 套件(package.json 已列,零新依賴)解析。
 * parse 丟例外即不過;`yaml` 的錯誤物件帶 `linePos`,取第一個位置當行號。
 */
function checkYaml(file: string): Failure | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { file, line: null, reason: `讀不到檔:${(e as Error).message}` };
  }
  try {
    parseYaml(text);
    return null;
  } catch (e) {
    const err = e as { message?: string; linePos?: Array<{ line: number }> };
    const line = err.linePos?.[0]?.line ?? null;
    return { file, line, reason: err.message ?? String(e) };
  }
}

/**
 * .sql → **只做配對平衡,不是語法檢查**。
 *
 * 為什麼不做真語法檢查(2026-08-07 實測後的結論,非偷懶):
 *   ① `psql` 沒有離線語法檢查模式(`/opt/homebrew/bin/psql` 需連上 server 才 parse)。
 *   ② 真 parser(node-sql-parser / pgsql-ast-parser 等)都要**新增依賴**,且它們對 PG 方言
 *      (plpgsql `$$` body、`CREATE POLICY`、`GRANT ... ON ALL TABLES`)覆蓋不全,誤報成本高。
 *   ③ 靠拋棄式 PG 實跑可以做到真檢查,但那要起 postgres、秒級成本
 *      ⇒ **不該進全域 commit gate**,該留在該片自己的 harness(B 線既有做法)。
 * ⇒ 折衷:只抓「引號 / dollar-quote / 括號不平衡」這一類**會讓整個檔讀不進去**的錯,
 *   它正是「插入未跳脫引號打壞檔案」那個真實故障的 SQL 版本。
 *
 * 🔴 **這格抓不到的**:欄名打錯、型別不符、語意錯誤、缺分號、任何平衡但錯誤的 SQL。
 *   不得因為這格綠就宣稱「SQL 已驗」。
 */
function checkSql(file: string): Failure | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { file, line: null, reason: `讀不到檔:${(e as Error).message}` };
  }

  let line = 1;
  let paren = 0;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    const rest = text.slice(i);

    if (c === '\n') { line += 1; i += 1; continue; }

    // 行註解 -- ... 到行尾
    if (rest.startsWith('--')) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }
    // 區塊註解 /* ... */(PG 允許巢狀)
    if (rest.startsWith('/*')) {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text.startsWith('/*', j)) { depth += 1; j += 2; continue; }
        if (text.startsWith('*/', j)) { depth -= 1; j += 2; continue; }
        if (text[j] === '\n') line += 1;
        j += 1;
      }
      if (depth > 0) return { file, line, reason: '區塊註解 /* 未閉合' };
      i = j;
      continue;
    }
    // dollar-quote:$$ 或 $tag$ ... 同樣的結束標記
    const dq = rest.match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (dq) {
      const tag = dq[0];
      const end = text.indexOf(tag, i + tag.length);
      if (end === -1) return { file, line, reason: `dollar-quote ${tag} 未閉合` };
      for (let k = i; k < end; k += 1) if (text[k] === '\n') line += 1;
      i = end + tag.length;
      continue;
    }
    // PG escape string:E'...' / e'...' —— **反斜線也是跳脫字元**(與一般 '...' 不同)。
    // 🔴 少了這個分支,合法的 `SELECT E'it\'s ok';` 會被誤判成「單引號未閉合」而擋下 commit。
    //   誤擋合法檔比漏抓更糟:它會逼人走 --no-verify,整條 gate 的可信度一次歸零。
    //   前一個字元不可是識別字字元,免得把 `nameE'x'` 這種欄名誤當 E-string。
    if ((c === 'E' || c === 'e') && text[i + 1] === "'" && !/[A-Za-z0-9_]/.test(text[i - 1] ?? ' ')) {
      let j = i + 2;
      for (;;) {
        if (j >= n) return { file, line, reason: "E'' 跳脫字串未閉合" };
        const ch = text[j];
        if (ch === '\\') {
          if (text[j + 1] === '\n') line += 1;
          j += 2;
          continue;
        }
        if (ch === "'") {
          if (text[j + 1] === "'") { j += 2; continue; }
          break;
        }
        if (ch === '\n') line += 1;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    // 單引號字串('' 為跳脫)
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        const q = text.indexOf("'", j);
        if (q === -1) return { file, line, reason: "單引號字串 ' 未閉合" };
        if (text[q + 1] === "'") { j = q + 2; continue; }
        for (let k = i; k < q; k += 1) if (text[k] === '\n') line += 1;
        i = q + 1;
        break;
      }
      continue;
    }
    // 雙引號識別字("" 為跳脫)
    if (c === '"') {
      let j = i + 1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) return { file, line, reason: '雙引號識別字 " 未閉合' };
        if (text[q + 1] === '"') { j = q + 2; continue; }
        for (let k = i; k < q; k += 1) if (text[k] === '\n') line += 1;
        i = q + 1;
        break;
      }
      continue;
    }
    if (c === '(') paren += 1;
    if (c === ')') {
      paren -= 1;
      if (paren < 0) return { file, line, reason: '多餘的右括號 )' };
    }
    i += 1;
  }

  if (paren !== 0) return { file, line: null, reason: `括號不平衡(缺 ${paren} 個右括號)` };
  return null;
}

function checkOne(file: string): Failure | null {
  if (!GUARDED_EXT.test(file)) return null;
  const lower = file.toLowerCase();
  if (lower.endsWith('.sh')) return checkShell(file);
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return checkYaml(file);
  if (lower.endsWith('.sql')) return checkSql(file);
  return null;
}

export { checkShell, checkYaml, checkSql, checkOne, GUARDED_EXT };
export type { Failure };

/**
 * 是否為「直接執行」(被 test import 時不該跑 CLI)。
 *
 * 🔴 原本用 `process.argv[1].endsWith('check-syntax-nonts.ts')` 判斷,**那是一個靜默失效的洞**:
 *   經 symlink 或改名呼叫時判斷為 false ⇒ 整支 CLI 不跑、exit 0、**連一行輸出都沒有**
 *   —— 防假綠的計數器自己被同一個洞繞過(2026-08-07 code-reviewer must-fix 1,已實測復現)。
 * 改用 realpath 比對:symlink 兩端都正規化到同一個真實路徑。
 * realpath 失敗(檔被刪等)→ 退回字串比對,**不靜默當作「不是直接執行」**。
 */
const invokedDirectly = ((): boolean => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(argv1) === realpathSync(self);
  } catch {
    return argv1 === self;
  }
})();

if (invokedDirectly) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log('check-syntax-nonts: 無檔案參數、跳過');
    process.exit(0);
  }
  const failures: Failure[] = [];
  let checked = 0;
  for (const f of files) {
    if (!GUARDED_EXT.test(f)) continue; // 非守備範圍、不計數(與 checkOne 共用同一份清單)
    checked += 1;
    const r = checkOne(f);
    if (r) failures.push(r);
  }
  // 🔴 一律印出「實際檢查了幾個檔」——沒有這行就分不出「沒紅」與「根本沒跑」
  //   (memory feedback_negative-test-harness-self-false-green)
  console.log(`check-syntax-nonts: 檢查 ${checked} 檔、${failures.length} 個不過`);
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`  ✗ ${f.file}${f.line !== null ? `:${f.line}` : ''} — ${f.reason}`);
    }
    process.exit(1);
  }
}
