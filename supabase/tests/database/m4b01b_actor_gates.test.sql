-- m4b01b_actor_gates.test.sql —— 20260927020000 四支碰錢 RPC 的操作人檢查(M-4b-01 補強)
--
-- ① admin_dealer_brand_discounts_save:在職非管理者 / 停用管理者 / 不存在的操作人 ⇒ '無權執行此操作';管理者 ⇒ 過閘走到客人查找(NOT_FOUND)。
-- ②③④ admin_set_customer_tier / admin_adjust_wallet / admin_initiate_order_refund:停用員工 / 不存在的操作人 ⇒ 擋;在職一般員工 ⇒ 過閘(誰能做不變)。
-- 🔴 反向對照(拋棄式 PG 2026-09-27 手跑, 不在本檔):把四支換回正式庫原版再跑同一組, 9 格「擋」全部變紅、6 格「過閘」不變。
-- ⚠️ 本檔在本機拋棄式 PG 沒跑過(那裡沒有 pgtap);同內容的純 SQL 探測已在拋棄式 PG 跑過 15/15。
-- fixture 都在交易內造、最後 ROLLBACK, 不留痕。

BEGIN;
SELECT plan(15);

INSERT INTO public.staff (id, label, is_manager, is_active) VALUES
  ('t_b_mgr', '測試管理者', true, true), ('t_b_staff', '測試員工', false, true),
  ('t_b_mgr_off', '停用管理者', true, false), ('t_b_staff_off', '停用員工', false, false);

SELECT throws_ok(
  $$SELECT public.admin_dealer_brand_discounts_save('00000000-0000-4000-8000-0000000000aa','[{"brand_id":"00000000-0000-4000-8000-0000000000bb","percent":5}]','{"00000000-0000-4000-8000-0000000000bb":null}','t_b_staff','r1')$$,
  '無權執行此操作', '① 在職非管理者 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_dealer_brand_discounts_save('00000000-0000-4000-8000-0000000000aa','[{"brand_id":"00000000-0000-4000-8000-0000000000bb","percent":5}]','{"00000000-0000-4000-8000-0000000000bb":null}','t_b_mgr_off','r2')$$,
  '無權執行此操作', '① 停用管理者 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_dealer_brand_discounts_save('00000000-0000-4000-8000-0000000000aa','[{"brand_id":"00000000-0000-4000-8000-0000000000bb","percent":5}]','{"00000000-0000-4000-8000-0000000000bb":null}','no_such_staff','r3')$$,
  '無權執行此操作', '① 不存在的操作人 ⇒ 擋');
SELECT is(
  (public.admin_dealer_brand_discounts_save('00000000-0000-4000-8000-0000000000aa','[{"brand_id":"00000000-0000-4000-8000-0000000000bb","percent":5}]','{"00000000-0000-4000-8000-0000000000bb":null}','t_b_mgr','r4')),
  'NOT_FOUND', '① 管理者 ⇒ 過閘, 走到客人查找');
SELECT throws_ok(
  $$SELECT public.admin_dealer_brand_discounts_save('00000000-0000-4000-8000-0000000000aa','[{"brand_id":"00000000-0000-4000-8000-0000000000bb","percent":5}]','{"00000000-0000-4000-8000-0000000000bb":null}','t_b_staff','')$$,
  'admin_dealer_brand_discounts_save:缺 request_id', '① 參數檢查先答, 閘在後');
SELECT throws_ok(
  $$SELECT public.admin_set_customer_tier('00000000-0000-4000-8000-0000000000aa','store','測試','t_b_staff_off','r5',NULL)$$,
  '無權執行此操作', '② 停用員工 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_set_customer_tier('00000000-0000-4000-8000-0000000000aa','store','測試','no_such_staff','r6',NULL)$$,
  '無權執行此操作', '② 不存在的操作人 ⇒ 擋');
SELECT is(
  (public.admin_set_customer_tier('00000000-0000-4000-8000-0000000000aa','store','測試','t_b_staff','r7',NULL)),
  'NOT_FOUND', '② 在職一般員工 ⇒ 過閘(誰能做不變)');
SELECT is(
  (public.admin_set_customer_tier('00000000-0000-4000-8000-0000000000aa','store','測試','t_b_mgr','r8',NULL)),
  'NOT_FOUND', '② 管理者 ⇒ 過閘');
SELECT throws_ok(
  $$SELECT public.admin_adjust_wallet('00000000-0000-4000-8000-0000000000aa','deposit',100,'測試','t_b_staff_off','00000000-0000-4000-8000-0000000000c1')$$,
  '無權執行此操作', '③ 停用員工 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_adjust_wallet('00000000-0000-4000-8000-0000000000aa','deposit',100,'測試','no_such_staff','00000000-0000-4000-8000-0000000000c2')$$,
  '無權執行此操作', '③ 不存在的操作人 ⇒ 擋');
SELECT is(
  (public.admin_adjust_wallet('00000000-0000-4000-8000-0000000000aa','deposit',100,'測試','t_b_staff','00000000-0000-4000-8000-0000000000c3')),
  'NOT_FOUND', '③ 在職一般員工 ⇒ 過閘');
SELECT throws_ok(
  $$SELECT (public.admin_initiate_order_refund('00000000-0000-4000-8000-0000000000aa','partial',100,0,NULL,'測試','t_b_staff_off','00000000-0000-4000-8000-0000000000d1'))::text$$,
  '無權執行此操作', '④ 停用員工 ⇒ 擋');
SELECT throws_ok(
  $$SELECT (public.admin_initiate_order_refund('00000000-0000-4000-8000-0000000000aa','partial',100,0,NULL,'測試','no_such_staff','00000000-0000-4000-8000-0000000000d2'))::text$$,
  '無權執行此操作', '④ 不存在的操作人 ⇒ 擋');
SELECT is(
  ((public.admin_initiate_order_refund('00000000-0000-4000-8000-0000000000aa','partial',100,0,NULL,'測試','t_b_staff','00000000-0000-4000-8000-0000000000d3'))->>'result'),
  'ORDER_NOT_FOUND', '④ 在職一般員工 ⇒ 過閘');

SELECT * FROM finish();
ROLLBACK;
