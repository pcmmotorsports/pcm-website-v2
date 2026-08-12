-- ============================================================
-- M-4b · L5b-2 片 2e:`close_released_attempt` 加入序列化點與退款否決
--
-- plan = docs/specs/2026-08-12-l5b2-2e-close-advisory-plan.md(**v4**;關卡1 + code-reviewer R1 + codex R2 全折)
-- 母 plan = docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md(v8)§3a-4/3a-5/3a-6a/§2b
-- 依賴 = 2d(20260811110000,已 apply)+ 沖銷片(20260812140000,已 apply,交付 canonical view)
--
-- 這片做三件(其餘本體逐字不動):
--   A. 無鎖預讀 order_id → B. 取 advisory(訂單級序列化點)→ 才走原本的 attempt FOR UPDATE
--      理由:沿現況「先 FOR UPDATE 再取 advisory」會構成
--      「close 持 attempt 列鎖等 advisory ╱ 補償持 advisory 等 attempt KEY SHARE」= 40P01(母 plan :258-260)
--   C. order_id 復核(P2E02):步 3 會覆蓋 v_order_id ⇒ 鎖錯隊伍原本是**靜默**的(關卡1 MF3)
--   D. 該 attempt 有未結案退款 ⇒ 拒結案(P2E01),**終局定義一律消費 canonical view**
--      (沖銷片 §2d-1 契約;母 plan :476 的「認 result_confirmed」字面已被它取代)
--
-- 🔴 CREATE OR REPLACE 會整支重寫函式屬性,子句沒寫到的一律回預設。
--    實測(拋棄式 PG17.10):不帶子句 ⇒ proconfig → NULL、prosecdef → **false**。
--    ⇒ SECURITY DEFINER / SET search_path / SET lock_timeout 三者缺一不可,後置斷言逐項釘死。
--
-- 🔴 lock_timeout 放**函式層 SET 子句**、不放 body:
--    body 內的 `SET LOCAL` 是交易尺度、**不隨函式返回還原**(實測:返回後仍是 3s);
--    函式層 SET 子句才有 save/restore 邊界(實測:函式內 3s、返回後回 0)。
--
-- 🔴 死結射程(關卡1 MF1;R2 codex must-fix 1 再度收窄):本片**不宣稱消滅死結**。
--    ❌ v3 的前提寫成「呼叫端交易在呼叫前沒有持有**該訂單相關列鎖**」= **太窄,被 R2 擊破**。
--       反例(與該訂單無關的第三資源 R 就夠):
--         A: BEGIN; SELECT close(<Y 的 attempt>);  → 取得 advisory(Y),交易**還沒結束**
--            …接著在同一交易內去要 R                → 等 R
--         B: BEGIN; <取得 R>; SELECT close(<Y 的另一 attempt>);
--                                                  → 持 R,等 advisory(Y)
--       ⇒ 成環。B **從頭到尾沒碰過該訂單任何列**,舊前提放行它。
--       根因:`pg_advisory_xact_lock` 持有到**整個交易結束**,不是函式返回。
--    ✅ 正確前提(唯一寫法):**本函式只能在「單語句交易」內呼叫** ——
--       呼叫端交易在本呼叫之外不得持有、也不得後續等待**任何**可爭用資源(不限於該訂單相關列)。
--    🔴 前提**完全沒有機制守**,而且比 v3 寫的還弱:全 repo grep,`close_released_attempt`
--       **沒有任何應用層 caller**(只有 database.types.ts 的產生型別)⇒ 唯一路徑是 **owner 手動 psql**
--       ⇒ 「正式路徑是單語句 RPC」不是既成事實,是**對未來 caller 的要求**。誰接它誰要遵守。
--    可構造的反例(harness L4 會真的跑):
--      S1: BEGIN; UPDATE orders WHERE id=Y;  SELECT close(<Y 的 attempt>);   ← 持列鎖等 advisory(Y)
--      S2: SELECT close(<Y 的另一 attempt>);                                 ← 持 advisory(Y) 等 orders(Y) FOR UPDATE
--      ⇒ 本機實測 40P01(deadlock_timeout 1s < lock_timeout 3s ⇒ 死結偵測先發火)。
--      ⚠️ SQLSTATE 是**環境相依的**(R2 codex important 6):正式庫的 `deadlock_timeout` **本片未量**;
--         若它 ≥ 3s,函式層 lock_timeout 會先到 ⇒ 得到的是 **55P03 而不是 40P01**。
--         兩者**安全方向相同**(都失敗、都不寫),但**診斷字面不同** ⇒ 別把 40P01 當成判斷依據寫進 runbook。
--
-- 🔴 與 begin_charge_attempt 的鎖序關係(R1 #3 更正,2f/2g 請照本段、別照舊字面):
--    begin **也取 advisory**(20260804120000:126,per-user 鍵 `hashtextextended(customer_user_id)`),
--    而且它的順序是 **orders FOR UPDATE(:100)先於 advisory(:126)= 與本片相反**。
--    仍然不成環的理由**不是**「begin 不參與 advisory」(那句話是錯的,plan v2 §4 曾這樣寫),
--    而是**兩把鍵不同**:per-user vs per-order = advisory 空間裡的**不同鎖物件**
--    ⇒ 沒有共用節點可構成環。本片對 begin 的關係維持「只阻塞不死結」(A8c1 世代結論不變)。
--
-- 呼叫面:proacl = postgres=X/postgres(**僅 owner**;COMMENT 逐字「REVOKE 5 角色含 payment_confirmer、
--   無 GRANT = owner/postgres only」)⇒ **無員工路徑**;母 plan :395-397 的「員工可見」揭露對本片不成立
--   (主視窗 P-561-A 裁 Q-2e-3=照實改:揭露文字=「owner 手動路徑,從無限等改成 3s 快速失敗」)。
--   postgres 角色實測 current_setting('lock_timeout') = 0 ⇒ 本片加的 3s **不是死碼**。
--
-- Rollback:scripts/l5b2-2e-rollback.sql
--   🔴 **必須整支單一交易跑**,禁止只抄座標逐句手跑(理由寫在該檔檔頭)。
--   🔴 還原來源是**兩個不同的檔**:本體=20260624120010:70-136(md5 機械驗過)、
--      COMMENT=20260804120000:215(A8c1 只重寫 COMMENT、沒動本體)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';


-- ── ①. 前置閘(fail-closed;不對著陌生版本動手)────────────────────────────
DO $pre_2e$
DECLARE
  v_md5   text;
  v_acl   text;
  v_cfg   text;
  v_owner text;
  v_sec   boolean;
BEGIN
  -- 隔離閘:DDL 在 RR 下對別的交易的可見性推論會失真(形制照沖銷片 §①)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '2e 前置閘:apply 必須在 read committed 下執行(實際=%)',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_isolation_required';
  END IF;

  -- pre-image 指紋:prosrc(檔內字面、跨環境穩定;不用 pg_get_functiondef)
  SELECT pg_catalog.md5(p.prosrc),
         COALESCE(pg_catalog.array_to_string(p.proacl, ' | '), '(NULL)'),
         COALESCE(pg_catalog.array_to_string(p.proconfig, ' | '), '(NULL)'),
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef
    INTO v_md5, v_acl, v_cfg, v_owner, v_sec
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_attempt_id uuid, p_resolution text';

  IF NOT FOUND THEN
    RAISE EXCEPTION '2e 前置閘:找不到 public.close_released_attempt(uuid, text)'
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_preimage_missing';
  END IF;

  IF v_md5 IS DISTINCT FROM 'fa8afcc2bf0f3c683e156a719fea80f0' THEN
    RAISE EXCEPTION '2e 前置閘:close_released_attempt 定義漂移(md5=%,期望 fa8afcc2bf0f3c683e156a719fea80f0)'
                    ';本片的 DDL 是硬編碼的,跑下去會把別人的改動無聲吃掉。停下人工判斷。', v_md5
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_preimage_drift';
  END IF;

  -- pre-image 的 ACL/owner/proconfig/secdef 也要對:後置斷言比的是「有沒有被我改壞」,
  -- 前置比的是「我以為的起點對不對」。少了這道,起點就已經不同時後置照樣全綠。
  IF v_acl IS DISTINCT FROM 'postgres=X/postgres' THEN
    RAISE EXCEPTION '2e 前置閘:proacl 非預期(實際=[%],期望 [postgres=X/postgres])', v_acl
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_preimage_acl';
  END IF;
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '2e 前置閘:proconfig 非預期(實際=[%],期望 [search_path=""])', v_cfg
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_preimage_proconfig';
  END IF;
  IF v_owner IS DISTINCT FROM 'postgres' OR NOT v_sec THEN
    RAISE EXCEPTION '2e 前置閘:owner/secdef 非預期(owner=%、secdef=%)', v_owner, v_sec
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_preimage_owner';
  END IF;

  -- canonical view 必須在庫:缺它則新增的否決條件**恆假**(無聲失效,而不是報錯)
  IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'payment_refund_effective_terminal'
           AND c.relkind = 'v') THEN
    RAISE EXCEPTION '2e 前置閘:canonical view public.payment_refund_effective_terminal 不在庫 '
                    '⇒ 沖銷片(20260812140000)未 apply。缺它本片的否決條件會恆假=無聲失效。'
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_canonical_view_required';
  END IF;

  -- 🔴 「在庫」還不夠,要**讀得到**(R1 must-fix 2):payment_refunds / payment_refund_events
  --    已 ENABLE RLS 且**零 policy**(20260810140000:150)。任一被開 FORCE ROW LEVEL SECURITY
  --    ⇒ **在函式 owner 不是 superuser 且沒有 BYPASSRLS 的前提下**,連 owner 都被自己的 RLS 擋死
  --    ⇒ 否決那道 SELECT 回 0 列 = P2E01 **恆假、無聲失效**(不是報錯)。形制照先例 20260803130000:292-299。
  --    🔴 **那個前提本片沒驗過**(R2 codex important 1):superuser / BYPASSRLS **永遠**繞過 RLS,
  --       本機拋棄式叢集的 postgres 正是 superuser+bypassrls(實測:FORCE 開/關都讀得到列)
  --       ⇒ **本斷言目前是結構型早期預警,不是被行為證明過的防線**。
  --       正式庫的 `postgres` 屬性由 apply preflight 查(P-570-A §1),查完才知道它有沒有牙。
  --    ⚠️ 射程:只擋 FORCE 這個**靜默**模式;若表 owner 換人導致無 SELECT 權,那是 fail-loud(會報錯)。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
              WHERE c.oid IN ('public.payment_refunds'::regclass,
                              'public.payment_refund_events'::regclass)
                AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION '2e 前置閘:payment_refunds / payment_refund_events 之中有表開了 FORCE ROW LEVEL SECURITY '
                    '⇒ SECDEF 會被自己擋死、本片的退款否決恆假無聲失效。停下人工判斷。'
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_force_rls_blocked';
  END IF;

  -- 2d 的 result_confirmed 值域仍在(canonical view 的語意上游)
  IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = 'public.payment_refund_events'::regclass
           AND c.conname = 'pre_event_type_chk'
           AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid), 'result_confirmed') > 0) THEN
    RAISE EXCEPTION '2e 前置閘:pre_event_type_chk 不含 result_confirmed ⇒ 2d 的值域被動過'
      USING ERRCODE = 'P2E10', CONSTRAINT = 'l5b2_2e_result_confirmed_required';
  END IF;
END
$pre_2e$;


-- ── ②. close_released_attempt:CREATE OR REPLACE ──────────────────────────
-- 🔴 三個子句缺一不可(實測:不寫就分別回 NULL / false)
CREATE OR REPLACE FUNCTION public.close_released_attempt(
  p_attempt_id uuid,
  p_resolution text
)
RETURNS jsonb  -- {closed: boolean, idempotent: boolean}(closed 永 true=結案/已結案;非 released/charged/paid/不存在 一律 RAISE)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $fn$
DECLARE
  v_actor        text := session_user;                            -- 稽核記 DB session role(非 current_user=function owner;對齊 R1b1b)
  v_status       text;
  v_closed_at    timestamptz;
  v_order_id     uuid;
  v_order_id_pre uuid;                                            -- 2e:advisory 取鍵用的**無鎖**預讀值(與步 3 的鎖下值分開存,才驗得出漂移)
  v_order_status public.payment_status;
  v_resolution   text := pg_catalog.btrim(COALESCE(p_resolution, ''));  -- 驗證 + 寫入皆用 trim 後正規值(稽核欄整潔)
  v_n            integer;
  v_blocking     uuid;                                            -- 2e:擋住結案的那筆未結案退款
BEGIN
  -- p_resolution 必填非空(group_chk 要求 released_close_resolution 非 NULL + 操作稽核留痕;自由文字、非 enum)
  IF v_resolution = '' THEN
    RAISE EXCEPTION 'close_released_attempt:p_resolution 必填非空(人工結案理由)';
  END IF;

  -- 2e-A. 無鎖預讀 order_id(取 advisory 的鍵來源)
  --   為什麼無鎖是安全的:payment_charge_attempts.order_id 是建立時寫入的 FK,全 repo 無 UPDATE 改它。
  --   ⚠️ 那是**時點觀察、不是資料庫層不變量**(無 CHECK、無 trigger 擋 UPDATE)⇒ 步 C 另有 fail-closed 復核。
  --   NOT FOUND 在這裡 RAISE:pg_advisory_xact_lock(NULL) **回 NULL、不取任何鎖、不報錯**(實測)
  --      ⇒ 少了這道,不存在的 attempt 會**無鎖地繼續往下走**。
  --   ⚠️ **但這道在安全性上不是承重的**(R2 codex important 4 校正我原本的誇大字面):
  --      實測 M2b —— 拿掉本 RAISE 之後,`v_order_id_pre` 為 NULL 一路走到步 C,
  --      `<uuid> IS DISTINCT FROM NULL` = TRUE ⇒ **步 C 的 P2E02 嚴格攔住**(突變輪 M2 也只紅 md5 那格)。
  --      本道剩下的價值 = 清楚的錯誤訊息 + 不做一次無意義的 NULL 鍵 advisory 呼叫。**承重的是步 C。**
  SELECT a.order_id
    INTO v_order_id_pre
    FROM public.payment_charge_attempts a
   WHERE a.id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % 不存在', p_attempt_id;
  END IF;

  -- 2e-B. 訂單級序列化點(三方共用;母 plan §3a-4)
  --   🔴 鍵式子=字面契約,三方必須**逐字相同**,否則彼此不互斥而且完全無症狀。
  --      由 order_id(uuid)直接取前 64 bit,不經 hashtext(後者只有 32-bit,碰撞會讓不相干訂單共用隊伍)。
  --   🔴 必須在任何列鎖**之前**取(母 plan :258-261);往後挪 = 40P01 重生(harness M5 消融)。
  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(pg_catalog.replace(v_order_id_pre::text, '-', ''), 1, 16))::bit(64)::bigint);

  -- 鎖 attempt 列讀現態(鎖序 attempt→order、對齊 R1b2)
  SELECT a.status, a.released_closed_at, a.order_id
    INTO v_status, v_closed_at, v_order_id
    FROM public.payment_charge_attempts a
   WHERE a.id = p_attempt_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % 不存在', p_attempt_id;
  END IF;

  -- 2e-C. order_id 復核(fail-closed;關卡1 MF3)
  --   步 3 會**覆蓋** v_order_id ⇒ 若該欄在 A→3 之間被改,本函式會鎖住舊單的隊伍卻對新單動手,而且**完全靜默**。
  --   合法請求下兩值恆等(沒有路徑改得動它)⇒ 本道**不拒任何現行請求、不改任何述詞**。
  --   位置在冪等分支**之前**:承重假設被違反時,連冪等回應都不該給(那份回應是在錯的隊伍下算出來的)。
  IF v_order_id IS DISTINCT FROM v_order_id_pre THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % 的 order_id 在無鎖預讀(%)與鎖下重讀(%)之間改變 '
                    '⇒ advisory 鎖到的是舊單的隊伍,fail-closed 拒 close', p_attempt_id, v_order_id_pre, v_order_id
      USING ERRCODE = 'P2E02', CONSTRAINT = 'l5b2_2e_order_id_drift';
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

  -- 2e-D. 未結案退款否決(母 plan §2 片表 :576)
  --   🔴 終局的定義**一律消費 canonical view**,本函式不得自己再問「有沒有 manual」(沖銷片 §2d-1 契約)。
  --   位置:必須晚於冪等分支(否則「重複 close 一顆已結案、身上掛未結案退款的 attempt」
  --         會從 idempotent:true 變成被拒 = 改了既有語意)、晚於 released 檢查(既有診斷優先)、早於 UPDATE。
  --   只查 payment_refunds(attempt 尺度);order_refunds 是 order 尺度、無 attempt 欄,
  --   且該情形本來就過不了下方的 order-paid guard(harness M9 觀察那道真的發火)。
  SELECT pr.id
    INTO v_blocking
    FROM public.payment_refunds pr
   WHERE pr.attempt_id = p_attempt_id
     AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                      WHERE et.refund_id = pr.id)
   LIMIT 1;
  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'close_released_attempt:attempt % 尚有未結案退款(payment_refunds.id=%)⇒ 拒結案。'
                    '先讓該筆退款走到有效終局(或用 admin_correct_refund_manual_verdict 修正判定)再 close。',
                    p_attempt_id, v_blocking
      USING ERRCODE = 'P2E01', CONSTRAINT = 'l5b2_2e_refund_in_flight';
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


-- ── ③. COMMENT(基底=20260804120000:215 的 A8c1 世代字面 + 2e 四件新語意)──
COMMENT ON FUNCTION public.close_released_attempt(uuid, text) IS
  'M-3 3DS R1c3 owner-only 人工結案(SECDEF、search_path='''')。Sean 取得 TapPay 明確終局(未扣款)後收尾 released attempt:released→failed + 寫 released_closed_at=now()/released_closed_by=session_user/released_close_resolution=p_resolution(三欄成組、滿足 R1a1 group_chk)。order-paid guard fail-closed(order 非 unpaid → RAISE,潛在雙扣走 W1 退款)+ charged/pending/plain-failed 拒(僅 released 可 close)+ 重複 close 冪等(failed+closed_at 非 NULL → no-op、保留首次三欄、{idempotent:true})。🔴 鎖序 attempt→order;E10-A8c1(2026-08-04)起 begin 持 orders 先鎖 ⇒「無反向鎖序 ⇒ 無死結」舊字面(本檔源 migration 檔頭 :24-27)失效——本函式對 begin 只阻塞不死結(同構 mark_failed;實測 scripts/a8c1-verify.sh L3b)。p_resolution 自由文字(非 enum、btrim 非空)。REVOKE 5 角色含 payment_confirmer、無 GRANT = owner/postgres only(Phase 1 受控人工流程)。'
  '🆕 L5b-2 片 2e(20260812160000):①無鎖預讀 order_id → 取 order 級 advisory → 才走 attempt FOR UPDATE(三方共用序列化點,母 plan §3a-4;鍵式子=pg_advisory_xact_lock((''x''||substr(replace(order_id::text,''-'',''''),1,16))::bit(64)::bigint),三方必須逐字相同,不經 hashtext=避 32-bit 碰撞讓不相干訂單共用隊伍)②order_id 無鎖/鎖下復核不符 → P2E02 fail-closed(承重假設「order_id 不可變」只是時點觀察、非 schema 不變量)③該 attempt 有未結案退款(父列存在且 canonical view payment_refund_effective_terminal 無有效終局)→ P2E01 拒結案;終局定義一律消費該 view、本函式不自行判讀 manual ④函式層 SET lock_timeout=''3s''(放子句不放 body:body 內 SET LOCAL 是交易尺度、不隨函式返回還原;postgres 角色原本無限等)。'
  '🔴🔴 呼叫端前提(本函式管不到、無機制守,只能寫在這裡):**本函式只能在單語句交易內呼叫**。理由=本函式取的 advisory 持有到**整個交易結束**、不是函式返回 ⇒ 呼叫端交易只要在本呼叫之外還持有、或之後還會等待**任何**可爭用資源(不限於該訂單相關列),就可能與另一條同單呼叫成環:A 呼完 close 續等資源 R × B 持 R 再呼同單 close ⇒ 40P01(本機值;正式庫 deadlock_timeout 未量,若 ≥3s 會先得 55P03)。⚠️ 舊字面「勿在已動過該訂單相關列的交易內呼叫」**射程太窄、已作廢**(R2 codex MF1:B 從沒碰該訂單任何列也能成環)。⚠️ 本函式**目前沒有任何應用層 caller**(全 repo grep 僅產生型別)⇒ 「正式路徑是單語句 RPC」是**對未來 caller 的要求**,不是既成事實。本片**不宣稱消滅死結**,只宣稱「在該前提成立之下 advisory 不會出現在環上」。';


-- ── ④. 後置斷言 ───────────────────────────────────────────────────────────
DO $post_2e$
DECLARE
  v_acl   text;
  v_cfg   text[];
  v_owner text;
  v_sec   boolean;
  v_src   text;
  v_bare  text;
  v_adv   integer;
  v_fu    integer;
  v_n     bigint;
  r       record;
BEGIN
  SELECT COALESCE(pg_catalog.array_to_string(p.proacl, ' | '), '(NULL)'),
         p.proconfig,
         pg_catalog.pg_get_userbyid(p.proowner),
         p.prosecdef,
         p.prosrc
    INTO v_acl, v_cfg, v_owner, v_sec, v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_attempt_id uuid, p_resolution text';

  -- ④-1 ACL 逐字(正向:僅 owner)
  IF v_acl IS DISTINCT FROM 'postgres=X/postgres' THEN
    RAISE EXCEPTION '2e 後置:proacl 被改動(實際=[%],期望 [postgres=X/postgres])', v_acl
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_acl';
  END IF;

  -- ④-2 ACL 負向:五個角色都不得有 EXECUTE
  --   ⚠️ 字面校正(R1 nit 10):本迴圈是**第一個命中就 RAISE、整個 apply abort**,
  --      不是「逐角色各報」——訊息帶得出是哪個角色,但**同時開了兩個角色只會看到第一個**。
  --      逐角色全報要改成收集後一次 RAISE;此處刻意不做(apply 面 fail-fast 即可,修完會重跑)。
  FOR r IN SELECT pg_catalog.unnest(ARRAY['anon','authenticated','service_role','authenticator','payment_confirmer']) AS rolname
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r.rolname)
       AND pg_catalog.has_function_privilege(r.rolname,
             'public.close_released_attempt(uuid, text)', 'EXECUTE') THEN
      RAISE EXCEPTION '2e 後置:角色 % 竟有 EXECUTE ⇒ 金流 RPC 對外開放', r.rolname
        USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_acl_negative';
    END IF;
  END LOOP;

  -- ④-3 owner
  IF v_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '2e 後置:owner=%(期望 postgres)', v_owner
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_owner';
  END IF;

  -- ④-4 SECURITY DEFINER(實測:CREATE OR REPLACE 不寫就變 false)
  IF NOT COALESCE(v_sec, false) THEN
    RAISE EXCEPTION '2e 後置:prosecdef=%(期望 true;CREATE OR REPLACE 漏寫 SECURITY DEFINER 會變 INVOKER)', v_sec
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_secdef';
  END IF;

  -- ④-5 proconfig:search_path 那一格(🔴 與 lock_timeout 分開兩格,
  --      否則兩個突變會紅在同一格、彼此的判別力互相遮蔽)
  IF NOT ('search_path=""' = ANY(COALESCE(v_cfg, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION '2e 後置:proconfig 缺 search_path=""(實際=[%])',
                    COALESCE(pg_catalog.array_to_string(v_cfg, ' | '), '(NULL)')
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_search_path';
  END IF;

  -- ④-6 proconfig:lock_timeout 那一格
  IF NOT ('lock_timeout=3s' = ANY(COALESCE(v_cfg, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION '2e 後置:proconfig 缺 lock_timeout=3s(實際=[%])',
                    COALESCE(pg_catalog.array_to_string(v_cfg, ' | '), '(NULL)')
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_lock_timeout';
  END IF;

  -- ④-7 advisory 鍵式子的逐字子字串(三方契約;2f/2g 會拿它做跨函式比對)
  IF pg_catalog.strpos(v_src,
       '(''x'' || pg_catalog.substr(pg_catalog.replace(v_order_id_pre::text, ''-'', ''''), 1, 16))::bit(64)::bigint') = 0 THEN
    RAISE EXCEPTION '2e 後置:prosrc 找不到 advisory 鍵式子的逐字字面 ⇒ 三方契約已漂移'
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_advisory_key';
  END IF;

  -- ④-8 順序錨:advisory 必須早於真列鎖
  --   🔴 先剝 -- 註解再比位置(recon §3 實測:不剝的話會量到註解;本函式目前量得對純屬運氣)
  --   🔴 本支找 'FOR UPDATE'(② admin_initiate_order_refund 是 'FOR NO KEY UPDATE',兩支不共用字串)
  --   ⚠️ 這只是**廉價前哨**,不是判別力來源;真判別力在 harness 的 M5 消融(移位後必須構造得出 40P01)。
  v_bare := pg_catalog.regexp_replace(v_src, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  v_adv  := pg_catalog.strpos(v_bare, 'pg_advisory_xact_lock');
  v_fu   := pg_catalog.strpos(v_bare, 'FOR UPDATE');
  IF v_adv = 0 OR v_fu = 0 OR v_adv >= v_fu THEN
    RAISE EXCEPTION '2e 後置:順序錨不成立(剝註解後 advisory 位置=%、FOR UPDATE 位置=%;需 0 < advisory < FOR UPDATE)', v_adv, v_fu
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_order_anchor';
  END IF;

  -- ④-9 COMMENT 的呼叫端前提句(R1 must-fix 4)
  --   §4 的死結不變量**沒有機制守**,唯一防線就是 COMMENT 那一句;而 `COMMENT ON FUNCTION`
  --   是任何後續片都能整支覆寫的,覆寫掉**完全無聲**(prosrc 不變 ⇒ md5 那格照樣綠)。
  --   ⇒ 把它釘成一格,讓「前提被靜靜刪掉」這件事會變色。
  IF pg_catalog.strpos(
       COALESCE(pg_catalog.obj_description(
                  'public.close_released_attempt(uuid, text)'::regprocedure, 'pg_proc'), ''),
       '本函式只能在單語句交易內呼叫') = 0 THEN
    RAISE EXCEPTION '2e 後置:COMMENT 缺呼叫端前提句(「本函式只能在單語句交易內呼叫」)'
                    ' ⇒ §4 不變量的唯一防線不見了'
      USING ERRCODE = 'P2E11', CONSTRAINT = 'l5b2_2e_post_comment_precondition';
  END IF;

  -- ④-10 apply 時點觀察(不是斷言;數字要進 apply 檢查表給 Sean)
  --   >0 代表 apply 之後那些 attempt 的人工結案會被 P2E01 擋住 —— 他該先知道數字,而不是撞到才知道。
  SELECT pg_catalog.count(*)
    INTO v_n
    FROM public.payment_refunds pr
   WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                      WHERE et.refund_id = pr.id);
  RAISE NOTICE '2e 觀察:目前「無有效終局」的 payment_refunds 父列數 = %(預期 0;>0 = 其 attempt 的人工結案自此被 P2E01 擋住)', v_n;

  RAISE NOTICE '2e 後置斷言全過(ACL 正負向 / owner / secdef / proconfig 兩格 / 鍵式子 / 順序錨 / COMMENT 前提句)。';
  RAISE NOTICE '2e post-image prosrc md5 = %(🔴 2f 的 preflight 要釘這顆)',
               (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
                  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public' AND p.proname='close_released_attempt');
END
$post_2e$;

COMMIT;
