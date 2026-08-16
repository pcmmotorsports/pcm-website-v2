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
import { orderDetailGoodsAxis, goodsAxisProgressNote } from '../../lib/orders/order-status-axes';
import { customerEmailDisplay } from '../../lib/customers/customer-list-view';
import {
  invoiceTypeLabel,
  shippingMethodLabel,
  formatOrderDateTime,
} from '../../lib/orders/order-detail-view';

/* ═══ BMW M 片4a:摘要卡改成 OD 的「髮絲線格」+ 小標字體 ═══════════════════════════
   **逐字搬 OD `overview-desktop-bmw-m.html:251-257` 的 `.specs` / `.spec` / `.spec .l`。**

   🔴 **分隔線是【格線縫隙透出底色】,不是每張卡自己畫框**:
      OD `:251-252` = `gap:1px; background:var(--border); border:1px solid var(--border)`
      + `:253` `.spec{background:var(--surface)}` ⇒ **1px 的縫讓容器底色透出來當線。**
      我方對應 = 容器 `gap-px bg-border border`、每格 `bg-card`(見下方 grid)。
      ⚠️ **這不是「把 gap-4 改小」** —— 舊版是四張**浮著的卡**(各自有框、中間 16px 空隙),
         新版是**一塊被切成四格的面板**。**視覺分組的語意變了**,而那正是 BMW M 的樣子。
   ⚠️ **`rounded-lg` 一併拿掉**:片1 已把 `--radius-lg` 釘成 0 ⇒ **它今天就已經是方角、拿掉零視覺差**;
      留著只會讓下一個人以為這裡還有圓角。**這是清掉一個誤導字面,不是改外觀。**

   🔴 **小標字體 = OD `.spec .l`(`:256-257`),而三件裡一樣只搬得動兩件**:
      OD = `font-size:var(--text-xs); font-weight:700; letter-spacing:1.5px; text-transform:uppercase`。
        ✅ 搬 `font-weight:700`(`font-medium` → `font-bold`)與 `letter-spacing:1.5px`。
        🔴 **不搬 `uppercase`** —— 四個標題全是中文(客戶資訊 / 收件與出貨 / 付款 / 發票),
           **對 CJK 是 no-op**:寫上去畫面一個像素都不會變,卻會留下一行「已照 OD 做大寫」的假字面。
           **與訂單表表頭同一個判斷,不是各自決定的。**
   ⬜ **OD `.spec .v` 那個「大數字」沒有做** —— 它需要先決定「一張訂單的頭條數字是哪三個」,
      **而這個面板現在沒有任何頭條數字**(全是 label-value 欄位)⇒ **那是內容決策,不是樣式**,
      已排給 Sean。**不要看到 `.spec` 就順手把 `.v` 也補上去。** */
const CARD = 'bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-bold tracking-[1.5px]';
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
/**
 * 🔴 **`GoodsAxisValue` 不是這一片新寫的輔助函式** —— 它是從 `order-detail.tsx` **原封搬過來的**
 *    (2026-08-16 收割 `customers` 分支時,void-readers 把明細抽成本元件 ⇒ 它必須跟著搬)。
 *    **不要因為「這裡只有一個地方用到」就把它就地展開或刪掉** —— 它的守門與 docstring 都認這個名字。
 */
/**
 * 「出貨狀態」那格的值 = 軸的中文 + **一行解釋為什麼是這個字的小字**。
 *
 * 🔴 **為什麼要有這行小字**(Sean 2026-08-15 拍板乙):改讀真相之後,`RCPVVJ` 那張單
 *    上方摘要寫「未訂貨」、品項列寫「訂貨 3/6」—— **兩個都對,而放在一起讓人看不懂**
 *    (軸的定義是「該單所有品項都訂滿才算已訂」,3<6 ⇒ 退回前一階)。
 *    ⚠️ 後果不是美觀問題:**員工可能讀成「還沒下單」而重複下單、同一批貨訂兩次。**
 *    需求檔 `docs/specs/2026-08-12-admin-order-ui-design-brief.md:114` 早就要求
 *    「這個定義要在畫面上讓人看得懂」—— `#514` 只做了改讀真相那半,這片補另一半。
 *
 * 🔴 **軸值本身一個字都不動**(`GOODS_AXIS_LABEL` / `ORDER_GOODS_AXIS_VALUES` / 篩選 chip / adapter
 *    全部沒碰)⇒ 這片不中鐵則 8。小字是**加上去的解釋**,不是新的狀態。
 *
 * 規則與它依賴的三條 DB CHECK 寫在 `goodsAxisProgressNote` 的 docstring,**不在這裡重複一份**
 * (兩份會漂;那條規則的正當性屬於算它的地方)。
 *
 * 🔴 **守門在 `app/orders/[id]/refund-wiring.test.tsx` 的 `describe('出貨狀態的解釋小字')`(六格)。**
 *    **檔名對不上是刻意的**,「為什麼不改名」寫在 `goodsAxisProgressNote` 的 docstring
 *    (E 窗 2026-08-15 `E-629` nit1)。⇒ **動這一格的渲染 = 必跑那六格。**
 */
function GoodsAxisValue({ detail }: { detail: AdminOrderDetail }) {
  const note = goodsAxisProgressNote(detail.items);
  return (
    <>
      {GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)]}
      {note !== null && <span className='text-muted-foreground block text-xs'>{note}</span>}
    </>
  );
}

export function OrderSummaryCards({ detail }: { detail: AdminOrderDetail }) {
  return (
    /* 🔴 `gap-px bg-border border` = OD `.specs` 的髮絲線格(見 `CARD` 上方那段的完整理由)。
       ⚠️ **`gap-px` 與 `bg-border` 是一組,少一個就不成立**:只有 `gap-px` 會變成四格緊貼、
          完全沒有分隔線;只有 `bg-border` 而 gap 是 0 則底色永遠被格子蓋住、看不到。
       ⚠️ **容器斷點(`@md` / `@4xl`)一個字沒動** —— 那條的理由(同一份明細有整頁與面板兩個容器)
          與本片無關,不要順手一起改。 */
    <div className='grid gap-px border bg-border @md:grid-cols-2 @4xl:grid-cols-4'>
      <section className={CARD}>
        <h2 className={CARD_TITLE}>客戶資訊</h2>
        <Field label='姓名' value={detail.customer.name} />
        <Field label='電話' value={detail.customer.phone} />
        <Field label='Email' value={customerEmailDisplay(detail.customer.email)} />
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
        <Field label='出貨狀態' value={<GoodsAxisValue detail={detail} />} />
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
