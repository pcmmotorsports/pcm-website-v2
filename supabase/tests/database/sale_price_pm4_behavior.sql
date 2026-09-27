-- 商品頁乙 P10(P-M4,20260928230000)行為測試:特價生效後,顯示、查價、建單都用「實際一般價」,下單時核對單價。
-- 用法:拋棄式 PG(public 結構 = 正式庫唯讀 pg_dump,套到 20260928230000)上跑:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/database/sale_price_pm4_behavior.sql
--   全過印「✅ P-M4 行為測試全部通過」;任一格不對會 RAISE「❌ …」停下。在沒貼 P-M4 的庫上跑,第一格就會紅(負對照)。
-- 整支包在一個 BEGIN … ROLLBACK 裡,先套 b2b_d1_fixture.sql 的虛構資料。絕不在正式庫跑(會建訂單)。
-- 🔵 刻意不叫 *.test.sql:同資料夾那幾支是 pgTAP,本檔是 psql 腳本。

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

BEGIN;
-- b2b_d1_fixture.sql 用 'boss' 這位主管存經銷折扣;拋棄式庫沒有就補一位(交易結束會回滾)
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
CREATE FUNCTION pg_temp.pp(p text) RETURNS text LANGUAGE sql AS $$
  SELECT price_general::text || '/' || coalesce(original_price::text, '-') FROM public.products_public WHERE id = p::uuid $$;
CREATE FUNCTION pg_temp.lp(p text) RETURNS text LANGUAGE sql AS $$
  SELECT price_general::text || '/' || coalesce(original_price::text, '-') FROM public.products_list_public WHERE id = p::uuid $$;
CREATE FUNCTION pg_temp.vp(v text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(price_general::text, 'NULL') || '/' || coalesce(original_price::text, '-') FROM public.product_variants_public WHERE id = v::uuid $$;
-- 建單:成功回 'OK|小計|運費|折扣|總額|第一行單價',失敗回 SQLSTATE 加錯誤訊息(子交易回滾 ⇒ 失敗時不留任何列)
CREATE FUNCTION pg_temp.try_ord(lines text, pay text DEFAULT 'bank_transfer', coupon text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb; o record;
BEGIN
  r := public.create_order(lines::jsonb,
    (SELECT id FROM public.customer_addresses WHERE customer_user_id = auth.uid()), 'home', '{"type":"personal"}'::jsonb,
    gen_random_uuid(), 't1', '127.0.0.1', 'probe', pay, NULL, coupon);
  SELECT subtotal, shipping_fee, discount_total, total INTO o FROM public.orders WHERE id = (r->>'order_id')::uuid;
  RETURN 'OK|' || o.subtotal || '|' || o.shipping_fee || '|' || o.discount_total || '|' || o.total || '|' ||
    (SELECT unit_price FROM public.order_items WHERE order_id = (r->>'order_id')::uuid ORDER BY unit_price DESC LIMIT 1);
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
CREATE FUNCTION pg_temp.n() RETURNS text LANGUAGE sql AS $$ SELECT (SELECT count(*) FROM public.orders)::text || '/' || (SELECT count(*) FROM public.order_items)::text $$;

-- 加一件完全沒有規格的商品(計畫 R7-1:照舊顯示商品層價格)
INSERT INTO public.products(id,external_id,title,handle,price_by_tier,price_general,brand_id,category_id,delisted_at) VALUES
 ('11111111-0000-4000-8000-000000000009','e9','P9 沒有規格','p9',pg_temp.pbt(2500,2000),2500,'aaaaaaaa-0000-4000-8000-00000000000b','cccccccc-0000-4000-8000-000000000001',NULL);
-- 一件像正式庫 DBK CC02 的商品:商品層價格 8400,但有一個規格只要 4300(沒有特價 ⇒ 卡片價維持 8400,和今天一樣)
INSERT INTO public.products(id,external_id,title,handle,price_by_tier,price_general,brand_id,category_id,delisted_at) VALUES
 ('11111111-0000-4000-8000-000000000008','e8','P8 商品層比最便宜規格貴','p8',pg_temp.pbt(8400,8000),8400,'aaaaaaaa-0000-4000-8000-00000000000b','cccccccc-0000-4000-8000-000000000001',NULL);
INSERT INTO public.product_variants(id,product_id,sku,price_general,price_store,supplier_slug,spec) VALUES
 ('22222222-0000-4000-8000-00000000008a','11111111-0000-4000-8000-000000000008','P8-A',8400,8000,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-00000000008e','11111111-0000-4000-8000-000000000008','P8-E',4300,4000,'rpm','{"c":"E"}'::jsonb);
-- 滿 1000 折 100 的券(最低消費看的是實際小計)
INSERT INTO public.coupons(code, discount_type, discount_value, min_spend, stacks_with_tier, created_by)
  VALUES ('PM4TEST', 'fixed', 100, 1000, true, (SELECT id FROM public.staff ORDER BY id LIMIT 1));

-- ══ ① 沒有特價:和今天一樣 ══
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000f');
SELECT pg_temp.eq('一般 沒特價 規格價', pg_temp.gv('22222222-0000-4000-8000-00000000001a'), '1100');
SELECT pg_temp.eq('一般 沒特價 商品價', pg_temp.gp('11111111-0000-4000-8000-000000000001'), '1100');
SELECT pg_temp.eq('一般 沒特價 商品頁', pg_temp.pp('11111111-0000-4000-8000-000000000001'), '1100/-');
SELECT pg_temp.eq('一般 沒特價 型錄', pg_temp.lp('11111111-0000-4000-8000-000000000001'), '1100/-');
SELECT pg_temp.eq('一般 沒特價 規格 view', pg_temp.vp('22222222-0000-4000-8000-00000000001b'), '1300/-');
SELECT pg_temp.eq('一般 沒特價 建單(沒帶核對值)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]'), 'OK|1100|100|0|1200|1100');
SELECT pg_temp.eq('沒有規格的商品 商品頁用商品層價格', pg_temp.pp('11111111-0000-4000-8000-000000000009'), '2500/-');
SELECT pg_temp.eq('沒特價 商品層價格照舊(不改成最便宜規格)', pg_temp.lp('11111111-0000-4000-8000-000000000008'), '8400/-');
SELECT pg_temp.eq('沒特價 查價照舊', pg_temp.gp('11111111-0000-4000-8000-000000000008'), '8400');
SELECT pg_temp.eq('沒有規格的商品 查價用商品層價格', pg_temp.gp('11111111-0000-4000-8000-000000000009'), '2500');
RESET ROLE;

-- ══ ② 設特價:P1-B 1300 → 500(比 P1-A 1100 便宜 ⇒ 代表款換成 P1-B) ══
UPDATE public.product_variants SET sale_price_general = 500 WHERE id = '22222222-0000-4000-8000-00000000001b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.eq('一般 有特價 規格價', pg_temp.gv('22222222-0000-4000-8000-00000000001b'), '500');
SELECT pg_temp.eq('一般 有特價 規格 view(劃線 1300)', pg_temp.vp('22222222-0000-4000-8000-00000000001b'), '500/1300');
SELECT pg_temp.eq('一般 有特價 商品價 = 代表款', pg_temp.gp('11111111-0000-4000-8000-000000000001'), '500');
SELECT pg_temp.eq('一般 有特價 商品頁(劃線取代表款原價)', pg_temp.pp('11111111-0000-4000-8000-000000000001'), '500/1300');
SELECT pg_temp.eq('一般 有特價 型錄', pg_temp.lp('11111111-0000-4000-8000-000000000001'), '500/1300');
SELECT pg_temp.eq('一般 有特價 沒特價的規格不變', pg_temp.vp('22222222-0000-4000-8000-00000000001a'), '1100/-');
SELECT pg_temp.eq('一般 有特價 建單收特價(數量 2、匯款)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":2}]'), 'OK|1000|100|0|1100|500');
SELECT pg_temp.eq('一般 有特價 建單(刷卡)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1}]', 'tappay'), 'OK|500|100|0|600|500');
SELECT pg_temp.eq('一般 有特價 券的最低消費看特價小計(1000 夠)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":2}]', 'bank_transfer', 'PM4TEST'), 'OK|1000|100|100|1000|500');
SELECT set_config('t.n0', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.eq('一般 有特價 券的最低消費看特價小計(500 不夠 ⇒ 拒)', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1}]', 'bank_transfer', 'PM4TEST') LIKE 'P2C20 %')::text, 'true');
SELECT pg_temp.eq('券被拒 零新增', pg_temp.n(), current_setting('t.n0'));
-- 經銷會員不吃特價
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000d');
SELECT pg_temp.eq('經銷 有特價 規格價仍是經銷價', pg_temp.gv('22222222-0000-4000-8000-00000000001b'), '1141');
SELECT pg_temp.eq('經銷 有特價 商品價仍是基準款經銷價', pg_temp.gp('11111111-0000-4000-8000-000000000001'), '925');
SELECT pg_temp.eq('經銷 有特價 建單收經銷價', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1}]'), 'OK|1141|100|0|1241|1141');
RESET ROLE;

-- ══ ③ 下單時核對單價 ══
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000f');
SELECT pg_temp.eq('核對 一樣 ⇒ 建單', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":500}]'), 'OK|500|100|0|600|500');
SELECT pg_temp.eq('核對 JSON null ⇒ 不比對', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":null}]'), 'OK|500|100|0|600|500');
SELECT pg_temp.eq('核對 0 元贈品帶 0 ⇒ 建單', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":1100},{"variant_id":"22222222-0000-4000-8000-000000000006","qty":1,"expected_unit_price":0}]'), '|', 1), 'OK');
SELECT set_config('t.n1', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.eq('核對 不一樣(畫面還是原價 1300)⇒ P2C21', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":1300}]'), ' ', 1), 'P2C21');
SELECT pg_temp.eq('核對 第二行不一樣 ⇒ 整張不建', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1,"expected_unit_price":1100},{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":499}]'), ' ', 1), 'P2C21');
SELECT pg_temp.eq('核對 字串 ⇒ 格式不對', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":"500"}]') LIKE '%expected_unit_price 格式不對%')::text, 'true');
SELECT pg_temp.eq('核對 小數 ⇒ 格式不對', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":500.5}]') LIKE '%expected_unit_price 格式不對%')::text, 'true');
SELECT pg_temp.eq('核對 負數 ⇒ 格式不對', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":-1}]') LIKE '%expected_unit_price 格式不對%')::text, 'true');
SELECT pg_temp.eq('核對被拒的都零新增', pg_temp.n(), current_setting('t.n1'));
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000d');
SELECT pg_temp.eq('核對 經銷也比(帶一般價 1300)⇒ P2C21', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":1300}]'), ' ', 1), 'P2C21');
SELECT pg_temp.eq('核對 經銷帶經銷價 ⇒ 建單', split_part(pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1,"expected_unit_price":1141}]'), '|', 1), 'OK');
RESET ROLE;

-- ══ ④ 特價比新的一般價高(報價單把一般價調低):付比較低的一般價 ══
UPDATE public.product_variants SET price_general = 400 WHERE id = '22222222-0000-4000-8000-00000000001b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000f');
SELECT pg_temp.eq('特價 500 > 一般價 400 ⇒ 付 400、不劃線', pg_temp.vp('22222222-0000-4000-8000-00000000001b'), '400/-');
SELECT pg_temp.eq('特價 500 > 一般價 400 ⇒ 建單 400', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001b","qty":1}]'), 'OK|400|100|0|500|400');
RESET ROLE;

-- ══ ⑤ 一般價變成空的(特價還在):不能買,不能讓特價頂上(計畫 R6-1) ══
UPDATE public.product_variants SET price_general = NULL, sale_price_general = 300 WHERE id = '22222222-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.eq('一般價空 規格 view 空', pg_temp.vp('22222222-0000-4000-8000-000000000002'), 'NULL/-');
SELECT pg_temp.eq('一般價空 查價空', pg_temp.gv('22222222-0000-4000-8000-000000000002'), NULL);
SELECT pg_temp.eq('一般價空 唯一規格 ⇒ 商品頁空價(不拿商品層頂上)', (SELECT coalesce(price_general::text, 'NULL') FROM public.products_public WHERE id = '11111111-0000-4000-8000-000000000002'), 'NULL');
SELECT set_config('t.n2', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.eq('一般價空 ⇒ 擋單', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000002","qty":1}]') LIKE '%變體無有效單價%')::text, 'true');
SELECT pg_temp.eq('一般價空 帶核對值 300 也擋', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000002","qty":1,"expected_unit_price":300}]') LIKE '%變體無有效單價%')::text, 'true');
SELECT pg_temp.eq('一般價空 零新增', pg_temp.n(), current_setting('t.n2'));
RESET ROLE;

-- ⑤b 特價清掉之後,一般價仍是空 ⇒ 還是空價(不能讓商品層舊價 1200 頂回來;Codex R1 必修)
UPDATE public.product_variants SET sale_price_general = NULL WHERE id = '22222222-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.eq('清掉特價後一般價仍空 商品頁空價', (SELECT coalesce(price_general::text, 'NULL') FROM public.products_public WHERE id = '11111111-0000-4000-8000-000000000002'), 'NULL');
SELECT pg_temp.eq('清掉特價後一般價仍空 型錄空價', (SELECT coalesce(price_general::text, 'NULL') FROM public.products_list_public WHERE id = '11111111-0000-4000-8000-000000000002'), 'NULL');
SELECT pg_temp.eq('清掉特價後一般價仍空 查價空', pg_temp.gp('11111111-0000-4000-8000-000000000002'), NULL);
RESET ROLE;
-- ⑤c 從來沒有特價、一般價被同步改成空(商品層還是 800)⇒ 空價
UPDATE public.product_variants SET price_general = NULL WHERE id = '22222222-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_temp.eq('沒特價、規格一般價空 商品頁空價', (SELECT coalesce(price_general::text, 'NULL') FROM public.products_public WHERE id = '11111111-0000-4000-8000-000000000003'), 'NULL');
SELECT pg_temp.eq('沒特價、規格一般價空 型錄空價', (SELECT coalesce(price_general::text, 'NULL') FROM public.products_list_public WHERE id = '11111111-0000-4000-8000-000000000003'), 'NULL');
SELECT pg_temp.eq('沒特價、規格一般價空 查價空', pg_temp.gp('11111111-0000-4000-8000-000000000003'), NULL);
RESET ROLE;
UPDATE public.product_variants SET price_general = 800 WHERE id = '22222222-0000-4000-8000-000000000003';

-- ══ ⑥ 免運門檻看實際小計:P7 6000 設特價 4000 ⇒ 不到 5000,要收運費 ══
UPDATE public.product_variants SET sale_price_general = 4000 WHERE id = '22222222-0000-4000-8000-000000000007';
SET LOCAL ROLE authenticated;
SELECT pg_temp.eq('免運門檻 特價後 4000 收運費', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000007","qty":1}]'), 'OK|4000|100|0|4100|4000');
SELECT pg_temp.eq('免運門檻 數量 2 = 8000 免運', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000007","qty":2}]'), 'OK|8000|0|0|8000|4000');
RESET ROLE;

-- ══ ⑦ 訪客(anon)讀得到三個 view 與原價欄,讀不到經銷目錄 ══
SET LOCAL ROLE anon;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.eq('訪客 商品頁', pg_temp.pp('11111111-0000-4000-8000-000000000007'), '4000/6000');
SELECT pg_temp.eq('訪客 型錄', pg_temp.lp('11111111-0000-4000-8000-000000000007'), '4000/6000');
SELECT pg_temp.eq('訪客 規格', pg_temp.vp('22222222-0000-4000-8000-000000000007'), '4000/6000');
SELECT pg_temp.eq('訪客 下架商品看不到', (SELECT count(*)::text FROM public.product_variants_public WHERE id = '22222222-0000-4000-8000-000000000004'), '0');
SELECT pg_temp.eq('訪客 讀不到經銷目錄', has_table_privilege('anon', 'public.products_list_dealer', 'SELECT')::text, 'false');
SELECT pg_temp.eq('訪客 讀不到經銷價欄', has_column_privilege('anon', 'public.product_variants', 'price_store', 'SELECT')::text, 'false');
RESET ROLE;

-- ══ ⑨ 同步把有特價的規格搬到別的商品(計畫 R5-2):下一次讀就算在新商品上,不靠存起來的標記 ══
UPDATE public.product_variants SET sale_price_general = 600 WHERE id = '22222222-0000-4000-8000-000000000003';
UPDATE public.product_variants SET product_id = '11111111-0000-4000-8000-000000000008', spec = '{"c":"moved"}'::jsonb WHERE id = '22222222-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000f');
SELECT pg_temp.eq('搬過去的特價 新商品卡片看得到', pg_temp.lp('11111111-0000-4000-8000-000000000008'), '600/800');
SELECT pg_temp.eq('搬過去的特價 新商品查價看得到', pg_temp.gp('11111111-0000-4000-8000-000000000008'), '600');
SELECT pg_temp.eq('搬走之後 舊商品沒有規格 ⇒ 商品層價格', pg_temp.lp('11111111-0000-4000-8000-000000000003'), '800/-');
SELECT pg_temp.eq('搬過去的特價 建單收 600(和卡片一致)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000003","qty":1,"expected_unit_price":600}]'), 'OK|600|100|0|700|600');
RESET ROLE;

-- ══ ⑧ 舊訂單金額不變(前面建的單,改價之後重讀) ══
SELECT pg_temp.eq('舊訂單的單價沒有被改', (SELECT count(*)::text FROM public.order_items WHERE variant_id = '22222222-0000-4000-8000-00000000001b' AND unit_price = 500), '5');

ROLLBACK;
SELECT '✅ P-M4 行為測試全部通過';
