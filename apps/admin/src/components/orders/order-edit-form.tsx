import type { AdminOrderDetail } from '@pcm/domain';
import { updateOrderWorkflowAction } from '../../lib/orders/order-actions';
import {
  ORDER_ID_FIELD,
  VERSION_FIELD,
  RETURN_TO_FIELD,
  SHIPPING_METHOD_FIELD,
  INVOICE_NUMBER_FIELD,
  INVOICE_AMOUNT_FIELD,
  INVOICE_STATUS_FIELD,
} from '../../lib/orders/workflow-form';
import {
  ADMIN_INPUT_CLASS,
  AdminForm,
  AdminFormField,
} from '../shared/admin-form';

// M-4a Slice C:明細頁改單表單(server action、零 client JS)。全欄 present 一次提交
// (RPC 端 no-op 檢查:只有實際變動的欄會寫);version hidden 帶樂觀鎖。
// D-2 起「訂單狀態」下拉退場:狀態=per-item(品項表逐列改;拍板 Q-A=A),本表單只剩
// 出貨方式+發票紀錄三欄(order 層 RPC 的 workflow_status key 能力保留、UI 停送)。
// E11-2:欄位外框與版面已改用共用 <AdminForm> 卡片內嵌變體。

export function OrderEditForm({
  detail,
  returnTo,
}: {
  detail: AdminOrderDetail;
  /**
   * #350d C1:動作做完回哪裡 = **這個視圖自己的網址**(整頁 `/orders/{id}` / 面板帶 `panel` 的列表)。
   * 🔴 原本這裡硬寫 `/orders/${detail.id}` ⇒ 在面板裡按儲存會**跳去整頁版、面板消失**。
   *    值不可信任(client 送得回來),action 端一律再過 `parseOrderReturnTo`。
   */
  returnTo: string;
}) {
  return (
    <AdminForm
      action={updateOrderWorkflowAction}
      variant='card'
      heading='編輯訂單'
      columns={3}
      hidden={{
        [ORDER_ID_FIELD]: detail.id,
        [VERSION_FIELD]: detail.version,
        [RETURN_TO_FIELD]: returnTo,
      }}
      actions={
        <button
          type='submit'
          className='bg-primary text-primary-foreground h-9 rounded-md px-5 text-sm font-medium'
        >
          儲存
        </button>
      }
    >
      <AdminFormField label='出貨方式'>
        <input
          type='text'
          name={SHIPPING_METHOD_FIELD}
          defaultValue={detail.shippingMethod}
          maxLength={64}
          required
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>

      <AdminFormField label='開票狀態'>
        <select
          name={INVOICE_STATUS_FIELD}
          defaultValue={detail.invoiceStatus}
          className={ADMIN_INPUT_CLASS}
        >
          <option value='not_issued'>未開立</option>
          <option value='issued'>已開立</option>
          <option value='voided'>已作廢</option>
        </select>
      </AdminFormField>

      <AdminFormField label='發票號碼'>
        <input
          type='text'
          name={INVOICE_NUMBER_FIELD}
          defaultValue={detail.invoiceNumber ?? ''}
          maxLength={64}
          placeholder='不填就會清空'
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>

      <AdminFormField label='發票金額(元)'>
        <input
          type='text'
          inputMode='numeric'
          name={INVOICE_AMOUNT_FIELD}
          defaultValue={detail.invoiceAmount ? String(detail.invoiceAmount.amount) : ''}
          placeholder='不填就會清空'
          className={ADMIN_INPUT_CLASS}
        />
      </AdminFormField>
    </AdminForm>
  );
}
