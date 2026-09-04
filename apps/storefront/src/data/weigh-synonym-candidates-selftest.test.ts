// weigh-synonym-candidates-selftest.test.ts — 把那支量測台的自檢【拉進測試套件】。
//
// 🔴🔴 **為什麼需要這一支**(主視窗 2026-09-04 裁,而問題是我自己講出來的):
//    `scripts/weigh-synonym-candidates.py` 跟 `search-prefix-largest.test.ts` 一樣
//    **接在生產碼上**(它呼叫真的 `buildCategoryTree` + `parseSearchFacets`),
//    🛑 **而它不是測試檔 ⇒ 全套跑不到它** ⇒ 合完別人的東西之後,沒有任何自動的東西會驗它。
//    🎯 **而它的危險不在「會壞」,在【它壞掉的時候仍然會輸出】** ——
//       一支腳本壞了不會有人紅,而**下一個用它的人拿到的是一張看起來正常的表。**
//    📌 **⇒ 那是「一個前提被推翻的量測,最危險的形狀是它照樣輸出」的第二個受詞**:
//       這一次被推翻的前提是「**這支工具還能跑**」。
//
// ⚠️ **這一支只驗【那支腳本的判定邏輯還在】** —— 它**不驗**那台量測台量不量得到東西
//    (那一半靠每一次真的拿它去量的時候被驗,見腳本檔頭)。**射程就到這裡,不要外推。**
//
// 🔵 **它很便宜**:那個 `--selftest` 不跑 vitest、不碰檔案、只餵合成讀數 ⇒ 不會拖慢全套。
// 🔵 **而它不碰 git** —— 2026-09-04 實測:餵壞掉的 `GIT_DIR` / `GIT_INDEX_FILE` 進去,照樣 rc=0。
//    下面仍然把那組環境變數剝掉,理由是**「今天不碰」不是「以後不會碰」**,而剝掉零成本。

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO, 'scripts', 'weigh-synonym-candidates.py');

/** 🔴 剝掉繼承來的 git 環境 —— `git -C` 擋不住它們(專案自檢清單那一格)。 */
function envWithoutGit(): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const k of [
    'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE',
  ]) delete e[k];
  return e;
}

/**
 * 跑那支自檢,**把失敗接住**而不是讓它在收集階段炸掉。
 *
 * 🔴 **為什麼要接住**(2026-09-04 突變當場撞到):
 *    初版直接在 `describe` 的頂層 `execFileSync` ⇒ 腳本 rc≠0 時它 **throw 在收集階段**
 *    ⇒ vitest 印 `Test Files 1 failed` 而 **`Tests` 那一欄是 `no tests`**。
 *    🛑 它確實是紅的, 而**那個形狀把鐵則 11 的第四個數(它跑了幾支)藏起來了** ——
 *       一個「幾支都沒跑」與「跑了而紅」在那一行上長得不一樣, 而讀的人只看 Test Files。
 *    ✅ 改成接住 ⇒ 失敗時是**一格明確的斷言紅**, 而且**訊息裡帶那支腳本自己印的理由**。
 */
function runSelftest(): { ok: boolean; out: string } {
  try {
    return {
      ok: true,
      out: execFileSync('python3', [SCRIPT, '--selftest'], {
        cwd: REPO,
        env: envWithoutGit(),
        encoding: 'utf8',
      }),
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}` };
  }
}

describe('scripts/weigh-synonym-candidates.py --selftest', () => {
  const r = runSelftest();
  const out = r.out;

  it('🔴 那支自檢自己要 rc=0(而失敗時把它印的理由帶出來)', () => {
    expect(r.ok, `weigh-synonym-candidates.py --selftest 沒過:\n${out}`).toBe(true);
  });

  it('🔴 六個世界各自走到【不同的分支】', () => {
    // 🔴 **不能只斷言 rc=0** —— `execFileSync` 在非零時會 throw, 所以上面那一行已經涵蓋 rc;
    //    而一支【什麼都不印就 exit 0】的腳本一樣會通過那一關。
    //    ⇒ 📌 所以這裡斷言它印出來的【內容】。
    expect(out).toContain('6 個世界各自走到【不同的分支】');
  });

  it.each([
    'LESS_RECALL', 'REDUNDANT', 'WAS_UNREACHABLE',
    'MORE_RECALL', 'TO_NOT_IN_TREE', 'RULE_FIRST',
  ])('🔴 判定分支 %s 有被走到', (tag) => {
    // 🔵 逐個分支釘住 —— 這樣「兩個世界被壓成同一個分支」那種錯,
    //    在【少了哪一個代號】上看得出來, 而不是只看到一個總數對不上。
    expect(out).toContain(`[${tag}]`);
  });
});
