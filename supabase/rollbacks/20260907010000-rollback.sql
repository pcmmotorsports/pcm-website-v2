-- ════════════════════════════════════════════════════════════
-- Rollback:20260907010000_m4b_m208_get_effective_prices(貼板 68)
-- ════════════════════════════════════════════════════════════
-- 🔴🔴 **這一份的驗收條件是【貼得下去】, 不是【讀得懂】** ——
--    要 rollback 的那一刻, 沒有人有心情去比對一支函式的內容。
--
-- 🛑 **先想一下再貼**:本支只是【新增一支沒有人在叫的函式】——
--    貼板 68 當下顧客站還沒有任何碼呼叫它(後半那顆還沒推)。
--    ⇒ 📌 **它壞不了任何東西** ⇒ 多數情況你不需要跑這一份。
--    ⇒ ✅ 真正該跑它的情境只有一個:**發現它把經銷價給錯人**。
--       而那一刻【先跑這份、再查為什麼】—— 收掉 EXECUTE 比查清楚快。
--
-- 🔵 順序刻意:**先 REVOKE 再 DROP**。
--    REVOKE 一秒生效、立刻止血;DROP 若因為有人正在叫而卡住, 血已經止了。
-- ════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;

REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[], uuid[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_effective_prices(uuid[], uuid[]) FROM PUBLIC;

DROP FUNCTION IF EXISTS public.get_effective_prices(uuid[], uuid[]);

DO $assert$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_effective_prices(uuid[], uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION '還原斷言:函式還在 ⇒ DROP 沒有生效, 拒繼續';
  END IF;
  RAISE NOTICE '已還原:public.get_effective_prices(uuid[], uuid[]) 不存在了';
  RAISE NOTICE '而【前台那半】若已經上線, 它會開始丟「函式不存在」—— 那是預期的, 不是新的事故。';
END;
$assert$;

COMMIT;
