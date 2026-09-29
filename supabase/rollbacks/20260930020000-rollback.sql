-- 退回 20260930020000_m4b_pfe_sync_diff_only.sql(貼板 254):pfe_sync_commit / pfe_staging_reset 換回 2026-09-30 正式庫原文
--   pfe_sync_commit   md5 485e726a58ce03ea830f98b8e9d863b1(DELETE 全表 + INSERT 全部)
--   pfe_staging_reset md5 6c0b99de0346861611c43b5e7aaa7caa(DELETE … WHERE true)
-- 原文出處:2026-09-30 正式庫唯讀 pg_get_functiondef, 逐字貼上(= 20260902200000 那一代)。
-- 兩版寫出來的結果相同(正式表 = 暫存表), 沒有資料要回復;下一輪同步照常。

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
    IF r.h <> (CASE r.proname WHEN 'pfe_sync_commit' THEN '4f65f7bd02d933579ed9acce90b9214f'
                             ELSE '960f2f17e5896c8b22a9176c174b4b42' END) THEN
      RAISE EXCEPTION '退回前置閘①:% 本體 md5 = %, 不是 20260930020000 那一版(可能沒貼過或已被別人改)', r.proname, r.h;
    END IF;
    IF r.prosecdef THEN
      RAISE EXCEPTION '退回前置閘②:% 是 SECURITY DEFINER, 與 20260930020000 貼上後的不同', r.proname;
    END IF;
    IF r.proconfig IS DISTINCT FROM (CASE r.proname
         WHEN 'pfe_sync_commit' THEN ARRAY['search_path=public, pg_temp', 'statement_timeout=300s']::text[]
         ELSE ARRAY['search_path=public, pg_temp']::text[] END) THEN
      RAISE EXCEPTION '退回前置閘③:% 的 SET 子句 = %, 與要照抄的不同', r.proname, r.proconfig;
    END IF;
    IF r.own <> 'postgres' THEN
      RAISE EXCEPTION '退回前置閘④:% owner = %, 不是 postgres', r.proname, r.own;
    END IF;
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION '退回前置閘⑤:% 的 EXECUTE 名單 = %, 與 20260930020000 貼上後的不同', r.proname, r.acl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('pfe_sync_commit', 'pfe_staging_reset')) <> 2 THEN
    RAISE EXCEPTION '退回前置閘⑥:兩支函式不是剛好各一支(可能有多載或少一支)';
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
  -- WHERE true: PostgREST 連線掛 safeupdate、擋無 WHERE 的 DELETE(21000)
  DELETE FROM public.product_fitments_effective WHERE true;
  INSERT INTO public.product_fitments_effective
    (product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code)
  SELECT product_id, moto_brand, model_code, year_start, year_end, match_source, source_model_code
  FROM public.product_fitments_effective_staging;
  DELETE FROM public.product_fitments_effective_staging WHERE true;
  INSERT INTO public.product_fitments_effective_sync_log
    (status, source_rows, staged_rows, orphan_rows, old_count, new_count, note, run_id)
  VALUES ('success', p_source_rows, v_new, p_orphan_rows, v_old, v_new, p_note, p_run_id);
  RETURN jsonb_build_object('old_count', v_old, 'new_count', v_new);
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
  -- WHERE true: PostgREST 連線掛 safeupdate、擋無 WHERE 的 DELETE(21000)
  WITH del AS (DELETE FROM public.product_fitments_effective_staging WHERE true RETURNING 1)
  SELECT count(*)::int INTO v_deleted FROM del;
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
    IF r.h <> (CASE r.proname WHEN 'pfe_sync_commit' THEN '485e726a58ce03ea830f98b8e9d863b1'
                             ELSE '6c0b99de0346861611c43b5e7aaa7caa' END) THEN
      RAISE EXCEPTION '退回事後閘①:% 本體 md5 = %, 不是 2026-09-30 正式庫原文那一版', r.proname, r.h;
    END IF;
    IF r.prosecdef THEN
      RAISE EXCEPTION '退回事後閘②:% 變成 SECURITY DEFINER', r.proname;
    END IF;
    IF r.proconfig IS DISTINCT FROM (CASE r.proname
         WHEN 'pfe_sync_commit' THEN ARRAY['search_path=public, pg_temp', 'statement_timeout=300s']::text[]
         ELSE ARRAY['search_path=public, pg_temp']::text[] END) THEN
      RAISE EXCEPTION '退回事後閘③:% 的 SET 子句 = %, 沒有照抄', r.proname, r.proconfig;
    END IF;
    IF r.own <> 'postgres' THEN
      RAISE EXCEPTION '退回事後閘④:% owner = %', r.proname, r.own;
    END IF;
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION '退回事後閘⑤:% 的 EXECUTE 名單 = %, 被改動了', r.proname, r.acl;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('pfe_sync_commit', 'pfe_staging_reset')) <> 2 THEN
    RAISE EXCEPTION '退回事後閘⑥:兩支函式不是剛好各一支';
  END IF;
END
$post$;

COMMIT;
