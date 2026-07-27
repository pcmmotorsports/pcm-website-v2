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

function StaffProfileForm({ staff }: { staff: StaffRow }) {
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
        aria-label={`${staff.id} 顯示名`}
        className={`${ADMIN_INPUT_CLASS} min-w-0 flex-1 md:w-36 md:flex-none`}
      />
      <label className='flex items-center gap-1.5 text-sm'>
        <input
          type='checkbox'
          name={IS_MANAGER_FIELD}
          defaultChecked={staff.is_manager}
          className='size-4'
        />
        管理者(標記用,尚未生效)
      </label>
      <span className='text-muted-foreground text-xs' title={staff.id}>
        代碼不可修改
      </span>
      <p className='text-muted-foreground w-full text-xs'>
        此標記目前不影響任何權限;成本報表上線後才會生效。
      </p>
      <button
        type='submit'
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium md:ml-auto'
      >
        儲存資料
      </button>
    </form>
  );
}

function StaffActiveForm({ staff }: { staff: StaffRow }) {
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
        disabled={breakGlassProtected}
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

export function StaffEditRow({ staff }: { staff: StaffRow }) {
  return (
    <div className='flex w-full flex-col gap-3 md:flex-row md:items-end'>
      <StaffProfileForm staff={staff} />
      <StaffActiveForm staff={staff} />
    </div>
  );
}
