-- ============================================================
-- M-3 3DS 乙路 R1c3:close_released_attempt — owner-only 人工結案 RPC(released→failed + closed_* 三欄、冪等)
-- ============================================================
-- 真權威:docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1c3(行 207-209、逐字)
--          + §2.6 人工結案(行 61)+ §3 權限架構(行 115-116、120 D1 定稿)+ §9 第 10 片(行 306)+ §14 步 16 point 11/13 + 步 20。
-- canonical 經 Codex round4→11 共 8 輪、round11 PASS;本片 = §14 唯一 45 步序之步 20(R1 migration bundle 第十/末片)。
-- 依賴:20260612150000(payment_charge_attempts 表 + status CHECK + updated_at)、
--       20260624120000 R1a1('released' 狀態 + released_closed_at/by/resolution 三欄 + group_chk + released_closed_at⇒failed status_chk)、
--       20260604120000(orders.payment_status enum / orders.id)、20260611120000(payment_confirmer 角色〔本片 REVOKE 對象之一、不 GRANT〕)。
-- 鐵則 8(新 SECDEF RPC、無 GRANT=owner-only)由 canonical 滿足、無需新 plan;鐵則 12(payment / 結算終局 / owner-only / migration)→ codex K2 + Codex Packet。分級 N/A(非 L3 營運 UI、純資料層 owner RPC)。
--
-- 🔴 設計(canonical §4 R1c3 行 208 逐字 + §3 行 116/120 + §2.6 行 61):
--   人工結案 = Sean 取得 TapPay 明確終局(未扣款)後,以 owner-only RPC 把 released attempt 收尾 → released→failed + 寫 released_closed_*。
--   ① 轉移:`released → failed`(🔴 **不新增 closed enum**、沿用既有 status 集;released_closed_at 非 NULL ⇒ status=failed 由 R1a1 status_chk 坐實)。
--      同交易寫 released_closed_at=now() / released_closed_by=session_user / released_close_resolution=p_resolution(三欄成組,滿足 R1a1 group_chk 整組非 NULL)。
--   ② order-paid guard(fail-closed):鎖 order、payment_status 必須 'unpaid';非 unpaid(paid/refunded/partiallyPaid)→ RAISE。
--      released 但 order 已 paid = 潛在雙扣(late success / sibling 成交),走 W1 anomaly + 退款 runbook、**不得** close 為 failed(會掩蓋雙扣)。
--   ③ 已 charged / pending / 未經 close 的 plain failed 一律拒(非 released、RAISE);charged 已扣款不可結為 failed。
--   ④ 重複 close 冪等:status=failed 且 released_closed_at 非 NULL(= 前次 close 終局、唯一寫 released_closed_at 者 = 本 RPC)→ no-op、
--      **保留首次結案三欄不覆蓋**(稽核完整性)、回 {closed:true, idempotent:true}。
--   🔴 begin / release CAS / sweeper / settle policy 本體本片**不改**(canonical §4 結尾「begin 主體不改」)。
--
-- 🔴 並發 / 鎖序(鐵則 12;對齊 R1b2 §10.4 鎖序分析):
--   本 RPC 鎖序 = attempt FOR UPDATE(讀 status/closed_at/order_id) → order FOR UPDATE(paid guard);= **attempt→order**。
--   全庫唯一 orders FOR UPDATE 持有者 = confirm_order_payment(orders-only、不鎖 attempt);其餘動 attempt 者
--   (markCharged / markFailed〔R1b2 同 attempt→order〕/ sweeper SKIP LOCKED / S2b / release R1a3)皆 attempt-only 鎖或唯讀 orders
--   → 無 order→attempt 反向鎖序 → 無 A-B/B-A 死結。TOCTOU:guard 讀 unpaid 後 confirm 並發翻 paid 由 order FOR UPDATE 序列化
--   (confirm 持 order 鎖時 close 阻塞於 order、confirm commit→close 讀到 paid→guard RAISE)。
--   兩 close 並發同 attempt:attempt 鎖序列化、第二者 unblock 後 EvalPlanQual 重評見 status=failed+closed_at → 冪等 no-op(不雙寫)。
--
-- 🔴 權限(§3 行 120 D1 定稿:**不 GRANT payment_confirmer**):REVOKE PUBLIC/anon/authenticated/service_role/payment_confirmer、
--   **無 GRANT = owner/postgres only**(Phase 1 Sean 受控人工流程執行;未來正式 staff/admin 角色再獨立 migration 開權)。
--   SECURITY DEFINER + SET search_path='' + 全識別子 schema-qualified(pg_catalog.* / public.*)。稽核欄寫 session_user
--   (非 current_user=function owner、非真人 staff id;記 DB session role)。has_function_privilege 矩陣 + role_routine_grants fail-closed assert。
--   p_resolution 自由文字結案理由(**非 enum**、不設 allowlist;僅 btrim 非空守衛)+ 寫入 trim 後正規值。
--
-- ⚠️ 守線:本片只新增 1 migration 檔(1 新 SECDEF RPC、無 ALTER 表 / 無新欄 / 無 GRANT)+ MCP 模擬(零留痕);
--   不 db push(= §14 步 21 Sean、R1 bundle 連帶 S2b=live)、不 push/merge、不開 flag(TAPPAY_3DS_ENABLED false)、不擴張 scope。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、單一 atomic DO block:
--   先套 R1a1 DDL('released' + closed_* 三欄 + 4 一致性 CHECK)→ CREATE 本片 RPC → REVOKE → 合成 order/attempt → 行為測 → 末端 RAISE 強制 rollback、零留痕):
--   C1 released+unpaid → close 成功(status=failed、released_closed_at/by/resolution 三欄寫入、by=session_user、resolution=trim 值);
--   C2 冪等:對 C1 已結案 attempt 再 close → no-op、{idempotent:true}、三欄保留首次值不變;
--   C3 charged+unpaid → RAISE(非 released)、attempt 維持 charged closed 三欄 NULL;
--   C4 pending+unpaid → RAISE(非 released)、維持 pending;
--   C5 released+order paid → order-paid guard RAISE、維持 released(不 close);
--   C6 released+order refunded → guard RAISE、維持 released;
--   C7 plain failed(closed_at NULL)→ RAISE(非 released、非冪等分支)、維持 failed 三欄 NULL;
--   C8 attempt 不存在 → RAISE;
--   C9 released + 空白 resolution → RAISE(必填)、維持 released 不 close;
--   ACL 矩陣:has_function_privilege × {anon,authenticated,service_role,payment_confirmer} EXECUTE 全 false +
--     role_routine_grants=0;anon/authenticated literal SET ROLE 實呼 → permission denied(NOLOGIN、pooled MCP 不斷);
--     payment_confirmer/service_role 走 has_function_privilege 等價(SET ROLE LOGIN + SECDEF 斷 pooled MCP、沿用 R1a2/R1a3/R1b1b 先例)。
--   跑後 pg_proc / pg_constraint / 欄 catalog 複查 residue=0(RPC 不殘留、R1a1 暫加欄不殘留)。結果回填 commit body / Codex Packet。
--   ⚠️ 死結/TOCTOU 屬並發性質、單連線模擬不可證 → 上方鎖序分析 + 真雙連線留執行 session 雙 psql(canonical §12)。
--
-- Rollback(Supabase forward-only、僅供參考):DROP FUNCTION IF EXISTS public.close_released_attempt(uuid, text)。見檔尾。
-- ============================================================


-- ── 1. close_released_attempt(owner-only;released→failed + closed_* 三欄、order-paid guard、冪等)──
CREATE OR REPLACE FUNCTION public.close_released_attempt(
  p_attempt_id uuid,
  p_resolution text
)
RETURNS jsonb  -- {closed: boolean, idempotent: boolean}(closed 永 true=結案/已結案;非 released/charged/paid/不存在 一律 RAISE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor        text := session_user;                            -- 稽核記 DB session role(非 current_user=function owner;對齊 R1b1b)
  v_status       text;
  v_closed_at    timestamptz;
  v_order_id     uuid;
  v_order_status public.payment_status;
  v_resolution   text := pg_catalog.btrim(COALESCE(p_resolution, ''));  -- 驗證 + 寫入皆用 trim 後正規值(稽核欄整潔)
  v_n            integer;
BEGIN
  -- p_resolution 必填非空(group_chk 要求 released_close_resolution 非 NULL + 操作稽核留痕;自由文字、非 enum)
  IF v_resolution = '' THEN
    RAISE EXCEPTION 'close_released_attempt:p_resolution 必填非空(人工結案理由)';
  END IF;

  -- 鎖 attempt 列讀現態(鎖序 attempt→order、對齊 R1b2;無 order→attempt 反向 = 無死結)
  SELECT a.status, a.released_closed_at, a.order_id
    INTO v_status, v_closed_at, v_order_id
    FROM public.payment_charge_attempts a
   WHERE a.id = p_attempt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % 不存在', p_attempt_id;
  END IF;

  -- 冪等:已結案(status=failed 且 released_closed_at 非 NULL = 前次 close 終局、唯一寫此欄者 = 本 RPC)
  --   → no-op、保留首次結案三欄不覆蓋(稽核完整性)、回 idempotent
  IF v_status = 'failed' AND v_closed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('closed', true, 'idempotent', true);
  END IF;

  -- 僅 released 可人工結案;pending / charged / 未經 close 的 plain failed 一律拒
  --   (charged 已扣款不可結為 failed;pending 走正常付款流程;plain failed 非 released 終局、無 close 語意)
  IF v_status <> 'released' THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % status=% 非 released、不可 close(僅 released 人工結案)', p_attempt_id, v_status;
  END IF;

  -- order-paid guard(fail-closed):鎖 order、payment_status 必須 unpaid;非 unpaid → RAISE
  --   (released 但 order 已 paid/refunded = 潛在雙扣,走 W1 anomaly + 退款 runbook、不得 close 掩蓋)
  SELECT o.payment_status
    INTO v_order_status
    FROM public.orders o
   WHERE o.id = v_order_id
   FOR UPDATE;
  IF NOT FOUND OR v_order_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION 'close_released_attempt:order % payment_status 非 unpaid、fail-closed 拒 close(潛在雙扣走 W1 退款)', v_order_id;
  END IF;

  -- 結案:released → failed + closed_* 三欄成組(滿足 R1a1 group_chk 整組非 NULL + status_chk released_closed_at⇒failed)
  --   row 離開 per-order 鎖 partial index(failed 不在 predicate)= 釋放該單對帳鎖位
  UPDATE public.payment_charge_attempts
     SET status                    = 'failed',
         released_closed_at        = pg_catalog.now(),
         released_closed_by        = v_actor,
         released_close_resolution = v_resolution,
         updated_at                = pg_catalog.now()
   WHERE id = p_attempt_id AND status = 'released';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    -- 持 FOR UPDATE 鎖 + 已驗 released → 理論恆 1;防禦性斷言(任何意外 → fail-closed 回滾)
    RAISE EXCEPTION 'close_released_attempt:結案 UPDATE 影響 % 列(預期 1、attempt %)', v_n, p_attempt_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object('closed', true, 'idempotent', false);
END;
$fn$;

COMMENT ON FUNCTION public.close_released_attempt(uuid, text) IS
  'M-3 3DS R1c3 owner-only 人工結案(SECDEF、search_path='''')。Sean 取得 TapPay 明確終局(未扣款)後收尾 released attempt:released→failed + 寫 released_closed_at=now()/released_closed_by=session_user/released_close_resolution=p_resolution(三欄成組、滿足 R1a1 group_chk)。order-paid guard fail-closed(order 非 unpaid → RAISE,潛在雙扣走 W1 退款)+ charged/pending/plain-failed 拒(僅 released 可 close)+ 重複 close 冪等(failed+closed_at 非 NULL → no-op、保留首次三欄、{idempotent:true})。鎖序 attempt→order 無死結。p_resolution 自由文字(非 enum、btrim 非空)。REVOKE 5 角色含 payment_confirmer、無 GRANT = owner/postgres only(Phase 1 受控人工流程)。';


-- ── 2. ACL(§3 行 120 D1:REVOKE PUBLIC/anon/authenticated/service_role/payment_confirmer、無 GRANT = owner/postgres only)──
REVOKE ALL ON FUNCTION public.close_released_attempt(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;

-- 🔴 函式權限矩陣 fail-closed assert(owner-only:4 負向角色 × EXECUTE 全 false;含 service_role,因 ALTER DEFAULT PRIVILEGES 預設回授 function EXECUTE 須顯式 REVOKE)
DO $$
DECLARE
  v_cnt integer;
BEGIN
  IF has_function_privilege('anon',              'public.close_released_attempt(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated',  'public.close_released_attempt(uuid, text)', 'EXECUTE')
     OR has_function_privilege('service_role',    'public.close_released_attempt(uuid, text)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.close_released_attempt(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R1c3 close_released_attempt EXECUTE 權限矩陣異常 — 應 owner/postgres only(anon/authenticated/service_role/payment_confirmer 全無 EXECUTE);拒繼續';
  END IF;

  -- role_routine_grants 顯式 grant 零(對稱坐實「零 routine grant」、對齊 R1b1b)
  SELECT count(*) INTO v_cnt
    FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public'
     AND routine_name = 'close_released_attempt'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'payment_confirmer');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'R1c3 close_released_attempt role_routine_grants 非零(% 筆)— 應 4 角色零 routine 顯式 grant;拒繼續', v_cnt;
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.close_released_attempt(uuid, text);
-- ============================================================
