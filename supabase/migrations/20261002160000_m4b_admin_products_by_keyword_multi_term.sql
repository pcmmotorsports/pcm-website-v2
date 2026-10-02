-- 20261002160000_m4b_admin_products_by_keyword_multi_term.sql —— 後台商品管理搜尋:拆詞、料號去符號、全形轉半形(S5)
-- Sean 2026-10-02 Q1 甲:打「ducati panigale arrow」這種有空格的字, 拆成幾個詞, 每個詞都要對到同一件商品。
-- 計畫:~/pcm-mailbox/計畫-後台搜尋沿用前台-20261002.md(S5)、~/pcm-mailbox/計畫-S5商品管理搜尋-20261002.md
--
-- 改什麼:admin_products_by_keyword 換本體, 簽章、回傳(SETOF products)、SECURITY INVOKER、權限都不變。
--   · 先 NFKC(全形轉半形), 修剪。
--   · 一個詞:照上一版比料號、商品名稱、員工改過的名稱、車款(* 照舊是萬用字元), 另外多比「料號去符號」
--     (「PEDGPEVO」對得到「PED-GP EVO」)⇒ 結果只會比上一版多, 不會少。
--   · 兩個詞以上:最多 8 個詞(只有標點的不算), 每個詞都要對到某一個來源。
-- 影響:簽章不變 ⇒ 貼板和推程式沒有先後問題, 後台程式不用改。不設定任何 pg_trgm 參數(不會重演 265)。
-- 還原:supabase/rollbacks/20261002160000-rollback.sql(換回正式庫 c1ffafa6… 那一版)。
-- 驗證:scripts/20261002160000-verify.sh

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5
    FROM pg_catalog.pg_proc p WHERE p.oid = 'public.admin_products_by_keyword(text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'c1ffafa6189dd0e675be1b1300d18097' THEN
    RAISE EXCEPTION 'S5 前置閘:admin_products_by_keyword 不是 c1ffafa6…(實得 %), 已貼過或底已經換了', v_md5;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_products_by_keyword(p_term text)
 RETURNS SETOF products
 LANGUAGE sql
 STABLE
AS $function$
  -- S5(Sean 2026-10-02 Q1 甲):先 NFKC(全形轉半形)、修剪;用空白拆詞(最多 8 個, 只有標點的詞不算)。
  --   `normalize(x, NFKC)` 是 SQL 語法。本函式照上一版是 SECURITY INVOKER、不設 search_path, 物件都帶 schema。
  WITH v AS (
    SELECT pg_catalog.btrim(normalize(COALESCE(p_term, ''), NFKC), E' \t\r\n　  ​﻿') AS txt
  ),
  terms AS (
    SELECT x.term, pg_catalog.min(x.ord) AS first_ord
      FROM v, pg_catalog.regexp_split_to_table(v.txt, E'[[:space:]  ​﻿]+') WITH ORDINALITY AS x(term, ord)
     WHERE x.term <> ''
       AND x.term !~ '^[[:punct:]]+$'
     GROUP BY x.term
     ORDER BY pg_catalog.min(x.ord)
     LIMIT 8
  ),
  needles AS (
    -- 0 或 1 個詞 ⇒ 一個比對對象:那個詞;一個像樣的詞都沒有就用整串(= 上一版, 例如只打 *)。
    SELECT 0::bigint AS ord, COALESCE((SELECT t.term FROM terms t), v.txt) AS txt
      FROM v
     WHERE v.txt <> '' AND (SELECT pg_catalog.count(*) FROM terms) <= 1
    UNION ALL
    -- 兩個詞以上 ⇒ 每個詞各一個比對對象, 一件商品每個詞都要對到(任一來源)才算。
    SELECT t.first_ord, t.term
      FROM terms t
     WHERE (SELECT pg_catalog.count(*) FROM terms) > 1
  ),
  n AS (
    -- pat:先把 \ % _ 當字面跳脫, 再把 * 換成萬用字元(與上一版同一條式子, 順序不可換)。
    -- fold:料號去符號比對(「PEDGPEVO」對得到「PED-GP EVO」);詞裡有 * 或去掉符號後不到 3 個字就不用。
    SELECT nd.ord,
           '%' || pg_catalog.replace(
                    pg_catalog.regexp_replace(nd.txt, '([\\%_])', '\\\1', 'g'),
                    '*', '%') || '%' AS pat,
           CASE WHEN nd.txt !~ '[*]'
                 AND pg_catalog.length(pg_catalog.regexp_replace(nd.txt, '[^A-Za-z0-9]', '', 'g')) >= 3
                THEN pg_catalog.upper(pg_catalog.regexp_replace(nd.txt, '[^A-Za-z0-9]', '', 'g')) END AS fold
      FROM needles nd
  ),
  -- 🔴 照上一版寫成「id IN (三個來源 UNION)」, 不寫成 OR 裡帶 IN 子查詢(那個形狀正式庫實測超過 2 分鐘)。
  -- ponytail: 每個詞各掃一次三個來源;正式庫 2026-10-02 唯讀實測三個詞約 3.7 秒、八個單字母詞約 10 秒
  --   (上一版單詞「a」約 5.7 秒;service_role 逾時 300 秒)。真的太慢再改成先用最長的詞縮小範圍。
  hits AS (
    SELECT q.id, n.ord
      FROM public.products q
      JOIN n ON (   q.external_id ILIKE n.pat
                 OR q.title ILIKE n.pat
                 OR (q.staff_overrides ->> 'title') ILIKE n.pat
                 OR (n.fold IS NOT NULL
                     AND pg_catalog.upper(pg_catalog.regexp_replace(q.external_id, '[^A-Za-z0-9]', '', 'g'))
                         LIKE '%' || n.fold || '%'))
    UNION
    SELECT f.product_id, n.ord
      FROM public.product_fitments f
      JOIN n ON (f.moto_brand || ' ' || f.model_code) ILIKE n.pat
    UNION
    SELECT e.product_id, n.ord
      FROM public.product_fitments_effective e
      JOIN n ON (e.moto_brand || ' ' || e.model_code) ILIKE n.pat
  )
  SELECT p.*
    FROM public.products p
   WHERE p.id IN (
           SELECT h.id
             FROM hits h
            GROUP BY h.id
           HAVING pg_catalog.count(DISTINCT h.ord) = (SELECT pg_catalog.count(*) FROM n)
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
  -- 實際叫一次(兩個詞 ⇒ 走到拆詞那段);貼板角色不對就當場整筆回滾。
  PERFORM 1 FROM public.admin_products_by_keyword('smoke zzzz-test') LIMIT 1;
END
$post$;

COMMIT;
