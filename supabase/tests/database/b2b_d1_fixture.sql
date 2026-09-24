-- B2B D1 行為測試用的虛構資料(取自後台窗 E2 的測試資料 e2-fixture.sql,2026-09-25,逐字未改)。
-- 用法:拋棄式 PG(public 結構 = 正式庫唯讀 pg_dump)依序套 20260925010000–050000 之後,先跑本檔,再跑 b2b_d1_behavior.sql。
-- 絕不在正式庫跑。

-- E2 測試資料。品牌 A 有折扣(經銷 D 7.5%), 品牌 B 沒有。
INSERT INTO public.brands(id,name,slug) VALUES
 ('aaaaaaaa-0000-4000-8000-00000000000a','BRAND-A','brand-a'),('aaaaaaaa-0000-4000-8000-00000000000b','BRAND-B','brand-b');
INSERT INTO public.categories(id,name,raw_path,segments) VALUES ('cccccccc-0000-4000-8000-000000000001','CAT','CAT','["CAT"]');
CREATE FUNCTION pg_temp.pbt(g int, s int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('general', jsonb_build_object('amount', g::text, 'currency','TWD'), 'store', jsonb_build_object('amount', s::text, 'currency','TWD')) $$;
INSERT INTO public.products(id,external_id,title,handle,price_by_tier,brand_id,category_id,delisted_at) VALUES
 ('11111111-0000-4000-8000-000000000001','e1','P1 兩個變體','p1',pg_temp.pbt(1100,1000),'aaaaaaaa-0000-4000-8000-00000000000a','cccccccc-0000-4000-8000-000000000001',NULL),
 ('11111111-0000-4000-8000-000000000002','e2','P2','p2',pg_temp.pbt(1200,999),'aaaaaaaa-0000-4000-8000-00000000000a','cccccccc-0000-4000-8000-000000000001',NULL),
 ('11111111-0000-4000-8000-000000000003','e3','P3 品牌B','p3',pg_temp.pbt(800,700),'aaaaaaaa-0000-4000-8000-00000000000b','cccccccc-0000-4000-8000-000000000001',NULL),
 ('11111111-0000-4000-8000-000000000004','e4','P4 下架','p4',pg_temp.pbt(900,800),'aaaaaaaa-0000-4000-8000-00000000000a','cccccccc-0000-4000-8000-000000000001',now()),
 ('11111111-0000-4000-8000-000000000005','e5','P5 缺經銷價','p5',pg_temp.pbt(1500,1500),'aaaaaaaa-0000-4000-8000-00000000000a','cccccccc-0000-4000-8000-000000000001',NULL),
 ('11111111-0000-4000-8000-000000000006','e6','P6 零元','p6',pg_temp.pbt(0,0),'aaaaaaaa-0000-4000-8000-00000000000a','cccccccc-0000-4000-8000-000000000001',NULL),
 ('11111111-0000-4000-8000-000000000007','e7','P7 大額','p7',pg_temp.pbt(6000,5400),'aaaaaaaa-0000-4000-8000-00000000000a','cccccccc-0000-4000-8000-000000000001',NULL);
UPDATE public.products SET price_general = (price_by_tier->'general'->>'amount')::int;
INSERT INTO public.product_variants(id,product_id,sku,price_general,price_store,supplier_slug,spec) VALUES
 ('22222222-0000-4000-8000-00000000001a','11111111-0000-4000-8000-000000000001','P1-A',1100,1000,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-00000000001b','11111111-0000-4000-8000-000000000001','P1-B',1300,1234,'rpm','{"c":"B"}'::jsonb),
 ('22222222-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000002','P2',1200,999,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-000000000003','11111111-0000-4000-8000-000000000003','P3',800,700,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-000000000004','11111111-0000-4000-8000-000000000004','P4',900,800,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-000000000005','11111111-0000-4000-8000-000000000005','P5',1500,NULL,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-000000000006','11111111-0000-4000-8000-000000000006','P6',0,0,'rpm','{}'::jsonb),
 ('22222222-0000-4000-8000-000000000007','11111111-0000-4000-8000-000000000007','P7',6000,5400,'rpm','{}'::jsonb);
INSERT INTO auth.users(id,email) VALUES
 ('dddddddd-0000-4000-8000-00000000000d','d@x.tw'),('dddddddd-0000-4000-8000-0000000000d2','d2@x.tw'),('dddddddd-0000-4000-8000-00000000000f','g@x.tw');
INSERT INTO public.customers(user_id,email,tier) VALUES
 ('dddddddd-0000-4000-8000-00000000000d','d@x.tw','store'),('dddddddd-0000-4000-8000-0000000000d2','d2@x.tw','store'),('dddddddd-0000-4000-8000-00000000000f','g@x.tw','general')
 ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier;
INSERT INTO public.customer_addresses(id,customer_user_id,name,line,phone) VALUES
 ('eeeeeeee-0000-4000-8000-00000000000d','dddddddd-0000-4000-8000-00000000000d','阿明','台北市','0912345678'),
 ('eeeeeeee-0000-4000-8000-0000000000d2','dddddddd-0000-4000-8000-0000000000d2','阿華','台北市','0912345678'),
 ('eeeeeeee-0000-4000-8000-00000000000f','dddddddd-0000-4000-8000-00000000000f','小美','台北市','0912345678');
INSERT INTO public.legal_terms_versions(version,content_hash,effective_at) VALUES ('t1','h',now() - interval '1 day') ON CONFLICT DO NOTHING;
SELECT public.admin_dealer_brand_discounts_save('dddddddd-0000-4000-8000-00000000000d',
  '[{"brand_id":"aaaaaaaa-0000-4000-8000-00000000000a","percent":7.5}]','{"aaaaaaaa-0000-4000-8000-00000000000a":null}','boss','fx');
