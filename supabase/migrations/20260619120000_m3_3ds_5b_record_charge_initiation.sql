-- ============================================================
-- M-3 3DS-5b:3DS 啟動半段「把 bank_txn / rec_trade_id 寫進仍 pending 的 attempt」窄權 RPC × 2
-- ============================================================
-- 真權威:docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md §3.1(R1、codex 關卡1 r2 PASS)
--   + master plan v5 §1 step 1(charge 前產 bank_txn durable、回應遺失仍可對帳)。
-- 依賴:20260604120000(orders + payment_status enum)、20260612150000(s2d:payment_charge_attempts 表 +
--       per-order 鎖 + rec_unique_idx + mark_charge_attempt_charged rec 上限 64)、
--       20260613140000(0c:attempts.bank_transaction_id 欄〔nullable、無 CHECK 無 UNIQUE〕)、
--       20260611120000(payment_confirmer 角色)。
-- 鐵則 8(新 index + 新 CHECK + 新 RPC + GRANT)+ 鐵則 12(payment / 對帳脊椎 charge 前 durable 寫入)。
--
-- 🔴 設計(plan §3.1 + codex 關卡1 釘死點):
--   【為什麼】begin_charge_attempt 建 attempt 只寫 (order_id, customer_user_id, fallback_token_hash)、
--     **不寫 bank_txn/rec_trade_id**;markCharged 會 pending→charged(代表已扣款)、不適用「3DS 啟動但未請款」的
--     pending attempt。settleCharge 靠 get_active_charge_attempt(1b)撈 bank_transaction_id/rec_trade_id 對帳 →
--     必須有路徑把這兩鍵寫進**仍 pending** 的 attempt(且不翻 charged)。3DS-5b 補這條路徑。
--
--   【DDL-1 UNIQUE 部分索引】payment_charge_attempts ON (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL
--     (縱深防撞號;對齊 s2d rec_unique_idx 慣例;TapPay「bank_transaction_id 不能與之前重複」雙保險)。
--
--   【DDL-2 format CHECK — 履行 0c 前向承諾(誠實揭示偏離)】
--     bank_transaction_id IS NULL OR bank_transaction_id ~ '^[A-Z0-9]{1,19}$'。
--     🔴 plan §3.1 DDL 字面只列 UNIQUE 部分索引、未列 CHECK;本 CHECK 為**有意識的縱深加法**,理由 3:
--       ① 0c migration(20260613140000)L67 既有 COMMENT 明寫「生成方式 3DS-5b 定義時再加 length CHECK」=
--          已 push prod 的前向契約、5b 履行之(不履行 = 0c 承諾懸空)。
--       ② 對齊本表既有欄級格式 CHECK 慣例(s2d:fallback_token_hash text NOT NULL CHECK (~ '^[0-9a-f]{64}$'))。
--       ③ 縱深:寫入路徑唯 SECDEF RPC(下方 record_charge_bank_txn 已 guard `^[A-Z0-9]{1,19}$`)、CHECK 為
--          「未來任何新寫入路徑/手動修補」的欄級 backstop(碰錢表鐵則 12、三視角 bug 可追蹤性)。
--     格式 `^[A-Z0-9]{1,19}$` 對齊 §2.2 generateBankTransactionId(P + 18 字 = 19 字、`^[A-Z0-9]{19}$` ⊂ {1,19})
--       + RPC 輸入 guard;現存列 bank_transaction_id 全 NULL(0c 才加欄、5b 為首個寫入者)→ ADD CONSTRAINT 即時驗證通過。
--     ⚠️ codex 關卡2 + 審查側請核此偏離(additive、易回退);若判超 plan scope 可移除、不影響 RPC guard 主防線。
--
--   【兩支窄權 SECDEF RPC】payment_confirmer only、search_path=''、全識別子 schema-qualified、RETURNS boolean persisted:
--     ① record_charge_bank_txn(p_attempt_id, p_order_id, p_bank_transaction_id):charge **前**寫 bank_txn。
--        - 輸入 guard(codex 關卡1 #4):btrim 非空 + `^[A-Z0-9]{1,19}$` 否則通用 RAISE(對齊既有 RPC「不洩內部」)。
--        - FOR UPDATE 鎖 attempt;雙鍵驗(attempt_id + order_id);guard status='pending'(charged/failed 不可再寫)。
--        - 冪等:bank_transaction_id IS NULL → 寫入回 **true**;同值 → no-op 回 **true**(已 durable、非混淆 no-op);
--          異值 → 不覆寫回 **false**(防竄改);非 pending / 查無 attempt → 回 **false**。
--        - unique_violation(撞 UNIQUE 部分索引)→ 收斂為通用 RAISE(不洩約束名)。
--        🔴 persisted 語意(codex 關卡1 #3):回 false = **未 durable** → port 方法必 throw、use-case 不送 TapPay
--          (init_failed、零 charge);同值冪等回 true(成功、非 no-op 混淆)。
--     ② record_charge_pending_rec(p_attempt_id, p_order_id, p_rec_trade_id):charge **後**寫 rec_trade_id、
--        **維持 status='pending'**(≠ mark_charge_attempt_charged 之 pending→charged):
--        - 輸入 guard:btrim 非空 + 長度 ≤ 64(= s2d mark_charge_attempt_charged rec 上限、已核對 L256/L369)。
--        - 同 FOR UPDATE + 雙鍵 + status='pending' guard + 冪等(NULL/同值→true、異值→false、非 pending/查無→false);
--          unique_violation(撞 rec_unique_idx 跨單重複 rec)→ 通用 RAISE。
--   🔴 設計取捨(plan §3.1):兩支單一職責 RPC(本檔採)vs 一支 DEFAULT NULL 呼兩次 → 採兩支:意圖清楚、各自
--     guard 緊、codex 易逐支推理。
--
--   【ACL】兩支 REVOKE EXECUTE FROM PUBLIC, anon, authenticated, **service_role**(memory
--     supabase-service-role-execute-default-grant:REVOKE 四方收不掉 service_role 需顯式 + ALTER DEFAULT 直 grant
--     防線)+ GRANT payment_confirmer;has_function_privilege 矩陣 fail-closed assert(正負向)+ payment_confirmer
--     全域 role-hygiene 回歸 assert(直接表/欄權限恆零、對齊 s2d L471 / 0c / 1b)。
--
-- ⚠️ 誠實揭示(memory pooled-mcp-set-role-secdef-terminates):payment_confirmer literal 實呼於 Supabase pooled MCP
--   必斷線(S2-c/d、0a/0c/1b 多次重現)→ 等價證據 = has_function_privilege 矩陣 + owner 實跑行為矩陣 +
--   search_path='' caller 一致 + role_table/column_grants=0;真連線 round-trip 由 3DS-6 charge action 對 session
--   pooler 補。兩 RPC 皆寫(非唯讀)→ MCP 交易模擬 BEGIN…ROLLBACK 可全程跑(零留痕)。
--
-- 🔴 動手前真 DB 交易模擬:**待審查側執行**(寫審分離 ROLE=A:執行 session 不 db push、不跑 MCP sim;
--   審查 session fresh-context 獨立跑 MCP 交易模擬 + 獨立 codex 關卡2 → sign-off 後 Sean 手動 db push)。
--   預期模擬斷言(審查側 BEGIN + 本 migration DDL + synthetic + DO 斷言 + SET LOCAL ROLE 等價 + ROLLBACK、
--   project bmpnplmnldofgaohnaok PG17、零留痕):
--     A:DDL 套用無誤(1 UNIQUE 部分索引 + 1 CHECK + 2 RPC);in-migration assert 靜默通過
--        (EXECUTE 矩陣唯 payment_confirmer〔anon/authenticated/service_role 全拒〕+ role-hygiene tbl=col=0)。
--     B:record_charge_bank_txn:① pending+NULL → 寫入回 true、row.bank_transaction_id 正確;② 同值重呼 → true(no-op 冪等);
--        ③ 異值 → false 不覆寫;④ 空字串/小寫/含 '_'/>19 字 → 通用 RAISE;⑤ charged attempt → false;
--        ⑥ failed attempt → false;⑦ 查無(雙鍵不配對)→ false;⑧ 跨單同 bank_txn 撞 UNIQUE 部分索引 → 通用 RAISE。
--     C:record_charge_pending_rec:① pending+NULL → 寫入回 true、status 仍 pending;② 同值 → true;③ 異值 → false;
--        ④ 空/>64 字 → 通用 RAISE;⑤ charged/failed → false;⑥ 查無 → false;⑦ 跨單同 rec 撞 rec_unique_idx → 通用 RAISE。
--     D:非 payment_confirmer(anon/authenticated)實呼 → permission denied;CHECK 拒小寫/含 '_'/>19 字 bank_txn 直 INSERT。
--     E:ROLLBACK 後唯讀複查零留痕(兩 RPC / index / constraint / synthetic orders·attempts·users 全 absent)。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):見檔尾。
-- ============================================================


-- ── 1. DDL:bank_transaction_id UNIQUE 部分索引 + format CHECK(縱深防撞號 + 履行 0c 前向承諾)──
-- UNIQUE 部分索引(對齊 s2d rec_unique_idx 慣例;WHERE NOT NULL = 多列 NULL 不撞、僅非空值唯一)
CREATE UNIQUE INDEX payment_charge_attempts_bank_txn_unique_idx
  ON public.payment_charge_attempts (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;

-- format CHECK(履行 0c L67 前向承諾 + 對齊 fallback_token_hash CHECK 慣例;格式對齊 §2.2 / RPC guard)
ALTER TABLE public.payment_charge_attempts
  ADD CONSTRAINT payment_charge_attempts_bank_txn_format_chk
  CHECK (bank_transaction_id IS NULL OR bank_transaction_id ~ '^[A-Z0-9]{1,19}$');

COMMENT ON COLUMN public.payment_charge_attempts.bank_transaction_id IS
  'M-3 3DS-0c gateway 第二道唯一鍵 + 3DS-5b 落實:3DS initiate(5b)送 charge「前」由 record_charge_bank_txn 寫入並 durable 存(回應遺失本機仍可查鍵、settleCharge Record 反查用;master plan §1 step 1)。格式 `^[A-Z0-9]{1,19}$`(5b format CHECK + RPC guard + generateBankTransactionId 三層);跨單 UNIQUE(5b 部分索引)。維持 pending 寫入、不翻 charged。';


-- ── 2. record_charge_bank_txn(charge 前寫 bank_txn;plan §3.1 RPC ①)──
CREATE OR REPLACE FUNCTION public.record_charge_bank_txn(
  p_attempt_id          uuid,
  p_order_id            uuid,
  p_bank_transaction_id text
)
RETURNS boolean  -- true=已 durable(寫入/同值冪等);false=未 durable(異值不覆寫 / 非 pending / 查無)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_n           integer;
  v_generic_msg constant text := 'record_charge_bank_txn: 付款處理失敗';  -- PF-E 通用訊息(不洩內部)
BEGIN
  -- 🔴 輸入 guard(codex 關卡1 #4):btrim 非空 + 格式 `^[A-Z0-9]{1,19}$`(對齊 §2.2 / format CHECK)否則通用 RAISE
  IF p_bank_transaction_id IS NULL
     OR pg_catalog.btrim(p_bank_transaction_id) = ''
     OR p_bank_transaction_id !~ '^[A-Z0-9]{1,19}$' THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 雙鍵驗(attempt_id + order_id、縮錯寫半徑)+ FOR UPDATE(序列化並發、鎖定後 status/bank_txn 不可變)
  SELECT id, status, bank_transaction_id
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;  -- 查無 attempt(雙鍵不配對)→ 未 durable
  END IF;

  -- guard:僅 pending 可寫 bank_txn(charged/failed = 不在啟動寫入窗 → 未 durable)
  IF v_row.status <> 'pending' THEN
    RETURN false;
  END IF;

  -- 冪等:已有 bank_txn → 同值回 true(已 durable、非 no-op 混淆);異值回 false(不覆寫、防竄改)
  IF v_row.bank_transaction_id IS NOT NULL THEN
    IF v_row.bank_transaction_id = p_bank_transaction_id THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  -- NULL → 寫入(FOR UPDATE 已鎖、條件不可變;撞跨單 UNIQUE 部分索引 → EXCEPTION 收斂通用 RAISE)
  UPDATE public.payment_charge_attempts
     SET bank_transaction_id = p_bank_transaction_id,
         updated_at          = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id
     AND status = 'pending' AND bank_transaction_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RETURN false;  -- 防禦(FOR UPDATE 下不可達):未寫成 = 未 durable、fail-closed
  END IF;
  RETURN true;

EXCEPTION
  -- 跨單重複 bank_txn 撞 UNIQUE 部分索引 → 通用訊息(PF-E、不洩約束名;TapPay 去重雙保險)
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.record_charge_bank_txn(uuid, uuid, text) IS
  'M-3 3DS-5b:3DS charge 啟動「前」把 caller 自產 bank_transaction_id(`^[A-Z0-9]{1,19}$`)durable 寫進**仍 pending** 的 attempt(雙鍵驗 + FOR UPDATE + status=pending guard)。回 boolean persisted:true=已 durable(NULL 寫入 / 同值冪等)、false=未 durable(異值不覆寫 / 非 pending / 查無)→ port 回 false 即 throw、use-case 映 init_failed 零 TapPay(codex 關卡1 #3)。跨單撞 UNIQUE 部分索引 → 通用 RAISE。只 payment_confirmer 可呼。';


-- ── 3. record_charge_pending_rec(charge 後寫 rec、維持 pending;plan §3.1 RPC ②)──
CREATE OR REPLACE FUNCTION public.record_charge_pending_rec(
  p_attempt_id   uuid,
  p_order_id     uuid,
  p_rec_trade_id text
)
RETURNS boolean  -- true=已 durable(寫入/同值冪等);false=未 durable(異值不覆寫 / 非 pending / 查無)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_n           integer;
  v_generic_msg constant text := 'record_charge_pending_rec: 付款處理失敗';  -- PF-E
BEGIN
  -- 輸入 guard:btrim 非空 + 長度 ≤ 64(= s2d mark_charge_attempt_charged rec 上限、已核對 L256/L369)否則通用 RAISE
  IF p_rec_trade_id IS NULL
     OR pg_catalog.btrim(p_rec_trade_id) = ''
     OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 雙鍵驗 + FOR UPDATE
  SELECT id, status, rec_trade_id
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;  -- 查無 attempt → 未 durable
  END IF;

  -- 🔴 維持 status='pending'(≠ mark_charge_attempt_charged 的 pending→charged):僅 pending 可寫 rec
  IF v_row.status <> 'pending' THEN
    RETURN false;
  END IF;

  -- 冪等:已有 rec → 同值回 true;異值回 false(不覆寫)
  IF v_row.rec_trade_id IS NOT NULL THEN
    IF v_row.rec_trade_id = p_rec_trade_id THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  -- NULL → 寫入(維持 pending;撞 rec_unique_idx 跨單重複 rec → EXCEPTION 通用 RAISE)
  UPDATE public.payment_charge_attempts
     SET rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id
     AND status = 'pending' AND rec_trade_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RETURN false;  -- 防禦(FOR UPDATE 下不可達):fail-closed
  END IF;
  RETURN true;

EXCEPTION
  -- 跨單重複 rec 撞 rec_unique_idx → 通用訊息(PF-E、不洩約束名)
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.record_charge_pending_rec(uuid, uuid, text) IS
  'M-3 3DS-5b:3DS charge 啟動回 rec_trade_id 後 durable 寫進**仍 pending** 的 attempt(維持 pending、≠ markCharged;雙鍵驗 + FOR UPDATE + status=pending guard;長度 ≤ 64 = s2d rec 上限)。回 boolean persisted:true=已 durable(寫入/同值)、false=未 durable(異值/非 pending/查無)。best-effort(charge 後、bank_txn 已可對帳)→ port 連線/parse 失敗 throw、use-case catch→log。跨單撞 rec_unique_idx → 通用 RAISE。只 payment_confirmer 可呼。';


-- ── 4. ACL:兩支全 REVOKE(含 service_role)再精準 GRANT payment_confirmer ──
-- 🔴 顯式 REVOKE service_role(memory supabase-service-role-execute-default-grant:REVOKE PUBLIC/anon/authenticated
--    收不掉 ALTER DEFAULT PRIVILEGES 對 service_role 的直 grant、需顯式列舉)
REVOKE ALL ON FUNCTION public.record_charge_bank_txn(uuid, uuid, text)   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_charge_pending_rec(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_charge_bank_txn(uuid, uuid, text)   TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.record_charge_pending_rec(uuid, uuid, text) TO payment_confirmer;


-- ── 5. fail-closed assert(EXECUTE 矩陣正負向 + payment_confirmer role-hygiene 回歸)──
DO $$
DECLARE
  v_tbl int;
  v_col int;
BEGIN
  -- 兩支 EXECUTE 唯 payment_confirmer(anon/authenticated/service_role 全拒)
  IF NOT has_function_privilege('payment_confirmer', 'public.record_charge_bank_txn(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.record_charge_pending_rec(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.record_charge_bank_txn(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_charge_bank_txn(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.record_charge_bank_txn(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.record_charge_pending_rec(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_charge_pending_rec(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.record_charge_pending_rec(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_charge_* RPC EXECUTE 權限矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;

  -- 🔴 payment_confirmer role-hygiene 回歸(對齊 s2d L471 / 0c / 1b):直接表/欄層權限恆零
  --   (只透 SECDEF RPC 寫 attempts、新 SECDEF 函式不得意外放開表權限)
  SELECT count(*) INTO v_tbl FROM information_schema.role_table_grants  WHERE grantee = 'payment_confirmer';
  SELECT count(*) INTO v_col FROM information_schema.role_column_grants WHERE grantee = 'payment_confirmer';
  IF v_tbl <> 0 OR v_col <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 表/欄層權限非零(role-hygiene 破)— tbl=% col=%;拒繼續', v_tbl, v_col;
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.record_charge_pending_rec(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.record_charge_bank_txn(uuid, uuid, text);
--   ALTER TABLE public.payment_charge_attempts DROP CONSTRAINT IF EXISTS payment_charge_attempts_bank_txn_format_chk;
--   DROP INDEX IF EXISTS public.payment_charge_attempts_bank_txn_unique_idx;
--   -- bank_transaction_id 欄還原回 0c COMMENT(手動 COMMENT ON COLUMN … 貼 0c L66-67 原文)
-- ============================================================
