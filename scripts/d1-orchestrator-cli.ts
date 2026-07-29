/**
 * D1t2:D1 orchestrator CLI(規格 §5.1 row 17)。
 *
 * 用法(唯一 action grammar:第一個 token 是動作,其後全部 `--flag value`):
 *   pnpm exec tsx scripts/d1-orchestrator-cli.ts <dry-run|apply|recover-sweeper|verify-ca> --target <production|rehearsal> [flags]
 *
 * 🔴 `--recover-sweeper` / `--verify-ca` 是**合法別名**(= 同名 action):D1t1 已 commit 的
 * 錯誤訊息與 master §8.4 逐字教操作者打 `--recover-sweeper` —— 嚴格 parser 若拒收旗標形,
 * 復原路會在事故當下被自家訊息堵死(Fable R3-F2)。
 *
 * 🔴 模式×目標矩陣(fail-closed;違反任一格 = exit 2 + 說明,絕不猜測意圖):
 *   production:dry-run/apply 必填 --merchant-id(TapPay 商家後台抄,與 env 雙輸入)、
 *     禁 --readback-fixture、禁自訂 --state(固定 $HOME/.pcm-d1/sweeper-state.json ——
 *     hard crash 後 recovery 必須找得到同一個檔)、--audit 必填;
 *     apply 另必填 --confirm DELETE-26-ORDERS(§8.4 步驟 7 批准閘的防誤觸承接 ——
 *     批准本身 = Sean 親自執行這件事,字串只防誤觸)。
 *   rehearsal:必填 --readback-fixture(隔離環境不得打真 TapPay)、--cluster-id、
 *     --state、--audit;禁 --merchant-id、禁 --confirm(零正式環境依賴)。
 *   recover-sweeper:不需 merchant/fixture/confirm;state/audit 規則同上。
 *   verify-ca:只收 --target production;獨立驗證、不進 orchestrator。
 *
 * 🔴 exit code 分流必須認 stdout 的 `D1-OUTCOME: <outcome>` 判定字串,不得單憑 exit code
 * (與 Node 保留碼有重疊之虞;d1-orchestrator.ts D1_EXIT_CODES 註解)。parse 錯誤 = exit 2。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { SUPABASE_ROOT_CA_2021 } from '../packages/adapters/src/payment/supabase-ca';
import { buildD1PgConfig, PRODUCTION_CLUSTER_ID, PRODUCTION_PROJECT_REF } from './d1-guard';
import { runD1Orchestrator, D1_EXIT_CODES, type D1OrchestratorMode, type D1Target } from './d1-orchestrator';
import { makeFixtureReadback, makeLiveReadback, type D1RunReadback } from './d1-readback-runner';
import { buildD1TapPayConfig } from './d1-tappay-client';

export const D1_CONFIRM_PHRASE = 'DELETE-26-ORDERS';
/** wrapper/runbook 分流認這個 stdout 判定字串,不單憑 exit code。 */
export const D1_OUTCOME_PREFIX = 'D1-OUTCOME: ';
export const PRODUCTION_STATE_PATH = path.join(homedir(), '.pcm-d1', 'sweeper-state.json');

const ACTIONS = ['dry-run', 'apply', 'recover-sweeper', 'verify-ca'] as const;
type D1CliAction = (typeof ACTIONS)[number];
/** 旗標別名(Fable R3-F2 + code-reviewer C1):master §8.4 與 D1t1 既有訊息的
 *  `--dry-run`/`--recover-sweeper` 字面照舊有效 —— 別名漏一個,操作路就被自家 parser 堵死。 */
const ACTION_ALIASES: Readonly<Record<string, D1CliAction>> = {
  '--dry-run': 'dry-run',
  '--apply': 'apply',
  '--recover-sweeper': 'recover-sweeper',
  '--verify-ca': 'verify-ca',
};

const KNOWN_FLAGS = ['--target', '--merchant-id', '--audit', '--state', '--cluster-id', '--readback-fixture', '--confirm'] as const;

export type D1CliConfig = Readonly<{
  action: D1CliAction;
  target: D1Target;
  merchantId?: string;
  auditPath: string;
  statePath: string;
  clusterId: string;
  projectRef: string;
  fixturePath?: string;
}>;

export type D1CliParseResult = { ok: true; config: D1CliConfig } | { ok: false; error: string };

const fail = (error: string): D1CliParseResult => ({ ok: false, error });

/** 嚴格 parser:重複旗標 = 拒(不 last-wins)、動作外 positional = 拒、缺值 = 拒、未知旗標 = 拒。 */
export function parseD1CliArgs(argv: readonly string[]): D1CliParseResult {
  if (argv.length === 0) return fail(`缺動作;合法動作:${ACTIONS.join(' | ')}`);

  const first = argv[0]!;
  // Object.hasOwn:物件字面量帶原型鏈,'constructor'/'__proto__' 等六個 token 會被
  // ACTION_ALIASES[first] 撈到函式而 fail-open 成合法 action(code-reviewer R2 實跑證明)。
  const action: D1CliAction | undefined =
    (Object.hasOwn(ACTION_ALIASES, first) ? ACTION_ALIASES[first] : undefined) ??
    ((ACTIONS as readonly string[]).includes(first) ? (first as D1CliAction) : undefined);
  if (!action) return fail(`未知動作 '${first}';合法動作:${ACTIONS.join(' | ')}(或同名旗標別名 --dry-run / --apply / --recover-sweeper / --verify-ca)`);

  const flags = new Map<string, string>();
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i]!;
    if (!key.startsWith('--')) return fail(`多餘的 positional 參數 '${key}';動作只有第一個 token`);
    if (ACTION_ALIASES[key]) return fail(`動作別名 '${key}' 只能是第一個 token`);
    if (!(KNOWN_FLAGS as readonly string[]).includes(key)) return fail(`未知旗標 '${key}'`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return fail(`旗標 '${key}' 缺值`);
    if (flags.has(key)) return fail(`旗標 '${key}' 重複(不採 last-wins,拒絕執行)`);
    flags.set(key, value);
  }

  const target = flags.get('--target');
  if (target !== 'production' && target !== 'rehearsal') {
    return fail(`--target 必填且必須是 production|rehearsal(實 '${target ?? '缺'}')`);
  }
  if (action === 'verify-ca') {
    if (target !== 'production') return fail('verify-ca 只支援 --target production');
    if (flags.size > 1) return fail('verify-ca 只收 --target,其餘旗標一律拒(不接受並忽略)');
    return { ok: true, config: { action, target, auditPath: '', statePath: '', clusterId: PRODUCTION_CLUSTER_ID, projectRef: PRODUCTION_PROJECT_REF } };
  }

  const audit = flags.get('--audit');
  if (!audit || !path.isAbsolute(audit)) return fail('--audit 必填且必須是絕對路徑');

  if (target === 'production') {
    if (flags.has('--readback-fixture')) return fail('production 禁用 --readback-fixture(刪除依據只能是真 TapPay read-back)');
    if (flags.has('--cluster-id')) return fail('production 的叢集識別碼由 repo 常數提供,禁用 --cluster-id');
    // 🔴 state 固定路徑:hard crash 後 recovery 必須找得到同一個檔(D1t2 R2-3)。
    if (flags.has('--state')) return fail(`production 禁用自訂 --state(固定 ${PRODUCTION_STATE_PATH})`);
    const merchantId = flags.get('--merchant-id');
    if (action !== 'recover-sweeper' && !merchantId) {
      return fail('production 的 dry-run/apply 必填 --merchant-id(從 TapPay 商家後台抄;與 Vercel env 雙輸入斷言)');
    }
    if (action === 'recover-sweeper' && merchantId) return fail('recover-sweeper 不需也不收 --merchant-id');
    if (action === 'apply') {
      if (flags.get('--confirm') !== D1_CONFIRM_PHRASE) {
        return fail(`production apply 必須帶 --confirm ${D1_CONFIRM_PHRASE}(逐字;§8.4 步驟 7 批准閘的防誤觸承接)`);
      }
    } else if (flags.has('--confirm')) {
      return fail('--confirm 只在 production apply 有意義');
    }
    return {
      ok: true,
      config: { action, target, merchantId, auditPath: audit, statePath: PRODUCTION_STATE_PATH, clusterId: PRODUCTION_CLUSTER_ID, projectRef: PRODUCTION_PROJECT_REF },
    };
  }

  // rehearsal:零正式環境依賴。
  if (flags.has('--merchant-id')) return fail('rehearsal 禁用 --merchant-id(不得依賴正式 TapPay 環境)');
  if (flags.has('--confirm')) return fail('rehearsal 不收 --confirm');
  const clusterId = flags.get('--cluster-id');
  if (!clusterId) return fail('rehearsal 必填 --cluster-id(由 harness 從隔離庫 pg_control_system() 撈取)');
  const state = flags.get('--state');
  if (!state || !path.isAbsolute(state)) return fail('rehearsal 必填 --state(絕對路徑;harness 傳 tmp)');
  const fixturePath = flags.get('--readback-fixture');
  if (action === 'recover-sweeper') {
    if (fixturePath) return fail('recover-sweeper 不做 read-back,不收 --readback-fixture');
  } else if (!fixturePath) {
    return fail('rehearsal 的 dry-run/apply 必填 --readback-fixture(隔離環境不得打真 TapPay)');
  }
  return {
    ok: true,
    config: { action, target, auditPath: audit, statePath: state, clusterId, projectRef: 'rehearsal', fixturePath },
  };
}

/**
 * rehearsal 連線:同構離散欄位解析(不把 raw URL 交給 pg)+ loopback allowlist。
 * hostname 先去 `[]`(WHATWG URL 對 IPv6 回 `[::1]`;D1t2 R2-nit)。
 */
export function buildRehearsalPgConfig(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('D1:rehearsal 連線字串無法解析;拒繼續');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`D1:rehearsal 只收 loopback(實 '${host}');拒繼續`);
  }
  if (url.search !== '') {
    throw new Error('D1:rehearsal 連線字串不得帶 query 參數;拒繼續');
  }
  const database = url.pathname.replace(/^\//, '');
  const user = decodeURIComponent(url.username);
  // 🔴 釘死 postgres/postgres(codex K2):recovery 的身分閘固定要求這兩值 ——
  //    放行其他身分等於允許「跑的時候可以、crash 後復原被拒」的不對稱。
  if (database !== 'postgres' || user !== 'postgres') {
    throw new Error(`D1:rehearsal 連線必須是 postgres/postgres(實 ${user}/${database});拒繼續`);
  }
  return {
    host,
    port: url.port ? Number(url.port) : 5432,
    database,
    user,
    password: decodeURIComponent(url.password),
  };
}

/** verify-ca 的錯誤分類(純函式、可測):憑證類 vs auth 類(= TLS 已過)vs 其他。 */
export function classifyConnectError(err: unknown): 'cert' | 'auth' | 'other' {
  const e = err as { code?: string; message?: string; severity?: string };
  const code = e?.code ?? '';
  const msg = e?.message ?? '';
  if (
    ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)
  ) {
    return 'cert';
  }
  // server 送回 ErrorResponse(帶 severity)= TLS 握手已通過才可能發生 —— pooler 的
  // auth 錯誤不是標準 28P01(實測 XX000 'tenant/user not found'),認 severity 不認碼。
  if (typeof e?.severity === 'string' && e.severity.length > 0) return 'auth';
  if (code === '28P01' || code === '28000' || /password authentication/i.test(msg)) return 'auth';
  return 'other';
}

/** 自簽假 CA(verify-ca 負向用;任何真憑證都驗不過它)。 */
const BOGUS_CA = `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIUQfN0DTAKBggqhkjOPQQDAjAUMRIwEAYDVQQDDAlib2d1
cy10ZXN0MB4XDTI0MDEwMTAwMDAwMFoXDTM0MDEwMTAwMDAwMFowFDESMBAGA1UE
AwwJYm9ndXMtdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABGJ3vaudHxIQ
ZBQyzcJ0S5EA5+9nOOnEwLc3TfSyH8dGQxkS1F+f3uNwbdNS9eNCS3aP4sKRRIl6
FbLYAgUOO16jUzBRMB0GA1UdDgQWBBTFAKeC5CQEbNZUcXWLGDroBmZzGDAfBgNV
HSMEGDAWgBTFAKeC5CQEbNZUcXWLGDroBmZzGDAPBgNVHRMBAf8EBTADAQH/MAoG
CCqGSM49BAMCA0gAMEUCIQDcurEg4WstBqevrDaTBLLbEVWRPmnJSbXbYUvMUzn0
NwIgQmL/o3Nb4RH0WWkjcnaSFbNPMDrOHtsydz2SLpp4Q08=
-----END CERTIFICATE-----`;

/**
 * CA 兩方向實跑(d1-guard 合約債③):以 pg 真連線(SSLRequest 前導由 pg 處理,Fable R3-F3):
 * - 正確 CA:錯誤**必須是 auth 階段**(TLS 已過;不接受 'ok');
 * - 假 CA:錯誤必須是憑證驗證類 —— 任意連線失敗不算通過。
 * 🔴 密碼**無條件換成假的 `ca-probe`**(code-reviewer R2:舊寫法的空值 fallback 只在
 * 空密碼才生效,操作者帶真密碼 URL 會 ①把真憑證送去 pooler 兩次 ②connect 成功 = 假失敗)
 * —— 永不送真憑證、永遠停在 auth 階段、不需要任何 runbook 但書。
 */
export async function runVerifyCa(dbUrl: string, log: (m: string) => void): Promise<boolean> {
  const { Client } = await import('pg');
  const good = buildD1PgConfig(dbUrl);
  const tryConnect = async (ca: string): Promise<'ok' | 'cert' | 'auth' | 'other'> => {
    const client = new Client({ ...good, password: 'ca-probe', ssl: { ...good.ssl, ca } });
    try {
      await client.connect();
      await client.end();
      return 'ok';
    } catch (err) {
      await client.end().catch(() => {});
      return classifyConnectError(err);
    }
  };
  const positive = await tryConnect(SUPABASE_ROOT_CA_2021);
  const negative = await tryConnect(BOGUS_CA);
  const positiveOk = positive === 'auth';
  const negativeOk = negative === 'cert';
  log(`verify-ca 正向(真 CA):${positive}${positiveOk ? ' ✅ TLS 已通過' : ' 🔴 未到 auth 階段'}`);
  log(`verify-ca 負向(假 CA):${negative}${negativeOk ? ' ✅ 憑證驗證擋下' : ' 🔴 不是憑證類錯誤'}`);
  return positiveOk && negativeOk;
}

export type D1ConnectedClient = Readonly<{
  query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
}>;

/** 組裝 + 執行(main)。`connectClient`/`run` 皆可注入 —— 組裝層(mode 映射 / 守門 config /
 *  D1-OUTCOME 輸出 / exit 映射)才測得到,不是假保證(code-reviewer I3)。 */
export async function runD1Cli(
  argv: readonly string[],
  overrides: Partial<{
    run: typeof runD1Orchestrator;
    connectClient: (config: unknown) => Promise<D1ConnectedClient>;
    env: Record<string, string | undefined>;
    log: (m: string) => void;
    out: (m: string) => void;
    /** 第二擊硬退出的 seam(測試注入;預設 process.exit)。 */
    exit: (code: number) => void;
  }> = {},
): Promise<number> {
  const log = overrides.log ?? ((m: string) => console.error(m));
  const parsed = parseD1CliArgs(argv);
  if (!parsed.ok) {
    log(`D1 CLI:${parsed.error}`);
    return 2;
  }
  const { config } = parsed;
  const env = overrides.env ?? process.env;
  const dbUrl = env.D1_DB_URL;
  if (!dbUrl) {
    log('D1 CLI:缺 D1_DB_URL');
    return 2;
  }

  if (config.action === 'verify-ca') {
    return (await runVerifyCa(dbUrl, log)) ? 0 : 1;
  }

  const pgConfig = config.target === 'production' ? buildD1PgConfig(dbUrl) : buildRehearsalPgConfig(dbUrl);
  if (config.target === 'production') {
    mkdirSync(path.dirname(config.statePath), { recursive: true });
  }
  // audit 目錄先建:production dry-run 的 audit 若等五筆真 read-back 跑完才 ENOENT,
  // 白燒一次 3 分鐘 deadline 的正式查詢(code-reviewer M8;fail-closed 但浪費)。
  // 目錄 0700(codex K2:audit 含 rec_trade_id/金額/訂單 UUID)。
  mkdirSync(path.dirname(config.auditPath), { recursive: true, mode: 0o700 });
  // 🔴 mkdir 的 mode 對**既存**目錄無效(codex K2 R2):production 下實查權限,
  //    group/other 有任何位 = 拒(把 audit 丟 /tmp 這類共用目錄就會在這裡停)。
  if (config.target === 'production') {
    const dirMode = statSync(path.dirname(config.auditPath)).mode & 0o077;
    if (dirMode !== 0) {
      log(`D1 CLI:audit 目錄權限過寬(group/other=${dirMode.toString(8)});production 只收 0700 目錄`);
      return 2;
    }
  }
  // 🔴 拒覆蓋既存 audit(codex K2:上一輪的 prepared/committed audit 是 T-Q3 證據)。
  if (config.action !== 'recover-sweeper' && existsSync(config.auditPath)) {
    log(`D1 CLI:audit 檔已存在(${config.auditPath}),拒絕覆蓋 —— 換一個路徑`);
    return 2;
  }

  let runReadback: D1RunReadback;
  if (config.action === 'recover-sweeper') {
    runReadback = async () => {
      throw new Error('D1:recover-sweeper 不做 read-back(程式錯誤)');
    };
  } else if (config.target === 'production') {
    runReadback = makeLiveReadback(buildD1TapPayConfig(env, config.merchantId!));
  } else {
    runReadback = makeFixtureReadback(config.fixturePath!);
  }

  const connectClient =
    overrides.connectClient ??
    (async (cfg: unknown): Promise<D1ConnectedClient> => {
      const { Client } = await import('pg');
      const c = new Client(cfg as object);
      await c.connect();
      return {
        query: async (sql, params) => c.query(sql, params as unknown[]),
        end: () => c.end(),
      };
    });
  const client = await connectClient(pgConfig);
  // 第二擊硬退出(state 保留給 self-heal);第一擊交給核心 graceful。
  let signalCount = 0;
  const hardExit = overrides.exit ?? ((code: number) => process.exit(code));
  const onHardSignal = () => {
    signalCount += 1;
    if (signalCount >= 2) {
      console.error('D1 CLI:第二次中止訊號,硬退出(state 保留,之後跑 --recover-sweeper)');
      hardExit(130);
    }
  };
  process.on('SIGINT', onHardSignal);
  process.on('SIGTERM', onHardSignal);

  try {
    const mode: D1OrchestratorMode = config.action === 'recover-sweeper' ? 'recover-only' : config.action === 'apply' ? 'apply' : 'dry-run';
    const run = overrides.run ?? runD1Orchestrator;
    const result = await run({
      mode,
      target: config.target,
      query: (sql, params) => client.query(sql, params),
      openFreshQuery: async () => {
        // 🔴 與主連線同一份離散 config(D1t2 R1-6:fresh 走 raw URL 會誤連 clone)。
        const fresh = await connectClient(pgConfig);
        return { query: fresh.query, close: fresh.end };
      },
      runReadback,
      auditPath: config.auditPath,
      statePath: config.statePath,
      projectRef: config.projectRef,
      clusterId: config.clusterId,
      randomUUID,
    });
    (overrides.out ?? console.log)(`${D1_OUTCOME_PREFIX}${result.outcome}`);
    log(result.message);
    return result.exitCode;
  } finally {
    process.off('SIGINT', onHardSignal);
    process.off('SIGTERM', onHardSignal);
    await client.end().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('d1-orchestrator-cli.ts')) {
  runD1Cli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`D1 CLI:未攔截錯誤:${String(err)}`);
      process.exit(1);
    });
}
