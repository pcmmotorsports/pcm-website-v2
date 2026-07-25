# PCM 訂單後台現況盤點(唯讀,不含評價/建議)

方法:`grep -rn` + `Read` 逐檔核對 `supabase/migrations/*.sql`(80 檔全掃)、`apps/admin/src/{app,components,lib}/**/orders*`、`packages/domain/src/order/*`。每項附檔案:行號。

---

## 1. 訂單相關資料表(最終態,已合併所有 ALTER TABLE)

### 1.1 `orders`(建表 `supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:92-131`)
逐欄(建表 + 後續 ADD COLUMN 合併):
| 欄位 | 型別 | NOT NULL/DEFAULT/CHECK | 來源 |
|---|---|---|---|
| id | uuid PK | DEFAULT gen_random_uuid() | :93 |
| display_id | text UNIQUE | NOT NULL;CHECK `^PCM-[0-9]{4}-[0-9]{4,}$`(:114) | :94 |
| customer_user_id | uuid FK→customers(user_id) ON DELETE RESTRICT | NOT NULL | :95 |
| address_id | uuid FK→customer_addresses(id) ON DELETE SET NULL | nullable | :96 |
| shipping_address_snapshot | jsonb | NOT NULL;CHECK exact-key{name,phone,line}+全值 string(:125-130) | :97 |
| tier_at_checkout | member_tier | NOT NULL | :98 |
| payment_status | payment_status enum | NOT NULL DEFAULT 'unpaid' | :99 |
| fulfillment_status | fulfillment_status enum | NOT NULL DEFAULT 'notOrdered' | :100 |
| subtotal | integer | NOT NULL CHECK >=0 | :101 |
| shipping_fee | integer | NOT NULL CHECK >=0 | :102 |
| discount_total | integer | NOT NULL DEFAULT 0 CHECK >=0 | :103 |
| total | integer | NOT NULL CHECK >=0;CHECK `total=subtotal+shipping_fee-discount_total`(:112) | :104 |
| shipping_method | text | NOT NULL(RPC 白名單 home/store,無表 CHECK) | :105 |
| invoice | jsonb | NOT NULL;CHECK exact-key{type,carrier,title,taxId,donateCode}+type∈{personal,company,donate}+全值 string(:118-124) | :106 |
| tappay_rec_trade_id | text UNIQUE | nullable | :107 |
| paid_at | timestamptz | nullable | :108 |
| payment_method | text | nullable | :109 |
| created_at | timestamptz | NOT NULL DEFAULT now() | :110 |
| updated_at | timestamptz | NOT NULL DEFAULT now() | :111 |
| display_position | bigint | nullable(`20260712203000_m4a_orders_admin_columns.sql:34`) |
| order_source | text | NOT NULL DEFAULT 'web';CHECK IN('web','manual_phone','manual_line','manual_other')(`20260712203000:37-43`) |
| payment_channel | text | NOT NULL DEFAULT 'tappay';CHECK IN('tappay','bank_transfer','cash','none')(`20260712203000:46-51`);CHECK `payment_channel='tappay' OR tappay_rec_trade_id IS NULL`(`20260712203000:69-71`) |
| cancelled_at | timestamptz | nullable(`20260712203000:56`) |
| cancelled_reason | text | nullable(`20260712203000:57`) |
| version | integer | NOT NULL DEFAULT 1(`20260712203000:63`,樂觀鎖) |
| workflow_status | text | nullable;CHECK `^[a-z0-9_]{1,64}$`(`20260714120000_m4a_order_workflow_status.sql:96-99`)— 🔴**已停寫**,見 §3 |
| invoice_number | text | nullable;CHECK 非純空白 len<=64(`20260714120000:106,109-111`) |
| invoice_amount | integer | nullable;CHECK >=0(`20260714120000:107,113-114`) |
| invoice_status | text | NOT NULL DEFAULT 'not_issued';CHECK IN('not_issued','issued','voided')(`20260714120000:108,115-117`) |
| notification_email | text | nullable;CHECK(ASCII/長度254 octet/去尾點/擋 LINE 合成域等,見`20260718120000_m4a_b1_orders_notification_email.sql:124-137`) |
| shipping_free_threshold | integer | NOT NULL DEFAULT 5000;CHECK >=0(`20260725120000_rf2a0_orders_freeze_shipping_rule.sql:63,185-187`) |
| shipping_home_fee | integer | NOT NULL DEFAULT 100;CHECK >=0(同上:64) |
| shipping_method_at_checkout | text | NOT NULL(BEFORE INSERT trigger 填);CHECK IN('home','store')(`20260725120000:65,206-208`) |

RLS/ACL:`orders_select_own`(authenticated 僅讀自己,`20260604120000:193-195`);authenticated 僅 GRANT SELECT、無 INSERT/UPDATE/DELETE(:190-191);寫入唯 SECURITY DEFINER RPC。

### 1.2 `order_items`(建表 `20260604120000:140-167`)
| 欄位 | 型別 | 約束 | 來源 |
|---|---|---|---|
| id | uuid PK | DEFAULT gen_random_uuid() | :141 |
| order_id | uuid FK→orders(id) ON DELETE CASCADE | NOT NULL | :142 |
| variant_id | uuid FK→product_variants(id) ON DELETE SET NULL | nullable | :143 |
| variant_sku | text | NOT NULL | :144 |
| product_snapshot | jsonb | NOT NULL;CHECK exact-key{title,sku,spec}+title/sku string+spec object全值string+spec鍵名blacklist擋price_store/price_by_tier/cost(:157-166) | :145 |
| quantity | integer | NOT NULL CHECK >0 | :146 |
| unit_price | integer | NOT NULL CHECK >=0 | :147 |
| line_total | integer | NOT NULL CHECK >=0;CHECK `line_total=unit_price*quantity`(:149) | :148 |
| availability_at_checkout | text | nullable;CHECK IN('in-stock','out-of-stock')(`20260614130000_m3_create_order_stock_snapshot.sql:40-42`) |
| workflow_status | text | nullable;CHECK `^[a-z0-9_]{1,64}$`(`20260716120000_m4a_d2_order_items_workflow_status.sql:47-50`)— 🔴**D-2 起唯一操作真相**,見 §3 |
| version | integer | NOT NULL DEFAULT 1(`20260716120000:51`,樂觀鎖) |
| updated_at | timestamptz | NOT NULL DEFAULT now()(`20260716120000:52`) |
| vehicle_snapshot | jsonb | nullable;形狀 CHECK(kind enum+object+逐kind必填,`20260716180000_m4a_v3a_order_items_vehicle_snapshot.sql:26,32-56`) |

RLS:`order_items_select_own`(經 orders join own-only,`20260604120000:197-205`)。

### 1.3 `payment_charge_attempts`(`supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql:87-99`)
id uuid PK / order_id uuid NOT NULL FK→orders / customer_user_id uuid NOT NULL(反正規化)/ status text NOT NULL DEFAULT 'pending' CHECK IN('pending','charged','failed') / rec_trade_id text nullable / fallback_token_hash text NOT NULL CHECK `^[0-9a-f]{64}$` / created_at,updated_at timestamptz DEFAULT now() / CHECK `status<>'charged' OR rec_trade_id IS NOT NULL`(:98)。Unique index:per-order lock(pending|charged,:102-103)、per-user idx(:105-106)、rec_trade_id unique(非NULL,:108-109)。RLS enable 零 policy;ACL:anon/authenticated 全 0、service_role 僅 SELECT(:117-121)。

### 1.4 `payment_double_charge_anomalies`(`20260624120003_m3_3ds_r1b1a_double_charge_anomaly_tables.sql:45-91`)
id / old_attempt_id uuid NOT NULL UNIQUE FK→payment_charge_attempts / old_order_id uuid NOT NULL FK→orders / user_id uuid NOT NULL / cart_session_id uuid NOT NULL / rec_trade_id text NOT NULL / refund_target_rec_trade_id text NOT NULL(建立後不可改)/ released_at,charged_at timestamptz NOT NULL / amount integer NOT NULL CHECK>=0 / status text NOT NULL DEFAULT 'open' CHECK IN('open','refunding','refunded','dismissed') / refund_claimed_at,refund_claimed_by,resolved_at,resolved_by,resolution_note,refund_provider_reference nullable / created_at DEFAULT now()。4態一致性 CHECK 鎖各狀態必備欄(:64-84)。

### 1.5 `payment_double_charge_anomaly_events`(`20260624120003:100-105+`,append-only 稽核事件表,欄位 id/anomaly_id/event_type/from_status/to_status 等,詳見檔案全文)

### 1.6 `order_status_options`(`20260714120000_m4a_order_workflow_status.sql:53-65`)
code text PK CHECK `^[a-z0-9_]{1,64}$` / label text NOT NULL CHECK 非空且<=32字 / color text NOT NULL CHECK `^#[0-9A-Fa-f]{6}$` / text_color text NOT NULL DEFAULT 'dark' CHECK IN('light','dark') / sort_order integer NOT NULL / is_active boolean NOT NULL DEFAULT true / created_at timestamptz NOT NULL DEFAULT now()。RLS enable、REVOKE ALL(PUBLIC,anon,authenticated,service_role)僅留精準 GRANT(:83-87)、無 DELETE(soft-delete 用 is_active)。

### 1.7 `order_refunds`(`20260725130100_m3_rf2a2_order_refunds_ledger.sql:80-131`)
id uuid PK / order_id uuid NOT NULL FK→orders / bank_refund_id text NOT NULL UNIQUE CHECK len 1-20(冪等鍵,TapPay bank_refund_id)/ tappay_refund_id text nullable(unique when not null,:136-138)/ items_amount integer NOT NULL CHECK>0 / shipping_fee_before,shipping_fee_after integer NOT NULL CHECK>=0 / shipping_delta integer NOT NULL / refund_amount integer NOT NULL CHECK>0;CHECK `refund_amount=items_amount-shipping_delta`(:106-107);CHECK `shipping_delta=shipping_fee_after-shipping_fee_before`(:108-109);CHECK 運費上界<=100000(:112-113) / status text NOT NULL CHECK IN('processing','confirmed','failed') / reason,actor,request_id text NOT NULL(非空白)/ failed_reason text nullable / created_at DEFAULT now() / confirmed_at nullable。狀態一致性 CHECK:confirmed⇔confirmed_at非NULL(:116-117)、failed⇔failed_reason非空(:118-119)、processing⇔兩者皆NULL(:120-121)。

### 1.8 `order_refund_items`(`20260725130100:143-169`)
id uuid PK / refund_id uuid NOT NULL / order_id uuid NOT NULL(冗餘,供複合FK)/ order_item_id uuid NOT NULL / quantity integer NOT NULL CHECK>0 / unit_price integer NOT NULL CHECK>=0 / line_amount integer NOT NULL CHECK>0;CHECK `line_amount=unit_price*quantity`(:153-154)。兩道複合FK鎖跨單串接(refund_id,order_id)→order_refunds、(order_id,order_item_id)→order_items(:156-162)。UNIQUE(refund_id,order_item_id)防同次退款重複列品項(:164-165)。另有兩個 DEFERRED CONSTRAINT TRIGGER 驗主從一致性(header sum = items sum),函式 `pcm_assert_refund_ledger_consistent()` 定義在同檔(:173+)。

**表清單統計:8 張表**(orders / order_items / payment_charge_attempts / payment_double_charge_anomalies / payment_double_charge_anomaly_events / order_status_options / order_refunds / order_refund_items)。

---

## 2. Enum 型別

| Enum | 定義位置 | 完整值 |
|---|---|---|
| `payment_status` | `20260604120000_m3_s2a_orders_order_items.sql:50` | unpaid, paid, partiallyPaid, refunded(原始4值)+ **partiallyRefunded**(`20260725130000_m3_rf2a1_payment_status_add_partially_refunded.sql:45` `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'partiallyRefunded'`)→ 現總計 **5 值** |
| `fulfillment_status` | `20260604120000:51` | notOrdered, ordered, inStock, shipped(**4 值,無後續 ALTER**) |

repo 內 `ALTER TYPE ... ADD VALUE` 全樹只此一筆(`20260725130000_m3_rf2a1...sql:27` 檔內註明「本 repo 在此之前零 ALTER TYPE ADD VALUE 先例」,已用 grep `ALTER TYPE.*ADD VALUE` 對全 `supabase/migrations/` 驗證,命中僅此 1 處)。

其餘與訂單相關但非狀態軸的 enum:`wallet_entry_type`(`20260523034911_init_customers_and_subtables.sql:97` deposit/use/refund,屬會員儲值非訂單表)——與訂單無直接 FK,列出僅供對照。

---

## 3. 狀態詞彙表(`order_status_options` seed,`20260714120000_m4a_order_workflow_status.sql:72-81`)

| code | label | color | text_color | sort_order |
|---|---|---|---|---|
| received_confirmed | 已收已定 | #FBE4A6 | dark | 10 |
| received_unconfirmed | 已收未定 | #F8D7DA | dark | 20 |
| shipped_done | 出貨完成 | #C6E7B3 | dark | 30 |
| unpaid_confirmed | 未收已定 | #F2A0A0 | dark | 40 |
| unpaid_shipped | 未收出貨 | #A52A2A | light | 50 |
| unpaid_unconfirmed | 未收未定 | #F5F26B | dark | 60 |
| unpaid_instock | 未收現貨 | #7B3FA0 | light | 70 |
| instock_available | 現貨在庫 | #2E7D46 | light | 80 |
| cancelled | 已取消 | #E57373 | dark | 90 |

**9 筆 seed。**

`orders.workflow_status` vs `order_items.workflow_status` 關係(親讀 comment,非推測):
- `orders.workflow_status`:D-2 起**已停寫、僅存歷史值**(`20260716120000_m4a_d2_order_items_workflow_status.sql:76` COMMENT 逐字「D-2 起停寫、僅存歷史值」)。DB 未強制擋寫(欄位仍在、無 trigger 擋 UPDATE),停寫是**app 層強制**:`admin_update_order_workflow` RPC 已收窄(`20260716130000_m4a_admin_update_order_item_workflow_rpc.sql:8`)+ admin TS parser/型別/adapter 皆已移除此欄(`apps/admin/src/lib/orders/workflow-form.ts:91-94` 「D-2(Codex R1 must-fix 1):order 層 workflow_status 寫入路徑關死」)。
- `order_items.workflow_status`:「item 層=唯一操作真相」(Sean 2026-07-15 拍板 Q-A=A,`20260716120000:7,55`)。整單狀態=顯示端由 items 彙總(全同→該值、混合→「多狀態」),函式 `summarizeOrderItemWorkflow`(`apps/admin/src/lib/orders/order-list-view.ts:239`)。
- 兩者皆明文「純操作/顯示層,絕不驅動金流/對帳/退款/庫存/出貨自動化;金流真相恆為 `orders.payment_status`」(`20260716120000:17`、`20260714120000:18`)。

---

## 4. 後台訂單 UI 檔案清單(`apps/admin/src/{app,components,lib}/**/orders*` + `order-statuses`)

**Pages**
- `apps/admin/src/app/orders/page.tsx`(98行)— 訂單列表 server component,`force-dynamic`;讀 searchParams 建 `AdminOrderFilter`,呼叫 repository 分頁查詢
- `apps/admin/src/app/orders/[id]/page.tsx`(76行)— 訂單明細頁
- `apps/admin/src/app/settings/order-statuses/page.tsx`(69行)— 狀態詞彙表管理頁

**Components**(`apps/admin/src/components/orders/`)
- `orders-table.tsx`(210行)— 列表主表格,**每商品一列、同單 rowSpan 分組**;欄位見下
- `order-detail.tsx`(249行)— 明細頁主體:客戶資訊卡/收件與出貨卡/付款卡/發票卡 + 品項表(ItemsTable)+ 取消橫幅;**無退款區塊**(order_refunds 未接入)
- `order-edit-form.tsx`(90行)— 出貨方式+發票紀錄編輯表單(workflow_status key 保留能力、UI 已停送)
- `order-filter-bar.tsx`(49行)— 篩選列容器,組 workflowOptions + query 初始值
- `order-filter-controls.tsx`(122行)— 篩選互動核心,5 篩選軸(見下)+ page + r
- `item-workflow-status-cell.tsx`(67行)— 品項狀態下拉(逐列改,樂觀鎖)
- `workflow-status-badge.tsx`(26行)— 狀態色 badge 顯示元件
- `workflow-status-select.tsx`(50行)— 狀態下拉共用元件
- `result-banner.tsx`(29行)— server action 結果橫幅

**lib**(`apps/admin/src/lib/orders/`)
- `order-repository.ts`(55行)— repo 建構,service_role client,呼叫 `@pcm/adapters` SupabaseOrderAdapter
- `order-list-view.ts`(300行)— 列表 view model:分頁參數解析、enum label 對照表、`summarizeOrderItemWorkflow`、`workflowStatusBadge`
- `order-detail-view.ts`(47行)— 明細頁 view model(發票狀態 label、配送方式 label、日期格式)
- `order-actions.ts`(135行)— server actions(per-item workflow 改狀態等)
- `status-option-actions.ts`(186行)— 狀態詞彙表 CRUD server actions
- `status-option-form.ts`(110行)— 狀態詞彙表表單 parser
- `workflow-form.ts`(173行)— 品項狀態表單 parser(明文「order 層 workflow_status 一律忽略」)
- `workflow-select-options.ts`(99行)— 狀態下拉選項組裝

**列表頁欄位**(`orders-table.tsx:182-194`,13欄):訂單編號、日期、商品品牌、料號、物品名稱、年份廠牌車種、數量、單價、總金額、會員等級、客戶名稱、商品狀態、來源·管道

**篩選軸**(`order-filter-controls.tsx` + `order-filter-bar.tsx:34-38`,5軸):商品狀態(workflow_status,多勾選)、付款狀態(pay)、出貨狀態(ful)、來源(src,多勾選)、付款管道(ch,多勾選)

**明細頁區塊**(`order-detail.tsx:183-246`):客戶資訊卡(姓名/電話/Email)、收件與出貨卡(收件人/電話/地址/出貨方式)、付款卡(付款狀態/出貨狀態/來源·管道/付款時間)、發票卡(需求型式/統編抬頭/載具/開立狀態/發票號碼/發票金額)、取消橫幅(條件顯示)、OrderEditForm、品項表(逐列含商品狀態下拉)+ 小計/運費/折扣/總計

**匯出功能**:grep `csv|export|download`(大小寫不拘)於 `order-list-view.ts` / `orders-table.tsx` / `app/orders/*.tsx` **零命中** → **查無匯出功能**。

---

## 5. Domain 層型別(`packages/domain/src/order/`)

檔案清單:`display-id.ts`(+test)、`errors.ts`、`order.ts`(+test)、`refund.ts`(+test)、`shipping.ts`(+test,+`shipping-rpc-drift.test.ts`)、`snapshot.ts`(+test)、`state-machine.ts`(+test)、`types.ts`。

**主要型別**(`types.ts`,共 25 個 export):`OrderId`/`DisplayId`/`PaymentStatus`(:38)/`FulfillmentStatus`(:57)/`ShippingMethod`(:69)/`ProductSnapshot`(:83)/`OrderItem`(:99)/`OrderStatusFilter`(:119)/`Order`(:138)/`OrderListItem`(:169)/`OrderSource`(:194)/`PaymentChannel`(:204)/`AdminOrderFilter`(:213)/`WORKFLOW_STATUS_CODE_RE`(:236)/`AdminOrderLine`(:247)/`OrderItemVehicleSnapshot`(:281)/`AdminOrderSummary`(:296)/`InvoiceStatus`(:329)/`AdminOrderWorkflowPatch`(:343)/`AdminOrderWorkflowResult`(:351)/`AdminOrderDetailItem`(:360)/`AdminOrderDetail`(:390)/`OrderStatusOption`(:440)/`OrderStatusOptionUpdate`(:458)/`PlaceOrderVehicle`(:476)/`PlaceOrderLine`(:491)/`OrderInvoice`(:501)/`PlaceOrderInput`(:526)/`PlaceOrderResult`(:555)。

`AdminOrderDetail`/`AdminOrderSummary` 型別層**已移除 workflowStatus/version 欄**(`types.ts:339` 「D-2 起型別層亦無 workflowStatus(orders.workflow_status 停寫=雙層強制:TS 層關死+DB 層…)」)——與 §3 DB comment 互證,雙層鎖死。

**狀態機規則**(`state-machine.ts`):
- 付款軸 `PAYMENT_TRANSITIONS`(:38-44):
  - unpaid → [paid, partiallyPaid]
  - partiallyPaid → [paid, refunded]
  - paid → [partiallyPaid, refunded, partiallyRefunded]
  - partiallyRefunded → [partiallyRefunded(🔴唯一允許的自我轉移,2026-07-25 Sean 拍板 Q1=A,支援多次連續部分退), refunded]
  - refunded → [](終態)
  - 隱含非法:任何 `→unpaid`、`unpaid→refunded`、`refunded→*`、其餘4值的自我轉移
- 出貨軸 `FULFILLMENT_TRANSITIONS`(:50-55):notOrdered→[ordered]、ordered→[inStock]、inStock→[shipped]、shipped→[](終態);禁跳級/倒退/自我轉移
- `assertPaymentTransition`/`assertFulfillmentTransition` 非法轉移一律 throw `OrderError`(:77-103)
- `withPaymentStatus`/`withFulfillmentStatus`:immutable 轉移後回新 Order(:111-126)

`refund.ts`:`computeRefundQuote()` 純函式退款金額+運費重算引擎;`RefundQuoteRejection` 型別列 7 種拒絕理由(empty_refund/duplicate_refund_item/non_positive_refund 等,:43-78);`RefundShippingAdjustment.direction`∈{charge,refund,none}(:125-126)。

---

## 6. 已知缺口與 TODO(訂單/退款/退貨/出貨相關)

- **admin 無任何退款(order_refunds)UI**:`grep -rln "order_refund" apps/admin/src` 零命中(已排除誤判)——`order_refunds`/`order_refund_items` 帳本表(2026-07-25 上線)在後台**完全不可見**,無列表無明細無操作介面。
- **明細頁無退款/退貨區塊**:`apps/admin/src/components/orders/order-detail.tsx:1-249` 全文讀過,四張資訊卡(客戶/收件出貨/付款/發票)+ 品項表,無退款欄位、無退貨/退款歷史顯示。
- **backlog #217**:`packages/domain/src/order/types.ts:162` 「刻意不含 items[]:order_items 表無 product_id(backlog #217)、無法忠實重建」
- **backlog #213**:`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:43` 「blacklist 非全封屬實、改名鍵靠 RPC 主控(backlog #213)」;同檔:156 重複提及
- **backlog #214**:`supabase/migrations/20260614130000_m3_create_order_stock_snapshot.sql:45` 「A 案有意取捨:不分哪一層缺、日後真需分層為非破壞 ADD COLUMN(見 backlog #214)」;`20260604130000_m3_s2b1_create_order_rpc.sql:176` 「若未來加第三態(如預購)須回看(backlog #214)」
- **backlog #26**:`packages/domain/src/order/types.ts:31` partiallyRefunded 新增「收 backlog #26」;`20260725130000_m3_rf2a1...sql:4` 同一 backlog 編號出現於 migration
- **backlog #278**:`apps/admin/src/lib/orders/order-repository.ts:18` 「沿用 #249 隱含濾 unpaid,揭示見 backlog #278」
- **Phase 2 預留(非本期實作)**:`packages/domain/src/order/types.ts:67`(超商取貨 fulfillment_method 留 Phase 2);`packages/domain/src/identity/wallet.ts:9` 與 `supabase/migrations/20260523034911_init_customers_and_subtables.sql:96`(wallet refund entry_type,Phase 2 預留;非訂單表本身但與退款詞彙相關)
- **`order_source='manual_phone'/'manual_line'/'manual_other'`**:enum 值存在(`20260712203000_m4a_orders_admin_columns.sql:37-43`)但**未在 admin UI 找到手動建單入口**(僅列表頁篩選軸讀取此值,`order-list-view.ts:62`;grep repo 未見「手動建單」表單/action —— 標記「查無」,已試 grep pattern:`manual_phone|manual_order|create.*order.*manual`,`apps/admin/src` 內零命中,未排除可能在其他未搜到的命名下存在)。

---

## 查無清單(用過的 grep pattern)

- admin 匯出/CSV 功能:`grep -riE "csv|export|download" apps/admin/src/lib/orders/*.ts apps/admin/src/components/orders/*.tsx apps/admin/src/app/orders/**/*.tsx` — 零命中(功能性,僅命中不相關的 `export function` 語法)。
- admin 手動建單表單/action:`grep -rn "manual_phone|manual_order|建立訂單|新增訂單" apps/admin/src` — 零命中。
- `order_refunds`/`OrderRefund` 在 admin 任何檔案:`grep -rln "order_refund|OrderRefund" apps/admin/src` — 零命中(唯一近似命中為 `customer-detail-view.ts` 內含子字串巧合,非退款功能,已人工排除)。
