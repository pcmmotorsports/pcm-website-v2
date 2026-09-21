-- 20260920020000-rollback.sql —— 退回 20260920020000_m4b_vehicle_taxonomy_base_and_years.sql
-- M-4b · 前台線(worktree pcm-ops)
--
-- ═══ 本檔做什麼 ═════════════════════════════════════════════════════════════
-- 把**新增的那兩支函式 DROP 掉**。舊的 `public.get_vehicle_taxonomy()` 正片一個字沒動,
-- 所以這裡**也不動它**。
--
-- ═══ 🔴 而多數情況下【你不需要跑這一支】══════════════════════════════════════
-- 正片是**純新增** ⇒ 碼沒推上去之前, 那兩支函式**沒有任何呼叫端**。
-- ⇒ 📌 **要退的是【碼】不是【板】**:`git revert` 那一顆碼的 commit 就回到改之前,
--    DB 上多兩支沒人叫的函式**不影響任何行為**。
-- ⇒ ✅ 所以本檔的用途只有一個:**確定以後都不會用它們了, 想把庫弄乾淨。**
-- 🛑 **而順序仍然要對**:先退碼、再跑本檔。反過來 ⇒ 還在線上的新碼會 `PGRST202`。
--
-- ═══ 🛑 DROP 之前先確認沒有人在叫 ═══════════════════════════════════════════
-- `DROP … RESTRICT` 看得到 view 與 `BEGIN ATOMIC` 的相依, **看不到 `$$` 字串本體裡的呼叫**
-- (`docs/patterns/revoking-function-execute-in-supabase.md` §3 實測)。
-- ⇒ 跑之前自己 grep 一次:`git grep -n 'get_vehicle_taxonomy_base\|get_vehicle_model_years' -- apps/ supabase/`

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.get_vehicle_taxonomy_base() RESTRICT;
DROP FUNCTION IF EXISTS public.get_vehicle_model_years(text) RESTRICT;

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_vehicle_taxonomy_base()') IS NOT NULL THEN
    RAISE EXCEPTION '還原事後斷言:get_vehicle_taxonomy_base() 還在 ⇒ 還原沒成功';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_vehicle_model_years(text)') IS NOT NULL THEN
    RAISE EXCEPTION '還原事後斷言:get_vehicle_model_years(text) 還在 ⇒ 還原沒成功';
  END IF;
  -- 🔴 而**舊那支必須還在** —— 本檔若把它一起弄掉, 客人的車款下拉會整個消失。
  IF pg_catalog.to_regprocedure('public.get_vehicle_taxonomy()') IS NULL THEN
    RAISE EXCEPTION '還原事後斷言:🔴 舊的 get_vehicle_taxonomy() 不見了 ⇒ 這比沒還原嚴重, 停下';
  END IF;
END
$post$;

COMMIT;
