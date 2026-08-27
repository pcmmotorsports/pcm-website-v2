/**
 * D1t2:CLI parser 矩陣 / rehearsal 連線閘 / verify-ca 分類 / readback runner。
 * 本檔在純 node import CLI 模組 = 「node 可載入」實證(規格 row 16 指定在 D1t2 驗)。
 * CLI 主流程的端到端(D1-OUTCOME 字串、exit code、真 DB)由 scripts/d1t2-rehearsal.sh
 * 三段實跑斷言 —— 這裡只測純函式層。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildRehearsalPgConfig,
  classifyConnectError,
  D1_CONFIRM_PHRASE,
  D1_OUTCOME_PREFIX,
  parseD1CliArgs,
  PRODUCTION_STATE_PATH,
  runD1Cli,
} from './d1-orchestrator-cli';
import type { runD1Orchestrator } from './d1-orchestrator';
import { makeFixtureReadback, makeLiveReadback } from './d1-readback-runner';
import type { D1KeyedAttemptFact } from './d1-readback';
import type { FetchLike } from './d1-tappay-client';

const AUDIT = '/tmp/d1-audit.json';
const ok = (argv: string[]) => {
  const r = parseD1CliArgs(argv);
  if (!r.ok) throw new Error(r.error);
  return r.config;
};
const err = (argv: string[]) => {
  const r = parseD1CliArgs(argv);
  if (r.ok) throw new Error(`不該通過:${argv.join(' ')}`);
  return r.error;
};

describe('parseD1CliArgs:action grammar', () => {
  it('production dry-run happy path;state 固定路徑', () => {
    const c = ok(['dry-run', '--target', 'production', '--merchant-id', 'm1', '--audit', AUDIT]);
    expect(c.action).toBe('dry-run');
    expect(c.statePath).toBe(PRODUCTION_STATE_PATH);
    expect(c.clusterId).toBe('7632885393857617092');
  });

  it('旗標別名 --recover-sweeper / --verify-ca(D1t1 錯誤訊息與 master 字面照舊有效)', () => {
    expect(ok(['--recover-sweeper', '--target', 'production', '--audit', AUDIT]).action).toBe('recover-sweeper');
    expect(ok(['--verify-ca', '--target', 'production']).action).toBe('verify-ca');
    expect(err(['dry-run', '--recover-sweeper', 'x', '--target', 'production'])).toContain('第一個 token');
  });

  it('嚴格性:重複旗標不 last-wins、缺值、未知旗標、多餘 positional、缺動作全拒', () => {
    expect(err(['dry-run', '--target', 'production', '--target', 'rehearsal', '--merchant-id', 'm', '--audit', AUDIT])).toContain('重複');
    expect(err(['dry-run', '--target'])).toContain('缺值');
    expect(err(['dry-run', '--target', 'production', '--bogus', 'x'])).toContain('未知旗標');
    expect(err(['dry-run', 'extra', '--target', 'production'])).toContain('positional');
    expect(err([])).toContain('缺動作');
    expect(err(['deploy'])).toContain('未知動作');
  });

  it('Object.prototype 鍵不得 fail-open 成合法 action(R2:constructor 曾被放行)', () => {
    for (const token of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(err([token])).toContain('未知動作');
    }
  });

  it('production 矩陣:禁 fixture / 禁自訂 state / 禁 cluster-id / merchant 必填 / apply 必 confirm 逐字', () => {
    const base = ['--target', 'production', '--merchant-id', 'm', '--audit', AUDIT];
    expect(err(['dry-run', ...base, '--readback-fixture', '/tmp/f.json'])).toContain('禁用 --readback-fixture');
    expect(err(['dry-run', ...base, '--state', '/tmp/s.json'])).toContain('禁用自訂 --state');
    expect(err(['dry-run', ...base, '--cluster-id', '123'])).toContain('禁用 --cluster-id');
    expect(err(['dry-run', '--target', 'production', '--audit', AUDIT])).toContain('--merchant-id');
    expect(err(['apply', ...base])).toContain('--confirm');
    expect(err(['apply', ...base, '--confirm', 'delete-26-orders'])).toContain(D1_CONFIRM_PHRASE);
    expect(ok(['apply', ...base, '--confirm', D1_CONFIRM_PHRASE]).action).toBe('apply');
    expect(err(['dry-run', ...base, '--confirm', D1_CONFIRM_PHRASE])).toContain('只在 production apply');
  });

  it('邊角兩格:rehearsal 缺 --state 拒;production recover-sweeper 帶 --merchant-id 拒(M6)', () => {
    expect(err(['dry-run', '--target', 'rehearsal', '--cluster-id', '9', '--audit', AUDIT, '--readback-fixture', '/tmp/f.json'])).toContain('--state');
    expect(err(['recover-sweeper', '--target', 'production', '--audit', AUDIT, '--merchant-id', 'm'])).toContain('不需也不收');
  });

  it('--dry-run / --apply 旗標別名(master §8.4:850 與 D1b2 row 20 字面照舊有效;C1)', () => {
    expect(ok(['--dry-run', '--target', 'production', '--merchant-id', 'm', '--audit', AUDIT]).action).toBe('dry-run');
    expect(
      ok(['--apply', '--target', 'production', '--merchant-id', 'm', '--audit', AUDIT, '--confirm', D1_CONFIRM_PHRASE]).action,
    ).toBe('apply');
  });

  it('rehearsal 矩陣:fixture/cluster-id/state 必填;禁 merchant-id 與 confirm(零正式環境依賴)', () => {
    const base = ['--target', 'rehearsal', '--cluster-id', '999', '--state', '/tmp/s.json', '--audit', AUDIT];
    expect(err(['dry-run', ...base])).toContain('--readback-fixture');
    const c = ok(['dry-run', ...base, '--readback-fixture', '/tmp/f.json']);
    expect(c.projectRef).toBe('rehearsal');
    expect(err(['dry-run', ...base, '--readback-fixture', '/tmp/f.json', '--merchant-id', 'm'])).toContain('禁用 --merchant-id');
    expect(err(['apply', ...base, '--readback-fixture', '/tmp/f.json', '--confirm', D1_CONFIRM_PHRASE])).toContain('不收 --confirm');
    expect(err(['dry-run', '--target', 'rehearsal', '--state', '/tmp/s.json', '--audit', AUDIT, '--readback-fixture', '/tmp/f.json'])).toContain('--cluster-id');
    expect(ok(['recover-sweeper', ...base]).action).toBe('recover-sweeper');
  });

  it('verify-ca 只收 production;--target 必填', () => {
    expect(err(['verify-ca', '--target', 'rehearsal'])).toContain('只支援 --target production');
    expect(err(['dry-run', '--merchant-id', 'm', '--audit', AUDIT])).toContain('--target 必填');
  });
});

describe('buildRehearsalPgConfig:loopback allowlist', () => {
  it('localhost / 127.0.0.1 / [::1](去括號)放行;其餘 host 拒', () => {
    expect(buildRehearsalPgConfig('postgresql://postgres@127.0.0.1:54329/postgres').host).toBe('127.0.0.1');
    expect(buildRehearsalPgConfig('postgresql://postgres@localhost/postgres').port).toBe(5432);
    expect(buildRehearsalPgConfig('postgresql://postgres@[::1]:54329/postgres').host).toBe('::1');
    expect(() => buildRehearsalPgConfig('postgresql://postgres@10.0.0.5/postgres')).toThrow(/loopback/);
    expect(() => buildRehearsalPgConfig('postgresql://postgres@aws-0-x.pooler.supabase.com:5432/postgres')).toThrow(/loopback/);
  });

  it('query 參數 = 拒(pg-connection-string 覆蓋前科);user/db 非 postgres = 拒(K2:與 recovery 身分閘對稱)', () => {
    expect(() => buildRehearsalPgConfig('postgresql://postgres@127.0.0.1/postgres?host=evil')).toThrow(/query/);
    expect(() => buildRehearsalPgConfig('postgresql://127.0.0.1/postgres')).toThrow(/postgres\/postgres/);
    expect(() => buildRehearsalPgConfig('postgresql://alice@127.0.0.1/postgres')).toThrow(/postgres\/postgres/);
    expect(() => buildRehearsalPgConfig('postgresql://postgres@127.0.0.1/otherdb')).toThrow(/postgres\/postgres/);
  });
});

describe('classifyConnectError(verify-ca 兩方向的判定基礎)', () => {
  it('憑證類 / auth 類(TLS 已過)/ 其他', () => {
    expect(classifyConnectError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' })).toBe('cert');
    expect(classifyConnectError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })).toBe('cert');
    expect(classifyConnectError({ code: '28P01' })).toBe('auth');
    expect(classifyConnectError({ message: 'password authentication failed for user' })).toBe('auth');
    expect(classifyConnectError({ code: 'ECONNREFUSED' })).toBe('other');
  });
});

describe('readback runners', () => {
  const FACTS: D1KeyedAttemptFact[] = [
    { displayId: 'PCM-2026-0052', orderId: 'u52', recTradeId: 'R52', authorizedAmount: 100, paymentStatus: 'paid' },
    { displayId: 'PCM-2026-0102', orderId: 'u02', recTradeId: 'R02', authorizedAmount: 200, paymentStatus: 'paid' },
  ];
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'd1t2-fx-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('live runner:fetch body 的 rec_trade_id 逐筆 === fact.recTradeId(鍵綁錯 = 0052 假查無的唯一防線)', async () => {
    const sent: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body) as { filters: { rec_trade_id: string } };
      sent.push(body.filters.rec_trade_id);
      return { ok: true, status: 200, json: async () => ({ status: 2, number_of_transactions: 0 }) };
    };
    const run = makeLiveReadback({ partnerKey: 'pk', merchantId: 'm' }, fetchImpl);
    const results = await run(FACTS, new AbortController().signal, Date.now() + 60_000);
    expect(sent).toEqual(['R52', 'R02']);
    expect([...results.keys()]).toEqual(['PCM-2026-0052', 'PCM-2026-0102']);
  });

  const fixtureFile = (obj: unknown) => {
    const p = path.join(dir, 'fx.json');
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  const REC = (rec: string, merchant = 'M') => ({
    status: 0,
    msg: '',
    number_of_transactions: 1,
    trade_records: [
      { rec_trade_id: rec, order_number: 'u', merchant_id: merchant, amount: 1, currency: 'TWD', record_status: 5, is_captured: false },
    ],
  });

  it('fixture runner:key set 必須恰等於五筆 keyed(多 0101 / 少一筆都拒)', async () => {
    const good = makeFixtureReadback(
      fixtureFile({ merchantId: 'M', responses: { 'PCM-2026-0052': REC('R52'), 'PCM-2026-0102': REC('R02') } }),
    );
    expect((await good(FACTS, new AbortController().signal, 0)).size).toBe(2);

    const extra = makeFixtureReadback(
      fixtureFile({ merchantId: 'M', responses: { 'PCM-2026-0052': REC('R52'), 'PCM-2026-0102': REC('R02'), 'PCM-2026-0101': REC('RX') } }),
    );
    await expect(extra(FACTS, new AbortController().signal, 0)).rejects.toThrow(/key set/);
  });

  it('fixture 過嚴格 wire + merchant 檢查(假資料不得比正式路徑寬鬆)', async () => {
    const badWire = makeFixtureReadback(
      fixtureFile({ merchantId: 'M', responses: { 'PCM-2026-0052': { status: 0 }, 'PCM-2026-0102': REC('R02') } }),
    );
    await expect(badWire(FACTS, new AbortController().signal, 0)).rejects.toThrow(/wire 不完整/);

    const badMerchant = makeFixtureReadback(
      fixtureFile({ merchantId: 'M', responses: { 'PCM-2026-0052': REC('R52', '別家'), 'PCM-2026-0102': REC('R02') } }),
    );
    await expect(badMerchant(FACTS, new AbortController().signal, 0)).rejects.toThrow(/非本商戶/);
  });
});

describe('runD1Cli 組裝層(注入 connectClient/run;code-reviewer I3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'd1t2-cli-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const fakeClient = { query: async () => ({ rows: [] }), end: async () => {} };
  const capture = () => {
    const seen: { config?: unknown; deps?: Parameters<typeof runD1Orchestrator>[0]; out: string[]; logs: string[] } = { out: [], logs: [] };
    const overrides = {
      connectClient: async (config: unknown) => {
        seen.config = config;
        return fakeClient;
      },
      run: (async (deps: Parameters<typeof runD1Orchestrator>[0]) => {
        seen.deps = deps;
        return { outcome: 'not_committed' as const, exitCode: 1, message: '假結果' };
      }) as typeof runD1Orchestrator,
      out: (m: string) => seen.out.push(m),
      log: (m: string) => seen.logs.push(m),
    };
    return { seen, overrides };
  };
  const REHEARSAL_ENV = { D1_DB_URL: 'postgresql://postgres@127.0.0.1:54329/postgres' };
  const rehearsalArgv = (action: string) => {
    const fixture = path.join(dir, 'fx.json');
    writeFileSync(fixture, JSON.stringify({ merchantId: 'M', responses: {} }));
    return [action, '--target', 'rehearsal', '--cluster-id', '999', '--state', path.join(dir, 's.json'), '--audit', path.join(dir, 'a.json'), '--readback-fixture', fixture];
  };

  it('mode 映射:--recover-sweeper 別名 → 核心 recover-only;dry-run → dry-run;D1-OUTCOME + exit 透傳', async () => {
    const { seen, overrides } = capture();
    const code = await runD1Cli(['--recover-sweeper', '--target', 'rehearsal', '--cluster-id', '9', '--state', path.join(dir, 's.json'), '--audit', path.join(dir, 'a.json')], { ...overrides, env: REHEARSAL_ENV });
    expect(seen.deps?.mode).toBe('recover-only');
    expect(code).toBe(1);
    expect(seen.out).toEqual([`${D1_OUTCOME_PREFIX}not_committed`]);

    const second = capture();
    await runD1Cli(rehearsalArgv('dry-run'), { ...second.overrides, env: REHEARSAL_ENV });
    expect(second.seen.deps?.mode).toBe('dry-run');
    expect(second.seen.deps?.clusterId).toBe('999');
    // 🔴 跨模組耦合釘(R2 ③):CLI 註解「第一擊交給核心 graceful」只在不傳 processLike 時
    // 成立 —— D1t3 若注入這個 seam,第一擊就變 no-op。有人改傳,這行先紅。
    expect(second.seen.deps?.processLike).toBeUndefined();
  });

  it('production 組裝必經 buildD1PgConfig(config 含 CA/servername/pooler host)', async () => {
    const { seen, overrides } = capture();
    await runD1Cli(['dry-run', '--target', 'production', '--merchant-id', 'm', '--audit', path.join(dir, 'a.json')], {
      ...overrides,
      env: {
        D1_DB_URL: 'postgresql://postgres.bmpnplmnldofgaohnaok:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        TAPPAY_ENV: 'production', TAPPAY_PARTNER_KEY: 'pk', TAPPAY_MERCHANT_ID: 'm',
      },
    });
    const cfg = seen.config as { host: string; ssl: { rejectUnauthorized: boolean; servername: string; ca: string } };
    expect(cfg.host).toBe('aws-0-ap-southeast-1.pooler.supabase.com');
    expect(cfg.ssl.rejectUnauthorized).toBe(true);
    expect(cfg.ssl.servername).toBe(cfg.host);
    expect(cfg.ssl.ca).toContain('BEGIN CERTIFICATE');
  });

  it('signal 二擊:第一擊不退出、第二擊 exit(130)且不動 state(注入 exit seam)', async () => {
    const exits: number[] = [];
    let resolveRun!: () => void;
    const gate = new Promise<void>((r) => (resolveRun = r));
    const overrides = {
      connectClient: async () => fakeClient,
      run: (async () => {
        process.emit('SIGINT');           // 第一擊:只計數,不退出。
        expect(exits).toEqual([]);
        process.emit('SIGINT');           // 第二擊:hardExit(130)。
        resolveRun();
        return { outcome: 'not_committed' as const, exitCode: 1, message: 'x' };
      }) as typeof runD1Orchestrator,
      exit: (code: number) => {
        exits.push(code);
      },
      out: () => {},
      log: () => {},
      env: REHEARSAL_ENV,
    };
    const code = await runD1Cli(rehearsalArgv('dry-run'), overrides);
    await gate;
    expect(exits).toEqual([130]);
    expect(code).toBe(1);
  });

  it('缺 D1_DB_URL = exit 2;production URL 走 rehearsal target = 連線層拒(loopback 閘)', async () => {
    const { overrides } = capture();
    expect(await runD1Cli(rehearsalArgv('dry-run'), { ...overrides, env: {} })).toBe(2);
    await expect(
      runD1Cli(rehearsalArgv('dry-run'), { ...overrides, env: { D1_DB_URL: 'postgresql://postgres.x:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres' } }),
    ).rejects.toThrow(/loopback/);
  });
});

describe('verify-ca 離線負向:pg 對錯誤 CA 真的吐憑證類錯(code-reviewer I4)', () => {
  it('自簽 TLS server + pg SSLRequest 舞步 → classifyConnectError = cert', async () => {
    const net = await import('node:net');
    const tls = await import('node:tls');
    // 🔴 test-only 自簽金鑰(本測試現場產、無任何外部用途;不是秘密 —— secret scanning 誤報時
    //    以本註記為準;codex K2 nit)。
    const KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgFB3aeWP62ixDVDhW
KrnwG+NJwPcypsD84C9a7q3wyMihRANCAAR5CpA6Ui7nC2Y5isjWw2B1dDJ8tKKJ
PrvU/85JyzQfiDHV460memySo5ByEtDNsAct/sOsmTiuD0pTTdUFOQ8k
-----END PRIVATE KEY-----`;
    const CERT = `-----BEGIN CERTIFICATE-----
MIIBfDCCASOgAwIBAgIUN40EbLziTPBYQRjFWVM17d+OGF8wCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDcyOTE1MTExM1oXDTM2MDcyNjE1
MTExM1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEeQqQOlIu5wtmOYrI1sNgdXQyfLSiiT671P/OScs0H4gx1eOtJnpskqOQ
chLQzbAHLf7DrJk4rg9KU03VBTkPJKNTMFEwHQYDVR0OBBYEFN/0A2JwexfwPWc3
6Mt2Gb/UhXN6MB8GA1UdIwQYMBaAFN/0A2JwexfwPWc36Mt2Gb/UhXN6MA8GA1Ud
EwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDRwAwRAIgOmFZ54wdYnt0SazT9c4ZuxYU
mhM8LnkAF+BJNqmofVwCIH+5ms8Q9Z8bRgDs4DePkIvdYWM2hDn6on0T5ls7amEK
-----END CERTIFICATE-----`;
    // pg wire:client 先送 8-byte SSLRequest,server 回 'S' 才升級 TLS。
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        socket.write('S');
        new tls.TLSSocket(socket, { isServer: true, key: KEY, cert: CERT });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const { Client } = await import('pg');
    const client = new Client({
      host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password: 'x',
      // 用一張與 server 無關的 CA(Supabase root)驗自簽憑證 ⇒ 必為憑證驗證類錯誤。
      ssl: { ca: readFileSync(path.join(__dirname, '../packages/adapters/src/payment/supabase-ca.ts'), 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)![0], rejectUnauthorized: true },
      connectionTimeoutMillis: 3000,
    });
    let classified = 'none';
    try {
      await client.connect();
    } catch (err) {
      classified = classifyConnectError(err);
    } finally {
      await client.end().catch(() => {});
      server.close();
    }
    expect(classified).toBe('cert');
  });
});

describe('文字層釘死', () => {
  it('D1-OUTCOME 判定字串常數真的被輸出路徑使用', () => {
    expect(D1_OUTCOME_PREFIX).toBe('D1-OUTCOME: ');
    const src = readFileSync(path.join(__dirname, 'd1-orchestrator-cli.ts'), 'utf8');
    expect(src).toContain('`${D1_OUTCOME_PREFIX}${result.outcome}`');
  });

  it('verify-ca 正向只認 auth、密碼無條件 ca-probe(R2 回歸釘;runVerifyCa 無法離線整支跑)', () => {
    const src = readFileSync(path.join(__dirname, 'd1-orchestrator-cli.ts'), 'utf8');
    expect(src).toContain("const positiveOk = positive === 'auth';");
    expect(src).toContain("password: 'ca-probe'");
    expect(src).not.toContain("|| 'ca-probe'");
  });

  it('harness 三段斷言的判定字串與 CLI 輸出同字面', () => {
    const sh = readFileSync(path.join(__dirname, 'd1t2-rehearsal.sh'), 'utf8');
    expect(sh).toContain('D1-OUTCOME: ${expect_outcome}');
    expect(sh).toContain('not_committed 1');
    expect(sh).toContain('completed 0');
  });
});
