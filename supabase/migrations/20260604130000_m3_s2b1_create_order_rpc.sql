-- ============================================================
-- M-3-S2-b1:create_order RPC(建單、零 service_role、SECURITY DEFINER 受控提權)
-- ============================================================
-- 真權威:master plan docs/specs/2026-06-04-m3-checkout-plan.md v6 §3.1 + kickoff §5 + plan v3。
-- 依賴:20260604120000_m3_s2a_orders_order_items.sql(orders/order_items/雙軸 enum/display seq/3 jsonb backstop)。
-- 鐵則 8 重大改動(新 RPC、跨表寫入、pricing)+ 鐵則 12(建單 / server 價權威 / 經銷價零外洩 / 歷史凍結快照)。
--
-- 🔴 business override(D3=B、鐵則 12 揭示、偏離 master plan v6「create_order tier-aware」):
--   S2-b1 **只做 general 價、零 store→price_store code path**。tier-aware(店家經銷價取價)延到「定價階段」
--   (報價單管道就緒 + 硬驗後)。本 RPC:① 不查 customers.tier 做價格分支 ② unit_price 恆取 variant.price_general
--   ③ tier_at_checkout 恆寫 'general'(= 本單定價基準;客人真實 tier 仍在 customers.tier 可 join、無資訊損失)
--   ④ 全函式零 price_store / price_by_tier 參照。
--
-- 🔴 鐵則 12 經銷價零外洩 + server 權威:
--   - 零 service_role:本 RPC SECURITY DEFINER 以 owner 身分受控寫入(authenticated 對 orders/order_items 僅 SELECT、
--     無直接 INSERT → 建單只能走本 RPC)。
--   - client 只送 variant_id(或 (supplier_slug,sku))+ qty + address_id + shipping_method + invoice;**永不送價/tier**。
--   - 價格 server 權威:unit_price 由 RPC 從 product_variants.price_general 取(變體自己的價、群層價不可當變體價);
--     subtotal/shipping_fee/total 全 RPC 自算;client 送的任何金額一律忽略。
--   - product_snapshot 由 RPC jsonb_build_object 建 {title,sku,spec}(spec 取 variant.spec catalog 規格欄、全 string)=
--     主控,配 S2-a 三層 backstop(值型別守 + exact-key 白名單 + spec 鍵名 blacklist)。
--   - return DTO 只 {order_id, display_id}(禁回原 row、禁帶任何價結構)。
--
-- ⚠️ fail-closed 逐項 raise(防舊 cart 送已下架/缺貨/錯價、防越權、防竄改;含 codex k2 round1 加固):
--   未登入(auth.uid NULL)/ 無 customer profile / 地址非本人或不存在 / 配送方式 NULL或非白名單 /
--   發票 NULL或非 object或缺 type或類型非法 / 購物車空 / 品項數 >200 / 數量 <=0或>10000 / line 缺 variant 識別 /
--   找不到 variant / 重複 variant / 商品已下架 / 🔴 商品群層缺貨(products.availability)/ 變體缺貨(variant.availability)/
--   變體價 NULL或<=0 / variant spec 非法(非 object/含非字串值/含敏感鍵)/ 單筆·小計·總額金額溢位(> int max、bigint 中間值算)。
--   全 fail-closed 驗於 nextval 前 → 不燒號於被拒單(codex k2:NULL guard 提前 + spec 預驗 + phone coalesce 於 nextval 前)。
-- 🔴 codex k2 r2 must-fix:① display_id 用 CASE(seq <4 位補零、>=4 位原樣)避 lpad 截斷撞號 ② 收件 phone coalesce '' 避 JSON null 燒號。
--
-- ⭐ 運費(Sean 拍 B、偏離 design「自取免運/宅配滿額免運」與「flat 100」的調和):
--   method ∈ {home, store}(對齊 design CheckoutPage/HANDOFF-v2.0、Sean 拍 A;未知 raise);
--   store → 0(自取免運、對齊 design);home → subtotal >= 5000 ? 0 : 100。RPC 自算、不信 client。
--
-- 安全屬性:SECURITY DEFINER + SET search_path='' + 全物件 schema 限定 + 無動態 SQL(= ANY(array) 靜態)
--   + REVOKE EXECUTE FROM PUBLIC, anon + 只 GRANT EXECUTE TO authenticated。
--
-- 動手前真 DB 交易模擬(MCP execute_sql 交易內 BEGIN + 套 S2-a + 本 RPC + synthetic 假資料 + 模擬呼叫 + ROLLBACK +
--   catalog 複查零留痕、project bmpnplmnldofgaohnaok;SQL 字面不自證、以唯讀查為憑):見 commit body / review-log。
--
-- Rollback(Supabase forward-only、僅供參考):
--   DROP FUNCTION IF EXISTS public.create_order(jsonb, uuid, text, jsonb);
-- ============================================================


CREATE OR REPLACE FUNCTION public.create_order(
  p_lines           jsonb,   -- [{variant_id uuid} 或 {supplier_slug text, sku text}, qty int]
  p_address_id      uuid,
  p_shipping_method text,
  p_invoice         jsonb     -- {type:'personal'|'company'|'donate', carrier?, title?, taxId?, donateCode?}
)
RETURNS jsonb                 -- {order_id uuid, display_id text}
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
  v_line_total     bigint;            -- bigint 中間值防 integer*integer 溢位(codex k2 consider);存表前驗 <= int max
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
BEGIN
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
  -- 🔴 codex k2 r2 must-fix:customer_addresses.phone 可為 NULL → jsonb_build_object 產 JSON null →
  --    S2-a orders_ship_addr_whitelist 在 nextval 後才拒(燒序號 + 訂單永敗)。coalesce '' 收乾淨(空電話業務允許、欄 DEFAULT '')。
  --    name/line 為 NOT NULL、不需 coalesce。
  v_addr_snapshot := pg_catalog.jsonb_build_object(
    'name', v_addr.name, 'phone', coalesce(v_addr.phone, ''), 'line', v_addr.line
  );

  -- ── 3. 配送方式白名單(Sean 拍 A:home/store;運費 step 7 算)──
  --    NULL 顯式擋(codex k2 consider:NULL NOT IN 為 NULL 非 true、不擋 → 會燒號才被 NOT NULL 擋;早 raise)
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'create_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;

  -- ── 4. 發票類型(完整欄位驗在 schema/use-case 層;DB 收乾淨白名單 jsonb)──
  --    NULL / 非 object / 缺 type 顯式擋(codex k2 consider:全在 nextval 前 fail-closed、不燒號於被拒單)
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'type') IS NULL OR (p_invoice->>'type') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'create_order: 發票類型非法或缺失(%)', p_invoice->>'type';
  END IF;
  -- RPC jsonb_build_object 主控:逐欄 ->> 取為 text(任何巢狀值被序列化為字串、無法注入物件)+ strip_nulls 去缺欄。
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       p_invoice->>'type',
    'carrier',    p_invoice->>'carrier',
    'title',      p_invoice->>'title',
    'taxId',      p_invoice->>'taxId',
    'donateCode', p_invoice->>'donateCode'
  ));

  -- ── 5. 購物車非空 + 品項數上限(codex k2 consider:防巨量 line DoS / 累加溢位面)──
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'create_order: 購物車為空';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'create_order: 購物車品項超過上限(200)';
  END IF;

  -- ── 6. 逐 line:解析變體 → fail-closed 驗 → server 取價 → 累計 subtotal + 累積 items 快照 ──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(p_lines) AS e
  LOOP
    v_qty := (v_line->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 10000 THEN  -- 上限 10000(codex k2 consider:防巨量 qty 溢位 / DoS)
      RAISE EXCEPTION 'create_order: 數量非法或超過上限 1-10000(qty=%)', v_line->>'qty';
    END IF;

    v_variant_id    := nullif(v_line->>'variant_id', '')::uuid;  -- NULLIF 為 SQL 構造、非 catalog 函式、search_path='' 下仍解析
    v_supplier_slug := v_line->>'supplier_slug';
    v_sku           := v_line->>'sku';

    -- 解析變體(優先 variant_id;否則 (supplier_slug,sku) 複合鍵、S3a 後 sku 非全域唯一防撞);
    -- 取 variant 自己的價 + variant 層 availability + parent 下架/群層 availability/標題(codex k2 must-fix:群層 availability 也驗)
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

    -- 重複 variant(同一變體跨多 line)→ raise(防前台重複加購未合併造成快照分裂)
    IF v_variant.id = ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'create_order: 重複 variant(%);同變體應合併 qty', v_variant.id;
    END IF;
    v_seen_variants := v_seen_variants || v_variant.id;

    -- 下架 / 群層缺貨 / 變體缺貨(防舊 cart 送已下架/缺貨;群層 + 變體層雙驗、codex k2 must-fix)
    -- ⚠️ availability 現為二值 'in-stock'/'out-of-stock'、`<> 'in-stock'` fail-closed;若未來加第三態(如預購)須回看(backlog #214)
    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
    END IF;
    IF v_variant.product_availability <> 'in-stock' THEN
      RAISE EXCEPTION 'create_order: 商品群層缺貨(variant=%, product_availability=%)', v_variant.id, v_variant.product_availability;
    END IF;
    IF v_variant.variant_availability <> 'in-stock' THEN
      RAISE EXCEPTION 'create_order: 變體缺貨(variant=%, availability=%)', v_variant.id, v_variant.variant_availability;
    END IF;

    -- 🔴 server 取價(D3=B general-only:取 variant 自己的 price_general;零 price_store path);價 NULL/<=0 → raise
    v_unit_price := v_variant.price_general;
    IF v_unit_price IS NULL OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
    END IF;

    -- spec 預驗(codex k2 r2 consider:對齊 S2-a order_items_snapshot_whitelist、fail-closed 於 nextval 前;
    --   catalog 髒 spec〔非 object/含非字串值/含敏感鍵 #213〕早 raise、不燒號 + 不在 INSERT 才爆;spec 非 client 可控、屬資料品質縱深)
    IF pg_catalog.jsonb_typeof(v_variant.spec) <> 'object'
       OR NOT public.m3_jsonb_values_all_string(v_variant.spec)
       OR (v_variant.spec ?| array['price_store','price_by_tier','cost']) THEN
      RAISE EXCEPTION 'create_order: variant spec 非法(非 object/含非字串值/含敏感鍵)(variant=%)', v_variant.id;
    END IF;

    -- 金額用 bigint 中間值算 + 存表前驗 <= int max(codex k2 consider:防 integer*integer 溢位)
    v_line_total := v_unit_price::bigint * v_qty;
    IF v_line_total > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 單筆金額溢位(variant=%, line_total=%)', v_variant.id, v_line_total;
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 訂單小計溢位(subtotal=%)', v_subtotal;
    END IF;

    -- 凍結快照(product_snapshot 主控:title 取 product、sku/spec 取 variant;spec 全 string、配 S2-a backstop)
    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id',       v_variant.id,
      'variant_sku',      v_variant.sku,
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec),
      'quantity',         v_qty,
      'unit_price',       v_unit_price,
      'line_total',       v_line_total
    );
  END LOOP;

  -- ── 7. 運費(Sean 拍 B):store→0 自取免運;home→subtotal>=5000?0:100。RPC 自算、不信 client ──
  IF p_shipping_method = 'store' THEN
    v_shipping_fee := 0;
  ELSE  -- home(已白名單、僅餘此分支)
    v_shipping_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END;
  END IF;
  v_total := v_subtotal + v_shipping_fee;  -- discount_total Phase 1 = 0
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 訂單總額溢位(total=%)', v_total;
  END IF;

  -- ── 8. 產號(fail-closed 全過後才 nextval、不燒號於被拒單)+ 寫 order(unpaid/notOrdered)──
  -- 🔴 codex k2 r2 must-fix:lpad(s,4) 對 >4 位字串會「截斷」(seq=10000→'1000' 撞號)→ 改 CASE:
  --    <4 位才補零到 4、>=4 位原樣輸出(對齊 S2-a regex ^PCM-YYYY-[0-9]{4,}$ 不跨年重置成長)。
  v_seq_text := pg_catalog.nextval('public.order_display_seq')::text;
  v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' ||
                  CASE WHEN pg_catalog.length(v_seq_text) < 4 THEN pg_catalog.lpad(v_seq_text, 4, '0') ELSE v_seq_text END;

  -- v_subtotal/v_total 為 bigint、已驗 <= int max → ::integer 安全(欄為 integer)
  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice
  )
  RETURNING id INTO v_order_id;

  -- ── 9. 寫 items(快照已備、逐筆 insert;order_items CHECK 為縱深底線)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer
    );
  END LOOP;

  -- ── 10. return DTO 只 {order_id, display_id}(禁回原 row / 禁帶價結構)──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;

COMMENT ON FUNCTION public.create_order(jsonb, uuid, text, jsonb) IS
  'M-3-S2-b1 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')。client 送 variant+qty+address+method+invoice、永不送價/tier;server 權威取 variant.price_general(D3=B general-only、零 price_store path)、自算 subtotal/運費/total;fail-closed 逐項 raise;product_snapshot RPC 主控配 S2-a backstop;return 只 {order_id,display_id}。';


-- ── 權限:REVOKE EXECUTE FROM PUBLIC, anon → 只 GRANT authenticated(建單須登入)──
-- 新函式預設 GRANT EXECUTE TO PUBLIC → 先 REVOKE 收回(含 anon)、再精準 GRANT authenticated。
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb) TO authenticated;
