-- 20260916170000_m4b_supplier_mail_system_draft.sql
-- M-4b · 「email 廠商新品 → 首頁大圖」片 4 第 2 步:系統記信 + 建草稿(同一個交易)
-- PRD:docs/plans/2026-09-15-email-newproduct-homepage-banner-prd.md §4 / §12.5;碼:packages/use-cases/src/draft-supplier-newproduct-banners.ts
-- pcm:idempotent: no
--   理由:建新函式。重貼 ⇒ 前置閘二 RAISE(函式已在)。要重來先跑 rollback。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════
-- `admin_home_banner_save_draft`(20260916150000)要在職員工當 actor ⇒ 每日讀信的系統(`system:mail-draft`)進不去。
-- 而「記這封信」與「建草稿」必須同一個交易:記了信而草稿沒建 ⇒ 下一輪去重跳過 ⇒ 那封永遠沒草稿。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════
-- public.system_supplier_mail_record(p_record jsonb, p_draft jsonb, p_request_id text) RETURNS text
--   · 回 'recorded' / 'duplicate'
--   · 那封信已經有一列、而且不是 failed ⇒ 'duplicate',什麼都不寫(兩輪重疊 / 已經起草過)
--   · 🔴 **failed 重跑規則**:那封信已經有一列、status = 'failed' ⇒ 覆寫那一列(created_at 不動 ⇒ 90 天從第一次看到算)
--     ⇒ 每次重跑都要 Gmail 還列得出那封(查詢式 newer_than:3d)⇒ 天然上限約 3 次,不另加計數欄
--     ⇒ 對應碼:adapter 的 knownMessageIds 不把 failed 當成已讀過
--   · status 是 drafted / no_products ⇒ 一定要帶草稿;其他狀態 ⇒ 不准帶草稿
--   · 草稿:status draft、rights_confirmed = false、created_by = updated_by = 'system:mail-draft'、source_email_id 指回這封、
--     有圖 ⇒ image_origin = 'supplier_url'(複製到自家空間是 §8 #15);同交易寫 admin_audit_log home_banner.draft_create
--     ⚠️ admin_audit_log.source_app 的 COMMENT(20260712210000)寫「系統自動化 / cron 事件不寫本表」—— 本支【刻意】寫:
--        系統草稿會出現在後台大圖頁,員工要看得到「這張是誰建的」;actor 'system:mail-draft' 不在 staff 表 ⇒ actor_label 為 NULL
--   · drafted / no_products 一定要 auth_passed = true(寄件網域驗證沒過的信不准有草稿;碼那一層已經擋,這裡再兜一次)
--   · SECURITY DEFINER、search_path 釘空、EXECUTE 只給 service_role
--
-- ══ 刻意不做:排程(開旗標那天一起貼)═══════════════════════════════════
-- 🔴 兩支排程【都不在本檔執行】—— 主視窗 2026-09-16:排程先不開,SQL 寫好註解著。
--    理由:① 旗標沒開之前 supplier_inbound_emails 不會有任何資料 ⇒ 90 天清理沒有東西可清
--          ② 排程一上就要進 `packages/domain/src/ops/cron-jobs.ts` 的 CRON_JOB_WHITELIST(cron-allowlist-drift-gate 會比),
--             而白名單上的 job 沒寫心跳 ⇒ 後台排程健康頁每天亮「從來沒寫過心跳」⇒ 心跳接線是開旗標那一片的事
--    ⇒ 開旗標那天:下面兩句 + 白名單兩列 + 心跳,同一顆 commit、同一次貼板。
--    (以下是註解,不會被執行)
--    SELECT cron.schedule('pcm-supplier-newproduct-drafts', '0 0 * * *',
--      $cron$SELECT pcm_cron.invoke_cron_route('/api/cron/supplier-newproduct-drafts')$cron$);   -- 台北 08:00
--    SELECT cron.schedule('pcm-supplier-inbound-purge', '30 19 * * *',
--      $cron$SELECT public.supplier_inbound_emails_purge_expired()$cron$);                          -- 台北 03:30
--
-- ══ 貼板必附 ═══════════════════════════════════════════════════════
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260916170000):新增 1 支函式
-- 🔴 本檔先貼,adapter 那顆(呼叫本 RPC)才合 dev;旗標預設關,正式站不會跑到
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- supabase/rollbacks/20260916170000-rollback.sql:DROP 這支函式。已建的系統草稿與讀信紀錄留著。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.supplier_inbound_emails') IS NULL OR pg_catalog.to_regclass('public.home_banners') IS NULL THEN
    RAISE EXCEPTION '前置閘一:supplier_inbound_emails / home_banners 不在 ⇒ 20260916150000(板 196)還沒貼';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'system_supplier_mail_record') THEN
    RAISE EXCEPTION '前置閘二:system_supplier_mail_record 已存在 ⇒ 貼過了, 停下(要重來先跑 rollback)';
  END IF;
END
$pre$;

CREATE FUNCTION public.system_supplier_mail_record(
  p_record     jsonb,
  p_draft      jsonb,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c_actor      constant text := 'system:mail-draft';
  v_request_id text := pg_catalog.btrim(p_request_id);
  v_draft      jsonb := CASE WHEN p_draft IS NULL OR pg_catalog.jsonb_typeof(p_draft) = 'null' THEN NULL ELSE p_draft END;
  v_mid        text;
  v_status     text;
  v_extracted  jsonb;
  v_existing   public.supplier_inbound_emails;
  v_email_id   uuid;
  v_banner     public.home_banners;
  v_title      text;
BEGIN
  IF v_request_id IS NULL OR v_request_id = '' OR p_record IS NULL OR pg_catalog.jsonb_typeof(p_record) <> 'object'
     OR (v_draft IS NOT NULL AND pg_catalog.jsonb_typeof(v_draft) <> 'object') THEN
    RAISE EXCEPTION '參數不正確';
  END IF;

  v_mid := p_record ->> 'gmail_message_id';
  v_status := p_record ->> 'status';
  IF v_mid IS NULL OR v_status IS NULL OR pg_catalog.jsonb_typeof(p_record -> 'auth_passed') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  IF v_status IN ('drafted', 'no_products') AND v_draft IS NULL THEN
    RAISE EXCEPTION 'drafted / no_products 的信一定要帶草稿';
  END IF;
  IF v_status NOT IN ('drafted', 'no_products') AND v_draft IS NOT NULL THEN
    RAISE EXCEPTION '只有 drafted / no_products 的信可以帶草稿';
  END IF;
  IF v_status IN ('drafted', 'no_products') AND NOT (p_record ->> 'auth_passed')::boolean THEN
    RAISE EXCEPTION '寄件網域驗證沒過的信不能起草';
  END IF;
  v_extracted := CASE WHEN pg_catalog.jsonb_typeof(p_record -> 'extracted') IN ('null') OR p_record -> 'extracted' IS NULL
                      THEN NULL ELSE p_record -> 'extracted' END;

  SELECT * INTO v_existing FROM public.supplier_inbound_emails e WHERE e.gmail_message_id = v_mid FOR UPDATE;
  IF FOUND THEN
    IF v_existing.status <> 'failed' THEN
      RETURN 'duplicate';
    END IF;
    -- 🔴 failed 重跑:覆寫那一列;created_at 不動(90 天從第一次看到算)
    UPDATE public.supplier_inbound_emails e
       SET gmail_thread_id = p_record ->> 'gmail_thread_id',
           sender          = p_record ->> 'sender',
           subject         = p_record ->> 'subject',
           received_at     = (p_record ->> 'received_at')::timestamptz,
           auth_passed     = (p_record ->> 'auth_passed')::boolean,
           status          = v_status,
           extracted       = v_extracted,
           error_code      = p_record ->> 'error_code'
     WHERE e.id = v_existing.id
    RETURNING e.id INTO v_email_id;
  ELSE
    INSERT INTO public.supplier_inbound_emails (
      gmail_message_id, gmail_thread_id, sender, subject, received_at, auth_passed, status, extracted, error_code)
    VALUES (
      v_mid, p_record ->> 'gmail_thread_id', p_record ->> 'sender', p_record ->> 'subject',
      (p_record ->> 'received_at')::timestamptz, (p_record ->> 'auth_passed')::boolean, v_status, v_extracted,
      p_record ->> 'error_code')
    ON CONFLICT (gmail_message_id) DO NOTHING
    RETURNING id INTO v_email_id;
    IF v_email_id IS NULL THEN
      RETURN 'duplicate';   -- 另一輪同時插進去了
    END IF;
  END IF;

  IF v_draft IS NULL THEN
    RETURN 'recorded';
  END IF;

  v_title := NULLIF(pg_catalog.btrim(v_draft ->> 'title_line1'), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION '草稿缺標題第一行';
  END IF;

  INSERT INTO public.home_banners (
    eyebrow, title_line1, title_line2, subtitle, cta_label, link_path,
    image_desktop_url, image_origin, image_kind, rights_confirmed, source_email_id, matched_variant_ids,
    created_by, updated_by)
  VALUES (
    NULLIF(pg_catalog.btrim(v_draft ->> 'eyebrow'), ''),
    v_title,
    NULLIF(pg_catalog.btrim(v_draft ->> 'title_line2'), ''),
    NULLIF(pg_catalog.btrim(v_draft ->> 'subtitle'), ''),
    NULLIF(pg_catalog.btrim(v_draft ->> 'cta_label'), ''),
    NULLIF(pg_catalog.btrim(v_draft ->> 'link_path'), ''),
    NULLIF(pg_catalog.btrim(v_draft ->> 'image_desktop_url'), ''),
    CASE WHEN NULLIF(pg_catalog.btrim(v_draft ->> 'image_desktop_url'), '') IS NULL THEN NULL ELSE 'supplier_url' END,
    COALESCE(NULLIF(v_draft ->> 'image_kind', ''), 'scene'),
    false,
    v_email_id,
    CASE WHEN pg_catalog.jsonb_typeof(v_draft -> 'matched_variant_ids') = 'array'
         THEN ARRAY(SELECT x::uuid FROM pg_catalog.jsonb_array_elements_text(v_draft -> 'matched_variant_ids') AS x)
         ELSE '{}'::uuid[] END,
    c_actor,
    c_actor)
  RETURNING * INTO v_banner;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id)
  VALUES (c_actor, 'home_banner.draft_create', 'home_banner:' || v_banner.id::text, NULL,
          pg_catalog.to_jsonb(v_banner), 'source_email:' || v_email_id::text, v_request_id);

  RETURN 'recorded';
END
$fn$;

ALTER FUNCTION public.system_supplier_mail_record(jsonb, jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.system_supplier_mail_record(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_supplier_mail_record(jsonb, jsonb, text) TO service_role;

COMMENT ON FUNCTION public.system_supplier_mail_record(jsonb, jsonb, text) IS
  '每日讀廠商新品信:記一封信,drafted / no_products 同交易建系統草稿(20260916170000)。回 recorded / duplicate;已有非 failed 的列 ⇒ duplicate;failed 的列 ⇒ 覆寫重跑(created_at 不動)。草稿 rights_confirmed = false、created_by = system:mail-draft,寫 admin_audit_log home_banner.draft_create。EXECUTE 只給 service_role。';

DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.system_supplier_mail_record(jsonb, jsonb, text)'
  ]::text[];
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘一:% 對 anon / authenticated 可執行', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘二:% service_role 不能執行', v_fn;
    END IF;
  END LOOP;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.system_supplier_mail_record(jsonb, jsonb, text)'::regprocedure) THEN
    RAISE EXCEPTION '後置閘三:不是 SECURITY DEFINER';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = 'public.system_supplier_mail_record(jsonb, jsonb, text)'::regprocedure)
     IS DISTINCT FROM ARRAY['search_path=""']
     OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.system_supplier_mail_record(jsonb, jsonb, text)'::regprocedure)
     IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '後置閘四:search_path 不是空字串或 owner 不是 postgres';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
