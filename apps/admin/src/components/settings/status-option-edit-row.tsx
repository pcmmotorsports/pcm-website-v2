import type { OrderStatusOption } from '@pcm/domain';
import { WorkflowStatusBadge } from '../orders/workflow-status-badge';
import { updateStatusOptionAction } from '../../lib/orders/status-option-actions';
import {
  CODE_FIELD,
  LABEL_FIELD,
  COLOR_FIELD,
  TEXT_COLOR_FIELD,
  SORT_ORDER_FIELD,
  IS_ACTIVE_FIELD,
} from '../../lib/orders/status-option-form';

// M-4a Slice D-3 狀態選項 inline 編輯列(server-render;native <form> → server action、零 client JS)。
// 預覽 badge = 目前「已存」值(存檔後 PRG 重繪、非即時預覽);code 唯讀(唯一鍵、orders soft-ref、DB 亦擋改)。

const INPUT = 'border-input bg-background h-9 rounded-md border px-2 text-sm';

export function StatusOptionEditRow({ option }: { option: OrderStatusOption }) {
  return (
    <form
      action={updateStatusOptionAction}
      className='flex flex-wrap items-center gap-3 border-t px-3 py-3'
    >
      <input type='hidden' name={CODE_FIELD} value={option.code} />
      <div className='w-24 shrink-0'>
        <WorkflowStatusBadge
          badge={{
            label: option.label,
            color: option.color,
            textColor: option.textColor,
            known: true,
          }}
        />
      </div>
      <code
        className='text-muted-foreground w-36 shrink-0 truncate font-mono text-xs'
        title={option.code}
      >
        {option.code}
      </code>
      <input
        name={LABEL_FIELD}
        defaultValue={option.label}
        maxLength={32}
        required
        aria-label='標籤'
        className={`${INPUT} w-32`}
      />
      <input
        type='color'
        name={COLOR_FIELD}
        defaultValue={option.color}
        aria-label='底色'
        className='border-input h-9 w-12 rounded-md border bg-transparent p-0.5'
      />
      <select name={TEXT_COLOR_FIELD} defaultValue={option.textColor} aria-label='字色' className={INPUT}>
        <option value='dark'>淺底深字</option>
        <option value='light'>深底淺字</option>
      </select>
      <input
        type='number'
        name={SORT_ORDER_FIELD}
        defaultValue={option.sortOrder}
        min={0}
        step={1}
        aria-label='排序'
        className={`${INPUT} w-20`}
      />
      <label className='flex items-center gap-1.5 text-sm'>
        <input type='checkbox' name={IS_ACTIVE_FIELD} defaultChecked={option.isActive} className='size-4' />
        啟用
      </label>
      <button
        type='submit'
        className='bg-primary text-primary-foreground ml-auto h-9 rounded-md px-4 text-sm font-medium'
      >
        儲存
      </button>
    </form>
  );
}
