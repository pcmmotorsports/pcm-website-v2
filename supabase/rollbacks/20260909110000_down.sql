-- 回退 20260909110000_m4b_partial_refund_cancel_gap_counts.sql
-- ⟦auth-PARTIALREFUNDCANCELGAP⟧
--
-- 🔵 **本支建的是【新物件】** ⇒ 回退 = 把它 DROP 掉,沒有「前一代」要還原。
-- ✅ **而 DROP 是安全的**:呼叫端讀不到函式時走三態的「函式不存在 ⇒ null(不知道)」那條路,
--    **不是回 0** ⇒ 📌 **不會把「量不到」印成「沒有缺口」。**
-- 🛑 **而它【不是】無代價的**:退了之後那群單就回到今天的狀態 —— **沒有任何一條線看得到它們**。

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src text;
BEGIN
  -- ① 它得在, 否則這一發是空跑而執行的人會以為自己退回去了
  IF pg_catalog.to_regprocedure('public.get_partial_refund_cancel_gap_counts()') IS NULL THEN
    RAISE EXCEPTION '回退前置閘①:get_partial_refund_cancel_gap_counts() 不存在 ⇒ 不必退, 拒空跑';
  END IF;

  -- ② 🔴 **確認要 drop 的是【我建的那一支】,不是後來有人用同名蓋掉的另一支**
  --    ⇒ 比的是本支獨有的那條述詞字面, 不是名字。
  --    📌 名字相同而內容不同的東西, 用名字當判準等於沒有判準。
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_partial_refund_cancel_gap_counts()');

  IF pg_catalog.strpos(v_src, 'pcm_pending_refund_amounts') = 0
     OR pg_catalog.strpos(v_src, 'partiallyRefunded') = 0 THEN
    RAISE EXCEPTION '回退前置閘②:那一支的函式體裡找不到本支獨有的兩條述詞字面 ⇒ 它已經被別人改寫過, 拒盲目 DROP';
  END IF;

  -- ⚪ 負對照:這把尺不是恆真
  IF pg_catalog.strpos(v_src, 'zzz_never_a_literal') <> 0 THEN
    RAISE EXCEPTION '回退前置閘②(負對照):現造字面竟然命中 ⇒ 尺壞了, 上面那格不算數';
  END IF;
END
$pre$;

DROP FUNCTION public.get_partial_refund_cancel_gap_counts();

-- ── 退後斷言 ──────────────────────────────────────────────────
DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_partial_refund_cancel_gap_counts()') IS NOT NULL THEN
    RAISE EXCEPTION '回退後斷言失敗:函式還在 ⇒ 這一發沒有生效';
  END IF;
  -- 🔵 正對照:同一把尺要問得出一個【應該還在】的東西, 否則上面那個 NULL 可能是尺壞了
  IF pg_catalog.to_regprocedure('public.get_cancelled_mixed_rail_gap_counts()') IS NULL THEN
    RAISE EXCEPTION '回退後斷言失敗(正對照):連兄弟那支都查無 ⇒ 這把尺在錯的庫上, 上面那格不算數';
  END IF;
  RAISE NOTICE '回退完成:get_partial_refund_cancel_gap_counts() 已移除;呼叫端會走「函式不存在 ⇒ null」三態路徑, 不是回 0。';
END
$post$;

COMMIT;
