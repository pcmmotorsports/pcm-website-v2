-- 20261002130000  後台訂單搜尋:拆詞(每個詞都要對到)+ 全形轉半形(後台搜尋沿用前台 S2;Sean 2026-10-02 Q1 甲)
-- pcm:idempotent: yes
--   (整支包在 BEGIN … COMMIT;BEGIN 後第一個動作是前置閘比對 md5。已貼過再跑 ⇒ 前置閘 RAISE ⇒ 整筆回滾。)
-- 計畫:~/pcm-mailbox/計畫-後台搜尋沿用前台-20261002.md(S2)、~/pcm-mailbox/計畫-S2訂單搜尋拆詞-20261002.md
--
-- 改什麼:
--   ① 新增 pcm_admin_search_order_term_hits(詞, 起, 迄):本體 = 正式庫第 3 代 admin_search_orders 的 12 維比對(逐字),
--      只把 p_query 換成 p_term。內部函式, 只給 ② 呼叫(收掉所有角色的 EXECUTE)。
--   ② admin_search_orders 第 4 代(簽章、回傳形狀、上限、排序都不變):
--      · 先 NFKC(全形轉半形:「０９１２」=「0912」、全形空白 = 空白), 再小寫去頭尾空白。
--      · 整串照舊比一次(= 第 3 代的行為, 一個詞的查詢結果完全不變)。
--      · 有兩個詞以上時, 另外拆詞(最多 8 個), 一張單【每個詞都對到某一維】才算命中(「王 小明」對得到「王小明」)。
--      · 兩組聯集後照舊 created_at DESC, 最多 100 筆, 超過標 truncated。
-- 回滾:supabase/rollbacks/20261002130000-rollback.sql(換回第 3 代本體, DROP 內部函式)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'admin_search_orders') IS DISTINCT FROM 'c3cdaf1bf1294ae283362dbdaa7cf78e' THEN
    RAISE EXCEPTION 'S2 前置閘:admin_search_orders 與 2026-10-02 正式庫第 3 代不同(有人改過或已貼過)⇒ 停止';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'S2 前置閘:pcm_admin_search_order_term_hits 已存在 ⇒ 停止';
  END IF;
END
$pre$;

-- ═══ ① 每個詞的 12 維比對(內部)═══
CREATE FUNCTION public.pcm_admin_search_order_term_hits(p_term text, p_from timestamp with time zone, p_to timestamp with time zone)
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
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(oi.product_snapshot ->> 'title',''))))
    UNION
    -- #9 規格(文字;本片新增。spec 是 jsonb 物件 ⇒ 走 pcm_spec_text 攤平)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(public.pcm_spec_text(oi.product_snapshot -> 'spec'),''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
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
REVOKE ALL ON FUNCTION public.pcm_admin_search_order_term_hits(text, timestamp with time zone, timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_admin_search_order_term_hits(text, timestamp with time zone, timestamp with time zone) FROM anon, authenticated, service_role;
COMMENT ON FUNCTION public.pcm_admin_search_order_term_hits(text, timestamp with time zone, timestamp with time zone) IS
  '後台訂單搜尋的單詞 12 維比對(單號 / 舊單號 / 客人姓名 / 客人電話 / 收件人姓名 / 收件電話 / 地址 / 料號 / 品名 / 規格 / 品牌 / 供應商單號), 本體 = admin_search_orders 第 3 代逐字。內部函式, 只給 admin_search_orders 呼叫。';

-- ═══ ② admin_search_orders 第 4 代 ═══
CREATE OR REPLACE FUNCTION public.admin_search_orders(p_query text, p_limit integer DEFAULT 100, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "pg_trgm.word_similarity_threshold" TO '0.4'
AS $function$
DECLARE
  v_norm   text;
  v_terms  text[];
  v_limit  integer;
  v_ids    uuid[];
  v_found  integer;
BEGIN
  -- S2(Sean 2026-10-02 Q1 甲):先 NFKC(全形轉半形), 空白類字元一律當分隔。
  --   `normalize(x, NFKC)` 是 SQL 語法(不能寫 pg_catalog.normalize(x, NFKC)), 在空 search_path 下照樣解析到 pg_catalog。
  v_norm := pg_catalog.lower(pg_catalog.btrim(
    normalize(COALESCE(p_query, ''), NFKC), E' \t\r\n　  ​﻿'));
  IF v_norm = '' OR pg_catalog.length(v_norm) > 120 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;
  v_limit := CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN 100 ELSE LEAST(p_limit, 100) END;

  -- 拆詞:最多 8 個(與顧客站同一個上限), 重複的詞只算一次。
  SELECT pg_catalog.array_agg(t.term ORDER BY t.first_ord)
    INTO v_terms
    FROM (SELECT x.term, pg_catalog.min(x.ord) AS first_ord
            FROM pg_catalog.regexp_split_to_table(v_norm, E'[[:space:]  ​﻿]+') WITH ORDINALITY AS x(term, ord)
           WHERE x.term <> ''
           GROUP BY x.term
           ORDER BY pg_catalog.min(x.ord)
           LIMIT 8) t;

  WITH matched AS (
    -- 整串照舊比一次(= 第 3 代的行為)
    SELECT h.id, h.created_at FROM public.pcm_admin_search_order_term_hits(v_norm, p_from, p_to) h
    UNION
    -- 兩個詞以上:每個詞都要對到
    SELECT x.id, x.created_at
      FROM (SELECT h.id, h.created_at, pg_catalog.count(DISTINCT t.ord) AS n
              FROM pg_catalog.unnest(v_terms) WITH ORDINALITY AS t(term, ord)
             CROSS JOIN LATERAL public.pcm_admin_search_order_term_hits(t.term, p_from, p_to) h
             WHERE pg_catalog.cardinality(v_terms) > 1
             GROUP BY h.id, h.created_at) x
     WHERE x.n = pg_catalog.cardinality(v_terms)
  )
  SELECT pg_catalog.array_agg(m.id ORDER BY m.created_at DESC, m.id DESC)
    INTO v_ids
    FROM (SELECT DISTINCT matched.id, matched.created_at
            FROM matched
           ORDER BY matched.created_at DESC, matched.id DESC
           LIMIT v_limit + 1) m;

  v_found := COALESCE(pg_catalog.array_length(v_ids, 1), 0);
  IF v_found = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;
  IF v_found > v_limit THEN
    RETURN pg_catalog.jsonb_build_object('ids', pg_catalog.to_jsonb(v_ids[1:v_limit]), 'truncated', true);
  END IF;
  RETURN pg_catalog.jsonb_build_object('ids', pg_catalog.to_jsonb(v_ids), 'truncated', false);
END
$function$;

-- ═══ 事後斷言 ═══
DO $acl$
DECLARE
  v_functions text[] := ARRAY[
    'public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)',
    'public.admin_search_orders(text,integer,timestamptz,timestamptz)'
  ]::text[];
  v text;
BEGIN
  FOREACH v IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 對 anon / authenticated 仍可 EXECUTE', v;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v::regprocedure AND p.prosecdef
                      AND 'search_path=""' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION '收權斷言:% 不是 SECURITY DEFINER 或 search_path 不是空字串', v;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_search_orders(text,integer,timestamptz,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '收權斷言:service_role 叫不到 admin_search_orders';
  END IF;
  IF pg_catalog.has_function_privilege('service_role', 'public.pcm_admin_search_order_term_hits(text,timestamptz,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '收權斷言:內部函式不該開給 service_role';
  END IF;
END
$acl$;

COMMIT;
