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
  //    🔴 queryStatus 白名單 {0,2}(isQuerySucceeded):top `status=2`「已無更多分頁」是 TapPay **查詢成功**態
  //    (≠交易狀態、≠「無紀錄」;官方逐字 querystatus-fix plan §2)。原 `!== 0` 把 status=2 誤殺成「查詢失敗」→
  //    到不了 classifyRecordStatus → **所有 3DS 授權成功單卡 pending、S1「授權即成立」實際從未生效**
  //    (2026-06-21 PCM-2026-0018 真刷實證;fix plan docs/specs/2026-06-21-m3-3ds-settle-querystatus-fix-plan.md)。
  //    🔴 放行 ≠ 拿掉檢查:fail-closed 白名單(只放已逐字確認成功碼)+ count===1 + records.length===1 +
  //    recordMatchesOrder(識別/金額/弱識別窗)三重縱深全保留;record_status 才是成立權威。
  if (!isQuerySucceeded(record.queryStatus) || record.numberOfTransactions !== 1 || record.records.length !== 1) {
    // observability(non-blocking、不改裁決):查詢碼非白名單卻帶紀錄 → 可能 TapPay error table 有未涵蓋成功碼,
    //   記一行非 PII 警示供未來追(仍 fail-closed pending、絕不據此放行)。
    if (!isQuerySucceeded(record.queryStatus) && record.records.length > 0) {
      console.warn('[settleCharge] queryStatus 非白名單{0,2}卻帶紀錄(fail-closed pending、待查 TapPay error table)', {
        orderId,
        queryStatus: record.queryStatus,
        count: record.numberOfTransactions,
      });
    }
    return { kind: 'pending', reason: 'record_unverified' };
  }
  const tr = record.records[0]!;
  if (!recordMatchesOrder(tr, attempt, orderId, hasStrongKey)) {
    return { kind: 'pending', reason: 'record_unverified' };
  }

  // 4b. record_status 映射(官方 7 值;§5 表;識別/金額/時間窗已在 §4 recordMatchesOrder 閘驗過)。
  //     paid 才走 step 5,其餘逐態回。
  const verdict = classifyRecordStatus(tr);
  if (verdict.kind !== 'paid_candidate') {
    if (verdict.kind === 'explicit_failed') {
      // -1=ERROR / 5=CANCEL:明確未成功(且識別/金額/時間窗已過 §4 閘)→ markFailed 釋鎖(caller 放行重刷)。
      //    🔴 pre-attempt 防誤釋鎖縱深已前移到 §4 recordMatchesOrder 弱識別窗(下界=attempt、S1 收緊):弱識別
      //    pre-attempt 舊 Record 在 §4 即被擋成 record_unverified、到不了此處;強識別由鍵唯一識別(不套窗)。
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
    // auth_or_pending(record_status=4 PENDING 待付款)或 unverified(未知碼)
    return { kind: 'pending', reason: verdict.reason };
  }

  // 5. paid 收斂(Record 證實 record_status ∈ {0 AUTH, 1 OK} + 識別/金額/幣別符;授權即成立)。rec 用 Record 權威值。
  return settlePaid(deps, attempt, tr.recTradeId, orderId);
}

/**
 * TapPay 查詢 API top `status` 成功白名單(官方逐字 querystatus-fix plan §2):
 * `0`=查詢成功有紀錄 / `2`=已無更多分頁(亦查詢成功、與「有無紀錄」正交、由 count/records 判)。
 * 🔴 **fail-closed 白名單**(非「拿掉檢查」):TapPay error table 未內聯 → 只放行已逐字確認的成功碼,其餘一律照擋
 * (即使存在未知成功碼也只保守多擋、**絕不誤放行錯誤碼**)。`record_status` 才是成立權威、`status` 只管查詢有沒有成功。
 */
function isQuerySucceeded(status: number): boolean {
  return status === 0 || status === 2;
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

/**
 * 弱識別(hint/order_number)時間窗:Record 交易時間須在 attempt 建立時間「後」的窗內;缺時間 → fail-closed。
 *
 * 🔴 **單向窗、下界 = attempt(零 pre-attempt 偏移;S1 收緊、Q3、審查側雙扣 finding)**:
 * charge 必在 attempt 建立**後**發生 → record 交易時間須 `>= attempt` 且 `<= attempt + 24h`。
 * 下界零容忍 pre-attempt:**在 bank_txn 於 charge 前先 durable 的 invariant 下**,弱識別窗內本 attempt 的
 * charge 尚未上 TapPay → Record 撈到的同單交易必是 pre-attempt 舊交易;採信會誤釋鎖/誤標 paid 放行重刷=雙扣。
 * **paid/failed 同款硬化**:S1 前 paid 側曾用 `attempt − 5min` skew、被審查側逮為「授權即成立」後的雙扣縫(舊
 * AUTH 落 -5min 帶內被誤採信標 paid 釋鎖→本 attempt 若成交→重刷),已移除(純安全增益、不誤擋合法自癒)。
 * 🔴 鐵則 10:此論證綁定「bank_txn charge 前 durable」前提,未來改 initiate 順序須重核此窗。
 */
function withinAttemptWindow(
  recordTimeMillis: number | undefined,
  attemptCreatedAt: string,
): boolean {
  if (recordTimeMillis === undefined) {
    return false; // 弱識別又無交易時間 → 無法驗窗、fail-closed
  }
  const attemptMs = Date.parse(attemptCreatedAt);
  if (Number.isNaN(attemptMs)) {
    return false;
  }
  return recordTimeMillis >= attemptMs && recordTimeMillis <= attemptMs + SETTLE_WINDOW_FORWARD_MS;
}

/**
 * 🔴 共用「本機↔Record 識別 + 金額」閘(codex 關卡2):terminal outcome(paid/failed)前必過,防誤命中他單。
 * - `order_number` 恆對 orderId;本機有 rec/bank → 必等於 Record(防 filter 異常採他單);
 * - `amount===orderTotal`(整數)+ `currency==='TWD'`(R5;orders 無 currency 欄、常數比);
 * - 弱識別(無 rec/bank、走 hint/order_number)→ 加時間窗(下界=attempt、S1 收緊;master plan §1 step 2)。
 *   🔴 S1「授權即成立」後,此弱識別窗是 paid + failed 雙 terminal 防 pre-attempt 誤採信的**統一縱深**(下界
 *   零容忍 pre-attempt;原 explicit_failed 的二次窗 guard 已併入此處、不再分散)。
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

/**
 * record_status 官方 7 值 → 裁決(§5 表;識別/金額已在 recordMatchesOrder 閘驗過)。
 *
 * 🔴 **授權即成立**(Sean 2026-06-20 拍、S1 重設計;設計包 docs/specs/2026-06-20-m3-3ds-auth-settlement-redesign.md §3-4):
 * record_status ∈ {0 AUTH, 1 OK} 即成立 → paid_candidate,**不再要求 is_captured**(請款由收單行自動批次、
 * 網站不做 capture)。`0 AUTH=授權成功未請款` ≠ `4 PENDING=待付款(尚未授權)`;故只放 0/1、4 維持 pending。
 * is_captured 欄位仍 parse/型別保留(未來精準帳務 authorized/captured 兩段),裁決不再讀。
 */
function classifyRecordStatus(tr: TapPayTradeRecord): RecordVerdict {
  switch (tr.recordStatus) {
    case 0: // AUTH 授權成功未請款 → 授權即成立(不再要求 is_captured)
    case 1: // OK 交易完成 → 成立
      return { kind: 'paid_candidate' };
    case 4: // PENDING 待付款(尚未授權)→ 維持 pending(≠ 0 AUTH)
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
