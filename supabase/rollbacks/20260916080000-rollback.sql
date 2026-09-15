-- 20260916080000-rollback.sql —— 退回 20260916080000_m4b_incident_mark_resolved.sql
--
-- 🔴 順序:先 revert 後台「標記已處理」那片(dev)與告警信文字那顆(storefront / main),再跑本檔。
--    反過來 ⇒ 後台按鈕先壞(PGRST202),信裡「到後台按已處理」繼續出現而鈕已經不在。
-- 🔴 plan §6 甲:只 DROP 兩支寫入函式 + 讀取函式還原 6 欄。**兩欄與兩條 CHECK 留著**
--    (可 NULL、無害;丟掉 resolved_by 而留 resolved_at 會讓 CHECK 與重貼互相卡死)⇒ 重貼走 migration 的「跳過 ALTER」。
-- 🔴 退回不會把已處理的事故改回未處理:resolved_at / resolved_by / resolution_note 都留著值。
--    要全部打開 ⇒ 另寫一句 UPDATE(三欄一起清, CHECK 才過),不放進本檔(不猜意圖)。
-- 🔴 退完同批跑 pcm_acl_approve_latest(p_note 帶 20260916080000 與「rollback」)。
-- ⚠️ 本檔不動表 ⇒ 不拿 ACCESS EXCLUSIVE;讀取函式 DROP + CREATE 期間事故頁可能短暫 PGRST202。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_resolve_pcm_incident(bigint, text, text, text);
DROP FUNCTION IF EXISTS public.admin_reopen_pcm_incident(bigint, text, text, text);

-- 讀取函式還原成 20260916040000 那一代(本體與 ACL 逐字)。先 DROP IF EXISTS ⇒ 重跑冪等。
DROP FUNCTION IF EXISTS public.admin_list_pcm_incidents(integer, boolean);

CREATE FUNCTION public.admin_list_pcm_incidents(p_limit integer, p_open_only boolean)
RETURNS TABLE (
  id          bigint,
  kind        text,
  subject_id  uuid,
  detail      text,
  created_at  timestamptz,
  resolved_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT i.id, i.kind, i.subject_id, i.detail, i.created_at, i.resolved_at
    FROM public.pcm_incident i
   WHERE NOT COALESCE(p_open_only, true)
      OR i.resolved_at IS NULL
   ORDER BY i.created_at DESC, i.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$fn$;
COMMENT ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) IS
  '後台事故紀錄頁的唯讀窄門(20260916040000;稽核 P2-7)。回 pcm_incident 單筆(含 detail / subject_id),'
  ' p_limit NULL⇒50 夾 1..200、p_open_only NULL⇒true。EXECUTE 只給 service_role(後台 server 端代讀);'
  ' 表本身仍對所有角色 0 權限。Sean 2026-09-15「都可以看」:能登入後台的員工都看得到全文。';

ALTER FUNCTION public.admin_list_pcm_incidents(integer, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) FROM anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.admin_list_pcm_incidents(integer, boolean) TO service_role;

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_resolve_pcm_incident(bigint, text, text, text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_reopen_pcm_incident(bigint, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘一:寫入函式還在';
  END IF;
  IF pg_catalog.pg_get_function_result('public.admin_list_pcm_incidents(integer, boolean)'::regprocedure)
     IS DISTINCT FROM 'TABLE(id bigint, kind text, subject_id uuid, detail text, created_at timestamp with time zone, resolved_at timestamp with time zone)' THEN
    RAISE EXCEPTION '退回後置閘二:admin_list_pcm_incidents 沒有回到 6 欄形狀';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_list_pcm_incidents(integer, boolean)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.admin_list_pcm_incidents(integer, boolean)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_list_pcm_incidents(integer, boolean)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('payment_confirmer', 'public.admin_list_pcm_incidents(integer, boolean)', 'EXECUTE')
     OR (EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly')
         AND pg_catalog.has_function_privilege('pcm_readonly', 'public.admin_list_pcm_incidents(integer, boolean)', 'EXECUTE')) THEN
    RAISE EXCEPTION '退回後置閘三:admin_list_pcm_incidents 的 EXECUTE 不是只給 service_role';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
