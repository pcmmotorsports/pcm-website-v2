-- 20260916170000-rollback.sql —— 退回 20260916170000_m4b_supplier_mail_system_draft.sql
--
-- 🔴 順序:先 revert 呼叫本 RPC 的 adapter 那顆(或確認 SUPPLIER_MAIL_DRAFTS_ENABLED 沒開),再跑本檔。
--    反過來 ⇒ 旗標開著時每封信 PGRST202 ⇒ use-case 記 failed(記 failed 也走本 RPC ⇒ 連 failed 都記不進去,下一輪再撈)。
-- 🔵 已建的系統草稿(home_banners created_by = 'system:mail-draft')與讀信紀錄都留著,本檔不刪資料。
-- 🔴 退完同批跑 pcm_acl_approve_latest(p_note 帶 20260916170000 與「rollback」)。
-- 🔵 可重跑:DROP IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.system_supplier_mail_record(jsonb, jsonb, text);

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'system_supplier_mail_record') THEN
    RAISE EXCEPTION '退回後置閘一:system_supplier_mail_record 還在(含任何簽章)';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
