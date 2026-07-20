# M-4a D-2 計畫 — 訂單「每商品各自狀態」(per-item workflow_status)

> ✅ **歷史 plan，D-2 已落地並上線。** 下方「未動 code／未 apply」是開工前快照，
> 只保留作 migration 與審查來源證據，不得當成目前狀態。

> 狀態:**関卡1 plan、未動 code、未寫 migration、未 apply**。送 Fable 對抗審(硬閘)。
> 真權威依據:`docs/handoff/2026-07-16-m4a-day2-kickoff.md`(Sean Q-A=A 拍板)+ `docs/specs/2026-07-15-m4a-order-list-redesign-slice-d-plan.md` §0(Fable 審定 A1)。
> 模板 = Slice C `supabase/migrations/20260714130000_m4a_admin_update_order_workflow_rpc.sql`(已 live、Fable+Codex 雙審過)。
> 🔴 硬護欄:不 push、不 apply、不 deploy、不動 .env。所有事實今日 MCP live 實查(非憑記憶)。

---

## 0. 今日 live 實查(project bmpnplmnldofgaohnaok,2026-07-16,MCP 唯讀)

| 事實 | 值 | 對 D-2 的意義 |
|---|---|---|
| `20260714120000` / `20260714130000` migration | **均已 apply** | Slice C 全 live;`database.types.ts:442` 註解「尚未 apply」= **stale**(follow-up:apply 後重 gen 清掉) |
| `orders.workflow_status` 存在 | ✅ true | **backfill 來源存在**(item 繼承所屬訂單狀態) |
| `admin_update_order_workflow`(Slice C RPC) | ✅ 存在 | 訂單層 shipping/invoice 仍走它、不動 |
| `service_role` 對 `order_items` UPDATE | ❌ **false** | **owner RPC 是唯一寫入車道**(與 Slice C 42501 同因、非選項) |
| `service_role` 對 `order_items` SELECT | ✅ true | admin 讀清單 OK(D-1a 已用) |
| `authenticated` 對 `order_items` UPDATE | ❌ false | 會員不能寫 item(縱深已在) |
| `order_items.workflow_status` / `version` / `updated_at` | ❌ 均不存在 | D-2 migration 新增三欄(order_items 現 9 欄、零 timestamp) |
| orders / order_items 列數 | 30 / 40 | **backfill 面 = 40 列**;多商品單 5/30(遷移面小) |

order_items 現有 9 欄(**RPC SET 絕不含**):`id, order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total, availability_at_checkout`。

---

## 1. 架構(Sean Q-A=A 已拍;Fable §0 審定 A1)

- **item 層 = 唯一操作真相**:`order_items.workflow_status` 可手設(鏡像 Slice C owner RPC)。
- **`orders.workflow_status` → 衍生顯示**:全 item 同 → 顯示該值;混合 → 「多狀態」徽章。**停寫、欄保留不 DROP**。
- **Slice C 訂單層 RPC 不改、不退**:`admin_update_order_workflow` 仍負責 shipping_method + 發票三欄(order 層、不搬 item)。它是 **jsonb key 驅動**——UI 只要**停送 `workflow_status` key**,它就自然停寫該欄,RPC 本體零改。「退場」僅指**明細頁狀態下拉退場**、非整支 RPC 退場(§4 釐清 Slice-D plan §0 用語)。

---

## 2. Migration 設計(新檔 `20260716120000_m4a_order_item_workflow_status.sql`,pending、不 apply)

### 2.1 order_items 加三欄
```sql
ALTER TABLE public.order_items
  ADD COLUMN workflow_status text,                              -- nullable(= unset;語意同 orders.workflow_status)
  ADD COLUMN version integer NOT NULL DEFAULT 1,                -- 樂觀鎖(現有 40 列起始 1)
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();     -- 建議加(與 orders 對齊、item 狀態最後異動時點);Fable 可否決
```
- **無 FK 到 order_status_options**(同 orders.workflow_status:code 是軟參照、選項停用不該連坐既有單;有效性由 RPC 在**變更時**驗 is_active,對齊 Slice C nit-8)。
- `updated_at`:kickoff 標「若 RPC set」= 可選。**建議加**(parity + 除錯用);若 Fable 認為多餘 → 只留 workflow_status + version、RPC SET 拿掉 updated_at。

### 2.2 backfill(繼承所屬訂單當前狀態)
```sql
UPDATE public.order_items i
   SET workflow_status = o.workflow_status
  FROM public.orders o
 WHERE i.order_id = o.id;
```
- 40 列;訂單 status 為 NULL 者 item 亦 NULL。冪等(可重跑)。

### 2.3 GRANT
- order_items 對 service_role 維持**無 UPDATE**(不新增直寫權;寫入只走 §3 owner RPC)。新欄不改變 D-1a 的 SELECT 投影權(service_role SELECT 已具)。

---

## 3. Owner RPC `admin_update_order_item_workflow`(鏡像 Slice C、簡化為單欄)

### 3.1 簽章(單欄 → 不用 jsonb patch)
```
admin_update_order_item_workflow(
  p_order_item_id    uuid,
  p_expected_version integer,
  p_workflow_status  text,     -- NULL = 清空(全清重設);code = 設定(須 is_active 命中)
  p_actor            text,
  p_request_id       text
) RETURNS text                 -- 'UPDATED' | 'CONFLICT' | 'NOOP'
```
> **與 Slice C 差異(有意識)**:Slice C 用 jsonb patch 因 5 欄有「未提供≠清空」語意;item 層**只有 1 個可編欄**,「未提供」無意義 → 單一 `p_workflow_status` 更簡、攻擊面更小。**開放 Fable 定調**:若預期 item 層近期要加欄(per-item ETA/追蹤碼?),改 jsonb patch 更好擴充。**建議先單欄**(YAGNI),需要再擴。

### 3.2 安全模型(逐條對齊 Slice C 已審過的機制)
- `SECURITY DEFINER` + `SET search_path = public, pg_temp`;函式體物件全 `public.` 限定。
- **樂觀鎖**:`SELECT ... FROM order_items WHERE id=p_order_item_id FOR UPDATE` → 不存在回 `'CONFLICT'`;`version <> p_expected_version` 回 `'CONFLICT'`(不重讀當條件)。
- **is_active 僅在 code 實際變更時驗**(Slice C nit-8):`p_workflow_status IS DISTINCT FROM v_cur.workflow_status AND NOT EXISTS(SELECT 1 FROM order_status_options WHERE code=p_workflow_status AND is_active)` → RAISE。NULL(清空)不驗。
- **NOOP**:`p_workflow_status IS NOT DISTINCT FROM v_cur.workflow_status` → 回 `'NOOP'`(不 bump version、不寫 audit)。
- 🔴 **金流/經銷價紅線(硬性、DB 層)**:UPDATE 的 SET 清單**字面只含** `workflow_status, version(=cur+1), updated_at(=now())`。**絕不含** `quantity / unit_price / line_total / variant_id / variant_sku / product_snapshot / order_id / availability_at_checkout`。
```sql
UPDATE public.order_items SET
  workflow_status = p_workflow_status,
  version         = v_cur.version + 1,
  updated_at      = pg_catalog.now()
WHERE id = p_order_item_id AND version = p_expected_version;
-- GET DIAGNOSTICS 驗 ROW_COUNT=1(縱深:防未來 FORCE RLS 靜默 0 列)
```
- **同交易稽核**:`INSERT admin_audit_log(actor, action='order_item.workflow.update', target='order_item:'||id, before={workflow_status:old}, after={workflow_status:new}, request_id, source_app='admin')`。原子(缺筆不可能)。
- **server 參數 fail-closed**:p_actor / p_request_id 空 → RAISE(不以未知身分寫稽核);p_expected_version 越界 → RAISE。
- **EXECUTE ACL**:`REVOKE ALL FROM PUBLIC, anon, authenticated` → `GRANT EXECUTE TO service_role`;結尾 `has_function_privilege` fail-closed DO 斷言(service_role=true、anon/authenticated=false)。

---

## 4. UI(切 item 層;鏡像 Slice C 的「明細編輯 / 列表顯示」分工)

- **列表 `/orders`(D-1a 已每商品一列)**:
  - 投影 `ADMIN_ORDER_LIST_SELECT` 加 `order_items(workflow_status)`;mapper `AdminOrderLine` 加 `workflowStatus`。
  - 每 item 列加**唯讀** per-item 狀態徽章(重用 `WorkflowStatusBadge`)。
  - 訂單層「訂單狀態」cell 改**彙總顯示**:group 內全 item 同 → 該徽章;混合 → 「多狀態」中性徽章(前端由 lines 計算、無新查詢)。
- **明細 `/orders/[id]`(Slice C)**:
  - **移除**訂單層 workflow_status 下拉(狀態改逐 item 編)。
  - **每 order_item 一個狀態控制**(native form → 新 server action `updateOrderItemWorkflowAction` → RPC;鏡像 D-3/Slice C 的 PRG + 三閘 session/Origin/actor + expected_version hidden)。
  - **保留** shipping_method + 發票三欄編輯(order 層、續走 `admin_update_order_workflow`、只是表單不再送 workflow_status key)。
  - 訂單層狀態改**唯讀彙總**顯示。
- 經銷價隔離:per-item 狀態 UI **零觸及** unit_price/line_total(只讀寫 workflow_status);沿用 D-1a server-only 投影,無新洩漏面。

---

## 5. 交易模擬斷言清單(実作時 BEGIN→套 migration+RPC→synthetic→逐條→ROLLBACK→零留痕)

1. EXECUTE ACL:service_role=true、anon=false、authenticated=false。
2. 樂觀鎖:錯 version → 'CONFLICT'、version 不變、無 audit;對 version → 'UPDATED'、version+1。
3. NOOP:相同 status → 'NOOP'、version 不變、無 audit。
4. 🔴 **經銷價/金流欄 byte 不變**:呼叫前後 `unit_price / line_total / quantity / variant_id / variant_sku / product_snapshot / order_id / availability_at_checkout` **完全相等**。
5. workflow_status:命中 active code → 成功;停用/未知 code(且與現值不同)→ RAISE;NULL(清空)→ 成功設 NULL。
6. is_active 只在變更時驗:現值已是某 code、只重送同 code(該 code 後被停用)→ 不因此 RAISE(NOOP 或放行)。
7. 稽核落一筆:action='order_item.workflow.update'、target='order_item:<uuid>'、before/after={workflow_status}、source_app='admin'、actor/request_id 對。
8. 不存在 item id → 'CONFLICT';p_actor/p_request_id 空 → RAISE。
9. backfill:每 item.workflow_status = 所屬 order.workflow_status(含 NULL 繼承)。
10. `orders.workflow_status` 全程 byte 不變(item RPC 不碰 orders 表)。
11. ROLLBACK 後零留痕(三欄 / RPC / synthetic 全消失)。

---

## 6. 切法(鐵則 4:15-45 分鐘可中斷)

- **D-2a**:migration(三欄+backfill)+ owner RPC + **交易模擬**(硬閘核心)。→ Fable 對抗審 + **Codex 盲審(鐵則 12 Packet)**;不 apply。
- **D-2b**:列表 per-item 狀態顯示 + 訂單彙總徽章(投影/mapper/orders-table;不動 schema)。
- **D-2c**:明細頁 per-item 狀態編輯 server action + 移除訂單層狀態下拉 + 保留 shipping/invoice。→ 動改單寫入路徑,commit 前 Fable 抽查(鐵則 12)。
- D-2a 為最高風險、先做透;D-2b/D-2c 為前端。

---

## 7. 鐵則 / 風險 flags

- **鐵則 8**:新 SECURITY DEFINER RPC + schema 三欄 + 動 orders-table/order-detail 共用元件 → 本檔即 plan、Fable 批准才實作。
- **鐵則 12**:訂單寫入 + 新 owner RPC + 稽核 → D-2a **交易模擬 + Fable + Codex 三段**;D-2c 動改單路徑 commit 前抽查。
- **相容/遷移**:Slice C per-order 狀態(30 單 backfill、live)不破壞——orders.workflow_status 欄留、只停 UI 寫;既有 30 單改 item 層後,訂單彙總徽章需正確反映(交易模擬 + 部署後肉眼驗)。過渡期(D-2b 上、D-2c 未上)列表已 item 顯示但編輯仍 order 層 → 短暫不一致,故 D-2b/c 宜同波上。
- **內容分級**:狀態詞彙 = L3(沿用 order_status_options 同一詞表,D-3 已 CRUD)。

---

## 8. 請 Fable 審的重點(関卡1)

1. RPC 單欄 `p_workflow_status` vs jsonb patch:單欄夠不夠(item 層近期會不會加欄)?
2. `updated_at` 加不加(parity vs 多餘)?
3. 「Slice C RPC 不改、UI 停送 workflow_status key」的過渡是否乾淨、有無殘留寫入 orders.workflow_status 的路徑漏網?
4. 訂單彙總徽章規則(全同/混合→多狀態)前端計算 vs 投影計算,經銷價隔離無洩漏面?
5. 切法 D-2a/b/c 順序與體積(鐵則 4/8),過渡期不一致視窗可否接受?
6. backfill NULL 繼承語意、樂觀鎖初始 version=1 有無邊界問題。

> 事實均為 2026-07-16 MCP live 實查;checkout `create_order` 是否需同步寫 item 初始 status = **本計畫不動**(新單 item.workflow_status 預設 NULL=unset,與現行「未設定」一致;若 Sean 要新單自動繼承某預設狀態 = 另案)。
