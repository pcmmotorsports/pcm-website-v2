-- ============================================================
-- M-4a 客戶線:tier 編輯 — admin_set_customer_tier owner RPC
--   (customers.tier 三檔互轉;UPDATE 單欄 + admin_audit_log INSERT 同交易;同值冪等 NO_CHANGE 零寫入)
-- ============================================================
-- 真權威:pcm-tools/review-inbox/m4a-tier-edit-plan.md + .verdict.md(關卡1 R1 PASS 0 must-fix、3 note 折入)
--        + m4a-tier-edit-decisions-directive.md。
-- Sean 拍板(07-16、memory project_m4a-tier-edit-decisions):
--   Q1=A 本片不 step-up(寫入閘=admin server 端 authorizeAdminMutation 既有三段);Q2=A 變更原因備註必填。
-- 鐵則 8(新 SECURITY DEFINER RPC + GRANT + 寫 customers.tier)+ 鐵則 12(會員 tier+RPC+GRANT)。
-- 依賴:20260523034911(customers 表 + member_tier enum('general','store','premiumStore')+
--        customers_set_updated_at BEFORE UPDATE trigger;live 已 apply)、
--        20260712210000(admin_audit_log;live 已 apply 在用)。
-- 樣板:20260716210000 admin_adjust_wallet(SECURITY DEFINER + search_path 鎖定 + v_ws Unicode 空白集
--        + REVOKE→GRANT service_role only + fail-closed DO 斷言 + 同交易 audit;prod 交易模擬全 PASS)。
--
-- 🔴 與儲值金片相反:本函式 UPDATE public.customers SET tier=目的寫入(tier 無 ledger/trigger 同步路,
--   直寫單欄+同交易稽核=正路);「禁裸覆寫」=全 repo 唯一 tier 寫入路=本 RPC,兩層保證:
--   app 層(adapter update patch 白名單僅 name/phone/birthday;grep 驗)+ **DB 層(本檔 §2b,codex 關卡2
--   F1 折入)**:REVOKE service_role 對 customers 的表級 UPDATE → 只回 GRANT 欄級(name,phone,birthday,
--   updated_at;鏡像 authenticated 既有欄級慣例 20260523034911 L229-232)→ 持 service key 也**無法**
--   `.from('customers').update({tier})` 繞過 RPC+audit(RPC 本身 SECURITY DEFINER 以 owner 執行、不受影響)。
-- 🔴 同值冪等:new tier = 現值 → RETURN 'NO_CHANGE'、零 UPDATE 零 audit(tier 無「重複入帳」語意,
--   double-submit 第二發天然 no-op;audit 不產噪音列)。
-- 🔴 前台連動零:storefront 讀 tier 走 cookie(#215 defer 至 M-2-08、STATUS Blocker 欄)+經銷價 dummy 0
--   → 本 RPC 上線後改 tier 僅影響 admin 顯示+稽核,真 pricing 生效=M-2-08。
-- 🔴 安全模型(對齊 sibling family 20260714130000/20260716210000):
--   ① SECURITY DEFINER + SET search_path=public,pg_temp;函式體物件全 public. 限定(縱深)。
--   ② EXECUTE:REVOKE ALL FROM PUBLIC/anon/authenticated → 只 GRANT service_role(admin server 專用)
--      + has_function_privilege fail-closed DO 斷言。
--   ③ 並發:SELECT ... FOR UPDATE 鎖 customers 列 → 同客並發變更序列化;before 快照同一把鎖內讀。
--   ④ 稽核同交易:UPDATE + admin_audit_log INSERT 同函式體=同交易 COMMIT/ROLLBACK,缺筆不可能;
--      before/after={tier} 鍵名對稱;reason=備註(必填=Sean Q2=A)。
--   ⑤ 錯誤收斂:業務結果回固定碼('UPDATED'/'NO_CHANGE'/'NOT_FOUND');輸入非法一律 RAISE 通用訊息
--      (不洩欄值/約束名)。
--
-- 🔴 尚未 apply(等 Sean db push);部署硬順序=commit 壓住不推 → Sean db push → 值班台驗
--   (函式在/ACL/交易模擬、見檔尾斷言清單)→ 放行代推。
-- 🔴 無顯式 BEGIN;/COMMIT;(supabase CLI ExecBatch 隱式交易;顯式 COMMIT 撞 history 登記)。
-- ============================================================

-- ── 1. admin_set_customer_tier:後台會員等級變更 owner RPC ──────────────────
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

-- ── 2b. customers 欄級 ACL 收斂(codex 關卡2 F1 折入):封死 service_role 裸 UPDATE tier 旁路 ──
-- 動機:service_role 對 customers 表級 UPDATE 預設全開(Supabase 預設)+ BYPASSRLS → 持 service key
--   可 `.from('customers').update({tier})` 繞過本 RPC 與 audit。收斂=表級 UPDATE 撤掉、只回欄級
--   (鏡像 authenticated 慣例=name/phone/birthday/updated_at;20260523034911 L229-232)。
-- 影響面查核(寫進 migration 供審計):
--   * SupabaseCustomerAdapter.update patch 白名單=name/phone/birthday → 欄級 GRANT 完整涵蓋、不壞;
--   * wallet_balance/total_deposit 由 ledger trigger(SECURITY DEFINER、owner)寫 → 不受影響;
--   * 本 RPC/admin_adjust_wallet/create_order 皆 SECURITY DEFINER owner 執行 → 不受影響;
--   * SELECT/INSERT/DELETE 表級權限不動(admin 讀全客、auth.users trigger 建列走 owner)。
REVOKE UPDATE ON TABLE public.customers FROM service_role;
GRANT UPDATE (name, phone, birthday, updated_at) ON TABLE public.customers TO service_role;

-- ── 3. fail-closed 斷言:EXECUTE ACL + customers 欄級 UPDATE 終態 ─────────────
DO $$
BEGIN
  IF NOT has_function_privilege('service_role',
      'public.admin_set_customer_tier(uuid, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_customer_tier ACL 異常 — service_role 應可 EXECUTE(admin 寫入路徑);拒繼續';
  END IF;
  IF has_function_privilege('anon',
      'public.admin_set_customer_tier(uuid, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_customer_tier ACL 異常 — anon 不應可 EXECUTE;拒繼續';
  END IF;
  IF has_function_privilege('authenticated',
      'public.admin_set_customer_tier(uuid, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_set_customer_tier ACL 異常 — authenticated 不應可 EXECUTE(會員不改自己 tier);拒繼續';
  END IF;
  -- §2b 終態:service_role 表級 UPDATE 已撤、tier/wallet 欄不可 UPDATE、白名單欄仍可(正控防誤殺 adapter)。
  IF has_table_privilege('service_role', 'public.customers', 'UPDATE') THEN
    RAISE EXCEPTION 'customers ACL 異常 — service_role 不應有表級 UPDATE(tier 旁路);拒繼續';
  END IF;
  IF has_column_privilege('service_role', 'public.customers', 'tier', 'UPDATE') THEN
    RAISE EXCEPTION 'customers ACL 異常 — service_role 不應可 UPDATE tier(唯一路=admin_set_customer_tier);拒繼續';
  END IF;
  IF has_column_privilege('service_role', 'public.customers', 'wallet_balance', 'UPDATE')
     OR has_column_privilege('service_role', 'public.customers', 'total_deposit', 'UPDATE') THEN
    RAISE EXCEPTION 'customers ACL 異常 — service_role 不應可 UPDATE wallet 欄(唯一路=ledger trigger);拒繼續';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.customers', 'name', 'UPDATE') THEN
    RAISE EXCEPTION 'customers ACL 異常 — service_role 應可 UPDATE name(adapter patch 白名單);拒繼續';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.customers', 'SELECT') THEN
    RAISE EXCEPTION 'customers ACL 異常 — service_role 應可 SELECT(admin 讀全客);拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、手動執行):
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_set_customer_tier(uuid, text, text, text, text);
--   REVOKE UPDATE (name, phone, birthday, updated_at) ON TABLE public.customers FROM service_role;
--   GRANT UPDATE ON TABLE public.customers TO service_role;  -- 回復 §2b 前的表級 UPDATE(Supabase 預設)
-- COMMIT;
-- (零表結構改動;已寫入的 audit 列=正常稽核資料、不回滾;已改的 tier 值=業務資料、如需回改走本 RPC 反向操作留稽核。)
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(值班台 db push 後驗;BEGIN → synthetic customer → 逐條 → ROLLBACK → 零留痕):
-- 1. EXECUTE ACL:service_role=true、anon=false、authenticated=false(§3 DO 已斷言,模擬獨立再查)。
-- 1b. customers 欄級 ACL(§2b):has_table_privilege('service_role','customers','UPDATE')=false、
--    has_column_privilege tier/wallet_balance/total_deposit=false、name/phone/birthday/updated_at=true;
--    行為驗=SET LOCAL ROLE service_role 後 `UPDATE customers SET tier=...` 應報 permission denied、
--    `UPDATE customers SET name=...` 應成功(正控;⚠️ pooled MCP SET ROLE 呼 SECDEF 會斷線
--    〔memory reference_pooled-mcp-set-role-secdef-terminates〕,此處 UPDATE 非 SECDEF 呼叫、可直測,
--    斷線時改 has_column_privilege 論證等價)。
-- 2. 三檔互轉 happy path:general→store→premiumStore→general 各回 'UPDATED';每次 customers.tier 實變、
--    audit +1 列(action='customer.tier.change'、target='customer:<uuid>'、before/after={tier} 前後值精確、
--    reason=note、request_id 對、source_app='admin')。
-- 2b. updated_at:happy path 後 customers.updated_at 已被 BEFORE UPDATE trigger 更新(verdict N2;
--    驗 trigger 對 RPC 路也生效)。
-- 3. 同值冪等:現值 general 再送 'general' → 'NO_CHANGE';customers 零變(updated_at 不動)、audit 零列。
-- 4. 拒收矩陣(全 RAISE、customers/audit 零寫入):非法 tier('Store'/'STORE'/' store'/'store '/
--    'premium_store'/''/亂字串)/ 空 note / note >200 字 / note 含控制字元 / 缺 actor / 缺 request_id。
-- 4b. Unicode 空白繞過(F2 補集後全驗):note/actor/request_id 各以「純 NBSP(U+00A0)」「純全形空白
--    (U+3000)」「純 tab/newline」「純垂直 tab U+000B」「純零寬 U+200B」「純 U+FEFF」
--    「純 ogham U+1680」「純 en quad U+2000」「純 MMSP U+205F」「純 ZWNJ U+200C」「純 word joiner
--    U+2060」呼叫 → 全 RAISE(v_ws 全集擋)。
-- 4c. v_ws 字面正確性:note='vip客戶v' → 稽核 reason 首尾 v **保留**(E'' 無 \v、已用 \013;
--    若見 v 被刪=v_ws 摻進字母 v=立即 FAIL);長度自檢=函式體 §0 每呼叫斷言 char_length(v_ws)=31
--    (6 escape 集+25 Unicode 字元;happy path 能跑通即證明自檢過)。
-- 5. 查無客戶:隨機 uuid → 'NOT_FOUND'、零寫入。
-- 6. UPDATE 單欄:pg_get_functiondef grep 驗函式體僅一個 UPDATE、僅 SET tier(無其他欄、無第二 UPDATE)。
-- 7. ROLLBACK 後零留痕:synthetic customer / audit 消失;函式定義本身由 db push 保留。
-- ============================================================
