'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { readSingleString } from '../forms/single-value';
import { authorizeAdminMutation } from '../session/authorize';
import { TapPayConfigError, getTapPayAdapter } from './composition';
import { REFUND_RECORD_QUERY_TIMEOUT_MS } from './refund-baseline';
import { REFUND_EXCEPTION_STALL_MS } from './refund-ledger-view';
import {
  RESOLUTION_REQUIRED_VERDICT,
  judgeRefundRecovery,
  type RefundRecoveryJudgment,
} from './refund-judgment';
import { generateRefundRequestToken } from './refund-action-state';
import { parseRecoveryJudgeForm, parseRecoveryResolveForm } from './refund-recovery-form';
import {
  RecoveryReadIntegrityError,
  findRefundForRecovery,
  type RecoveryRefundSnapshot,
} from './refund-recovery-read';
import {
  RefundCallerBugError,
  RefundFinalizeParseError,
  finalizeRecoveryOrderRefund,
} from './refund-repository';
import {
  RECOVERY_CONFIRM_FIELD,
  RECOVERY_DR_CODE_FIELD,
  RECOVERY_REQUEST_TOKEN_FIELD,
  REFUND_MARKED_FAILED_RESULT_CODE,
  REFUND_RECOVERED_RESULT_CODE,
  VERDICT_MESSAGES,
  judgeFailure,
  resolveFailure,
  type RefundJudgeState,
  type RefundResolveState,
} from './refund-recovery-state';

// refund-recovery-actions.ts — M-3 A7c RW4:恢復流程兩支 server action(高風險片、鐵則 12 ①)。
//
// ① judgeRefundExceptionAction(唯讀):帳本重讀 → Record 反查 → §4-1 判定 → 回讀數給員工。
// ② resolveRefundExceptionAction(結案):**送出當下重跑同一條判定鏈**(不信畫面上的舊判定);
//    閘序=便宜的先跑(opus R2 N3:確認碼/證據只要帳本列,打錯不燒 TapPay 呼叫)——
//    授權 → 解析 → 帳本重讀+入口鏡像 → 確認碼(mark)/證據(recover)→ Record 重判 → 判定閘 → finalize。
//
// 🔴 本流程**不吃退款發起旗標**(refund-ui-flag.ts;字面刻意不寫 —— wiring oracle 只准兩檔命中):
//    旗標的開啟前置=RW4 收工(plan §1 RW2d 列)——結案流程若被同一旗標鎖住,
//    旗標關著時卡住的 processing 列就永遠無人能收,正是 plan 說的「值班無畫面死巷」。
//    授權(authorizeAdminMutation)+異常入口鏡像+三閘+RPC 步 5b/G5 才是本流程的閘。
//
// 🔴 異常入口鏡像(RPC 步 5b 是權威、這裡給友善訊息):processing 且(滯留 ≥30 分 或 有證據)。
//    created_at 不可解析 → **擋**(not_exception_yet)—— 注意方向與 isRefundException 相反:
//    顯示面的 fail-closed=「看得見」,動作面的 fail-closed=「不可解鎖」,兩者都是保守側。
//
// 🔴 稽核零本檔:finalize RPC 同交易寫 audit(G9);judge 是唯讀動作、只留 console 軌跡。
//    judge 無 server 端節流(直接 POST 可重複打 Record API)= 已知邊界:authorize 後才可達、
//    唯讀零副作用,與 initiate 的 G0 反查同待遇;要節流是全 admin 的基建題、不在本片。
// 🔴 成功 redirect 在一切 try 之外(NEXT_REDIRECT 被 catch 吞=「結了案畫面卻說失敗」,A9d2-1 R2-3)。

const EXCEPTIONS_PATH = '/orders/refund-exceptions';

type FailureOnly<T extends string> = { ok: false; code: T };

type LoadRowOutcome =
  | FailureOnly<'not_found' | 'already_finalized' | 'not_exception_yet' | 'bug' | 'error'>
  | { ok: true; row: RecoveryRefundSnapshot };

type JudgeRowOutcome =
  | FailureOnly<'config' | 'record_unavailable' | 'error'>
  | { ok: true; judgment: RefundRecoveryJudgment };

type LogError = (stage: string, error: unknown, extra?: Record<string, unknown>) => void;

/** 判定鏈前半:帳本重讀+入口鏡像(零外部呼叫;便宜閘的依據都在這)。 */
async function loadExceptionRow(refundId: string, logError: LogError): Promise<LoadRowOutcome> {
  let row: RecoveryRefundSnapshot | null;
  try {
    row = await findRefundForRecovery(refundId);
  } catch (error) {
    logError('帳本重讀失敗', error);
    // 完整性異常(兄弟列截斷)=重試不會好 → 停手訊息;一般讀取失敗 → 可重試(opus nit 折入)。
    return { ok: false, code: error instanceof RecoveryReadIntegrityError ? 'bug' : 'error' };
  }
  if (!row) return { ok: false, code: 'not_found' };
  if (row.status !== 'processing') {
    // 🔴 #473(關卡2 codex MF1):這條早退原本**不 revalidate**,員工按下去之後畫面仍停在舊的那一列。
    //    我第一版把文案寫成「看清單上的最新狀態即可」—— **那句和舊文案一樣是白做工**,
    //    因為畫面根本不會變。⇒ **根因修法 = 讓畫面自己更新**,而不是寫一句話解釋畫面是舊的。
    //    (成功路徑本來就這樣做;這裡只是把它補齊。)
    // ⚠️ 原註解在這裡寫「異常清單只載 `processing`(`refund-read.ts:126` `.eq()`)」當**現行事實** ——
    //    `#473b-2` 已把那行刪掉(清單改成**兩支獨立查詢**——可處理那支仍是 `.eq('status','processing')`,
    //    卡住那支是 `.eq('status','failed').eq('failed_reason', …)`;`manual_failed` 列**留在清單上**)。
    //    revalidate 的必要性**不因此改變**(那一列的顯示內容仍要更新),但別再拿舊述詞當理由。
    revalidatePath(EXCEPTIONS_PATH);
    revalidatePath(`/orders/${row.orderId}`);
    return { ok: false, code: 'already_finalized' };
  }

  // 異常入口鏡像(檔頭;證據列不等 30 分=fable N4)。
  if (row.providerEvidence === null) {
    const createdMs = Date.parse(row.createdAt);
    if (!Number.isFinite(createdMs) || Date.now() - createdMs < REFUND_EXCEPTION_STALL_MS) {
      return { ok: false, code: 'not_exception_yet' };
    }
  }
  return { ok: true, row };
}

/** 判定鏈後半:Record 反查+§4-1 判定(唯一外部呼叫點;失敗零副作用可重試)。 */
async function judgeRow(row: RecoveryRefundSnapshot, logError: LogError): Promise<JudgeRowOutcome> {
  let adapter;
  try {
    adapter = getTapPayAdapter();
  } catch (error) {
    logError('adapter 建構失敗', error);
    return { ok: false, code: error instanceof TapPayConfigError ? 'config' : 'error' };
  }

  let record;
  try {
    // 逾時同 G0(≤10s;RW2b maxDuration 餘額紀律)。
    record = await adapter.recordQuery(
      { recTradeId: row.recTradeId },
      { signal: AbortSignal.timeout(REFUND_RECORD_QUERY_TIMEOUT_MS) },
    );
  } catch (error) {
    logError('Record 反查失敗', error);
    return { ok: false, code: 'record_unavailable' };
  }

  return {
    ok: true,
    judgment: judgeRefundRecovery(
      record,
      {
        refundAmount: row.refundAmount,
        recTradeId: row.recTradeId,
        recordRefundedBefore: row.recordRefundedBefore,
        providerEvidence: row.providerEvidence,
      },
      row.otherInFlightCount,
    ),
  };
}

function makeLogError(
  scope: string,
  base: Record<string, unknown>,
): LogError {
  return (stage, error, extra = {}) => {
    // 🔴 只記 code 與 message 前 200 字,不記 details / hint(PG DETAIL 會帶整列內容)。
    const summary = (error ?? {}) as { code?: unknown; message?: unknown };
    console.error(`[admin/payment/refund-recovery] ${scope} ${stage}`, {
      ...base,
      code: typeof summary.code === 'string' ? summary.code : undefined,
      message: String(summary.message ?? '').slice(0, 200),
      ...extra,
    });
  };
}

/** ① 對帳判定(唯讀)。 */
export async function judgeRefundExceptionAction(
  _prev: RefundJudgeState,
  formData: FormData,
): Promise<RefundJudgeState> {
  // 授權閘絕對第一(連讀一個欄位都在它之後;測試用 get() 會爆的地雷 FormData 釘住短路)。
  const authorization = await authorizeAdminMutation();
  if (!authorization) return judgeFailure('denied');

  const parsed = parseRecoveryJudgeForm(formData);
  if (!parsed.ok) return judgeFailure('invalid');

  const httpRequestId = await getRequestId();
  console.info('[admin/payment/refund-recovery] judge.attempt', {
    request_id: httpRequestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    refund_id: parsed.refundId,
  });
  const logError = makeLogError('judge', {
    request_id: httpRequestId,
    refund_id: parsed.refundId,
  });

  const loaded = await loadExceptionRow(parsed.refundId, logError);
  if (!loaded.ok) return judgeFailure(loaded.code);
  const { row } = loaded;
  const judged = await judgeRow(row, logError);
  if (!judged.ok) return judgeFailure(judged.code);
  const { judgment } = judged;

  // shape/state 異常兩碼沒有讀數(判定聯合的判別窄化;不 cast)。
  const readings =
    judgment.verdict === 'record_shape_bad' || judgment.verdict === 'record_state_bad'
      ? { refundedNow: null, delta: null }
      : { refundedNow: judgment.refundedNow, delta: judgment.delta };
  // RF8 對帳結論(opus C1:期望和把本列算進去;讀數不可信/矛盾判定 → 不下結論)。
  const expectedLedger =
    judgment.verdict === 'executed'
      ? row.ledgerConfirmedSum + row.refundAmount
      : judgment.verdict === 'not_executed'
        ? row.ledgerConfirmedSum
        : null;
  const ledgerMatchesRecord =
    readings.refundedNow === null || expectedLedger === null
      ? null
      : readings.refundedNow === expectedLedger;
  console.info('[admin/payment/refund-recovery] judge.verdict', {
    request_id: httpRequestId,
    refund_id: parsed.refundId,
    order_id: row.orderId,
    verdict: judgment.verdict,
    delta: readings.delta,
  });
  return {
    status: 'judged',
    message: VERDICT_MESSAGES[judgment.verdict],
    verdict: judgment.verdict,
    baseline: row.recordRefundedBefore,
    refundedNow: readings.refundedNow,
    delta: readings.delta,
    refundAmount: row.refundAmount,
    ledgerConfirmedSum: row.ledgerConfirmedSum,
    ledgerMatchesRecord,
    confirmedMissingRefundId: row.confirmedMissingRefundId,
    judgedAtIso: new Date().toISOString(),
  };
}

/** ② 人工結案(標記失敗 / Portal 真碼恢復)。 */
export async function resolveRefundExceptionAction(
  _prev: RefundResolveState,
  formData: FormData,
): Promise<RefundResolveState> {
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return resolveFailure('denied', generateRefundRequestToken(), { drCode: '', confirmCode: '' });
  }

  // #365:回帶欄位同樣走「getAll 恰一筆」——送兩份時不再回顯第一筆,一律回空。
  const read = (field: string): string => readSingleString(formData, field) ?? '';
  const rawToken = read(RECOVERY_REQUEST_TOKEN_FIELD);
  // 原樣帶回;真的拿不到才新產(重放權威=G5 CAS,token 只餵 audit)。
  const carriedToken = rawToken !== '' ? rawToken : generateRefundRequestToken();
  const carried = { drCode: read(RECOVERY_DR_CODE_FIELD), confirmCode: read(RECOVERY_CONFIRM_FIELD) };

  const parsed = parseRecoveryResolveForm(formData);
  if (!parsed.ok) return resolveFailure('invalid', carriedToken, carried);

  const httpRequestId = await getRequestId();
  console.info('[admin/payment/refund-recovery] resolve.attempt', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    sid: authorization.sid,
    actor: authorization.actorId,
    refund_id: parsed.refundId,
    resolution: parsed.resolution,
  });
  const logError = makeLogError('resolve', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    refund_id: parsed.refundId,
    resolution: parsed.resolution,
  });

  const loaded = await loadExceptionRow(parsed.refundId, logError);
  if (!loaded.ok) return resolveFailure(loaded.code, parsed.requestToken, carried);
  const { row } = loaded;

  // ── 便宜閘(只要帳本列;打錯不燒 Record 呼叫,opus R2 N3)──
  if (parsed.resolution === 'mark_failed') {
    // 確認碼閘(opus C3;Q2=A 人因閘同款、server 端驗):「你真的在結這一筆」。
    if (row.orderDisplayId === null) {
      logError('帳本列缺母單編號(FK 應保證;資料異常)', null);
      return resolveFailure('bug', parsed.requestToken, carried);
    }
    // 大小寫不敏感(opus R2 N1:新 6 碼制字母表全大寫,小寫輸入不該恆撞牆)。
    if (row.orderDisplayId.slice(-4).toUpperCase() !== parsed.confirmCode.toUpperCase()) {
      return resolveFailure('confirm_mismatch', parsed.requestToken, carried);
    }
  } else if (row.providerEvidence !== null && parsed.drCode !== row.providerEvidence) {
    // P7C13 app 鏡像(友善訊息;DB 仍是權威):hold 列的 Portal 碼必須等於受理證據。
    return resolveFailure('evidence_mismatch', parsed.requestToken, carried);
  }

  // 🔴 送出當下重跑判定(不信畫面上的舊判定 —— 判定與結案之間 Portal/別人都可能動過)。
  const judged = await judgeRow(row, logError);
  if (!judged.ok) return resolveFailure(judged.code, parsed.requestToken, carried);
  const { judgment } = judged;

  let resultCode: string;
  let expectedStatusAfter: string;
  let outcome;
  try {
    if (parsed.resolution === 'mark_failed') {
      // 判定閘(§4-1:delta=0 且無證據矛盾才准標記失敗)。
      if (judgment.verdict !== RESOLUTION_REQUIRED_VERDICT.mark_failed) {
        return resolveFailure('verdict_mismatch', parsed.requestToken, carried);
      }
      // detail=兩讀數(§4-1 逐字);內容全為數字+固定字面,長度有界(RPC 上限 500)。
      outcome = await finalizeRecoveryOrderRefund({
        refundId: row.id,
        outcome: 'manual_failed',
        tappayRefundId: null,
        failedDetail:
          `Record 對帳:record_refunded_before=${row.recordRefundedBefore};` +
          `refunded_amount 現值=${judgment.refundedNow};差額=0(未執行);` +
          `判定時刻=${new Date().toISOString()}`,
        actor: authorization.actorId,
        requestId: parsed.requestToken,
      });
      resultCode = REFUND_MARKED_FAILED_RESULT_CODE;
      expectedStatusAfter = 'failed';
    } else {
      // 判定閘(§4-1:delta=refund_amount 且無其他在途列才准恢復)。
      if (judgment.verdict !== RESOLUTION_REQUIRED_VERDICT.recover_confirmed) {
        return resolveFailure('verdict_mismatch', parsed.requestToken, carried);
      }
      outcome = await finalizeRecoveryOrderRefund({
        refundId: row.id,
        outcome: 'recovered_confirmed',
        tappayRefundId: parsed.drCode,
        failedDetail: null,
        actor: authorization.actorId,
        requestId: parsed.requestToken,
      });
      resultCode = REFUND_RECOVERED_RESULT_CODE;
      expectedStatusAfter = 'confirmed';
    }
  } catch (error) {
    // 現況可能已被別人改(CAS/守門);讓清單與訂單頁重取再顯示。
    revalidatePath(EXCEPTIONS_PATH);
    revalidatePath(`/orders/${row.orderId}`);
    // 🔴 三分流(codex R2 must-fix):RAISE=確定回滾 / 解析失敗=交易已 commit、結果不明 /
    //    其他=結果不明。「沒寫入」只在確定回滾時才可以說。子型別先驗(它 instanceof 父類)。
    if (error instanceof RefundFinalizeParseError) {
      logError('finalize 回應解析失敗(交易可能已完成)', error);
      return resolveFailure('finalize_unknown', parsed.requestToken, carried);
    }
    if (error instanceof RefundCallerBugError) {
      logError('finalize 被拒(RAISE)', error);
      return resolveFailure('finalize_rejected', parsed.requestToken, carried);
    }
    // 23 類 SQLSTATE(integrity violation)=交易必回滾、**確定零寫入** —— 例:員工從 Portal
    // 抄到別筆退款的編號撞 tappay_refund_id UNIQUE(修後 E2E 實錘 23505)。映「被拒、沒寫入」。
    const sqlState = (error as { code?: unknown }).code;
    if (typeof sqlState === 'string' && sqlState.startsWith('23')) {
      logError('finalize 被拒(integrity violation)', error);
      return resolveFailure('finalize_rejected', parsed.requestToken, carried);
    }
    // 🔴 codex 關卡2 MF 折入:寫入請求丟出的其他錯誤=**結果不明**(可能已 commit、回應斷在路上)。
    //    不得映成「沒有完成、可再試」—— 那是沒被驗證的斷言;映 finalize_unknown(先確認現況)。
    logError('finalize 結果不明', error);
    return resolveFailure('finalize_unknown', parsed.requestToken, carried);
  }

  revalidatePath(EXCEPTIONS_PATH);
  revalidatePath(`/orders/${row.orderId}`);
  if (outcome.result === 'REFUND_NOT_FOUND') {
    return resolveFailure('not_found', parsed.requestToken, carried);
  }
  if (outcome.result !== 'FINALIZED' || outcome.statusAfter !== expectedStatusAfter) {
    // 非預期碼(HELD 只可能出自 accepted 路徑)或語意漂移(codex nit:manual_failed 回 confirmed
    // 仍顯「錢沒動」= 訊息與事實相反)—— 一律 fail-closed 停手,不宣稱任何一種結果。
    logError('finalize 回非預期碼或語意漂移', outcome);
    return resolveFailure('bug', parsed.requestToken, carried);
  }

  console.info('[admin/payment/refund-recovery] resolve.finalized', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    refund_id: row.id,
    order_id: row.orderId,
    resolution: parsed.resolution,
    status_after: outcome.statusAfter,
    payment_status_after: outcome.paymentStatusAfter,
  });
  // 🔴 成功才 PRG;在一切 try 之外(檔頭)。
  redirect(`${EXCEPTIONS_PATH}?r=${resultCode}`);
}
