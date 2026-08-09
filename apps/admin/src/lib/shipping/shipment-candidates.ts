import 'server-only';

// shipment-candidates.ts — 建箱彈窗的資料源:把勾選的訂單換成「還能出什麼、還能出幾件」。
//
// 🔴🔴 **鐵則 12 面:這支的唯一職責就是把價格擋在 server 端。**
//    `AdminOrderDetail.items` 帶成交價(`unitPrice` / `lineTotal`)與客人 PII。
//    彈窗只需要**單號 + 品名 + 料號 + 還能出幾件**,所以本檔吐的是一個**刻意很窄的 DTO**:
//    `{ orderItemId, orderDisplayId, variantSku, title, remaining }` —— 沒有任何金額欄位。
//    (`variantSku` = 料號,2026-08-09 Sean 實測後追加:員工核對包裹內容靠料號、不是靠品名。
//     它是非價格欄、`ADMIN_ORDER_DETAIL_SELECT` 早就取了它 ⇒ 零白名單改動。)
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
import {
  listAssignedQuantitiesByOrderItemIds,
  listOrderCustomerUserIds,
} from './shipment-repository';

/** 彈窗用的一個可出貨品項。**刻意沒有任何金額欄位**(見檔頭)。 */
export type ShipmentCandidateItem = {
  orderItemId: string;
  /** 顯示用的單號(讓員工看得出這件來自哪一張單;跨單裝同一箱是允許的)。 */
  orderDisplayId: string;
  /** 料號(`order_items.variant_sku`)。非價格欄;員工核對箱內實物靠它。 */
  variantSku: string;
  title: string | null;
  /** 還能出幾件 = 訂購 − 已取消 − 已配箱(≥0)。 */
  remaining: number;
};

export type ShipmentCandidates = {
  items: ShipmentCandidateItem[];
  /**
   * 這批訂單**共同**的客人。`null` = 查不到、或它們不屬於同一位客人 ⇒ 呼叫端不得開窗。
   *
   * 🔴 **這一欄是「早期偵測」,不是權威。** 它會跨 server→client 邊界送給彈窗的呼叫端,
   * 所以**不能**拿它當建箱的客人來源 —— 送出去的東西回得來,回得來的東西可以被改。
   * 建箱真正用的客人由 `submitShipment` **從送出的品項自己反查**
   * (`listCustomerUserIdsByOrderItemIds`),client 連這個欄位都送不出去。
   * ⇒ 本欄唯一的作用是讓員工在**按下去之前**就看到「這批單裝不成同一箱」。
   */
  customerUserId: string | null;
  /**
   * 收件資料(取自第一張單的 `shippingAddress`)。
   * 🔴 形狀**恰好**是 `admin_create_shipment` 要的 `{name, phone, line}` 三欄
   * (`pcm_b2_w3a_recipient_shape` 多一個少一個都退件)。
   */
  recipient: { name: string | null; phone: string | null; line: string | null } | null;
};

/**
 * 🔴🔴 **「同客人」的 server 端交叉核對(2026-08-09 補上;先前是明說的缺口)。**
 *
 * 舊註解說這一道做不起來,理由是「`AdminOrderDetail` 沒有 customer id,要拿得動
 * `ADMIN_ORDER_DETAIL_SELECT` 這份帶 PII 的白名單」。**那個理由的失效條件當時就寫下來了**,
 * 而它現在成立了:詳情頁出貨入口需要客人身分,於是改走
 * `listOrderCustomerUserIds()` —— **只投影 `id, customer_user_id` 兩欄的獨立查詢**,
 * 完全不碰明細白名單。⇒ 原本「代價與收益不成比例」的判斷不再成立,這道就補上了。
 *
 * 現在四道:
 *   ① UI:別的客人的框變灰(`shipping-selection.tsx`)
 *   ② 狀態層:`nextSelection` 拒收不同客人
 *   ③ **本檔(server)**:`orders` 查出來的客人不只一位 ⇒ `customerUserId = null` ⇒ 開不了窗
 *   ④ **DB(權威)**:`pcm_b2_w3b2_item_not_customers` —— 前三道全繞過也會被退件
 *
 * ⚠️ **①②③ 全是體驗層,一條都不是權威**:它們算出來的值都會跨到 client、都可以被改。
 * 「箱子掛誰」的來源在 `submitShipment` —— 它從**送出的品項自己**反查客人,
 * 而那批品項正是 ④ 會拿去核對的同一批 ⇒ 竄改構造不出跨客人的箱。
 * 🔴 這個區分是 2026-08-09 codex R1 打回來的:第一版把 ③ 寫成「client 碰不到的來源」,
 * 但那個值**經過 client 再送回來**,宣稱與事實不符。
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
      variantSku: it.variantSku,
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
  if (orderIds.length === 0) return { items: [], customerUserId: null, recipient: null };

  const repo = getAdminOrderRepository();
  const details = (await Promise.all(orderIds.map((id) => repo.findAdminOrderDetail(id)))).filter(
    (d): d is AdminOrderDetail => d !== null,
  );
  if (details.length === 0) return { items: [], customerUserId: null, recipient: null };

  const allItemIds = details.flatMap((d) => d.items.map((it) => it.id));
  const [assigned, customerByOrderId] = await Promise.all([
    listAssignedQuantitiesByOrderItemIds(allItemIds),
    listOrderCustomerUserIds(details.map((d) => d.id)),
  ]);

  // 🔴 **恰好一位**才給:0 位(查不到)與 2 位以上(跨客人)都回 null ⇒ 呼叫端開不了窗。
  //    ⚠️ 用 `details` 的 id 而不是輸入的 `orderIds` —— 查無的訂單上面已經濾掉了,
  //    拿沒濾過的清單去比會讓「有一張單查不到」被誤判成「跨客人」。
  const distinct = new Set(
    details.map((d) => customerByOrderId.get(d.id)).filter((v): v is string => v !== undefined),
  );
  const complete = distinct.size === 1 && customerByOrderId.size === details.length;

  return {
    // 🔴 `remaining === 0` 的不吐出去:員工看到一個永遠選不了的列只會困惑。
    items: details.flatMap((d) => itemsOf(d, assigned)).filter((i) => i.remaining > 0),
    customerUserId: complete ? [...distinct][0]! : null,
    recipient: details[0]!.shippingAddress,
  };
}
