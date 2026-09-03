// migration-new-file-gate.test.ts — 「新增的 .sql 會不會真的被靜態檢查擋下」的**真效果測**。
//
// 🔴 為什麼要有這一支(2026-08-24 線3 立):
//   `scripts/migration-new-file-static-checks.sh --selftest` 已經證明**那支腳本自己**會擋
//   (A/M 雙向 + 多檔 + 該綠必綠,4/4)。但它證不到中間那一層:
//   package.json 的 `supabase/migrations/*.sql` 這條 lint-staged entry
//   —— **有人把那一行刪掉,腳本仍然 4/4 全綠,而新的 migration 從此沒有人檢查。**
//   當場量到的分母:全 repo 提到 `migration-new-file-static-checks` 的是 **4 個檔 / 9 行**
//   (package.json **兩條** entry〔接線那條 + `--selftest` 那條〕、腳本自己、兩支 migration 的註解)。
//   ⚠️ **那是 2026-08-24 的量;2026-08-27 現量是 7 檔 / 18 行**(多了三支 migration 的註解)。
//   📌 句子有標日期, 而**它讀起來像現值** —— 帶日期不等於讀者會把它讀成過去式。
//   🔴 而「零守門」只對**接線那一條**成立 —— `--selftest` 那條守的是**腳本本體**,不守接線。
//      (審查 2026-08-24 更正:原句寫「只有 4 處」把 package.json 的第二條蓋掉了。)
//   形狀 = memory `feedback_a-fail-open-guard-hides-whether-it-is-installed`
//         + 隔壁 `check-syntax-nonts.gate.test.ts` 檔頭那句「守門存在 ≠ 守門接著」。
//
// 🔴 怎麼避免變成抄本測試(照抄隔壁那支的紀律):
//   scratch repo 的 lint-staged 設定**整包從主 repo 讀進去**,不手抄、不挑 key、不正規化。
//   ⇒ 主 repo 的 glob 打錯、entry 被刪、命令改指別的檔,這裡都會紅。
//
// ⚠️ **誠實邊界(不要讀成比它大)**:
//   · 它證的是「這條路通」,不是「四道靜態檢查都對」—— 那是 `migration-static-checks.sh --selftest`(29/29)的事。
//   · 只餵規則②那一種違規。其餘三道規則的接線由同一條路走 ⇒ 通了就是通了,但本檔沒有各餵一發。
//   · 走的是 `lint-staged` 這一層,**不是 `.husky/pre-commit`**。
//     🔴 **2026-08-24 審查更正**:~~原句寫「pre-commit 有沒有呼叫 lint-staged 由
//     `scripts/husky-hook-wiring-check.sh` 管」—— 那是假的~~。那支管的是
//     「`.husky/*.sh` 那幾行有沒有接 `|| exit $?`」,它檔內唯一那句 `pnpm exec lint-staged`
//     在自檢 fixture 的 heredoc 裡。真正釘住那一環的是
//     `scripts/check-syntax-nonts.gate.test.ts`(字面錨 `存在性釘,非效果證明`)。
//     ⚠️ 這種句子的作用是**關掉下一個人的尋找動作** ⇒ 指錯比不指更貴。
//
// ✅ **2026-08-27 已修:本檔現在 3 綠。** 底下那段「2 格是紅的」是**當時的狀態**, 留著不刪 ——
//    **它記的是成因與一次錯誤歸因, 而那比「現在幾綠」有用得多。**
//    修法與它的價格寫在 `beforeAll` 裡(錨:`TRUTH_SYNC_PATH_CONSTANTS`)。
//    🔴 **而那 2 格紅在 CI 上活了 30+ 小時而沒有人被通知** —— 那一半沒修, 也不是本檔修得掉的。
//
// 🔴🔴 **2026-08-27(修之前的狀態):本檔有 2 格是紅的, 而 `7228d8d0` 的 commit body 把成因寫錯了。**
//
//   那顆 body 逐字說這 2 格紅是「那支測試讀的是 index, 而 index 上是別窗 staged 的兩支 migration
//   (`20260826150000` / `20260826160000`)」⇒ 🔴 **那是假的。**
//
//   真成因(2026-08-27 開檔看的, 不是推的):擋下來的是**另一道檢查**, 它印 `FileNotFoundError`
//   並點名三支檔 —— `supabase/migrations/20260806180000_…_shipped_recompute_wire.sql` /
//   `docs/runbooks/a4a-summary-rollback.md` /
//   `supabase/migrations/20260813120000_…_procurement_void_schema.sql`。
//   **而這三支在真 repo 裡都存在**(逐支 `test -e` ⇒ 存在)⇒ 是這支 harness 的**暫時工作區**看不到它們。
//   ⇒ 於是「有擋到」而**歸因失敗**, 斷言逐字「擋下來了,但不是規則②擋的 ⇒ 本格失去歸因」。
//
//   🔴 **判別法(自帶, 不要相信上面這段字 —— 一句話會過期, 一條指令不會):**
//   ```
//   git diff --cached --name-only | wc -l     ⇒ 印 0(index 乾淨)時這 2 格【仍然紅】
//                                              ⇒ 與 index 無關, 也與任何別窗無關
//   ```
//   實測時序:`b7af8f76` 之後 index 已清空(`⇒ 0 行`), 單獨重跑本檔 ⇒ 仍 `2 failed | 1 passed (3)`。
//
//   📌 **而這一格真正該記的不是「成因寫錯了」, 是它為什麼活得下來:**
//      那顆 body 的**結論**(外因、非該片可修)**碰巧是對的** ——
//      **結論對, 就沒有人會回來查理由。**
//      作者(線1)自陳成因:「我看到 index 上有兩支 migration、而這支測試名字裡也有 migration,
//      **就停在那裡了**。」⇒ memory `feedback_相關但錯的源會關掉懷疑` 的新實例。
//   ⚠️ **本段只訂正成因, 不宣稱這 2 格該怎麼修** —— 那要能讓 harness 的暫時工作區看到那三支檔,
//      而那是 `scripts/` 那條線的面, 不是線1 的。**未修, 未指派。**
//
// 🔴🔴 **2026-08-27 第三次訂正:上面那段【也是錯的】, 而它現在全綠。**
//
//   `f4b36ea2` 訂正了 `7228d8d0`(說成因是 index), 改成說「harness 的暫時工作區看不到那三支檔」。
//   **而那三支檔在整批 64 顆未推的 commit 裡, 一顆都沒有被動過**
//   (`git log --oneline origin/dev..HEAD -- <三支> | wc -l` ⇒ 各 **0**)。
//   **它們沒變, 而測試從紅變綠** ⇒ **那個成因解釋不了這件事。**
//
//   現在的量測(2026-08-27, 整批安全檢查時):
//   ```
//   連跑三發 ⇒ Tests 3 passed (3) / 3 passed / 3 passed
//   當下狀態:git diff --cached --name-only | wc -l ⇒ 0 ;git status --porcelain | wc -l ⇒ 4
//   而它紅的那時:index 有 2 支 staged, 工作樹髒 9+ 支
//   ```
//   ⇒ **變的是【工作樹有多髒】, 而我前兩次分別說是「index」與「那三支檔」—— 兩次都指錯了變數。**
//     (機制推測:`lint-staged` 會 `git stash` 掉未提交的東西, 而那會改變 scratch repo 看得到什麼。
//      🔴 **這是推測, 我沒有做對照實驗** —— 要證明它得刻意弄髒工作樹再跑一次, 而那會影響別的窗, 我沒做。)
//
//   📌 **這一格真正的教訓不是「成因是什麼」, 是【我對同一個紅講錯了兩次, 而第二次我有把握到去 commit 一份訂正】。**
//      ⇒ 現在這一段也可能是錯的。**它與前兩段唯一的差別是:它明說自己是推測, 而且說得出缺哪一道檢查。**
//      ⇒ 缺的那道檢查:**弄髒工作樹 ⇒ 重跑 ⇒ 看它會不會紅。** ~~沒有人做過。~~ **⇒ 見下面第四次訂正:不必做了。**
//
// ✅ **2026-08-27 第四次訂正(線1 · 21 窗, 壓縮復工後):真成因【已經有人量到了】, 而它不是我猜的那三個。**
//
//   真成因與修法就在同一支檔的 `beforeAll` 裡(錨 `TRUTH_SYNC_PATH_CONSTANTS`):
//   `ee4bdf27` 把一條 lint-staged entry 的 glob 從【兩支具名 migration】放寬成
//   `supabase/migrations/*.sql` ⇒ 本檔餵進去的新 migration 也叫起 `b2s2b-truth-sync.py`
//   ⇒ scratch repo 沒有它要讀的四支真實檔 ⇒ FileNotFoundError ⇒ lint-staged 整個 task 被 kill
//   ⇒ **規則② 根本沒跑到**, 症狀因此長成「有擋到但歸因失敗」。
//   量到的是 **b4 窗**(2026-08-27), **de 窗** 複量。**我不是量的人, 我是回來關掉自己那句話的人。**
//
//   🔴 **它的成因比我的三個強在哪**:它有**介入證據** —— 照它修(把那四支複製進 scratch)⇒ 綠。
//      我的三個(index / 那三支檔 / 工作樹有多髒)**一個都沒有介入過**, 全是從相關性推出來的。
//      📌 **「我說得出一個機制」與「我動了那個機制而它變了」是兩件事。**
//
//   📌 **而這一格最該記的是它怎麼被發現的**:我把「沒有人知道成因」寫成交接檔的頭號未結項,
//      交出去、壓縮、復工 —— **而在那段時間裡它已經被關掉了, 沒有任何東西通知那句話。**
//      **一個被關掉的問題, 不會自己去通知那些還在引用它的句子。**
//      ⇒ 判別句:**接一份交接檔時先問「這些未結項在我離開的那段時間裡有沒有已經被關掉」, 再排工。**

// 成本:scratch repo 建一次;每格 spawn 一次 lint-staged(node 冷啟動)。

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, readFileSync, copyFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

// 🔴 逾時放寬的理由與隔壁同一條:多窗夜跑時機器負載會讓 node 冷啟動變慢,
//    而 `Test timed out` 與真的紅在畫面上長得一樣。判別法:
//    錯訊息是 `Test timed out` ⇒ 負載,單獨重跑;是 `AssertionError` ⇒ 才去讀 diff。
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const REPO = resolve(process.cwd());
const LINT_STAGED = join(REPO, 'node_modules/.bin/lint-staged');
const GLOB_KEY = 'supabase/migrations/*.sql';

/** 規則②違規:開了交易卻中途 COMMIT。 */
const BAD_SQL = 'BEGIN;\nSELECT 1; COMMIT;\nSELECT 2;\nCOMMIT;\n';
/** 同形狀但乾淨 —— 負對照,證明這道閘不是恆紅。 */
const GOOD_SQL = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
/** 規則②紅掉時**只有它會印**的字面。用它而不是用 exit code:
 *  非 0 有很多來源(腳本找不到 ⇒ 127、lint-staged 自己壞掉 ⇒ 1),
 *  而「紅錯地方」與「擋下來了」的 exit code 是同一個。 */
const RULE2_MARK = '預期恰好 1';

let scratch: string;

type GateResult = { status: number; out: string };

/**
 * 🔴 繼承來的 `GIT_*` 會讓底下的 `git add` 寫進**外層那次 commit 的 index**
 *    (`docs/patterns/mutation-harness-restore.md` §4e;`migration-new-file-static-checks.sh`
 *     字面錨 `unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE` 已為同一件事明文防過)。
 *    今天不可達(`.husky/*` 裡沒有人跑 vitest),而這棵樹同時有別的窗在準備 commit
 *    ⇒ **不可達不是理由,清掉它。**
 */
const GIT_ENV = { ...process.env } as Record<string, string | undefined>;
for (const k of [
  'GIT_INDEX_FILE',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
])
  delete GIT_ENV[k];

function git(args: string[]) {
  return spawnSync('git', args, { cwd: scratch, encoding: 'utf8', env: GIT_ENV });
}

function stageAndRunGate(name: string, content: string): GateResult {
  const rel = `supabase/migrations/${name}`;
  writeFileSync(join(scratch, rel), content, 'utf8');
  const add = git(['add', rel]);
  if (add.status !== 0) throw new Error(`git add 失敗:${add.stderr}`);

  const r = spawnSync(LINT_STAGED, [], { cwd: scratch, encoding: 'utf8', env: GIT_ENV });
  // 🔴 spawn 本身失敗必須拋,不可落成一個「非 0」的假退出碼(隔壁 must-fix 2 的同一個坑)。
  if (r.error) throw r.error;
  if (r.status === null) throw new Error('lint-staged 被訊號中止、沒有退出碼');

  git(['reset']);
  rmSync(join(scratch, rel), { force: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  // 🔴🔴 2026-08-27:**分得開「規則②沒擋」與「別的 task 先炸、把它 SIGKILL 了」。**
  //    那正是 CI 紅 30+ 小時那次的形狀 —— 當時的斷言訊息寫「擋下來了, 但不是規則②擋的」,
  //    而真兇是另一個 task 的 `FileNotFoundError`。**那句話誤導了兩輪歸因。**
  //    ⇒ 這種輸出不是「本格失去歸因」, 是 **fixture 級的壞**, 要指名真兇。
  //    ⚠️ **偵測要指名【本閘自己】被殺, 不能只看有沒有 `[SIGKILL]`** ——
  //       閘正確擋下的時候, lint-staged 會把**兄弟 task** 殺掉(實測:`check-syntax-nonts.ts [SIGKILL]`)
  //       ⇒ 只看 `[SIGKILL]` 會把【擋對了】判成【fixture 壞了】。
  //       📌 **那正好是這道偵測自己要防的病:分不出兩個世界。第一版我寫錯了, 而它一裝就把該綠的弄紅。**
  const gateKilled = /migration-new-file-static-checks\.sh[^\n]*\[SIGKILL/.test(out);
  if (gateKilled || out.includes('FileNotFoundError')) {
    throw new Error(
      'fixture:本閘自己被 SIGKILL / 或有別的 task 印了 FileNotFoundError ⇒ 本格的紅【不是規則②沒擋】。\n' +
        '真兇在下面這段輸出裡(找 [FAILED] 那幾行):\n' +
        out,
    );
  }
  return { status: r.status, out };
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'mig-gate-e2e-'));
  // 🔴 fixture 每一步都檢 status(審查 nit 5):fixture 建置失敗時的症狀是
  //    「lint-staged 詭異地紅」,而那讀起來像**閘抓到東西**。要讓它說出自己壞了。
  const must = (label: string, args: string[]) => {
    const r = spawnSync('git', args, { cwd: scratch, encoding: 'utf8', env: GIT_ENV });
    if (r.status !== 0) throw new Error(`fixture ${label} 失敗(rc=${r.status}):${r.stderr}`);
  };
  must('git init', ['init', '-q']);
  must('config email', ['config', 'user.email', 'gate-test@local']);
  must('config name', ['config', 'user.name', 'gate-test']);
  must('config gpgsign', ['config', 'commit.gpgsign', 'false']);

  // 🔴 整包搬,不挑 key —— 挑 key 就等於把「別的 entry 會不會互相干擾」這件事偷偷排除掉。
  //    (實際會干擾:一支 `.sql` 現在會叫起**三個** task —— `*.{sh,yaml,yml,sql,py}` 那條、
  //     `b2s2b-truth-sync.py` 那條(`ee4bdf27` 放寬後才有的)、以及本檔要測的 new-file 那條。
  //     ~~原句寫「兩個 task」~~ 2026-08-27 實跑是三個, 而**那句正好是解釋本次事故的那句**
  //     ⇒ 不改它, 下一個人會再算錯一次。)
  const mainPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    // 值可能是字串或字串陣列 —— 見下方 GLOB_KEY 那格的說明。
    'lint-staged': Record<string, string | string[]>;
  };
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'mig-gate-e2e', 'lint-staged': mainPkg['lint-staged'] }, null, 2),
    'utf8',
  );

  symlinkSync(join(REPO, 'node_modules'), join(scratch, 'node_modules'));
  // 整個 scripts/ 掛過去:命令字串改指別支腳本時,那支也在 ⇒ 本檔不會因為「檔不在」而紅錯地方。
  symlinkSync(join(REPO, 'scripts'), join(scratch, 'scripts'));
  mkdirSync(join(scratch, 'supabase/migrations'), { recursive: true });

  // 🔴🔴 2026-08-27:`ee4bdf27` 把另一條 lint-staged entry 的 glob 從【兩支具名 migration】
  //    放寬成 `supabase/migrations/*.sql` ⇒ **本檔餵進去的新 migration 現在也會叫起
  //    `python3 scripts/b2s2b-truth-sync.py .`**,而那支要讀三支真實檔。
  //    本 scratch repo 沒有它們 ⇒ FileNotFoundError x9 ⇒ lint-staged 整個 task 被 kill
  //    ⇒ **規則② 根本沒跑到**, 而症狀是「有擋到但歸因失敗」。CI 因此紅了 30+ 小時。
  //    (成因由 b4 窗 2026-08-27 量到;下手窗 de 複量:本機 `2 failed | 1 passed`、
  //     `git show ee4bdf27 --stat` = package.json 一行。)
  //
  //    ⇒ 修法照本檔既有紀律【不手抄】:**從那支腳本自己宣告的路徑常數讀出來**, 再從真 repo 複製過來。
  //
  //  🔴 它宣告的是【四支】不是三支(code-reviewer 2026-08-27 抓到我原本寫「三支」):
  //     `MIG` / `MIG452` / `RB` / **`AV = 'scripts/a4a-verify.sh'`**(`b2s2b-truth-sync.py:66`
  //     的 `BLOCKS_PER_FILE = {MIG: 2, RB: 3, AV: 1, MIG452: 1}` 才是完整清單)。
  //     **AV 今天沒有炸, 只是因為它碰巧落在上面那行 symlink 過去的 `scripts/` 底下。**
  //     📌 **「它在」與「我知道它為什麼在」是兩件事, 而前者不會提醒你後者。**
  //
  //  🔴 **個數釘住**:抓到的不是 `TRUTH_SYNC_PATH_CONSTANTS` 支就 throw。
  //     ~~只擋「全部消失」~~ 擋不住**最可能發生的那兩種**:其中一個改名(仍抓到 3 支 ⇒ 不 throw
  //     ⇒ **安靜地回到今天這個狀態**)、或有人加第四第五支。
  //
  //  ⚠️ **這個修法的價格, 明寫**:本檔的綠從此綁在「真 repo 的 b2s2b 真相同步維持全綠」上。
  //     有人合法改 `SHIPPED-TRUTH` 區塊而忘了同步 `BLOCKS` 凍結值 ⇒ **本檔跟著紅, 而訊息指向規則②**。
  //     (另兩條路我沒選:甲 = truth-sync 找不到檔就 skip ⇒ **fail-open**;
  //      乙 = 把 package.json 那條 glob 收回具名 ⇒ 撤銷 `ee4bdf27` 的用意, 且不在本窗檔案面。)
  const TRUTH_SYNC_PATH_CONSTANTS = 4;
  const truthSrc = readFileSync(join(REPO, 'scripts/b2s2b-truth-sync.py'), 'utf8');
  const truthPaths = [...truthSrc.matchAll(/^[A-Z][A-Z0-9_]*\s*=\s*'([^']*\/[^']*)'/gm)]
    .map((m) => m[1])
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (truthPaths.length !== TRUTH_SYNC_PATH_CONSTANTS) {
    throw new Error(
      `fixture:scripts/b2s2b-truth-sync.py 的路徑常數抓到 ${truthPaths.length} 支, 期望 ${TRUTH_SYNC_PATH_CONSTANTS} 支。` +
        '常數被改名 / 新增 / 刪除了 ⇒ 請開那支檔核對(看 BLOCKS_PER_FILE 那一行才是完整清單), ' +
        '再更新這裡的期望值與下面的複製邏輯。' +
        '🔴 不要只把這個數字調成實際值就算了 —— 它變了代表 lint-staged 那條鏈要讀的【檔集合】變了。',
    );
  }
  const copiedTruthFiles: string[] = [];
  for (const rel of truthPaths) {
    // `scripts/` 底下的由上面那行 symlink 覆蓋 ⇒ **不要複製**:
    // `join(scratch, rel)` 會【穿過 symlink 寫回真 repo】。(實測是 no-op 自我複製、不截斷,
    //  而依賴那個行為是運氣, 不是設計。)
    if (rel.startsWith('scripts/')) continue;
    mkdirSync(join(scratch, dirname(rel)), { recursive: true });
    try {
      copyFileSync(join(REPO, rel), join(scratch, rel));
    } catch (e) {
      // 照本檔 `must()` 的紀律:fixture 建不起來要說出自己壞了, 不要看起來像閘抓到東西。
      throw new Error(`fixture 複製 ${rel} 失敗:${String(e)} —— 這不是閘壞了, 是 fixture 建不起來。`);
    }
    copiedTruthFiles.push(rel);
  }

  // 🔴🔴 **第二支依賴真實檔的消費者:`python3 scripts/verify-cron6-md5.py`**
  //    `ee4bdf27` 把 glob 放寬成 `supabase/migrations/*.sql` 之後, 本檔餵進去的新 migration
  //    也會叫起它;而 `1720f25e` 把它從「寫死六支」改成【基準集決定成員】之後,
  //    它要讀的是 **`scripts/migration-self-md5-baseline.txt` 裡列的每一支 + 校準塊 `L3A`**。
  //    ⇒ 那些檔不在 scratch 裡 ⇒ `FileNotFoundError` ⇒ 整條 lint-staged 紅
  //    ⇒ 🛑 而本檔 `stageAndRunGate` 會認出它並 throw「fixture:…」——
  //       **那不是誤報, 是它正確地拒絕在量不到的時候印綠。**(實錘:CI run 33780749129)
  //
  //  ⚠️ **兩條我沒選的路, 明寫**:
  //    甲 = 讓 `verify-cron6-md5.py` 對「檔不存在」改成 skip ⇒ 🔴 **fail-open** ——
  //         而那正是基準集這個設計要防的那件事(基準集的存在理由就是【集合不得變短】)。
  //    乙 = 把 package.json 那條 glob 收回具名 ⇒ 撤銷 `ee4bdf27` 的用意, 且不在本窗檔案面。
  //  ⇒ ✅ 選丙 = 跟 truth-sync 同一個做法:**把它要讀的檔一起搬進 scratch**。
  //
  //  🔵 **而這裡【刻意不釘數量】**, 與上面 truth-sync 那格不同 ——
  //     truth-sync 的路徑常數變動 = 異常;而**基準集【本來就會長】**(加一行 = 多保護一支)。
  //     釘住它 ⇒ 每次有人合法加一行, 本檔就紅一次 ⇒ 🛑 **那種閘會死於誤報, 然後被關掉。**
  //     ⇒ 取而代之:抽到 0 支才 throw(那代表抽法壞了, 不是集合空了)。
  const cronSrc = readFileSync(join(REPO, 'scripts/verify-cron6-md5.py'), 'utf8');
  const baselineSrc = readFileSync(join(REPO, 'scripts/migration-self-md5-baseline.txt'), 'utf8');
  const cronDeps = [
    // 校準塊:`L3A = 'supabase/migrations/…sql'`
    ...[...cronSrc.matchAll(/^[A-Z][A-Z0-9_]*\s*=\s*'(supabase\/migrations\/[^']+)'/gm)].map((m) => m[1]),
    // 基準集:一行一格 `<migration 檔名>\t<函式名>`,取第一欄
    ...baselineSrc
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
      .map((l) => `supabase/migrations/${l.split('\t')[0]!.trim()}`),
  ].filter((v, i, a): v is string => typeof v === 'string' && a.indexOf(v) === i);
  if (cronDeps.length === 0) {
    throw new Error(
      'fixture:從 verify-cron6-md5.py + 基準集抽到 0 支 migration 依賴。' +
        '⇒ 抽法壞了(常數改名 / 基準集格式變了), **不是**「它不再依賴真實檔」。' +
        '🔴 不要把這個 throw 改成 skip —— 那會讓本檔在量不到的時候印綠。',
    );
  }
  for (const rel of cronDeps) {
    mkdirSync(join(scratch, dirname(rel)), { recursive: true });
    try {
      copyFileSync(join(REPO, rel), join(scratch, rel));
    } catch (e) {
      throw new Error(`fixture 複製 ${rel} 失敗:${String(e)} —— 這不是閘壞了, 是 fixture 建不起來。`);
    }
    copiedTruthFiles.push(rel);
  }

  writeFileSync(join(scratch, 'README.md'), '# mig gate e2e\n', 'utf8');
  must('add README', ['add', 'README.md']);
  // 進 init commit。⚠️ **理由不是「不然會紅」** —— code-reviewer 2026-08-27 實測:
  //    複製但不 `git add`(留 untracked)⇒ 每一格結果**與現版逐格相同**
  //    (lint-staged 只看 staged;`migration-new-file-static-checks.sh:33` 也只看被傳進來的那支)。
  //    ⇒ 保留 `git add` **只為了 scratch 乾淨**, 不是判別力來源。~~原本我寫的理由是錯的。~~
  must('add truth-sync files', ['add', '--', ...copiedTruthFiles]);
  must('commit init', ['commit', '-q', '-m', 'init']);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('lint-staged → migration-new-file-static-checks 真效果測', () => {
  it('前提:主 repo 的 lint-staged 真的有這條 entry,且命令指向那支入口', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      // 🔴 lint-staged 的值可以是【字串】也可以是【字串陣列】(一個 glob 掛多支指令)。
      //    2026-09-02:`fc985d4e` 把這一格從字串改成陣列 ⇒ 下面那發 `toContain` 的語意
      //    從【子字串比對】靜靜變成【元素相等比對】⇒ 紅。
      //    🛑 而原本寫 `Record<string, string>` 時 typecheck 一聲都沒有 ——
      //       它是 `JSON.parse` 上的一個 cast ⇒ **這個型別註記的作用是【關掉編譯器】,
      //       不是【描述事實】。**
      'lint-staged': Record<string, string | string[]>;
    };
    expect(
      Object.keys(pkg['lint-staged']),
      `lint-staged 少了 \`${GLOB_KEY}\` ⇒ 新增的 .sql 不會被任何東西檢查,而 commit 全程安靜`,
    ).toContain(GLOB_KEY);
    // 先正規化成陣列(值可以是字串, 也可以是一個 glob 掛多支指令的陣列),
    // 再問「有沒有一支指令【就是】那支入口」。
    // 🔴 不用 `JSON.stringify(...).toContain(名字)`:那樣 `echo migration-new-file-static-checks.sh`
    //    或任何把那串字放進註解/參數的指令都會通過 ⇒ 那是【偽陽性】, 而它印綠。
    //    (codex 對抗審查 2026-09-02 抓到;第一版修法就是那個形狀。)
    const ENTRY = 'bash scripts/migration-new-file-static-checks.sh';
    // `?? []` 是給 noUncheckedIndexedAccess 的:key 不存在時得到空陣列
    // ⇒ 下面那發會紅並印出「實得:[]」, 而不是丟 TypeError。
    const raw = pkg['lint-staged'][GLOB_KEY] ?? [];
    const cmds: string[] = Array.isArray(raw) ? raw : [raw];
    expect(
      cmds.filter((c) => c === ENTRY || c.startsWith(`${ENTRY} `)),
      `\`${GLOB_KEY}\` 沒有一支指令是 \`${ENTRY}\` ⇒ 新增的 .sql 沒有人檢查`
        + `(實得:${JSON.stringify(cmds)})`,
    ).not.toHaveLength(0);
  });

  it('🔴 該紅:新增一支違反規則②的 migration ⇒ 被擋,而且是【規則②】擋的', () => {
    const r = stageAndRunGate('20200202000000_l3_bad.sql', BAD_SQL);
    // 🔴 兩件事要分開驗:「有沒有被擋」與「【誰】擋的」是兩個宣稱
    //    (memory `feedback_which-gate-blocked-you-is-the-measurement`)。
    expect(r.status, `該擋沒擋 ⇒ 輸出:\n${r.out}`).not.toBe(0);
    expect(r.out, `擋下來了,但不是規則②擋的 ⇒ 本格失去歸因:\n${r.out}`).toContain(RULE2_MARK);
  });

  // 🔴🔴 **本格第一版是【恆綠】的,2026-08-24 審查 must-fix 2 抓到 —— 形狀就是本片在獵的那個。**
  //    原版只斷 `status === 0` 與「沒印規則②的字面」。而 lint-staged **成功時完全不印 task 輸出**
  //    ⇒ 「entry 被刪、task 根本沒跑」那個世界**印出一模一樣的東西** ⇒ 零判別力。
  //    📏 兩個世界的差別在 lint-staged 自己的進度行(實測,不是推的):
  //      接線在   ⇒ `supabase/migrations/*.sql — 1 file`  出現 2 次
  //      接線拿掉 ⇒ 出現 0 次
  //    ⚠️ **不要拿 `migration-new-file-static-checks` 當錨** —— `--selftest` 那條 entry 的 key
  //       在**兩個世界都會印**(各 1 次),抓它等於沒抓(審查點名的誘餌)。
  it('✅ 該綠:乾淨的新 migration 放行,**而且那個 task 真的跑到它**(不是沒跑所以綠)', () => {
    const r = stageAndRunGate('20200203000000_l3_ok.sql', GOOD_SQL);
    // ① 那條 task 真的認領了我們的檔 —— 少了這句,下面兩句在「沒跑」時照樣綠
    expect(
      r.out,
      `lint-staged 沒把這支 .sql 交給 \`${GLOB_KEY}\` ⇒ 它根本沒被檢查,` +
        `而「檢查過了」與「沒東西可檢查」在 exit code 上長得一樣:\n${r.out}`,
    ).toContain(`${GLOB_KEY} — 1 file`);
    // ② 跑了, 而且放行(不是恆紅的閘)
    expect(r.status, `乾淨的檔被擋 = 誤擋 ⇒ 下一個人會學會繞過它:\n${r.out}`).toBe(0);
    expect(r.out).not.toContain(RULE2_MARK);
  });
});
