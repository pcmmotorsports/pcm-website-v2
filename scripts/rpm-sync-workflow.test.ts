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
    // 2026-09-24 Sean 批准:每日那一輪改由 Mac mini 07:45 手動觸發(daily), 排程降為備援、表訂台灣 11:17(UTC 03:17)。
    expect(yml).toContain("- cron: '17 3 * * *'");
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
    expect(jobBlock('image-trim-scan')).toContain("if: ${{ !cancelled() && !inputs.dry_run && needs.sync.result != 'skipped' }}");
    expect(jobBlock('notify-failure')).toContain('if: ${{ failure() && !inputs.dry_run }}');
  });

  it('🔴 inputs.supplier 不插進任何 run(自由字串 ⇒ 注入);dispatch-guard 走 env', () => {
    const runLines = yml.split('\n').filter((l) => /^\s*run:/.test(l) || /^\s{10,}\S/.test(l));
    // 2026-09-24:DEALER_PRICE_TRIGGER 那一行只把 inputs.supplier 當【有沒有填】的布林用, 輸出只可能是
    //   'schedule' 或 github.event_name(下面 daily 那一組逐字釘住整行), 不會把字串帶進指令 ⇒ 列為例外。
    expect(runLines.filter((l) => l.includes('inputs.supplier') && !/^\s*(if:|SUPPLIER:|DEALER_PRICE_TRIGGER:)/.test(l.trim()) && !l.trim().startsWith('#'))).toEqual([]);
    expect(jobBlock('dispatch-guard')).toContain('SUPPLIER: ${{ inputs.supplier }}');
    expect(jobBlock('dispatch-guard')).toContain("if: ${{ github.event_name == 'workflow_dispatch' }}");
  });
});

describe('rpm-sync.yml Mac mini 日常觸發(daily)與備援略過(2026-09-24)', () => {
  const DAILY_ONLY = "inputs.daily && !inputs.supplier && !inputs.dry_run && inputs.dealer_price_checksum == ''";

  it('🔴 經銷價:只有「daily 且沒填 supplier / dry_run / checksum」的手動觸發才當成日常同步', () => {
    // 少了這條, 開灌價之後 Mac mini 每天那一輪沒有 checksum ⇒ 經銷價停在灌價那天(rpm-import.ts:376-390)。
    // 條件放寬(例如只看 daily)⇒ 第一次灌價的單家手動觸發可以不帶 checksum 就寫。
    const lines = yml.split('\n').filter((l) => /^\s*DEALER_PRICE_TRIGGER:/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`(github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && ${DAILY_ONLY})) && 'schedule' || github.event_name`);
  });

  it('🔴 run-name 的 daily 標題與備援檢查、Mac mini 腳本比對的是同一個字串、同一組條件', () => {
    expect(yml).toContain(`run-name: \${{ github.event_name == 'workflow_dispatch' && ${DAILY_ONLY} && 'Supplier Daily Sync (daily)' || 'Supplier Daily Sync' }}`);
    expect(jobBlock('already-ran-today')).toContain('select(.display_title == "Supplier Daily Sync (daily)")');
    const sh = readFileSync(join(__dirname, '..', 'ops', 'mac-mini', 'rpm-sync-dispatch.sh'), 'utf-8');
    expect(sh).toContain('TITLE="Supplier Daily Sync (daily)"');
    expect(sh).toContain('gh workflow run "$WF" --repo "$REPO" --ref dev -f daily=true');
    // Mac mini 去重也只認 dev;取消、失敗的不算已跑過。
    expect(sh).toContain('--branch dev --event workflow_dispatch');
    expect(sh).toContain("^completed success$");
  });

  it('🔴 備援檢查只在排程跑, 查不到就照跑(寧可重跑不漏跑);sync 在手動觸發時不被它擋掉', () => {
    const guard = jobBlock('already-ran-today');
    expect(guard).toContain("if: ${{ github.event_name == 'schedule' }}");
    expect(guard.match(/echo "skip=false" >> "\$GITHUB_OUTPUT"; exit 0/g)).toHaveLength(2);
    // 只認 dev、讀完每一頁(Codex 2026-09-24 R1:別的分支同名成功會讓備援誤略過;只讀第一頁會漏看)。
    expect(guard).toContain('gh api --paginate');
    expect(guard).toContain('event=workflow_dispatch&branch=dev&status=success');
    const sync = jobBlock('sync');
    expect(sync).toContain('needs: [already-ran-today, dispatch-guard]');
    expect(sync).toContain("if: ${{ !cancelled() && needs.already-ran-today.outputs.skip != 'true' && needs.dispatch-guard.result != 'failure' }}");
  });

  it('🔴 dispatch-guard 擋 daily 與 supplier / dry_run / checksum 混用, 而且它紅了 sync 就不跑(見上一格的 if)', () => {
    const g = jobBlock('dispatch-guard');
    expect(g).toContain('DAILY: ${{ inputs.daily }}');
    expect(g).toContain('CHECKSUM: ${{ inputs.dealer_price_checksum }}');
    expect(g).toContain('if [ "$DAILY" = "true" ] && { [ -n "$SUPPLIER" ] || [ "$DRY_RUN" = "true" ] || [ -n "$CHECKSUM" ]; }; then');
  });
});
