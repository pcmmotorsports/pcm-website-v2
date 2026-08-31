// check-syntax-nonts.gate.test.ts — commit gate 的「真效果測」(backlog #340)。
//
// 🔴 為什麼要獨立於 check-syntax-nonts.test.ts:
//   那支測的是**純函式**與**直接呼叫 CLI**;它們全綠,不代表 `lint-staged` 這一層真的會把
//   壞檔擋下來。中間還隔著:package.json 的 glob 比對(micromatch)、lint-staged 把檔名 append
//   到命令後的方式、cwd/PATH 能不能解析 `tsx`。那一層原本**零測試**
//   —— Fable R2 F2 點名,形狀 = memory `feedback_guard-checks-existence-not-effect`
//   (守門存在 ≠ 守門接著)。原本只有一格「讀 package.json 斷言字面」的**存在性釘**。
//
// 🔴 這支怎麼避免變成另一個抄本測試:
//   scratch repo 的 lint-staged 設定是**從主 repo 的 package.json 讀進去的**,不是手抄。
//   被呼叫的腳本路徑也是**從那個命令字串抽出來**的,不是硬編。
//   ⇒ 主 repo 的 glob 打錯、entry 被刪、命令被改壞或改指別的檔,這裡都會紅。
//
// 🔴 本支自己踩過的兩個恆真面(2026-08-07 code-reviewer must-fix,已修,測試留下形狀):
//   ①「.md 不被攔」那格原本斷 exit=0 —— 但 glob 放寬成 `*` 時,腳本仍因 GUARDED_EXT 不匹配而 skip、
//     照樣 exit 0 ⇒ 任何 glob 突變都紅不了它。改斷 stdout 的 `could not find any staged files`。
//   ②`r.status ?? -1` + `not.toBe(0)`:spawnSync 對不存在的 binary 回 status=null(ENOENT),
//     落成 -1 後「壞檔被擋」在 **gate 根本沒被 spawn** 時照樣綠。改成 error 直接拋 + 斷 exit===1。
//
// ⚠️ **看到 skipped 不要當成通過**:若主 repo 的 entry key 改掉,`beforeAll` 會 throw,
//   vitest 把 9 格顯示成 `skipped` 而非 `failed` —— 但 **exit code 實測為 1**,全套會紅、不是假綠。
//
// 成本:scratch repo 在 beforeAll 建一次;每格跑一次 `lint-staged`(~600ms,全是 node 啟動)。
//   刻意逐副檔名各一發而非合併成一發 —— 合併會失去歸因(glob 只掉 sql 時要能只紅 sql 那格)。

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

// 🔎 **在 debug「怎麼寫到別的 repo / 別棵樹去了」「git 的設定被誰改掉了」的人:你要找的就是這一段。**
//    (症狀字寫在這裡是刻意的 —— 會來查的人搜的是【症狀】, 不是 `GIT_DIR` 這個變數名。)
// 🔴🔴 **繼承來的 `GIT_*` 會讓底下每一個 `git …` 寫到【外層那棵樹】,而不是 `cwd` 指的那個。**
//    `GIT_DIR` 贏過 `cwd` —— 而本檔跑的是 `git config user.email` / `git add` / `git commit`。
// 📌 **2026-08-31 這件事今晚【真的發生過】**:另一條線的 selftest 用 `git -C <tmp> config user.name t`,
//    而 hook 底下 `GIT_DIR` 指著真 repo ⇒ **全隊八個窗的 git 身分被改成 `t`**(`probe → t → probe`)。
// ✅ 本檔的雙世界實測(拋棄式 victim repo,`mktemp -d`,不是本 repo):
//    不剝 ⇒ victim 的 `user.email` 從 `VICTIM@keep.me` **變成 `t@l`**
//    剝了 ⇒ victim **不變**,而內層那個 repo **仍然被正確設到** ⇒ 不是「什麼都沒做」。
// 🔵 **而這裡刻意【不用】姊妹檔 `migration-new-file-gate.test.ts` 那個「每個呼叫點傳 env」的寫法。**
// ⚠️ **而【姊妹檔那個寫法不是錯的】—— 它有自己的射程,我寫出來,免得下一個人以為它該被換掉:**
//    ✅ **呼叫點少、而且集中在一個 helper 裡** ⇒ 每個呼叫點傳 `env` 是對的:
//       它把「用了乾淨的 env」寫在**看得見的地方**,而模組層的 `delete` 是隱形的
//       (讀那一行 `spawnSync('git', …)` 的人,不會知道 `process.env` 已經被動過)。
//    🔴 **而本檔不是那個條件**:8 / 15 個呼叫點、散在各個 `it` 裡。
// ⛔ ~~而漏掉的機率與呼叫點數成正比(檔案會長)~~
// 🔴 **2026-08-31 訂正 —— 我把那個理由量了一發,而【資料不支持它】**:
//    `git log --follow` 逐顆數非註解的 `spawnSync(` ⇒
//      `migration-new-file-gate` **3 → 3**(08-24 起)· 本族兩支 **8 → 8** / **15 → 15**(08-07 起,24 天沒動)
//    ⇒ 📌 這三支**不是「會長」,是【已經定型】** —— 而照上面那條判準,定型的檔反而該用姊妹檔那個寫法。
// ✅ **⇒ 所以真正站得住的理由要換一個,而它在【導入期】不在【維護期】**:
//    要一次把 **15 個散在各個 `it` 裡**的呼叫點【全部】改對。
//    而事實是:這兩支在 08-07 到 08-31 的 **24 天裡一個保護都沒有** ——
//    **那不是因為有人漏了一個,是因為【沒有人做那 15 次】。**
//    ⇒ 🔵 模組層那一行做完就是做完了;15 次修改是一件永遠排不進去的事。
// 📌 **⇒ 所以差別不在誰比較好,在【呼叫點的數量與集中度】** ——
//    而**一個成例的可行性,綁在它當初那支檔的規模上,而抄它的人不會知道那個規模。**
//    (`-48` 2026-08-31 的話,我原樣收。)
// ⇒ 本檔選**機制**:在模組載入時把六個 `GIT_*` 從 `process.env` 拿掉
//   ⇒ **之後新增的呼叫點自動被保護,不必有人記得。**
for (const k of [
  'GIT_INDEX_FILE',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
])
  delete process.env[k];


// 🔴 **容差,不是斷言**(2026-08-18 W1;主視窗准、Sean FYI)。斷言一個字沒有變。
//    每一格 spawn 一次 `lint-staged`(node 冷啟動 × 2),而本檔原本吃 vitest 預設 `testTimeout` 5000ms。
//    ⚠️ **檔頭那句「~600ms」是舊的**:2026-08-18 11:0x 在本機單檔實測逐格
//       9ms / 7140ms / 1218ms / 1992ms / 1624ms / 1240ms / 1192ms / 518ms / 1ms
//       ⇒ 常態 1.2–2.0s(不是 0.6s),**而其中一格當場就衝到 7140ms 並且紅了** —— 單檔跑、非全套。
//    ⇒ 5000ms 的真實餘裕只有 ~2.5x,不是檔頭暗示的 8x。八個窗共用一台機器時它擋不住。
//    🔴 **假紅的成本不只是重跑:它讓「四綠紅了」這個訊號變得不可信,而那是推之前唯一的閘。**
//       2026-08-18 同一天兩個窗各為它浪費一發四綠(W1 10:19 load 214、W4 10:42 load 100.62)。
//    ⚠️ **這一格【仍然必須抓得到真的壞掉】** —— 改完當場驗過:拆掉 `package.json` 的
//       `*.{sh,yaml,yml,sql}` glob key ⇒ 全套 rc=1(證據貼在 commit body)。
//    📌 判別法(給下一個看到這裡紅掉的人):錯訊息是 `Test timed out in Nms` ⇒ **負載,不是 code**,
//       單獨重跑那幾支、綠就放行;是 `AssertionError` / `expected…to…` ⇒ **那才要去讀 diff**。
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const REPO = resolve(process.cwd());
const LINT_STAGED = join(REPO, 'node_modules/.bin/lint-staged');
// 🔴 大小寫用 [xX] 字元類展開,不是 `sh` —— picomatch 預設 case-sensitive,
//    `BROKEN.PY` / `x.SH` 不匹配 `*.{...,py}` ⇒ lint-staged 根本不呼叫 checker、commit 回綠。
//    `GUARDED_EXT` 的 /i 救不到「沒進 gate」的檔(codex R1 must-fix 3;這個洞比 .py 這片老)。
const GLOB_KEY = '*.{[sS][hH],[yY][aA][mM][lL],[yY][mM][lL],[sS][qQ][lL],[pP][yY]}';

let scratch: string;

type GateResult = { status: number; stdout: string; stderr: string };

/** 在 scratch repo 裡 stage 一個檔,跑一次 lint-staged,回傳結果。 */
function stageAndRunGate(name: string, content: string): GateResult {
  const p = join(scratch, name);
  writeFileSync(p, content, 'utf8');
  const add = spawnSync('git', ['add', name], { cwd: scratch, encoding: 'utf8' });
  if (add.status !== 0) throw new Error(`git add 失敗:${add.stderr}`);

  const r = spawnSync(LINT_STAGED, [], { cwd: scratch, encoding: 'utf8' });
  // 🔴 spawn 本身失敗(binary 不在、權限不足)必須拋,不可落成一個「非 0」的假退出碼 ——
  //    否則「壞檔被擋」會在 gate 根本沒跑的情況下通過(must-fix 2)。
  if (r.error) throw r.error;
  if (r.status === null) throw new Error('lint-staged 被訊號中止、沒有退出碼');

  spawnSync('git', ['reset'], { cwd: scratch, encoding: 'utf8' });
  rmSync(p, { force: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'gate-e2e-'));

  spawnSync('git', ['init', '-q'], { cwd: scratch });
  spawnSync('git', ['config', 'user.email', 'gate-test@local'], { cwd: scratch });
  spawnSync('git', ['config', 'user.name', 'gate-test'], { cwd: scratch });

  // 🔴 關鍵:lint-staged 設定**從主 repo 讀進去**、整包搬,不手抄、不正規化。
  const mainPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    'lint-staged': Record<string, string>;
  };
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'gate-e2e', 'lint-staged': mainPkg['lint-staged'] }, null, 2),
    'utf8',
  );

  // 被呼叫的腳本路徑**從命令字串抽**,不硬編 —— 主 repo 改檔名時這裡要跟著,
  // 否則 tsx 找不到檔 → 壞檔格全綠(訊號在但紅錯地方)。
  const cmd = mainPkg['lint-staged'][GLOB_KEY];
  const scriptRel = cmd?.split(/\s+/).find((t) => t.endsWith('.ts'));
  if (!scriptRel) throw new Error(`從 lint-staged 命令抽不出腳本路徑:${cmd}`);

  symlinkSync(join(REPO, 'node_modules'), join(scratch, 'node_modules'));
  mkdirSync(join(scratch, dirname(scriptRel)), { recursive: true });
  symlinkSync(join(REPO, scriptRel), join(scratch, scriptRel));

  // lint-staged 需要 HEAD 才能做 stash 備份。scratch repo 沒有 .husky,故不需要也不該用 --no-verify。
  writeFileSync(join(scratch, 'README.md'), '# gate e2e\n', 'utf8');
  spawnSync('git', ['add', 'README.md'], { cwd: scratch });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: scratch });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('lint-staged → check-syntax-nonts 真效果測(backlog #340)', () => {
  it('前提:主 repo 的 lint-staged 真的有這條 entry(沒有的話下面全部無意義)', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      'lint-staged': Record<string, string>;
    };
    expect(Object.keys(pkg['lint-staged'])).toContain(GLOB_KEY);
  });

  // ── 壞檔必須被擋。三種副檔名各一發;除了退出碼,也斷「失敗來源真的是這支腳本」──
  it('🔴 壞 .sql staged → gate 擋下(exit=1,且失敗來自本守門)', () => {
    const r = stageAndRunGate('bad.sql', "SELECT * FROM t WHERE n = '沒收尾;\n");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/檢查 1 檔、1 個不過/);
    expect(r.stderr).toMatch(/單引號/);
  });

  it('🔴 壞 .sh staged → gate 擋下(exit=1,且失敗來自本守門)', () => {
    const r = stageAndRunGate('bad.sh', '#!/bin/bash\nif true; then\n  echo hi\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/檢查 1 檔、1 個不過/);
  });

  it('🔴 壞 .py staged → gate 擋下(exit=1,且失敗來自本守門)', () => {
    const r = stageAndRunGate('bad.py', 'def f(:\n    pass\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/檢查 1 檔、1 個不過/);
  });

  // 🔴 巢狀路徑必須也被 glob 吃到 —— repo 裡有 scripts/storefront-probe/*.py 這種。
  //    lint-staged 的無斜線 pattern 比對 basename;這格證明它,不用去讀 lint-staged 的文件。
  it('🔴 巢狀目錄下的壞 .py 也要被擋(量 glob 的深度,不是量退出碼)', () => {
    mkdirSync(join(scratch, 'sub'), { recursive: true });
    const r = stageAndRunGate('sub/bad.py', 'x = (1\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/檢查 1 檔、1 個不過/);
  });

  // 🔴 codex R1 must-fix 3 的那一發。這格【在修 glob 之前是紅的】—— 突變實測見交件。
  //    形狀 = 「守門存在但那個檔根本沒進分母」,GUARDED_EXT 的 /i 完全救不到:
  //    lint-staged 沒把檔名餵進來,腳本連跑都沒跑,commit 一路綠。
  it('🔴 大寫副檔名 BROKEN.PY 的壞檔也要被擋(量 glob 的大小寫,不是量退出碼)', () => {
    const r = stageAndRunGate('BROKEN.PY', 'def f(:\n    pass\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/檢查 1 檔、1 個不過/);
  });

  // 同一個洞的**既有**受害者(比 .py 這片老):`.SH` / `.SQL` / `.YML` 一直都繞得過去。
  it('🔴 大寫 .SH 的壞檔也要被擋(這個洞在 .py 進來之前就存在)', () => {
    const r = stageAndRunGate('BAD.SH', '#!/bin/bash\nif true; then\n  echo hi\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/檢查 1 檔、1 個不過/);
  });

  it('好 .py staged → 放行(exit=0)', () => {
    expect(stageAndRunGate('ok.py', 'import sys\nprint(sys.argv)\n').status).toBe(0);
  });

  it('🔴 壞 .yaml staged → gate 擋下(exit=1,且失敗來自本守門)', () => {
    const r = stageAndRunGate('bad.yaml', 'title: "他說 "這樣" 不行"\n');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/檢查 1 檔、1 個不過/);
  });

  // ── 好檔必須放行。誤擋會逼人 --no-verify,整條 gate 就死了 ──
  it('好 .sql staged → 放行(exit=0)', () => {
    expect(stageAndRunGate('ok.sql', "SELECT * FROM t WHERE n = 'ok';\n").status).toBe(0);
  });

  it('好 .sh staged → 放行(exit=0)', () => {
    expect(stageAndRunGate('ok.sh', '#!/bin/bash\nset -e\necho ok\n').status).toBe(0);
  });

  it('好 .yaml(含多文件)staged → 放行(exit=0)', () => {
    expect(stageAndRunGate('ok.yaml', 'a: 1\n---\nb: 2\n').status).toBe(0);
  });

  // 🔴 這格證明 **glob 真的在挑檔**。
  //    斷 exit=0 是不夠的(那是恆真:.md 就算被 entry 吃下,腳本也會因 GUARDED_EXT skip 而回 0);
  //    斷「lint-staged 說它找不到符合的檔」才真的在量 glob 有沒有把 .md 排除掉。
  it('🔴 .md staged → 這條 entry 根本不該匹配(量 glob 本身,非量退出碼)', () => {
    const r = stageAndRunGate('note.md', '# 隨便寫 " 不平衡的引號 (\n');
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/could not find any staged files/);
  });

  // 最後一哩的存在性釘:gate 要生效,pre-commit 得真的呼叫 lint-staged。
  // ⚠️ 這是**存在性釘不是效果證明**(husky 有沒有被安裝、hook 有沒有執行權限,這格都看不到)。
  // 🔴 要排掉註解行(codex R2 nit):原本 `expect(hook).toMatch(/lint-staged/)` 的分母是**整支檔**,
  //    有人把呼叫改成 `# pnpm exec lint-staged` 之後這格照樣綠 —— 而 gate 已經不跑了。
  //    形狀 = memory `feedback_greps-denominator-is-the-whole-file`(那一行是它存在的原因,還是只是提到它)。
  it('.husky/pre-commit 有一行【非註解】在呼叫 lint-staged(存在性釘,非效果證明)', () => {
    const hook = readFileSync(join(REPO, '.husky/pre-commit'), 'utf8');
    const liveLines = (text: string) =>
      text
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .filter((l) => /lint-staged/.test(l));
    expect(liveLines(hook).length).toBeGreaterThan(0);
    // 🔴 反向對照:同一把濾網餵「被註解掉的呼叫」必須回 0。
    //    ⚠️ 刻意**不**去突變真的 `.husky/pre-commit` —— 六個窗正在用它 commit,
    //    弄壞它的代價落在別人身上。⇒ 這格證明的是**濾網對不對**,
    //    不是「真的把呼叫註解掉之後這支測試會紅」。那半沒有實跑過,寫在這裡免得被讀成有。
    expect(liveLines('# pnpm exec lint-staged\necho hi\n')).toHaveLength(0);
  });
});
