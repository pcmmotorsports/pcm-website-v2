# `#240` 會員訂單詳情頁 —— 偵察 + plan

> 作者:G1 · 2026-08-19 · 🔴 **狀態:尚未批准,一行 code 未動。**
> 主視窗指示:**第一步驗 `#217` 那個 `✅` 是不是真的**(G6 自陳只讀了狀態欄字面)。

## ① 前置驗證:**`✅` 是真的,而它的意思和「可以照原解法做」相反**

### 三把不同原理的尺,結論一致:**`order_items.product_id` 不存在**
```
尺一 型別檔      packages/adapters/src/supabase/database.types.ts 的 order_items Row
                 欄位:availability_at_checkout / id / line_total / order_id / product_snapshot /
                 quantity / unit_price / updated_at / variant_id / variant_sku / vehicle_snapshot /
                 version / workflow_status ⇒ **沒有 product_id**
尺二 migrations  `git grep -rn product_id -- supabase/migrations | grep -i order_item` ⇒ **0**
                 🔴 正向對照(同範圍該命中的)`variant_id` ⇒ **7** ✅ 尺是活的
尺三 RPC 插入    20260604130000_m3_s2b1_create_order_rpc.sql:253-259 的欄位清單逐字:
                 `order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total`
```
⇒ 🔴 **主視窗要我「對正式庫查一發分佈,因為有欄位 ≠ 有資料」——【那一步不必跑】:欄位根本不存在。**
(先確認欄位在不在,比先查資料分佈便宜、而且結論更硬。)

### 那 `#217` 的 `✅` 是什麼意思
`#217` 條目逐字:**「結案 2026-08-18 19:2x = **D(不動 domain,明細頁走唯讀投影)**」**,裁定者=主視窗。
⇒ **它是「決定不加欄位」而結案的,不是「加好了」而結案的。**
⇒ **`#240` 的前置確實滿足了** —— 因為 `#217` 選的 D 就是 `#240` 條目裡寫的「**或詳情用獨立 read DTO**」那一支。

### 🔴 而 `#240` 條目自己的「預期解法」**已經過期,照做會撞到明文禁止**
```
#240 條目寫:「啟用 SupabaseOrderAdapter.findById（目前 deferred-stub）+ 讀 mapper 重建單筆」
而 packages/ports/src/IOrderRepository.ts:73 逐字:
   listByCustomer「維持 deferred(2026-08-18 `#217` 裁定 D ⇒ **刻意不提供**)」
   SupabaseOrderAdapter.ts:1193 findById 直接 throw，訊息點名 #217
⇒ **那不是「還沒做」，是「決定不做」。** 照條目的解法走 = 推翻昨天的裁定。
```
✅ **正確形狀**:比照現行 `listSummariesByCustomer`(`IOrderRepository.ts:75`)**新增一支詳情投影**,
不重建 domain `Order`、不碰 `findById`。

## ② 🔴 鐵則 1:design-reference **沒有**這一頁,而 **OD 有** —— 而且是為了這顆鈕才補的

```
design-reference 20 支元件逐個看過 ⇒ **沒有訂單詳情頁**
   AccountPages.jsx:551 `<button className="acc-order-detail">查看詳情 →</button>`
   ⇒ **裸 button、沒有 onClick、沒有 href** ⇒ **design 自己就是一顆死鈕，我們忠實地照搬了它**
   正向對照(同檔「訂單」)⇒ 6 命中 ✅ 尺是活的
```
```
OD `pcm-home-redesign` 有 **order-detail-page.html（306 行）**，2026-08-07 新建，檔頭逐字:
   「這一頁**原本完全沒有稿** —— OD 全專案查無任何 order-detail* 檔,所以會員中心的
     『查看詳情 →』一直是一顆沒有 onClick 也沒有 href 的鈕…稿補上,那顆鈕才有地方去。」
```
⇒ **真權威在 OD**(與 `#309` / 商品頁同一條線)。**設計存在 ⇒ 這一片不是「要先請設計畫」。**

### 🔴 OD 同時定了兩件我們現在做錯的事
```
網址契約  order-detail-page.html 檔頭逐字「/account/orders/<displayId>。原型用 ?id= 帶，真站是動態路由段」
          ⇒ **用 displayId，不是 orders.id 那個 UUID**
鈕的形狀  account-page.html:319 `<a class="acc-order-detail" href="/account/orders/${encodeURIComponent(o.displayId)}">`
          ⇒ **是 `<a href>`，不是 `<button>`** ⇒ 我們現在的 `<button>`（OrdersTab.tsx:74）要換成連結
```
⚠️ **而我沒有讀完那 306 行**(只讀了檔頭 55 行 + 兩處搜尋命中)⇒ **版面細節要實作前整份搬,不憑這份 plan 的摘要。**

## ③ 與 `#278` 的邊界:**沒有交集**
`#278` 是 **admin 客戶明細**的訂單歷史(`SupabaseOrderAdapter.ts:582` 的 `.neq('payment_status','unpaid')`),
不是 `/account`。⇒ **兩片不會互相蓋掉。**
📎 而 G6 已在 `#278` 條目標「**這條的前提已經被推翻,而推翻它的東西已經上線了**」⇒ 那條的現況要看 G6,不是我。

## ④ 分級與鐵則
```
L 分級   不適用（不是站上可編輯內容，是功能頁）
片型     標準片以上
鐵則 8   **命中** —— 新路由 + 新元件 + port/adapter 新增投影 + OrdersTab 改鈕 ⇒ 遠超 3 檔
鐵則 12  ⚠️ **要主視窗判**:它讀的是【客人自己的訂單金額】，而 RLS own-only 是既有的
         （orders_select_own / order_items_select_own）。我判**不動權限、只新增讀投影** ⇒ 不命中 12②；
         而「新增一支會讀訂單的投影」離 12① 很近 ⇒ **我不自己判，列在這裡等裁。**
```

## ⑤ 驗收條件(每條可 yes/no)
1. **零洩漏**:投影只回白名單欄(`product_snapshot` 的 title/sku/spec、`unit_price`、`line_total`),**不含成本、不含經銷價**。配一個負測:塞一筆有 cost 的假資料,斷言它不在輸出裡。
2. **own-only**:拿 A 的 session 讀 B 的 `displayId` ⇒ **查無**(不是 403、不洩存在性)。
3. **網址用 displayId**,且不存在的 displayId ⇒ 走 OD 的「查無此單」狀態(`?id=nope` 那個預覽態)。
4. **那顆鈕變成連結**:`OrdersTab.tsx:74` 由 `<button>` 改 `<a href>`,而**鍵盤可達**(它現在是 button、本來就可 focus,改成 a 要確認不退化)。
5. 四綠(`TURBO_FORCE=1`,動 `.tsx` ⇒ 含 build)。

## ⑥ 我沒做/沒查的
```
· **沒讀完 OD 那 306 行**（只讀檔頭 55 行 + 搜尋命中）
· 沒走過會員中心真畫面（要登入；G3 那條線有登入，訂單頁量測該掛它）
· 沒查「listSummariesByCustomer 的 .neq unpaid」會不會讓客人在列表看不到自己的待付款單
  ⇒ 🔴 那是 #249/#278 那一族，而**它會決定詳情頁進得去進不去** —— 進不去的單，詳情頁也沒入口
· 沒查 OrderCompletePage 的「查看訂單詳情」連到哪（design 那支也有一顆）
```
