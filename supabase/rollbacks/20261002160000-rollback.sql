-- 還原 20261002160000_m4b_admin_products_by_keyword_multi_term.sql:換回正式庫上一版(md5 c1ffafa6189dd0e675be1b1300d18097), 本體逐字。
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_products_by_keyword(p_term text)
 RETURNS SETOF products
 LANGUAGE sql
 STABLE
AS $function$
  WITH t AS (
    -- 先把 \ % _ 當字面跳脫,再把 * 換成萬用字元(順序不可換:先換 * 會讓它產生的 % 被跳脫掉)。
    SELECT '%' || pg_catalog.replace(
                    pg_catalog.regexp_replace(p_term, '([\\%_])', '\\\1', 'g'),
                    '*', '%') || '%' AS pat
     WHERE pg_catalog.btrim(COALESCE(p_term, '')) <> ''
  )
  -- 🔴 寫成「id IN (三個來源 UNION)」,不寫成「料號 ILIKE … OR id IN (車款)」:
  --    OR 裡的 IN 子查詢結果太大時(例如搜「a」,車款表幾乎每列都中),planner 會放棄雜湊、
  --    改成每件商品重掃一次子查詢 ⇒ 正式庫唯讀實測超過 2 分鐘沒跑完。UNION 形狀同一個詞約 1.1 秒。
  SELECT p.*
    FROM public.products p
   WHERE p.id IN (
           SELECT q.id FROM public.products q, t
            WHERE q.external_id ILIKE t.pat
               OR q.title ILIKE t.pat
               OR (q.staff_overrides ->> 'title') ILIKE t.pat
           UNION
           SELECT f.product_id FROM public.product_fitments f, t
            WHERE (f.moto_brand || ' ' || f.model_code) ILIKE t.pat
           UNION
           SELECT e.product_id FROM public.product_fitments_effective e, t
            WHERE (e.moto_brand || ' ' || e.model_code) ILIKE t.pat
         );
$function$;

REVOKE ALL ON FUNCTION public.admin_products_by_keyword(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_products_by_keyword(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_products_by_keyword(text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_products_by_keyword(text)'];
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 不該開給 anon / authenticated', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:service_role 叫不到 %', v_fn;
    END IF;
    -- 照上一版:SECURITY INVOKER(以呼叫者身份讀, 不越權)。
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure AND p.prosecdef) THEN
      RAISE EXCEPTION '收權斷言:% 變成 SECURITY DEFINER 了', v_fn;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.admin_products_by_keyword(text)'::regprocedure) IS DISTINCT FROM 'c1ffafa6189dd0e675be1b1300d18097' THEN
    RAISE EXCEPTION '還原事後閘:本體不是 c1ffafa6…';
  END IF;
END
$post$;

COMMIT;
