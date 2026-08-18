// OrdersTab.tsx — 會員中心「訂單記錄」分頁(M-3:接真訂單摘要清單,取代 g-2 空狀態)
//
// 直接搬 design AccountPages.jsx orders tab(L538-557).acc-order.acc-order-full 字面:
//   左欄 .acc-order-l(.ap-mono.acc-order-id + .acc-order-meta「{日期} · {件數} 件商品」)
//   右欄 .acc-order-r(.acc-order-total「NT$ {total}」+ .acc-order-status + button.acc-order-detail「查看詳情 →」)
// 資料來自 page.tsx getOrderRepo→listSummariesByCustomer(RLS own-only)、forward 經 AccountView。
//
// - 0 筆 → 保留 g-2 business override 空狀態(design 無 orders 空狀態);≥1 筆 → 渲染清單。
// - 金額走整數 Money(total.amount.toLocaleString());狀態走 orderStatusLabel 雙軸中文;日期 formatOrderDate→YYYY-MM-DD。
// - 件數 = itemCount(Σquantity、Q4=B);訂單號 = displayId(新單 6 碼亂碼 / 舊單 PCM-YYYY-NNNN,兩者並存)。
// - 查看詳情鈕(Q1=A):照 design 渲染、**無 onClick**;訂單詳情頁 = backlog #240(另開 slice)。
// - 絕不搬 design mock 訂單假字面(PCM-2026-0042 / NT$ 18,600 / 已出貨 等);只渲染真 prop。

import type { OrderListItem } from '@pcm/domain';
import { formatOrderDate, orderStatusLabel } from '@/lib/orders/order-display';
import { ORDER_ITEM_COUNT_TRUNCATED_NOTE } from '@/lib/account-order-copy';

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
                  {/* 🔴 **`itemCountTruncated` ⇒ 件數不可信,改印「?」**(2026-08-16,`Q-EMBED-1`)。
                    ⚠️ **這裡【不能】照後台那條印「未知」蓋掉整格** —— 那一格印的是**一個算出來的狀態**,
                       蓋掉它員工還看得到別的欄;而**這裡蓋掉的是客人辨識自己訂單的資訊**。
                       ⇒ 只把**那個不可信的數字**換掉,單號與日期照常。
                    🔴 **不印 0、不留空** —— 兩者都會被讀成「這單沒東西」。
                       印 `?` 是「我們也不確定」,而它旁邊的 title 給得出下一步。 */}
                  {formatOrderDate(o.createdAt)} ·{' '}
                  {o.itemCountTruncated ? (
                    <span title={ORDER_ITEM_COUNT_TRUNCATED_NOTE}>? 件商品</span>
                  ) : (
                    <>{o.itemCount} 件商品</>
                  )}
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
