-- 20260915100000-coupon-checkout.sql — ⟦b4-COUPONFIELD⟧ 片 D 的驗收(拋棄式 PG 跑;零留痕:整包 ROLLBACK)。
--
-- 跑法:psql -h /tmp -p <PG> -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/after-checks/20260915100000-coupon-checkout.sql
-- 每一格獨立 try、收集所有紅再一次 RAISE(同 20260915030000 / 060000 那兩支的形狀)。
--
-- 🔴 突變證明:把 create_order 裡 `v_coupon_id := ...` 那一行拿掉 ⇒ ③ 必紅(orders_discount_needs_coupon 擋)。
--    把 `v_discount_total := coalesce(...)` 改成 0 ⇒ ③ 也紅(折抵沒進單)。
--
-- 🛑 本檔會【真的建單】(呼 create_order),所以:
--    · 只在拋棄式 PG 跑, **不要對正式庫跑**(會留 display_id 序號與 cart_session 佔用)。
--    · 需要 auth.users 一位客人 + 一張地址 + 一個 variant;缺任何一項 ⇒ 紅(不是跳過)。

BEGIN;

-- 🔴 `create_order` 的客人身分來自 `auth.uid()`(`:105` 逐字 `v_uid := (select auth.uid())`)——
--    psql 直連沒有 JWT ⇒ auth.uid() 是 NULL ⇒ 每一發都會被「查不到 customers.tier」擋下。
--    ⇒ 本檔在交易內把 claims 設成那位客人;`SET LOCAL` ⇒ ROLLBACK 之後不留。
DO $claims$
DECLARE v_u uuid;
BEGIN
  SELECT u.id INTO v_u FROM auth.users u
   WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = u.id) LIMIT 1;
  IF v_u IS NULL THEN RAISE EXCEPTION '這台庫沒有任何 customers ⇒ 建單格做不了(拋棄式 PG 要先種)'; END IF;
  EXECUTE pg_catalog.format('SET LOCAL request.jwt.claims = %L',
    pg_catalog.jsonb_build_object('sub', v_u::text, 'role', 'authenticated')::text);
END
$claims$;

DO $chk$
DECLARE
  v_fail   text[] := ARRAY[]::text[];
  v_src    text;
  v_uid    uuid;
  v_addr   uuid;
  v_variant uuid;
  v_price  integer;
  v_code   text := 'ZZQCHK100';
  v_terms  text;
  v_cid    uuid;
  v_res    jsonb;
  v_order  public.orders%ROWTYPE;
  v_state  text;
  v_detail text;
BEGIN
  -- ① 本體:封鎖拆了、試算接上、coupon_id 有寫
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure(
     'public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text,text)');
  IF v_src IS NULL THEN
    v_fail := pg_catalog.array_append(v_fail, '① 11 參 create_order 不存在');
  ELSE
    IF pg_catalog.strpos(v_src, '優惠券結帳尚未啟用') > 0 THEN
      v_fail := pg_catalog.array_append(v_fail, '① 3a 的封鎖字面還在');
    END IF;
    IF pg_catalog.strpos(v_src, 'public.redeem_coupon(') = 0 THEN
      v_fail := pg_catalog.array_append(v_fail, '① 本體沒有呼叫 redeem_coupon');
    END IF;
  END IF;

  -- ② 前提:客人 / 地址 / 商品變體 / 員工(建券要 created_by)
  SELECT u.id INTO v_uid FROM auth.users u
   WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = u.id) LIMIT 1;
  SELECT a.id INTO v_addr FROM public.customer_addresses a WHERE a.customer_user_id = v_uid LIMIT 1;
  -- 條款版本要是這台庫真有的那一版(order_legal_consents 有 FK)
  SELECT t.version INTO v_terms FROM public.legal_terms_versions t ORDER BY t.version DESC LIMIT 1;
  SELECT v.id, v.price_general INTO v_variant, v_price
    FROM public.product_variants v JOIN public.products p ON p.id = v.product_id
   WHERE v.price_general >= 500 AND v.availability = 'in-stock' LIMIT 1;
  IF v_uid IS NULL OR v_addr IS NULL OR v_variant IS NULL THEN
    v_fail := pg_catalog.array_append(v_fail,
      pg_catalog.format('② 前提不齊(uid=%s addr=%s variant=%s)⇒ 建單格做不了', v_uid, v_addr, v_variant));
  ELSE
    -- 造一張 100 元定額券(本交易 ROLLBACK, 不留)
    INSERT INTO public.coupons (code, description, discount_type, discount_value, min_spend, stacks_with_tier, is_active, created_by)
    VALUES (v_code, 'after-check 用', 'fixed', 100, 0, true, true,
            (SELECT s.id FROM public.staff s WHERE s.is_active ORDER BY s.id LIMIT 1))
    RETURNING id INTO v_cid;

    -- ③ 真的帶券建一張單 ⇒ 折抵 100、coupon_id 寫進去、total 對得起來
    BEGIN
      v_res := public.create_order(
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('variant_id', v_variant, 'qty', 1)),
        v_addr, 'home', '{"type":"personal"}'::jsonb, pg_catalog.gen_random_uuid(),
        v_terms, NULL, NULL, 'bank_transfer', NULL, v_code);
      SELECT * INTO v_order FROM public.orders WHERE id = (v_res->>'order_id')::uuid;
      IF v_order.id IS NULL THEN
        v_fail := pg_catalog.array_append(v_fail, '③ create_order 回了 order_id 而 orders 查無');
      ELSE
        IF v_order.discount_total IS DISTINCT FROM 100 THEN
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ 折抵 %s(期望 100)', v_order.discount_total));
        END IF;
        IF v_order.coupon_id IS DISTINCT FROM v_cid THEN
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ coupon_id %s(期望 %s)⇒ 扣券 trigger 會找不到券', v_order.coupon_id, v_cid));
        END IF;
        -- 🔴 運費照收(Sean 09-11 拍甲):折的是小計, 不是小計 + 運費
        IF v_order.total IS DISTINCT FROM public.pcm_order_total(v_order.subtotal, v_order.shipping_fee, v_order.discount_total, v_order.tax_total) THEN
          v_fail := pg_catalog.array_append(v_fail, '③ total 與 pcm_order_total 對不起來');
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ 帶券建單炸了(%s %s)', SQLSTATE, SQLERRM));
    END;

    -- ④ 被拒:停用的券 ⇒ P2C20 + DETAIL 帶得出理由(前台靠它挑哪幾種講得出口)
    UPDATE public.coupons SET is_active = false WHERE id = v_cid;
    BEGIN
      PERFORM public.create_order(
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('variant_id', v_variant, 'qty', 1)),
        v_addr, 'home', '{"type":"personal"}'::jsonb, pg_catalog.gen_random_uuid(),
        v_terms, NULL, NULL, 'bank_transfer', NULL, v_code);
      v_fail := pg_catalog.array_append(v_fail, '④ 停用的券竟然建得出單');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
      IF v_state IS DISTINCT FROM 'P2C20' OR coalesce(v_detail, '') NOT LIKE 'coupon_rejected:%' THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('④ 被拒的碼不對(state=%s detail=%s)', v_state, v_detail));
      ELSIF v_detail IS DISTINCT FROM 'coupon_rejected:inactive' THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('④ 理由是 %s(期望 coupon_rejected:inactive)', v_detail));
      END IF;
    END;

    -- ⑤ 不存在的碼 ⇒ 同一條路、理由 not_found(前台把它與 inactive / exhausted 收成同一句)
    BEGIN
      PERFORM public.create_order(
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('variant_id', v_variant, 'qty', 1)),
        v_addr, 'home', '{"type":"personal"}'::jsonb, pg_catalog.gen_random_uuid(),
        v_terms, NULL, NULL, 'bank_transfer', NULL, 'ZZQNOSUCHCODE');
      v_fail := pg_catalog.array_append(v_fail, '⑤ 不存在的券碼竟然建得出單');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
      IF v_state IS DISTINCT FROM 'P2C20' OR v_detail IS DISTINCT FROM 'coupon_rejected:not_found' THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('⑤ 不對(state=%s detail=%s)', v_state, v_detail));
      END IF;
    END;

    -- ⑥ 🔵 負對照:不帶券碼 ⇒ 照樣建得出來、折抵 0、coupon_id NULL(沒帶券的路一個位元都沒變)
    BEGIN
      v_res := public.create_order(
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('variant_id', v_variant, 'qty', 1)),
        v_addr, 'home', '{"type":"personal"}'::jsonb, pg_catalog.gen_random_uuid(),
        v_terms, NULL, NULL, 'bank_transfer', NULL, NULL);
      SELECT * INTO v_order FROM public.orders WHERE id = (v_res->>'order_id')::uuid;
      IF v_order.discount_total IS DISTINCT FROM 0 OR v_order.coupon_id IS NOT NULL THEN
        v_fail := pg_catalog.array_append(v_fail,
          pg_catalog.format('⑥ 沒帶券的單被動到了(discount=%s coupon_id=%s)', v_order.discount_total, v_order.coupon_id));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('⑥ 沒帶券的單建不出來(%s %s)⇒ 本片弄壞了既有的路', SQLSTATE, SQLERRM));
    END;
  END IF;

  IF pg_catalog.cardinality(v_fail) > 0 THEN
    RAISE EXCEPTION '🔴 20260915100000 after-check 紅 % 格:%', pg_catalog.cardinality(v_fail), pg_catalog.array_to_string(v_fail, ' ‖ ');
  END IF;
  RAISE NOTICE '✅ 20260915100000 after-check 全過(①本體 ②前提 ③帶券建單 ④停用被拒 ⑤查無被拒 ⑥沒帶券的路沒變)';
END
$chk$;

ROLLBACK;
