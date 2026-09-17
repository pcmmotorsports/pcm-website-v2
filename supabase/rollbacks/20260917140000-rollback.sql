-- supabase/rollbacks/20260917140000-rollback.sql
-- 🔴 **rc=0 不是成功的判準**(對抗審查 R1 的 N7):`psql -f` 在「有 ERROR」與「全對」兩個世界
--    rc 都是 0(本 repo 記過:`scripts/readonly-prod-sql.sh` 檔頭)。⇒ 下面這一行讓它出錯就停;
--    而**真正的判準是有沒有印出最後那句「✅ 後置斷言」**。
--    🔵 射程:`supabase/rollbacks/` 117 支裡只有 9 支有這一行 ⇒ 這不是本 repo 的慣例, 是本檔多加的。
\set ON_ERROR_STOP on
-- 還原 `20260917140000_m4b_definer_searchpath_lock_m2.sql`:
-- 把那 12 支 SECURITY DEFINER 函式的 search_path 從空字串**退回** `public, pg_temp`。
--
-- 🛑🛑 **絕對不要對正式庫跑這支。** 演練只在拋棄式 PG
--     (`scripts/migrations-replay-from-zero.sh --keep-db`)。
--
-- 🔴 **依據是【貼之前存下來的那張回滾帳】public.pcm_definer_searchpath_rollback_20260917140000**,
--    不是從 repo 抄一份「應該長這樣」的清單 —— 那兩份不保證一樣。
--    ⇒ 回滾帳不在(被 DROP 了 / 本片沒貼過)⇒ **這支當場 RAISE, 不做任何事。**
--
-- 🔴 **寫回去用【不加引號的清單形式】** —— `SET search_path = public, pg_temp`。
--    ⛔ ~~`SET search_path = 'public, pg_temp'`~~(單引號包整串)存進去會變成
--       **帶雙引號的** `"public, pg_temp"`, 與原字面不是同一個東西
--       ⇒ 函式行為會對, 而 acl-snapshot 的 FNCFG 族會叫, 而那個叫聲會被讀成「有人動了權限」。
--    ⇒ 🔵 所以下面用 `EXECUTE format('… SET search_path = %s', …)` 的 **%s**(裸貼),
--       **不是 %L**(會加引號)。正片鎖成空字串時用 %L 是對的, 兩邊不一樣, 不要統一。
--
-- 🟢 退這一支【不用先退碼】:本片零行為改動、不改簽章、**不加任何【碼會用到的】物件**
--    (正片確實加了一張回滾帳, 而沒有任何程式讀它)⇒ 舊碼新碼都叫得動,沒有部署時序問題。
--    ⛔ ~~原字面「不加新物件」~~ —— **那句是假的**(對抗審查 R1 的 N5),而這是一份要在
--       【災難當下】被讀的檔, 裡面不該有逐字不成立的話。
--
-- 🔵 **lock_timeout 會自己留著** —— `ALTER FUNCTION … SET search_path` 只動 search_path 那一項。
--    🛑 而我不靠這句話:下面的後置斷言直接量那 6 支事後仍含 `lock_timeout=5s`。

-- ══ 🔴 這支【拒跑】的時候怎麼辦 —— 手動出口(對抗審查 R1 的 N6)══════════════
--    本檔是 fail-closed 的:下面前置閘要求「12 支現在全是空字串」、後置斷言要求
--    「body 與貼之前一模一樣」⇒ 🛑 **出事之後最自然的兩個動作(先手動退一兩支 / 熱修某支 body)**
--    任一個做過, 這支就什麼都不做。
--    ⇒ 📌 **那個世界正是它會被拿出來用的世界** ⇒ 救火的人要有出口, 不要在這裡卡住。
--    ✅ 手動逐支退(簽名去回滾帳的 `sig` 欄撈:
--       `SELECT sig FROM public.pcm_definer_searchpath_rollback_20260917140000 ORDER BY 1;`):
--         ALTER FUNCTION public.<簽名> SET search_path = public, pg_temp;
--       🔴 **不加引號** —— 加了會存成帶雙引號的 "public, pg_temp",與原字面不是同一個東西。
--    🛑 手動退完要自己對一次:那 6 支原本有 `lock_timeout=5s` 的, 退完應該還在
--       (`ALTER … SET search_path` 只動那一項)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:回滾帳要在, 而且現在真的是【貼過本片】的狀態 ────────────────
DO $pre$
DECLARE v_n int; v_bad int;
BEGIN
  IF to_regclass('public.pcm_definer_searchpath_rollback_20260917140000') IS NULL THEN
    RAISE EXCEPTION '前置閘①:回滾帳 public.pcm_definer_searchpath_rollback_20260917140000 不在 ⇒ 本片沒貼過, 或帳已被 DROP。不做任何事。';
  END IF;
  SELECT count(*) INTO v_n FROM public.pcm_definer_searchpath_rollback_20260917140000;
  IF v_n <> 12 THEN
    RAISE EXCEPTION '前置閘②:回滾帳只有 % 列, 不是 12 ⇒ 帳被動過, 拒繼續。', v_n;
  END IF;
  -- 🔴 現在真的全是空字串嗎 —— 不是的話表示有人在中間又改過, 我不該蓋過去。
  SELECT count(*) INTO v_bad
    FROM public.pcm_definer_searchpath_rollback_20260917140000 t
    JOIN pg_catalog.pg_proc p
      ON p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = t.sig
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE (SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') IS DISTINCT FROM 'search_path=""';
  IF v_bad > 0 THEN
    RAISE EXCEPTION '前置閘③:% 支現在不是空字串 ⇒ 中間有人改過, 拒繼續(先去看它們現在是什麼)。', v_bad;
  END IF;
  RAISE NOTICE '✅ 前置閘:回滾帳 12 列在、12 支現在都是空字串';
END $pre$;

-- ── 2. 逐支寫回 ──────────────────────────────────────────────────────────
DO $restore$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT sig, search_path_before FROM public.pcm_definer_searchpath_rollback_20260917140000 LOOP
    -- 🔵 %s 裸貼(不是 %L)—— 理由見檔頭。search_path_before 的值是本片自己寫進去的
    --    固定字面 'public, pg_temp', 不是外部輸入。
    EXECUTE format('ALTER FUNCTION public.%s SET search_path = %s', r.sig, r.search_path_before);
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 12 THEN
    RAISE EXCEPTION '還原:只寫回 % 支, 不是 12, 拒 COMMIT', v_n;
  END IF;
  RAISE NOTICE '✅ 已寫回 % 支', v_n;
END $restore$;

-- ── 3. 後置斷言 ──────────────────────────────────────────────────────────
DO $post$
DECLARE r record; v_sp text; v_lt text; v_md5 text; v_n int := 0; v_lt_kept int := 0;
BEGIN
  FOR r IN SELECT sig, body_md5_before, proconfig_before FROM public.pcm_definer_searchpath_rollback_20260917140000 LOOP
    SELECT (SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
           (SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'lock_timeout=%'),
           pg_catalog.md5(p.prosrc)
      INTO v_sp, v_lt, v_md5
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' = r.sig;
    -- 🔴 精確比對【不帶雙引號】的那個字面 —— 帶了雙引號就是寫錯形式了(檔頭那段)。
    IF v_sp IS DISTINCT FROM 'search_path=public, pg_temp' THEN
      RAISE EXCEPTION '後置斷言①:public.% 寫回後是 %,不是 search_path=public, pg_temp ⇒ 形式錯了, 拒 COMMIT', r.sig, COALESCE(v_sp,'(未設)');
    END IF;
    IF v_md5 <> r.body_md5_before THEN
      RAISE EXCEPTION '後置斷言②:public.% 的 body 與貼之前不同(md5 % 不等於 %)⇒ 拒 COMMIT', r.sig, v_md5, r.body_md5_before;
    END IF;
    -- 🔴 原本帶 lock_timeout 的那 6 支, 寫回之後要還在(帳裡的 proconfig_before 就是判準)。
    IF 'lock_timeout=5s' = ANY(r.proconfig_before) THEN
      IF v_lt IS DISTINCT FROM 'lock_timeout=5s' THEN
        RAISE EXCEPTION '後置斷言③:public.% 的 lock_timeout 不見了(現在是 %)⇒ 拒 COMMIT', r.sig, COALESCE(v_lt,'(沒有)');
      END IF;
      v_lt_kept := v_lt_kept + 1;
    ELSIF v_lt IS NOT NULL THEN
      RAISE EXCEPTION '後置斷言④:public.% 本來沒有 lock_timeout, 現在冒出 % ⇒ 拒 COMMIT', r.sig, v_lt;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> 12 THEN RAISE EXCEPTION '後置斷言⑤:檢查數是 %,不是 12, 拒 COMMIT', v_n; END IF;
  IF v_lt_kept <> 6 THEN RAISE EXCEPTION '後置斷言⑥:保住 lock_timeout 的是 % 支,不是 6, 拒 COMMIT', v_lt_kept; END IF;
  RAISE NOTICE '✅ 後置斷言:12 支都退回 public, pg_temp、6 支的 lock_timeout 都還在、body 一支都沒動';
END $post$;

-- 🔵 回滾帳【故意不 DROP】—— 退回去之後它仍是「原值長什麼樣」的唯一紀錄。
--    要 DROP 由人另外決定:DROP TABLE public.pcm_definer_searchpath_rollback_20260917140000;

COMMIT;
