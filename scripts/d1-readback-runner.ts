/**
 * D1t2:`runReadback` 的兩個實作 —— 真 TapPay 版(production)與 fixture 版(rehearsal)。
 *
 * 🔴 介面合約(d1-orchestrator.ts deps.runReadback JSDoc):只收五筆有鍵 facts、
 * 必須以 `fact.recTradeId` 為查詢鍵逐筆對應 —— 0052 的零命中出口在判定層驗不到
 * 「查的鍵對不對」,鍵綁錯會靜默落成「正式商戶查無」⇒ 本檔測試斷言 fetch body 的
 * `rec_trade_id === fact.recTradeId`。
 *
 * 🔴 fixture 版(rehearsal 專用;production 帶 fixture = CLI 層拒收):
 * - key set 必須恰等於五筆 keyed displayId(0101 出現 = 拒 —— 無鍵單物理上不進查詢層);
 * - 每筆過 `assertStrictRecordWire` + `parseTapPayRecordResponse` + `assertRecordsMerchant`
 *   (假資料不得比正式路徑寬鬆);merchant 基準 = fixture 檔內自帶的 `merchantId` 宣告
 *   (形狀紀律、非身分證明)。
 */
import { readFileSync } from 'node:fs';

import type { TapPayRecordResponseWire } from '../packages/adapters/src/tappay/wire';
import { parseTapPayRecordResponse } from '../packages/adapters/src/tappay/wire';
import {
  judgeReadback,
  selectFactsForQuery,
  SEAN_ATTESTED_NOTE,
  type D1AttemptFact,
  type D1KeyedAttemptFact,
  type D1ReadbackAuditRow,
} from './d1-readback';
import {
  READBACK_DEADLINE_MS,
  READBACK_FACTS_SQL,
  RECONCILE_IDENTITY_SQL,
  type D1Target,
} from './d1-orchestrator';
import { writeJsonAtomic, type D1QueryExecutor } from './d1-sweeper-control';
import {
  assertRecordsMerchant,
  assertStrictRecordWire,
  describeRawShape,
  queryRecordByRecTradeId,
  type D1RawShape,
  type D1RawShapeSink,
  type D1TapPayClientConfig,
  type FetchLike,
} from './d1-tappay-client';

export type D1RunReadback = (
  facts: readonly D1KeyedAttemptFact[],
  abortSignal: AbortSignal,
  deadlineAt: number,
) => Promise<ReadonlyMap<string, TapPayRecordResponseWire>>;

/** 真 TapPay 版:五筆逐筆查(共享 deadline 與 abort signal;任何 throw = 整批 abort、不重試)。 */
export function makeLiveReadback(
  config: D1TapPayClientConfig,
  fetchImpl?: FetchLike,
  onRawShape?: D1RawShapeSink,
): D1RunReadback {
  return async (facts, abortSignal, deadlineAt) => {
    const results = new Map<string, TapPayRecordResponseWire>();
    for (const fact of facts) {
      const wire = await queryRecordByRecTradeId(config, fact.recTradeId, {
        deadlineAt,
        abortSignal,
        fetchImpl,
        onRawShape,
      });
      results.set(fact.displayId, wire);
    }
    return results;
  };
}

export type D1ReadbackFixture = Readonly<{
  /** fixture 的商戶宣告 —— 每筆 record 的 merchant_id 必須等於它(形狀紀律)。 */
  merchantId: string;
  /** displayId → Record API raw 回應(過 strict wire 檢查與 parser 的原始形狀)。 */
  responses: Readonly<Record<string, unknown>>;
}>;

/** fixture 版:讀檔驗形狀;key set 恰等於五筆 keyed facts。 */
export function makeFixtureReadback(fixturePath: string, onRawShape?: D1RawShapeSink): D1RunReadback {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as D1ReadbackFixture;
  if (!fixture.merchantId || typeof fixture.responses !== 'object' || fixture.responses === null) {
    throw new Error('D1:readback fixture 缺 merchantId 或 responses;拒繼續');
  }
  return async (facts) => {
    const fixtureKeys = Object.keys(fixture.responses).sort();
    const factKeys = facts.map((f) => f.displayId).sort();
    if (fixtureKeys.join() !== factKeys.join()) {
      throw new Error(
        `D1:fixture key set(${fixtureKeys.join(',')})必須恰等於五筆有鍵單(${factKeys.join(',')});拒繼續`,
      );
    }
    const results = new Map<string, TapPayRecordResponseWire>();
    for (const fact of facts) {
      const raw = fixture.responses[fact.displayId];
      onRawShape?.(fact.recTradeId, describeRawShape(raw));
      assertStrictRecordWire(raw);
      const wire = parseTapPayRecordResponse(raw);
      assertRecordsMerchant(wire, fixture.merchantId);
      results.set(fact.displayId, wire);
    }
    return results;
  };
}

// ── D1b1:證據包(唯讀;不開交易、不鎖任何列、不動 cron)──────────────────────

/**
 * D1b1 = 「憑什麼刪」的取證片。**與 D1c 步驟 8b 共用 `judgeReadback`**,兩處不得各自實作。
 *
 * 🔴 為什麼不借用 `--dry-run`:dry-run 的 read-back 跑在 `REPEATABLE READ` 交易內,
 * 會對 29 張正式站 orders `FOR UPDATE`、對 attempts `FOR UPDATE NOWAIT` ——
 * 取證不該付演練刪除的代價,而且撞上並發結帳整批 abort。本函式只跑兩句 SELECT。
 *
 * ⚠️ 誠實邊界(關卡2 N7):「不開交易、不鎖列」是**這兩句就是全部**,不是有機制擋著。
 * 兩句 autocommit SELECT 仍會取 ACCESS SHARE(與 DDL 互卡,但不鎖列)。
 * 真要機制化得發 `SET default_transaction_read_only = on`;目前沒發,別讀成有閘。
 *
 * 🔴 判定失敗**照樣落證據檔**(§8.7 施工必做:`0`/`4` 出現 = 保留 cohort、**輸出證據**、
 * 停下等 Sean)。把證據跟著例外一起丟掉,等於逼下一輪重打一次正式商戶的查詢。
 *
 * 🔴 身分閘先於一切:連錯庫撈到的六筆事實會產出一份看起來完全正常、卻毫無效力的證據包。
 */
export type D1ReadbackEvidenceDeps = Readonly<{
  target: D1Target;
  query: D1QueryExecutor;
  runReadback: D1RunReadback;
  /** 證據檔絕對路徑(原子落盤;CLI 層負責 0700 目錄與拒覆蓋)。 */
  evidencePath: string;
  clusterId: string;
  /**
   * 🔴 這次查詢**打的是誰**(關卡2 M2):0052 的 `keep-original-no-hit` 判決,全部效力
   * 來自「查的是正式商戶」。證據包只寫 target/clusterId 的話,env 的 merchant id 若是
   * 別的商戶,產出的證據長得完全正常卻證不了任何事。**Partner Key 絕不入檔。**
   */
  queryContext: Readonly<{ merchantId: string; endpoint: string }>;
  /** D1b1 首跑須落的原始回應形狀(鍵名與計數,零欄位值);由 CLI 綁進 runReadback。 */
  rawShapes?: ReadonlyMap<string, D1RawShape>;
  now?: () => number;
  log?: (m: string) => void;
  /** signal 掛載點(測試注入;預設 process)。 */
  processLike?: Pick<NodeJS.Process, 'on' | 'off'>;
}>;

export type D1ReadbackEvidenceResult = Readonly<{
  outcome: 'readback-ok' | 'readback-aborted';
  message: string;
  rows?: readonly D1ReadbackAuditRow[];
}>;

export async function runD1ReadbackEvidence(
  deps: D1ReadbackEvidenceDeps,
): Promise<D1ReadbackEvidenceResult> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.error(m));
  const proc = deps.processLike ?? process;

  const envelope = (extra: Record<string, unknown>) => ({
    version: 1,
    kind: 'd1b1-readback-evidence',
    target: deps.target,
    clusterId: deps.clusterId,
    queryContext: deps.queryContext,
    generatedAt: new Date().toISOString(),
    ...extra,
  });
  /** 0101 那筆的判定完全不依賴 TapPay ⇒ abort 版證據照樣寫得出它(§8.7 施工必做 1)。 */
  const attestedRow: D1ReadbackAuditRow = {
    displayId: 'PCM-2026-0101',
    verdict: 'sean-attested-no-key',
    evidenceLevel: 'sean-attested',
    recTradeId: null,
    recordStatus: null,
    amount: null,
    refundedAmount: null,
    transactionTimeMillis: null,
    note: SEAN_ATTESTED_NOTE,
  };
  const shapes = () => Object.fromEntries(deps.rawShapes ?? new Map());

  const id = (await deps.query(RECONCILE_IDENTITY_SQL)).rows[0];
  if (String(id?.cid) !== deps.clusterId || id?.su !== 'postgres' || id?.db !== 'postgres') {
    return {
      outcome: 'readback-aborted',
      message: `D1b1:連線的叢集/身分與目標不符(cid=${String(id?.cid)});未查 TapPay、未產證據`,
    };
  }

  const factRows = (await deps.query(READBACK_FACTS_SQL)).rows;
  if (factRows.length !== 6) {
    return {
      outcome: 'readback-aborted',
      message: `D1b1:read-back 事實應 6 筆,實 ${factRows.length};未查 TapPay、未產證據`,
    };
  }
  const facts: D1AttemptFact[] = factRows.map((r) => ({
    displayId: String(r.display_id),
    orderId: String(r.order_id),
    recTradeId: r.rec_trade_id === null ? null : String(r.rec_trade_id),
    authorizedAmount: Number(r.total),
    paymentStatus: String(r.payment_status),
  }));
  // 🔴 共用查詢層入口閘(關卡2 M1):以 displayId 排除 0101,且送出任何 HTTP 之前
  //    先跑整組前提斷言。與 D1c 步驟 8b 同一支,不各自 filter。
  let keyed: readonly D1KeyedAttemptFact[];
  try {
    keyed = selectFactsForQuery(facts);
  } catch (err) {
    return {
      outcome: 'readback-aborted',
      message: `D1b1:cohort 前提斷言失敗(未查 TapPay、未產證據):${String(err)}`,
    };
  }
  log(`D1b1:六筆事實已讀取,其中 ${keyed.length} 筆有 rec_trade_id 進查詢層`);

  // Ctrl-C 打在三分鐘批次中間也要把 signal 接到每一次 fetch,並照樣落證據 ——
  // 否則已完成的正式商戶查詢全丟,下一輪得重打一次(關卡2 N3)。
  const controller = new AbortController();
  const onSignal = () => controller.abort(new Error('D1b1:收到中止訊號'));
  proc.on('SIGINT', onSignal);
  proc.on('SIGTERM', onSignal);

  let results: ReadonlyMap<string, TapPayRecordResponseWire>;
  try {
    results = await deps.runReadback(keyed, controller.signal, now() + READBACK_DEADLINE_MS);
  } catch (err) {
    writeJsonAtomic(
      deps.evidencePath,
      envelope({
        outcome: 'readback-aborted',
        stage: 'query',
        error: String(err),
        facts,
        readback: [attestedRow],
        responseShapes: shapes(),
      }),
    );
    return {
      outcome: 'readback-aborted',
      message: `D1b1:TapPay 查詢階段失敗(不重試);證據已落 ${deps.evidencePath}:${String(err)}`,
    };
  } finally {
    proc.off('SIGINT', onSignal);
    proc.off('SIGTERM', onSignal);
  }

  // 🔴 命名誠實(關卡2 M3):這是 parser 白名單窄化**之後**的物件,不是 raw。
  //    零命中到底是「缺 trade_records 鍵」還是「空陣列」在這裡已經看不出來 ——
  //    那件事由 responseShapes 保存。
  const parsedResults = Object.fromEntries([...results.entries()]);
  try {
    const rows = judgeReadback(facts, results);
    writeJsonAtomic(
      deps.evidencePath,
      envelope({
        outcome: 'readback-ok',
        readback: rows,
        facts,
        parsedResults,
        responseShapes: shapes(),
      }),
    );
    return {
      outcome: 'readback-ok',
      message: `D1b1:六筆判定全數成立,證據已落 ${deps.evidencePath}`,
      rows,
    };
  } catch (err) {
    // 🔴 判定 abort 也要留證據(§8.7:出現 0/4 = 保留 cohort、輸出證據、停下等 Sean)。
    writeJsonAtomic(
      deps.evidencePath,
      envelope({
        outcome: 'readback-aborted',
        stage: 'judge',
        error: String(err),
        facts,
        readback: [attestedRow],
        parsedResults,
        responseShapes: shapes(),
      }),
    );
    return {
      outcome: 'readback-aborted',
      message: `D1b1:判定 abort(保留 cohort、停下等 Sean);證據已落 ${deps.evidencePath}:${String(err)}`,
    };
  }
}
