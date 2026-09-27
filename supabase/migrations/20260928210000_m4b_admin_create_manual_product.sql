-- 20260928210000_m4b_admin_create_manual_product.sql —— 商品頁乙 P3(P-M2):後台新增手動商品
-- pcm:idempotent: yes
--   ↑ 重跑同形:函式 CREATE OR REPLACE(簽章不變)· REVOKE / GRANT 可重下。拋棄式 PG 實跑:套用 → 重跑 → 回滾 → 再套用(見 commit message)。
-- pcm:rule1-exception: 新函式刻意用 CREATE OR REPLACE —— 為了重貼冪等(pcm:idempotent: yes);簽章固定,前置閘之前本庫查無此名。
--   另外 CREATE OR REPLACE 既有的 trigger 函式 sync_product_fitments():前置閘先核對它的本體指紋必須是 20260708130000 那一代
--   (正式庫 2026-09-28 唯讀查 md5(prosrc) = 1a08b860…)或本支改好的那一代,兩者都不是就拒絕,不會蓋掉別人改過的版本。
-- ACL-GATE-EXEMPT: public.admin_create_manual_product -- SECURITY DEFINER RPC,只給 service_role EXECUTE(後台 server action 以 service_role 呼叫);anon / authenticated 全收(同 20260927060000 admin_set_product_override)。
--
-- 🛑 未貼。只寫不貼,貼的人是主視窗(Sean 2026-09-28 Q3 甲:本計畫的 migration 由主視窗直接貼)。
--    plan:~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第八節(P-M2、片 P3)
--
-- ══ 為什麼 ══════════════════════════════════════════
-- Sean 2026-09-28 Q1 乙:後台要能新增「手動商品」(報價單沒有、網站自己賣的)。
-- 手動商品的供應商代號固定 'pcm':不在每日同步名單(.github/workflows/rpm-sync.yml:231),
-- 同步與對帳都按供應商分開跑(scripts/rpm-import.ts:1223、1348;rpm-reconcile.ts:194、516)⇒ 不會改到它。
-- 🔴 代號由本函式寫死,不靠欄位預設值(products.supplier_slug 預設仍是 'rpm')。
--
-- ══ 做什麼 ══════════════════════════════════════════
-- public.admin_create_manual_product(p_brand_id, p_category_id, p_title, p_subtitle, p_description, p_variants jsonb, p_actor, p_request_id)
--   RETURNS jsonb { product_id, external_id, handle }
-- · 只有在職員工能用(錯誤字面同 20260927060000 ⇒ 後台對應到「無權執行此操作」)。
-- · p_variants = [{ sku, label, price_general, price_store, availability }, …],1–50 個。
--     sku:1–64 字、只含英數字與 . _ -、至少一個英數字、不能含 ..(與報價單圖庫同一套,d6 ea64cb66);一律轉大寫存。
--     label:規格名稱,1–100 字,同一商品內不能重複(存成 spec = {"style": label},對應 pv_spec_unique)。
--     price_general:0 以上整數,必填;price_store:0 以上整數或空(空 = 經銷會員買不了這件,照現有規則擋單)。
--     availability:'in-stock' / 'out-of-stock'。
-- · 商品編號 external_id = 第一個規格料號;網址代號 handle = 'pcm-' + 料號(規則同 scripts/rpm-transform.ts normalizeHandleSegment:
--   轉小寫、_ 和 - 以外的符號換成 -、連續分隔符合一、去掉頭尾分隔符)。
--   料號在 pcm 裡重複、handle 全站重複 ⇒ RAISE(說出是哪一個)。
-- · 商品層價格照同步的規則取「最低一般價那一款」(同價取料號小的):price_general、
--   price_by_tier = { general: { amount, currency: 'TWD' }, store: { amount, currency: 'TWD' } }
--   (格式與同步相同,scripts/rpm-transform.ts:724、732;那一款沒有經銷價 ⇒ store 取一般價)。
-- · 新建的商品一律【已下架】(delisted_at = now()、listing_set_by = 'staff'),員工檢查照片和文字後再上架。
-- · 同一交易寫 admin_audit_log('product.manual.create')。
-- 🔴 不碰特價(sale_price_general)與任何讀價出口;手動商品上架前客人看不到,所以本支不影響任何人付的錢。
--
-- ══ 順帶修一支既有的 trigger 函式 ══════════════════════════
-- products 的 AFTER INSERT / UPDATE OF fitments trigger 呼叫 sync_product_fitments()(20260708130000:74 起),
-- 它寫的是沒有 schema 的 product_fitments,而且沒設 search_path。本支的函式照慣例 search_path = '' ⇒ 新增商品時
-- 那支 trigger 找不到表(拋棄式 PG 實跑撞到:relation "product_fitments" does not exist)。
-- 修法:執行內容與原版相同(註解精簡),只把表名與函式都寫明 schema,並 SET search_path = ''。仍是 SECURITY INVOKER(預設),權限不變。
-- 每日同步(search_path 本來就有 public)行為不變。
--
-- ══ 貼的時候 ══════════════════════════════════════════
-- · 建一支函式、改寫一支 trigger 函式(sync_product_fitments,見上),不動表 ⇒ 任何時段都可以貼。
--   後台「新增商品」那幾片(P5、P6)要等本支貼完才推。
-- · 回滾:supabase/rollbacks/20260928210000-rollback.sql(DROP FUNCTION;要先退後台碼)。已建立的手動商品留著(已下架)。
-- ═══════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.admin_audit_log 不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.staff'::regclass AND attname = 'is_active' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘失敗 — staff.is_active 不存在(在職員工檢查需要它)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.products'::regclass AND conname = 'products_supplier_external_id_key') THEN
    RAISE EXCEPTION '前置閘失敗 — products (supplier_slug, external_id) 唯一鍵不存在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.product_variants'::regclass AND conname = 'pv_spec_unique') THEN
    RAISE EXCEPTION '前置閘失敗 — product_variants (product_id, spec) 唯一鍵不存在';
  END IF;
END
$pre$;

DO $pre_fitments$
DECLARE
  v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sync_product_fitments';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '前置閘失敗 — public.sync_product_fitments() 不存在';
  END IF;
  IF v_md5 NOT IN ('1a08b86005cb6932b6a93f35986db89b', 'c1c5fc705bef6d9cd967bbbff4d607f7') THEN
    RAISE EXCEPTION '前置閘失敗 — sync_product_fitments() 的本體不是預期的那一代(md5 %),有人改過,拒絕覆蓋', v_md5;
  END IF;
END
$pre_fitments$;

CREATE OR REPLACE FUNCTION public.sync_product_fitments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  -- 先清該商品舊列(全量重建、避免部分更新漂移)
  DELETE FROM public.product_fitments WHERE product_id = NEW.id;

  -- 防禦性 unnest(逐字同 20260708130000,只補 schema)
  IF pg_catalog.jsonb_typeof(NEW.fitments) = 'array' THEN
    INSERT INTO public.product_fitments (product_id, moto_brand, model_code, year_start, year_end)
    SELECT DISTINCT
      NEW.id,
      elem->>'motoBrand',
      elem->>'modelCode',
      CASE WHEN (elem->>'yearStart') ~ '^[0-9]{4}$' THEN (elem->>'yearStart')::int ELSE NULL END,
      CASE WHEN (elem->>'yearStart') ~ '^[0-9]{4}$' AND (elem->>'yearEnd') ~ '^[0-9]{4}$' THEN (elem->>'yearEnd')::int ELSE NULL END
    FROM pg_catalog.jsonb_array_elements(NEW.fitments) AS elem
    WHERE pg_catalog.jsonb_typeof(elem) = 'object'
      AND pg_catalog.jsonb_typeof(elem->'motoBrand') = 'string'
      AND pg_catalog.jsonb_typeof(elem->'modelCode') = 'string'
      AND pg_catalog.btrim(elem->>'motoBrand') <> ''
      AND pg_catalog.btrim(elem->>'modelCode') <> '';
  END IF;

  RETURN NULL;  -- AFTER trigger、回傳值忽略
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_create_manual_product(
  p_brand_id    uuid,
  p_category_id uuid,
  p_title       text,
  p_subtitle    text,
  p_description text,
  p_variants    jsonb,
  p_actor       text,
  p_request_id  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_title       text := pg_catalog.btrim(COALESCE(p_title, ''));
  v_subtitle    text := NULLIF(pg_catalog.btrim(COALESCE(p_subtitle, '')), '');
  v_description text := NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), '');
  v_item        jsonb;
  v_sku         text;
  v_label       text;
  v_general     integer;
  v_store       integer;
  v_avail       text;
  v_skus        text[] := '{}';
  v_labels      text[] := '{}';
  v_rows        jsonb := '[]'::jsonb;
  v_n           integer;
  v_external_id text;
  v_handle      text;
  v_basis       jsonb;
  v_product_id  uuid;
  v_i           integer := 0;
BEGIN
  -- 1. 操作人與請求編號
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_create_manual_product: 缺 actor';
  END IF;
  PERFORM 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_create_manual_product: 缺 request_id';
  END IF;

  -- 2. 商品層欄位
  IF p_brand_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id) THEN
    RAISE EXCEPTION 'admin_create_manual_product: 品牌不存在';
  END IF;
  IF p_category_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = p_category_id) THEN
    RAISE EXCEPTION 'admin_create_manual_product: 分類不存在';
  END IF;
  IF v_title = '' OR pg_catalog.char_length(v_title) > 200 OR v_title ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_create_manual_product: 標題是空的、太長或含控制字元';
  END IF;
  IF v_subtitle IS NOT NULL AND (pg_catalog.char_length(v_subtitle) > 300 OR v_subtitle ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'admin_create_manual_product: 副標太長或含控制字元';
  END IF;
  IF v_description IS NOT NULL AND pg_catalog.char_length(v_description) > 5000 THEN
    RAISE EXCEPTION 'admin_create_manual_product: 說明太長';
  END IF;

  -- 3. 規格
  IF p_variants IS NULL OR pg_catalog.jsonb_typeof(p_variants) <> 'array' THEN
    RAISE EXCEPTION 'admin_create_manual_product: 規格格式不對';
  END IF;
  v_n := pg_catalog.jsonb_array_length(p_variants);
  IF v_n < 1 OR v_n > 50 THEN
    RAISE EXCEPTION 'admin_create_manual_product: 規格要 1 到 50 個';
  END IF;
  FOR v_item IN SELECT e FROM pg_catalog.jsonb_array_elements(p_variants) AS t(e) LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object'
       OR pg_catalog.jsonb_typeof(v_item -> 'sku') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_item -> 'label') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_item -> 'price_general') IS DISTINCT FROM 'number'
       OR (v_item ? 'price_store' AND pg_catalog.jsonb_typeof(v_item -> 'price_store') NOT IN ('number', 'null'))
       OR pg_catalog.jsonb_typeof(v_item -> 'availability') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'admin_create_manual_product: 規格格式不對';
    END IF;
    v_sku := pg_catalog.upper(pg_catalog.btrim(v_item ->> 'sku'));
    -- 料號規則與報價單圖庫同一套(1–64、英數字與 . _ -、至少一個英數字、不能含 ..)
    IF v_sku !~ '^[A-Z0-9._-]{1,64}$' OR v_sku !~ '[A-Z0-9]' OR pg_catalog.strpos(v_sku, '..') > 0 THEN
      RAISE EXCEPTION 'admin_create_manual_product: 料號格式不對:%', v_sku;
    END IF;
    IF v_sku = ANY (v_skus) THEN
      RAISE EXCEPTION 'admin_create_manual_product: 料號重複:%', v_sku;
    END IF;
    v_label := pg_catalog.btrim(v_item ->> 'label');
    IF v_label = '' OR pg_catalog.char_length(v_label) > 100 OR v_label ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'admin_create_manual_product: 規格名稱是空的、太長或含控制字元';
    END IF;
    IF v_label = ANY (v_labels) THEN
      RAISE EXCEPTION 'admin_create_manual_product: 規格名稱重複:%', v_label;
    END IF;
    IF (v_item ->> 'price_general') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'admin_create_manual_product: 一般價要是 0 以上的整數';
    END IF;
    v_general := (v_item ->> 'price_general')::integer;
    IF v_item ? 'price_store' AND pg_catalog.jsonb_typeof(v_item -> 'price_store') = 'number' THEN
      IF (v_item ->> 'price_store') !~ '^[0-9]{1,9}$' THEN
        RAISE EXCEPTION 'admin_create_manual_product: 經銷價要是 0 以上的整數或不填';
      END IF;
      v_store := (v_item ->> 'price_store')::integer;
    ELSE
      v_store := NULL;
    END IF;
    v_avail := v_item ->> 'availability';
    IF v_avail NOT IN ('in-stock', 'out-of-stock') THEN
      RAISE EXCEPTION 'admin_create_manual_product: 現貨狀態不對';
    END IF;
    v_skus := v_skus || v_sku;
    v_labels := v_labels || v_label;
    v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sku', v_sku, 'label', v_label, 'price_general', v_general, 'price_store', v_store, 'availability', v_avail, 'i', v_i));
    v_i := v_i + 1;
  END LOOP;

  -- 4. 撞號檢查(料號在 pcm 裡、handle 全站)
  SELECT pv.sku INTO v_sku FROM public.product_variants pv WHERE pv.supplier_slug = 'pcm' AND pv.sku = ANY (v_skus) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'admin_create_manual_product: 料號已經有商品在用:%', v_sku;
  END IF;
  v_external_id := v_skus[1];
  IF EXISTS (SELECT 1 FROM public.products p WHERE p.supplier_slug = 'pcm' AND p.external_id = v_external_id) THEN
    RAISE EXCEPTION 'admin_create_manual_product: 料號已經有商品在用:%', v_external_id;
  END IF;
  v_handle := 'pcm-' || pg_catalog.btrim(
    pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.lower(v_external_id), '[^a-z0-9_-]+', '-', 'g'), '[-_]{2,}', '-', 'g'),
    '-_');
  IF EXISTS (SELECT 1 FROM public.products p WHERE p.handle = v_handle) THEN
    RAISE EXCEPTION 'admin_create_manual_product: 網址代號已經有商品在用:%', v_handle;
  END IF;

  -- 5. 商品層價格 = 最低一般價那一款(同價取料號小的)
  SELECT r INTO v_basis
    FROM pg_catalog.jsonb_array_elements(v_rows) AS t(r)
   ORDER BY (r ->> 'price_general')::integer, (r ->> 'sku') COLLATE "C"
   LIMIT 1;

  INSERT INTO public.products (
    supplier_slug, external_id, title, subtitle, description, handle, brand_id, category_id,
    price_general, price_store, price_by_tier, availability, delisted_at, listing_set_by
  ) VALUES (
    'pcm', v_external_id, v_title, v_subtitle, v_description, v_handle, p_brand_id, p_category_id,
    (v_basis ->> 'price_general')::integer, NULL,
    -- 🔴 格式同同步(scripts/rpm-transform.ts:724、732):{ general: { amount, currency }, store: { amount, currency } }
    --    get_effective_prices 讀的是 ->'general'->>'amount'(20260925050000:183);寫成純數字它會讀成空價(P3 Codex R1 必修)。
    pg_catalog.jsonb_build_object(
      'general', pg_catalog.jsonb_build_object('amount', (v_basis ->> 'price_general')::integer, 'currency', 'TWD'),
      'store', pg_catalog.jsonb_build_object(
        'amount', COALESCE((v_basis ->> 'price_store')::integer, (v_basis ->> 'price_general')::integer), 'currency', 'TWD')),
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_rows) AS t(r) WHERE r ->> 'availability' = 'in-stock')
         THEN 'in-stock' ELSE 'out-of-stock' END,
    pg_catalog.now(), 'staff'
  )
  RETURNING id INTO v_product_id;

  INSERT INTO public.product_variants (product_id, sku, supplier_slug, spec, price_general, price_store, availability, sort_order)
  SELECT v_product_id, r ->> 'sku', 'pcm', pg_catalog.jsonb_build_object('style', r ->> 'label'),
         (r ->> 'price_general')::integer, (r ->> 'price_store')::integer, r ->> 'availability', (r ->> 'i')::integer
    FROM pg_catalog.jsonb_array_elements(v_rows) AS t(r);
  GET DIAGNOSTICS v_i = ROW_COUNT;
  IF v_i <> v_n THEN
    RAISE EXCEPTION 'admin_create_manual_product: 規格寫入筆數不符(應 % 實 %)', v_n, v_i;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'product.manual.create',
    'product:' || v_product_id::text,
    NULL,
    pg_catalog.jsonb_build_object('external_id', v_external_id, 'title', v_title, 'variant_count', v_n,
                                  'price_general', (v_basis ->> 'price_general')::integer),
    NULL,
    p_request_id,
    'admin'
  );

  RETURN pg_catalog.jsonb_build_object('product_id', v_product_id, 'external_id', v_external_id, 'handle', v_handle);
END;
$fn$;

COMMENT ON FUNCTION public.admin_create_manual_product(uuid, uuid, text, text, text, jsonb, text, text) IS
  '商品頁乙 P3(20260928210000):後台新增手動商品(supplier_slug 寫死 pcm、建立即下架)。在職員工才能用;規格 1–50 個,'
  '料號規則同報價單圖庫並轉大寫;商品層價格取最低一般價那一款;同交易寫 admin_audit_log(product.manual.create)。'
  'SECURITY DEFINER,search_path 空字串;EXECUTE 僅 service_role。';

REVOKE ALL ON FUNCTION public.admin_create_manual_product(uuid, uuid, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_manual_product(uuid, uuid, text, text, text, jsonb, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_create_manual_product(uuid, uuid, text, text, text, jsonb, text, text)']::text[];
  v_fn  oid;
BEGIN
  v_fn := pg_catalog.to_regprocedure(v_functions[1]);
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_product:函式沒有建立成功';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_create_manual_product:anon / authenticated 仍可 EXECUTE';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_create_manual_product:service_role 沒有 EXECUTE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'admin_create_manual_product:不是 SECURITY DEFINER 或 search_path 不是空字串';
  END IF;
  RAISE NOTICE '✅ admin_create_manual_product:函式在、只有 service_role 可執行、SECURITY DEFINER + search_path 空字串';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
