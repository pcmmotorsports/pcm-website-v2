-- ============================================================
-- M-3 #214a:create_order 移除缺貨閘 + order_items.availability_at_checkout 快照
-- ============================================================
-- 真權威:docs/specs/2026-06-14-m3-create-order-stock-gate-removal-plan.md(Sean 拍 §7=A 單欄派生)
--   + 審查側合成執行指令 v2(折入關卡1 2 MAJOR + 4 MINOR)+ 記憶 project_create-order-stock-gate-removed。
-- 依賴(同 db push bundle、皆 git-pushed DB 未 push):20260604120000(orders/order_items + whitelist CHECK)、
--   20260613130000(0b:create_order 5-param + orders.cart_session_id)。本 migration CREATE OR REPLACE 0b 版 create_order。
-- 鐵則 8(改建單核心 RPC + 新增 order_items 欄=schema)+ 鐵則 12(付款/建單脊椎/經銷價零外洩)。
--
-- 🔴 設計(plan §1/§3/§7 + 執行指令 v2):
--   ① 移 create_order 兩條 availability RAISE(群層 product_availability + 變體層 variant_availability);
--      保留 delisted_at 下架閘 + 價 price_general NULL/<=0 fail-closed + spec blacklist + 防撞 + IDOR + search_path=''。
--      對齊前端 #161 訂貨型(不顯庫存、買鈕永遠可點、海外調貨缺貨可賣);#214(a) 走移除非擴值域。
--   ② 新增 order_items.availability_at_checkout(單欄 text 派生、Sean §7=A):
--      RPC 寫 CASE WHEN variant='in-stock' AND product='in-stock' THEN 'in-stock' ELSE 'out-of-stock' END。
--      兩源欄皆 NOT NULL(MCP 實證 is_nullable=NO)→ ELSE 必真 out-of-stock、非 NULL 退化。
--      nullable + CHECK 白名單(相容無 row、對齊 0b cart_session_id 慣例);非價/非 PII、RLS own-only 自動涵蓋(不需新 policy)。
--   ③ 三處接線:第一迴圈 v_items jsonb 加鍵 / INSERT 欄清單加欄 / VALUES 從 v_line 取(🔴 非 v_variant、後者為上一迴圈末筆 stale)。
--   ④ zero-regression:CREATE OR REPLACE 0b 本體、only diff = 移 2 RAISE + 寫快照三接線;取價/防撞/IDOR/溢位/權限矩陣逐字不動。
--   ⑤ 🔴 forward-only:0b(c89e178)已 git-push origin/dev、不可 amend;本 migration **不重播** 0b 的 DROP 4-param /
--      begin_charge_attempt / ALTER orders(同 bundle 0b 先跑、重播會炸)。唯一新 DDL = order_items ADD COLUMN。
--   ⑥ DO assert:0b 既有 4 條矩陣 assert 當回歸哨兵(create_order 5-param 唯 authenticated / 舊 4-param IS NULL /
--      begin 唯 payment_confirmer / payment_confirmer 不可呼 create_order)+ 新增 availability_at_checkout 欄存在 assert。
--
-- 驗證分工(寫審分離、執行指令 v2 ③:完整行為七情境=審查側權威 gate):
--   執行側已做(2026-06-14、project bmpnplmnldofgaohnaok PG17、零留痕):
--     ① zero-regression diff:create_order 本體 byte-identical 0b 減三處 delta(移 2 availability RAISE / v_items 加
--        availability_at_checkout CASE / INSERT 加欄+值〔欄值數對齊〕);取價/防撞/IDOR/溢位/權限矩陣逐字不動。
--     ② 新 DDL MCP 交易驗證(BEGIN..ROLLBACK):ALTER 套用 + 欄存在 assert 過 + CHECK 拒 bogus·收 in-stock/out-of-stock/NULL
--        + CHECK 約束已建 + order_items_snapshot_whitelist 完好(prod orders/order_items 0 row、is_nullable=NO 兩源欄)。
--   審查側權威 gate(commit 後):完整行為七情境(端到端 create_order):移閘 oos 建單成功 / delisted 仍擋 / 價 NULL·0 fail-closed /
--     快照值正確〔oos→out-of-stock、in→in-stock〕/ product_snapshot 仍 exact{title,sku,spec} / DO assert 全過(5-param 矩陣 + 新欄)/
--     seq setval 還原零留痕 + codex 關卡2(鐵則 12)。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):見檔尾。
-- ============================================================


-- ── 1. order_items.availability_at_checkout 新欄(單欄 text 派生、Sean §7=A)──
ALTER TABLE public.order_items
  ADD COLUMN availability_at_checkout text
  CHECK (availability_at_checkout IS NULL OR availability_at_checkout IN ('in-stock', 'out-of-stock'));

COMMENT ON COLUMN public.order_items.availability_at_checkout IS
  '結帳當下 snapshot:群層+變體層任一非 in-stock 即 out-of-stock(調貨/預購單識別、交期 SLA/客訴溯源)。非價/非 PII;RLS own-only 涵蓋。nullable 相容無 row、RPC 恆寫非 null。A 案有意取捨:不分哪一層缺、日後真需分層為非破壞 ADD COLUMN(見 backlog #214)。';


-- ── 2. create_order:CREATE OR REPLACE 0b 版(移 2 條 availability RAISE + 寫 availability_at_checkout 快照)──
CREATE OR REPLACE FUNCTION public.create_order(
  p_lines           jsonb,   -- [{variant_id uuid} 或 {supplier_slug text, sku text}, qty int]
  p_address_id      uuid,
  p_shipping_method text,
  p_invoice         jsonb,    -- {type:'personal'|'company'|'donate', carrier?, title?, taxId?, donateCode?}
  p_cart_session_id uuid      -- 🔴 3DS-0b cart-instance key(client 送、空車首件生;入口 null fail-closed)
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
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed(於任何 nextval/INSERT 之前;防舊/惡意 client 製無 key 垃圾單 + 燒序號)──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
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

    -- 下架閘(防舊 cart 送已下架)；🔴 #214a：availability 不再 fail-closed raise(訂貨型、海外調貨缺貨可賣)、
    -- 改於下方 v_items 寫 availability_at_checkout 快照(群層+變體層任一非 in-stock 即 out-of-stock；調貨單識別)。
    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
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
      'line_total',       v_line_total,
      -- 🔴 #214a availability 快照(群層+變體層任一非 in-stock 即 out-of-stock；兩源 NOT NULL → ELSE 必真 out-of-stock、非 NULL 退化)
      'availability_at_checkout',
        CASE WHEN v_variant.variant_availability = 'in-stock'
              AND v_variant.product_availability = 'in-stock'
             THEN 'in-stock' ELSE 'out-of-stock' END
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
  -- 🔴 3DS-0b:INSERT 寫 cart_session_id(cross-tab dedup 鍵;begin 後續以此判同 cart 重複)
  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id
  ) VALUES (
    v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id
  )
  RETURNING id INTO v_order_id;

  -- ── 9. 寫 items(快照已備、逐筆 insert;order_items CHECK 為縱深底線)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total, availability_at_checkout
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer,
      v_line->>'availability_at_checkout'    -- 🔴 從 v_line 取(非 v_variant、後者為上一迴圈末筆 stale 值)
    );
  END LOOP;

  -- ── 10. return DTO 只 {order_id, display_id}(禁回原 row / 禁帶價結構)──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;
COMMENT ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid) IS
  'M-3-S2-b1 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')+ 3DS-0b cart_session_id + #214a availability 快照。client 送 variant+qty+address+method+invoice+cart_session_id、永不送價/tier;server 權威取 variant.price_general(D3=B general-only、零 price_store path)、自算 subtotal/運費/total;cart_session_id null fail-closed;fail-closed 逐項 raise(下架/價 NULL·0/IDOR);🔴 #214a:availability 不再 fail-closed raise(訂貨型、海外調貨缺貨可賣)、改寫 order_items.availability_at_checkout 快照(群層+變體層任一 out 即 out-of-stock);product_snapshot RPC 主控配 S2-a backstop;return 只 {order_id,display_id}。';

-- ── 3. 權限(冪等重申、CREATE OR REPLACE 保留 ACL、explicit 防退化)──
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid) TO authenticated;


-- ── 4. fail-closed assert(擋 db push;0b 4 條矩陣回歸哨兵 + 新欄存在)──
DO $$
BEGIN
  -- create_order 5-param:唯 authenticated(補掉舊 4-param service_role over-grant)
  IF NOT has_function_privilege('authenticated', 'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',             'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',     'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_order 5-param EXECUTE 權限矩陣異常 — 應唯 authenticated;拒繼續';
  END IF;

  -- 🔴 舊 4-param 已 DROP(無不寫 key 後門 + 順帶清掉 service_role over-grant 的舊目標)
  IF to_regprocedure('public.create_order(jsonb,uuid,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'create_order 舊 4-param 未 DROP — 殘留 = 繞 cross-tab dedup 後門;拒繼續';
  END IF;

  -- begin_charge_attempt CREATE OR REPLACE 保留 ACL = 唯 payment_confirmer(回歸 assert;S2-d 紀律不破)
  IF NOT has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'begin_charge_attempt EXECUTE 權限矩陣異常(CREATE OR REPLACE 後);拒繼續';
  END IF;

  -- payment_confirmer 仍不可呼 create_order(S2-c/S2-d 攻擊面收斂回歸、5-param 版)
  IF has_function_privilege('payment_confirmer', 'public.create_order(jsonb,uuid,text,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'payment_confirmer 不應可呼 create_order(攻擊面收斂回歸);拒繼續';
  END IF;

  -- 🔴 #214a：availability_at_checkout 欄存在且 nullable(本 migration 唯一新 schema；回歸哨兵)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.order_items'::pg_catalog.regclass
       AND attname = 'availability_at_checkout'
       AND NOT attisdropped
       AND attnotnull = false
  ) THEN
    RAISE EXCEPTION 'availability_at_checkout 欄缺失或非 nullable；拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   ALTER TABLE public.order_items DROP COLUMN IF EXISTS availability_at_checkout;
--   -- create_order 還原回 0b 版(重含兩條 availability RAISE、INSERT 不寫 availability_at_checkout):
--   --   手動貼 20260613130000 該檔 create_order 全文 CREATE OR REPLACE + REVOKE/GRANT。
-- ============================================================
