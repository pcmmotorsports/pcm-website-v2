-- ============================================================
-- M-4a 客戶線:儲值金編輯 — admin_adjust_wallet owner RPC
--   (加值 deposit / 扣款 use 兩語意;ledger INSERT + admin_audit_log INSERT 同交易;餘額只走既有 trigger)
-- ============================================================
-- 真權威:pcm-tools/review-inbox/m4a-wallet-edit-plan.md + verdict(關卡1 R1 PASS 0 must-fix、3 note 已折入)。
-- Sean 拍板(07-16、memory project_wallet-deposit-taiwan-legal-hold):
--   Q1=B 加值/扣款兩鈕+金額+備註必填+允許扣成負餘額(不做「直接改餘額數字」);Q2=A 本片不 step-up。
-- 鐵則 8(新 SECURITY DEFINER RPC + GRANT)+ 鐵則 12(動錢+RPC+GRANT)。
-- 依賴:20260523034911(customer_wallet_ledger 表 + wallet_entry_type enum + wallet_amount_sign CHECK +
--        on_wallet_ledger_inserted trigger〔sync_wallet_balance_on_ledger_insert:balance += NEW.amount、
--        total_deposit 只累 deposit〕;live 已 apply)、20260712210000(admin_audit_log;live 已 apply 在用)。
-- 樣板:20260714130000 admin_update_order_workflow(SECURITY DEFINER + search_path 鎖定 + REVOKE→GRANT
--        service_role only + fail-closed DO 斷言 + 同交易 audit;prod 實證運轉)。
--
-- 🔴 禁裸覆寫(硬性、plan 驗收 2):本函式體**零 UPDATE public.customers**——餘額/累積儲值唯一同步路
--   = 既有 AFTER INSERT trigger(SECURITY DEFINER、search_path='');RPC 只 INSERT ledger。
--   wallet_amount_sign CHECK(deposit>0 / use<0 / refund>0)= 最後防線,本函式前置重述=縱深。
-- 🔴 負餘額 = 拍板行為:customers.wallet_balance 無下界 CHECK、trigger 純加總 → 扣款可扣成負數(內部彈性、
--   負數照記);本檔不加任何下界擋。
-- 🔴 refund 不開:enum 有 'refund' 但本 RPC 白名單只收 deposit/use;退款語意等後續片。
-- 🔴 安全模型(對齊 sibling family):
--   ① SECURITY DEFINER + SET search_path=public,pg_temp;函式體物件全 public. 限定(縱深)。
--   ② EXECUTE:REVOKE ALL FROM PUBLIC/anon/authenticated → 只 GRANT service_role(admin server 專用)
--      + has_function_privilege fail-closed DO 斷言。
--   ③ 並發:SELECT ... FOR UPDATE 鎖 customers 列 → 同客並發調整序列化;before/after 快照同一把鎖內讀
--      (AFTER ROW trigger 在 INSERT 語句內完成 → 後續重讀=after 正確)。
--   ④ 稽核同交易:ledger INSERT + admin_audit_log INSERT 同函式體=同交易 COMMIT/ROLLBACK,缺筆不可能;
--      before/after=純狀態快照 {wallet_balance,total_deposit}、鍵名對稱(關卡1 note N3);reason=備註。
--   ⑤ 錯誤收斂:業務失敗回固定碼('NOT_FOUND');輸入非法 → RAISE 通用訊息(不洩欄值/約束名)。
--
-- 🔴 尚未 apply(等 Sean db push);部署硬順序=commit 壓住不推 → Sean db push → 值班台驗
--   (函式在/ACL/交易模擬、見檔尾斷言清單)→ 放行代推。
-- 🔴 無顯式 BEGIN;/COMMIT;(supabase CLI ExecBatch 隱式交易;顯式 COMMIT 撞 history 登記)。
-- ============================================================

-- ── 1. admin_adjust_wallet:後台儲值金調整 owner RPC ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  p_customer_user_id uuid,
  p_entry_type       text,
  p_amount           integer,
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
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;缺=拒,不以未知身分寫稽核)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 request_id';
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
  INSERT INTO public.customer_wallet_ledger (customer_user_id, entry_type, amount, note)
  VALUES (p_customer_user_id, v_entry_type, p_amount, v_note);

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
$$;

COMMENT ON FUNCTION public.admin_adjust_wallet(uuid, text, integer, text, text, text) IS
  'M-4a 客戶線儲值金編輯(加值 deposit>0 / 扣款 use<0;refund 拒收)。SECURITY DEFINER owner RPC;備註必填、單筆上限 1,000 萬、允許扣成負餘額(07-16 拍板)。鎖列讀 before → INSERT customer_wallet_ledger(餘額只走 on_wallet_ledger_inserted trigger、函式體零 UPDATE customers)→ 重讀 after → 同交易寫 admin_audit_log。回 ADJUSTED/NOT_FOUND。EXECUTE 僅 service_role。';

-- ── 2. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role(admin server 專用)──
REVOKE ALL ON FUNCTION public.admin_adjust_wallet(uuid, text, integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet(uuid, text, integer, text, text, text)
  TO service_role;

-- ── 3. fail-closed 斷言:EXECUTE ACL 終態 ─────────────────────────────────
DO $$
BEGIN
  IF NOT has_function_privilege('service_role',
      'public.admin_adjust_wallet(uuid, text, integer, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_adjust_wallet ACL 異常 — service_role 應可 EXECUTE(admin 寫入路徑);拒繼續';
  END IF;
  IF has_function_privilege('anon',
      'public.admin_adjust_wallet(uuid, text, integer, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_adjust_wallet ACL 異常 — anon 不應可 EXECUTE;拒繼續';
  END IF;
  IF has_function_privilege('authenticated',
      'public.admin_adjust_wallet(uuid, text, integer, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_adjust_wallet ACL 異常 — authenticated 不應可 EXECUTE(會員不動儲值金);拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、手動執行):
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_adjust_wallet(uuid, text, integer, text, text, text);
-- COMMIT;
-- (零表改動;已寫入的 ledger/audit 列=正常業務資料、不回滾。)
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(值班台 db push 後驗;BEGIN → synthetic customer → 逐條 → ROLLBACK → 零留痕):
-- 1. EXECUTE ACL:service_role=true、anon=false、authenticated=false(§3 DO 已斷言,模擬獨立再查)。
-- 2. 加值:('deposit', +500, note) → 'ADJUSTED';ledger +1 列(entry_type=deposit/amount=500/note 對)、
--    customers.wallet_balance +500、total_deposit +500;audit +1 列(action='customer.wallet.adjust'、
--    target='customer:<uuid>'、before/after 快照差=+500、reason=note、source_app='admin')。
-- 3. 扣款:('use', -300, note) → 'ADJUSTED';balance -300、total_deposit 不變(trigger 只累 deposit)。
-- 4. 負餘額:balance=0 時扣款 → 'ADJUSTED'、balance 為負(拍板行為、無下界擋)。
-- 5. 拒收矩陣(全 RAISE、ledger/audit 零寫入):refund / 未知 entry_type / deposit 配 0 或負值 /
--    use 配 0 或正值 / abs>10,000,000 / note 空白或 >200 字或含控制字元 / 缺 actor / 缺 request_id。
-- 5b. Unicode 空白繞過(codex F2):note/actor/request_id 各以「純 NBSP(U+00A0)」「純全形空白(U+3000)」
--    「純 tab/newline」「純垂直 tab U+000B」「純零寬 U+200B」「純 U+FEFF」呼叫 → 全 RAISE(v_ws 集擋)。
-- 5c. v_ws 字面正確性(codex round2):note='vip客戶v' → 儲存值首尾 v **保留**(E'' 無 \v、已用 \013;
--    若模擬見 v 被刪=v_ws 摻進字母 v=立即 FAIL);SELECT length(v_ws)=12(6 escape 集+6 Unicode 字元)。
-- 6. 查無客戶:隨機 uuid → 'NOT_FOUND'、零寫入。
-- 7. 函式體零 UPDATE customers(pg_get_functiondef grep;餘額變動證明=trigger 路)。
-- 8. ROLLBACK 後零留痕:synthetic customer / ledger / audit 消失;函式定義本身由 db push 保留。
-- ============================================================
