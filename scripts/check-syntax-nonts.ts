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
//   - `.py` 只有 `ast.parse`:**它量的是「這個檔讀不讀得進去」,不是「這支腳本對不對」**。
//     import 錯的模組、名稱打錯、邏輯錯、跑起來就炸 —— 這格全部是綠的。
//     ⇒ 不得因為這格綠就宣稱「那 N 支 .py 都沒問題」(2026-08-22 D 線加入 .py 時明寫)。

import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseAllDocuments } from 'yaml';

type Failure = { file: string; line: number | null; reason: string };

/**
 * 守備範圍的副檔名 —— **單一來源**。
 * 🔴 `checkOne` 的分流與 CLI 的計數器必須讀同一份:兩邊各寫一份時,
 *   分歧會讓「檢查 N 檔」這個防假綠計數器**自己說謊**(算進沒檢查的檔 / 漏算檢查過的檔)。
 */
const GUARDED_EXT = /\.(sh|ya?ml|sql|py)$/i;

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
 *
 * 🔴 用 `parseAllDocuments` 而非 `parse`:`parse` 遇到 `---` 分隔的**合法多文件 YAML**
 *   (k8s manifest、docker-compose 等常見)會丟 `Source contains multiple documents` ——
 *   那是**能力限制被回報成語法錯**,屬「誤擋合法檔 ⇒ 逼人 `--no-verify` ⇒ gate 可信度歸零」那族。
 *   (2026-08-07 Fable R2 F1,已實測復現)
 * 錯誤收在每個 doc 的 `.errors`(不丟例外),故逐 doc 檢查;`catch` 保留當保險。
 */
function checkYaml(file: string): Failure | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    return { file, line: null, reason: `讀不到檔:${(e as Error).message}` };
  }
  try {
    for (const doc of parseAllDocuments(text)) {
      const err = doc.errors[0];
      if (err) {
        return { file, line: err.linePos?.[0]?.line ?? null, reason: err.message };
      }
    }
    return null;
  } catch (e) {
    const err = e as { message?: string; linePos?: Array<{ line: number }> };
    return { file, line: err.linePos?.[0]?.line ?? null, reason: err.message ?? String(e) };
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

/**
 * .py → `python3` 的 `ast.parse`(標準庫,零新依賴、零副作用)。
 *
 * 🔴 **不用 `python3 -m py_compile`**:那會在旁邊寫出 `__pycache__/*.pyc`
 *   —— 一道守門在被守的目錄裡留下產物,下一個人 `git status` 會看到不是他改的東西。
 * 🔴 **不用 `python3 -c ... a.py b.py` 批次**:與 checkShell 同一個坑(逐檔呼叫才不會恆真)。
 * 🔴 **射程**:只抓「parse 不過」。import 不存在的模組、名稱打錯、跑起來就炸 —— 這格**全綠**。
 *
 * 🔴 **餵 bytes,不是 str**(2026-08-22 codex R1 must-fix 1,實測後改):
 *   原版 `open(p, encoding='utf-8').read()` 有**雙向**錯:
 *   ① `# coding: ascii` + UTF-8 中文 —— 真 Python 紅、這裡綠(**cookie 被繞過**);
 *   ② 合法的 Latin-1 檔 —— 真 Python 綠、這裡 `UnicodeDecodeError` 紅(**誤擋合法檔**)。
 *   餵 bytes 之後 PEP 263 的 coding cookie 由 Python 自己處理,兩個方向都跟真 Python 一致。
 *   (實測四格全部復現過;`ValueError` 那條 except 就是為 ① 的 codec 錯而在。)
 *
 * 🔴 **版本地板 `PY_MIN`(codex R1 must-fix 2 / R2 #1-#3;R2 後改成機制,不再靠判斷)**:
 *   `ast.parse` 用的是**跑它的那個 python3 的 grammar**。具體形狀:`t"hi"`(PEP 750 t-string)
 *   在 3.14 綠、拿 3.13 解析則紅 ⇒ **同一份 diff 有人 commit 得了、有人 commit 不了**,
 *   而那正是「一道紅著而做不完的閘會訓練人略過它」。
 *   ⚠️ **R1 我寫的是「今天不咬人」+ 三個理由(CI 沒有它 / 只餵自己 staged 的檔 / 同一台機器)。**
 *     那三個理由當時是真的,但它們**過期時沒有任何訊號** —— 換機器、開 CI 都不會有人回來讀這段。
 *   ⇒ 改成**低於地板就明確報錯**:把「你那邊綠我這邊紅」換成「它當場說出自己幾版、要幾版」。
 *   ⚠️ **這道地板不會讓不同版本解析出同一個結果** —— 它只保證**不一致時你會知道**。
 *     真要一致,得釘 python 版本(需要 Sean 拍板,不在本片範圍)。
 *   📌 **2026-08-23 更新(原句保留,不改掉)**:上面那句「需要 Sean 拍板」寫在他的「1234」預先授權**之前**。
 *     釘 python 版本命中預先授權**第 1 類**(純內部工具 / 守門 / 測試,客人與員工都看不到)
 *     ⇒ **不再需要為了開工許可停下來問他**(memory `project_0824-sean-preauthorizes-four-categories`;
 *     該清單另有「永遠要問他」的四件,本件一件都不中)。而**鐵則 12④(CI 屬平台設定)不受影響** ——
 *     commit 前仍要跑對抗審查。
 *     🔴 **它已經釘上去了**:`.github/workflows/ci.yml` 的 `Setup Python` 步驟,`python-version: '3.14'`。
 *     ⚠️ **改本檔 `PY_MIN` 就要一起改那裡**,否則 CI 會再次恆紅 —— **雖然可由錯誤訊息定位**
 *     (codex R1 N2:那個紅會印「本閘需要 >= X.Y,實得 Z」,不是無頭紅;原句寫「沒有人知道為什麼」
 *     過度宣稱了)。而那邊釘的是 **3.14 這條 minor 線**,不是釘死某個 patch。
 *   🔴 **而上面那段「今天不咬人 + 三個理由」自己就過期了,這裡記一筆**:三個理由的第一個是
 *     「CI 沒有它」—— 而 CI 後來有了它,那 8 格在 CI 上恆紅(2026-08-21 起),
 *     **而它過期的時候果然沒有發出任何訊號**,正如上一段自己預言的。
 *     ⇒ 這是「**一句過期的『這件事做不了』產生的不是錯誤,是【沒有發生的嘗試】**」的一個標本。
 *   📌 失敗訊息一律帶 `[python <版本>]`,所以版本造成的紅自己說得出原因。
 *
 * 📌 **要數「這道閘守得到幾支 .py」,一律在 repo root 跑 `git ls-files '*.py'`**(codex R2 #4 nit):
 *   `git ls-files` 的分母是**你當下所在的目錄以下**——在 `scripts/storefront-probe/` 跑只會得到 2。
 *   而 lint-staged 的射程是整個 repo ⇒ **量法不固定 root,數出來的就不是這道閘的分母。**
 */

/** 本閘要求的 python3 最低版本。低於它 ⇒ 明確報錯,不靜靜用不同 grammar 解析。 */
const PY_MIN: readonly [number, number] = [3, 14];
function checkPython(file: string, minVersion: readonly [number, number] = PY_MIN): Failure | null {
  const prog = [
    'import ast,sys',
    'p=sys.argv[1]',
    'need=(int(sys.argv[2]),int(sys.argv[3]))',
    'v=sys.version.split()[0]',
    'if sys.version_info[:2] < need:',
    "    sys.stderr.write('python 版本地板未達:本閘需要 >= %d.%d,實得 %s —— 不同版本的 grammar 會給出不同判定(例:t-string 3.14 綠 3.13 紅)' % (need[0],need[1],v)); sys.exit(2)",
    'try:',
    "    src=open(p,'rb').read()",
    'except Exception as e:',
    "    sys.stderr.write('讀不到檔:'+str(e)); sys.exit(1)",
    'try:',
    '    ast.parse(src,p)',
    'except SyntaxError as e:',
    "    sys.stderr.write('line '+str(e.lineno or 0)+': '+(e.msg or 'syntax error')+' [python '+v+']'); sys.exit(1)",
    'except ValueError as e:',
    "    sys.stderr.write('line 0: '+str(e)+' [python '+v+']'); sys.exit(1)",
  ].join('\n');
  const r = spawnSync(
    'python3',
    ['-c', prog, file, String(minVersion[0]), String(minVersion[1])],
    { encoding: 'utf8' },
  );
  if (r.error) return { file, line: null, reason: `python3 無法執行:${r.error.message}` };
  if (r.status === 0) return null;
  const stderr = (r.stderr || '').trim();
  // exit 2 = 版本地板未達。它不是這個檔的問題 ⇒ 訊息不帶行號,免得有人跑去看第 0 行。
  if (r.status === 2) return { file, line: null, reason: stderr || 'python 版本地板未達' };
  const m = stderr.match(/^line (\d+): /);
  // 🔴 行號 0 = Python 給不出行號(編碼 cookie 那類錯就是),落成 null 免得印出 `檔:0` 誤導人去看第 0 行
  const lineNo = m && Number(m[1]) > 0 ? Number(m[1]) : null;
  return {
    file,
    line: lineNo,
    reason: (m ? stderr.slice(m[0].length) : stderr) || `python3 ast.parse exit ${r.status}`,
  };
}

function checkOne(file: string): Failure | null {
  if (!GUARDED_EXT.test(file)) return null;
  const lower = file.toLowerCase();
  if (lower.endsWith('.sh')) return checkShell(file);
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return checkYaml(file);
  if (lower.endsWith('.sql')) return checkSql(file);
  if (lower.endsWith('.py')) return checkPython(file);
  return null;
}

export { checkShell, checkYaml, checkSql, checkPython, checkOne, GUARDED_EXT, PY_MIN };
export type { Failure };

/**
 * 是否為「直接執行」(被 test import 時不該跑 CLI)。
 *
 * 🔴 原本用 `process.argv[1].endsWith('check-syntax-nonts.ts')` 判斷,**那是一個靜默失效的洞**:
 *   經 symlink 或改名呼叫時判斷為 false ⇒ 整支 CLI 不跑、exit 0、**連一行輸出都沒有**
 *   —— 防假綠的計數器自己被同一個洞繞過(2026-08-07 code-reviewer must-fix 1,已實測復現)。
 * 改用 realpath 比對:symlink 兩端都正規化到同一個真實路徑。
 * realpath 失敗(檔被刪等)→ 退回**絕對路徑**比對。
 * 🔴 fallback 必須先 `resolve()`:gate 實際呼叫時 argv1 常是相對路徑
 *   (`tsx scripts/check-syntax-nonts.ts`),裸字串比對必 false = 恰好又是靜默不跑
 *   —— 那會讓上面那句「不靜默」變成宣稱大於能力(2026-08-07 Fable R2 F7)。
 */
const invokedDirectly = ((): boolean => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(argv1) === realpathSync(self);
  } catch {
    return resolve(argv1) === resolve(self);
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
