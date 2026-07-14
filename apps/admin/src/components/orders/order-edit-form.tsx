import type { AdminOrderDetail, OrderStatusOption } from '@pcm/domain';
import { updateOrderWorkflowAction } from '../../lib/orders/order-actions';
import {
  WF_CLEAR_VALUE,
  ORDER_ID_FIELD,
  VERSION_FIELD,
  RETURN_TO_FIELD,
  WF_STATUS_FIELD,
  SHIPPING_METHOD_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_AMOUNT_FIELD,
  INVOICE_STATUS_FIELD,
} from '../../lib/orders/workflow-form';

// M-4a Slice C:明細頁改單表單(server action、零 client JS)。全欄 present 一次提交
// (RPC 端 no-op 檢查:只有實際變動的欄會寫);version hidden 帶樂觀鎖。

const FIELD = 'flex flex-col gap-1 text-sm';
const LABEL = 'text-muted-foreground text-xs font-medium';
const INPUT = 'border-input bg-background h-9 rounded-md border px-3 text-sm';

export function OrderEditForm({
  detail,
  activeOptions,
}: {
  detail: AdminOrderDetail;
  activeOptions: OrderStatusOption[];
}) {
  const current = detail.workflowStatus;
  const currentInActive = current !== null && activeOptions.some((o) => o.code === current);

  return (
    <form
      action={updateOrderWorkflowAction}
      className='rounded-lg border bg-card p-4 text-card-foreground'
    >
      <h2 className='mb-3 text-sm font-semibold'>編輯訂單</h2>
      <input type='hidden' name={ORDER_ID_FIELD} value={detail.id} />
      <input type='hidden' name={VERSION_FIELD} value={detail.version} />
      <input type='hidden' name={RETURN_TO_FIELD} value={`/orders/${detail.id}`} />

      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <label className={FIELD}>
          <span className={LABEL}>訂單狀態</span>
          <select name={WF_STATUS_FIELD} defaultValue={current ?? WF_CLEAR_VALUE} className={INPUT}>
            <option value={WF_CLEAR_VALUE}>未設定</option>
            {current !== null && !currentInActive && (
              <option value={current}>{current}(已停用)</option>
            )}
            {activeOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className={FIELD}>
          <span className={LABEL}>出貨方式</span>
          <input
            type='text'
            name={SHIPPING_METHOD_FIELD}
            defaultValue={detail.shippingMethod}
            maxLength={64}
            required
            className={INPUT}
          />
        </label>

        <label className={FIELD}>
          <span className={LABEL}>開票狀態</span>
          <select name={INVOICE_STATUS_FIELD} defaultValue={detail.invoiceStatus} className={INPUT}>
            <option value='not_issued'>未開立</option>
            <option value='issued'>已開立</option>
            <option value='voided'>已作廢</option>
          </select>
        </label>

        <label className={FIELD}>
          <span className={LABEL}>發票號碼</span>
          <input
            type='text'
            name={INVOICE_NUMBER_FIELD}
            defaultValue={detail.invoiceNumber ?? ''}
            maxLength={64}
            placeholder='留空=清除'
            className={INPUT}
          />
        </label>

        <label className={FIELD}>
          <span className={LABEL}>發票金額(元)</span>
          <input
            type='text'
            inputMode='numeric'
            name={INVOICE_AMOUNT_FIELD}
            defaultValue={detail.invoiceAmount ? String(detail.invoiceAmount.amount) : ''}
            placeholder='留空=清除'
            className={INPUT}
          />
        </label>
      </div>

      <div className='mt-4 flex justify-end'>
        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-5 text-sm font-medium'
        >
          儲存
        </button>
      </div>
    </form>
  );
}
