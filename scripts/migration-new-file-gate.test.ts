// migration-new-file-gate.test.ts — 「新增的 .sql 會不會真的被靜態檢查擋下」的**真效果測**。
//
// 🔴 為什麼要有這一支(2026-08-24 線3 立):
//   `scripts/migration-new-file-static-checks.sh --selftest` 已經證明**那支腳本自己**會擋
//   (A/M 雙向 + 多檔 + 該綠必綠,4/4)。但它證不到中間那一層:
//   package.json 的 `supabase/migrations/*.sql` 這條 lint-staged entry
//   —— **有人把那一行刪掉,腳本仍然 4/4 全綠,而新的 migration 從此沒有人檢查。**
//   當場量到的分母:全 repo 提到 `migration-new-file-static-checks` 的是 **4 個檔 / 9 行**
//   (package.json **兩條** entry〔接線那條 + `--selftest` 那條〕、腳本自己、兩支 migration 的註解)。
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
// 成本:scratch repo 建一次;每格 spawn 一次 lint-staged(node 冷啟動)。

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
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
  //    (實際會干擾:`.sql` 同時命中 `*.{…,[sS][qQ][lL],…}` 那條 ⇒ 兩個 task 都會跑。)
  const mainPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
    'lint-staged': Record<string, string>;
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

  writeFileSync(join(scratch, 'README.md'), '# mig gate e2e\n', 'utf8');
  must('add README', ['add', 'README.md']);
  must('commit init', ['commit', '-q', '-m', 'init']);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('lint-staged → migration-new-file-static-checks 真效果測', () => {
  it('前提:主 repo 的 lint-staged 真的有這條 entry,且命令指向那支入口', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      'lint-staged': Record<string, string>;
    };
    expect(
      Object.keys(pkg['lint-staged']),
      `lint-staged 少了 \`${GLOB_KEY}\` ⇒ 新增的 .sql 不會被任何東西檢查,而 commit 全程安靜`,
    ).toContain(GLOB_KEY);
    expect(pkg['lint-staged'][GLOB_KEY]).toContain('migration-new-file-static-checks.sh');
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
