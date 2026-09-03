/**
 * 查商品一次最多回幾筆。
 *
 * 🔴 **為什麼它自己一支檔**:`manual-order-catalog.ts` 檔頭有 `server-only`
 *    (它建 service client)⇒ **client 元件 import 它會讓 build 紅**
 *    (實測:`Turbopack build failed with 45 errors`,而 typecheck 與 lint **都是綠的**)。
 * 🎯 ⇒ 而 `manual-order-line-price-check.tsx`(client)需要這個數字來判
 *    「查詢是不是滿了」—— 滿了就不敢說「不在型錄裡」。
 * 🛑 **不要在那支 client 檔裡重打一個 20** —— 兩份會漂,而漂掉不會有東西紅。
 *    ⇒ 📌 單一權威放這裡, 兩邊都 import。
 */
export const MANUAL_ORDER_CATALOG_LIMIT = 20;
