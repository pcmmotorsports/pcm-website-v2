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

/**
 * 依 id 取**單列** staff。
 *
 * 🔴 **新增函式,既有的一個字都沒動**(B5-b codex 關卡2 MF-2;主視窗 2026-08-25 裁「只准新增」)。
 * **為什麼要它**:讀取閘跑在**路由之前** ⇒ 連 `/does-not-exist`、HEAD、`/print/*.png` 都會經過。
 * 若那裡走 `listStaffRows()`(**select 整張表**),一張還沒過期的停用票就能把任意 404
 * 放大成一次全表查詢 —— codex 逐字:「不存在路徑與 public asset 也能放大 DB」。
 * ⇒ 改成 PK 精準查一列。
 *
 * ⚠️ **它與 `listStaffRows()` 的差別只有【範圍】,沒有【語意】**:
 *    `is_active` 的過濾仍然在上層(`staff.ts`)做,本函式照舊回原始列 —— 對齊本檔既有分工。
 */
export async function getStaffRowById(
  id: string,
  signal?: AbortSignal,
): Promise<StaffRow | null> {
  // 🔴 **`abortSignal` 不是可有可無**(codex R2 must-fix)。
  //    上一版只用 `Promise.race` 做逾時 ⇒ **我們不等了,而【查詢還在跑】** ——
  //    codex 逐字「輸掉的 Supabase promise 仍執行／重試;連續重登可堆積未取消請求」。
  //    ⇒ 📌 **「不再等待」與「已經停止」是兩件事**,而只有前者是 `race` 給得起的。
  //    ⇒ 那正是 DB 已經在掙扎的那一刻,我們**還在往它身上疊請求**。
  const q = createSupabaseServiceClient().from('staff').select(STAFF_COLUMNS).eq('id', id);
  const { data, error } = await (signal ? q.abortSignal(signal) : q).maybeSingle();

  if (error) throw error;
  return data ?? null;
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
