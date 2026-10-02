-- 還原 20261002200000_m4b_email_copy_versions.sql。
-- 🔴 先 revert 寄信接線(2b)與存檔動作(2c)的程式, 再跑這支;否則寄信端會持續讀不到表而每輪告警。
-- 刪表會刪掉員工改過的所有版本(操作紀錄 admin_audit_log 留著)。
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.admin_save_email_copy(text, text, text, text);
DROP TABLE IF EXISTS public.email_copy_versions;
DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.email_copy_versions') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_save_email_copy(text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '還原事後閘:表或函式還在';
  END IF;
END
$post$;
COMMIT;
