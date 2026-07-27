'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from './audit/context';
import type { AuditEntry } from './audit/types';
import { getAdminAuditLogRepository } from './orders/order-repository';
import { authorizeAdminMutation } from './session/authorize';
import {
  insertStaffRow,
  listStaffRows,
  setStaffActiveRow,
  updateStaffProfileRow,
  type StaffRow,
} from './staff-repository';
import {
  parseStaffActiveForm,
  parseStaffCreateForm,
  parseStaffProfileForm,
} from './staff-form';

// E8-A2 員工管理 action。actor 仍是使用者自行選擇,本片不把它描述成身分驗證。
// 固定 redirect 回單一設定頁,無 return_to / open-redirect 面。

const SETTINGS_PATH = '/settings/staff';

// sean 是既有、不可改名的穩定 seed 與老闆救援身分;DB 又未授予 DELETE。
// 在不新增 migration 的前提下,以永不允許停用 sean 取代非原子「最後一人」快照檢查。
const BREAK_GLASS_STAFF_ID = 'sean';

type ResultCode =
  | 'saved'
  | 'audit_failed'
  | 'notfound'
  | 'invalid'
  | 'denied'
  | 'error';

function redirectWith(code: ResultCode): never {
  redirect(`${SETTINGS_PATH}?r=${code}`);
}

function logDatabaseError(
  message: string,
  requestId: string,
  error: unknown,
): void {
  const summary = error as { code?: unknown; message?: unknown };
  console.error(message, {
    request_id: requestId,
    code: typeof summary.code === 'string' ? summary.code : undefined,
    message: String(summary.message ?? '').slice(0, 200),
  });
}

async function recordStaffAudit(
  entry: AuditEntry,
  context: { actor: string; requestId: string },
): Promise<boolean> {
  try {
    await getAdminAuditLogRepository().record(entry, {
      actor: context.actor,
      requestId: context.requestId,
      sourceApp: 'admin',
    });
    return true;
  } catch (error) {
    console.error(
      '[admin/settings/staff] 稽核寫入失敗(員工變更已生效)',
      {
        request_id: context.requestId,
        message: String(
          (error as { message?: unknown }).message ?? '',
        ).slice(0, 200),
      },
    );
    return false;
  }
}

function finishMutation(auditRecorded: boolean): never {
  revalidatePath(SETTINGS_PATH);
  redirectWith(auditRecorded ? 'saved' : 'audit_failed');
}

export async function createStaffAction(formData: FormData): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseStaffCreateForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  console.info('[admin/settings/staff] staff.create.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.input.id,
  });

  // ③ 寫入。
  let inserted: StaffRow | 'DUPLICATE';
  try {
    inserted = await insertStaffRow({
      id: parsed.input.id,
      label: parsed.input.label,
      is_manager: parsed.input.isManager,
    });
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工新增失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }
  if (inserted === 'DUPLICATE') redirectWith('invalid');

  // ④ 稽核。DB 已成功後 audit 不可回滾;失敗時回誠實警示結果。
  const auditRecorded = await recordStaffAudit(
    {
      action: 'settings.staff.create',
      target: `staff:${inserted.id}`,
      after: inserted,
    },
    { actor: authorization.actorId, requestId },
  );

  // ⑤ PRG redirect。
  finishMutation(auditRecorded);
}

export async function updateStaffProfileAction(
  formData: FormData,
): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseStaffProfileForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  console.info('[admin/settings/staff] staff.profile.update.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.id,
  });

  let rows: StaffRow[];
  try {
    rows = await listStaffRows();
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工資料更新前置讀取失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }

  const before = rows.find((row) => row.id === parsed.id);
  if (!before) redirectWith('notfound');

  // ③ 寫入。repository SET 不含 is_active,舊 profile 表單不能自行復活。
  let after: StaffRow | null;
  try {
    after = await updateStaffProfileRow(parsed.id, {
      label: parsed.profile.label,
      is_manager: parsed.profile.isManager,
    });
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工資料更新失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }
  if (!after) redirectWith('notfound');

  // ④ 稽核。
  const auditRecorded = await recordStaffAudit(
    {
      action: 'settings.staff.update',
      target: `staff:${parsed.id}`,
      before,
      after,
    },
    { actor: authorization.actorId, requestId },
  );

  // ⑤ PRG redirect。
  finishMutation(auditRecorded);
}

export async function setStaffActiveAction(
  formData: FormData,
): Promise<void> {
  // ① 授權閘。
  const authorization = await authorizeAdminMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseStaffActiveForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  const requestId = await getRequestId();
  console.info('[admin/settings/staff] staff.active.set.attempt', {
    request_id: requestId,
    sid: authorization.sid,
    actor: authorization.actorId,
    target_id: parsed.id,
    is_active: parsed.isActive,
  });

  // 🔴 原子 break-glass:不依賴名單快照,任何請求都不得停用 sean。
  if (parsed.id === BREAK_GLASS_STAFF_ID && !parsed.isActive) {
    redirectWith('invalid');
  }

  let rows: StaffRow[];
  try {
    rows = await listStaffRows();
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工狀態更新前置讀取失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }

  const before = rows.find((row) => row.id === parsed.id);
  if (!before) redirectWith('notfound');

  const isDeactivating = before.is_active && !parsed.isActive;

  // 🔴 縱深守門:不得停用最後一個啟用中的員工。
  if (
    isDeactivating &&
    rows.filter((row) => row.is_active).length <= 1
  ) {
    redirectWith('invalid');
  }

  // 🔴 縱深守門:當前 actor 不得停用自己。
  if (parsed.id === authorization.actorId && !parsed.isActive) {
    redirectWith('invalid');
  }

  // ③ 寫入。repository SET 只含 is_active,不覆蓋顯示名或管理者標記。
  let after: StaffRow | null;
  try {
    after = await setStaffActiveRow(parsed.id, parsed.isActive);
  } catch (error) {
    logDatabaseError(
      '[admin/settings/staff] 員工狀態更新失敗',
      requestId,
      error,
    );
    redirectWith('error');
  }
  if (!after) redirectWith('notfound');

  // ④ 稽核。
  const auditRecorded = await recordStaffAudit(
    {
      action: parsed.isActive
        ? 'settings.staff.reactivate'
        : 'settings.staff.deactivate',
      target: `staff:${parsed.id}`,
      before,
      after,
    },
    { actor: authorization.actorId, requestId },
  );

  // ⑤ PRG redirect。
  finishMutation(auditRecorded);
}
