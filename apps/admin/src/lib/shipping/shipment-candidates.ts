import 'server-only';

// shipment-candidates.ts — 建箱彈窗的資料源:把勾選的訂單換成「還能出什麼、還能出幾件」。
//
// 🔴🔴 **鐵則 12 面:這支的唯一職責就是把價格擋在 server 端。**
//    `AdminOrderDetail.items` 帶成交價(`unitPrice` / `lineTotal`)與客人 PII。
//    彈窗只需要**品名 + 還能出幾件**,所以本檔吐的是一個**刻意很窄的 DTO**:
//    `{ orderItemId, orderDisplayId, title, remaining }` —— 沒有任何金額欄位。
//    ⇒ 呼叫端把這個 DTO 交給 client 元件是安全的;把 `AdminOrderDetail` 交過去不是。
//    `import 'server-only'` 讓「有人不小心從 client 檔 import 它」變成**建置期錯誤**,
//    不是等到上線才發現金額進了 bundle。守門另有一條釘住這個 import。
//
// 🔴 **「還能出幾件」= 訂購數 − 已取消 − 已配箱**,三個減項缺一不可:
//    · 已取消:取消掉的不該再出。
//    · 已配箱:**含還沒寄出的草稿箱**(見 `listAssignedQuantitiesByOrderItemIds` 檔頭)——
//      漏了它,同一件會被裝進第二個箱子。
//    ⚠️ 這裡**不是**正確性層。真正擋住超額出貨的是 DB;本檔只是不要讓員工看到根本不能選的東西。

import type { AdminOrderDetail } from '@pcm/domain';
import { getAdminOrderRepository } from '../orders/order-repository';
import { listAssignedQuantitiesByOrderItemIds } from './shipment-repository';

/** 彈窗用的一個可出貨品項。**刻意沒有任何金額欄位**(見檔頭)。 */
export type ShipmentCandidateItem = {
  orderItemId: string;
  /** 顯示用的單號(讓員工看得出這件來自哪一張單;跨單裝同一箱是允許的)。 */
  orderDisplayId: string;
  title: string | null;
  /** 還能出幾件 = 訂購 − 已取消 − 已配箱(≥0)。 */
  remaining: number;
};

export type ShipmentCandidates = {
  items: ShipmentCandidateItem[];
  /**
   * 收件資料(取自第一張單的 `shippingAddress`)。
   * 🔴 形狀**恰好**是 `admin_create_shipment` 要的 `{name, phone, line}` 三欄
   * (`pcm_b2_w3a_recipient_shape` 多一個少一個都退件)。
   */
  recipient: { name: string | null; phone: string | null; line: string | null } | null;
};

/**
 * 🔴🔴 **本檔沒有「同客人」的 server 端交叉核對 —— 這是明說的缺口,不是漏做。**
 *
 * `AdminOrderDetail` 只有 `customer: {name, email, phone}`,**沒有 customer id**
 * (2b-0 只把 id 加進了**列表**的讀模型)。要在這裡核對,得再動一次
 * `ADMIN_ORDER_DETAIL_SELECT` 的白名單 —— 而那份是**帶 PII 的明細專用白名單**,
 * 又是一輪鐵則 12。
 *
 * 而那道閘**已經有兩個地方在守**:
 *   ① UI:別的客人的框變灰(`shipping-selection.tsx`)
 *   ② 狀態層:`nextSelection` 拒收不同客人
 *   ③ **DB(權威)**:`pcm_b2_w3b2_item_not_customers` —— 客戶端就算說謊,
 *      `admin_add_shipment_items` 也會退件。
 *
 * ⇒ 少了 server 端這一道,**安全性質不變**(DB 是權威),差別只在「錯誤要到送出才發現」。
 * 為了一個 UX 上的早期偵測去動 PII 白名單,代價與收益不成比例。
 * 🔴 但這句話的**失效條件**要寫下來:哪天 `AdminOrderDetail` 因為別的理由拿到了 customer id,
 * 這裡就該補上核對 —— 那時它是零成本的。
 */

/** 從一張訂單明細算出它的候選品項(不含金額)。 */
function itemsOf(detail: AdminOrderDetail, assigned: Map<string, number>): ShipmentCandidateItem[] {
  return detail.items.map((it) => {
    const cancelled = it.quantitySummary?.cancelledQuantity ?? 0;
    const already = assigned.get(it.id) ?? 0;
    // 🔴 這裡**刻意不包 `Math.max(0, …)`**。第一版包了,而突變 M3 證明它是**死碼**:
    //    負數之後一定被下方的 `filter(remaining > 0)` 濾掉,包不包行為完全相同
    //    ——「防止顯示負數」那句宣稱是假的,真正在做事的是那道 filter。
    //    摘要是衍生快取(A1 表 COMMENT 逐字「衍生值,非真相」)、可能與 shipment_items 短暫不一致
    //    ⇒ 算出負數是可能的,而**負數與 0 一樣都代表「這件不能再出」**,由 filter 統一擋掉。
    const remaining = it.quantity - cancelled - already;
    return {
      orderItemId: it.id,
      orderDisplayId: detail.displayId,
      title: it.title,
      remaining,
    };
  });
}

/**
 * 勾選的訂單 → 可出貨品項清單。
 *
 *
 * ⚠️ 逐張訂單各打一次 `findAdminOrderDetail`(N 張 = N 次查詢)。
 * 員工一次勾的張數是個位數 ⇒ 先用最簡單的做法;真的變慢再改批次查詢,**不預先最佳化**。
 */
export async function loadShipmentCandidates(
  orderIds: readonly string[],
): Promise<ShipmentCandidates> {
  if (orderIds.length === 0) return { items: [], recipient: null };

  const repo = getAdminOrderRepository();
  const details = (await Promise.all(orderIds.map((id) => repo.findAdminOrderDetail(id)))).filter(
    (d): d is AdminOrderDetail => d !== null,
  );
  if (details.length === 0) return { items: [], recipient: null };

  const allItemIds = details.flatMap((d) => d.items.map((it) => it.id));
  const assigned = await listAssignedQuantitiesByOrderItemIds(allItemIds);

  return {
    // 🔴 `remaining === 0` 的不吐出去:員工看到一個永遠選不了的列只會困惑。
    items: details.flatMap((d) => itemsOf(d, assigned)).filter((i) => i.remaining > 0),
    recipient: details[0]!.shippingAddress,
  };
}
