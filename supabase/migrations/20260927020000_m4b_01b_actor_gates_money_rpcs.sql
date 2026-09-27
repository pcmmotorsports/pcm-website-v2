-- 20260927020000_m4b_01b_actor_gates_money_rpcs.sql
-- M-4b-01 補強(接 20260915040000):四支碰錢的 RPC 在資料庫這一層補操作人檢查。
-- 主視窗 2026-09-27 夜跑派工;Sean 2026-09-19 劃線「資料庫權限類由我們依規則處理」(主視窗轉述)。
-- 盤點與正式庫現行定義的逐行核對:~/pcm-mailbox/計畫-改金額審核-20260927.md。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① admin_dealer_brand_discounts_save:加【管理者且在職】(寫法逐字抄 20260915040000 ①)。
--    9/25 起畫面只給管理者(apps/admin/src/lib/customers/brand-discount-actions.ts:34), 資料庫原本不擋。
-- ② admin_set_customer_tier、③ admin_adjust_wallet、④ admin_initiate_order_refund:加【操作人是在職員工】。
--    誰能做不變(Sean 2026-09-14 Q2 甲:這幾件維持員工能做), 只擋停用帳號。原本只驗「操作人非空」。
--    ② 另被 admin_dealer_application_decide、admin_dealer_account_create 在內部呼叫, 兩者都原樣傳入員工操作人 ⇒ 一起受檢(預期)。
--    正式庫 admin_audit_log 裡這幾類動作的操作人只有 sean、staff_1(2026-09-27 唯讀查), 沒有系統帳號呼叫。
-- 擋下時一律 RAISE '無權執行此操作'(與 20260915040000、staff RPC 同一句)。
--
-- ══ 基準 ═══════════════════════════════════════════════════
-- 🔴 四支本體逐字取自【正式庫現行定義】(2026-09-27 唯讀 pg_get_functiondef), 只在錨點後插入檢查。
--    為什麼不直接抄 repo 那一代:拋棄式 PG 從零重播時, 20260905110000(search_path 鎖定)與 20260906800000 在本機環境沒有完全套上,
--    重播出來的 admin_adjust_wallet 本體 md5 = ad55861b…(正式庫 = ae256739…), 兩支 search_path 也不同;
--    正式庫才是「repo 最新一代 + search_path 鎖定」的實際結果。前置閘釘正式庫的 md5, 對不上就停。
-- 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ header 逐字保留:四支都是 SET search_path = '',
--    ④ 另有 SET lock_timeout = '10s'(漏掉就會悄悄失去逾時)。後置閘逐支比對 proconfig。
-- 🔴 ACL 不動(CREATE OR REPLACE 保留);後置閘再驗 anon/authenticated 不能 EXECUTE、service_role 能。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- supabase/rollbacks/20260927020000-rollback.sql:四支貼回正式庫原版整支(前置閘釘本檔新版 md5)。回滾不動資料。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_expect constant text[][] := ARRAY[
    ['public.admin_dealer_brand_discounts_save(uuid,jsonb,jsonb,text,text)', 'f256b594adbe26ebfe9e1178007d1583'],
    ['public.admin_set_customer_tier(uuid,text,text,text,text,text)', '2a3a690e7ec7c9549762e230ca5bb9d6'],
    ['public.admin_adjust_wallet(uuid,text,integer,text,text,text)', 'ae2567393ca47e550ebe501644234d8a'],
    ['public.admin_initiate_order_refund(uuid,text,integer,bigint,bigint,text,text,text)', '6ad5549694cc49bc97b38958724e887a']
  ];
  i int; v_src text;
BEGIN
  FOR i IN 1 .. pg_catalog.array_length(v_expect, 1) LOOP
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_expect[i][1]);
    IF v_src IS NULL THEN
      RAISE EXCEPTION '前置閘一:% 不在 ⇒ 簽章不是我以為的', v_expect[i][1];
    END IF;
    IF v_src LIKE '%無權執行此操作%' THEN
      RAISE EXCEPTION '前置閘二:% 已含操作人檢查 ⇒ 這一片貼過了, 拒重貼', v_expect[i][1];
    END IF;
    IF pg_catalog.md5(v_src) <> v_expect[i][2] THEN
      RAISE EXCEPTION USING MESSAGE = '前置閘三:' || v_expect[i][1] || ' 本體 md5 不是 ' || v_expect[i][2] || '(實得 ' || pg_catalog.md5(v_src) || ')⇒ 有人動過它, 本檔抄本基準已失效, 停下人工對齊';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_active' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_manager' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘四:staff.is_active / is_manager 不在';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_dealer_brand_discounts_save(p_customer uuid, p_changes jsonb, p_expected jsonb, p_actor text, p_request_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_is_manager boolean;   -- 20260927020000
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
  -- 🔴 20260927020000:資料庫這一層也只准【管理者且在職】(9/25 畫面只給管理者, brand-discount-actions.ts:34;
  --    後台用 service_role, 直接打 PostgREST 就繞過畫面那道)。寫法逐字抄 20260915040000 ①。
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF NOT coalesce(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_customer_tier(p_customer_user_id uuid, p_tier text, p_note text, p_actor text, p_request_id text, p_expected_before text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- 空白字元集(本片 codex 關卡2 F2 補全集:樣板 20260716210000 的 6+6 集漏 U+1680/U+2000-200A/
  -- U+205F/U+200C/U+200D 等,冷門 Unicode 空白可繞過「必填」→ 改列 Unicode White_Space 全集
  -- + 零寬/格式字;note/actor/request_id 三參數同套。PG POSIX regex 無 \p{White_Space},只能顯式列舉。
  -- ⚠️ PG E'' 不支援 \v(會變字面字母 v、btrim 誤刪首尾 v;儲值金片 codex round2 實錘)→ 垂直 tab 用 \013。
  -- (儲值金 RPC 同洞補集=backlog #280、另片走動錢硬閘,本片不夾帶。)
  v_ws constant text := E' \t\r\n\f\013'  -- 6 ASCII:space/tab/CR/LF/FF/VT
    || U&'\0085'  -- NEL(C1 next line)
    || U&'\00A0'  -- NBSP
    || U&'\1680'  -- ogham space mark
    || U&'\180E'  -- mongolian vowel separator(舊制空白、現 format 字)
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'  -- en/em quad、en/em/three-per-em space
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'  -- four/six-per-em、figure、punctuation、thin
    || U&'\200A'  -- hair space
    || U&'\200B'  -- zero-width space
    || U&'\200C'  -- zero-width non-joiner
    || U&'\200D'  -- zero-width joiner
    || U&'\2028'  -- line separator
    || U&'\2029'  -- paragraph separator
    || U&'\202F'  -- narrow NBSP
    || U&'\205F'  -- medium mathematical space
    || U&'\2060'  -- word joiner
    || U&'\3000'  -- 全形空白
    || U&'\FEFF'; -- BOM/zero-width no-break
  v_tier   public.member_tier;
  v_note   text;
  v_before public.member_tier;
BEGIN
  -- 0. v_ws 自檢(codex round2 nit:註解宣稱不可執行 → 改函式內 fail-closed;字面漂移〔如 E'\v' 類
  --    事故重演摻進可見字元〕→ 全 RPC 拒用、fail-loud)。
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_set_customer_tier: v_ws 字元集長度異常(預期 31)';
  END IF;

  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;缺=拒,不以未知身分寫稽核)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_set_customer_tier: 缺 actor';
  END IF;
  -- 🔴 20260927020000:操作人必須是【在職】員工(誰能做不變, 只擋停用帳號;Sean 2026-09-14 Q2 甲 維持員工能做)。
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_set_customer_tier: 缺 request_id';
  END IF;
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_set_customer_tier: 缺 customer_user_id';
  END IF;

  -- 1b. tier 白名單:嚴格等值(不 trim=大小寫/空白變體天然 RAISE;'Store'/' store' 全拒),
  --     =enum member_tier 全集(20260523034911 L8);cast 在白名單後、不可能失敗。
  IF p_tier IS NULL OR p_tier NOT IN ('general', 'store', 'premiumStore') THEN
    RAISE EXCEPTION 'admin_set_customer_tier: tier 非法';
  END IF;
  v_tier := p_tier::public.member_tier;

  -- 1c. 變更原因備註必填(Sean Q2=A):v_ws trim 非空、≤200 字、拒控制字元(對齊儲值金 1d)。
  IF p_note IS NULL THEN
    RAISE EXCEPTION 'admin_set_customer_tier: 缺 note';
  END IF;
  v_note := pg_catalog.btrim(p_note, v_ws);
  IF v_note = '' THEN
    RAISE EXCEPTION 'admin_set_customer_tier: 變更原因必填';
  END IF;
  IF pg_catalog.char_length(v_note) > 200 OR v_note ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_set_customer_tier: 變更原因非法';
  END IF;

  -- 1d. 鎖列 + before 快照(同客並發變更序列化;查無 → 固定碼、讓 UI 顯示不存在)。
  SELECT tier
    INTO v_before
    FROM public.customers
   WHERE user_id = p_customer_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- 1d2. #954 從 X 比對(主視窗 2026-08-28 裁丙、2026-09-14 批 Q1 甲):
  --   後台確認句上的「從 X」是開頁快照;送進來跟 FOR UPDATE 之後現讀的 v_before 比,
  --   不同 = 別人剛改過 ⇒ 回 'STALE' 零寫入零稽核,UI 叫他重新確認。比對材料就是 1d 那把鎖裡讀的,不多一次往返。
  --   🔴 NULL = 不比對 = 本支之前的行為。這是刻意留的 fail-open,只為了貼板與 push dev 兩個順序都不擋員工
  --     (5 參舊後台叫得到、6 參新後台也叫得到);後台碼永遠送(tier-form.ts 缺 from ⇒ invalid,測試守)。
  --     兩邊都上線後第二支 migration 收成必填。
  --   非白名單值 RAISE(與 1b 同尺:嚴格等值不 trim)。
  IF p_expected_before IS NOT NULL THEN
    IF p_expected_before NOT IN ('general', 'store', 'premiumStore') THEN
      RAISE EXCEPTION 'admin_set_customer_tier: expected_before 非法';
    END IF;
    IF v_before <> p_expected_before::public.member_tier THEN
      RETURN 'STALE';
    END IF;
  END IF;

  -- 1e. 同值冪等:零寫入零稽核(audit 無噪音列)。
  --   ⚠️ 本代起 double-submit 第二發【走不到這裡】:它原封重送 from=舊值,在 1d2 先回 STALE —— 同樣零寫入零稽核,只是碼不同。
  IF v_before = v_tier THEN
    RETURN 'NO_CHANGE';
  END IF;

  -- 1f. 目的寫入:UPDATE 僅 SET tier 單欄(updated_at 由既有 customers_set_updated_at BEFORE UPDATE
  --     trigger 自動補=20260523034911 L262-264;本函式不碰其他欄)。
  UPDATE public.customers
     SET tier = v_tier
   WHERE user_id = p_customer_user_id;

  -- 1g. 同交易寫稽核(before/after={tier} 鍵名對稱;reason=備註;request_id 串 middleware)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'customer.tier.change',
    'customer:' || p_customer_user_id::text,
    pg_catalog.jsonb_build_object('tier', v_before::text),
    pg_catalog.jsonb_build_object('tier', v_tier::text),
    v_note,
    p_request_id,
    'admin'
  );

  RETURN 'UPDATED';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(p_customer_user_id uuid, p_entry_type text, p_amount integer, p_note text, p_actor text, p_request_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- 空白字元集(codex 關卡2 F2):btrim 預設只吃 ASCII 空白;service_role 直呼可用全形空白/NBSP/
  -- 零寬字繞過「必填」→ 顯式列舉 Unicode 空白+零寬集,note/actor/request_id 三參數同套。
  -- ⚠️ PG E'' 不支援 \v(會變字面字母 v、btrim 誤刪備註首尾 v;codex round2 抓)→ 垂直 tab 用八進位 \013。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\00A0'  -- NBSP
    || U&'\2007'  -- figure space
    || U&'\202F'  -- narrow NBSP
    || U&'\3000'  -- 全形空白
    || U&'\200B'  -- zero-width space
    || U&'\FEFF'; -- BOM/zero-width no-break
  v_entry_type     public.wallet_entry_type;
  v_note           text;
  v_before_balance integer;
  v_before_total   integer;
  v_after_balance  integer;
  v_after_total    integer;
  -- ⟦b4-WALLETDEDUPE⟧ 2026-09-06
  v_inserted       integer;   -- ON CONFLICT DO NOTHING 之後實際插了幾列(0 = 撞到同鍵)
  v_prior          public.customer_wallet_ledger%ROWTYPE;   -- 撞到時, 前一次那一列
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;缺=拒,不以未知身分寫稽核)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 actor';
  END IF;
  -- 🔴 20260927020000:操作人必須是【在職】員工(誰能做不變, 只擋停用帳號;Sean 2026-09-14 Q2 甲 維持員工能做)。
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 request_id';
  END IF;
  -- 🔴 ⟦b4-WALLETDEDUPE⟧:`p_request_id` 從「稽核關聯值」升格成**冪等鍵** ⇒ 形狀要收緊成 uuid。
  -- 🛑 **為什麼不能只驗「非空」**:非空的隨機字串每次都不同 ⇒ 唯一索引永遠不會撞
  --    ⇒ 去重**靜默失效**, 而 migration 貼了、索引建了、三綠全綠。fail-closed 在這裡。
  -- 🔵 呼叫端形狀同一道:`apps/admin/src/lib/customers/wallet-form.ts` 的 UUID_RE。
  IF p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: request_id 形狀不是 uuid';
  END IF;
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 customer_user_id';
  END IF;

  -- 1b. entry_type 白名單:僅 deposit / use('refund' 在 enum 內但本 RPC 拒收=UI 不開退款)。
  IF p_entry_type IS NULL OR p_entry_type NOT IN ('deposit', 'use') THEN
    RAISE EXCEPTION 'admin_adjust_wallet: entry_type 非 deposit/use';
  END IF;
  v_entry_type := p_entry_type::public.wallet_entry_type; -- enum cast(關卡1 note N2)

  -- 1c. 金額:符號一致(前置重述 wallet_amount_sign CHECK=縱深;deposit>0 / use<0,0 一律拒)
  --     + 單筆 sanity 上界 1,000 萬元(抓多零手滑、不擋真大額;D2 值班台建議維持,Sean 可改)。
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 amount';
  END IF;
  IF p_entry_type = 'deposit' AND p_amount <= 0 THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 加值金額須為正整數';
  END IF;
  IF p_entry_type = 'use' AND p_amount >= 0 THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 扣款金額須為負整數';
  END IF;
  IF pg_catalog.abs(p_amount) > 10000000 THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 金額超過單筆上限';
  END IF;

  -- 1d. 備註必填(Sean Q1=B):trim 非空、≤200 字、拒控制字元(對齊 invoice_number 紀律)。
  IF p_note IS NULL THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 note';
  END IF;
  v_note := pg_catalog.btrim(p_note, v_ws);
  IF v_note = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 備註必填';
  END IF;
  IF pg_catalog.char_length(v_note) > 200 OR v_note ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 備註非法';
  END IF;

  -- 1e. 鎖列 + before 快照(同客並發調整序列化;查無 → 固定碼、讓 UI 顯示不存在)。
  SELECT wallet_balance, total_deposit
    INTO v_before_balance, v_before_total
    FROM public.customers
   WHERE user_id = p_customer_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- 1f. INSERT ledger(🔴 餘額由既有 AFTER INSERT trigger 同步;本函式體零 UPDATE customers=禁裸覆寫;
  --     entry_date/created_at 走 DEFAULT;related_order_id 留 NULL=人工調整無關聯單)。
  INSERT INTO public.customer_wallet_ledger (customer_user_id, entry_type, amount, note, request_id)
  VALUES (p_customer_user_id, v_entry_type, p_amount, v_note, p_request_id)
  -- 🔴 **必須指定衝突目標**(codex 審 plan #13):裸 `ON CONFLICT DO NOTHING` 會把**別的**
  --    唯一衝突也一起吞掉 ⇒ 那時它會回一個看起來很正常的 'DUPLICATE', 而真相是另一個錯。
  -- 🔴🔴 **`WHERE request_id IS NOT NULL` 不能省** —— 鑽機當場抓到的真 bug:
  --    **partial 唯一索引要當 ON CONFLICT 的仲裁者, 衝突目標必須帶上【相符的 predicate】**,
  --    否則執行期報 `there is no unique or exclusion constraint matching the ON CONFLICT specification`。
  --    🛑 它是**執行期**才炸的 —— `CREATE OR REPLACE` 當下不紅、三綠不紅、前置閘與事後斷言也不紅。
  --    ⇒ 📌 **只有真的呼叫一次 RPC 才問得出來**(codex 審 plan 也沒抓到這條)。
  -- 🔴 **而這一行我修過兩次** —— 第一次修在【產生出來的 migration】上, 而不是這支產生器,
  --    下一次重新產生就把它**靜默還原**了(鑽機第二次抓到同一個錯)。
  --    ⇒ 📌 **修產物不修產生器 = 那個修法有一個看不見的到期日。**
  ON CONFLICT (customer_user_id, request_id) WHERE request_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    -- 🔴 **`ROW_COUNT = 0` 只證明「沒插入」, 不證明「同一筆已經完成」**(codex 審 plan #13)
    --    ⇒ 一定要把前一次那一列撈出來**逐欄比對**, 相符才算重送。
    SELECT * INTO v_prior
      FROM public.customer_wallet_ledger
     WHERE customer_user_id = p_customer_user_id
       AND request_id = p_request_id;
    IF NOT FOUND THEN
      -- 撞了唯一索引卻找不到那一列 = 我不知道發生什麼事 ⇒ fail-closed, 不要猜。
      RAISE EXCEPTION 'admin_adjust_wallet: 冪等鍵撞了而讀不到前一列';
    END IF;
    -- 🛑 **同一把鑰匙被拿去開別的門** —— 例如員工按上一頁、把金額改成 600 再送:
    --    token 相同而內容不同。這時**回 DUPLICATE 是錯的**(會讓他以為「已經處理過了」,
    --    而他這一次要做的那件事**根本沒有執行**)⇒ 一律 RAISE, 讓他看到不對勁。
    IF v_prior.entry_type IS DISTINCT FROM v_entry_type
       OR v_prior.amount   IS DISTINCT FROM p_amount
       OR v_prior.note     IS DISTINCT FROM v_note THEN
      -- 🔴 **帶專屬 ERRCODE**:呼叫端要分得出「這是內容不符」與「這是一般 DB 錯誤」——
      --    那兩者要讓員工做**相反**的動作(一個是停下來, 一個是放心再按一次)。
      --    ⇒ 📌 **不要讓 app 去比對訊息字串** —— 訊息會被改、會被翻譯, 而 SQLSTATE 不會。
      RAISE EXCEPTION 'admin_adjust_wallet: 同一個 request_id 帶著不同內容'
        USING ERRCODE = 'P9W01';
    END IF;
    -- 🔵 真的是重送 ⇒ **提前 RETURN**:不重複入帳、也不再寫一列稽核
    --    (這一發沒有改變任何東西;而「員工按了第二次」由 app 端的 attempt log 記著)。
    RETURN 'DUPLICATE';
  END IF;

  -- 1g. after 快照(鎖仍持有、trigger 已於 INSERT 語句內完成 → 重讀即調整後值)。
  SELECT wallet_balance, total_deposit
    INTO v_after_balance, v_after_total
    FROM public.customers
   WHERE user_id = p_customer_user_id;

  -- 1h. 同交易寫稽核(before/after=純狀態快照、鍵名對稱;操作參數可由差額+ledger 回查;reason=備註)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'customer.wallet.adjust',
    'customer:' || p_customer_user_id::text,
    pg_catalog.jsonb_build_object('wallet_balance', v_before_balance, 'total_deposit', v_before_total),
    pg_catalog.jsonb_build_object('wallet_balance', v_after_balance,  'total_deposit', v_after_total),
    v_note,
    p_request_id,
    'admin'
  );

  RETURN 'ADJUSTED';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_initiate_order_refund(p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '10s'
AS $function$
DECLARE
  v_actor    text;
  v_req      text;
  v_reason   text;
  v_ps       text;
  v_rec      text;
  v_frozen   integer;
  v_brid     text;
  v_row      public.order_refunds%ROWTYPE;
  v_id       uuid;
  v_conname  text;
  v_blocking uuid;
BEGIN
  -- 步 1. 輸入衛生(G11;RAISE 面,鏡像 A6 步 1;slug regex 拒 unicode ⇒ 裸 btrim 已足)
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 actor';
  END IF;
  v_actor := btrim(p_actor);
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: actor 非法(須為 staff slug)';
  END IF;
  -- 🔴 20260927020000:操作人必須是【在職】員工(誰能做不變, 只擋停用帳號;Sean 2026-09-14 Q2 甲 維持員工能做)。
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF p_request_id IS NULL
     OR p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 非法(須為 UUID v4 小寫;表單渲染時 server 發)';
  END IF;
  v_req := p_request_id;
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 reason';
  END IF;
  v_reason := btrim(p_reason);
  IF v_reason = '' OR char_length(v_reason) > 200 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: reason 非法(1-200 字、零控制字元)';
  END IF;

  -- 步 2. kind 與金額參數互斥(RAISE 面;fail-closed 嚴格互斥;損壞輸入=RAISE 非業務碼)
  IF p_kind IS NULL OR p_kind NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: kind 須為 full|partial(got %)', COALESCE(p_kind, '<null>');
  END IF;
  IF p_record_refunded_before IS NULL OR p_record_refunded_before < 0 THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: record_refunded_before 須為非負整數(G0 baseline;Record 欄缺時 action 必須 abort、不得傳 0 充數)';
  END IF;
  IF p_kind = 'partial' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 必須帶正整數 amount';
    END IF;
    IF p_record_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 不得帶 record_amount(凍結額=員工輸入額)';
    END IF;
    v_frozen := p_amount;
  ELSE  -- full
    IF p_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 不得帶 amount(凍結額=Record 剩餘額;plan G3)';
    END IF;
    IF p_record_amount IS NULL OR p_record_amount < 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 必須帶非負 record_amount(G0 那次 Record 的 amount;負值=損壞輸入)';
    END IF;
    IF p_record_amount > 2147483647 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: record_amount 超出 integer 範圍';
    END IF;
    v_frozen := p_record_amount::integer;   -- =0 時走步 6 的 NOTHING_LEFT(業務態非損壞)
  END IF;

  -- 🆕 2f-A. 訂單級序列化點(母 plan §3a-4/§3a-6a;plan §3-1)
  --   🔴 必須在步 3 之前:此刻手上**沒有任何列鎖** ⇒ 只可能「等 advisory」,
  --      不可能「持 orders 列鎖等 advisory」× close 持 advisory 等 orders = AB-BA 40P01。
  --   🔴 鍵式子與 2e(close_released_attempt)**逐字相同**,三方必須同一把鎖;
  --      不經 hashtext = 避 32-bit 碰撞讓不相干訂單共用隊伍。
  --   ⚠️ p_order_id 為 NULL 時鍵求值為 NULL、鎖不生效,步 3 隨即回 ORDER_NOT_FOUND(harness 釘住)。
  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(pg_catalog.replace(p_order_id::text, '-', ''), 1, 16))::bit(64)::bigint);

  -- 步 3. 鎖訂單(G1:FOR NO KEY UPDATE —— FOR UPDATE 與 FK RI KEY SHARE 死結 40P01 實錘;
  --   鎖順序沿既有約定 orders → order_refunds;INSERT trigger 的 FOR SHARE 同列同交易相容)
  SELECT o.payment_status::text, o.tappay_rec_trade_id
    INTO v_ps, v_rec
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_FOUND');
  END IF;

  -- 步 4. 查驗式冪等(G4;**先於一切業務前置** —— 重播必須拿到 DUPLICATE 而非被
  --   後續業務態遮蔽;以 S4 唯一鍵找列、逐欄比指紋)
  SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
  IF FOUND THEN
    IF v_row.order_id = p_order_id AND v_row.kind = p_kind
       AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec THEN
      IF v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: 該 request 的前次嘗試已終結為 %(deferred/failed 不得同鍵重放;請開新請求=新表單=新 token)', v_row.status;
    END IF;
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 已被使用且指紋不符(order/kind/金額/rec 任一變動;full 的凍結額會隨 Record 漂移 —— 金額已變動,請重新發起)';
  END IF;

  -- 步 5. 業務前置(友善碼面;P7C02/P7C03 仍是深層防線、不重複計門)
  IF v_ps = 'refunded' THEN
    RETURN jsonb_build_object('result', 'REFUND_LEDGER_FULL');   -- Sean Q1=A 硬擋(G12)
  END IF;
  IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_REFUNDABLE');
  END IF;
  IF v_rec IS NULL OR btrim(v_rec) = '' THEN
    RETURN jsonb_build_object('result', 'ORDER_NO_CARD_TRANSACTION');
  END IF;

  -- 步 6. full 的「已無可退」業務態(fable F2:凍 0 元會撞 refund_amount>0 CHECK 成裸錯)
  IF p_kind = 'full' AND v_frozen < 1 THEN
    RETURN jsonb_build_object('result', 'REFUND_NOTHING_LEFT');
  END IF;

  -- 🆕 2f-B. 跨帳本否決:payment_refunds(補償帳本)有在途 ⇒ 不開新的
  --   位置=步 6 之後、步 7 之前(plan §3-2a / §11 偏-4):
  --     下界 母 plan :290「必須晚於 G4」(早於 G4 會把合法重播的 DUPLICATE_REQUEST 變成被拒);
  --     上界「早於動錢」= 步 8 的 INSERT(步 5-7 無寫入、無外呼)。
  --     取區間最後一格 ⇒ LEDGER_FULL / NOT_REFUNDABLE / NO_CARD_TRANSACTION / NOTHING_LEFT
  --     四個具體診斷**優先於**籠統的 REFUND_IN_FLIGHT,與 order_refunds 那半(步 8 才擋)一致。
  --   🔴 只做 payment_refunds 這半:order_refunds 那半已由唯一索引
  --      order_refunds_single_processing_per_order 在步 8 擋住(plan §1-4),再加一道會被它嚴格蘊含。
  --   🔴 複用既有回傳碼 REFUND_IN_FLIGHT,**不新增第 9 碼**:8 碼全集是呼叫端合約
  --      (本檔 COMMENT + apps/admin/src/lib/payment/refund-repository.ts:17-26 allowlist,:211 未知碼 throw)。
  SELECT pr.id
    INTO v_blocking
    FROM public.payment_refunds pr
    JOIN public.payment_charge_attempts a ON a.id = pr.attempt_id
   WHERE a.order_id = p_order_id
     -- 終局判定一律消費 canonical view(沖銷片 §2d-1 契約;本函式不自行判讀 manual)
     AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                      WHERE et.refund_id = pr.id)
     -- 🔴 已被沿鏈接手的舊列不算在途:母 plan :483-489 的重試路徑(delta 說沒退 ⇒ 沿鏈開新根)
     --    **沒有任何一步給舊列寫終局** ⇒ 少這條,走過一次設計內重試的訂單會被**永久**擋死。
     AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s
                      WHERE s.supersedes_refund_id = pr.id)
     -- 🔴 Sean Q-2f-2 = B(2026-08-12,複判維持):**已受理即不算在途**。
     --    result_success 不在 canonical view 的終局集合(20260811110000:197-198)⇒ 只能直讀 events。
     --    這是本函式**唯一**獲准直讀的 event_type(carve-out,後置錨釘死);
     --    它是**受理判定**、不是終局判定,不得當成「終局」的同義詞。
     AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                      WHERE e.refund_id = pr.id AND e.event_type = 'result_success')
   -- 無 ORDER BY 的 LIMIT 1 回哪一列由計畫決定 ⇒ blocking id 會飄、測試 flake、對帳對不起來
   ORDER BY pr.created_at, pr.id
   LIMIT 1;
  IF v_blocking IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'REFUND_IN_FLIGHT',
                              'blocking_payment_refund_id', v_blocking);
  END IF;

  -- 步 7. bank_refund_id 生成(G2:rotation-always 一列一鍵;16 bytes→base64→+/→ab→截 20
  --   = 恰 20 字 [A-Za-z0-9ab]、熵 ≥90-bit;生成即形狀,不設驗證(恆真=死規則,關卡2 折入);
  --   撞鍵由 UNIQUE 承接、機率天文小、fail-loud)
  v_brid := substr(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', 'ab'), 1, 20);

  -- 步 8. 單列 INSERT(S5/S4 撞鍵在此收斂成具名結果;其餘 unique 撞鍵 fail-loud)
  BEGIN
    INSERT INTO public.order_refunds
      (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor,
       request_id, kind, record_refunded_before)
    VALUES
      (p_order_id, v_brid, v_rec, v_frozen, 'processing', v_reason, v_actor,
       v_req, p_kind, p_record_refunded_before)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_conname = CONSTRAINT_NAME;
    IF v_conname = 'order_refunds_single_processing_per_order' THEN
      RETURN jsonb_build_object('result', 'REFUND_IN_FLIGHT');   -- 接線債②:同單已有進行中退款
    END IF;
    IF v_conname = 'order_refunds_request_id_key' THEN
      -- 同 token 併發競態:另一連線剛插入 ⇒ 重跑步 4 的查驗(嚴格同判準)
      SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
      IF FOUND AND v_row.order_id = p_order_id AND v_row.kind = p_kind
         AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec
         AND v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: request_id 併發撞鍵且查驗不過;拒繼續';
    END IF;
    RAISE;  -- bank_refund_id 撞鍵等 = 異常,fail-loud
  END;

  -- 步 9. 同交易稽核(G9;audit INSERT 不包 EXCEPTION handler —— 失敗必整筆 rollback)
  -- 🔴 audit.reason 一律 NULL(零自由文字/零 PII;退款理由存帳本列 reason 欄、RLS 保護;
  --    關卡2 codex MF3 折入)。after 恰 8 鍵、全部取自實際寫入值。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.initiate', 'order:' || p_order_id::text, NULL,
          jsonb_build_object(
            'order_id', p_order_id,
            'refund_row_id', v_id,
            'kind', p_kind,
            'refund_amount', v_frozen,
            'rec_trade_id', v_rec,
            'bank_refund_id', v_brid,
            'record_refunded_before', p_record_refunded_before,
            'request_id', v_req),
          NULL, v_req, 'admin');

  RETURN jsonb_build_object('result', 'INITIATED', 'refund_id', v_id,
    'bank_refund_id', v_brid, 'refund_amount', v_frozen, 'status', 'processing');
END;
$function$;

DO $post$
DECLARE
  v_functions constant text[] := ARRAY['public.admin_dealer_brand_discounts_save(uuid,jsonb,jsonb,text,text)', 'public.admin_set_customer_tier(uuid,text,text,text,text,text)', 'public.admin_adjust_wallet(uuid,text,integer,text,text,text)', 'public.admin_initiate_order_refund(uuid,text,integer,bigint,bigint,text,text,text)']::text[];
  r text; v_src text; v_config text[]; v_secdef boolean; v_want text[];
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.prosrc, p.proconfig, p.prosecdef INTO v_src, v_config, v_secdef
      FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_src IS NULL THEN
      RAISE EXCEPTION '後置閘一:% 不存在', r;
    END IF;
    IF v_src NOT LIKE '%無權執行此操作%' OR v_src NOT LIKE '%20260927020000%' THEN
      RAISE EXCEPTION '後置閘二:% 本體沒有本檔的操作人檢查', r;
    END IF;
  IF r = 'public.admin_dealer_brand_discounts_save(uuid,jsonb,jsonb,text,text)' THEN v_want := ARRAY['search_path=""']::text[];
  ELSIF r = 'public.admin_set_customer_tier(uuid,text,text,text,text,text)' THEN v_want := ARRAY['search_path=""']::text[];
  ELSIF r = 'public.admin_adjust_wallet(uuid,text,integer,text,text,text)' THEN v_want := ARRAY['search_path=""']::text[];
  ELSIF r = 'public.admin_initiate_order_refund(uuid,text,integer,bigint,bigint,text,text,text)' THEN v_want := ARRAY['search_path=""', 'lock_timeout=10s']::text[];
    END IF;
    IF NOT v_secdef OR v_config IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION '後置閘三:% 不是 SECURITY DEFINER 或 SET 子句被換掉(實得 %, 應為 %)', r, v_config, v_want;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘五:% service_role 不能 EXECUTE ⇒ 後台接線斷了', r;
    END IF;
  END LOOP;
  -- 正對照:範本函式含同一句(20260915040000 貼過)。行為測試在 supabase/tests/database/m4b01b_actor_gates.test.sql。
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_update_order_item_amount(uuid,uuid,integer,integer,text,text,text)');
  IF v_src IS NULL OR v_src NOT LIKE '%無權執行此操作%' THEN
    RAISE EXCEPTION '後置閘六:正對照 admin_update_order_item_amount 不在或不含那一句 ⇒ 這把尺壞了';
  END IF;
END
$post$;

COMMIT;
