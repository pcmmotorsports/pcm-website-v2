// 把 `scripts/category-raw-path-consistency.py --selftest` 拉進測試套件。
//
// 🔴 形狀與理由同 `weigh-synonym-candidates-selftest.test.ts`:那支腳本**不是測試檔** ⇒ 全套跑不到它,
//    而**它壞掉的時候仍然會輸出** —— 下一個用它的人拿到的是一句看起來正常的「✅ 沒有同名」。
// ⚠️ **射程**:這一支只驗**判定邏輯**還在。那支腳本**撈不撈得到正式庫**這一半,
//    測試碰不到(worktree / CI 都沒有那組 env)⇒ 靠真的跑一次時被驗。
// 🔴🔴 **而那支腳本目前【沒有接上任何會自動跑的東西】** —— 見它自己的檔頭。
//    ⇒ 📌 **在它被接上之前,它與「沒有守門」印同一個綠**,而這一支測試綠也不改變那件事。

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'category-raw-path-consistency.py');

function envWithoutGit(): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const k of [
    'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE',
  ]) delete e[k];
  return e;
}

function run(): { ok: boolean; out: string } {
  try {
    return {
      ok: true,
      out: execFileSync('python3', [SCRIPT, '--selftest'], {
        cwd: REPO, env: envWithoutGit(), encoding: 'utf8',
      }),
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}` };
  }
}

describe('scripts/category-raw-path-consistency.py --selftest', () => {
  const r = run();

  it('🔴 那支自檢自己要 rc=0(失敗時把它印的理由帶出來)', () => {
    expect(r.ok, `category-raw-path-consistency.py --selftest 沒過:\n${r.out}`).toBe(true);
  });

  it('🔴 四個世界都判對(而不是只印一句「通過」)', () => {
    // 🔵 不只斷言 rc —— 一支什麼都不印就 exit 0 的腳本會通過那一關。
    expect(r.out).toContain('四個世界');
  });

  it('🔵 而【不該叫】那一側有被跑到 —— 那是它每天要用的那一側', () => {
    // 🔴 一把只驗過「該叫時會叫」的尺, 它的【不該叫】那一側從來沒有被跑過,
    //    而那正是它每天拿來說「今天沒事」的方向。
    expect(r.out).toContain('跨父層同名而路徑各自正確');
  });

  it('🔴 而【真的造一列歪掉的】那一格有被跑到 —— 那是它存在的理由', () => {
    // 🔵 那一種正是 UNIQUE(raw_path) 抓不到的:路徑與父子關係脫鉤。
    expect(r.out).toContain('手寫歪掉');
  });
});
