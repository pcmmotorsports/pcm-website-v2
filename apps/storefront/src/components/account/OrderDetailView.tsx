// OrderDetailView.tsx — 會員訂單明細頁的版面(`#240`;/account/orders/<displayId>)
//
// 🔴 直接搬 OD 稿 `pcm-home-redesign/order-detail-page.html`(305 行)的字面與 class,不翻譯、不重寫:
//   .od-back / .od-head(.od-status + h1 + .od-head-meta)/ .od-steps / .od-line / .od-sums /
//   .od-info(Shipping | Payment)/ .od-help
//   樣式住在 OD 的 `pcm-account.css:1167` 起「訂單詳情」段(與會員中心共用 .acc-main / .acc-section)。
//
// 🔴 **稿上有、而本片【刻意不做】的東西**(每一個都是「沒有資料來源」,不是漏做):
//   · 「下載訂單 PDF」鈕 —— 稿註解要求真站接 /account/orders/<id>/statement.pdf 由後端產;
//     後端不存在 ⇒ **做出來就是第二顆死鈕**,而本片存在的理由正是消滅第一顆。
//   · 物流(courier / trackingNo / trackingUrl / 物流歷程)與進度軸後兩階 ——
//     稿 :167-175 自己就寫著「需要第 2 批【包裹真相】」,且逐字警告
//     **「fulfillment_status 是 stale 出貨軸,拿它點亮『已出貨』等於對客人說謊」**。
//     ⇒ 後兩階畫成未完成的空心點,**這是稿指定的誠實狀態**,不是缺工。
//   · etaLabel / discountLabel —— 零資料來源。
//
// 🔴 狀態字面**一律呼叫 orderStatusLabel()**、不照抄稿上那串三元運算:
//   稿是 2026-08-07 的,而 Sean 2026-08-18 拍 Q06=甲 把 partiallyPaid 從「付款確認中」改成
//   「已收訂金」⇒ **逐字搬稿會把一個被推翻的字面搬回線上**。tone 才照稿(spec 附錄 B-5)。

import Link from 'next/link';
import type { MemberOrderDetail, MemberOrderDetailItem, OrderItemVehicleSnapshot, PaymentStatus } from '@pcm/domain';
import { ProductImage } from '@/components/ProductImage';
import { formatOrderDate, orderStatusLabel } from '@/lib/orders/order-display';
import { ORDER_DETAIL_ITEMS_TRUNCATED_NOTE } from '@/lib/account-order-copy';

/**
 * 付款軸 → 徽章三檔(spec 附錄 B-5;來源 = OD 稿 `order-detail-page.html:150-156` 的 tone)。
 *
 * 🔴 **稿另有 `已出貨`(progress)/ `已送達`(done)兩檔吃 `order.shipStage`** —— 那需要第 2 批
 * 「包裹真相」,而 `orderStatusLabel()` 現在**完全不讀出貨軸**(A9f:paid 一律固定「處理中」)
 * ⇒ **第 1 批那兩檔永遠不會出現,不要為它們寫分支。**
 */
/**
 * 金額欄的標題字面(codex 關卡2 must-fix,2026-08-23)。
 *
 * 🔴 **原本是 `paid ? '實付金額' : '應付金額'` 的二元式,而它對三個狀態說了假話**:
 *    `refunded` / `partiallyRefunded` / `partiallyPaid` 全都會印成
 *    **「應付金額 + 原始總額」** ⇒ **一個已經退款的客人,會被告知他還欠全額。**
 * ⚠️ 那個二元式是**從 OD 稿逐字搬來的**(稿 `:247` / `:271`)——
 *    **稿是視覺權威,不是金額語意的權威。**
 * ⚠️ `unpaid` 在這一頁**到不了**(adapter 端 `.neq('payment_status','unpaid')`、`#249`);
 *    列出來是因為 `Record` 要窮盡,**不是因為它會出現**。
 * 🔴 三個非 `paid` 的可達狀態一律用中性的「訂單金額」—— 它在那三種狀態下都為真。
 *    **而這個字面是我選的,不是稿上的、也不是 Sean 拍過的** ⇒ 已列給主視窗送他過目。
 */
const AMOUNT_LABEL: Record<PaymentStatus, string> = {
  paid: '實付金額',
  unpaid: '應付金額',
  partiallyPaid: '訂單金額',
  refunded: '訂單金額',
  partiallyRefunded: '訂單金額',
};

const STATUS_TONE: Record<PaymentStatus, 'action' | 'progress' | 'done'> = {
  refunded: 'done',
  partiallyRefunded: 'done',
  unpaid: 'action',
  partiallyPaid: 'action',
  paid: 'progress',
};

/** 金額字面(整數 Money → `NT$ 1,234`);與 OrdersTab 的既有寫法一致。 */
function nt(amount: number): string {
  return `NT$ ${amount.toLocaleString()}`;
}

/**
 * 車款快照 → 稿上 `.od-line-fits` 那一行的字面。
 *
 * ⚠️ **「稿的 `it.fits` 就是 vehicle_snapshot」是【推的】** —— 形狀吻合而稿沒寫來源
 * (見 `MemberOrderDetailItem.vehicle` 的 docstring)。缺 → null ⇒ 那一行不印。
 */
function formatVehicle(v: OrderItemVehicleSnapshot | null): string | null {
  if (!v) return null;
  const year = v.year === undefined ? '' : ` ${v.year}`;
  return v.kind === 'dict' ? `${v.brand} ${v.model}${year}` : `${v.raw}${year}`;
}

function OrderLine({ item }: { item: MemberOrderDetailItem }) {
  const fits = formatVehicle(item.vehicle);
  return (
    <div className="od-line">
      <div className="od-line-img">
        {/* 🔴 取圖與 fallback 走既有 ProductImage(spec 附錄 B):它自帶
            onError → 站內佔位圖 → 漸層 的三層退化,而 **onError 記在 state、不改 src**
            (改 src 會再觸發 load ⇒ 佔位圖也載不到時變成無限迴圈)。不另發明一條取圖路徑。
            ⚠️ imageUrl 為 null 的兩個成因(商品無圖 / **商品已下架 join 不到**)在這裡
               長得一樣,而兩者都該退到佔位圖 ⇒ 不分流。 */}
        <ProductImage image={item.imageUrl} label={item.title ?? item.variantSku} />
      </div>
      <div>
        {/* 🔴 品牌 null ⇒ **整行不印**(不印「—」)——判準來自 AdminOrderDetailItem.brand 的
            docstring:「缺值本身算不算一個需要被看見的事實」。品牌缺值不是異常。 */}
        {item.brand !== null && <div className="od-line-brand">{item.brand}</div>}
        <div className="od-line-name">{item.title ?? item.variantSku}</div>
        {fits !== null && <div className="od-line-fits">{fits}</div>}
      </div>
      <div className="od-line-r">
        <div className="od-line-unit">
          {nt(item.unitPrice.amount)} × {item.quantity}
        </div>
        <div className="od-line-sum">{nt(item.lineTotal.amount)}</div>
      </div>
    </div>
  );
}

export type OrderDetailViewProps = {
  order: MemberOrderDetail;
};

export function OrderDetailView({ order }: OrderDetailViewProps) {
  const paid = order.paymentStatus === 'paid';
  const tone = STATUS_TONE[order.paymentStatus];
  // 稿的四階進度軸。前兩階有來源;後兩階在第 1 批一律未完成(見檔頭)。
  const steps = [
    { t: '訂單成立', d: formatOrderDate(order.createdAt), ok: true },
    // 🔴 日期只能用 `paidAt`(codex 關卡2 must-fix):延後付款或重試成功時,下單日與付款日
    //    可以差好幾天 ⇒ 拿 `createdAt` 冒充等於**印一個我們自己編的付款日**,而客人沒有第二個來源可以對。
    //    `paidAt` 為 null ⇒ **那一階不印日期**(狀態仍可標完成),不要退回 createdAt。
    { t: '付款完成', d: order.paidAt === null ? '' : formatOrderDate(order.paidAt), ok: paid },
    { t: '已出貨', d: '', ok: false },
    { t: '已送達', d: '', ok: false },
  ];
  const nowIdx = steps.reduce((n, s, i) => (s.ok ? i : n), 0);
  const amountLabel = AMOUNT_LABEL[order.paymentStatus];
  // 收件三欄缺值印 `—`:**這裡缺值是異常、要看得出來**(與品牌那格刻意相反)。
  const dash = (v: string | null) => (v === null || v === '' ? '—' : v);

  return (
    <>
      <Link className="od-back" href="/account?tab=orders" data-od-id="order-back">
        <span>訂單記錄</span>
      </Link>

      <div className="od-head" data-od-id="order-head">
        <div>
          <span className={`od-status is-${tone}`}>
            {orderStatusLabel(order.paymentStatus, order.fulfillmentStatus)}
          </span>
          <h1>{order.displayId}</h1>
          <div className="od-head-meta">
            {formatOrderDate(order.createdAt)} 成立
            {/* 🔴 itemsTruncated ⇒ 件數不可信。**不印 0、不留空**(逐字沿用 OrderListItem
                :196 的紀律):印「?」= 我們也不確定,而下一步寫在下面看得見的說明裡。 */}
            {order.itemsTruncated ? ' · 共 ? 件商品' : ` · 共 ${order.itemCount} 件商品`}
          </div>
        </div>
      </div>

      <div className="od-steps" data-od-id="order-steps">
        {steps.map((s, i) => (
          <div
            key={s.t}
            className={`od-step${s.ok ? ' is-done' : ''}${i === nowIdx ? ' is-now' : ''}`}
          >
            <div className="od-step-t">{s.t}</div>
            <div className="od-step-d">{s.d}</div>
          </div>
        ))}
      </div>

      <div className="acc-section" data-od-id="order-items">
        <div className="acc-section-head">
          <h2>商品明細</h2>
        </div>
        {order.itemsTruncated && (
          <p className="acc-order-note">{ORDER_DETAIL_ITEMS_TRUNCATED_NOTE}</p>
        )}
        {order.items.map((item) => (
          <OrderLine key={item.id} item={item} />
        ))}

        <div className="od-sums" data-od-id="order-sums">
          <div className="od-sum">
            <span>商品小計</span>
            <b>{nt(order.subtotal.amount)}</b>
          </div>
          <div className="od-sum">
            <span>運費</span>
            <b>{order.shippingFee.amount === 0 ? '免運' : nt(order.shippingFee.amount)}</b>
          </div>
          {order.discountTotal.amount > 0 && (
            <div className="od-sum od-sum-off">
              <span>折扣</span>
              <b>− {nt(order.discountTotal.amount)}</b>
            </div>
          )}
          {/* 稿註解逐字:**未付款的訂單不能寫「實付」——那是還沒發生的事。** */}
          <div className="od-sum od-sum-total">
            <span>{amountLabel}</span>
            <b>{nt(order.total.amount)}</b>
          </div>
        </div>
      </div>

      <div className="acc-section" data-od-id="order-info">
        <div className="acc-section-head">
          <h2>收件與付款</h2>
        </div>
        <div className="od-info">
          <div>
            <h3>Shipping</h3>
            <dl>
              <dt>收件人</dt>
              <dd>{dash(order.shippingAddress.name)}</dd>
              <dt>手機</dt>
              <dd>{dash(order.shippingAddress.phone)}</dd>
              <dt>地址</dt>
              <dd>{dash(order.shippingAddress.line)}</dd>
            </dl>
          </div>
          <div>
            <h3>Payment</h3>
            <dl>
              <dt>付款方式</dt>
              {/* paymentMethod 為 null = 尚無成功請款(不是「資料缺失」)⇒ 仍印 `—`,
                  與收件那三格同理:這一格空著是**看得出來比較好**的那種空。 */}
              <dd>{dash(order.paymentMethod)}</dd>
              <dt>{amountLabel}</dt>
              <dd>{nt(order.total.amount)}</dd>
            </dl>
          </div>
        </div>
      </div>

      {order.cancelledAt !== null && (
        <div className="acc-section" data-od-id="order-cancelled">
          <div className="acc-section-head">
            <h2>訂單已取消</h2>
          </div>
          {/* cancelledReason = **可對客文案**(內部原因在 admin_audit_log,不在投影裡)。 */}
          <div className="acc-empty-sub">{dash(order.cancelledReason)}</div>
        </div>
      )}

      <div className="od-help" data-od-id="order-help">
        <div>
          <div className="od-help-t">這筆訂單有問題?</div>
          <div className="od-help-d">
            商品若有瑕疵,收到後請直接用 LINE 傳照片給我們,我們會安排換貨。
            非瑕疵的商品恕不接受退換 —— 下單前不確定裝不裝得上,先問我們最快。
          </div>
        </div>
        <a
          className="acc-btn-ghost"
          href="https://lin.ee/R6QZUH2"
          target="_blank"
          rel="noopener noreferrer"
        >
          用 LINE 詢問這筆訂單
        </a>
      </div>
    </>
  );
}
