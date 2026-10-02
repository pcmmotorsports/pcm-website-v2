-- 20261002150000_m4b_admin_search_customers_multi_term.sql —— 後台客戶搜尋:拆詞、全形轉半形(S4)
-- Sean 2026-10-02 Q1 甲:打「王 小明」「小明 0912」這種有空格的字, 拆成幾個詞, 每個詞都要對到同一位客人。
-- 計畫:~/pcm-mailbox/計畫-後台搜尋沿用前台-20261002.md(S4)、~/pcm-mailbox/計畫-S4客戶搜尋拆詞-20261002.md
--
-- 改什麼:admin_search_customers 換本體, 簽章、回傳形狀、上限、排序、狀態篩選都不變。
--   · 先 NFKC(全形轉半形:「０９１２」=「0912」), 小寫, 修剪。
--   · 只有一個詞:照上一版整串比一次(三軸:姓名 / Email / 電話數字), 結果與上一版相同。
--   · 兩個詞以上:拆詞(最多 8 個, 只有標點的詞不算), 一位客人每個詞都要對到某一軸才算。
--     🔴 不再另外整串比:上一版會把整串的數字全部抽出來比電話, 「林 0912」會找到電話含 0912 的王小明(姓名沒對到)。
--        有空格的電話「0912 345 678」拆開後每段都對得到電話, 不需要整串比。
--   · 沒做姓名模糊比對:本機拋棄式資料庫的字元設定讀不到中文, 驗不到結果;正式庫 27 位客人, 拆詞加子字串先上。
-- 影響:簽章不變 ⇒ 貼板和推程式沒有先後問題, 後台程式不用改。不設定任何 pg_trgm 參數(不會重演 265)。
-- 還原:supabase/rollbacks/20261002150000-rollback.sql(換回正式庫 e69e31ce… 那一版)。
-- 驗證:scripts/20261002150000-verify.sh

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5
    FROM pg_catalog.pg_proc p WHERE p.oid = 'public.admin_search_customers(text,integer,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM 'e69e31cee080a7f12e422ac0b6877c6a' THEN
    RAISE EXCEPTION 'S4 前置閘:admin_search_customers 不是 e69e31ce…(實得 %), 已貼過或底已經換了', v_md5;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_search_customers(p_query text, p_limit integer DEFAULT 100, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_txt       text;
  v_terms     text[];
  v_limit     integer;
  v_ids       uuid[];
  v_truncated boolean;
  v_status    text := coalesce(p_status, 'active');
BEGIN
  -- S4(Sean 2026-10-02 Q1 甲):先 NFKC(全形轉半形), 小寫, 修剪(字元集同 admin_search_orders 第 4 代)。
  --   `normalize(x, NFKC)` 是 SQL 語法, 在空 search_path 下照樣解析到 pg_catalog。
  v_txt := pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(p_query, ''), NFKC), E' \t\r\n　  ​﻿'));

  -- 空 / 過長 → 回空清單, 不擲例外(錯誤訊息會含輸入原文 = PII)。
  IF v_txt = '' OR pg_catalog.length(v_txt) > 120 THEN
    RETURN jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- 上限:NULL / <=0 → 100;硬夾 100(對齊下游 `.in()` 的 URL 長度上限)。
  v_limit := LEAST(COALESCE(NULLIF(p_limit, 0), 100), 100);
  IF v_limit <= 0 THEN v_limit := 100; END IF;

  -- 狀態只收 active / disabled / all;不認得的值回空清單(本函式不 RAISE)。
  IF v_status NOT IN ('active', 'disabled', 'all') THEN
    RETURN jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- 拆詞:最多 8 個(與顧客站、訂單搜尋同一個上限), 第 9 個以後的詞直接丟掉;重複的詞只算一次。
  SELECT pg_catalog.array_agg(t.term ORDER BY t.first_ord)
    INTO v_terms
    FROM (SELECT x.term, pg_catalog.min(x.ord) AS first_ord
            FROM pg_catalog.regexp_split_to_table(v_txt, E'[[:space:]  ​﻿]+') WITH ORDINALITY AS x(term, ord)
           WHERE x.term <> ''
             AND x.term !~ '^[[:punct:]]+$'   -- 「0912 - 345」中間那個 - 不算一個詞
           GROUP BY x.term
           ORDER BY pg_catalog.min(x.ord)
           LIMIT 8) t;

  -- 比對對象:只有一個詞(或沒有像樣的詞)⇒ ord 0 = 整串(= 上一版的行為);
  --           兩個詞以上 ⇒ ord 1..n = 每個詞, 一位客人每個詞都要對到某一軸才算。
  -- 三軸:姓名、Email(子字串, LIKE 萬用字元已逃逸)、電話(只比數字;needle 沒有數字就跳過這軸, 否則 LIKE '%%' 會撈全部)。
  -- ponytail: 改成一個 JOIN 而不是上一版的三段 UNION, 用不到各軸索引;正式庫 2026-10-02 只有 27 位客人, 上千位再拆回 UNION。
  -- 電話那一軸照舊包 lower(), 表達式和 idx_customers_phone_trgm 一樣。
  WITH needles AS (
    -- 去重 / 丟標點後只剩一個詞(「小明 小明」「王小明 ,」)⇒ 比那個詞;一個像樣的詞都沒有 ⇒ 比整串(= 上一版)。
    SELECT 0::bigint AS ord,
           CASE WHEN pg_catalog.cardinality(v_terms) = 1 THEN v_terms[1] ELSE v_txt END AS txt
     WHERE COALESCE(pg_catalog.cardinality(v_terms), 0) <= 1
    UNION ALL
    SELECT u.ord, u.term
      FROM pg_catalog.unnest(v_terms) WITH ORDINALITY AS u(term, ord)
     WHERE pg_catalog.cardinality(v_terms) > 1
  ),
  n AS (
    SELECT nd.ord,
           pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(nd.txt, '\', '\\'), '%', '\%'), '_', '\_') AS txt_like,
           pg_catalog.regexp_replace(nd.txt, '[^0-9]', '', 'g') AS num
      FROM needles nd
  ),
  hit_terms AS (
    SELECT DISTINCT c.user_id, n.ord
      FROM public.customers c
      JOIN n ON (
           pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name, '')))  LIKE '%' || n.txt_like || '%' ESCAPE '\'
        OR pg_catalog.lower(pg_catalog.btrim(COALESCE(c.email, ''))) LIKE '%' || n.txt_like || '%' ESCAPE '\'
        OR (n.num <> ''
            AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(c.phone, '')), '[^0-9]', '', 'g')
                LIKE '%' || n.num || '%')
      )
  ),
  hits AS (
    SELECT h.user_id FROM hit_terms h WHERE h.ord = 0
    UNION
    SELECT h.user_id FROM hit_terms h WHERE h.ord > 0
     GROUP BY h.user_id
    HAVING pg_catalog.count(DISTINCT h.ord) = pg_catalog.cardinality(v_terms)
  ),
  ranked AS (
    -- 多撈一筆分辨「剛好觸頂」與「超過」;user_id 是穩定的第二排序鍵;狀態篩選在上限之前。
    SELECT c.user_id, c.created_at
      FROM hits h
      JOIN public.customers c ON c.user_id = h.user_id
     WHERE v_status = 'all' OR (v_status = 'active') = (c.disabled_at IS NULL)
     ORDER BY c.created_at DESC, c.user_id
     LIMIT v_limit + 1
  )
  -- array_agg 自帶 ORDER BY(子查詢的順序不會傳進聚合)。
  SELECT pg_catalog.array_agg(user_id ORDER BY created_at DESC, user_id) INTO v_ids FROM ranked;

  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);
  v_truncated := pg_catalog.array_length(v_ids, 1) > v_limit;
  IF v_truncated THEN
    v_ids := v_ids[1:v_limit];
  END IF;

  RETURN jsonb_build_object(
    'ids', COALESCE(pg_catalog.to_jsonb(v_ids), '[]'::jsonb),
    'truncated', COALESCE(v_truncated, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_search_customers(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_customers(text, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_customers(text, integer, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_search_customers(text,integer,text)'];
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
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
                     AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '收權斷言:% 不是 SECURITY DEFINER / search_path 空 / owner postgres', v_fn;
    END IF;
  END LOOP;
  -- 實際叫一次(兩個詞 ⇒ 走到拆詞那段);貼板角色不對就當場整筆回滾。
  PERFORM public.admin_search_customers('smoke test', 1, 'all');
END
$post$;

COMMIT;
