// order-detail-summary-cards.tsx — 訂單明細頁上方的四張摘要卡(客戶 / 收件出貨 / 付款 / 發票)。
//
// 🔴 **為什麼抽出來**(鐵則 6):`order-detail.tsx` 卡在 404 行、距 400 只有 4 行。
//    我在 `#13 片1c-2` 的檔頭立過一條**有期限的**約定:
//    「下一次任何人動 `order-detail.tsx`,**先抽下一塊再改**,不得再走『寫理由』那條路徑。」
//    `#520` 的修法會動那支檔 ⇒ **那條約定生效,所以先做結構、再改行為。**
//
// 🔴🔴 **本檔是【純搬家】:零行為改變。**
//    四張卡的 JSX、`Field`、四個 class 常數逐行照抄,只把縮排往左移兩格
//    (原本多包在 `order-detail.tsx` 的 return 裡一層)。
//    ⚠️ 抽的時候差一點掉一件:那段 `#350c` 的註解**開頭留在原檔、續行被抽走** ——
//       半截註解讓 JSX 直接壞掉。**抽取最容易掉的不是 code,是跨行的註解與 `use client` 邊界。**
//
// ⚠️ **`@container` 的前提沒有變,而它是承重的**:欄數看的是**容器寬度**不是視窗寬度
//    ⇒ **兩個消費者(整頁 / 面板)的外框都必須帶 `@container`**,否則容器斷點沒有參照對象、
//    一律退回 1 欄。那件事釘在 `order-panel-wiring.test.ts`,**本檔沒有把它帶過來,也不該帶** ——
//    它守的是消費者那一側。
//
// 📎 `Field` 與四個常數**只有本檔在用**(抽取前實查:`order-detail.tsx` 內 17 次、
//    全 repo 零外部 import)⇒ 一起搬,不留在原檔當孤兒。

import type { AdminOrderDetail } from '@pcm/domain';

import {
  PAYMENT_STATUS_LABEL,
  GOODS_AXIS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderAmount,
  INVOICE_STATUS_LABEL, // A11a-5 起共用(原在 order-detail-view.ts,依該檔頭宣告的慣例搬來)
} from '../../lib/orders/order-list-view';
import { orderDetailGoodsAxis } from '../../lib/orders/order-status-axes';
import {
  invoiceTypeLabel,
  shippingMethodLabel,
  formatOrderDateTime,
} from '../../lib/orders/order-detail-view';

const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';
const ROW = 'flex justify-between gap-4 py-1 text-sm';
const ROW_LABEL = 'text-muted-foreground shrink-0';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className='text-right break-all'>{value ?? '—'}</span>
    </div>
  );
}

// #350c:欄數改看**容器寬度**而不是視窗寬度(主視窗 2026-08-10 裁④)。
// 🔴 為什麼非改不可:同一份明細現在有兩個容器 —— 整頁版(~72rem)與右側面板(~36rem)。
// 用 `md:`/`xl:` 這種 viewport 斷點的話,1920 螢幕上的 576px 面板會**硬排四欄**、每欄擠到不能看。
// 容器斷點 `@md`(28rem)/ `@4xl`(56rem)⇒ 面板 2 欄、整頁 4 欄。
// ⚠️ **兩個消費者的外框都必須帶 `@container`**,否則容器斷點沒有參照對象、一律退回 1 欄
// (`order-panel-wiring.test.ts` 有一格把兩邊的 `@container` 釘住)。
export function OrderSummaryCards({ detail }: { detail: AdminOrderDetail }) {
  return (
    <div className='grid gap-4 @md:grid-cols-2 @4xl:grid-cols-4'>
      <section className={CARD}>
        <h2 className={CARD_TITLE}>客戶資訊</h2>
        <Field label='姓名' value={detail.customer.name} />
        <Field label='電話' value={detail.customer.phone} />
        <Field label='Email' value={detail.customer.email} />
      </section>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>收件與出貨</h2>
        <Field label='收件人' value={detail.shippingAddress.name} />
        <Field label='電話' value={detail.shippingAddress.phone} />
        <Field label='地址' value={detail.shippingAddress.line} />
        <Field label='出貨方式' value={shippingMethodLabel(detail.shippingMethod)} />
      </section>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>付款</h2>
        <Field label='付款狀態' value={PAYMENT_STATUS_LABEL[detail.paymentStatus]} />
        {/* 🔴🔴 `#514`:這一格**改讀貨品軸的真相**,不再讀 `orders.fulfillment_status`。
            那一欄的 COLUMN COMMENT 自己寫著「E10 起停止維護、值為 legacy stale、不得當現況真相」
            (`20260729010000_m4b_e10_d0_display_id_expand.sql:88` 逐字),而**全 migrations 零 writer**
            ⇒ 正式庫 13/13 全是 DEFAULT `notOrdered` ⇒ **這一格從來沒有正確過一次**。
            ⚠️ 那條 COMMENT 防的是「有人拿它做判斷」,**沒防「有人把它畫出來」——`render` 不是判斷**。
            🔴 **文案一個字都沒變**:`GOODS_AXIS_LABEL` 與 `FULFILLMENT_STATUS_LABEL` 字面逐字相同
               (`order-list-view.ts` 兩張表的 docstring 互相記著這件事)⇒ **變的只有資料從哪來**。
            ⚠️ **修完之後多數單仍顯示「未訂貨」,而那是對的** —— 正式庫多數單還沒採購;
               要證明它真的改讀了,看**有採購紀錄的那張單**(`order-status-axes.test.ts` 釘了那一格)。 */}
        <Field label='出貨狀態' value={GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)]} />
        <Field
          label='來源 · 管道'
          value={`${ORDER_SOURCE_LABEL[detail.orderSource]} · ${PAYMENT_CHANNEL_LABEL[detail.paymentChannel]}`}
        />
        <Field
          label='付款時間'
          value={detail.paidAt ? formatOrderDateTime(detail.paidAt) : null}
        />
      </section>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>發票</h2>
        <Field label='需求型式' value={invoiceTypeLabel(detail.invoiceRequest.type)} />
        {detail.invoiceRequest.taxId && (
          <Field label='統編 / 抬頭' value={`${detail.invoiceRequest.taxId} ${detail.invoiceRequest.title ?? ''}`} />
        )}
        {detail.invoiceRequest.carrier && (
          <Field label='載具' value={detail.invoiceRequest.carrier} />
        )}
        <Field label='開立狀態' value={INVOICE_STATUS_LABEL[detail.invoiceStatus]} />
        <Field label='發票號碼' value={detail.invoiceNumber} />
        <Field
          label='發票金額'
          value={
            detail.invoiceAmount ? `NT$ ${formatOrderAmount(detail.invoiceAmount.amount)}` : null
          }
        />
      </section>
    </div>
  );
}
