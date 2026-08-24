\set QUIET on
\pset pager off
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.mk2(p_lines jsonb, p_key uuid, p_invoice jsonb DEFAULT '{"type":"personal"}'::jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb; v_state text; v_con text;
BEGIN
  r := public.admin_create_manual_order(
    '11111111-1111-1111-1111-111111111111'::uuid, p_key,
    'probe_alice',
    'manual_phone', 'bank_transfer', 'home',
    '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
    p_invoice, 100, p_lines);
  RETURN CASE WHEN (r->>'idempotent')::boolean THEN 'IDEMPOTENT' ELSE 'NEW' END || ' ' || (r->>'display_id');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  RETURN 'RAISE[' || v_state || '/' || COALESCE(v_con,'-') || '] ' || left(SQLERRM, 28);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ln(sku text, qty integer, price integer, title text DEFAULT NULL, spec jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('sku', sku, 'title', COALESCE(title,'品名-'||sku),
                            'qty', qty, 'unit_price', price, 'spec', spec)
$$;

\echo '════ R2-N1 指紋穩定性(這三格上一版全部會誤拒)════'
SELECT 'R2-1 建基準單(兩個品項)' AS t,
  pg_temp.mk2(jsonb_build_array(pg_temp.ln('X1',1,100), pg_temp.ln('X2',2,200)), 'dddd0001-0000-0000-0000-000000000001') AS r;
SELECT 'R2-1a 同鍵、品項【換順序】(期望 IDEMPOTENT)' AS t,
  pg_temp.mk2(jsonb_build_array(pg_temp.ln('X2',2,200), pg_temp.ln('X1',1,100)), 'dddd0001-0000-0000-0000-000000000001') AS r;
SELECT 'R2-1b 同鍵、發票載具多空白(期望 IDEMPOTENT)' AS t,
  pg_temp.mk2(jsonb_build_array(pg_temp.ln('X1',1,100), pg_temp.ln('X2',2,200)), 'dddd0001-0000-0000-0000-000000000001',
              '{"type":"personal","carrier":"   "}'::jsonb) AS r;
SELECT 'R2-1c 同鍵、品名前後多空白(期望 IDEMPOTENT)' AS t,
  pg_temp.mk2(jsonb_build_array(pg_temp.ln('X1',1,100,'  品名-X1  '), pg_temp.ln('X2',2,200)), 'dddd0001-0000-0000-0000-000000000001') AS r;
SELECT 'R2-1d 同鍵、規格值多空白(先建帶規格的基準)' AS t,
  pg_temp.mk2(jsonb_build_array(pg_temp.ln('Y1',1,100,NULL,'{"顏色":"黑"}'::jsonb)), 'dddd0002-0000-0000-0000-000000000001') AS r;
SELECT 'R2-1e 同鍵、規格值變成 " 黑 "(期望 IDEMPOTENT)' AS t,
  pg_temp.mk2(jsonb_build_array(pg_temp.ln('Y1',1,100,NULL,'{"顏色":" 黑 "}'::jsonb)), 'dddd0002-0000-0000-0000-000000000001') AS r;
SELECT 'R2-1f 同鍵、真的改了數量(期望 RAISE P858B)' AS t,
  pg_temp.mk2(jsonb_build_array(pg_temp.ln('X1',9,100), pg_temp.ln('X2',2,200)), 'dddd0001-0000-0000-0000-000000000001') AS r;

\echo ''
\echo '════ R2-N3 代購等價鍵:變寬(不誤拒)+ 變嚴(不繞過)════'
SELECT 'R2-3a 同料號同品名、【規格不同】(期望 NEW)' AS t,
  pg_temp.mk2(jsonb_build_array(
    pg_temp.ln('K1',1,100,'煞車皮','{"位置":"前"}'::jsonb),
    pg_temp.ln('K1',1,100,'煞車皮','{"位置":"後"}'::jsonb)), 'dddd0003-0000-0000-0000-000000000001') AS r;
SELECT 'R2-3b 同料號同品名、【單價不同】(期望 NEW)' AS t,
  pg_temp.mk2(jsonb_build_array(
    pg_temp.ln('K2',1,100,'機油'), pg_temp.ln('K2',1,250,'機油')), 'dddd0004-0000-0000-0000-000000000001') AS r;
SELECT 'R2-3c 同料號、品名中間多一個空白(期望 RAISE 重複品項)' AS t,
  pg_temp.mk2(jsonb_build_array(
    pg_temp.ln('K3',1,100,'煞車 皮'), pg_temp.ln('K3',1,100,'煞車  皮')), 'dddd0005-0000-0000-0000-000000000001') AS r;

\echo ''
\echo '════ nit A:兩欄同生共死 CHECK(直接繞過 RPC 寫)════'
DO $$ BEGIN
  BEGIN
    INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
      subtotal, shipping_fee, discount_total, total, shipping_method, invoice, manual_request_id)
    VALUES (public.pcm_generate_display_id(), '11111111-1111-1111-1111-111111111111',
      '{"name":"毒","phone":"0912000111","line":"毒化路"}'::jsonb, 'general',
      1,0,0,1,'home','{"type":"personal"}'::jsonb, 'eeee0001-0000-0000-0000-000000000001');
    RAISE WARNING 'nitA-1 有鍵無指紋 ⇒ 🔴 竟然寫進去了';
  EXCEPTION WHEN check_violation THEN RAISE WARNING 'nitA-1 有鍵無指紋 ⇒ ✅ 被 CHECK 擋下';
  END;
  BEGIN
    INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
      subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
      manual_request_id, manual_request_payload_sha256)
    VALUES (public.pcm_generate_display_id(), '11111111-1111-1111-1111-111111111111',
      '{"name":"毒","phone":"0912000111","line":"毒化路"}'::jsonb, 'general',
      1,0,0,1,'home','{"type":"personal"}'::jsonb, 'eeee0002-0000-0000-0000-000000000001', 'not-a-sha');
    RAISE WARNING 'nitA-2 指紋不是 64 碼 hex ⇒ 🔴 竟然寫進去了';
  EXCEPTION WHEN check_violation THEN RAISE WARNING 'nitA-2 指紋不是 64 碼 hex ⇒ ✅ 被 CHECK 擋下';
  END;
END $$;

\echo ''
\echo '════ nit B:我修正的那句話,要【量到】不是宣稱 ════'
DO $$
DECLARE v_n integer;
BEGIN
  CREATE TEMP TABLE nulltest (id integer, k uuid);
  CREATE UNIQUE INDEX nulltest_plain_uniq ON nulltest (k);
  INSERT INTO nulltest VALUES (1, NULL), (2, NULL), (3, NULL);
  SELECT count(*) INTO v_n FROM nulltest WHERE k IS NULL;
  RAISE WARNING '普通 UNIQUE 塞了 % 列 NULL ⇒ 多筆 NULL【不會】互撞(我原本寫的那句是錯的)', v_n;
  BEGIN
    INSERT INTO nulltest VALUES (4, 'ffff0001-0000-0000-0000-000000000001'), (5, 'ffff0001-0000-0000-0000-000000000001');
    RAISE WARNING '🔴 對照組失敗:非 NULL 重複竟然塞得進去 ⇒ 這把尺是死的';
  EXCEPTION WHEN unique_violation THEN RAISE WARNING '對照組 ✅:非 NULL 重複【會】撞 ⇒ 索引是活的、上面那個 3 有判別力';
  END;
END $$;

\echo ''
\echo '════ F1(R3):稽核落列 —— 這張單記不記得住是誰建的 ════'
CREATE OR REPLACE FUNCTION pg_temp.mk3(p_key uuid, p_actor text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb; v_state text;
BEGIN
  r := public.admin_create_manual_order(
    '11111111-1111-1111-1111-111111111111'::uuid, p_key, p_actor,
    'manual_phone','bank_transfer','home',
    '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
    '{"type":"personal"}'::jsonb, 100,
    '[{"sku":"F1","title":"稽核測試品","qty":1,"unit_price":100,"spec":{}}]'::jsonb);
  RETURN CASE WHEN (r->>'idempotent')::boolean THEN 'IDEMPOTENT' ELSE 'NEW' END || ' ' || (r->>'display_id');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  RETURN 'RAISE[' || v_state || '] ' || left(SQLERRM, 34);
END $$;

SELECT 'F1-1 正常建單(期望 NEW)' AS t, pg_temp.mk3('f1110001-0000-0000-0000-000000000001','probe_alice') AS r;
SELECT 'F1-1b 稽核恰 1 列、內容對得上(期望 t)' AS t,
  (count(*) = 1 AND bool_and(actor='probe_alice' AND action='order.manual_create'
     AND target LIKE 'order:%' AND before IS NULL
     AND (after->>'order_source')='manual_phone' AND (after->>'item_count')='1'))::text AS r
  FROM public.admin_audit_log WHERE request_id = 'f1110001-0000-0000-0000-000000000001';
SELECT 'F1-2 actor 是空白(期望 RAISE)' AS t, pg_temp.mk3('f1110002-0000-0000-0000-000000000001','   ') AS r;
SELECT 'F1-3 actor 查無此人(期望 RAISE)' AS t, pg_temp.mk3('f1110003-0000-0000-0000-000000000001','nobody_here') AS r;
SELECT 'F1-4 actor 是【已停用】的員工(期望 RAISE)' AS t, pg_temp.mk3('f1110004-0000-0000-0000-000000000001','probe_bob_off') AS r;
SELECT 'F1-5 同鍵同內容重送(期望 IDEMPOTENT)' AS t, pg_temp.mk3('f1110001-0000-0000-0000-000000000001','probe_alice') AS r;
SELECT 'F1-5b 重送【不】再落一列稽核(期望 1)' AS t, count(*)::text AS r
  FROM public.admin_audit_log WHERE request_id = 'f1110001-0000-0000-0000-000000000001';
SELECT 'F1-6 同鍵、換一位【在職】同事重送同內容(期望 IDEMPOTENT 不是 P858B)' AS t,
  pg_temp.mk3('f1110001-0000-0000-0000-000000000001','probe_carol') AS r;
SELECT 'F1-6b 換人重送後,稽核仍恰 1 列且 actor 還是原本那位(期望 t|probe_alice)' AS t,
  (count(*) = 1)::text || '|' || COALESCE(max(actor),'-') AS r
  FROM public.admin_audit_log WHERE request_id = 'f1110001-0000-0000-0000-000000000001';
SELECT 'F1-7 被拒的那些鍵零稽核列(期望 0)' AS t, count(*)::text AS r
  FROM public.admin_audit_log WHERE request_id LIKE 'f11100%' AND request_id <> 'f1110001-0000-0000-0000-000000000001';
