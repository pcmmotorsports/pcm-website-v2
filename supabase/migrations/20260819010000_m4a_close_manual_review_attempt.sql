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
-- ── 🔴🔴 誠實揭示:這支 RPC【解不掉】的那一格,以及它會怎麼咬人 ──────
--   **它是什麼**:一筆**TapPay 那側真的扣成功了、而我們這側從來沒觀察到**的單。
--   它的 `attempt.status` 仍是 `pending`(我們沒收到結果)、`orders.payment_status` 仍是 `unpaid`
--   ⇒ **它就在佇列裡**,而**資料層看不出它收過錢**。
--
--   **它會怎麼咬人(具體,不是「有風險」)**:
--   ```
--   某天早上，員工看到「人工待確認 3 筆」，想把畫面清乾淨。
--   他點第一筆：選「確定沒扣到」⇒ 系統噴錯（那條沒做）
--             選「確定扣到了」⇒ 系統噴錯（那條也沒做）
--             選「真不確定」  ⇒ 通過了。
--   🔴 三個選項裡，【兩個會噴錯、一個會通過】—— 那不是選單，是一條阻力最小的路。
--   於是那一筆離開告警、進入 unknown 存量。而客人的錢【真的被扣了】，
--   訂單狀態永遠是 unpaid，客人打電話來的時候，我們的系統上沒有任何一個地方說他付過錢。
--   ```
--   **本片做到與沒做到的,分開講**:
--   ```
--   ✅ 資料【說得出來】的那一半已經是強制的：status='charged' ⇒ 選 unknown 會被 RAISE 擋下（⑤-2）
--   🔴 資料【說不出來】的那一半解不掉：我們沒觀察到的扣款，DB 裡沒有任何欄位知道它
--      ⇒ 唯一的來源是【去 TapPay 那側查】，而那不是這支 RPC 做得到的事
--   ⇒ 所以 unknown 仍然是「一條會通過的路」，而它的正確性【靠人】
--   ```
--   **⇒ 這是一個產品決定,不是技術題**:要嘛先做「確定扣到了」那條(補入帳),
--   要嘛在介面上強制「按 unknown 之前必須先貼上 TapPay 查詢結果」。**本片兩者都沒做。**
--   ⚠️ 而 `unknown` 存量計數(`reviewed_unknown_unresolved_count`)**只讓它可見,不讓它被解決** ——
--     **誰、什麼時候、看什麼清單去解那些單,本片沒有答案。**
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
  'M-4a 人工待確認佇列的【出口】:有人看過了。🔴 它【只讓那一列離開主告警述詞】,不動 status、不動 needs_manual_review(後者同時是「停止自動 retry」的旗標,清它會把重試打開)。⚠️ **「鎖仍在」只對 status IN (pending, charged) 那一族成立** —— per-order 佔鎖是 `ON CONFLICT (order_id) WHERE status IN (pending, charged)`(20260612150000:101),而告警述詞也涵蓋 superseded 的 released 列,**那一族本來就不在那個 partial index 的保護裡**,本 RPC 沒有再釋一次鎖、但也不得宣稱它鎖著。寫入唯一入口 = admin_close_manual_review_attempt();unknown 的存量另見 get_payment_anomaly_alert_summary 的 reviewed_unknown_unresolved_count。';
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
    -- 🔴🔴 **M-4a:`unknown` 的可見性 —— 它與出口【必須同一交付】**(codex 關卡2 Critical 1)。
    --    沒有它,選 `unknown` 之後那張單:告警 1→0、鎖還在(客人付不了)、自動重試仍關著
    --    ⇒ **完全不可見** ⇒ 我們只是把「響的告警」換成「安靜的黑洞」,而【安靜】正是這條線最初的病。
    --    ⇒ 這個計數**不是告警**(它不該吵),它是「有多少單卡在『我們還不知道』」的**存量**。
    --    ⚠️ 述詞與主告警**同源**(unpaid + pending/superseded),差別只在 reviewed 的方向 ——
    --      兩者相加 = 原本的主告警數,**不會有單從兩邊同時消失**。
    'reviewed_unknown_unresolved_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_charge_attempts a
         JOIN public.orders o ON o.id = a.order_id
        WHERE a.needs_manual_review = true
          AND ( a.status = 'pending'
                OR ( a.superseded_at IS NOT NULL
                     AND a.status IN ('charged', 'released') ) )
          AND o.payment_status = 'unpaid'::public.payment_status
          AND a.manual_reviewed_at IS NOT NULL
          AND a.manual_review_outcome = 'unknown'),
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
  -- 🔴 `p_reason` 是自由文字且**永久進稽核表**(codex 關卡2 Low):操作者可能貼進姓名/電話/卡務內容。
  --    長度上限**不是**防洩漏(貼 200 字的個資照樣進得去),它防的是「整段對話貼進來」。
  --    ⚠️ **真正的防線是操作介面的提示與訓練** —— 這裡擋不住,寫出來免得被讀成擋住了。
  IF pg_catalog.length(p_reason) > 500 THEN
    RAISE EXCEPTION 'admin_close_manual_review_attempt: p_reason 過長(上限 500 字;請寫結論不要貼原始對話,且不得填入客戶個資或付款憑證)';
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

  -- ⑤ 🔴 只能關【真的在告警述詞裡】的那一列(codex 關卡2 High:~~原本只驗旗標~~)。
  --    只驗 `needs_manual_review` 的話:一列旗標 true 但已 `failed`、或訂單已 `paid`
  --    —— **它根本不在告警裡** —— RPC 仍會蓋時戳、寫一列「close」稽核並回成功。
  --    ⇒ 述詞**逐字對齊** `get_payment_anomaly_alert_summary` 的 `attempt_manual_review_count`。
  --    ⚠️ 這裡讀 orders **不加 FOR UPDATE**:本 RPC 不動 orders、也不動 attempt 的 status
  --      ⇒ 與付款路徑無寫入交集 ⇒ 不引入新的鎖序。代價是「讀到的 payment_status 可能在下一刻改變」,
  --      而那個 race 的後果只是「關掉了一列剛好同時被付掉的」—— 不動錢、不動鎖,可接受。
  IF NOT EXISTS (
    SELECT 1
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.id = p_attempt_id
       AND a.needs_manual_review = true
       AND ( a.status = 'pending'
             OR ( a.superseded_at IS NOT NULL
                  AND a.status IN ('charged', 'released') ) )
       AND o.payment_status = 'unpaid'::public.payment_status
  ) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ⑤-2 🔴🔴 **`unknown` 不是一個「可以隨便選」的出口 —— 資料說得出來的,就不准宣告不知道。**
  --     (2026-08-19:Sean 揭露「後台的單都是真的刷過」+ 主視窗指出「三個選項裡兩個會噴錯、一個會通過
  --      ⇒ 那不是選單,是一條阻力最小的路」⇒ 這一格把**能由資料決定的部分**從宣告改成強制。)
  --     `status = 'charged'` 的意思是**我們自己的系統觀察到扣款成功了** ⇒ 那筆**確定收過錢**
  --     ⇒ 對它宣告 `unknown` 是**說謊**,而說謊的後果是那筆錢從告警消失、沒有人去補入帳。
  IF EXISTS (
    SELECT 1 FROM public.payment_charge_attempts
     WHERE id = p_attempt_id AND status = 'charged'
  ) THEN
    RAISE EXCEPTION '這一筆的 attempt 狀態是 charged —— 系統【已經觀察到扣款成功】,不得宣告 unknown。它要走「確定扣到了」那條(補入帳),而那條尚未實作 ⇒ 請回報。';
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
  'M-4a 人工待確認佇列的出口。🔴 它做的是【讓那一列離開告警述詞】,不是【改狀態】—— status 與 needs_manual_review 一個字都不動(不動 status ⇒ **pending/charged 那一族的 per-order 佔鎖不受影響**;⚠️ superseded 的 released 列本來就不在那個 partial index 裡,**不得宣稱它鎖著**。後者同時是「停止自動 retry」的旗標)。p_outcome 必填三選一,而本片【只實作 unknown】:not_charged(要釋鎖)與 charged(要補入帳)一律 RAISE 並指名下一步,理由是它們動錢/動鎖、各需自己的一片 + 鐵則 12 審查。⚠️ 選 unknown 之後【那張單仍然鎖著、客人仍然付不了】—— 本片交付的是告警的出口,不是訂單的出口。冪等(重複點擊 no-op、不重複寫稽核 —— ⚠️ 第二個人帶著**不同的 actor/reason/outcome** 也會被靜默當成成功冪等,介面若需要「已由別人處理」要自己回讀既有值);只能關**完整告警述詞成立**的列(不只旗標);同交易寫 admin_audit_log(reason 必填)。⚠️ **`p_actor` 由呼叫端自報、可冒名** —— 綁定真實 session 身分要等 `#436`/E8-B,本片不解;且「每一列 reviewed 必有稽核」只在**走這支 RPC**時成立,owner 或別的 SECDEF 直接寫欄位時冪等分支會直接回成功而不檢查稽核是否存在。⚠️ RAISE 訊息含內部欄位與流程狀態,**API 不得把 DB 例外原文回給前端**。';

-- ── 4. 授權:🔴 只給後台那條路,而且不給 PUBLIC ──────────────
REVOKE ALL ON FUNCTION public.admin_close_manual_review_attempt(uuid, uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_close_manual_review_attempt(uuid, uuid, text, text, text, text) TO service_role;

-- ── 5. apply 期 fail-closed 斷言 ───────────────────────────
-- 🔴 GRANT 出錯不會讓任何東西紅(repo 內零 `GRANT` 字面可掃、三綠不紅)⇒ 斷言是唯一會停下來的東西。
DO $$
DECLARE
  v_role text;
  v_priv text;
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
  -- ⚠️ **誠實揭示:5a【突變不到】** —— 任何讓欄位不存在的改法,PG 自己的 DDL(CHECK 引用該欄)
  --    會**先**炸 ⇒ 這一格在實測中從未 firing。**它是縱深,不是「已驗證會抓到」的守門。**
  --    (2026-08-19 實跑:把 ADD COLUMN 的欄名改掉 ⇒ 紅在第 66 行的 CHECK,不是這裡。)

  -- 5b. 🔴 兩個 CHECK 都在(「有時戳沒結果」= 有人按過但沒說查到什麼,那正是本片要防的)
  -- 🔴 **比對【定義】不是名字**(codex 關卡2 High:~~只驗名字存在~~ ⇒ 保留名字、把 pair CHECK
  --    改成 `CHECK (true)`,那一格照樣全綠)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.payment_charge_attempts'::regclass
     AND ( ( conname = 'payment_charge_attempts_manual_review_outcome_check'
             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%manual_review_outcome%'
             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%unknown%'
             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%not_charged%'
             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%charged%' )
        OR ( conname = 'payment_charge_attempts_manual_review_pair_check'
             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%manual_reviewed_at IS NULL%'
             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%manual_review_outcome IS NULL%' ) );
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '出口 CHECK 異常 — 兩條 CHECK 應存在【且定義相符】(實 % 條相符);拒繼續', v_cnt;
  END IF;

  -- 5c. 🔴 告警述詞【真的】排除了已檢視的列 —— 只驗「函式重建成功」等於沒驗。
  --     量法:函式原始碼裡必須出現那一行。**這是字面檢查,不是行為檢查**(行為要有資料才測得到)。
  -- 🔴 **鎖定精確 overload、且【去掉註解之後】再找**(codex 關卡2 High:
  --    ~~`proname` + 整份 functiondef 含某段字串~~ ⇒ 把那段字串放進**註解**、放進無效分支、
  --    或改成 `OR a.manual_reviewed_at IS NULL`,都可能全綠;`proname` 還可能命中錯的 overload)。
  --    ⚠️ **而它仍然是【字面檢查】** —— 它證不了那一行落在正確的 CTE、與正確的 `AND` 關係。
  --      **行為要有資料才測得到**,那道在拋棄式 PG 上跑過(計數 1→0),不在 apply 期。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure
     AND pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
         LIKE '%AND a.manual_reviewed_at IS NULL%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '告警述詞異常 — get_payment_anomaly_alert_summary(int,int,int) 沒有排除已檢視的列(去註解後找不到);拒繼續';
  END IF;
  -- 🔴 而 unknown 的可見性也要在同一支裡(它與出口是同一交付,見檔頭 Critical 1)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure
     AND pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
         LIKE '%reviewed_unknown_unresolved_count%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'unknown 可見性異常 — 少了 reviewed_unknown_unresolved_count ⇒ 出口會變成無聲黑洞;拒繼續';
  END IF;

  -- 5d. 🔴 **proacl allowlist,不點名角色**(codex 關卡2 Critical 2:~~只問四個角色~~ ⇒
  --     任何**別的**角色經由 default privilege 或額外 GRANT 拿到 EXECUTE,那四問全綠)。
  --     ⇒ 展開 ACL、逐筆過白名單:非 owner 的 grantee **只准有 service_role**。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
   WHERE p.oid = 'public.admin_close_manual_review_attempt(uuid,uuid,text,text,text,text)'::regprocedure
     AND a.grantee <> p.proowner
     AND ( a.grantee = 0                                              -- 0 = PUBLIC
           OR pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role' );
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '出口 RPC ACL 異常 — owner/service_role 以外的 grantee 應零筆(實 % 筆);拒繼續', v_cnt;
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.admin_close_manual_review_attempt(uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '出口 RPC EXECUTE 異常 — service_role 應執行得了(後台要用);拒繼續';
  END IF;
  -- 5d-2. 🔴 **有效權限那一半**:ACL 乾淨不代表沒有人**經由角色成員資格**拿得到。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF pg_catalog.pg_has_role(v_role, 'service_role', 'USAGE') THEN
      RAISE EXCEPTION '角色拓樸異常 — % 是 service_role 的成員 ⇒ 它取得得了出口 RPC 的 EXECUTE;拒繼續', v_role;
    END IF;
    IF has_function_privilege(v_role,
         'public.admin_close_manual_review_attempt(uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION '出口 RPC EXECUTE 異常 — % 不應執行得了;拒繼續', v_role;
    END IF;
  END LOOP;

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

  -- 5f. 🔴 **本片不得動到 attempts 表的既有寫權面** —— 出口走 SECURITY DEFINER 的 RPC,不是給表權限。
  --     ⚠️ **措辭更正(codex 關卡2 High)**:~~「直接權限應維持零」~~ 本來就是假的 ——
  --       `service_role` 對這張表**有 SELECT**(那是既有設計)。正確的說法是「**直接【寫】權零**」。
  --     🔴 而**只驗 UPDATE 不夠**:`DELETE` 更危險 —— 刪掉那列 pending attempt,
  --       per-order partial unique 鎖**直接消失** ⇒ 允許再 charge ⇒ 重扣,而原本那一格全綠。
  --       `TRUNCATE` 同理且更狠(且不受 RLS 管)。⇒ 六權矩陣全驗。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.payment_charge_attempts', v_priv) THEN
        RAISE EXCEPTION 'payment_charge_attempts ACL 異常 — % 不應有 %(出口只准走 RPC;DELETE/TRUNCATE 會讓 per-order 佔鎖消失 = 可重扣);拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  -- 負對照:`service_role` 的 SELECT **本來就該在**(既有設計)⇒ 它不見了代表我動到了不該動的
  IF NOT has_table_privilege('service_role', 'public.payment_charge_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'payment_charge_attempts ACL 異常 — service_role 的 SELECT 不見了(本片不該動它);拒繼續';
  END IF;
END $$;
