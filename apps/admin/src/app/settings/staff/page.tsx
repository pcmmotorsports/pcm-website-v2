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
  //
  // 🔴 **`actor === null` 是 `no` 不是 `unknown`**(codex R1 must-fix,2026-08-31):
  //    `getSessionActor()` 走 `listActiveStaff()`,而那支**過濾掉停用者**
  //    ⇒ 一個【已停用而 session 還沒過期】的人會拿到 `null`。
  //    第一版把 `null` 當 `unknown` ⇒ **他的鈕不會灰**,而他確實管不了任何東西。
  //    ⇒ 而 `null` 的另外兩個來源(共用密碼備援 / bootstrap)**同樣沒有具名身分**
  //      ⇒ `authorizeManagerMutation` 也會拒他們 ⇒ 判 `no` 與 server 的行為一致。
  //
  // ⚠️ **殘餘的一格,明寫**:`listActiveStaff()` 自己也 catch DB 錯誤並回 `[]`
  //    ⇒ 若我們這一發 `listStaffRows()` 成功、而它那一發失敗(兩次查詢之間的瞬時故障),
  //    真管理者會拿到 `no` ⇒ 鈕被誤灰。**那是一個窄的競態,不是常態**,
  //    而它的代價有界(按不了 ⇒ 重整一次就好),所以本片不為它多開一條路。
  let canManage: ManagePermission = 'unknown';
  if (!loadFailed) {
    try {
      const actor = await getSessionActor();
      if (!actor) {
        canManage = 'no';
      } else {
        const me = rows.find((row) => row.id === actor.id);
        // 名單載到了而找不到自己(理論上不可達:actor 就是從同一張表解出來的)⇒ 留 unknown。
        if (me) canManage = me.is_active && me.is_manager ? 'yes' : 'no';
      }
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
