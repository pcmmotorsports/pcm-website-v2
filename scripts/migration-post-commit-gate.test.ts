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
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  writeFileSync(join(scratch, MIGDIR, name), body);
  sh('git', ['add', `${MIGDIR}/${name}`]);
}

/** 清掉 scratch 裡所有 staged 的 migration(檔案與 index 都清)。 */
function clearMigrations() {
  const ls = sh('git', ['diff', '--cached', '--name-only', '--', `${MIGDIR}/`]);
  for (const f of ls.out.split('\n').filter(Boolean)) sh('git', ['rm', '-q', '--cached', '--', f]);
  sh('bash', ['-c', `rm -f "${join(scratch, MIGDIR)}"/*.sql`]);
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
