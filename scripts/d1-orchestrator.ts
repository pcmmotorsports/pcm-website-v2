/**
 * D1t1:D1c orchestrator 交易核心(§8.4 步驟 8 前置 + 8b-13 + 驗收矩陣)。
 *
 * **這支程式執行「永久刪除 26 張 production 訂單」的那一個交易。** 除 D1c 外全線可逆;
 * 這裡的每一道斷言都是「刪錯」與「刪對」之間唯一的差別。
 *
 * 執行序(§5.0 / §8.4 逐字;關卡1 三輪 44 條 findings 折入,對帳見 slice plan v4):
 *   advisory lock(single-flight,R25)→ 金絲雀(R3-F1)→ state-first 分流(R27)
 *   → [apply] assert active → 停 sweeper(R24 crash-safe 序,d1-sweeper-control)
 *   → BEGIN REPEATABLE READ → 守門(與 DELETE 同交易)→ 快照 → 鎖序(NOWAIT fence,R21/R22)
 *   → 鎖畢 assert(12/9/pending 未變)→ A2/A3 零引用 → 8b read-back(§8.7 判定矩陣)
 *   → 步驟 9-13(刪除類 DML 以 RETURNING 驗精確主鍵集合;改號/退款/發票以 RETURNING
 *     列數 + 欄值 + 終態逐筆驗,R1-12)→ 驗收矩陣
 *   → audit 落盤(prepared,fsync)→ COMMIT → audit 改終態 → 恢復 sweeper → completed
 *
 * 🔴 結果六態(R1-9 + R2-5 + codex K2),exit code 互異;`commit_outcome_unknown` 與
 *   `committed_recovery_required` **絕不可包裝成可重跑**,`not_committed_recovery_required`
 *   可重跑但必先 --recover-sweeper:
 *   completed / not_committed / not_committed_recovery_required / commit_outcome_unknown /
 *   committed_recovery_required / recovery_only
 *
 * 🔴 dry-run(§8.4 逐字「不動 cron」):零 cron/state 寫入、遇 state 檔拒絕執行、
 *   交易一律 ROLLBACK;但必跑唯讀 control-plane preflight(R3-F4)—— 否則那三句查詢
 *   第一次對真 production 跑就是不可逆的 D1c 當下。
 *
 * 🔴 本檔不建 CLI(D1t2);不對任何 DB 實跑的驗證(D1t3,規格明定不可省)。
 */
import { D1_COHORT, D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { buildD1TransactionGuardSql } from './d1-guard';
import {
  judgeReadback,
  selectFactsForQuery,
  type D1AttemptFact,
  type D1KeyedAttemptFact,
  type D1ReadbackAuditRow,
} from './d1-readback';
import {
  clearStateAtomic,
  DRAIN_HTTP_QUEUE_SQL,
  DRAIN_JOB_RUNS_SQL,
  locateSweeperJob,
  readState,
  recoverSweeper,
  stopSweeper,
  takeOverState,
  writeJsonAtomic,
  type D1QueryExecutor,
} from './d1-sweeper-control';
import type { TapPayRecordResponseWire } from '../packages/adapters/src/tappay/wire';

/** `recover-only` = D1t2 `--recover-sweeper`:只走 recovery mode,state 不在場即退出、絕不 fall through 到正式執行(D1t2 關卡1 R2-1)。 */
export type D1OrchestratorMode = 'apply' | 'dry-run' | 'recover-only';
export type D1Target = 'production' | 'rehearsal';

export type D1Outcome =
  | 'completed'
  | 'not_committed'
  | 'not_committed_recovery_required'
  | 'commit_outcome_unknown'
  | 'committed_recovery_required'
  | 'recovery_only';

/** exit code 合約(D1t2 CLI 照抄;unknown 與 recovery_required 絕不可映成「可重跑」)。 */
export const D1_EXIT_CODES: Readonly<Record<D1Outcome, number>> = {
  completed: 0,
  not_committed: 1,
  committed_recovery_required: 3,
  commit_outcome_unknown: 4,
  // 未提交、但 sweeper 恢復失敗(state 保留):資料安全可重跑,但重跑前必先 --recover-sweeper。
  not_committed_recovery_required: 6,
  // 獨立碼(code-reviewer Important):recovery mode 不得與「26 張已刪、D1 完成」共用 0。
  // 🔴 recovery_only ≠「什麼都沒刪」—— 它也涵蓋「上輪已提交、本輪只收尾」的分支,
  //    提交與否要看 message 的對帳段。🔴 D1t2 wrapper 分流必須認 outcome/stdout 判定字串、
  //    不得單憑 exit code(3/4/5 與 Node 自身保留碼有重疊之虞,未逐碼查證)。
  recovery_only: 5,
};

// ── cohort 字面(單一來源:d1-cohort.ts;本檔不重抄任何 UUID)─────────────────
const ALL_IDS = D1_COHORT.map(({ id }) => `'${id}'::uuid`).join(', ');
const DELETE_IDS = D1_DELETE_COHORT.map(({ id }) => `'${id}'::uuid`).join(', ');
const RETAIN_IDS = D1_RETAIN_COHORT.map(({ id }) => `'${id}'::uuid`).join(', ');
const READBACK_DISPLAY_IDS = [
  'PCM-2026-0052',
  'PCM-2026-0064',
  'PCM-2026-0090',
  'PCM-2026-0101',
  'PCM-2026-0102',
  'PCM-2026-0104',
]
  .map((d) => `'${d}'`)
  .join(', ');

// ── 交易 SQL 合約(exported:測試以剝註解後的語句序列 + fake client 呼叫序雙軌驗)──

export const ADVISORY_LOCK_SQL =
  "SELECT pg_try_advisory_lock(hashtext('pcm-d1-orchestrator')) AS locked";

/** 🔴 金絲雀(R3-F1):transaction pooler(6543)下每句話可能落在不同 backend ——
 *  取到的 advisory lock 對「下一句」毫無保護。同 session 查得到自己的鎖才算 single-flight 成立。 */
export const ADVISORY_LOCK_CANARY_SQL =
  "SELECT count(*)::int AS n FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory'";

/** 顯式釋放(session 關閉本來就會釋放;顯式是為了日後若被接到 pooled 連線不殘留)。 */
export const ADVISORY_UNLOCK_SQL =
  "SELECT pg_advisory_unlock(hashtext('pcm-d1-orchestrator'))";

export const TXN_SETUP_SQL: readonly string[] = [
  'BEGIN',
  'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
  "SET LOCAL lock_timeout = '5s'",
  "SET LOCAL statement_timeout = '60s'",
  // 大於 read-back 總體 3 分鐘 HTTP 預算 + 餘裕(D1t3 驗逾時後交易確實 rollback)。
  "SET LOCAL idle_in_transaction_session_timeout = '5min'",
];

/** 三組基準快照(R1-12/13/14 + R2-6;兩組 attempts 不混用)。 */
export const SNAPSHOT_SQL: readonly string[] = [
  `CREATE TEMP TABLE d1t_noncohort_orders ON COMMIT DROP AS SELECT * FROM public.orders WHERE id NOT IN (${ALL_IDS})`,
  `CREATE TEMP TABLE d1t_pending_attempts ON COMMIT DROP AS SELECT * FROM public.payment_charge_attempts WHERE order_id IN (${DELETE_IDS}) AND status = 'pending'`,
  `CREATE TEMP TABLE d1t_retained_attempts ON COMMIT DROP AS SELECT * FROM public.payment_charge_attempts WHERE order_id IN (${RETAIN_IDS})`,
  `CREATE TEMP TABLE d1t_retained_orders ON COMMIT DROP AS SELECT * FROM public.orders WHERE id IN (${RETAIN_IDS})`,
];

/** 鎖序定死(R21):orders → order_items → attempts(NOWAIT)→ pending_invoices。 */
export const LOCK_SQL: ReadonlyArray<readonly [sql: string, expectRows: number]> = [
  [`SELECT id FROM public.orders WHERE id IN (${ALL_IDS}) ORDER BY id FOR UPDATE`, 29],
  [`SELECT id FROM public.order_items WHERE order_id IN (${ALL_IDS}) ORDER BY id FOR UPDATE`, 39],
  // 任何反向持鎖者(如 mark_charge_attempt_charged 先鎖 attempt)讓 NOWAIT 立即 error
  // ⇒ ROLLBACK + exit 非零;R23 定死:不自動重試,操作者確認無並發後手動重跑。
  [
    `SELECT id FROM public.payment_charge_attempts WHERE order_id IN (${ALL_IDS}) ORDER BY id FOR UPDATE NOWAIT`,
    27,
  ],
  [`SELECT id FROM public.pending_invoices WHERE order_id IN (${ALL_IDS}) ORDER BY id FOR UPDATE`, 3],
];

/** 鎖畢 assert(R22 逐字:12/9 + pending 三筆未變,**不是「全終態」**—— 那個斷言必然 fail)。 */
export const LOCKED_STATE_ASSERT_SQL = `SELECT status, count(*)::int AS n FROM public.payment_charge_attempts WHERE order_id IN (${DELETE_IDS}) GROUP BY status ORDER BY status`;
export const PENDING_FENCE_SQL = `SELECT (SELECT count(*) FROM (SELECT * FROM public.payment_charge_attempts WHERE order_id IN (${DELETE_IDS}) AND status = 'pending' EXCEPT ALL SELECT * FROM d1t_pending_attempts) x)::int
  + (SELECT count(*) FROM (SELECT * FROM d1t_pending_attempts EXCEPT ALL SELECT * FROM public.payment_charge_attempts WHERE order_id IN (${DELETE_IDS}) AND status = 'pending') y)::int AS n`;

/**
 * A2/A3 零引用(D1c 前置,Fable 關卡2 F5 / 交接檔 §5-3)。
 * 🔴 口徑 = 待刪 26 張:RESTRICT 只咬「被刪的列」;留存單若已有合法備註,擋 29 張口徑
 * 只會製造假 abort。非零 = abort 人工釐清,不得硬刪。
 */
export const A2A3_ZERO_REF_SQL = `SELECT
  (SELECT count(*) FROM public.order_item_procurement p JOIN public.order_items i ON p.order_item_id = i.id WHERE i.order_id IN (${DELETE_IDS}))::int AS proc_refs,
  (SELECT count(*) FROM public.order_notes n WHERE n.order_id IN (${DELETE_IDS}))::int AS note_refs`;

/** 8b:read-back 事實(六筆 = partial unique index 保證的 pending|charged 各一)。
 *  order_id:TapPay 的 order_number 存 UUID(adapter:91)⇒ 強識別閘比對鍵;
 *  payment_status:0101 例外的拍板前提釘死(NT$2,400 / unpaid)。 */
export const READBACK_FACTS_SQL = `SELECT o.display_id AS display_id, o.id AS order_id, a.rec_trade_id AS rec_trade_id, o.total AS total, o.payment_status::text AS payment_status
  FROM public.orders o
  JOIN public.payment_charge_attempts a ON a.order_id = o.id AND a.status IN ('pending', 'charged')
 WHERE o.display_id IN (${READBACK_DISPLAY_IDS})
 ORDER BY o.display_id`;

// 步驟 9-13:只有具名 DML(R1-20:禁止任何由表清單推導的通用刪除 —— buildCohortSelectors
// 含五張父表,反序會刪到備份父資料)。每道 RETURNING 驗精確主鍵集合。
export const EXPECTED_ATTEMPT_IDS_SQL = `SELECT id FROM public.payment_charge_attempts WHERE order_id IN (${DELETE_IDS}) ORDER BY id`;
export const PRE_CASCADE_COUNTS_SQL = `SELECT
  (SELECT count(*) FROM public.order_items WHERE order_id IN (${DELETE_IDS}))::int AS items,
  (SELECT count(*) FROM public.order_legal_consents WHERE order_id IN (${DELETE_IDS}))::int AS consents`;
export const DELETE_ATTEMPTS_SQL = `DELETE FROM public.payment_charge_attempts WHERE order_id IN (${DELETE_IDS}) RETURNING id`;
export const DELETE_ORDERS_SQL = `DELETE FROM public.orders WHERE id IN (${DELETE_IDS}) RETURNING id`;
export const POST_CASCADE_COUNTS_SQL = PRE_CASCADE_COUNTS_SQL;

/** 步驟 11 前:跨欄零碰撞(R2-7;兩欄各自 UNIQUE 擋不住跨欄撞號)。 */
const NEW_IDS = D1_RETAIN_COHORT.map(({ newDisplayId }) => `'${newDisplayId}'`).join(', ');
const OLD_IDS = D1_RETAIN_COHORT.map(({ displayId }) => `'${displayId}'`).join(', ');
export const RENUMBER_COLLISION_SQL = `SELECT
  (SELECT count(*) FROM public.orders WHERE display_id IN (${NEW_IDS}) OR legacy_display_id IN (${NEW_IDS}))::int AS new_taken,
  (SELECT count(*) FROM public.orders WHERE legacy_display_id IN (${OLD_IDS}))::int AS old_taken`;
export const RENUMBER_SQL = `UPDATE public.orders SET legacy_display_id = display_id, display_id = $2 WHERE id = $1 AND display_id = $3 RETURNING id, display_id, legacy_display_id`;
/** 改號後:舊號經 A9b 形狀(display OR legacy)必須唯一命中指定 UUID(R2-7 + 矩陣 A9b 列)。 */
export const RENUMBER_VERIFY_SQL = `SELECT id FROM public.orders WHERE display_id = $1 OR legacy_display_id = $1`;

export const MARK_REFUNDED_SQL = `UPDATE public.orders SET payment_status = 'refunded' WHERE id = $1 RETURNING id, payment_status`;
/** 步驟 12 終態驗證:期望差集刻意排除 payment_status 欄 ⇒ 這裡逐筆補驗(refunded 或 = 快照原值)。 */
export const PAYMENT_STATE_VERIFY_SQL = `SELECT o.id, o.payment_status::text AS payment_status, s.payment_status::text AS snapshot_status FROM public.orders o JOIN d1t_retained_orders s ON s.id = o.id`;
export const VOID_INVOICES_SQL = `UPDATE public.pending_invoices SET status = 'voided' WHERE order_id IN (${RETAIN_IDS}) RETURNING id`;

/** 驗收矩陣(§8.4 表逐項;全 cohort 口徑)。每項 [sql, 期望,說明]。 */
export const MATRIX_SQL: ReadonlyArray<readonly [sql: string, expect: number, label: string]> = [
  [`SELECT count(*)::int AS n FROM public.orders WHERE id IN (${DELETE_IDS})`, 0, '26 待刪 orders 歸零'],
  [`SELECT count(*)::int AS n FROM public.orders WHERE id IN (${RETAIN_IDS})`, 3, '3 留存 orders 仍在'],
  [`SELECT count(*)::int AS n FROM public.order_items WHERE order_id IN (${DELETE_IDS})`, 0, 'cohort items 36→0'],
  [`SELECT count(*)::int AS n FROM public.order_items WHERE order_id IN (${RETAIN_IDS})`, 3, '留存 items 3 仍在'],
  [`SELECT count(*)::int AS n FROM public.order_legal_consents WHERE order_id IN (${DELETE_IDS})`, 0, 'cohort consents 2→0'],
  [`SELECT count(*)::int AS n FROM public.order_legal_consents WHERE order_id IN (${RETAIN_IDS})`, 2, '留存 consents 2 仍在'],
  [`SELECT count(*)::int AS n FROM public.payment_charge_attempts WHERE order_id IN (${DELETE_IDS})`, 0, 'cohort attempts 24→0'],
  [`SELECT count(*)::int AS n FROM public.payment_charge_attempts WHERE order_id IN (${RETAIN_IDS})`, 3, '留存 attempts 3 仍在'],
  [
    `SELECT (SELECT count(*) FROM (SELECT * FROM public.payment_charge_attempts WHERE order_id IN (${RETAIN_IDS}) EXCEPT ALL SELECT * FROM d1t_retained_attempts) x)::int + (SELECT count(*) FROM (SELECT * FROM d1t_retained_attempts EXCEPT ALL SELECT * FROM public.payment_charge_attempts WHERE order_id IN (${RETAIN_IDS})) y)::int AS n`,
    0,
    '留存 attempts 與快照逐欄一致(status 未變)',
  ],
  // 🔴 cohort 口徑(§8.4 逐字紅字;code-reviewer Critical):全表計數在 D1 前有新付款單
  //    進來時必然失敗 —— record_pending_invoice 對每筆 paid 冪等 INSERT。
  [`SELECT count(*)::int AS n FROM public.pending_invoices WHERE order_id IN (${ALL_IDS})`, 3, 'pending_invoices 3→3 一筆未刪(cohort 口徑)'],
  [`SELECT count(*)::int AS n FROM public.pending_invoices WHERE status = 'voided' AND order_id IN (${RETAIN_IDS})`, 3, '三筆全 voided'],
  // 五張 0 列表(R1-21:規格是五張不是四張)。
  [`SELECT count(*)::int AS n FROM public.email_outbox WHERE order_id IN (${ALL_IDS})`, 0, 'email_outbox 0→0'],
  [`SELECT count(*)::int AS n FROM public.order_refunds WHERE order_id IN (${ALL_IDS})`, 0, 'order_refunds 0→0'],
  [
    `SELECT count(*)::int AS n FROM public.order_refund_items WHERE order_id IN (${ALL_IDS}) OR refund_id IN (SELECT id FROM public.order_refunds WHERE order_id IN (${ALL_IDS}))`,
    0,
    'order_refund_items 0→0(兩條路)',
  ],
  [`SELECT count(*)::int AS n FROM public.payment_double_charge_anomalies WHERE old_order_id IN (${ALL_IDS})`, 0, 'anomalies 0→0'],
  [
    `SELECT count(*)::int AS n FROM public.payment_double_charge_anomaly_events WHERE anomaly_id IN (SELECT id FROM public.payment_double_charge_anomalies WHERE old_order_id IN (${ALL_IDS}))`,
    0,
    'anomaly_events 0→0',
  ],
  // display_id / legacy_display_id 唯一且等於映射(逐筆另驗;這裡驗全域無碰撞)。
  [`SELECT count(*)::int AS n FROM public.orders WHERE display_id IN (${NEW_IDS})`, 3, '3 新號都在'],
  [`SELECT count(*)::int AS n FROM public.orders WHERE legacy_display_id IN (${OLD_IDS})`, 3, '3 舊號都進 legacy'],
  // 非 cohort orders:與快照雙向 EXCEPT ALL 為空(R1-13;md5 已廢 —— 只證明本交易沒動到它們)。
  [
    `SELECT (SELECT count(*) FROM (SELECT * FROM public.orders WHERE id NOT IN (${ALL_IDS}) EXCEPT ALL SELECT * FROM d1t_noncohort_orders) x)::int + (SELECT count(*) FROM (SELECT * FROM d1t_noncohort_orders EXCEPT ALL SELECT * FROM public.orders WHERE id NOT IN (${ALL_IDS})) y)::int AS n`,
    0,
    '非 cohort orders 雙向 EXCEPT ALL 為空',
  ],
  // 留存 orders 期望差集(R3-F2):除三個蓄意改的欄,逐欄與快照相等;paid_at 明列不變。
  [
    `SELECT count(*)::int AS n FROM public.orders o JOIN d1t_retained_orders s ON s.id = o.id
      WHERE (to_jsonb(o) - 'display_id' - 'legacy_display_id' - 'payment_status') IS DISTINCT FROM (to_jsonb(s) - 'display_id' - 'legacy_display_id' - 'payment_status')
         OR o.paid_at IS DISTINCT FROM s.paid_at
         OR o.legacy_display_id IS DISTINCT FROM s.display_id`,
    0,
    '留存 orders 期望差集:僅三欄變、paid_at 未動、legacy=原號',
  ],
];

/** CHECK 逐字驗(R1-21):讀 pg_constraint,不用 position/子字串假綠。 */
export const CHECK_VALID_SQL = `SELECT
  (SELECT convalidated FROM pg_constraint WHERE conname = 'orders_display_id_format' AND conrelid = 'public.orders'::regclass) AS display_format_valid,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'pending_invoices_status_check' AND conrelid = 'public.pending_invoices'::regclass) AS invoices_check_def`;

// ── 主流程 ──────────────────────────────────────────────────────────────────

export type D1OrchestratorDeps = Readonly<{
  mode: D1OrchestratorMode;
  target: D1Target;
  query: D1QueryExecutor;
  /** unknown 態對帳用:開一條**新**唯讀連線(原連線的 COMMIT 結果不明時,舊連線不可信)。 */
  openFreshQuery: () => Promise<{ query: D1QueryExecutor; close: () => Promise<void> }>;
  /**
   * 8b:對五筆有鍵者跑 TapPay read-back(D1b1 重用同一實作;測試注入 fake)。
   * 🔴 型別上只收有鍵五筆(codex K2:傳六筆進去,實作就有機會對 0101 用禁止的替代鍵
   * 查詢後把結果丟掉,判定層察覺不了 —— 無鍵單物理上不進查詢層才是斷絕)。
   * 🔴 實作合約:必須以 `fact.recTradeId` 為查詢鍵、逐筆對應 —— 0052 的零命中出口
   * 在判定層驗不到「查的鍵對不對」,鍵綁錯會靜默落成「正式商戶查無」⇒ D1t2 單元測
   * 必須斷言 fetch body 的 `rec_trade_id === fact.recTradeId`(code-reviewer Minor 1)。
   */
  runReadback: (
    facts: readonly D1KeyedAttemptFact[],
    abortSignal: AbortSignal,
    deadlineAt: number,
  ) => Promise<ReadonlyMap<string, TapPayRecordResponseWire>>;
  auditPath: string;
  statePath: string;
  projectRef: string;
  clusterId: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  randomUUID: () => string;
  /** signal 掛載點(測試注入 fake;預設 process)。 */
  processLike?: Pick<NodeJS.Process, 'on' | 'off'>;
}>;

export type D1OrchestratorResult = Readonly<{
  outcome: D1Outcome;
  exitCode: number;
  message: string;
  auditRows?: readonly D1ReadbackAuditRow[];
}>;

/** read-back 整批 3 分鐘 deadline(§8.4 六筆總體上限)。 */
export const READBACK_DEADLINE_MS = 180_000;

function expectRows(rows: Array<Record<string, unknown>>, n: number, label: string): void {
  if (rows.length !== n) {
    throw new Error(`D1:${label} 應 ${n} 列,實 ${rows.length};abort`);
  }
}

function expectIdSet(rows: Array<Record<string, unknown>>, expected: readonly string[], label: string): void {
  const got = rows.map((r) => String(r.id)).sort();
  const want = [...expected].sort();
  if (got.length !== want.length || got.some((v, i) => v !== want[i])) {
    throw new Error(`D1:${label} RETURNING 主鍵集合與期望不符(${got.length}/${want.length});abort`);
  }
}

export async function runD1Orchestrator(deps: D1OrchestratorDeps): Promise<D1OrchestratorResult> {
  const log = deps.log ?? ((m: string) => console.error(m));
  const now = deps.now ?? Date.now;
  const proc = deps.processLike ?? process;

  // 🔴 audit 與 state 必須是兩個不同檔(codex K2):同檔時 prepared audit 會覆蓋
  //    ownership state,COMMIT 後 sweeper 永遠恢復不了。
  const path = await import('node:path');
  if (path.resolve(deps.auditPath) === path.resolve(deps.statePath)) {
    return {
      outcome: 'not_committed',
      exitCode: D1_EXIT_CODES.not_committed,
      message: 'D1:auditPath 與 statePath 不得是同一個檔案;拒繼續',
    };
  }

  // ── signal 序列化(R1-10 + R2-4):第一個 signal 設旗標 + abort HTTP;每個 DB 呼叫
  //    前檢查(safe-point);第二個 signal 由 CLI 層硬退出(state 留給 self-heal)。
  const abortController = new AbortController();
  let aborted = false;
  const onSignal = () => {
    aborted = true;
    abortController.abort(new Error('D1:收到中止訊號'));
  };
  proc.on('SIGINT', onSignal);
  proc.on('SIGTERM', onSignal);

  // 所有 DB 呼叫走這層 = 每個 await 之後的下一步自帶 abort safe-point。
  const q: D1QueryExecutor = async (sql, params) => {
    if (aborted) throw new Error('D1:已中止(signal);走 ROLLBACK 路');
    return deps.query(sql, params);
  };

  /** 一進 stopSweeper 就設(codex K2:cron 已停但停後排空/fsync 失敗時也必須恢復)。 */
  let stopAttempted = false;
  let committed = false;
  /** COMMIT 已送出(結果可能不明);此後任何錯誤都不得回報成可重跑(codex K2)。 */
  let commitSent = false;
  /** 內層 catch 的 ROLLBACK 是否確認成功 —— 訊息只在確認後才寫「已 ROLLBACK」。 */
  let rollbackConfirmed = false;
  const runId = deps.randomUUID();

  const finish = (outcome: D1Outcome, message: string, auditRows?: readonly D1ReadbackAuditRow[]): D1OrchestratorResult => {
    proc.off('SIGINT', onSignal);
    proc.off('SIGTERM', onSignal);
    return { outcome, exitCode: D1_EXIT_CODES[outcome], message, auditRows };
  };

  try {
    // 1. single-flight(R25):具名 advisory lock,涵蓋「恢復→寫 state→停 job→執行→恢復→清 state」全段。
    const lock = await q(ADVISORY_LOCK_SQL);
    if (lock.rows[0]?.locked !== true) {
      return finish('not_committed', 'D1:另一個 orchestrator 實例持有 advisory lock;立即退出(禁雙執行)');
    }
    const canary = await q(ADVISORY_LOCK_CANARY_SQL);
    if (Number(canary.rows[0]?.n) < 1) {
      return finish(
        'not_committed',
        'D1:advisory lock 金絲雀失敗 —— 本 session 查不到自己的鎖,疑似 transaction pooler(6543);拒繼續',
      );
    }

    // 🔴 活連線身分閘提前到**任何 cron/state 寫入之前**(codex K2:apply 會先停 sweeper、
    //    交易守門在那之後才跑 —— loopback 若是 production 的 tunnel,沒有確認字串就動了
    //    正式站的 cron)。cid 精確比對 deps.clusterId(production = 常數;rehearsal = harness
    //    撈的隔離叢集值,天然 ≠ production)。
    const liveIdentity = (await q(RECONCILE_IDENTITY_SQL)).rows[0];
    if (
      String(liveIdentity?.cid) !== deps.clusterId ||
      liveIdentity?.su !== 'postgres' ||
      liveIdentity?.db !== 'postgres'
    ) {
      return finish(
        'not_committed',
        `D1:當下連線的叢集/身分與目標不符(cid=${String(liveIdentity?.cid)});不動 cron、不接管 state,人工釐清`,
      );
    }

    // 2. state-first 分流(R27:state 判斷先於一切 active 斷言)。
    const existing = readState(deps.statePath);
    if (existing) {
      if (deps.mode === 'dry-run') {
        return finish(
          'not_committed',
          'D1:偵測到 sweeper ownership state 檔;dry-run 不動 cron,請先跑 --recover-sweeper 釐清',
        );
      }
      // 🔴 跨環境 state 檔在「改寫或刪除它之前」就要擋(code-reviewer R2:takeOverState
      //    會先改寫、active 分支會直接刪 —— 比對必須在單一入口最前面)。
      if (existing.projectRef !== deps.projectRef || existing.clusterId !== deps.clusterId) {
        return finish(
          'not_committed',
          'D1:state 檔的 projectRef/clusterId 與本次目標不符(疑似跨環境誤用);不接管、不清除,人工釐清',
        );
      }
      // (活連線身分閘已提前到取鎖後、所有路徑共用;此處不重複。)
      // recovery mode:CAS 接管(R26)→ 恢復/清 state → 附帶對帳(R3-F8)→ 退出,不開始正式執行。
      takeOverState(deps.statePath, runId);
      const { jobId: liveJobId, active } = await locateSweeperJob(q);
      // 🔴 active 分支同樣要驗 state.jobId 與現網一致(codex K2:inactive 分支會比對、
      //    active 分支原本直接清檔 —— 不一致代表 state 不是這個 job 的,不得清)。
      if (existing.jobId !== liveJobId) {
        return finish(
          'not_committed',
          `D1:state 內 jobId ${existing.jobId} 與現網五元組定位 ${liveJobId} 不符;不清除、人工釐清`,
        );
      }
      // 🔴 兩階段順序(codex K2):①先對帳、②先落 recovery audit、③才動 cron/清 state ——
      //    反過來的話,恢復後任何一步失敗就留下「已復原但無紀錄」。
      // 🔴 recovery audit 寫**獨立檔**(`<audit>.recovery.json`):操作者若重用 apply 那次的
      //    --audit 路徑,最小 recovery JSON 會覆蓋掉完整 read-back 與 T-Q3 證據(codex K2)。
      const present = await q(`SELECT count(*)::int AS n FROM public.orders WHERE id IN (${DELETE_IDS})`);
      const n = Number(present.rows[0]?.n);
      // 🔴 對帳只接受 0 或 26(codex K2 R2):1-25 = 半套狀態,恢復 cron/清 state 都可能
      //    掩蓋現場 —— 保留一切、人工釐清。
      if (n !== 0 && n !== 26) {
        return finish(
          'not_committed',
          `D1:recovery 對帳非預期(待刪單剩 ${n} 張,應 0 或 26);不動 cron、state 保留,人工釐清`,
        );
      }
      const verdict = n === 26 ? '上輪未提交(26 張待刪單仍在)' : '🔴 上輪已提交(26 張已刪)';
      const recoveryAuditPath = `${deps.auditPath}.recovery-${runId}.json`;
      writeJsonAtomic(recoveryAuditPath, {
        version: 1,
        outcome: 'recovery_only',
        runId,
        takenOverRunId: existing.runId,
        reconcile: verdict,
        startedAt: new Date().toISOString(),
      });
      try {
        if (active) {
          // 已是 active:別的流程恢復到一半死掉 ⇒ 只清 state(read-back 已由 locate 完成)。
          clearStateAtomic(deps.statePath);
        } else {
          await recoverSweeper({
            query: q,
            statePath: deps.statePath,
            expectedRunId: runId,
            projectRef: deps.projectRef,
            clusterId: deps.clusterId,
          });
        }
      } catch (recErr) {
        // 🔴 依對帳結果分流(codex K2 R2):上輪已提交時絕不可回報成可重跑。
        return finish(
          n === 0 ? 'committed_recovery_required' : 'not_committed_recovery_required',
          `D1:recovery 對帳=「${verdict}」但恢復/清 state 失敗:${String(recErr)};state 保留,修復後重跑 --recover-sweeper`,
        );
      }
      return finish('recovery_only', `D1:recovery mode 完成(sweeper 已恢復、state 已清)。對帳:${verdict}。請檢查 ${recoveryAuditPath}`);
    }

    // recover-only 且無 state:無事可恢復 —— 明確退出,絕不 fall through 到正式執行(D1t2 R2-1)。
    if (deps.mode === 'recover-only') {
      return finish('recovery_only', 'D1:無 state 檔,無事可恢復(非本流程停用的 job 不動);未動任何東西');
    }

    // 3. 正式分支 / dry-run preflight。
    if (deps.mode === 'apply') {
      const { active } = await locateSweeperJob(q);
      if (!active) {
        return finish('not_committed', 'D1:sweeper 非 active 且無 state = 別人刻意停的;abort 人工釐清(不誤開)');
      }
      stopAttempted = true; // 進場即記(alter 成功但後續步驟失敗時,恢復照樣要跑)。
      await stopSweeper({
        query: q,
        statePath: deps.statePath,
        runId,
        projectRef: deps.projectRef,
        clusterId: deps.clusterId,
        now: deps.now,
        sleep: deps.sleep,
        log,
      });
    } else {
      // dry-run 唯讀 preflight(R3-F4):三張 control-plane 表的查詢**在 dry-run 就實跑**,
      // 不留到 D1c 當天第一次見面;零 alter_job、零 state 寫入。
      const { jobId } = await locateSweeperJob(q);
      await q(DRAIN_JOB_RUNS_SQL, [jobId]);
      await q(DRAIN_HTTP_QUEUE_SQL);
      log('D1 dry-run:control-plane preflight 通過(cron.job 五元組 / job_run_details / http_request_queue 形狀)');
    }

    // 4-5. 交易 + 守門(與 DELETE 同交易;d1-guard 執行合約)。
    // 🔴 BEGIN 起整段都在 rollback fence 內(codex K2:BEGIN 後 SET/signal 失敗若不
    //    ROLLBACK,後續 sweeper 恢復會在同連線的 aborted 交易內全數失敗)。
    try {
      for (const sql of TXN_SETUP_SQL) await q(sql);
      await q(buildD1TransactionGuardSql(deps.target));

      // 6. 三組基準快照。
      for (const sql of SNAPSHOT_SQL) await q(sql);

      // 7. 鎖序(NOWAIT fence)。
      for (const [sql, n] of LOCK_SQL) {
        expectRows((await q(sql)).rows, n, `鎖序 ${sql.slice(0, 40)}…`);
      }

      // 8. 鎖畢 assert:12/9/3 + pending 逐欄 fence。
      const dist = await q(LOCKED_STATE_ASSERT_SQL);
      const byStatus = new Map(dist.rows.map((r) => [String(r.status), Number(r.n)]));
      if (byStatus.get('failed') !== 12 || byStatus.get('released') !== 9 || byStatus.get('pending') !== 3 || dist.rows.length !== 3) {
        throw new Error(`D1:待刪 attempts 分佈應 failed 12 / released 9 / pending 3,實 ${JSON.stringify(dist.rows)};abort`);
      }
      const fence = await q(PENDING_FENCE_SQL);
      if (Number(fence.rows[0]?.n) !== 0) throw new Error('D1:pending 三筆與快照逐欄不一致;abort');

      // 9. A2/A3 零引用。
      const refs = await q(A2A3_ZERO_REF_SQL);
      if (Number(refs.rows[0]?.proc_refs) !== 0 || Number(refs.rows[0]?.note_refs) !== 0) {
        throw new Error('D1:order_item_procurement / order_notes 對待刪 cohort 有引用;abort 人工釐清(不得硬刪)');
      }

      // 10. 步驟 8b:交易內 read-back(六筆斷言與 D1b1 完全相同 = 共用 judgeReadback)。
      const factRows = (await q(READBACK_FACTS_SQL)).rows;
      expectRows(factRows, 6, 'read-back 事實');
      const facts: D1AttemptFact[] = factRows.map((r) => ({
        displayId: String(r.display_id),
        orderId: String(r.order_id),
        recTradeId: r.rec_trade_id === null ? null : String(r.rec_trade_id),
        authorizedAmount: Number(r.total),
        paymentStatus: String(r.payment_status),
      }));
      // 🔴 只把「准查的五筆」交給查詢層 —— 以 displayId 排除 0101、且送出前先跑整組
      //    前提斷言(D1b1 關卡2 M1;舊寫法只擋 null,0101 被回填鍵就會被拿去查正式商戶)。
      const keyedFacts = selectFactsForQuery(facts);
      const results = await deps.runReadback(keyedFacts, abortController.signal, now() + READBACK_DEADLINE_MS);
      if (aborted) throw new Error('D1:已中止(signal);走 ROLLBACK 路');
      const auditRows = judgeReadback(facts, results);
      const verdictOf = (d: string) => auditRows.find((r) => r.displayId === d)?.verdict;

      // 11. 步驟 9:刪 attempts(RETURNING 集合 = 事先 SELECT 的 24 筆)。
      const expectedAttemptIds = (await q(EXPECTED_ATTEMPT_IDS_SQL)).rows.map((r) => String(r.id));
      if (expectedAttemptIds.length !== 24) {
        throw new Error(`D1:待刪 attempts 預查應 24 筆,實 ${expectedAttemptIds.length};abort`);
      }
      const pre = (await q(PRE_CASCADE_COUNTS_SQL)).rows[0]!;
      if (Number(pre.items) !== 36 || Number(pre.consents) !== 2) {
        throw new Error(`D1:CASCADE 前置計數應 items 36 / consents 2,實 ${pre.items}/${pre.consents};abort`);
      }
      expectIdSet((await q(DELETE_ATTEMPTS_SQL)).rows, expectedAttemptIds, '步驟 9 刪 attempts');

      // 12. 步驟 10:刪 orders(RETURNING = 26 個 cohort id 精確集合)+ CASCADE 驗證。
      expectIdSet(
        (await q(DELETE_ORDERS_SQL)).rows,
        D1_DELETE_COHORT.map(({ id }) => id),
        '步驟 10 刪 orders',
      );
      const post = (await q(POST_CASCADE_COUNTS_SQL)).rows[0]!;
      if (Number(post.items) !== 0 || Number(post.consents) !== 0) {
        throw new Error('D1:CASCADE 後 items/consents 未歸零;abort');
      }

      // 13. 步驟 11:改號(跨欄零碰撞 → 逐筆 UPDATE → 舊/新號唯一命中指定 UUID)。
      const collision = (await q(RENUMBER_COLLISION_SQL)).rows[0]!;
      if (Number(collision.new_taken) !== 0 || Number(collision.old_taken) !== 0) {
        throw new Error('D1:改號前碰撞檢查失敗(新號已被占用或舊號已在 legacy 欄);abort');
      }
      for (const { id, displayId, newDisplayId } of D1_RETAIN_COHORT) {
        const updated = (await q(RENUMBER_SQL, [id, newDisplayId, displayId])).rows;
        expectRows(updated, 1, `步驟 11 改號 ${displayId}`);
        if (updated[0]!.display_id !== newDisplayId || updated[0]!.legacy_display_id !== displayId) {
          throw new Error(`D1:改號 ${displayId} RETURNING 值不符映射;abort`);
        }
      }
      for (const { id, displayId, newDisplayId } of D1_RETAIN_COHORT) {
        const oldHit = (await q(RENUMBER_VERIFY_SQL, [displayId])).rows;
        const newHit = (await q(RENUMBER_VERIFY_SQL, [newDisplayId])).rows;
        if (oldHit.length !== 1 || String(oldHit[0]!.id) !== id || newHit.length !== 1 || String(newHit[0]!.id) !== id) {
          throw new Error(`D1:改號後 ${displayId} 舊/新號未唯一命中指定 UUID;abort`);
        }
      }

      // 14. 步驟 12:條件兩態(verdict 驅動,orchestrator 不二次判斷)。
      for (const { id, displayId } of D1_RETAIN_COHORT) {
        const v = verdictOf(displayId);
        if (displayId === 'PCM-2026-0052' && v === 'keep-original-no-hit') {
          continue; // 保持原值 + audit 註記(正式商戶查無;§8.4 R21 專屬出口)。
        }
        if (v !== 'refund-confirmed') {
          throw new Error(`D1:${displayId} verdict ${v} 不允許改 refunded;abort`);
        }
        const updated = (await q(MARK_REFUNDED_SQL, [id])).rows;
        expectRows(updated, 1, `步驟 12 ${displayId} → refunded`);
      }

      // 14b. 步驟 12 終態逐筆驗證(keep-original 的 0052 必須仍等於快照原值)。
      const payRows = (await q(PAYMENT_STATE_VERIFY_SQL)).rows;
      expectRows(payRows, 3, '步驟 12 終態驗證');
      for (const { id, displayId } of D1_RETAIN_COHORT) {
        const row = payRows.find((r) => String(r.id) === id);
        if (!row) throw new Error(`D1:${displayId} 終態驗證缺列;abort`);
        const expected =
          verdictOf(displayId) === 'keep-original-no-hit' ? String(row.snapshot_status) : 'refunded';
        if (String(row.payment_status) !== expected) {
          throw new Error(`D1:${displayId} payment_status 應 ${expected} 實 ${row.payment_status};abort`);
        }
      }

      // 15. 步驟 13:三筆 pending_invoices → voided。
      expectRows((await q(VOID_INVOICES_SQL)).rows, 3, '步驟 13 invoices → voided');

      // 16. 驗收矩陣(dry-run 與正式各驗一次同一張 —— 就是這一張)。
      for (const [sql, expected, label] of MATRIX_SQL) {
        const n = Number((await q(sql)).rows[0]?.n);
        if (n !== expected) throw new Error(`D1:矩陣「${label}」期望 ${expected} 實 ${n};abort`);
      }
      const check = (await q(CHECK_VALID_SQL)).rows[0]!;
      if (check.display_format_valid !== true || !String(check.invoices_check_def ?? '').includes("'voided'")) {
        throw new Error('D1:CHECK 驗收失敗(orders_display_id_format 非 VALID 或 invoices CHECK 缺 voided);abort');
      }

      // 17. audit 先落盤(prepared)才 COMMIT(R1-11 + R2-5)。
      const audit = {
        version: 1,
        outcome: 'prepared',
        mode: deps.mode,
        target: deps.target,
        runId,
        readback: auditRows,
        deletedOrderIds: D1_DELETE_COHORT.map(({ id }) => id),
        renumbered: D1_RETAIN_COHORT.map(({ displayId, newDisplayId }) => ({ old: displayId, new: newDisplayId })),
        finishedMatrixAt: new Date().toISOString(),
      };
      if (deps.mode === 'dry-run') {
        writeJsonAtomic(deps.auditPath, { ...audit, outcome: 'dry-run-rolled-back' });
        await q('ROLLBACK');
        return finish('not_committed', 'D1 dry-run:步驟 8-13 + 驗收矩陣全數通過,已 ROLLBACK 零寫入', auditRows);
      }
      writeJsonAtomic(deps.auditPath, audit);

      if (aborted) throw new Error('D1:已中止(signal);COMMIT 前 safe-point,走 ROLLBACK');
      commitSent = true;
      try {
        await deps.query('COMMIT');
        committed = true;
      } catch (commitErr) {
        // COMMIT 已送出但結果不明:已提交與已回滾皆有可能,舊連線不可信(R2-5)。
        const reconciled = await reconcileUnknown(deps);
        if (reconciled === 'rolled-back') {
          commitSent = false; // 對帳確認未提交 ⇒ 才允許回到可重跑語意。
          rollbackConfirmed = true;
          throw commitErr;
        }
        if (reconciled === 'committed') {
          committed = true; // 確認已提交 ⇒ 繼續收尾流程。
        } else {
          try {
            writeJsonAtomic(deps.auditPath, { ...audit, outcome: 'commit_outcome_unknown' });
          } catch (auditErr) {
            log(`D1:unknown 態 audit 改寫失敗(prepared 版仍在):${String(auditErr)}`);
          }
          return finish(
            'commit_outcome_unknown',
            'D1:🔴 COMMIT 結果不明且對帳失敗 —— 不得重跑;以唯讀連線人工確認 26 張待刪單在否,再決定下一步',
            auditRows,
          );
        }
      }
      // 🔴 COMMIT 之後的一切失敗都不得降級成可重跑(codex K2:audit 終態寫失敗原本會
      //    落到外層被回報成 not_committed —— 而資料已經刪了)。
      try {
        writeJsonAtomic(deps.auditPath, { ...audit, outcome: 'committed', committedAt: new Date().toISOString() });
        await recoverSweeper({
          query: deps.query, // 不走 q:aborted 後仍必須恢復。
          statePath: deps.statePath,
          expectedRunId: runId,
          projectRef: deps.projectRef,
          clusterId: deps.clusterId,
        });
      } catch (postCommitErr) {
        return finish(
          'committed_recovery_required',
          `D1:🔴 資料已提交,但收尾失敗(audit 終態寫入或 sweeper 恢復):${String(postCommitErr)}。跑 --recover-sweeper,不得重跑 orchestrator`,
          auditRows,
        );
      }
      return finish('completed', 'D1:apply 完成 —— 刪除/改號/狀態對齊 + 驗收矩陣全過、sweeper 已恢復', auditRows);
    } catch (txnErr) {
      // COMMIT 前任何失敗:ROLLBACK(交易死了 ROLLBACK 也只是 no-op error,吞掉)。
      if (!committed && !commitSent) {
        try {
          await deps.query('ROLLBACK');
          rollbackConfirmed = true;
        } catch {
          /* 連線已死:交易由 server 端 abort,無殘留;不宣稱「已 ROLLBACK」。 */
        }
      }
      throw txnErr;
    }
  } catch (err) {
    if (commitSent && !committed) {
      // COMMIT 已送出且未經對帳確認 ⇒ 絕不可回報成可重跑(codex K2)。
      return finish(
        'commit_outcome_unknown',
        `D1:🔴 COMMIT 已送出後發生錯誤且結果未確認:${String(err)};不得重跑,先以唯讀連線人工對帳`,
      );
    }
    // pre-commit 失敗:sweeper 恢復做完才組結果 —— 恢復失敗必須反映在 outcome,
    // 不得只寫 log 然後宣稱「已 ROLLBACK 可重跑」(codex K2)。
    const rollbackNote = rollbackConfirmed ? '已 ROLLBACK' : '交易未提交(由連線終止回滾,未逐字確認)';
    if (deps.mode === 'apply' && stopAttempted) {
      const st = readState(deps.statePath);
      if (st && st.runId === runId) {
        try {
          await recoverSweeper({
            query: deps.query,
            statePath: deps.statePath,
            expectedRunId: runId,
            projectRef: deps.projectRef,
            clusterId: deps.clusterId,
          });
        } catch (recErr) {
          return finish(
            'not_committed_recovery_required',
            `D1:未提交(${rollbackNote}),但 sweeper 恢復失敗(state 保留):${String(recErr)};先跑 --recover-sweeper 再重跑。原始錯誤:${String(err)}`,
          );
        }
      }
    }
    return finish('not_committed', `D1:未提交、${rollbackNote}:${String(err)}`);
  } finally {
    try {
      await deps.query(ADVISORY_UNLOCK_SQL);
    } catch {
      /* 連線已死 = 鎖已隨 session 釋放。 */
    }
  }
}

/** 對帳前的身分驗證:守門 DO 塊不可重用(cohort 配對 29 在已提交後必然 fail)⇒ 只驗身分三件套。 */
export const RECONCILE_IDENTITY_SQL = `SELECT (SELECT system_identifier FROM pg_control_system())::text AS cid, session_user AS su, current_database() AS db`;

/**
 * unknown 態對帳:新開唯讀連線數 26 張待刪單(R2-5;原連線不可信)。
 * 🔴 對帳前必先驗連線身分(codex K2):fresh 連線若誤連 clone 讀到 26,會把
 * 「production 已提交」誤判成 rolled-back = 可重跑 —— 身分不符一律回 unknown。
 */
async function reconcileUnknown(deps: D1OrchestratorDeps): Promise<'committed' | 'rolled-back' | 'unknown'> {
  try {
    const fresh = await deps.openFreshQuery();
    try {
      const idRow = (await fresh.query(RECONCILE_IDENTITY_SQL)).rows[0];
      // 🔴 精確比對 deps.clusterId(codex K2:rehearsal 只驗「非 production」的話,
      //    fresh 連到**另一個**隔離叢集讀 0/26 仍會誤定 committed/rolled-back)。
      if (
        String(idRow?.cid) !== deps.clusterId ||
        idRow?.su !== 'postgres' ||
        idRow?.db !== 'postgres'
      ) {
        return 'unknown';
      }
      const { rows } = await fresh.query(
        `SELECT count(*)::int AS n FROM public.orders WHERE id IN (${DELETE_IDS})`,
      );
      const n = Number(rows[0]?.n);
      if (n === 26) return 'rolled-back';
      if (n === 0) return 'committed';
      return 'unknown';
    } finally {
      await fresh.close();
    }
  } catch {
    return 'unknown';
  }
}
