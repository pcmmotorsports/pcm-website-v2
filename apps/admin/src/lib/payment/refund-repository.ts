import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// refund-repository.ts — M-3 A7c RW2c:退款兩支 owner RPC 的唯一呼叫端 + 訂單窄讀。
//
// 🔴 稽核由 RPC **同交易**寫(`20260803150000` 步 9 / 步 8),本層不碰 `admin_audit_log`。
//
// 🔴 **回傳碼窮盡收斂**(RPC COMMENT 逐字「呼叫端必斷言 ∈ 全集」;memory
//    `feedback_null-dispatch-rpc-silently-downgrades`):未知碼 / 缺欄 / 非物件一律
//    `RefundCallerBugError` 拋出,不得靜默當成功 —— 動錢路徑上「零錯誤而事情沒發生」
//    與「事情發生了而呼叫端不知道」都是雙退的溫床。
//
// 🔴 admin 訂單顯示層投影**刻意零 tappay_rec_trade_id**(`SupabaseOrderAdapter.ts:90`)⇒
//    退款要的 {display_id, payment_status, tappay_rec_trade_id} 走本檔的窄讀,不擴顯示層投影。

/** initiate 的 8 個固定回傳碼(migration `20260803150000:414-416` 逐字)。 */
export const INITIATE_RESULT_CODES = [
  'INITIATED',
  'DUPLICATE_REQUEST',
  'ORDER_NOT_FOUND',
  'ORDER_NOT_REFUNDABLE',
  'ORDER_NO_CARD_TRANSACTION',
  'REFUND_LEDGER_FULL',
  'REFUND_IN_FLIGHT',
  'REFUND_NOTHING_LEFT',
] as const;
export type InitiateResultCode = (typeof INITIATE_RESULT_CODES)[number];

/** finalize 的 3 個固定回傳碼(`20260803150000:607`)。 */
export const FINALIZE_RESULT_CODES = [
  'FINALIZED',
  'HELD_AMOUNT_MISMATCH',
  'REFUND_NOT_FOUND',
] as const;
export type FinalizeResultCode = (typeof FINALIZE_RESULT_CODES)[number];

/**
 * 本層開放的 outcome = 同步路徑四碼**而已**。恢復出口(recovered_confirmed / manual_failed)
 * 是 RW4 人工流程專屬 —— 型別層就不給 action 拿到,不靠「記得別傳」。
 * 由 FinalizeOrderRefundArgs 判別聯合導出=單一真相、不另養一份會漂移的清單。
 */
export type SyncFinalizeOutcome = FinalizeOrderRefundArgs['outcome'];

/**
 * 呼叫端契約違反(未知碼 / 缺欄 / RPC RAISE)。員工訊息會叫他**停手**,不是「稍後再試」。
 */
export class RefundCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundCallerBugError';
  }
}

/**
 * 🔴 finalize 的「回應解析失敗」專屬子型別(RW4 關卡2 codex R2 must-fix):
 * RPC RAISE=交易**確定回滾**(零寫入);但走到回應解析才炸=RPC 已成功、交易**已 commit**、
 * 只是回傳形狀不可信 —— 兩者的員工指示相反(前者「沒寫入」/後者「可能已完成、先確認現況」),
 * 共用一個型別會讓呼叫端把已寫入說成沒寫入。子類化保持既有 `instanceof RefundCallerBugError`
 * 行為不變(同步路徑零行為差),恢復 action 先驗子型別。
 */
export class RefundFinalizeParseError extends RefundCallerBugError {
  constructor(message: string) {
    super(message);
    this.name = 'RefundFinalizeParseError';
  }
}

/**
 * 🔴 RPC 的 RAISE → `RefundCallerBugError`(A9d2-1 F4 同型判別)。
 *
 * 本呼叫路徑上的 RAISE 面:①兩 RPC 步 1-2 的輸入/互斥面(P0001)②G4 同鍵指紋不符 /
 * 已終結重放(P0001)③CAS 失敗(P0001)④帳本 trigger 守門(**自訂 SQLSTATE `P7Cxx`**,
 * `20260801120000` + RW1a 新增 —— 它們被 RPC 打中=RPC 前置沒篩到=同屬呼叫端契約面)
 * ⑤狀態機 RAISE(P0001)。全部是「停手」語意,收斂一致。
 * 前提(grep supabase/migrations 實查):orders 表唯一 trigger = `orders_freeze_shipping_snapshot_bi`
 * (BEFORE **INSERT**、`20260725120000:104-105`)⇒ G8 的 orders UPDATE 路徑上零其他 RAISE 源;
 * order_refunds 的三支 trigger 全在上列 ④⑤。
 */
function isRpcRaise(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P0001' || (typeof code === 'string' && /^P7C/.test(code));
}

function toCallerBug(fn: string, error: { message?: unknown }): RefundCallerBugError {
  return new RefundCallerBugError(
    `${fn} 拒收本次呼叫(RAISE):${String(error.message ?? '').slice(0, 200)}`,
  );
}

// ── 訂單窄讀 ────────────────────────────────────────────────────────────────

export type RefundableOrderSnapshot = {
  displayId: string;
  paymentStatus: string;
  tappayRecTradeId: string | null;
};

/** 退款前的 server 重讀(app 層縱深;RPC 的 G12/白名單/P7C02-03 仍是權威)。查無 → null。 */
export async function findOrderForRefund(
  orderId: string,
): Promise<RefundableOrderSnapshot | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('orders')
    .select('display_id, payment_status, tappay_rec_trade_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    displayId: data.display_id,
    paymentStatus: data.payment_status,
    tappayRecTradeId: data.tappay_rec_trade_id,
  };
}

// ── RPC 1:initiate ─────────────────────────────────────────────────────────

/**
 * 🔴 kind 判別聯合(關卡2 codex must-fix):RPC 的互斥是合約(弄反=RAISE,而且發生在
 * INSERT 之前=無害、但發生在呼叫端手滑時 typecheck 就該紅)——
 * partial 必帶正整數 amount + recordAmount null;full 相反(recordAmount=Record 凍結額)。
 */
export type InitiateOrderRefundArgs = {
  orderId: string;
  /** G0 baseline(Record `refunded_amount`;欄缺時 action 已 abort、不得傳 0 充數)。 */
  recordRefundedBefore: number;
  reason: string;
  actor: string;
  requestId: string;
} & (
  | { kind: 'full'; amount: null; recordAmount: number }
  | { kind: 'partial'; amount: number; recordAmount: null }
);

export type InitiateOrderRefundOutcome =
  | {
      result: 'INITIATED';
      refundId: string;
      bankRefundId: string;
      /** RPC 凍結額(full=Record 剩餘額 / partial=員工輸入);= refund() 的預期受理額。 */
      refundAmount: number;
    }
  | {
      result: 'DUPLICATE_REQUEST';
      refundId: string;
      bankRefundId: string;
      refundAmount: number;
      rowStatus: 'processing' | 'confirmed';
    }
  | {
      result:
        | 'ORDER_NOT_FOUND'
        | 'ORDER_NOT_REFUNDABLE'
        | 'ORDER_NO_CARD_TRANSACTION'
        | 'REFUND_LEDGER_FULL'
        | 'REFUND_IN_FLIGHT'
        | 'REFUND_NOTHING_LEFT';
    };

function asRecord(fn: string, data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new RefundCallerBugError(`${fn} 回傳非物件:${JSON.stringify(data)?.slice(0, 200)}`);
  }
  return data as Record<string, unknown>;
}

function requireString(fn: string, row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value === '') {
    throw new RefundCallerBugError(`${fn} 回傳缺 ${key}:${JSON.stringify(row).slice(0, 200)}`);
  }
  return value;
}

/** 凍結額必為正整數(RPC CHECK refund_amount>0 保證;非正=合約漂移,fail-loud 不放行到 refund())。 */
function requirePositiveInt(fn: string, row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RefundCallerBugError(
      `${fn} 回傳缺 ${key} 或非正整數:${JSON.stringify(row).slice(0, 200)}`,
    );
  }
  return value;
}

/**
 * 登記退款(帳先記、後打 API)。逐欄具名送、不 spread(A9d2-1 慣例;spread 繞過
 * TS 多餘屬性檢查)。RAISE → `RefundCallerBugError`;回傳逐碼驗形狀後收斂成 union。
 */
export async function initiateOrderRefund(
  args: InitiateOrderRefundArgs,
): Promise<InitiateOrderRefundOutcome> {
  const fn = 'admin_initiate_order_refund';
  const { data, error } = await createSupabaseServiceClient().rpc(fn, {
    p_order_id: args.orderId,
    p_kind: args.kind,
    p_amount: args.amount,
    p_record_refunded_before: args.recordRefundedBefore,
    p_record_amount: args.recordAmount,
    p_reason: args.reason,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });
  if (error) {
    if (isRpcRaise(error)) throw toCallerBug(fn, error);
    throw error;
  }
  const row = asRecord(fn, data);
  const result = row.result;
  if (typeof result !== 'string' || !(INITIATE_RESULT_CODES as readonly string[]).includes(result)) {
    throw new RefundCallerBugError(`${fn} 回傳非預期碼:${JSON.stringify(result)}`);
  }
  if (result === 'INITIATED') {
    return {
      result,
      refundId: requireString(fn, row, 'refund_id'),
      bankRefundId: requireString(fn, row, 'bank_refund_id'),
      refundAmount: requirePositiveInt(fn, row, 'refund_amount'),
    };
  }
  if (result === 'DUPLICATE_REQUEST') {
    const rowStatus = requireString(fn, row, 'status');
    if (rowStatus !== 'processing' && rowStatus !== 'confirmed') {
      // G4 只對 processing/confirmed 回 DUPLICATE(終結列是 RAISE);出現其他值=合約漂移。
      throw new RefundCallerBugError(`${fn} DUPLICATE_REQUEST 帶非預期 status:${rowStatus}`);
    }
    return {
      result,
      refundId: requireString(fn, row, 'refund_id'),
      bankRefundId: requireString(fn, row, 'bank_refund_id'),
      refundAmount: requirePositiveInt(fn, row, 'refund_amount'),
      rowStatus,
    };
  }
  return { result: result as Exclude<InitiateResultCode, 'INITIATED' | 'DUPLICATE_REQUEST'> };
}

// ── RPC 2:finalize ─────────────────────────────────────────────────────────

/**
 * 🔴 outcome 判別聯合(關卡2 codex must-fix;鏡像 RPC 步 2 的參數矩陣):
 * accepted 必帶 wire refundId + wire 金額(G7 比對);deferred 全 null;
 * rejected/not_sent 只可帶診斷文字(≤500;呼叫端碼位截 450 留餘裕)。
 * 非法組合(如 deferred 帶 refundId)在編譯期就紅,不等 RPC RAISE。
 */
export type FinalizeOrderRefundArgs = {
  refundId: string;
  actor: string;
  requestId: string;
} & (
  | { outcome: 'accepted'; tappayRefundId: string; refundAmountWire: number; failedDetail: null }
  | {
      outcome: 'deferred_not_captured';
      tappayRefundId: null;
      refundAmountWire: null;
      failedDetail: null;
    }
  | {
      outcome: 'rejected_out_of_range' | 'not_sent';
      tappayRefundId: null;
      refundAmountWire: null;
      failedDetail: string | null;
    }
);

export type FinalizeOrderRefundOutcome =
  | { result: 'FINALIZED'; statusAfter: string; paymentStatusAfter: string }
  | { result: 'HELD_AMOUNT_MISMATCH'; statusAfter: string; paymentStatusAfter: string }
  | { result: 'REFUND_NOT_FOUND' };

/**
 * 🔴 RW4 恢復出口專用判別聯合(鏡像 RPC 步 2 矩陣的恢復半邊):
 * recovered_confirmed 必帶 Portal 真 DR 碼(P7C09/P7C13 由 DB 收口);
 * manual_failed 必帶含 Record 證據數字的 failed_detail。
 * 與 `FinalizeOrderRefundArgs`(同步四碼)刻意分型 —— 同步 action 拿不到恢復碼、
 * 恢復 action 拿不到同步碼,「記得別傳」不是防護,型別才是。
 */
export type RecoveryFinalizeArgs = {
  refundId: string;
  actor: string;
  requestId: string;
} & (
  | { outcome: 'recovered_confirmed'; tappayRefundId: string; failedDetail: null }
  | { outcome: 'manual_failed'; tappayRefundId: null; failedDetail: string }
);

/** 結案。unknown-state **沒有對應 outcome** —— 呼叫端不得為它呼本函式(列留 processing 走 RW4)。 */
export async function finalizeOrderRefund(
  args: FinalizeOrderRefundArgs,
): Promise<FinalizeOrderRefundOutcome> {
  return callFinalizeRpc({
    refundId: args.refundId,
    outcome: args.outcome,
    tappayRefundId: args.tappayRefundId,
    refundAmountWire: args.refundAmountWire,
    failedDetail: args.failedDetail,
    actor: args.actor,
    requestId: args.requestId,
  });
}

/** RW4 人工結案(判定閘在 action 端:送出當下重判、判定不符不得呼到這裡)。 */
export async function finalizeRecoveryOrderRefund(
  args: RecoveryFinalizeArgs,
): Promise<FinalizeOrderRefundOutcome> {
  return callFinalizeRpc({
    refundId: args.refundId,
    outcome: args.outcome,
    tappayRefundId: args.tappayRefundId,
    // 恢復路徑不帶 wire 金額(RPC 步 2:accepted 以外帶了就 RAISE)。
    refundAmountWire: null,
    failedDetail: args.failedDetail,
    actor: args.actor,
    requestId: args.requestId,
  });
}

/** 兩個出口共用的唯一 wire 點(參數矩陣已由上面兩個判別聯合各自釘死)。 */
async function callFinalizeRpc(params: {
  refundId: string;
  outcome: string;
  tappayRefundId: string | null;
  refundAmountWire: number | null;
  failedDetail: string | null;
  actor: string;
  requestId: string;
}): Promise<FinalizeOrderRefundOutcome> {
  const fn = 'admin_finalize_order_refund';
  const { data, error } = await createSupabaseServiceClient().rpc(fn, {
    p_refund_id: params.refundId,
    p_outcome: params.outcome,
    p_tappay_refund_id: params.tappayRefundId,
    p_refund_amount_wire: params.refundAmountWire,
    p_failed_detail: params.failedDetail,
    p_actor: params.actor,
    p_request_id: params.requestId,
  });
  if (error) {
    if (isRpcRaise(error)) throw toCallerBug(fn, error);
    throw error;
  }
  // 🔴 自此交易已 commit —— 解析失敗一律升為 RefundFinalizeParseError(見 class 註解)。
  try {
    const row = asRecord(fn, data);
    const result = row.result;
    if (
      typeof result !== 'string' ||
      !(FINALIZE_RESULT_CODES as readonly string[]).includes(result)
    ) {
      throw new RefundCallerBugError(`${fn} 回傳非預期碼:${JSON.stringify(result)}`);
    }
    if (result === 'REFUND_NOT_FOUND') return { result };
    return {
      result: result as 'FINALIZED' | 'HELD_AMOUNT_MISMATCH',
      statusAfter: requireString(fn, row, 'status_after'),
      paymentStatusAfter: requireString(fn, row, 'payment_status_after'),
    };
  } catch (parseError) {
    if (parseError instanceof RefundCallerBugError) {
      throw new RefundFinalizeParseError(parseError.message);
    }
    throw parseError;
  }
}
