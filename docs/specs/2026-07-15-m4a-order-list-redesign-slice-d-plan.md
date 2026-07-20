# M-4a Slice D 計畫(v0.2,Fable 關卡1 審定折入;待 Sean 拍 Q-A)

> ✅ **歷史規格，Slice D 已落地。** 本檔因 migration 與測試直接引用而保留原路徑；
> 「待 Sean 拍／未動 code」是 2026-07-15 當時快照，不得當成目前狀態。

> 訂單列表改造:每商品一列 + 車輛/會員/品項欄位 + 即時篩選。
> 狀態:**方向經 Fable 審定放行、未動 code、未 migration**。
> 資料可用性 = 2026-07-15 MCP 實查 project `bmpnplmnldofgaohnaok` live schema(非憑記憶;每筆下方標來源)。

---

## 0. Fable 關卡1 審定(2026-07-15,verdict=`review-inbox/m4a-order-list-redesign-slice-d-plan.verdict.md`)

**方向放行。** 事實補強:多商品訂單僅 **5/30**(遷移面比 v0.1 自估小);`order_items` 無 version/workflow 欄、且對 service_role **零寫入** → A1 鏡像 owner RPC = **唯一車道**(非選項,同 Slice C 42501 理由)。

- **決策 A → A1,item 層=唯一操作真相(反對雙層並存)**:item 可手設(鏡像 Slice C RPC);`orders.workflow_status` 改**衍生顯示**(全 item 同→顯示該值、混合→「多狀態」徽章)、**停寫、欄保留不 DROP**;Slice C order 層 RPC 自 UI 退場(DB 函式留、無害)。Slice C 不白做=RPC/樂觀鎖/稽核/白名單=D-2 模板。**待 Sean 拍 Q-A。**
- **決策 B → 作廢 B1/B3,正式成案 B2 + per-item**:獨立設計線 `docs/specs/2026-07-15-order-item-vehicle-capture-design.md`(V-1 可打字車款選擇器/V-2 購物車車款欄/V-3 `order_items.vehicle_snapshot`+create_order=硬閘雙審)。Slice D「年份廠牌車種」欄=等 V-3 由 vehicle_snapshot 直出、**D-1 期間隱藏**。待 Sean 拍該檔 Q1-Q4。
- **決策 C → C1 放行**:admin server join `items→variants→products.brand_id→brands`,single query 下推、delisted 不硬刪 join 穩、缺配「—」。
- **經銷價隔離三護欄**:① 投影 server-only 具名白名單(禁 `select('*')`)+ byte-equal + forbidden-token 測試;🔴 `tier_at_checkout` 從 forbidden 移 allowed = **有意識變更**,測試同步改 + 註解引本 plan(勿靜默)。② 即時篩選 = **URL searchParams 驅動 server component 重取**、client 不持資料集(反對前端全量過濾=把成交價+tier 塞進 admin JS)。③ 紅線 = 會員 storefront bundle,本片零觸及。
- **切法修訂**:D-0 Sean 拍 A → D-1 唯讀 per-item 列表(**不動 schema**、列狀態顯示所屬訂單狀態、即時篩選)→ D-3 options CRUD(可與 D-1 並排/先做)→ D-2 per-item 狀態(migration + `admin_update_order_item_workflow` owner RPC〔SET **絕不含** quantity/unit_price/line_total/variant_*〕,**硬閘:交易模擬 + Fable + Codex 兩段審**)。
- **相容**:D-1 期間改單仍走 Slice C 既有 UI = 部署無斷點;D-2 落地才切 item 層。

🔴 **以下 §3 決策選項、§4 切法為 v0.1 原始提案,均以本節(§0)Fable 審定為準。**

---

## 1. Sean 需求(2026-07-15 口述,原文意圖)

1. **表格滿版**,欄位由左到右:訂單編號、年份廠牌車種、商品品牌、料號、物品名稱、數量、單價、總金額、會員等級(一般/車行)、客戶名稱、訂單狀態、來源·管道。
   - 「年份廠牌車種」:Sean 認知為 3 欄,顯示時合併如 `2017 YAMAHA R6`(客人下單前填、沒有就空白)。
   - **原「付款·出貨」欄拿掉,用「訂單狀態」取代。**
2. **一張訂單多商品 → 拆多列**(每商品一列)。因不同商品到貨時間不同,要能個別看「**該商品**」狀態。同訂單編號可重複、預設放一起(分組),除非手動調整。
3. **篩選即時**:選取後畫面直接變動、免按「篩選」;可多選;篩選功能重新設計。

---

## 2. 資料可用性稽核(live schema 實查)

| 要求欄位 | 資料來源(實查) | 狀態 |
|---|---|---|
| 訂單編號 | `orders.display_id` | ✅ 直接 |
| 年份 廠牌 車種 | `customer_vehicles`(`year` + `name` 自由文字 + `is_primary`);**掛客戶、非掛訂單** | 🔴 決策 B |
| 商品品牌 | `order_items.product_snapshot` 只有 `{sku,spec,title}`、**無 brand** | 🔴 決策 C |
| 料號 | `order_items.variant_sku`(= snapshot.sku) | ✅ 直接 |
| 物品名稱 | `order_items.product_snapshot.title` | ✅ 直接 |
| 數量 | `order_items.quantity` | ✅ 直接 |
| 單價 | `order_items.unit_price` | ✅ 直接(🔴 經銷價敏感) |
| 總金額 | `order_items.line_total` | ✅ 直接 |
| 會員等級(一般/車行) | `orders.tier_at_checkout` enum=`general,store,premiumStore` → general=一般、store+premiumStore=車行 | ✅ 需映射 |
| 客戶名稱 | `customers.name`(join `orders.customer_user_id`) | ✅ join |
| 訂單狀態 | `orders.workflow_status`(**per-order**,Slice C 剛上) | 🔴 決策 A |
| 來源·管道 | `orders.order_source` + `orders.payment_channel` | ✅ 直接 |

現況列表 = 每訂單一列的摘要投影(#217 繞道,無 migration)。改造 = 改成 `order_items` 為主體、每 item 一列。

---

## 3. 三個必須拍板的決策(Fable 審核心 + Sean 拍板)

### 決策 A(最重要)訂單狀態:per-item vs per-order
- **需求要 per-item**(每商品各自到貨狀態);現況 `workflow_status` 是 **per-order**(Slice C 昨天剛上、30 筆已 backfill、owner RPC + 樂觀鎖 + 稽核)。
- **選項 A1(符合需求)**:`order_items` 加 `workflow_status` + 各自 `version` + 稽核,把 Slice C 的 owner RPC 機制**鏡像到 item 層**。整單狀態改為衍生/摘要(或雙層並存)。
  - 成本:新 migration + 新 owner RPC + 前台改單改抓 item + 與 Slice C 剛上結構的相容/遷移。中大。
- **選項 A2**:維持 per-order,多列共用同一訂單狀態。→ **不能個別追蹤商品到貨,與需求矛盾**(不推薦,列出供對照)。
- 🔴 若走 A1,須決定 Slice C 剛上的 per-order 狀態是**保留為訂單摘要層**(雙層)還是**遷移作廢**(item 層取代)。這是 Fable 要審的架構主軸。

### 決策 B 車輛(年份廠牌車種)來源
- `customer_vehicles` 存在但:①**掛客戶、非掛訂單**(orders/order_items/cart 皆無 vehicle 參照欄);②`name` 為自由文字(brand+model 未拆),配 `year`=**2 欄非 3 欄**;③多車客戶靠 `is_primary` 猜。
- ⚠️「客人下單前填寫(per 訂單)」在**目前資料上不成立**——結帳未把「本單為哪台車」寫進訂單(schema 層確認;checkout code 未讀,建議 D 規劃時查 `create_order`)。
- **選項 B1**:顯示客戶主要車輛(`is_primary`)近似。便宜,但非訂單專屬、多車可能對不上。
- **選項 B2**:結帳補「本單車輛」+ `orders` 存 `vehicle_id`/snapshot。正確但動前台結帳 + schema(大題、超出表格改造範圍)。
- **選項 B3**:先留空/隱藏,待未來 slice。
- 需 Sean 拍:走近似(B1)、補收集(B2)、還是先擱置(B3)?

### 決策 C 商品品牌來源
- **選項 C1**:join `order_items.variant_id`→`products.brand_id`→品牌名(即時;商品下架/改名時舊單可能對不上)。
- **選項 C2**:從 `title` 解析(不可靠、不推薦)。
- **選項 C3**:未來 `create_order` 把 brand 寫進 snapshot(舊單空白)。
- 傾向 C1(admin 端可接受少數對不上),待 Fable 評即時 join 的效能/正確性。

### 即時篩選 + 多列分組
- 純前端互動 + 投影層,無資料模型風險。即時篩選 = client 端 onChange 重查(或 URL searchParams 驅動 server component 重取);多選 = 各軸多值。可直接做。

---

## 4. 建議切法(Slice D 拆解,15-45 分鐘可中斷為原則)

- **D-0**:Sean 拍決策 A/B/C(架構岔路,先於實作)。
- **D-1**:列表投影改 `order_items` 主體(join customers + tier 映射 + brand 依決策 C),每 item 一列、同單分組;即時篩選前端。**不含 per-item 狀態寫入**。
- **D-2**(依決策 A):per-item 狀態 migration + owner RPC + 前台改單改 item 層(鏡像 Slice C);處理與 per-order 狀態的相容/遷移。
- **D-3**(原 Slice D 本體):`order_status_options` CRUD 設定頁(標籤/顏色/排序/soft-delete;Slice A migration 已備資料層)。
- 車輛欄依決策 B 落到對應 sub-slice。

---

## 5. 鐵則 / 風險 flags

- **鐵則 8 重大改動**:動共用元件(orders-table)+ 投影 + 可能 schema/新 RPC → 本檔即 plan、待批准才實作。
- **鐵則 12(訂單/金流/經銷價)**:
  - 🔴 單價 + tier 同列 = **經銷價**。admin server-only 投影顯示 OK,但**絕不可洩到非 admin client bundle**;投影須 server component / service_role,沿用 Slice C 隔離。
  - per-item 狀態若加 RPC,走 **owner + 同交易稽核**,並沿用 Slice C 金流護欄:**狀態欄絕不驅動/碰 payment_status 等金流真相軸**。
- **決策 A 遷移風險**:Slice C 剛上的 per-order 狀態(30 筆 backfill、剛驗證 live)若改雙層或遷移,需相容計畫、勿破壞已上線行為。
- **內容分級**:狀態詞彙 = L3(已走後台 CRUD,決策 A 的 item 狀態沿用同一 `order_status_options` 詞彙表)。

---

## 6. 請 Fable 審的重點(關卡1 plan)

1. 決策 A 的資料模型(item 層雙層 vs 遷移),與 Slice C 剛上結構的相容性、遷移風險。
2. 決策 B「車輛掛客戶非掛訂單」的近似(B1)是否可接受,或必須 B2 補結帳收集。
3. 決策 C 即時 join 品牌的正確性/效能。
4. 經銷價(tier + unit_price)在 admin 投影的隔離是否有洩漏面。
5. 切法 D-0~D-3 的順序與體積是否合理(鐵則 4/8)。

> 資料事實均為 2026-07-15 MCP live 實查;checkout 是否收集訂單層車輛=schema 層已確認無參照欄、code 層未讀(決策 B 標註)。Fable 若需 code 佐證請指名,我補查後回。
