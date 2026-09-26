-- 退貨第 1 片(20260927010000):拋棄式 PG 行為測試(整份包在交易裡, 最後 ROLLBACK)
-- 🔴 只對拋棄式 PG 跑, 不要對正式庫跑(它會建假客人、假訂單, 雖然最後 ROLLBACK)。
-- 跑法:bash scripts/migrations-replay-from-zero.sh --keep-db ⇒ 照它印的 psql -h /tmp -p <port> ... -f 本檔
--   最後一行印 ALL-RETURNS-TESTS-PASSED 才算過;任何一格失敗會在那一格停下。
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA rt;

CREATE FUNCTION rt.expect_error(p_sql text, p_needle text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_needle in SQLERRM) = 0 THEN
      RAISE EXCEPTION '期望錯誤含「%」, 實得:%', p_needle, SQLERRM;
    END IF;
    RAISE NOTICE 'OK 擋下:%', left(SQLERRM, 80);
    RETURN;
  END;
  RAISE EXCEPTION '期望被擋(%), 卻成功了:%', p_needle, p_sql;
END $$;

INSERT INTO auth.users(id, email) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'rt@example.com');
INSERT INTO public.staff(id, label) VALUES ('rtstaff', '退貨測試員') ON CONFLICT DO NOTHING;
INSERT INTO public.suppliers(id, label) VALUES ('aaaaaaaa-0000-0000-0000-00000000000f', '退貨測試供應商');

CREATE TABLE rt.ids (k text PRIMARY KEY, v uuid);

DO $$
DECLARE v_order uuid; v_item uuid; v_proc uuid; v_ship uuid;
BEGIN
  INSERT INTO public.orders(display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
    payment_status, subtotal, shipping_fee, total, shipping_method, invoice, shipping_method_at_checkout, notification_email)
  VALUES ('PCM-2026-9901', 'aaaaaaaa-0000-0000-0000-000000000001', '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, 'general',
    'paid'::payment_status, 3000, 0, 3000, 'home', '{"type":"personal"}'::jsonb, 'home', 'rt@example.com')
  RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'SKU-RT', '{"title":"退貨測試品","sku":"SKU-RT","spec":{"尺寸":"標準"}}'::jsonb, 3, 1000, 3000)
  RETURNING id INTO v_item;
  INSERT INTO public.order_item_quantity_summary(order_item_id, quantity, ordered_quantity) VALUES (v_item, 3, 3);
  INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity)
  VALUES (v_item, 'aaaaaaaa-0000-0000-0000-00000000000f', 3) RETURNING id INTO v_proc;
  INSERT INTO public.order_item_procurement_receipts(procurement_id, quantity, received_at, received_by)
  VALUES (v_proc, 3, now() - interval '1 day', 'rtstaff');
  INSERT INTO public.shipments(shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES ('RTRTRT', 'aaaaaaaa-0000-0000-0000-000000000001', '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, 'hct')
  RETURNING id INTO v_ship;
  INSERT INTO public.shipment_items(shipment_id, order_item_id, shipped_quantity) VALUES (v_ship, v_item, 2);
  UPDATE public.shipments SET tracking_number = '1234567890', shipped_at = now() - interval '3 hour' WHERE id = v_ship;
  INSERT INTO rt.ids VALUES ('order', v_order), ('item', v_item), ('ship', v_ship);
  IF (SELECT shipped_quantity FROM public.order_item_quantity_summary WHERE order_item_id = v_item) <> 2 THEN
    RAISE EXCEPTION '前置:已出貨數量應為 2, 實得 %', (SELECT shipped_quantity FROM public.order_item_quantity_summary WHERE order_item_id = v_item);
  END IF;
  RAISE NOTICE '前置 OK:訂購 3、已出貨 2';
END $$;

CREATE FUNCTION rt.items(q int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('order_item_id', (SELECT v FROM rt.ids WHERE k='item')::text, 'quantity', q)) $$;
CREATE FUNCTION rt.recv(q int, cond text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('order_item_id', (SELECT v FROM rt.ids WHERE k='item')::text,
                                              'received_quantity', q, 'condition', to_jsonb(cond))) $$;
CREATE FUNCTION rt.reg(k uuid, q int, reason text DEFAULT 'defective', detail text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_register_return((SELECT v FROM rt.ids WHERE k='order'), k, 'rtstaff', reason, detail, NULL, NULL, rt.items(q)) $$;

DO $$
DECLARE r jsonb; r2 jsonb; v_ret1 uuid; v_ret2 uuid;
BEGIN
  -- ① 超過已出貨
  PERFORM rt.expect_error($q$SELECT rt.reg('bbbbbbbb-0000-0000-0000-000000000001', 3)$q$, '超過可退數量');
  -- ② 原因「其他」沒填說明
  PERFORM rt.expect_error($q$SELECT rt.reg('bbbbbbbb-0000-0000-0000-000000000002', 1, 'other', '  ')$q$, '請填寫說明');
  -- ③ 正常登記 2 件, 重送同一把鑰匙回同一筆
  r := rt.reg('bbbbbbbb-0000-0000-0000-000000000003', 2);
  r2 := rt.reg('bbbbbbbb-0000-0000-0000-000000000003', 2);
  IF (r->>'idempotent')::boolean OR NOT (r2->>'idempotent')::boolean OR r->>'return_id' <> r2->>'return_id' THEN
    RAISE EXCEPTION '③ 冪等不對:% / %', r, r2;
  END IF;
  v_ret1 := (r->>'return_id')::uuid;
  IF (SELECT count(*) FROM public.order_returns) <> 1 THEN RAISE EXCEPTION '③ 重送多建了一筆'; END IF;
  RAISE NOTICE 'OK ③ 登記 2 件 + 重送回同一筆';
  -- ④ 同一把鑰匙換內容
  PERFORM rt.expect_error($q$SELECT rt.reg('bbbbbbbb-0000-0000-0000-000000000003', 1)$q$, '登記退貨失敗');
  -- ⑤ 已占滿(出貨 2、登記 2)再登記 1
  PERFORM rt.expect_error($q$SELECT rt.reg('bbbbbbbb-0000-0000-0000-000000000005', 1)$q$, '超過可退數量');
  -- ⑥ 收到:全部 0 件 / 有收到沒選狀況 / 實收多於登記
  PERFORM rt.expect_error(format($q$SELECT public.admin_receive_return(%L, 'cccccccc-0000-0000-0000-000000000001', 'rtstaff', rt.recv(0, NULL), NULL)$q$, v_ret1), '所有品項都是 0 件');
  PERFORM rt.expect_error(format($q$SELECT public.admin_receive_return(%L, 'cccccccc-0000-0000-0000-000000000001', 'rtstaff', rt.recv(1, NULL), NULL)$q$, v_ret1), '請選擇商品狀況');
  PERFORM rt.expect_error(format($q$SELECT public.admin_receive_return(%L, 'cccccccc-0000-0000-0000-000000000001', 'rtstaff', rt.recv(3, 'good'), NULL)$q$, v_ret1), '實收數量不能多於');
  -- ⑦ 實收 1 件(良好), 重送同一個 request_id 不出錯
  r := public.admin_receive_return(v_ret1, 'cccccccc-0000-0000-0000-000000000002', 'rtstaff', rt.recv(1, 'good'), '盒子有壓痕');
  r2 := public.admin_receive_return(v_ret1, 'cccccccc-0000-0000-0000-000000000002', 'rtstaff', rt.recv(1, 'good'), '盒子有壓痕');
  IF (r->>'idempotent')::boolean OR NOT (r2->>'idempotent')::boolean THEN RAISE EXCEPTION '⑦ 冪等不對:% / %', r, r2; END IF;
  IF (SELECT status FROM public.order_returns WHERE id = v_ret1) <> 'received' THEN RAISE EXCEPTION '⑦ 狀態沒變 received'; END IF;
  RAISE NOTICE 'OK ⑦ 實收 1 件 + 重送不出錯';
  -- ⑧ 換一個 request_id 再確認一次 ⇒ 擋
  PERFORM rt.expect_error(format($q$SELECT public.admin_receive_return(%L, 'cccccccc-0000-0000-0000-000000000003', 'rtstaff', rt.recv(1, 'good'), NULL)$q$, v_ret1), '已經確認收到過了');
  -- ⑨ 實收 1 ⇒ 占用降為 1 ⇒ 可以再登記 1 件, 但不能登記 2 件
  PERFORM rt.expect_error($q$SELECT rt.reg('bbbbbbbb-0000-0000-0000-000000000009', 2)$q$, '超過可退數量');
  v_ret2 := (rt.reg('bbbbbbbb-0000-0000-0000-00000000000a', 1)->>'return_id')::uuid;
  RAISE NOTICE 'OK ⑨ 實收少於登記 ⇒ 釋出的數量可以再登記';
  -- ⑩ 已收回的不能作廢;作廢要填原因;作廢 + 重送
  PERFORM rt.expect_error(format($q$SELECT public.admin_void_return(%L, 'dddddddd-0000-0000-0000-000000000001', 'rtstaff', '登記錯了')$q$, v_ret1), '不能作廢');
  PERFORM rt.expect_error(format($q$SELECT public.admin_void_return(%L, 'dddddddd-0000-0000-0000-000000000002', 'rtstaff', ' ')$q$, v_ret2), '請填寫作廢原因');
  r := public.admin_void_return(v_ret2, 'dddddddd-0000-0000-0000-000000000003', 'rtstaff', '客人沒寄回');
  r2 := public.admin_void_return(v_ret2, 'dddddddd-0000-0000-0000-000000000003', 'rtstaff', '客人沒寄回');
  IF (r->>'idempotent')::boolean OR NOT (r2->>'idempotent')::boolean THEN RAISE EXCEPTION '⑩ 冪等不對:% / %', r, r2; END IF;
  PERFORM rt.expect_error(format($q$SELECT public.admin_receive_return(%L, 'cccccccc-0000-0000-0000-000000000004', 'rtstaff', rt.recv(1, 'good'), NULL)$q$, v_ret2), '已作廢');
  RAISE NOTICE 'OK ⑩ 作廢規則';
  -- ⑪ 作廢出貨之後, 已出貨變 0 ⇒ 任何數量都登記不了
  UPDATE public.shipments SET deleted_at = now(), void_reason = '測試作廢' WHERE id = (SELECT v FROM rt.ids WHERE k='ship');
  PERFORM rt.expect_error($q$SELECT rt.reg('bbbbbbbb-0000-0000-0000-00000000000b', 1)$q$, '超過可退數量');
  -- ⑫ 操作紀錄:登記 2(一筆重送不重記)、收到 1、作廢 1
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'order.return.register') <> 2
     OR (SELECT count(*) FROM public.admin_audit_log WHERE action = 'order.return.receive') <> 1
     OR (SELECT count(*) FROM public.admin_audit_log WHERE action = 'order.return.void') <> 1 THEN
    RAISE EXCEPTION '⑫ 操作紀錄筆數不對';
  END IF;
  RAISE NOTICE 'OK ⑫ 操作紀錄筆數';
END $$;

-- ⑬ 權限:anon / authenticated 叫不動函式、讀不到表(測試工具本身要開給這三個角色)
GRANT USAGE ON SCHEMA rt TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION rt.expect_error(text, text) TO anon, authenticated, service_role;
SET ROLE anon;
SELECT rt.expect_error($q$SELECT public.admin_void_return(gen_random_uuid(), gen_random_uuid(), 'x', 'y')$q$, 'permission denied');
SELECT rt.expect_error($q$SELECT 1 FROM public.order_returns$q$, 'permission denied');
RESET ROLE;
SET ROLE authenticated;
SELECT rt.expect_error($q$SELECT public.admin_register_return(gen_random_uuid(), gen_random_uuid(), 'x', 'other', 'x', NULL, NULL, '[]'::jsonb)$q$, 'permission denied');
SELECT rt.expect_error($q$SELECT 1 FROM public.order_return_items$q$, 'permission denied');
RESET ROLE;
SET ROLE service_role;
SELECT rt.expect_error($q$INSERT INTO public.order_returns(order_id, reason_code, registered_by, idempotency_key, payload_hash) VALUES (gen_random_uuid(), 'other', 'x', gen_random_uuid(), 'x')$q$, 'permission denied');
SELECT count(*) AS service_role_can_read FROM public.order_returns;
RESET ROLE;

\echo ALL-RETURNS-TESTS-PASSED
ROLLBACK;
