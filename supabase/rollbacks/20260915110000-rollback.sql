-- 20260915110000-rollback.sql —— 退回 20260915110000_m4b_grant_bank_amount_changed_helpers.sql
--
-- 🛑 **退了會把 `/api/cron/email-sweep` 打回「每一輪 42501 + 503」那個狀態** —— 那正是本檔要修的病。
--    ⇒ 只在「GRANT 本身造成別的問題」時才退, 不是例行回滾對象。
-- 零 schema、零資料。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_bank_amount_changed_email_floor()') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_bank_amount_changed_email_dedup_key(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '退回前置閘:那兩支函式不在 ⇒ 沒東西可退';
  END IF;
END
$pre$;

REVOKE EXECUTE ON FUNCTION public.pcm_bank_amount_changed_email_floor() FROM service_role;
REVOKE EXECUTE ON FUNCTION public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid) FROM service_role;

DO $post$
BEGIN
  IF pg_catalog.has_function_privilege('service_role', 'public.pcm_bank_amount_changed_email_floor()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.pcm_bank_amount_changed_email_dedup_key(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '退回後置閘:service_role 還執行得到 ⇒ REVOKE 沒生效';
  END IF;
END
$post$;

COMMIT;
