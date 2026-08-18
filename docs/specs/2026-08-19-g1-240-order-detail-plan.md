# `#240` 會員訂單詳情頁 —— 偵察 + plan

> 作者:G1 · 2026-08-19 · 🔴 **狀態:尚未批准,一行 code 未動。**
> 主視窗指示:**第一步驗 `#217` 那個 `✅` 是不是真的**(G6 自陳只讀了狀態欄字面)。

## ⓪ 🔴 第 0 步(GR-066 MF-3):**先把 OD 那 306 行整份讀完,欄位清單落成本 plan 的附錄**

```
現況:我只讀了檔頭 55 行 + 兩處搜尋命中 ⇒ **§⑤-1 白名單的分母是「還沒讀的 251 行」**
檔頭給的是【結構契約】(共用 .acc-main、資料同源、網址契約)；
而【內容契約】—— 地址 / 物流 / 狀態時間軸 / 發票欄 —— 全在後面那 251 行裡
⇒ 🔴 OD 若畫了它們，**白名單、洩漏面、估時三個全部要重算**
```
⇒ **實作的第一步不是寫 code,是把那 306 行的欄位清單抄成附錄**;§⑤-1 的白名單**以那份附錄為分母**。

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
片型     高風險片（見下）
鐵則 8   **命中** —— 新路由 + 新元件 + port/adapter 新增投影 + OrdersTab 改鈕；檔數 ≈ 7+
鐵則 12① 🔴 **命中**（GR-066 MF-1 翻掉主視窗「不命中」那一裁，我複驗過、採納）
```

### 🔴 12① 為什麼從「不命中」翻成「命中」
```
原裁定（主視窗）:唯讀投影【不寫金額、不改狀態、不動權限】⇒ 12① 管的是【改動】⇒ 不命中
GR-066 MF-1 兩個問題:
  (a) **12① 是【領域清單】**（order・payment・refund・pricing 字面在列），
      而原裁定用「不改」這個【動詞】判準去答一個【領域】題
  (b) 🔴 **決定性的是先例**:同族上一片（OrdersTab 列表投影 `0c78bfb6`）的 commit body 逐字
      「codex **關卡1 round2 PASS** 後實作」+「待審查 session codex **關卡2 sign-off**」
      ⇒ **艦隊自己把同族唯讀投影當雙關卡級在審，就在上一片。**
```
✅ **我開檔複驗過那顆 commit body**(`git log -1 0c78bfb6`),GR 引的兩句逐字都在。
⇒ 依「**自評有風險只能加審不能免審**」⇒ **本片走關卡2,不省。**

### 🔴 而 GR 要的那根 pin(plan 原本沒寫,是真的漏)
```
**投影必須走 RLS-scoped 的 cookie client，禁用 service client。**
理由:選錯 client ⇒ RLS 被繞過 ⇒ 12②（權限）當場活過來，而畫面上完全看不出來。
⇒ 這一行要寫進實作紀律，並配一格測試（用 A 的 session 讀 B 的單 ⇒ 查無）。
```

## ④-b 影響面 / rollback / 估時(鐵則 8 逐字要求,GR-066 MF-2 指出我漏了)
```
影響面  新增:訂單詳情路由 + 詳情元件 + port 介面一支 + adapter 投影一支 + 對應測試
        修改:OrdersTab.tsx:74 那顆鈕（<button> → <a href>）
        **不動**:findById / listByCustomer（#217 裁定 D 明文「刻意不提供」）、
                現行 `.neq('payment_status','unpaid')` 過濾（#249 Sean 拍板）、
                任何寫路徑、任何 RPC、任何 migration
rollback 單一 commit `git revert`。**零 schema、零 migration、零資料面副作用**
        ⇒ 撤掉之後那顆鈕回到今天的樣子（死鈕），不會留下半條路由
估時    🔴 **我不給數字** —— 大頭是 OD 306 行的版面移植（商品頁級的工），
        而**我只讀了檔頭 55 行**（GR-066 MF-3）⇒ 估時要等 §⓪ 讀完才算得出來。
        ⚠️ 條目原本寫的「~60-90 min」是 2026-06-20 寫的，**那時 OD 那份稿還不存在**（2026-08-07 才建）
        ⇒ **那個估時已經過期，不要拿它排程。**
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
· ~~沒查「listSummariesByCustomer 的 .neq unpaid」~~ ⇒ **查完了,見 §⑦。結論是【不要修它】。**
· 沒查 OrderCompletePage 的「查看訂單詳情」連到哪（design 那支也有一顆）
```

---

## ⑦ 🔴 前置風險查完了:**客人看不到自己的 `unpaid` 單 —— 而那是 Sean 拍過的,不是 bug**

### 量到的
```
packages/adapters/src/supabase/SupabaseOrderAdapter.ts:582
   .neq('payment_status', 'unpaid')   // #249 治標:藏放棄付款的 unpaid 孤兒單(前提=無線下待付款單)
```
`#249` 條目逐字:**「Sean 2026-07-02 拍 A+甲」** ⇒ **Phase 1 維持「顯示層藏孤兒單」**,治本(付成才建單)定調 **Phase 2**。
⇒ 🔴 **那是拍過的決定,不是遺漏。`#240` 不得順手把它拿掉。**

### 對 `#240` 的實際影響 —— **比想像的小**
```
`.neq` 是【單值】⇒ 被藏的只有 `unpaid` 一種 ⇒ **`partiallyPaid` 客人看得到**
⇒ 「付一半」的單有入口、有詳情頁；只有【完全沒付成的孤兒單】沒有入口
⇒ 而那正是 #249 要藏的東西 ⇒ **一致，不是新洞**
```
✅ **⇒ `#240` 照現行過濾器做就對了。** 詳情頁的入口天然只會有「列表看得到的那些」。

### ⚠️ 兩格要寫進實作紀律,否則會踩到
```
① 🔴 詳情頁【自己】不要放寬過濾 —— 有人直接用 displayId 打詳情路由時，
   若詳情投影沒有同一道 `.neq`，**被藏起來的孤兒單會從詳情頁漏出來**
   ⇒ 那會讓 #249 的決定在【另一個入口】失效。**詳情投影必須套同一道過濾。**
   📌 而這是【設計決定】不是安全洞:RLS own-only 仍在，客人只看得到自己的單。
② `#249` 條目自己寫的安全前提:「**未來若新增線下付款方式，此過濾須重審**
   (否則藏掉合法待付款單)」⇒ 那天到了，`#240` 的入口也要跟著重審。
```

### 📎 而它與結帳那片是**同一個客人的同一次經歷**
被藏的 `unpaid` 孤兒單,正是**客人放棄 3DS 之後留下的那一張**。
⇒ `2026-08-19-g1-checkout-login-redirect-plan.md` §⑨ 講的「他回購物車再結一次 ⇒ 第二張單」——
**那第一張單就是這裡被藏起來的那張。** ⇒ 兩片講的是同一件事,而處置分屬兩處。
