import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isUuid } from '../orders/note-action-state';
import type { ManualRefundVoidFailureCode } from './manual-refund-void-action-state';

// manual-refund-void-repository.ts — M-4b E10 片 D3-c:admin_void_manual_refund 的唯一呼叫端。
//
// 🔴 本層不 throw、只回傳(逐字同 manual-refund-repository.ts 的理由):
//    action 的主流程因此不需要包 try,「成功的 redirect() 被 catch 吞掉」那個坑結構上不存在。
//
// 🔴 稽核由 RPC 同交易寫,本層不碰 admin_audit_log。
//
// 🔴 **沒有 request_id 參數** —— 那是 D3-b 的設計,不是漏傳(見 action-state 檔頭)。

export interface VoidManualRefundArgs {
  refundId: string;
  reason: string;
  actor: string;
}

export type VoidManualRefundOutcome =
  | { ok: true; refundId: string; idempotent: boolean }
  | {
      ok: false;
      code: ManualRefundVoidFailureCode;
      sqlstate: string | null;
      /** 已截 200 字、不含 details/hint,呼叫端記 log 用。 */
      logMessage: string;
      /** 僅 code==='rejected' 時有值:RPC 的 message 原文,action 層顯示給員工用。 */
      staffMessage: string | null;
    };

/**
 * SQLSTATE → 失敗碼。🔴 用 Map 不用物件字面(memory `reference_js-index-lookup-hits-prototype-chain`)。
 */
const SQLSTATE_CLASSIFICATION = new Map<string, ManualRefundVoidFailureCode>([
  ['P0001', 'rejected'], // D3-b 全部業務 RAISE 走這條(該檔零 USING ERRCODE)
  // 🔴 40001 = could not serialize access。D3-b 的 COMMENT 自己宣告了這一條路徑存在
  //    (REPEATABLE READ 之下冪等分支走不到)⇒ 分出來,不要落成一句無意義的 bug。
  ['40001', 'conflict'],
  ['40P01', 'conflict'], // deadlock_detected:同一族「重讀一次再決定」的處置
  ['42501', 'bug'], // ACL 被撤 ⇒ 這片的 GRANT migration 被 rollback 了
  ['PGRST202', 'bug'], // 簽章漂移 / 找不到函式
  ['23514', 'bug'], // 表 CHECK(order_manual_refunds_void_trio)被觸發而 RPC 沒攔到 = 漂移
]);

/** 成功 payload 的鍵集合(D3-b:jsonb_build_object('voided', true, 'idempotent', <bool>, 'refund_id', <uuid>))。 */
const SUCCESS_PAYLOAD_KEYS = 'idempotent,refund_id,voided';

function parseSuccessPayload(data: unknown): { refundId: string; idempotent: boolean } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.keys(data).sort().join(',') !== SUCCESS_PAYLOAD_KEYS) return null;
  const row = data as Record<string, unknown>;
  if (row.voided !== true) return null;
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
 * 把一筆非卡退款登記標成作廢。**永不 throw**;所有失敗都收斂成 `ok: false`。
 *
 * 🔴 拋出型失敗一律歸 `error`(同登記那半的理由):supabase-js 對 PostgREST 的錯誤是**回傳**的,
 *    會拋的是傳輸層/環境層失敗 —— 那正是「請求可能已經到 PG 並 commit,只是回應斷在路上」。
 *    ⚠️ 而作廢**沒有冪等鍵**可以讓員工「用同一張表單重送」⇒ `error` 的員工訊息不能照抄登記那半,
 *       要叫他**先重新整理看現況**(見 action-state 的 FAILURE_MESSAGES.error)。
 */
export async function voidManualRefund(
  args: VoidManualRefundArgs,
): Promise<VoidManualRefundOutcome> {
  // 🔴 refundId 先過 uuid 閘(Fable R2 nit F6):不過就直接落 `bug`。
  //    少了它,一個永遠寫不進去的輸入會拿到 22P02 ⇒ 不在分類表 ⇒ 落 `error`
  //    ⇒ 員工看到的是「它可能已經寫進去了,先重新整理看現況」——**對一個絕不可能寫進去的請求。**
  //    ⚠️ 這不是防線(RPC 的參數型別才是),它只是不要把一個確定的失敗說成一個不確定的失敗。
  if (!isUuid(args.refundId)) {
    return {
      ok: false,
      code: 'bug',
      sqlstate: null,
      logMessage: `refundId 不是 uuid,沒有送出 RPC:${args.refundId.slice(0, 64)}`,
      staffMessage: null,
    };
  }

  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await createSupabaseServiceClient().rpc('admin_void_manual_refund', {
      p_refund_id: args.refundId,
      p_void_reason: args.reason,
      p_actor: args.actor,
    }));
  } catch (thrown) {
    return { ok: false, code: 'error', sqlstate: null, logMessage: summarize(thrown), staffMessage: null };
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
      logMessage: `admin_void_manual_refund 回傳形狀漂移:${describeShape(data)}`,
      staffMessage: null,
    };
  }
  return { ok: true, ...payload };
}
