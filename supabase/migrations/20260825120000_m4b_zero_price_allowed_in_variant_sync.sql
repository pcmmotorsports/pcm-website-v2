-- ============================================================
-- 0 元是合法價格(贈品)—— 讓 `sync_product_variant_group` 不再把它擋在上架那一步
--
-- 拍板:Sean 2026-08-25「乙:會, 偶爾有」(贈品 / 買一送一的那個「送」/ 試用品)
--   ⇒ `price_general = 0` 是合法值。落點 memory
--     `project_0825-sean-zero-price-is-real-print-ntd-zero`。
--   ⇒ 同日另一板「甲 不會, 贈品永遠跟著別的商品一起買」⇒ 贈品不單獨成單
--     ⇒ 整張訂單 total 恆 > 0 ⇒ 刷卡確認與付款帳本那兩道**不用動**。
--
-- 🔴 本 migration 只改【一個判斷】:
--     `(item.value->>'price_general')::numeric <= 0`  →  `< 0`
--   (另加四行解釋那個判斷的註解 —— 所以逐字 diff 是 -1 / +5, **不是「只有一行」**;
--    codex R1 nit 訂正,原文寫「只改一行」不精確。)
--   其餘整支函式逐字照抄 `20260727084801_atomic_variant_group_sync.sql` 第 19 行起,
--   **用程式從原檔取出來替換的, 不是手打** ⇒ 非目標行的差異在產出當下就驗過是 0
--   (difflib 機械比對;負對照:原檔跟自己比 = 0)。
--
-- ⚠️ 這道閘是【三道裡的第一道】。0 元商品現在的狀態:
--     ① 上架  sync_product_variant_group  ⇒ **本 migration 修的就是它**
--     ② 結帳  create_order 仍拒 `v_unit_price <= 0`(活庫實比)⇒ **本片不碰, 另一片**
--     ③ 顯示  storefront `Price.tsx`      ⇒ 已於 `0ed3cf16` 做完
--   ⇒ **這一支 apply 之後贈品仍然買不了。** 不要讀成「贈品可以上線了」。
--
-- 🔴🔴 **而【上架】那一格也還沒完 —— 它有兩道閘, 不是一道**(codex R1 must-fix, 本片外):
--   `scripts/rpm-delta.ts:74`  `isAbnormal()` ⇒ `newP <= 0` 判為異常
--   `scripts/rpm-import.ts:529` `hasAbnormal(delta)` ⇒ **throw, 硬 abort**
--   ⇒ 供應商匯入流程**在呼叫本 RPC 之前就先擋下 0 元**, 而它的訊息是
--     「價格異常列 N(null/0/負/NaN/Inf)、不可覆寫硬 abort」。
--   ⇒ **只 apply 這一支, 贈品仍然進不來。** 那一片(改 importer 的判準)未做、未開。
--
-- ⚠️ `price_store` 那半【刻意不動】:它本來就允許 0(`jsonb_typeof` 收 'null' 或 'number'),
--   而那是「選填 vs 必填」的連貫立場,不是 bug。要動先問 Sean。
--
-- 🔴 誰會受影響 —— **標題先寫清楚射程:這是「anon 可見、未下架」那一段的數字**
--   (2026-08-25 anon 對正式站實測,量測時點與角色跟著數字走):
--     products_list_public    20,668 筆 · `price_general = 0` ⇒ **0 筆**
--     product_variants_public 51,666 筆 · 同上 ⇒ **0 筆**
--     尺的雙向證明:`products_public.video_url is.null` ⇒ 18,955 · `description` ⇒ 199
--       ⇒ 這把尺不是恆回 0;負對照 `price_general = -99999` ⇒ 0
--   ⇒ **anon 可見且未下架的列: 0 筆受影響。全表數字【未查】。**
--     ~~原文寫「現有資料零筆受影響」~~ ⇒ codex R1 nit:那句會蓋過後面的限定。
--   ⚠️ anon 角色看不到已下架(`delisted_at` 非 null)的列 —— 那些列不經前台, 而
--      **本函式是 importer 走的路, 它不受 RLS 限制** ⇒ 下架列有沒有 0 元, 我沒查。
--   ⚠️ 而這是一道【放寬】:它只會讓原本被拒的 payload 通過, 不會改寫任何既有列。
--
-- Rollback(forward-only):
--   🔴🔴 **~~「把本檔的 `< 0` 改回 `<= 0` 再 apply 一次」~~ 是錯的**(codex R1 must-fix):
--     **已經 apply 過的 migration 不會因為改了同一支檔而重跑。** 改本檔只會讓
--     「檔案內容」與「資料庫裡那支函式」不一致, 而 **沒有任何東西會紅**。
--   ⇒ 正確做法:**新開一支【新 timestamp】的 migration**, 內容是同一支函式的
--     `CREATE OR REPLACE`, 把那個判斷寫回 `<= 0`。
--   ⚠️ **不要 `DROP FUNCTION`** —— 那會連同 `20260727084801` 建立的那支一起刪掉,
--      而 importer 會立刻壞。
--   📌 本 migration 沒有資料異動、沒有新物件;**而 `CREATE OR REPLACE FUNCTION` 本身就是 DDL**
--      (~~原文寫「沒有 DDL」~~ ⇒ codex R1 nit,不正確)。
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_product_variant_group(
  p_supplier_slug text,
  p_external_id text,
  p_variants jsonb,
  p_orphan_skus text[] DEFAULT ARRAY[]::text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_product_id uuid;
  v_input_count integer;
  v_allowed_keys constant text[] := ARRAY[
    'sku', 'spec', 'price_general', 'price_store', 'availability',
    'images', 'sort_order', 'metadata', 'updated_at'
  ];
  v_required_keys constant text[] := ARRAY[
    'sku', 'spec', 'price_general', 'price_store', 'availability',
    'images', 'sort_order', 'metadata', 'updated_at'
  ];
BEGIN
  IF p_supplier_slug IS NULL OR pg_catalog.btrim(p_supplier_slug) = ''
     OR p_external_id IS NULL OR pg_catalog.btrim(p_external_id) = '' THEN
    RAISE EXCEPTION 'sync_product_variant_group: supplier_slug/external_id 不可空';
  END IF;
  IF p_variants IS NULL OR pg_catalog.jsonb_typeof(p_variants) <> 'array'
     OR pg_catalog.jsonb_array_length(p_variants) = 0 THEN
    RAISE EXCEPTION 'sync_product_variant_group: variants 必須是非空 array';
  END IF;
  IF p_orphan_skus IS NULL THEN
    RAISE EXCEPTION 'sync_product_variant_group: orphan_skus 不可為 NULL';
  END IF;

  v_input_count := pg_catalog.jsonb_array_length(p_variants);

  -- 同供應商所有 hazard-group RPC 串行，避免不同商品群同時搬動 supplier+sku。
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pcm.variant-sync:' || p_supplier_slug, 0)
  );

  SELECT p.id
    INTO v_product_id
    FROM public.products AS p
   WHERE p.supplier_slug = p_supplier_slug
     AND p.external_id = p_external_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sync_product_variant_group: 找不到指定 supplier/external_id 商品';
  END IF;

  -- payload shape：每列只能且必須帶 VariantRow 的九個可寫欄。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
     WHERE pg_catalog.jsonb_typeof(item.value) <> 'object'
        OR NOT (item.value ?& v_required_keys)
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: variant row 非 object 或缺必要欄';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_object_keys(item.value) AS key_entry(key_name)
     WHERE NOT (key_entry.key_name = ANY (v_allowed_keys))
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: variant row 含非白名單欄';
  END IF;

  -- sku/spec/JSON 欄先嚴驗；禁止來源占用 transaction-only sentinel 保留鍵。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
     WHERE pg_catalog.jsonb_typeof(item.value->'sku') <> 'string'
        OR pg_catalog.btrim(item.value->>'sku') = ''
        OR item.value->>'sku' IS NULL
        OR pg_catalog.jsonb_typeof(item.value->'spec') <> 'object'
        OR (item.value->'spec') ? '__pcm_sync_sentinel__'
        OR pg_catalog.jsonb_typeof(item.value->'availability') <> 'string'
        OR pg_catalog.jsonb_typeof(item.value->'images') <> 'array'
        OR pg_catalog.jsonb_typeof(item.value->'metadata') <> 'object'
        OR (item.value->>'availability') NOT IN ('in-stock', 'out-of-stock')
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: variant 欄位型別/值非法或使用 sentinel 保留鍵';
  END IF;

  -- jsonb_to_recordset 會替呼叫端做隱式轉型；先檢查 JSON primitive，
  -- 避免 "1000"、1.5 等看似可轉型的值繞過 importer 的價格／排序契約。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
     WHERE pg_catalog.jsonb_typeof(item.value->'price_general') <> 'number'
        OR pg_catalog.jsonb_typeof(item.value->'price_store') NOT IN ('null', 'number')
        OR pg_catalog.jsonb_typeof(item.value->'sort_order') <> 'number'
        OR pg_catalog.jsonb_typeof(item.value->'updated_at') <> 'string'
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: 價格/排序/updated_at JSON 型別非法';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
     WHERE (item.value->>'price_general')::numeric
             <> pg_catalog.trunc((item.value->>'price_general')::numeric)
        -- 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的
        --   那個「送」/ 試用品)⇒ 這道閘原本把「贈品」判成「非法價格」而擋在上架那一步。
        --   ⚠️ **只放 0 進來, 負數仍然擋**;而「沒有價格」由上面那道
        --      `jsonb_typeof(...) <> 'number'` 擋 —— 那一行一個字都沒動。
        OR (item.value->>'price_general')::numeric < 0
        OR (item.value->>'price_general')::numeric > 2147483647
        OR (item.value->>'sort_order')::numeric
             <> pg_catalog.trunc((item.value->>'sort_order')::numeric)
        OR (item.value->>'sort_order')::numeric < 0
        OR (item.value->>'sort_order')::numeric > 2147483647
        OR NOT pg_catalog.isfinite((item.value->>'updated_at')::timestamptz)
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: 一般價/排序/updated_at 值非法';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
     WHERE pg_catalog.jsonb_typeof(item.value->'price_store') = 'number'
       AND (
         (item.value->>'price_store')::numeric
           <> pg_catalog.trunc((item.value->>'price_store')::numeric)
         OR (item.value->>'price_store')::numeric < 0
         OR (item.value->>'price_store')::numeric > 2147483647
       )
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: 店家價值非法';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_each(item.value->'spec') AS spec_entry(key, value)
     WHERE pg_catalog.jsonb_typeof(spec_entry.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: spec value 必須全為 string';
  END IF;

  -- 最終態必須 sku 唯一、spec 唯一；orphan 清單也不得重複或與 desired 重疊。
  IF (
    SELECT pg_catalog.count(DISTINCT item.value->>'sku')
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
  ) <> v_input_count THEN
    RAISE EXCEPTION 'sync_product_variant_group: desired sku 重複';
  END IF;
  IF EXISTS (
    SELECT item.value->'spec'
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
     GROUP BY item.value->'spec'
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: desired spec 重複';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(p_orphan_skus) AS orphan(sku)
     WHERE orphan.sku IS NULL OR pg_catalog.btrim(orphan.sku) = ''
  ) OR (
    SELECT pg_catalog.count(DISTINCT orphan.sku)
      FROM pg_catalog.unnest(p_orphan_skus) AS orphan(sku)
  ) <> pg_catalog.cardinality(p_orphan_skus) THEN
    RAISE EXCEPTION 'sync_product_variant_group: orphan sku 空值或重複';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
     WHERE (item.value->>'sku') = ANY (p_orphan_skus)
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: desired sku 不可同時列為 orphan';
  END IF;

  -- 鎖住本群與 desired SKU 現存列；跨商品搬 SKU 不在本 slice，明確 fail-closed。
  PERFORM 1
    FROM public.product_variants AS pv
   WHERE pv.product_id = v_product_id
      OR (
        pv.supplier_slug = p_supplier_slug
        AND pv.sku IN (
          SELECT item.value->>'sku'
            FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
        )
      )
   FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM public.product_variants AS pv
      JOIN pg_catalog.jsonb_array_elements(p_variants) AS item(value)
        ON item.value->>'sku' = pv.sku
     WHERE pv.supplier_slug = p_supplier_slug
       AND pv.product_id <> v_product_id
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: desired SKU 目前屬於另一商品群';
  END IF;

  -- 呼叫端必須提供完整群：任何非 desired 現存列都必須明列 orphan，避免漏刪後假成功。
  IF EXISTS (
    SELECT 1
      FROM public.product_variants AS pv
     WHERE pv.product_id = v_product_id
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
          WHERE item.value->>'sku' = pv.sku
       )
       AND NOT (pv.sku = ANY (p_orphan_skus))
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: payload 不是完整商品群（缺 orphan）';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(p_orphan_skus) AS orphan(sku)
      LEFT JOIN public.product_variants AS pv
        ON pv.supplier_slug = p_supplier_slug
       AND pv.sku = orphan.sku
     WHERE pv.id IS NULL OR pv.product_id <> v_product_id
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: orphan SKU 不存在或不屬於指定商品群';
  END IF;

  -- 若上次有人繞過本 RPC 留下 sentinel，拒絕覆蓋證據；正常交易 rollback 不可能留下它。
  IF EXISTS (
    SELECT 1
      FROM public.product_variants AS pv
     WHERE pv.product_id = v_product_id
       AND pv.spec ? '__pcm_sync_sentinel__'
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: target 已存在 sentinel，需人工調查';
  END IF;

  -- 第一階段：只把 spec 真正會變的現存 desired row 搬到每列唯一 sentinel。
  UPDATE public.product_variants AS pv
     SET spec = pg_catalog.jsonb_build_object('__pcm_sync_sentinel__', pv.id::text)
   WHERE pv.product_id = v_product_id
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
        WHERE item.value->>'sku' = pv.sku
          AND pv.spec IS DISTINCT FROM item.value->'spec'
     );

  -- 第二階段：同一 transaction 內刪孤兒、寫入完整 desired 集合。
  DELETE FROM public.product_variants AS pv
   WHERE pv.product_id = v_product_id
     AND pv.supplier_slug = p_supplier_slug
     AND pv.sku = ANY (p_orphan_skus);

  INSERT INTO public.product_variants (
    product_id,
    supplier_slug,
    sku,
    spec,
    price_general,
    price_store,
    availability,
    images,
    sort_order,
    metadata,
    updated_at
  )
  SELECT
    v_product_id,
    p_supplier_slug,
    desired.sku,
    desired.spec,
    desired.price_general,
    desired.price_store,
    desired.availability,
    desired.images,
    desired.sort_order,
    desired.metadata,
    desired.updated_at
  FROM pg_catalog.jsonb_to_recordset(p_variants) AS desired(
    sku text,
    spec jsonb,
    price_general integer,
    price_store integer,
    availability text,
    images jsonb,
    sort_order integer,
    metadata jsonb,
    updated_at timestamptz
  )
  ON CONFLICT (supplier_slug, sku) DO UPDATE
    SET product_id = EXCLUDED.product_id,
        spec = EXCLUDED.spec,
        price_general = EXCLUDED.price_general,
        price_store = EXCLUDED.price_store,
        availability = EXCLUDED.availability,
        images = EXCLUDED.images,
        sort_order = EXCLUDED.sort_order,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
    -- ownership guard 必須與 ON CONFLICT 同一原子決策：
    -- 前置查詢後若普通 bulk writer 競態插入同 supplier+sku 到別群，禁止把它搬進本群。
    WHERE public.product_variants.product_id = EXCLUDED.product_id;

  -- 終態 assert：本群 SKU 集合需與 desired 完全相等，且 sentinel 零殘留。
  IF (
    SELECT pg_catalog.count(*)
      FROM public.product_variants AS pv
     WHERE pv.product_id = v_product_id
  ) <> v_input_count OR EXISTS (
    SELECT 1
      FROM public.product_variants AS pv
     WHERE pv.product_id = v_product_id
       AND (
         pv.spec ? '__pcm_sync_sentinel__'
         OR NOT EXISTS (
           SELECT 1
             FROM pg_catalog.jsonb_array_elements(p_variants) AS item(value)
            WHERE item.value->>'sku' = pv.sku
         )
       )
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group: 終態 assert 失敗';
  END IF;

  RETURN v_input_count;
END;
$fn$;

COMMENT ON FUNCTION public.sync_product_variant_group(text, text, jsonb, text[]) IS
  'Supplier Daily Sync 專用：單商品群變體換位 atomic RPC。supplier row lock + payload 重驗 + unique sentinel + orphan delete + full desired upsert + final assert；失敗整個函式 transaction rollback。EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.sync_product_variant_group(text, text, jsonb, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_product_variant_group(text, text, jsonb, text[])
  TO service_role;

DO $$
BEGIN
  IF NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.sync_product_variant_group(text, text, jsonb, text[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group ACL 異常：service_role 應可 EXECUTE';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.sync_product_variant_group(text, text, jsonb, text[])',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.sync_product_variant_group(text, text, jsonb, text[])',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'sync_product_variant_group ACL 異常：client roles 不可 EXECUTE';
  END IF;
END
$$;
