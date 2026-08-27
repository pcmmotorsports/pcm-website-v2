// check-syntax-nonts.test.ts — 守門自己的負向測試。
//
// 🔴 紀律(memory feedback_negative-test-harness-self-false-green /
//   feedback_guard-checks-existence-not-effect):
//   每一格檢查都要有**只紅它那一條**的負向測試;而且負測必須是「改壞值、保留形狀」,
//   不是「拿掉整個檔」——後者證明不了守門有判別力。
//   每組都配一個「合法版本必須綠」的正向對照,否則守門恆假也會全綠。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkShell, checkYaml, checkSql, checkPython, checkOne, PY_MIN } from './check-syntax-nonts';

let dir: string;
const w = (name: string, content: string): string => {
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'chk-nonts-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('.sh — bash -n', () => {
  it('合法 shell → 綠(正向對照,防守門恆假)', () => {
    const f = w('ok.sh', '#!/bin/bash\nset -e\nfor i in 1 2 3; do\n  echo "$i"\ndone\n');
    expect(checkShell(f)).toBeNull();
  });

  it('未閉合的 do/done → 紅,且帶得出行號', () => {
    const f = w('bad.sh', '#!/bin/bash\nfor i in 1 2 3; do\n  echo "$i"\n');
    const r = checkShell(f);
    expect(r).not.toBeNull();
    expect(r?.reason).toMatch(/syntax error|unexpected/i);
  });

  it('未閉合引號 → 紅', () => {
    const f = w('quote.sh', '#!/bin/bash\necho "沒有收尾的引號\n');
    expect(checkShell(f)).not.toBeNull();
  });

  // 這格驗「逐檔各自判定」的行為。
  // ⚠️ 誠實邊界:它**擋不住**真正的風險形狀 —— 若有人把 package.json 寫成
  //    `"*.sh": "bash -n"` 讓 lint-staged 批次帶多檔,本格照樣綠(它沒經過 package.json)。
  //    真正釘住那個形狀的是下面「CLI 端到端」那組。此處只證明 checkShell 本身逐檔正確。
  it('🔴 兩個檔、只有第二個壞 → 第二個必須被抓到(防「批次帶入只驗第一個」的恆真)', () => {
    const good = w('first-ok.sh', '#!/bin/bash\necho ok\n');
    const bad = w('second-bad.sh', '#!/bin/bash\nif true; then\n  echo hi\n');
    expect(checkShell(good)).toBeNull();
    expect(checkShell(bad)).not.toBeNull();
    // 經由 checkOne 分流也要成立(分流表打錯會在這裡紅)
    expect(checkOne(bad)).not.toBeNull();
  });
});

describe('.yaml — 用既有 yaml 套件 parse', () => {
  it('合法 YAML → 綠(正向對照)', () => {
    const f = w('ok.yaml', 'name: 測試\nitems:\n  - a\n  - b\n');
    expect(checkYaml(f)).toBeNull();
  });

  // 🔴 這格重現 D 線 2026-08-07 的真實故障:manifest 被插入未跳脫的雙引號,
  //    四綠(typecheck/lint/build/test)全部 exit=0、零判別力。
  it('🔴 引號字串內插入未跳脫雙引號 → 紅(D 線真實案例)', () => {
    const f = w('broken.yaml', 'title: "他說 "這樣" 不行"\nother: 1\n');
    const r = checkYaml(f);
    expect(r).not.toBeNull();
    expect(r?.line).not.toBeNull();
  });

  it('縮排錯誤 → 紅', () => {
    const f = w('indent.yaml', 'a:\n  b: 1\n   c: 2\n');
    expect(checkYaml(f)).not.toBeNull();
  });

  it('.yml 副檔名走同一條路(分流表遺漏 .yml 會在這裡紅)', () => {
    const f = w('broken.yml', 'title: "壞掉 "的" 引號"\n');
    expect(checkOne(f)).not.toBeNull();
  });

  // 🔴 釘住 Fable R2 F1:`---` 分隔的多文件 YAML 是**合法語法**(k8s manifest 類常見),
  //    早期用 `parse` 會丟 multiple documents 而誤擋。誤擋合法檔會逼人 --no-verify。
  it('🔴 合法多文件 YAML(--- 分隔)→ 綠(防誤擋)', () => {
    const f = w('multi-ok.yaml', 'doc: 1\n---\ndoc: 2\n---\ndoc: 3\n');
    expect(checkYaml(f)).toBeNull();
  });

  it('🔴 多文件 YAML 裡「第二份」壞掉 → 仍要紅(改 parseAllDocuments 別漏檢後面幾份)', () => {
    const f = w('multi-bad.yaml', 'doc: 1\n---\na:\n  b: 1\n   c: 2\n');
    expect(checkYaml(f)).not.toBeNull();
  });
});

describe('.sql — 配對平衡(刻意不是語法檢查)', () => {
  it('合法 SQL(含 plpgsql dollar-quote)→ 綠(正向對照)', () => {
    const f = w(
      'ok.sql',
      [
        '-- 註解裡有 unbalanced ( 和 \' 單引號,不該影響判斷',
        '/* 區塊註解 /* 巢狀 */ 也要能收 */',
        'CREATE OR REPLACE FUNCTION f() RETURNS void AS $$',
        'BEGIN',
        "  RAISE NOTICE 'it''s fine';",
        'END;',
        '$$ LANGUAGE plpgsql;',
        "INSERT INTO t (a, b) VALUES ('x', 'y');",
      ].join('\n'),
    );
    expect(checkSql(f)).toBeNull();
  });

  it('🔴 dollar-quote 未閉合 → 紅', () => {
    const f = w('dq.sql', 'CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\nEND;\n');
    const r = checkSql(f);
    expect(r).not.toBeNull();
    expect(r?.reason).toMatch(/dollar-quote/);
  });

  it('🔴 單引號未閉合(插入未跳脫引號的 SQL 版)→ 紅', () => {
    const f = w('quote.sql', "SELECT * FROM t WHERE name = '沒收尾;\n");
    const r = checkSql(f);
    expect(r).not.toBeNull();
    expect(r?.reason).toMatch(/單引號/);
  });

  it('多餘右括號 → 紅', () => {
    const f = w('paren.sql', 'SELECT (a + b)) FROM t;\n');
    expect(checkSql(f)).not.toBeNull();
  });

  it('缺右括號 → 紅', () => {
    const f = w('paren2.sql', 'SELECT (a + b FROM t;\n');
    expect(checkSql(f)).not.toBeNull();
  });

  // 🔴 誠實邊界的測試化:這格**明確記錄它抓不到什麼**,
  //    免得日後有人看到「.sql 有守門」就以為 SQL 已被驗過。
  //    ⚠️ 這格把盲區釘死了:日後若升級成真 parser,它會**為了對的理由變紅** —— 屆時本格要一起改,
  //    不是把 parser 改回來。
  it('⚠️ 已知盲區:平衡但語意錯誤的 SQL 照樣綠(本守門不是語法檢查)', () => {
    const f = w('semantic.sql', 'SELCT * FRM 不存在的表;\n');
    expect(checkSql(f)).toBeNull(); // 刻意為 null——這是設計,不是 bug
  });
});

describe('.py — python3 ast.parse', () => {
  it('合法 python → 綠(正向對照,防守門恆假)', () => {
    const f = w('ok.py', 'import sys\n\n\ndef main():\n    print(sys.argv)\n');
    expect(checkPython(f)).toBeNull();
  });

  // 🔴 斷**確切行號**與**確切檔名**,不是「非 null」(codex R2 nit):
  //    `not.toBeNull()` 在行號被突變成 999、或 Failure.file 指到別的檔時,照樣全綠。
  it('未閉合括號 → 紅,且行號=1、檔名=這個檔(不是「非 null」)', () => {
    const f = w('bad-paren.py', 'x = foo(1, 2\ny = 3\n');
    const r = checkPython(f);
    expect(r).not.toBeNull();
    // 🔴 行號是**量到的 1**,不是我以為的 2:Python 把 `(` 沒收尾算在**開括號那一行**。
    //    我第一版寫 2、測試當場紅 —— 留這句是因為斷言確切行號的價值就在這裡:
    //    寫「非 null」的話,我那個錯的心智模型會一路綠著活下去。
    expect(r?.line).toBe(1);
    expect(r?.file).toBe(f);
  });

  it('縮排錯誤 → 紅', () => {
    const f = w('bad-indent.py', 'def f():\nreturn 1\n');
    expect(checkPython(f)).not.toBeNull();
  });

  it('未閉合三引號 → 紅(插入未跳脫引號的 python 版)', () => {
    const f = w('bad-quote.py', 'DOC = """沒有收尾\nprint(1)\n');
    expect(checkPython(f)).not.toBeNull();
  });

  // 這格是**誠實邊界**,不是缺陷:寫下來免得下一個人把「.py 全綠」讀成「那些腳本沒問題」。
  it('⚠️ 已知盲區:import 不存在的模組 / 名稱打錯 → 照樣綠(本守門只 parse,不執行)', () => {
    const f = w('runtime-boom.py', 'import 這個模組不存在\nprint(undefined_name)\n');
    expect(checkPython(f)).toBeNull();
  });

  // 與 .sh 同一個坑:批次帶入只驗第一個 = 恆真守門。
  it('🔴 兩個檔、只有第二個壞 → 第二個必須被抓到(且分流表也要對)', () => {
    const good = w('first-ok.py', 'print("ok")\n');
    const bad = w('second-bad.py', 'def f(:\n    pass\n');
    expect(checkPython(good)).toBeNull();
    expect(checkPython(bad)).not.toBeNull();
    expect(checkOne(bad)).not.toBeNull();
  });

  // ── codex R1 must-fix 1:編碼要交給 Python 自己判,兩個方向都要對 ──
  it("🔴 `# coding: ascii` 檔頭 + UTF-8 中文 → 紅(真 Python 也紅;餵 str 的舊版會綠)", () => {
    const f = w('cookie-ascii.py', '# coding: ascii\nx = "中文"\n');
    const r = checkPython(f);
    expect(r).not.toBeNull();
    // 這類錯 Python 給不出行號 ⇒ 不可印成 `檔:0` 叫人去看第 0 行
    expect(r?.line).toBeNull();
  });

  it('🔴 合法的 Latin-1 檔(帶 coding 宣告)→ 綠(舊版會 UnicodeDecodeError 誤擋合法檔)', () => {
    const p = join(dir, 'cookie-latin1.py');
    writeFileSync(p, Buffer.from('# coding: latin-1\ns = "caf\xe9"\n', 'latin1'));
    expect(checkPython(p)).toBeNull();
  });

  // ── codex R2 #1-#3:版本歧異改用**機制**(會自己出聲的地板),不用判斷 ──
  // ⚠️ 舊版這格只拿「普通壞語法」驗訊息裡有沒有版本字串 —— 3.13 / 3.14 都會過,
  //    **對「同一份檔兩個版本判定不同」這個核心缺陷恆綠**(codex R2 must-fix 5)。
  //    現在改成直接驗地板本身,而且兩個方向都跑。
  it('🔴 python3 低於地板 → 紅,且訊息說得出「要幾版、實得幾版」', () => {
    const f = w('floor-ok.py', 'x = 1\n');
    const r = checkPython(f, [3, 99]); // 拿一個一定達不到的地板 = 模擬「跑在舊 python 上」
    expect(r).not.toBeNull();
    expect(r?.reason).toMatch(/版本地板未達/);
    expect(r?.reason).toMatch(/>= 3\.99/); // 要幾版
    expect(r?.reason).toMatch(/實得 \d+\.\d+/); // 實得幾版
    expect(r?.line).toBeNull(); // 這不是檔案的問題 ⇒ 不可給行號
    expect(r?.file).toBe(f);
  });

  it('🔴 python3 達到地板 → 綠(反向對照;少了這格,上面那格在「永遠紅」時也會過)', () => {
    const f = w('floor-ok2.py', 'x = 1\n');
    expect(checkPython(f, PY_MIN)).toBeNull();
    expect(checkPython(f)).toBeNull(); // 預設參數也要走同一條路
  });

  it('一般語法錯的訊息仍帶得出 python 版本(版本造成的紅要能自我診斷)', () => {
    const f = w('ver.py', 'x = (1\n');
    expect(checkPython(f)?.reason).toMatch(/\[python \d+\.\d+/);
  });

  it('讀不到的 .py → 紅而不是靜默綠(fail-closed)', () => {
    expect(checkPython(join(dir, '根本不存在.py'))).not.toBeNull();
  });
});

describe('分流與邊界', () => {
  it('非守備範圍副檔名 → null(不誤擋 .ts/.md)', () => {
    const f = w('x.md', '# 標題\n');
    expect(checkOne(f)).toBeNull();
  });

  // ⚠️ 這格測的是 `checkOne` 的分流(regex 帶 /i)。真 gate 走 lint-staged 的 micromatch,
  //    glob `*.{sh,yaml,yml,sql}` **預設 case-sensitive** ⇒ `FOO.SQL` 實際上進不到這支腳本。
  //    本 repo 目前 0 個大寫副檔名檔案、無實害;但不要把這格讀成「大寫檔已被 gate 覆蓋」。
  it('大寫副檔名也要分流到(.SQL/.YAML;僅函式層,非 gate 層)', () => {
    const f = w('UPPER.SQL', "SELECT '沒收尾;\n");
    expect(checkOne(f)).not.toBeNull();
  });

  it('讀不到的檔 → 紅而不是靜默綠(fail-closed)', () => {
    const r = checkYaml(join(dir, '不存在.yaml'));
    expect(r).not.toBeNull();
    expect(r?.reason).toMatch(/讀不到檔/);
  });
});

// ─────────────────────────────────────────────────────────────
// CLI 端到端 —— 🔴 這一組才是真正掛在 commit gate 上的東西。
//   上面那些格全部只測純函式;純函式全綠、CLI 卻整支不跑,失敗形狀就是「靜默全綠」,
//   正是本片要補的那個洞本身(2026-08-07 code-reviewer must-fix 1/2)。
// ─────────────────────────────────────────────────────────────
describe('CLI 端到端(commit gate 實際走的路徑)', () => {
  const TSX = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const SCRIPT = resolve(process.cwd(), 'scripts/check-syntax-nonts.ts');
  const run = (scriptPath: string, args: string[]) =>
    spawnSync(TSX, [scriptPath, ...args], { encoding: 'utf8' });

  it('壞檔 → exit 1(非 0 才擋得住 commit)', () => {
    const f = w('cli-bad.sql', "SELECT * FROM t WHERE n = '沒收尾;\n");
    const r = run(SCRIPT, [f]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/單引號/);
  });

  it('好檔 → exit 0(誤擋合法檔會逼人 --no-verify,整條 gate 就死了)', () => {
    const f = w('cli-ok.sql', "SELECT * FROM t WHERE n = 'ok';\n");
    expect(run(SCRIPT, [f]).status).toBe(0);
  });

  // 🔴 釘住 must-fix 1:原實作用 argv[1].endsWith('check-syntax-nonts.ts') 判斷是否直接執行,
  //   經 symlink/改名呼叫時整支靜默不跑(exit 0、零輸出)。這格若紅,代表那個洞回來了。
  it('🔴 經 symlink 改名呼叫 → 仍必須跑、仍必須 exit 1(防「整支靜默不跑」)', () => {
    const link = join(dir, 'renamed-gate.ts');
    symlinkSync(SCRIPT, link);
    const f = w('cli-symlink-bad.sql', "SELECT '沒收尾;\n");
    const r = run(link, [f]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/檢查 1 檔/); // 計數器有印 = 確實跑了,不是碰巧非 0
  });

  it('混入非守備副檔名 → 只計守備範圍的檔數(計數器不說謊)', () => {
    const sql = w('cli-mix.sql', "SELECT 'ok';\n");
    const md = w('cli-mix.md', '# 標題\n');
    const r = run(SCRIPT, [sql, md]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/檢查 1 檔/);
  });

  // 🔴 釘住 must-fix 4:合法的 PG escape string 曾被誤判成「單引號未閉合」而擋下 commit。
  it("🔴 合法 PG E-string `E'it\\'s ok'` → 綠(防誤擋合法 SQL)", () => {
    const f = w('cli-estring.sql', "SELECT E'it\\'s ok';\n");
    const r = run(SCRIPT, [f]);
    expect(r.status).toBe(0);
  });

  it('無檔案參數 → exit 0 且明講跳過(不誤紅)', () => {
    const r = run(SCRIPT, []);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/跳過/);
  });

  // 🔴 釘住 Fable R2 F2:`package.json` 的 glob → 腳本那一層,是全系統唯一零測試的接線。
  //    把 entry 整行刪掉、或 glob 打成 `slq`,底下所有格照樣全綠零訊號
  //    = feedback_guard-checks-existence-not-effect 的形狀(守門存在 ≠ 守門接著)。
  //    ⚠️ 這是**存在性釘**,只擋「被編輯掉/打錯字」;它證明不了 lint-staged 真的會呼叫成功
  //    (真效果測需在 scratch repo 實跑 lint-staged,已列 backlog、本片不做)。
  it('🔴 package.json 的 lint-staged 接線字面沒有被改掉(存在性釘,非效果證明)', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { 'lint-staged'?: Record<string, string> };
    expect(pkg['lint-staged']?.['*.{[sS][hH],[yY][aA][mM][lL],[yY][mM][lL],[sS][qQ][lL],[pP][yY]}']).toBe(
      'tsx scripts/check-syntax-nonts.ts',
    );
  });
});
