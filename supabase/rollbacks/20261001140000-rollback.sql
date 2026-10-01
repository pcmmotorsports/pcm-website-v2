-- 20261001140000 回滾:system_supplier_mail_record 換回 20260916170000 那一版(草稿不再寫 fb_text / ig_text)。
-- 本體逐字取自 supabase/migrations/20260916170000_m4b_supplier_mail_system_draft.sql。
-- 已寫進 home_banners 的 fb_text / ig_text 留著(後台照常顯示、可改)。先停 mac mini 排程 com.pcm.newsletter-drafts, 再跑本檔。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := pg_catalog.md5(pg_catalog.pg_get_functiondef('public.system_supplier_mail_record(jsonb,jsonb,text)'::regprocedure));
  IF v_md5 = '9ccd85a9ffbadee4dfa4f2118c7c00d3' THEN
    RAISE EXCEPTION '前置閘:已經是 20260916170000 那一版 ⇒ 沒貼過或已回滾, 停下';
  END IF;
  -- R1 nit 1:比 md5 不比字面 —— 日後再改這支(仍含 fb_text)時不可以被整個洗回 09-16 版
  IF v_md5 IS DISTINCT FROM '83d4e97dec5d3530eb3d24ef869cb10a' THEN
    RAISE EXCEPTION '前置閘:現行版本不是 20261001140000(md5 %), 有人改過 ⇒ 先比對再跑', v_md5;
  END IF;
END
$precondition$;

CREATE OR REPLACE FUNCTION public.system_supplier_mail_record(
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

COMMENT ON FUNCTION public.system_supplier_mail_record(jsonb, jsonb, text) IS
  '每日讀廠商新品信:記一封信,drafted / no_products 同交易建系統草稿(20260916170000)。回 recorded / duplicate;已有非 failed 的列 ⇒ duplicate;failed 的列 ⇒ 覆寫重跑(created_at 不動)。草稿 rights_confirmed = false、created_by = system:mail-draft,寫 admin_audit_log home_banner.draft_create。EXECUTE 只給 service_role。';

DO $post$
BEGIN
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef('public.system_supplier_mail_record(jsonb,jsonb,text)'::regprocedure))
     IS DISTINCT FROM '9ccd85a9ffbadee4dfa4f2118c7c00d3' THEN
    RAISE EXCEPTION '後置閘:回滾後 md5 不是 20260916170000 那一版';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.system_supplier_mail_record(jsonb, jsonb, text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.system_supplier_mail_record(jsonb, jsonb, text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.system_supplier_mail_record(jsonb, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘:執行權限不是只給 service_role';
  END IF;
END
$post$;

COMMIT;
