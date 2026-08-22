# `#240` 會員訂單詳情頁 —— 偵察 + plan

> 作者:G1 · 2026-08-19 · 🔴 **狀態:尚未批准,一行 code 未動。**
> 主視窗指示:**第一步驗 `#217` 那個 `✅` 是不是真的**(G6 自陳只讀了狀態欄字面)。

## ⓪ ✅ 已完成(線2,2026-08-23):OD 那份稿整份讀完,欄位清單見附錄 A

原文要求:「先把 OD 那 306 行整份讀完,欄位清單落成本 plan 的附錄」(GR-066 MF-3)。

**已完成。** 實測 `wc -l` ⇒ **305 行**(原文寫 306,差一行,不影響任何結論)。
檔案(🔴 **用絕對路徑,因為 OD 工具現在查不到它**):

```
/Users/sean_1/Library/Application Support/Open Design/
  namespaces/release-stable/data/projects/pcm-home-redesign/order-detail-page.html
```

🔴 **OD 的 `list_projects` 回空陣列,而磁碟上有 11 個專案**(2026-08-23 線2 實測、主視窗複驗:
`mcp__open-design__list_projects()` ⇒ `{"projects": []}` / `ls "<上面那個 projects 目錄>" | wc -l` ⇒ `11`)
⇒ **從此鐵則 1 查 OD 真權威一律直接讀磁碟,不要只信 `list_projects`。**
`#240` 的稿因此被兩個窗各判過一次「查無」,而它 2026-08-07 就在那裡。
📌 三個 `pcm-home-redesign*` 專案裡**只有無後綴那個有 `order-detail*`**(`-codex` ⇒ 0 / `-opus5` ⇒ 0)
⇒ 無版本分歧,讀的就是唯一那份。
⚠️ **為什麼 daemon 指不到,沒有人查出根因。** 線A 已排除三個猜測(daemon 沒跑 / namespace 指錯 /
磁碟與 sqlite 對不起來 —— `projects` 與 `workspace_projects` 各 11 列,對得上),
收窄成「**MCP 接上了,而它問到的那個範圍是空的**」;唯一未排除的方向是
`team_project_materializations` 0 列(**標未確認,線A 未證**)。

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
   SupabaseOrderAdapter.ts:1194 findById 直接 throw，訊息點名 #217
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
`#278` 是 **admin 客戶明細**的訂單歷史(`SupabaseOrderAdapter.ts:586` 的 `.neq('payment_status','unpaid')`),
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
估時    **前提已解除**(§⓪ 已完成,OD 305 行讀完、欄位清單見附錄 A),但數字取決於
        Q-A'(圖片與品牌)⇒ Sean 2026-08-23 拍 **乙**(開 join、忠實照稿)⇒ 依乙估。
        ⚠️ 待實作窗填入;**本檔不填憑空數字。**
        ⚠️ 條目原本寫的「~60-90 min」是 2026-06-20 寫的，**那時 OD 那份稿還不存在**（2026-08-07 才建）
        ⇒ **那個估時已經過期，不要拿它排程。**
```

## ⑤ 驗收條件(每條可 yes/no)
1. **零洩漏**:投影為 module-level `export const` 具名白名單、禁 `select('*')`,讓測試可 byte-equal 守門(比照 `ORDER_LIST_SELECT` 先例)。投影字串**刻意整條各寫一次、不與 admin 那份拼接** —— `ORDER_ITEMS_DETAIL_SELECT` docstring(`:414-424`)逐字:兩份的收放理由完全不同,拼接會製造沒人預期的連動。比 `ADMIN_ORDER_DETAIL_SELECT` 少掉三處:① `customers(name,email,phone)` 不取(客人在看自己的單,取了只是多一份 PII 在 RSC payload 裡跑)② `invoice` / `tappay_rec_trade_id` / `tier_at_checkout` / `order_notes` / `payment_charge_attempts` / `order_item_procurement` / `workflow_status` / `availability_at_checkout` / `variant_id` / `version` 不取(內部營運欄 + 金流識別碼)③ 🔴 **品牌與圖片【要取】**,那是 Q-A'=乙 的拍板結果,見 §⑤-b。⚠️ **本條理由 2026-08-23 改寫過**:原本寫「不取,因為那條 join 穿越帶經銷價的表、有洩漏風險」—— **那個理由已被實測推翻**(見 §⑤-b),不要再引用舊句。
1-b. **件數不得用 `OrderListItem.itemCount`**(`packages/domain/src/order/types.ts:188-196` 逐字:「客人看到『3 件』而實際訂了 600 件,他不會知道、也不會回報」)⇒ 自己從撈到的 `order_items` reduce Σquantity,並比照 admin 夾自己的上限常數(**新開一個,不共用** —— `ORDER_LIST_ITEMS_EMBED_LIMIT` docstring `:441-446` 逐字「與後台列表同值,**而那是巧合不是耦合**」)。理由逐字在 `mappers/order.ts:405-415`:**PostgREST 對內嵌截斷不給任何訊號**(仍回 200、`Content-Range` 不反映)⇒ 不自己夾上限,邊界就握在遠端 `db-max-rows` 手上而看不見。🔴 `.order()` 要與 `.limit()` 成對(同檔 `:582-583`):沒排序的截斷會讓兩次重新整理拿到不同子集。⇒ 型別需有 `itemsTruncated: boolean`,而**顯示端不得印 0、不得留空**(`types.ts:196` 逐字)。
2. **own-only**:拿 A 的 session 讀 B 的 `displayId` ⇒ **查無**(不是 403、不洩存在性)。
3. **網址用 displayId**,且不存在的 displayId ⇒ 走 OD 的「查無此單」狀態(`?id=nope` 那個預覽態)。
4. **那顆鈕變成連結**:`OrdersTab.tsx:74` 由 `<button>` 改 `<a href>`,而**鍵盤可達**(它現在是 button、本來就可 focus,改成 a 要確認不退化)。
5. 四綠(`TURBO_FORCE=1`,動 `.tsx` ⇒ 含 build)。
5-b. **收件資訊來源**:收件人 / 手機 / 地址一律取 `orders.shipping_address_snapshot` 的 `name` / `phone` / `line`,**禁 join `customer_addresses`**。理由不是偏好,是那條路**會給錯答案**:建表 `20260604120000_m3_s2a_orders_order_items.sql:96` 逐字「收件地址凍結快照(白名單 name/phone/line)」,同檔 `:120-125` CHECK 硬鎖 exact key set;而同檔 `:95` `address_id ... ON DELETE SET NULL`、註解逐字「**僅追溯 FK(地址可被客人刪改)**」⇒ 客人搬家改了地址,join 出來會顯示**新地址** —— 那不是那張單寄去的地方。正式庫實查(2026-08-23):20 張單 snapshot 非 null **20/20**、`address_id` 非 null **19/20** ⇒ 那條 join 現在就已經有 1/20 撈不到。型別三欄皆 `| null`(理由不是 DB 可能沒有 —— DDL 擋著 —— 是**投影退版時整個鍵會消失**,`types.ts:1213-1219` 對 `customerUserId` 逐字寫過這個推論);**缺值印 `—`,不要不印** —— 收件人那格缺值是異常、要看得出來。

## ⑤-b 🔴 Q-A'=乙(Sean 2026-08-23 拍板:開 join 取商品圖 + 品牌)的專屬驗收

前提:本片因此**穿越** product_variants / products,而那兩張表帶
price_store / price_by_tier / price_general(`packages/domain/src/order/types.ts:814-819` 逐字)。
先例:`d2f82be3`(admin 明細加品牌)走過同一條路,其五層改法與守門補法為本片範本。

6. ⚠️ **【已知缺口,不列入本片驗收】行為層實打** —— 現有工具做不完,理由見本節末限定 ④。
   🔴 **不要在 `storefront-probe` 上打這一條 —— 它會回假紅**(`up.sh:153` 的整表 GRANT 跑在 migrations 之後);要做得先解 backlog `#853`。
   (內容原樣保留在下面,因為它是**日後怎麼補**的規格,不是今天的驗收項。)
   原條文:**行為層實打(不可用授權查代替)**:以 **authenticated client**(禁 service_role)
   對 `order_items → product_variants → products → brands` 打一發真請求,
   **列舉回傳的完整 key 集合**(不是「看起來沒有價格」,是印出來逐一看)。
   ⇒ 兩個世界要印不同的東西:該拿到品牌名的一發要拿到、該被擋的一發要被擋。
   🔴 **若帶出任何價格欄 ⇒ 立刻停下回報主視窗,不自行變通、不自己想繞法。**
      那一刻它從「照拍板實作」變成「拍板選的路走不通」,是 Sean 要重新拍的題。
7. ⚠️ **【已知缺口,不列入本片驗收】forbidden-token 負測** —— 同上:在 probe 上**恆紅**、零判別力。
   (內容原樣保留在下面,同樣是日後的規格。)
   原條文:**forbidden-token 負測**:釘住 `price_store` / `price_by_tier` / `price_general`
   三個字面在客人面回應裡 **0 命中**;**且負對照要證明尺是活的**
   (故意塞一個進去,測試必須紅 —— 沒紅代表那格恆綠、等於沒有守門)。
   📌 `price_general` 一定要在清單裡:`d2f82be3` commit body 逐字記過
      「兩份清單各自漂了」,漏的就是這一個。
8. **投影走 RLS-scoped cookie client,禁 service client**(GR-066 MF-1 附帶 pin)。
   配一格測試:用 A 的 session 讀 B 的單 ⇒ 查無。
9. **下架商品的降級**:`products_select_public` 的 qual = `delisted_at IS NULL`,
   `product_variants_select_public` 要求母商品未下架(pg_policies 實查)
   ⇒ **商品下架後,客人端 join 不到它**,圖與品牌雙雙為 null。
   ⇒ 那一列必須仍然可讀(品名/規格/單價來自快照,不受影響),**不得整列消失、不得破圖**。
   🔴 顯示規則照既有先例分兩種、不得憑感覺:
      品牌 null ⇒ **整行不印**(`AdminOrderDetailItem.brand` docstring 逐字)
      圖 null   ⇒ 走 `ProductImage` 那套佔位圖 + onError 備援(**見附錄 B**)

### 🔴 第 6 / 7 條的可完成性 —— **不要把它們排進本片的驗收清單**

現有工具下第 6 條(行為層欄位洩漏)**完成不了**(見下方限定 ④)。
⇒ 它的真正答案只能來自:①已完成的 `pg_catalog` 正式庫授權量測(唯讀)
②上線後 code 層的 forbidden-token 測試(那是防「未來有人改寬投影」,與本條不同層)。
🔴 **理由不是它不重要,是一條【今天做不完的驗收條件】會訓練人略過整張清單**
(memory `feedback_a-guard-you-cant-finish-today-becomes-noise`)。
⇒ **第 6/7 條改列為「已知缺口 + 為什麼」,第 8/9 條留在驗收清單裡。**

### ⚠️ 上面那句「客人端拿不到經銷價」的證據等級 —— 三條限定,**不可與結論分開引用**

```
① 量到的是【授權】,不是【一發真的 REST 請求回什麼】。
   最強的那一發(真 authenticated JWT 打過去、列舉回傳的完整 key 集合)**尚未執行**
   ⇒ 那正是上面第 6 條要求的工,**它不因授權量測而可省**。
② memory 記著「`has_*_privilege` 對欄級授權**少報**」⇒ 它的 `false` 可能是假陰性。
   📌 而 **ACL 字串那把尺不受此限,兩把尺同向,且 ACL 是權威**。
③ 本量測**不解除** forbidden-token 負測的必要 —— 它防的是**未來有人改寬投影**,
   而授權快照不會在那天變紅。
④ 🔴🔴 **那一發【不能】在現有的 storefront-probe 上打 —— 那把尺會回一個假紅。**
   `scripts/storefront-probe/up.sh` 的順序是決定性的:
   `:139-143` 先套所有 migrations(含正式站的 REVOKE + 欄位級 GRANT),
   而 `:153` **在那之後**下 `GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;`
   ⇒ **後面那行把前面抹平。** 被抹平的正是本片要驗的那道牆。
   數法(2026-08-23 主視窗實數):`grep -ln "GRANT SELECT[[:space:]]*(" supabase/migrations/*.sql | wc -l` ⇒ **14**;
   `grep -lE "REVOKE.*FROM.*(anon|authenticated)" supabase/migrations/*.sql | wc -l` ⇒ **99**;
   負對照(編造的 GRANT 形狀)⇒ **0**。
   ⇒ **正式站防線 = RLS(列)+ GRANT/REVOKE(表與欄)兩層;probe = RLS 一層。**
   ⇒ 在 probe 上打第 6 條,回傳裡出現 `price_store` 是**鑽機自己 `:153` 那行的迴音**,不是洩漏;
     第 7 條在 probe 上會**恆紅** ⇒ 一樣零判別力。
   ✅ 而 RLS 那一層 probe 是**忠實的**(policy 來自 migrations、未被覆蓋)
     ⇒ **第 8 條(own-only)與第 9 條(下架降級)在 probe 上驗得起來。**
   ⚠️ `up.sh:27` 檔頭本來就自陳「GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ 證不了正式站的權限設定」——
     **那句寫對了,而它沒有寫「所以哪幾種問題問不出來」** ⇒ 這一格是本檔補的。
   📌 **修那支腳本 = 動六個窗共用的工具**,且 `:153` 當初為何存在未查(拿掉可能讓 probe 起不來)
     ⇒ 已另立條目、**不擠在本片做**。
```
🔴 **為什麼要逐字留著**:三個月後讀這份 spec 的人會讀到「客人端拿不到經銷價」,
而**不知道那是授權量測不是行為量測** ⇒ 一份誠實的限制清單被讀成完整的結論。
(同族 `feedback_an-honest-limits-list-is-read-as-a-complete-one`。)

### 🔴 而「下架商品」那個坑,今天量到 0 —— **那是樣本太小,不是安全**

```
訂單那一面(2026-08-23 線2 實量)   20 張單、23 個品項,有下架品項的 0;最舊 5 張 0、最新 5 張 0
                                   ⇒ 分子每格都是 0 ⇒ **斜率沒有定義**(不得寫成「斜率是平的」)
                                   ⚠️ 且這 20 張全是自己人測試單(Sean 逐字)⇒ 對真實使用幾乎零推論力
商品那一面(分子不是 0 的地方)     products 21,225 / 已下架 559 = **2.63%**
                                   第一筆 2026-06-03、最後一筆 2026-08-11
                                   🔴 **最近 30 天內下架 74 件** ⇒ 約每天 2.5 件
```
⇒ 2.63% × 23 個品項 ≈ **0.6 件** ⇒ **量到 0 完全符合「機制成立但樣本太小」**,它不是安全的證據。
⇒ 而下架只增不減 ⇒ **舊訂單踩到下架商品的機率每個月都在往上走,且不會有任何一天發出訊號。**
⇒ **第 9 條(下架降級)不因為今天是 0 而可省。**
⚠️ **刻意不量**:「559 件裡歷史上被下單過幾件」(那才是真分子)—— 我們只有兩個月訂單歷史
   且全是自己人測試單 ⇒ 分子再精確,分母仍無推論力。**標【刻意不量】,不是漏。**


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
packages/adapters/src/supabase/SupabaseOrderAdapter.ts:586
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

---

## 附錄 A · OD 稿欄位清單(分母 = 305 行全文,**非摘要**)

> 來源 `pcm-home-redesign/order-detail-page.html`(305 行,mtime 2026-08-07 11:31)。
> 線2 2026-08-23 整份讀完;絕對路徑見 §⓪。

### A-1 有來源、做得出來的

| 稿上的東西 | 真站來源 |
|---|---|
| `displayId` 大標 | `orders.display_id`(🔴 網址也用它,不是 UUID) |
| 成立時間 | `orders.created_at` |
| 狀態徽章 | `orderStatusLabel()`(見 A-3) |
| 商品小計 / 運費 / 總計 | `subtotal` / `shipping_fee` / `total`(運費 `0` ⇒ 印「免運」) |
| 「實付金額」vs「應付金額」 | 依 `payment_status==='paid'` 切換 |
| 品名 / 單價 / 數量 / 小計 | `product_snapshot.title` / `unit_price` / `quantity` / `line_total` |
| 收件人 / 手機 / 地址 | `orders.shipping_address_snapshot` {name,phone,line}(見 §⑤ 5-b) |
| 付款方式 | `orders.payment_method` |
| 發票(三種句型) | `orders.invoice` jsonb(⚠️ 稿讀 `addr.invoice` 是原型取巧,真站在 orders) |
| 四階進度軸 前兩階 | `created_at` / `payment_status='paid'` |
| 圖片 / 品牌 | join `product_variants → products (→ brands)`(Q-A'=乙,見 §⑤-b) |
| 「這筆訂單有問題?」LINE 區塊 | 純文案(L1) |
| 返回鍵 | `/account?tab=orders` |

稿上註解逐字(要照抄的判斷):**未付款的訂單不能寫「實付」——那是還沒發生的事。**

### A-2 稿上有、而現在**沒有來源**的

```
1. 「下載訂單 PDF」鈕  → 稿註解:真站改成 <a href="/account/orders/<id>/statement.pdf" download> 由後端產
                        ⚠️ 稿刻意不寫「下載發票」—— 產的是對帳單,不是統一發票(2026-08-07 拍板)
2. 物流 courier / trackingNo / trackingUrl / 物流歷程 shipEvents
3. 四階進度軸 後兩階(已出貨 / 已送達)
4. etaLabel / etaSub(預計到貨)、discountLabel(折扣名稱)
```
📌 **2 與 3 稿子自己就交代了**,不用我們決定 —— 稿 `:167-175` 逐字:
> 已出貨 = 包裹 `shipped_at` ← **需要第 2 批「包裹真相」**;已送達 = 包裹 `delivered_at` ← 同上
> ⚠️ 第 3、4 階在第 1 批一律是未完成的空心點,**這是誠實的**:
> `fulfillment_status` 是 stale 出貨軸,**拿它點亮「已出貨」等於對客人說謊**。

✅ 而且降級得乾淨:`shipEvents` 空 ⇒ 整個「物流歷程」區塊不畫;
`courier` 空 ⇒ 那一列 `<dt>物流</dt>` 整列不畫(稿 `:265-267` 有專門註解)。

### A-3 🔴 逐字搬稿會搬到一個【已經過期的字面】

稿 `:145-152` 自己釘住真站權威 `apps/storefront/src/lib/orders/order-display.ts`。
開檔對過,四個字面一致、**一個不一致**:

```
稿  (2026-08-07)  partiallyPaid ⇒ 「付款確認中」
真站(現在)         partiallyPaid ⇒ 「已收訂金」   order-display.ts:64
                   成因:Sean 2026-08-18 拍 Q06=甲,推翻 2026-06-20 舊字面(該檔 :23-26)
```
⇒ 稿比那次拍板早 11 天。**狀態字面一律呼叫 `orderStatusLabel()`,不要照抄稿上的三元運算。**
📌 稿自己也這樣要求(`:150-151`):「真站請共用同一個 helper,不要各寫一次。」

### A-4 🔴 稿上**沒有畫**的一個狀態:那一列沒有圖的時候

訂單品項 23 筆實量:**15 筆有圖(各 1 張)/ 8 筆兩層都沒有圖**;
而那 8 筆**全是同一個東西** —— `supplier_slug='manual'`、標題「補差額用賣場」、`images = []`
⇒ **不是圖漏了,是一個沒有實體、本來就不該有商品照的手開品項。**
⚠️ 分母是自己人的 20 張測試單 ⇒ 「8/23」這個比例**不能拿去推真實客人的訂單長相**。

缺圖有**兩個成因,處置不見得該一樣**:
```
成因 A  手開的補差額品項  ⇒ **本來就不該有圖**(今天 8/23 全屬此類)
成因 B  商品已下架 join 不到 ⇒ **本來有圖,現在拿不到**(今天 0 筆,而 §⑤-b 說它會長)
```
三個候選(**描述,不是視覺稿**):甲 整個圖框不畫 / 乙 灰底佔位框 / 丙 兩種成因分開處理。
🔴 **成本欄看附錄 B-4,不要憑直覺** —— 讀完 CSS 之後那三個的貴賤**反過來**了(乙零改動、甲要動兩處斷點)。
📌 既有先例的判準(`AdminOrderDetailItem.brand` docstring 逐字):
**「缺值本身算不算一個需要被看見的事實」** ⇒ 照這條指向**丙**
—— ⚠️ **而那是推論不是拍板,且它是畫面題 ⇒ 交線A / Sean。**
✅ **不擋實作**:先走乙(既有 `ProductImage` 佔位圖 + onError 備援),Sean 看過真畫面再調 = 純樣式片。
🔴 主視窗紀律:**他第一次看到畫面時要主動把那一列指給他看,不要等他自己發現。**

---

## 附錄 B · 取圖與 fallback 的權威(**不要另發明一條取圖路徑**)

> 補這一節的原因:`§⑤-b` 第 9 條寫「圖 null ⇒ 走 `ProductImage` 那套」,
> 而**這份 spec 原本沒有告訴實作窗那套是什麼、在哪、有什麼坑**
> ⇒ 讀到那句的人只能自己去猜或自己重寫一份。(2026-08-23 線2 當驗收者抓到。)

### B-1 權威在哪

```
commit 21cbf057  fix(storefront): 商品圖不再向外部圖庫熱連, 而載不到的圖現在有備援 (2026-08-22)
   舊做法 ProductImage.tsx:28 PRODUCT_IMG_POOL = 15 個 Unsplash id、:176 熱連 images.unsplash.com
   出處是 design-reference/components/ProductCard.jsx:22 的【示意圖】被當成正式站 fallback
   ⇒ 已全數移除(分母在 commit body:定義處 2→0、程式碼命中 2→0)
commit c6a7b896  無商品圖佔位圖換成 PCM 版 —— 原本那張是 favicon 的複本
```
⇒ **取圖與 fallback 一律走既有的 `ProductImage`,不另發明。**

### B-2 🔴 兩條硬紀律(`21cbf057` commit body 逐字,照抄別重犯)

```
① onError 記在 state,**不改 `e.currentTarget.src`**
   —— 改 src 會【再觸發一次 load】⇒ 佔位圖若也載不到就變成無限迴圈。有測試釘著。
② hero / 縮圖 / lightbox 三個位置各有各的取法 —— 當時第一版用 getByLabelText('圖片 1')
   當 hero,而那個 aria-label 掛在【縮圖按鈕】上 ⇒ **量了縮圖、結論講 hero**。突變才抓到。
```

### B-3 ✅ 一格 Sean 已經拍過,**不要再問他**

`memory project_0822-sean-closes-three-image-and-cache-items` ①:
47 件商品的 `images[0]` 是供應商自己的 no-image / COMING SOON 圖檔 ⇒ Sean 逐字
**「就用他們的圖,沒關係」** ⇒ 不改資料、不做圖片正規化。
⇒ **訂單詳情頁上出現一張寫著「COMING SOON」的圖是【拍過板的可接受狀態】**,不是 bug、不要修。

### B-4 🔴 CSS 讀完之後,「沒有圖那一列」的成本算式**反過來了**

```css
.od-line     { grid-template-columns: 84px minmax(0,1fr) auto; }   /* pcm-account.css:1321 */
.od-line-img { width:84px; aspect-ratio:1/1; background:#fff; border:1px solid …; } /* :1328 */
手機版 :1400  .od-line { grid-template-columns: 64px minmax(0,1fr); }
```
**圖片欄是一條寫死的 grid 軌道,不是靠圖片撐出來的。** ⇒ 附錄 A-4 那三個候選的成本欄要照這個讀:

```
乙 灰底佔位框   🔴 **零成本, 而且已經是現在的預設** —— 沒有 <img> 時那個 div 本身就是
                 白底 + 1px 框、與有圖的列等寬等高。**一行 CSS 都不用改。**
甲 整框不畫     ❌ **不是少畫一個 div 就好** —— 軌道還在, 那列仍空著 84px、文字不會左移
                 ⇒ 要加 modifier 改 `grid-template-columns`, **而且手機版斷點要再改一次**
丙 兩種成因分開  = 乙 + 甲 各做一次
```
🔴 **原本寫「甲最省」是錯的** —— 依 CSS **乙最省(零改動),甲要動兩處斷點**。
⚠️ 而「乙零成本」是**讀 CSS 推的**,不是畫面上看到的 ⇒ 要變成量到的,得真的渲染一列沒有 `img` 的 `.od-line`。
🔴 **端那三個候選給 Sean / 線A 時,成本欄要用這一版** —— 否則他用錯的價格挑。

### B-5 一格實作時要補的決定

`.od-status` 有三檔(`is-action` / `is-progress` / `is-done`),與訂單記錄同一套,
而**稿沒有給「`orderStatusLabel()` 五個字面各配哪一檔」的對照表** ⇒ 實作時要補。
