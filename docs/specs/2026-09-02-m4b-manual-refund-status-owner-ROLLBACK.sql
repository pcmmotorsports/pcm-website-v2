-- 🛑 **它的主檔尚未通過審查 ⇒ 現在不會有人需要還原。而這一支本身仍然是可執行的。**
--    (主檔:`2026-09-02-m4b-manual-refund-status-owner.sql`,檔頭第一行有「不得貼」。)
-- ════════════════════════════════════════════════════════════════════════
-- ⟦b4-MANREFUNDNOOWNER⟧ 還原 —— **整支貼下去就對,不用挑段落。**
--
-- 🛑 **貼這一支之前先想一件事**:還原之後,人工退款又會變成**不改狀態** ——
--    也就是「退了 400 而畫面仍寫已付款」的那個樣子。
--
-- ✅ 它做的事:把 `pcm_sync_order_refund_payment_status` 改回 `20260823020000:239` 那一版,
--    **逐字**,一個字都沒加。
-- 🔴 它【不做】的事:不把已經被改對的訂單狀態改回去 —— 那些是真實的退款事實。

BEGIN;

DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  -- 🔴 剝註解再判:否則「碼被改掉而註解留著」會讓這道前置閘綠著放行。
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  IF pg_catalog.strpos(v_src, 'order_manual_refunds') = 0 THEN
    RAISE EXCEPTION '還原前置:現在裝的【不是】本片(函式體裡沒有 order_manual_refunds)⇒ 貼下去會把別人的版本蓋掉,拒繼續';
  END IF;
END
$pre$;

-- 逐字回到 20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql:239 那一版。
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  SELECT COALESCE(SUM(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  IF v_moved <= 0 THEN
    RETURN v_ps;
  END IF;

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒繼續。🔴 本函式由多個呼叫端共用(卡片結案 / 非卡登記 / …)—— **錯不一定在卡片那條路**, 看呼叫堆疊', p_order_id, v_ps;
  END IF;

  v_target := CASE WHEN v_moved >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
  IF v_ps <> 'refunded' AND v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  RETURN v_ps;
END;
$fn$;

DO $post$
DECLARE v_bare text;
BEGIN
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g')
    INTO v_bare FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_bare, 'order_manual_refunds') > 0 THEN
    RAISE EXCEPTION '還原後置:人工那本帳還在被加總 ⇒ 還原沒生效';
  END IF;
  IF pg_catalog.strpos(v_bare, 'AND status = ''confirmed''') = 0 THEN
    RAISE EXCEPTION '還原後置:卡片那半的算式不見了 ⇒ 還原把它一起拆掉了, 那不是還原';
  END IF;
  IF pg_catalog.strpos(v_bare, 'domain 轉移表') = 0 THEN
    RAISE EXCEPTION '還原後置:那道 domain 閘不見了';
  END IF;
  RAISE NOTICE '⟦b4-MANREFUNDNOOWNER⟧ 還原完成:同步器已回到 20260823020000 那一版';
  RAISE NOTICE '⚠️ 提醒:人工退款又會變成不改狀態 —— 退了款而畫面仍寫已付款。';
END
$post$;

COMMIT;
