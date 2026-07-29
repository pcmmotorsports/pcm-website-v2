/**
 * D1t1:settle sweeper 停用/恢復 + ownership state(§8.4 步驟 8 前置,R21-R27 合約)。
 *
 * 🔴 crash-safe 順序**定死**(R24;順序反了會留下「已停用、無 state」的不可恢復窗):
 *   停用 = ①排空初查 ②原子寫 state ③alter_job(active:=false)+回查 ④停後排空+70s 沉降 ⑤補 jobStoppedAt
 *   恢復 = ①active:=true ②回查 active=true ③才原子清 state(殘留舊 state 會誤開日後別人刻意停用的 job)
 *
 * 🔴 排空判定兩個已知陷阱(關卡1 R2-1 + Fable R3-F3):
 *   - `cron.job_run_details` 只查 `status='running'` 會漏 starting/sending/connecting;
 *     不加時間窗則任何歷史 crash 留下的 stale 非終態列會讓每次執行輪詢滿上限後 abort、
 *     永久卡死無 SOP ⇒ 判準 = 該 jobid ∧ start_time > now()-10min ∧ status 非終態 = 0 列
 *     (job 每 2 分鐘一輪、pg_net timeout 70s 是執行上界,10 分鐘窗綽綽有餘)。
 *   - `net.http_request_queue` 的列**送出即刪** ⇒ queue=0 證不了 HTTP in-flight;
 *     pg_net timeout 70s ≥ route maxDuration 60s ⇒ 雙條件成立後**再等 70 秒**才是數學上界。
 *
 * 🔴 洩密面(R3-F9):`net.http_request_queue.headers` 含 `Authorization: Bearer <CRON_SECRET>`。
 * 本檔對該表**只准 SELECT count(*)**,headers 欄不得出現在任何 SQL / 輸出 / audit。
 *
 * state 檔原子寫(R2 折入):同目錄 tmp → write → fsync(fd) → rename → fsync(父目錄);
 * 清除 = unlink → fsync(父目錄)。rename 後不 fsync 目錄,斷電可能出現「job 已停、state 消失」。
 */
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type D1QueryExecutor = (
  sql: string,
  params?: readonly unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export type D1SweeperState = Readonly<{
  version: 1;
  projectRef: string;
  clusterId: string;
  jobId: number;
  jobName: string;
  runId: string;
  /** 接管(R26 CAS)時保留被接管的原 run id;首次停用為 null。 */
  previousRunId: string | null;
  stateWrittenAt: string;
  /** alter_job 成功後第二次原子寫才補上 —— 不在停用前謊寫時間。 */
  jobStoppedAt: string | null;
}>;

export const SWEEPER_JOB_NAME = 'pcm-settle-sweep';
/** 🔴 與 migration `$job$…$job$` 逐字一致(測試 readFileSync 釘死,兩邊不得各抄各的)。 */
export const SWEEPER_JOB_COMMAND = "SELECT pcm_cron.invoke_cron_route('/api/cron/settle-sweep')";
export const SWEEPER_JOB_SCHEDULE = '*/2 * * * *';

/** pg_net timeout 70s ≥ sweeper route maxDuration 60s ⇒ 停用後 70 秒是 in-flight 的數學上界。 */
export const POST_STOP_SETTLE_MS = 70_000;
const DRAIN_POLL_INTERVAL_MS = 5_000;
const DRAIN_POLL_LIMIT_MS = 180_000;

/**
 * 五元組逐字定位(R1-5 + R2-2):jobname/username/database/schedule/command **全等**、恰一列。
 * LIKE 或少驗任一欄,含額外 SQL 的漂移 job 仍會命中並在恢復時被誤啟用。
 */
export const LOCATE_SWEEPER_JOB_SQL = `SELECT jobid, active FROM cron.job
 WHERE jobname = '${SWEEPER_JOB_NAME}'
   AND username = 'postgres'
   AND database = 'postgres'
   AND schedule = '${SWEEPER_JOB_SCHEDULE}'
   AND command = $$${SWEEPER_JOB_COMMAND}$$`;

/** 非終態 = 0 列才算排空(時間窗擋 stale 列;見檔頭)。 */
export const DRAIN_JOB_RUNS_SQL = `SELECT count(*)::int AS n FROM cron.job_run_details
 WHERE jobid = $1
   AND start_time > now() - interval '10 min'
   AND status NOT IN ('succeeded', 'failed')`;

/** 🔴 只准 count(*):headers 欄含 CRON_SECRET,禁入任何輸出。 */
export const DRAIN_HTTP_QUEUE_SQL = `SELECT count(*)::int AS n FROM net.http_request_queue
 WHERE url LIKE '%/api/cron/settle-sweep%'`;

export async function locateSweeperJob(
  query: D1QueryExecutor,
): Promise<{ jobId: number; active: boolean }> {
  const { rows } = await query(LOCATE_SWEEPER_JOB_SQL);
  if (rows.length !== 1) {
    throw new Error(`D1:sweeper job 五元組定位應恰 1 列,實 ${rows.length};拒繼續(勿放寬比對)`);
  }
  const row = rows[0]!;
  return { jobId: Number(row.jobid), active: Boolean(row.active) };
}

// ── state 檔 ────────────────────────────────────────────────────────────────

function assertAbsoluteStatePath(statePath: string): void {
  // 🔴 JS 不展開 '~':預設字串 '~/…' 會把救命 state 寫到工作目錄下名為 '~' 的資料夾(R2 折入)。
  if (!path.isAbsolute(statePath) || statePath.startsWith('~')) {
    throw new Error(`D1:state 路徑必須是絕對路徑(實 '${statePath}');拒繼續`);
  }
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * 通用原子 JSON 落盤(state 檔與 orchestrator audit 檔共用;audit 必須在 COMMIT 前持久化)。
 * 同目錄 tmp → write → fsync(fd) → rename → fsync(父目錄)。
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  assertAbsoluteStatePath(filePath);
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
  fsyncDir(dir);
}

export function writeStateAtomic(statePath: string, state: D1SweeperState): void {
  writeJsonAtomic(statePath, state);
}

export function readState(statePath: string): D1SweeperState | null {
  assertAbsoluteStatePath(statePath);
  if (!existsSync(statePath)) return null;
  const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as D1SweeperState;
  if (parsed.version !== 1 || typeof parsed.jobId !== 'number' || !parsed.runId) {
    throw new Error('D1:state 檔格式不符(version/jobId/runId);拒繼續、人工檢查');
  }
  return parsed;
}

export function clearStateAtomic(statePath: string): void {
  assertAbsoluteStatePath(statePath);
  unlinkSync(statePath);
  fsyncDir(path.dirname(statePath));
}

// ── 停用 / 恢復 ─────────────────────────────────────────────────────────────

export type D1SweeperDeps = Readonly<{
  query: D1QueryExecutor;
  statePath: string;
  runId: string;
  projectRef: string;
  clusterId: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}>;

async function waitForDrain(deps: D1SweeperDeps, jobId: number): Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const startedAt = now();
  for (;;) {
    const runs = await deps.query(DRAIN_JOB_RUNS_SQL, [jobId]);
    const queue = await deps.query(DRAIN_HTTP_QUEUE_SQL);
    if (Number(runs.rows[0]?.n) === 0 && Number(queue.rows[0]?.n) === 0) return;
    if (now() - startedAt > DRAIN_POLL_LIMIT_MS) {
      throw new Error('D1:sweeper 排空輪詢逾 3 分鐘仍有非終態執行/在途請求;abort 人工釐清');
    }
    await sleep(DRAIN_POLL_INTERVAL_MS);
  }
}

/**
 * 停用序(R24 順序定死;見檔頭)。回傳停用後的 state。
 * 前置:呼叫端已確認 state 檔不存在且 job active=true(state-first 分流是 orchestrator 的責任)。
 */
export async function stopSweeper(deps: D1SweeperDeps): Promise<D1SweeperState> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { jobId, active } = await locateSweeperJob(deps.query);
  if (!active) {
    throw new Error('D1:sweeper job 非 active 且無 state 檔 = 別人刻意停的;abort 人工釐清(不誤開)');
  }

  // ① 排空初查(規格逐字「先等待進行中的執行排空再開始」)。
  await waitForDrain(deps, jobId);

  // 🔴 排空可長達 3 分鐘 —— 期間若有人手動停用 job,照原計畫寫 state + 停用 + 事後恢復
  //    = 誤開別人刻意停的 job(codex K2)。寫 state 前必須用五元組再回查一次。
  const recheck = await locateSweeperJob(deps.query);
  if (recheck.jobId !== jobId || !recheck.active) {
    throw new Error('D1:排空期間 sweeper job 狀態漂移(已被停用或 jobId 變動);abort 人工釐清(不誤開)');
  }

  // ② 先原子寫 state、③ 才停 job —— 反過來會留下「已停用、無 state」的不可恢復窗。
  const state: D1SweeperState = {
    version: 1,
    projectRef: deps.projectRef,
    clusterId: deps.clusterId,
    jobId,
    jobName: SWEEPER_JOB_NAME,
    runId: deps.runId,
    previousRunId: null,
    stateWrittenAt: new Date().toISOString(),
    jobStoppedAt: null,
  };
  writeStateAtomic(deps.statePath, state);

  await deps.query('SELECT cron.alter_job(job_id => $1, active => false)', [jobId]);
  const after = await locateSweeperJob(deps.query);
  if (after.jobId !== jobId || after.active) {
    throw new Error('D1:alter_job 後回查 active 仍為 true;abort');
  }

  // ④ 停後排空 + 70s 沉降(②③ 之間 2 分鐘窗內可能又起一輪;queue=0 證不了 in-flight)。
  await waitForDrain(deps, jobId);
  await sleep(POST_STOP_SETTLE_MS);

  // ⑤ 補 jobStoppedAt(第二次原子寫;不在停用前謊寫)。
  const stopped: D1SweeperState = { ...state, jobStoppedAt: new Date().toISOString() };
  writeStateAtomic(deps.statePath, stopped);
  return stopped;
}

/**
 * 恢復序:①active:=true ②回查 ③才清 state。
 * `expectedRunId`:正常路徑 = 本次 run id(compare;防仍存活的雙執行互清 —— advisory lock
 * 已擋,此為第二道);recovery mode 呼叫前應已完成 CAS 接管(`takeOverState`)。
 */
export async function recoverSweeper(
  deps: Omit<D1SweeperDeps, 'runId'> & Readonly<{ expectedRunId: string }>,
): Promise<void> {
  const state = readState(deps.statePath);
  if (!state) {
    throw new Error('D1:無 state 檔,拒絕恢復(非本流程停用的 job 不動;abort 人工)');
  }
  if (state.runId !== deps.expectedRunId) {
    throw new Error('D1:state run id 與本次不符,拒絕恢復(先 CAS 接管才可動)');
  }
  // 跨環境誤用的 state 檔(rehearsal 的 state 拿到 production 用)jobId 可能剛好撞上;
  // schema 既然帶了這兩欄就要驗,不留死證據(code-reviewer Minor 3)。
  if (state.projectRef !== deps.projectRef || state.clusterId !== deps.clusterId) {
    throw new Error('D1:state 的 projectRef/clusterId 與本次目標不符;拒絕恢復、人工釐清');
  }
  const { jobId } = await locateSweeperJob(deps.query);
  if (jobId !== state.jobId) {
    throw new Error('D1:state 內 jobId 與現網五元組定位不符;abort 人工釐清');
  }
  await deps.query('SELECT cron.alter_job(job_id => $1, active => true)', [jobId]);
  const after = await locateSweeperJob(deps.query);
  if (!after.active) {
    throw new Error('D1:恢復後回查 active 仍為 false;abort(state 保留,人工重跑恢復)');
  }
  clearStateAtomic(deps.statePath);
}

/**
 * R26 CAS 接管:recovery mode 把 state 的 owner run id 原子改為本次(接管紀錄保留原 id)。
 * 只有接管後,`recoverSweeper` 的 run id compare 才會放行。
 */
export function takeOverState(statePath: string, newRunId: string): D1SweeperState {
  const state = readState(statePath);
  if (!state) {
    throw new Error('D1:無 state 檔可接管');
  }
  const taken: D1SweeperState = { ...state, runId: newRunId, previousRunId: state.runId };
  writeStateAtomic(statePath, taken);
  return taken;
}
