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
// - 查看詳情鈕:(舊:Q1=A 照 design 渲染、無 onClick、詳情頁另開 slice)⇒ **2026-08-23 `#240` 已做**,
//   改成 `<a href>` 連到 /account/orders/<displayId>(OD 稿 account-page.html:319 的形狀)。
//   原句保留是因為它記著「design 自己就是一顆死鈕」這個仍然成立的事實。
// - 絕不搬 design mock 訂單假字面(PCM-2026-0042 / NT$ 18,600 / 已出貨 等);只渲染真 prop。

import Link from 'next/link';
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
                       印 `?` 是「我們也不確定」,而下一步寫在下面那段**看得見的**說明裡
                       (~~原本寫「它旁邊的 title 給得出下一步」~~ —— `#639` 甲之後那句已不成立)。 */}
                  {formatOrderDate(o.createdAt)} ·{' '}
                  {o.itemCountTruncated ? (
                    <span>? 件商品</span>
                  ) : (
                    <>{o.itemCount} 件商品</>
                  )}
                </div>
                {/* 🔴 `#639` 甲(Sean 2026-08-18 拍板;送給他的選項逐字:「整段直接印在
                    畫面上。客人 0 個動作,那張訂單卡變高」)——**他是在知道那個代價下選的**。
                    (送他看的時候我估「約 3.4 倍」,**做出來在真顧客站量是 2.0–2.7 倍**;
                     那段常數是 **112 個字元**,不是我當時寫的 79。兩個數字都在 artifact 上更正了。)
                    ⇒ **不要折衷成「前兩句直接印、其餘收起來」** —— 那是乙,他沒選乙。要偏離就先問他。
                    三案並排 <https://claude.ai/code/artifact/a15cced4-de75-4680-b3f8-6afd696d9832>。
                    🔴 **這段字原本住在上面那個 `title=` 裡**,而 `title` 是 hover-only、
                    **觸控裝置沒有 hover** ⇒ 手機客人四段**一段都拿不到**
                    (W4 2026-08-18 在真顧客站實測:四段出現在畫面文字 **0/4**)。
                    **不要把它搬回 `title`。** */}
                {o.itemCountTruncated && (
                  <p className="acc-order-note">{ORDER_ITEM_COUNT_TRUNCATED_NOTE}</p>
                )}
              </div>
              <div className="acc-order-r">
                <div className="acc-order-total">NT$ {o.total.amount.toLocaleString()}</div>
                {/* 🔴 `#249`(2026-08-24):第三個參數帶取消軸。**取消不動 `payment_status`**
                    ⇒ 少了它,一張已作廢的單在這一格會印「待付款」,而客人會去付它。
                    ⚠️ 這張卡上**沒有任何付款入口**(唯一的連結是下面那顆「查看詳情」)——
                       所以 Sean 那句「不能點去付款」在這一頁**本來就成立**,不需要停用什麼。
                       ⚠️ 而「本來就成立」是**現況**不是保證:誰日後在這張卡加付款鈕,
                       要先讀 `#249` 那一板(memory `project_0824-sean-cancelled-orders-visible-and-notfound-copy`)。 */}
                <div className="acc-order-status">
                  {orderStatusLabel(o.paymentStatus, o.fulfillmentStatus, o.cancelKind)}
                </div>
                {/* 🔴 `#240`(2026-08-23):**這裡原本是一顆沒有 onClick 也沒有 href 的 `<button>`** ——
                    design-reference `AccountPages.jsx:551` 自己就是一顆死鈕,我們忠實照搬了它。
                    而 OD 稿 `account-page.html:319` 給的是 `<a href>`:
                      `<a class="acc-order-detail" href="/account/orders/${encodeURIComponent(o.displayId)}">`
                    ⇒ 換成連結、網址段用 **displayId 不是 UUID**(OD 稿檔頭定的契約)。
                    🔴 `encodeURIComponent` 不可省:displayId 兩種格式並存(6 碼亂碼 / `PCM-YYYY-NNNN`),
                       而**它是使用者可見的識別碼、不保證只有 URL-safe 字元**。 */}
                <Link
                  className="acc-order-detail"
                  href={`/account/orders/${encodeURIComponent(o.displayId)}`}
                >
                  查看詳情 →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
