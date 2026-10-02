-- 還原 20261002190000_m4b_vehicle_taxonomy_pairs_view.sql:車款精簡版換回貼前本體(md5 95ce06b5a052d51763c6eeba540670b5,
--   逐字取自 20260920020000), 再 DROP 新 view。只在本體 md5 是 377aebadd8ee0fb5e1c2999eb485389f(= 190000 貼過)時才換。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '377aebadd8ee0fb5e1c2999eb485389f' THEN
    RAISE EXCEPTION '還原前置閘:車款精簡版本體 md5 = %, 不是 190000 的 377aebadd8ee0fb5e1c2999eb485389f ⇒ 不是這支貼上去的, 停', v_md5;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.get_vehicle_taxonomy_base()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  -- 🔵 `MATERIALIZED` 讓聚合只算一次(照舊那支的做法, 少了它可能被 inline 成兩次全掃)。
  WITH r AS MATERIALIZED (
    SELECT COALESCE(
             pg_catalog.jsonb_agg(
               -- 🔴 年份兩欄**一律 NULL** —— 那不是壞掉, 是既有語意:
               --    `products-vehicle-taxonomy.test.ts:149`「year_start = null ⇒ 該列不貢獻年份」。
               pg_catalog.jsonb_build_array(d.moto_brand, d.model_code, NULL, NULL)
               ORDER BY d.moto_brand, d.model_code),
             '[]'::jsonb) AS rows_json
      FROM (SELECT DISTINCT v.moto_brand, v.model_code
              FROM public.vehicle_taxonomy_public v) d
  )
  SELECT pg_catalog.jsonb_build_object(
           'n', pg_catalog.jsonb_array_length(r.rows_json),
           'rows', r.rows_json)
    FROM r;
$fn$;

DROP VIEW public.vehicle_taxonomy_pairs_v;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = 'public.get_vehicle_taxonomy_base()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '95ce06b5a052d51763c6eeba540670b5' THEN
    RAISE EXCEPTION '還原事後閘:車款精簡版本體 md5 = %, 不是 95ce06b5a052d51763c6eeba540670b5', v_md5;
  END IF;
  IF pg_catalog.to_regclass('public.vehicle_taxonomy_pairs_v') IS NOT NULL THEN
    RAISE EXCEPTION '還原事後閘:新 view 還在';
  END IF;
END
$post$;

COMMIT;
