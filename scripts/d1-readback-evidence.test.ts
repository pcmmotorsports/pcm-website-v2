/**
 * D1b1:唯讀取證(`runD1ReadbackEvidence`)+ CLI `readback` 動作的 parse 規則。
 *
 * 🔴 這一片產出的是「憑什麼刪 26 張正式站訂單」的證據。它最危險的失效不是炸掉,
 * 是**產出一份看起來正常、實際上無效力的證據包** —— 連錯庫、少查一筆、
 * 或 0101 偷偷用替代鍵查了。下面每條測試都對著其中一種。
 *
 * 🔴 誠實邊界:本檔全部用 fake query / fake readback,**沒有打過任何 TapPay**;
 * 對真正式商戶的實跑 = D1b1 本體,須 Sean 在場(過夜禁區)。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TapPayRecordResponseWire } from '../packages/adapters/src/tappay/wire';
import { parseD1CliArgs, runD1Cli } from './d1-orchestrator-cli';
import { READBACK_FACTS_SQL, RECONCILE_IDENTITY_SQL } from './d1-orchestrator';
import { runD1ReadbackEvidence } from './d1-readback-runner';

const CLUSTER = '7668003382341355627';
const UUID = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

/** 六筆事實(與 §8.7 一致:0101 無鍵、NT$2,400、unpaid)。 */
const FACT_ROWS: Array<Record<string, unknown>> = [
  { display_id: 'PCM-2026-0052', order_id: UUID(52), rec_trade_id: 'REC0052', total: 5100, payment_status: 'paid' },
  { display_id: 'PCM-2026-0064', order_id: UUID(64), rec_trade_id: 'REC0064', total: 2400, payment_status: 'unpaid' },
  { display_id: 'PCM-2026-0090', order_id: UUID(90), rec_trade_id: 'REC0090', total: 1800, payment_status: 'unpaid' },
  { display_id: 'PCM-2026-0101', order_id: UUID(101), rec_trade_id: null, total: 2400, payment_status: 'unpaid' },
  { display_id: 'PCM-2026-0102', order_id: UUID(102), rec_trade_id: 'REC0102', total: 101, payment_status: 'paid' },
  { display_id: 'PCM-2026-0104', order_id: UUID(104), rec_trade_id: 'REC0104', total: 5100, payment_status: 'paid' },
];

const refunded = (rec: string, orderId: string, amount: number): TapPayRecordResponseWire => ({
  status: 0,
  msg: '',
  numberOfTransactions: 1,
  records: [
    {
      recTradeId: rec,
      orderNumber: orderId,
      merchantId: 'PCM_PROD',
      isCaptured: true,
      amount,
      currency: 'TWD',
      recordStatus: 3,
      refundedAmount: amount,
      transactionTimeMillis: 1_700_000_000_000,
    },
  ],
});

const cancelled = (rec: string, orderId: string, amount: number): TapPayRecordResponseWire => ({
  status: 0,
  msg: '',
  numberOfTransactions: 1,
  records: [
    {
      recTradeId: rec,
      orderNumber: orderId,
      merchantId: 'PCM_PROD',
      isCaptured: true,
      amount,
      currency: 'TWD',
      recordStatus: 5,
      refundedAmount: 0,
      transactionTimeMillis: 1_700_000_000_000,
    },
  ],
});

function happyResults(): Map<string, TapPayRecordResponseWire> {
  return new Map([
    ['PCM-2026-0052', refunded('REC0052', UUID(52), 5100)],
    ['PCM-2026-0064', cancelled('REC0064', UUID(64), 2400)],
    ['PCM-2026-0090', cancelled('REC0090', UUID(90), 1800)],
    ['PCM-2026-0102', refunded('REC0102', UUID(102), 101)],
    ['PCM-2026-0104', refunded('REC0104', UUID(104), 5100)],
  ]);
}

let dir: string;
let evidencePath: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'd1b1-'));
  evidencePath = path.join(dir, 'evidence.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Call = { sql: string };
function makeDeps(
  over: Partial<{
    identity: Record<string, unknown>;
    factRows: Array<Record<string, unknown>>;
    results: Map<string, TapPayRecordResponseWire>;
    throwOnQuery: Error;
    calls: Call[];
    keyedSeen: string[][];
  }> = {},
) {
  const calls = over.calls ?? [];
  return {
    target: 'production' as const,
    clusterId: CLUSTER,
    evidencePath,
    queryContext: { merchantId: 'PCM_PROD', endpoint: 'https://prod.tappaysdk.com/tpc/transaction/query' },
    processLike: { on: () => undefined, off: () => undefined } as unknown as NodeJS.Process,
    log: () => {},
    query: async (sql: string) => {
      calls.push({ sql });
      if (sql === RECONCILE_IDENTITY_SQL) {
        return { rows: [over.identity ?? { cid: CLUSTER, su: 'postgres', db: 'postgres' }] };
      }
      if (sql === READBACK_FACTS_SQL) return { rows: over.factRows ?? FACT_ROWS };
      throw new Error(`未預期的 SQL:${sql}`);
    },
    runReadback: async (facts: readonly { displayId: string }[]) => {
      over.keyedSeen?.push(facts.map((f) => f.displayId).sort());
      if (over.throwOnQuery) throw over.throwOnQuery;
      return over.results ?? happyResults();
    },
  };
}

const readEvidence = () => JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;

describe('D1b1 唯讀取證', () => {
  it('happy:六筆判定成立、證據落盤、0101 逐字帶 Sean 證述', async () => {
    const r = await runD1ReadbackEvidence(makeDeps());
    expect(r.outcome).toBe('readback-ok');
    const ev = readEvidence();
    expect(ev.kind).toBe('d1b1-readback-evidence');
    const rows = ev.readback as Array<Record<string, unknown>>;
    expect(rows.map((x) => x.displayId).sort()).toEqual([
      'PCM-2026-0052',
      'PCM-2026-0064',
      'PCM-2026-0090',
      'PCM-2026-0101',
      'PCM-2026-0102',
      'PCM-2026-0104',
    ]);
    const no101 = rows.find((x) => x.displayId === 'PCM-2026-0101')!;
    expect(no101.evidenceLevel).toBe('sean-attested');
    // §8.7 施工必做 1 的逐字要求:證據包必須寫明「未經 TapPay read-back」。
    expect(String(no101.note)).toContain('未經 TapPay read-back');
  });

  it('🔴 唯讀:只送出身分閘與事實查詢兩句 SELECT,零 BEGIN / 零 FOR UPDATE / 零 alter_job', async () => {
    const calls: Call[] = [];
    await runD1ReadbackEvidence(makeDeps({ calls }));
    expect(calls.map((c) => c.sql)).toEqual([RECONCILE_IDENTITY_SQL, READBACK_FACTS_SQL]);
    // ⚠️ 下面這圈只擋「那兩個常數自己漂移成含寫入語意」,擋不住 runner 行為 ——
    //    真正承重的是上面那條 toEqual(送出的 SQL 恰為那兩句、順序固定)。
    const all = calls.map((c) => c.sql).join('\n');
    for (const forbidden of ['BEGIN', 'FOR UPDATE', 'alter_job', 'DELETE', 'UPDATE ']) {
      expect(all).not.toContain(forbidden);
    }
  });

  it('🔴 0101 就算被回填 rec_trade_id 也不得被送去查(關卡2 M1;舊寫法只擋 null)', async () => {
    const keyedSeen: string[][] = [];
    const drifted = FACT_ROWS.map((r) =>
      r.display_id === 'PCM-2026-0101' ? { ...r, rec_trade_id: 'DRIFTED-KEY' } : r,
    );
    const r = await runD1ReadbackEvidence(makeDeps({ factRows: drifted, keyedSeen }));
    expect(r.outcome).toBe('readback-aborted');
    // 一次 TapPay 都不能打 —— §8.7 逐字禁止的就是「對 0101 發出查詢」。
    expect(keyedSeen).toHaveLength(0);
    expect(r.message).toContain('前提斷言失敗');
  });

  it('證據包記下這次查的是哪個商戶與哪個 endpoint(0052 的「正式商戶查無」全靠它)', async () => {
    await runD1ReadbackEvidence(makeDeps());
    const qc = readEvidence().queryContext as Record<string, unknown>;
    expect(qc.merchantId).toBe('PCM_PROD');
    expect(String(qc.endpoint)).toContain('prod.tappaysdk.com');
    // Partner Key 絕不入檔。
    expect(JSON.stringify(readEvidence())).not.toContain('partner');
  });

  it('🔴 0101 物理上進不了查詢層(只有五筆有鍵者被送去 TapPay)', async () => {
    const keyedSeen: string[][] = [];
    await runD1ReadbackEvidence(makeDeps({ keyedSeen }));
    expect(keyedSeen).toHaveLength(1);
    expect(keyedSeen[0]).toEqual(['PCM-2026-0052', 'PCM-2026-0064', 'PCM-2026-0090', 'PCM-2026-0102', 'PCM-2026-0104']);
  });

  it('🔴 身分閘不符 ⇒ 連 TapPay 都不查、不產證據(連錯庫的證據包毫無效力)', async () => {
    const keyedSeen: string[][] = [];
    const r = await runD1ReadbackEvidence(makeDeps({ identity: { cid: '999', su: 'postgres', db: 'postgres' }, keyedSeen }));
    expect(r.outcome).toBe('readback-aborted');
    expect(keyedSeen).toHaveLength(0);
    expect(() => readFileSync(evidencePath)).toThrow();
  });

  it('🔴 判定 abort(pending 單回 4=PENDING)⇒ 仍必須落證據檔,不得把證據跟例外一起丟掉', async () => {
    const results = happyResults();
    const bad = cancelled('REC0064', UUID(64), 2400);
    results.set('PCM-2026-0064', { ...bad, records: [{ ...bad.records[0]!, recordStatus: 4 }] });
    const r = await runD1ReadbackEvidence(makeDeps({ results }));
    expect(r.outcome).toBe('readback-aborted');
    const ev = readEvidence();
    expect(ev.outcome).toBe('readback-aborted');
    expect(ev.stage).toBe('judge');
    expect(String(ev.error)).toContain('PCM-2026-0064');
    // 窄化後的回應要留著(命名誠實:parsedResults 不是 raw),回應形狀另存。
    expect(ev.parsedResults).toBeTruthy();
    // §8.7 施工必做 1:abort 版證據照樣要有 0101 那筆的證據等級。
    expect((ev.readback as Array<Record<string, unknown>>)[0]!.evidenceLevel).toBe('sean-attested');
  });

  it('查詢階段失敗也落證據(標 stage=query),訊息不宣稱可重試', async () => {
    const r = await runD1ReadbackEvidence(makeDeps({ throwOnQuery: new Error('deadline 已到') }));
    expect(r.outcome).toBe('readback-aborted');
    expect(readEvidence().stage).toBe('query');
  });

  it('事實筆數不是 6 ⇒ 不查 TapPay、不產證據', async () => {
    const keyedSeen: string[][] = [];
    const r = await runD1ReadbackEvidence(makeDeps({ factRows: FACT_ROWS.slice(0, 5), keyedSeen }));
    expect(r.outcome).toBe('readback-aborted');
    expect(keyedSeen).toHaveLength(0);
  });
});

describe('CLI readback 動作的 parse 規則', () => {
  const ok = (argv: string[]) => {
    const r = parseD1CliArgs(argv);
    if (!r.ok) throw new Error(r.error);
    return r.config;
  };
  const err = (argv: string[]) => {
    const r = parseD1CliArgs(argv);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.error;
  };

  it('production:必填 --merchant-id 與 --audit;不收 --state / --readback-fixture / --confirm', () => {
    const c = ok(['readback', '--target', 'production', '--merchant-id', 'M1', '--audit', '/tmp/e.json']);
    expect(c.action).toBe('readback');
    expect(c.statePath).toBe('');
    expect(err(['readback', '--target', 'production', '--audit', '/tmp/e.json'])).toContain('--merchant-id');
    expect(
      err(['readback', '--target', 'production', '--merchant-id', 'M1', '--audit', '/tmp/e.json', '--state', '/tmp/s.json']),
    ).toContain('不收 --state');
    expect(
      err(['readback', '--target', 'production', '--merchant-id', 'M1', '--audit', '/tmp/e.json', '--readback-fixture', '/tmp/f.json']),
    ).toContain('readback-fixture');
    expect(
      err(['readback', '--target', 'production', '--merchant-id', 'M1', '--audit', '/tmp/e.json', '--confirm', 'DELETE-26-ORDERS']),
    ).toContain('--confirm');
  });

  it('rehearsal:必填 fixture + cluster-id;不收 --merchant-id / --state', () => {
    const c = ok([
      'readback', '--target', 'rehearsal', '--cluster-id', CLUSTER,
      '--readback-fixture', '/tmp/f.json', '--audit', '/tmp/e.json',
    ]);
    expect(c.fixturePath).toBe('/tmp/f.json');
    expect(c.statePath).toBe('');
    expect(err(['readback', '--target', 'rehearsal', '--cluster-id', CLUSTER, '--audit', '/tmp/e.json'])).toContain(
      '--readback-fixture',
    );
    expect(
      err(['readback', '--target', 'rehearsal', '--cluster-id', CLUSTER, '--readback-fixture', '/tmp/f.json', '--audit', '/tmp/e.json', '--merchant-id', 'M1']),
    ).toContain('--merchant-id');
    expect(
      err(['readback', '--target', 'rehearsal', '--cluster-id', CLUSTER, '--readback-fixture', '/tmp/f.json', '--audit', '/tmp/e.json', '--state', '/tmp/s.json']),
    ).toContain('不收 --state');
  });

  it('旗標別名 --readback 與動作同義(既有四動作的別名合約延續)', () => {
    expect(ok(['--readback', '--target', 'production', '--merchant-id', 'M1', '--audit', '/tmp/e.json']).action).toBe(
      'readback',
    );
  });
});

describe('CLI readback 接線(關卡2 M4:這條分支原本零測試覆蓋)', () => {
  /** fixture 版走的是真的 strict wire + parser + merchant 檢查 ⇒ 這裡要給合法原始形狀。 */
  function writeFixture(dirPath: string): string {
    const rec = (id: string, orderId: string, amount: number, status: number, refunded: number) => ({
      rec_trade_id: id,
      order_number: orderId,
      merchant_id: 'FIXTURE_MERCHANT',
      is_captured: true,
      amount,
      currency: 'TWD',
      record_status: status,
      refunded_amount: refunded,
      transaction_time_millis: 1_700_000_000_000,
    });
    const wrap = (r: object) => ({ status: 0, msg: '', number_of_transactions: 1, trade_records: [r] });
    const fixture = {
      merchantId: 'FIXTURE_MERCHANT',
      responses: {
        'PCM-2026-0052': wrap(rec('REC0052', UUID(52), 5100, 3, 5100)),
        'PCM-2026-0064': wrap(rec('REC0064', UUID(64), 2400, 5, 0)),
        'PCM-2026-0090': wrap(rec('REC0090', UUID(90), 1800, 5, 0)),
        'PCM-2026-0102': wrap(rec('REC0102', UUID(102), 101, 3, 101)),
        'PCM-2026-0104': wrap(rec('REC0104', UUID(104), 5100, 3, 5100)),
      },
    };
    const p = path.join(dirPath, 'fixture.json');
    writeFileSync(p, JSON.stringify(fixture));
    return p;
  }

  it('rehearsal readback:證據落在 --audit、stdout 印 D1-OUTCOME、exit 0、連線有關掉', async () => {
    const out: string[] = [];
    let ended = 0;
    const code = await runD1Cli(
      ['readback', '--target', 'rehearsal', '--cluster-id', CLUSTER, '--readback-fixture', writeFixture(dir), '--audit', evidencePath],
      {
        env: { D1_DB_URL: 'postgresql://postgres@127.0.0.1:5432/postgres' },
        log: () => {},
        out: (m) => out.push(m),
        connectClient: async () => ({
          query: async (sql: string) => {
            if (sql === RECONCILE_IDENTITY_SQL) return { rows: [{ cid: CLUSTER, su: 'postgres', db: 'postgres' }] };
            if (sql === READBACK_FACTS_SQL) return { rows: FACT_ROWS };
            throw new Error(`未預期的 SQL:${sql}`);
          },
          end: async () => {
            ended += 1;
          },
        }),
      },
    );
    expect(code).toBe(0);
    expect(out).toEqual(['D1-OUTCOME: readback-ok']);
    expect(ended).toBe(1);
    const ev = readEvidence();
    expect((ev.readback as unknown[]).length).toBe(6);
    // 🔴 接線:證據必須落在 --audit 指的那個檔(誤用 statePath 會讓函式層測試全綠)。
    expect(ev.queryContext).toMatchObject({ merchantId: 'rehearsal-fixture' });
    // D1b1 首跑要落的原始回應形狀(fixture 版一併產出,避免 production 才第一次見面)。
    expect(Object.keys(ev.responseShapes as object).sort()).toEqual(['REC0052', 'REC0064', 'REC0090', 'REC0102', 'REC0104']);
  });

  it('判定 abort ⇒ exit 1 且仍印 D1-OUTCOME(wrapper 靠判定字串分流,不靠 exit code)', async () => {
    const out: string[] = [];
    const drifted = FACT_ROWS.map((r) => (r.display_id === 'PCM-2026-0101' ? { ...r, total: 99 } : r));
    const code = await runD1Cli(
      ['readback', '--target', 'rehearsal', '--cluster-id', CLUSTER, '--readback-fixture', writeFixture(dir), '--audit', evidencePath],
      {
        env: { D1_DB_URL: 'postgresql://postgres@127.0.0.1:5432/postgres' },
        log: () => {},
        out: (m) => out.push(m),
        connectClient: async () => ({
          query: async (sql: string) => {
            if (sql === RECONCILE_IDENTITY_SQL) return { rows: [{ cid: CLUSTER, su: 'postgres', db: 'postgres' }] };
            if (sql === READBACK_FACTS_SQL) return { rows: drifted };
            throw new Error(`未預期的 SQL:${sql}`);
          },
          end: async () => undefined,
        }),
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(['D1-OUTCOME: readback-aborted']);
  });
});
