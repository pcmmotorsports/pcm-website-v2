// OrdersTab.tsx — 會員中心「訂單記錄」分頁(M-3:接真訂單摘要清單,取代 g-2 空狀態)
//
// 直接搬 design AccountPages.jsx orders tab(L538-557).acc-order.acc-order-full 字面:
//   左欄 .acc-order-l(.ap-mono.acc-order-id + .acc-order-meta「{日期} · {件數} 件商品」)
//   右欄 .acc-order-r(.acc-order-total「NT$ {total}」+ .acc-order-status + button.acc-order-detail「查看詳情 →」)
// 資料來自 page.tsx getOrderRepo→listSummariesByCustomer(RLS own-only)、forward 經 AccountView。
//
// - 0 筆 → 保留 g-2 business override 空狀態(design 無 orders 空狀態);≥1 筆 → 渲染清單。
// - 金額走整數 Money(total.amount.toLocaleString());狀態走 orderStatusLabel 雙軸中文;日期 formatOrderDate→YYYY-MM-DD。
// - 件數 = itemCount(Σquantity、Q4=B);訂單號 = displayId(PCM-YYYY-NNNN)。
// - 查看詳情鈕(Q1=A):照 design 渲染、**無 onClick**;訂單詳情頁 = backlog #240(另開 slice)。
// - 絕不搬 design mock 訂單假字面(PCM-2026-0042 / NT$ 18,600 / 已出貨 等);只渲染真 prop。

import type { OrderListItem } from '@pcm/domain';
import { formatOrderDate, orderStatusLabel } from '@/lib/orders/order-display';

export type OrdersTabProps = {
  orders: OrderListItem[];
};

export function OrdersTab({ orders }: OrdersTabProps) {
  return (
    <div className="acc-section" data-tab="orders">
      <div className="acc-section-head">
        <h2>訂單記錄</h2>
      </div>
      {orders.length === 0 ? (
        <div className="acc-empty">
          目前尚無訂單紀錄
          <div className="acc-empty-sub">您的購買紀錄會顯示在此</div>
        </div>
      ) : (
        <div className="acc-orders">
          {orders.map((o) => (
            <div key={o.id} className="acc-order acc-order-full">
              <div className="acc-order-l">
                <div className="ap-mono acc-order-id">{o.displayId}</div>
                <div className="acc-order-meta">
                  {formatOrderDate(o.createdAt)} · {o.itemCount} 件商品
                </div>
              </div>
              <div className="acc-order-r">
                <div className="acc-order-total">NT$ {o.total.amount.toLocaleString()}</div>
                <div className="acc-order-status">
                  {orderStatusLabel(o.paymentStatus, o.fulfillmentStatus)}
                </div>
                {/* Q1=A:照 design 渲染、無 onClick;訂單詳情頁 backlog #240(另開 slice) */}
                <button className="acc-order-detail">查看詳情 →</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
