-- ⟦還原 · 災難用⟧ 20260908010000_m4b_q74_dealer_catalog_rpc.sql 的回頭路
--
-- 🔵 本片【沒有資料風險】:它只建了一支函式, 沒動任何一列資料、沒改任何既有物件。
--    ⇒ 還原 = 把那支函式拿掉。一般那支 `search_catalog_by_vehicle` 一個字都沒被動過, 不需要還原。
--
-- 🔴 什麼時候【不可以】跑這一支:
--    前端已經接上去了(有呼叫端在叫 `…_dealer`)⇒ 先把前端切回一般那支, 再跑本支。
--    🛑 而 **`pg_depend` 看不到應用層的呼叫** —— 閘②只擋得住【DB 內部】的引用。
--       ⇒ 📌 **這一格本閘擋不住, 只能靠人**:跑之前先問「storefront 現在叫哪一支」。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL quote_all_identifiers = off;

DO $g$
DECLARE
  v_md5 text; v_n int; v_dep text;
BEGIN
  -- 閘① 它在不在
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '閘①:public.search_catalog_by_vehicle_dealer 不存在 ⇒ 沒有東西可還原(整筆回滾)。';
  END IF;

  -- 閘①b 同名【不等於】同一份:body md5 要是本片建的那一份
  IF v_md5 <> '4c3ee7c2d6a035e93067315c03ad47a9' THEN
    RAISE EXCEPTION '閘①b:body md5 = %(期望 4c3ee7c2d6a035e93067315c03ad47a9)⇒ 它已經被別人改過 ⇒ 停, 不刪別人的版本。', v_md5;
  END IF;

  -- 閘② DB 內部有沒有東西靠著它(函式體字面引用;pg_depend 對 plpgsql 內部引用失明)
  --   🔴 刻意往【多抓】的方向:多抓 ⇒ 拒絕還原 ⇒ 人來看一眼(安全);漏抓 ⇒ 刪掉還在用的(不安全)。
  --   ⇒ 不剝註解、一律 lower()、掃所有非系統 schema。
  SELECT count(*), string_agg(p.oid::regprocedure::text, ', ')
    INTO v_n, v_dep
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     -- 🔴 codex must-fix ④:原本用 `proname <>` 排除自己 —— 那會【連別的 schema 裡同名的包裝函式一起漏掉】
     --    ⇒ DROP 成功而那支包裝函式變成壞掉的入口。改成用 oid 排除, 只排掉【它自己那一支】。
     AND p.oid <> 'public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz)'::regprocedure
     AND p.prosrc IS NOT NULL
     AND strpos(lower(p.prosrc), 'search_catalog_by_vehicle_dealer') > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION '閘②:還有 % 支函式的 body 字面提到它(%)⇒ 停, 先還原那些。(本閘刻意寧可多抓)', v_n, v_dep;
  END IF;

  -- 閘③ 一般那支必須【還在而且沒被動過】—— 否則「還原」會把客人留在一個沒有目錄的世界
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle'
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_categories%';
  IF v_md5 IS DISTINCT FROM '336beaff1188c7670e85134db5aa623b' THEN
    RAISE EXCEPTION '閘③:一般那支 12 參數的 body md5 = %(期望 336beaff1188c7670e85134db5aa623b)⇒ 它被動過了 ⇒ 停, 先確認客人那條路是好的。', coalesce(v_md5, '(查無)');
  END IF;
END
$g$;

DROP FUNCTION public.search_catalog_by_vehicle_dealer(text[], text, text, integer, integer, integer, text, text, text[], integer, integer, timestamptz);

DO $post$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle_dealer';
  IF v_n <> 0 THEN RAISE EXCEPTION '事後閘:DROP 完它還在(% 支)⇒ 停。', v_n; END IF;
  -- 🟢 正對照:同一把尺對【該在的】必須數得到 —— 否則這個 0 是尺壞了
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  IF v_n < 1 THEN
    RAISE EXCEPTION '事後閘:正對照失敗 —— 連一般那支都數不到 ⇒ 這把尺壞了, 它的 0 不算數 ⇒ 停。';
  END IF;
  RAISE NOTICE '✅ search_catalog_by_vehicle_dealer 已移除;一般那支仍在(% 支, 正對照)。', v_n;
END
$post$;

COMMIT;
