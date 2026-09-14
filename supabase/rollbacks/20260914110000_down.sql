-- 稽核身分快照 回滾:DROP trigger / 函式 / 兩欄。欄是 20260914110000 才加的, 丟掉不傷既有資料(actor slug 還在)。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_audit_actor_snapshot()') IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:pcm_audit_actor_snapshot 不在這台庫上, 沒有東西可回滾';
  END IF;
END
$pre$;
DROP TRIGGER IF EXISTS admin_audit_log_actor_snapshot_bi ON public.admin_audit_log;
DROP FUNCTION IF EXISTS public.pcm_audit_actor_snapshot();
ALTER TABLE public.admin_audit_log DROP COLUMN IF EXISTS actor_label, DROP COLUMN IF EXISTS actor_is_manager;
COMMIT;
