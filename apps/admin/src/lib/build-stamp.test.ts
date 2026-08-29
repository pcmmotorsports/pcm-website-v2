import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * `scripts/build-with-stamp.sh` + `build-stamp.ts` 的守門測試。
 *
 * 🔴 **為什麼這支檔存在**:codex 2026-08-29 對抗審查逐字:
 *    「四支讀者測試只是【使用】它,**不能證明守門本身有判別力**」——
 *    它並列了七個沒被測過的世界(成功/失敗清戳記、rc 穿透、錯 app、壞 JSON、缺欄位、
 *    git 不可用、戳記寫入失敗)。**本檔把其中【可在拋棄式目錄裡演的】那幾個補上。**
 *
 * 🛑 **它不碰真的 `.next`** —— 八窗共用一棵樹,而本檔若去動 `apps/admin/.next`,
 *    它會清掉別人正在用的產物(今晚已經有一支測試在做這件事了,不再多一支)。
 *    ⇒ 用 `mkdtemp` 造一個假 app 根,對著它跑 wrapper。
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const WRAPPER = join(REPO, 'scripts', 'build-with-stamp.sh');

/** 在拋棄式目錄裡跑一段 shell,回 `{ rc, out }` —— rc 單獨收,不串接。 */
function sh(cmd: string, cwd: string): { rc: number; out: string } {
  try {
    const out = execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { rc: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { rc: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('build-with-stamp.sh —— 先刪後寫,而失敗世界留下的是【無戳記】', () => {
  it('🔴 正對照:wrapper 存在且可執行(否則下面每一格都是恆真)', () => {
    expect(existsSync(WRAPPER)).toBe(true);
  });

  it('🔴 缺 app 參數 ⇒ rc=2(用法錯與失敗要分得開)', () => {
    const r = sh(`bash ${JSON.stringify(WRAPPER)}`, REPO);
    expect(r.rc).toBe(2);
  });

  it('🔴🔴 build 失敗 ⇒ 【舊戳記必須不見】(這是本機制唯一真正在守的那件事)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bstamp-'));
    try {
      const nextDir = join(tmp, 'apps', 'zzzapp', '.next');
      mkdirSync(nextDir, { recursive: true });
      const stamp = join(nextDir, 'BUILD_OK');
      writeFileSync(stamp, '{"app":"zzzapp","head":"deadbeef","at":"昨天","rc":0}\n');
      expect(existsSync(stamp)).toBe(true); // 正對照:它真的在

      // 造一個假 wrapper 世界:同一支腳本,而 `next` 指向一個必定失敗的替身。
      mkdirSync(join(tmp, 'bin'), { recursive: true });
      writeFileSync(join(tmp, 'bin', 'next'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
      const r = sh(
        `PATH="${tmp}/bin:$PATH" BUILD_STAMP_REPO_ROOT=${JSON.stringify(tmp)} bash ${JSON.stringify(WRAPPER)} zzzapp`,
        tmp,
      );

      // 🔴 兩個宣稱分開驗:rc 穿透 + 舊戳記被刪
      expect(r.rc).toBe(7); // rc 原樣穿透(不是被壓成 1)
      expect(existsSync(stamp)).toBe(false); // 失敗世界留下的是【無戳記】
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('✅ 負對照:build 成功 ⇒ 戳記寫得出來,而內容帶得出分母(app / head / at / rc)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bstamp-ok-'));
    try {
      mkdirSync(join(tmp, 'apps', 'zzzapp', '.next'), { recursive: true });
      mkdirSync(join(tmp, 'bin'), { recursive: true });
      writeFileSync(join(tmp, 'bin', 'next'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const r = sh(`PATH="${tmp}/bin:$PATH" BUILD_STAMP_REPO_ROOT=${JSON.stringify(tmp)} bash ${JSON.stringify(WRAPPER)} zzzapp`, tmp);
      expect(r.rc).toBe(0);
      const stamp = join(tmp, 'apps', 'zzzapp', '.next', 'BUILD_OK');
      expect(existsSync(stamp)).toBe(true);
      const j = JSON.parse(readFileSync(stamp, 'utf8')) as Record<string, unknown>;
      // 🔴 戳記自帶分母:四個欄位缺一個,讀的人就少一格判斷依據。
      expect(j.app).toBe('zzzapp');
      expect(j.rc).toBe(0);
      expect(String(j.head)).toMatch(/^[0-9a-f]{7,40}$|^unknown$/);
      expect(String(j.at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
