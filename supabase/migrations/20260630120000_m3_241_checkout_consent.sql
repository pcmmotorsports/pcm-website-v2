-- ============================================================
-- M-3 #241:結帳同意紀錄 — legal_terms_versions 登錄表 + order_legal_consents + create_order 8-param 原子寫 consent
-- ============================================================
-- 真權威:docs/specs/2026-06-30-m3-241-checkout-consent-plan.md(Gemini 第二意見 §6 + codex 關卡1 fold §7)。
-- 鐵則 8(動核心建單 RPC 簽名 5→8 + 2 新表 + RLS/GRANT)+ 鐵則 12(付款/建單脊椎、PII 隔離、零經銷價滲入)。
-- 依賴(皆已 db push live):20260604120000(orders/order_items)、20260613130000(0b create_order 5-param + cart_session_id)、
--   20260614130000(#214a create_order CREATE OR REPLACE 5-param + availability 快照,= 本 migration 的 zero-regression baseline)。
-- flag:TAPPAY_3DS_ENABLED 全程 false、prod 結帳關閉中 → 本 migration prod 零影響;db push = Sean(joins 開 prod flag 前 bundle)。
--
-- 🔴 設計(plan §2 + §7 codex fold,以 §7 為準):
--   ① legal_terms_versions:條款版本登錄表(version PK + content_hash〔design 條款源檔 sha256〕+ effective_at);
--      order_legal_consents.terms_version FK 此表 = 只收已登錄版本(codex H4)。seed 當前版本 '2026-06-30'。
--   ② order_legal_consents:1:1 附屬 orders 的同意紀錄(terms_version FK / consented_at / client_ip / client_user_agent);
--      RLS 啟用 + 零 policy + REVOKE ALL(含 service_role)= IP/UA PII 最大隔離,app 不讀、只 create_order SECDEF owner 寫、dashboard/admin 直查。
--   ③ create_order 5→8 param:加 p_terms_version/p_client_ip/p_client_ua;p_terms_version NULL/空 → RAISE(create_order 路徑「無 consent 不生 order」、codex B2 限縮為此單一 app 建單路徑);
--      同 transaction INSERT orders 後 INSERT order_legal_consents(原子;Gemini 否決拆 RPC 的幽靈訂單)。IP/UA left() 截斷 128/1024(codex M8)。
--      zero-regression:本體 **executable logic 對 20260614130000 byte-identical** + 三處 delta(簽名 +3 param / consent guard / consent INSERT);取價/防撞/IDOR/溢位/快照/權限矩陣 executable 逐字。
--      🔴 行內 rationale 註解精簡(lpad-CASE 撞號防 / availability 從 v_line 取非上一迴圈 stale / spec whitelist 對齊 S2-a / phone coalesce 防燒序號 / bigint 溢位閘 等 codex must-fix 說明**完整見 20260614130000**)—— code-reviewer should-fix 字面誠實化(executable 逐字、註解非逐字)。
--   ④ DROP 舊 5-param;DO assert 4-param 與 5-param 皆不存在(codex N9 replay drift bypass overload)。
--   ⑤ SECDEF owner 寫 zero-policy 表:DO assert 兩新表 relforcerowsecurity=false(codex H6:FORCE RLS 會連 owner 都擋)。
--
-- 命名誠實(codex B1):本片 = 「同意紀錄」(consent signal + version + content_hash + IP/UA)非「完整法律舉證」;
--   完整效力另需 #235(結帳條款連結 href="#" → 接可讀條款頁,前端/內容片、不在本 migration);content_hash 提供「同意哪份內容」provenance。
--
-- 驗證分工:本 migration 經 DDL MCP 模擬(BEGIN..ROLLBACK 零留痕、project bmpnplmnldofgaohnaok PG17):
--   catalog(2 表/欄/FK/PK/CHECK)+ RLS enabled + relforcerowsecurity=false + consent 表 grants=0 矩陣 + create_order 8-param ACL(唯 authenticated)+
--   4/5-param 皆 DROP + 行為(8-param 建單同時寫 consent 綁正確 order_id / null·空 terms_version RAISE / 未登錄版本 FK reject / IP·UA null 容忍 + 截斷 / consent 唯 owner 寫得進)+ 零留痕後驗。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動):見檔尾。
-- ============================================================


-- ── 1. legal_terms_versions:條款版本登錄表(codex H4 FK 來源 + B1 content_hash 歸宿)──
CREATE TABLE public.legal_terms_versions (
  version       text PRIMARY KEY,
  content_hash  text NOT NULL,                         -- design 條款源檔 sha256(證明「同意哪份內容」;條款改版必 bump version+hash)
  effective_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.legal_terms_versions IS
  'M-3 #241 條款版本登錄表。version=當前條款版本(= TS CURRENT_TERMS_VERSION);content_hash=design-reference/components/LegalPage.jsx sha256(條款內容 provenance)。order_legal_consents.terms_version FK 此表 → 只收已登錄版本。非 PII、公開讀;寫入僅 migration seed。';

ALTER TABLE public.legal_terms_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.legal_terms_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.legal_terms_versions TO anon, authenticated;   -- 版本/雜湊非 PII、公開可讀(FK 檢查 + 未來「條款版本」UI)
CREATE POLICY legal_terms_versions_select_all ON public.legal_terms_versions
  FOR SELECT TO anon, authenticated
  USING (true);

-- seed 當前版本(content_hash = shasum -a 256 design-reference/components/LegalPage.jsx @ 2026-06-30)
INSERT INTO public.legal_terms_versions (version, content_hash, effective_at)
VALUES ('2026-06-30', 'a07a5f29bc5eb6b8600e75071862073d3a529550159d4d7d289d1ef577c4bd77', now())
ON CONFLICT (version) DO NOTHING;


-- ── 2. order_legal_consents:1:1 附屬 orders 的同意紀錄(IP/UA PII 隔離)──
CREATE TABLE public.order_legal_consents (
  order_id           uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  terms_version      text NOT NULL REFERENCES public.legal_terms_versions(version),   -- 只收已登錄版本(codex H4)
  consented_at       timestamptz NOT NULL DEFAULT now(),
  client_ip          text CHECK (client_ip IS NULL OR length(client_ip) <= 128),        -- best-effort、PII;長度上限(codex M8)
  client_user_agent  text CHECK (client_user_agent IS NULL OR length(client_user_agent) <= 1024),
  created_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.order_legal_consents IS
  'M-3 #241 結帳同意紀錄(1:1 附屬 orders)。consent signal + terms_version(FK)+ consented_at + client_ip/UA(best-effort 爭議舉證、PII)。寫入唯一路徑 = create_order SECDEF owner;RLS 啟用零 policy + REVOKE ALL(含 service_role)= app 不讀、PII 最大隔離、僅 dashboard/admin 直查。無金額/經銷價欄。';
COMMENT ON COLUMN public.order_legal_consents.client_ip IS 'best-effort(x-vercel-forwarded-for/x-forwarded-for/x-real-ip 首段);可偽造、非強身分證據。';

ALTER TABLE public.order_legal_consents ENABLE ROW LEVEL SECURITY;
-- 🔴 零 policy + REVOKE ALL(含 service_role)= IP/UA PII 最大隔離(對齊 R1b1a anomaly 表);create_order SECDEF owner 寫(owner bypass RLS、relforcerowsecurity=false 保證)。
REVOKE ALL PRIVILEGES ON TABLE public.order_legal_consents FROM PUBLIC, anon, authenticated, service_role;


-- ── 3. create_order:CREATE OR REPLACE 5→8 param(zero-regression 20260614130000 版 + 三 delta:簽名 / consent guard / consent INSERT)──
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
             THEN 'in-stock' ELSE 'out-of-stock' END
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

  -- ── 9. 寫 items ──
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
      v_line->>'availability_at_checkout'
    );
  END LOOP;

  -- ── 10. return DTO ──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;
COMMENT ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text) IS
  'M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄(8-param)。client 送 variant+qty+address+method+invoice+cart_session_id、永不送價/tier;server 注入 terms_version(CURRENT_TERMS_VERSION)+ best-effort client_ip/ua。p_terms_version NULL/空 fail-closed(create_order 路徑無 consent 不生 order);同 transaction 原子 INSERT order_legal_consents(IP/UA left 截斷)。其餘(取價/防撞/IDOR/溢位/快照/運費)executable 逐字同 20260614130000(行內 rationale 註解精簡、完整見該檔);return 只 {order_id,display_id}。';

-- ── 4. DROP 舊 5-param(無不寫 consent 後門;codex N9)──
DROP FUNCTION IF EXISTS public.create_order(jsonb, uuid, text, jsonb, uuid);

-- ── 5. 權限(8-param 唯 authenticated;冪等重申)──
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text) TO authenticated;


-- ── 6. fail-closed assert(擋 db push)──
DO $$
BEGIN
  -- create_order 8-param:唯 authenticated
  IF NOT has_function_privilege('authenticated', 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon',             'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role',     'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_order 8-param EXECUTE 權限矩陣異常 — 應唯 authenticated;拒繼續';
  END IF;

  -- 🔴 codex N9:舊 5-param 與 4-param 皆不存在(無不寫 consent 後門 / replay drift bypass overload)
  IF to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'create_order 舊 5-param 未 DROP — 殘留 = 繞 consent 後門;拒繼續';
  END IF;
  IF to_regprocedure('public.create_order(jsonb,uuid,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'create_order 舊 4-param 殘留 — 繞 cross-tab dedup + consent 後門;拒繼續';
  END IF;

  -- begin_charge_attempt ACL 回歸(唯 payment_confirmer)
  IF NOT has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'begin_charge_attempt EXECUTE 權限矩陣異常;拒繼續';
  END IF;

  -- payment_confirmer 仍不可呼 create_order(8-param)
  IF has_function_privilege('payment_confirmer', 'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'payment_confirmer 不應可呼 create_order(攻擊面收斂回歸);拒繼續';
  END IF;

  -- 🔴 #241 兩新表存在
  IF to_regclass('public.legal_terms_versions') IS NULL THEN
    RAISE EXCEPTION 'legal_terms_versions 表缺失;拒繼續';
  END IF;
  IF to_regclass('public.order_legal_consents') IS NULL THEN
    RAISE EXCEPTION 'order_legal_consents 表缺失;拒繼續';
  END IF;

  -- 🔴 codex H6:兩新表 RLS enabled 且 relforcerowsecurity=false(否則零 policy 連 SECDEF owner 都寫不進)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                  WHERE oid = 'public.order_legal_consents'::pg_catalog.regclass
                    AND relrowsecurity = true AND relforcerowsecurity = false) THEN
    RAISE EXCEPTION 'order_legal_consents RLS 狀態異常(需 enabled + 非 force);拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                  WHERE oid = 'public.legal_terms_versions'::pg_catalog.regclass
                    AND relrowsecurity = true AND relforcerowsecurity = false) THEN
    RAISE EXCEPTION 'legal_terms_versions RLS 狀態異常(需 enabled + 非 force);拒繼續';
  END IF;

  -- 🔴 order_legal_consents grants=0(PII 隔離;PUBLIC/anon/authenticated/service_role 皆零表權)
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'order_legal_consents'
       AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) THEN
    RAISE EXCEPTION 'order_legal_consents 表權限非零(PII 隔離破口);拒繼續';
  END IF;

  -- 🔴 #241 seed 存在
  IF NOT EXISTS (SELECT 1 FROM public.legal_terms_versions WHERE version = '2026-06-30') THEN
    RAISE EXCEPTION 'legal_terms_versions seed 缺當前版本;拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   -- create_order 還原回 5-param #214a 版(手動貼 20260614130000 該檔 create_order 全文 CREATE OR REPLACE + REVOKE/GRANT):
--   DROP FUNCTION IF EXISTS public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text);
--   -- 然後重建 5-param(見 20260614130000)。
--   DROP TABLE IF EXISTS public.order_legal_consents;
--   DROP TABLE IF EXISTS public.legal_terms_versions;
-- ============================================================
