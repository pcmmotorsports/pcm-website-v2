-- ci-self-contained: no — 需外部 provision 的庫、psql -f 對 $DSN 手動跑(見檔頭跑法),非 CI 自給自足。
\set ON_ERROR_STOP off
\set QUIET on
\pset pager off
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.mk(p_lines jsonb, p_key uuid, p_fee integer DEFAULT 100)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := public.admin_create_manual_order(
    '11111111-1111-1111-1111-111111111111'::uuid, p_key,
    'probe_alice',
    'manual_phone', 'bank_transfer', 'home',
    '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb,
    -- 🔴 第④代(20260904251500)起 `requested` 是**必填**:缺這個鍵會 RAISE。
    --    ⇒ 本探針要繼續量它本來在量的東西, 就得送它。**不是為了通過, 是為了不換題目。**
    '{"type":"personal","requested":true}'::jsonb, p_fee, p_lines);
  RETURN 'OK ' || r::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'RAISE ' || left(SQLERRM, 60);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.line(sku text, qty integer, price integer, spec jsonb DEFAULT '{}'::jsonb, vid uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'sku', sku, 'title', '品名-'||sku, 'qty', qty, 'unit_price', price,
    'spec', spec, 'variant_id', vid))
$$;

\echo '════ 正面:該過的要過 ════'
SELECT 'P1 建單' AS t, left(pg_temp.mk(jsonb_build_array(pg_temp.line('A1', 2, 500)), 'aaaa0001-0000-0000-0000-000000000001'), 30) AS r;
SELECT 'P1b 金額 server 自算(期望 subtotal=1000 total=1100)' AS t,
       subtotal||'/'||total||' src='||order_source||' ch='||payment_channel AS r
  FROM public.orders WHERE manual_request_id = 'aaaa0001-0000-0000-0000-000000000001';
SELECT 'P2 同鍵同內容重送(期望 idempotent true)' AS t,
       left(pg_temp.mk(jsonb_build_array(pg_temp.line('A1', 2, 500)), 'aaaa0001-0000-0000-0000-000000000001'), 90) AS r;
SELECT 'P2b 只有一張單(期望 1)' AS t, count(*)::text AS r
  FROM public.orders WHERE manual_request_id = 'aaaa0001-0000-0000-0000-000000000001';
SELECT 'P3 邊界 50 筆(期望 OK)' AS t, left(pg_temp.mk(
  (SELECT jsonb_agg(pg_temp.line('S'||g, 1, 10)) FROM generate_series(1,50) g),
  'aaaa0002-0000-0000-0000-000000000001'), 12) AS r;
SELECT 'P4 邊界 qty 9999(期望 OK)' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('Q1', 9999, 1)), 'aaaa0003-0000-0000-0000-000000000001'), 12) AS r;
SELECT 'P5 兩個代購品項、sku 不同(期望 OK)' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('C1',1,100), pg_temp.line('C2',1,100)), 'aaaa0004-0000-0000-0000-000000000001'), 12) AS r;
SELECT 'P6 spec 全字串(期望 OK)' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('SP',1,100,'{"顏色":"黑","尺寸":"L"}'::jsonb)), 'aaaa0005-0000-0000-0000-000000000001'), 12) AS r;

\echo ''
\echo '════ 負面:該紅的要紅(每一條對應 codex 一格)════'
SELECT 'N1 :143 同鍵不同內容' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('A1', 3, 500)), 'aaaa0001-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N1b :143 同鍵、只有運費不同' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('A1', 2, 500)), 'aaaa0001-0000-0000-0000-000000000001', 200), 70) AS r;
SELECT 'N2 :138 51 筆' AS t, left(pg_temp.mk(
  (SELECT jsonb_agg(pg_temp.line('T'||g, 1, 10)) FROM generate_series(1,51) g),
  'bbbb0001-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N3 :138 qty 10000' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('Q2', 10000, 1)), 'bbbb0002-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N3b :138 qty=2147483647 配 0 元(舊版穿得過去)' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('Q3', 2147483647, 0)), 'bbbb0003-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N4 :186 同 variant_id 兩列' AS t, left(pg_temp.mk(
  jsonb_build_array(
    pg_temp.line('V1',1,100,'{}'::jsonb,'22222222-2222-2222-2222-222222222222'),
    pg_temp.line('V2',1,100,'{}'::jsonb,'22222222-2222-2222-2222-222222222222')),
  'bbbb0004-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N5 :186 代購品 sku+品名都一樣' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('C9',1,100), pg_temp.line('C9',1,100)),
  'bbbb0005-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N6 :203 spec 值是數字' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('SP2',1,100,'{"重量":12}'::jsonb)),
  'bbbb0006-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N7 :203 spec 有 cost 鍵' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('SP3',1,100,'{"cost":"900"}'::jsonb)),
  'bbbb0007-0000-0000-0000-000000000001'), 70) AS r;
SELECT 'N7b :203 spec 有 price_by_tier 鍵' AS t, left(pg_temp.mk(
  jsonb_build_array(pg_temp.line('SP4',1,100,'{"price_by_tier":"5"}'::jsonb)),
  'bbbb0008-0000-0000-0000-000000000001'), 70) AS r;

\echo ''
\echo '════ 收斂:失敗的那些一列都不准留 ════'
SELECT 'X1 bbbb* 那些鍵應該零張單(期望 0)' AS t, count(*)::text AS r
  FROM public.orders WHERE manual_request_id::text LIKE 'bbbb%';
SELECT 'X2 anon 不得 EXECUTE(期望 f)' AS t,
       has_function_privilege('anon',
         'public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb)', 'EXECUTE')::text AS r;
SELECT 'X3 service_role 要有 EXECUTE(期望 t)' AS t,
       has_function_privilege('service_role',
         'public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb)', 'EXECUTE')::text AS r;
