# 片 A `#484a`(含 `#488`)· 貨品軸 view + adapter 換源 —— plan

> 主視窗裁:形狀 = **view**、拆兩片、中間 apply 停點由 Sean 按。**本片 = 片 A。片 B(chip UI)另開。**
> 鐵則 **12③**(migration)+ **8**(跨 3 檔以上、動共用 adapter)⇒ **要 Sean 批 plan + codex 對抗審查不降級。**

## 1. 要改什麼、為什麼

**一個 bug + 一個新能力,共用同一份真相。**

- 🔴 **既有 bug(`#488`)**:訂單列表的「出貨狀態」下拉走 `.eq('fulfillment_status', …)`
  (`SupabaseOrderAdapter.ts:582`),而 `orders.fulfillment_status` **13/13 實測都是 `notOrdered`**
  ⇒ **員工用它篩「已到貨」今天必定回零筆**,而畫面上的狀態膠囊明明寫著別的。**這是一個正在騙人的篩選器。**
- 🆕 **新能力(`#484`)**:「未到貨」chip 需要「該單所有品項都到齊了嗎」這種**全稱條件**。

**兩者的正解是同一個**:讓**膠囊算的那份軸**變成 DB 可篩的欄位,然後**同時餵給 chip 與那個既有下拉**。
⇒ **一份真相、兩個消費者。**

## 2. 為什麼是 view(兩條已排除的,寫進明處免得下一個人再評一次)

- **產生欄:🔴 不是貴,是做不到。** PG 的 generated column 只能引用**同一列**且必須 immutable;
  貨品軸取決於**子列**(`order_items` × `order_item_quantity_summary`)。**可行性問題,不是成本問題。**
- **PostgREST filter 直接表達:做不到,已實測。** `instock_quantity=lt.quantity` → `400 22P02
  invalid input syntax for type integer: "quantity"`(對照組 `lt.99` → `401` 權限錯 ⇒ 兩者錯在不同階段,
  400 不是被 RLS 遮住的假訊號)。filter 右邊只能是字面值。
- **RPC:可行但更貴。** 既有 `admin_search_orders(p_query,p_limit,p_from,p_to)` 只給關鍵字、`p_limit` 硬夾 100、
  無分頁無篩選軸 ⇒ 等於新寫一支,而且要把列表投影**再抄一份**進 SQL = **第二份會漂的真相**。

## 3. 🔴 步驟 0:先驗一件會讓整個形狀作廢的事(**沒過就停下回報,不要硬做**)

`ADMIN_ORDER_LIST_SELECT`(`SupabaseOrderAdapter.ts:87`)是一個**深層 embedded select**
(`order_items(... product_variants(products(brands(name))) ...)`、`customers(name)`)。
**把 `.from('orders')` 換成 `.from(view)` 之後,PostgREST 還認不認得這些 embed,我沒有驗過。**

- **驗法**:在 **Supabase branch**(不是正式庫)apply view，用同一份 select 打一次,比對回傳形狀與筆數。
- **沒過的話**:view 這條形狀就不成立(或要退化成「view 只用來取 id、再 `.in('id',…)` 打 `orders`」= 多一次往返)。
  ⇒ **停下回報,不要自己改成第二形狀。**

## 4. 動哪些檔

| 檔 | 改什麼 |
|---|---|
| `supabase/migrations/<ts>_m4b_e10_484a_order_goods_axis_view.sql` | **新增** `admin_order_list_v` = `orders` 全欄 + `goods_axis text`(`none/ordered/instock/shipped`,算法**逐字對齊** `order-status-axes.ts:126-133` 的判序:`shipped ⊆ instock ⊆ ordered`,**先問最遠的**)。`security_invoker = true`(admin 走 service_role,無繞過 RLS 的需求 ⇒ 不用 definer)。`GRANT SELECT` **只給 `service_role`**,🔴 **不給 `anon` / `authenticated`**(這支帶訂單全欄與客戶關聯)。附 `COMMENT` 寫明理由。 |
| 同上 `-down` | `DROP VIEW` 回退腳本(照 `scripts/452a-down.sql` 的既有形狀) |
| `packages/domain/src/order/types.ts` | `AdminOrderFilter` 加 `goodsAxes?: readonly OrderGoodsAxis[]`(多值,與既有 `orderSources` 同形) |
| `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` | `.from('orders')` → view;新增 `.in('goods_axis', …)`;🔴 **`fulfillment_status` 那條 `.eq` 改接 `goods_axis`**(= `#488` 的修法) |
| `apps/admin/src/lib/orders/order-list-view.ts` | 「出貨狀態」下拉的選項字面改對應四軸值;param 白名單同批 |
| 各層同層測試 | 見 §5 |

⚠️ **片 A 不含 chip UI**(那是片 B)。片 A 上線後畫面**只有一個可見變化**:那個下拉真的篩得動了。

## 5. 驗收(每條 yes/no)

1. ☐ 步驟 0 過(embed 形狀與筆數與換源前一致)
2. ☐ 🔴 **用「已到貨」篩,回的筆數 = 膠囊顯示已到貨的筆數**(**不是**「不等於零」—— 那太弱)。
   同一份 fixture 兩邊各數一次、相等才算過。四個軸值**逐值各一格**。
3. ☐ view 的軸與 `orderGoodsAxis()` **同源守門**:同一份資料餵兩邊,結果逐列相等。
   🔴 **這格要有負測**:把 view 的判序倒過來(先問 `ordered`)⇒ 必須紅。
4. ☐ `GRANT` 實查:`anon` / `authenticated` 對這支 **無 SELECT**(查 `information_schema.role_table_grants`)
5. ☐ 分頁與 `count: 'exact'` 行為不變(換源前後同一組篩選的總數相等)
6. ☐ 三綠 + build,四個 EXIT 分開貼
7. ☐ 回退腳本實跑一次(`DROP VIEW` 後 adapter 指回 `orders` 仍可運作)

## 6. Rollback

**兩段、可分別執行**:①app 層 revert 單一 commit ②`DROP VIEW`。
🔴 **順序有硬性要求**:先 revert app、後 DROP view。反過來會讓線上 app 指向不存在的關聯
(同族=`feedback_app-layer-must-not-ship-before-migration-apply`,今天 handoff §7 也記著同一條)。
⇒ **apply 停點由 Sean 按**,片 B 不得在片 A apply 之前上線。

## 7. 估時(取代 `E-509` 的 140 分整包)

片 A = **95 分**(步驟 0 驗證 15 / migration 35 / adapter+domain 25 / 測試 20)。片 B = **45 分**。
⚠️ 不含 plan 批准等待、codex 對抗審查與折 findings 的時間。**這是看 diff 面積估的,沒拆到步驟級。**

## 8. 我沒查的
- **步驟 0 的答案**(view 上的 embed)—— 本 plan 最大的未知,已擺在第一步。
- **view 的查詢成本**:今天 13 張單、規劃量每月 100-300 ⇒ 我判斷不需要索引或物化。**這是推的,沒 EXPLAIN。**
- **`orders.fulfillment_status` 本身要不要一起修/退場**:本片只是**不再靠它篩**。
  它仍被 `20260714120000_m4a_order_workflow_status.sql:142-148` 的推導式吃著 ⇒ **那條路徑我沒查**,留在 `#488`。
