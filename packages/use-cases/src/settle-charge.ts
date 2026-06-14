import type { ITapPayAdapter, IChargeAttemptStore, IPaymentConfirmer } from '@pcm/ports';
import type {
  ActiveChargeAttempt,
  SettleChargeInput,
  SettleChargeOutcome,
  TapPayRecordQuery,
  TapPayRecordResult,
  TapPayTradeRecord,
} from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';

/**
 * settleCharge:3DS 對帳脊椎 use-case(M-3 3DS-1b;master plan v5 §1 step 1-5)。
 *
 * 三路(callback / webhook / sweeper)+ retry **共呼同一條冪等結算**、以 **Record API 為唯一權威**
 * (notify 無簽章不可信)。本 use-case:
 * ```
 * 1. findActiveByOrderId(orderId) → 無 active attempt → no_attempt(webhook 對不上本機 → route 丟棄)
 * 2. 🔴 缺陷C 短路 + C×A 自癒:order 已 paid → best-effort recordPendingInvoice(冪等、throw 只 log)→ paid
 *    (嚴格 === 'paid';重入永遠到不了 step5、故短路路也補記、durable 不漏待開票)
 * 3. R4 鍵優先序組 recordQuery:rec_trade_id → bank_transaction_id → hint(Record 驗)→ order_number
 *    recordQuery throw → pending: record_unreachable(保留、不誤判 failed)
 * 4. 🔴 共用識別+金額閘 recordMatchesOrder(任何 terminal 前必過):count=1 + order_number===orderId +
 *    本機 rec/bank 對 Record + amount/currency 嚴格 + 弱識別時間窗 → 再 record_status 映射(R3/R5)
 * 5. paid 收斂(既有冪等樹複用 + 缺陷A):markCharged(主軌、token 不用)→ confirm → recordPendingInvoice → paid
 *    (findActiveByOrderId / markCharged / markFailed / confirm throw 皆 fail-closed → pending,不 reject route)
 * ```
 *
 * 信任 / 安全邊界:
 * - deps 由 **cookieless** composition factory(getSettleChargeDeps)注入:attempts=主軌-only
 *   PgChargeAttemptAdapter(webhook/sweeper 無 cookie;markCharged 主軌刻意不用 fallbackToken)。
 * - 金額 = `attempt.orderTotal`(read RPC 窄權回、非 findTotal RLS own-only);整數零浮點。
 * - log 僅 orderId/attemptId/recTradeId/recordStatus(零 PII/卡資料/token)。
 * - settleCharge **不下 UI/cart 決策**(retry 三裁決的 duplicate/重刷/hold 由 action 層〔3DS-5b〕映)。
 *
 * @see docs/specs/2026-06-14-m3-3ds-1b-settlecharge-plan.md §2/§5-§8
 * @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §1/§7
 */
export type SettleChargeDeps = {
  tappay: ITapPayAdapter;
  attempts: IChargeAttemptStore;
  confirmer: IPaymentConfirmer;
};

export async function settleCharge(
  deps: SettleChargeDeps,
  input: SettleChargeInput,
): Promise<SettleChargeOutcome> {
  const { tappay, attempts, confirmer } = deps;
  const { orderId } = input;

  // 1. 依 orderId 反查 active(pending|charged)attempt + order 對帳欄(主軌-only)。
  //    🔴 fail-closed(codex 關卡2):讀失敗(連線/parse)→ pending 保留、**不 reject**(否則 route 500),sweeper 重來。
  let attempt: ActiveChargeAttempt | null;
  try {
    attempt = await attempts.findActiveByOrderId(orderId);
  } catch {
    return { kind: 'pending', reason: 'record_unreachable' };
  }
  if (!attempt) {
    return { kind: 'no_attempt' };
  }

  // 2. 🔴 缺陷C 短路 + C×A 自癒:order 已 paid → 不打 Record(省 §7 rate-limit);**短路路也補記待開票**
  //    (C×A:若首次 paid 收斂 step5 recordPendingInvoice throw,訂單已 paid → 重入永遠在此短路、到不了
  //     step5 → 待開票永久遺失;故短路也呼、ON CONFLICT 已記 no-op/未記自癒)。嚴格 === 'paid'(不 !==unpaid、
  //    避免誤短路退款/partiallyPaid 態)。
  if (attempt.orderPaymentStatus === 'paid') {
    await bestEffortRecordInvoice(confirmer, orderId);
    return { kind: 'paid', idempotent: true, displayId: attempt.orderDisplayId };
  }

  // 3. R4 鍵優先序 → Record 反查。hasStrongKey=本機有 rec 或 bank(強識別);否則弱識別(hint/order_number)。
  const hasStrongKey = attempt.recTradeId !== null || attempt.bankTransactionId !== null;
  let record: TapPayRecordResult;
  try {
    record = await tappay.recordQuery(buildRecordQuery(attempt, input.recTradeIdHint, orderId));
  } catch {
    // HTTP/格式異常 = 查不到真狀態 → 保留(retry),絕不誤判 failed。
    return { kind: 'pending', reason: 'record_unreachable' };
  }

  // 4. 命中恰一筆 + 🔴 共用「本機↔Record 識別 + 金額」閘(codex 關卡2):任何 terminal outcome(paid/failed)
  //    前必過,防誤命中他單而誤釋鎖放行重刷=雙扣。
  if (record.queryStatus !== 0 || record.numberOfTransactions !== 1 || record.records.length !== 1) {
    return { kind: 'pending', reason: 'record_unverified' };
  }
  const tr = record.records[0]!;
  if (!recordMatchesOrder(tr, attempt, orderId, hasStrongKey)) {
    return { kind: 'pending', reason: 'record_unverified' };
  }

  // 4b. record_status 映射(官方 7 值;§5 表;識別/金額已在 §4 閘驗過)。paid 才走 step 5,其餘逐態回。
  const verdict = classifyRecordStatus(tr);
  if (verdict.kind !== 'paid_candidate') {
    if (verdict.kind === 'explicit_failed') {
      // 🔴 弱識別失敗終態下界硬化(codex 關卡2 r3、審查側逮):charge 必在 attempt「後」發生,弱識別失敗
      //    **不可採信 attempt「前」的舊 Record**(即使落在 -5min skew 內)→ 否則同單舊 CANCEL/ERROR 會誤釋
      //    當前 attempt 鎖、當前 3DS 若成交→重入 no_attempt→客人重刷=雙扣。pre-attempt 弱識別失敗 → 不釋鎖、
      //    保留 pending(retry/sweeper)。-5min skew 僅留給 paid 自癒(settlePaid;自癒安全、不釋鎖)。
      if (!hasStrongKey && !withinAttemptWindow(tr.transactionTimeMillis, attempt.attemptCreatedAt, true)) {
        return { kind: 'pending', reason: 'record_unverified' };
      }
      // -1=ERROR / 5=CANCEL:明確未成功(且識別/金額已過閘)→ markFailed 釋鎖(caller 放行重刷)。
      //    🔴 fail-closed(codex 關卡2):markFailed throw → pending 保留(不誤回 failed、不 reject route),retry。
      try {
        await attempts.markFailed({ attemptId: attempt.attemptId, orderId });
      } catch {
        return { kind: 'pending', reason: 'record_unreachable' };
      }
      return { kind: 'failed' };
    }
    if (verdict.kind === 'refund_anomaly') {
      // 2=PARTIALREFUNDED / 3=REFUNDED:Phase 1 無退款流程 → 異常、不自動放行(S2=B);告警。
      console.error('[settleCharge] 🔴 Record 顯退款態(Phase 1 無退款流程、不自動放行;退款片 S2=B)', {
        orderId,
        attemptId: attempt.attemptId,
        recordStatus: tr.recordStatus,
      });
      return { kind: 'pending', reason: 'record_unverified' };
    }
    // auth_or_pending(0/4/1&&!is_captured)或 unverified(金額不符)
    return { kind: 'pending', reason: verdict.reason };
  }

  // 5. paid 收斂(Record 證實 record_status=1 && is_captured && 金額/幣別符)。rec 用 Record 權威值。
  return settlePaid(deps, attempt, tr.recTradeId, orderId);
}

/** R4 優先序:rec_trade_id → bank_transaction_id → hint(僅 hint、Record 驗)→ order_number(=orderId)。 */
function buildRecordQuery(
  attempt: ActiveChargeAttempt,
  hint: string | undefined,
  orderId: string,
): TapPayRecordQuery {
  if (attempt.recTradeId) {
    return { recTradeId: attempt.recTradeId };
  }
  if (attempt.bankTransactionId) {
    return { bankTransactionId: attempt.bankTransactionId };
  }
  if (hint) {
    // 🔴 hint 非本機權威鍵、僅作查詢入口;Record 回應仍走 recordMatchesOrder 全條件(含時間窗)驗證。
    return { recTradeId: hint };
  }
  // 純 order_number fallback(弱識別):order_number=我方唯一 orderId(UUID);recordMatchesOrder 套
  //   count=1 + order_number===orderId + amount + 🔴 時間窗(master plan §1 step 2、codex 關卡2)防誤命中他單。
  return { orderNumber: orderId };
}

const SETTLE_WINDOW_FORWARD_MS = 24 * 60 * 60 * 1000; // attempt 建立「後」24h(charge 後續結算/延遲容忍)
const SETTLE_CLOCK_SKEW_MS = 5 * 60 * 1000; // attempt 「前」僅容 5 分鐘時鐘偏移(防舊交易誤命中)

/**
 * 弱識別(hint/order_number)時間窗:Record 交易時間須在 attempt 建立時間「後」的窗內;缺時間 → fail-closed。
 *
 * 🔴 **單向窗(codex 關卡2 r2)**:charge 必在 attempt 建立**後**發生 → record 交易時間須 `>= 下界` 且
 * `<= attempt + 24h`;**不可**落在 attempt 前太久(否則為同單舊交易、舊 hint 回來會誤命中 → 誤釋鎖放行重刷=雙扣)。
 *
 * 🔴 **下界非對稱(codex 關卡2 r3、審查側逮)**:
 * - 一般(paid 自癒)下界 = `attempt − 5min` 時鐘偏移:採信「略早於 attempt」的 Record 頂多收斂成 paid、自癒安全、不雙扣。
 * - `forFinalFail=true`(markFailed 釋鎖)下界 = `attempt`(零 pre-attempt 偏移):失敗終態若採信 attempt「前」舊 Record
 *   會誤釋當前鎖→當前 3DS 若成交→重刷=雙扣;故釋鎖路徑零容忍 pre-attempt 舊交易。
 */
function withinAttemptWindow(
  recordTimeMillis: number | undefined,
  attemptCreatedAt: string,
  forFinalFail = false,
): boolean {
  if (recordTimeMillis === undefined) {
    return false; // 弱識別又無交易時間 → 無法驗窗、fail-closed
  }
  const attemptMs = Date.parse(attemptCreatedAt);
  if (Number.isNaN(attemptMs)) {
    return false;
  }
  const lowerBound = forFinalFail ? attemptMs : attemptMs - SETTLE_CLOCK_SKEW_MS;
  return (
    recordTimeMillis >= lowerBound &&
    recordTimeMillis <= attemptMs + SETTLE_WINDOW_FORWARD_MS
  );
}

/**
 * 🔴 共用「本機↔Record 識別 + 金額」閘(codex 關卡2):terminal outcome(paid/failed)前必過,防誤命中他單。
 * - `order_number` 恆對 orderId;本機有 rec/bank → 必等於 Record(防 filter 異常採他單);
 * - `amount===orderTotal`(整數)+ `currency==='TWD'`(R5;orders 無 currency 欄、常數比);
 * - 弱識別(無 rec/bank、走 hint/order_number)→ 加時間窗(master plan §1 step 2)。
 * merchant 由 adapter recordQuery wire 完整性已 fail-closed(每筆 merchant_id 必本商戶、否則 throw)。
 */
function recordMatchesOrder(
  tr: TapPayTradeRecord,
  attempt: ActiveChargeAttempt,
  orderId: string,
  hasStrongKey: boolean,
): boolean {
  if (tr.orderNumber !== orderId) return false;
  if (attempt.recTradeId !== null && tr.recTradeId !== attempt.recTradeId) return false;
  if (attempt.bankTransactionId !== null && tr.bankTransactionId !== attempt.bankTransactionId) return false;
  if (tr.amount !== attempt.orderTotal || tr.currency !== 'TWD') return false;
  if (!hasStrongKey && !withinAttemptWindow(tr.transactionTimeMillis, attempt.attemptCreatedAt)) return false;
  return true;
}

type RecordVerdict =
  | { kind: 'paid_candidate' }
  | { kind: 'explicit_failed' }
  | { kind: 'refund_anomaly' }
  | { kind: 'pending'; reason: 'auth_or_pending' | 'record_unverified' };

/** record_status 官方 7 值 → 裁決(§5 表;1a amend 3286a30 釘正;識別/金額已在 recordMatchesOrder 閘驗過)。 */
function classifyRecordStatus(tr: TapPayTradeRecord): RecordVerdict {
  switch (tr.recordStatus) {
    case 1: // OK 交易完成 → 須已 captured 才算 paid(未 captured = 罕見中間態 → pending)
      return tr.isCaptured
        ? { kind: 'paid_candidate' }
        : { kind: 'pending', reason: 'auth_or_pending' };
    case 0: // AUTH 授權未請款
    case 4: // PENDING 待付款
      return { kind: 'pending', reason: 'auth_or_pending' };
    case -1: // ERROR
    case 5: // CANCEL 取消交易
      return { kind: 'explicit_failed' };
    case 2: // PARTIALREFUNDED 部分退款
    case 3: // REFUNDED 完全退款
      return { kind: 'refund_anomaly' };
    default:
      return { kind: 'pending', reason: 'record_unverified' }; // 未知碼 → 保留(fail-closed)
  }
}

/** paid 收斂:markCharged(主軌、token 不用)→ confirm → recordPendingInvoice(缺陷A best-effort)→ paid。 */
async function settlePaid(
  deps: SettleChargeDeps,
  attempt: ActiveChargeAttempt,
  recTradeId: string,
  orderId: string,
): Promise<SettleChargeOutcome> {
  const { attempts, confirmer } = deps;

  // markCharged(pending→charged;charged 同 rec no-op 冪等)。主軌刻意不用 fallbackToken → 傳 '' 佔位。
  //   throw(transport)→ 保留 retry(sweeper 再來、冪等);不誤判、不棄。
  try {
    await attempts.markCharged({ attemptId: attempt.attemptId, orderId, recTradeId, fallbackToken: '' });
  } catch {
    return { kind: 'pending', reason: 'record_unreachable' };
  }

  // confirm(unpaid→paid 冪等;FOR UPDATE + paid no-op)。
  let idempotent: boolean;
  try {
    const result = await confirmer.confirm({
      orderId,
      amount: { amount: toMoneyAmount(attempt.orderTotal), currency: 'TWD' },
      recTradeId,
    });
    if (!result.confirmed) {
      // RPC 契約恆 confirmed:true(業務失敗走 throw);drift 回 false → fail-closed 不宣 paid。
      return { kind: 'pending', reason: 'record_unverified' };
    }
    idempotent = result.idempotent;
  } catch {
    // 連線層 / RPC RAISE → 保留(已 Record 證實扣款、不棄;retry confirm 冪等)。
    return { kind: 'pending', reason: 'record_unreachable' };
  }

  // 🔴 缺陷A:成交點記待開票(best-effort、throw 只 log 不翻 paid;S1=B、master plan §5)。
  await bestEffortRecordInvoice(confirmer, orderId);
  return { kind: 'paid', idempotent, displayId: attempt.orderDisplayId };
}

/** best-effort 記待開票:throw 只 log、不影響 paid 結果(訂單已 paid + ON CONFLICT 冪等)。 */
async function bestEffortRecordInvoice(confirmer: IPaymentConfirmer, orderId: string): Promise<void> {
  try {
    await confirmer.recordPendingInvoice(orderId);
  } catch {
    console.error('[settleCharge] recordPendingInvoice 失敗(訂單已 paid、待開票留 sweeper 重入自癒)', {
      orderId,
    });
  }
}
