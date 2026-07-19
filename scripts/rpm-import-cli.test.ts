// rpm-import-cli.test.ts — 寫入授權硬鎖的【行為】測試(Codex R1 2026-07-19 must-fix M4)
//
// 為什麼要真的跑 CLI:supplier-config.test.ts 測的是「設定值 writeAllowed=false」,
// 但真正保護 prod 的是 rpm-import.ts main() 裡那道 if(CONFIRM_WRITE && !config.writeAllowed) throw。
// 值測試綠 ≠ guard 還在——把那個 if 整段刪掉,既有測試全綠、未授權供應商直接開寫。
// 這支補的就是那個縫:實際 spawn CLI,驗「拒絕」這個行為本身。
//
// 🔴 安全設計(這支測試自己不能變成寫入路徑):
//   1. cwd = 系統暫存目錄(非 repo 根)→ rpm-import 的 existsSync('.env.local') 為 false、
//      絕不載入真實連線 env。
//   2. env 白名單只給 PATH/HOME → 沒有任何 QUOTE_* / SUPABASE_* 可用。
//      即使 guard 被拿掉(測試該紅的情境),流程也會卡在 requireEnv、連不上任何資料庫。
//   3. 全程不帶會寫入的 supplier 進真實管線:授權家(rpm)的對照組刻意只驗「錯誤訊息不是
//      writeAllowed」,它在 requireEnv 就死了,不會 fetch、不會 upsert。

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, '..');
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const IMPORT_SCRIPT = join(SCRIPTS_DIR, 'rpm-import.ts');
const CLI_TIMEOUT = 60_000;

/** 在無 env、非 repo cwd 的沙箱跑 rpm-import CLI;回 exit code + 合併輸出。 */
function runImportCli(args: string[]): { status: number | null; output: string } {
  const r = spawnSync(TSX_BIN, [IMPORT_SCRIPT, ...args], {
    cwd: tmpdir(), // 🔴 離開 repo 根 → 不載 .env.local(見檔頭安全設計 1)
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }, // 🔴 白名單、零連線憑證(安全設計 2)
    encoding: 'utf8',
    timeout: CLI_TIMEOUT - 5_000,
  });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('rpm-import CLI:writeAllowed 硬鎖行為(must-fix M4)', () => {
  // 🔴 未授權樣本 = lightech(#275 https 重抓未完成、writeAllowed 仍 false)。
  //    原本這條用 akrapovic;2026-07-19 首灌批准後它翻 true,這條測試**當場紅**——
  //    正是本檔要證明的事:guard 沒觸發時流程會往下走到 requireEnv。換樣本、不是放寬斷言。
  //    未來 lightech 開寫時這條也會紅 → 那時再換成當時仍未授權的一家(名單見 supplier-config.ts)。
  it(
    '🔴 lightech(未授權)+ --confirm-write → 非零退出且明說 writeAllowed=false(建線/連線前就擋)',
    () => {
      const { status, output } = runImportCli(['--supplier=lightech', '--confirm-write']);
      expect(status).not.toBe(0);
      expect(output).toMatch(/writeAllowed=false/);
      expect(output).toMatch(/lightech/);
      // guard 必須在任何連線之前:若它跑到 requireEnv 才死,代表 guard 被搬到連線之後或被拿掉
      expect(output).not.toMatch(/QUOTE_SUPABASE_URL not set/);
    },
    CLI_TIMEOUT,
  );

  it.each(['rpm', 'akrapovic'])(
    '對照組:授權家(%s)+ --confirm-write 不該被 writeAllowed 擋(證明擋的是授權、不是全部擋)',
    (supplier) => {
      const { status, output } = runImportCli([`--supplier=${supplier}`, '--confirm-write']);
      expect(status).not.toBe(0); // 沙箱無 env → 卡在 requireEnv(非本測試關注點)
      expect(output).not.toMatch(/writeAllowed=false/); // 🔴 這才是斷言:它過了授權關
      expect(output).toMatch(/QUOTE_SUPABASE_URL not set/);
    },
    CLI_TIMEOUT,
  );

  it(
    '未登記供應商 + --confirm-write → fail-closed(getSupplierConfig throw、早於一切)',
    () => {
      const { status, output } = runImportCli(['--supplier=not-a-supplier', '--confirm-write']);
      expect(status).not.toBe(0);
      expect(output).toMatch(/未知供應商/);
    },
    CLI_TIMEOUT,
  );

  it(
    '--expect-groups 非正整數 → fail-closed 拒跑(M2:不得被當成「沒帶」而靜默放行)',
    () => {
      const { status, output } = runImportCli(['--supplier=rpm', '--dry-run', '--expect-groups=abc']);
      expect(status).not.toBe(0);
      expect(output).toMatch(/--expect-groups 需為正整數/);
    },
    CLI_TIMEOUT,
  );
});
