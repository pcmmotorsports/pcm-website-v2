import {
  renameSupplierAction,
  setSupplierActiveAction,
} from '../../lib/supplier-actions';
import {
  SUPPLIER_ID_FIELD,
  SUPPLIER_IS_ACTIVE_FIELD,
  SUPPLIER_LABEL_FIELD,
  SUPPLIER_LABEL_MAX,
} from '../../lib/supplier-form';
import type { SupplierRow } from '../../lib/supplier-repository';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

// supplier-edit-row.tsx — M-4b E10 S3b-3:單列的改名表單 + 啟用切換表單。
// 形狀對齊 `staff-edit-row.tsx`(已上線樣板):兩張**獨立**的 form,各自送自己那個 action。
// 🔴 兩張分開不是排版偏好 —— 合成一張的話,改名時會連帶送出 is_active,
//    一次點擊變成兩件事,而稽核列也會記成「同時改了名字與啟用狀態」。

/**
 * 🔴 **這行小字是驗收項,不是文案潤飾**(母 plan §6:251-253,Sean Q1=A 知情選擇):
 *    改名會**追溯改寫所有歷史採購的顯示名** —— 三月向「老吳精品」下的單,
 *    八月改名後會顯示新名字,因為系統**不存下單當時的名稱快照**。
 *    Sean 拍板時知道這個代價,而「知情選擇」的前提是**按鈕的人也看得到**
 *    ⇒ 只寫在 plan 裡不算數,必須出現在員工按下去之前的畫面上。
 */
export const SUPPLIER_RENAME_HISTORY_NOTE =
  '改後,過去所有採購紀錄都會顯示新名字。';

function SupplierRenameForm({ supplier }: { supplier: SupplierRow }) {
  return (
    <form
      action={renameSupplierAction}
      className='flex w-full flex-wrap items-center gap-3 md:min-w-[34rem]'
    >
      <input type='hidden' name={SUPPLIER_ID_FIELD} value={supplier.id} />
      <input
        name={SUPPLIER_LABEL_FIELD}
        defaultValue={supplier.label}
        maxLength={SUPPLIER_LABEL_MAX}
        required
        aria-label={`${supplier.label} 供應商名稱`}
        className={`${ADMIN_INPUT_CLASS} min-w-0 flex-1 md:w-56 md:flex-none`}
      />
      <button
        type='submit'
        className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
      >
        儲存名稱
      </button>
      <p className='text-muted-foreground w-full text-xs'>
        {SUPPLIER_RENAME_HISTORY_NOTE}
      </p>
    </form>
  );
}

function SupplierActiveForm({ supplier }: { supplier: SupplierRow }) {
  const nextActive = !supplier.is_active;

  return (
    <form
      action={setSupplierActiveAction}
      className='flex w-full items-center justify-between gap-3 md:w-auto'
    >
      <input type='hidden' name={SUPPLIER_ID_FIELD} value={supplier.id} />
      {/*
        🔴 **不能用原生 `<input type="checkbox">`**(`supplier-form.ts` 的 `parseSupplierActiveForm` docblock 明文契約):
        原生 checkbox 勾選時送 `'on'`、未勾選時**整個欄位缺席**,而 `parseSupplierActiveForm`
        只收字面 `'true'` / `'false'` ⇒ 兩種都判 `ok:false` ⇒ **每次切換都拿到 `invalid`**。
        hidden input 帶 `String(!current)` + 一顆按鈕 = 一次點擊送一個明確方向。
      */}
      <input
        type='hidden'
        name={SUPPLIER_IS_ACTIVE_FIELD}
        value={String(nextActive)}
      />
      <button
        type='submit'
        className='h-9 rounded-md border px-4 text-sm font-medium'
      >
        {nextActive ? '啟用' : '停用'}
      </button>
    </form>
  );
}

export function SupplierEditRow({ supplier }: { supplier: SupplierRow }) {
  return (
    <div className='flex w-full flex-col gap-3 md:flex-row md:items-start'>
      <SupplierRenameForm supplier={supplier} />
      <SupplierActiveForm supplier={supplier} />
    </div>
  );
}
