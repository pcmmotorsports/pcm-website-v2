/**
 * @module @pcm/adapters/payment/PgAnomalyAlertReaderAdapter — 雙扣 anomaly 告警聚合讀主軌(M-3 #250)
 *
 * **🔴 server-only + payment_confirmer 窄權**(同 PgReleaseSiblingAdapter:持 `PAYMENT_CONFIRMER_DB_URL`、
 * pg 不污染 root barrel;連線安全完全複用 `buildPgConfig`〔session pooler + 完整 CA 驗證 + host 釘死 +
 * 顯式 servername〕;per-request `new Client()` + `finally end()`)。
 *
 * 呼 owner-defined SECDEF 聚合 RPC `get_payment_anomaly_alert_summary(p_refunding_stuck_seconds,
 * p_pending_dc_window_seconds, p_pending_dc_stuck_seconds)`(#250 六計數 + #256 第 7 計數)
 * → 回 jsonb `{open_count,refunding_count,refunding_stuck_count,oldest_open_age_seconds,
 * attempt_manual_review_count,released_stuck_count,pending_double_charge_candidate_count}`
 * (計數;payment_confirmer 對 anomaly 兩表 / attempts / orders 零表權、只能經此 SECDEF 受控窗讀)
 * **以及** `get_payment_anomaly_alert_display_ids` 回的**五個訂單單號陣列**。
 * 🔴 **2026-08-24(F-004)起還有第三支** `get_order_refunds_stuck_summary()`(零參數)——
 *    退款卡住計數,分母是 `order_refunds`,與上面那支的 `refunding_stuck_count`【不同表】。
 * 🔴 ~~原句「零 PII 計數」~~ 2026-08-19 作廢:**本層現在會下放訂單單號**,
 *    那道閘是 Sean 本人拍板打開的(理由與代價見 `packages/use-cases/src/check-anomaly-alerts.ts` 檔頭)。
 * 本層把 DB snake_case 映射成 domain camelCase。
 *
 * 錯誤紀律(對齊 PgReleaseSiblingAdapter):不轉傳 pg 原始 message;throw 通用訊息 + 安全 SQLSTATE `code`
 * 屬性(零 PII/token)。本 RPC 唯讀不 RAISE 業務拒絕;throw 僅 transport/parse。
 *
 * @see supabase/migrations/20260701120000_m3_250_anomaly_alert_summary.sql
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
 */
import 'server-only';

import { Client } from 'pg';
import type { IAnomalyAlertReader } from '@pcm/ports';
import type { AnomalyAlertSummary } from '@pcm/domain';
import { buildPgConfig, type PgClientLike } from './PaymentConfirmerAdapter';

/** 帶安全 SQLSTATE 的告警讀錯誤(message 通用、code 供分類;零 pg 原文/token)。 */
export type AnomalyAlertReaderError = Error & { code?: string };

/** 本層 RPC 回應解析錯誤(branded:sanitizeError 憑類別放行、不靠「無 code」啟發式)。 */
class AnomalyAlertReaderParseError extends Error {}

/**
 * PostgreSQL `undefined_function`。
 * 🔴 **這是唯一一個會被降級成「沒有單號」的錯誤碼**,理由見 `getAlertSummary` 內那段。
 *    值的來源 = PostgreSQL 官方 Appendix A「PostgreSQL Error Codes」Class 42。
 */
const UNDEFINED_FUNCTION = '42883';

function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client(buildPgConfig(connectionString)) as unknown as PgClientLike;
}

export class PgAnomalyAlertReaderAdapter implements IAnomalyAlertReader {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  async getAlertSummary(
    refundingStuckSeconds: number,
    pendingDcWindowSeconds: number,
    pendingDcStuckSeconds: number,
  ): Promise<AnomalyAlertSummary> {
    return this.run(async (client) => {
      const args = [refundingStuckSeconds, pendingDcWindowSeconds, pendingDcStuckSeconds];
      const counts = await client.query(
        'SELECT public.get_payment_anomaly_alert_summary($1::integer, $2::integer, $3::integer) AS result',
        args,
      );

      /**
       * 🔴 **單號走【另一支】函式,而不是併進上面那支** ——
       *    那支 summary RPC 有四代定義散在四支 migration 裡,重貼整支會安靜倒退兩代
       *    (成因與實錘寫在 `supabase/migrations/20260819130000_…display_ids.sql` 檔頭)。
       *
       * 🔴 **只有「函式不存在」(SQLSTATE `42883`)才降級成空陣列。**
       *    那是**部署窗口**:程式先上、migration 還沒 apply。此時 throw ⇒ 整支告警 503
       *    ⇒ **雙扣告警在那段時間完全停掉**,比「訊息裡少了單號」嚴重得多。
       *    ⚠️ **其餘錯誤一律上拋**,特別是 `42501`(權限被收走)——
       *       那不是部署窗口,那是有人把受控窗關掉了,**必須吵**。
       *       把它一起吞掉的話,「我們拿不到單號」會被讀成「今天沒有單號」。
       */
      let ids: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_payment_anomaly_alert_display_ids($1::integer, $2::integer, $3::integer) AS result',
          args,
        );
        ids = res.rows;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        // 🔴🔴 **`42883` 不等於「我們那支函式不存在」**(codex R2 must-fix):
        //    函式**存在**、而它的**函式體**裡少了某個 helper/operator,PG 回的是**同一個碼**。
        //    照碼降級 ⇒ 一支壞掉的函式會被安靜地讀成「今天沒有單號」,而它不會自己好。
        //    ⇒ 再問一次「它到底在不在」:`to_regprocedure` 回 NULL 才是真的不存在(=部署窗口)。
        //      回得出 oid ⇒ 那個 42883 來自**函式內部** ⇒ **原封上拋**。
        //    ⚠️ 這一發只在錯誤路徑跑,正常情況零成本。
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_payment_anomaly_alert_display_ids(integer,integer,integer)') IS NULL AS missing",
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
      }

      /**
       * 🔴 **F-004 第三支 RPC:退款卡住計數(分母 `order_refunds`)。**
       *
       * 為什麼是【另一支函式】而不是把 key 加進上面那支 summary:
       * 那支的定義散在四支 migration,而 `20260810220000` 檔內有**四顆 pre-image md5
       * fail-closed 閘 + 三道 post-image prosrc 指紋**在守它;同簽章重貼可能**安靜撤回**
       * `L5b-0-s` 的最新述詞,而新 key 照常出現、型別過、ACL 過、三綠過。
       * ⇒ 而走那條路要 live pre-image md5,施工窗零 DB access ⇒ **做不到那道驗證。**
       *    「我做不到那道驗證」本身就是選路的理由,不只是風險。
       *
       * 降級**逐字沿用上面 display_ids 那一條**(不是新發明的):
       *   `42883` → `to_regprocedure` 複查 → 真的不存在 ⇒ unknown(部署窗口)
       *   `42883` 而 oid 回得出來 ⇒ **原封上拋**(函式體壞了,必須吵)
       *   `42501`(權限被收走)⇒ **原封上拋**
       * 🔴 而 unknown **不寫成 0** —— `null` 與 `0` 在信上要印不同的字。
       */
      let refundRows: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_order_refunds_stuck_summary() AS result',
          [],
        );
        refundRows = res.rows;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_order_refunds_stuck_summary()') IS NULL AS missing",
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
      }

      return parseAlertSummary(counts.rows, ids, refundRows);
    });
  }

  /** per-request 連線生命週期(connect → op → finally end;end throw 吞掉不蓋主錯誤)。 */
  private async run<T>(op: (client: PgClientLike) => Promise<T>): Promise<T> {
    let client: PgClientLike | undefined;
    try {
      client = this.clientFactory(this.connectionString);
      await client.connect();
      return await op(client);
    } catch (err) {
      throw sanitizeError(err);
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          /* swallow:連線已斷時 end 可能 throw、不蓋過主錯誤 */
        }
      }
    }
  }
}

/** F-004 那支 RPC 的名字(錯誤訊息要指對地方 —— 見 `parseCount` 的 `fn`)。 */
const REFUNDS_FN = 'get_order_refunds_stuck_summary';

/**
 * 非負整數解析(count 欄;非有限/負 → throw fail-closed)。
 *
 * 🔴 `fn` 必須帶,而它是 F-004 當場修的一個**指錯地方的錯誤訊息**:
 *    原本函式名寫死成 `get_payment_anomaly_alert_summary`,而退款那支 RPC 的欄位壞掉時
 *    訊息會說「**get_payment_anomaly_alert_summary** 計數欄 order_refunds_stuck_count 異常」
 *    ⇒ **值班的人會去查一支根本沒問題的函式。**
 *    📌 那不是假綠,是**紅在對的時候、指向錯的地方** —— 一樣會浪費掉那個晚上。
 */
function parseCount(v: unknown, field: string, fn = 'get_payment_anomaly_alert_summary'): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new AnomalyAlertReaderParseError(`${fn} 計數欄 ${field} 異常`);
  }
  return n;
}

/**
 * 單號陣列解析(2026-08-19 片)。
 *
 * 🔴 **缺鍵 → 回 `[]`,不 throw** —— 刻意的,理由是**部署順序**:
 *    程式先上、migration 後 apply 的那個窗口裡,舊版 RPC 回不出這五個鍵。
 *    此時 throw ⇒ 整支告警 503 ⇒ **雙扣告警在那段時間完全停掉**,
 *    比「訊息裡少了單號」嚴重得多 ⇒ 缺鍵 = 降級回舊行為(只講筆數)。
 * 🔴 **而【有鍵但形狀錯】仍然 throw** —— 那不是部署窗口,那是 RPC 壞了。
 *    兩者在 `undefined` 與「非字串陣列」上分得開,**不要合併成一個 catch-all**。
 */
function parseDisplayIds(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    // 🔴 訊息要指向**真正出問題的那支** —— 單號來自 `…_display_ids`,寫成 summary 會讓
    //    接手的人去查錯的函式(關卡2 nit)。
    throw new AnomalyAlertReaderParseError(`get_payment_anomaly_alert_display_ids 單號欄 ${field} 異常`);
  }
  return v as string[];
}

/** 配對陣列解析(`[[單號A, 單號B], …]`);缺鍵/形狀規則同 `parseDisplayIds`。 */
function parseDisplayIdPairs(v: unknown, field: string): Array<[string, string]> {
  if (v === undefined || v === null) return [];
  if (
    !Array.isArray(v) ||
    v.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== 'string'))
  ) {
    throw new AnomalyAlertReaderParseError(`get_payment_anomaly_alert_display_ids 配對欄 ${field} 異常`);
  }
  return v as Array<[string, string]>;
}

/**
 * 解析告警聚合 jsonb → domain camelCase;形狀不符 → throw(通用、fail-closed)。
 *
 * 🔴 **計數與單號來自【兩支不同的函式、兩次查詢】** ⇒ 兩次之間資料可能變動
 *    ⇒ `count` 與陣列長度**可以不一致,而那是預期不是故障**。
 *    ⇒ 這裡**不做兩者一致性的斷言** —— 那會把一個正常的競態變成半夜的 503。
 *      對得起不起來的檢查放在 **migration 的 apply 期斷言**(那一刻是靜態的、有判別力)。
 */
function parseAlertSummary(
  rows: Array<Record<string, unknown>>,
  idRows: Array<Record<string, unknown>>,
  refundRows: Array<Record<string, unknown>>,
): AnomalyAlertSummary {
  const r = rows[0]?.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') {
    throw new AnomalyAlertReaderParseError('get_payment_anomaly_alert_summary 回應格式異常');
  }
  // 🔴 `idRows` 為空 = 上面那支函式還不存在(部署窗口)⇒ 五個欄位各自降級成 `[]`。
  const d = (idRows[0]?.result ?? {}) as Record<string, unknown>;
  // oldest_open_age_seconds:無 open → null(合法);有值 → 非負整數。
  const rawOldest = r.oldest_open_age_seconds;
  let oldestOpenAgeSeconds: number | null;
  if (rawOldest === null || rawOldest === undefined) {
    oldestOpenAgeSeconds = null;
  } else {
    const n = typeof rawOldest === 'number' ? rawOldest : Number(rawOldest);
    if (!Number.isFinite(n) || n < 0) {
      throw new AnomalyAlertReaderParseError('get_payment_anomaly_alert_summary oldest_open_age_seconds 異常');
    }
    oldestOpenAgeSeconds = Math.floor(n);
  }
  /**
   * F-004:`refundRows` 為空 = 那支 RPC 還不存在(部署窗口)⇒ unknown、兩個計數 `null`。
   * 🔴 **有回應但缺鍵、或型別不對 ⇒ 走 `parseCount` 的 fail-closed 上拋**,不當成 unknown ——
   *    「函式不在」與「函式回了垃圾」是兩件事,後者必須吵(codex R1 N9)。
   */
  /**
   * 🔴🔴 **`undefined` 與 `null` 是兩個世界,而我第一版把它們合成一個**(code-reviewer 抓的)。
   * ```
   * refundRows = []          ⇒ rf === undefined ⇒ 我們【根本沒拿到那一列】= 函式不存在(部署窗口)
   * { result: null }         ⇒ rf === null      ⇒ 函式【存在而且跑了】, 只是回了 SQL NULL
   * ```
   * 合成一個的後果:函式明明 apply 了、只是回 NULL ⇒ route 會印「**尚未 apply**」
   * ⇒ 🔴 **值班的人跑去查 migration 有沒有 apply, 而它 apply 了** —— 紅在對的時候、指向錯的地方,
   *    正是同檔 `parseCount` 的 `fn` 參數在防的那件事。
   * ⇒ `null` 走 fail-closed 上拋:「函式不在」與「函式回了垃圾」是兩件事,而 NULL 屬後者。
   */
  const rf = refundRows[0]?.result as Record<string, unknown> | null | undefined;
  const orderRefundsStuckUnknown = rf === undefined;
  if (!orderRefundsStuckUnknown && (rf === null || typeof rf !== 'object')) {
    throw new AnomalyAlertReaderParseError(`${REFUNDS_FN} 回應格式異常(函式存在但回了 NULL 或非物件)`);
  }

  return {
    openCount: parseCount(r.open_count, 'open_count'),
    refundingCount: parseCount(r.refunding_count, 'refunding_count'),
    refundingStuckCount: parseCount(r.refunding_stuck_count, 'refunding_stuck_count'),
    orderRefundsStuckCount: orderRefundsStuckUnknown
      ? null
      : parseCount(rf!.order_refunds_stuck_count, 'order_refunds_stuck_count', REFUNDS_FN),
    orderRefundsStuckOvernightCount: orderRefundsStuckUnknown
      ? null
      : parseCount(
          rf!.order_refunds_stuck_overnight_count,
          'order_refunds_stuck_overnight_count',
          REFUNDS_FN,
        ),
    orderRefundsManualFailedCount: orderRefundsStuckUnknown
      ? null
      : parseCount(rf!.order_refunds_manual_failed_count, 'order_refunds_manual_failed_count', REFUNDS_FN),
    orderRefundsStuckUnknown,
    oldestOpenAgeSeconds,
    attemptManualReviewCount: parseCount(r.attempt_manual_review_count, 'attempt_manual_review_count'),
    releasedStuckCount: parseCount(r.released_stuck_count, 'released_stuck_count'),
    pendingDoubleChargeCandidateCount: parseCount(
      r.pending_double_charge_candidate_count,
      'pending_double_charge_candidate_count',
    ),
    openDisplayIds: parseDisplayIds(d.open_display_ids, 'open_display_ids'),
    refundingStuckDisplayIds: parseDisplayIds(
      d.refunding_stuck_display_ids,
      'refunding_stuck_display_ids',
    ),
    attemptManualReviewDisplayIds: parseDisplayIds(
      d.attempt_manual_review_display_ids,
      'attempt_manual_review_display_ids',
    ),
    releasedStuckDisplayIds: parseDisplayIds(
      d.released_stuck_display_ids,
      'released_stuck_display_ids',
    ),
    pendingDoubleChargeDisplayIdPairs: parseDisplayIdPairs(
      d.pending_double_charge_display_id_pairs,
      'pending_double_charge_display_id_pairs',
    ),
  };
}

/** pg 錯誤淨化:本層 parse 錯誤原樣放行(已通用);其餘只回通用訊息 + 安全 SQLSTATE code。 */
function sanitizeError(err: unknown): AnomalyAlertReaderError {
  if (err instanceof AnomalyAlertReaderParseError) {
    return err; // 本層 throw(已通用、無 pg 原文/token)
  }
  const code = (err as { code?: unknown } | null)?.code;
  const e: AnomalyAlertReaderError = new Error(
    `anomaly 告警聚合讀失敗(${typeof code === 'string' ? code : 'transport'})`,
  );
  if (typeof code === 'string') {
    e.code = code;
  }
  return e;
}
