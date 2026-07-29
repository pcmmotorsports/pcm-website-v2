/**
 * D1t3 負測①:`idle_in_transaction_session_timeout` 逾時後,交易確實 rollback、不留半掛交易。
 *
 * 🔴 用的是 orchestrator **真正的** `TXN_SETUP_SQL`(不重抄一份 SET LOCAL）——
 * 這一片要驗的就是那個常數在真 PostgreSQL 上的行為,抄一份等於驗自己。
 * 等待長度也從那個常數推導(`--idle-seconds auto`),不讓 harness 另抄一個 330。
 *
 * 流程:連線(走 CLI 同一支 `buildRehearsalPgConfig`)→ 跑 TXN_SETUP_SQL
 *   → 做一筆**真的會被看見**的寫入(刪掉誘餌 email_outbox 那一列)→ 閒置 N 秒
 *   → 再送一句 SQL,看連線是否已被 server 砍掉。
 *
 * 🔴 `terminated` 的定義 = **那句 `SELECT 1` 真的 throw**(code-reviewer must-fix 3)。
 * 舊版只要閒置期間收到任何非同步 'error' 就回 true,連線其實還活著、交易還開著,
 * 而 harness 後續三條斷言全部攔不到(digest 看不到未提交的 DELETE;兩條殘留檢查
 * 都在探針 process 收完線之後才查)⇒ 那是一條走得通的假綠路徑。
 *
 * 消融用 `--override-idle <值>`:在真的 TXN_SETUP_SQL **之後**再蓋一句 SET LOCAL
 * (不動原常數)。`--override-idle 0` = 關閉逾時 ⇒ **同樣長度**的閒置應存活;
 * 存活這件事才證明前一段的終止來自那個設定(消融必須等一樣久,否則證的是別的東西)。
 *
 * stdout = 單行 JSON(harness 判定);本程式自身除參數錯誤外一律 exit 0。
 */
import { buildRehearsalPgConfig } from './d1-orchestrator-cli';
import { TXN_SETUP_SQL } from './d1-orchestrator';

export type D1IdleProbeResult = Readonly<{
  /** 唯一判準:閒置後那句 SELECT 1 是否真的 throw。 */
  terminated: boolean;
  /** 診斷用:閒置期間是否收到非同步 'error'(不參與 terminated 判定)。 */
  asyncErrorSeen: boolean;
  /** 量測值(非字面):證明閒置期間交易裡真的掛著一筆未提交的寫入。 */
  deletedRows: number;
  idleSeconds: number;
  /**
   * 🔴 **server 送來的**那個錯誤(非同步 FATAL)—— 這才帶得出 `25P03 idle-in-transaction`。
   * 閒置期間連線就死了,之後那句 `SELECT 1` 只會拿到 pg 客戶端自己的泛用訊息
   * (`Client has encountered a connection error…`、無 code)⇒ 若用它當證據,
   * 「為什麼被砍」這件事就消失了。兩個都留、不互相覆蓋。
   */
  errorCode: string | null;
  errorMessage: string | null;
  /** 客戶端層的訊息(診斷用,不列入證據)。 */
  queryErrorMessage: string | null;
}>;

/** 從 orchestrator 的 SET LOCAL 字面推導該等多久(+30 秒餘裕);停用時退回固定長度。 */
export function idleWaitSecondsFromSetup(): number {
  const m = TXN_SETUP_SQL.join('\n').match(/idle_in_transaction_session_timeout = '(\d+)(ms|s|min)?'/);
  if (!m) throw new Error('D1t3:TXN_SETUP_SQL 找不到 idle_in_transaction_session_timeout 字面');
  const unit = { ms: 0.001, s: 1, min: 60 }[(m[2] ?? 'ms') as 'ms' | 's' | 'min'];
  const secs = Number(m[1]) * unit;
  // 0 = 停用(M5b 突變的情形):仍要等夠久才有資格說「它沒被砍」。
  return (secs > 0 ? Math.ceil(secs) : 300) + 30;
}

function parseArgs(argv: readonly string[]): { idleSeconds: number; overrideIdle: string | null } {
  let idleRaw: string | null = null;
  let overrideIdle: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--idle-seconds') {
      idleRaw = argv[++i] ?? null;
    } else if (a === '--override-idle') {
      overrideIdle = argv[++i] ?? null;
    } else {
      throw new Error(`未知參數 '${a}'`);
    }
  }
  if (idleRaw === null) throw new Error("--idle-seconds 必填(數字或 'auto')");
  const idleSeconds = idleRaw === 'auto' ? idleWaitSecondsFromSetup() : Number(idleRaw);
  if (!Number.isFinite(idleSeconds) || idleSeconds <= 0) throw new Error(`--idle-seconds 不合法:'${idleRaw}'`);
  if (overrideIdle !== null && !/^[0-9]+(ms|s|min)?$/.test(overrideIdle)) {
    throw new Error(`--override-idle 值形狀不合法:'${overrideIdle}'`);
  }
  return { idleSeconds, overrideIdle };
}

export async function runIdleProbe(
  dbUrl: string,
  idleSeconds: number,
  overrideIdle: string | null,
): Promise<D1IdleProbeResult> {
  const { Client } = await import('pg');
  const client = new Client(buildRehearsalPgConfig(dbUrl));
  // 🔴 server 端 FATAL 是**非同步**送達的:閒置期間沒有 in-flight query,pg 會把它丟成
  //    client 的 'error' 事件。沒有 listener ⇒ EventEmitter 直接拋成未攔截例外、
  //    探針 process 當場死掉,harness 只會看到「探針壞了」而不是「逾時被驗到」。
  let asyncError: { code?: string; message?: string } | null = null;
  client.on('error', (err: { code?: string; message?: string }) => {
    asyncError ??= err;
  });
  await client.connect();
  try {
    for (const sql of TXN_SETUP_SQL) await client.query(sql);
    if (overrideIdle !== null) {
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${overrideIdle}'`);
    }
    // 真寫入:誘餌那一列在 harness 的 digest 裡,rollback 與否外部看得見。
    const deleted = await client.query('DELETE FROM public.email_outbox RETURNING id');
    const deletedRows = deleted.rows.length;
    if (deletedRows !== 1) {
      throw new Error(`D1t3:探針前提不成立 —— email_outbox 應恰 1 列,實 ${deletedRows}`);
    }
    await new Promise((r) => setTimeout(r, idleSeconds * 1000));
    let probeError: { code?: string; message?: string } | null = null;
    let terminated = false;
    try {
      await client.query('SELECT 1');
    } catch (err) {
      terminated = true;
      probeError = err as { code?: string; message?: string };
    }
    // server 的 FATAL 優先(它才有 SQLSTATE);客戶端訊息另外留一欄,不覆蓋它。
    const surfaced = asyncError ?? probeError;
    return {
      terminated,
      asyncErrorSeen: asyncError !== null,
      deletedRows,
      idleSeconds,
      errorCode: surfaced?.code ?? null,
      errorMessage: surfaced?.message ?? null,
      queryErrorMessage: probeError?.message ?? null,
    };
  } finally {
    // 連線若已被 server 砍掉,end() 本身可能 throw —— 吞掉,判定看回傳值。
    await client.end().catch(() => {});
  }
}

if (process.argv[1]?.endsWith('d1t3-idle-timeout-probe.ts')) {
  const dbUrl = process.env.D1_DB_URL;
  if (!dbUrl) {
    console.error('D1t3 探針:缺 D1_DB_URL');
    process.exit(2);
  }
  const { idleSeconds, overrideIdle } = parseArgs(process.argv.slice(2));
  runIdleProbe(dbUrl, idleSeconds, overrideIdle)
    .then((r) => {
      console.log(JSON.stringify(r));
      process.exit(0);
    })
    .catch((err) => {
      console.error(`D1t3 探針:未攔截錯誤:${String(err)}`);
      process.exit(1);
    });
}
