-- ============================================================
-- #954 換等級的「從 X」送給 RPC 比對 —— admin_set_customer_tier 第二代(加 p_expected_before)
--   (docs/phase-1-backlog.md:35890;plan docs/plans/plan-tier-change-stale-from.md;主視窗 2026-09-14 批 Q1 甲 / Q2 甲)
-- ============================================================
-- 為什麼:確認句「一般會員 → 店家會員」的「從」是開頁那一刻的快照;別人在中間把客人改成 premiumStore,
--   員工按下去做的是 premiumStore → store 一次他不知道的降級,畫面 ?r=saved。稽核對、當下零訊號。
-- 改什麼:簽章加第 6 參 p_expected_before text DEFAULT NULL;1d FOR UPDATE 現讀 v_before 之後、1e 之前比對,
--   不同回 'STALE'(零寫入零稽核)。其餘函式體逐字 = 20260717010000(v_ws 自檢 / 白名單 / note 規則 / 稽核 INSERT)。
-- 🔴 換簽章 = 新函式:CREATE OR REPLACE 不會蓋掉 5 參那支 ⇒ 先 DROP 5 參,再 CREATE 6 參,
--   COMMENT / REVOKE / GRANT / DO 自檢全部用 6 參簽章重貼(ACL 不會跟過來;docs/patterns/revoking-function-execute-in-supabase.md)。
--   customers 表級 / 欄級 UPDATE 那幾條(20260717010000 §2b)本支不動、自檢照舊留著。
-- 🔴 DEFAULT NULL 是刻意的 fail-open(只在部署間隙存在),理由寫在函式體 1d2。
-- 依賴:20260717010000(5 參那支在;本支 DROP 它)、20260523034911(member_tier enum)、20260712210000(admin_audit_log)。
-- 回滾:supabase/rollbacks/20260914130000_down.sql(DROP 6 參 + 逐字重貼 5 參 + ACL)。
-- ⏳ PENDING —— 只做不貼(主視窗 2026-09-14);貼的人是 Sean。
-- 🔴 整支包在 BEGIN … COMMIT 裡(txn-wrap-gate):DROP 之後任何一格紅 ⇒ 五參那支不會被留在半路。
-- ============================================================

BEGIN;

DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_customer_tier(uuid, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION '前置閘:5 參 admin_set_customer_tier 不在這台庫上(20260717010000 沒貼?)拒繼續';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_set_customer_tier(uuid, text, text, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:6 參 admin_set_customer_tier 已存在(本支貼過?)拒繼續';
  END IF;
END
$pre$;

DROP FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text);

CREATE FUNCTION public.admin_set_customer_tier(
  p_customer_user_id uuid,
  p_tier             text,
  p_note             text,
  p_actor            text,
  p_request_id       text,
  p_expected_before  text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴 本代改成空 search_path(definer-search-path-gate,2026-09-14):20260717010000 是 public, pg_temp。
--   函式體本來就全名(public.customers / public.admin_audit_log / public.member_tier / pg_catalog.*),換掉不影響行為。
SET search_path = ''
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
$$;

COMMENT ON FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text, text) IS
  'M-4a 客戶線 tier 編輯 第二代(#954):同 20260717010000,加 p_expected_before(NULL=不比對=舊行為;非 NULL 且 ≠ 現值 ⇒ STALE 零寫入)。回 UPDATED/NO_CHANGE/NOT_FOUND/STALE。EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_tier(uuid, text, text, text, text, text)
  TO service_role;

DO $post$
DECLARE
  -- 收權斷言清單(house 形狀;scripts/migration-static-checks.sh ③ 數這一個 ARRAY):本支只建一個可授權物件。
  v_functions text[] := ARRAY[
    'public.admin_set_customer_tier(uuid,text,text,text,text,text)'
  ]::text[];
  v_fn text;
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_customer_tier(uuid, text, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'admin_set_customer_tier 5 參那支還在;拒繼續';
  END IF;
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '% 沒建起來;拒繼續', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% ACL 異常 — service_role 應可 EXECUTE;拒繼續', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('public', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% ACL 異常 — anon / authenticated / PUBLIC 不應可 EXECUTE;拒繼續', v_fn;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.customers', 'UPDATE') THEN
    RAISE EXCEPTION 'customers ACL 異常 — service_role 不應有表級 UPDATE(tier 旁路);拒繼續';
  END IF;
  IF has_column_privilege('service_role', 'public.customers', 'tier', 'UPDATE') THEN
    RAISE EXCEPTION 'customers ACL 異常 — service_role 不應可 UPDATE tier(唯一路=admin_set_customer_tier);拒繼續';
  END IF;
END
$post$;

COMMIT;
