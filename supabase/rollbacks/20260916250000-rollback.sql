-- 20260916250000-rollback.sql —— 退回 20260916250000_m4b_home_banner_duplicate.sql
--
-- 做什麼:DROP 掉 admin_home_banner_duplicate。
-- 🔵 **這支的退法乾淨**:那支函式**只新增列、不改任何既有列** ⇒ **沒有資料要退。**
--    複製出來的草稿留著也無害 —— 草稿不會上線(要上線得再過發布那一關)。
-- 🔵 **先退碼再退板**:後台那顆「複製一張來改」若還在線上, 退完按下去會 PGRST202。
--    (貼板那一支的順序是反的 —— 板先貼碼後推;退的時候順序就要反過來。)
-- ⚠️ 退完之後,published / archived 的那些列就**又改不動了**(回到 2026-09-16 的狀態)。
--    那不是這支 rollback 的缺陷, 那就是退回去的意思 —— 但**退之前要知道有人正在靠它改首頁大圖**。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  -- 前置閘:函式不在 ⇒ 沒貼過或已經退過
  IF pg_catalog.to_regprocedure('public.admin_home_banner_duplicate(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '退回前置閘:admin_home_banner_duplicate 不在 ⇒ 沒貼過或已經退過, 停';
  END IF;
END
$pre$;

DROP FUNCTION public.admin_home_banner_duplicate(uuid, text, text);

DO $post$
DECLARE n int;
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_home_banner_duplicate(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '退回事後閘:函式還在';
  END IF;

  -- 🔬 正對照:既有那三支一支都不能少 —— 退這支不該碰到它們
  SELECT count(*) INTO n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('admin_home_banner_save_draft', 'admin_home_banner_publish', 'admin_home_banner_archive');
  IF n <> 3 THEN
    RAISE EXCEPTION '退回事後閘:既有三支現在是 % 支(期望 3)⇒ 退錯東西了, 停', n;
  END IF;
END
$post$;

COMMIT;
