-- ============================================================
-- M-3 3DS 乙路 R1b1b:雙扣 anomaly claim/resolve owner-only RPC + 同交易寫 event + ACL/CAS tests
-- ============================================================
-- 真權威:docs/specs/2026-06-24-m3-3ds-anomaly-refund-PRD.md(過 prd_review、codex K1 round3 = PASS 0 must-fix)§3(生命週期狀態機)/§4(安全權限)/§8(R1b1b 驗收)
--          + docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1b1b(行 166-175、逐字)+ §3(權限架構)+ §7 + §9 第 5 片 + §14 步 14。
-- canonical 經 Codex round4→11 共 8 輪、round11 PASS;PRD 經 codex K1 round1→3、round3 PASS;本片 = §14 唯一 45 步序之步 14(R1 migration bundle 第五片)。
-- 依賴:20260624120003(R1b1a anomaly 主表 + append-only event 表;本片兩 RPC 操作對象)、20260612150000(payment_charge_attempts)、20260604120000(orders)、20260611120000(payment_confirmer 角色)。
--       🔴 **本片只 R1b1b 兩 owner-only RPC + tests;markCharged genesis(寫入 anomaly)= R1b1c、非本片。** 兩 RPC 不動既有物件(begin / R1a* / R1b1a 表結構皆不改)。
-- 鐵則 8(動 schema:2 新 SECDEF RPC、無 GRANT=owner-only)由 canonical/PRD 滿足;鐵則 12(payment / 雙扣 / 退款稽核 / migration)→ codex K2 + Codex Packet。L3(退款營運)→ 已過 prd_review。
--
-- 🔴 設計(PRD §3/§4 + canonical §4 R1b1b):兩個 owner-only RPC,退款 lifecycle 在系統內序列化;退款證據與稽核 append-only。
--   ① **claim_double_charge_anomaly_for_refund(p_anomaly_id uuid)**:
--      只允許 `open→refunding`,CAS `WHERE status='open'`(I3:平行/重複 claim 只一人成功);寫 refund_claimed_at=now()/refund_claimed_by=session_user;
--      成功(rowcount=1)同交易寫 `claim` event;rowcount=0(非 open 或不存在)= 正常「未領到」→ {claimed:false}、不寫 event、不 RAISE。
--   ② **resolve_double_charge_anomaly(p_anomaly_id uuid, p_resolution text, p_note text, p_provider_reference text DEFAULT NULL)** 四分支(FOR UPDATE 鎖列讀現態 + fail-closed 前置條件):
--      a. p_resolution='refunded'  → refunding→refunded(Dashboard 明確退款成功):note 必填非空 + provider 必填非空(退款證據);保留 claimed;寫 `refund_confirmed` event。
--      b. p_resolution='dismissed' → open→dismissed(確認非雙扣):note 必填非空、不得帶 provider;寫 `dismissed` event。
--      c. p_resolution='reopen'    → refunding→open(僅 TapPay 明確確認未退款/未執行):清主表六稽核欄(refund_claimed_at/by + refund_provider_reference + resolved_at/by + resolution_note)回乾淨 open、機械自足不依賴前態;
--         **reopen 不抹稽核歷史**(前次 claim event 留存)、同交易寫**兩筆** event `refund_not_executed` + `reopened`(canonical line 172 / I1)。
--      d. p_resolution='uncertain' → 退款結果不確定/Dashboard 回應遺失:**status 維持 refunding(fail-closed)**、僅寫 `refund_uncertain` event;**不 reopen、不再 claim、不再退款**(查明確定未退才 reopen、確定已退才 refunded)。
--      禁:refunded→open/refunding(終態不可逆)、dismissed→退款(終態不可逆)、open→refunded(不可跳過 refunding)、非 allowlist resolution、覆蓋 refund_target_rec_trade_id(RPC 完全不 UPDATE 此欄 = I2 immutable)。
--   ③ 兩 RPC 共同硬化(PRD §4.2 / canonical §3 round8 一/round7 二):
--      - SECURITY DEFINER + `SET search_path=''` + 全識別子 schema-qualified(pg_catalog.* / public.*)。
--      - REVOKE PUBLIC/anon/authenticated/service_role/payment_confirmer;**無 GRANT = owner/postgres only**(Phase 1 Sean 受控人工流程;未來正式 staff/admin 角色再獨立 migration 開權)。
--      - has_function_privilege 矩陣 fail-closed assert(4 負向角色 × EXECUTE 全 false;含 service_role,因 ALTER DEFAULT PRIVILEGES 預設回授 function EXECUTE 須顯式 REVOKE)。
--      - 稽核欄(refund_claimed_by / resolved_by / event actor_session_role)一律寫 **session_user**(非 current_user:SECDEF 內 current_user=function owner 會令稽核失真;session_user 記 DB session role、非真人 staff ID)。
--      - 每個狀態轉移/退款結果同交易 INSERT event(I1:主表變動與稽核原子綁定;reopen 兩筆、其餘各一筆;uncertain 不變主表只寫 event)。
--   ④ 🔴 誠實邊界(PRD §4.3 / canonical §7 round7 二、不得過度承諾):claim CAS **只序列化系統內退款工作**,**無法物理阻止 Sean 在 TapPay Dashboard 手動點兩次退款**。
--      真正防呆 = claim CAS + runbook(先 claim 才退)+ TapPay 狀態查證 + 不確定 fail-closed 保持 refunding + append-only 稽核;**本檔/報表/commit 不得寫「CAS 完全防止 Dashboard 重複退款」**。
--
-- ⚠️ 守線:本片只新增 1 migration 檔 + MCP 模擬(零留痕);不 db push(= §14 步 21 Sean、R1 bundle 連帶 S2b=live)、不 push/merge、不開 flag(TAPPAY_3DS_ENABLED false)、不擴張 scope。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-24;單一 atomic DO block:
--   🔴 R1b1b 依賴 R1b1a 兩表 → DO block 內**先套 R1b1a 兩表 DDL**(引用 prod 既有 payment_charge_attempts/orders 滿足 FK)→ CREATE 本片兩 RPC →
--   anomaly 列以 owner 直接 INSERT(引用 prod 既有 attempt/order id、唯讀引用、皆隨末端 RAISE 'SENTINEL_OK_R1B1B' rollback)→ 行為測 → RAISE 強制 rollback、零留痕、跑後 catalog residue=0):
--   - claim:open→refunding 成功(refund_claimed_* 寫入 + claim event)+ 第二次 claim(status≠open)rowcount=0 / {claimed:false} / 不增 event。
--   - resolve 四分支:refunding→refunded(provider 必填、寫 refund_confirmed)/ open→dismissed(note 必填、寫 dismissed)/ refunding→open reopen(清主表六稽核欄 + 寫 refund_not_executed+reopened 兩筆 event、前次 claim event 留存)/ uncertain 維持 refunding(寫 refund_uncertain、主表零變)。
--   - 非法轉移否決:open→refunded、refunded→reopen/refunded(終態)、dismissed→refunded(終態)、refunded provider 空、dismissed 帶 provider、note 空、非 allowlist resolution、不存在 anomaly。
--   - immutable:resolve 全程不改 refund_target_rec_trade_id(前後比對相等)。
--   - append-only:event 表無 UPDATE/DELETE RPC(本片只 INSERT);table ACL 全 REVOKE(R1b1a 已驗、本片不重複改)。
--   - ACL 矩陣:has_function_privilege 兩 RPC × {anon,authenticated,service_role,payment_confirmer} EXECUTE 全 false;anon/authenticated literal SET ROLE 實呼 → permission denied(NOLOGIN、pooled MCP 不斷);payment_confirmer/service_role 走 has_function_privilege 等價(SET ROLE LOGIN + SECDEF 斷 pooled MCP、沿用 20260612150000/R1a2/R1a3 先例)。
--   跑後 catalog residue=0 複查(兩 RPC 不殘留、兩表不殘留)。結果回填 commit body / Codex Packet。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. claim_double_charge_anomaly_for_refund(owner-only CAS open→refunding)──
CREATE OR REPLACE FUNCTION public.claim_double_charge_anomaly_for_refund(p_anomaly_id uuid)
RETURNS jsonb  -- {claimed: boolean}(true=CAS open→refunding 成功 / false=非 open 或不存在;平行/重複 claim 只一人 true)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor text    := session_user;   -- 稽核記 DB session role(非 current_user=function owner、非真人 staff)
  v_n     integer;
BEGIN
  -- CAS:WHERE status='open' → I3 平行/重複 claim 只一人成功;open→refunding 滿足主表 refunding 一致性 CHECK(寫 claimed、不動 resolved)
  UPDATE public.payment_double_charge_anomalies a
     SET status            = 'refunding',
         refund_claimed_at = pg_catalog.now(),
         refund_claimed_by = v_actor
   WHERE a.id     = p_anomaly_id
     AND a.status = 'open';

  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 1 THEN
    -- I1:同交易寫 claim event(主表轉移與稽核原子綁定)
    INSERT INTO public.payment_double_charge_anomaly_events
      (anomaly_id, event_type, from_status, to_status, actor_session_role, note)
    VALUES
      (p_anomaly_id, 'claim', 'open', 'refunding', v_actor,
       'claim:open→refunding(owner CAS、領取退款工作)');
  END IF;

  -- rowcount=0 = 非 open 或不存在 = 正常「未領到」(平行落敗 / 已處理);不 RAISE、不寫 event
  RETURN pg_catalog.jsonb_build_object('claimed', v_n = 1);
END;
$fn$;

COMMENT ON FUNCTION public.claim_double_charge_anomaly_for_refund(uuid) IS
  'M-3 3DS R1b1b owner-only anomaly claim(SECDEF、search_path='''')。CAS open→refunding(WHERE status=''open''、平行/重複 claim 只一人成功),寫 refund_claimed_at=now()/refund_claimed_by=session_user + 同交易 claim event。rowcount=0(非 open/不存在)= 正常未領到、回 {claimed:false} 不 RAISE。REVOKE 5 角色、owner/postgres only。🔴 CAS 只序列化系統內退款工作、無法物理阻止 Dashboard 重複退款(防呆=claim+runbook+狀態查證+不確定 fail-closed)。';


-- ── 2. resolve_double_charge_anomaly(owner-only;refunded / dismissed / reopen / uncertain 四分支)──
CREATE OR REPLACE FUNCTION public.resolve_double_charge_anomaly(
  p_anomaly_id         uuid,
  p_resolution         text,
  p_note               text,
  p_provider_reference text DEFAULT NULL
)
RETURNS jsonb  -- {resolved: boolean, status: <新狀態>}(uncertain 維持 refunding → resolved:false)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor  text := session_user;
  v_status text;
  v_note   text := pg_catalog.btrim(COALESCE(p_note, ''));               -- 驗證 + 寫入皆用 trim 後正規值(稽核欄整潔)
  v_prov   text := pg_catalog.btrim(COALESCE(p_provider_reference, '')); -- 同上;uncertain 以 NULLIF 還原 NULL
BEGIN
  -- resolution allowlist fail-closed(非 allowlist 一律 RAISE)
  IF p_resolution IS NULL
     OR p_resolution NOT IN ('refunded', 'dismissed', 'reopen', 'uncertain') THEN
    RAISE EXCEPTION 'resolve_double_charge_anomaly:非法 resolution %(allowlist refunded|dismissed|reopen|uncertain)', p_resolution;
  END IF;

  -- 所有分支均需 note(event.note NOT NULL + 操作稽核留痕)
  IF v_note = '' THEN
    RAISE EXCEPTION 'resolve_double_charge_anomaly:resolution_note 必填非空';
  END IF;

  -- 鎖列讀現態(序列化 + fail-closed 前置條件判定;不存在 → RAISE)
  SELECT a.status INTO v_status
    FROM public.payment_double_charge_anomalies a
   WHERE a.id = p_anomaly_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolve_double_charge_anomaly:anomaly % 不存在', p_anomaly_id;
  END IF;

  -- ── 分支 a:refunding→refunded(Dashboard 明確退款成功;provider 必填非空)──
  IF p_resolution = 'refunded' THEN
    IF v_status <> 'refunding' THEN
      RAISE EXCEPTION 'resolve→refunded 僅允許 refunding(現態 %);禁 open→refunded 直跳 / refunded·dismissed 終態不可逆', v_status;
    END IF;
    IF v_prov = '' THEN
      RAISE EXCEPTION 'resolve→refunded:refund_provider_reference 必填非空(退款證據)';
    END IF;
    UPDATE public.payment_double_charge_anomalies a
       SET status                    = 'refunded',
           resolved_at               = pg_catalog.now(),
           resolved_by               = v_actor,
           resolution_note           = v_note,
           refund_provider_reference = v_prov   -- 不改 refund_target_rec_trade_id(I2 immutable)
     WHERE a.id = p_anomaly_id AND a.status = 'refunding';
    INSERT INTO public.payment_double_charge_anomaly_events
      (anomaly_id, event_type, from_status, to_status, actor_session_role, note, provider_reference)
    VALUES
      (p_anomaly_id, 'refund_confirmed', 'refunding', 'refunded', v_actor, v_note, v_prov);
    RETURN pg_catalog.jsonb_build_object('resolved', true, 'status', 'refunded');

  -- ── 分支 b:open→dismissed(確認非雙扣;note 必填、不得帶 provider)──
  ELSIF p_resolution = 'dismissed' THEN
    IF v_status <> 'open' THEN
      RAISE EXCEPTION 'resolve→dismissed 僅允許 open(現態 %);終態不可逆 / refunding 須先 reopen 或 refunded', v_status;
    END IF;
    IF v_prov <> '' THEN
      RAISE EXCEPTION 'resolve→dismissed:dismissed 非退款、不得帶 refund_provider_reference';
    END IF;
    UPDATE public.payment_double_charge_anomalies a
       SET status          = 'dismissed',
           resolved_at     = pg_catalog.now(),
           resolved_by     = v_actor,
           resolution_note = v_note
     WHERE a.id = p_anomaly_id AND a.status = 'open';
    INSERT INTO public.payment_double_charge_anomaly_events
      (anomaly_id, event_type, from_status, to_status, actor_session_role, note)
    VALUES
      (p_anomaly_id, 'dismissed', 'open', 'dismissed', v_actor, v_note);
    RETURN pg_catalog.jsonb_build_object('resolved', true, 'status', 'dismissed');

  -- ── 分支 c:refunding→open reopen(僅 TapPay 明確確認未退款/未執行;清主表 claimed/provider、event 留歷史)──
  ELSIF p_resolution = 'reopen' THEN
    IF v_status <> 'refunding' THEN
      RAISE EXCEPTION 'resolve reopen 僅允許 refunding→open(現態 %)', v_status;
    END IF;
    UPDATE public.payment_double_charge_anomalies a
       SET status                    = 'open',
           refund_claimed_at         = NULL,
           refund_claimed_by         = NULL,
           refund_provider_reference = NULL,
           resolved_at               = NULL,   -- refunding CHECK 已保證為 NULL;此處顯式清、令乾淨 open 由本 UPDATE 機械自足、不依賴前態
           resolved_by               = NULL,
           resolution_note           = NULL    -- refunding CHECK 未約束 note → 顯式清坐實 open 一致性 CHECK(六稽核欄皆 NULL)
     WHERE a.id = p_anomaly_id AND a.status = 'refunding';
    -- I1:reopen 同交易寫**兩筆** event(canonical line 172);reopen 不抹稽核歷史(前次 claim event 留存)
    INSERT INTO public.payment_double_charge_anomaly_events
      (anomaly_id, event_type, from_status, to_status, actor_session_role, note)
    VALUES
      (p_anomaly_id, 'refund_not_executed', 'refunding', 'open', v_actor, v_note),
      (p_anomaly_id, 'reopened',            'refunding', 'open', v_actor, v_note);
    RETURN pg_catalog.jsonb_build_object('resolved', true, 'status', 'open');

  -- ── 分支 d:退款結果不確定 → 維持 refunding(fail-closed;不 reopen / 不再 claim / 不再退款)──
  ELSE  -- p_resolution = 'uncertain'
    IF v_status <> 'refunding' THEN
      RAISE EXCEPTION 'resolve uncertain 僅允許 refunding(現態 %)', v_status;
    END IF;
    -- 主表零變動(維持 refunding);僅寫 refund_uncertain event 進人工查證
    INSERT INTO public.payment_double_charge_anomaly_events
      (anomaly_id, event_type, from_status, to_status, actor_session_role, note, provider_reference)
    VALUES
      (p_anomaly_id, 'refund_uncertain', 'refunding', 'refunding', v_actor, v_note, NULLIF(v_prov, ''));
    RETURN pg_catalog.jsonb_build_object('resolved', false, 'status', 'refunding');
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.resolve_double_charge_anomaly(uuid, text, text, text) IS
  'M-3 3DS R1b1b owner-only anomaly resolve(SECDEF、search_path='''')。FOR UPDATE 鎖列讀現態後四分支:refunded(refunding→refunded、note+provider 必填、寫 refund_confirmed)/ dismissed(open→dismissed、note 必填、不得帶 provider、寫 dismissed)/ reopen(refunding→open、清主表六稽核欄、寫 refund_not_executed+reopened 兩筆、不抹稽核)/ uncertain(維持 refunding、寫 refund_uncertain、fail-closed)。禁終態不可逆轉移 / open→refunded 直跳 / 非 allowlist resolution / 改 refund_target_rec_trade_id。稽核欄寫 session_user。REVOKE 5 角色、owner/postgres only。';


-- ── 3. ACL(PRD §4.2 / canonical §4 R1b1b line 167:REVOKE PUBLIC/anon/authenticated/service_role/payment_confirmer、無 GRANT = owner/postgres only)──
REVOKE ALL ON FUNCTION public.claim_double_charge_anomaly_for_refund(uuid)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
REVOKE ALL ON FUNCTION public.resolve_double_charge_anomaly(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;

-- 🔴 函式權限矩陣 fail-closed assert(owner-only:4 負向角色 × EXECUTE 全 false;任一不符 → 擋 db push)
DO $$
DECLARE
  v_cnt integer;
BEGIN
  IF has_function_privilege('anon',              'public.claim_double_charge_anomaly_for_refund(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',  'public.claim_double_charge_anomaly_for_refund(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',    'public.claim_double_charge_anomaly_for_refund(uuid)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.claim_double_charge_anomaly_for_refund(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',              'public.resolve_double_charge_anomaly(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated',  'public.resolve_double_charge_anomaly(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role',    'public.resolve_double_charge_anomaly(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.resolve_double_charge_anomaly(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R1b1b owner-only RPC EXECUTE 權限矩陣異常 — 應 owner/postgres only(anon/authenticated/service_role/payment_confirmer 全無 EXECUTE);拒繼續';
  END IF;

  -- role_routine_grants 顯式 grant 零(對稱坐實「零 routine grant」、對齊 R1b1a 表層 role_table_grants/role_column_grants)
  SELECT count(*) INTO v_cnt
    FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public'
     AND routine_name IN ('claim_double_charge_anomaly_for_refund', 'resolve_double_charge_anomaly')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'payment_confirmer');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'R1b1b owner-only RPC role_routine_grants 非零(% 筆)— 應 4 角色零 routine 顯式 grant;拒繼續', v_cnt;
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.resolve_double_charge_anomaly(uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.claim_double_charge_anomaly_for_refund(uuid);
-- ============================================================
