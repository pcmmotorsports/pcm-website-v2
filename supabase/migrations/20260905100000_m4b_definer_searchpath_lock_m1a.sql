-- ═══════════════════════════════════════════════════════════════════════════
-- M1a(前導片) —— 把 3 支 SECURITY DEFINER 函式的 search_path 鎖成空字串
-- ═══════════════════════════════════════════════════════════════════════════
-- Plan:docs/plans/2026-09-05-definer-search-path-lock-plan.md(Sean 2026-09-05 批「甲」)
-- M1a = 堆 A 裡【唯讀】那 3 支。切法理由:它們不寫任何東西 ⇒ 鎖壞了最多是一個查詢失敗,
--    不會讓寫入路徑斷在一半。先用它們證明機制, 再動 M1b 那 17 支會寫入的。
--
-- 🔴🔴 **本片【不動 body】** —— 只改 proconfig 的 search_path 那一項。
--    ⇒ 事後斷言比對每支的 md5(prosrc):**改前改後必須一模一樣**。
--    📌 那個 md5 是本片唯一能證明「我沒有順手改到別的東西」的東西 ——
--       而 md5(pg_get_functiondef) 【不行】:它含 SET 子句, 本片本來就會讓它變。
--
-- 🔴 **待鎖清單是 0 支要改 body** —— 唯讀正式庫量過三類裸引用(表 / 型別 / 函式)全 0。
--    ⛔ ~~早先「14 支要先補 public. 前綴」~~ 是一把把註解與字串常值算進去的壞尺, 已作廢
--       (訂正與四格突變測試見 plan §2)。
--
-- 🛑 **靜態全綠不代表沒事** —— 拋棄式 PG 17.10 實測:
--    ALTER FUNCTION ... SET search_path = 空字串 在【下的當下零警告零錯誤】,
--    body 裡若有裸引用, 要等到【有人真的呼叫】才炸。
--    ⇒ 本片的驗收不是這裡的斷言, 是 plan §4 閘 B(拋棄式 PG 各呼叫一發回值)。
--
-- ↩️ Rollback:public.pcm_definer_searchpath_rollback_20260905100000 存了每支的原值。
--    🔴 **寫回去要用【不加引號的清單形式】**:
--        ALTER FUNCTION public.<簽名> SET search_path = public, pg_temp;
--    ⛔ ~~SET search_path = 單引號包住的 'public, pg_temp'~~ 存進去是
--       search_path 等於【帶雙引號的】 "public, pg_temp",
--       與原本的 search_path=public, pg_temp **不是同一個字面**
--       ⇒ 函式行為會對而 acl-snapshot 的 FNCFG 族會叫,
--         而那個叫聲會被讀成「有人動了權限」。(2026-09-05 拋棄式 PG 實測)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE pcm_m1_targets(sig text PRIMARY KEY, body_md5 text NOT NULL) ON COMMIT DROP;
INSERT INTO pcm_m1_targets(sig, body_md5) VALUES
  ('admin_list_saved_order_views(p_actor text)', '3edeee175e8d3ed991c4c7775e1fd242'),
  ('pcm_manual_refund_rail_cap(p_order_id uuid)', 'cf1a581f2ed12a177a520e8248a505af'),
  ('pcm_order_refundable_remaining(p_order_id uuid)', 'a7c426364358738f792625c14363fb69');

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_oid oid; v_sp text; v_md5 text; v_n int := 0;
BEGIN
  FOR r IN SELECT * FROM pcm_m1_targets LOOP
    -- 🔴 **不能用 to_regprocedure(sig)** —— `pg_get_function_identity_arguments` 回的是
    --    「p_actor text」這種【帶參數名】的形式, 而 to_regprocedure 只吃型別
    --    ⇒ 它會丟 `invalid type name "p_actor text"`。
    --    📌 而這個錯【靜態看不出來】:檔案讀起來完全正確, 是拋棄式 PG 實跑才炸的。
    --    ⇒ 改成拿同一個字串去 pg_proc 精確比對 —— 存的是什麼就比什麼。
    SELECT p.oid INTO v_oid
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = r.sig;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '前置閘①:找不到 public.% —— 簽名打錯或它不在了。拒繼續。', r.sig;
    END IF;
    SELECT (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'), pg_catalog.md5(prosrc)
      INTO v_sp, v_md5 FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_sp IS DISTINCT FROM 'search_path=public, pg_temp' THEN
      RAISE EXCEPTION '前置閘②:public.% 現在的 search_path 是 %,不是我寫這一片時看到的 public, pg_temp ⇒ 正式庫已經變了, 拒繼續。', r.sig, COALESCE(v_sp,'(未設)');
    END IF;
    IF v_md5 <> r.body_md5 THEN
      RAISE EXCEPTION '前置閘③:public.% 的 body 已經被改過(md5 % 不等於我量到的 %)⇒ 我釘的前提不成立, 拒繼續。', r.sig, v_md5, r.body_md5;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  -- 🔴 **codex must-fix**:只防 v_n=0 擋不住【清單少列一支】——
  --    那時前後兩閘讀的是【同一張少了一列的表】⇒ 一切自洽、全綠, 而那一支沒被鎖。
  --    ⇒ 硬釘支數。這個數字是我唯讀正式庫量到的, 改清單就要同時改它。
  IF v_n <> 3 THEN
    RAISE EXCEPTION '前置閘④:檢查數是 %,不是我寫這一片時釘的 3 ⇒ 清單被動過或有函式不見了, 拒繼續。', v_n;
  END IF;
  RAISE NOTICE '✅ 前置閘:% 支都在、search_path 是預期值、body 未被改動', v_n;
END $$;

-- ── 前態快照(rollback 唯一的依據)──────────────────────────────────────
CREATE TABLE public.pcm_definer_searchpath_rollback_20260905100000 (
  sig                text PRIMARY KEY,
  search_path_before text NOT NULL,
  body_md5_before    text NOT NULL,
  captured_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.pcm_definer_searchpath_rollback_20260905100000 IS
  '退場:本片與同批上線滿一週且 plan §4 閘 B(行為)跑過 ⇒ DROP。在那之前它是唯一能寫回原值的東西。';
REVOKE ALL ON TABLE public.pcm_definer_searchpath_rollback_20260905100000 FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_definer_searchpath_rollback_20260905100000 FROM anon, authenticated;
-- 🔴🔴 **codex must-fix**:上面兩道收不到【具名的 service_role】——
--    而 Supabase 的 default privileges 可能讓新表自帶 service_role 的 ALL(含 TRUNCATE),
--    🛑 **而 RLS 不管 TRUNCATE** ⇒ 開了 RLS 也擋不住它把這張回滾帳清空。
--    🔵 實測(2026-09-05 acl-snapshot):`pcm_rls_rollback_20260904270000` 四個角色都是 `----`
--       ⇒ 這個庫【今天】不會自帶。而那是【設定的當下狀態】, 不是保證 ——
--       一句明文 REVOKE 不依賴那個設定維持不變, 而它免費。
REVOKE ALL ON TABLE public.pcm_definer_searchpath_rollback_20260905100000 FROM service_role, payment_confirmer;
ALTER TABLE public.pcm_definer_searchpath_rollback_20260905100000 ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: pcm_definer_searchpath_rollback_20260905100000 -- 只給 postgres 用的回滾帳;四個應用角色(anon/authenticated/service_role/payment_confirmer)四道 REVOKE 全收,沒有任何後台路徑會讀它 ⇒ 補 policy 反而是給它一條不存在的用途。退場:同批上線滿一週且閘 B 跑過 ⇒ DROP。

-- static-checks:no-grant-needed 這張回滾帳【刻意零 GRANT】—— 它只給 postgres 用,
--   四個應用角色四道 REVOKE 全收。給它 GRANT 等於給它一條不存在的用途。

-- ── 收權斷言(GRANT/REVOKE 是我寫的動作, 這一段是量到的結果)──────────
DO $$
DECLARE
  v_relations text[] := ARRAY[
    'public.pcm_definer_searchpath_rollback_20260905100000'
  ]::text[];
  r text; v_role text; v_priv text; v_oid oid; v_bad int := 0; v_checked int := 0;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '收權斷言:找不到 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','payment_confirmer'] LOOP
      -- 🔴 **TRUNCATE 一定要在清單裡** —— RLS 不管它,
      --    開了 RLS 也擋不住有 TRUNCATE 的角色把這張回滾帳清空。(codex 2026-09-05)
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
        IF pg_catalog.has_table_privilege(v_role, v_oid, v_priv) THEN
          v_bad := v_bad + 1;
          RAISE WARNING '收權斷言:% 上 % 仍有 %', r, v_role, v_priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF v_checked = 0 THEN
    RAISE EXCEPTION '收權斷言:檢查數為 0 —— 這個斷言沒有分母, 不算通過。';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '收權斷言失敗:% 項權限沒收乾淨 ⇒ 拒 COMMIT', v_bad;
  END IF;
  RAISE NOTICE '✅ 收權斷言:% 張表 × 4 角色 × 5 種權限, 全部為 0', v_checked;
END $$;

INSERT INTO public.pcm_definer_searchpath_rollback_20260905100000 (sig, search_path_before, body_md5_before)
SELECT t.sig, 'public, pg_temp', t.body_md5 FROM pcm_m1_targets t;

-- ── 主路徑 ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT * FROM pcm_m1_targets LOOP
    EXECUTE format('ALTER FUNCTION public.%s SET search_path = %L', r.sig, '');
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '✅ 已鎖 % 支', v_n;
END $$;

-- ── 事後斷言 ──────────────────────────────────────────────────────────────
DO $$
DECLARE r record; v_oid oid; v_sp text; v_md5 text; v_n int := 0;
BEGIN
  FOR r IN SELECT * FROM pcm_m1_targets LOOP
    SELECT p.oid INTO v_oid
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = r.sig;
    SELECT (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%'), pg_catalog.md5(prosrc)
      INTO v_sp, v_md5 FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_sp IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION '事後斷言①:public.% 鎖完是 %,不是空字串 ⇒ 拒 COMMIT', r.sig, COALESCE(v_sp,'(未設)');
    END IF;
    IF v_md5 <> r.body_md5 THEN
      RAISE EXCEPTION '事後斷言②:public.% 的 body 被動到了(md5 % 不等於 %)⇒ 本片只該改 proconfig, 拒 COMMIT', r.sig, v_md5, r.body_md5;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 3 THEN RAISE EXCEPTION '事後斷言③:檢查數是 %,不是釘住的 3, 拒 COMMIT', v_n; END IF;
  -- 🔵 負對照:同一把尺對一支【本片沒動】的函式要印【非空】——
  --    否則「全部都是空字串」的成因可能是這把尺對什麼都印空字串。
  -- 🔴🔴 **codex must-fix**:原本寫 `v_sp IS DISTINCT FROM 空字串` ⇒
  --    函式**不存在**時 v_sp = NULL, 而 NULL IS DISTINCT FROM '...' 是 true
  --    ⇒ **負對照在「對照組根本不存在」的世界裡照樣印通過。**
  --    📌 那正是負對照最該叫的那個世界 —— 它變成一張免費的通行證。
  --    ⇒ 改成:先斷言它【存在】, 再斷言它的值【精確等於】 search_path=pg_catalog。
  v_oid := to_regprocedure('public.rls_auto_enable()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '🔴 負對照的對照組 rls_auto_enable() 不存在 ⇒ 這一格證不到任何事, 拒 COMMIT';
  END IF;
  SELECT (SELECT c FROM unnest(proconfig) c WHERE c LIKE 'search_path=%') INTO v_sp
    FROM pg_catalog.pg_proc WHERE oid = v_oid;
  IF v_sp = 'search_path=pg_catalog' THEN
    RAISE NOTICE '🔵 負對照通過:未動的 rls_auto_enable 仍是 % ⇒ 上面那些空字串是本片做的', v_sp;
  ELSE
    RAISE EXCEPTION '🔴 負對照失敗:rls_auto_enable 的 search_path 是 %,不是我釘的 search_path=pg_catalog ⇒ 對照組本身被動過, 上面的斷言沒有判別力, 拒 COMMIT', COALESCE(v_sp,'(未設)');
  END IF;
  RAISE NOTICE '✅ 事後斷言:% 支都鎖成空、body 一支都沒動', v_n;
END $$;

COMMIT;
