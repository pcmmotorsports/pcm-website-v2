# M-3-S2 訂單地基(orders/order_items migration + create_order RPC)— 動手前計畫 v3（鐵則 8 關卡1 用）

> 狀態:🟢 v3、codex 關卡1 round1 FAIL(5 BLOCKER+8 WARN)→ v2 收斂全部 → **Sean 2026-06-04 拍 D1-D6(D3=B general-only / D4 運費 100·門檻 5000)** → v3 記拍板 + business override。可開 S2-a。**唯 運費 method 白名單(home/cvs/store/express vs design v2.0 home/store)鐵則 1 衝突延 S2-b1 前解。**
> 作者:Claude Code(M-3 執行 session、寫審分離 ROLE=A) / 日期:2026-06-04
> 衝突仲裁:STATUS.md > NORTHSTAR > master plan v6(`docs/specs/2026-06-04-m3-checkout-plan.md`) > ADR-0005 > 本檔
> 上層真權威:master plan v6 §3.1+§3.0+§5。本檔 = 其 **階段① 訂單地基的「子片群」backend 設計**(非 §3.1 全完;明列後續見 §0)。

---

## 0. 範圍界定(收斂 codex WARN-2 命名)

- 本計畫 = master plan 階段① 的**訂單地基子片群**:`orders`/`order_items` migration + RLS + GRANT + `create_order` RPC(**D3=B general-only、tier-aware/經銷價取價延定價階段**)+ create-order use-case + 只讀 adapter + calculate-shipping + CartContext variant_id。
- **明列不含(後續 slice)**:`payment_confirmer` 角色 + `confirm_order_payment` RPC + TapPayChargeAdapter(=階段②);**server-only protected pricing path + CI grep gate(=階段⓪)**;前台 購物車/結帳 UI(=階段① 後續 UI 片)。本片完成**不等於** master plan §3.1 完成。
- S1 ✅ sign-off(634fbe7):domain Order + 雙軸狀態機 + 經銷價快照白名單。migration enum/欄逐欄對齊 S1 `packages/domain/src/order/types.ts`。

## 1. 現況(recon 實查、見原 v1 §1,不重列)

無 orders/order_items 表;既有可複用:member_tier ENUM、customers(user_id PK / tier column-GRANT)、customer_addresses RLS、product_variants(price_general/store int、availability CHECK、複合 UNIQUE)、products.delisted_at + RLS、SECURITY DEFINER 慣例、金額 integer 元位。

## 2. 切片拆解(收斂 codex WARN-1:S2-b 再拆)

| slice | 內容 | 鐵則 | 審查 |
|---|---|---|---|
| **S2-a** | migration:2 ENUM type + `orders`+`order_items` 表(完整約束見 §3A)+ display_id sequence + RLS + DDL GRANT | 8+12 | MCP 交易模擬 + code-reviewer + **codex 關卡2 必跑** |
| **S2-b1** | `create_order` RPC 骨架 + 權限 + **全 fail-closed guards**(§3B-2)+ **general 取價**(店家分支見 D3) | 8+12 | MCP 交易模擬(synthetic 驗金額)+ code-reviewer + **codex 關卡2 必跑** |
| **S2-b2** | RPC 快照寫入(tier_at_checkout + product_snapshot 白名單 + variant_sku)+ **return DTO `{order_id,display_id}`** + display_id 產號 + 高覆蓋測試 | 8+12 | MCP 交易模擬 + code-reviewer + **codex 關卡2 必跑** + **Codex Review Packet** |
| **S2-c** | create-order use-case + IOrderRepository Supabase **只讀** adapter + zod schemas(line/checkout 輸入白名單) | 8 | code-reviewer +（pricing → codex 關卡2 必跑） |
| **S2-d** | calculate-shipping use-case（運費常數**與 RPC 同一真相**、見 D4 + drift 測試) | 6/9 | code-reviewer |
| **S2-e** | CartContext `variant_id` 線契約清理 | 3/5 | code-reviewer + Sean 肉眼驗 |

> 階段① 末 Sean 肉眼驗:一般帳號走到付款前價正確(店家價依 D3 + 階段ⓠ)。

## 3. 設計決策(待 Sean 批准)

**D1 狀態欄型別 — 推薦 A=ENUM type**(`payment_status`/`fulfillment_status` ENUM、對齊 S1 domain + customers member_tier 慣例)。

**D2 order_items 連結 — 推薦 A=FK+快照並存**(`variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL` + 凍結快照欄)。

**D3 🔴 tier 取價 vs 階段ⓠ gate(codex BLOCKER-1 駁回 v1 的 NULL-gate)— 待 Sean 拍**
- **B 拍板**:S2 create_order **只支援 general(price_general)**;**完全不寫 store→price_store code path**。店家經銷價取價 + tier-aware 留**定價階段**(報價單管道就緒 + 硬驗後)才加。最嚴守「不啟用店家價 checkout」(零 store code path、零洩漏面、零「資料一填就自動開」)。
- 🔴 **business override(必註明、鐵則 12)**:**偏離 master plan v6「S2 create_order tier-aware」** → tier-aware/經銷價取價自 S2 延到定價階段、本片 create_order 只做 general 價。commit body + manifest override 揭示。
- codex BLOCKER-1 收斂:v1「price_store NULL 即 gate」是資料狀態 gate 非政策 gate → B「零 store code path」徹底避開。premiumStore 鎖=store 邏輯一併留定價階段。

**D4 運費 — Sean 拍 ✅(2026-06-04)**:
- 免運門檻 **NT$5,000**(已拍 #161、不動);未滿門檻運費 = **NT$100 全站平價**(flat、method-independent)。
- 🔴 **business override(必註明)**:偏離 design HANDOFF-v2.0(threshold 400 / homeFee 150 / 店家取貨免運)→ Sean 拍 threshold 5000 + flat 100(對齊 backlog「寄店家固定 100」+ 全站平價)。commit body + manifest 揭示。
- ✅ **運費 method 白名單 = `home`/`store`(Sean 2026-06-04 拍 A、鐵則 1 衝突解)**:對齊 design 真權威 CheckoutPage.jsx + HANDOFF-v2.0「只宅配+自取」;舊 4 種 `home/cvs/store/express`(HANDOFF.md L188)= 審查引舊檔誤報、作廢。S2-a `shipping_method` text 無 CHECK、白名單在 RPC(S2-b1)。
- 🔴 client 不送運費;RPC 自算為**最終權威**;calculate-shipping use-case 鏡像同常數 + **drift 測試**(TS 常數 === DB 常數,codex WARN-3)。
- ⚠️ **S2-b1 運費片待定(Sean)**:design 寫**自取 store 免運(0)** / 宅配 home 滿額免運否則收費,與「未滿門檻 flat 100」可能衝突 → **自取是否也收 100** 留運費片 Sean 定;偏離 design 則 override 註明。

**D5 display_id — Sean 拍 A ✅=全域 sequence**:`CREATE SEQUENCE order_display_seq`,RPC `'PCM-'||to_char(now() AT TIME ZONE 'Asia/Taipei','YYYY')||'-'||lpad(nextval('order_display_seq')::text,4,'0')`。**不跨年重置、NNNN 隨量 ≥4 位成長**(S1 regex `^PCM-\d{4}-\d{4,}$` 已允許 ≥4 位、`PCM-2026-12345` 合法、無格式衝突;v1「每年序列」措辭矛盾已刪)。併發唯一性由 sequence 原子性保證。

**D6 tappay 欄 — Sean 拍 A ✅=本片建 nullable**(`tappay_rec_trade_id text UNIQUE`、`paid_at timestamptz`、`payment_method text`;階段② 寫值;避免階段② 再 ALTER)。

**D1 狀態欄型別 — Sean 拍 A ✅=ENUM type**。**D2 order_items 連結 — Sean 拍 A ✅=FK+快照並存**。

## 3A. DDL 草案(收斂 codex WARN-5)

> ⚠️ **真權威 = 實際 migration 檔** `supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql`(已實作 + MCP 交易模擬多輪 PASS + 零留痕)。下方為 v2 草案,**實作版另含 codex 關卡2 收斂的 5 項**:`shipping_address_snapshot jsonb NOT NULL` 凍結快照 / 三 jsonb 欄 **strict whitelist CHECK**(jsonb_typeof object + exact key set `- array = '{}'` + spec object,非僅 blacklist)/ `display_id` 格式 CHECK / `REVOKE ALL ON SEQUENCE` / **S2-a-fix 值型別守 + spec 鍵名 blacklist**(審查側 codex k2 MUST-FIX-1+2 + round2:IMMUTABLE helper `m3_jsonb_values_all_string`〔CASE 正向判 object、NULL/非 object fail-closed〕把三白名單欄值鎖 string scalar + order_items title/sku 須 string,封經銷價藏巢狀物件/數值;另 spec `?|` blacklist 擋 price_store/price_by_tier/cost 字串鍵。spec **改名鍵**殘餘靠 RPC 主控、非全封,誠實揭示記 backlog #213)。以 migration 檔為準。

```sql
-- ENUM(D1=A)
CREATE TYPE payment_status     AS ENUM ('unpaid','paid','partiallyPaid','refunded');
CREATE TYPE fulfillment_status AS ENUM ('notOrdered','ordered','inStock','shipped');

CREATE SEQUENCE order_display_seq;  -- D5=A 全域

CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id          text NOT NULL UNIQUE,                 -- PCM-YYYY-NNNN
  customer_user_id    uuid NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  address_id          uuid REFERENCES customer_addresses(id) ON DELETE SET NULL, -- 快照另存、FK 僅追溯
  tier_at_checkout    member_tier NOT NULL,                 -- 凍結
  payment_status      payment_status     NOT NULL DEFAULT 'unpaid',
  fulfillment_status  fulfillment_status NOT NULL DEFAULT 'notOrdered',
  subtotal            integer NOT NULL CHECK (subtotal >= 0),
  shipping_fee        integer NOT NULL CHECK (shipping_fee >= 0),
  discount_total      integer NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  total               integer NOT NULL CHECK (total >= 0),
  shipping_method     text NOT NULL,                        -- 白名單值(§3B)
  invoice             jsonb NOT NULL,                       -- 白名單欄(§3B)
  tappay_rec_trade_id text UNIQUE,                          -- D6 nullable
  paid_at             timestamptz,
  payment_method      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_balances CHECK (total = subtotal + shipping_fee - discount_total)
);

CREATE TABLE order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id      uuid REFERENCES product_variants(id) ON DELETE SET NULL, -- D2 追溯、可 NULL
  variant_sku     text NOT NULL,                            -- 快照
  product_snapshot jsonb NOT NULL,                          -- 白名單 title/sku/spec only
  quantity        integer NOT NULL CHECK (quantity > 0),
  unit_price      integer NOT NULL CHECK (unit_price >= 0),
  line_total      integer NOT NULL CHECK (line_total >= 0),
  CONSTRAINT order_items_line_balances CHECK (line_total = unit_price * quantity)
);

CREATE INDEX orders_customer_idx    ON orders(customer_user_id);
CREATE INDEX order_items_order_idx  ON order_items(order_id);

-- RLS:客人只讀自己、anon 0、寫入只走 create_order RPC(authenticated 無直接 INSERT)
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE orders, order_items FROM anon, authenticated;
GRANT SELECT ON orders, order_items TO authenticated;        -- 無 INSERT/UPDATE/DELETE 給 authenticated
CREATE POLICY orders_select_own ON orders FOR SELECT TO authenticated
  USING (customer_user_id = (select auth.uid()));
CREATE POLICY order_items_select_own ON order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id
                 AND o.customer_user_id = (select auth.uid())));
-- anon:零 policy + REVOKE = 零讀。無 view 投射經銷價(orders/order_items 無 price_store/price_by_tier 欄)。
```

## 3B. create_order RPC 合約(收斂 codex BLOCKER-2/3/4 + WARN-8)

- **簽章**:`create_order(p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb) RETURNS jsonb` `SECURITY DEFINER` `SET search_path=''`。
- **回傳(BLOCKER-4)**:**只** `jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id)`。🔴 **禁回 variant/product 原 row / 任何 price 結構**。
- **權限(WARN-7)**:`REVOKE EXECUTE ON FUNCTION public.create_order(...) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO authenticated;`。
- **fail-closed 全列(BLOCKER-2、缺一即 raise)**:
  1. `v_uid := auth.uid()`;`v_uid IS NULL` → raise(未登入/anon)。
  2. customers row(user_id=v_uid)不存在 → raise。
  3. 地址:`customer_addresses WHERE id=p_address_id AND customer_user_id=v_uid` 0 筆 → raise。
  4. `p_lines` 非陣列 / 空 / 任一 element 缺 variant_id 或 qty → raise。
  5. `qty`:非整數 / `<= 0` / 超大(> 上限如 9999)→ raise。
  6. 重複 variant_id → raise(或合併、本片 raise 防意外)。
  7. variant join `product_variants` 找不到 → raise;parent `products.delisted_at IS NOT NULL` → raise;`availability != 'in-stock'` → raise(訂購政策)。
  8. 取價:`v_price := price_general`(D3=B);`v_price IS NULL OR v_price <= 0` → raise。
  9. `p_shipping_method` 不在白名單 `{'home','store'}`(Sean 拍 A、對齊 design)→ raise。
- **金額 server 權威(BLOCKER-3)**:`line_total := v_price * qty`;`subtotal := Σ`;`shipping_fee := f(subtotal, method)`(免運門檻 D4、RPC inline 常數最終權威);`total := subtotal + shipping_fee - discount_total`。client 永不送金額。
- **invoice 白名單(WARN-8)**:`p_invoice` 只取 `{type, carrier, title, taxId, donateCode}`(對齊 S1 CustomerAddress.invoice);RPC 逐欄白名單建 jsonb 存、忽略多餘欄;type 須 ∈ ('personal','company','donate')。
- **快照(S2-b2)**:order_items 寫 `product_snapshot = jsonb_build_object('title',…,'sku',…,'spec',…)` 白名單;`variant_sku`、`unit_price`、`line_total`、`quantity`;orders 寫 `tier_at_checkout`。🔴 禁寫 price_store/price_by_tier/cost。
- **禁動態 SQL**;`p_lines` 走 `jsonb_array_elements` + 參數化。

## 4. 架構與影響面(鐵則 8)— 見 v1 §4(不變):動 schema(新表/enum/RPC/sequence、零碰既有)、跨層 domain→ports→use-cases→adapters→CartContext、無新 env、零 service_role。

## 5. 鐵則 12 紅線 — 見 v1 §5,**補強**:RPC return DTO 只 `{order_id,display_id}`(BLOCKER-4);REVOKE FROM PUBLIC,anon,authenticated 再 GRANT authenticated(WARN-7);fail-closed 全列(§3B-2);DDL CHECK(quantity>0 / line_total=unit_price*quantity / total=subtotal+shipping-discount)。

## 6. 內容分級 — 運費門檻/金額 L2(hardcode+backlog);訂單狀態/發票類型 L1。

## 7. 審查計畫(收斂 codex BLOCKER-5 + WARN-6)

- 本 plan v2 → 可選 codex round2(Sean 批 D3/D4 後)。
- 每 DB slice commit 前:`/slice-checkpoint` 三綠 + code-reviewer + **codex 關卡2 必跑**;S2-b2 產 Codex Review Packet。
- **MCP 交易模擬(每 migration/RPC 套正式庫前)**:`BEGIN` + 套 DDL/RPC + **`SET LOCAL request.jwt.claims = '{"sub":"<userA-uuid>","role":"authenticated"}'`**(令 `auth.uid()` 有值、WARN-6)→ 分 anon / userA / userB 三身分驗:RLS 只讀自己、anon 零讀、create_order 越權(userB 用 userA 地址)被拒、**synthetic fixture 驗 unit_price/subtotal/total 算對 + 店家分支(D3)行為**(BLOCKER-5:驗算出的金額對、但**不列印真實庫經銷價**、用測試假資料)→ `ROLLBACK` → `information_schema` 驗零留痕。
- migration 由 Sean `supabase db push` 套用。

## 8. Rollback — 每 migration 自帶 `-- ROLLBACK`(逆序 DROP FUNCTION→order_items→orders→SEQUENCE→TYPE);先交易模擬驗。

## 9. 風險 — 見 v1 §9 + codex 收斂:gate(D3 改政策 gate 非資料 gate);RPC 複雜度(拆 b1/b2 + 高覆蓋);金額權威(運費/total RPC 自算 + synthetic 驗 + drift 測試);display_id 併發(sequence 原子)。

## 10. Sean 拍板紀錄(2026-06-04)+ 殘留

- ✅ **D1=A**(ENUM)/ **D2=A**(FK+快照)/ **D3=B**(general-only、零店家價 code path、tier-aware 延定價階段)/ **D4**(門檻 5000 不動 + 未滿 flat 100)/ **D5=A**(全域 sequence)/ **D6=A**(tappay 欄本片建)。
- 🔴 **2 business override 須揭示**(commit body + manifest):① tier-aware/經銷價取價自 S2 延定價階段(偏離 master plan v6);② 運費 threshold 5000 + flat 100(偏離 design v2.0 400/150/店家免運)。
- ✅ **method 白名單解(2026-06-04 Sean 拍 A)= `home`/`store`**(對齊 design CheckoutPage.jsx + HANDOFF-v2.0;舊 4 種作廢)。
- ⚠️ **S2-b1 運費片殘留**:自取 store 免運 vs flat 100 衝突 → 自取是否收 100 留運費片 Sean 定(偏離 design 則 override)。
- codex 關卡1 round1 全 5 BLOCKER + 8 WARN 已收斂進 v2/v3;**可開 S2-a**。

— END —
