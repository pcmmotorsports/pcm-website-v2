-- 20261001140000_m4b_supplier_mail_record_social.sql
-- M-4b · 品牌電子報 → 首頁大圖草稿(mac mini 版):系統記信建草稿時一併寫 FB / IG 文字
-- 計畫:~/pcm-mailbox/計畫-電子報草稿-macmini-20261001.md §2(主視窗 2026-10-01 批准, 四題照推薦)
-- pcm:idempotent: no
--   理由:CREATE OR REPLACE 一支既有函式。前置閘鎖舊版 md5 ⇒ 重貼會被擋(函式已是新版)。要重來先跑 rollback。
--
-- ══ 為什麼 ═══════════════════════════════════════════════════════════
-- 讀信起草改跑在 mac mini(Sean 2026-10-01:launchd + 月租 Claude + IMAP 讀 dayun.info@gmail.com)。
-- 草稿要同時帶 FB / IG 文字, 而 system_supplier_mail_record(20260916170000)寫的時候 home_banners 還沒有這兩欄:
--   · admin_home_banner_save_social 要在職員工當 actor ⇒ 系統(system:mail-draft)叫不了
--   · system_new_product_draft 以 source_product_id 去重(一件商品一份)、而且 home_banners_one_source_check
--     不准同時有 source_product_id 與 source_email_id ⇒ 信件來源記不下來, 還會跟每日自動新品草稿搶同一件
-- ⇒ 讓本支多收兩個鍵, 其他行為逐字不變。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════
-- public.system_supplier_mail_record(p_record jsonb, p_draft jsonb, p_request_id text):簽章不變
--   · p_draft 多讀 fb_text、ig_text, 寫進 home_banners 同名兩欄(空字串 ⇒ NULL;沒帶 ⇒ NULL)
--   · 長度上限由表上既有 CHECK home_banners_fb_text_check / home_banners_ig_text_check(≤ 2200, 20261001120000)擋
--   · 其餘本體逐字照抄 20260916170000(正式庫 2026-10-01 唯讀量 pg_get_functiondef md5 9ccd85a9ffbadee4dfa4f2118c7c00d3)
--   · 🔴 SET search_path = '' 照抄(CREATE OR REPLACE 會把 SET 子句整組換掉);OWNER 與 ACL 不變(CREATE OR REPLACE 保留)
--   · 發布規則不在本支:admin_home_banner_publish 對信件草稿要求配到商品、連結指 /products…、大圖文字紅字檢查(不變)
--
-- ══ 貼板必附 ═══════════════════════════════════════════════════════
-- 🔴 前提:20261001120000(板 257)已貼 —— fb_text / ig_text 兩欄要在。前置閘②擋。
-- 🔴 簽章沒變 ⇒ 沒有「舊碼叫不動」的空窗:舊碼不帶 fb_text / ig_text, 新版當 NULL 寫, 跟舊版一樣。
-- 🔴 ACL 不變 ⇒ 不需要 pcm_acl_approve_latest(後置閘一、二逐格確認 anon / authenticated 不能執行、service_role 能)。
-- 正式庫 2026-10-01 唯讀量:supplier_inbound_emails 0 列、system:mail-draft 草稿 0 張 ⇒ 貼上當下沒有任何資料受影響。
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- supabase/rollbacks/20261001140000-rollback.sql:換回 20260916170000 那一版。已寫進去的 fb_text / ig_text 留著(後台照常顯示、可改)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_md5 text;
BEGIN
  -- 前置閘①:現行函式是 20260916170000 那一版(本支逐字照抄它)
  IF pg_catalog.to_regprocedure('public.system_supplier_mail_record(jsonb,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘①:system_supplier_mail_record 不在 ⇒ 20260916170000 還沒貼';
  END IF;
  v_md5 := pg_catalog.md5(pg_catalog.pg_get_functiondef('public.system_supplier_mail_record(jsonb,jsonb,text)'::regprocedure));
  IF v_md5 IS DISTINCT FROM '9ccd85a9ffbadee4dfa4f2118c7c00d3' THEN
    RAISE EXCEPTION '前置閘①:system_supplier_mail_record 不是預期那一版(md5 %), 有人改過或已貼過 ⇒ 先比對再貼', v_md5;
  END IF;
  -- 前置閘②:fb_text / ig_text 兩欄在(20261001120000)
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'home_banners' AND column_name IN ('fb_text', 'ig_text')) <> 2 THEN
    RAISE EXCEPTION '前置閘②:home_banners 沒有 fb_text / ig_text ⇒ 20261001120000(板 257)還沒貼';
  END IF;
END
$pre$;

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
    fb_text, ig_text,
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
    NULLIF(pg_catalog.btrim(v_draft ->> 'fb_text'), ''),
    NULLIF(pg_catalog.btrim(v_draft ->> 'ig_text'), ''),
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
  '每日讀廠商新品信:記一封信,drafted / no_products 同交易建系統草稿(20260916170000;20261001140000 起草稿可帶 fb_text / ig_text)。回 recorded / duplicate;已有非 failed 的列 ⇒ duplicate;failed 的列 ⇒ 覆寫重跑(created_at 不動)。草稿 rights_confirmed = false、created_by = system:mail-draft,寫 admin_audit_log home_banner.draft_create。EXECUTE 只給 service_role。';

DO $post$
DECLARE
  v_fn  constant text := 'public.system_supplier_mail_record(jsonb, jsonb, text)';
  v_md5 text;
BEGIN
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘一:% 對 anon / authenticated 可執行', v_fn;
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘二:% service_role 不能執行', v_fn;
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
    RAISE EXCEPTION '後置閘三:不是 SECURITY DEFINER';
  END IF;
  IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM ARRAY['search_path=""']
     OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION '後置閘四:search_path 不是空字串或 owner 不是 postgres';
  END IF;
  v_md5 := pg_catalog.md5(pg_catalog.pg_get_functiondef(v_fn::regprocedure));
  IF v_md5 = '9ccd85a9ffbadee4dfa4f2118c7c00d3' THEN
    RAISE EXCEPTION '後置閘五:函式還是舊版 md5 ⇒ 沒換到';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_fn::regprocedure), 'fb_text') = 0 THEN
    RAISE EXCEPTION '後置閘五:新版函式沒有 fb_text';
  END IF;
END
$post$;

COMMIT;
