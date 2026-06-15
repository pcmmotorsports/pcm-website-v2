-- ============================================================
-- M-3 3DS-4a-2:attempt sweeper RPC — payment_charge_attempts 退避/上限/轉人工 + 原子 claim/flag/mark
-- ============================================================
-- 真權威:docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md §5.1b(3DS-4a-2)+ master plan v5 §2(3DS-4)。
-- 依賴(功能):20260604120000(orders + payment_status enum)、20260612150000(s2d payment_charge_attempts 表)、
--             20260611120000(payment_confirmer 角色、S2-c)。本檔不引用 webhook inbox(0a)— inbox 路徑屬 4a-1。
-- 🔴 入 db push bundle、時戳最末:0a→0b→0c→1b→#214a→4a-1(20260615120000)→**4a-2(本檔、20260615120001)**;
--    bundle 受 cart_session_id 整合阻擋、不單推(memory 3ds-db-push-bundle-blocked-until-cart-session-integration)。
-- 鐵則 8(ALTER + 新 RPC 群 + GRANT)+ 鐵則 12(payment / 對帳 sweeper、窄權、零 PII、fail-closed)。
--
-- 🔴 設計(plan §5.1b、三模型審查群1/2 + codex 關卡1 r2 must-fix #1/#2/#3、對稱 4a-1 inbox):
--   ① stuck-attempt 路徑鏡像 inbox 退避/上限/轉人工 → 修群1 共識破口「confirm 永失敗的 charged-unpaid 每輪無界重打
--      Record」。新 4 欄(settle_attempt_count/next_settle_at/needs_manual_review/last_settle_error)+ 4 窄權 RPC。
--   ② 🔴 claim_stuck_unsettled_attempts(原子 lease、r2-#2 對稱 inbox claim、非 read-only list):
--      ceiling-expirer 前置 → CTE FOR UPDATE OF a SKIP LOCKED + LIMIT → UPDATE settle_attempt_count++ + 5min lease;
--      濾 status IN(pending,charged) AND o.payment_status='unpaid'(群2)AND needs_manual_review=false
--      AND settle_attempt_count<8(ceiling 退熱)AND lease 到期 AND created_at < now()-age(Q2=A 10min age-gate)。
--      🔴 含 charged-unpaid(群1:markCharged 成功但 confirm throw → attempt=charged/order unpaid、只掃 pending 則
--      confirm 永不補;settleCharge 重入 markCharged no-op→confirm 冪等補收斂)。claim token = 回傳的 settle_attempt_count。
--   ③ 🔴 flag_non_unpaid_active_attempts(r2-#3 真實作非承諾):標 status active 但 payment_status NOT IN(unpaid,paid)
--      (refunded/partiallyPaid 殘留;confirm 只收 unpaid 永不收斂)→ needs_manual_review、回 count(sweeper 告警)。
--   ④ 🔴 mark_attempt_settle_retry(token guard + 退避 + 達 ceiling→manual、不 ++):WHERE settle_attempt_count=
--      p_claimed_count AND needs_manual_review=false(含 manual guard、對齊 4a-1 codex K2 r1 防 late mark 寫 manual row);
--      退避 next_settle_at=2^(settle_attempt_count-1) 封頂 16min;達 ceiling(>=8)→needs_manual_review;
--      last_settle_error 固定錯誤碼集(零 PII);遞增唯一在 claim、本 RPC 不 ++。
--   ⑤ 權限:全 RPC SECURITY DEFINER + search_path='' + 全識別子 schema-qualified;REVOKE EXECUTE 全 → GRANT
--      payment_confirmer;has_function_privilege 矩陣 + payment_confirmer 全域表/欄 role-hygiene 回歸 assert
--      (群5:ALTER 加欄勿洩 grant、否則炸整 bundle)。
--
-- 🔴 對 plan §5.1b 的 2 處「字面精化」〔A〕〔B〕 + 2 處「安全實作補強」〔C〕〔D〕(動手前 adversarial timeline 自審
--    逮、下方 MCP 實證;codex K2 consider 收斂、審查側請逐條核;A/B=改 plan 字面、C/D=純實作補強非 plan 偏離):
--   〔A〕**4 欄非 brief 摘要的 3 欄** — 第 4 欄 last_settle_error 為 plan §5.1b L79「mark_attempt_settle_retry … +
--        last reason_code」+「鏡像 inbox」(inbox 0a 有 last_error、4a-1 markRetry 寫之)所需:p_reason_code 參數
--        在 plan/brief 簽名皆在 → 必有 durable 落點 → last_settle_error(零 PII、RPC 唯一寫者且 allowlist 強制)。
--        作用=轉人工 row 的人工 triage「為何卡住」+ 群4「reason 連續性」告警信號之 durable 來源。
--   〔B〕**ceiling-expirer + mark 的 manual 寫路徑加 o.payment_status='unpaid' 閘**(plan 字面僅 claim 帶此閘):
--        settle_attempt_count 只在 claim(unpaid-scoped)遞增 → 若某單在第 8 輪 claim(count→8、charged)後被平行
--        callback/webhook 結清(order→paid、attempt→charged 留存)→ 無閘 expirer/mark 會把**已結清 paid 單**誤標
--        needs_manual_review(假人工告警、可達)。加 unpaid 閘 → 不變式收斂為「manual 只設於 unpaid-stuck attempt」:
--        claim(unpaid<ceiling)/ expirer(unpaid>=ceiling 孤兒)/ flag(非 unpaid 非 paid)/ mark(unpaid 退避/ceiling)
--        四者 payment_status 分軌;**已結清 paid 單(sweeper 讀到時已 paid)全程被濾、不誤標**。refunded/partiallyPaid
--        達 ceiling 由 flag 接管轉 manual、非 expirer → 零孤兒。
--        🔴 殘餘窄 TOCTOU(codex K2 consider、誠實揭示、非自宣接受):expirer/mark 語句快照讀到 unpaid 後、並發
--        callback/confirm 才 commit order→paid → 該語句仍可能留 `paid + needs_manual_review=true`。屬 cosmetic 假
--        人工告警(無雙扣 / 無金錢 / 無安全影響;settleCharge 冪等 + Record 權威);人工複查即清,4b paid 收斂路徑
--        或 Phase II 後台可主動清同單 active attempt 的 needs_manual_review(forward note、入 #231 prod 前置候選)。
--        安全面=nil;本精化把「lease 到期即誤標」大幅收窄成「並發 commit 窄窗」、非完全消除(字面誠實)。
--   〔C〕**claim/flag 用 FOR UPDATE OF a SKIP LOCKED**(非裸 FOR UPDATE;純實作補強、非 plan 偏離):只鎖
--        payment_charge_attempts(a)、不鎖 join 的 orders(o)→ 避免 ① 持 orders row 鎖阻塞平行 confirm/callback
--        結算 ② SKIP LOCKED 因他人持 order 鎖而誤跳可 claim 的 attempt。expirer 為冪等 plain UPDATE(對齊 4a-1
--        inbox expirer、無 SKIP LOCKED)。
--   〔D〕**claim age-gate fail-closed**(純實作補強、非 plan 偏離):`p_age_seconds >= 0` 閘 → NULL/負 p_age_seconds
--        → 整批 claim 空(非 over-claim recent),守 Q2=A「>10min 才掃、避 racing 即時 callback/webhook」安全意圖。
--   ⚠️ p_limit:DB 端 clamp [1,1000](硬 backstop、對齊 4a-1);**營運批次量=4b caller 帶 Q3=A 50**(plan §5.1b
--        預算:單輪 50×~500ms=25s < 60s maxDuration < 5min lease),caller 固定小 limit + 測(4b forward note)。
--
-- ⚠️ 誠實揭示:主軌 RPC 以 payment_confirmer 身分 literal 實呼於 pooled MCP 必斷線(S2-c/d/0a/1b/4a-1 多次重現)
--   → 等價證據 = has_function_privilege 矩陣 + owner 身分行為矩陣 + search_path='' caller 一致 + role_table/
--   column_grants=0;真連線 round-trip 由 3DS-4c route(payment_confirmer 鑰、session pooler)補。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、BEGIN + s2d/4a-2 DDL + synthetic orders/attempts + DO 斷言 + ROLLBACK、
--   零留痕;見 commit body 摘要):claim 原子+lease+age-gate+ceiling 濾+charged-unpaid 入掃、ceiling-expirer lease 內
--   不誤標/到期補轉 + 〔B〕paid-at-ceiling 不誤標 manual、flag 標 refunded/partiallyPaid 回 count、mark token guard
--   correct=1/stale=0/manual-row=0/paid-平行=0、退避 2^(count-1)=8min 不++、達 ceiling→manual、reason allowlist
--   惡意→unknown;has_function_privilege 矩陣唯 payment_confirmer + 全域 role-hygiene grants=0。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. 退避/上限/轉人工/錯誤碼 4 欄(鏡像 inbox;群1 修「stuck-attempt 無界重打 Record」)──
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN settle_attempt_count integer     NOT NULL DEFAULT 0,   -- claim 次數(唯一遞增點=claim;token)
  ADD COLUMN next_settle_at       timestamptz,                      -- lease / 退避到期(NULL=從未 claim、立即可掃)
  ADD COLUMN needs_manual_review  boolean     NOT NULL DEFAULT false, -- durable 轉人工旗標(達 ceiling/孤兒/非 unpaid 殘留)
  ADD COLUMN last_settle_error    text;                             -- 固定錯誤碼集(零 PII;RPC 唯一寫者 + allowlist 強制)


-- ── 2. expire_stuck_attempts_at_ceiling()(ceiling-expirer、claim 前置、防孤兒;codex r2-#1 對稱 inbox)──
-- claim 把 settle_attempt_count 加到 ceiling 後若 route timeout/crash 在 mark 前 → 該 attempt settle_attempt_count>=8
-- 永遠被 claim 濾掉、又無 markSettleRetry set manual → 永久孤兒。前置 expirer 把「達 ceiling 且 lease 到期仍 active
-- unpaid」一律轉 manual(durable 告警)、回轉換筆數(>0 = sweeper 告警)。
-- 🔴 lease 條件(對齊 4a-1):孤兒 = 達 ceiling 且 next_settle_at<=now()(lease 到期);否則 overlap cron 會把「剛 claim、
--    仍在 5min lease 內處理中」attempt 提早誤標。NULL next_settle_at(未經 claim 不可能達 ceiling、防禦納入)視為到期。
-- 🔴 精化〔B〕:o.payment_status='unpaid' 閘 → 平行 callback 在 ceiling 後結清的**已付款單**不被誤標 manual。
CREATE OR REPLACE FUNCTION public.expire_stuck_attempts_at_ceiling()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_charge_attempts a
       SET needs_manual_review = true
      FROM public.orders o
     WHERE o.id = a.order_id
       AND a.status IN ('pending', 'charged')
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.needs_manual_review = false
       AND a.settle_attempt_count >= 8
       AND (a.next_settle_at IS NULL OR a.next_settle_at <= pg_catalog.now())
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.expire_stuck_attempts_at_ceiling() IS
  'M-3 3DS-4a-2:attempt ceiling-expirer(claim 前置、防孤兒)。達 ceiling(settle_attempt_count>=8)且 lease 到期、仍 active(pending|charged)且 order unpaid → 轉 needs_manual_review;回轉換筆數。只 payment_confirmer 可呼。';


-- ── 3. claim_stuck_unsettled_attempts(原子 lease claim;codex r2-#2 對稱 inbox claim)──
-- 含 charged-unpaid(群1):markCharged 成功但 confirm throw → attempt=charged/order unpaid、只掃 pending 則 confirm
-- 永不補 → 故 status IN(pending,charged)。回 attempt_id/order_id/settle_attempt_count(claim token)。
-- 🔴 FOR UPDATE OF a SKIP LOCKED(精化〔C〕):只鎖 a、不鎖 join 的 orders。age-gate fail-closed(精化〔D〕):
--    p_age_seconds>=0 閘 → NULL/負 → claim 空。
CREATE OR REPLACE FUNCTION public.claim_stuck_unsettled_attempts(
  p_age_seconds integer,
  p_limit       integer
)
RETURNS TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH claimed AS (
    SELECT a.id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.status IN ('pending', 'charged')
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.needs_manual_review = false
       AND a.settle_attempt_count < 8
       AND (a.next_settle_at IS NULL OR a.next_settle_at <= pg_catalog.now())
       AND p_age_seconds >= 0
       AND a.created_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_age_seconds)
     ORDER BY a.created_at
     FOR UPDATE OF a SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  UPDATE public.payment_charge_attempts a
     SET settle_attempt_count = a.settle_attempt_count + 1,
         next_settle_at = pg_catalog.now() + interval '5 minutes'
    FROM claimed
   WHERE a.id = claimed.id
  RETURNING a.id AS attempt_id, a.order_id AS order_id, a.settle_attempt_count AS settle_attempt_count;
$fn$;

COMMENT ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) IS
  'M-3 3DS-4a-2:原子 lease claim stuck unsettled attempt(FOR UPDATE OF a SKIP LOCKED + LIMIT)。settle_attempt_count++(claim token)+ 5min lease;濾 status IN(pending,charged) AND order unpaid(含 charged-unpaid 群1)AND settle_attempt_count<8(ceiling)AND 非 manual AND lease 到期 AND created_at < now()-p_age_seconds(p_age_seconds<0/NULL→空、fail-closed)。回 attempt_id/order_id/settle_attempt_count。只 payment_confirmer 可呼。';


-- ── 4. flag_non_unpaid_active_attempts(群2:標 refunded/partiallyPaid 殘留 active attempt → manual)──
-- claim 的 payment_status='unpaid' 濾掉 refunded/partiallyPaid 殘留 attempt(confirm 只收 unpaid 永不收斂)→ 本 RPC
-- 偵測 + durable 標記 + 回 count(>0 sweeper 告警)。Phase I 不可達、前瞻正確。FOR UPDATE OF a SKIP LOCKED + LIMIT 界定。
CREATE OR REPLACE FUNCTION public.flag_non_unpaid_active_attempts(p_limit integer)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH target AS (
    SELECT a.id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.status IN ('pending', 'charged')
       AND o.payment_status NOT IN ('unpaid'::public.payment_status, 'paid'::public.payment_status)
       AND a.needs_manual_review = false
     ORDER BY a.created_at
     FOR UPDATE OF a SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  ),
  upd AS (
    UPDATE public.payment_charge_attempts a
       SET needs_manual_review = true
      FROM target
     WHERE a.id = target.id
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.flag_non_unpaid_active_attempts(integer) IS
  'M-3 3DS-4a-2:標 active(pending|charged)但 order payment_status NOT IN(unpaid,paid)(refunded/partiallyPaid 殘留、confirm 永不收斂)→ needs_manual_review;回標記筆數。FOR UPDATE OF a SKIP LOCKED + LIMIT 界定。只 payment_confirmer 可呼。';


-- ── 5. mark_attempt_settle_retry(token guard;退避 + 達 ceiling 轉 manual;不 ++)──
-- 🔴 token guard(WHERE settle_attempt_count=p_claimed_count AND needs_manual_review=false、含 manual guard、對齊
--    4a-1 codex K2 r1):事件被另一 run 重領(count 變)或已轉人工 row late mark = no-op(回 affected=0)、不覆寫。
-- 🔴 精化〔B〕:o.payment_status='unpaid' 閘 → 平行結清的已付款單 mark = no-op、不誤標 manual。
-- 退避 next_settle_at=2^(settle_attempt_count-1) 封頂 16min(首次 claim 後 count=1→2^0=1min;off-by-one 校正);
-- 達 ceiling(>=8)→ needs_manual_review;last_settle_error 固定錯誤碼集(零 PII);不 ++(遞增唯一在 claim)。
CREATE OR REPLACE FUNCTION public.mark_attempt_settle_retry(
  p_attempt_id    uuid,
  p_claimed_count integer,
  p_reason_code   text
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_charge_attempts a
       SET next_settle_at = pg_catalog.now()
             + pg_catalog.make_interval(mins =>
                 LEAST(pg_catalog.power(2, GREATEST(a.settle_attempt_count - 1, 0))::integer, 16)),
           last_settle_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'auth_or_pending')
               THEN p_reason_code ELSE 'unknown' END,
           needs_manual_review = (a.needs_manual_review OR a.settle_attempt_count >= 8)
      FROM public.orders o
     WHERE o.id = a.order_id
       AND a.id = p_attempt_id
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.status IN ('pending', 'charged')
       AND a.settle_attempt_count = p_claimed_count
       AND a.needs_manual_review = false
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.mark_attempt_settle_retry(uuid, integer, text) IS
  'M-3 3DS-4a-2:pending outcome 退避 retry。next_settle_at=2^(settle_attempt_count-1) 封頂 16min;達 ceiling(>=8)→needs_manual_review;last_settle_error 固定錯誤碼集(零 PII)。token guard(settle_attempt_count=p_claimed_count + needs_manual_review=false + order unpaid)防 stale/late mark/平行已付款單。不 ++(遞增唯一在 claim)。回 affected(1=已退避、0=no-op)。只 payment_confirmer 可呼。';


-- ── 6. RPC 權限:全 REVOKE 再精準 GRANT payment_confirmer ──
REVOKE ALL ON FUNCTION public.expire_stuck_attempts_at_ceiling()               FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.flag_non_unpaid_active_attempts(integer)         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_attempt_settle_retry(uuid, integer, text)   FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stuck_attempts_at_ceiling()            TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.flag_non_unpaid_active_attempts(integer)      TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.mark_attempt_settle_retry(uuid, integer, text) TO payment_confirmer;


-- ── 7. fail-closed assert:RPC EXECUTE 矩陣(payment_confirmer=true、其餘 false)──
DO $$
BEGIN
  IF NOT has_function_privilege('payment_confirmer', 'public.expire_stuck_attempts_at_ceiling()', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.flag_non_unpaid_active_attempts(integer)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.expire_stuck_attempts_at_ceiling()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.expire_stuck_attempts_at_ceiling()', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.expire_stuck_attempts_at_ceiling()', 'EXECUTE')
     OR has_function_privilege('anon',          'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.claim_stuck_unsettled_attempts(integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.flag_non_unpaid_active_attempts(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.flag_non_unpaid_active_attempts(integer)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.flag_non_unpaid_active_attempts(integer)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_attempt_settle_retry(uuid, integer, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '3DS-4a-2 attempt sweeper RPC EXECUTE 矩陣異常 — 應唯 payment_confirmer;拒繼續';
  END IF;
END
$$;


-- ── 8. role-hygiene 回歸 assert:payment_confirmer **全域**表/欄層零權限(對齊 4a-1/1b/s2d 全域版;ALTER 加欄勿
--    洩 grant、且防未來同檔追加他表 ALTER 漏盯;prod 實查全域=0 已確認)──
DO $$
DECLARE
  v_tbl_grants integer;
  v_col_grants integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_tbl_grants
    FROM information_schema.role_table_grants
   WHERE grantee = 'payment_confirmer';
  SELECT pg_catalog.count(*) INTO v_col_grants
    FROM information_schema.role_column_grants
   WHERE grantee = 'payment_confirmer';
  IF v_tbl_grants <> 0 OR v_col_grants <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 全域表/欄層權限非零(role-hygiene 破、ALTER 加欄洩 grant)— 拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(逆序手動):
--   DROP FUNCTION IF EXISTS public.mark_attempt_settle_retry(uuid, integer, text);
--   DROP FUNCTION IF EXISTS public.flag_non_unpaid_active_attempts(integer);
--   DROP FUNCTION IF EXISTS public.claim_stuck_unsettled_attempts(integer, integer);
--   DROP FUNCTION IF EXISTS public.expire_stuck_attempts_at_ceiling();
--   ALTER TABLE public.payment_charge_attempts
--     DROP COLUMN IF EXISTS last_settle_error,
--     DROP COLUMN IF EXISTS needs_manual_review,
--     DROP COLUMN IF EXISTS next_settle_at,
--     DROP COLUMN IF EXISTS settle_attempt_count;
-- ============================================================
