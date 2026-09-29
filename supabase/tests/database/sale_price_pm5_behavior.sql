-- 商品頁乙 P-M5(20260929050000)行為測試:沒帶核對單價就拒絕(P2C22);經銷一般價空的兩道檢查。
-- 用法:拋棄式 PG(public 結構 = 正式庫唯讀 pg_dump,套到 20260929050000)上跑:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/database/sale_price_pm5_behavior.sql
--   全過印「✅ P-M5 行為測試全部通過」;任一格不對會 RAISE「❌ …」停下。
--   負對照:在只套到 P-M4(20260928230000)的庫上跑,第一格「沒帶 ⇒ P2C22」就會紅(那一代沒帶照樣建單)。
-- 整支包在一個 BEGIN … ROLLBACK 裡,先套 b2b_d1_fixture.sql 的虛構資料。絕不在正式庫跑(會建訂單)。
-- 🔵 sale_price_pm4_behavior.sql 有幾格「沒帶核對值 ⇒ 建單」,在套了 P-M5 的庫上會紅 —— 那支測的是 P-M4 那一代的狀態,不改它。
-- 計畫:~/pcm-mailbox/計畫-P-M5-沒帶核對單價就拒絕-20260929.md 第 5 節、第 8 節第 3 點。

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

BEGIN;
INSERT INTO public.staff(id, label, is_manager, is_active) VALUES ('boss', '測試主管', true, true) ON CONFLICT (id) DO NOTHING;
\ir b2b_d1_fixture.sql

CREATE FUNCTION pg_temp.eq(label text, got text, want text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '❌ % 得到 % 期望 %', label, got, want; END IF;
  RETURN '✓ ' || label || ' = ' || coalesce(got, 'NULL');
END $$;
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.gv(v text) RETURNS text LANGUAGE sql AS $$ SELECT amount::text FROM public.get_effective_prices(NULL, ARRAY[v::uuid]) $$;
CREATE FUNCTION pg_temp.gp(p text) RETURNS text LANGUAGE sql AS $$ SELECT amount::text FROM public.get_effective_prices(ARRAY[p::uuid], NULL) $$;
-- 建單:成功回 'OK|第一行單價',失敗回 SQLSTATE 加錯誤訊息(子交易回滾 ⇒ 失敗時不留任何列)
CREATE FUNCTION pg_temp.try_ord(lines text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := public.create_order(lines::jsonb,
    (SELECT id FROM public.customer_addresses WHERE customer_user_id = auth.uid()), 'home', '{"type":"personal"}'::jsonb,
    gen_random_uuid(), 't1', '127.0.0.1', 'probe', 'bank_transfer', NULL, NULL);
  RETURN 'OK|' || (SELECT unit_price FROM public.order_items WHERE order_id = (r->>'order_id')::uuid ORDER BY unit_price DESC LIMIT 1);
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
-- 錯誤的 DETAIL(前台靠 SQLSTATE 分流;這裡順便釘 DETAIL 字面)
CREATE FUNCTION pg_temp.detail_of(lines text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE d text;
BEGIN
  PERFORM public.create_order(lines::jsonb,
    (SELECT id FROM public.customer_addresses WHERE customer_user_id = auth.uid()), 'home', '{"type":"personal"}'::jsonb,
    gen_random_uuid(), 't1', '127.0.0.1', 'probe', 'bank_transfer', NULL, NULL);
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
  RETURN d;
END $$;
CREATE FUNCTION pg_temp.n() RETURNS text LANGUAGE sql AS $$ SELECT (SELECT count(*) FROM public.orders)::text || '/' || (SELECT count(*) FROM public.order_items)::text $$;

-- 一件像 DBK CC02 的商品:兩個規格(8A 8400/8000、8E 4300/4000)
INSERT INTO public.products(id,external_id,title,handle,price_by_tier,price_general,brand_id,category_id,delisted_at) VALUES
 ('11111111-0000-4000-8000-000000000008','e8','P8 兩個規格','p8',pg_temp.pbt(8400,8000),8400,'aaaaaaaa-0000-4000-8000-00000000000b','cccccccc-0000-4000-8000-000000000001',NULL);
INSERT INTO public.product_variants(id,product_id,sku,price_general,price_store,supplier_slug,spec) VALUES
 ('22222222-0000-4000-8000-00000000008a','11111111-0000-4000-8000-000000000008','P8-A',8400,8000,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-00000000008e','11111111-0000-4000-8000-000000000008','P8-E',4300,4000,'rpm','{"c":"E"}'::jsonb);

-- ══ ① 一般會員:沒帶核對單價 ⇒ P2C22,不建單 ══
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000f');
SELECT set_config('t.n0', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.eq('沒帶 ⇒ P2C22', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]'), ' ', 1), 'P2C22');
SELECT pg_temp.eq('沒帶 DETAIL = price_unconfirmed', pg_temp.detail_of('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]'), 'price_unconfirmed');
SELECT pg_temp.eq('JSON null ⇒ P2C22', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":null}]'), ' ', 1), 'P2C22');
SELECT pg_temp.eq('第一行有帶、第二行沒帶 ⇒ 整張 P2C22', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":1100},{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1}]'), ' ', 1), 'P2C22');
SELECT pg_temp.eq('被拒的零新增', pg_temp.n(), current_setting('t.n0'));
-- 對照組:行為不變的幾格
SELECT pg_temp.eq('帶對的 ⇒ 建單', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":1100}]'), 'OK|1100');
SELECT pg_temp.eq('0 元贈品帶 0 ⇒ 建單(0 不算沒帶)', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":1100},{"variant_id":"22222222-0000-4000-8000-000000000006","qty":1,"expected_unit_price":0}]'), '|', 1), 'OK');
SELECT pg_temp.eq('帶錯的 ⇒ 仍是 P2C21', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":999}]'), ' ', 1), 'P2C21');
SELECT pg_temp.eq('格式不對 ⇒ 仍是格式錯誤(不是 P2C22)', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":"1100"}]') LIKE '%expected_unit_price 格式不對%')::text, 'true');
RESET ROLE;

-- ══ ② 經銷會員:沒帶也拒;帶經銷價照常 ══
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000d');
SELECT pg_temp.eq('經銷 沒帶 ⇒ P2C22', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1}]'), ' ', 1), 'P2C22');
SELECT pg_temp.eq('經銷 帶經銷價 ⇒ 建單(對照組)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":1141}]'), 'OK|1141');
RESET ROLE;

-- ══ ③ 經銷:規格一般價空、經銷價有值 ⇒ 查價 NULL、建單拒絕 ══
UPDATE public.product_variants SET price_general = NULL WHERE id = '22222222-0000-4000-8000-00000000008e';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000d');
SELECT set_config('t.p8a_dealer', pg_temp.gv('22222222-0000-4000-8000-00000000008a'), true) IS NOT NULL;
SELECT pg_temp.eq('經銷 一般價空的規格 查價 NULL', pg_temp.gv('22222222-0000-4000-8000-00000000008e'), NULL);
SELECT pg_temp.eq('經銷 一般價有的規格 查價照常(不是 NULL)', (pg_temp.gv('22222222-0000-4000-8000-00000000008a') IS NOT NULL)::text, 'true');
-- 混合情況(計畫第 8 節第 3 點):商品層回 A 款的經銷價,不是 NULL,也不是 E 款的
SELECT pg_temp.eq('經銷 混合 商品層 = A 款經銷價', pg_temp.gp('11111111-0000-4000-8000-000000000008'), current_setting('t.p8a_dealer'));
SELECT set_config('t.n1', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.eq('經銷 一般價空的規格 建單 ⇒ 變體無有效單價', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000008e","qty":1,"expected_unit_price":3760}]') LIKE '%變體無有效單價%')::text, 'true');
SELECT pg_temp.eq('經銷 被拒的零新增', pg_temp.n(), current_setting('t.n1'));
SELECT pg_temp.eq('經銷 一般價有的規格 建單照常(對照組)', split_part(pg_temp.try_ord(format('[{"variant_id":"22222222-0000-4000-8000-00000000008a","qty":1,"expected_unit_price":%s}]', current_setting('t.p8a_dealer'))), '|', 1), 'OK');
RESET ROLE;

-- ══ ④ 經銷:商品所有規格一般價全空 ⇒ 商品層 NULL ══
UPDATE public.product_variants SET price_general = NULL WHERE id = '22222222-0000-4000-8000-00000000008a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000d');
SELECT pg_temp.eq('經銷 規格一般價全空 商品層 NULL', pg_temp.gp('11111111-0000-4000-8000-000000000008'), NULL);
-- 一般會員:和 P-M4 一樣(全空 ⇒ NULL),本檔不改一般會員那一半(回歸)
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000f');
SELECT pg_temp.eq('一般 規格一般價全空 商品層 NULL(P-M4 行為不變)', pg_temp.gp('11111111-0000-4000-8000-000000000008'), NULL);
SELECT pg_temp.eq('一般 別的商品查價不變(回歸)', pg_temp.gp('11111111-0000-4000-8000-000000000001'), '1100');
RESET ROLE;

ROLLBACK;
SELECT '✅ P-M5 行為測試全部通過';
