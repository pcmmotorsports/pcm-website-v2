// M-4a M0-S2 最小具名身分(PRD docs/specs/2026-07-12-m4a-admin-phase1-prd.md §6.1)。
// 共用密碼登入後「選人」寫進 session,稽核 log 才不會全記成同一個 shared admin。
// 🔴 臨時解:M-4b 完整帳號/權限前先 hardcode 名單;SSO 收端上線後由真實登入身分取代。

/** 具名 staff 身分。id 為穩定 slug、寫入 admin_audit_log.actor;label 供 UI 顯示。 */
export interface StaffActor {
  readonly id: string;
  readonly label: string;
}

/**
 * hardcode staff 名單。
 * ⚠️ 'staff_1'/'staff_2' 為占位,實際員工名單由 Sean 補;新增/異動員工暫時改這裡。
 */
export const STAFF: readonly StaffActor[] = [
  { id: 'sean', label: 'Sean(老闆)' },
  { id: 'staff_1', label: '員工 1(占位)' },
  { id: 'staff_2', label: '員工 2(占位)' },
] as const;

/**
 * 依 id 取 staff。非名單內 / 空值 → 回 null(fail-closed:
 * 呼叫端不得以未知 id 當 actor 寫稽核,見 audit/context.ts buildAuditContext)。
 */
export function resolveStaff(id: string | null | undefined): StaffActor | null {
  if (!id) return null;
  return STAFF.find((s) => s.id === id) ?? null;
}
