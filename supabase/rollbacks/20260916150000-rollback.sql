-- 20260916150000-rollback.sql —— 退回 20260916150000_m4b_home_banners_and_inbound_emails.sql
--
-- 🔴 順序:先 revert 用到這些物件的後台 / 前台片,再跑本檔。反過來 ⇒ 首頁讀 view 失敗(前台應當作沒有大圖)、後台頁 PGRST202。
-- 🔴 ⚠️ 會連資料一起刪:所有草稿、已發布的大圖、讀信紀錄。admin_audit_log 裡的 home_banner.* 稽核列留著。
-- 🔴 退完同批跑 pcm_acl_approve_latest(p_note 帶 20260916150000 與「rollback」)。
-- 🔵 可重跑:全部 IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP VIEW IF EXISTS public.home_banners_live_v;

DROP FUNCTION IF EXISTS public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text);
DROP FUNCTION IF EXISTS public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.admin_home_banner_archive(uuid, text, text);
DROP FUNCTION IF EXISTS public.supplier_inbound_emails_purge_expired();

-- home_banners 有 FK 指向 supplier_inbound_emails ⇒ 先刪它
DROP TABLE IF EXISTS public.home_banners;
DROP TABLE IF EXISTS public.supplier_inbound_emails;

DO $post$
BEGIN
  IF pg_catalog.to_regclass('public.home_banners') IS NOT NULL
     OR pg_catalog.to_regclass('public.supplier_inbound_emails') IS NOT NULL
     OR pg_catalog.to_regclass('public.home_banners_live_v') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘一:表或 view 還在';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('admin_home_banner_save_draft', 'admin_home_banner_publish',
                                  'admin_home_banner_archive', 'supplier_inbound_emails_purge_expired')) THEN
    RAISE EXCEPTION '退回後置閘二:函式還在(含任何簽章)';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
