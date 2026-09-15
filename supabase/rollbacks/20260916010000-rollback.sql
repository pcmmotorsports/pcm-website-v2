-- 20260916010000-rollback.sql
-- 退 P0-1 片 2(supabase/migrations/20260916010000_m4b_p01_auto_cancel_split_by_shipment_state.sql)。
--
-- 🔴 函式本體由程式從【正式庫 2026-09-15 schema dump 的 prosrc】逐字產生(= 20260914060000 那一代);後置閘驗 md5 回到 db9946ed….
-- 🔴 CHECK 只在 pcm_incident 沒有 auto_cancel_live_shipment 的列時縮回;有列 ⇒ 保留六種(舊函式不會再寫新值, 多一個允許值無害), 印列數。
-- 🔴 退的順序:片 4 → 片 3 → 本檔(片 2)→ 片 1b → 片 1a(plan §9)。
-- 🔴 不會被撤銷的事實:期間的自動取消 / 跳過結果、寫下的 incident 列。

BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.pcm_incident IN ACCESS EXCLUSIVE MODE;

DO $pre$
BEGIN
  IF pg_catalog.strpos(coalesce((SELECT p.prosrc FROM pg_catalog.pg_proc p
                                  WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_auto_cancel_on_full_card_refund(uuid)')), ''),
                       'skipped:shipped') = 0 THEN
    RAISE EXCEPTION '前置閘:自動取消不是片 2 那一代 ⇒ 沒貼過或已退過';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.pcm_auto_cancel_on_full_card_refund(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rb$
DECLARE
  v_order  record;
  v_actor  text;
  v_key    uuid;
  v_result jsonb;
  v_state  text;
  v_msg    text;
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
  RETURN CASE WHEN COALESCE((v_result ->> 'idempotent')::boolean, false) THEN 'already' ELSE 'marked' END;
END;
$rb$;
COMMENT ON FUNCTION public.pcm_auto_cancel_on_full_card_refund(uuid) IS
  '刷卡全額退款 ⇒ 自動標已取消(20260914060000;Sean 09-12 拍)。只由 pcm_sync_order_refund_payment_status 在 definer 下呼叫, 零 GRANT。前提 = admin_mark_order_cancelled 的閘(刷卡 / refunded / 沒取消過 / 沒部分取消);actor = 最後一筆退款的經手人;冪等鍵 md5(pcm-auto-cancel:<order_id>);失敗吞掉留痕 pcm_incident(auto_cancel_failed / auto_cancel_skipped), query_canceled 不吞。';

DO $chk$
DECLARE
  v_n bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM public.pcm_incident WHERE kind = 'auto_cancel_live_shipment';
  IF v_n = 0 THEN
    ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
    ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
      CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total', 'auto_cancel_skipped', 'auto_cancel_failed', 'line_forward_failed'));
    RAISE NOTICE 'CHECK 縮回五種(沒有 auto_cancel_live_shipment 的列)';
  ELSE
    RAISE NOTICE 'CHECK 保留六種:pcm_incident 有 % 列 auto_cancel_live_shipment(不刪資料)', v_n;
  END IF;
END
$chk$;

DO $post$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_auto_cancel_on_full_card_refund(uuid)')) <> 'db9946ed9c890f550c63470618f650d8' THEN
    RAISE EXCEPTION '後置閘:自動取消沒有回到 20260914060000 那一代(md5 對不上)';
  END IF;
  RAISE NOTICE '✅ 20260916010000 rollback:自動取消回到 db9946ed…';
END
$post$;

COMMIT;
