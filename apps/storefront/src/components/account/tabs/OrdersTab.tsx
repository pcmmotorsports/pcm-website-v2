// OrdersTab.tsx — 會員中心「訂單記錄」分頁(M-3:接真訂單摘要清單,取代 g-2 空狀態)
//
// 🔴 **2026-08-29 重蓋**(Sean 拍板):版面權威從 **design-reference 舊權威**換成
//   **OD 稿 `pcm-home-redesign/account-page.html`**(sha256 前 12 = 88f9b3085d16 · 841 行 · 08-07)。
//   兩者是**兩個世界**,不是「稿比較新」——舊版照的是 `AccountPages.jsx` L538-557。
//   現在的形狀 = 稿的三段式卡:
//     .acc-order-top   灰抬頭四欄(訂單日期 / 訂單金額 / 訂單編號 / 狀態徽章)
//     .acc-order-body  件數、`#639` 那段說明、每件商品一列(.acc-order-item)
//     .acc-order-foot  動作列 —— **這一輪只有「查看詳情 →」**(理由寫在那一段)
// ~~舊版:左欄 .acc-order-l + 右欄 .acc-order-r~~ ⇒ 那兩個 class 現在**只剩 OverviewTab 在用**
//   (它有自己一份 JSX,尚未跟著換;稿本身是統一的,而統一是另一片)。
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
import { formatOrderDate, orderStatusLabel, orderStatusTone } from '@/lib/orders/order-display';
import {
  ORDER_ITEM_COUNT_TRUNCATED_NOTE,
  // 🔴 沿用【明細頁那一句】,不另造一句：兩頁講的是同一件事(內嵌上限把品項切了),
  //    而兩份各自維護的文案，下次只會改到一邊。
  ORDER_DETAIL_ITEMS_TRUNCATED_NOTE,
} from '@/lib/account-order-copy';
import { ProductImage } from '@/components/ProductImage';

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
            <div key={o.id} className="acc-order">
              {/* 🔴 灰色抬頭列 —— 稿 `account-page.html:266-281` 的四欄,字面直接搬。
                  稿的註解逐字:「捲動時區分訂單靠的就是這條灰帶 —— 手機也不能拿掉,
                  只把四欄折成兩列。四個欄位是掃描用的:日期找時間、總額對帳、
                  編號報客服、徽章看狀態。」⇒ 欄位順序與標題字面照搬,不重排。 */}
              <div className="acc-order-top">
                <div className="acc-order-field">
                  <div className="acc-order-field-k">訂單日期</div>
                  <div className="acc-order-field-v">{formatOrderDate(o.createdAt)}</div>
                </div>
                <div className="acc-order-field">
                  <div className="acc-order-field-k">訂單金額</div>
                  <div className="acc-order-field-v acc-order-total">
                    NT$ {o.total.amount.toLocaleString()}
                  </div>
                </div>
                <div className="acc-order-field">
                  <div className="acc-order-field-k">訂單編號</div>
                  <div className="acc-order-field-v acc-order-id">{o.displayId}</div>
                </div>
                {/* 🔴 `#249`(2026-08-24):狀態字第三個參數帶取消軸。**取消不動 `payment_status`**
                    ⇒ 少了它,一張已作廢的單在這一格會印「待付款」,而客人會去付它。
                    🔴🔴 而**顏色是同一條拍板的另一半**:`orderStatusTone` 讓已取消/已逾期
                       走 `is-done`(中性),**不是** `is-action`(熔橘 = 全站叫人動作的顏色)。
                       ⇒ 少了顏色那半,字寫著「已取消」而整顆徽章在喊「來付款」。
                    ⚠️ 這張卡上**沒有任何付款入口**(唯一的連結是下面那顆「查看詳情」)
                       ⇒ Sean 那句「不能點去付款」在這一頁成立。
                       🔴 而那是**現況不是保證**:誰日後要在這張卡加付款鈕,先讀 `#249`
                       (memory `project_0824-sean-cancelled-orders-visible-and-notfound-copy`)。 */}
                <span
                  className={`acc-order-status is-${orderStatusTone(o.paymentStatus, o.fulfillmentStatus, o.cancelKind)}`}
                >
                  {orderStatusLabel(o.paymentStatus, o.fulfillmentStatus, o.cancelKind)}
                </span>
              </div>
              {/* 卡身。稿的卡身放 ETA / 物流條 / 商品列,而那三塊這一片都不做
                  (ETA 與物流歷程 Sean 2026-08-29 拍「先不做」;「查詢物流」他拍【要】,
                   而各家物流的網址格式查無 ⇒ 不接一顆連到空網址的鈕)。
                  ⇒ 這一輪卡身放的是【件數】與【那段說明】。 */}
              <div className="acc-order-body">
                <div className="acc-order-meta">
                  {/* 🔴 **`itemCountTruncated` ⇒ 件數不可信,改印「?」**(2026-08-16,`Q-EMBED-1`)。
                    ⚠️ **這裡【不能】照後台那條印「未知」蓋掉整格** —— 那一格印的是**一個算出來的狀態**,
                       蓋掉它員工還看得到別的欄;而**這裡蓋掉的是客人辨識自己訂單的資訊**。
                       ⇒ 只把**那個不可信的數字**換掉,單號與日期照常。
                    🔴 **不印 0、不留空** —— 兩者都會被讀成「這單沒東西」。
                       印 `?` 是「我們也不確定」,而下一步寫在下面那段**看得見的**說明裡
                       (~~原本寫「它旁邊的 title 給得出下一步」~~ —— `#639` 甲之後那句已不成立)。 */}
                  {/* 🔴 日期已經搬到上面的灰抬頭(稿的四欄之一)⇒ 這裡不再重複印它,
                      只留件數。~~原字面「{日期} · {件數} 件商品」~~ 是舊的兩欄版式,
                      而在三段式卡片裡重印一次日期會與抬頭那格打架。 */}
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
                {/* 🔴 商品列(Sean 2026-08-29 拍板「卡片裡列出每件商品,有圖有品名」)。
                    結構與 class 逐字搬自稿 `account-page.html:296-305`。
                    🔴 **null 有兩種,而它們的成因【不同】**(codex 對抗審查訂正,2026-08-29):
                       · `brand` / `imageUrl` ⇒ **合法的 null**:`order_items.variant_id` 是
                         `ON DELETE SET NULL`(訂單是歷史,不隨商品目錄變動)⇒ 變體刪掉 join 就斷。
                       · `title` ⇒ **理論上不會 null**:`product_snapshot` 是 NOT NULL 且 DB CHECK
                         要求 `?& array['title','sku','spec']` 且 title 必為 string
                         ⇒ 它為 null 表示**那個 CHECK 沒擋住的東西進來了**。
                       ⚠️ ~~我原本把三者一起講成「變體被刪就會這樣」~~ —— **那句對 title 是錯的。**
                       ⇒ 仍然要防:退成一句看得懂的話,而不是空白 —— 但那是**防禦性退路**,
                         不是預期路徑。真的看到它,該去查的是資料不是這裡。
                    ⚠️ **缺欄時【不得整列消失】** —— 那會讓客人以為他沒買過那個東西。
                       ⇒ 圖沒有就留空框(版位不塌)、品牌沒有就不印那一行、品名沒有就退成料號那句。 */}
                {/* 🔴 件數不可信時,商品列**也是被切過的**(同一個成因:內嵌上限)。
                    codex 對抗審查 must-fix(2026-08-29):原本只有件數那句說明,
                    而客人看到一份**看起來完整**的商品列 ⇒ 他會以為那就是全部。
                    ⇒ 這一行明說「下面列出的可能不是全部」。 */}
                {o.itemCountTruncated && o.items.length > 0 && (
                  <p className="acc-order-note">{ORDER_DETAIL_ITEMS_TRUNCATED_NOTE}</p>
                )}
                {o.items.length > 0 && (
                  <div className="acc-order-items">
                    {o.items.map((it, i) => (
                      <div className="acc-order-item" key={`${o.id}-${i}`}>
                        <div className="acc-order-thumb">
                          {/* ⛔ ~~原生 `<img>` + `{it.imageUrl ? … : null}`(沒有圖 ⇒ **空框**)~~
                              🔴 **2026-09-04 改走 `ProductImage`(⟦ship-ORDERIMG⟧ 甲案)** ——
                              成因:同一批商品客人在三個地方看到三種東西 ——
                              明細走 `ProductImage`(站內佔位圖)· 這裡空框 · 收藏什麼都沒有。
                              🎯 而那個不一致**不是這一片製造的**, 它在濾掉供應商佔位圖之前就在了;
                                 這一片只是把它收斂成一種。
                              🔵 原註解那段留著, 因為它記著一件仍然成立的事:
                                 「用原生 `<img>` 不用 `next/image`(外部 URL、46px)」——
                                 而 `ProductImage` 內部就是原生 `<img>`, 所以那個理由沒有被推翻。
                              ⚠️ ~~我原本在這裡加了 `eslint-disable-next-line @next/next/no-img-element`~~
                                 ⇒ **那條規則這個 repo 沒有裝** ⇒ lint 直接報
                                 「Definition for rule … was not found」而**紅掉**。 */}
                          <ProductImage image={it.imageUrl} label={it.title ?? 'PRODUCT'} />
                        </div>
                        <div>
                          {it.brand ? <div className="acc-order-item-b">{it.brand}</div> : null}
                          <div className="acc-order-item-n">{it.title ?? '(此品項已無資料)'}</div>
                        </div>
                        <div className="acc-order-item-q">
                          × {it.quantity}
                          <b>NT$ {it.lineTotal.amount.toLocaleString()}</b>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* 🔴 動作列 —— 稿 `account-page.html:312-320` 是三個:再買一次 / 下載訂單 PDF / 查看詳情。
                    **這一輪只放「查看詳情」**,而兩顆不放的理由各自不同,不要合併成一句:
                      · 「再買一次」⇒ Sean 2026-08-29 明寫**不做**(它不是純 UI,要「把舊單商品加回購物車」
                        的後端路徑:缺貨/下架/改價三個世界都要有形狀)
                      · 「下載訂單 PDF」⇒ **已拍板未實作**(2026-08-07 逐字「= 訂單明細/對帳單,不是發票」)
                        ⇒ 它**沒有後端**。照 Sean 自己那句「一顆連到空網址的按鈕比沒有按鈕糟」⇒ 不放。
                        🔴 要放的話那是**另一片**,不在這一顆順手加。
                    ⚠️ 而稿的註解逐字:「三個都是文字連結、**沒有實心底** —— 一筆訂單沒有『唯一該做的事』,
                       給它主鈕等於幫客人決定,而清單上十筆就會有十顆搶眼的鈕。」
                       ⇒ 只剩一顆時**更不要**把它升級成實心鈕。 */}
                <div className="acc-order-foot">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
