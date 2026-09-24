-- B2B D1(20260925050000)行為測試:缺經銷價不退回一般價、create_order 依 x-pcm-site 擋錯站。
-- 用法:拋棄式 PG(public 結構 = 正式庫唯讀 pg_dump)依序套 20260925010000–050000,先跑 b2b_d1_fixture.sql,再跑本檔;
--   全過印「✅ D1 行為測試全部通過」,任一格不對會 RAISE「❌ …」停下。在只套到 E2(040000)的庫上跑,第一格就會紅(負對照)。
-- 絕不在正式庫跑(會建訂單)。每段都包在 BEGIN … ROLLBACK 裡。
-- 🔵 刻意不叫 *.test.sql:同資料夾那幾支是 pgTAP,本檔是 psql 腳本(用 \set、\pset),混在一起會讓整批 pgTAP 跑失敗。

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
-- D1 行為測試(拋棄式庫,先套 e2-fixture.sql)。經銷 D=store(品牌 A 7.5%),G=general。P5 變體 price_store NULL。
CREATE FUNCTION pg_temp.eq(label text, got text, want text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '❌ % 得到 % 期望 %', label, got, want; END IF;
  RETURN '✓ ' || label || ' = ' || coalesce(got, 'NULL');
END $$;
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.site(h text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.headers', coalesce(h, ''), true) $$;
CREATE FUNCTION pg_temp.gv(v text) RETURNS text LANGUAGE sql AS $$ SELECT amount::text FROM public.get_effective_prices(NULL, ARRAY[v::uuid]) $$;
CREATE FUNCTION pg_temp.gp(p text) RETURNS text LANGUAGE sql AS $$ SELECT amount::text FROM public.get_effective_prices(ARRAY[p::uuid], NULL) $$;
CREATE FUNCTION pg_temp.cat(t text) RETURNS text LANGUAGE sql AS $$
  SELECT item->>'price_general' FROM public.search_catalog_by_vehicle_dealer(NULL::text[], p_limit => 50) WHERE item->>'title' = t $$;
-- 建單:成功回 'OK',失敗回錯誤訊息(子交易回滾 ⇒ 失敗時不留任何列)
CREATE FUNCTION pg_temp.try_ord(lines text, pay text DEFAULT 'bank_transfer') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.create_order(lines::jsonb,
    (SELECT id FROM public.customer_addresses WHERE customer_user_id = auth.uid()), 'home', '{"type":"personal"}'::jsonb,
    gen_random_uuid(), 't1', '127.0.0.1', 'probe', pay, NULL, NULL);
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
CREATE FUNCTION pg_temp.n() RETURNS text LANGUAGE sql AS $$ SELECT (SELECT count(*) FROM public.orders)::text || '/' || (SELECT count(*) FROM public.order_items)::text $$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000d');
SELECT pg_temp.site(NULL);
-- ① 缺經銷價 ⇒ NULL(不退一般價);有經銷價照舊(含品牌折扣)
SELECT pg_temp.eq('D 變體 P5 缺經銷價', pg_temp.gv('22222222-0000-4000-8000-000000000005'), NULL);
SELECT pg_temp.eq('D 商品 P5 缺經銷價', pg_temp.gp('11111111-0000-4000-8000-000000000005'), NULL);
SELECT pg_temp.eq('D 目錄 P5 缺經銷價', pg_temp.cat('P5 缺經銷價'), NULL);
SELECT pg_temp.eq('D 變體 P1-A 照舊', pg_temp.gv('22222222-0000-4000-8000-00000000001a'), '925');
SELECT pg_temp.eq('D 商品 P1 照舊', pg_temp.gp('11111111-0000-4000-8000-000000000001'), '925');
SELECT pg_temp.eq('D 目錄 P1 照舊', pg_temp.cat('P1 兩個變體'), '925');
SELECT pg_temp.eq('D 變體 P3 品牌B 不打折', pg_temp.gv('22222222-0000-4000-8000-000000000003'), '700');
SELECT pg_temp.eq('D 變體 P6 零元', pg_temp.gv('22222222-0000-4000-8000-000000000006'), '0');
-- ② 建單:缺經銷價 ⇒ 拒絕、零新增
SELECT set_config('t.n0', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.eq('D 建單 P5 缺經銷價 ⇒ 拒絕', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000005","qty":1}]') LIKE '%變體無有效單價%')::text, 'true');
SELECT pg_temp.eq('D 建單 P5 零新增', pg_temp.n(), current_setting('t.n0'));
-- ③ 站別:沒標頭 ⇒ 照舊;b2b ⇒ 可;retail ⇒ 拒絕;大小寫不對 ⇒ 非法拒絕
SELECT pg_temp.eq('D 沒標頭 ⇒ 建單成功', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]'), 'OK');
SELECT pg_temp.site('{"x-pcm-site":"b2b"}');
SELECT pg_temp.eq('D 經銷站 ⇒ 建單成功(刷卡)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]', 'tappay'), 'OK');
SELECT set_config('t.n1', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.site('{"x-pcm-site":"retail"}');
SELECT pg_temp.eq('D 一般站 ⇒ pcm_wrong_site', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]') LIKE '%pcm_wrong_site%')::text, 'true');
SELECT pg_temp.site('{"x-pcm-site":"B2B"}');
SELECT pg_temp.eq('D 標頭 B2B(大小寫)⇒ 非法拒絕', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]') LIKE '%標頭值非法%')::text, 'true');
SELECT pg_temp.eq('D 被拒的都零新增', pg_temp.n(), current_setting('t.n1'));
SELECT pg_temp.site('not json');
SELECT pg_temp.eq('D 標頭不是 JSON ⇒ 報錯不吞', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-00000000001a","qty":1}]') LIKE '%json%')::text, 'true');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-00000000000f');
SELECT pg_temp.site(NULL);
SELECT pg_temp.eq('G 變體 P5 一般價不變', pg_temp.gv('22222222-0000-4000-8000-000000000005'), '1500');
SELECT pg_temp.eq('G 沒標頭 ⇒ 建單成功', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000005","qty":1}]'), 'OK');
SELECT pg_temp.site('{"x-pcm-site":"retail"}');
SELECT pg_temp.eq('G 一般站 ⇒ 建單成功(刷卡)', pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000005","qty":1}]', 'tappay'), 'OK');
SELECT set_config('t.n2', pg_temp.n(), true) IS NOT NULL;
SELECT pg_temp.site('{"x-pcm-site":"b2b"}');
SELECT pg_temp.eq('G 經銷站 ⇒ pcm_wrong_site', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000005","qty":1}]') LIKE '%pcm_wrong_site%')::text, 'true');
SELECT pg_temp.eq('G 被拒零新增', pg_temp.n(), current_setting('t.n2'));
ROLLBACK;

-- premiumStore 在經銷站也要擋(計畫 F 節 Q1 甲:premiumStore 當一般會員)
BEGIN;
UPDATE public.customers SET tier = 'premiumStore' WHERE user_id = 'dddddddd-0000-4000-8000-0000000000d2';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('dddddddd-0000-4000-8000-0000000000d2');
SELECT pg_temp.site('{"x-pcm-site":"b2b"}');
SELECT pg_temp.eq('premiumStore 經銷站 ⇒ pcm_wrong_site', (pg_temp.try_ord('[{"variant_id":"22222222-0000-4000-8000-000000000003","qty":1}]') LIKE '%pcm_wrong_site%')::text, 'true');
ROLLBACK;
SELECT '✅ D1 行為測試全部通過';
