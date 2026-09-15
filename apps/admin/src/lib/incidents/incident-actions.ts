'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { reopenIncident, resolveIncident } from './incident-repository';
import { INCIDENT_FIELD, INCIDENT_TEXT_MAX, type IncidentResultCode } from './incident-result-messages';

// incident-actions.ts — 事故紀錄頁「標記已處理 / 取消已處理」server action
// plan docs/plans/2026-09-15-incident-mark-resolved-plan.md §4-B;DB 20260916080000。
// 形狀抄 `supplier-actions.ts`:①授權閘 → ②解析 → ③repository → ④PRG redirect。
//
// 🔴 **授權走 `authorizeAdminMutation`(所有在職員工)** —— Sean 2026-09-15 Q1 乙。DB 那層也只驗在職(同一句話的兩層)。
// 🔴 **本檔沒有稽核碼**:RPC 在同一個交易裡寫 `admin_audit_log`。
// 🔴 **actor 不是經過驗證的身分**(`session/actor.ts`):稽核上的處理人是自陳的。
// 🔴 redirect 目標只有兩個寫死的網址(`view` 只認 `all`)⇒ 沒有 open-redirect 面。

const PATH = '/settings/incidents';

function redirectWith(code: IncidentResultCode, view: FormDataEntryValue | null): never {
  redirect(view === 'all' ? `${PATH}?all=1&r=${code}` : `${PATH}?r=${code}`);
}

function parseId(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** 與 DB `[[:cntrl:]]` 同範圍:C0、DEL、C1。 */
function hasControlChar(s: string): boolean {
  return [...s].some((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n < 0x20 || n === 0x7f || (n >= 0x80 && n <= 0x9f);
  });
}

/** 選填 / 必填文字共用:trim 後空 ⇒ null;超長或含控制字元 ⇒ 'invalid'。 */
function parseText(raw: FormDataEntryValue | null): string | null | 'invalid' {
  if (raw === null) return null;
  if (typeof raw !== 'string') return 'invalid';
  const s = raw.trim();
  if (s === '') return null;
  if ([...s].length > INCIDENT_TEXT_MAX || hasControlChar(s)) return 'invalid';
  return s;
}

/** DB 丟回來的錯分流。「無權執行此操作」重按也不會過 ⇒ denied,不叫員工再試。 */
function classifyError(tag: string, requestId: string, error: unknown): IncidentResultCode {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.code === 'P0001') {
    if (message === '無權執行此操作') {
      console.warn(`${tag} —— DB 身分閘拒絕`, { request_id: requestId });
      return 'denied';
    }
    if (message.endsWith('缺原因')) return 'reason_required';
    if (message.endsWith('說明非法') || message.endsWith('原因非法')) return 'invalid';
  }
  console.error(tag, {
    request_id: requestId,
    code: typeof e.code === 'string' ? e.code : undefined,
    message: message.slice(0, 200),
  });
  return 'error';
}

export async function resolveIncidentAction(formData: FormData): Promise<void> {
  const view = formData.get(INCIDENT_FIELD.view);

  // ① 授權閘
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied', view);

  // ② 解析(說明選填,Sean Q2 乙)
  const id = parseId(formData.get(INCIDENT_FIELD.id));
  const note = parseText(formData.get(INCIDENT_FIELD.note));
  if (id === null || note === 'invalid') redirectWith('invalid', view);

  const requestId = await getRequestId();
  // log 不記說明全文
  console.info('[admin/settings/incidents] incident.resolve.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    incident_id: id,
  });

  // ③ 寫入
  let code: IncidentResultCode;
  try {
    const result = await resolveIncident({ id, actor: authorization.actorId, requestId, note });
    code = result === 'not_found' ? 'notfound' : result;
  } catch (error) {
    code = classifyError('[admin/settings/incidents] 標記已處理失敗', requestId, error);
  }

  // ④ PRG
  revalidatePath(PATH);
  redirectWith(code, view);
}

export async function reopenIncidentAction(formData: FormData): Promise<void> {
  const view = formData.get(INCIDENT_FIELD.view);

  // ① 授權閘(Sean Q3「權限一樣」)
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied', view);

  // ② 解析(原因必填,Sean Q3「要寫原因」;空的在這裡就擋、不打 RPC,DB 那層照樣再擋一次)
  const id = parseId(formData.get(INCIDENT_FIELD.id));
  const reason = parseText(formData.get(INCIDENT_FIELD.reason));
  if (id === null || reason === 'invalid') redirectWith('invalid', view);
  if (reason === null) redirectWith('reason_required', view);

  const requestId = await getRequestId();
  console.info('[admin/settings/incidents] incident.reopen.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    incident_id: id,
  });

  let code: IncidentResultCode;
  try {
    const result = await reopenIncident({ id, actor: authorization.actorId, requestId, reason });
    code = result === 'not_found' ? 'notfound' : result;
  } catch (error) {
    code = classifyError('[admin/settings/incidents] 取消已處理失敗', requestId, error);
  }

  revalidatePath(PATH);
  redirectWith(code, view);
}
