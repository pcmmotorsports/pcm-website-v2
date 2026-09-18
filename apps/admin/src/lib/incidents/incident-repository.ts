import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// incident-repository.ts — 後台事故紀錄頁的讀寫層
//   讀:稽核 P2-7(plan docs/plans/2026-09-15-admin-incident-list-plan.md §4-B)
//   寫:標記已處理 / 取消已處理(plan docs/plans/2026-09-15-incident-mark-resolved-plan.md §4-B;DB 20260916080000)
//
// 🔴 **不能 `.from('pcm_incident')`**:那張表連 service_role 都 REVOKE(20260905290000:137-161)⇒ 會回 42501。
//    門只有三支 definer 函式,EXECUTE 只給 service_role:
//    `admin_list_pcm_incidents` / `admin_resolve_pcm_incident` / `admin_reopen_pcm_incident`。
// ⛔ ~~**`as never` 的理由與代價同 `lib/payment/manual-refund-read.ts`**:`database.types.ts` 沒有這幾支函式,~~
// ⛔ ~~   而手動補型別會讓那份「沒重 gen 過的清單」開始說謊 ⇒ 改由 `incident-repository.test.ts` 釘函式名與參數名。~~
// 🟢 **2026-09-18:那個理由到期了 —— 整支型別檔重 gen 過, 這三支函式都在 `Database` 裡了。**
//    ⇒ 三處 `as never`(函式名 + 參數物件)全部拆掉, **函式名與參數名回到 typecheck 管轄。**
//    🔴 而拆的時候才發現這裡原本只有函式名那半被想到過:`admin_resolve_pcm_incident.p_note`
//       送的是 `string | null` 而生成型別是 `string` ⇒ 補進檔頭 ㉞。
//       📌 **拆一半的逃生口,看起來像拆過了。**
//    🔵 `incident-repository.test.ts` 那道字面守門**留著** —— 它守的是「參數名有沒有被改掉」,
//       與型別守的不是同一件事(型別只管形狀對不對, 不管有沒有人偷偷換名字又同步改了兩邊)。
// 🔴 **錯誤 throw、不回 `[]`**:回 `[]` 會讓頁面印「目前沒有未處理的事故」—— 讀不到與沒有事故長得一樣,就會騙人。
// 🔴 **稽核在 RPC 同一個交易裡寫**(`admin_audit_log` incident.resolve / incident.reopen)⇒ 本檔與 action 都沒有稽核碼。

export type IncidentRow = {
  readonly id: string;
  readonly kind: string;
  readonly subjectId: string | null;
  readonly detail: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  /** 按「標記已處理」的員工 staff.id(自陳身分,見 DB 函式註解) */
  readonly resolvedBy: string | null;
  /** 標記已處理時寫的說明(選填) */
  readonly resolutionNote: string | null;
};

export type ResolveIncidentResult = 'resolved' | 'already' | 'not_found';
export type ReopenIncidentResult = 'reopened' | 'already_open' | 'superseded' | 'not_found';

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

function toRow(raw: unknown, index: number): IncidentRow {
  const r = raw as Record<string, unknown> | null;
  const id = r?.id;
  // bigint 經 PostgREST 可能是 number 或 string ⇒ 兩種都收,一律轉字串當 key(不做算術)
  const idOk = (typeof id === 'number' && Number.isSafeInteger(id)) || (typeof id === 'string' && /^\d+$/.test(id));
  if (
    !r
    || !idOk
    || typeof r.kind !== 'string'
    || !isNullableString(r.subject_id)
    || typeof r.detail !== 'string'
    || typeof r.created_at !== 'string'
    || !isNullableString(r.resolved_at)
    // 🔴 舊一代函式(20260916040000)沒有這兩欄 ⇒ undefined ⇒ 這裡 throw ⇒ 整頁走讀取失敗。
    //    那正是「板先貼、程式後合」要擋的世界,不要改成 `?? null` 把它蓋掉。
    || !isNullableString(r.resolved_by)
    || !isNullableString(r.resolution_note)
  ) {
    throw new Error(`admin_list_pcm_incidents 第 ${index} 列形狀不對 ⇒ 不當成空的,整頁走讀取失敗`);
  }
  return {
    id: String(id),
    kind: r.kind,
    subjectId: r.subject_id,
    detail: r.detail,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
    resolutionNote: r.resolution_note,
  };
}

/** 最近的事故。`openOnly = true` 只回未處理(`resolved_at IS NULL`)。筆數上限由 DB 夾在 1..200。 */
export async function listRecentIncidents(limit: number, openOnly: boolean): Promise<IncidentRow[]> {
  const { data, error } = (await createSupabaseServiceClient().rpc(
    'admin_list_pcm_incidents',
    { p_limit: limit, p_open_only: openOnly },
  )) as { data: unknown; error: unknown };
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error('admin_list_pcm_incidents 回傳不是陣列 ⇒ 不當成空的,整頁走讀取失敗');
  }
  return data.map(toRow);
}

/** RPC 回 `{"result": "<碼>"}`;碼不在名單上 ⇒ throw(不當成功)。 */
function resultOf<T extends string>(fn: string, data: unknown, allowed: readonly T[]): T {
  const result = (data as { result?: unknown } | null)?.result;
  if (typeof result === 'string' && (allowed as readonly string[]).includes(result)) return result as T;
  throw new Error(`${fn} 回了不認得的結果 ⇒ 不當成功`);
}

/** 標記已處理。DB 驗在職員工;說明選填(空字串由 DB 存成 NULL)。錯誤(含「無權執行此操作」)原樣 throw。 */
export async function resolveIncident(input: {
  id: number;
  actor: string;
  requestId: string;
  note: string | null;
}): Promise<ResolveIncidentResult> {
  const { data, error } = (await createSupabaseServiceClient().rpc(
    'admin_resolve_pcm_incident',
    { p_id: input.id, p_actor: input.actor, p_request_id: input.requestId, p_note: input.note },
  )) as { data: unknown; error: unknown };
  if (error) throw error;
  return resultOf('admin_resolve_pcm_incident', data, ['resolved', 'already', 'not_found'] as const);
}

/** 取消已處理。原因必填(DB 再擋一次);系統已記了較新的一筆 ⇒ `superseded`。 */
export async function reopenIncident(input: {
  id: number;
  actor: string;
  requestId: string;
  reason: string;
}): Promise<ReopenIncidentResult> {
  const { data, error } = (await createSupabaseServiceClient().rpc(
    'admin_reopen_pcm_incident',
    { p_id: input.id, p_actor: input.actor, p_request_id: input.requestId, p_reason: input.reason },
  )) as { data: unknown; error: unknown };
  if (error) throw error;
  return resultOf('admin_reopen_pcm_incident', data, ['reopened', 'already_open', 'superseded', 'not_found'] as const);
}
