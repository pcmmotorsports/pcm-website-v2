import { listStaffRows } from './staff-repository';

// M-4b E8-A1:staff 名單改由資料庫提供,但操作者仍是使用者自行選擇。
// 🔴 這不是登入 / 授權邊界,也沒有驗證「目前使用者是誰」;真實身分驗證待個人帳號接上。

/** 具名 staff 身分。id 為穩定 slug、寫入 admin_audit_log.actor;label 供 UI 顯示。 */
export interface StaffActor {
  readonly id: string;
  readonly label: string;
}

/**
 * 依 id 取 staff。非名單內 / 空值 → 回 null(fail-closed:
 * 呼叫端不得以未知 id 當 actor 寫稽核,見 audit/context.ts buildAuditContext)。
 */
export function pickStaff(
  list: readonly StaffActor[],
  id: string | null | undefined,
): StaffActor | null {
  if (!id) return null;
  return list.find((staff) => staff.id === id) ?? null;
}

/** 讀取啟用中的 staff;DB 失敗時回空陣列並留 server log。 */
export async function listActiveStaff(): Promise<StaffActor[]> {
  try {
    const rows = await listStaffRows();
    return rows
      .filter((row) => row.is_active)
      .map(({ id, label }) => ({ id, label }));
  } catch (err) {
    console.error('[admin/staff] 員工名單載入失敗', err);
    return [];
  }
}

/** 由資料庫啟用名單解析 staff;DB 失敗或未知 id 一律回 null。 */
export async function resolveStaff(
  id: string | null | undefined,
): Promise<StaffActor | null> {
  if (!id) return null;
  return pickStaff(await listActiveStaff(), id);
}
