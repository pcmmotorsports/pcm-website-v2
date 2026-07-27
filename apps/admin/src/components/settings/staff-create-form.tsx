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

export function StaffCreateForm() {
  return (
    <AdminForm
      action={createStaffAction}
      variant='card'
      heading='新增員工'
      footerHint='代碼之後不可修改。'
      actions={
        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
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
          placeholder='staff_3'
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>

      <AdminFormField label='顯示名'>
        <input
          name={STAFF_LABEL_FIELD}
          maxLength={32}
          required
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>

      <AdminFormField label='管理者(標記用,尚未生效)'>
        <div className='space-y-1.5'>
          <label className='flex h-9 items-center gap-2'>
            <input
              type='checkbox'
              name={IS_MANAGER_FIELD}
              className='size-4'
            />
            標記為是
          </label>
          <p className='text-muted-foreground text-xs'>
            此標記目前不影響任何權限;成本報表上線後才會生效。
          </p>
        </div>
      </AdminFormField>
    </AdminForm>
  );
}
