// migration-post-commit-gate.test.ts — `#531` / `#530` 那道閘的**真效果測**(2026-08-23 立)。
//
// ══ 🔴 為什麼這支非做不可(codex R2 把它從 nit 升成 must-fix)═══════════════════════
// 那支守門 2026-08-16 寫好之後**零呼叫端**,而「接上 hook」這個動作在 2026-08-23 一天之內
// 揭露了它**從來沒有正確過**:
//   · 所有關鍵字比對**區分大小寫** ⇒ 合法的小寫 `begin; vacuum …; commit;` **直接放行**
//   · 只認 `COMMIT;` 離開交易 ⇒ `ROLLBACK;` / `END;` 之後的交易外語句**誤紅**
//   · 不追蹤 dollar-quote ⇒ `$$ … BEGIN; … $$` **誤開交易狀態**
// 而同一天接線層自己也長出四個洞(canary 合併跑 / 非零當成抓到 / 故障與偵測分不開 / 訊號不 exit)。
//
// 🔴 **這些洞【全部】是別人審出來的,沒有一個是手跑那七格時發現的。**
//   ⇒ 手跑的證據**隨那個 session 消失**;下一個改這道閘的人拿不到今天證過的任何一格。
//   ⇒ 本檔的存在理由不是「補測試」,是**把今天付過的學費變成下一個人不用再付的**。
//
// ══ 🔴 三格,不是兩格 ═══════════════════════════════════════════════════════════
//   「該紅有紅」證明它**看得到東西**
//   「該綠有綠」證明它**看得到的不是全部東西**
//   兩個一起,才證明它**在分辨**。
//   ⇒ 一支「對什麼都紅」的守門,**只跑第一個方向時看起來完美**(本檔 C4 就是那一支)。
//   📌 而 2026-08-23 當天四次事故裡,**誤擋出現的次數不比漏擋少** ——
//     漏擋會自己撞出來(有人踩到),**誤擋的回饋是那個人自己繞過去,而繞過不留痕跡**。
//
// ══ 怎麼避免它變成一份抄本 ═════════════════════════════════════════════════════
//   · 兩支腳本從**主 repo 現址**複製進 scratch,不是在本檔內嵌一份
//   · `.husky/pre-commit` 有沒有真的呼叫那支閘,是**讀主 repo 那支檔**斷言的
//     ⇒ 有人把那一段拿掉、或改回 `sh`(NUL 讀取會靜靜退化)⇒ 這裡會紅
//   · 每一格斷的是 **exit code + 輸出裡的字**,不是只斷「非零」——
//     `非零 ≠ 抓到` 正是 R2 抓到的洞
//
// ⚠️ **scratch repo 在本檔內自建自拆,一律不碰共用工作樹的 index**
//   (多窗共用一棵樹;`git add` 會動到別人的暫存區)。

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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


// scratch repo 建一次 + 每格 spawn 一次 bash/git ⇒ 給足餘裕(對齊 check-syntax-nonts.gate.test.ts
// 那支的教訓:5000ms 預設在多窗共用機器上會假紅,而假紅讓「全綠」這個訊號變得不可信)。
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const REPO = resolve(process.cwd());
const GATE_SRC = join(REPO, '.husky/migration-post-commit-gate.sh');
const GUARD_SRC = join(REPO, 'scripts/migration-post-commit-guard.sh');
const PRECOMMIT_SRC = join(REPO, '.husky/pre-commit');

const MIGDIR = 'supabase/migrations';
const GUARD_REL = 'scripts/migration-post-commit-guard.sh';
const GATE_REL = '.husky/migration-post-commit-gate.sh';

let scratch: string;

function sh(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? scratch,
    encoding: 'utf8',
    // 🔴 這裡的 `process.env` **已經被本檔頂端動過**(六個 `GIT_*` 被 delete 掉了)——
    //    讀這一行的人會以為它是「真的 env」, 而它不是。⇒ 那是模組層那個修法唯一的代價:
    //    **它不用人記得, 而它看不見。**(往上搜「怎麼寫到別的 repo」)
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  // 🔴 不用 `r.status ?? -1`:spawnSync 對不存在的 binary 回 status=null(ENOENT),
  //   落成 -1 之後「它擋下了」在**閘根本沒被 spawn** 時照樣綠(那支姊妹檔踩過的坑)。
  if (r.error) throw r.error;
  if (r.status === null) throw new Error(`${cmd} 沒有正常結束(signal=${r.signal})`);
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** 跑接線層那支閘。回 { code, out }。 */
function runGate(env: NodeJS.ProcessEnv = {}) {
  return sh('bash', [GATE_REL], { env });
}

/** 把一支 migration 寫進 scratch 並 stage(只動 scratch 的 index)。 */
function stageMigration(name: string, body: string) {
  // 🔴 `mkdirSync` 少不得:`git rm` 掉最後一支 migration 之後,git 會把**空目錄一起移走**
  //   ⇒ 下一格 `writeFileSync` ENOENT。2026-08-27 加「刪除」那格時當場踩到。
  mkdirSync(join(scratch, MIGDIR), { recursive: true });
  writeFileSync(join(scratch, MIGDIR, name), body);
  sh('git', ['add', `${MIGDIR}/${name}`]);
}

/** 清掉 scratch 裡所有 staged 的 migration(檔案與 index 都清)。 */
function clearMigrations() {
  // 🔴 `-z`(NUL 分隔、不加引號)少不得 —— 2026-08-27 `-ed` 實際踩到:
  //   預設 `--name-only` 會把非 ASCII 檔名**加引號並八進位轉義**
  //   (`"supabase/migrations/20990101000004_\344\270\255…"`),
  //   於是 `git rm --cached` 拿那串去找檔案 ⇒ **找不到 ⇒ 清不掉,而它不報錯**。
  //   ⇒ 本檔上面那格「非 ASCII 檔名」測完之後,那支 migration 會【留在 index 裡】
  //     污染後面每一格。⚠️ 而在 `#872` 那組加進來之前**沒有任何一格會因此紅**
  //     —— 它只是安靜地讓後面的測試在一個不是它們預期的世界裡跑。
  // 🔴 用 `git reset` 而不是 `git rm --cached`(codex R2):
  //   `git rm --cached` **清不掉一個已經 staged 的【刪除】** —— 而 2026-08-27 加的「刪除」那格
  //   正好會留下一個 staged deletion ⇒ 它會污染後面每一格,而那些格的前置失敗時仍可能假綠。
  //   `git reset -- <path>` 把該路徑的 index 還原成 HEAD,加/刪兩種都清得掉。
  const hasHead = sh('git', ['rev-parse', '--verify', '--quiet', 'HEAD']).code === 0;
  if (hasHead) {
    const r = sh('git', ['reset', '-q', '--', `${MIGDIR}/`]);
    if (r.code !== 0) throw new Error(`clearMigrations: git reset 失敗 rc=${r.code} ${r.out}`);
  } else {
    const ls = sh('git', ['diff', '--cached', '--name-only', '-z', '--', `${MIGDIR}/`]);
    for (const f of ls.out.split('\0').filter(Boolean)) {
      const r = sh('git', ['rm', '-q', '--cached', '--ignore-unmatch', '--', f]);
      if (r.code !== 0) throw new Error(`clearMigrations: git rm 失敗 rc=${r.code} ${r.out}`);
    }
  }
  sh('bash', ['-c', `rm -f "${join(scratch, MIGDIR)}"/*.sql`]);
  // 🔴 自證清乾淨了 —— 沒有這一行,「清不掉」會安靜地讓後面的測試在別的世界裡跑。
  const left = sh('git', ['diff', '--cached', '--name-only', '-z', '--', `${MIGDIR}/`]);
  if (left.out.split('\0').filter(Boolean).length !== 0) {
    throw new Error(`clearMigrations 沒清乾淨:${left.out}`);
  }
}

/** 把 index 裡那支守門換成 body(工作樹留原樣 —— 這正是掉包的形狀)。 */
function swapGuardInIndex(body: string) {
  const real = readFileSync(GUARD_SRC, 'utf8');
  writeFileSync(join(scratch, GUARD_REL), body);
  sh('git', ['add', GUARD_REL]);
  writeFileSync(join(scratch, GUARD_REL), real); // 工作樹還原成正常版
}

function restoreGuard() {
  copyFileSync(GUARD_SRC, join(scratch, GUARD_REL));
  sh('git', ['add', GUARD_REL]);
}

const CLEAN = 'BEGIN;\nCREATE TABLE public.h1 (id int);\nCOMMIT;\n';

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'mpcg-harness-'));
  mkdirSync(join(scratch, MIGDIR), { recursive: true });
  mkdirSync(join(scratch, 'scripts'), { recursive: true });
  mkdirSync(join(scratch, '.husky'), { recursive: true });
  sh('git', ['init', '-q']);
  sh('git', ['config', 'user.email', 'harness@example.invalid']);
  sh('git', ['config', 'user.name', 'harness']);
  // 🔴 從主 repo 現址複製,不內嵌抄本 ⇒ 那兩支被改壞,本檔會紅。
  copyFileSync(GATE_SRC, join(scratch, GATE_REL));
  copyFileSync(GUARD_SRC, join(scratch, GUARD_REL));
  chmodSync(join(scratch, GATE_REL), 0o755);
  chmodSync(join(scratch, GUARD_REL), 0o755);
  sh('git', ['add', GUARD_REL, GATE_REL]);
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// ── ⓪ 接線本身:守門存在 ≠ 守門接著 ──────────────────────────────────────────────
describe('migration post-COMMIT 閘 — 接線(存在 ≠ 接著)', () => {
  it('🔴 `.husky/pre-commit` 真的呼叫這支閘,而且是用 `bash` 不是 `sh`', () => {
    const pre = readFileSync(PRECOMMIT_SRC, 'utf8');
    expect(pre).toContain('.husky/migration-post-commit-gate.sh');
    // 🔴 `bash` 是承重的:那支閘用 `read -r -d ''` 讀 NUL 分隔的檔名(bash 專有)。
    //   改回 `sh` ⇒ 檔名處理**靜靜退化**回按空白斷詞,而退化時不會有東西紅。
    expect(pre).toMatch(/bash\s+\.husky\/migration-post-commit-gate\.sh/);
    // 檔不見了要 fail-closed(不是留痕跡然後放行)
    expect(pre).toMatch(/migration-post-commit-gate\.sh 不見了[\s\S]{0,400}?exit 1/);
  });
});

// ── ① 七格回歸 ──────────────────────────────────────────────────────────────────
describe('migration post-COMMIT 閘 — 回歸七格', () => {
  it('沒有 staged migration ⇒ 放行', () => {
    clearMigrations();
    restoreGuard();
    expect(runGate().code).toBe(0);
  });

  it('乾淨的 migration ⇒ 放行(該綠要綠)', () => {
    clearMigrations();
    stageMigration('20990101000000_clean.sql', CLEAN);
    expect(runGate().code).toBe(0);
  });

  it('閘① COMMIT 之後還有 DDL ⇒ 擋,且說得出是「之後仍有 DDL/DML」', () => {
    clearMigrations();
    stageMigration('20990101000001_after.sql', `${CLEAN}DROP TABLE public.h1;\n`);
    const r = runGate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('之後仍有 DDL/DML');
  });

  it('閘② 交易區塊內有 VACUUM ⇒ 擋,且說得出是「沖掉批次」', () => {
    clearMigrations();
    stageMigration(
      '20990101000002_inside.sql',
      'BEGIN;\nCREATE TABLE public.h2 (id int);\nVACUUM public.h2;\nCOMMIT;\n',
    );
    const r = runGate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('沖掉批次');
  });

  it('🔴 守門在 index 裡被刪 ⇒ 擋(fail-closed;而它要在「沒有 staged migration」之前檢查)', () => {
    clearMigrations();
    sh('git', ['rm', '-q', '--cached', GUARD_REL]);
    const r = runGate();
    restoreGuard();
    // 🔴 這一格刻意**不 stage 任何 migration** —— codex R1 M3 的形狀:
    //   舊版把存在性檢查排在「沒有 staged migration 就 exit 0」之後
    //   ⇒ **單獨刪掉守門的那一顆 commit 剛好不會被擋**,而那是最可能發生的形狀。
    expect(r.code).toBe(1);
    expect(r.out).toContain('取不到');
  });

  it('逃生門 ⇒ 放行,而且要留下警告(它是【方便】不是【控制】,見 #872)', () => {
    clearMigrations();
    stageMigration('20990101000003_bad.sql', `${CLEAN}DROP TABLE public.h1;\n`);
    const r = runGate({ PCM_ALLOW_MIGRATION_POST_COMMIT: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('略過');
  });

  it('🔴 非 ASCII 檔名 + 乾淨 SQL ⇒ 放行(修之前這一格是【誤擋】exit 128)', () => {
    clearMigrations();
    stageMigration('20990101000004_中文名.sql', CLEAN);
    expect(runGate().code).toBe(0);
  });
});

// ── ② 大小寫:兩份,而它們問的不是同一件事 ─────────────────────────────────────
describe('migration post-COMMIT 閘 — SQL 關鍵字大小寫不敏感', () => {
  // ⚠️🔴 **更正(2026-08-23,寫完當天量的)——我原本在這裡寫的理由是【假的】,原句作廢:**
  //   ~~「全小寫那發在樣式沒改小寫時仍會紅(grep -i 救得回來)⇒ 只有混合大小寫問得出 awk 那半」~~
  //   **那句沒有被量過就寫下去了,而它經不起一發突變。** 實測三發:
  //     突變 A 樣式改回大寫(`grep -i` 與 `tolower` 都留著)
  //            ⇒ 🔴 **本節兩格【都是綠的】**;紅的是下面「該綠要綠」那一族 + canary
  //     突變 B `$BATCH_BREAKER` 那個 grep 拿掉 `-i`
  //            ⇒ 同上,**本節兩格仍綠**(canary 的毒 B 用大寫 VACUUM ⇒ 整道閘先倒)
  //     突變 C 樣式與 `tolower` 一起還原成大寫世界 ⇒ 大量紅,但一樣不是這兩格抓的
  //   ⇒ **在現行實作下,這兩格走的是【同一條路】**:`tolower($0)` 把兩種輸入變成同一個字串,
  //     `grep -i` 也對兩種一視同仁 ⇒ **混合那一份現在【問不出】全小寫那一份問不出的東西。**
  //
  // 📌 **那為什麼還留著?** 因為它便宜,而且它守的是**未來的實作**:
  //   哪天有人把降大小寫的做法換掉(例如只在某幾條路徑上 `tr`),混合那一份才會開始有判別力。
  //   ⚠️ **但那是「以後可能有用」,不是「現在有用」** —— 這一句必須寫在這裡,
  //   否則下一個人會以為它現在正在守著什麼。
  //
  // 🔴 **而真正抓得到大小寫回歸的是誰,要講清楚**:是 **canary 與「該綠要綠」那一族**
  //   (上面三發突變全部由它們紅)。**不是本節這兩格。**
  //   ⇒ 這一格留給下一個人的教訓比測試本身值錢:
  //     **一個「聽起來很有道理」的測試理由,與一個【量過】的測試理由,在檔案裡長得一模一樣。**
  it('全小寫 `begin; … vacuum …; commit;` ⇒ 擋(修之前 exit 0 直接放行)', () => {
    clearMigrations();
    stageMigration(
      '20990101000010_lc.sql',
      'begin;\ncreate table public.lc (id int);\nvacuum public.lc;\ncommit;\n',
    );
    const r = runGate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('沖掉批次');
  });

  // 🔴 格名裡就要寫「同路」(Fable R3 nit ①):**看格數的人不會讀到上面那段註解** ——
  //   而 18 格裡有一格與另一格同路,會讓「18」虛胖。判別力的實際格數是 17。
  it('混合大小寫 `Begin; … VACUUM …; Commit;` ⇒ 擋【目前與「全小寫」那格同路,不是額外的判別力】', () => {
    clearMigrations();
    stageMigration(
      '20990101000011_mixed.sql',
      'Begin;\nCreate Table public.mx (id int);\nVACUUM public.mx;\nCommit;\n',
    );
    const r = runGate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('沖掉批次');
  });
});

// ── ③ 該綠要綠:三種「不是違規」的合法寫法 ────────────────────────────────────
describe('migration post-COMMIT 閘 — 該綠要綠(誤擋那一族)', () => {
  it('兩段交易【中間】的 VACUUM 在交易外 ⇒ 放行', () => {
    clearMigrations();
    stageMigration(
      '20990101000020_two_txn.sql',
      'BEGIN;\nCREATE TABLE public.t1 (id int);\nCOMMIT;\nVACUUM public.t1;\nBEGIN;\nCREATE TABLE public.t2 (id int);\nCOMMIT;\n',
    );
    expect(runGate().code).toBe(0);
  });

  it('`ROLLBACK;` 也結束交易 ⇒ 其後的 VACUUM 不算在交易內', () => {
    clearMigrations();
    stageMigration(
      '20990101000021_rollback.sql',
      'BEGIN;\nCREATE TABLE public.rb (id int);\nROLLBACK;\nVACUUM public.rb;\nBEGIN;\nCREATE TABLE public.rb2 (id int);\nCOMMIT;\n',
    );
    expect(runGate().code).toBe(0);
  });

  it('dollar-quote 區塊裡的 `BEGIN;` 不得打開交易狀態', () => {
    clearMigrations();
    stageMigration(
      '20990101000022_dollar.sql',
      'CREATE FUNCTION public.f() RETURNS void AS $$\nBEGIN;\nEND;\n$$ LANGUAGE plpgsql;\nVACUUM public.anything;\nBEGIN;\nCREATE TABLE public.d1 (id int);\nCOMMIT;\n',
    );
    expect(runGate().code).toBe(0);
  });

  it('🔴 負對照:`COMMIT WORK;` 之後的 DDL 仍要被抓到(別讓上面三格把閘放寬了)', () => {
    clearMigrations();
    stageMigration(
      '20990101000023_work.sql',
      'BEGIN;\nCREATE TABLE public.w1 (id int);\nCOMMIT WORK;\nDROP TABLE public.w1;\n',
    );
    const r = runGate();
    expect(r.code).toBe(1);
    expect(r.out).toContain('之後仍有 DDL/DML');
  });
});

// ── ④ canary:四種壞掉的守門 ────────────────────────────────────────────────────
describe('migration post-COMMIT 閘 — canary(這次要提交的那份守門是不是活的)', () => {
  const ALWAYS_GREEN = '#!/usr/bin/env bash\necho "✅ 通過"\nexit 0\n';
  const ALWAYS_RED = '#!/usr/bin/env bash\necho "🔴 壞了"\nexit 1\n';

  it('C1 恆綠版被 stage(工作樹留正常版)⇒ 擋', () => {
    clearMigrations();
    swapGuardInIndex(ALWAYS_GREEN);
    const r = runGate();
    restoreGuard();
    expect(r.code).toBe(1);
    expect(r.out).toContain('毒 A 應該紅而它回 0');
  });

  it('🔴 C2 恆【紅】版 ⇒ 擋。非零不等於抓到', () => {
    clearMigrations();
    swapGuardInIndex(ALWAYS_RED);
    const r = runGate();
    restoreGuard();
    expect(r.code).toBe(1);
    // 這一格若只斷「非零」,恆紅版會通過 canary 而獲得信任(codex R2 的原話)。
    expect(r.out).toContain('非零不等於抓到');
  });

  it('🔴 C3 兩支毒都抓得到、但對【乾淨的】也紅 ⇒ 擋,且要說那是【故障】不是【偵測】', () => {
    clearMigrations();
    // 把一條過度規則插在真守門的 `exit` **之前**(插在之後根本跑不到 —— 我第一次就這樣造壞了)。
    const real = readFileSync(GUARD_SRC, 'utf8');
    const anchor = 'if [ "$FAIL" -eq 0 ]; then';
    expect(real.split(anchor).length - 1).toBe(1); // anchor 唯一,否則這格是在測一個沒套用的突變
    const overBroad = real.replace(
      anchor,
      'if grep -qiE "create[[:space:]]+table" "$DIR"/*.sql 2>/dev/null; then\n  echo "🔴 我覺得 CREATE TABLE 都不行"\n  FAIL=1\nfi\n' +
        anchor,
    );
    swapGuardInIndex(overBroad);
    const r = runGate();
    restoreGuard();
    expect(r.code).toBe(1);
    expect(r.out).toContain('這是【故障】不是【偵測】');
  });

  it('C4 守門正常 ⇒ canary 三格全過,不得誤擋乾淨的 commit', () => {
    clearMigrations();
    restoreGuard();
    stageMigration('20990101000030_clean.sql', CLEAN);
    expect(runGate().code).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// `#872` 逃生門留痕閘(`.husky/commit-msg`)—— 2026-08-27 `-ed` 線
//
// 在它出現之前:設了 `PCM_ALLOW_MIGRATION_POST_COMMIT=1` 只在**當次 stderr** 留一行警告
// ⇒ commit 完就沒了 ⇒ 事後分不出哪一顆 commit 是走逃生門過的。
//
// 🔴 本段有兩格是**別的測試抓不到、而少了它們這支閘等於只跑了一發**的:
//   ① `W1 沒設逃生門` 與 `W2 設了但沒動 migration` **兩發都是 rc=0 + 零輸出**
//      ⇒ 只比 rc 的話它們是同一發。分辨方式:**它有沒有去呼叫 git**
//      ⇒ 用 PATH 假 git 量,不是看它自己 report(自己 report 的東西壞掉時會一起壞)。
//   ② 那個「逃生門沒設 ⇒ 第一行就退」是**控制爆炸半徑的唯一憑據**
//      (`commit-msg` 每一顆 commit 都跑,壞掉的樣子是全隊 commit 不了)
//      ⇒ 它必須有一發專門證明,而證明的內容是 **git 呼叫次數 = 0**。
// ═════════════════════════════════════════════════════════════════════════════

const CM_SRC = join(REPO, '.husky/commit-msg');
const CM_REL = '.husky/commit-msg';
const TOKEN = 'PCM-MIGRATION-BYPASS-872';

/** 跑 commit-msg 閘,並用 PATH 假 git 記下它呼叫了幾次 git。 */
function runCommitMsg(body: string, env: NodeJS.ProcessEnv = {}) {
  const msgPath = join(scratch, 'COMMIT_MSG_FIXTURE');
  writeFileSync(msgPath, body);
  const shimDir = join(scratch, 'gitshim');
  mkdirSync(shimDir, { recursive: true });
  const callLog = join(scratch, 'git-calls.log');
  writeFileSync(callLog, '');
  // 假 git:記一行再轉呼真的。🔴 用 `command -v` 之外的絕對路徑會綁死機器 ⇒ 從 PATH 尾端找。
  writeFileSync(
    join(shimDir, 'git'),
    `#!/bin/sh\nprintf 'git %s\\n' "$*" >> "${callLog}"\nexec ${realGitPath} "$@"\n`,
  );
  chmodSync(join(shimDir, 'git'), 0o755);
  // 🔴 hermetic:跑這支測試的人**很可能就是會碰這片的人**,而他的 shell 裡可能正 export 著
  //   `PCM_ALLOW_MIGRATION_POST_COMMIT=1` 或 debug 旗標 ⇒ W1/W2 會假紅。顯式清掉。
  const r = sh('sh', ['-e', CM_REL, 'COMMIT_MSG_FIXTURE'], {
    env: {
      PCM_ALLOW_MIGRATION_POST_COMMIT: undefined,
      PCM_MIGRATION_BYPASS_DEBUG: undefined,
      ...env,
      PATH: `${shimDir}:${process.env.PATH ?? ''}`,
    },
  });
  const gitCalls = readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length;
  return { ...r, gitCalls };
}

let realGitPath = '/usr/bin/git';

describe('#872 逃生門留痕閘 .husky/commit-msg', () => {
  beforeAll(() => {
    const which = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' });
    if (which.stdout.trim()) realGitPath = which.stdout.trim();
    mkdirSync(join(scratch, '.husky'), { recursive: true });
    copyFileSync(CM_SRC, join(scratch, CM_REL));
    chmodSync(join(scratch, CM_REL), 0o755);
  });

  it('🔴 W1 逃生門沒設 ⇒ 過、零輸出,而且【一次 git 都沒呼叫】(爆炸半徑的憑據)', () => {
    clearMigrations();
    restoreGuard();
    stageMigration('20990101000040_w1.sql', CLEAN);
    const r = runCommitMsg('feat: 一般的 commit\n');
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('');
    // 🔴 這一格才是重點:它證明「第一行就退」是真的,而不是它自己說的。
    expect(r.gitCalls).toBe(0);
  });

  it('W2 設了逃生門但沒動 migration ⇒ 過、零輸出,而它【有】去查 git(與 W1 分得開)', () => {
    clearMigrations();
    const r = runCommitMsg('docs: 跟 migration 無關\n', { PCM_ALLOW_MIGRATION_POST_COMMIT: '1' });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('');
    // W1 與 W2 的 rc 與輸出【完全相同】⇒ 沒有這一行,兩發等於只跑了一發。
    expect(r.gitCalls).toBeGreaterThan(0);
  });

  it('🔴 W3 設了 + 動 migration + body 沒 token ⇒ 擋,並直接給出要貼的那一行', () => {
    clearMigrations();
    stageMigration('20990101000041_w3.sql', CLEAN);
    const r = runCommitMsg('feat: 沒有留痕\n', { PCM_ALLOW_MIGRATION_POST_COMMIT: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${TOKEN}:`);
    expect(r.out).toContain('20990101000041_w3.sql'); // 有指名是哪一支,不是只說「有 migration」
    expect(r.out).toContain('--no-verify'); // 明講不要改走那條(它連警告都不留)
  });

  it('W4 設了 + 動 migration + 有 token ⇒ 過,並印出日後查法', () => {
    clearMigrations();
    stageMigration('20990101000042_w4.sql', CLEAN);
    const r = runCommitMsg(`feat: 有留痕\n\n${TOKEN}: 這次手動 apply 過了\n`, {
      PCM_ALLOW_MIGRATION_POST_COMMIT: '1',
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain('git log --all --grep=');
  });

  it('🔴 W5 負對照:token 拼錯(少了冒號)⇒ 仍須擋 —— 不能「有那串字就算」', () => {
    clearMigrations();
    stageMigration('20990101000043_w5.sql', CLEAN);
    const r = runCommitMsg(`feat: x\n\n${TOKEN} 忘了冒號\n`, {
      PCM_ALLOW_MIGRATION_POST_COMMIT: '1',
    });
    expect(r.code).toBe(1);
  });

  it('🔴 codex R2:token 有冒號但【沒寫理由】⇒ 要擋(不能把留痕做成一個形式)', () => {
    clearMigrations();
    stageMigration('20990101000048_empty.sql', CLEAN);
    const r = runCommitMsg(`feat: x\n\n${TOKEN}:   \n`, { PCM_ALLOW_MIGRATION_POST_COMMIT: '1' });
    expect(r.code).toBe(1);
  });

  it('🔴 codex R2 反向:訊息裡出現 ">8" 這兩個字元【不算】剪刀線 ⇒ 後面的 token 仍要算數', () => {
    // 前一版 pattern 是 `/>8/,$d` ⇒ 任何含 ">8" 的行都會把後面整段砍掉 ⇒ 有效 token 被忽略 ⇒ 過度擋。
    // 這一格是那個修法的**反向對照**:沒有它,把 pattern 改鬆改緊都不會紅。
    clearMigrations();
    stageMigration('20990101000049_gt8.sql', CLEAN);
    const body = ['fix: 批次大小從 a >8 改成 a >4', '', `${TOKEN}: 這行在它後面,要算數`, ''].join(
      '\n',
    );
    const r = runCommitMsg(body, { PCM_ALLOW_MIGRATION_POST_COMMIT: '1' });
    expect(r.code).toBe(0);
  });

  it('接線:git 會不會真的呼叫它 —— 而這一格在【乾淨 checkout】上也要成立', () => {
    // 🔴 前幾格證明「這支腳本被呼叫時會做對的事」,而**「git 到底會不會呼叫它」是另一半**。
    // ⚠️ 而 `.husky/_` 整個目錄是 gitignore 的(`.husky/_/.gitignore` = `*`)
    //   ⇒ 它只在**跑過 husky install** 的樹裡存在。斷言「它在」會在乾淨 CI 上假紅
    //   ⇒ 分兩個世界斷:裝過 ⇒ 斷 shim 與 hooksPath;沒裝過 ⇒ 斷 `prepare` 會把它裝起來。
    const installed = existsSync(join(REPO, '.husky/_/commit-msg'));
    if (installed) {
      const hooksPath = spawnSync('git', ['config', 'core.hooksPath'], {
        cwd: REPO,
        encoding: 'utf8',
      }).stdout.trim();
      expect(hooksPath).toBe('.husky/_');
    } else {
      const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      expect(pkg.scripts?.prepare ?? '').toContain('husky');
    }
    // 這一份【一定】要在(它是進版控的那份),不受 husky 有沒有裝影響。
    expect(existsSync(CM_SRC)).toBe(true);
  });

  it('🔴 C1 端到端:token 寫成【註解行】⇒ 必須擋 —— 它會被 git 剝掉,而 hook 本來印 ✅', () => {
    // 🔴 這一格是 code-reviewer 端到端抓到的,而它**戴著一個綠勾**:
    //   走編輯器路徑時 git 預設 cleanup 會把 `#` 開頭的行整行刪掉,而 hook 讀的是刪之前那份
    //   ⇒ 一個 `# PCM-…-872: …` 會讓 hook 印「✅ 已留痕」而那行根本不會進 commit。
    // ⚠️ **用 -m / -F 測【測不出來】** —— 那兩條路不剝註解。所以這格必須走真的 git commit + 編輯器。
    const e2e = mkdtempSync(join(tmpdir(), 'mpcg-e2e-'));
    const hooksDir = join(e2e, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    copyFileSync(CM_SRC, join(hooksDir, 'commit-msg'));
    chmodSync(join(hooksDir, 'commit-msg'), 0o755);
    mkdirSync(join(e2e, MIGDIR), { recursive: true });
    writeFileSync(join(e2e, MIGDIR, 'e2e.sql'), 'select 1;\n');
    const run = (args: string[], env: NodeJS.ProcessEnv = {}) =>
      spawnSync('git', args, {
        cwd: e2e,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    // 🔴 前置每一步都要斷回碼(codex must-fix):不斷的話,建 repo 失敗時
    //   最後那句「非零 = 被擋」照樣成立 ⇒ 這一格會恆綠,而它證明的東西不見了。
    for (const args of [
      ['init', '-q', '.'],
      ['config', 'user.email', 't@t'],
      ['config', 'user.name', 't'],
      ['config', 'core.hooksPath', hooksDir],
      ['add', `${MIGDIR}/e2e.sql`],
    ]) {
      expect({ args, status: run(args).status }).toEqual({ args, status: 0 });
    }

    // 編輯器把 token 寫成【註解行】—— 人很容易這樣做,因為 git 的訊息範本滿是 # 開頭的行。
    const editor = join(e2e, 'ed.sh');
    writeFileSync(
      editor,
      `#!/bin/sh\nprintf 'feat: x\\n\\n# ${TOKEN}: 我以為這樣算\\n' > "$1"\n`,
    );
    chmodSync(editor, 0o755);
    const r = run(['commit'], {
      PCM_ALLOW_MIGRATION_POST_COMMIT: '1',
      GIT_EDITOR: editor,
      PCM_MIGRATION_BYPASS_DEBUG: undefined,
    });
    const out = `${r.stdout}${r.stderr}`;
    rmSync(e2e, { recursive: true, force: true });
    expect(r.status).not.toBe(0); // 🔴 必須擋 —— 否則就是「印 ✅ 而查不到」那個狀態
    // 🔴 「非零」不等於「被本閘擋」—— 斷輸出裡有本閘的字,否則任何前置爆炸都算過。
    expect(out).toContain('commit body 沒有留痕');
  });

  it('🔴 codex must-fix:mktemp 失敗 ⇒ 擋,而且【不落回 /dev/null】(那會去 rm 裝置節點)', () => {
    clearMigrations();
    stageMigration('20990101000047_mk.sql', CLEAN);
    const badDir = join(scratch, 'badmktemp');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'mktemp'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(badDir, 'mktemp'), 0o755);
    writeFileSync(join(scratch, 'COMMIT_MSG_FIXTURE'), 'feat: x\n');
    const r = sh('sh', ['-e', CM_REL, 'COMMIT_MSG_FIXTURE'], {
      env: {
        PCM_ALLOW_MIGRATION_POST_COMMIT: '1',
        PCM_MIGRATION_BYPASS_DEBUG: undefined,
        PATH: `${badDir}:${process.env.PATH ?? ''}`,
      },
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('mktemp 失敗');
    // 🔴 這一格真正防的不是「擋」,是【不要落回 /dev/null】—— 落回去之後那句 rm -f
    //   會拿 /dev/null 當暫存檔刪。斷言訊息裡明講「不落回 /dev/null」,拿掉那條路就會紅。
    expect(r.out).toContain('/dev/null');
    // 而 /dev/null 必須還在(它若被刪掉,整台機器後面都會怪)。
    expect(existsSync('/dev/null')).toBe(true);
  });

  it('🔴 codex must-fix:設了逃生門而【刪掉】一支 migration ⇒ 一樣要擋', () => {
    // --diff-filter=ACMR 會排除刪除 ⇒ 刪一支 migration 會被判成「沒動 migration」而放行。
    // 刪除與新增同樣需要留痕。
    clearMigrations();
    stageMigration('20990101000045_del.sql', CLEAN);
    // 🔴 前置要斷回碼(codex R2):seed commit 失敗時那支 migration 會【留在 index 當新增】
    //   ⇒ gate 照樣擋 ⇒ 測試綠,而它根本沒測到「刪除」。
    expect(sh('git', ['commit', '-q', '-m', 'seed for delete case', '--no-verify']).code).toBe(0);
    expect(sh('git', ['rm', '-q', '--', `${MIGDIR}/20990101000045_del.sql`]).code).toBe(0);
    // 自證此刻 index 裡那一筆真的是【刪除】,不是新增。
    const staged = sh('git', ['diff', '--cached', '--name-status', '--', `${MIGDIR}/`]);
    expect(staged.out).toMatch(/^D\s/m);
    const r = runCommitMsg('chore: 刪掉一支\n', { PCM_ALLOW_MIGRATION_POST_COMMIT: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('20990101000045_del.sql');
  });

  it('🔴 codex must-fix:token 寫在【剪刀線以下】⇒ 要擋(git 會把那段截掉)', () => {
    // commit.cleanup=scissors 時 `# ---- >8 ----` 以下整段會被 git 丟掉,
    // 而 stripspace --strip-comments 留得住那段的非註解文字 ⇒ 又是一次「印成功、歷史查不到」。
    clearMigrations();
    stageMigration('20990101000046_sc.sql', CLEAN);
    const body = [
      'feat: x',
      '',
      '# ------------------------ >8 ------------------------',
      '# 以下不會進 commit',
      `${TOKEN}: 我寫在剪刀線下面`,
      '',
    ].join('\n');
    const r = runCommitMsg(body, { PCM_ALLOW_MIGRATION_POST_COMMIT: '1' });
    expect(r.code).toBe(1);
  });

  it('🔴 I2 fail-closed:git 查不出 staged 清單 ⇒ 擋(而不是靜靜放行)', () => {
    // 這條分支我寫了三行註解說它為什麼重要,而它在測試裡本來是【死碼】——
    // 突變「把 exit 1 改成 exit 0」原本七格全綠存活(code-reviewer 抓到)。
    clearMigrations();
    stageMigration('20990101000044_i2.sql', CLEAN);
    const badDir = join(scratch, 'badgit');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'git'), '#!/bin/sh\necho "boom" >&2\nexit 42\n');
    chmodSync(join(badDir, 'git'), 0o755);
    const msgPath = join(scratch, 'COMMIT_MSG_FIXTURE');
    writeFileSync(msgPath, 'feat: x\n');
    const r = sh('sh', ['-e', CM_REL, 'COMMIT_MSG_FIXTURE'], {
      env: {
        PCM_ALLOW_MIGRATION_POST_COMMIT: '1',
        PCM_MIGRATION_BYPASS_DEBUG: undefined,
        PATH: `${badDir}:${process.env.PATH ?? ''}`,
      },
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('讀不到 staged 檔案清單');
  });

  it('接線:逃生門那支閘的警告【直接給出要貼的那一行】,不是只說「請寫明理由」', () => {
    // 要求要寫在他當下讀到的地方 —— 否則他做完 commit 才被 commit-msg 擋,而那時他不知道要貼什麼。
    const gateText = readFileSync(GATE_SRC, 'utf8');
    expect(gateText).toContain(`${TOKEN}:`);
  });
});
