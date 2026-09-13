import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  setStaffActiveAction,
  updateStaffProfileAction,
} from '../../lib/staff-actions';
import {
  IS_ACTIVE_FIELD,
  IS_MANAGER_FIELD,
  STAFF_ID_FIELD,
  STAFF_LABEL_FIELD,
} from '../../lib/staff-form';
import type { StaffRow } from '../../lib/staff-repository';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

// 🔵 **三態與它的兩句話已搬到 `lib/session/manage-permission.ts`**(貼板 138)——
//    理由:本檔 import `lib/staff-actions` ⇒ 拉進 `staff-repository` 的 `import 'server-only'`
//    ⇒ **任何想用這個型別的 client 元件都會被那條鏈炸掉**(備註時間軸就是這樣撞到的)。
//    ⇒ 這裡 re-export,**既有呼叫端一個字都不用改**;那一段「為什麼是三態不是布林」
//      與「Sean 2026-08-31 拍甲」的說明**整段跟著搬過去了**,沒有被刪。
export {
  NO_PERMISSION_TEXT,
  UNKNOWN_PERMISSION_TEXT,
  isEditable,
  permissionNotice,
  type ManagePermission,
} from '../../lib/session/manage-permission';
// 🔵 `export … from` **不會**把名字帶進本檔自己的作用域,而本檔內部用得到這兩個
//    ⇒ 另外 import 一次。(少了這一行 ⇒ typecheck 當場紅「Cannot find name」。)
import { isEditable, type ManagePermission } from '../../lib/session/manage-permission';

export function StaffProfileForm({
  staff,
  canManage,
  cancelSlot,
}: {
  staff: StaffRow;
  canManage: ManagePermission;
  /** 彈窗版:與「確認」同一排的取消鈕(`<NextStepCancelButton />`)。 */
  cancelSlot?: ReactNode;
}) {
  const editable = isEditable(canManage);
  return (
    <form
      action={updateStaffProfileAction}
      className='flex w-full flex-wrap items-center gap-3 md:min-w-[38rem]'
    >
      <input type='hidden' name={STAFF_ID_FIELD} value={staff.id} />
      <input
        name={STAFF_LABEL_FIELD}
        defaultValue={staff.label}
        maxLength={32}
        required
        disabled={!editable}
        aria-label={`${staff.id} 顯示名`}
        className={`${ADMIN_INPUT_CLASS} min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-50 md:w-36 md:flex-none`}
      />
      <label className='flex items-center gap-1.5 text-sm'>
        <input
          type='checkbox'
          name={IS_MANAGER_FIELD}
          defaultChecked={staff.is_manager}
          disabled={!editable}
          className='size-4 disabled:cursor-not-allowed disabled:opacity-50'
        />
        管理者
      </label>
      <span className='text-muted-foreground text-xs' title={staff.id}>
        代碼不可修改
      </span>
      <p className='text-muted-foreground w-full text-xs'>
        管理者才能新增員工、改員工資料,以及授予或收回管理者權限、停用 / 重新啟用員工。
      </p>
      {cancelSlot ? <span className='next-step-ft md:ml-auto'>{cancelSlot}</span> : null}
      <button
        type='submit'
        disabled={!editable}
        className={`bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${cancelSlot ? '' : 'md:ml-auto'}`}
      >
        {/* ⛔ ~~儲存資料~~ ⇒「確認」(Sean 09-13 送出鈕一律「確認」;這張表單現在住在「改名字」彈窗裡)。 */}
        確認
      </button>
    </form>
  );
}

export function StaffActiveForm({
  staff,
  canManage,
}: {
  staff: StaffRow;
  canManage: ManagePermission;
}) {
  const editable = isEditable(canManage);
  const nextActive = !staff.is_active;
  const breakGlassProtected = staff.id === 'sean' && !nextActive;

  return (
    <form
      action={setStaffActiveAction}
      className='flex w-full items-center justify-between gap-3 md:w-auto'
    >
      <input type='hidden' name={STAFF_ID_FIELD} value={staff.id} />
      <input
        type='hidden'
        name={IS_ACTIVE_FIELD}
        value={String(nextActive)}
      />
      <button
        type='submit'
        disabled={breakGlassProtected || !editable}
        className='h-9 rounded-md border px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
      >
        {breakGlassProtected
          ? '救援帳號不可停用'
          : nextActive
            ? '啟用員工'
            : '停用員工'}
      </button>
    </form>
  );
}

/**
 * 🆕 C8(2026-09-14)稿 v22 `data-sec="staff"` 的「處理」格:小鈕「改名字」(開 `?edit=<id>` 彈窗,裡面就是 `StaffProfileForm`)
 * + 「停用 / 啟用」(既有 `StaffActiveForm`,一顆鈕)。表單一支都沒換,只是改名字那張搬進彈窗。
 * `StaffEditRow`(整張表單塞在格子裡)留著給手機卡片與既有測試。
 */
export function StaffRowActions({
  staff,
  canManage,
  editHref,
}: {
  staff: StaffRow;
  canManage: ManagePermission;
  editHref: string;
}) {
  const editable = isEditable(canManage);
  return (
    <span className='pcm-acts'>
      {editable ? (
        <Link href={editHref} className='pcm-ib'>改名字</Link>
      ) : (
        <span className='pcm-ib pcm-ib--off' aria-disabled='true' title='只有管理者能改'>改名字</span>
      )}
      <StaffActiveForm staff={staff} canManage={canManage} />
    </span>
  );
}

export function StaffEditRow({
  staff,
  canManage,
}: {
  staff: StaffRow;
  canManage: ManagePermission;
}) {
  return (
    <div className='flex w-full flex-col gap-3 md:flex-row md:items-end'>
      <StaffProfileForm staff={staff} canManage={canManage} />
      <StaffActiveForm staff={staff} canManage={canManage} />
    </div>
  );
}
