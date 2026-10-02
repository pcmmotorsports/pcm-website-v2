-- 還原 20261002150000_m4b_admin_search_customers_multi_term.sql:換回正式庫上一版(md5 e69e31cee080a7f12e422ac0b6877c6a), 本體逐字。
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_search_customers(p_query text, p_limit integer DEFAULT 100, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_txt       text;
  v_txt_like  text;
  v_num       text;
  v_num_like  text;
  v_limit     integer;
  v_ids       uuid[];
  v_truncated boolean;
  -- 20260926100000:狀態篩選。沒帶(舊呼叫端)或 NULL ⇒ active
  v_status    text := coalesce(p_status, 'active');
BEGIN
  -- ① 修剪:字元集**顯式**含 tab / U+3000 / NBSP / U+202F / U+200B / BOM
  --    (逐字對齊 `admin_search_orders`;`btrim` 預設只吃 ASCII 空白,中文輸入法常帶全形空白)。
  v_txt := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(p_query, ''), E' \t\n\r　  ​﻿')
  );

  -- ② 空 / 過長 → 回空清單,**不擲例外**(錯誤訊息會含輸入原文 = PII)。
  --    120 與 `MAX_ORDER_KEYWORD_LENGTH` 同值,刻意:兩軸的 UI 上限一致,員工不用記兩套。
  IF v_txt = '' OR pg_catalog.length(v_txt) > 120 THEN
    RETURN jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- ③ 上限:NULL / <=0 → 100;硬夾 100(對齊下游 `.in()` 的 URL 長度上限)。
  v_limit := LEAST(COALESCE(NULLIF(p_limit, 0), 100), 100);
  IF v_limit <= 0 THEN v_limit := 100; END IF;

  -- ③b 20260926100000:狀態只收 active(正常)/ disabled(已停用)/ all;不認得的值回空清單(本函式不 RAISE 的原則照舊)。
  IF v_status NOT IN ('active', 'disabled', 'all') THEN
    RETURN jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- ④ 逃逸:`LIKE` 的萬用字元。**這是在 SQL 內對 literal 做逃逸,與 `.or()` 的結構性風險無關**
  --    —— 值永遠是參數、永遠不參與語法。
  v_txt_like := pg_catalog.replace(
                  pg_catalog.replace(
                    pg_catalog.replace(v_txt, '\', '\\'),
                  '%', '\%'),
                '_', '\_');

  -- ⑤ 數字類 needle(電話):去掉所有非數字後比對 ⇒ `0912-345-678` 與 `0912345678` 互相搜得到。
  v_num := pg_catalog.regexp_replace(v_txt, '[^0-9]', '', 'g');
  v_num_like := v_num;  -- 純數字,無 LIKE 元字元可逃

  -- ⑥ 三軸 UNION(**不是一大坨 OR**)—— 逐字對齊 `admin_search_orders` 的形狀理由:
  --    OR 形狀下規劃器拿不到各軸的索引。`UNION`(非 `UNION ALL`)天然去重,
  --    一位客人同時命中兩軸只算一筆,不吃掉別人的名額。
  --    🔴 **各軸各自檢查 needle 非空**:搜 `-` 時數字類變空字串 ⇒ 該軸整組跳過,
  --       否則 `LIKE '%%'` 會**撈回全部客人**(fail-open)。
  WITH hits AS (
    -- #1 姓名(文字)
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_txt <> ''
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name, ''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
    UNION
    -- #2 Email(文字)
    -- 🔴 **LINE 合成位址刻意【搜得到】**(C 窗 2026-08-16 判、主視窗核):
    --    那串仍是該客人的登入帳號;後台把它藏起來是為了**畫面不顯示雜訊**,不是讓紀錄找不到。
    --    員工手上有那串的唯一來源是**後台以外**(Supabase 後台 / 錯誤紀錄 / LINE 客服),
    --    而那種時候他正需要用它反查是誰。⇒ 本軸不排除 `@line.pcmmotorsports.local`。
    --    ⚠️ 代價:搜到之後畫面 Email 欄顯示「LINE 帳號登入,無 Email」⇒ **搜 X 卻看不到 X**。
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_txt <> ''
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(c.email, ''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
    UNION
    -- #3 電話(數字;正規化後子字串)
    -- 🔴 **`lower()` 不可省(codex R1 must-fix 5)**:既有索引 `idx_customers_phone_trgm` 的表達式是
    --    `regexp_replace(pg_catalog.lower(COALESCE(phone,'')), '[^0-9]', '', 'g')`
    --    (`20260812130000:436-438` 逐字)。電話只有數字,**加不加 `lower()` 結果完全相同** ——
    --    但 **expression index 比對的是【表達式樹】不是【結果】** ⇒ 少一個 `lower()` 規劃器就用不到它,
    --    症狀是**功能完全正常、只是全表掃**,而**沒有任何測試會紅**。
    SELECT c.user_id, c.created_at
      FROM public.customers c
     WHERE v_num <> ''
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(c.phone, '')), '[^0-9]', '', 'g')
           LIKE '%' || v_num_like || '%' ESCAPE '\'
  ),
  ranked AS (
    -- 多撈一筆:用來分辨「剛好觸頂」與「超過」。UI 不得改用 `ids.length >= 上限` 的啟發式。
    -- 🔴 `user_id` 是**穩定的第二排序鍵**(codex R1 nit):只用 `created_at DESC` 時,
    --    兩位客人時間相同又剛好卡在上限邊界 ⇒ 回誰隨執行計畫改變 = 不可重現。
    -- 20260926100000:狀態篩選在上限之前做 ⇒ 被排除的會員不佔名額
    SELECT h.user_id, h.created_at
      FROM hits h
      JOIN public.customers c ON c.user_id = h.user_id
     WHERE v_status = 'all' OR (v_status = 'active') = (c.disabled_at IS NULL)
     ORDER BY h.created_at DESC, h.user_id
     LIMIT v_limit + 1
  )
  -- 🔴 **`array_agg` 必須自帶 `ORDER BY`(codex R2 must-fix 6)**:
  --    子查詢的 `ORDER BY` **不會**傳遞到聚合的輸入順序(PG 明文:aggregate 的輸入順序未指定)
  --    ⇒ 下面 `v_ids[1:v_limit]` 切掉的**可能不是第 101 筆**,邊界那一位隨執行計畫改變。
  --    症狀:同一組資料、同一個搜尋詞,兩次回不同的人 —— 而**兩次都「看起來正常」**。
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
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.admin_search_customers(text,integer,text)'::regprocedure) IS DISTINCT FROM 'e69e31cee080a7f12e422ac0b6877c6a' THEN
    RAISE EXCEPTION '還原事後閘:本體不是 e69e31ce…';
  END IF;
END
$post$;

COMMIT;
