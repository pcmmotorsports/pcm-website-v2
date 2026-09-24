-- ============================================================
-- 經銷商申請表單(B2B 計畫第 9 節,片 A)
-- ============================================================
-- plan:docs/plans/2026-09-23-b2b-subdomain-plan.md §9.2–9.5(Sean 2026-09-23 第 3 題改成要有申請表單流程頁面;
--       2026-09-24「都陸續安排,不要問我,依推薦」⇒ Q7 甲 核准給 store(後台「車行」)、Q8 甲 這一包不寄信)
-- 退回檔:supabase/rollbacks/20260925010000-rollback.sql(檔內第一行就是 SET LOCAL lock_timeout)
--
-- ══ 權限形狀(與計畫 §9.3 不同的地方, 理由寫在這裡)═══════════════════════
-- 計畫 §9.3 原本給 authenticated 欄級 SELECT / INSERT / UPDATE。本檔改成:
--   表 ⇒ anon / authenticated 零權限(表級、欄級都沒有);service_role 只有 SELECT(後台列表)。
--   客人 ⇒ 三支 SECURITY DEFINER 函式,EXECUTE 只給 authenticated,身分一律取 auth.uid():
--     dealer_application_submit / dealer_application_update_mine / dealer_application_mine
--   員工 ⇒ admin_dealer_application_decide,EXECUTE 只給 service_role。
--   理由:① ACL 快照(pcm_acl_approve_latest)只看表級權限,看不到欄級授權 ⇒ 欄級 GRANT 會讓帳本記成
--         「authenticated 對這張表零權限」而其實讀寫得到(同 20260916150000 首頁大圖那支檔 R1 C3 的判斷)。
--         ② 客人不能自己填 updated_at、user_id、status、decided_*(計畫 R4 留的那一條建議也一併解掉)。
--         ③ 核准要同時改會員等級與申請狀態 —— 放進同一支函式 ⇒ 同一個交易, 不會留下
--            「等級改了、申請還在審核中」那種半套(計畫 §9.5 原本要靠「先 RPC 再 UPDATE、重按收斂」處理)。
--
-- ══ 刻意不做 ═══════════════════════════════════════════════════════
-- · 寄信(Q8 甲)· 營業登記證上傳 · 地址(計畫 §9.2)
-- · 前台入口與文案(片 C,等經銷站上線)
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.dealer_applications') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.dealer_applications 已存在 ⇒ 停(可能已貼過)。';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_set_customer_tier(uuid, text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 admin_set_customer_tier 六參版(20260914130000)⇒ 停, 核准函式要呼叫它。';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.admin_audit_log ⇒ 停。';
  END IF;
END
$pre$;

-- ── 1. 表 ────────────────────────────────────────────────────
CREATE TABLE public.dealer_applications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.customers(user_id) ON DELETE CASCADE,
  company_name   text        NOT NULL,
  tax_id         text        NOT NULL,
  store_name     text        NOT NULL DEFAULT '',
  region         text        NOT NULL,
  contact_name   text        NOT NULL,
  contact_phone  text        NOT NULL,
  contact_email  text        NOT NULL,
  note           text        NOT NULL DEFAULT '',
  status         text        NOT NULL DEFAULT 'pending',
  decided_by     text,
  decided_at     timestamptz,
  decide_note    text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealer_app_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT dealer_app_company_name_check CHECK (company_name <> '' AND char_length(company_name) <= 100),
  -- 只驗 8 碼數字、不驗檢查碼(沿用後台 apps/admin/src/lib/orders/invoice-title-lookup.ts:26「驗錯了會擋掉合法統編」)
  CONSTRAINT dealer_app_tax_id_format CHECK (tax_id ~ '^[0-9]{8}$'),
  CONSTRAINT dealer_app_store_name_check CHECK (char_length(store_name) <= 100),
  CONSTRAINT dealer_app_region_check CHECK (region IN (
    '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市',
    '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
    '臺東縣', '澎湖縣', '金門縣', '連江縣')),
  CONSTRAINT dealer_app_contact_name_check CHECK (contact_name <> '' AND char_length(contact_name) <= 50),
  -- 存客人打的原樣;判斷只看數字(去掉空白、橫線、括號後 8–10 碼, 市話含區碼或手機)
  CONSTRAINT dealer_app_contact_phone_check CHECK (
    char_length(contact_phone) <= 30
    AND contact_phone ~ '^[0-9 ()+-]+$'
    AND char_length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) BETWEEN 8 AND 10),
  CONSTRAINT dealer_app_contact_email_check CHECK (
    char_length(contact_email) <= 254 AND contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT dealer_app_note_check CHECK (char_length(note) <= 500),
  -- 兩個欄位【各綁一道】:只綁 decided_at 的話,「已核准而不知道是誰核准的」照樣進得來
  CONSTRAINT dealer_app_decided_at_pairing CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT dealer_app_decided_by_pairing CHECK ((status = 'pending') = (decided_by IS NULL)),
  CONSTRAINT dealer_app_reject_has_note CHECK (status <> 'rejected' OR decide_note <> ''),
  CONSTRAINT dealer_app_decide_note_check CHECK (char_length(decide_note) <= 500)
);

-- 一個帳號同時只能有一筆審核中的申請(重送 ⇒ 23505, 前台對應成「已經有一筆在審核中」)
CREATE UNIQUE INDEX dealer_applications_one_pending
  ON public.dealer_applications (user_id) WHERE status = 'pending';
CREATE INDEX dealer_applications_status_created_idx
  ON public.dealer_applications (status, created_at DESC);

COMMENT ON TABLE public.dealer_applications IS
  '經銷商申請(20260925010000;B2B 計畫 §9)。anon / authenticated 零權限;客人走 dealer_application_submit / _update_mine / _mine(auth.uid()),員工讀表(service_role SELECT)、決定走 admin_dealer_application_decide。decide_note 只給員工看, _mine 不回。';

ALTER TABLE public.dealer_applications ENABLE ROW LEVEL SECURITY;
-- service_role 帶 BYPASSRLS;這條政策是給哪天拿掉它時用的(rls-service-role-policy-gate)
CREATE POLICY dealer_applications_service_role_select ON public.dealer_applications
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.dealer_applications FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.dealer_applications TO service_role;

-- ── 2. 客人:送出申請 ─────────────────────────────────────────
CREATE FUNCTION public.dealer_application_submit(
  p_company_name  text,
  p_tax_id        text,
  p_store_name    text,
  p_region        text,
  p_contact_name  text,
  p_contact_phone text,
  p_contact_email text,
  p_note          text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  -- 空白字元集照抄 admin_set_customer_tier(20260914130000):btrim() 預設只剝 ASCII 空格,
  --   tab / 全形空白 / 零寬字元會讓「必填」與「婉拒原因」被一串看不見的字元騙過(Codex R1)。
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'dealer_application_submit:沒有登入身分' USING ERRCODE = '28000';
  END IF;
  -- 🔴 空白一律剝掉再存;格式由表上的 CHECK 判(違反 ⇒ 23514, 前台逐格先驗過, 這裡是最後一道)
  INSERT INTO public.dealer_applications
    (user_id, company_name, tax_id, store_name, region, contact_name, contact_phone, contact_email, note)
  VALUES (
    v_uid,
    pg_catalog.btrim(coalesce(p_company_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_tax_id, ''), v_ws),
    pg_catalog.btrim(coalesce(p_store_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_region, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_name, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_phone, ''), v_ws),
    pg_catalog.btrim(coalesce(p_contact_email, ''), v_ws),
    pg_catalog.btrim(coalesce(p_note, ''), v_ws)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- ── 3. 客人:修改自己【審核中】的那一筆 ─────────────────────────
-- 回 true = 改到了;false = 沒有這一筆、不是他的、或已經審核完成(前台:「這筆申請已經審核完成, 無法再修改」)
CREATE FUNCTION public.dealer_application_update_mine(
  p_id            uuid,
  p_company_name  text,
  p_tax_id        text,
  p_store_name    text,
  p_region        text,
  p_contact_name  text,
  p_contact_phone text,
  p_contact_email text,
  p_note          text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  -- 空白字元集照抄 admin_set_customer_tier(20260914130000):btrim() 預設只剝 ASCII 空格,
  --   tab / 全形空白 / 零寬字元會讓「必填」與「婉拒原因」被一串看不見的字元騙過(Codex R1)。
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'dealer_application_update_mine:沒有登入身分' USING ERRCODE = '28000';
  END IF;
  UPDATE public.dealer_applications
     SET company_name  = pg_catalog.btrim(coalesce(p_company_name, ''), v_ws),
         tax_id        = pg_catalog.btrim(coalesce(p_tax_id, ''), v_ws),
         store_name    = pg_catalog.btrim(coalesce(p_store_name, ''), v_ws),
         region        = pg_catalog.btrim(coalesce(p_region, ''), v_ws),
         contact_name  = pg_catalog.btrim(coalesce(p_contact_name, ''), v_ws),
         contact_phone = pg_catalog.btrim(coalesce(p_contact_phone, ''), v_ws),
         contact_email = pg_catalog.btrim(coalesce(p_contact_email, ''), v_ws),
         note          = pg_catalog.btrim(coalesce(p_note, ''), v_ws),
         updated_at    = pg_catalog.now()
   WHERE id = p_id
     AND user_id = v_uid
     AND status = 'pending';
  RETURN FOUND;
END;
$fn$;

-- ── 4. 客人:讀自己最新的一筆(不回 decided_by / decide_note —— 婉拒原因只給員工看)────
CREATE FUNCTION public.dealer_application_mine()
RETURNS TABLE (
  id            uuid,
  company_name  text,
  tax_id        text,
  store_name    text,
  region        text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  note          text,
  status        text,
  decided_at    timestamptz,
  created_at    timestamptz,
  updated_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'dealer_application_mine:沒有登入身分' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
  SELECT a.id, a.company_name, a.tax_id, a.store_name, a.region, a.contact_name, a.contact_phone,
         a.contact_email, a.note, a.status, a.decided_at, a.created_at, a.updated_at
    FROM public.dealer_applications a
   WHERE a.user_id = v_uid
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT 1;
END;
$fn$;

-- ── 5. 員工:核准 / 婉拒(同一個交易改等級與申請狀態)─────────────
-- 回:APPROVED / REJECTED / NOT_FOUND / ALREADY_DECIDED / STALE / WOULD_DOWNGRADE
--   · 只處理審核中的那一筆(FOR UPDATE 鎖住;兩個人同時按, 後到的拿到 ALREADY_DECIDED)
--   · 核准 = 等級改成 store(Q7 甲;後台顯示「車行」)。走既有 admin_set_customer_tier ⇒ 稽核紀錄與員工手動改的長得一樣。
--     p_expected_tier = 員工畫面上看到的現值;與實際不同 ⇒ STALE、零寫入。
--     現值是 premiumStore(後台「經銷」)⇒ 改成 store 會降級 ⇒ WOULD_DOWNGRADE、零寫入。
--     現值已是 store ⇒ 等級不變(NO_CHANGE), 申請照樣標已核准。
--   · 婉拒 = 原因必填(只給員工看), 等級不動。
CREATE FUNCTION public.admin_dealer_application_decide(
  p_application_id uuid,
  p_decision       text,
  p_note           text,
  p_actor          text,
  p_request_id     text,
  p_expected_tier  text,
  p_expected_updated_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_app      public.dealer_applications%ROWTYPE;
  v_tier     text;
  v_note     text;
  v_result   text;
  -- 空白字元集照抄 admin_set_customer_tier(20260914130000):btrim() 預設只剝 ASCII 空格,
  --   tab / 全形空白 / 零寬字元會讓「必填」與「婉拒原因」被一串看不見的字元騙過(Codex R1)。
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  v_note := pg_catalog.btrim(coalesce(p_note, ''), v_ws);
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:decision 只能是 approve 或 reject';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:缺 request_id';
  END IF;
  IF p_decision = 'reject' AND v_note = '' THEN
    RAISE EXCEPTION 'admin_dealer_application_decide:婉拒要填原因';
  END IF;

  SELECT * INTO v_app FROM public.dealer_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_app.status <> 'pending' THEN
    RETURN 'ALREADY_DECIDED';
  END IF;
  -- 🔴 員工核准的必須是【他看過的那一版】(Codex R1):他打開之後客人又改了公司名 / 統編 ⇒ STALE、零寫入。
  --   p_expected_updated_at 原樣回傳資料庫給的值(微秒), 不要先轉成 JS Date(只剩毫秒 ⇒ 每次都 STALE)。
  IF p_expected_updated_at IS DISTINCT FROM v_app.updated_at THEN
    RETURN 'STALE';
  END IF;

  -- 婉拒也讀等級, 稽核紀錄的快照才是真的(Codex R1:原本婉拒寫成 tier=null)
  SELECT c.tier::text INTO v_tier FROM public.customers c WHERE c.user_id = v_app.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  IF p_decision = 'approve' THEN
    IF p_expected_tier IS DISTINCT FROM v_tier THEN
      RETURN 'STALE';
    END IF;
    IF v_tier = 'premiumStore' THEN
      RETURN 'WOULD_DOWNGRADE';
    END IF;
    v_result := public.admin_set_customer_tier(
      v_app.user_id, 'store', '經銷商申請核准 #' || v_app.id::text, p_actor, p_request_id, v_tier);
    IF v_result NOT IN ('UPDATED', 'NO_CHANGE') THEN
      -- 前面已鎖住並比對過 ⇒ 理論上到不了;到了就整筆回滾, 不留半套
      RAISE EXCEPTION 'admin_dealer_application_decide:改等級回 %(預期 UPDATED / NO_CHANGE)', v_result;
    END IF;
  END IF;

  UPDATE public.dealer_applications
     SET status      = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by  = p_actor,
         decided_at  = pg_catalog.now(),
         decide_note = v_note,
         updated_at  = pg_catalog.now()
   WHERE id = v_app.id;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'dealer_application.decide',
    'dealer_application:' || v_app.id::text,
    pg_catalog.jsonb_build_object('status', 'pending', 'tier', v_tier),
    pg_catalog.jsonb_build_object('status', CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
                                  'tier', CASE WHEN p_decision = 'approve' THEN 'store' ELSE v_tier END),
    nullif(v_note, ''),
    p_request_id,
    'admin'
  );

  RETURN CASE WHEN p_decision = 'approve' THEN 'APPROVED' ELSE 'REJECTED' END;
END;
$fn$;

-- ── 6. 權限 ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.dealer_application_submit(text, text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.dealer_application_update_mine(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.dealer_application_mine() FROM PUBLIC, anon, service_role;
-- ACL-GATE-EXEMPT: public.dealer_application_submit -- 登入客人自己送申請, 身分取 auth.uid()(對照建表 20260925010000)
GRANT EXECUTE ON FUNCTION public.dealer_application_submit(text, text, text, text, text, text, text, text) TO authenticated;
-- ACL-GATE-EXEMPT: public.dealer_application_update_mine -- 登入客人改自己審核中的申請, 身分取 auth.uid()(對照建表 20260925010000)
GRANT EXECUTE ON FUNCTION public.dealer_application_update_mine(uuid, text, text, text, text, text, text, text, text) TO authenticated;
-- ACL-GATE-EXEMPT: public.dealer_application_mine -- 登入客人讀自己最新一筆, 身分取 auth.uid()(對照建表 20260925010000)
GRANT EXECUTE ON FUNCTION public.dealer_application_mine() TO authenticated;

REVOKE ALL ON FUNCTION public.admin_dealer_application_decide(uuid, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dealer_application_decide(uuid, text, text, text, text, text, timestamptz) TO service_role;

-- ── 7. 事後閘 ─────────────────────────────────────────────────
DO $post$
DECLARE
  r      text;
  v_cfg  text;
  -- 🔴 收權斷言清單:本檔建出來的【可授權物件】全部列在這裡(migration-static-checks ③ 會數)
  v_relations text[] := ARRAY['public.dealer_applications']::text[];
  v_functions text[] := ARRAY['public.dealer_application_submit(text, text, text, text, text, text, text, text)', 'public.dealer_application_update_mine(uuid, text, text, text, text, text, text, text, text)', 'public.dealer_application_mine()', 'public.admin_dealer_application_decide(uuid, text, text, text, text, text, timestamptz)']::text[];
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
  END LOOP;
  -- 表:anon / authenticated 零權限(表級與欄級);service_role 只有 SELECT
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    IF has_table_privilege(r, 'public.dealer_applications', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(r, 'public.dealer_applications', 'SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION '事後閘①:% 對 dealer_applications 有權限 ⇒ 停。', r;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.dealer_applications', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②:service_role 讀不到 dealer_applications ⇒ 後台列表會空 ⇒ 停。';
  END IF;
  IF has_table_privilege('service_role', 'public.dealer_applications', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION '事後閘③:service_role 能直接寫 dealer_applications ⇒ 繞過決定函式 ⇒ 停。';
  END IF;

  -- 客人三支:authenticated 叫得動, anon / service_role 叫不動;員工那支反過來
  FOREACH r IN ARRAY ARRAY[
    'public.dealer_application_submit(text, text, text, text, text, text, text, text)',
    'public.dealer_application_update_mine(uuid, text, text, text, text, text, text, text, text)',
    'public.dealer_application_mine()']::text[] LOOP
    IF NOT pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘④:% 的 EXECUTE 不對(只該給 authenticated)⇒ 停。', r;
    END IF;
  END LOOP;
  r := 'public.admin_dealer_application_decide(uuid, text, text, text, text, text, timestamptz)';
  IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑤:% 的 EXECUTE 不對(只該給 service_role)⇒ 停。', r;
  END IF;

  -- 四支都是 DEFINER 而且 search_path 空字串
  FOR r, v_cfg IN
    SELECT p.oid::regprocedure::text, pg_catalog.array_to_string(p.proconfig, ',') || CASE WHEN p.prosecdef THEN '' ELSE '|NOT-DEFINER' END
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('dealer_application_submit', 'dealer_application_update_mine',
                         'dealer_application_mine', 'admin_dealer_application_decide')
  LOOP
    IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION '事後閘⑥:% 的 search_path 設定是 %(期望空字串)⇒ 停。', r, v_cfg;
    END IF;
  END LOOP;

  -- 真的叫一次(沒有 auth.uid() ⇒ 應該 RAISE 28000, 而不是回資料)
  BEGIN
    PERFORM public.dealer_application_mine();
    RAISE EXCEPTION '事後閘⑦:沒有登入身分叫 dealer_application_mine 竟然沒擋 ⇒ 停。';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    NULL;
  END;
  -- 員工那支:不存在的 id ⇒ NOT_FOUND, 查詢有被規劃執行
  IF public.admin_dealer_application_decide(
       '00000000-0000-0000-0000-000000000000'::uuid, 'approve', '', 'migration-selftest', 'migration-selftest', 'general', NULL)
     IS DISTINCT FROM 'NOT_FOUND' THEN
    RAISE EXCEPTION '事後閘⑧:admin_dealer_application_decide 對不存在的 id 沒回 NOT_FOUND ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ dealer_applications 與四支函式建好。';
END
$post$;

COMMIT;
