// shipment-limits.ts — 出貨線的輸入上限常數。
//
// 🔴 **本檔【刻意沒有】`import 'server-only'`,而那不是漏掉。**
//    `shipment-candidates.ts` 有 server-only(它碰得到成交價與 PII)⇒ client 元件 import 不了它。
//    而下面這個上限**兩邊都要用**:
//      · server(`loadShipmentCandidates`)= **安全控制**,擋被竄改的請求
//      · client(`shipment-launcher`)   = **文案**,讓員工在按下去之前就知道要分批
//    ⇒ 常數住在一個兩邊都 import 得到的地方,**否則它會被抄成兩份而各自漂**。
// ⚠️ 本檔只准放**數字與純函式**,不准放任何會碰資料的東西 —— 一放進來,
//    server-only 那道牆就等於在這裡開了一個洞。

/**
 * 建一張出貨單一次能勾幾張訂單的**硬上限**。超過就擋掉,**不截斷**。
 *
 * 🔴🔴 **`50` 【不是】抄 `ORDER_ITEMS_EMBED_LIMIT = 200`,兩者母體不同:**
 * - `200` = **一張訂單有幾個品項**的業務上緣(Sean 2026-08-17 逐字「可能到 200 個」)。
 * - `50`  = **員工一次勾幾張訂單**。
 * ⇒ **形狀可以抄,數字不能抄。**
 *
 * ⚠️ **這個值是【判斷】,不是量出來的** —— 沒有統計過實際勾選張數的分布。
 *    上游唯一的兩個硬事實(當場量的):`orders-table.tsx` **刻意沒有全選框**、
 *    `ORDERS_PAGE_SIZE = 20`(`lib/orders/order-list-view.ts:42`)。
 *    🔴 **但那兩個事實【擋不住】跨頁累積** —— codex 2026-08-17 R2 查到勾選狀態
 *    (`ShippingSelectionProvider`,`app/orders/page.tsx:247`)在純 search-param 換頁下會保留
 *    ⇒ **員工翻到第三頁就合法累積得到 51 張。**
 *    ⚠️ 這一條我**沒有在真瀏覽器上驗過**,是 codex 讀 Next 原始碼推出來的
 *    ⇒ 標**未實測**;而**正因為沒定論,client 端那句文案才更要有**(見 `shipment-launcher`)。
 * ⇒ 真的有人合法撞到 50,那是**把值調高**的理由,不是把守門拆掉的理由。
 */
export const MAX_SHIPMENT_CANDIDATE_ORDERS = 50;
