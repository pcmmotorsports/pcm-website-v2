import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

export interface StaffRow {
  readonly id: string;
  readonly label: string;
  readonly is_manager: boolean;
  readonly is_active: boolean;
}

export interface StaffInsert {
  readonly id: string;
  readonly label: string;
  readonly is_manager: boolean;
}

export interface StaffProfileUpdate {
  readonly label: string;
  readonly is_manager: boolean;
}

const STAFF_COLUMNS = 'id, label, is_manager, is_active' as const;

/** 讀取 staff 原始列;啟用狀態的篩選由 staff.ts 統一處理。 */
export async function listStaffRows(): Promise<StaffRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .select(STAFF_COLUMNS)
    .order('id', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/** 新增 staff;PK 重複轉成可預期結果,其餘 DB error 交 action 安全記錄。 */
export async function insertStaffRow(
  input: StaffInsert,
): Promise<StaffRow | 'DUPLICATE'> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .insert(input)
    .select(STAFF_COLUMNS)
    .single();

  if (error) {
    if ((error as { code?: unknown }).code === '23505') return 'DUPLICATE';
    throw error;
  }
  if (!data) throw new Error('staff INSERT 未回傳新增列');
  return data;
}

/**
 * 更新 staff 顯示資料。
 * 🔴 SET 只含 label/is_manager,不得夾帶 is_active 造成 stale write 自行復活。
 */
export async function updateStaffProfileRow(
  id: string,
  update: StaffProfileUpdate,
): Promise<StaffRow | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .update({
      label: update.label,
      is_manager: update.is_manager,
    })
    .eq('id', id)
    .select(STAFF_COLUMNS);

  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * 切換 staff 啟用狀態。
 * 🔴 SET 只含 is_active,不得用舊表單值覆蓋 label/is_manager。
 */
export async function setStaffActiveRow(
  id: string,
  isActive: boolean,
): Promise<StaffRow | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('staff')
    .update({ is_active: isActive })
    .eq('id', id)
    .select(STAFF_COLUMNS);

  if (error) throw error;
  return data?.[0] ?? null;
}
