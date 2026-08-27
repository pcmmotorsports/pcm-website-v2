-- ============================================================
-- 0 元贈品可以結帳 —— 而「整車全 0」要擋在建單前
--
-- 兩個改動, 同一支函式:
--   ① 段 6 單價閘  `v_unit_price <= 0`  →  `< 0`
--      (`IS NULL` 那半一個字不動 —— 它擋「查不到價格」, 與「0 元」是兩件事)
--   ② 段 7 新增閘  `v_total <= 0` ⇒ RAISE
--      成因:0 元贈品放行之後,「只有贈品 + 門市取貨」⇒ subtotal 0 + 運費 0 ⇒ **total 0**
--
-- 拍板:Sean 2026-08-25
--   ·「乙:會, 偶爾有」⇒ 0 元商品(贈品 / 買一送一的那個「送」/ 試用品)是合法價格
--   ·「甲:修結帳那道閘的時候順手加一道『整車金額要大於 0』」
--   落點 memory `project_0825-sean-zero-price-is-real-print-ntd-zero`
--
-- 這是【上架 → 結帳 → 顯示】三道裡的第二道:
--   ① 上架 `sync_product_variant_group`  ⇒ `20260825120000_m4b_zero_price_allowed_in_variant_sync.sql`
--      🔴 而上架其實有【兩道】閘 —— `scripts/rpm-delta.ts:74` 的 `isAbnormal()` 仍把 0 判為異常,
--         `scripts/rpm-import.ts` 會在呼叫 RPC 之前先 throw。**那一片未做。**
--   ② 結帳 `create_order`                ⇒ **本檔**
--   ③ 顯示 storefront `Price.tsx`        ⇒ 已於 `0ed3cf16` 做完
--   ⇒ ①的第二道還在 ⇒ **贈品仍然上不了架。本檔不會改變那件事。**
--
-- 🔴 本檔的函式體是【用程式從 `20260730120100` 第 181 行起取出來替換的, 不是手打】;
--   difflib 機械比對 ⇒ 非目標行差異 0(負對照:原檔跟自己比 = 0)。
--
-- 🔴 為什麼要自帶字面斷言(段 3):
--   `20260730120100` 檔尾那五條「既有行為必須還在」的字面守門, 住在**它自己的 DO $$** 裡
--   ⇒ 那支 migration 已經 apply 過、不會重跑 ⇒ **它們對本檔這一版零覆蓋**。
--   而 `scripts/n3b-verbatim-check.py:42/43` 比對的是**兩支寫死的 migration 檔**,不是現行函式
--   ⇒ 出現第三版之後它**不會紅, 而它從此不再覆蓋現行版本** —— 沒有任何訊號。
--   ⇒ 所以本檔把那五條抄過來, 再加兩條【證明本檔改動確實生效】的雙向斷言。
--   ⚠️ 那支 `n3b-verbatim-check.py` 的失效**本檔不修**(它是 N3b 那條線的守門)。已回報開條目。
--
-- Rollback(forward-only):
--   🔴 **不要改本檔再 apply** —— 已 apply 過的 migration 不會重跑, 只會讓檔案與 DB 不一致而**零訊號**。
--   ⇒ 新開一支【新 timestamp】的 migration, 把兩處寫回 `<= 0` 並移除 total 閘。
--   ⚠️ 不要 `DROP FUNCTION` —— 那會連同 `20260730120100` 建的那支一起刪掉, 結帳會整條斷。
--   📌 本檔無資料異動、無新物件;而 `CREATE OR REPLACE FUNCTION` 本身就是 DDL。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 段 1:前置閘 —— 🔴 這一段是【本檔實跑之後才補上的】, 而它的成因值得留著 ──────
--
--   本檔第一版**沒有**這段。在拋棄式庫上實跑時我量到:
--     `20260730120100`(N3b)自己 apply **失敗**(rc=3,因為 N3a 沒到位、產號器不存在),
--     🔴 **而本檔照樣 rc=0** —— 因為 plpgsql 是**晚綁定**的:函式體裡引用一支不存在的函式,
--        `CREATE OR REPLACE` 一樣會過, 我的字面斷言也一樣全綠(它們查的是 `prosrc` 文字)。
--   ⇒ **「apply 成功」與「這支函式跑得動」是兩個宣稱, 而本檔的斷言只證明得了前者。**
--   ⇒ 所以把 N3b 的前置閘逐字帶過來:本檔重下的是**整支 654 行**, 它繼承的依賴一個都沒少。
DO $$
BEGIN
  IF to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN
    RAISE EXCEPTION '0 元閘前置失敗 — public.pcm_generate_display_id() 不存在。'
                    ' 請先套用 20260730120000(N3a);db push 應會自動依版本號排序';
  END IF;
  -- 🔴 `IS DISTINCT FROM true` 是承重的, 不是囉唆(codex R1 must-fix):
  --   產號器若回 `NULL`, `NULL !~ regex` 的結果是 **NULL 不是 true**
  --   ⇒ 寫成 `IF x !~ … THEN` 的話這個 IF **不成立 ⇒ 直接放行** ⇒ 前置閘假綠。
  --   ⚠️ 這個寫法是從 `20260730120100` 逐字抄來的 ⇒ **那一支也有同一個洞**(本片不改它)。
  IF (public.pcm_generate_display_id() ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$') IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0 元閘前置失敗 — pcm_generate_display_id() 的產出不符 §5.4a 合約(NULL 也算不符)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname  = 'orders_display_id_format'
       AND pg_get_constraintdef(oid) LIKE '%[23456789BCDFGHJKMNPQRSTVWXYZ]{6}%'
  ) THEN
    RAISE EXCEPTION '0 元閘前置失敗 — orders_display_id_format 沒有接受新 6 碼格式的分支。'
                    ' 請先套用 20260729010000(D0);否則本片 apply 會全綠、'
                    ' 但第一筆真結帳會死在 check_violation(不重試、對客一般失敗)';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.create_order(
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
CALLED ON NULL INPUT
NOT LEAKPROOF
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
  -- N3b delta:v_seq_text 移除(不再用序號產號);新增有界重試所需兩個變數。
  v_attempt        integer;
  v_cname          text;
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
    -- 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的那個
    --   「送」/ 試用品)⇒ 這道閘原本把贈品判成「無有效價格」而擋在結帳。
    --   ⚠️ **`IS NULL` 那半一個字都沒動** —— 它擋的是「查不到價格」, 與「0 元」是兩件事。
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
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
  -- 🔴🔴 2026-08-25 新閘:整車金額為 0 ⇒ 擋在建單前(Sean 拍甲「順手加一道」)。
  --
  --   **這【不是】一條「訂單金額必須大於 0」的商業規則。** 它說的是一件工程事實:
  --   一張 total = 0 的單, **目前沒有一條路付得掉它** —— 刷卡腿與付款帳本都拒 0。
  --   ⚠️ **而「它們拒 0」是從那兩道的【定義】讀來的, 本片沒有實跑那兩道。** 這一格是推論。
  --
  --   為什麼它會發生:0 元贈品放行之後, 「只有贈品 + 門市取貨」⇒ subtotal 0 + 運費 0 ⇒ total 0。
  --   Sean 早先拍的「贈品永遠跟著別的商品一起買」是**業務假設, 不是一道閘** ——
  --   `create_order` 與購物車都沒有在強制它。本閘把那個假設變成一道真的閘。
  --
  --   🔴 **日後若出現【合法的 0 元單】, 這道閘要一起重議, 不是繞過它**:
  --     · 100% 折抵的優惠券(Sean 2026-08-24 已把優惠券從「零條目」拍成要做)
  --     · 全額儲值金付款
  --     · 全額折抵的退換貨補寄
  --   那時要問的是「這張 0 元單走哪一條付款路」, 而不是「怎麼讓它通過」。
  --
  --   ⚠️ 誤擋乾跑(2026-08-25 service_role 對正式站實測, 只取 count):
  --     orders 20 筆 · `total = 0` ⇒ **0 筆** · `total < 0` ⇒ 0 筆 · `subtotal = 0` ⇒ 0 筆
  --     order_items 23 筆 · `unit_price = 0` ⇒ 0 筆
  --     尺的證明:撈一筆真的 total(13050)回頭 `eq.` 它 ⇒ 命中 1(算子挑得出東西);
  --               負對照 `total = -987654321` ⇒ 0;正對照 `total > 0` ⇒ 20 = 全部(加法自洽)
  --   ⇒ **對現有資料誤擋 0 筆。**
  --
  --   📌 客人面看到的**不是**這句話:`charge-actions.ts:364` 零原始 error 透傳,
  --     一律回 `MSG.generic`(`:86` 逐字「付款失敗,請稍後再試或聯繫客服 LINE」)。
  --     ⚠️ 而那句對本情境**是誤導的** —— 再試一次永遠不會成功。客人面文案要另外處理(未做)。
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'create_order: 整車金額為 0(subtotal=%, shipping_fee=%)—— 目前沒有一條付款路徑可以結清它(刷卡腿與付款帳本皆拒 0);贈品需與正價商品同車。若這是合法的 0 元單(全額折價券/儲值金), 本閘需重議', v_subtotal, v_shipping_fee;
  END IF;

  -- ── 8. 產號 + 寫 order(N3b:6 碼亂碼 + 有界重試)──
  -- 🔴 唯一 delta 就在這一段。重試迴圈**只包 orders 的 INSERT**:
  --    plpgsql 的 BEGIN…EXCEPTION 是子交易,捕捉後只回滾這一次 INSERT;
  --    8b 的 consent 與 9 的 items 都排在迴圈之後 ⇒ 不會被重複寫入。
  -- 🔴 重試迴圈刻意寫在這一層、不在 helper 裡(v2 §5.4a / R3):
  --    helper 只回候選值,它不可能捕捉 INSERT 的 unique violation。
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();

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

      EXIT;   -- 成功寫入 ⇒ 離開重試迴圈
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴 只吞 display_id 的碰撞。其他 unique violation(例如 cart_session_id 去重、
      --    tappay_rec_trade_id)**原樣上拋** —— 那些是語意訊號,重試會把它們吃掉。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        -- 明確報錯、不靜默、不降級。token 供 app 層 catch 後告警(N3b-app、backlog #300)。
        RAISE EXCEPTION 'create_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)'
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  -- 迴圈理論上不可能在未設值的情況下離開(成功才 EXIT、用盡必 RAISE),
  -- 但「理論上不可能」也是一條沒被測的斷言 ⇒ 明寫出來、fail-closed。
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 重試迴圈結束但 v_order_id 未設值(不該發生)'
      USING ERRCODE = 'P0001';
  END IF;

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

-- ── 段 5:COMMENT ───────────────────────────────────────────────
COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) IS
  'M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄 + M-4a V-3a vehicle_snapshot + M-4a B-2 notification_email(9-param)。🆕 **E10 N3b(2026-07-30)**:段 8 產號改呼 public.pcm_generate_display_id()(v2 §5.4a 合約、6 碼亂碼、無前綴),INSERT 包在上限 5 次的有界重試迴圈內;只捕捉 constraint_name = orders_display_id_key 的 unique_violation,其他 unique violation 原樣上拋;用盡則 RAISE(SQLSTATE P0001、message 含 token pcm_display_id_exhausted,供 app 層 catch 後告警 —— 該片延後,見 backlog #300)。order_display_seq 保留但不再被呼叫。🔴 display_id 新舊兩種格式永久並存(Sean 2026-07-30 拍 Q1=A,舊單不改號);orders_display_id_format CHECK 維持兩收、不再收緊(N3c 已取消)。其餘 executable 逐字同 20260719120000(prosrc delta 僅段 8 與 DECLARE)。return 只 {order_id,display_id}。🆕 **2026-08-25(0 元贈品)**:①段 6 單價閘 `<= 0` 放寬為 `< 0`(`IS NULL` 那半不變 —— 「查不到價格」與「0 元」是兩件事);②段 7 新增「整車 total 必須 > 0」閘(理由是工程事實不是商業規則:total=0 目前沒有付款路徑結得掉,而那一格是從閘④⑤ 的定義推的、本片未實跑)。其餘 executable 逐字同 20260730120100。';


-- ── 段 3:收工驗收(fail-closed;任一條不成立 = 整片回滾)────────
-- 🔴 為什麼在這裡再抄一次:見檔頭。既有那五條住在別支 migration 的 DO $$ 裡, 對本版零覆蓋。
DO $$
DECLARE
  v_txt text;
  v_cnt integer;
BEGIN
  -- 3.1 ACL(逐字沿用 20260730120100 段 6.2 的兩個方向)
  IF NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — authenticated 對 create_order 的 EXECUTE 不見了(結帳會全斷)';
  END IF;
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('service_role'), ('payment_confirmer')) AS r(role_name)
   WHERE pg_catalog.has_function_privilege(
      r.role_name,
      'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure, 'EXECUTE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — anon/service_role/payment_confirmer 竟可 EXECUTE create_order(實 % 個)', v_cnt;
  END IF;

  SELECT prosrc INTO v_txt
    FROM pg_proc
   WHERE oid = 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)'::regprocedure;
  -- 🔴🔴 **剝掉 `--` 行註解再比對**(codex R1 must-fix):`prosrc` 是**含註解**的原始碼
  --   ⇒ 有人把 `order_legal_consents` 的 INSERT 刪掉、而把那段的標題註解留著,
  --     下面每一條字面斷言**照樣全綠**。⇒ 它們原本量的是「這個詞在檔案裡」,
  --     不是「這段碼還在」。剝註解之後才勉強靠近後者。
  --   ⚠️ **而剝完仍然只是字面** —— 它證明不了那段碼的語意還對(那要行為測試)。
  --   ⚠️ 這個洞是從 `20260730120100` 段 6.3 一起抄過來的 ⇒ **那一支也有**(本片不改它)。
  v_txt := pg_catalog.regexp_replace(v_txt, '--[^\n]*', '', 'g');

  -- 3.2 🔴 本檔改動【確實生效】—— 兩個方向都要
  IF pg_catalog.strpos(v_txt, 'v_unit_price IS NULL OR v_unit_price < 0') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 6 單價閘不是 `< 0`(贈品仍被擋在結帳)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'v_unit_price IS NULL OR v_unit_price <= 0') > 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 6 舊的 `<= 0` 還在(本檔沒有生效)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'IF v_total <= 0 THEN') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 7 整車金額閘不見了(0 元單會生得出來而付不掉)';
  END IF;

  -- 3.3 既有行為必須還在(從 20260730120100 段 6.3 抄來的五條;
  --     它們在那支檔裡只跑過一次, 對本版本來零覆蓋)
  IF pg_catalog.strpos(v_txt, 'v_subtotal >= 5000 THEN 0 ELSE 100') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 7 運費 CASE 不見了';
  END IF;
  IF pg_catalog.strpos(v_txt, 'order_legal_consents') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 8b 同意紀錄寫入不見了(無 consent 不生 order)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'vehicle_snapshot') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 9 vehicle_snapshot 不見了';
  END IF;
  IF pg_catalog.strpos(v_txt, 'availability_at_checkout') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 9 availability 快照不見了';
  END IF;
  IF pg_catalog.strpos(v_txt, '訂單總額溢位') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 7 溢位守門不見了';
  END IF;
  IF pg_catalog.strpos(v_txt, 'public.pcm_generate_display_id()') = 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 段 8 產號器呼叫不見了';
  END IF;
  IF pg_catalog.strpos(v_txt, 'order_display_seq') > 0 THEN
    RAISE EXCEPTION '0 元閘驗收失敗 — 舊產號器 order_display_seq 又回來了';
  END IF;

  RAISE NOTICE '0 元閘驗收通過(ACL 雙向 + 本檔改動雙向 + 7 項既有行為字面)';
END
$$;

COMMIT;
