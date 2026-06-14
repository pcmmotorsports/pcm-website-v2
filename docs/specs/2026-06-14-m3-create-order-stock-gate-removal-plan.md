# Slice Plan:create_order 移除缺貨閘 + availability 快照(解 backlog #214a)

> 作者:Claude Code(執行側正式化、源自審查側 /tmp 草擬)/ 日期:2026-06-14
> 鐵則:8(改建單核心 RPC + 🔴 新增 order_items 欄=schema 變動)+ 12(付款/建單脊椎)→ codex 關卡1+2 + 審查側 MCP 交易模擬 + zero-regression diff
> 決定來源:Sean 2026-06-14 拍 A(移閘 + 保留 delisted + 加 availability_at_checkout 快照);記憶 `project_create-order-stock-gate-removed`
> **codex 關卡1(2026-06-14、gpt-5.5 read-only 零留痕)= PASS-with-comments**(1 must-fix〔domain 註解〕已併 §5、考量/nit 已併入下文)。
> **狀態:✅ Sean 2026-06-14 拍 §7=A(單欄 text 派生值)、已實作 migration 20260614130000;本檔為實作後最終狀態。** 原 /tmp 草稿「無 schema 欄變動」與快照需求矛盾(見 §3)已解。

## ① 任務目標
移除 `create_order` RPC 的「缺貨(availability)」fail-closed RAISE(product 群層 + variant 變體層兩條),讓後端對齊前端早已上線的訂貨型設計(backlog #161 / Q4=A:不顯庫存、買鈕永遠可點、海外調貨缺貨可賣)。**保留 `delisted_at` 下架閘 + 價 NULL/0 fail-closed + 取價/快照/權限/RLS/防撞/IDOR 全部不動。** 另寫 `availability_at_checkout` 快照供後台分辨「調貨/預購單 vs 一般單」(交期 SLA / 客訴溯源)。解 backlog #214(a);#214(b) 訂單 idempotency 仍開。

## ② 背景與資料(正式庫 bmpnplmnldofgaohnaok MCP 唯讀實證 2026-06-14、零留痕)
- 前後端矛盾:前端訂貨型(`ProductInfo.tsx` L9 Q4=A / 永遠可下單),但 create_order 仍對缺貨 RAISE → 客人填完結帳才在送出失敗。
- 現況缺貨族群(實證):商品 total 1407 / out-of-stock **474**(未下架 **241**);變體 total 9274 / out-of-stock **6778**。
- **🔴 `products.availability` 與 `product_variants.availability` 皆 `NOT NULL`、僅 'in-stock'/'out-of-stock' 兩值、零 NULL**(is_nullable=NO + distinct 實查)→ plan ⑥ NULL 邊界為**防禦測項、實務 moot**。
- prod **orders / order_items 皆 0 row** → `ALTER TABLE order_items ADD COLUMN` 零鎖/零 backfill 風險;`availability_at_checkout` 欄目前不存在(確認);`order_items_snapshot_whitelist` 約束存在(=1)。
- products 只有 `availability`(text 二值)+ `delisted_at` 兩狀態欄,**無第三停產訊號** → 「真正拿不到」只能靠 quote 同步正確下架(殘餘風險、非本 slice;backlog #214 已記)。

## ③ 🔴 關鍵設計修正(執行側偵察 vs /tmp 草稿)
**/tmp 草稿 §3/§4 說「寫進 order_items 快照 JSONB(欄如 availability_at_checkout)」+「無 schema 欄變動」—— 兩者矛盾、無法成立:**

- `order_items.product_snapshot` 有 **exact-key whitelist CHECK `order_items_snapshot_whitelist`**(migration 20260604120000 L157-167):`(product_snapshot - array['title','sku','spec']) = '{}'::jsonb` —— 移除三鍵後須為空,**任何第 4 個 key 會被 CHECK 拒**。且此 CHECK 是 **鐵則12 經銷價零滲入的核心防線**(擋 price_store/cost 藏進快照),**不該為塞 availability 去鬆動它**。
- **唯一乾淨做法 = 新欄位**(`ALTER TABLE public.order_items ADD COLUMN ...`)= **schema 變動**(鐵則8)。(codex 關卡1 consider:技術上 availability 可塞進 `product_snapshot.spec`〔spec 只要求 object / 值為 string / 不含 price_store·price_by_tier·cost〕,但那把「非規格語意」塞進 spec、擴大 backlog #213 殘餘〔spec 鍵名非全封、靠 RPC 主控〕→ **否決**。)原草稿「無 schema 欄變動」**作廢**;正確影響面 = 新增 1 個 order_items 欄。
- TS 層**零連動**:create_order RPC 回 `{order_id, display_id}`,order_items 不被建單流程回讀(grep 證 `CreateOrderRpcResult` = {order_id,display_id});新欄純 RPC 內部寫入、後台(尚未建)才讀 → adapter/mapper/DTO 不改。

## ④ 改點(精準)
**目標 RPC = 最新 5-param `create_order`(0b `20260613130000` 版,已 git-push、DB 未 push)。** 新 migration 時戳 `20260614130000`(> 最新 1b `20260614120000`)、`CREATE OR REPLACE`:

1. **移 2 條 availability RAISE**(0b L246-248 product_availability + L249-251 variant_availability);**保留** delisted RAISE(L243-245)。
2. **`ALTER TABLE public.order_items ADD COLUMN availability_at_checkout text`**(nullable + 顯式 `CHECK (availability_at_checkout IS NULL OR availability_at_checkout IN ('in-stock','out-of-stock'))`;nullable=相容舊/無 row〔對齊 0b cart_session_id 慣例〕,RPC 恆寫非 null)。§7=A 單欄 text 派生(已實作)。
3. **SELECT 保留** `variant_availability` + `product_availability`(推薦案兩者皆 feed 派生值 → 無未用死變數)。
4. **FOR 迴圈 v_items**:`jsonb_build_object` 加 `availability_at_checkout` 派生值。
5. **INSERT INTO order_items**:加 `availability_at_checkout` 欄 + 值。
6. 其餘 byte-equivalent(取價 general、變體 join、price NULL/0 fail-closed、product_snapshot 快照、防撞、IDOR、search_path=''、REVOKE/GRANT 矩陣、末段 DO assert)。
7. **rollback**:DROP COLUMN availability_at_checkout + CREATE OR REPLACE 回 0b 版(含 gate)。

**🔴 新 migration 只含(codex 關卡1):** `ALTER TABLE order_items ADD COLUMN` + 5-param `CREATE OR REPLACE FUNCTION public.create_order(...)` + REVOKE/GRANT(冪等、explicit)+ DO assert。**不重播** 0b 的 `DROP FUNCTION ...(jsonb,uuid,text,jsonb)` / begin_charge_attempt / ALTER orders —— 同 bundle 套用時 0b 先跑(時戳早),4-param 已 DROP、欄已加,重播會失敗或誤動。

**為何 forward-only 新 migration(非 amend 0b):** 0b(`c89e178`)**已 git-push 到 origin/dev**(`git merge-base --is-ancestor` 證)→ migration 檔=不可變歷史,改它要 force-push、被 dev ruleset 擋。**只有 `supabase db push` 還沒做**(prod schema 未變)。forward-only 是已推 migration 的標準做法。與 0b/0c/1b 同一 db push bundle。

## ⑤ 連帶 docs / code 註解(字面vs事實、完整清單 —— 非歷史 migration 的當前 code/docs;舊 migration 歷史註解/RAISE 不動)
移除缺貨閘後,所有宣稱「create_order 檢查缺貨」「out-of-stock 訂不到」「Order 不存 availability」的字面須清(保留「下架」):

**程式碼註解 / domain 型別(6 處):**
- 🔴 **`packages/domain/src/catalog/types.ts:93-103`(codex must-fix)**:L98「out-of-stock:訂不到」→ 改為「現貨無、訂貨型仍可下單(#214a 移閘、需調貨/可能停產、下單後客服 LINE 確認)」;L102-103「Order 不直接引用…不存 availability 字面」→ 改為「order_items.availability_at_checkout 於結帳當下 snapshot availability(調貨單識別)」。(型別 `'in-stock'|'out-of-stock'` L108 不變,僅 JSDoc。)
- `apps/storefront/src/app/checkout/actions.ts:17`「下架/缺貨/防撞」→ 去缺貨
- `apps/storefront/src/app/checkout/actions.ts:19`「下架/缺貨/錯價/IDOR」→ 去缺貨
- `packages/use-cases/src/place-order.ts:9`「下架·缺貨檢查全在 RPC」→ 去缺貨
- `packages/use-cases/src/place-order.ts:26`「變體存在·下架·缺貨」→ 去缺貨
- `packages/ports/src/IOrderRepository.ts:28`「下架·缺貨檢查全在 RPC」→ 去缺貨

**docs(3 處):**
- `docs/design-storefront-manifest.yaml:854`「catch 吞 RPC RAISE(下架/缺貨/錯價/IDOR)」→ 去缺貨
- `docs/specs/2026-06-04-m3-checkout-plan.md:67`「availability 訂購政策(防舊 cart 送已下架/缺貨)」→ 註明缺貨改快照不擋
- `docs/specs/2026-06-04-m3-s2-orders-migration-plan.md:130`「`availability != 'in-stock'` → raise(訂購政策)」→ 改為移除/快照

**backlog:**
- `docs/phase-1-backlog.md:5579-5588` #214 ①:標 #214(a) 已解(移閘 + 快照、不擴值域);#214(b) idempotency 仍開。
- `docs/phase-1-backlog.md:5684`(#219 RPC RAISE 原文清單含缺貨):缺貨 RAISE 已移除 → 輕量註記(屬另一 IDOR/error-leak backlog 項、低優先)。

## ⑥ 影響面(鐵則 8)
- 改 create_order RPC 邏輯(移 2 條 RAISE + 寫快照)+ **🔴 新增 order_items.availability_at_checkout 欄**(schema 變動)+ 連帶 6 code/domain 註解 + 3 docs + backlog。
- **無權限/RLS/GRANT 變動、無新 env、無新 type、無 view**。order_items 既有 RLS(own-only SELECT)自動涵蓋新欄(非經銷價、非 PII;codex 確認不需新 policy、service_role 直寫權早收);REVOKE/GRANT 矩陣冪等重申。
- 前端:**不需改**(已訂貨型;catch 吞所有 RPC RAISE 回單一通用字面、無缺貨專屬分支 → grep 證 0)。
- db push:與 0b/0c/1b RPC 同 bundle(Sean 授權);prod orders/order_items 0 row → ADD COLUMN 零鎖風險。

## ⑦ ✅ Sean 拍板 §7=A:availability_at_checkout 快照「形狀」= 單欄 text 派生值(codex + 審查側雙證推 A)
原 /tmp 草稿假設「塞進 JSONB、無 schema 變動」已證不可行(§3)。Sean 2026-06-14 拍 A(單欄 text 派生值);唯一乾淨解=新欄(§3 whitelist exact-key CHECK 證塞 JSONB 不可行):

- ✅【已採用】**A(推薦、codex 認同 Phase 1 最對)單欄 text 派生值** `availability_at_checkout text`:RPC 寫
  `CASE WHEN v_variant.variant_availability = 'in-stock' AND v_variant.product_availability = 'in-stock' THEN 'in-stock' ELSE 'out-of-stock' END`
  + CHECK 白名單。後台一句 `WHERE availability_at_checkout='out-of-stock'` 抓全部調貨單行。**最小 schema 面、群層+變體層皆 feed(無死碼)、業務語意清**(「結帳當下這行從庫存出得了嗎」)。
  - NULL 處理:availability 兩源欄皆 NOT NULL(§2 實證)→ ELSE 永遠是真 out-of-stock、**不會誤把 NULL 標成 out-of-stock**(NULL 不可能發生、僅防禦);plan 明載此語意。
- 【未採用】**B 無損明細** 2 欄 `variant_availability_at_checkout` + `product_availability_at_checkout`:溯源更細(知道哪層缺),但 schema 面較大、Phase 1 後台尚未需此粒度(codex:供應商/資料品質診斷才需)。
- 【未採用】**C 不做快照、保最小** 只移閘 + 移除 SELECT 的 2 個 availability 變數(消死碼),本 slice 維持 schema-free;快照延到後台真要時再加。(當時因前提改變〔快照現需 schema 變動、非免費〕誠實重列此選項;Sean 維持原 拍 A〔含快照、§7=A〕、未選 C。)

## ⑧ 執行步驟(✅ 已完成 migration 20260614130000)
1. MCP 再驗 order_items 0 row(已驗、實作前複查)。
2. 新 migration `CREATE OR REPLACE create_order`(移 2 RAISE + 寫快照)+ `ALTER TABLE order_items ADD COLUMN`(依 §7 形狀)+ REVOKE/GRANT + DO assert + rollback。
3. 審查側 MCP 交易模擬(BEGIN…ROLLBACK 零留痕):① out-of-stock variant + parent 未下架 → **建單成功**(現會 RAISE);② parent delisted → **仍 RAISE**;③ 變體 out-of-stock + parent delisted → 仍 RAISE;④ 價 NULL/0 → 仍 RAISE;⑤ 取價/變體 join/防撞/IDOR/tier general → zero-regression(only diff=移 gate + 寫快照);⑥ `availability IS NULL`(防禦、實務 moot:NOT NULL)→ 舊新同放行;⑦ 快照欄值正確(in-stock variant+in-stock product→'in-stock';任一 out→'out-of-stock');⑧ 新欄 CHECK 拒非白名單值;⑨ order_items_snapshot_whitelist 不受影響(product_snapshot 仍 exact {title,sku,spec});⑩ **DO assert 仍驗 create_order 5-param 權限矩陣唯 authenticated + 新欄存在**(對齊 0b assert 紀律)。
4. 連帶 docs/code/domain 註解更新(⑤ 完整清單)。
5. /slice-checkpoint 三綠(本 slice 動 .sql + .ts 註解 + .md/.yaml → typecheck/lint 跑;.ts 僅註解改但仍 build 驗保險)。
6. code-reviewer + codex 關卡2(鐵則 12)+ 審查側獨立 zero-regression diff + MCP 模擬。

## ⑨ 驗收條件(yes/no)
- [ ] out-of-stock variant(parent 未下架)可成功建單(MCP 實證)。
- [ ] delisted parent 仍 RAISE 擋單;價 NULL/0 仍 fail-closed RAISE。
- [ ] 取價/防撞/IDOR/權限/RLS/search_path/GRANT 矩陣 與 0b 版 zero-regression(diff only = 移 2 RAISE + 寫快照 + 新欄)。
- [ ] order_items 新欄 `availability_at_checkout` 值正確(依 §7 形狀);無未用死變數殘留。
- [ ] `availability IS NULL` 仍可建單(舊新同放行;實務 moot)。
- [ ] product_snapshot exact-key whitelist 不被破壞(仍 {title,sku,spec})。
- [ ] 前端 grep 確認無缺貨專屬 catch 分支(預期 0)。
- [ ] 連帶 6 code/domain 註解 + 3 docs + backlog 字面vs事實一致(含 domain types.ts must-fix)。
- [ ] 新 migration 自帶 rollback、DO assert、MCP 模擬零留痕。

## 禁止清單(基線)
- 不動 `delisted_at` 下架閘 / 不動取價(general)/ 不動 product_snapshot 白名單 CHECK / 不動防撞(複合鍵)/ 不動 IDOR(地址歸屬)/ 不動權限·RLS·GRANT·search_path。
- 不改前端行為(已訂貨型;僅清註解字面)。
- 不擴 availability 值域(不加第三態;直接移閘,#214a 走移除非擴張)。
- 不改舊歷史 migration 檔(forward-only)。
- 不 git add . / -A(精準 add)/ 不自動 push / 不自行 db push(等 Sean 授權、與 0b/0c/1b 同 bundle)。
- 不動 scope 外檔 / 不碰 CheckoutView.tsx(Sean 既存)/ .playwright-mcp。
— 禁止清單結束 —
