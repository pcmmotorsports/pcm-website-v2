-- 20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql
-- M-4b · P0-1 片 2:刷卡全額退款的自動取消依箱子狀態分流(plan docs/plans/2026-09-15-card-refund-cancel-blocks-shipping-plan.md 片 2)
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- 20260914060000 的自動取消不看箱子:已出貨的單全退也被標成已取消、寄取消信;叫過車的箱也一起被取消。
-- Sean 拍板:Q2 甲(已出貨 ⇒ 不取消, 只寄退款信)、Q-A 乙(叫過車未出貨 ⇒ 不取消 + incident)、Q-B 甲(剩下沒出的由片 1b 擋)。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① pcm_incident_kind_check 加 auto_cancel_live_shipment(第 5 代 CHECK;上一代 20260914100000 五種)。
-- ② pcm_auto_cancel_on_full_card_refund 新一代(抄 20260914060000 逐字, 前置閘釘 md5):在 mixed_rail 之後、找 actor 之前讀這張單的未作廢箱子
--      A 有箱叫過車而沒出貨   ⇒ RETURN 'skipped:hct_dispatched' + incident auto_cancel_skipped
--      否則 S 有箱已出貨       ⇒ RETURN 'skipped:shipped';若還有沒叫車沒出貨的箱 ⇒ incident auto_cancel_skipped(剩下的已被擋, 請作廢)
--      否則 U 只有沒出貨的箱   ⇒ 照常取消;取消成功後 incident auto_cancel_live_shipment(請作廢、攔新竹)
--      A / S 不取消而全額退款含「failed/manual_failed 更正成 money_moved」⇒ incident 多一句「請手動聯絡客人」
--      (Sean 2026-09-15 選乙:退款信 view 只收 confirmed, 寄信不動)
--    讀箱子不上鎖:呼叫端 pcm_sync_order_refund_payment_status 已持這張單 FOR NO KEY UPDATE;片 1b 的叫車、沒派遣成功的標出貨、
--    復原作廢、送單佔位持同一張單 FOR SHARE ⇒ 與這裡互斥。⚠️ 補記出貨(hct_dispatched_at 已有值)與作廢【不鎖訂單】, 可與退款並行
--    (codex 2 R1 nit):補記前這張單已屬 A、補記後屬 S, 兩者都不取消;作廢並行時事故訊息可能點名剛作廢的箱 —— 只影響訊息, 不影響取消判斷。
--    incident 去重形狀照原檔:同一張單同一種未解決的只記一列。
--
-- ══ 部署 ═══════════════════════════════════════════════════
-- 片 1a → 片 1b(同次連續)→ 本檔。前置閘要求片 1b 已貼(pcm_order_ship_blocked 在)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- supabase/rollbacks/20260916010000-rollback.sql:函式回 20260914060000 那一代逐字;CHECK 只在沒有新 kind 的列時縮回。

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 前置閘讀 CHECK 與下面 ALTER 之間要同一把鎖(20260914100000 同理)。
LOCK TABLE public.pcm_incident IN ACCESS EXCLUSIVE MODE;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_order_ship_blocked(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘一:片 1b(20260916000000)還沒貼 ⇒ 先貼 1a、1b';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_auto_cancel_on_full_card_refund(uuid)'))
     IS DISTINCT FROM 'db9946ed9c890f550c63470618f650d8' THEN
    RAISE EXCEPTION '前置閘二:pcm_auto_cancel_on_full_card_refund 不是 20260914060000 那一代(md5 對不上)⇒ 有人改過, 停下重抄';
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check';
  -- CHECK 只收兩種逐字形狀(codex 2 R1 must-fix 2):
  --   五種 = 20260914100000 那一代(第一次貼);
  --   六種 = 本檔貼過、rollback 因為已有 auto_cancel_live_shipment 列而保留(函式已回舊版, 上面前置閘二已驗)⇒ 合法的重貼起點。
  --   其他任何形狀 ⇒ 有人加了別種 kind, 停下。
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''pending_refund_open_failed''::text, ''refund_over_total''::text, ''auto_cancel_skipped''::text, ''auto_cancel_failed''::text, ''line_forward_failed''::text])))'
     AND v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''pending_refund_open_failed''::text, ''refund_over_total''::text, ''auto_cancel_skipped''::text, ''auto_cancel_failed''::text, ''line_forward_failed''::text, ''auto_cancel_live_shipment''::text])))' THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:CHECK 既不是 20260914100000 的五種、也不是本檔的六種逐字(實得 ' || coalesce(v_def, 'NULL') || ')⇒ 有人加了別種 kind, 停下人工對齊';
  END IF;
END
$pre$;

-- ── ① 小事故 kind 加一種(已是六種 ⇒ 跳過)──────────────────────
DO $kind$
BEGIN
  IF pg_catalog.strpos((SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
                         WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check'),
                       'auto_cancel_live_shipment') = 0 THEN
    ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
    ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
      CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total', 'auto_cancel_skipped', 'auto_cancel_failed', 'line_forward_failed', 'auto_cancel_live_shipment'));
  ELSE
    RAISE NOTICE 'CHECK 已是六種(上一次 rollback 因有 auto_cancel_live_shipment 列而保留)⇒ 不重做';
  END IF;
END
$kind$;

-- ── ② 自動取消分流 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_auto_cancel_on_full_card_refund(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $auto$
DECLARE
  v_order  record;
  v_actor  text;
  v_key    uuid;
  v_result jsonb;
  v_state  text;
  v_msg    text;
  v_boxes  record;
  v_corrected boolean;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN 'skipped:null_order';
  END IF;
  -- 呼叫端(pcm_sync_order_refund_payment_status)已對 orders 那一列 FOR NO KEY UPDATE;這裡再讀一次拿齊欄位。
  SELECT o.id, o.payment_method, o.payment_status::text AS payment_status, o.cancelled_at
    INTO v_order
    FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN 'skipped:not_found';
  END IF;
  -- 前提 = admin_mark_order_cancelled 的閘, 先判、不讓它 RAISE(這四種都不是錯, 是「不歸這條路管」)。
  IF v_order.payment_method IS DISTINCT FROM 'tappay' THEN
    RETURN 'skipped:not_card';
  END IF;
  IF v_order.payment_status IS DISTINCT FROM 'refunded' THEN
    RETURN 'skipped:not_fully_refunded';
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN 'skipped:already_cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_cancellation_items ci
               JOIN public.order_items oi ON oi.id = ci.order_item_id
              WHERE oi.order_id = p_order_id) THEN
    RETURN 'skipped:partially_cancelled';
  END IF;
  -- 🔴 混合軌(有人工退款的刷卡單)不自動取消(codex R1 must-fix ④):取消信 view 對「有人工退款」的單不寄、逐筆退款信又要求
  --    已取消的單先有取消信 ⇒ 自動取消會讓那位客人兩封都收不到。混合軌本來就走人工寄信 SOP(每天告警 + `get_cancelled_mixed_rail_gap_counts`),
  --    這裡留給人按「標記已取消」。Sean 拍的字面是「刷卡全退」= 純卡片路。
  IF EXISTS (SELECT 1 FROM public.order_manual_refunds m WHERE m.order_id = p_order_id AND m.voided_at IS NULL) THEN
    RETURN 'skipped:mixed_rail';
  END IF;

  -- 🔴 P0-1 片 2:依這張單【未作廢】箱子的狀態分流(plan 片 2)。
  --    不上鎖:呼叫端持這張單 NKU;1b 的叫車 / 沒派遣成功的標出貨持同一張單 FOR SHARE ⇒ 互斥。補記出貨與作廢不鎖訂單(檔頭說明), 不影響取消判斷。
  SELECT pg_catalog.bool_or(b.hct_dispatch_attempted_at IS NOT NULL AND b.shipped_at IS NULL) AS dispatched,
         pg_catalog.bool_or(b.shipped_at IS NOT NULL)                                          AS shipped,
         pg_catalog.bool_or(b.hct_dispatch_attempted_at IS NULL AND b.shipped_at IS NULL)     AS live,
         pg_catalog.string_agg(b.shipment_reference, '、' ORDER BY b.shipment_reference)
           FILTER (WHERE b.hct_dispatch_attempted_at IS NOT NULL AND b.shipped_at IS NULL)     AS dispatched_refs,
         pg_catalog.string_agg(b.shipment_reference, '、' ORDER BY b.shipment_reference)
           FILTER (WHERE b.hct_dispatch_attempted_at IS NULL AND b.shipped_at IS NULL)         AS live_refs
    INTO v_boxes
    FROM (SELECT DISTINCT s.id, s.shipment_reference, s.shipped_at, s.hct_dispatch_attempted_at
            FROM public.shipments s
            JOIN public.shipment_items si ON si.shipment_id = s.id
            JOIN public.order_items oi ON oi.id = si.order_item_id
           WHERE oi.order_id = p_order_id
             AND s.deleted_at IS NULL) b;

  -- Sean 2026-09-15 選乙(codex 2 R1 must-fix 1):全額退款裡有「failed/manual_failed 被更正成 money_moved」的那筆時,
  --    退款信 view(pcm_partial_refund_email_pending)只收 confirmed ⇒ 不寄這筆;單若因下面 A / S 而不取消, 取消信也不寄
  --    ⇒ 事故訊息多一句叫員工手動聯絡客人。寄信不動。(取消了的單由取消信涵蓋更正金額, 不需要這句。)
  v_corrected := EXISTS (SELECT 1 FROM public.order_refunds r
                           JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
                          WHERE r.order_id = p_order_id
                            AND r.status = 'failed' AND r.failed_reason = 'manual_failed'
                            AND v.corrected_to = 'money_moved');

  -- A:叫過車而沒出貨 ⇒ 車已經叫了收不回來, 不取消;讓紀錄還能照事實補「已出貨」(Sean Q-A 乙)。
  IF coalesce(v_boxes.dispatched, false) THEN
    -- 去重:同單同 kind 未解決就不重寫;但這一次需要「手動聯絡客人」而既有那列沒寫過 ⇒ 補寫一列(codex 2 R2 must-fix:
    --    先有 confirmed 全退留下事故、之後才把 manual_failed 更正成 money_moved 的單, 否則提醒永遠寫不進去)。
    IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                    WHERE i.kind = 'auto_cancel_skipped' AND i.subject_id = p_order_id AND i.resolved_at IS NULL
                      AND (NOT v_corrected OR pg_catalog.strpos(i.detail, '請手動聯絡客人') > 0)) THEN
      PERFORM public.pcm_incident_log('auto_cancel_skipped', p_order_id,
        '刷卡已全額退款,但箱子 ' || v_boxes.dispatched_refs || ' 已叫過新竹、還沒標已出貨 ⇒ 沒有自動取消。'
        || '新竹回成功 ⇒ 按已出貨;結果不明而貨確實交出 ⇒ 管理者按「確認已交貨」再按已出貨;貨沒交出 ⇒ 作廢箱子後按「標記已取消」'
        || CASE WHEN v_corrected THEN '。退款裡有一筆是失敗後更正成錢已退回, 系統不會寄這筆的退款信 ⇒ 請手動聯絡客人' ELSE '' END);
    END IF;
    RETURN 'skipped:hct_dispatched';
  END IF;

  -- S:已出貨 ⇒ 不取消, 維持「已出貨 + 已退款」, 只寄退款信(Sean Q2 甲)。剩下沒出的箱由片 1b 擋住(Sean Q-B 甲)。
  IF coalesce(v_boxes.shipped, false) THEN
    IF (coalesce(v_boxes.live, false) OR v_corrected)
       AND NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                        WHERE i.kind = 'auto_cancel_skipped' AND i.subject_id = p_order_id AND i.resolved_at IS NULL
                          AND (NOT v_corrected OR pg_catalog.strpos(i.detail, '請手動聯絡客人') > 0)) THEN
      PERFORM public.pcm_incident_log('auto_cancel_skipped', p_order_id,
        '刷卡已全額退款:已出貨的部分保留(不標已取消)'
        || CASE WHEN coalesce(v_boxes.live, false) THEN ';剩下的箱子 ' || v_boxes.live_refs || ' 已被擋住不能出,請作廢' ELSE '' END
        || CASE WHEN v_corrected THEN ';退款裡有一筆是失敗後更正成錢已退回, 系統不會寄這筆的退款信 ⇒ 請手動聯絡客人' ELSE '' END);
    END IF;
    RETURN 'skipped:shipped';
  END IF;

  -- actor = 這張單【最後一筆算進 money_moved 的卡片退款】的經手人:confirmed 的 order_refunds, 或 failed/manual_failed 而被有效更正成
  --    money_moved 的那筆(更正人 = 經手人)—— 與 pcm_order_money_moved 同一組分母(codex R1 must-fix ③)。
  -- 🔴 先挑最後那一筆、再看那個人啟不啟用(must-fix ②):不可以「跳過停用的、拿更早那個人」—— 那是冒名。
  SELECT a.actor INTO v_actor
    FROM (
      SELECT r.actor, r.confirmed_at AS at, r.id
        FROM public.order_refunds r
       WHERE r.order_id = p_order_id AND r.status = 'confirmed'
      UNION ALL
      SELECT v.actor, v.created_at AS at, r.id
        FROM public.order_refunds r
        JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
       WHERE r.order_id = p_order_id AND r.status = 'failed' AND r.failed_reason = 'manual_failed'
         AND v.corrected_to = 'money_moved'
    ) a
   ORDER BY a.at DESC NULLS LAST, a.id DESC
   LIMIT 1;
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active) THEN
    -- 留痕一次就好:同一張單同一種未解決事故不重複記(must-fix ⑤;同匯流點 refund_over_total 那條的去重形狀)。
    IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                    WHERE i.kind = 'auto_cancel_skipped' AND i.subject_id = p_order_id AND i.resolved_at IS NULL) THEN
      PERFORM public.pcm_incident_log('auto_cancel_skipped', p_order_id,
        '刷卡全額退款但最後一筆退款的經手人不在 / 已停用 ⇒ 沒有自動標取消;請到後台按「標記已取消」');
    END IF;
    RETURN 'skipped:no_actor';
  END IF;

  -- 冪等鍵:由單號決定。成功之後重跑 sync 會先被上面 `cancelled_at IS NOT NULL` 擋掉(走不到這裡);這把鍵擋的是
  --    「mark RPC 寫了一半 / 同一交易內重入」那種世界 —— 同鍵同 actor ⇒ mark RPC 回 idempotent, 不落第二列 audit。
  v_key := pg_catalog.md5('pcm-auto-cancel:' || p_order_id::text)::uuid;

  BEGIN
    v_result := public.admin_mark_order_cancelled(p_order_id, v_key, v_actor, 'other', '刷卡已全額退款,系統自動取消');
  EXCEPTION
    WHEN query_canceled THEN RAISE;   -- 逾時/取消不吞, 原樣往外
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      -- 🔴 吞掉但留痕:退款在 TapPay 已經成立, 讓「標取消」失敗把整個結案交易退掉 = 帳面錢的狀態不更新, 比沒自動取消更糟。
      --    pcm_incident 進 Sean 的日報(shouldAlert), 後台那顆「標記已取消」鈕可以補按。同一張單未解決的只記一列。
      IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'auto_cancel_failed' AND i.subject_id = p_order_id AND i.resolved_at IS NULL) THEN
        PERFORM public.pcm_incident_log('auto_cancel_failed', p_order_id,
          '自動標取消失敗 ' || v_state || ' ' || pg_catalog.left(v_msg, 200));
      END IF;
      RETURN 'skipped:error';
  END;

  -- U:取消成功而還有沒叫車沒出貨的箱 ⇒ 片 1b 會擋住它們, 這一列叫人去作廢、攔新竹。
  IF coalesce(v_boxes.live, false)
     AND NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'auto_cancel_live_shipment' AND i.subject_id = p_order_id AND i.resolved_at IS NULL) THEN
    PERFORM public.pcm_incident_log('auto_cancel_live_shipment', p_order_id,
      '單已自動取消,但箱子 ' || v_boxes.live_refs || ' 還沒作廢;請作廢, 新竹若已建單請打給新竹攔');
  END IF;
  RETURN CASE WHEN COALESCE((v_result ->> 'idempotent')::boolean, false) THEN 'already' ELSE 'marked' END;
END;
$auto$;
COMMENT ON FUNCTION public.pcm_auto_cancel_on_full_card_refund(uuid) IS
  '刷卡全額退款 ⇒ 自動標已取消(20260914060000;Sean 09-12 拍)。第 2 代 20260916010000(P0-1 片 2):未作廢箱子叫過車而沒出貨 ⇒ skipped:hct_dispatched + incident;'
  '已出貨 ⇒ skipped:shipped(剩下的箱由 1b 擋, 有則 incident);只有沒出貨的箱 ⇒ 照常取消 + incident auto_cancel_live_shipment。'
  '只由 pcm_sync_order_refund_payment_status 在 definer 下呼叫, 零 GRANT。前提 = admin_mark_order_cancelled 的閘(刷卡 / refunded / 沒取消過 / 沒部分取消);'
  'actor = 最後一筆退款的經手人;冪等鍵 md5(pcm-auto-cancel:<order_id>);失敗吞掉留痕 pcm_incident(auto_cancel_failed / auto_cancel_skipped), query_canceled 不吞。';

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列)
  v_functions text[] := ARRAY['public.pcm_auto_cancel_on_full_card_refund(uuid)']::text[];
  v_src text;
  v_def text;
  r text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF pg_catalog.strpos(v_src, 'skipped:hct_dispatched') = 0
       OR pg_catalog.strpos(v_src, 'skipped:shipped') = 0
       OR pg_catalog.strpos(v_src, 'auto_cancel_live_shipment') = 0
       OR pg_catalog.strpos(v_src, '請手動聯絡客人') = 0 THEN
      RAISE EXCEPTION '後置閘一:% 本體沒有三個分流字面與更正退款的手動通知', r;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r))
       OR (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(r)) IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '後置閘二:% 不是 SECURITY DEFINER + search_path 空字串', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘三:% 對 anon / authenticated / service_role 開著 EXECUTE(應零 GRANT)', r;
    END IF;
  END LOOP;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check';
  IF pg_catalog.strpos(v_def, 'auto_cancel_live_shipment') = 0 OR pg_catalog.strpos(v_def, 'line_forward_failed') = 0
     OR pg_catalog.strpos(v_def, 'pending_refund_open_failed') = 0 OR pg_catalog.strpos(v_def, 'refund_over_total') = 0
     OR pg_catalog.strpos(v_def, 'auto_cancel_skipped') = 0 OR pg_catalog.strpos(v_def, 'auto_cancel_failed') = 0 THEN
    RAISE EXCEPTION '後置閘四:CHECK 不是六種 kind 都在(實得 %)', v_def;
  END IF;
  RAISE NOTICE '✅ 20260916010000 後置閘全過:自動取消三條分流 + incident kind 六種';
END
$post$;

COMMIT;
