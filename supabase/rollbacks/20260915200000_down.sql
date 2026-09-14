-- 回退 20260915200000_m4b_paid_email_after_cancel_detection.sql
-- ⟦f3-PAIDCANCELRACE1⟧
--
-- 🔵 本支建的是【新物件】⇒ 回退 = DROP, 沒有「前一代」要還原。
-- ✅ DROP 安全:呼叫端讀不到函式時走「函式不存在 ⇒ null(查不到)」, 不是回 0 ⇒ 不會把「量不到」印成「沒有疑似」。
-- 🛑 而它不是無代價的:退了之後「付款信在取消之後才寄出」回到沒有任何東西看得到的狀態。

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_src text;
BEGIN
  IF pg_catalog.to_regprocedure('public.get_paid_email_after_cancel_counts()') IS NULL THEN
    RAISE EXCEPTION '回退前置閘①:get_paid_email_after_cancel_counts() 不存在 ⇒ 不必退, 拒空跑';
  END IF;

  -- ② 確認要 drop 的是【我建的那一支】—— 比本支獨有的述詞字面, 不是名字
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_paid_email_after_cancel_counts()');
  IF pg_catalog.strpos(v_src, 'e.sent_at > o.cancelled_at') = 0
     OR pg_catalog.strpos(v_src, 'order_created') = 0 THEN
    RAISE EXCEPTION '回退前置閘②:函式體裡找不到本支獨有的述詞字面 ⇒ 它已經被別人改寫過, 拒盲目 DROP';
  END IF;
  IF pg_catalog.strpos(v_src, 'zzz_never_a_literal') <> 0 THEN
    RAISE EXCEPTION '回退前置閘②(負對照):現造字面竟然命中 ⇒ 尺壞了';
  END IF;
END
$pre$;

DROP FUNCTION public.get_paid_email_after_cancel_counts();

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_paid_email_after_cancel_counts()') IS NOT NULL THEN
    RAISE EXCEPTION '回退事後閘:get_paid_email_after_cancel_counts() 還在';
  END IF;
END
$post$;

COMMIT;
