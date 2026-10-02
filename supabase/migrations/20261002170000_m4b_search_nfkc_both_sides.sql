-- 20261002170000_m4b_search_nfkc_both_sides.sql —— 訂單搜尋、客戶搜尋:文字欄原字串與轉半形各比一次
-- Sean 2026-10-02 選甲(主視窗轉達):265(S2)、267(S4)只把查詢字轉半形, 資料沒轉 ⇒ 員工從商品名稱複製
--   「翅膀（左）」去搜, 查詢字變「翅膀(左)」, 對不上訂單裡的「翅膀（左）」。上一版兩邊都是原字串, 所以這是 265 帶進來的退步。
--   正式庫 2026-10-02 商品名稱 30,787 件裡 7,677 件有全形字;訂單品項目前 24 筆都沒有, 新訂單會照抄商品名稱。
--   S5(商品管理搜尋)Fable R1 F1 抓到同一件事, 這支照那個修法補 S2、S4。
-- 計畫:~/pcm-mailbox/計畫-搜尋全形兩邊比對-20261002.md
--
-- 改什麼(兩支都是 CREATE OR REPLACE, 簽章、權限、SET 子句都不變;其他比對一個字都不改):
--   ① pcm_admin_search_order_term_hits:六個文字軸(客人姓名、收件人姓名、地址、品名、規格、品牌)的子字串比對,
--      多比一次 normalize(欄位, NFKC)。模糊比對(<%)與識別碼、電話軸不動(正式庫實查單號 / 料號 / 供應商單號 0 筆有全形字)。
--   ② admin_search_customers:姓名、Email 多比一次 normalize(欄位, NFKC)。
--   ⇒ 只會多找到, 不會少。
-- 影響:簽章不變, 貼板和推程式沒有先後問題, 程式不用改。
-- 還原:supabase/rollbacks/20261002170000-rollback.sql(換回 711588725c… 與 19102ce2… 兩個本體)。
-- 驗證:scripts/20261002170000-verify.sh

BEGIN;
SET LOCAL lock_timeout = '5s';
-- 先載入 pg_trgm 的程式庫:訂單搜尋內部函式帶 SET pg_trgm.word_similarity_threshold, 貼板角色不是 superuser,
-- 程式庫沒載入時會 permission denied(265 第一次貼就是死在這裡)。
DO $load$ BEGIN PERFORM extensions.similarity('a', 'a'); END $load$;

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '711588725c4add65224a241ae063e664' THEN
    RAISE EXCEPTION '全形前置閘:訂單搜尋內部函式不是 71158872…(實得 %), 已貼過或底已經換了', v_md5;
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_search_customers(text,integer,text)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '19102ce213bd16759900003c72072c2f' THEN
    RAISE EXCEPTION '全形前置閘:admin_search_customers 不是 19102ce2…(實得 %), 已貼過或底已經換了', v_md5;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.pcm_admin_search_order_term_hits(p_term text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(id uuid, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "pg_trgm.word_similarity_threshold" TO '0.4'
AS $fn$
#variable_conflict use_column
DECLARE
  v_id_needle  text;
  v_num_needle text;
  v_txt_needle text;
  v_id_like    text;
  v_num_like   text;
  v_txt_like   text;
BEGIN
  -- 本體 = 正式庫第 3 代 admin_search_orders 的 needles 與 hits(逐字), 只把 p_query 換成 p_term。
  v_id_needle  := pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(p_term,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g');
  v_num_needle := pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(p_term,'')), '[^0-9]', '', 'g');
  v_txt_needle := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_term,'')));
  v_id_like  := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_id_needle ,'\','\\'),'%','\%'),'_','\_');
  v_num_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_num_needle,'\','\\'),'%','\%'),'_','\_');
  v_txt_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_txt_needle,'\','\\'),'%','\%'),'_','\_');
  RETURN QUERY
  WITH hits AS (
    -- #1 訂單編號(識別碼;不套模糊)
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_id_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(o.display_id,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
    UNION
    -- #12 舊訂單編號 legacy_display_id(識別碼)
    -- 🔴 少這支 = 淨失能力:舊的專用單號欄是**兩欄對稱查**
    --    (adapter 裡一條 `display_id.eq.…,legacy_display_id.eq.…` 的 `.or()`),
    --    改過號的單、客人拿舊單號來問,新搜尋若只查 display_id 就查不到。
    -- ⚠️ **那條 `.or()` 與整個 `orderNumber` 專用軸已在應用層那顆退場**(Sean 拍板 Q-347-B1=B)
    --    ⇒ 本分支自此是舊單號**唯一**的查得到路徑,不再是「與 adapter 並存的第二條」。
    --    (原文此處寫 `SupabaseOrderAdapter.ts:762`,那個行號在同一批的應用層改動後
    --     指到無關的程式碼 —— 指向已刪實作的行號比沒有指標更糟,故改成描述它是什麼。)
    -- ⚠️ 下面那條 `IS NOT NULL` **語意上是恆等的**(NULL 經 COALESCE 變空字串,
    --    本來就不可能命中非空 needle)—— 它只為了讓規劃器對得上 partial 索引的述詞。
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_id_needle <> ''
       AND o.legacy_display_id IS NOT NULL
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(o.legacy_display_id,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
    UNION
    -- #2 會員姓名(文字:子字串 OR 詞相似度)
    -- 🔴 join 欄是 `customers.user_id`,不是 `customers.id`(踩過)。
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.customers c ON c.user_id = o.customer_user_id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name,''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(c.name,''), NFKC))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name,''))))
    UNION
    -- #3 會員電話(數字;不套模糊)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.customers c ON c.user_id = o.customer_user_id
     WHERE v_num_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(c.phone,'')), '[^0-9]', '', 'g')
           LIKE '%' || v_num_like || '%' ESCAPE '\'
    UNION
    -- #4 收件人姓名(文字)
    -- 🔴 收件快照三個子鍵**分開比,不得先用 `||` 串起來** —— 串接會製造跨欄假命中
    --    (姓名結尾 + 電話開頭剛好拼出搜尋詞)。
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'name',''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(o.shipping_address_snapshot ->> 'name',''), NFKC))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'name',''))))
    UNION
    -- #5 收件電話(數字;不套模糊)
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_num_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(o.shipping_address_snapshot ->> 'phone','')), '[^0-9]', '', 'g')
           LIKE '%' || v_num_like || '%' ESCAPE '\'
    UNION
    -- #6 收件地址 line(文字)
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'line',''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(o.shipping_address_snapshot ->> 'line',''), NFKC))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'line',''))))
    UNION
    -- #7 料號(識別碼;讀 order_items 的**下單當下快照**,不經商品表)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE v_id_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(oi.variant_sku,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
    UNION
    -- #8 品名(文字;同樣讀快照)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(oi.product_snapshot ->> 'title',''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(oi.product_snapshot ->> 'title',''), NFKC))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(oi.product_snapshot ->> 'title',''))))
    UNION
    -- #9 規格(文字;本片新增。spec 是 jsonb 物件 ⇒ 走 pcm_spec_text 攤平)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(public.pcm_spec_text(oi.product_snapshot -> 'spec'),''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(public.pcm_spec_text(oi.product_snapshot -> 'spec'),''), NFKC))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(public.pcm_spec_text(oi.product_snapshot -> 'spec'),''))))
    UNION
    -- #10 品牌(文字;**12 條裡唯一走活的商品表的分支** —— variant → product → brand 三跳)
    -- 🔴 Sean 拍 Q2=A:搜「**現在的**品牌」,不是下單當時的品牌;畫面要標明這件事(plan A5)。
    -- 🔴 資料源刻意用 base 表、**不是** `storefront_catalog_v`:那個 view 的條件是
    --    `is_listed AND NOT hidden_from_store` ⇒ 已下架商品的歷史訂單會整批搜不到。
    --    後台搜訂單歷史 vs 前台目錄 = 兩種答案(plan A4b)。
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items    oi ON oi.order_id = o.id
      JOIN public.product_variants pv ON pv.id = oi.variant_id
      JOIN public.products         pr ON pr.id = pv.product_id
      JOIN public.brands           br ON br.id = pr.brand_id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(br.name,''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(br.name,''), NFKC))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(br.name,''))))
    UNION
    -- #11 供應商單號(識別碼;不套模糊)
    -- ⚠️ 本片**只保留「查得到單」這一項**。舊兩段式路徑另外帶的「供應商名/多家去重」
    --    在片 B-2 重建(Sean Q-347-B2=C);「截斷擲例外」則照 Q-347-B3=B 退場,
    --    改由本函式既有的 `truncated` 旗標 + 畫面提示承載。
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items             oi ON oi.order_id = o.id
      JOIN public.order_item_procurement  pc ON pc.order_item_id = oi.id
     WHERE v_id_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(pc.supplier_order_no,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
  )
  SELECT DISTINCT hits.id, hits.created_at FROM hits;
END
$fn$;

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
        OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(c.name, ''), NFKC))) LIKE '%' || n.txt_like || '%' ESCAPE '\'
        OR pg_catalog.lower(pg_catalog.btrim(COALESCE(c.email, ''))) LIKE '%' || n.txt_like || '%' ESCAPE '\'
        OR pg_catalog.lower(pg_catalog.btrim(normalize(COALESCE(c.email, ''), NFKC))) LIKE '%' || n.txt_like || '%' ESCAPE '\'
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

REVOKE ALL ON FUNCTION public.pcm_admin_search_order_term_hits(text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_admin_search_order_term_hits(text, timestamp with time zone, timestamp with time zone) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_search_customers(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_customers(text, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_customers(text, integer, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)', 'public.admin_search_customers(text,integer,text)'];
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 不該開給 anon / authenticated', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure
                     AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)
                     AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
      RAISE EXCEPTION '收權斷言:% 不是 SECURITY DEFINER / search_path 空 / owner postgres', v_fn;
    END IF;
  END LOOP;
  -- 內部函式只給 admin_search_orders 叫;客戶搜尋給 service_role。
  IF pg_catalog.has_function_privilege('service_role', 'public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '收權斷言:訂單搜尋內部函式不該開給 service_role';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_search_customers(text,integer,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '收權斷言:service_role 叫不到 admin_search_customers';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)'::regprocedure
                    AND p.proconfig @> ARRAY['pg_trgm.word_similarity_threshold=0.4']) THEN
    RAISE EXCEPTION '收權斷言:訂單搜尋內部函式的模糊門檻 0.4 不見了';
  END IF;
  -- 實際叫一次(訂單:兩個詞 ⇒ 走到內部函式;客戶:兩個詞);貼板角色不對就當場整筆回滾。
  PERFORM public.admin_search_orders('smoke test');
  PERFORM public.admin_search_customers('smoke test', 1, 'all');
END
$post$;

COMMIT;
