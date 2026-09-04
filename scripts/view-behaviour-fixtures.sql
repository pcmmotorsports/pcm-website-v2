-- ══════════════════════════════════════════════════════════════════════════════
-- 四支寄信掃描 view 的【行為】fixture —— ⟦b4-VIEWSQLUNTESTED⟧
--
-- 🛑 **為什麼有這一支**:那四支 view 的篩選條件, 在 2026-09-05 之前
--    **沒有任何一發可重跑的東西在驗**。既有的防線只有兩道, 而兩道都答不出這件事:
--      ① apply 期的 `pg_get_viewdef` 字面釘樁 ⇒ 它證的是【字面在定義裡】,
--         🔴 **擋不住有人加一個 `OR TRUE`** —— 那正是 codex 2026-09-05 打穿的那一點。
--      ② 兩支 adapter 的 vitest ⇒ 它們餵的是**假的 query builder**,
--         🔴 **一行 SQL 都沒有跑過。**
--    ⇒ 📌 **本支是唯一會【真的把 SQL 跑在真的資料上】的那一格。**
--
-- ── 設計:一列該進 + 【每一條述詞各一列該排除】────────────────────────────
--    每一列該排除的資料, 與該進的那列**只差那一個維度**
--    ⇒ 🎯 **任何一條述詞被拿掉, 至少有一列會漏出來, 而集合比對會紅。**
--    ⇒ **那些排除列本身就是 `OR TRUE` 的覆蓋面**, 不是額外的裝飾。
--
-- ── 🔴 而集合比對是【雙向】的, 這一點承重 ─────────────────────────────────
--    斷言比的是「實得集合 = 期望集合」, 不是「期望的那幾列在裡面」。
--    ⇒ 少一列(述詞太嚴)與多一列(述詞太鬆)**都會紅**。
--    🛑 單向的「in 檢查」對【述詞被拿掉】完全失明 —— 那是這一族最常見的假綠。
--
-- ── 🔴 期望值從【規格】推, 不從跑出來的東西抄 ─────────────────────────────
--    每一列的期望寫在它自己的註解裡, 而**先寫期望再跑**。
--    抄觀察值的期望值從出生起就不可能抓到缺陷 —— 而它照樣會紅一次, 所以騙得過自檢。
--
-- ── 🛑 射程(它答不出來的)─────────────────────────────────────────────────
--    · 它跑在**拋棄式 PG** 上 ⇒ 不答「正式庫那四支 view 現在長什麼樣」。
--    · 它驗**篩選**, 不驗 RLS 可見性 —— `service_role` 的 BYPASSRLS 若被收掉,
--      view 會靜靜回零, 而本支是以 postgres 身分跑的 ⇒ **看不到那個世界**。
--    · 它不驗 adapter 那一層(cutoff / limit / 排序)—— 那在 vitest 裡。
-- ══════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;

-- ── 0. 前置閘:四支 view 在不在(它們不在時, 下面每一格都會【零列 = 全綠】)──
--    🔴 這一格非有不可:一支不存在的 view 若被 `to_regclass` 判成 NULL 而我們略過它,
--       那個略過與「它篩對了」在輸出上是同一句話。
DO $$
DECLARE v text; v_missing text[] := ARRAY[]::text[];
BEGIN
  FOREACH v IN ARRAY ARRAY['public.pcm_order_created_email_pending',
                           'public.pcm_unpaid_cancelled_email_pending',
                           'public.pcm_shipped_email_pending',
                           'public.pcm_tracking_corrected_email_pending',
                           'public.pcm_shipped_email_unsendable'] LOOP
    IF to_regclass(v) IS NULL THEN v_missing := v_missing || v; END IF;
  END LOOP;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION '前置閘:這幾支 view 不存在 ⇒ 本發不算數(不是「它們篩對了」):%', v_missing;
  END IF;
END $$;

-- 🔴 底表必須是空的 —— 否則別人留下的資料會混進集合比對, 而那個紅指向錯的方向。
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.orders;
  IF n <> 0 THEN RAISE EXCEPTION '前置閘:orders 不是空的(% 列)⇒ 本支只能跑在乾淨的拋棄式 PG 上', n; END IF;
END $$;

CREATE SCHEMA fx;

-- ── 1. 共用資料 ───────────────────────────────────────────────────────────
--    🔴 空白信箱刻意用 **U+00A0(NBSP)** 而不是半形空白 —— 那是 `pcm_js_trim_whitespace()`
--       認得而 `btrim()` 不認得的碼位。⇒ 它同時量到**兩支 view 用了不同的空白定義**。
-- 🔴 **不直接 INSERT customers** —— `auth.users` 上有 `handle_new_auth_user()` 會自己建那一列
--    (直接插會撞 PK, 而不帶 email 會撞 customers.email 的 NOT NULL)。
--    ⇒ 走真的那條路建人, 再把信箱改成我要的形狀。
INSERT INTO auth.users(id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'real@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'placeholder2@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'placeholder3@example.com');
UPDATE public.customers SET email = E'\u00a0'
 WHERE user_id = '22222222-2222-2222-2222-222222222222';   -- NBSP:JS 判空、btrim() 判非空
UPDATE public.customers SET email = '   '
 WHERE user_id = '33333333-3333-3333-3333-333333333333';   -- 半形空白:兩邊都判空
DO $fx$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.customers;
  IF n <> 3 THEN RAISE EXCEPTION '前置:期望 3 個客人, 實得 % ⇒ handle_new_auth_user 沒跑或跑了別的', n; END IF;
END $fx$;
INSERT INTO public.staff(id, label) VALUES ('fxstaff', '測試員');
INSERT INTO public.suppliers(id, label)
VALUES ('99999999-9999-9999-9999-999999999999', '測試供應商');

-- 建一張單 + 一個品項。回傳 order id。
CREATE FUNCTION fx.mk_order(p_label text, p_cust uuid, p_paid boolean,
                            p_cancelled boolean, p_notify text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_proc uuid;
BEGIN
  INSERT INTO public.orders(
    display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
    payment_status, subtotal, shipping_fee, total, shipping_method, invoice,
    shipping_method_at_checkout, notification_email, cancelled_at)
  VALUES (
    p_label, p_cust, '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, 'general',
    CASE WHEN p_paid THEN 'paid' ELSE 'unpaid' END::payment_status,
    1000, 0, 1000, 'home', '{"type":"personal"}'::jsonb,
    'home', p_notify,
    CASE WHEN p_cancelled THEN now() - interval '1 hour' ELSE NULL END)
  RETURNING id INTO v_id;
  UPDATE public.orders SET paid_at = now() - interval '2 hour' WHERE id = v_id AND p_paid;
  INSERT INTO public.order_items(order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_id, 'SKU-'||p_label,
          jsonb_build_object('title','測試品','sku','SKU-'||p_label,'spec', jsonb_build_object('尺寸','標準')),
          1, 1000, 1000);
  -- 🔴 `oiqs_shipped_le_instock`:出貨數不得超過【已到貨數】⇒ 沒有這一步就出不了貨。
  --    ⚠️ 實測:插 order_items **不會**自動生這一列(我原本假設會, 而那個假設被自己的斷言打掉)
  --    ⇒ 這裡自己補, 相當於真實流程裡「進貨入庫」那一步。
  -- 🔴🔴 **不直寫 instock_quantity / received_quantity** —— `pcm_a4a_received_quantity_guard`
  --    逐字擋:「received_quantity 由重算 trigger 維護(真相 = receipts 明細 SUM),不得直寫」。
  --    ⇒ 📌 走真的那條路:**採購列 → 到貨明細** ⇒ 重算 trigger 自己把數字推上去。
  --    ⚠️ 它有一個 `pcm_a4a.received_sync` 的旁路旗標, **刻意不用** ——
  --      用旁路造出來的資料, 與真的流程造出來的**可以不一樣**, 而那個差別正是這支 fixture 要量的東西。
  INSERT INTO public.order_item_quantity_summary(order_item_id, quantity, ordered_quantity)
  SELECT id, 1, 1 FROM public.order_items WHERE order_id = v_id;
  INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity)
  SELECT id, '99999999-9999-9999-9999-999999999999', 1
    FROM public.order_items WHERE order_id = v_id
  RETURNING id INTO v_proc;
  INSERT INTO public.order_item_procurement_receipts(procurement_id, quantity, received_at, received_by)
  VALUES (v_proc, 1, now() - interval '1 day', 'fxstaff');
  RETURN v_id;
END $$;

-- 建一張箱 + 掛一個品項。回傳 shipment id。
-- 建一張箱 + 掛一個品項。回傳 shipment id。
-- 🔴🔴 **順序是承重的:先建【未出貨】的箱 → 掛品項 → 才 UPDATE 成已出貨。**
--    `shipment_items_parent_guard_ac` 逐字擋「包裹已寄出或已作廢,不可再加品項」
--    ⇒ 📌 **這正是 2026-09-04 那句「插不出一張已出貨的箱,只能走出來」的實際形狀** ——
--      而它的射程是【掛品項那一步】, 不是 shipments 本身(shipments 沒有 BEFORE INSERT 守門)。
CREATE FUNCTION fx.mk_shipment(p_order uuid, p_ref text, p_shipped boolean,
                               p_deleted boolean, p_tracking text,
                               p_corrected timestamptz, p_carrier text DEFAULT 'hct')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_cust uuid; v_item uuid;
BEGIN
  SELECT customer_user_id INTO v_cust FROM public.orders WHERE id = p_order;
  SELECT id INTO v_item FROM public.order_items WHERE order_id = p_order LIMIT 1;
  INSERT INTO public.shipments(
    shipment_reference, customer_user_id, recipient_snapshot, carrier_code, carrier_note)
  VALUES (
    p_ref, v_cust, '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, p_carrier,
    CASE WHEN p_carrier = 'other' THEN '自送' ELSE NULL END)
  RETURNING id INTO v_id;
  INSERT INTO public.shipment_items(shipment_id, order_item_id, shipped_quantity)
  VALUES (v_id, v_item, 1);
  UPDATE public.shipments
     SET tracking_number       = p_tracking,
         shipped_at            = CASE WHEN p_shipped THEN now() - interval '3 hour' END,
         tracking_corrected_at = p_corrected
   WHERE id = v_id;
  IF p_deleted THEN
    UPDATE public.shipments SET deleted_at = now(), void_reason = '測試作廢' WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION fx.mk_outbox(p_order uuid, p_event text, p_dedup text,
                             p_status text, p_sent timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.email_outbox(event_type, order_id, dedup_key, recipient_email,
                                  subject, payload, status, sent_at)
  VALUES (p_event, p_order, p_dedup, 'x@example.com', '測試', '{}'::jsonb, p_status, p_sent);
$$;

-- ══ 2. A 組:pcm_order_created_email_pending ══════════════════════════════
--    述詞 4 條:payment_status='paid' / cancelled_at IS NULL /
--               無 order_created outbox / 至少一個信箱非空
DO $$
DECLARE v uuid;
BEGIN
  -- ✅ 該進:通知信箱有值(而客戶信箱是 NBSP ⇒ 證 OR 的左半獨立成立)
  PERFORM fx.mk_order('CRTPSS', '22222222-2222-2222-2222-222222222222', true,  false, 'a@example.com');
  -- ✅ 該進:通知信箱 NULL, 靠客戶信箱(⇒ 證 OR 的右半獨立成立)
  PERFORM fx.mk_order('CRTPS2', '11111111-1111-1111-1111-111111111111', true,  false, NULL);
  -- ❌ 排除:未付款
  PERFORM fx.mk_order('CRTXPY', '11111111-1111-1111-1111-111111111111', false, false, 'a@example.com');
  -- ❌ 排除:已取消(而 payment_status 仍是 paid —— 取消不改它, 這正是那條述詞的理由)
  PERFORM fx.mk_order('CRTXCN', '11111111-1111-1111-1111-111111111111', true,  true,  'a@example.com');
  -- ❌ 排除:已經排過 order_created
  v := fx.mk_order('CRTXBX', '11111111-1111-1111-1111-111111111111', true, false, 'a@example.com');
  PERFORM fx.mk_outbox(v, 'order_created', 'CRTXBX-created', 'pending', NULL);
  -- ❌ 排除:兩個信箱都只有 NBSP ⇒ pcm_js_trim_whitespace() 判空(本片新增的那條述詞)
  PERFORM fx.mk_order('CRTXNR', '22222222-2222-2222-2222-222222222222', true, false, NULL);   -- 🔴 不是 NBSP:orders_notification_email_valid 不准通知信箱是空白, 真實形狀是 NULL
END $$;

-- ══ 3. B 組:pcm_unpaid_cancelled_email_pending ═══════════════════════════
--    述詞 5 條:payment_status='unpaid' / cancelled_at IS NOT NULL /
--               EXISTS order_cancellations / 無 order_unpaid_cancelled outbox / 信箱非空
CREATE FUNCTION fx.mk_cancellation(p_order uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.order_cancellations(order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (p_order, 'out_of_stock', gen_random_uuid(), repeat('a', 64), 'fxstaff');
$$;
DO $$
DECLARE v uuid;
BEGIN
  -- ✅ 該進
  v := fx.mk_order('CNCPSS', '11111111-1111-1111-1111-111111111111', false, true, 'b@example.com');
  PERFORM fx.mk_cancellation(v);
  -- ❌ 排除:已付款(那條線走的是別封信)
  v := fx.mk_order('CNCXPD', '11111111-1111-1111-1111-111111111111', true,  true, 'b@example.com');
  PERFORM fx.mk_cancellation(v);
  -- ❌ 排除:沒被取消。
  --    🔴 而它【帶著一列 order_cancellations】—— 這樣它唯一缺的就只有 cancelled_at,
  --      第 8 節才問得出「攔下它的是不是那一條」。少了這一步, 補救動作要改兩格,
  --      而兩格一起改, 綠只能告訴我「至少其中一格有用」。
  v := fx.mk_order('CNCXNC', '11111111-1111-1111-1111-111111111111', false, false, 'b@example.com');
  PERFORM fx.mk_cancellation(v);
  -- 🔴🔴 ❌ 排除:被取消了, 而 order_cancellations 沒有那一列 ⇒ 【逾時自動取消】
  --    這一列就是那條身分述詞的全部理由。Sean 2026-09-03 拍過:自動取消不寄信。
  PERFORM fx.mk_order('CNCXTM', '11111111-1111-1111-1111-111111111111', false, true, 'b@example.com');
  -- ❌ 排除:已經排過
  v := fx.mk_order('CNCXBX', '11111111-1111-1111-1111-111111111111', false, true, 'b@example.com');
  PERFORM fx.mk_cancellation(v);
  PERFORM fx.mk_outbox(v, 'order_unpaid_cancelled', 'CNCXBX-unpaid', 'pending', NULL);
  -- ❌ 排除:兩個信箱都是 NBSP
  v := fx.mk_order('CNCXNR', '22222222-2222-2222-2222-222222222222', false, true, NULL);   -- 🔴 不是 NBSP:orders_notification_email_valid 不准通知信箱是空白, 真實形狀是 NULL
  PERFORM fx.mk_cancellation(v);
END $$;

-- ══ 4. C 組:pcm_shipped_email_pending ════════════════════════════════════
--    🔴 C/D 兩組的單一律【未付款且未取消】⇒ 它們對 A 組與 B 組都不成立
--       ⇒ 四個期望集合互不汙染。
DO $$
DECLARE v uuid; s uuid;
BEGIN
  -- ✅ 該進
  v := fx.mk_order('SHPPSS', '11111111-1111-1111-1111-111111111111', false, false, 'c@example.com');
  PERFORM fx.mk_shipment(v, 'CCCCCC', true, false, 'TRACK-C1', NULL);
  -- ❌ 排除:還沒出貨
  v := fx.mk_order('SHPXNS', '11111111-1111-1111-1111-111111111111', false, false, 'c@example.com');
  PERFORM fx.mk_shipment(v, 'CCCCCD', false, false, NULL, NULL);
  -- ❌ 排除:箱被作廢
  v := fx.mk_order('SHPXVD', '11111111-1111-1111-1111-111111111111', false, false, 'c@example.com');
  PERFORM fx.mk_shipment(v, 'CCCCCF', true, true, 'TRACK-C3', NULL);
  -- ❌ 排除:已經排過(dedup_key 用真的那支函式算, 不手打)
  v := fx.mk_order('SHPXBX', '11111111-1111-1111-1111-111111111111', false, false, 'c@example.com');
  s := fx.mk_shipment(v, 'CCCCCG', true, false, 'TRACK-C4', NULL);
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'pending', NULL);
  -- ❌ 排除:兩個信箱都是半形空白(⇒ btrim() 也判得出來)
  v := fx.mk_order('SHPXNR', '33333333-3333-3333-3333-333333333333', false, false, NULL);   -- 通知信箱只能是 NULL 或合法信箱(orders_notification_email_valid)
  PERFORM fx.mk_shipment(v, 'CCCCCH', true, false, 'TRACK-C5', NULL);
  -- 🔴 ❌【該排除 —— 而 2026-09-05 之前它是【該進】的】:信箱只有 NBSP。
  --    ⛔ ~~本 view 用沒帶字元集的 `btrim()`(只剝半形空白), 而 A/B/D 三支用
  --      `pcm_js_trim_whitespace()` ⇒ 同一種信箱, 四支 view 判出兩種答案。~~
  --    ✅ `20260905040000`(⟦b4-SHIPPEDBTRIMNARROW⟧)把這兩支出貨信 view 改成同一支 helper
  --      ⇒ **四支現在給同一個答案**, 而這一列從「釘住不一致」翻成「釘住一致」。
  --    🔵 它同時是 `pcm_shipped_email_unsendable` 的期望列 —— 📌 **離開掃描面不等於消失**。
  v := fx.mk_order('SHPNBS', '22222222-2222-2222-2222-222222222222', false, false, NULL);   -- 🔴 不是 NBSP:orders_notification_email_valid 不准通知信箱是空白, 真實形狀是 NULL
  PERFORM fx.mk_shipment(v, 'CCCCCJ', true, false, 'TRACK-C6', NULL);
END $$;

-- ══ 5. D 組:pcm_tracking_corrected_email_pending ═════════════════════════
--    述詞 7 條(最多的一支):shipped / 未作廢 / tracking_corrected_at 有值 /
--    單號非空 / 信箱非空 / 出貨信已【寄出】且早於更正時點 / 沒排過更正信
DO $$
DECLARE v uuid; s uuid; t timestamptz := now() - interval '1 hour';
BEGIN
  -- ✅ 該進
  v := fx.mk_order('TRKPSS', '11111111-1111-1111-1111-111111111111', false, false, 'd@example.com');
  s := fx.mk_shipment(v, 'DDDDDD', true, false, 'TRACK-D1', t);
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'sent', t - interval '30 minute');
  -- ❌ 排除:單號沒有被更正過
  v := fx.mk_order('TRKXNC', '11111111-1111-1111-1111-111111111111', false, false, 'd@example.com');
  s := fx.mk_shipment(v, 'DDDDDF', true, false, 'TRACK-D2', NULL);
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'sent', t - interval '30 minute');
  -- 🔴 ❌ 排除:出貨信【還沒寄出】(status='pending')
  --    ⇒ 客人手上還沒有那個錯號碼 ⇒ 沒有東西需要更正。
  v := fx.mk_order('TRKXNS', '11111111-1111-1111-1111-111111111111', false, false, 'd@example.com');
  s := fx.mk_shipment(v, 'DDDDDG', true, false, 'TRACK-D3', t);
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'pending', NULL);
  -- 🔴 ❌ 排除:出貨信寄出的時間【晚於】更正時點 ⇒ 那封信帶的已經是新號碼
  v := fx.mk_order('TRKXTM', '11111111-1111-1111-1111-111111111111', false, false, 'd@example.com');
  s := fx.mk_shipment(v, 'DDDDDH', true, false, 'TRACK-D4', t);
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'sent', t + interval '10 minute');
  -- ❌ 排除:這一次更正已經排過了(dedup key 含更正時點 ⇒ 用真的那支函式算)
  v := fx.mk_order('TRKXDN', '11111111-1111-1111-1111-111111111111', false, false, 'd@example.com');
  s := fx.mk_shipment(v, 'DDDDDJ', true, false, 'TRACK-D5', t);
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'sent', t - interval '30 minute');
  PERFORM fx.mk_outbox(v, 'shipment_tracking_corrected',
                       public.pcm_tracking_corrected_dedup_key(s, v, t), 'pending', NULL);
  -- ❌ 排除:單號被更正成空白(carrier='other' 才過得了 shipments_shipped_needs_tracking)
  v := fx.mk_order('TRKXBT', '11111111-1111-1111-1111-111111111111', false, false, 'd@example.com');
  s := fx.mk_shipment(v, 'DDDDDK', true, false, E' ', t, 'other');
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'sent', t - interval '30 minute');
  -- ❌ 排除:兩個信箱都是 NBSP
  v := fx.mk_order('TRKXNR', '22222222-2222-2222-2222-222222222222', false, false, NULL);   -- 🔴 不是 NBSP:orders_notification_email_valid 不准通知信箱是空白, 真實形狀是 NULL
  s := fx.mk_shipment(v, 'DDDDDM', true, false, 'TRACK-D7', t);
  PERFORM fx.mk_outbox(v, 'order_shipped', public.pcm_shipped_email_dedup_key(s, v), 'sent', t - interval '30 minute');
END $$;

-- ══ 6. 斷言:實得集合 = 期望集合(雙向)═══════════════════════════════════
CREATE FUNCTION fx.assert_view(p_view text, p_expect text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_got text[]; v_extra text[]; v_miss text[]; v_rows bigint;
BEGIN
  EXECUTE format('SELECT coalesce(array_agg(DISTINCT display_id ORDER BY display_id), ARRAY[]::text[]) FROM %s', p_view)
    INTO v_got;
  -- 🔴🔴 **codex 2026-09-05 must-fix**:`array_agg(DISTINCT …)` 把**同一張單的多列折成一個標籤**。
  --    ⇒ 出貨那兩支的一列是 **(箱, 單)** 配對 —— 一張單兩箱時該回 2 列,
  --      而回 1 列(少一箱的信)與回 2 列**在標籤集合上完全相同** ⇒ 那一格對它失明。
  --    ✅ 補原始列數。本 fixture 裡每張單剛好一箱 ⇒ 列數 = 標籤數;
  --    🔵 **而有人日後加第二箱時, 這一格會紅並強迫他把期望寫清楚** —— 那正是要的。
  EXECUTE format('SELECT count(*) FROM %s', p_view) INTO v_rows;
  IF v_rows <> cardinality(p_expect) THEN
    RAISE EXCEPTION E'❌ % 的【列數】是 %, 而期望的標籤有 % 個\n   ⇒ 有標籤重複出現(同一單多列)或少了列 —— 標籤集合看不到這件事\n   實得標籤: %',
      p_view, v_rows, cardinality(p_expect), v_got;
  END IF;
  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) INTO v_extra
    FROM unnest(v_got) x WHERE NOT x = ANY(p_expect);
  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) INTO v_miss
    FROM unnest(p_expect) x WHERE NOT x = ANY(v_got);
  IF cardinality(v_extra) > 0 OR cardinality(v_miss) > 0 THEN
    RAISE EXCEPTION E'❌ % 篩錯了\n   多出來(述詞太鬆 / 被拿掉了): %\n   少掉了(述詞太嚴): %\n   實得: %\n   期望: %',
      p_view, v_extra, v_miss, v_got, p_expect;
  END IF;
  RAISE NOTICE '✅ % ⇒ % 列, 與期望逐一相符', p_view, cardinality(v_got);
END $$;

DO $$
BEGIN
  PERFORM fx.assert_view('public.pcm_order_created_email_pending',    ARRAY['CRTPSS','CRTPS2']);
  PERFORM fx.assert_view('public.pcm_unpaid_cancelled_email_pending', ARRAY['CNCPSS']);
  -- 🔴 SHPNBS **不再**在期望裡(20260905040000 之後)—— 它移到 unsendable 那一格。
  PERFORM fx.assert_view('public.pcm_shipped_email_pending',          ARRAY['SHPPSS']);
  -- 🔴🔴 補集那一支:**離開掃描面的單必須出現在這裡** ——
  --    少了這一格, 「不寄」與「消失」印同一個東西, 而 get_shipped_email_gap_counts
  --    的 no_recipient 是從這支數的(`20260831020000:89-90`)。
  PERFORM fx.assert_view('public.pcm_shipped_email_unsendable',       ARRAY['SHPXNR','SHPNBS']);
  PERFORM fx.assert_view('public.pcm_tracking_corrected_email_pending', ARRAY['TRKPSS']);
END $$;

-- ══ 6b. 🔴 四支對【同一個信箱】給同一個答案(⟦b4-SHIPPEDBTRIMNARROW⟧ 的正向釘子)══
--
-- 🛑 上面第 6 節是**每支 view 各自**的集合比對 —— 📌 **四支各自都對, 仍然可以彼此不一致**
--    (2026-09-05 之前就是那個狀態:出貨信那支用裸 `btrim`, 另三支用 JS 版)。
--    ⇒ 🎯 **「每一支都篩對了」與「四支對同一個輸入給同一個答案」是兩個宣稱。**
--
-- 兩格, 各答不同的問題:
--   ① **資料層**:同一個「只有 NBSP」的信箱, 在四支裡都必須【不出現】。
--   ② **定義層**:四支的定義裡都要有 `pcm_js_trim_whitespace`, 且都不許留下裸 btrim 的形式。
--      ⚠️ ② 是字面檢查, 它**擋不住 `OR TRUE`** —— 而那一半由 ① 與第 7/8 節守。
DO $$
DECLARE v text; v_n int; v_def text; v_bad text[] := ARRAY[]::text[];
  c_views text[] := ARRAY['public.pcm_order_created_email_pending',
                          'public.pcm_unpaid_cancelled_email_pending',
                          'public.pcm_shipped_email_pending',
                          'public.pcm_tracking_corrected_email_pending'];
  c_nbsp  text[] := ARRAY['CRTXNR','CNCXNR','SHPNBS','TRKXNR'];
BEGIN
  -- ① 資料層
  FOREACH v IN ARRAY c_views LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE display_id = ANY($1)', v)
      INTO v_n USING c_nbsp;
    IF v_n <> 0 THEN v_bad := v_bad || format('%s 收了 %s 列', v, v_n); END IF;
  END LOOP;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION '❌ 四支一致性(資料層):只有 NBSP 的信箱應該四支都排除, 而 % —— 那一支的空白定義與其餘不同', v_bad;
  END IF;
  -- 🟢 正對照:那四張單真的存在(否則「四支都是 0」與「我打錯了 display_id」印同一個東西)
  SELECT count(*) INTO v_n FROM public.orders WHERE display_id = ANY(c_nbsp);
  IF v_n <> 4 THEN
    RAISE EXCEPTION '四支一致性(正對照):那四張「只有 NBSP」的單只找到 % 張, 期望 4 ⇒ 上面那四個 0 不算數', v_n;
  END IF;
  -- ② 定義層
  FOREACH v IN ARRAY c_views LOOP
    v_def := pg_catalog.pg_get_viewdef(v::regclass, true);
    IF pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 THEN
      RAISE EXCEPTION '❌ 四支一致性(定義層):% 的定義裡沒有 pcm_js_trim_whitespace', v;
    END IF;
    IF pg_catalog.strpos(v_def, 'btrim(o.notification_email)') > 0
       OR pg_catalog.strpos(v_def, 'btrim(c.email)') > 0 THEN
      RAISE EXCEPTION '❌ 四支一致性(定義層):% 裡還留著不帶字元集的 btrim ⇒ 那一處只剝半形空白', v;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 四支一致性(不出現那一半)+ 定義層 4 支';
END $$;

-- 🔵 **反向那一半(「把信箱修好就出現」)在第 8 節的尾巴** ——
--    它要用 `fx.assert_fixup_appears`, 而那支函式在第 8 節才建。
--    📌 **這一格自己就是證據**:第一版我把它寫在這裡, 而 fixture 當場紅
--      `function fx.assert_fixup_appears(text,text,text) does not exist` ⇒ **閘會叫。**

-- ══ 7. 🔴 突變格:把每一支的 WHERE 整段拿掉, 它必須紅 ══════════════════════
--    這一格證的是【上面那四格會動】, 不是【這棵樹乾淨】。
--    🛑 突變體從 `pg_get_viewdef` 當場切出來, **不手抄第二份 SELECT 清單** ——
--       手抄的那份會過期, 而過期的突變體殺不死任何東西卻照樣印綠。
--    🟢 而這個切法自己會自檢:切壞了 ⇒ 列數不會變多 ⇒ 下面那格紅。
CREATE FUNCTION fx.assert_mutation_red(p_view text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_def text; v_pos int; v_real bigint; v_mut bigint;
BEGIN
  v_def := pg_catalog.pg_get_viewdef(p_view::regclass, true);
  v_pos := position(E'\n  WHERE ' in v_def);
  IF v_pos = 0 THEN
    RAISE EXCEPTION '突變格:% 的定義裡找不到 WHERE ⇒ 突變沒落在目標上 ⇒ 這一格不算通過', p_view;
  END IF;
  EXECUTE format('CREATE VIEW fx.mut AS %s', substr(v_def, 1, v_pos));
  EXECUTE format('SELECT count(*) FROM %s', p_view) INTO v_real;
  EXECUTE 'SELECT count(*) FROM fx.mut' INTO v_mut;
  EXECUTE 'DROP VIEW fx.mut';
  IF v_mut <= v_real THEN
    RAISE EXCEPTION '❌ 突變格:% 拿掉整段 WHERE 之後仍是 % 列(原本 % 列)⇒ 那些述詞在本 fixture 上【不承重】⇒ 上面那一格的綠不算數',
      p_view, v_mut, v_real;
  END IF;
  RAISE NOTICE '✅ 突變格 % :WHERE 拿掉後 % ⇒ % 列, 述詞承重', p_view, v_real, v_mut;
END $$;

DO $$
BEGIN
  PERFORM fx.assert_mutation_red('public.pcm_order_created_email_pending');
  PERFORM fx.assert_mutation_red('public.pcm_unpaid_cancelled_email_pending');
  PERFORM fx.assert_mutation_red('public.pcm_shipped_email_pending');
  PERFORM fx.assert_mutation_red('public.pcm_tracking_corrected_email_pending');
END $$;

-- ══ 8. 🔴🔴 逐條述詞:把那一列【缺的那一格補回去】, 它必須出現 ══════════════
--
-- 🛑 **為什麼第 7 節不夠**:那一格是**一次拿掉整段 WHERE**
--    ⇒ 它證的是「這些述詞【合起來】承重」。
--    ⇒ 📌 **其中某一條完全不承重, 那一格照樣印綠** —— 因為別條會把列數壓下來。
--    ⇒ 🎯 **「N 條合起來有效」與「每一條都有效」是兩個宣稱, 而第 7 節只答得出第一個。**
--
-- ✅ 本節的形狀是第 7 節的鏡像:**不動 view, 動資料** ——
--    把那一列唯一缺的那一格補回去, 然後問「它出現了嗎」。
--    ⇒ 沒出現 ⇒ 它是被**別的**述詞擋住的 ⇒ 📌 **我對這列的設計理解是錯的**,
--      而那正是「每一列只差一個維度」這個設計前提被證偽的形狀。
--    ⇒ 出現了 ⇒ **那一條述詞就是攔下它的那一條** ⇒ 它承重。
--
-- 🔵 回滾用 PL/pgSQL 的 `EXCEPTION` 區塊(它自帶一個子交易)——
--    區塊裡改的資料會被丟掉, 而**變數留著**, 所以判定帶得出來。
CREATE FUNCTION fx.assert_fixup_appears(p_view text, p_label text, p_fixup text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_n int; v_ok boolean := false; v_err text;
BEGIN
  BEGIN
    EXECUTE p_fixup;
    EXECUTE format('SELECT count(*) FROM %s WHERE display_id = $1', p_view)
      INTO v_n USING p_label;
    v_ok := (v_n > 0);
    RAISE EXCEPTION 'fx_rollback_sentinel';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'fx_rollback_sentinel' THEN
      v_err := SQLERRM;
      RAISE EXCEPTION '逐條述詞:% 的補救動作自己就失敗了(%)⇒ 這一格【沒有量到任何東西】, 不是通過', p_label, v_err;
    END IF;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '❌ 逐條述詞:把 % 缺的那一格補回去之後, 它【仍然】不在 % 裡 ⇒ 攔下它的是別條述詞 ⇒ 這一列沒有在測我以為它在測的那條',
      p_label, p_view;
  END IF;
  RAISE NOTICE '✅ 逐條述詞 % :補回去就出現 ⇒ 那條述詞承重', p_label;
END $$;

-- 🔵 鏡像:**改了之後它必須【仍然不在】** —— 給「換一種空白字元」那種問題用。
CREATE FUNCTION fx.assert_fixup_absent(p_view text, p_label text, p_fixup text, p_why text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_n int := -1; v_err text;
BEGIN
  BEGIN
    EXECUTE p_fixup;
    EXECUTE format('SELECT count(*) FROM %s WHERE display_id = $1', p_view)
      INTO v_n USING p_label;
    RAISE EXCEPTION 'fx_rollback_sentinel';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'fx_rollback_sentinel' THEN
      v_err := SQLERRM;
      RAISE EXCEPTION '%(% / %):那個動作自己就失敗了(%)⇒ 這一格沒有量到任何東西', p_why, p_view, p_label, v_err;
    END IF;
  END;
  IF v_n < 0 THEN
    RAISE EXCEPTION '%(% / %):計數根本沒被填 ⇒ 這一格沒跑到', p_why, p_view, p_label;
  END IF;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '❌ %:% 出現在 % 裡(% 列)⇒ 那個空白字元沒有被判成空', p_why, p_label, p_view, v_n;
  END IF;
  RAISE NOTICE '✅ % —— % 不在 % 裡', p_why, p_label, p_view;
END $$;

DO $fx$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- A 組
      ('public.pcm_order_created_email_pending','CRTXPY',
       $q$UPDATE public.orders SET payment_status='paid' WHERE display_id='CRTXPY'$q$),
      ('public.pcm_order_created_email_pending','CRTXCN',
       $q$UPDATE public.orders SET cancelled_at=NULL WHERE display_id='CRTXCN'$q$),
      ('public.pcm_order_created_email_pending','CRTXBX',
       $q$DELETE FROM public.email_outbox WHERE dedup_key='CRTXBX-created'$q$),
      ('public.pcm_order_created_email_pending','CRTXNR',
       $q$UPDATE public.customers SET email='fixed@example.com' WHERE user_id='22222222-2222-2222-2222-222222222222'$q$),
      -- B 組
      ('public.pcm_unpaid_cancelled_email_pending','CNCXPD',
       $q$UPDATE public.orders SET payment_status='unpaid' WHERE display_id='CNCXPD'$q$),
      ('public.pcm_unpaid_cancelled_email_pending','CNCXTM',
       $q$INSERT INTO public.order_cancellations(order_id,reason_code,idempotency_key,payload_hash,actor)
          SELECT id,'out_of_stock',gen_random_uuid(),repeat('a',64),'fxstaff' FROM public.orders WHERE display_id='CNCXTM'$q$),
      ('public.pcm_unpaid_cancelled_email_pending','CNCXBX',
       $q$DELETE FROM public.email_outbox WHERE dedup_key='CNCXBX-unpaid'$q$),
      ('public.pcm_unpaid_cancelled_email_pending','CNCXNR',
       $q$UPDATE public.customers SET email='fixed@example.com' WHERE user_id='22222222-2222-2222-2222-222222222222'$q$),
      ('public.pcm_unpaid_cancelled_email_pending','CNCXNC',
       $q$UPDATE public.orders SET cancelled_at=now()-interval '1 hour' WHERE display_id='CNCXNC'$q$),
      -- C 組
      ('public.pcm_shipped_email_pending','SHPXVD',
       $q$UPDATE public.shipments SET deleted_at=NULL, void_reason=NULL WHERE shipment_reference='CCCCCF'$q$),
      ('public.pcm_shipped_email_pending','SHPXNS',
       $q$UPDATE public.shipments SET tracking_number='TRACK-FIX', shipped_at=now() WHERE shipment_reference='CCCCCD'$q$),
      ('public.pcm_shipped_email_pending','SHPXBX',
       $q$DELETE FROM public.email_outbox WHERE event_type='order_shipped'
           AND order_id=(SELECT id FROM public.orders WHERE display_id='SHPXBX')$q$),
      ('public.pcm_shipped_email_pending','SHPXNR',
       $q$UPDATE public.customers SET email='fixed@example.com' WHERE user_id='33333333-3333-3333-3333-333333333333'$q$),
      -- D 組
      ('public.pcm_tracking_corrected_email_pending','TRKXNC',
       $q$UPDATE public.shipments SET tracking_corrected_at=now()-interval '1 hour' WHERE shipment_reference='DDDDDF'$q$),
      ('public.pcm_tracking_corrected_email_pending','TRKXNS',
       $q$UPDATE public.email_outbox SET status='sent', sent_at=now()-interval '90 minute'
          WHERE order_id=(SELECT id FROM public.orders WHERE display_id='TRKXNS')$q$),
      ('public.pcm_tracking_corrected_email_pending','TRKXTM',
       $q$UPDATE public.email_outbox SET sent_at=now()-interval '90 minute'
          WHERE order_id=(SELECT id FROM public.orders WHERE display_id='TRKXTM')$q$),
      ('public.pcm_tracking_corrected_email_pending','TRKXDN',
       $q$DELETE FROM public.email_outbox WHERE event_type='shipment_tracking_corrected'$q$),
      ('public.pcm_tracking_corrected_email_pending','TRKXBT',
       $q$UPDATE public.shipments SET tracking_number='TRACK-FIX' WHERE shipment_reference='DDDDDK'$q$),
      ('public.pcm_tracking_corrected_email_pending','TRKXNR',
       $q$UPDATE public.customers SET email='fixed@example.com' WHERE user_id='22222222-2222-2222-2222-222222222222'$q$)
    ) AS t(v, lbl, fixup)
  LOOP
    PERFORM fx.assert_fixup_appears(r.v, r.lbl, r.fixup);
  END LOOP;
END $fx$;

-- 🔴🔴 **codex 2026-09-05 must-fix:上面那一格只證了「四支都不收它」。**
--    ⇒ 📌 **而「因為信箱是空的所以不收」與「因為別的條件所以不收」印同一個 0。**
--      有人在 pending 上加一條與信箱無關、剛好排除 SHPNBS 的條件 ⇒ 上面那格照樣全綠。
--    ✅ 補反向那一半:**把那個信箱換成一個合法的, 它就必須出現。**
--      這一格與第 8 節共用 `fx.assert_fixup_appears` —— 同一個機制, 換一組受詞。
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.pcm_order_created_email_pending','CRTXNR','22222222-2222-2222-2222-222222222222'),
      ('public.pcm_unpaid_cancelled_email_pending','CNCXNR','22222222-2222-2222-2222-222222222222'),
      ('public.pcm_shipped_email_pending','SHPNBS','22222222-2222-2222-2222-222222222222'),
      ('public.pcm_tracking_corrected_email_pending','TRKXNR','22222222-2222-2222-2222-222222222222')
    ) AS t(v, lbl, uid)
  LOOP
    PERFORM fx.assert_fixup_appears(r.v, r.lbl,
      format($q$UPDATE public.customers SET email='fixed@example.com' WHERE user_id=%L$q$, r.uid));
  END LOOP;
  RAISE NOTICE '✅ 四支一致性(修好就出現那一半):4 支 × 1 標籤';
END $$;

-- ══ 8b. 🔴 U+202F:⟦b4-JSWSNARROWER⟧ 補的那兩個碼位 ═══════════════════════
--
-- 🛑 `pcm_js_trim_whitespace()` 2026-09-05 之前比 JS 的 `trim()` **窄兩個碼位**
--    (U+202F 窄式不斷行空格 / U+205F 中等數學空格)。
--    ⇒ 只含這種字元的信箱:**JS 判空**(永遠不 enqueue)而 **SQL 判非空**(不被排除)
--    ⇒ 📌 **每一輪重撈、永遠不會停 = 永久誤報。**
--
-- 兩格, 而**兩格都必須有**:
--   ① 把那個客人的信箱換成【只有 U+202F】⇒ 四支 view 都必須【仍然不收】
--   ② 換成一個合法信箱 ⇒ 必須【出現】
--   🔴 少了 ② , 第一格與「那一列因為別的條件而不在」印同一個 0。
--   (② 與 6b 的反向那半是同一組斷言, 這裡重跑是因為 ① 動的是【不同的字元】。)
DO $fx$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.pcm_order_created_email_pending','CRTXNR'),
      ('public.pcm_unpaid_cancelled_email_pending','CNCXNR'),
      ('public.pcm_shipped_email_pending','SHPNBS'),
      ('public.pcm_tracking_corrected_email_pending','TRKXNR')
    ) AS t(v, lbl)
  LOOP
    PERFORM fx.assert_fixup_absent(r.v, r.lbl,
      $q$UPDATE public.customers SET email = U&'\202f'
          WHERE user_id='22222222-2222-2222-2222-222222222222'$q$,
      'U+202F 必須被判成空');
  END LOOP;
END $fx$;

-- 🟢 **正對照:那個字元真的被寫進去了。**
--    少了這一格, 一個「UPDATE 沒改到任何列」會讓上面四格印出四個誠實的 0
--    ⇒ 📌 而那四個 0 說的是「NBSP 那一版仍然被判空」, 不是「U+202F 被判空」。
DO $fx$
DECLARE v_len int; v_cp int;
BEGIN
  UPDATE public.customers SET email = U&'\202f'
   WHERE user_id='22222222-2222-2222-2222-222222222222';
  SELECT pg_catalog.length(email), pg_catalog.ascii(email) INTO v_len, v_cp
    FROM public.customers WHERE user_id='22222222-2222-2222-2222-222222222222';
  IF v_len <> 1 OR v_cp <> x'202f'::int THEN
    RAISE EXCEPTION '正對照:那個客人的信箱不是單一個 U+202F(長度 %, 第一個碼位 %)⇒ 上面四格量的不是我以為的東西', v_len, v_cp;
  END IF;
  -- 🔴 而 helper 自己也要答得出來 —— 這一格量的是【函式】, 上面四格量的是【view】。
  IF nullif(pg_catalog.btrim(U&'\202f', public.pcm_js_trim_whitespace()), '') IS NOT NULL THEN
    RAISE EXCEPTION '正對照:pcm_js_trim_whitespace() 剝不掉 U+202F ⇒ 20260905050000 沒貼或被蓋掉';
  END IF;
  IF nullif(pg_catalog.btrim(U&'\205f', public.pcm_js_trim_whitespace()), '') IS NOT NULL THEN
    RAISE EXCEPTION '正對照:pcm_js_trim_whitespace() 剝不掉 U+205F';
  END IF;
  -- 🛑 負向:U+200B 必須【剝不掉】(JS 的 trim() 不剝它)
  IF nullif(pg_catalog.btrim(U&'\200b', public.pcm_js_trim_whitespace()), '') IS NULL THEN
    RAISE EXCEPTION '正對照(負向):U+200B 被剝掉了 ⇒ 與 JS 不一致, 那是永久誤報那個方向';
  END IF;
  RAISE NOTICE '✅ U+202F / U+205F 剝得掉, U+200B 剝不掉(量的是 helper 本身)';
  -- 把信箱換回 NBSP, 不影響後面的分母對帳。
  UPDATE public.customers SET email = U&'\00a0'
   WHERE user_id='22222222-2222-2222-2222-222222222222';
END $fx$;

-- 🔴 分母對帳:上面那張表少一列, 迴圈照樣全綠而沒有東西會叫。
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.orders WHERE display_id ~ 'X';
  IF n <> 19 THEN
    RAISE EXCEPTION '分母對帳:該被排除的單有 % 張, 而逐條述詞那張表只列了 19 列 ⇒ 有述詞沒被單獨驗到', n;
  END IF;
END $$;

-- 🔴 全部回滾 —— 本支只做量測, 不留任何一列。
ROLLBACK;
