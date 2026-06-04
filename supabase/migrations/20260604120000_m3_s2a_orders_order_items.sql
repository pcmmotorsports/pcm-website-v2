-- ============================================================
-- M-3-S2-a:訂單地基 — orders / order_items 表 + 雙軸狀態 ENUM + display_id sequence + RLS + GRANT
-- ============================================================
-- 對齊 docs/specs/2026-06-04-m3-s2-orders-migration-plan.md(v3:codex 關卡1 round1 FAIL→收斂 + Sean 拍 D1-D6)。
-- 上層真權威:master plan docs/specs/2026-06-04-m3-checkout-plan.md v6 §3.1。
-- 鐵則 8 重大改動(新表/enum/RLS/GRANT)+ 鐵則 12(訂單 schema + RLS + 金額 + 歷史凍結快照)。
--
-- 決策(Sean 2026-06-04 拍):
--   D1=A 狀態 ENUM type(對齊 S1 domain + customers member_tier 慣例)/ D2=A order_items FK + 凍結快照並存 /
--   D5=A display_id 全域 sequence(PCM-YYYY-NNNN、NNNN ≥4 位不跨年重置)/ D6=A tappay 欄本片建 nullable(階段② 寫值)。
--
-- 🔴 business override(鐵則 12 揭示):
--   ① D3=B create_order **只做 general 價、零 store→price_store code path** —— tier-aware/經銷價取價自 S2
--      延到「定價階段」(報價單管道就緒 + 硬驗後)才加。偏離 master plan v6「S2 create_order tier-aware」。
--      本 migration 不含 create_order RPC(= S2-b1/b2);orders/order_items 表無 price_store/price_by_tier/cost 欄。
--   ② D4 運費 threshold NT$5,000(#161 已拍)+ 未滿 flat NT$100 —— 偏離 design HANDOFF-v2.0(400/150/店家免運);
--      運費邏輯在 create_order RPC(S2-b1),本 migration 僅存 shipping_fee 整數結果。
--   (運費 method 白名單 = home/store〔Sean 2026-06-04 拍 A、對齊 design CheckoutPage.jsx + HANDOFF-v2.0;舊 4 種
--    home/cvs/store/express 作廢〕;本片 shipping_method 為 text 欄、白名單在 RPC〔S2-b1〕。⚠️ S2-b1 運費片注意:design
--    自取 store 免運 / 宅配 home 滿額免運否則收費,與「flat 100」可能衝突 → 自取是否也 100 留運費片定、偏離 design 則 override。)
--
-- 🔴 經銷價零外洩(鐵則 12):orders / order_items **無任何 price_store / price_by_tier / cost 欄**;unit_price /
--   line_total / subtotal / total 為「結帳當下客人付的價」(S2 全 general);**不建 view**(RLS 直管表、客人只讀自己單)。
--
-- 金額一律 integer 元位(禁浮點);DDL CHECK 硬擋:quantity > 0、各金額 >= 0、line_total = unit_price * quantity、
--   total = subtotal + shipping_fee - discount_total(server 權威 + 縱深防禦)。
--
-- 動手前真 DB 交易模擬(MCP execute_sql 交易內 BEGIN + 套本 migration + DO 區塊斷言 + ROLLBACK、project
--   bmpnplmnldofgaohnaok pcm-website-v2 PG17、2026-06-04;SQL 字面不自證、以此唯讀查為憑):
--   PASS(round3、含審查側 codex k2 MUST-FIX-1+2 鎖值型別)= ① DDL 套用無誤(types/seq + m3_jsonb_values_all_string
--      helper + REVOKE/2 表/index/RLS/GRANT/2 policy 全建成);
--   ② **CHECK 拒非法列**(含 strict whitelist + 值型別守):line_total<>unit_price*qty / total<>subtotal+shipping-discount /
--      quantity<=0 / display_id 格式非 PCM-YYYY-NNNN / 🔴 product_snapshot 非 exact{title,sku,spec}(帶 price_store 或任何額外鍵
--      或缺鍵或 spec 非 object 皆拒;**spec 內藏 price_store/cost 數值、title/sku 為物件亦拒**)/ invoice 非 exact 白名單
--      (type 非法或額外鍵或**白名單鍵值為巢狀物件**皆拒)/ shipping_address_snapshot 非 exact{name,phone,line}(**值為物件亦拒**);
--   ③ RLS:authenticated sub=userA → 見自己單 count=1;sub=userB → 見 userA 單 count=0(越權擋);
--   ④ 🔴 authenticated `nextval(order_display_seq)` → insufficient_privilege(sequence REVOKE 生效);
--   ⑤ anon(SET ROLE anon + REVOKE ALL)SELECT orders → insufficient_privilege;
--   ⑥ ROLLBACK 後 information_schema/pg_type/pg_class 複查:orders/order_items/payment_status/
--      fulfillment_status/order_display_seq 全 false = 零留痕、正式庫零污染。
--
-- Rollback(Supabase forward-only、僅供參考):見檔尾。
-- ============================================================


-- ── 1. 雙軸狀態 ENUM type(D1=A、逐值對齊 packages/domain/src/order/types.ts PaymentStatus / FulfillmentStatus)──
CREATE TYPE payment_status     AS ENUM ('unpaid', 'paid', 'partiallyPaid', 'refunded');
CREATE TYPE fulfillment_status AS ENUM ('notOrdered', 'ordered', 'inStock', 'shipped');

COMMENT ON TYPE payment_status     IS 'M-3 付款軸(domain PaymentStatus 逐值對齊;主路徑 unpaid→paid、refunded/partiallyPaid 留用、轉移 guard 在 domain state-machine)。';
COMMENT ON TYPE fulfillment_status IS 'M-3 出貨軸(domain FulfillmentStatus;notOrdered→ordered→inStock→shipped 逐級、guard 在 domain)。';


-- ── 2. display_id 全域 sequence(D5=A;PCM-YYYY-NNNN 產號於 create_order RPC、不跨年重置、NNNN ≥4 位成長)──
CREATE SEQUENCE order_display_seq;
COMMENT ON SEQUENCE order_display_seq IS 'M-3 訂單人類可讀單號 PCM-YYYY-NNNN 的 NNNN 流水(全域、不跨年重置;create_order RPC nextval + lpad>=4)。';
-- 🔴 codex k2 WARN-2:REVOKE sequence(防非預期角色取號 / 燒號);create_order SECURITY DEFINER RPC 由 owner nextval、無需 GRANT。
REVOKE ALL ON SEQUENCE order_display_seq FROM PUBLIC, anon, authenticated;


-- ── 2b. jsonb strict-whitelist 值型別守 IMMUTABLE helper(審查側 codex k2 MUST-FIX-1+2)──
-- 背景:strict whitelist 只鎖「最外層 key」(jsonb - array[...] = {}),未鎖「value 的型別/巢狀」→ 經銷價/cost 可藏內層:
--   product_snapshot.spec = {"weave":"3K","price_store":999}(數值藏 spec 內)/ invoice = {"type":"personal","carrier":{"price_store":999}}
--   (物件藏白名單鍵值)/ shipping_address_snapshot = {"name":{"cost":1},...}(物件藏值)→ 舊 CHECK 全誤放行。
-- 修:此 helper 驗 top-level jsonb object 的「每個 value 皆為 string scalar」(拒 number/object/array/bool/null);
--   用於 invoice / shipping_address_snapshot(值皆純文字)+ product_snapshot.spec(domain Record<string,string>)。
-- ⚠️ CHECK 不能含 subquery → 改呼叫 IMMUTABLE 函式;jsonb_each 對非 object 會丟錯且 Postgres AND 不保證短路 →
--    用 CASE 保證先判 typeof object 再 jsonb_each(fail-closed:非 object 直接回 false 不丟錯)。SET search_path='' + pg_catalog 限定(避 mutable search_path advisor)。
CREATE OR REPLACE FUNCTION m3_jsonb_values_all_string(j jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(j) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(j) AS kv(k, v)
      WHERE pg_catalog.jsonb_typeof(kv.v) <> 'string'
    )
  END;
$$;
COMMENT ON FUNCTION m3_jsonb_values_all_string(jsonb) IS '🔴 鐵則 12 縱深(codex k2 MUST-FIX):驗 jsonb object 每個 top-level value 皆為 string scalar(拒 number/object/array/bool/null);防經銷價/cost 藏進白名單鍵的巢狀值。CHECK 用(IMMUTABLE);非 object 回 false(fail-closed)。';


-- ── 3. orders 主表 ──
CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id          text NOT NULL UNIQUE,                                        -- PCM-YYYY-NNNN(RPC 產)
  customer_user_id    uuid NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,  -- 有單不可刪客
  address_id          uuid REFERENCES customer_addresses(id) ON DELETE SET NULL,   -- 僅追溯 FK(地址可被客人刪改)
  shipping_address_snapshot jsonb NOT NULL,                                         -- 🔴 收件地址凍結快照(白名單 name/phone/line);防客人刪地址後訂單失履約地址(codex k2 WARN-1)
  tier_at_checkout    member_tier NOT NULL,                                         -- 結帳當下等級凍結(S2 恆 general、定價階段才有 store)
  payment_status      payment_status     NOT NULL DEFAULT 'unpaid',
  fulfillment_status  fulfillment_status NOT NULL DEFAULT 'notOrdered',
  subtotal            integer NOT NULL CHECK (subtotal >= 0),                       -- = Σ line_total
  shipping_fee        integer NOT NULL CHECK (shipping_fee >= 0),                   -- RPC 自算(未滿 5000 → 100、否則 0)
  discount_total      integer NOT NULL DEFAULT 0 CHECK (discount_total >= 0),       -- Phase 1 多為 0
  total               integer NOT NULL CHECK (total >= 0),
  shipping_method     text NOT NULL,                                               -- 白名單在 RPC(S2-b1、鐵則 1 衝突待解);不加表 CHECK
  invoice             jsonb NOT NULL,                                              -- 白名單欄 type/carrier/title/taxId/donateCode(RPC 逐欄白名單)
  tappay_rec_trade_id text UNIQUE,                                                 -- D6 nullable;階段② 寫
  paid_at             timestamptz,                                                 -- D6 nullable;階段② 寫
  payment_method      text,                                                        -- D6 nullable;階段② 寫(tappay/atm…)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_balances CHECK (total = subtotal + shipping_fee - discount_total),
  -- display_id 格式(codex k2r2 WARN;對齊 S1 DisplayId regex ^PCM-\d{4}-\d{4,}$)
  CONSTRAINT orders_display_id_format CHECK (display_id ~ '^PCM-[0-9]{4}-[0-9]{4,}$'),
  -- 🔴 鐵則 12 縱深(codex k2 BLOCKER + k2r2 收嚴 strict whitelist + k2 MUST-FIX-2 鎖值型別、對齊 S1 metadata CHECK):
  --    jsonb_typeof=object + 必備鍵 ?& + **移除白名單鍵後須為 {} = exact key set**(拒任何額外/改名鍵)
  --    + **每個白名單鍵的值皆 string scalar(m3_jsonb_values_all_string)= 拒巢狀物件/陣列藏經銷價**。
  CONSTRAINT orders_invoice_whitelist CHECK (
    jsonb_typeof(invoice) = 'object'
    AND invoice ? 'type'
    AND (invoice->>'type') IN ('personal', 'company', 'donate')
    AND (invoice - array['type','carrier','title','taxId','donateCode']) = '{}'::jsonb
    AND m3_jsonb_values_all_string(invoice)
  ),
  CONSTRAINT orders_ship_addr_whitelist CHECK (
    jsonb_typeof(shipping_address_snapshot) = 'object'
    AND shipping_address_snapshot ?& array['name','phone','line']
    AND (shipping_address_snapshot - array['name','phone','line']) = '{}'::jsonb
    AND m3_jsonb_values_all_string(shipping_address_snapshot)
  )
);

COMMENT ON TABLE  orders IS 'M-3 訂單主表(S2-a)。寫入只走 create_order RPC(SECURITY DEFINER、authenticated 無直接 INSERT);客人只讀自己(RLS)。無經銷價欄、無 view。金額 integer 元位、CHECK 守 server 權威。';
COMMENT ON COLUMN orders.tier_at_checkout IS '結帳當下會員等級凍結(歷史不變);S2=B 恆 general、店家分支留定價階段。';
COMMENT ON COLUMN orders.shipping_method IS '配送方式;白名單 home/store(Sean 2026-06-04 拍 A、對齊 design CheckoutPage.jsx + HANDOFF-v2.0「只宅配+自取」);驗證在 create_order RPC(S2-b1)、本欄 text 無表 CHECK。';
COMMENT ON COLUMN orders.invoice          IS '發票 jsonb 白名單欄 type(personal/company/donate)/carrier/title/taxId/donateCode;RPC 逐欄白名單建、拒多餘欄(防混入價格/多餘 PII)。';


-- ── 4. order_items 明細表(D2=A:FK 追溯 + 凍結快照並存)──
CREATE TABLE order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id       uuid REFERENCES product_variants(id) ON DELETE SET NULL,        -- 追溯;變體刪不破歷史
  variant_sku      text    NOT NULL,                                               -- 快照(該變體個別料號)
  product_snapshot jsonb   NOT NULL,                                               -- 🔴 白名單 title/sku/spec only(RPC 建、禁經銷價/cost)
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price       integer NOT NULL CHECK (unit_price >= 0),                        -- 結帳當下單價(S2 = price_general)
  line_total       integer NOT NULL CHECK (line_total >= 0),
  CONSTRAINT order_items_line_balances CHECK (line_total = unit_price * quantity),
  -- 🔴 鐵則 12 縱深(codex k2 BLOCKER + k2r2 收嚴 strict whitelist + k2 MUST-FIX-1 鎖值型別、對齊 S1 metadata CHECK):
  --    product_snapshot 必 object + 必備 title/sku/spec + **移除三鍵後須為 {}(exact key set、零額外鍵)**
  --    + title/sku 須 string(拒物件藏值)+ spec 須 object 且 **spec 每值皆 string(m3_jsonb_values_all_string)**。
  --    任何經銷價 / cost / 改名鍵 = 額外鍵 → 違 exact-key → 拒;藏進 spec 內的 price_store/cost 數值 → 違值型別 → 拒
  --    (RPC jsonb_build_object 為主寫入者,本 CHECK 為縱深底線;spec 鍵名為 domain Record<string,string> 自由欄、由 RPC 控)。
  CONSTRAINT order_items_snapshot_whitelist CHECK (
    jsonb_typeof(product_snapshot) = 'object'
    AND product_snapshot ?& array['title','sku','spec']
    AND (product_snapshot - array['title','sku','spec']) = '{}'::jsonb
    AND jsonb_typeof(product_snapshot->'title') = 'string'
    AND jsonb_typeof(product_snapshot->'sku')   = 'string'
    AND jsonb_typeof(product_snapshot->'spec')  = 'object'
    AND m3_jsonb_values_all_string(product_snapshot->'spec')
  )
);

COMMENT ON TABLE  order_items IS 'M-3 訂單明細(S2-a)。歷史凍結快照:unit_price/line_total/variant_sku/product_snapshot(白名單 title/sku/spec)。🔴 無 price_store/price_by_tier/cost。商品改價不影響舊單。';
COMMENT ON COLUMN order_items.product_snapshot IS '🔴 鐵則 12 經銷價零滲入:逐欄白名單 title/sku/spec(對齊 domain ProductSnapshot);RPC jsonb_build_object 建 + DB CHECK order_items_snapshot_whitelist 縱深拒經銷價鍵。';

-- 🔴 codex k2 WARN-3:跨表不變式 orders.subtotal = Σ(order_items.line_total) 為 DB CHECK 無法表達(跨 row);
--    由 create_order RPC 單一寫入者保證(RPC 自算 subtotal、authenticated 無直接 INSERT)+ S2-b 交易測試覆蓋
--    subtotal/items 不一致情境。不加 deferrable trigger(RPC 權威已足、避免複雜度)。


-- ── 5. index ──
CREATE INDEX orders_customer_idx   ON orders(customer_user_id);
CREATE INDEX order_items_order_idx ON order_items(order_id);


-- ── 6. RLS + GRANT(客人只讀自己、anon 0、寫入只走 RPC)──
-- 重點:authenticated 只 GRANT SELECT(無 INSERT/UPDATE/DELETE)→ 建單只能走 create_order SECURITY DEFINER RPC;
--       anon 零 policy + REVOKE = 零讀;orders/order_items 無經銷價欄、無 view 投射。
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE orders      FROM PUBLIC, anon, authenticated;  -- NIT(codex k2):加 PUBLIC 與 sequence REVOKE 一致
REVOKE ALL PRIVILEGES ON TABLE order_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE orders      TO authenticated;
GRANT SELECT ON TABLE order_items TO authenticated;

CREATE POLICY orders_select_own ON orders
  FOR SELECT TO authenticated
  USING (customer_user_id = (select auth.uid()));

CREATE POLICY order_items_select_own ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.customer_user_id = (select auth.uid())
    )
  );


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP POLICY IF EXISTS order_items_select_own ON order_items;
--   DROP POLICY IF EXISTS orders_select_own ON orders;
--   DROP TABLE IF EXISTS order_items;
--   DROP TABLE IF EXISTS orders;
--   DROP FUNCTION IF EXISTS m3_jsonb_values_all_string(jsonb);
--   DROP SEQUENCE IF EXISTS order_display_seq;
--   DROP TYPE IF EXISTS fulfillment_status;
--   DROP TYPE IF EXISTS payment_status;
-- ============================================================
