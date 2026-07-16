-- ============================================================
-- M-4a V-3a(RPC 層):create_order — p_lines 每 line optional vehicle 白名單重組 → order_items.vehicle_snapshot
-- ============================================================
-- 真權威:docs/specs/2026-07-15-order-item-vehicle-capture-design.md v0.2 §3/§8 +
--   review-inbox m4a-v3-plan.verdict.md(Fable 關卡1;MUST-FIX=基底 20260630120000、REQUIRED 1-4、裁示 2=照 M-3 慣例)。
-- 鐵則 8+12 全套(動核心建單金流 RPC):值班台獨立交易模擬 + Codex 盲審 + Fable 對抗審不降級;
--   migration 不 apply、code commit 壓住,Sean db push(20260716180000 → 本檔依序)→ 值班台驗 → 才放行 git push。
-- 依賴:20260716180000(order_items.vehicle_snapshot 欄,本檔 INSERT 寫入、**必先 apply**)、
--   20260630120000(#241 8-param=zero-regression 基底;**2026-07-16 live 驗證**:pg_get_functiondef
--   md5(prosrc)=f1ee05bf8ba79260d0a64722fd70d5ae 與該檔 $fn$ body byte-identical〔8336 bytes〕、
--   live 僅此一版無 hotfix 漂移=verdict MUST-FIX 第 2 步完成)。
--
-- 🔴 設計(plan §V-3a + verdict REQUIRED 3):
--   ① 簽名不變(仍 8-param;vehicle 藏在 p_lines 每 line 的 optional `vehicle` object)→ 無新舊 overload 問題。
--   ② 每 line 白名單重組(鏡像 p_invoice L153-159 手法;**禁 p_line->'vehicle' 直存**=防任意欄/注入):
--      kind ∈ {'dict','free'} 逐 kind 隔離 —— dict 只收 brand/model/year/source(**不收 raw**)、
--      free 只收 raw/year/source(**不收 brand/model**);source 白名單同 V-2a CartItemVehicle
--      (dict:search/garage/picker、free:garage/freetext);brand/model/raw=非空 text 且 ≤200;
--      year=JSON number、4 位整數、1900-2100(防 ::integer 溢位 RAISE 擋單)。
--      **任何一項不合=該 line vehicle 整顆 NULL、不 RAISE 不擋單**(選填、§2「不填不擋結帳」;
--      與 @pcm/schemas PlaceOrderVehicleInput `.catch(undefined)` 兩層同構=REQUIRED-4)。
--   ③ 🔴 車種鐵律:RPC 零正規化/零比對/零猜,通過白名單即字面凍結原樣存。
--   ④ 🔴 零金流語意變更:vehicle 純 metadata,不進取價/qty/變體解析/運費/溢位任何路徑;
--      executable logic 對 20260630120000 byte-identical + 四處 delta(DECLARE 4 變數 / 迴圈內
--      vehicle 白名單段 / v_items 多帶 vehicle / §9 INSERT 多寫 vehicle_snapshot)。
--      不帶 vehicle 的 p_lines:v_vehicle 恆 NULL → vehicle_snapshot=NULL,其餘行為 byte 級不變。
--   ⑤ 行內 rationale 註解精簡(取價/防撞/IDOR/溢位/快照/權限矩陣說明完整見 20260614130000/20260630120000)。
--
-- 🔴 無顯式 BEGIN;/COMMIT;(supabase CLI ExecBatch 隱式交易)。
-- **尚未 apply(等 Sean db push;20260716180000 → 本檔依序、同批)。**
-- ============================================================

-- ── 1. create_order:CREATE OR REPLACE(簽名不變 8-param;基底 20260630120000 + vehicle 四 delta)──
CREATE OR REPLACE FUNCTION public.create_order(
  p_lines           jsonb,
  p_address_id      uuid,
  p_shipping_method text,
  p_invoice         jsonb,
  p_cart_session_id uuid,
  p_terms_version   text,    -- 🔴 #241 server 注入(CURRENT_TERMS_VERSION);NULL/空 → RAISE(create_order 路徑無 consent 不生 order)
  p_client_ip       text,    -- 🔴 #241 best-effort PII(可 NULL);左截 128
  p_client_ua       text     -- 🔴 #241 best-effort PII(可 NULL);左截 1024
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id
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
COMMENT ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text) IS
  'M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄(8-param)+ M-4a V-3a vehicle_snapshot。client 送 variant+qty+address+method+invoice+cart_session_id、每 line 可帶 optional vehicle(給哪台車用;白名單重組逐 kind 隔離、非法=NULL 不擋單、字面凍結零猜)、永不送價/tier;server 注入 terms_version(CURRENT_TERMS_VERSION)+ best-effort client_ip/ua。p_terms_version NULL/空 fail-closed;同 transaction 原子 INSERT order_legal_consents(IP/UA left 截斷)。其餘(取價/防撞/IDOR/溢位/快照/運費)executable 逐字同 20260630120000(行內 rationale 註解精簡、完整見 20260614130000);return 只 {order_id,display_id}。';

-- ── 2. 權限(簽名不變;冪等重申 8-param 唯 authenticated)──
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text) TO authenticated;

-- ── 3. fail-closed assert(擋 db push;ACL 與 20260630120000 全等 + 基底防護哨兵 + 欄依賴)──
DO $$
DECLARE
  v_src text;
BEGIN
  -- 3a. 欄依賴:20260716180000 必先 apply(否則 §9 INSERT 執行期炸=後台整批單掛)。
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'vehicle_snapshot'
  ) THEN
    RAISE EXCEPTION 'order_items.vehicle_snapshot 欄缺失 — 20260716180000 未先 apply;拒繼續';
  END IF;

  -- 3b. ACL 全等 20260630120000:8-param 唯 authenticated。
  IF NOT has_function_privilege('authenticated', 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon',             'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role',     'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_order 8-param EXECUTE 權限矩陣異常 — 應唯 authenticated;拒繼續';
  END IF;

  -- 3c. 舊 overload 仍不存在(N9 回歸;本檔簽名不變、不應出現任何新舊分身)。
  IF to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'create_order 舊 5-param 重現 — 繞 consent 後門;拒繼續';
  END IF;
  IF to_regprocedure('public.create_order(jsonb,uuid,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'create_order 舊 4-param 重現 — 繞 cross-tab dedup + consent 後門;拒繼續';
  END IF;

  -- 3d. 基底防護哨兵(prosrc 文字探針;防「從舊版字面改起=靜默回滾金流防護」= verdict MUST-FIX 向量):
  --     0 缺 cart_session_id(3DS-0b 雙扣防護)/ 0b 缺同意條款(#241)/ availability 快照(#214a)/
  --     spec 敏感鍵閘(價格零洩漏)/ vehicle_snapshot(本檔 delta 已進)。行為級驗證=值班台獨立交易模擬。
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF position('缺 cart_session_id' in v_src) = 0 THEN
    RAISE EXCEPTION 'create_order 基底防護缺失:3DS-0b cart_session_id guard 不在(雙扣防護回滾?);拒繼續';
  END IF;
  IF position('缺同意條款版本' in v_src) = 0 THEN
    RAISE EXCEPTION 'create_order 基底防護缺失:#241 consent guard 不在;拒繼續';
  END IF;
  IF position('availability_at_checkout' in v_src) = 0 THEN
    RAISE EXCEPTION 'create_order 基底防護缺失:#214a availability 快照不在;拒繼續';
  END IF;
  IF position('price_store' in v_src) = 0 THEN
    RAISE EXCEPTION 'create_order 基底防護缺失:spec 敏感鍵閘不在(經銷價洩漏面);拒繼續';
  END IF;
  IF position('vehicle_snapshot' in v_src) = 0 THEN
    RAISE EXCEPTION 'create_order V-3a delta 未進(vehicle_snapshot 寫入缺);拒繼續';
  END IF;

  -- 3e. begin_charge_attempt ACL 回歸(唯 payment_confirmer;同 20260630120000)。
  IF NOT has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'begin_charge_attempt EXECUTE 權限矩陣異常;拒繼續';
  END IF;
END
$$;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、手動執行):
--   -- 還原 20260630120000 版 create_order(手動貼該檔 §3 create_order 全文 CREATE OR REPLACE
--   --   + §5 REVOKE/GRANT;簽名同 8-param、直接 REPLACE 即可,無 overload 清理)。
--   -- vehicle_snapshot 欄回滾見 20260716180000 檔尾(先還原本檔、再 DROP 欄,順序不可反)。
-- ============================================================

-- ============================================================
-- 值班台獨立交易模擬斷言清單(diff 審時 MCP execute_sql BEGIN→ROLLBACK 親跑;verdict Diff 審預告):
-- 1. 兩檔逐字套用(20260716180000 → 本檔)後:欄+CHECK+函式 replace 成功、DO 斷言全過。
-- 2. 行為:帶 dict vehicle 建單 → vehicle_snapshot 白名單欄逐鍵相等;帶 free 同;不帶=NULL;
--    壞形狀(kind 亂值/brand 空/raw 空/year 非 4 位或字串/source 非白名單/多餘欄)→ 單建成、
--    vehicle_snapshot=NULL、多餘欄不存在(禁直存證明)。
-- 3. 🔴 零回歸:不帶 vehicle 的 p_lines → orders/order_items 各欄(金額/快照/consent/dedup)
--    與 20260630120000 版行為 byte 級一致;RAISE 路徑(空車/重複變體/溢位/缺 consent)全不變。
-- 4. ACL:aclexplode 全 allowlist 斷言(anon/authenticated/service_role/payment_confirmer 對
--    create_order 與前版全等)。
-- 5. ROLLBACK 後零留痕。
-- ============================================================
