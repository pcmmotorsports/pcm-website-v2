-- ══════════════════════════════════════════════════════════════════════
-- Rollback:20260906990000_m4b_5b_member_order_cancelled_quantities_rpc
-- ══════════════════════════════════════════════════════════════════════
-- 🔴🔴 **這一份的驗收條件是【貼得下去】, 不是【讀得懂】** ——
--    要 rollback 的那一刻, 沒有人有心情去比對一支函式的內容。
--
-- 🛑 **它只 DROP 那支函式** —— 本片**從來沒有碰過** `order_item_quantity_summary`
--    的 policy 或 GRANT(那正是丁案的整個賣點:窗口不拆牆)
--    ⇒ 📌 **所以這一份不需要「還原權限」那一段, 而那不是漏寫。**
--
-- ⚠️ **不可逆的那一格**:rollback 之後顧客站拿不到取消件數 ⇒ mapper 退回舊規則
--    ⇒ 一張部分取消的單會再度被算成「已全出」⇒ 分批小字被抑制。
--    **本檔還原機制, 不還原那段期間客人看到的東西。**
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ══ 前置閘:只 DROP 我建的那一支 ═══════════════════════════════════════
DO $$
DECLARE v_src text;
BEGIN
  IF pg_catalog.to_regprocedure('public.get_member_order_cancelled_quantities(uuid)') IS NULL THEN
    RAISE NOTICE 'rollback:那支函式不在 ⇒ 跳過(重跑時的正常路徑)';
    RETURN;
  END IF;
  -- 🔴🔴 **不要 DROP 一支我沒讀過的同名函式。**
  --    ⛔ ~~比兩個語意特徵(`order_item_quantity_summary` / `customer_user_id`)~~
  --    ⇒ 🔴 **codex 2026-09-06 must-fix:那太弱** —— 一支【後來改寫過】的同名函式
  --      仍然會提到那兩個名字(**甚至只出現在註解裡也會過**)⇒ 舊 rollback 會刪掉新版本。
  --    ✅ 改成 **md5(prosrc) 逐字釘樁**(形狀照 `20260905200000` 的 counts 釘樁):
  --      內容只要動一個字元就對不上 ⇒ **停下來, 不要刪一個我沒讀過的東西。**
  --    🔬 那個值是**量出來的**(拋棄式 PG 上 apply 之後讀 `md5(prosrc)`), 不是算的 ——
  --      PG 存的 `prosrc` 與檔案裡那段字面**不一定逐位元相同**(前導換行、dollar-quote 邊界)。
  --      🔬 **而這不是理論**:我先在本地對檔案裡那段 body 算了一次 ⇒ `a28e07df…`,
  --      而 PG 上量到的是 **`9f5413b3…`** ⇒ 📌 **兩個都是誠實的 md5, 而只有後者是這道閘要比的東西。**
  SELECT pg_catalog.md5(p.prosrc) INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.get_member_order_cancelled_quantities(uuid)'::regprocedure;
  IF v_src <> '9f5413b3dae5d0c92d0ced3bed1f37a1'
  THEN RAISE EXCEPTION 'rollback 前置閘:同名函式的 body md5 是 % ⇒ 不是我建的那一支, 停下來看一眼, 不要 DROP', v_src; END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_member_order_cancelled_quantities(uuid);

-- ══ 事後閘 ═══════════════════════════════════════════════════════════
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_member_order_cancelled_quantities(uuid)') IS NOT NULL
  THEN RAISE EXCEPTION 'rollback 事後閘①:那支函式還在'; END IF;
  -- 🟢 **正對照:牆本來就沒被碰過, 而 rollback 也不該碰它** ——
  --    少了這一格, 一支「順手把權限也改掉」的 rollback 會靜靜通過。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy
       WHERE polrelid = 'public.order_item_quantity_summary'::regclass) <> 0
  THEN RAISE EXCEPTION 'rollback 事後閘②:那張表多了 policy ⇒ 有人在 rollback 裡動了不該動的東西'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_item_quantity_summary', 'SELECT')
  THEN RAISE EXCEPTION 'rollback 事後閘③:service_role 讀不到那張表 ⇒ 後台那條路被弄壞了'; END IF;
END $$;

COMMIT;
