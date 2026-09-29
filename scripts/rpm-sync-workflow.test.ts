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
  it('排程本身沒動:cron 與 matrix 22 家仍在', () => {
    // 2026-09-24 Sean 批准:每日那一輪改由 Mac mini 07:45 手動觸發(daily), 排程降為備援、表訂台灣 11:17(UTC 03:17)。
    expect(yml).toContain("- cron: '17 3 * * *'");
    const m = /supplier:\s*\[([^\]]*)\]/.exec(yml);
    expect(m![1]!.split(',').map((s) => s.trim())).toHaveLength(22); // 2026-09-28 ohlins 翻 writeAllowed 時加入;⛔ ~~21~~ 2026-09-27 ilmberger 首灌準備時加入(圖已轉存 R2);⛔ ~~20~~ 2026-09-26 arrow 首灌後加入(Sean Q15 甲)
  });

  it('🔴 sync 的每一步都掛同一個 if(少一步 ⇒ 只跑一家時那一步會在 21 個 job 裡都跑)', () => {
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

// ── Sean 2026-09-27 Q4 甲:「今天已跑過」改成「台灣 07:30 之後有沒有成功的 daily」────────────────
// 起因:09-27 00:07 手動跑了一輪 daily ⇒ 舊判準(台灣當天 00:00 起算)把 07:45 那輪當成已跑過而擋掉。
// 同步日從台灣 07:30 開始;07:30 之前查 ⇒ 看昨天 07:30 起(Mac mini 睡醒補跑時不會把前一天的份重跑)。
// 兩邊同一個純算術函式(台灣沒有夏令時間 ⇒ 07:30 台灣 = 前一天 23:30 UTC);本格真的執行它。
describe('rpm-sync 同步日起點 = 最近一個台灣 07:30(Sean 2026-09-27 Q4 甲)', () => {
  const sh = readFileSync(join(__dirname, '..', 'ops', 'mac-mini', 'rpm-sync-dispatch.sh'), 'utf-8');
  const fnOf = (src: string): string => {
    const m = src.match(/sync_day_start_epoch\(\) \{\n[\s\S]*?\n\s*\}/);
    expect(m, '找不到 sync_day_start_epoch 函式').not.toBeNull();
    return m![0].replace(/^\s+/gm, '');
  };
  const run = (fn: string, epoch: number): number => {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    return Number(execFileSync('bash', ['-c', `${fn}\nsync_day_start_epoch ${epoch}`], { encoding: 'utf-8' }).trim());
  };
  const iso = (s: string) => Date.parse(s) / 1000;

  it('🔴 workflow 與 Mac mini 腳本是同一個函式(逐字)', () => {
    expect(fnOf(jobBlock('already-ran-today'))).toBe(fnOf(sh));
  });

  it.each([
    // [現在(UTC), 期望起點(UTC)]
    ['2026-09-26T16:07:00Z', '2026-09-25T23:30:00Z'], // 台灣 09-27 00:07(那一輪手動)⇒ 屬於 09-26 那個同步日
    ['2026-09-26T23:29:59Z', '2026-09-25T23:30:00Z'], // 台灣 07:29:59 ⇒ 仍是前一天
    ['2026-09-26T23:30:00Z', '2026-09-26T23:30:00Z'], // 台灣 07:30 整 ⇒ 新的一天
    ['2026-09-26T23:45:00Z', '2026-09-26T23:30:00Z'], // 台灣 07:45(Mac mini)⇒ 00:07 那輪不算
    ['2026-09-27T03:17:00Z', '2026-09-26T23:30:00Z'], // 台灣 11:17(備援排程)
    ['2026-09-27T15:59:00Z', '2026-09-26T23:30:00Z'], // 台灣 23:59
  ])('現在 %s ⇒ 起點 %s', (now, want) => {
    expect(run(fnOf(sh), iso(now))).toBe(iso(want));
  });

  it('🔴 兩邊都不再用「台灣當天 00:00」當起點', () => {
    expect(jobBlock('already-ran-today')).not.toContain('00:00 +0800');
    expect(sh).not.toContain('00:00:00" +%s');
  });
});

describe('rpm-sync.yml IndexNow(2026-09-29 計畫 ~/pcm-mailbox/計畫-IndexNow-20260929.md, Fable R2 PASS)', () => {
  it('🔴 sync 部分失敗仍送、被略過就不送、只在完整的日常同步送(R1 必修 2)', () => {
    const job = jobBlock('indexnow');
    expect(job).toContain('needs: sync');
    expect(job).toContain("!cancelled() && needs.sync.result != 'skipped'");
    expect(job).toContain(
      "(github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.daily && !inputs.supplier && !inputs.dry_run && inputs.dealer_price_checksum == ''))",
    );
  });

  it('🔴 continue-on-error 要留:本 job 變紅會讓備援查不到 success、把 21 家整輪重跑', () => {
    expect(jobBlock('indexnow')).toContain('continue-on-error: true');
  });

  it('金鑰走 secret, 不寫進檔案;跑的是 indexnow-submit.ts', () => {
    const job = jobBlock('indexnow');
    expect(job).toContain('INDEXNOW_KEY: ${{ secrets.INDEXNOW_KEY }}');
    expect(job).toContain('pnpm exec tsx scripts/indexnow-submit.ts');
  });

  it('🔵 寄客服信那個 job 不看 indexnow(IndexNow 失敗不寄同步失敗信)', () => {
    expect(jobBlock('notify-failure')).toContain('needs: sync');
    expect(jobBlock('notify-failure')).not.toContain('indexnow');
  });
});
