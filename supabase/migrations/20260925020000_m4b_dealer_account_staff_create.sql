-- ============================================================
-- 後台直接新增經銷帳號、替客人寄重設密碼信(B2B 計畫 §9.9,片 D4a / D4b)
-- ============================================================
-- plan:docs/plans/2026-09-23-b2b-subdomain-plan.md §9.9(Sean 2026-09-25 新增,「依推薦」)
-- 退回檔:supabase/rollbacks/20260925020000-rollback.sql(檔內第一行就是 SET LOCAL lock_timeout)
-- 前提:20260925010000(dealer_applications)要先貼。
--
-- 本檔三件事:
--   ① dealer_applications 加 source 欄:customer = 客人自己申請;staff = 員工在後台直接建立。
--   ② admin_dealer_account_create:員工建好帳號(邀請信由後台呼叫 Supabase Auth 寄)之後,
--      同一個交易寫一筆已核准的申請(source='staff')並把等級改成 store(後台「車行」)。冪等。
--   ③ admin_password_reset_claim:員工按「寄送重設密碼信」前先搶這一格。
--      鎖住 customers 那一列 ⇒ 兩個人同時按只有一個拿到 OK;60 秒內重按回 TOO_SOON。
--      拿到 OK 才寄信;寄完的結果(accepted / failed / unknown)由後台另外寫一筆稽核。
-- 兩支函式 EXECUTE 只給 service_role;員工身分與 Origin 在後台 server action 先驗(authorizeAdminMutation)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.dealer_applications') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.dealer_applications ⇒ 先貼 20260925010000 再貼這支。';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.dealer_applications'::regclass AND attname = 'source' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘②:dealer_applications.source 已存在 ⇒ 停(可能已貼過)。';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_set_customer_tier(uuid, text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 admin_set_customer_tier 六參版 ⇒ 停。';
  END IF;
END
$pre$;

-- ── 1. 申請來源 ────────────────────────────────────────────────
ALTER TABLE public.dealer_applications
  ADD COLUMN source text NOT NULL DEFAULT 'customer',
  ADD CONSTRAINT dealer_app_source_check CHECK (source IN ('customer', 'staff'));

COMMENT ON COLUMN public.dealer_applications.source IS
  'customer = 客人自己送的申請;staff = 員工在後台直接建立經銷帳號時寫入(20260925020000, 一定是 approved)。';

-- ── 2. 員工:把剛建好的帳號設成經銷 ────────────────────────────────
-- 回:CREATED / ALREADY_DONE / NOT_FOUND / WOULD_DOWNGRADE
--   · NOT_FOUND:customers 沒有這個 user_id(handle_new_auth_user 沒建到)⇒ 零寫入。
--   · ALREADY_DONE:這個帳號已經有 source='staff' 的已核准申請 ⇒ 零寫入(「重新完成設定」重按、兩個人同時按)。
--   · WOULD_DOWNGRADE:現值是 premiumStore(後台「經銷」)⇒ 改成 store 會降級 ⇒ 零寫入。
--   · 公司資料格式由表上的 CHECK 判(違反 ⇒ 23514, 後台先用同一套規則驗過)。
CREATE FUNCTION public.admin_dealer_account_create(
  p_user_id       uuid,
  p_company_name  text,
  p_tax_id        text,
  p_store_name    text,
  p_region        text,
  p_contact_name  text,
  p_contact_phone text,
  p_contact_email text,
  p_note          text,
  p_actor         text,
  p_request_id    text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tier   text;
  v_id     uuid;
  v_result text;
  -- 空白字元集照抄 20260925010000(= admin_set_customer_tier 那一組)
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_dealer_account_create:缺 user_id';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_account_create:缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_account_create:缺 request_id';
  END IF;

  -- 🔴 先鎖 customers 那一列, 再查「做過了沒」⇒ 兩個請求同時進來, 後到的等前一個提交後才看, 看到的是 ALREADY_DONE
  SELECT c.tier::text INTO v_tier FROM public.customers c WHERE c.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dealer_applications a
              WHERE a.user_id = p_user_id AND a.source = 'staff' AND a.status = 'approved') THEN
    RETURN 'ALREADY_DONE';
  END IF;
  IF v_tier = 'premiumStore' THEN
    RETURN 'WOULD_DOWNGRADE';
  END IF;

  INSERT INTO public.dealer_applications
    (user_id, company_name, tax_id, store_name, region, contact_name, contact_phone, contact_email, note,
     status, source, decided_by, decided_at)
  VALUES (
    p_user_id,
    pg_catalog.btrim(coalesce(p_company_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_tax_id, ''), v_ws),
    pg_catalog.btrim(coalesce(p_store_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_region, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_phone, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_email, ''), v_ws),
    pg_catalog.btrim(coalesce(p_note, ''), v_ws),
    'approved', 'staff', p_actor, pg_catalog.now()
  )
  RETURNING id INTO v_id;

  v_result := public.admin_set_customer_tier(
    p_user_id, 'store', '後台建立經銷帳號 #' || v_id::text, p_actor, p_request_id, v_tier);
  IF v_result NOT IN ('UPDATED', 'NO_CHANGE') THEN
    -- 前面已鎖住並讀過現值 ⇒ 理論上到不了;到了就整筆回滾, 不留「有申請紀錄而等級沒改」
    RAISE EXCEPTION 'admin_dealer_account_create:改等級回 %(預期 UPDATED / NO_CHANGE)', v_result;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'dealer.account.create',
    'customer:' || p_user_id::text,
    pg_catalog.jsonb_build_object('tier', v_tier),
    pg_catalog.jsonb_build_object('tier', 'store', 'dealer_application', v_id::text),
    NULL,
    p_request_id,
    'admin'
  );
  RETURN 'CREATED';
END;
$fn$;

-- ── 3. 員工:寄重設密碼信前先搶這一格 ──────────────────────────────
-- 回:OK / TOO_SOON / NOT_FOUND。OK 的同時寫一筆 customer.password_reset.claimed 稽核(同一個交易)。
CREATE FUNCTION public.admin_password_reset_claim(
  p_customer   uuid,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'admin_password_reset_claim:缺 customer';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_password_reset_claim:缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_password_reset_claim:缺 request_id';
  END IF;

  -- 🔴 鎖住這位客人 ⇒ 兩個員工同時按, 後到的等前一個提交, 再查就看得到那一筆 claimed
  PERFORM 1 FROM public.customers c WHERE c.user_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  -- clock_timestamp():後到的那個交易可能比前一個【早】開始, 用 now() 會把前一筆算成未來
  IF EXISTS (SELECT 1 FROM public.admin_audit_log l
              WHERE l.action = 'customer.password_reset.claimed'
                AND l.target = 'customer:' || p_customer::text
                AND l.created_at > pg_catalog.clock_timestamp() - interval '60 seconds') THEN
    RETURN 'TOO_SOON';
  END IF;

  -- 🔴 created_at 明寫 clock_timestamp()(Codex R1):欄位預設 now() 是【交易開始】時間,
  --    等鎖等了 5 秒的那一筆會被記早 5 秒 ⇒ 下一次在 56 秒就放行。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app, created_at)
  VALUES (p_actor, 'customer.password_reset.claimed', 'customer:' || p_customer::text,
          NULL, NULL, NULL, p_request_id, 'admin', pg_catalog.clock_timestamp());
  RETURN 'OK';
END;
$fn$;

-- ── 4. 權限 ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_dealer_account_create(uuid, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dealer_account_create(uuid, text, text, text, text, text, text, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.admin_password_reset_claim(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_password_reset_claim(uuid, text, text) TO service_role;

-- ── 5. 事後閘 ─────────────────────────────────────────────────
DO $post$
DECLARE
  r      text;
  v_cfg  text;
  -- 🔴 收權斷言清單:本檔建出來的【可授權物件】全部列在這裡(migration-static-checks ③ 會數)
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY['public.admin_dealer_account_create(uuid, text, text, text, text, text, text, text, text, text, text)', 'public.admin_password_reset_claim(uuid, text, text)']::text[];
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(r) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:斷言清單裡的 % 不存在 ⇒ 停。', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '事後閘⓪:斷言清單裡的 % 不存在 ⇒ 停。', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘①:% 的 EXECUTE 不對(只該給 service_role)⇒ 停。', r;
    END IF;
  END LOOP;

  FOR r, v_cfg IN
    SELECT p.oid::regprocedure::text, pg_catalog.array_to_string(p.proconfig, ',') || CASE WHEN p.prosecdef THEN '' ELSE '|NOT-DEFINER' END
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('admin_dealer_account_create', 'admin_password_reset_claim')
  LOOP
    IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION '事後閘②:% 的 search_path 設定是 %(期望空字串)⇒ 停。', r, v_cfg;
    END IF;
  END LOOP;

  -- 既有申請全部是客人送的
  IF EXISTS (SELECT 1 FROM public.dealer_applications WHERE source <> 'customer') THEN
    RAISE EXCEPTION '事後閘③:既有申請的 source 不是 customer ⇒ 停。';
  END IF;

  -- 真的叫一次:不存在的帳號 ⇒ NOT_FOUND, 零寫入
  IF public.admin_dealer_account_create('00000000-0000-0000-0000-000000000000'::uuid,
       'x', '12345678', '', '臺北市', 'x', '0912345678', 'x@x.tw', '', 'migration-selftest', 'migration-selftest')
     IS DISTINCT FROM 'NOT_FOUND' THEN
    RAISE EXCEPTION '事後閘④:admin_dealer_account_create 對不存在的帳號沒回 NOT_FOUND ⇒ 停。';
  END IF;
  IF public.admin_password_reset_claim('00000000-0000-0000-0000-000000000000'::uuid, 'migration-selftest', 'migration-selftest')
     IS DISTINCT FROM 'NOT_FOUND' THEN
    RAISE EXCEPTION '事後閘⑤:admin_password_reset_claim 對不存在的帳號沒回 NOT_FOUND ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ source 欄與兩支函式建好。';
END
$post$;

COMMIT;
