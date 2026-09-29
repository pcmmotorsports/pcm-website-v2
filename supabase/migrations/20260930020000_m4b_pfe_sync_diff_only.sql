-- 20260930020000_m4b_pfe_sync_diff_only.sql(貼板 254)
-- pcm:rule1-exception: 兩支都是重定義既有函式, 不是新物件 —— 更早的定義寫在動態 SQL 裡(20260712180000 的 EXECUTE $fndef$…、20260902200000 的 EXECUTE $fnbody$…), 靜態檢查讀不到;前置閘①⑥ 要求正式庫上剛好各一支、md5 是 plan 核過的那一版。
-- 車款同步改成只寫有變動的列:正式表 product_fitments_effective 不再每輪整張刪掉再全部寫回(約 29.5 萬列),
-- 只刪掉、修改、補上真的有差的列(09-30 樣本一輪是 146 列)。暫存表改用 TRUNCATE 清空。
--
-- plan:~/pcm-mailbox/計畫-車款同步只寫變動列-20260930.md(網站B 寫;Sean 2026-09-30 03:3x 批 Q7 甲)。
-- 報價單的同步程式(scripts/sync_storefront_fitments.py)不用改:呼叫方式、參數、回傳的 old_count / new_count 都照舊。
--
-- ── 改什麼 ─────────────────────────────────────────────────────────────────
-- 以正式庫現行原文為底(2026-09-30 唯讀 pg_get_functiondef;= 20260902200000 那一代):
--   pfe_sync_commit   md5 485e726a58ce03ea830f98b8e9d863b1
--   pfe_staging_reset md5 6c0b99de0346861611c43b5e7aaa7caa
-- · pfe_sync_commit:advisory lock 與五道檢查一字未改, 仍在寫入之前。把「DELETE 全表 + INSERT 全部」換成:
--     刪(唯一鍵在暫存表找不到)→ 改(唯一鍵相同、只有 source_model_code 不同)→ 補(唯一鍵在正式表找不到)
--   唯一鍵 = ux_pfe_row(product_id, moto_brand, model_code, year_start, year_end, match_source, NULLS NOT DISTINCT);
--   year_start / year_end 可為空 ⇒ 這兩欄用 IS NOT DISTINCT FROM, 其餘四欄用 `=`(讓查詢計畫能用 hash join)。
--   比對前先 ANALYZE 暫存表(剛灌滿、沒有統計 ⇒ 查詢計畫選錯, 一輪從約 5 秒變 45 秒)。
--   寫完在同一個交易裡自我檢查:正式表與暫存表逐列相同(兩個方向的差集都是 0、筆數相等), 不同就 RAISE ⇒ 整批退回。
--   暫存表清空改 TRUNCATE。回傳多三個鍵 inserted / updated / deleted。
-- · sync_log 的 note:【前面】加「增 N 改 N 刪 N」。
--   🔴 不能接在後面:報價單 read_prev_visibility 把 note 裡 VIS_NOTE_MARK 之後整段當 JSON 讀,
--      後面多接字 ⇒ json.loads 失敗 ⇒ 回 None ⇒ 隔天的「排除數暴增」比對靜靜不做(plan 寫「後面附上」, 這裡改成前面)。
-- · pfe_staging_reset:先數列數再 TRUNCATE, 回傳值意義不變(清掉幾列)。
-- 兩支都不是 SECURITY DEFINER(用呼叫者 service_role 的權限跑;service_role 對暫存表有 TRUNCATE 權限, 2026-09-30 唯讀核過)。
-- SET 子句照抄(CREATE OR REPLACE 會把 SET 整組換掉);owner、EXECUTE 名單不動, 前後閘逐項比。
--
-- ── 退回 ───────────────────────────────────────────────────────────────────
-- supabase/rollbacks/20260930020000-rollback.sql:兩支換回上面兩個 md5 的原文。
-- 兩版寫出來的結果相同(正式表 = 暫存表), 沒有資料要回復, 下一輪同步照常。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_catalog.md5(p.prosrc) AS h, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) AS own,
           p.proacl::text AS acl
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('pfe_sync_commit', 'pfe_staging_reset')
  LOOP
    IF r.h <> (CASE r.proname WHEN 'pfe_sync_commit' THEN '485e726a58ce03ea830f98b8e9d863b1'
                             ELSE '6c0b99de0346861611c43b5e7aaa7caa' END) THEN
      RAISE EXCEPTION '前置閘①:% 本體 md5 = %, 不是 plan 核過的那一版', r.proname, r.h;
    END IF;
    IF r.prosecdef THEN
      RAISE EXCEPTION '前置閘②:% 是 SECURITY DEFINER, 與 2026-09-30 唯讀核的不同', r.proname;
    END IF;
    IF r.proconfig IS DISTINCT FROM (CASE r.proname
         WHEN 'pfe_sync_commit' THEN ARRAY['search_path=public, pg_temp', 'statement_timeout=300s']::text[]
         ELSE ARRAY['search_path=public, pg_temp']::text[] END) THEN
      RAISE EXCEPTION '前置閘③:% 的 SET 子句 = %, 與要照抄的不同', r.proname, r.proconfig;
    END IF;
    IF r.own <> 'postgres' THEN
      RAISE EXCEPTION '前置閘④:% owner = %, 不是 postgres', r.proname, r.own;
    END IF;
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION '前置閘⑤:% 的 EXECUTE 名單 = %, 與 2026-09-30 唯讀核的不同', r.proname, r.acl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('pfe_sync_commit', 'pfe_staging_reset')) <> 2 THEN
    RAISE EXCEPTION '前置閘⑥:兩支函式不是剛好各一支(可能有多載或少一支)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'product_fitments_effective' AND indexname = 'ux_pfe_row'
                    AND indexdef LIKE '%(product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT') THEN
    RAISE EXCEPTION '前置閘⑦:ux_pfe_row 的欄位或 NULLS NOT DISTINCT 與本檔的比對鍵不同';
  END IF;
  -- ⑧ 函式裡的 ANALYZE 要靠 service_role 對暫存表有 MAINTAIN;沒有時 ANALYZE 只出警告(PostgREST 看不到)而同步變慢十倍 ⇒ 貼板時就擋
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.product_fitments_effective_staging', 'MAINTAIN') THEN
    RAISE EXCEPTION '前置閘⑧:service_role 對暫存表沒有 MAINTAIN 權限 ⇒ 函式裡的 ANALYZE 會被跳過';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.pfe_sync_commit(p_run_id uuid, p_source_rows integer, p_orphan_rows integer, p_allow_anomaly boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '300s'
AS $function$
DECLARE
  v_old int;
  v_new int;
  v_foreign int;
  rec record;
  v_del int;
  v_upd int;
  v_ins int;
  v_diff bigint;
  v_final int;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  SELECT count(*) INTO v_old FROM public.product_fitments_effective;
  SELECT count(*), count(*) FILTER (WHERE run_id <> p_run_id)
    INTO v_new, v_foreign
  FROM public.product_fitments_effective_staging;
  IF v_new = 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging empty, refuse swap (keep old % rows)', v_old;
  END IF;
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'pfe_sync_commit: staging has % rows from another run, refuse swap (concurrent sync?)', v_foreign;
  END IF;
  IF v_old > 0 AND v_new < v_old AND (v_old - v_new)::numeric / v_old > 0.10 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: shrink % -> % exceeds 10 pct, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  IF v_old > 0 AND v_new > v_old * 2 AND NOT p_allow_anomaly THEN
    RAISE EXCEPTION 'pfe_sync_commit: growth % -> % exceeds 2x, refuse swap (pass allow_anomaly after verifying source)', v_old, v_new;
  END IF;
  FOR rec IN
    SELECT p.supplier_slug,
           count(*) FILTER (WHERE x.src = 'old') AS old_cnt,
           count(*) FILTER (WHERE x.src = 'new') AS new_cnt
    FROM (
      SELECT product_id, 'old'::text AS src FROM public.product_fitments_effective
      UNION ALL
      SELECT product_id, 'new'::text FROM public.product_fitments_effective_staging
    ) x
    JOIN public.products p ON p.id = x.product_id
    GROUP BY p.supplier_slug
    HAVING count(*) FILTER (WHERE x.src = 'old') > 0
       AND count(*) FILTER (WHERE x.src = 'new') = 0
  LOOP
    IF NOT p_allow_anomaly THEN
      RAISE EXCEPTION 'pfe_sync_commit: supplier % effective rows % -> 0, refuse swap (supplier vanished from source view?)', rec.supplier_slug, rec.old_cnt;
    END IF;
  END LOOP;
  -- 🔴 先更新暫存表的統計:暫存表剛由 REST 灌滿, 正式庫的自動 ANALYZE 要到這支跑完約一分鐘後才來(09-29 實測 03:04:52 commit、03:05:50 analyze)。
  --    沒有統計 ⇒ 下面三句選錯 join(拋棄式 PG 實測 17 s + 31 s;有統計 0.9 s + 1.5 s)。
  --    service_role 在正式庫(PG 17.6)對暫存表有 MAINTAIN 權限(2026-09-30 唯讀核);沒有權限時 ANALYZE 只警告跳過, 不會失敗。
  ANALYZE public.product_fitments_effective_staging;
  -- 2026-09-30 只寫變動列(plan 計畫-車款同步只寫變動列-20260930):刪 → 改 → 補。
  -- 比對鍵 = ux_pfe_row;year_start / year_end 可為空 ⇒ IS NOT DISTINCT FROM, 其餘四欄 `=`(hash join 用得上)。
  -- 刪:唯一鍵在暫存表找不到的列
  DELETE FROM public.product_fitments_effective f
   WHERE NOT EXISTS (
     SELECT 1 FROM public.product_fitments_effective_staging s
      WHERE s.product_id = f.product_id AND s.moto_brand = f.moto_brand AND s.model_code = f.model_code
        AND s.match_source = f.match_source
        AND s.year_start IS NOT DISTINCT FROM f.year_start AND s.year_end IS NOT DISTINCT FROM f.year_end);
  GET DIAGNOSTICS v_del = ROW_COUNT;
  -- 改:唯一鍵相同、只有 source_model_code 不同(暫存表唯一鍵也是 UNIQUE ⇒ 每列最多對到一列)
  UPDATE public.product_fitments_effective f
     SET source_model_code = s.source_model_code
    FROM public.product_fitments_effective_staging s
   WHERE s.product_id = f.product_id AND s.moto_brand = f.moto_brand AND s.model_code = f.model_code
     AND s.match_source = f.match_source
     AND s.year_start IS NOT DISTINCT FROM f.year_start AND s.year_end IS NOT DISTINCT FROM f.year_end
     AND s.source_model_code <> f.source_model_code;
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  -- 補:唯一鍵在正式表找不到的列
  INSERT INTO public.product_fitments_effective
    (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code)
  SELECT s.product_id, s.moto_brand, s.model_code, s.year_start, s.year_end, s.match_source, s.source_model_code
    FROM public.product_fitments_effective_staging s
   WHERE NOT EXISTS (
     SELECT 1 FROM public.product_fitments_effective f
      WHERE f.product_id = s.product_id AND f.moto_brand = s.moto_brand AND f.model_code = s.model_code
        AND f.match_source = s.match_source
        AND f.year_start IS NOT DISTINCT FROM s.year_start AND f.year_end IS NOT DISTINCT FROM s.year_end);
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  -- 自我檢查:正式表必須與暫存表逐列相同(EXCEPT 把兩個 NULL 當成相同)。不同 ⇒ RAISE ⇒ 整批退回, 正式表維持上一輪。
  SELECT count(*) INTO v_diff FROM (
    (SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code FROM public.product_fitments_effective
     EXCEPT ALL
     SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code FROM public.product_fitments_effective_staging)
    UNION ALL
    (SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code FROM public.product_fitments_effective_staging
     EXCEPT ALL
     SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code FROM public.product_fitments_effective)
  ) d;
  SELECT count(*) INTO v_final FROM public.product_fitments_effective;
  IF v_diff <> 0 OR v_final <> v_new THEN
    RAISE EXCEPTION 'pfe_sync_commit: after diff-apply live != staging (diff % rows, live %, staged %), refuse swap', v_diff, v_final, v_new;
  END IF;
  -- TRUNCATE 直接歸還空間, 不留待清理的列;在交易裡, RAISE 會一起退回
  TRUNCATE public.product_fitments_effective_staging;
  -- 🔴 計數放 note【前面】:報價單 read_prev_visibility 把 VIS_NOTE_MARK 之後整段當 JSON 讀, 後面不能再接字
  INSERT INTO public.product_fitments_effective_sync_log
    (status, source_rows, staged_rows, orphan_rows, old_count, new_count, note, run_id)
  VALUES ('success', p_source_rows, v_new, p_orphan_rows, v_old, v_new,
          format('增 %s 改 %s 刪 %s', v_ins, v_upd, v_del) || coalesce('; ' || p_note, ''), p_run_id);
  RETURN jsonb_build_object('old_count', v_old, 'new_count', v_new,
                            'inserted', v_ins, 'updated', v_upd, 'deleted', v_del);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pfe_staging_reset()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_deleted int;
BEGIN
  PERFORM pg_advisory_xact_lock(74211231);
  -- 2026-09-30:改 TRUNCATE(直接歸還空間);先數列數, 回傳值意義不變(清掉幾列)
  SELECT count(*)::int INTO v_deleted FROM public.product_fitments_effective_staging;
  TRUNCATE public.product_fitments_effective_staging;
  RETURN v_deleted;
END;
$function$;

DO $post$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_catalog.md5(p.prosrc) AS h, p.prosecdef, p.proconfig, pg_catalog.pg_get_userbyid(p.proowner) AS own,
           p.proacl::text AS acl
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('pfe_sync_commit', 'pfe_staging_reset')
  LOOP
    IF r.h <> (CASE r.proname WHEN 'pfe_sync_commit' THEN '4f65f7bd02d933579ed9acce90b9214f'
                             ELSE '960f2f17e5896c8b22a9176c174b4b42' END) THEN
      RAISE EXCEPTION '事後閘①:% 本體 md5 = %, 不是本檔寫進去的那一版', r.proname, r.h;
    END IF;
    IF r.prosecdef THEN
      RAISE EXCEPTION '事後閘②:% 變成 SECURITY DEFINER', r.proname;
    END IF;
    IF r.proconfig IS DISTINCT FROM (CASE r.proname
         WHEN 'pfe_sync_commit' THEN ARRAY['search_path=public, pg_temp', 'statement_timeout=300s']::text[]
         ELSE ARRAY['search_path=public, pg_temp']::text[] END) THEN
      RAISE EXCEPTION '事後閘③:% 的 SET 子句 = %, 沒有照抄', r.proname, r.proconfig;
    END IF;
    IF r.own <> 'postgres' THEN
      RAISE EXCEPTION '事後閘④:% owner = %', r.proname, r.own;
    END IF;
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION '事後閘⑤:% 的 EXECUTE 名單 = %, 被改動了', r.proname, r.acl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('pfe_sync_commit', 'pfe_staging_reset')) <> 2 THEN
    RAISE EXCEPTION '事後閘⑥:兩支函式不是剛好各一支';
  END IF;
  -- 🔵 本檔不在正式庫呼叫這兩支(呼叫就是真的同步寫入);功能驗證在拋棄式 PG 跑, 結果見交件回報。
END
$post$;

DO $acl$
DECLARE
  -- 收權斷言:CREATE OR REPLACE 保留原本的 ACL;這裡再確認一般客人與登入會員都不能直接呼叫這兩支
  v_functions text[] := ARRAY['public.pfe_sync_commit(uuid,integer,integer,boolean,text)', 'public.pfe_staging_reset()']::text[];
  v_name text;
  v_fn   oid;
BEGIN
  FOREACH v_name IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(v_name);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言:% 不存在', v_name;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 可以被 anon 或 authenticated 呼叫', v_name;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:service_role 不能呼叫 % ⇒ 同步會失敗', v_name;
    END IF;
  END LOOP;
END
$acl$;

COMMIT;
