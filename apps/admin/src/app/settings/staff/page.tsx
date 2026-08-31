import { StaffCreateForm } from '@/components/settings/staff-create-form';
import { StaffTable } from '@/components/settings/staff-table';
import {
  SettingsResultBanner,
} from '@/components/settings/settings-result-banner';
import {
  listStaffRows,
  type StaffRow,
} from '@/lib/staff-repository';
import { STAFF_RESULT_MESSAGES } from '@/lib/staff-result-messages';
import { getSessionActor } from '@/lib/session/actor';
import type { ManagePermission } from '@/components/settings/staff-edit-row';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StaffSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const resultCode = typeof raw.r === 'string' ? raw.r : undefined;

  let rows: StaffRow[] = [];
  let loadFailed = false;
  try {
    rows = await listStaffRows();
  } catch (error) {
    console.error('[admin/settings/staff] 員工名單載入失敗', error);
    loadFailed = true;
  }

  // ── 這一頁的鈕要不要灰 —— 三態,而 `unknown` 【不灰】(理由見 staff-edit-row 的 ManagePermission)
  //
  // 🔵 **刻意不呼叫 `isActiveManager`**:那支在 DB 故障時回 `false`(fail-closed,對閘是對的),
  //    而 UI 沿用它 ⇒ DB 打嗝時真管理者的鈕會灰掉。
  //    這裡改用【已經載進來的那份名單】—— 零額外查詢,而且名單載不到時自然落在 `unknown`。
  let canManage: ManagePermission = 'unknown';
  if (!loadFailed) {
    try {
      const actor = await getSessionActor();
      const me = actor ? rows.find((row) => row.id === actor.id) : undefined;
      // 名單載到了而找不到自己(例如身分不在 staff 表上)⇒ 仍是 unknown,不是 'no'。
      if (me) canManage = me.is_active && me.is_manager ? 'yes' : 'no';
    } catch (error) {
      console.error('[admin/settings/staff] 取操作者身分失敗 ⇒ 不灰鈕', error);
    }
  }

  return (
    <div className='mx-auto space-y-4'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-semibold'>員工管理</h1>
        <p className='text-muted-foreground text-sm'>
          新增員工、改顯示名、授予或收回管理者權限,或停用不再使用的員工。代碼建立後不可修改。
        </p>
      </div>

      <SettingsResultBanner
        code={resultCode}
        messages={STAFF_RESULT_MESSAGES}
      />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          員工名單載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <StaffTable rows={rows} canManage={canManage} />
      )}

      <StaffCreateForm canManage={canManage} />
    </div>
  );
}
