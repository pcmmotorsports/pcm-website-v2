import { createStaffAction } from '../../lib/staff-actions';
import {
  IS_MANAGER_FIELD,
  STAFF_ID_FIELD,
  STAFF_LABEL_FIELD,
} from '../../lib/staff-form';
import {
  ADMIN_INPUT_CLASS,
  AdminForm,
  AdminFormField,
} from '../shared/admin-form';
import { isEditable, type ManagePermission } from './staff-edit-row';

export function StaffCreateForm({
  canManage,
}: {
  canManage: ManagePermission;
}) {
  const editable = isEditable(canManage);
  return (
    <AdminForm
      action={createStaffAction}
      variant='card'
      heading='新增員工'
      footerHint='代碼之後不可修改。'
      actions={
        <button
          type='submit'
          disabled={!editable}
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
        >
          新增員工
        </button>
      }
    >
      <AdminFormField label='代碼(id)'>
        <input
          name={STAFF_ID_FIELD}
          pattern='[a-z0-9_]{1,64}'
          required
          disabled={!editable}
          placeholder='staff_3'
          className={`${ADMIN_INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        />
      </AdminFormField>

      <AdminFormField label='顯示名'>
        <input
          name={STAFF_LABEL_FIELD}
          maxLength={32}
          required
          disabled={!editable}
          className={`${ADMIN_INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        />
      </AdminFormField>

      <AdminFormField label='管理者'>
        <div className='space-y-1.5'>
          <label className='flex h-9 items-center gap-2'>
            <input
              type='checkbox'
              name={IS_MANAGER_FIELD}
              disabled={!editable}
              className='size-4 disabled:cursor-not-allowed disabled:opacity-50'
            />
            設為管理者(這是授權,不只是標記)
          </label>
          <p className='text-muted-foreground text-xs'>
            管理者才能新增員工、改員工資料,以及授予或收回管理者權限、停用 / 重新啟用員工。
          </p>
        </div>
      </AdminFormField>
    </AdminForm>
  );
}
