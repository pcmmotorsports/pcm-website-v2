-- ============================================================
-- 經銷會員的品牌折扣:資料表與寫入函式(B2B 計畫 §10.2,片 E1)
-- ============================================================
-- plan:docs/plans/2026-09-23-b2b-subdomain-plan.md §10(Sean 2026-09-25 新增,「依推薦」)
-- 退回檔:supabase/rollbacks/20260925030000-rollback.sql(檔內第一行就是 SET LOCAL lock_timeout)
--
-- 每一位經銷會員各自設定「品牌 → 額外折扣 %」;沒設定的品牌不打折。本片只存資料,
-- 價格還沒有任何地方讀它(片 E2 才接進 get_effective_prices / 經銷目錄 / create_order)。
--
-- 權限照 20260925010000(經銷商申請)的形狀:
--   表 ⇒ anon / authenticated 零權限;service_role 只有 SELECT(後台列表)。
--   寫入只走 admin_dealer_brand_discounts_save, EXECUTE 只給 service_role;員工身分與「只限管理者」在後台 server action 驗。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.dealer_brand_discounts') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘①:public.dealer_brand_discounts 已存在 ⇒ 停(可能已貼過)。';
  END IF;
  IF pg_catalog.to_regclass('public.brands') IS NULL OR pg_catalog.to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.brands 或 public.customers ⇒ 停。';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.admin_audit_log ⇒ 停。';
  END IF;
END
$pre$;

-- ── 1. 表 ────────────────────────────────────────────────────
CREATE TABLE public.dealer_brand_discounts (
  customer_user_id  uuid          NOT NULL REFERENCES public.customers(user_id) ON DELETE CASCADE,
  -- 🔴 品牌那一側不 CASCADE(Codex E1 R1):刪品牌連帶刪折扣會繞過客人那一列的鎖、也不留稽核
  --    ⇒ 有經銷折扣的品牌刪不掉, 要先在後台把折扣清掉(走寫入函式, 有稽核)。
  brand_id          uuid          NOT NULL REFERENCES public.brands(id),
  -- 額外折扣 %, 最多小數一位;0 = 沒有這一列(不存 0, 刪掉那一列)
  percent           numeric(4,1)  NOT NULL,
  below_cost_reason text          NOT NULL DEFAULT '',
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  updated_by        text          NOT NULL,
  PRIMARY KEY (customer_user_id, brand_id),
  CONSTRAINT dealer_brand_discount_percent_check CHECK (percent > 0 AND percent < 100),
  CONSTRAINT dealer_brand_discount_reason_check CHECK (char_length(below_cost_reason) <= 500),
  CONSTRAINT dealer_brand_discount_updated_by_check CHECK (updated_by <> '')
);

COMMENT ON TABLE public.dealer_brand_discounts IS
  '經銷會員的品牌額外折扣(20260925030000;B2B 計畫 §10)。價格 = round(經銷價 × (100 − percent) ÷ 100)。anon / authenticated 零權限;service_role 只 SELECT;寫入只走 admin_dealer_brand_discounts_save。below_cost_reason 是成本相關, 只給管理者看。';

ALTER TABLE public.dealer_brand_discounts ENABLE ROW LEVEL SECURITY;
-- service_role 帶 BYPASSRLS;這條政策是給哪天拿掉它時用的(rls-service-role-policy-gate)
CREATE POLICY dealer_brand_discounts_service_role_select ON public.dealer_brand_discounts
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.dealer_brand_discounts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.dealer_brand_discounts TO service_role;

-- ── 2. 員工:整批儲存 ────────────────────────────────────────────
-- p_changes:[{ "brand_id": uuid, "percent": 數字 或 null(=刪除), "below_cost_reason": 文字 }, …]
-- p_expected:{ "<brand_id>": null(原本沒有設定) 或 { "percent", "below_cost_reason", "updated_at" }, … }
--   —— 員工畫面上看到的舊值。每一個要改的品牌都必須附上;任一筆與實際不同 ⇒ STALE, 整批零寫入。
-- 回:SAVED / NO_CHANGE / STALE / NOT_FOUND / NOT_DEALER
--   · 先鎖 customers 那一列(FOR UPDATE):兩個人同時新增原本沒有的品牌折扣也會排成一先一後(Codex 計畫 R1)。
--   · 新設或改 % 只限 tier = 'store'(後台「車行」, 經銷價那一級);刪除任何等級都可以。
--   · 同一批有重複品牌、% 超過一位小數、要改的品牌沒附 expected ⇒ RAISE(整批不寫)。
--   · 每一個真的有變的品牌寫一筆 admin_audit_log(dealer.brand_discount.change)。
CREATE FUNCTION public.admin_dealer_brand_discounts_save(
  p_customer   uuid,
  p_changes    jsonb,
  p_expected   jsonb,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tier     text;
  v_change   jsonb;
  v_brand    uuid;
  v_pct_raw  jsonb;
  v_pct      numeric;
  v_reason   text;
  v_exp      jsonb;
  v_cur      public.dealer_brand_discounts%ROWTYPE;
  v_found    boolean;
  v_seen     uuid[] := ARRAY[]::uuid[];
  v_written  integer := 0;
  -- 空白字元集照抄 20260925010000(= admin_set_customer_tier 那一組)
  v_ws constant text := E' \t\r\n\f\013' || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004' || U&'\2005' || U&'\2006'
    || U&'\2007' || U&'\2008' || U&'\2009' || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060' || U&'\3000' || U&'\FEFF';
BEGIN
  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'admin_dealer_brand_discounts_save:缺 customer';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_brand_discounts_save:缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_dealer_brand_discounts_save:缺 request_id';
  END IF;
  IF p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes) <> 'array' OR pg_catalog.jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'admin_dealer_brand_discounts_save:changes 要是非空陣列';
  END IF;
  IF pg_catalog.jsonb_array_length(p_changes) > 2000 THEN
    RAISE EXCEPTION 'admin_dealer_brand_discounts_save:一次最多 2000 個品牌';
  END IF;
  IF p_expected IS NULL OR pg_catalog.jsonb_typeof(p_expected) <> 'object' THEN
    RAISE EXCEPTION 'admin_dealer_brand_discounts_save:expected 要是物件';
  END IF;

  -- 🔴 先鎖客人那一列, 之後的比對與寫入都在這把鎖底下
  SELECT c.tier::text INTO v_tier FROM public.customers c WHERE c.user_id = p_customer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- 第一輪:驗格式、比對 expected。全部過了才寫(整批一起成立或一起不成立)
  FOR v_change IN SELECT pg_catalog.jsonb_array_elements(p_changes) LOOP
    -- 🔴 percent 鍵一定要在:只有明寫 JSON null 才是刪除;漏傳不能被當成刪除(Codex E1 R1)
    IF pg_catalog.jsonb_typeof(v_change) <> 'object' OR NOT (v_change ? 'brand_id') OR NOT (v_change ? 'percent') THEN
      RAISE EXCEPTION 'admin_dealer_brand_discounts_save:每一筆都要有 brand_id 與 percent(刪除請明寫 null)';
    END IF;
    v_brand := (v_change ->> 'brand_id')::uuid;
    IF v_brand = ANY (v_seen) THEN
      RAISE EXCEPTION 'admin_dealer_brand_discounts_save:同一批有重複品牌 %', v_brand;
    END IF;
    v_seen := v_seen || v_brand;

    v_pct_raw := v_change -> 'percent';
    IF v_pct_raw IS NOT NULL AND pg_catalog.jsonb_typeof(v_pct_raw) NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'admin_dealer_brand_discounts_save:percent 要是數字或 null';
    END IF;
    IF v_pct_raw IS NOT NULL AND pg_catalog.jsonb_typeof(v_pct_raw) = 'number' THEN
      v_pct := (v_pct_raw #>> '{}')::numeric;
      -- 🔴 numeric(4,1) 會把 7.55 靜靜進位成 7.6 ⇒ 超過一位小數在這裡拒絕, 不讓員工存到不是他填的數
      IF v_pct <= 0 OR v_pct >= 100 OR v_pct <> pg_catalog.round(v_pct, 1) THEN
        RAISE EXCEPTION 'admin_dealer_brand_discounts_save:percent 要大於 0、小於 100、最多一位小數(收到 %)', v_pct;
      END IF;
      IF v_tier <> 'store' THEN
        RETURN 'NOT_DEALER';
      END IF;
    END IF;
    v_reason := pg_catalog.btrim(coalesce(v_change ->> 'below_cost_reason', ''), v_ws);
    IF pg_catalog.char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'admin_dealer_brand_discounts_save:原因最多 500 字';
    END IF;

    IF NOT (p_expected ? v_brand::text) THEN
      RAISE EXCEPTION 'admin_dealer_brand_discounts_save:品牌 % 沒有附上畫面上的舊值', v_brand;
    END IF;
    v_exp := p_expected -> v_brand::text;

    SELECT * INTO v_cur FROM public.dealer_brand_discounts d
     WHERE d.customer_user_id = p_customer AND d.brand_id = v_brand;
    v_found := FOUND;
    IF pg_catalog.jsonb_typeof(v_exp) = 'null' THEN
      IF v_found THEN
        RETURN 'STALE';
      END IF;
    ELSE
      IF NOT v_found
         OR pg_catalog.jsonb_typeof(v_exp) <> 'object'
         OR (v_exp ->> 'percent')::numeric IS DISTINCT FROM v_cur.percent
         OR coalesce(v_exp ->> 'below_cost_reason', '') IS DISTINCT FROM v_cur.below_cost_reason
         OR (v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_cur.updated_at THEN
        RETURN 'STALE';
      END IF;
    END IF;
  END LOOP;

  -- 第二輪:寫入與稽核(只寫真的有變的)
  FOR v_change IN SELECT pg_catalog.jsonb_array_elements(p_changes) LOOP
    v_brand := (v_change ->> 'brand_id')::uuid;
    v_pct_raw := v_change -> 'percent';
    v_pct := CASE WHEN v_pct_raw IS NULL OR pg_catalog.jsonb_typeof(v_pct_raw) = 'null' THEN NULL
                  ELSE (v_pct_raw #>> '{}')::numeric END;
    v_reason := pg_catalog.btrim(coalesce(v_change ->> 'below_cost_reason', ''), v_ws);

    SELECT * INTO v_cur FROM public.dealer_brand_discounts d
     WHERE d.customer_user_id = p_customer AND d.brand_id = v_brand;
    v_found := FOUND;

    IF v_pct IS NULL THEN
      IF NOT v_found THEN
        CONTINUE;
      END IF;
      DELETE FROM public.dealer_brand_discounts d WHERE d.customer_user_id = p_customer AND d.brand_id = v_brand;
    ELSE
      IF v_found AND v_cur.percent = v_pct AND v_cur.below_cost_reason = v_reason THEN
        CONTINUE;
      END IF;
      INSERT INTO public.dealer_brand_discounts (customer_user_id, brand_id, percent, below_cost_reason, updated_at, updated_by)
      VALUES (p_customer, v_brand, v_pct, v_reason, pg_catalog.clock_timestamp(), p_actor)
      ON CONFLICT (customer_user_id, brand_id) DO UPDATE
        SET percent = EXCLUDED.percent,
            below_cost_reason = EXCLUDED.below_cost_reason,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by;
    END IF;

    INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
    VALUES (
      p_actor,
      'dealer.brand_discount.change',
      'customer:' || p_customer::text,
      CASE WHEN v_found
           THEN pg_catalog.jsonb_build_object('brand_id', v_brand::text, 'percent', v_cur.percent, 'below_cost_reason', v_cur.below_cost_reason)
           ELSE pg_catalog.jsonb_build_object('brand_id', v_brand::text, 'percent', NULL, 'below_cost_reason', '') END,
      pg_catalog.jsonb_build_object('brand_id', v_brand::text, 'percent', v_pct, 'below_cost_reason', CASE WHEN v_pct IS NULL THEN '' ELSE v_reason END),
      nullif(CASE WHEN v_pct IS NULL THEN '' ELSE v_reason END, ''),
      p_request_id,
      'admin'
    );
    v_written := v_written + 1;
  END LOOP;

  RETURN CASE WHEN v_written = 0 THEN 'NO_CHANGE' ELSE 'SAVED' END;
END;
$fn$;

-- ── 3. 權限 ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_dealer_brand_discounts_save(uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dealer_brand_discounts_save(uuid, jsonb, jsonb, text, text) TO service_role;

-- ── 4. 事後閘 ─────────────────────────────────────────────────
DO $post$
DECLARE
  r      text;
  v_cfg  text;
  -- 🔴 收權斷言清單:本檔建出來的【可授權物件】全部列在這裡(migration-static-checks ③ 會數)
  v_relations text[] := ARRAY['public.dealer_brand_discounts']::text[];
  v_functions text[] := ARRAY['public.admin_dealer_brand_discounts_save(uuid, jsonb, jsonb, text, text)']::text[];
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
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    IF has_table_privilege(r, 'public.dealer_brand_discounts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_any_column_privilege(r, 'public.dealer_brand_discounts', 'SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION '事後閘②:% 對 dealer_brand_discounts 有權限 ⇒ 停。', r;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.dealer_brand_discounts', 'SELECT')
     OR has_table_privilege('service_role', 'public.dealer_brand_discounts', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION '事後閘③:service_role 對 dealer_brand_discounts 應只有 SELECT ⇒ 停。';
  END IF;

  SELECT pg_catalog.array_to_string(p.proconfig, ',') || CASE WHEN p.prosecdef THEN '' ELSE '|NOT-DEFINER' END INTO v_cfg
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_dealer_brand_discounts_save(uuid, jsonb, jsonb, text, text)'::regprocedure;
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '事後閘④:admin_dealer_brand_discounts_save 的 search_path 設定是 %(期望空字串)⇒ 停。', v_cfg;
  END IF;

  -- 真的叫一次:不存在的客人 ⇒ NOT_FOUND
  IF public.admin_dealer_brand_discounts_save('00000000-0000-0000-0000-000000000000'::uuid,
       '[{"brand_id": "00000000-0000-0000-0000-000000000000", "percent": null}]'::jsonb,
       '{"00000000-0000-0000-0000-000000000000": null}'::jsonb, 'migration-selftest', 'migration-selftest')
     IS DISTINCT FROM 'NOT_FOUND' THEN
    RAISE EXCEPTION '事後閘⑤:對不存在的客人沒回 NOT_FOUND ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ dealer_brand_discounts 與寫入函式建好。';
END
$post$;

COMMIT;
