import type { AdminOrderDetail } from '@pcm/domain';
import { updateOrderWorkflowAction } from '../../lib/orders/order-actions';
import {
  SHIPPING_METHOD_LABELS,
  isShippingMethod,
} from '../../lib/orders/order-detail-view';
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
      {/* 🔴🔴 **這一格原本是 `<input type='text'>`,而它做了兩件壞事**(2026-08-19 片15,W1
          在真瀏覽器打開後台才看到的 —— 讀 code 時它長得像一個正常的欄位):

          ① **員工看到的是 raw enum `home`**,不是中文。全站每一處都印「宅配 / 自取」
             (`order-detail-view.ts:50-54` 的 `shippingMethodLabel`),**只有這一格在對人講程式的話**。

          ② 🔴 **更嚴重:它是自由文字,而這一欄有白名單而【沒有表 CHECK】。**
             · 白名單逐字在 COLUMN COMMENT:`20260604120000_m3_s2a_orders_order_items.sql:135`
               「白名單 home/store…**驗證在 create_order RPC**、本欄 text **無表 CHECK**」
               同檔 `:105` 逐字「白名單在 RPC…**不加表 CHECK**」
             · 而 **create_order 那道驗證只擋【下單】那條路**(`20260630120000…:144-145`
               `NOT IN ('home','store') ⇒ RAISE`),**改單這條路不經過它**:
               `workflow-form.ts:113` 逐字「shipping_method:非空 → 設定(**RPC 再驗長度**)」
               —— **只驗長度,不驗白名單。**
             ⇒ 員工打錯字或打「黑貓」都會寫進 `orders.shipping_method`,而**沒有任何東西會紅**。
             🔴 **下游真的在讀它**:退款運費重算走 `mode === 'store' ? 0 : fee`
                ⇒ **任何非 `store` 的雜訊值都會被當成宅配算運費。**
             📎 旁證:`docs/archive/…/2026-07-25-rf2a0-freeze-shipping-handoff.md:57` 那支 migration
                的 apply 前置斷言逐字要求「`admin_audit_log` 內**真的改過 `shipping_method` 筆數 = 0**」
                ⇒ **凍結快照那套設計是踩在「沒有人從後台改過它」上面的。**

          ⇒ 改成 `<select>`(與下面「開票狀態」同一個做法),值仍是 `home` / `store`、顯示走同一支 label 函式。
          🔴 **不白名單外的舊值一律【原樣保留成一個選項】,不靜默改掉** ——
             這一欄無表 CHECK ⇒ 歷史上可能已經有雜訊值;把它悄悄變成 `home` 是**改資料**,
             而那比顯示錯更嚴重。它會帶著「非白名單」四個字,讓員工看得出來。
          ⚠️ **這一改【收窄了寫入能力】**:原本打得出自訂字串(例:某家快遞名),現在打不出來。
             我查不到任何拍板說那是刻意的(`git grep '黑貓' -- docs/` 只命中架構文件講「未來串黑貓 API」,
             與這一欄無關)。**若 Sean 要保留自訂,那要另外設計成一個真的欄位,不是借這一欄。** */}
      <AdminFormField label='出貨方式'>
        {/* 🔴 選項由 `SHIPPING_METHOD_LABELS` 產,**不在這裡再寫一次 `home`/`store`**
            (片15 R2,W5 must-fix 2:收斂前白名單有三份可執行的副本,
             而「白名單有副本、其中一份不知道」正是這一欄一開始出事的形狀)。
            ⚠️ `required` 已拿掉 —— 沒有空值 option ⇒ 它永遠有選中值 ⇒ **它擋不住任何東西**,
               留著只會讓人以為這裡有一道檢查(W5 nit)。真正的守門在 `workflow-form.ts`。 */}
        <select
          name={SHIPPING_METHOD_FIELD}
          defaultValue={detail.shippingMethod}
          className={ADMIN_INPUT_CLASS}
        >
          {Object.entries(SHIPPING_METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {/* 🔴🔴 **這個選項不會「保留」任何東西 —— 它會【擋住整張單】**(片15 R2,W5 must-fix 1)。
              因果鏈是直的,兩段 code 都在:
                員工開單 → select 停在舊值 → 他改了發票號碼 → 按儲存
                → parser 拒收非白名單值 → `order-actions.ts:71-73` `redirectWith('/orders','invalid')`
                ⇒ **那張單的發票三欄也一起存不下去**（同一張表單、同一個 action）
                ⇒ 而他看到的是一個泛用的 invalid,**畫面上沒有任何東西指向「出貨方式」**
              ⇒ 所以字面必須把「要做什麼」講出來,不能只說「原樣保留」——
                 **fail-closed 不變,但沉默的陷阱要變成一句指令。**
              ⚠️ 本分支**今天在產品裡構造不出來**(正式庫實量 `home 14 / store 5`、第三種 0)
                 ⇒ 它守的是**未來**(該欄無表 CHECK,直接 SQL 或未來的新寫入路徑仍塞得進來)。
                 撐住它的是既有 fixture `ORDER_DETAIL.shippingMethod = '新竹物流'`。
                 **要清死碼的人先讀這一段。** */}
          {!isShippingMethod(detail.shippingMethod) && (
            <option value={detail.shippingMethod}>
              {detail.shippingMethod}(非白名單,必須改成宅配或自取才能存檔)
            </option>
          )}
        </select>
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
