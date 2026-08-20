import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isUuid } from '../orders/note-action-state';
import type { ManualRefundFailureCode } from './manual-refund-action-state';
import type { ManualRefundRail } from './manual-refund-form';

// manual-refund-repository.ts — M-4b E10 D3:admin_record_manual_refund owner RPC 的唯一呼叫端。
//
// 🔴 本層不 throw、只回傳(同 cancel-repository.ts 的刻意選擇,理由逐字同款):
//    action 的主流程因此不需要包 try,「成功的 redirect() 被 catch 吞掉」那個坑在結構上不存在。
//
// 🔴 稽核由 RPC 同交易寫(D1 header 段自陳),本層不碰 admin_audit_log。
//
// 🔴 **分類依 SQLSTATE、不解析 RPC message 的內容**——業務 RAISE 全部落 P0001(見
//    manual-refund-action-state.ts 檔頭的說明);`rejected` 這一格額外把 message 原樣帶出去
//    (`staffMessage`),讓 action 層決定要不要顯示給員工(D1 的每句 RAISE 本身就是寫給員工看的)。

export interface RecordManualRefundArgs {
  orderId: string;
  rail: ManualRefundRail;
  refundAmount: number;
  reason: string;
  /** ISO 字串。 */
  occurredAt: string;
  actor: string;
  /** 冪等鍵 = 表單帶回的一次性 token。 */
  requestId: string;
}

export type RecordManualRefundOutcome =
  | { ok: true; refundId: string; idempotent: boolean }
  | {
      ok: false;
      code: ManualRefundFailureCode;
      sqlstate: string | null;
      /** 已截 200 字、不含 details/hint,呼叫端記 log 用。 */
      logMessage: string;
      /** 僅 code==='rejected' 時有值:RPC 的 message 原文,action 層顯示給員工用。 */
      staffMessage: string | null;
    };

/**
 * SQLSTATE → 失敗碼。🔴 用 Map 不用物件字面(memory `reference_js-index-lookup-hits-prototype-chain`,
 * 同 cancel-repository.ts 的理由)。
 */
const SQLSTATE_CLASSIFICATION = new Map<string, ManualRefundFailureCode>([
  ['P8C01', 'bug'], // 隔離閘(部署面設定錯)
  ['P0001', 'rejected'], // D1 全部業務 RAISE 走這條(檔頭已確認無其他顯式 ERRCODE)
  ['23514', 'bug'], // 表 CHECK 被觸發卻沒被 RPC 自己的 IF 攔到 = RPC 與表定義漂移
  ['23505', 'bug'], // UNIQUE(order_id, request_id):RPC 自己有冪等檢查,不預期還會冒出這個
  ['42501', 'bug'], // ACL 被撤
  ['PGRST202', 'bug'], // 簽章漂移 / 找不到函式
]);

/** 成功 payload 的鍵集合(D1 §7:jsonb_build_object('recorded', true, 'idempotent', <bool>, 'refund_id', <uuid>))。 */
const SUCCESS_PAYLOAD_KEYS = 'idempotent,recorded,refund_id';

function parseSuccessPayload(data: unknown): { refundId: string; idempotent: boolean } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).sort().join(',') !== SUCCESS_PAYLOAD_KEYS) return null;
  const row = data as Record<string, unknown>;
  if (row.recorded !== true) return null;
  if (typeof row.refund_id !== 'string' || !isUuid(row.refund_id)) return null;
  if (typeof row.idempotent !== 'boolean') return null;
  return { refundId: row.refund_id, idempotent: row.idempotent };
}

function describeShape(data: unknown): string {
  if (typeof data !== 'object' || data === null) return `<${data === null ? 'null' : typeof data}>`;
  if (Array.isArray(data)) return `<array len=${data.length}>`;
  const entries = Object.entries(data)
    .map(([key, value]) => `${key}:${value === null ? 'null' : typeof value}`)
    .sort();
  return `{${entries.join(',')}}`.slice(0, 200);
}

/** 只取 message 前 200 字,不碰 details/hint(它們會帶整列內容)。 */
function summarize(value: unknown): string {
  return String((value as { message?: unknown } | null)?.message ?? '').slice(0, 200);
}

/**
 * 登記一筆非卡退款。**永不 throw**;所有失敗都收斂成 `ok: false`。
 *
 * 🔴 拋出型失敗一律歸 `error`(同 cancel-repository.ts 的理由):supabase-js 對 PostgREST
 * 的錯誤是回傳的,會拋的是傳輸層/環境層失敗 —— 那正是「請求可能已經到 PG 並 commit,只是
 * 回應斷在路上」,與 `error` 的員工訊息「可能已經寫進去了、用同一張表單重試會被冪等鍵認出」語意一致。
 */
export async function recordManualRefund(
  args: RecordManualRefundArgs,
): Promise<RecordManualRefundOutcome> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await createSupabaseServiceClient().rpc('admin_record_manual_refund', {
      p_order_id: args.orderId,
      p_request_id: args.requestId,
      p_actor: args.actor,
      p_rail: args.rail,
      p_refund_amount: args.refundAmount,
      p_reason: args.reason,
      p_occurred_at: args.occurredAt,
    }));
  } catch (thrown) {
    return {
      ok: false,
      code: 'error',
      sqlstate: null,
      logMessage: summarize(thrown),
      staffMessage: null,
    };
  }

  if (error) {
    const raw = (error as { code?: unknown }).code;
    const sqlstate = typeof raw === 'string' ? raw : null;
    const code = (sqlstate !== null && SQLSTATE_CLASSIFICATION.get(sqlstate)) || 'error';
    const message = summarize(error);
    return {
      ok: false,
      code,
      sqlstate,
      logMessage: message,
      staffMessage: code === 'rejected' && message !== '' ? message : null,
    };
  }

  const payload = parseSuccessPayload(data);
  if (payload === null) {
    return {
      ok: false,
      code: 'bug',
      sqlstate: null,
      logMessage: `admin_record_manual_refund 回傳形狀漂移:${describeShape(data)}`,
      staffMessage: null,
    };
  }

  return { ok: true, ...payload };
}
