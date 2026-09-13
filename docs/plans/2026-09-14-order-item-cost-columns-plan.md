# plan · 訂單品項成本欄(老闆:成本模式)—— 2026-09-14

> Sean 2026-09-14 00:5x 拍「Q3 都做好」+「我目的是完整的完成,不要分次,一次做到完畢」⇒ 本 plan 不問要不要做,只寫怎麼做。鐵則 8(schema + RPC + 共用元件)。
> 盤查:主視窗派 Plan subagent(opus)唯讀盤查,主視窗謄寫。數字附檔:行。
> 稿:OD `pcm-524f/orders-admin-v22-A-出貨彈窗收斂.html`(`#boss` 勾 ⇒ `body.boss`:隱 來源/收款/狀態/下一步 4 欄,多 原價 整列外幣 / 運費 整列外幣 / 稅金 ×數量外幣 / 幣值×匯率 / 總計 TWD / 利潤 TWD 6 欄;紫色 `#unsaved` 條「已改 N 格,還沒存」+「取消變更」「確認全部」;批次列「改成本(勾選的列)」)。稿盤點 `~/pcm-mailbox/0912-後台UX/盤點-稿v22-清單.md` §2。
> Sean 09-13 拍板(memory `project_0913-admin-order-ux-redesign-rulings`):成本三欄都是外幣,乘匯率才是台幣;原價 / 運費 整列一個數、稅金 × 數量;成本欄老闆才看;改匯率不回頭重算。

## 1. 改什麼

### 1-a 新表 `public.order_item_costs`(一對一 `order_items`,**不動 `order_items`**)
```sql
CREATE TABLE public.order_item_costs (
  order_item_id  uuid PRIMARY KEY REFERENCES public.order_items(id) ON DELETE CASCADE,
  cost_price     numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_price    >= 0 AND cost_price    < 'Infinity'),
  cost_shipping  numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_shipping >= 0 AND cost_shipping < 'Infinity'),
  cost_tax       numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_tax      >= 0 AND cost_tax      < 'Infinity'),
  currency       text NOT NULL CHECK (currency IN ('EUR','IDR','GBP','THB','AUD','USD','TWD','JPY','CNY','SGD')),
  fx_rate        numeric NOT NULL CHECK (fx_rate > 0 AND fx_rate < 'Infinity'),
  fx_rate_id     bigint REFERENCES public.fx_rates(id),
  updated_by     text NOT NULL REFERENCES public.staff(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (currency <> 'TWD' OR (fx_rate = 1 AND fx_rate_id IS NULL))
);
```
- 為什麼新表不加欄:`order_items` 表註解逐字「🔴 無 price_store/price_by_tier/cost」(`supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:165`);而且 `order_items` 對 `authenticated` 有 `GRANT SELECT` + RLS「客人讀自己的單」(`:190-196`)⇒ 加在那張表,成本直接落到一般會員讀得到的列。先例同形:`order_item_quantity_summary`(`20260730150000_m4b_e10_a1_order_item_summary_columns.sql:79`)。
- ACL:`REVOKE ALL ON public.order_item_costs FROM PUBLIC, anon, authenticated, service_role; GRANT SELECT ON … TO service_role;` RLS on + 只有一條 service_role select policy;**寫一律走 RPC**(照 `20260913070000_m4b_fx_rates.sql:100-120`)。
- **TWD 總計與利潤不存**,讀時算:`cost_twd = round((cost_price + cost_shipping + cost_tax * qty) * fx_rate, 0)`(numeric round = 四捨五入到整數元,**只在最後 round 一次**);`profit_twd = order_items.line_total − cost_twd`(line_total 是 integer 元)。
- 匯率**當下抄一份**:RPC 內查該幣別 `fx_rates` `effective_from <= clock_timestamp()` 最新列,把 `rate_to_twd` 與 `id` 一起寫入;查無 ⇒ RAISE「這個幣別還沒設過匯率,先到 設定 › 匯率 填」。

### 1-b 寫入 RPC `public.admin_set_order_item_costs(p_actor text, p_rows jsonb, p_request_id text)`
批次一發。形狀逐條抄 `admin_fx_rate_set`(`20260913070000:128-246`):`SECURITY DEFINER` + `SET search_path = ''` + body 全 schema 限定 + `SET LOCAL lock_timeout = '3s'` + `p_request_id` 空則 RAISE + `staff … FOR SHARE` / `IF NOT FOUND` / `coalesce(is_manager,false)` 雙閘 + `INSERT … ON CONFLICT (order_item_id) DO UPDATE` + **每列一筆 `admin_audit_log`**(action `orders.item.cost.set`,target `order_item:<id>`,before / after jsonb)+ `GET DIAGNOSTICS` 稽核列數必須等於寫入列數否則 RAISE + 三道 REVOKE / 只 GRANT service_role + 檔尾 `DO $assert$` 事後閘(照 070000:`v_relations` / `v_functions` 涵蓋本檔每個可授權物件)。
`p_rows` 元素:`{order_item_id, cost_price, cost_shipping, cost_tax, currency}`(金額字串,RPC 內 `::numeric`)。空陣列 ⇒ RAISE。

### 1-c 讀路徑:**不併進 `admin_order_list_v`、不新開 view**,第二發 `.in('order_item_id', ids)`
- 硬理由:`ADMIN_ORDER_LIST_SELECT`(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:248`)被 byte-equal + forbidden-token 守門釘死,`'cost'` 是**永久 forbidden token**(`SupabaseOrderAdapter.test.ts:529-540`)⇒ 併進去 = 動鐵則 12 紅線。
- 第二發的先例與「失敗就落回『算不出來』不讓整頁 500」的寫法:同檔 `:1470-1500`(`order_balance_base_v`)。
- 另開 manager-only view 沒有多一層真閘(view 照樣 service_role 讀),與 `fx_rates` 現行讀法(`apps/admin/src/lib/fx/fx-rate-repository.ts` service_role 直讀 + app 層閘)一致 ⇒ 少一個物件。
- **成本型別不進 `packages/domain`**:`packages/domain/src/order/types.ts:80/102/136` 三條紅線是給顧客站也 import 的 domain 用的;成本型別住 `apps/admin/src/lib/orders/cost-view.ts`(admin-only,金額一律字串不過 JSON number)。

### 1-d UI
- `?boss=1` 是**顯示軸不是篩選軸**,登記在 `apps/admin/src/lib/orders/order-list-view.ts` 的 `ORDER_DENSITY_PARAM`(`:92`)旁;**必須進 `OrderListCarriedValues`(`:708`)與 `buildCarriedUrlValues`(`:715`)**,否則翻頁靜默掉(該檔 `:80-83` 記過同款坑兩次)。
- `page.tsx` server 端 `await isActiveManager(actor.id)`(`apps/admin/src/lib/staff.ts:196`)—— **非管理者:忽略參數、不渲染勾、不發第二發查詢**(fail-closed)。
- `orders-table.tsx` 的「零 use client」守門(`orders-table.test.tsx:2167`)**不繞開**:六欄由 server 渲染;可編輯的四格(原價 / 運費 / 稅金 / 幣別)包成新 island `cost-cells.tsx`(抄 `OrderShipCheckbox` 只傳純量 props 的形狀),`orders-table.tsx` 只 import 它。
- **不做即時重算預覽**(要傳 line_total 進 client props = 金額進 RSC payload,撞 `orders-table.tsx:66` 紅線)⇒ 總計 / 利潤存檔後由 server 重算重繪。
- 「確認全部」= `apps/admin/src/lib/orders/cost-actions.ts` server action(`authorizeManagerMutation` → 一發 RPC → `revalidatePath`),形狀抄 `apps/admin/src/lib/fx/fx-rate-actions.ts`。紫色未存條 = island 自己的 dirty 狀態。
- 批次列「改成本(勾選的列)」= 同一支 action,彈窗填一組值套到勾選的品項(可留空 = 不改)。

## 2. 影響
- 一般會員 / 非管理者:零(表零 authenticated 權、投影不變、非 manager 不發查詢)。
- 既有列表:`?boss=1` 才多一發查詢;列表 select 不變。
- `bash scripts/acl-snapshot.sh` 貼完會因新表轉紅 ⇒ `--write` 重寫基線(= 有人簽名)。`database.types` 重產只看 diff。
- seed:不動(表可空)。

## 3. 風險
- **R1 成本外洩**:三層防線(表零 authenticated 權 + app 層 manager 閘 + 不進共用投影)。把 cost 塞進 `ADMIN_ORDER_LIST_SELECT` 或 domain 型別 ⇒ 三綠會紅(守門在);**把整包 cost props 傳進 client island 沒有守門** ⇒ `cost-cells.tsx` 自帶一格「props 只有純量」測試。
- **R2 匯率快照**:`fx_rate` 是寫入當下的抄本,改匯率**不回頭重算**;先填成本、幣別還沒設匯率 ⇒ RPC RAISE 不默默寫 0;畫面要講人話。
- **R3 版本號**:`20260914010000` 2026-09-14 00:5x 全 branch + 五個 worktree 掃過零撞號,貼的當天重掃。

## 4. rollback(可執行)
`supabase/rollbacks/20260914010000-rollback.sql`:
```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.admin_set_order_item_costs(text, jsonb, text);
DROP TABLE IF EXISTS public.order_item_costs;
COMMIT;
```
稽核列不刪(append-only)。退表會丟已填的成本 ⇒ 有列先另存。

## 5. 切片(≤45 分一片,依賴順序)
| # | 窗 | 內容 | 依賴 |
|---|---|---|---|
| B1 | B 窗 | migration `20260914010000_m4b_order_item_costs.sql`(表 + ACL/RLS + RPC + 事後閘)+ rollback + 拋棄式 PG 17 實跑(正 / 負對照:非 manager 被擋、TWD CHECK、空陣列、稽核筆數守、幣別無匯率 RAISE)+ codex 唯讀一輪 | — |
| B2 | B 窗 | `cost-repository.ts`(第二發讀 + `::text` 取 numeric)+ `cost-view.ts`(純函式算 TWD 總計 / 利潤 + 四捨五入,單測)+ `cost-actions.ts` server action | B1 |
| A1 | A 窗 | `?boss=1` 參數登記 + carried values + server `isActiveManager` 閘 + 勾選框 + 隱 4 欄 / 顯 6 欄(唯讀 server-render,含總計 / 利潤) | B2 |
| A2 | 設計窗 | `cost-cells.tsx` island(4 格可編輯 + dirty)+ 紫色未存條 + 「確認全部」+ 批次「改成本(勾選的列)」彈窗;字級 / 紫底 `rgb(239,233,251)` 照稿 token | A1 |

**未貼**:migration 寫好不貼,貼由 Sean 點名編號(runbook §0)。
