/**
 * D1t1:sweeper 停用/恢復 + ownership state。
 * state 檔走**真檔案系統**(tmpdir)—— 原子性與 fsync 是災難當天的保命符,不 mock fs。
 * DB 互動走 fake query(記錄呼叫序;R24 順序合約用呼叫序斷言,不只驗 SQL 文字)。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearStateAtomic,
  DRAIN_HTTP_QUEUE_SQL,
  DRAIN_JOB_RUNS_SQL,
  LOCATE_SWEEPER_JOB_SQL,
  locateSweeperJob,
  POST_STOP_SETTLE_MS,
  readState,
  recoverSweeper,
  stopSweeper,
  SWEEPER_JOB_COMMAND,
  takeOverState,
  writeStateAtomic,
  type D1QueryExecutor,
  type D1SweeperState,
} from './d1-sweeper-control';

let dir: string;
let statePath: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'd1-sweeper-'));
  statePath = path.join(dir, 'state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const BASE_STATE: D1SweeperState = {
  version: 1,
  projectRef: 'ref',
  clusterId: '123',
  jobId: 42,
  jobName: 'pcm-settle-sweep',
  runId: 'run-A',
  previousRunId: null,
  stateWrittenAt: '2026-07-29T00:00:00Z',
  jobStoppedAt: null,
};

/**
 * stateful fake(codex K2:丟棄 alter params、任何 alter 都當正確切換 = 假綠):
 * alter 必驗 jobId=42、方向由 SQL 決定並真的切 `active`;locate 回報當下 `active`。
 */
function makeFakeDb(overrides: Partial<Record<'locate' | 'runs' | 'queue' | 'alter', (call: number) => { rows: Array<Record<string, unknown>> }>> = {}) {
  const calls: Array<{ kind: string; sql: string; stateExists: boolean }> = [];
  const counts = { locate: 0, runs: 0, queue: 0, alter: 0 };
  let active = true;
  const query: D1QueryExecutor = async (sql, params) => {
    let kind: keyof typeof counts;
    if (sql === LOCATE_SWEEPER_JOB_SQL) kind = 'locate';
    else if (sql === DRAIN_JOB_RUNS_SQL) kind = 'runs';
    else if (sql === DRAIN_HTTP_QUEUE_SQL) kind = 'queue';
    else if (sql.includes('cron.alter_job')) kind = 'alter';
    else throw new Error(`unexpected sql: ${sql}`);
    counts[kind] += 1;
    calls.push({ kind, sql, stateExists: existsSync(statePath) });
    if (kind === 'alter') {
      if (Number(params?.[0]) !== 42) throw new Error(`alter_job 收到錯誤 jobId:${String(params?.[0])}`);
      active = sql.includes('active => true');
    }
    const fn = overrides[kind];
    if (fn) return fn(counts[kind]);
    if (kind === 'locate') return { rows: [{ jobid: 42, active }] };
    if (kind === 'alter') return { rows: [] };
    return { rows: [{ n: 0 }] };
  };
  return { query, calls };
}

const DEPS = (query: D1QueryExecutor, slept: number[] = []) => ({
  query,
  statePath,
  runId: 'run-A',
  projectRef: 'ref',
  clusterId: '123',
  sleep: async (ms: number) => {
    slept.push(ms);
  },
});

describe('state 檔(真 FS)', () => {
  it('write → read → clear roundtrip;清除後不存在', () => {
    writeStateAtomic(statePath, BASE_STATE);
    expect(readState(statePath)).toEqual(BASE_STATE);
    clearStateAtomic(statePath);
    expect(readState(statePath)).toBeNull();
    expect(existsSync(statePath)).toBe(false);
  });

  it('🔴 拒收相對路徑與 ~ 開頭(JS 不展開 ~,會把救命 state 寫到工作目錄)', () => {
    expect(() => writeStateAtomic('~/state.json', BASE_STATE)).toThrow(/絕對路徑/);
    expect(() => readState('relative/state.json')).toThrow(/絕對路徑/);
  });

  it('格式不符的 state = throw(不靜默當 null)', () => {
    writeStateAtomic(statePath, { version: 2 } as unknown as D1SweeperState);
    expect(() => readState(statePath)).toThrow(/格式不符/);
  });

  it('takeOverState:CAS 換 owner、previousRunId 保留原 id(R26 接管紀錄)', () => {
    writeStateAtomic(statePath, BASE_STATE);
    const taken = takeOverState(statePath, 'run-B');
    expect(taken.runId).toBe('run-B');
    expect(taken.previousRunId).toBe('run-A');
    expect(readState(statePath)?.runId).toBe('run-B');
    clearStateAtomic(statePath);
    expect(() => takeOverState(statePath, 'run-C')).toThrow(/無 state/);
  });
});

describe('job 定位(五元組逐字、恰一列)', () => {
  it('SQL 逐字含 jobname/username/database/schedule/command 全等比對', () => {
    for (const literal of [
      "jobname = 'pcm-settle-sweep'",
      "username = 'postgres'",
      "database = 'postgres'",
      "schedule = '*/2 * * * *'",
      `command = $$${SWEEPER_JOB_COMMAND}$$`,
    ]) {
      expect(LOCATE_SWEEPER_JOB_SQL).toContain(literal);
    }
    expect(LOCATE_SWEEPER_JOB_SQL).not.toContain('LIKE');
  });

  it('🔴 command 字面與 migration $job$…$job$ 逐字一致(readFileSync 釘死,防兩邊各抄各的)', () => {
    const migration = readFileSync(
      path.join(__dirname, '../supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql'),
      'utf8',
    );
    const m = migration.match(/\$job\$(SELECT pcm_cron\.invoke_cron_route\('\/api\/cron\/settle-sweep'\))\$job\$/);
    expect(m?.[1]).toBe(SWEEPER_JOB_COMMAND);
  });

  it('0 列或 ≥2 列 = throw', async () => {
    const zero = makeFakeDb({ locate: () => ({ rows: [] }) });
    await expect(locateSweeperJob(zero.query)).rejects.toThrow(/恰 1 列/);
    const two = makeFakeDb({ locate: () => ({ rows: [{}, {}] }) });
    await expect(locateSweeperJob(two.query)).rejects.toThrow(/恰 1 列/);
  });
});

describe('排空判定 SQL(R2-1 + R3-F3 + R3-F9)', () => {
  it('job_run_details:非終態 + 10 分鐘窗(stale running 列不得永久卡死)', () => {
    expect(DRAIN_JOB_RUNS_SQL).toContain("status NOT IN ('succeeded', 'failed')");
    expect(DRAIN_JOB_RUNS_SQL).toContain("interval '10 min'");
  });

  it('🔴 http_request_queue 只准 count(*):headers 欄含 CRON_SECRET,禁入任何 SQL', () => {
    expect(DRAIN_HTTP_QUEUE_SQL).toContain('count(*)');
    expect(DRAIN_HTTP_QUEUE_SQL).not.toContain('headers');
    expect(DRAIN_HTTP_QUEUE_SQL).not.toContain('SELECT *');
  });
});

describe('stopSweeper(R24 crash-safe 序)', () => {
  it('順序:排空初查 → 寫 state → alter false → 回查 → 停後排空 → 70s 沉降 → 補 jobStoppedAt', async () => {
    const slept: number[] = [];
    const db = makeFakeDb();
    const state = await stopSweeper(DEPS(db.query, slept));

    // 🔴 alter_job 當下 state 檔必須已存在(先 state 後停;反了 = 不可恢復窗)。
    const alterCall = db.calls.find((c) => c.kind === 'alter')!;
    expect(alterCall.stateExists).toBe(true);
    // alter 之前有初查排空(runs+queue),之後又有一輪(停後排空)。
    const alterIdx = db.calls.indexOf(alterCall);
    expect(db.calls.slice(0, alterIdx).filter((c) => c.kind === 'runs').length).toBeGreaterThanOrEqual(1);
    expect(db.calls.slice(alterIdx).filter((c) => c.kind === 'runs').length).toBeGreaterThanOrEqual(1);
    // 70 秒沉降真的等了(queue=0 證不了 in-flight;pg_net 70s 是數學上界)。
    expect(slept).toContain(POST_STOP_SETTLE_MS);
    // 排空判定必須同時查 pg_net queue(只查 cron = R2-1 的洞)。
    expect(db.calls.filter((c) => c.kind === 'queue').length).toBeGreaterThanOrEqual(2);
    // jobStoppedAt 只在停用成功後補上。
    expect(state.jobStoppedAt).not.toBeNull();
    expect(readState(statePath)?.jobStoppedAt).toBe(state.jobStoppedAt);
  });

  it('排空期間 job 被人手動停用 = throw(寫 state 前二次回查;不誤開別人的停用)', async () => {
    const db = makeFakeDb({
      // 第 1 次 locate(進場)active;第 2 次(排空後回查)已被別人停用。
      locate: (n) => ({ rows: [{ jobid: 42, active: n === 1 }] }),
    });
    await expect(stopSweeper(DEPS(db.query))).rejects.toThrow(/狀態漂移/);
    // 沒寫 state、沒 alter —— 走到回查就停。
    expect(existsSync(statePath)).toBe(false);
    expect(db.calls.filter((c) => c.kind === 'alter')).toHaveLength(0);
  });

  it('job 非 active 且無 state = throw(別人刻意停的,不誤開)', async () => {
    const db = makeFakeDb({ locate: () => ({ rows: [{ jobid: 42, active: false }] }) });
    await expect(stopSweeper(DEPS(db.query))).rejects.toThrow(/不誤開/);
  });

  it('alter 後回查仍 active = throw', async () => {
    const db = makeFakeDb({ locate: () => ({ rows: [{ jobid: 42, active: true }] }) });
    await expect(stopSweeper(DEPS(db.query))).rejects.toThrow(/仍為 true/);
  });

  it('排空輪詢逾 3 分鐘 = throw(fake 時鐘推進)', async () => {
    let clock = 0;
    const db = makeFakeDb({ runs: () => ({ rows: [{ n: 1 }] }) });
    await expect(
      stopSweeper({
        ...DEPS(db.query),
        now: () => clock,
        sleep: async (ms: number) => {
          clock += ms * 10; // 快轉
        },
      }),
    ).rejects.toThrow(/逾 3 分鐘/);
  });
});

describe('recoverSweeper(恢復序:active → 回查 → 才清 state)', () => {
  it('成功:alter true 當下 state 仍在;回查後才清(stateful fake:方向真的切狀態)', async () => {
    writeStateAtomic(statePath, BASE_STATE);
    const db = makeFakeDb();
    await recoverSweeper({ query: db.query, statePath, expectedRunId: 'run-A', projectRef: 'ref', clusterId: '123' });
    const alterCall = db.calls.find((c) => c.kind === 'alter')!;
    expect(alterCall.sql).toContain('active => true');
    expect(alterCall.stateExists).toBe(true);
    expect(existsSync(statePath)).toBe(false);
  });

  it('run id 不符 = 拒(先 CAS 接管才可動);無 state = 拒;回查 active=false = 拒且 state 保留', async () => {
    writeStateAtomic(statePath, BASE_STATE);
    const db = makeFakeDb();
    await expect(
      recoverSweeper({ query: db.query, statePath, expectedRunId: 'run-別人', projectRef: 'ref', clusterId: '123' }),
    ).rejects.toThrow(/run id 與本次不符/);

    clearStateAtomic(statePath);
    await expect(
      recoverSweeper({ query: db.query, statePath, expectedRunId: 'run-A', projectRef: 'ref', clusterId: '123' }),
    ).rejects.toThrow(/無 state/);

    writeStateAtomic(statePath, BASE_STATE);
    const stuck = makeFakeDb({ locate: () => ({ rows: [{ jobid: 42, active: false }] }) });
    await expect(
      recoverSweeper({ query: stuck.query, statePath, expectedRunId: 'run-A', projectRef: 'ref', clusterId: '123' }),
    ).rejects.toThrow(/仍為 false/);
    expect(existsSync(statePath)).toBe(true); // state 保留給人工重跑。
  });

  it('state 內 jobId 與現網定位不符 = 拒', async () => {
    writeStateAtomic(statePath, { ...BASE_STATE, jobId: 99 });
    const db = makeFakeDb();
    await expect(
      recoverSweeper({ query: db.query, statePath, expectedRunId: 'run-A', projectRef: 'ref', clusterId: '123' }),
    ).rejects.toThrow(/jobId 與現網/);
  });

  it('跨環境 state(projectRef/clusterId 不符)= 拒絕恢復', async () => {
    writeStateAtomic(statePath, { ...BASE_STATE, projectRef: 'rehearsal-ref' });
    const db = makeFakeDb();
    await expect(
      recoverSweeper({ query: db.query, statePath, expectedRunId: 'run-A', projectRef: 'ref', clusterId: '123' }),
    ).rejects.toThrow(/projectRef\/clusterId/);
    writeStateAtomic(statePath, { ...BASE_STATE, clusterId: '999' });
    await expect(
      recoverSweeper({ query: db.query, statePath, expectedRunId: 'run-A', projectRef: 'ref', clusterId: '123' }),
    ).rejects.toThrow(/projectRef\/clusterId/);
  });
});
