import Link from 'next/link';
import { StaffCreateForm } from '@/components/settings/staff-create-form';
import { StaffProfileForm } from '@/components/settings/staff-edit-row';
import { NextStepDialog } from '@/components/orders/next-step-dialog';
import { NextStepCancelButton } from '@/components/orders/next-step-cancel-button';
import { StaffTable } from '@/components/settings/staff-table';
import {
  SettingsResultBanner,
} from '@/components/settings/settings-result-banner';
import {
  listStaffRows,
  type StaffRow,
} from '@/lib/staff-repository';
import { STAFF_RESULT_MESSAGES } from '@/lib/staff-result-messages';
import { getSessionActorIdWithSource } from '@/lib/session/actor';
import {
  permissionNotice,
  type ManagePermission,
} from '@/components/settings/staff-edit-row';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StaffSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const resultCode = typeof raw.r === 'string' ? raw.r : undefined;
  /* 🆕 C8(2026-09-14)稿 v22:新增與改名字都是【彈窗】(共用殼 `NextStepDialog`,網址驅動,同 `/orders?pay=` 那族):
     `?new=1` ⇒ 新增員工;`?edit=<id>` ⇒ 改名字 / 管理者勾。只開表單不寫入,寫入仍走 staff-actions 那三支 RPC。 */
  const newOpen = raw.new === '1';
  const editId = typeof raw.edit === 'string' && raw.edit !== '' ? raw.edit : null;

  let rows: StaffRow[] = [];
  let loadFailed = false;
  try {
    rows = await listStaffRows();
  } catch (error) {
    console.error('[admin/settings/staff] 員工名單載入失敗', error);
    loadFailed = true;
  }

  // ── 這一頁能不能編輯 —— 三態(理由見 staff-edit-row 的 ManagePermission)
  //
  //   yes     可編輯
  //   no      整組唯讀 +「你沒有權限」
  //   unknown 整組停用 +「暫時無法確認權限」
  //
  // 🔴 **`unknown` 也停用, 而它與 `no` 的差別在【那句話】**(Sean 2026-08-31 拍甲)。
  //    我第一版讓 `unknown` 不灰, 理由是「灰了他會以為自己被降權」——
  //    而正確的解法不是讓他按, 是**告訴他為什麼**。
  //
  // 🔴 **而根因在 `actor.ts` 修掉了**(codex R2 must-fix):
  //    舊的 `getSessionActor()` 出口, `null` 同時代表「沒有具名身分」與「查身分失敗」
  //    (`staff.ts:67-73` 的 `catch { return []; }`)⇒ 三態在資料進頁面之前就塌成兩態。
  //    ⇒ 改用 `getSessionActorIdWithSource()`:**它一次 DB 都不打** ⇒ 它的 `null`
  //      只可能是「票 / cookie 上沒有具名 id」這一種確定的事實。
  //    ⇒ 於是「DB 出問題」這條路**只剩一個入口** = 我們自己這發 `listStaffRows()`,
  //      而它的失敗由 `loadFailed` 承接 ⇒ 落在 `unknown`。
  let canManage: ManagePermission = 'unknown';
  if (!loadFailed) {
    try {
      const { id } = await getSessionActorIdWithSource();
      const me = id ? rows.find((row) => row.id === id) : undefined;
      // id 為 null(沒有具名身分)/ 不在名單上 / 不是啟用中的管理者 ⇒ 都是 `no`。
      // 這三者共通點:**server 那道 authorizeManagerMutation 也會拒他們** ⇒ 畫面與閘一致。
      canManage = me && me.is_active && me.is_manager ? 'yes' : 'no';
    } catch (error) {
      // 讀 cookie / 驗票本身炸了 ⇒ 我們不知道他是誰 ⇒ `unknown`,不是 `no`。
      console.error('[admin/settings/staff] 取操作者身分失敗 ⇒ 暫時無法確認權限', error);
    }
  }

  const editRow = editId === null ? null : (rows.find((r) => r.id === editId) ?? null);
  const canEdit = canManage === 'yes';
  return (
    <div className='pcm-plist mx-auto space-y-3'>
      {/* 稿 v22 `data-sec="staff"`:h1 + 「只有管理者進得來」標 + 右側「＋ 新增員工」;表 顯示名 / 代碼 / 管理者 / 狀態 / 處理。
          🔴 那句「新增員工、改顯示名、授予或收回管理者權限…」是 ⟦b4-MGR0-COPY2⟧ 釘的可見說明(它在講【授權】),
             搬到表格下面的一句話(`pcm-note2`),讀取失敗時也在。 */}
      <div className='pcm-head'>
        <h1>員工管理</h1>
        <span className='pcm-mgr'>只有管理者進得來</span>
        <span className='pcm-sp' />
        {canEdit ? (
          <Link href='/settings/staff?new=1' className='pcm-btn-p'>＋ 新增員工</Link>
        ) : (
          <span className='pcm-btn-p pcm-btn--off' aria-disabled='true' title={permissionNotice(canManage) ?? undefined}>＋ 新增員工</span>
        )}
      </div>
      <SettingsResultBanner
        code={resultCode}
        messages={STAFF_RESULT_MESSAGES}
      />
      {permissionNotice(canManage) ? (
        <p
          className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'
          role='status'
        >
          {permissionNotice(canManage)}
        </p>
      ) : null}
      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          員工名單載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <StaffTable rows={rows} canManage={canManage} />
      )}
      <p className='pcm-note2'>
        新增員工、改顯示名、授予或收回管理者權限,或停用不再使用的員工。代碼建立後不可修改。
      </p>
      {newOpen ? (
        <NextStepDialog title='新增員工' closeHref='/settings/staff' inlineCancel>
          <div className='pcm-dlg'>
            <StaffCreateForm canManage={canManage} cancelSlot={<NextStepCancelButton />} />
          </div>
        </NextStepDialog>
      ) : null}
      {editId !== null ? (
        <NextStepDialog title='改名字' closeHref='/settings/staff' inlineCancel>
          <div className='pcm-dlg'>
            {editRow === null ? (
              <p className='text-muted-foreground text-sm'>找不到這位員工,請重新整理。</p>
            ) : (
              <StaffProfileForm staff={editRow} canManage={canManage} cancelSlot={<NextStepCancelButton />} />
            )}
          </div>
        </NextStepDialog>
      ) : null}
    </div>
  );
}
