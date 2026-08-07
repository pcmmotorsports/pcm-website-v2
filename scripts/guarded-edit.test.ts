// guarded-edit.test.ts — guarded-edit.sh 的負向測試(backlog #339)。
//
// 🔴 這支守門本身就是為了「靜默吃掉鄰居」而存在的,所以它自己失效也必須是**吵的**:
//   每條防護都要有一個「只紅它那一條」的負測,而不是只證明 happy path 會過。
//   對應 backlog #339 的三條 + 進 repo 時我實查到的第四個洞(untracked 檔恆真)。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARD = resolve(process.cwd(), 'scripts/guarded-edit.sh');
let dir: string;

/** 寫一支 python 編輯腳本,對 target 做指定的內容替換。 */
function editor(name: string, py: string): string {
  const p = join(dir, name);
  writeFileSync(p, py, 'utf8');
  return p;
}

function runGuard(file: string, add: number, del: number, editorPath: string) {
  const r = spawnSync('bash', [GUARD, file, String(add), String(del), editorPath], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const TEN_LINES = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n';

// 註:不 chmod GUARD —— 測試一律用 `bash [GUARD]` 呼叫,不需要可執行位;
//     對 repo 內檔案改 mode 會是測試副作用。
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'guarded-edit-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('happy path(正向對照,防守門恆假)', () => {
  it('宣告與實得相符 → exit 0,檔案保留改動', () => {
    const f = join(dir, 'ok.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = editor(
      'ed-ok.py',
      `import pathlib\np=pathlib.Path(${JSON.stringify(f)})\np.write_text(p.read_text().replace('line5','LINE5'))\n`,
    );
    const r = runGuard(f, 1, 1, ed);
    expect(r.status).toBe(0);
    expect(readFileSync(f, 'utf8')).toContain('LINE5');
  });
});

describe('🔴 核心:切片吃掉鄰居必須被擋 + 自動還原', () => {
  it('宣告 +1/-1 但實際吃掉 8 行 → exit 1 且檔案被還原成原樣', () => {
    const f = join(dir, 'eat.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const before = readFileSync(f, 'utf8');
    // 模擬「起訖索引切片」誤吃鄰居:本來只想改 line5,結果連 line3-9 一起沒了
    const ed = editor(
      'ed-eat.py',
      `import pathlib\np=pathlib.Path(${JSON.stringify(f)})\nls=p.read_text().splitlines(True)\np.write_text(''.join(ls[:2])+'LINE5\\n'+''.join(ls[9:]))\n`,
    );
    const r = runGuard(f, 1, 1, ed);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Δ 對帳不符/);
    expect(r.stderr).toMatch(/被起訖索引吃掉的鄰居/);
    // 🔴 還原必須是真的還原,不是只印訊息
    expect(readFileSync(f, 'utf8')).toBe(before);
  });
});

describe('🔴 防護①:對帳基準是「本次編輯」,不是「相對 HEAD 的總量」', () => {
  // 舊版量 git diff 對 HEAD 的數字再相減。這格用 untracked 新檔把那條路徑打死:
  // untracked 檔的 `git diff --numstat` 回空 ⇒ 舊版 Δ 恆為 0-0=0 ⇒ 守門恆真且靜默。
  it('🔴 untracked 新檔也要能對帳(舊版在此恆真)', () => {
    const sub = mkdtempSync(join(tmpdir(), 'ge-untracked-'));
    spawnSync('git', ['init', '-q'], { cwd: sub });
    spawnSync('git', ['config', 'user.email', 't@l'], { cwd: sub });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: sub });
    writeFileSync(join(sub, 'seed.txt'), 'seed\n', 'utf8');
    spawnSync('git', ['add', 'seed.txt'], { cwd: sub });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: sub });

    // 這個檔從未被 git 追蹤過
    const f = join(sub, 'untracked.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = join(sub, 'ed.py');
    writeFileSync(
      ed,
      `import pathlib\np=pathlib.Path(${JSON.stringify(f)})\nls=p.read_text().splitlines(True)\np.write_text(''.join(ls[:2]))\n`,
      'utf8',
    );
    const r = spawnSync('bash', [GUARD, f, '0', '1', ed], { cwd: sub, encoding: 'utf8' });
    expect(r.status).toBe(1); // 實際刪了 8 行、宣告只刪 1 行 ⇒ 必須紅
    expect(r.stderr).toMatch(/-8/);
    rmSync(sub, { recursive: true, force: true });
  });
});

describe('🔴 防護②:還原一律用備份,不得用 git checkout', () => {
  // git checkout -- <file> 會把該檔**其他未提交改動**一起丟掉。
  // 這格構造:檔案已有未提交改動,再跑一次會失敗的編輯 ⇒ 還原後那些改動必須還在。
  it('🔴 檔案已有未提交改動時,還原不得回到 HEAD(那會吃掉別人的工作)', () => {
    const sub = mkdtempSync(join(tmpdir(), 'ge-dirty-'));
    spawnSync('git', ['init', '-q'], { cwd: sub });
    spawnSync('git', ['config', 'user.email', 't@l'], { cwd: sub });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: sub });
    const f = join(sub, 'doc.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    spawnSync('git', ['add', 'doc.txt'], { cwd: sub });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: sub });

    // 別人的未提交改動
    writeFileSync(f, TEN_LINES.replace('line1', 'PRECIOUS-UNCOMMITTED'), 'utf8');
    const dirtyContent = readFileSync(f, 'utf8');

    const ed = join(sub, 'ed.py');
    writeFileSync(
      ed,
      `import pathlib\np=pathlib.Path(${JSON.stringify(f)})\nls=p.read_text().splitlines(True)\np.write_text(''.join(ls[:3]))\n`,
      'utf8',
    );
    const r = spawnSync('bash', [GUARD, f, '0', '1', ed], { cwd: sub, encoding: 'utf8' });
    expect(r.status).toBe(1);
    // 🔴 還原後必須等於「編輯前」而不是 HEAD —— 用 git checkout 的話這行會紅
    expect(readFileSync(f, 'utf8')).toBe(dirtyContent);
    expect(readFileSync(f, 'utf8')).toContain('PRECIOUS-UNCOMMITTED');
    rmSync(sub, { recursive: true, force: true });
  });
});

describe('🔴 防護③:「Δ 擋不了語意」必須出現在守門自己的訊息裡', () => {
  it('失敗訊息含語意警告(不能只寫在檔頭註解)', () => {
    const f = join(dir, 'sem-fail.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = editor(
      'ed-sem-fail.py',
      `import pathlib\np=pathlib.Path(${JSON.stringify(f)})\nls=p.read_text().splitlines(True)\np.write_text(''.join(ls[:5]))\n`,
    );
    const r = runGuard(f, 0, 1, ed);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/只比\*\*行數\*\*|只比.*行數/);
  });

  it('🔴 成功訊息也要含語意警告(通過那一刻最容易被當成「已驗過」)', () => {
    const f = join(dir, 'sem-ok.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = editor(
      'ed-sem-ok.py',
      `import pathlib\np=pathlib.Path(${JSON.stringify(f)})\np.write_text(p.read_text().replace('line5','WRONG'))\n`,
    );
    const r = runGuard(f, 1, 1, ed);
    expect(r.status).toBe(0); // 行數對得上 ⇒ 放行(這是設計,不是 bug)
    expect(r.stdout).toMatch(/行數/);
  });
});

describe('邊界與 fail-closed', () => {
  it('編輯腳本非零退出 → 還原且非零(不把半成品留在檔案裡)', () => {
    const f = join(dir, 'boom.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const before = readFileSync(f, 'utf8');
    const ed = editor(
      'ed-boom.py',
      `import pathlib,sys\np=pathlib.Path(${JSON.stringify(f)})\np.write_text('半成品\\n')\nsys.exit(3)\n`,
    );
    const r = runGuard(f, 0, 0, ed);
    expect(r.status).toBe(1);
    expect(readFileSync(f, 'utf8')).toBe(before);
  });

  it('編輯腳本把檔案刪掉 → 還原且非零', () => {
    const f = join(dir, 'gone.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = editor(
      'ed-gone.py',
      `import pathlib\npathlib.Path(${JSON.stringify(f)}).unlink()\n`,
    );
    const r = runGuard(f, 0, 0, ed);
    expect(r.status).toBe(1);
    expect(existsSync(f)).toBe(true);
  });

  it('宣告值非數字 → exit 2(參數錯與對帳失敗要分得開)', () => {
    const f = join(dir, 'arg.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = editor('ed-noop.py', 'pass\n');
    const r = spawnSync('bash', [GUARD, f, 'abc', '1', ed], { cwd: dir, encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  it('編輯腳本不存在 → exit 2', () => {
    const f = join(dir, 'arg2.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const r = spawnSync('bash', [GUARD, f, '0', '0', join(dir, '不存在.py')], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// 🔴 進 repo 時 code-reviewer 抓到 6 條 must-fix,共同形狀都是
//    「守門自己靜默失效」。這一組把每個破口釘住。
// ─────────────────────────────────────────────────────────────
describe('🔴 fail-loud:守門自己的每一步失敗都必須是吵的', () => {
  // MF3:binary 檔 numstat 回 `-`,若映成 0 ⇒ 整個檔被改寫、宣告 0/0 也會印「✅ 相符」。
  it('🔴 binary 檔量不到 → 當失敗(絕不可把「量不到」寫成「沒變」)', () => {
    const f = join(dir, 'bin.dat');
    writeFileSync(f, Buffer.from([0x41, 0x00, 0x42, 0x0a]));
    const ed = editor(
      'ed-bin.py',
      `import pathlib\npathlib.Path(${JSON.stringify(f)}).write_bytes(b'\\x00totally different\\x00\\n')\n`,
    );
    const r = runGuard(f, 0, 0, ed);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/量不到|不敢判定/);
  });

  // MF4:原本不存在的檔,還原必須是「刪掉」,不是留下 mktemp 的 0 byte 空檔。
  it('🔴 新建檔對帳不符 → 還原成「完全不存在」,不留 0 byte 幽靈檔', () => {
    const f = join(dir, 'brand-new.txt');
    const ed = editor(
      'ed-new.py',
      `import pathlib\npathlib.Path(${JSON.stringify(f)}).write_text('a\\nb\\nc\\n')\n`,
    );
    const r = runGuard(f, 1, 0, ed); // 實際 +3,宣告 +1 ⇒ 不符
    expect(r.status).toBe(1);
    expect(existsSync(f)).toBe(false); // 🔴 舊版會留下 0 byte 檔
  });

  // MF1:沒有備份就不能保證還原得回來 ⇒ 拒絕執行,而不是硬跑。
  it('🔴 備份失敗 → 拒絕執行 exit 2(不冒「改壞了還原不回來」的險)', () => {
    const f = join(dir, 'unreadable.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    chmodSync(f, 0o000);
    const ed = editor('ed-noop2.py', 'pass\n');
    const r = runGuard(f, 0, 0, ed);
    chmodSync(f, 0o644);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/備份.*失敗|拒絕執行/);
  });

  it('symlink → 拒跑 exit 2(git diff 會比到 link target 字串而非內容)', () => {
    const target = join(dir, 'real.txt');
    writeFileSync(target, TEN_LINES, 'utf8');
    const link = join(dir, 'link.txt');
    symlinkSync(target, link);
    const ed = editor('ed-noop3.py', 'pass\n');
    const r = runGuard(link, 0, 0, ed);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/symlink/);
  });

  it('備份路徑一定要印出來(中途異常時人得找得到它)', () => {
    const f = join(dir, 'shows-backup.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = editor('ed-noop4.py', 'pass\n');
    const r = runGuard(f, 0, 0, ed);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/備份:/);
  });

  // nit 10:非 .py 的編輯腳本走 bash 分支,原本 10 格全未覆蓋。
  it('bash 編輯腳本(非 .py)也走得通', () => {
    const f = join(dir, 'via-bash.txt');
    writeFileSync(f, TEN_LINES, 'utf8');
    const ed = join(dir, 'ed.sh');
    writeFileSync(ed, `sed -i '' 's/line5/LINE5/' ${JSON.stringify(f)}\n`, 'utf8');
    const r = runGuard(f, 1, 1, ed);
    expect(r.status).toBe(0);
    expect(readFileSync(f, 'utf8')).toContain('LINE5');
  });
});
