import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// incident-repository.ts — 後台事故紀錄頁的讀取層(稽核 P2-7;plan docs/plans/2026-09-15-admin-incident-list-plan.md §4-B)
//
// 🔴 **不能 `.from('pcm_incident')`**:那張表連 service_role 都 REVOKE(20260905290000:137-161)⇒ 會回 42501。
//    唯一的門是 `admin_list_pcm_incidents(p_limit, p_open_only)`(20260916040000),EXECUTE 只給 service_role。
// 🔴 **`as never` 的理由與代價同 `lib/payment/manual-refund-read.ts`**:`database.types.ts` 沒有這支函式,
//    而手動補型別會讓那份「沒重 gen 過的清單」開始說謊 ⇒ 改由 `incident-repository.test.ts` 釘函式名與參數名。
// 🔴 **錯誤 throw、不回 `[]`**:回 `[]` 會讓頁面印「目前沒有未處理的事故」—— 讀不到與沒有事故長得一樣,就會騙人。

export type IncidentRow = {
  readonly id: string;
  readonly kind: string;
  readonly subjectId: string | null;
  readonly detail: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
};

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
  };
}

/** 最近的事故。`openOnly = true` 只回未處理(`resolved_at IS NULL`)。筆數上限由 DB 夾在 1..200。 */
export async function listRecentIncidents(limit: number, openOnly: boolean): Promise<IncidentRow[]> {
  const { data, error } = (await createSupabaseServiceClient().rpc(
    'admin_list_pcm_incidents' as never,
    { p_limit: limit, p_open_only: openOnly } as never,
  )) as { data: unknown; error: unknown };
  if (error) throw error;
  if (!Array.isArray(data)) {
    throw new Error('admin_list_pcm_incidents 回傳不是陣列 ⇒ 不當成空的,整頁走讀取失敗');
  }
  return data.map(toRow);
}
