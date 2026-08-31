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

/**
 * 看這一頁的人有沒有管理權 —— **三態,不是布林**。
 *
 * 🔴 **為什麼不能是布林**:唯一現成的查核 `staff.ts` 的 `isActiveManager`
 *    在 **DB 故障時回 `false`**(`staff.ts:209-216`,那是刻意的 fail-closed,而它留了 log)。
 *    對【閘】來說那是對的;**對【UI】直接沿用就錯了** ——
 *    DB 打嗝 ⇒ 回 false ⇒ 鈕灰掉 ⇒ **一個真的是管理者的人會以為自己被降權**,
 *    而畫面上沒有任何字告訴他「這是查不到,不是你沒權限」。
 *
 * ⛔ ~~⇒ 所以 `unknown` **不灰**:讓他按,由 server 那道 `authorizeManagerMutation` 擋~~
 * 🔴 **2026-08-31 Sean 拍甲, 這一半改了**:`unknown` **也停用** ——
 *    而正確的解法不是讓他按, 是**告訴他為什麼**:
 *      `no`      ⇒ 整組唯讀 +「你沒有權限」
 *      `unknown` ⇒ 整組停用 +「暫時無法確認權限」
 *    ⇒ 我原本的顧慮(灰了他會以為被降權)由**那句話**解掉, 不是由「讓他按」解掉。
 *
 * 🛑 而 server 那道 `authorizeManagerMutation` **一個字都沒動** —— 安全面不靠這裡。
 */
export const NO_PERMISSION_TEXT = '你沒有權限修改員工資料。';
/** ⚠️ 暫定文案,未經 Sean 確認(2026-08-31)。 */
export const UNKNOWN_PERMISSION_TEXT =
  '暫時無法確認你的權限,請重新整理;若持續如此請回報。';

/** 三態裡只有 `yes` 可以編輯。`no` 與 `unknown` 都整組停用,差別在上面那兩句話。 */
export function isEditable(canManage: ManagePermission): boolean {
  return canManage === 'yes';
}

/**
 * 停用時要顯示的那一句;`yes` 沒有訊息。
 *
 * 🔴 **這一句由【頁面】印一次, 不由元件各印一次**(codex R3 must-fix, 2026-08-31):
 *    我第一版把它放進 `StaffProfileForm` ⇒ **N 位員工就出現 N 次**,
 *    而 `StaffTable` 桌機 + 手機雙渲染 ⇒ DOM 裡是 **2N+1 個 `role='status'`**。
 *    50 位員工 = 51 段紅字。而當時的測試只驗「至少存在一次」⇒ **完全抓不到。**
 */
export function permissionNotice(canManage: ManagePermission): string | null {
  if (canManage === 'no') return NO_PERMISSION_TEXT;
  if (canManage === 'unknown') return UNKNOWN_PERMISSION_TEXT;
  return null;
}
export type ManagePermission = 'yes' | 'no' | 'unknown';

function StaffProfileForm({
  staff,
  canManage,
}: {
  staff: StaffRow;
  canManage: ManagePermission;
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
      <button
        type='submit'
        disabled={!editable}
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 md:ml-auto'
      >
        儲存資料
      </button>
    </form>
  );
}

function StaffActiveForm({
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
