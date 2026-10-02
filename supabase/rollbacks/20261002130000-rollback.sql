-- 回滾 20261002130000(S2 訂單搜尋拆詞):admin_search_orders 換回第 3 代(md5 c3cdaf1b…), DROP 內部函式。先退程式(本片程式不用改)再跑。
BEGIN;
SET LOCAL lock_timeout = '5s';
-- 先載入 pg_trgm 的程式庫:貼板角色不是 superuser, 程式庫沒載入時不能在函式上 SET pg_trgm.word_similarity_threshold
-- (265 第一次貼就是死在這裡:permission denied to set parameter)。叫一次 pg_trgm 的函式就會載入。
DO $load$ BEGIN PERFORM extensions.similarity('a', 'a'); END $load$;
CREATE OR REPLACE FUNCTION public.admin_search_orders(p_query text, p_limit integer DEFAULT 100, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "pg_trgm.word_similarity_threshold" TO '0.4'
AS $function$
DECLARE
  v_raw        text;
  v_limit      integer;
  v_ids        uuid[];
  v_found      integer;
  v_id_needle  text;
  v_num_needle text;
  v_txt_needle text;
  v_id_like    text;
  v_num_like   text;
  v_txt_like   text;
BEGIN
  -- ── 0. 空輸入短路(承 #347-1/-3a,逐字保留)────────────────────────────
  -- 🔴 全空白也算空。回空清單、**不發查詢**。
  --    `btrim(x)` 預設只清 ASCII 空格 ⇒ tab、全形空白 U+3000、NBSP、窄空格、
  --    零寬空格、BOM 全都會穿過去 ⇒ 修剪字元集必須顯式列出。
  v_raw := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(p_query, ''), E' \t\r\n\u3000\u00a0\u202f\u200b\ufeff'));
  IF v_raw = '' THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- 🔴 長度閘:超過 120 字元一律當作沒有結果。擋的是「超長輸入讓每一列的比對變貴」,
  --    **不是**整體執行時間(那個本片綁不住)。回空清單而不是擲例外:錯誤訊息不得含
  --    輸入原文,而「長度是 N」本身也是輸入的資訊。
  IF pg_catalog.length(v_raw) > 120 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- ── 1. 上限:NULL 或 <= 0 → 100;超過 100 一律夾到 100(既有合約,不動)────
  v_limit := CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN 100 ELSE LEAST(p_limit, 100) END;

  -- ── 2. needle 三份(plan §4.2;每一類各自檢查非空)──────────────────────
  -- 🔴 **三類各自算、各自檢查空**,不是算一份共用:
  --    · 識別碼類 NORM_ID:忽略大小寫 + 忽略 - _ 空白(含 U+3000 / NBSP)
  --    · 數字類   NORM_NUM:只留數字
  --    · 文字類   NORM_TXT:lower + btrim
  --    搜 `-` 時 NORM_ID/NORM_NUM 會變空字串 ⇒ 那兩類整組跳過(否則 `LIKE '%%'` 撈全部);
  --    但**文字類不跳過** —— 資料裡真的可能有 `-`,搜得到才是對的(plan A2 逐字)。
  v_id_needle  := pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(p_query,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g');
  v_num_needle := pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(p_query,'')), '[^0-9]', '', 'g');
  v_txt_needle := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_query,'')));

  -- LIKE 用的跳脫版:needle 內的 \ % _ 三個字元必須跳脫,否則搜一個 `%` 會撈出全部。
  -- 🔴 順序固定:先跳脫反斜線本身,再跳脫 % 與 _(反過來會把剛加的反斜線再跳脫一次)。
  v_id_like  := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_id_needle ,'\','\\'),'%','\%'),'_','\_');
  v_num_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_num_needle,'\','\\'),'%','\%'),'_','\_');
  v_txt_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_txt_needle,'\','\\'),'%','\%'),'_','\_');

  -- ── 3. 12 分支 UNION ────────────────────────────────────────────────────
  -- 🔴 每個分支**自己帶**日期範圍與非空閘 —— 不是在外層包一次:
  --    分支各自帶,規劃器才可能對每個分支各自挑索引(這正是 UNION 形狀的目的)。
  -- 🔴 模糊的運算元方向固定:`needle OPERATOR(extensions.<%) 目標表達式`(needle 在左)。
  --    寫反了語意顛倒(變成「整個地址有多少對得上 needle」)而且**照樣會編譯過**。
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
  SELECT pg_catalog.array_agg(h.id ORDER BY h.created_at DESC, h.id DESC)
    INTO v_ids
    FROM (SELECT DISTINCT id, created_at
            FROM hits
           ORDER BY created_at DESC, id DESC
           LIMIT v_limit + 1) h;

  -- ── 4. 組回傳(合約與 #347-3a 逐字相同)──────────────────────────────────
  -- 🔴 `array_length(NULL,1)` 與空陣列都回 NULL ⇒ 零命中走這一條。
  v_found := COALESCE(pg_catalog.array_length(v_ids, 1), 0);
  IF v_found = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- 🔴 多撈的那一筆只用來證明「還有更多」,**不回給呼叫端**。
  --    這個 `+1` 的存在理由 = 分辨「剛好觸頂」與「超過」;UI 若改用
  --    `ids.length >= 上限` 的啟發式,就把它的價值整個抹掉(驗收有專屬邊界格)。
  IF v_found > v_limit THEN
    RETURN pg_catalog.jsonb_build_object(
      'ids', pg_catalog.to_jsonb(v_ids[1:v_limit]),
      'truncated', true);
  END IF;

  RETURN pg_catalog.jsonb_build_object('ids', pg_catalog.to_jsonb(v_ids), 'truncated', false);
END
$function$;
DROP FUNCTION public.pcm_admin_search_order_term_hits(text, timestamp with time zone, timestamp with time zone);
DO $post$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = 'public.admin_search_orders(text,integer,timestamptz,timestamptz)'::regprocedure) IS DISTINCT FROM 'c3cdaf1bf1294ae283362dbdaa7cf78e' THEN
    RAISE EXCEPTION '回滾後 admin_search_orders 不是第 3 代';
  END IF;
END
$post$;
COMMIT;
