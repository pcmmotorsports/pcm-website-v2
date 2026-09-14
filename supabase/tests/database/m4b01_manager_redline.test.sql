-- m4b01_manager_redline.test.sql —— 20260915040000 五支 RPC 的 DB 層管理者閘(M-4b-01, Sean 09-14 拍甲)
--
-- 每支三格:非管理者 ⇒ throws '無權執行此操作' · 停用的管理者 ⇒ 同句 · 管理者 ⇒ 過閘(拿一個不存在的單 / 列 / 信去打,
-- 看到的必須是「不存在」那一類, 不是權限那一句 ⇒ 證明閘在參數檢查之後、資料查找之前放行了)。
-- 🔴 突變(拋棄式 PG 手跑, 不在本檔):把任一支的 `IF NOT coalesce(v_is_manager, false)` 註掉 ⇒ 非管理者那格必須紅。
-- fixture 都在交易內造、最後 ROLLBACK, 不留痕。

BEGIN;
SELECT plan(18);

INSERT INTO public.staff (id, label, is_manager, is_active) VALUES
  ('t_m4b01_mgr',     '測試管理者',       true,  true),
  ('t_m4b01_staff',   '測試員工',         false, true),
  ('t_m4b01_mgr_off', '測試停用管理者',   true,  false);

-- ① admin_update_order_item_amount
SELECT throws_ok(
  $$SELECT public.admin_update_order_item_amount('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002', 100, 1, 't_m4b01_staff', 'req-m4b01-1')$$,
  '無權執行此操作', '① 非管理者改單價 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_update_order_item_amount('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002', 100, 1, 't_m4b01_mgr_off', 'req-m4b01-2')$$,
  '無權執行此操作', '① 停用的管理者 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_update_order_item_amount('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002', 100, 1, 't_m4b01_mgr', 'req-m4b01-3')$$,
  'admin_update_order_item_amount: 訂單不存在', '① 管理者 ⇒ 過閘, 走到訂單查找');

-- ② admin_requeue_dead_email(第 2 代 2 參)
SELECT ok(pg_catalog.to_regprocedure('public.admin_requeue_dead_email(uuid)') IS NULL, '② 1 參版已不在');
SELECT throws_ok(
  $$SELECT public.admin_requeue_dead_email('00000000-0000-4000-8000-000000000003', 't_m4b01_staff')$$,
  '無權執行此操作', '② 非管理者重排死信 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_requeue_dead_email('00000000-0000-4000-8000-000000000003', 't_m4b01_mgr_off')$$,
  '無權執行此操作', '② 停用的管理者 ⇒ 擋');
SELECT throws_like(
  $$SELECT public.admin_requeue_dead_email('00000000-0000-4000-8000-000000000003', 't_m4b01_mgr')$$,
  '%找不到 outbox 列%', '② 管理者 ⇒ 過閘, 走到 outbox 查找');

-- ③ admin_soft_delete_order_note
SELECT throws_ok(
  $$SELECT public.admin_soft_delete_order_note('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004', '測試', 't_m4b01_staff', 'req-m4b01-4')$$,
  '無權執行此操作', '③ 非管理者收起備註 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.admin_soft_delete_order_note('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004', '測試', 't_m4b01_mgr_off', 'req-m4b01-5')$$,
  '無權執行此操作', '③ 停用的管理者 ⇒ 擋');
SELECT is(
  public.admin_soft_delete_order_note('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004', '測試', 't_m4b01_mgr', 'req-m4b01-6'),
  'ORDER_NOT_FOUND', '③ 管理者 ⇒ 過閘, 走到訂單查找');

-- ③ 參數檢查先於閘(codex R1):非管理者傳空 note_id ⇒ 仍是 INVALID_INPUT, 不是權限例外
SELECT is(
  public.admin_soft_delete_order_note('00000000-0000-4000-8000-000000000001', NULL, '測試', 't_m4b01_staff', 'req-m4b01-13'),
  'INVALID_INPUT', '③ 非管理者 + 無效輸入 ⇒ 參數檢查先答, 閘在後');

-- ④ record_manual_cancel_notice
SELECT throws_ok(
  $$SELECT public.record_manual_cancel_notice('00000000-0000-4000-8000-000000000001', 'x@example.com', 't_m4b01_staff', 'req-m4b01-7')$$,
  '無權執行此操作', '④ 非管理者登錄手動取消通知 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.record_manual_cancel_notice('00000000-0000-4000-8000-000000000001', 'x@example.com', 't_m4b01_mgr_off', 'req-m4b01-8')$$,
  '無權執行此操作', '④ 停用的管理者 ⇒ 擋');
SELECT is(
  public.record_manual_cancel_notice('00000000-0000-4000-8000-000000000001', 'x@example.com', 't_m4b01_mgr', 'req-m4b01-9') ->> 'result',
  'not_found', '④ 管理者 ⇒ 過閘, 走到訂單查找');

-- ⑤ revoke_manual_cancel_notice
SELECT throws_ok(
  $$SELECT public.revoke_manual_cancel_notice('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005', 't_m4b01_staff', 'req-m4b01-10')$$,
  '無權執行此操作', '⑤ 非管理者撤銷 ⇒ 擋');
SELECT throws_ok(
  $$SELECT public.revoke_manual_cancel_notice('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005', 't_m4b01_mgr_off', 'req-m4b01-11')$$,
  '無權執行此操作', '⑤ 停用的管理者 ⇒ 擋');
SELECT is(
  public.revoke_manual_cancel_notice('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000005', 't_m4b01_mgr', 'req-m4b01-12') ->> 'result',
  'not_found', '⑤ 管理者 ⇒ 過閘, 走到列查找');

-- 尺是活的:同一句在範本函式裡也在(正對照)
SELECT ok(
  (SELECT p.prosrc LIKE '%無權執行此操作%' FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_staff_create(text,text,text,boolean,text)')),
  '正對照:admin_staff_create 含同一句');

SELECT * FROM finish();
ROLLBACK;
