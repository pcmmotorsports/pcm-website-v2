import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// 客戶詳情頁的「會員狀態」區塊要用的資料(20260926100000;計畫第五、九節)。
// 讀 customers 的停用四欄與 admin_customer_delete_eligibility, 都走 service_role(會員自己讀不到停用者與原因)。

export type MemberStatus =
  | {
      readonly kind: 'loaded';
      readonly disabledAt: string | null;
      readonly disabledBy: string | null;
      readonly disabledReason: string | null;
      /** 送出停用 / 恢復時帶回去比對;不同 ⇒ 資料庫回 STALE。 */
      readonly version: number;
      /** 讀不到可否刪除 ⇒ null(畫面不給刪除鈕, 不猜)。 */
      readonly deletable: boolean | null;
      readonly blockers: readonly string[];
    }
  /** 讀不到(例如 migration 還沒貼)⇒ 畫面只說讀不到, 不給任何按鈕。 */
  | { readonly kind: 'unknown' };

export async function loadMemberStatus(customerId: string): Promise<MemberStatus> {
  const client = createSupabaseServiceClient();
  const [row, elig] = await Promise.all([
    client
      .from('customers')
      .select('disabled_at, disabled_by, disabled_reason, disabled_version')
      .eq('user_id', customerId)
      .maybeSingle(),
    client.rpc('admin_customer_delete_eligibility', { p_customer_user_id: customerId }),
  ]);
  if (row.error || !row.data) {
    if (row.error) console.error('[admin/customers] 讀會員狀態失敗', { code: row.error.code, message: row.error.message?.slice(0, 200) });
    return { kind: 'unknown' };
  }
  const e = elig.error ? null : (elig.data as { deletable?: unknown; reasons?: unknown } | null);
  if (elig.error) console.error('[admin/customers] 讀可否刪除失敗', { code: elig.error.code, message: elig.error.message?.slice(0, 200) });
  const blockers = Array.isArray(e?.reasons) ? e.reasons.filter((r): r is string => typeof r === 'string') : [];
  return {
    kind: 'loaded',
    disabledAt: row.data.disabled_at,
    disabledBy: row.data.disabled_by,
    disabledReason: row.data.disabled_reason,
    version: row.data.disabled_version,
    deletable: typeof e?.deletable === 'boolean' ? e.deletable : null,
    blockers,
  };
}
