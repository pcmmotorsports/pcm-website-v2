-- #954 admin_set_customer_tier 第二代 回滾:DROP 6 參,逐字重貼 20260717010000 的 5 參 + COMMENT + ACL。
-- customers 表級 / 欄級 UPDATE 那幾條本支沒動過,這裡也不碰。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_customer_tier(uuid, text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:6 參 admin_set_customer_tier 不在這台庫上, 沒有東西可回滾';
  END IF;
END
$pre$;
DROP FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_set_customer_tier(
  p_customer_user_id uuid,
  p_tier             text,
  p_note             text,
  p_actor            text,
  p_request_id       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- 1e. 同值冪等:零寫入零稽核(double-submit 第二發 no-op、audit 無噪音列)。
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
$$;

COMMENT ON FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text) IS
  'M-4a 客戶線 tier 編輯(general/store/premiumStore 三檔互轉;Q1=A 不 step-up、Q2=A 備註必填,07-16 拍板)。SECURITY DEFINER owner RPC;鎖列讀 before → 同值回 NO_CHANGE 零寫入 → UPDATE 僅 SET tier 單欄 → 同交易寫 admin_audit_log(customer.tier.change、before/after={tier})。回 UPDATED/NO_CHANGE/NOT_FOUND。EXECUTE 僅 service_role。';

-- ── 2. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role(admin server 專用)──
REVOKE ALL ON FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text)
  TO service_role;
COMMIT;
