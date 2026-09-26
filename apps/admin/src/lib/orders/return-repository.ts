// 退貨收回(第 2 片):呼叫 20260927010000 的三支資料庫函式。形狀照 payment/manual-refund-repository.ts。
// 🔴 永不 throw:所有失敗都收成 { ok:false }。錯誤只依 SQLSTATE 分類, 不解析訊息內容;
//    只有 rejected(P0001, 函式自己 RAISE 的業務句)會把原句給員工看 —— 那些句子本來就是寫給員工的
//    (例如「退貨數量超過可退數量(已出貨 2 件…)」), 換成罐頭文字會弄丟具體數字。
import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isUuid } from './note-action-state';
import type { ReturnFailureCode } from './return-action-state';
import type { ReturnCondition, ReturnReasonCode } from './return-view';

export type ReturnOutcome =
  | { ok: true; returnId: string; idempotent: boolean }
  | { ok: false; code: ReturnFailureCode; sqlstate: string | null; logMessage: string; staffMessage: string | null };

// Map 而不是物件字面:防 'constructor' 這類 key 從原型鏈命中(同 manual-refund-repository.ts)。
const SQLSTATE_CLASSIFICATION = new Map<string, ReturnFailureCode>([
  ['P0001', 'rejected'], // 三支函式自己的 RAISE EXCEPTION(預設 SQLSTATE)
  ['23514', 'bug'], // 表 CHECK 被觸發卻沒被函式自己的 IF 攔到 ⇒ 函式與表定義漂移
  ['23505', 'bug'],
  ['23503', 'bug'],
  ['22003', 'bug'],
  ['42501', 'bug'], // 權限被撤
  ['PGRST202', 'bug'], // 找不到函式 / 簽章漂移
  ['42P01', 'bug'],
  ['42883', 'bug'],
  ['42703', 'bug'],
  ['55P03', 'error'], // 鎖等候逾時(lock_timeout 5s):別人同時在動這張單, 狀態沒變
]);

function summarize(value: unknown): string {
  return String((value as { message?: unknown } | null)?.message ?? '').slice(0, 200);
}

function parseSuccess(data: unknown): { returnId: string; idempotent: boolean } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).sort().join(',') !== 'idempotent,return_id') return null;
  const row = data as Record<string, unknown>;
  if (typeof row.return_id !== 'string' || !isUuid(row.return_id)) return null;
  if (typeof row.idempotent !== 'boolean') return null;
  return { returnId: row.return_id, idempotent: row.idempotent };
}

type ReturnRpc = 'admin_register_return' | 'admin_receive_return' | 'admin_void_return';

async function call(fn: ReturnRpc, params: Record<string, unknown>): Promise<ReturnOutcome> {
  let data: unknown;
  let error: unknown;
  try {
    // 生成型別把選填參數標成 string(不含 null), 而三支函式都接受 NULL(函式內 nullif / btrim 處理)⇒ 這裡放寬一次。
    ({ data, error } = await createSupabaseServiceClient().rpc(fn, params as never));
  } catch (thrown) {
    return { ok: false, code: 'error', sqlstate: null, logMessage: summarize(thrown), staffMessage: null };
  }
  if (error) {
    const raw = (error as { code?: unknown }).code;
    const sqlstate = typeof raw === 'string' ? raw : null;
    const code = (sqlstate !== null && SQLSTATE_CLASSIFICATION.get(sqlstate)) || 'error';
    const message = summarize(error);
    return { ok: false, code, sqlstate, logMessage: message, staffMessage: code === 'rejected' && message !== '' ? message : null };
  }
  const payload = parseSuccess(data);
  if (payload === null) {
    return { ok: false, code: 'bug', sqlstate: null, logMessage: `${fn} 回傳形狀不對`, staffMessage: null };
  }
  return { ok: true, ...payload };
}

export function registerReturn(args: {
  orderId: string;
  requestId: string;
  actor: string;
  reasonCode: ReturnReasonCode;
  reasonDetail: string | null;
  note: string | null;
  trackingNumber: string | null;
  items: readonly { orderItemId: string; quantity: number }[];
}): Promise<ReturnOutcome> {
  return call('admin_register_return', {
    p_order_id: args.orderId,
    p_idempotency_key: args.requestId,
    p_actor: args.actor,
    p_reason_code: args.reasonCode,
    p_reason_detail: args.reasonDetail,
    p_note: args.note,
    p_tracking_number: args.trackingNumber,
    p_items: args.items.map((i) => ({ order_item_id: i.orderItemId, quantity: i.quantity })),
  });
}

export function receiveReturn(args: {
  returnId: string;
  requestId: string;
  actor: string;
  note: string | null;
  items: readonly { orderItemId: string; receivedQuantity: number; condition: ReturnCondition | null }[];
}): Promise<ReturnOutcome> {
  return call('admin_receive_return', {
    p_return_id: args.returnId,
    p_request_id: args.requestId,
    p_actor: args.actor,
    p_note: args.note,
    p_items: args.items.map((i) => ({
      order_item_id: i.orderItemId,
      received_quantity: i.receivedQuantity,
      condition: i.condition,
    })),
  });
}

export function voidReturn(args: {
  returnId: string;
  requestId: string;
  actor: string;
  voidReason: string;
}): Promise<ReturnOutcome> {
  return call('admin_void_return', {
    p_return_id: args.returnId,
    p_request_id: args.requestId,
    p_actor: args.actor,
    p_void_reason: args.voidReason,
  });
}
