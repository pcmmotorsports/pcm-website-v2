/**
 * D1t1:orchestrator 交易核心。
 *
 * 🔴 測試策略(本線 F1 前科:「測試只驗腳本文字、從未對任何 DB 執行」)——
 * 主軌是 **fake pg client 驗真實呼叫序列與參數**:guard 在任何 DELETE 前、鎖序、NOWAIT
 * 只在 attempts、audit 落盤在 COMMIT 前、dry-run 零 cron/state 寫入……全部斷言「執行時
 * 真的發生了什麼」,不只斷言常數字面。文字層斷言僅作第二軌。
 * 🔴 誠實邊界:仍未對任何真 DB 實跑;隔離 DB 實跑負測 = D1t3(規格明定不可省)。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TapPayRecordResponseWire } from '../packages/adapters/src/tappay/wire';
import { D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { buildD1TransactionGuardSql } from './d1-guard';
import {
  A2A3_ZERO_REF_SQL,
  ADVISORY_LOCK_CANARY_SQL,
  ADVISORY_LOCK_SQL,
  ADVISORY_UNLOCK_SQL,
  CHECK_VALID_SQL,
  DELETE_ATTEMPTS_SQL,
  DELETE_ORDERS_SQL,
  EXPECTED_ATTEMPT_IDS_SQL,
  LOCK_SQL,
  LOCKED_STATE_ASSERT_SQL,
  MARK_REFUNDED_SQL,
  MATRIX_SQL,
  PAYMENT_STATE_VERIFY_SQL,
  PENDING_FENCE_SQL,
  PRE_CASCADE_COUNTS_SQL,
  READBACK_FACTS_SQL,
  RECONCILE_IDENTITY_SQL,
  RENUMBER_COLLISION_SQL,
  RENUMBER_SQL,
  RENUMBER_VERIFY_SQL,
  runD1Orchestrator,
  SNAPSHOT_SQL,
  TXN_SETUP_SQL,
  VOID_INVOICES_SQL,
  type D1OrchestratorDeps,
} from './d1-orchestrator';
import { DRAIN_HTTP_QUEUE_SQL, DRAIN_JOB_RUNS_SQL, LOCATE_SWEEPER_JOB_SQL, writeStateAtomic } from './d1-sweeper-control';

let dir: string;
let statePath: string;
let auditPath: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'd1-orch-'));
  statePath = path.join(dir, 'state.json');
  auditPath = path.join(dir, 'audit.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 六張單的真 UUID(cohort 單一來源;TapPay order_number 存的是它)。 */
const idOf = (d: string) =>
  [...D1_DELETE_COHORT, ...D1_RETAIN_COHORT].find((x) => x.displayId === d)!.id;

const KEYED = {
  'PCM-2026-0052': { rec: 'REC0052', total: 5100 },
  'PCM-2026-0064': { rec: 'REC0064', total: 2400 },
  'PCM-2026-0090': { rec: 'REC0090', total: 1800 },
  'PCM-2026-0102': { rec: 'REC0102', total: 101 },
  'PCM-2026-0104': { rec: 'REC0104', total: 5100 },
} as const;

function happyReadback(): ReadonlyMap<string, TapPayRecordResponseWire> {
  const rec = (d: keyof typeof KEYED, recordStatus: number) => ({
    status: 0,
    msg: '',
    numberOfTransactions: 1,
    records: [
      {
        recTradeId: KEYED[d].rec,
        orderNumber: idOf(d),
        merchantId: 'pcm-prod',
        amount: KEYED[d].total,
        currency: 'TWD',
        recordStatus,
        isCaptured: true,
        refundedAmount: recordStatus === 3 ? KEYED[d].total : 0,
        transactionTimeMillis: 1753000000000,
      },
    ],
  });
  return new Map([
    ['PCM-2026-0052', rec('PCM-2026-0052', 3)],
    ['PCM-2026-0102', rec('PCM-2026-0102', 3)],
    ['PCM-2026-0104', rec('PCM-2026-0104', 3)],
    ['PCM-2026-0064', rec('PCM-2026-0064', 5)],
    ['PCM-2026-0090', rec('PCM-2026-0090', -1)],
  ]);
}

const ATTEMPT_IDS = Array.from({ length: 24 }, (_, i) => `a-${i + 1}`);

type Call = {
  sql: string;
  params?: readonly unknown[];
  auditExists: boolean;
  stateExists: boolean;
  /** 呼叫當下 audit 檔的 outcome(不存在 = null)—— 驗「COMMIT 當下必須是 prepared」。 */
  auditOutcome: string | null;
};

/** fake DB:依 SQL 全等/前綴路由到 happy-path 回應;全程記錄呼叫與當下檔案狀態。 */
function makeDb(overrides: Partial<Record<string, (call: Call, nth: number) => { rows: Array<Record<string, unknown>> }>> = {}) {
  const calls: Call[] = [];
  const nthBySql = new Map<string, number>();
  const matrixExpect = new Map(MATRIX_SQL.map(([sql, n]) => [sql, n]));

  const respond = (call: Call): { rows: Array<Record<string, unknown>> } => {
    const { sql, params } = call;
    const nth = (nthBySql.get(sql) ?? 0) + 1;
    nthBySql.set(sql, nth);
    for (const [key, fn] of Object.entries(overrides)) {
      if (fn && (sql === key || sql.startsWith(key))) return fn(call, nth);
    }
    if (sql === ADVISORY_LOCK_SQL) return { rows: [{ locked: true }] };
    if (sql === ADVISORY_LOCK_CANARY_SQL) return { rows: [{ n: 1 }] };
    if (sql === ADVISORY_UNLOCK_SQL) return { rows: [{ pg_advisory_unlock: true }] };
    // 早期身分閘(全路徑必經):預設回與 deps.clusterId('123')相符的身分。
    if (sql === RECONCILE_IDENTITY_SQL) return { rows: [{ cid: '123', su: 'postgres', db: 'postgres' }] };
    if (sql === LOCATE_SWEEPER_JOB_SQL) {
      // apply:停用前 active、alter false 後 inactive、恢復 alter true 後 active。
      const alterFalse = calls.filter((c) => c.sql.includes('active => false')).length;
      const alterTrue = calls.filter((c) => c.sql.includes('active => true')).length;
      return { rows: [{ jobid: 42, active: alterTrue > 0 || alterFalse === 0 }] };
    }
    if (sql === DRAIN_JOB_RUNS_SQL || sql === DRAIN_HTTP_QUEUE_SQL) return { rows: [{ n: 0 }] };
    if (sql.includes('cron.alter_job')) return { rows: [] };
    if (TXN_SETUP_SQL.includes(sql) || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql === buildD1TransactionGuardSql('production') || sql === buildD1TransactionGuardSql('rehearsal')) return { rows: [] };
    if (SNAPSHOT_SQL.includes(sql)) return { rows: [] };
    for (const [lockSql, n] of LOCK_SQL) {
      if (sql === lockSql) return { rows: Array.from({ length: n }, (_, i) => ({ id: `l-${i}` })) };
    }
    if (sql === LOCKED_STATE_ASSERT_SQL) {
      return { rows: [{ status: 'failed', n: 12 }, { status: 'pending', n: 3 }, { status: 'released', n: 9 }] };
    }
    if (sql === PENDING_FENCE_SQL) return { rows: [{ n: 0 }] };
    if (sql === A2A3_ZERO_REF_SQL) return { rows: [{ proc_refs: 0, note_refs: 0 }] };
    if (sql === READBACK_FACTS_SQL) {
      return {
        rows: [
          ...Object.entries(KEYED).map(([display_id, { rec, total }]) => ({
            display_id,
            order_id: idOf(display_id),
            rec_trade_id: rec,
            total,
            payment_status: 'paid',
          })),
          {
            display_id: 'PCM-2026-0101',
            order_id: idOf('PCM-2026-0101'),
            rec_trade_id: null,
            total: 2400,
            payment_status: 'unpaid',
          },
        ],
      };
    }
    if (sql === EXPECTED_ATTEMPT_IDS_SQL) return { rows: ATTEMPT_IDS.map((id) => ({ id })) };
    if (sql === PRE_CASCADE_COUNTS_SQL) {
      // 第 1 次 = 刪前(36/2);第 2 次 = CASCADE 後(0/0)。
      return nth === 1 ? { rows: [{ items: 36, consents: 2 }] } : { rows: [{ items: 0, consents: 0 }] };
    }
    if (sql === DELETE_ATTEMPTS_SQL) return { rows: ATTEMPT_IDS.map((id) => ({ id })) };
    if (sql === DELETE_ORDERS_SQL) return { rows: D1_DELETE_COHORT.map(({ id }) => ({ id })) };
    if (sql === RENUMBER_COLLISION_SQL) return { rows: [{ new_taken: 0, old_taken: 0 }] };
    if (sql === RENUMBER_SQL) {
      const [id, newId, oldId] = params as [string, string, string];
      return { rows: [{ id, display_id: newId, legacy_display_id: oldId }] };
    }
    if (sql === RENUMBER_VERIFY_SQL) {
      const key = String((params as readonly unknown[])[0]);
      const hit = D1_RETAIN_COHORT.find(({ displayId, newDisplayId }) => displayId === key || newDisplayId === key);
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (sql === MARK_REFUNDED_SQL) {
      return { rows: [{ id: (params as readonly unknown[])[0], payment_status: 'refunded' }] };
    }
    if (sql === PAYMENT_STATE_VERIFY_SQL) {
      const refunded = calls.filter((c) => c.sql === MARK_REFUNDED_SQL).map((c) => String(c.params?.[0]));
      return {
        rows: D1_RETAIN_COHORT.map(({ id }) => ({
          id,
          payment_status: refunded.includes(id) ? 'refunded' : 'paid',
          snapshot_status: 'paid',
        })),
      };
    }
    if (sql === VOID_INVOICES_SQL) return { rows: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }] };
    if (matrixExpect.has(sql)) return { rows: [{ n: matrixExpect.get(sql) }] };
    if (sql === CHECK_VALID_SQL) {
      return { rows: [{ display_format_valid: true, invoices_check_def: "CHECK ((status = ANY (ARRAY['pending','issued','voided'])))" }] };
    }
    if (sql.startsWith('SELECT count(*)::int AS n FROM public.orders WHERE id IN')) return { rows: [{ n: 0 }] };
    throw new Error(`fake db 未涵蓋的 SQL:${sql.slice(0, 90)}`);
  };

  const query = async (sql: string, params?: readonly unknown[]) => {
    const call: Call = {
      sql,
      params,
      auditExists: existsSync(auditPath),
      stateExists: existsSync(statePath),
      auditOutcome: existsSync(auditPath)
        ? (JSON.parse(readFileSync(auditPath, 'utf8')) as { outcome: string }).outcome
        : null,
    };
    const result = respond(call);
    calls.push(call);
    return result;
  };
  return { query, calls };
}

function makeDeps(db: ReturnType<typeof makeDb>, patch: Partial<D1OrchestratorDeps> = {}): D1OrchestratorDeps {
  return {
    mode: 'apply',
    target: 'production',
    query: db.query,
    openFreshQuery: async () => ({ query: db.query, close: async () => {} }),
    runReadback: async () => happyReadback(),
    auditPath,
    statePath,
    projectRef: 'ref',
    clusterId: '123',
    sleep: async () => {},
    log: () => {},
    randomUUID: () => 'run-test',
    processLike: fakeProcess(),
    ...patch,
  };
}

function fakeProcess(): Pick<NodeJS.Process, 'on' | 'off'> & { emit(sig: string): void } {
  const handlers = new Map<string, Array<() => void>>();
  return {
    on(sig: string, fn: () => void) {
      handlers.set(sig, [...(handlers.get(sig) ?? []), fn]);
      return this as never;
    },
    off(sig: string, fn: () => void) {
      handlers.set(sig, (handlers.get(sig) ?? []).filter((f) => f !== fn));
      return this as never;
    },
    emit(sig: string) {
      for (const fn of handlers.get(sig) ?? []) fn();
    },
  } as never;
}

const sqlIndex = (calls: Call[], predicate: (sql: string) => boolean) => calls.findIndex((c) => predicate(c.sql));

describe('apply happy path', () => {
  it('completed:守門在 DELETE 前、audit 落盤在 COMMIT 前、sweeper 恢復、state 清空', async () => {
    const db = makeDb();
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('completed');
    expect(result.exitCode).toBe(0);

    const calls = db.calls;
    const guardIdx = sqlIndex(calls, (s) => s === buildD1TransactionGuardSql('production'));
    const deleteAttemptsIdx = sqlIndex(calls, (s) => s === DELETE_ATTEMPTS_SQL);
    const deleteOrdersIdx = sqlIndex(calls, (s) => s === DELETE_ORDERS_SQL);
    const commitIdx = sqlIndex(calls, (s) => s === 'COMMIT');
    // 🔴 守門必須在任何 DELETE 之前、且同一連線同一交易(BEGIN 之後)。
    const beginIdx = sqlIndex(calls, (s) => s === 'BEGIN');
    expect(guardIdx).toBeGreaterThan(beginIdx);
    expect(guardIdx).toBeLessThan(deleteAttemptsIdx);
    expect(deleteAttemptsIdx).toBeLessThan(deleteOrdersIdx);
    // 🔴 audit 落盤在 COMMIT 之前,且 COMMIT 當下必須還是 prepared(先寫成終態 = 假證據)。
    expect(calls[commitIdx]!.auditExists).toBe(true);
    expect(calls[commitIdx]!.auditOutcome).toBe('prepared');
    const auditFinal = JSON.parse(readFileSync(auditPath, 'utf8')) as { outcome: string };
    expect(auditFinal.outcome).toBe('committed');
    // 🔴 alter_job(false) 當下 state 檔已存在(R24);結束後 state 已清。
    const alterFalse = calls.find((c) => c.sql.includes('active => false'))!;
    expect(alterFalse.stateExists).toBe(true);
    expect(existsSync(statePath)).toBe(false);
    // 恢復 sweeper 在 COMMIT 之後;顯式 unlock 是最後一筆(鎖涵蓋恢復全段)。
    const alterTrueIdx = sqlIndex(calls, (s) => s.includes('active => true'));
    expect(alterTrueIdx).toBeGreaterThan(commitIdx);
    expect(calls[calls.length - 1]!.sql).toBe(ADVISORY_UNLOCK_SQL);
    expect(calls.length - 1).toBeGreaterThan(alterTrueIdx);
  });

  it('鎖序:orders → items → attempts(僅它 NOWAIT)→ invoices;SET LOCAL 三項', async () => {
    const db = makeDb();
    await runD1Orchestrator(makeDeps(db));
    const lockIdxs = LOCK_SQL.map(([sql]) => sqlIndex(db.calls, (s) => s === sql));
    expect([...lockIdxs].sort((a, b) => a - b)).toEqual(lockIdxs);
    expect(LOCK_SQL.filter(([sql]) => sql.includes('NOWAIT'))).toHaveLength(1);
    expect(LOCK_SQL[2]![0]).toContain('payment_charge_attempts');
    for (const s of ["lock_timeout = '5s'", "statement_timeout = '60s'", "idle_in_transaction_session_timeout = '5min'"]) {
      expect(TXN_SETUP_SQL.join('\n')).toContain(s);
    }
  });

  it('DELETE 語句綁定的是 cohort 26 組 UUID 字面(不是別的清單)', () => {
    for (const { id } of D1_DELETE_COHORT) {
      expect(DELETE_ORDERS_SQL).toContain(id);
    }
    for (const { id } of D1_RETAIN_COHORT) {
      expect(DELETE_ORDERS_SQL).not.toContain(id);
    }
  });

  it('0052 查無 ⇒ 只有 0102/0104 改 refunded,0052 保持原值(verdict 驅動、終態逐筆驗)', async () => {
    const results = new Map(happyReadback());
    results.set('PCM-2026-0052', { status: 2, msg: '', numberOfTransactions: 0, records: [] });
    const db = makeDb();
    const result = await runD1Orchestrator(makeDeps(db, { runReadback: async () => results }));
    expect(result.outcome).toBe('completed');
    const refundedIds = db.calls.filter((c) => c.sql === MARK_REFUNDED_SQL).map((c) => String(c.params?.[0]));
    expect(refundedIds).toHaveLength(2);
    expect(refundedIds).not.toContain(D1_RETAIN_COHORT[0]!.id); // 0052
  });
});

describe('dry-run(§8.4 逐字「不動 cron」+ R3-F4 唯讀 preflight)', () => {
  it('零 cron/state 寫入、control-plane 三查詢實跑、ROLLBACK 結束、無 COMMIT', async () => {
    const db = makeDb();
    const result = await runD1Orchestrator(makeDeps(db, { mode: 'dry-run' }));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('全數通過');

    const sqls = db.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes('cron.alter_job'))).toBe(false); // 零 cron 寫入
    expect(existsSync(statePath)).toBe(false); // 零 state 寫入
    expect(sqls).toContain(LOCATE_SWEEPER_JOB_SQL); // 唯讀 preflight 三查詢實跑
    expect(sqls).toContain(DRAIN_JOB_RUNS_SQL);
    expect(sqls).toContain(DRAIN_HTTP_QUEUE_SQL);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    // 矩陣在 ROLLBACK 前驗完。
    const lastMatrixIdx = Math.max(...MATRIX_SQL.map(([sql]) => sqlIndex(db.calls, (s) => s === sql)));
    expect(lastMatrixIdx).toBeLessThan(sqlIndex(db.calls, (s) => s === 'ROLLBACK'));
    const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as { outcome: string };
    expect(audit.outcome).toBe('dry-run-rolled-back');
  });

  it('遇 state 檔 = 拒絕執行(指示走 recovery),不進交易', async () => {
    writeStateAtomic(statePath, {
      version: 1, projectRef: 'ref', clusterId: '123', jobId: 42, jobName: 'pcm-settle-sweep',
      runId: 'run-舊', previousRunId: null, stateWrittenAt: 'x', jobStoppedAt: null,
    });
    const db = makeDb();
    const result = await runD1Orchestrator(makeDeps(db, { mode: 'dry-run' }));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('recover-sweeper');
    expect(db.calls.map((c) => c.sql)).not.toContain('BEGIN');
  });
});

describe('single-flight 與金絲雀', () => {
  it('advisory lock 取不到 = 立即退出,不再有任何後續呼叫', async () => {
    const db = makeDb({ [ADVISORY_LOCK_SQL]: () => ({ rows: [{ locked: false }] }) });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('另一個 orchestrator');
    // 唯二呼叫 = 取鎖 + finally 顯式 unlock(拿不到也 unlock 無害)。
    expect(db.calls.map((c) => c.sql)).toEqual([ADVISORY_LOCK_SQL, ADVISORY_UNLOCK_SQL]);
  });

  it('金絲雀查無自己的鎖 = transaction pooler 徵兆,拒繼續', async () => {
    const db = makeDb({ [ADVISORY_LOCK_CANARY_SQL]: () => ({ rows: [{ n: 0 }] }) });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.message).toContain('6543');
    expect(db.calls.map((c) => c.sql)).toEqual([ADVISORY_LOCK_SQL, ADVISORY_LOCK_CANARY_SQL, ADVISORY_UNLOCK_SQL]);
  });
});

describe('recovery mode(R26/R27)', () => {
  it('state 在場:CAS 接管 → 恢復 → 清 state → 對帳輸出、不進正式執行', async () => {
    writeStateAtomic(statePath, {
      version: 1, projectRef: 'ref', clusterId: '123', jobId: 42, jobName: 'pcm-settle-sweep',
      runId: 'run-死掉的', previousRunId: null, stateWrittenAt: 'x', jobStoppedAt: 'y',
    });
    const db = makeDb({
      [LOCATE_SWEEPER_JOB_SQL]: (_call, nth) => ({ rows: [{ jobid: 42, active: nth >= 3 }] }),
      // 對帳查詢與矩陣第一格同字面;recovery 情境下 26 張待刪單仍在(未提交)。
      [MATRIX_SQL[0]![0]]: () => ({ rows: [{ n: 26 }] }),
    });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('recovery_only');
    expect(result.exitCode).toBe(5); // R1 Important 的回歸釘。
    expect(result.message).toContain('26 張待刪單仍在'); // 對帳:fake 回 26。
    expect(existsSync(statePath)).toBe(false);
    expect(db.calls.map((c) => c.sql)).not.toContain('BEGIN'); // 不開始正式執行。
  });
});

describe('recovery 對帳分流(codex K2 R2)', () => {
  const seedState = () =>
    writeStateAtomic(statePath, {
      version: 1, projectRef: 'ref', clusterId: '123', jobId: 42, jobName: 'pcm-settle-sweep',
      runId: 'run-舊', previousRunId: null, stateWrittenAt: 'x', jobStoppedAt: 'y',
    });

  it('對帳非 0/26(半套狀態)= 不動 cron、state 保留、人工', async () => {
    seedState();
    const db = makeDb({ [MATRIX_SQL[0]![0]]: () => ({ rows: [{ n: 13 }] }) });
    const result = await runD1Orchestrator(makeDeps(db, { mode: 'recover-only' }));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('應 0 或 26');
    expect(db.calls.some((c) => c.sql.includes('cron.alter_job'))).toBe(false);
    expect(existsSync(statePath)).toBe(true);
  });

  it.each([
    [0, 'committed_recovery_required'],
    [26, 'not_committed_recovery_required'],
  ] as const)('對帳 n=%i + 恢復失敗 = %s(依對帳分流,不得謊報可重跑)', async (n, expected) => {
    seedState();
    const db = makeDb({
      [MATRIX_SQL[0]![0]]: () => ({ rows: [{ n }] }),
      [LOCATE_SWEEPER_JOB_SQL]: () => ({ rows: [{ jobid: 42, active: false }] }), // 走恢復路。
      'SELECT cron.alter_job(job_id => $1, active => true)': () => {
        throw new Error('alter 炸');
      },
    });
    const result = await runD1Orchestrator(makeDeps(db, { mode: 'recover-only' }));
    expect(result.outcome).toBe(expected);
    expect(existsSync(statePath)).toBe(true); // state 保留給下一次 recovery。
  });
});

describe('recover-only(D1t2 R2-1)', () => {
  it('無 state = 明確退出 recovery_only,絕不 fall through 到正式執行', async () => {
    const db = makeDb();
    const result = await runD1Orchestrator(makeDeps(db, { mode: 'recover-only' }));
    expect(result.outcome).toBe('recovery_only');
    expect(result.message).toContain('無事可恢復');
    const sqls = db.calls.map((c) => c.sql);
    expect(sqls).not.toContain('BEGIN');
    expect(sqls.some((s) => s.includes('cron.alter_job'))).toBe(false);
  });

  it('recovery 前活連線身分不符(連錯 loopback DB)= 不接管、不動 cron', async () => {
    writeStateAtomic(statePath, {
      version: 1, projectRef: 'ref', clusterId: '123', jobId: 42, jobName: 'pcm-settle-sweep',
      runId: 'run-舊', previousRunId: null, stateWrittenAt: 'x', jobStoppedAt: 'y',
    });
    const db = makeDb({ [RECONCILE_IDENTITY_SQL]: () => ({ rows: [{ cid: '999', su: 'postgres', db: 'postgres' }] }) });
    const result = await runD1Orchestrator(makeDeps(db, { mode: 'recover-only' }));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('不接管');
    expect(db.calls.some((c) => c.sql.includes('cron.alter_job'))).toBe(false);
    expect(existsSync(statePath)).toBe(true); // state 原封不動。
  });
});

describe('失敗路徑', () => {
  it('NOWAIT 鎖失敗 = ROLLBACK + not_committed,無任何 DELETE;未提交路徑恢復 sweeper', async () => {
    const nowaitSql = LOCK_SQL[2]![0];
    const db = makeDb({
      [nowaitSql]: () => {
        throw new Error('could not obtain lock (NOWAIT)');
      },
    });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('not_committed');
    const sqls = db.calls.map((c) => c.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain(DELETE_ATTEMPTS_SQL);
    expect(sqls).not.toContain('COMMIT');
    expect(sqls.some((s) => s.includes('active => true'))).toBe(true); // finally 恢復
    expect(existsSync(statePath)).toBe(false);
  });

  it('SIGTERM 後不可能 COMMIT(safe-point 擋下、走 ROLLBACK)', async () => {
    const proc = fakeProcess();
    const db = makeDb();
    const deps = makeDeps(db, {
      processLike: proc,
      runReadback: async () => {
        proc.emit('SIGTERM'); // 在 read-back 期間收到中止。
        return happyReadback();
      },
    });
    const result = await runD1Orchestrator(deps);
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('中止');
    expect(db.calls.map((c) => c.sql)).not.toContain('COMMIT');
  });

  it('鎖畢分佈非 failed 12 / released 9 / pending 3 = abort(R22 斷言不得放寬)', async () => {
    const db = makeDb({
      [LOCKED_STATE_ASSERT_SQL]: () => ({
        rows: [{ status: 'failed', n: 13 }, { status: 'pending', n: 2 }, { status: 'released', n: 9 }],
      }),
    });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('failed 12');
  });

  it('矩陣任一格不符 = ROLLBACK abort(fail-closed,不硬過)', async () => {
    const [firstMatrixSql] = MATRIX_SQL[0]!;
    const db = makeDb({ [firstMatrixSql]: () => ({ rows: [{ n: 99 }] }) });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('矩陣');
  });

  it('改號 RETURNING 值不符映射 = abort(映射對調在此被抓)', async () => {
    const db = makeDb({
      [RENUMBER_SQL]: (call) => {
        const [id] = call.params as [string];
        return { rows: [{ id, display_id: 'XXXXXX', legacy_display_id: 'YYYY' }] };
      },
    });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('不符映射');
  });
});

describe('COMMIT 結果不明(R2-5;身分驗證 + 對帳)', () => {
  const commitThrows = { COMMIT: () => { throw new Error('connection reset during COMMIT'); } };
  // fresh 對帳現在精確比對 deps.clusterId(測試 deps = '123')。
  const PROD_IDENTITY = { cid: '123', su: 'postgres', db: 'postgres' };

  /** fresh 連線 fake:先回身分、再回 cohort 計數。 */
  const freshWith = (identity: Record<string, unknown>, n: number) => async () => ({
    query: async (sql: string) =>
      sql === RECONCILE_IDENTITY_SQL ? { rows: [identity] } : { rows: [{ n }] },
    close: async () => {},
  });

  it('fresh 對帳 26 張在場 = 確認回滾 ⇒ not_committed(可重跑)', async () => {
    const db = makeDb(commitThrows);
    const result = await runD1Orchestrator(
      makeDeps(db, { openFreshQuery: freshWith(PROD_IDENTITY, 26) }),
    );
    expect(result.outcome).toBe('not_committed');
  });

  it('fresh 對帳 0 張 = 確認已提交 ⇒ 繼續恢復 sweeper、completed', async () => {
    const db = makeDb(commitThrows);
    const result = await runD1Orchestrator(
      makeDeps(db, { openFreshQuery: freshWith(PROD_IDENTITY, 0) }),
    );
    expect(result.outcome).toBe('completed');
    expect(db.calls.some((c) => c.sql.includes('active => true'))).toBe(true);
  });

  it('🔴 fresh 連到非 production 叢集(clone)= 身分不符 ⇒ unknown,不得誤判 rolled-back', async () => {
    const db = makeDb(commitThrows);
    const result = await runD1Orchestrator(
      makeDeps(db, { openFreshQuery: freshWith({ ...PROD_IDENTITY, cid: '999' }, 26) }),
    );
    expect(result.outcome).toBe('commit_outcome_unknown');
  });

  it('fresh 連不上 = commit_outcome_unknown(exit 4、絕不可標成可重跑)', async () => {
    const db = makeDb(commitThrows);
    const result = await runD1Orchestrator(
      makeDeps(db, { openFreshQuery: async () => { throw new Error('unreachable'); } }),
    );
    expect(result.outcome).toBe('commit_outcome_unknown');
    expect(result.exitCode).toBe(4);
    expect(result.message).toContain('不得重跑');
    const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as { outcome: string };
    expect(audit.outcome).toBe('commit_outcome_unknown');
  });
});

describe('留存映射與規格 §8.4 逐字釘死(映射對調在此被抓)', () => {
  it('0052→YWP3PC / 0102→BKPR5M / 0104→ZNHY8B 與 master plan §8.4 表逐組一致', () => {
    const spec = readFileSync(
      path.join(__dirname, '../docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md'),
      'utf8',
    );
    for (const { displayId, newDisplayId } of D1_RETAIN_COHORT) {
      const row = new RegExp(`\\|\\s*\`${displayId}\`\\s*\\|\\s*\\*\\*\`([A-Z0-9]{6})\`\\*\\*`);
      expect(spec.match(row)?.[1], `${displayId} 在規格表的新號`).toBe(newDisplayId);
    }
  });
});

describe('補強負例(突變守門)', () => {
  it('DELETE orders RETURNING 筆數對但 id 錯 = abort(集合驗證不得退化成 count)', async () => {
    const wrongIds: string[] = D1_DELETE_COHORT.map(({ id }) => String(id));
    wrongIds[0] = '00000000-0000-0000-0000-000000000000';
    const db = makeDb({ [DELETE_ORDERS_SQL]: () => ({ rows: wrongIds.map((id) => ({ id })) }) });
    const result = await runD1Orchestrator(makeDeps(db));
    expect(result.outcome).toBe('not_committed');
    expect(result.message).toContain('主鍵集合與期望不符');
  });

  it('COMMIT 前 abort safe-point:矩陣後才收到 SIGTERM 也不得 COMMIT', async () => {
    const proc = fakeProcess();
    const db = makeDb({ [CHECK_VALID_SQL]: () => {
      proc.emit('SIGTERM'); // 最後一個 DB 呼叫當下中止 —— 只剩 COMMIT 前的顯式檢查能擋。
      return { rows: [{ display_format_valid: true, invoices_check_def: "'voided'" }] };
    } });
    const result = await runD1Orchestrator(makeDeps(db, { processLike: proc }));
    expect(result.outcome).toBe('not_committed');
    expect(db.calls.map((c) => c.sql)).not.toContain('COMMIT');
  });

  it('happy path 必經 pending fence 與 A2/A3 零引用查詢(拿掉任一 = 本測試紅)', async () => {
    const db = makeDb();
    await runD1Orchestrator(makeDeps(db));
    const sqls = db.calls.map((c) => c.sql);
    expect(sqls).toContain(PENDING_FENCE_SQL);
    expect(sqls).toContain(A2A3_ZERO_REF_SQL);
    expect(sqls).toContain(PAYMENT_STATE_VERIFY_SQL);
  });
});

describe('文字層合約(第二軌)', () => {
  it('六態 exit code 互異', async () => {
    const { D1_EXIT_CODES } = await import('./d1-orchestrator');
    expect(new Set(Object.values(D1_EXIT_CODES)).size).toBe(6);
  });

  it('🔴 oracle 獨立釘死(codex K2:期望值不得只從受測常數轉抄 —— SQL 與期望一起改錯仍全綠)', () => {
    // 鎖序列數:orders 29 / items 39 / attempts 27 / invoices 3(§8.4 + D1a2 實跑口徑)。
    expect(LOCK_SQL.map(([, n]) => n)).toEqual([29, 39, 27, 3]);
    // 驗收矩陣期望序列(§8.4 表逐項,獨立抄寫;矩陣增刪或期望改動必須同步這裡)。
    expect(MATRIX_SQL.map(([, n]) => n)).toEqual([0, 3, 0, 3, 0, 2, 0, 3, 0, 3, 3, 0, 0, 0, 0, 0, 3, 3, 0, 0]);
  });

  it('A2/A3 零引用口徑 = 待刪 26 張(不含留存單;留存單的合法備註不得製造假 abort)', () => {
    for (const { id } of D1_RETAIN_COHORT) expect(A2A3_ZERO_REF_SQL).not.toContain(id);
    expect(A2A3_ZERO_REF_SQL).toContain('order_item_procurement');
    expect(A2A3_ZERO_REF_SQL).toContain('order_notes');
  });

  it('驗收矩陣涵蓋五張 0 列表 + 期望差集含 paid_at(R1-21 + R3-F2)', () => {
    const all = MATRIX_SQL.map(([sql]) => sql).join('\n');
    for (const t of ['email_outbox', 'order_refunds', 'order_refund_items', 'payment_double_charge_anomalies', 'payment_double_charge_anomaly_events']) {
      expect(all).toContain(t);
    }
    expect(all).toContain('paid_at IS DISTINCT FROM');
    expect(all).toContain("- 'display_id' - 'legacy_display_id' - 'payment_status'");
  });

  it('read-back 事實查詢只取 pending|charged(partial unique index 保證六筆各一)', () => {
    expect(READBACK_FACTS_SQL).toContain("a.status IN ('pending', 'charged')");
  });

  it('EXPECTED_ATTEMPT_IDS / 碰撞檢查 / 驗證 SQL 形狀', () => {
    expect(EXPECTED_ATTEMPT_IDS_SQL).toContain('ORDER BY id');
    expect(RENUMBER_COLLISION_SQL).toContain('legacy_display_id IN');
    expect(RENUMBER_VERIFY_SQL).toContain('display_id = $1 OR legacy_display_id = $1');
    expect(PRE_CASCADE_COUNTS_SQL).toContain('order_legal_consents');
    expect(CHECK_VALID_SQL).toContain('pg_get_constraintdef');
  });
});
