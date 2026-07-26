import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

export interface StaffRow {
  readonly id: string;
  readonly label: string;
  readonly is_active: boolean;
}

interface StaffQueryClient {
  from(table: 'staff'): {
    select(columns: 'id, label, is_active'): {
      order(
        column: 'id',
        options: { ascending: true },
      ): PromiseLike<{ data: StaffRow[] | null; error: unknown }>;
    };
  };
}

/** 讀取 staff 原始列;啟用狀態的篩選由 staff.ts 統一處理。 */
export async function listStaffRows(): Promise<StaffRow[]> {
  const client = createSupabaseServiceClient() as unknown as StaffQueryClient;
  const { data, error } = await client
    .from('staff')
    .select('id, label, is_active')
    .order('id', { ascending: true });

  if (error) throw error;
  return data ?? [];
}
