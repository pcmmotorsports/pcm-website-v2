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
const GLOB_KEY = '*.{sh,yaml,yml,sql}';

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
  it('.husky/pre-commit 仍然有呼叫 lint-staged(存在性釘,非效果證明)', () => {
    const hook = readFileSync(join(REPO, '.husky/pre-commit'), 'utf8');
    expect(hook).toMatch(/lint-staged/);
  });
});
