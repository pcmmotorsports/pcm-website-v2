-- 20260910130000_down.sql — 退掉 ⟦ship-DISPATCHORDER⟧ 片三。
--
-- ══ 🔴🔴 退這一支的代價, 寫在最前面 ═══════════════════════════════════════
-- `hct_dispatched_at` 記的是**一個已經發生的對外動作**:我們叫過一台車。
-- ⇒ 🛑 **DROP 掉那一欄 = 把那些紀錄永久刪掉**, 而**那些車還是會來**。
-- ⇒ 📌 所以本支的前置閘**先數那一欄有幾列非空** —— 非空就停下來問人,
--    不是因為技術上退不掉, 是因為**退掉之後沒有人知道哪些箱叫過車**。
-- ✅ 而零非空時退它是安全的:那代表這一欄從貼上去到現在**一次都沒被用過**。
--
-- ⚠️ **本支不還原任何資料** —— 它只拆掉本片建的三個東西(欄 · trigger · 兩支函式)。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 🔴🔴 **數之前先鎖整張表** —— codex R1 must-fix 二:
--    ⛔ ~~直接 `count(*)` 看有沒有人叫過車~~ ⇒ 出事時序:
--      另一個交易已經寫了派遣時間**而還沒提交** ⇒ 本支數到 0 ⇒ 對方提交
--      ⇒ 本支拿到 DDL 鎖、刪掉那一欄 ⇒ 📌 **剛留下的紀錄被永久刪掉, 而前置閘不會重算。**
--    ⚠️ 一般 `SELECT` 的鎖**不擋 UPDATE**, 而包在同一個交易裡**也消不掉那個窗口**。
--    ✅ `ACCESS EXCLUSIVE` 持有到 COMMIT ⇒ 數的那一刻起沒有人寫得進來。
--    🔵 而 `lock_timeout` 在上面 ⇒ 鎖不到就停, 不會卡住整個後台。
LOCK TABLE public.shipments IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE
  v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = pg_catalog.to_regclass('public.shipments')
                    AND a.attname = 'hct_dispatched_at' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '回退前置閘①:shipments.hct_dispatched_at 不在 ⇒ 這一片沒貼過(或已經退過)';
  END IF;

  -- 🔴🔴 **有紀錄就停** —— 見檔頭。這一格是本支唯一真正重要的閘。
  -- 🔴 **兩欄都要數** —— 只有佔位而沒有補記的那一箱, 車也可能已經在路上了。
  SELECT count(*) INTO v_n FROM public.shipments
   WHERE hct_dispatched_at IS NOT NULL OR hct_dispatch_attempted_at IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION USING MESSAGE =
      '回退前置閘②:已經有 ' || v_n::text || ' 箱叫過車(或叫到一半)了。'
      || ' 退掉這一欄會把那些紀錄永久刪掉, 而那些車還是會來'
      || ' ⇒ 📌 退之後沒有人知道哪些箱叫過。請先決定那些紀錄要留在哪裡, 再退。';
  END IF;

  -- ⚪ 負對照:這把尺不是恆真。
  IF pg_catalog.to_regclass('public.zzz_never_a_table') IS NOT NULL THEN
    RAISE EXCEPTION '回退前置閘(負對照):現造表名竟然命中 ⇒ 這把尺壞了';
  END IF;
END
$pre$;

DROP TRIGGER IF EXISTS shipments_hct_dispatched_at_write_once_bu ON public.shipments;
DROP FUNCTION IF EXISTS public.pcm_b2_shipments_hct_dispatched_at_write_once();
DROP FUNCTION IF EXISTS public.admin_record_hct_dispatch(text,text);
DROP FUNCTION IF EXISTS public.admin_claim_hct_dispatch(text,text);
ALTER TABLE public.shipments DROP COLUMN IF EXISTS hct_dispatched_at;
ALTER TABLE public.shipments DROP COLUMN IF EXISTS hct_dispatch_attempted_at;

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = pg_catalog.to_regclass('public.shipments')
                AND a.attname = 'hct_dispatched_at' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '回退後斷言:那一欄還在 ⇒ 沒退乾淨';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_record_hct_dispatch(text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_claim_hct_dispatch(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '回退後斷言:那兩支之一還在 ⇒ 沒退乾淨';
  END IF;
  -- 🔵 正對照:同族那支【不准】被我退掉 —— 它不是本片建的。
  IF pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '回退後斷言:我把 admin_record_hct_submit 也退掉了 ⇒ 那不是本片的東西';
  END IF;
  RAISE NOTICE '回退完成:本片建的四個東西都拆掉了, 而同族那支還在。';
END
$post$;

COMMIT;
