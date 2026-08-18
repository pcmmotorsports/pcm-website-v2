-- ============================================================
-- M-4a · 人工待確認佇列的【出口】(Sean 已批 plan「可以開始做」;GR 審後換過形狀)
--
-- 🔴🔴 **本檔一旦進入 `supabase/migrations/`,下一發 `db push` 會【連它一起推】。**
--    ⇒ **apply 由主視窗/Sean 執行,G4 不碰正式庫。commit ≠ 批准 apply。**
-- 🔴 **重跑行為:fail-closed(重跑會炸)** —— 與同批一致。中途失敗要重跑 ⇒ 先手動清殘留物。
--
-- ── 病:佇列有入口沒出口 ────────────────────────────────────
--   `attempt_manual_review_count` 一旦 >0 就【永遠 >0】(全樹零處把 `needs_manual_review` 設回 false,
--   唯一那處 `20260624120002:53-58` 同時把 status 翻 released = 另一條路)
--   ⇒ 計數永遠不回 0 ⇒ **下一筆真的卡住時,它看起來跟舊的一樣。**
--
-- ── 🔴 而「出口」不是「把狀態改掉」(2026-08-19 GR 審打掉我的第一版形狀)──
--   第一版想的是「呼 mark_charge_attempt_failed 讓 status 離開 pending ⇒ 自然掉出述詞」。
--   **那會釋放鎖 + 允許重扣,而【沒有任何一步強制先對帳】**
--   (`20260624120006:59` 起函式本體四道:雙鍵驗+FOR UPDATE / 冪等 / order-paid guard / ROW_COUNT
--    —— 掃 settle|reconcil|tappay|Record 零命中)
--   ⇒ 佇列裡每一筆**定義上就是「不知道錢扣到沒」** ⇒ 若其實扣成功了 ⇒ 🔴 **重複扣款**。
--
-- ── 出口的正確定義:**離開【告警述詞】** ───────────────────
--   告警數的是 `needs_manual_review=true AND (pending OR superseded 的 charged/released) AND unpaid`
--   ⇒ **加一個「已人工檢視」時戳,並讓述詞排除它** ⇒ 計數回到 0,而 `status` 一個字都不用動。
--
--   🔴 **為什麼不直接把 `needs_manual_review` 設回 false**(那是最短的路,而它是錯的):
--     `20260621120000_m3_3ds_s2b_poll_settle_throttle.sql:49` 逐字:
--     「needs_manual_review=false —— 4a-2 把它當【停止自動 retry】durable 旗標;
--       否則會員可用輪詢繞過 ceiling/manual」
--     ⇒ 清它 = **把自動重試重新打開**,而那正是「還不知道錢扣到沒」那批最不該被重試的。
--     📌 與 `#651` 同族:一個欄位承擔兩個**要求不同**的角色 ⇒ 新增獨立欄位,不動那面旗子。
--
-- ── 🔴 三種對帳結果,而不是一種(GR 審抓到的 must-fix)────────
--   `p_outcome` **必填**,分流三條路:
--     'unknown'      真不確定 ⇒ 只寫時戳。**鎖留著、旗子留著、自動重試仍然關著。**
--     'not_charged'  確定沒扣到 ⇒ 時戳 + **釋鎖**(pending→released),客人可重新付款
--     'charged'      確定扣到了 ⇒ 🔴 **本片不做**,RAISE(見下)
--   🔴 **必填的意義不是欄位驗證,是【強迫按鈕的人講出他到底查到了什麼】** ——
--     那道「先對帳」的強制在既有函式裡不存在 ⇒ **它只能立在 RPC 的契約上**。
--
--   ⚠️ **`unknown` 那條路把單鎖著,而那是誠實的中間態,不是解決** ——
--     選它 ⇒ 告警清掉、**鎖留著** ⇒ 那張單客人仍然付不了。
--     🔴 它需要**自己的可見性**(一份清單,不是告警)⇒ **本片不做**,已寫進 plan §7 誠實揭示。
--     **寫在這裡是因為「不做」與「沒想到」在檔案上長得一樣。**
--
-- Plan: docs/specs/2026-08-18-manual-review-queue-has-no-exit-plan.md §4.0-e
-- Rollback(forward-only、僅供參考):
--   DROP FUNCTION public.admin_close_manual_review_attempt(uuid,uuid,text,text,text,text);
--   ALTER TABLE public.payment_charge_attempts
--     DROP CONSTRAINT payment_charge_attempts_manual_review_outcome_check,
--     DROP CONSTRAINT payment_charge_attempts_manual_review_pair_check,
--     DROP COLUMN manual_review_outcome, DROP COLUMN manual_reviewed_at;
--   CREATE OR REPLACE FUNCTION public.get_payment_anomaly_alert_summary(...) 回 20260810220000 的本體
--   🔴 而【已寫入的時戳會一起消失】⇒ 那些單會重新回到告警裡(不是資料遺失,是回到未處理狀態)
-- ============================================================

-- ── 1. 兩個新欄(不動 status、不動 needs_manual_review)────────
ALTER TABLE public.payment_charge_attempts
  ADD COLUMN manual_reviewed_at    timestamptz,
  ADD COLUMN manual_review_outcome text;

ALTER TABLE public.payment_charge_attempts
  ADD CONSTRAINT payment_charge_attempts_manual_review_outcome_check
    CHECK (manual_review_outcome IS NULL
           OR manual_review_outcome IN ('unknown', 'not_charged', 'charged')),
  -- 🔴 兩欄同生同滅:有時戳沒結果 = 「有人按過但沒說查到什麼」,那正是本片要防的
  ADD CONSTRAINT payment_charge_attempts_manual_review_pair_check
    CHECK ((manual_reviewed_at IS NULL) = (manual_review_outcome IS NULL));

COMMENT ON COLUMN public.payment_charge_attempts.manual_reviewed_at IS
  'M-4a 人工待確認佇列的【出口】:有人看過了。🔴 它【只讓那一列離開告警述詞】,不動 status、不動 needs_manual_review(後者同時是「停止自動 retry」的旗標,清它會把重試打開)。寫入唯一入口 = admin_close_manual_review_attempt()。';
COMMENT ON COLUMN public.payment_charge_attempts.manual_review_outcome IS
  'M-4a 人工對帳的結果:unknown(真不確定,鎖留著)/ not_charged(確定沒扣到,已釋鎖)/ charged(確定扣到了 —— 尚未實作,RPC 會 RAISE)。🔴 必填的意義是【強迫按鈕的人講出他查到了什麼】—— 「標成失敗」那條路沒有任何一步強制先對帳,那道強制只能立在契約上。';

-- ── 2. 告警述詞排除已檢視的列 ─────────────────────────────
-- 🔴 整支重貼自 `20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:316`,
--    **唯一的差異是 attempt_manual_review_count 多一行 `AND a.manual_reviewed_at IS NULL`**。
--    (其餘六個計數逐字未動 —— 重貼是因為 PG 沒有「只改一個 CTE」的語法,不是因為它們要改。)
CREATE OR REPLACE FUNCTION public.get_payment_anomaly_alert_summary(
  p_refunding_stuck_seconds  integer,
  p_pending_dc_window_seconds integer,
  p_pending_dc_stuck_seconds  integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'open_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'open'),
    'refunding_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'refunding'),
    'refunding_stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'refunding'
          AND refund_claimed_at < pg_catalog.now()
              - pg_catalog.make_interval(secs => GREATEST(0, LEAST(COALESCE(p_refunding_stuck_seconds, 86400), 30 * 24 * 3600)))),
    'oldest_open_age_seconds',
      (SELECT (EXTRACT(EPOCH FROM (pg_catalog.now() - pg_catalog.min(created_at))))::bigint
         FROM public.payment_double_charge_anomalies
        WHERE status = 'open'),
    'attempt_manual_review_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_charge_attempts a
         JOIN public.orders o ON o.id = a.order_id
        WHERE a.needs_manual_review = true
          AND ( a.status = 'pending'
                OR ( a.superseded_at IS NOT NULL
                     AND a.status IN ('charged', 'released') ) )
          AND o.payment_status = 'unpaid'::public.payment_status
          -- 🔴 M-4a 出口:有人看過了就離開這個計數。**這是本檔唯一改動的一行。**
          --    它【不】改 status、【不】清 needs_manual_review ⇒ 鎖仍在、自動重試仍關著。
          AND a.manual_reviewed_at IS NULL),
    'released_stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_charge_attempts a
         JOIN public.orders o ON o.id = a.order_id
        WHERE a.released_manual_review_at IS NOT NULL
          AND a.status = 'released'
          AND o.payment_status = 'unpaid'::public.payment_status),
    'pending_double_charge_candidate_count',
      (SELECT pg_catalog.count(*) FROM (
         SELECT o1.customer_user_id, o1.total
           FROM public.orders o1
           JOIN public.orders o2
             ON o1.customer_user_id = o2.customer_user_id
            AND o1.total            = o2.total
            AND o1.id              <  o2.id
            AND o1.payment_status = 'paid'::public.payment_status
            AND o2.payment_status = 'paid'::public.payment_status
            AND o1.paid_at IS NOT NULL AND o2.paid_at IS NOT NULL
            AND pg_catalog.abs(EXTRACT(EPOCH FROM (o1.paid_at - o2.paid_at)))
                < GREATEST(0, LEAST(COALESCE(p_pending_dc_window_seconds, 43200), 30 * 24 * 3600))
          WHERE EXISTS (
                  SELECT 1
                    FROM public.payment_charge_attempts a
                   WHERE a.order_id IN (o1.id, o2.id)
                     AND a.status = 'charged'
                     AND EXTRACT(EPOCH FROM (a.updated_at - a.created_at))
                         > GREATEST(0, LEAST(COALESCE(p_pending_dc_stuck_seconds, 600), 24 * 3600))
                )
          GROUP BY o1.customer_user_id, o1.total
       ) x)
  );
$fn$;

COMMENT ON FUNCTION public.get_payment_anomaly_alert_summary(integer, integer, integer) IS
  'M-3 #250 + #256 + M-4b L5b-0-s(甲)改③ + 🔴 M-4a 出口:attempt_manual_review_count 多一條 `manual_reviewed_at IS NULL` —— 有人看過的那一列離開計數,而 status 與 needs_manual_review 一個字都沒動(後者同時是「停止自動 retry」的旗標)。其餘六個計數逐字未動;整支重貼只因為 PG 沒有「只改一個子查詢」的語法。前一版本體與完整說明見 20260810220000_m4b_lifecycle_l5b0s_supersede_sweeper_ceiling.sql:316。';

-- ── 3. 出口 RPC ────────────────────────────────────────────
-- 🔴 **本片【只實作 `unknown`】。`not_charged` 與 `charged` 一律 RAISE。**
--    為什麼:那兩條都會**動到錢或動到鎖**,而它們各自需要自己的一片 + 鐵則 12 審查:
--      · `not_charged` 要把 pending 翻 released ⇒ 那是**既有狀態機的第二份實作**
--        (`mark_charge_attempt_released_for_user:53-58` 已有一份,四閘 CAS 為【客人自己的動作】設計)
--        ⇒ 抄第二份 = 同一道轉換有兩個版本而它們會漂,而漂掉那天的症狀是【錢】。
--      · `charged` 要補入帳 ⇒ 明確動錢。
--    ⚠️ **所以本片交付的是「告警的出口」,不是「訂單的出口」** ——
--      選 `unknown` 之後**那張單仍然鎖著、客人仍然付不了**。**這句不要被讀成別的。**
--    🔴 而 RAISE **不是敷衍**:它讓「這條路還沒做」變成**當場看得見**,
--      而不是讓按鈕的人以為自己處理完了。(訊息裡直接寫下一步該找誰。)
CREATE FUNCTION public.admin_close_manual_review_attempt(
  p_attempt_id uuid,
  p_order_id   uuid,
  p_outcome    text,
  p_actor      text,
  p_reason     text,
  p_request_id text
)
RETURNS jsonb   -- {closed: boolean, idempotent: boolean}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_n           integer;
  v_generic_msg constant text := 'admin_close_manual_review_attempt: 無法處理';  -- 不洩內部狀態
BEGIN
  -- ① 必填三件。🔴 `p_outcome` 沒有預設值 —— 「沒說查到什麼」不得成為一條可以走的路。
  IF p_outcome IS NULL OR p_outcome NOT IN ('unknown', 'not_charged', 'charged') THEN
    RAISE EXCEPTION 'admin_close_manual_review_attempt: p_outcome 必填,且只能是 unknown / not_charged / charged';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_close_manual_review_attempt: p_actor 必填(三個月後要查得到是誰按的)';
  END IF;
  IF p_reason IS NULL OR pg_catalog.btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'admin_close_manual_review_attempt: p_reason 必填(沒有它,那一列只證明「有人按過」,不證明「為什麼」)';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_close_manual_review_attempt: p_request_id 必填(correlation)';
  END IF;

  -- ② 🔴 兩條還沒做的路,當場擋下並指名下一步 —— 不要讓按鈕的人以為處理完了。
  IF p_outcome = 'not_charged' THEN
    RAISE EXCEPTION '確定沒扣到的單要【釋鎖讓客人重新付款】,而那條路尚未實作(它是既有狀態機的第二份實作,需要自己的一片 + 鐵則 12 審查)。請回報,不要改選 unknown —— 選 unknown 會讓這張單一直鎖著。';
  END IF;
  IF p_outcome = 'charged' THEN
    RAISE EXCEPTION '確定扣到錢的單要【補入帳】,而那條路尚未實作(它動錢,需要自己的一片 + 鐵則 12 審查)。請回報,不要改選 unknown。';
  END IF;

  -- ③ 雙鍵驗 + FOR UPDATE(序列化重複點擊)
  SELECT id, needs_manual_review, manual_reviewed_at
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ④ 冪等:已經看過就 no-op(重複點擊不得再寫一列稽核、也不得覆蓋原本的結果與時間)
  IF v_row.manual_reviewed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('closed', true, 'idempotent', true);
  END IF;

  -- ⑤ 🔴 只能關【真的在佇列裡】的那一列 —— 否則這支 RPC 會變成「對任何 attempt 蓋一個時戳」。
  IF v_row.needs_manual_review IS DISTINCT FROM true THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ⑥ 寫時戳與結果。🔴 **status 與 needs_manual_review 一個字都不動** ——
  --    鎖留著(客人不會被重扣)、自動重試仍然關著。
  UPDATE public.payment_charge_attempts
     SET manual_reviewed_at    = pg_catalog.now(),
         manual_review_outcome = p_outcome,
         updated_at            = pg_catalog.now()
   WHERE id = p_attempt_id
     AND order_id = p_order_id
     AND manual_reviewed_at IS NULL;   -- CAS:與 ④ 併看,重複點擊只會有一次寫入
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ⑦ 同一個交易寫稽核。🔴 沒有它,三個月後那一列只證明「狀態變了」,不證明「誰決定的、為什麼」。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'payment.manual_review.close',
    'attempt:' || p_attempt_id::text,
    pg_catalog.jsonb_build_object('manual_reviewed_at', NULL),
    pg_catalog.jsonb_build_object('manual_review_outcome', p_outcome),
    p_reason,
    p_request_id,
    'admin'
  );

  RETURN pg_catalog.jsonb_build_object('closed', true, 'idempotent', false);
END;
$fn$;

COMMENT ON FUNCTION public.admin_close_manual_review_attempt(uuid, uuid, text, text, text, text) IS
  'M-4a 人工待確認佇列的出口。🔴 它做的是【讓那一列離開告警述詞】,不是【改狀態】—— status 與 needs_manual_review 一個字都不動(鎖留著=客人不會被重扣;後者同時是「停止自動 retry」的旗標)。p_outcome 必填三選一,而本片【只實作 unknown】:not_charged(要釋鎖)與 charged(要補入帳)一律 RAISE 並指名下一步,理由是它們動錢/動鎖、各需自己的一片 + 鐵則 12 審查。⚠️ 選 unknown 之後【那張單仍然鎖著、客人仍然付不了】—— 本片交付的是告警的出口,不是訂單的出口。冪等(重複點擊 no-op、不重複寫稽核);只能關 needs_manual_review=true 的列;同交易寫 admin_audit_log(reason 必填)。';

-- ── 4. 授權:🔴 只給後台那條路,而且不給 PUBLIC ──────────────
REVOKE ALL ON FUNCTION public.admin_close_manual_review_attempt(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_close_manual_review_attempt(uuid, uuid, text, text, text, text) TO service_role;

-- ── 5. apply 期 fail-closed 斷言 ───────────────────────────
-- 🔴 GRANT 出錯不會讓任何東西紅(repo 內零 `GRANT` 字面可掃、三綠不紅)⇒ 斷言是唯一會停下來的東西。
DO $$
DECLARE
  v_role text;
  v_cnt  integer;
BEGIN
  -- 5a. 兩個新欄真的在(打錯欄名時,上面的 RPC 要到執行期才會炸)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'payment_charge_attempts'
     AND a.attname IN ('manual_reviewed_at', 'manual_review_outcome') AND NOT a.attisdropped;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '出口欄位異常 — payment_charge_attempts 應有 manual_reviewed_at + manual_review_outcome 兩欄(實 % 欄);拒繼續', v_cnt;
  END IF;

  -- 5b. 🔴 兩個 CHECK 都在(「有時戳沒結果」= 有人按過但沒說查到什麼,那正是本片要防的)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.payment_charge_attempts'::regclass
     AND conname IN ('payment_charge_attempts_manual_review_outcome_check',
                     'payment_charge_attempts_manual_review_pair_check');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '出口 CHECK 異常 — 應有兩條(實 % 條);拒繼續', v_cnt;
  END IF;

  -- 5c. 🔴 告警述詞【真的】排除了已檢視的列 —— 只驗「函式重建成功」等於沒驗。
  --     量法:函式原始碼裡必須出現那一行。**這是字面檢查,不是行為檢查**(行為要有資料才測得到)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_payment_anomaly_alert_summary'
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%manual_reviewed_at IS NULL%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '告警述詞異常 — get_payment_anomaly_alert_summary 沒有排除已檢視的列(實 % 支符合);拒繼續', v_cnt;
  END IF;

  -- 5d. client 三角色不得執行出口 RPC(它會寫稽核、會關告警)
  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role,
         'public.admin_close_manual_review_attempt(uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION '出口 RPC EXECUTE 異常 — % 不應執行得了;拒繼續', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role',
       'public.admin_close_manual_review_attempt(uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '出口 RPC EXECUTE 異常 — service_role 應執行得了(後台要用);拒繼續';
  END IF;

  -- 5e. 🔴 owner 必須是跑 migration 的角色(SECURITY DEFINER 的身分就是 owner)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_close_manual_review_attempt', 'get_payment_anomaly_alert_summary')
     AND pg_catalog.pg_get_userbyid(p.proowner) <> current_user;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '函式 owner 異常 — 應為跑 migration 的 %(實有 % 支不是);拒繼續', current_user, v_cnt;
  END IF;

  -- 5f. 🔴 **本片不得動到 status 相關的既有權限面** —— service_role 對 attempts 表的直接權限應維持零。
  --     (出口走的是 SECURITY DEFINER 的 RPC,不是給表權限。)
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.payment_charge_attempts', 'UPDATE') THEN
      RAISE EXCEPTION 'payment_charge_attempts ACL 異常 — % 不應有 UPDATE(出口只准走 RPC);拒繼續', v_role;
    END IF;
  END LOOP;
END $$;
