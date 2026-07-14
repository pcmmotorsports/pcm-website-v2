import { createStatusOptionAction } from '../../lib/orders/status-option-actions';
import {
  CODE_FIELD,
  LABEL_FIELD,
  COLOR_FIELD,
  TEXT_COLOR_FIELD,
  SORT_ORDER_FIELD,
  IS_ACTIVE_FIELD,
} from '../../lib/orders/status-option-form';

// M-4a Slice D-3c 新增狀態選項表單(server-render;native <form> → server action、零 client JS)。
// code = 中性 slug、由使用者輸入(pattern 為 client 提示、server 權威驗;之後不可改)。

const INPUT = 'border-input bg-background h-9 rounded-md border px-2 text-sm';
const FIELD = 'flex flex-col gap-1';
const HINT = 'text-muted-foreground text-xs';

export function StatusOptionCreateForm() {
  return (
    <form
      action={createStatusOptionAction}
      className='flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4'
    >
      <div className={FIELD}>
        <label className={HINT}>
          代碼(英文小寫/數字/底線、之後不可改;客人查看自己訂單可能看到、請用中性字)
        </label>
        <input
          name={CODE_FIELD}
          required
          pattern='[a-z0-9_]{1,64}'
          placeholder='received_confirmed'
          aria-label='代碼'
          className={`${INPUT} w-44 font-mono`}
        />
      </div>
      <div className={FIELD}>
        <label className={HINT}>標籤</label>
        <input
          name={LABEL_FIELD}
          required
          maxLength={32}
          placeholder='已收已定'
          aria-label='標籤'
          className={`${INPUT} w-32`}
        />
      </div>
      <div className={FIELD}>
        <label className={HINT}>底色</label>
        <input
          type='color'
          name={COLOR_FIELD}
          defaultValue='#e5e7eb'
          aria-label='底色'
          className='border-input h-9 w-12 rounded-md border bg-transparent p-0.5'
        />
      </div>
      <div className={FIELD}>
        <label className={HINT}>字色</label>
        <select name={TEXT_COLOR_FIELD} defaultValue='dark' aria-label='字色' className={INPUT}>
          <option value='dark'>淺底深字</option>
          <option value='light'>深底淺字</option>
        </select>
      </div>
      <div className={FIELD}>
        <label className={HINT}>排序</label>
        <input
          type='number'
          name={SORT_ORDER_FIELD}
          defaultValue={100}
          min={0}
          step={1}
          aria-label='排序'
          className={`${INPUT} w-20`}
        />
      </div>
      <label className='flex h-9 items-center gap-1.5 text-sm'>
        <input type='checkbox' name={IS_ACTIVE_FIELD} defaultChecked className='size-4' />
        啟用
      </label>
      <button
        type='submit'
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
      >
        新增
      </button>
    </form>
  );
}
