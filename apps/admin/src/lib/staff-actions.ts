'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestId } from './audit/context';
import type { AuditEntry } from './audit/types';
import { getAdminAuditLogRepository } from './orders/order-repository';
import { authorizeManagerMutation } from './session/authorize';
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

// E8-A2 員工管理 action。固定 redirect 回單一設定頁,無 return_to / open-redirect 面。
//
// ⚠️ ~~原註解「actor 仍是使用者自行選擇,本片不把它描述成身分驗證」~~ **已作廢兩次**:
//    ① 2026-08-25 B5-a 起 `ADMIN_REQUIRE_REAL_IDENTITY=1` ⇒ actor 來自【簽章過的票】,
//       那顆自選 cookie 一個字都不讀(`session/actor.ts` 第 1 層)。
//    ② ⟦b4-MGR0⟧ 2026-08-28 起,那個 actor 還決定**誰能改權限**。
//
// 🔴 **Q5 = 乙(Sean 2026-08-28 拍板,而他讀過代價)**:三個 staff mutation 同一道管理者閘。
//    代價① 每次管理者離職就生出一顆「休眠管理者」(is_manager=true + is_active=false),
//          而甲(只閘寫入、不閘停用/啟用)會讓任何登入者把它叫醒 ⇒ 所以 setActive 也收進來。
//    代價② 實際效果 = 只有【啟用中的管理者】改得動員工。
//          (2026-08-28 量:正式庫 is_manager AND is_active = 1,後台 2 人在用 ⇒ Sean 判可接受)
//    🔴 上面那兩個數字【綁 2026-08-28 那個時點】,標籤跟著它們走 ——
//       第三個員工進來那天它們會零訊號地變假,而機制句(代價①②本身)不會。
//    哪天這一格開始卡人,回來看這裡,不要重新發明。
//
// 🔴 **而這道閘【不等於那個洞已經關閉】**:它住在應用層,`service_role` 仍有 `is_manager`
//    的欄級 UPDATE 權 ⇒ **我們自己寫的下一支腳本仍然繞得過**。那是 Sean 讀過代價後
//    選擇不鎖(Q15 = 甲),不是技術上做不到。完整說明在 `staff.ts` 的 `isActiveManager`。

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
  const authorization = await authorizeManagerMutation();
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
  const authorization = await authorizeManagerMutation();
  if (!authorization) redirectWith('denied');

  // ② 解析。
  const parsed = parseStaffProfileForm(formData);
  if (!parsed.ok) redirectWith('invalid');

  // 🔴 原子 break-glass:sean 的管理者身分不得被拿掉 ——
  //    拿掉 = 沒有人能再設定管理者(這道閘會把自己鎖死)。
  //    形狀與同檔 BREAK_GLASS_STAFF_ID / setStaffActiveAction 那條「永不允許停用 sean」相同,
  //    不是新發明;而它守的是【另一個欄位】,所以兩條都要。
  if (parsed.id === BREAK_GLASS_STAFF_ID && !parsed.profile.isManager) {
    redirectWith('invalid');
  }

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
  const authorization = await authorizeManagerMutation();
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

  // ③ 寫入。repository SET 只含 is_active,不覆蓋顯示名或管理者權限。
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
