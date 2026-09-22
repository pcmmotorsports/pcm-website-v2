// rpm-sync-workflow.test.ts —— rpm-sync.yml 手動「只跑一家 / 只乾跑」的字面守門(2026-09-16)。
// 🔴 本檔是【文字層】斷言:證的是 workflow 寫了什麼,證不到 GitHub 真的怎麼算那些 if(那要真的 dispatch 一次)。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(join(__dirname, '..', '.github', 'workflows', 'rpm-sync.yml'), 'utf-8');
const STEP_IF = "if: ${{ inputs.supplier == matrix.supplier || (!inputs.supplier && !inputs.dry_run) }}";

function jobBlock(name: string): string {
  const start = yml.indexOf(`\n  ${name}:\n`);
  expect(start, `找不到 job ${name}`).toBeGreaterThan(0);
  const next = yml.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

describe('rpm-sync.yml 手動 supplier / dry_run', () => {
  it('排程本身沒動:cron 與 matrix 19 家仍在', () => {
    // 2026-09-23 表訂 12:30 → 07:45(UTC 23:45);不得早於台灣 07:30(要在報價單 07:15 翻譯之後)。
    expect(yml).toContain("- cron: '45 23 * * *'");
    const m = /supplier:\s*\[([^\]]*)\]/.exec(yml);
    expect(m![1]!.split(',').map((s) => s.trim())).toHaveLength(19);
  });

  it('🔴 sync 的每一步都掛同一個 if(少一步 ⇒ 只跑一家時那一步會在 19 個 job 裡都跑)', () => {
    const sync = jobBlock('sync');
    const steps = sync.split('\n      - name: ').length - 1;
    expect(steps).toBeGreaterThan(4);
    expect(sync.split(STEP_IF).length - 1).toBe(steps);
  });

  it('🔴 乾跑永遠不帶 --confirm-write:兩個旗標只由同一個三元式二選一', () => {
    // 只認真正的 run 行(註解裡也提到 scripts/rpm-import.ts,不能拿它當證據)
    const runs = yml.split('\n').filter((l) => /^\s*run: pnpm exec tsx scripts\/rpm-import\.ts /.test(l));
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run).toContain("${{ inputs.dry_run && '--dry-run' || '--confirm-write' }}");
    expect(run.match(/--confirm-write/g)).toHaveLength(1);
  });

  it('🔴 帶 --confirm-write 的 image-trim-scan 與寄客服信在乾跑時不跑', () => {
    expect(jobBlock('image-trim-scan')).toContain('if: ${{ !cancelled() && !inputs.dry_run }}');
    expect(jobBlock('notify-failure')).toContain('if: ${{ failure() && !inputs.dry_run }}');
  });

  it('🔴 inputs.supplier 不插進任何 run(自由字串 ⇒ 注入);dispatch-guard 走 env', () => {
    const runLines = yml.split('\n').filter((l) => /^\s*run:/.test(l) || /^\s{10,}\S/.test(l));
    expect(runLines.filter((l) => l.includes('inputs.supplier') && !/^\s*(if:|SUPPLIER:)/.test(l.trim()) && !l.trim().startsWith('#'))).toEqual([]);
    expect(jobBlock('dispatch-guard')).toContain('SUPPLIER: ${{ inputs.supplier }}');
    expect(jobBlock('dispatch-guard')).toContain("if: ${{ github.event_name == 'workflow_dispatch' }}");
  });
});
