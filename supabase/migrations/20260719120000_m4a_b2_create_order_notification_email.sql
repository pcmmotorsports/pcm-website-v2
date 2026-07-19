-- ============================================================
-- M-4a B-2:create_order 8-param → 9-param(新增 p_notification_email)
--
-- 上位真權威:docs/specs/2026-07-18-b0-order-notification-email-prd.md §4 B-2
-- 片級 plan:docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md
-- apply 前凍結 snapshot:docs/reviews/2026-07-19-b2-preapply-snapshot.md
-- 鐵則觸發:8(schema+金流 RPC)、12(migration/schema/order/payment → 需 Codex Packet)
--
-- Sean 2026-07-19 拍板:
--   Q1=A 不合規 email 裸傳、由 B-1 CHECK 擋;RPC 內不加驗證/正規化(不新增第三份規則)
--   Q2=A database.types.ts 留 B-4 補(本片刻意不同步、非漏做)
--   Q3=A 檔內自帶 BEGIN/COMMIT + 兩簽章 DROP IF EXISTS(可重跑)
--   Q5=A 守門與 DROP 間競態窗口記為有界假設(全部 schema 變更走 db push、Sean 單人序列執行)
--
-- 🔴 為何必須 DROP+CREATE 而非 CREATE OR REPLACE(實測,非推論):
--   PG 不允許用 CREATE OR REPLACE 改參數數量 → 會產生 overload。實測 8-param 與
--   9-param(第 9 參 DEFAULT NULL)共存時,8 引數呼叫(具名與位置皆是)一律回
--   ERROR 42725 function ... is not unique → 結帳全斷。故必須 DROP 先、CREATE 後,且原子。
--
-- 🔴 為何自帶 BEGIN/COMMIT:2026-07-18 B-1 實測,migration 檔無顯式 BEGIN 時檔內
--   SET LOCAL 會噴 WARNING 25P01 且為 no-op(=無鎖保護)。自帶顯式交易同時取得
--   鎖保護與 DROP+CREATE 的原子性。⚠️ 殘餘:若 CLI 自帶外層交易,本檔 COMMIT 可能使
--   schema_migrations 寫入落到另一筆交易(schema 已改、history 未記)→ 由「兩簽章
--   DROP IF EXISTS = 整支可重跑」兜底收斂,非已驗證的原子性。Sean 明示接受(plan §3.1)。
--
-- 🔴 函式體來源與驗證(零手動轉錄):
--   權威基底 = 2026-07-19 由 prod pg_get_functiondef 取得;prosrc md5 = a60944edb678064c468ba517391cc311
--   全屬性基線指紋 = 2b898129e49d194c30ab8039b857c0be
--   本檔函式體以程式產生,並經「反向還原後 md5 等回基線」驗證 → 除下列 1 處 delta 外零位元組偏差:
--     · orders INSERT 欄位清單 + VALUES 各加一欄(notification_email / p_notification_email)
--   ⚠️ 「1 處」= **同一個 INSERT 敘述**;跑 unified diff 會看到 **2 個 hunk**(欄位清單與
--      VALUES 分屬兩段上下文),兩者皆屬同一處 delta,勿誤判為字面不符。
--   (簽章與 COMMENT 不在 prosrc 內,故 prosrc 層 delta = 1 處、檔面 = 3 處)
--   新函式體 prosrc md5 = 0bc0d256b7483c5dd6ef1f8f97b4e9a7
--
-- 驗收(詳 plan §6):三綠 / 路徑① apply 前模擬(須剔除本檔 BEGIN;COMMIT; 兩行,
--   否則內層 COMMIT 會真的提交 → prod 留痕)/ 路徑② apply 後含 PostgREST smoke。
-- rollback:見 plan §9 —— 只認 apply 前凍結副本,禁止重新拿舊 migration 當權威。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 🔴 Q5=A 緩解:令遵守同一約定的 migration 互斥(對不遵守約定的外部 DDL 無效,已誠實揭示)
SELECT pg_advisory_xact_lock(20260719120000);

-- ── 段 2.5:apply-time 基線守門(codex R3 BLOCKER-1)──────────────────
--   目的:DROP IF EXISTS 會願意輾過『任何』現況,包含別人後來改過的較新版本。
--   守門要求當下必為兩個預期狀態之一,否則中止,絕不覆寫未知版本。
--   指紋涵蓋 prosrc + 簽章 + default + secdef + proconfig + acl + owner + 回傳型別
--   + 語言 + volatility + parallel + strict + leakproof + cost + rows + COMMENT。
DO $guard$
DECLARE
  v_fp8   text;
  v_src9  text;
  v_args9 text;
  v_n8    int;
  v_n9    int;
BEGIN
  SELECT count(*) INTO v_n8 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  SELECT count(*) INTO v_n9 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');

  IF v_n8 = 1 AND v_n9 = 0 THEN
    -- 狀態 A:首次 apply。要求完整指紋 == 基線(body 相同但屬性被動過也會被擋)
    SELECT md5(
      coalesce(p.prosrc,'')                       || '|' ||
      pg_get_function_arguments(p.oid)            || '|' ||
      coalesce(pg_get_expr(p.proargdefaults,0),'')|| '|' ||
      p.prosecdef::text                           || '|' ||
      coalesce(p.proconfig::text,'')              || '|' ||
      coalesce(p.proacl::text,'')                 || '|' ||
      pg_get_userbyid(p.proowner)::text           || '|' ||
      p.prorettype::regtype::text                 || '|' ||
      l.lanname::text                             || '|' ||
      p.provolatile::text                         || '|' ||
      p.proparallel::text                         || '|' ||
      p.proisstrict::text                         || '|' ||
      p.proleakproof::text                        || '|' ||
      p.procost::text                             || '|' ||
      p.prorows::text                             || '|' ||
      coalesce(obj_description(p.oid,'pg_proc'),'')
    ) INTO v_fp8
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
     WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
    IF v_fp8 IS DISTINCT FROM '2b898129e49d194c30ab8039b857c0be' THEN
      RAISE EXCEPTION 'B-2 守門:8-param 完整指紋與基線不符(實際=%,預期=%)。現行 create_order 已被本 migration 之外的變更動過 → 中止,不覆寫未知版本。'
        , v_fp8, '2b898129e49d194c30ab8039b857c0be';
    END IF;

  ELSIF v_n9 = 1 AND v_n8 = 0 THEN
    -- 狀態 B:裂縫後重跑(schema 已建成 9-param、history 未記)。
    --   此處比對 prosrc md5 + 簽章字串(而非完整指紋):完整指紋含 ACL/COMMENT,
    --   而本 migration 接下來本就會把它們重建成 canonical 值,故不構成覆寫風險。
    --   若 prosrc 或簽章不符 → 是別人的 9-param 版本,一樣中止。
    SELECT md5(p.prosrc), pg_get_function_arguments(p.oid) INTO v_src9, v_args9
      FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
    IF v_src9 IS DISTINCT FROM '0bc0d256b7483c5dd6ef1f8f97b4e9a7' THEN
      RAISE EXCEPTION 'B-2 守門:既存 9-param 的 prosrc md5 與本檔預期產出不符(實際=%,預期=%)→ 非本 migration 所建,中止。', v_src9, '0bc0d256b7483c5dd6ef1f8f97b4e9a7';
    END IF;
    IF v_args9 IS DISTINCT FROM 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text DEFAULT NULL::text' THEN
      RAISE EXCEPTION 'B-2 守門:既存 9-param 簽章與預期不符(實際=%)→ 中止。', v_args9;
    END IF;

  ELSE
    RAISE EXCEPTION 'B-2 守門:create_order 現況非預期狀態(8-param 數=%,9-param 數=%)。預期為「僅 8-param」或「僅 9-param」→ 中止,交人工判斷。', v_n8, v_n9;
  END IF;
END
$guard$;

-- ── DROP:兩簽章皆 IF EXISTS = 整支可重跑(正確性由上方守門保證,非靠 IF EXISTS)──
DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text);

-- ── CREATE 9-param(屬性全部顯式寫出,不倚賴 PG 預設值日後不變)──
CREATE FUNCTION public.create_order(
  p_lines              jsonb,
  p_address_id         uuid,
  p_shipping_method    text,
  p_invoice            jsonb,
  p_cart_session_id    uuid,
  p_terms_version      text,
  p_client_ip          text,
  p_client_ua          text,
  p_notification_email text DEFAULT NULL   -- 🔴 B-2 過渡期 DEFAULT;B-6 移除
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
PARALLEL UNSAFE
COST 100
SET search_path = ''
AS $fn$
DECLARE
  v_uid            uuid := (select auth.uid());
  v_addr           record;
  v_line           jsonb;
  v_variant        record;
  v_qty            integer;
  v_variant_id     uuid;
  v_supplier_slug  text;
  v_sku            text;
  v_unit_price     integer;
  v_line_total     bigint;
  v_subtotal       bigint := 0;
  v_shipping_fee   integer;
  v_total          bigint;
  v_seen_variants  uuid[] := '{}';
  v_items          jsonb := '[]'::jsonb;
  v_invoice        jsonb;
  v_addr_snapshot  jsonb;
  v_display_id     text;
  v_seq_text       text;
  v_order_id       uuid;
  -- 🔴 V-3a delta:vehicle 白名單重組工作變數(其餘 DECLARE 逐字同 20260630120000)
  v_veh            jsonb;
  v_veh_ok         boolean;
  v_veh_year       integer;
  v_vehicle        jsonb;
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 0b. 🔴 #241 同意條款 guard(create_order 路徑「無 consent 不生 order」;codex H4 空字串、B2 限縮為本路徑)──
  IF p_terms_version IS NULL OR pg_catalog.btrim(p_terms_version) = '' THEN
    RAISE EXCEPTION 'create_order: 缺同意條款版本(consent)';
  END IF;

  -- ── 1. 身分 + customer profile(fail-closed)──
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_order: 未登入(auth.uid NULL)';
  END IF;
  PERFORM 1 FROM public.customers WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 查無 customer profile(uid=%)', v_uid;
  END IF;

  -- ── 2. 地址歸屬(必為本人、否則 raise;快照凍結履約地址)──
  SELECT id, name, phone, line
    INTO v_addr
    FROM public.customer_addresses
   WHERE id = p_address_id AND customer_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 地址非本人或不存在(address_id=%)', p_address_id;
  END IF;
  v_addr_snapshot := pg_catalog.jsonb_build_object(
    'name', v_addr.name, 'phone', coalesce(v_addr.phone, ''), 'line', v_addr.line
  );

  -- ── 3. 配送方式白名單(home/store)──
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'create_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;

  -- ── 4. 發票類型 ──
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'type') IS NULL OR (p_invoice->>'type') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'create_order: 發票類型非法或缺失(%)', p_invoice->>'type';
  END IF;
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       p_invoice->>'type',
    'carrier',    p_invoice->>'carrier',
    'title',      p_invoice->>'title',
    'taxId',      p_invoice->>'taxId',
    'donateCode', p_invoice->>'donateCode'
  ));

  -- ── 5. 購物車非空 + 品項數上限 ──
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'create_order: 購物車為空';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'create_order: 購物車品項超過上限(200)';
  END IF;

  -- ── 6. 逐 line ──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(p_lines) AS e
  LOOP
    v_qty := (v_line->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 10000 THEN
      RAISE EXCEPTION 'create_order: 數量非法或超過上限 1-10000(qty=%)', v_line->>'qty';
    END IF;

    v_variant_id    := nullif(v_line->>'variant_id', '')::uuid;
    v_supplier_slug := v_line->>'supplier_slug';
    v_sku           := v_line->>'sku';

    IF v_variant_id IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.supplier_slug = v_supplier_slug AND pv.sku = v_sku;
    ELSE
      RAISE EXCEPTION 'create_order: line 缺 variant_id 或 (supplier_slug,sku)';
    END IF;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'create_order: 找不到 variant(variant_id=%, supplier_slug=%, sku=%)', v_variant_id, v_supplier_slug, v_sku;
    END IF;

    IF v_variant.id = ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'create_order: 重複 variant(%);同變體應合併 qty', v_variant.id;
    END IF;
    v_seen_variants := v_seen_variants || v_variant.id;

    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
    END IF;

    v_unit_price := v_variant.price_general;
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
    END IF;

    IF pg_catalog.jsonb_typeof(v_variant.spec) <> 'object'
       OR NOT public.m3_jsonb_values_all_string(v_variant.spec)
       OR (v_variant.spec ?| array['price_store','price_by_tier','cost']) THEN
      RAISE EXCEPTION 'create_order: variant spec 非法(非 object/含非字串值/含敏感鍵)(variant=%)', v_variant.id;
    END IF;

    v_line_total := v_unit_price::bigint * v_qty;
    IF v_line_total > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 單筆金額溢位(variant=%, line_total=%)', v_variant.id, v_line_total;
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 訂單小計溢位(subtotal=%)', v_subtotal;
    END IF;

    -- ── 6v. 🔴 V-3a delta:optional vehicle 白名單重組(鏡像 §4 p_invoice 手法;禁 v_line->'vehicle' 直存)──
    --   逐 kind 隔離(verdict REQUIRED-3):dict 只收 brand/model/year/source(不收 raw)、
    --   free 只收 raw/year/source(不收 brand/model);非空 text ≤200;year=JSON number 4 位整數
    --   1900-2100(regex 先驗防 ::integer 溢位 RAISE)。任何不合 → 該 line v_vehicle=NULL、
    --   不 RAISE 不擋單(選填;與 @pcm/schemas .catch(undefined) 同構)。車種鐵律:零正規化、字面凍結。
    v_vehicle := NULL;
    v_veh := v_line->'vehicle';
    IF v_veh IS NOT NULL AND pg_catalog.jsonb_typeof(v_veh) = 'object' THEN
      v_veh_ok := true;
      v_veh_year := NULL;
      IF v_veh ? 'year' THEN
        -- 🔴 cast 與驗證分離(reviewer Important):::integer 只在 regex 4 位通過「之後」的獨立
        --   statement 執行=可證明無溢位 RAISE(不依賴 AND 短路順序=PG 官方不保證求值順序);
        --   typeof/regex 本身無異常面(->> 回 text/NULL、NULL~pattern=NULL)。
        IF pg_catalog.jsonb_typeof(v_veh->'year') = 'number'
           AND (v_veh->>'year') ~ '^[0-9]{4}$' THEN
          v_veh_year := (v_veh->>'year')::integer; -- regex 已限 4 位、cast 恆安全
          IF v_veh_year < 1900 OR v_veh_year > 2100 THEN
            v_veh_ok := false; -- 超界=整顆作廢(兩層同構;非法不擋單)
          END IF;
        ELSE
          v_veh_ok := false; -- year 形狀不合=整顆作廢(兩層同構;非法不擋單)
        END IF;
      END IF;
      IF v_veh_ok AND v_veh->>'kind' = 'dict' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'brand') = 'string'
           AND pg_catalog.jsonb_typeof(v_veh->'model') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'brand'), '') <> '' AND pg_catalog.length(v_veh->>'brand') <= 200
           AND coalesce(pg_catalog.btrim(v_veh->>'model'), '') <> '' AND pg_catalog.length(v_veh->>'model') <= 200
           AND (v_veh->>'source') IN ('search', 'garage', 'picker') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'dict', 'brand', v_veh->>'brand', 'model', v_veh->>'model',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      ELSIF v_veh_ok AND v_veh->>'kind' = 'free' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'raw') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'raw'), '') <> '' AND pg_catalog.length(v_veh->>'raw') <= 200
           AND (v_veh->>'source') IN ('garage', 'freetext') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'free', 'raw', v_veh->>'raw',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      END IF;
    END IF;

    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id',       v_variant.id,
      'variant_sku',      v_variant.sku,
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec),
      'quantity',         v_qty,
      'unit_price',       v_unit_price,
      'line_total',       v_line_total,
      'availability_at_checkout',
        CASE WHEN v_variant.variant_availability = 'in-stock'
              AND v_variant.product_availability = 'in-stock'
             THEN 'in-stock' ELSE 'out-of-stock' END,
      -- 🔴 V-3a delta:白名單重組後快照(NULL → JSON null → §9 NULLIF 轉回 SQL NULL)
      'vehicle',          v_vehicle
    );
  END LOOP;

  -- ── 7. 運費 ──
  IF p_shipping_method = 'store' THEN
    v_shipping_fee := 0;
  ELSE
    v_shipping_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END;
  END IF;
  v_total := v_subtotal + v_shipping_fee;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 訂單總額溢位(total=%)', v_total;
  END IF;

  -- ── 8. 產號 + 寫 order ──
  v_seq_text := pg_catalog.nextval('public.order_display_seq')::text;
  v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
                  CASE WHEN pg_catalog.length(v_seq_text) < 4 THEN pg_catalog.lpad(v_seq_text, 4, '0') ELSE v_seq_text END;

  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id,
    notification_email
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
    p_notification_email
  )
  RETURNING id INTO v_order_id;

  -- ── 8b. 🔴 #241 同 transaction 原子寫同意紀錄(Gemini 否決拆 RPC 的幽靈訂單;create_order 路徑無 consent 不生 order)──
  --    IP/UA left() 截斷(codex M8;NULL 輸入 left 回 NULL、容忍 best-effort 缺值)。
  INSERT INTO public.order_legal_consents (order_id, terms_version, consented_at, client_ip, client_user_agent)
  VALUES (v_order_id, p_terms_version, pg_catalog.now(),
          pg_catalog.left(p_client_ip, 128), pg_catalog.left(p_client_ua, 1024));

  -- ── 9. 寫 items(V-3a delta:多寫 vehicle_snapshot;NULLIF 把 JSON null 轉回 SQL NULL)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total, availability_at_checkout, vehicle_snapshot
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer,
      v_line->>'availability_at_checkout',
      NULLIF(v_line->'vehicle', 'null'::jsonb)
    );
  END LOOP;

  -- ── 10. return DTO ──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;

-- ── ACL 鏡像重建(DROP 後權限歸零;🔴 實測 Supabase 對新函式預設 GRANT 給
--    PUBLIC + anon + authenticated + service_role,anon 可執行 → 必須全部 REVOKE)──
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) TO authenticated;
-- 🔴 SECURITY DEFINER 的執行身分 = owner;實測 db push 以 postgres 連線,本行為保險
ALTER FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) OWNER TO postgres;

COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) IS
  'M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄 + M-4a V-3a vehicle_snapshot + M-4a B-2 notification_email(9-param)。client 送 variant+qty+address+method+cart_session_id+invoice,每 line 可帶 optional vehicle(白名單重組逐 kind 隔離、非法=NULL 不擋單、字面凍結零猜),永不送價/tier;server 注入 terms_version + best-effort client_ip/ua。notification_email 由 app 層送入(canonical 化由 B-3 的 app 層鏡像規則保證,**RPC 本身不驗不正規化**);⚠️ B-2 當下無任何呼叫端送第 9 參(TS 仍 8 參,B-4 才接)。p_notification_email 為 B-2 過渡期 DEFAULT NULL(必填收緊=B-6 移除 DEFAULT);RPC 內不做任何 email 正規化或驗證(Sean 07-19 拍 Q1=A:規則只留 DB CHECK 與 B-3 app 層鏡像兩份,不新增第三份),不合規值由 orders_notification_email_valid CHECK 擋下、整筆回滾。其餘 executable 逐字同 20260716200000(prosrc 僅 1 處 delta=orders INSERT 欄位與 VALUES);return 只 {order_id,display_id}。';

-- 🔴 codex R1 #1:不只依賴 pgrst_ddl_watch / pgrst_drop_watch,顯式再送一次。
--    NOTIFY 於 COMMIT 才送達 → 快取在新函式可見之後才重載,順序天然正確。
NOTIFY pgrst, 'reload schema';

-- ── fail-closed 斷言矩陣 ───────────────────────────────────────────
DO $assert$
DECLARE
  v_n8 int; v_sigs int; v_acl text; v_owner text; v_args text; v_def text;
  v_secdef boolean; v_cfg text; v_ret text; v_lang text; v_vol text; v_par text;
  v_strict boolean; v_leak boolean; v_cost real; v_rows real;
  v_retset boolean; v_support text;
  v_nargs int; v_ndef int; v_names text; v_cmt_md5 text; v_cmt_len int; v_src text;
  v_seclabel int; v_shseclabel int;
BEGIN
  SELECT count(*) INTO v_n8 FROM pg_proc WHERE oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  IF v_n8 <> 0 THEN RAISE EXCEPTION '斷言②失敗:舊 8-param 仍存在(=overload 風險)'; END IF;

  -- 🔴 斷言①:public.create_order 的**簽章總數**必須恰為 1。
  --    只驗「8-param 不在 + 9-param 在」不夠 —— 若另有型別相異的第三個 overload
  --    (例如末參 varchar),上面兩查都看不見,apply 後 8 引數呼叫會撞 42725
  --    is not unique = 結帳全斷(plan E4 實測過的災難模式)。
  SELECT count(*) INTO v_sigs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION '斷言①失敗:public.create_order 簽章總數=%(必須恰為 1;>1 即 overload 歧義風險)', v_sigs;
  END IF;

  SELECT p.prosecdef, coalesce(p.proconfig::text,''), pg_get_userbyid(p.proowner)::text,
         p.prorettype::regtype::text, l.lanname::text, p.provolatile::text, p.proparallel::text,
         p.proisstrict, p.proleakproof, p.procost, p.prorows,
         p.proretset, p.prosupport::text,
         p.pronargs, p.pronargdefaults, p.proargnames::text,
         pg_get_function_arguments(p.oid), coalesce(pg_get_expr(p.proargdefaults,0),''),
         coalesce(p.proacl::text,''), md5(obj_description(p.oid,'pg_proc')),
         length(obj_description(p.oid,'pg_proc')), md5(p.prosrc)
    INTO v_secdef, v_cfg, v_owner, v_ret, v_lang, v_vol, v_par, v_strict, v_leak, v_cost,
         v_rows, v_retset, v_support, v_nargs, v_ndef, v_names, v_args, v_def, v_acl,
         v_cmt_md5, v_cmt_len, v_src
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
  IF NOT FOUND THEN RAISE EXCEPTION '斷言①失敗:9-param create_order 不存在'; END IF;

  IF NOT v_secdef THEN RAISE EXCEPTION '斷言⑤失敗:prosecdef 非 true'; END IF;
  IF v_cfg <> '{"search_path=\"\""}' THEN
    RAISE EXCEPTION '斷言⑤失敗:proconfig 非預期(實際=%)', v_cfg; END IF;
  IF v_owner <> 'postgres' THEN RAISE EXCEPTION '斷言⑤失敗:owner=%(SECURITY DEFINER 執行身分)', v_owner; END IF;
  IF v_ret <> 'jsonb' THEN RAISE EXCEPTION '斷言⑤失敗:回傳型別=%', v_ret; END IF;
  IF v_lang <> 'plpgsql' THEN RAISE EXCEPTION '斷言⑤失敗:語言=%', v_lang; END IF;
  IF v_vol <> 'v' THEN RAISE EXCEPTION '斷言⑤失敗:volatility=%', v_vol; END IF;
  IF v_par <> 'u' THEN RAISE EXCEPTION '斷言⑤失敗:parallel=%', v_par; END IF;
  IF v_strict THEN RAISE EXCEPTION '斷言⑤失敗:proisstrict 非 false'; END IF;
  IF v_leak THEN RAISE EXCEPTION '斷言⑤失敗:proleakproof 非 false'; END IF;
  IF v_cost <> 100 THEN RAISE EXCEPTION '斷言⑤失敗:cost=%', v_cost; END IF;
  IF v_rows <> 0 THEN RAISE EXCEPTION '斷言⑤失敗:rows=%', v_rows; END IF;
  IF v_retset THEN RAISE EXCEPTION '斷言⑤失敗:proretset 非 false(應為純量回傳)'; END IF;
  IF v_support <> '-' THEN RAISE EXCEPTION '斷言⑤失敗:prosupport=%(基線為無)', v_support; END IF;

  -- 斷言⑦:第 9 參契約 —— 精確等值,禁 substring
  IF v_nargs <> 9 THEN RAISE EXCEPTION '斷言⑦失敗:參數數=%', v_nargs; END IF;
  IF v_ndef <> 1 THEN RAISE EXCEPTION '斷言⑦失敗:default 數=%', v_ndef; END IF;
  IF v_args <> 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text DEFAULT NULL::text' THEN
    RAISE EXCEPTION '斷言⑦失敗:簽章字串不符(實際=%)', v_args; END IF;
  -- 🔴 實測:PG 把 DEFAULT NULL 正規化為 NULL::text(非裸 NULL),照直覺寫會失敗
  IF v_def <> 'NULL::text' THEN
    RAISE EXCEPTION '斷言⑦失敗:default expression=%(預期 NULL::text)', v_def; END IF;
  IF v_names <> '{p_lines,p_address_id,p_shipping_method,p_invoice,p_cart_session_id,p_terms_version,p_client_ip,p_client_ua,p_notification_email}' THEN
    RAISE EXCEPTION '斷言⑦失敗:proargnames=%', v_names; END IF;

  -- 斷言③④:ACL 六角色矩陣 + proacl 字面
  IF v_acl <> '{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION '斷言④失敗:proacl=%', v_acl; END IF;
  IF NOT has_function_privilege('authenticated','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:authenticated 無 EXECUTE(結帳會全斷)'; END IF;
  IF has_function_privilege('anon','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:anon 可執行(未登入者可建單)'; END IF;
  IF has_function_privilege('service_role','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:service_role 可執行'; END IF;
  IF has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:payment_confirmer 可執行'; END IF;
  IF has_function_privilege('authenticator','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:authenticator 可執行'; END IF;
  IF has_function_privilege('public','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:PUBLIC 可執行'; END IF;

  -- 斷言⑥:COMMENT 已重建且為實質內容。
  --   🔴 刻意**不**驗 md5:COMMENT 就寫在本檔上方 3 個語句處,寫死其 md5 = 自指字面
  --   (改一個字就得同步改 md5,正是本專案反覆踩過的坑)。改以「非空 + 長度下限」
  --   證明它不是空字串或佔位符;逐字內容由 plan §6-B 第 4 項對照**本檔上方的
  --   COMMENT ON FUNCTION 語句字面**覆核(⚠️ 不是對照 snapshot —— snapshot 凍的是
  --   8-param 的舊 COMMENT,與本檔的 9-param 版本本就不同)。
  --   🔴 上一行 md5 IS NULL 檢查是承重的:若只留長度檢查,COMMENT 為 NULL 時
  --   NULL < 400 求值為 NULL 會靜默放行。日後勿「簡化」掉。
  IF v_cmt_md5 IS NULL THEN RAISE EXCEPTION '斷言⑥失敗:COMMENT 為空(DROP 後未重建)'; END IF;
  IF v_cmt_len < 400 THEN RAISE EXCEPTION '斷言⑥失敗:COMMENT 長度=%(疑為佔位符)', v_cmt_len; END IF;

  -- 斷言:函式體 = 已驗證產出(除 1 處 delta 外與 prod 基線零偏差)
  IF v_src <> '0bc0d256b7483c5dd6ef1f8f97b4e9a7' THEN
    RAISE EXCEPTION '斷言失敗:prosrc md5=%(預期=%)', v_src, '0bc0d256b7483c5dd6ef1f8f97b4e9a7'; END IF;

  SELECT count(*) INTO v_seclabel FROM pg_seclabel
   WHERE objoid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)')::oid;
  SELECT count(*) INTO v_shseclabel FROM pg_shseclabel
   WHERE objoid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)')::oid;
  IF v_seclabel <> 0 OR v_shseclabel <> 0 THEN
    RAISE EXCEPTION '斷言⑤失敗:seclabel=%,shseclabel=%(基線皆 0)', v_seclabel, v_shseclabel; END IF;

  RAISE NOTICE 'B-2 斷言矩陣全數通過(9-param / ACL / 全屬性 / 簽章 / prosrc)';
END
$assert$;

COMMIT;
