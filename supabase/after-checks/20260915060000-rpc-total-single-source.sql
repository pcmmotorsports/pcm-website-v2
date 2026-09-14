-- 20260915060000-rpc-total-single-source.sql — #953 P2 的驗收斷言(拋棄式 PG 跑;零寫入:整包 ROLLBACK)。
--
-- 跑法:psql -h /tmp -p <PG> -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/after-checks/20260915060000-rpc-total-single-source.sql
-- 每一格獨立、收集所有紅再一次 RAISE(同 20260915030000 那支的形狀)。
--
-- 🔴 突變證明:拋棄式 PG 上把 pcm_order_total 的函式體拿掉 `+ p_tax_total` ⇒ ④ 必須紅(手動單 total 變 1295;
--    三支 RPC 算的錢跟著函式走 —— 這正是 P2 的意義:等式只有一份, 改它三支一起變);還原 ⇒ 綠。③ 是無稅單, 去稅不會紅。

BEGIN;
-- 🔴 不關 trigger:這支走的是【真 RPC】(改價 / 建單), 它們靠 trigger 填欄(shipping_method_at_checkout 等);
--    關了 trigger 反而讓 RPC 撞 NOT NULL —— 2026-09-14 第一版就是這樣紅的。整包最後 ROLLBACK, 不留痕。

DO $chk$
DECLARE
  v_fail  text[] := ARRAY[]::text[];
  v_src   text; v_code text; v_secdef boolean;
  v_sig   text; v_md5 text; v_old text;
  v_ord   uuid; v_item uuid; v_ver integer; v_price integer;
  v_after public.orders%ROWTYPE;
  v_res   text;
BEGIN
  -- ①② 三支:md5 = 20260915060000 那一代、SECURITY DEFINER、去註解後本體含 pcm_order_total( 且舊字面不在
  --    (codex #3:只搜字串會連註解一起算 ⇒ 先剝 `--` 註解;md5 才是「真的是這一版」的證據)
  FOR v_sig, v_md5, v_old IN
    SELECT * FROM (VALUES
      ('public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text, text)', '2e642c484389ea58e6ab150c8e130675',
       'v_total := v_subtotal + v_shipping_fee - v_discount_total + v_tax;'),
      ('public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb, text, text, jsonb)', 'd97986f066c64f0c7f8baaf9cc5202f8',
       'v_total := v_subtotal + p_shipping_fee + v_tax;'),
      ('public.admin_update_order_item_amount(uuid, uuid, integer, integer, text, text, text)', '4b3d6e086edadb27b896f161c10b61dd',
       'v_total := v_subtotal + v_ord.shipping_fee::bigint - v_ord.discount_total::bigint;')
    ) AS t(sig, md5_new, old_literal)
  LOOP
    BEGIN
      SELECT p.prosrc, p.prosecdef INTO v_src, v_secdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig);
      IF v_src IS NULL THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('① %s 不存在', v_sig));
      ELSE
        IF pg_catalog.md5(v_src) <> v_md5 THEN
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('① %s 本體 md5 %s ≠ 20260915060000 那一代 %s', v_sig, pg_catalog.md5(v_src), v_md5));
        END IF;
        IF v_secdef IS NOT TRUE THEN
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('① %s 不是 SECURITY DEFINER', v_sig));
        END IF;
        v_code := pg_catalog.regexp_replace(v_src, '--[^\n]*', '', 'g');
        IF pg_catalog.strpos(v_code, 'public.pcm_order_total(') = 0 THEN
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('② %s 程式碼(非註解)沒有呼叫 pcm_order_total', v_sig));
        END IF;
        IF pg_catalog.strpos(v_code, v_old) > 0 THEN
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('② %s 舊等式字面還在程式碼裡', v_sig));
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('① 查 %s 炸了(%s %s)', v_sig, SQLSTATE, SQLERRM));
    END;
  END LOOP;

  -- ③ 行為格:拿一張【無稅、未收款、有品項】的單, 走 admin_update_order_item_amount 改一次單價
  --    ⇒ 改後 total 必須 = pcm_order_total(subtotal, shipping_fee, discount_total, tax_total)(逐位元)
  --    找不到符合的單 ⇒ 紅(不是跳過)。RPC 的 payments 閘 / 版本閘 / 管理者閘等會擋 ⇒ 用 SQLERRM 原文報, 不猜。
  BEGIN
    SELECT o.id, oi.id, o.version, oi.unit_price INTO v_ord, v_item, v_ver, v_price
      FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.tax_total = 0 AND COALESCE(o.price_tax_mode, 'inclusive') <> 'exclusive'
       AND NOT EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = o.id)
       AND o.cancelled_at IS NULL
     ORDER BY o.created_at LIMIT 1;
    IF v_ord IS NULL THEN
      v_fail := pg_catalog.array_append(v_fail, '③ 找不到「無稅、未收款、有品項、未取消」的單 ⇒ 行為格做不了(拋棄式 PG 要先種)');
    ELSE
      -- 管理者閘(20260915040000)要 actor 是 is_manager:用 staff 表裡第一個 is_manager AND is_active 的人;沒有就種一個
      IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.is_manager AND s.is_active) THEN
        INSERT INTO public.staff (id, label, is_manager, is_active) VALUES ('zzq953mgr', 'zzq 953 manager', true, true);
      END IF;
      SELECT public.admin_update_order_item_amount(
               v_ord, v_item, v_price + 7, v_ver,
               (SELECT s.id FROM public.staff s WHERE s.is_manager AND s.is_active ORDER BY s.id LIMIT 1),
               'zzq-953-p2-after-check', NULL) INTO v_res;
      SELECT * INTO v_after FROM public.orders WHERE id = v_ord;
      IF v_res IS DISTINCT FROM 'OK' THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ RPC 回 %s(不是 OK)', v_res));
      ELSIF v_after.version IS DISTINCT FROM v_ver + 1
         OR (SELECT oi.unit_price FROM public.order_items oi WHERE oi.id = v_item) IS DISTINCT FROM v_price + 7 THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ RPC 回 OK 但沒真的改到(version %s→%s, unit_price 期望 %s)', v_ver, v_after.version, v_price + 7));
      ELSIF v_after.total IS DISTINCT FROM public.pcm_order_total(v_after.subtotal, v_after.shipping_fee, v_after.discount_total, v_after.tax_total) THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ 改價後 total=%s ≠ pcm_order_total(%s,%s,%s,%s)=%s',
          v_after.total, v_after.subtotal, v_after.shipping_fee, v_after.discount_total, v_after.tax_total,
          public.pcm_order_total(v_after.subtotal, v_after.shipping_fee, v_after.discount_total, v_after.tax_total)));
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ 改價那一發炸了(%s %s)', SQLSTATE, SQLERRM));
  END;

  -- ④ 行為格:真的建一張手動單(勾發票 ⇒ 有稅;運費 60;兩列未稅 1000 + 235)⇒ total ≡ pcm_order_total(...)
  --    且 = 1235 + 60 + round((1235+60)×0.05)=65 ⇒ 1360(逐位元)。payload 形狀抄 after-checks/130000-after-sqleditor.sql。
  BEGIN
    DECLARE
      v_cust uuid; v_staff text; v_oid uuid; v_o public.orders%ROWTYPE;
      v_ship jsonb := '{"name":"953 對帳","phone":"0900000000","line":"953 對帳地址"}'::jsonb;
      v_inv  jsonb := '{"type":"personal","requested":true}'::jsonb;
      v_line jsonb := '[{"variant_id":null,"title":"953-a","sku":"ZZQ953A","unit_price":1000,"qty":1,"spec":{}},{"variant_id":null,"title":"953-b","sku":"ZZQ953B","unit_price":235,"qty":1,"spec":{}}]'::jsonb;
    BEGIN
      SELECT c.user_id INTO v_cust FROM public.customers c LIMIT 1;
      SELECT s.id INTO v_staff FROM public.staff s WHERE s.is_active ORDER BY s.id LIMIT 1;
      IF v_cust IS NULL OR v_staff IS NULL THEN
        v_fail := pg_catalog.array_append(v_fail, '④ 這台庫沒有客人或員工 ⇒ 建單格做不了(拋棄式 PG 要先種)');
      ELSE
        v_oid := (public.admin_create_manual_order(
                    v_cust, pg_catalog.gen_random_uuid(), v_staff,
                    'manual_phone', 'bank_transfer', 'home',
                    v_ship, v_inv, 60, v_line, NULL, NULL, NULL) ->> 'order_id')::uuid;
        SELECT * INTO v_o FROM public.orders WHERE id = v_oid;
        IF v_o.id IS NULL THEN
          v_fail := pg_catalog.array_append(v_fail, '④ RPC 回了 order_id 但 orders 裡找不到那張單');
        ELSIF (v_o.subtotal, v_o.shipping_fee, v_o.discount_total, v_o.tax_total, v_o.total) IS DISTINCT FROM (1235, 60, 0, 65, 1360) THEN
          -- 無條件釘五個數(codex #2):1000+235 未稅、運費 60、無券、稅 round(1295×0.05)=65、總額 1360
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('④ 手動單 (subtotal,ship,disc,tax,total)=(%s,%s,%s,%s,%s) 期望 (1235,60,0,65,1360)',
            v_o.subtotal, v_o.shipping_fee, v_o.discount_total, v_o.tax_total, v_o.total));
        ELSIF v_o.total IS DISTINCT FROM public.pcm_order_total(v_o.subtotal, v_o.shipping_fee, v_o.discount_total, v_o.tax_total) THEN
          v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('④ 手動單 total=%s ≠ pcm_order_total(...)=%s',
            v_o.total, public.pcm_order_total(v_o.subtotal, v_o.shipping_fee, v_o.discount_total, v_o.tax_total)));
        END IF;
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('④ 建手動單那一發炸了(%s %s)', SQLSTATE, SQLERRM));
  END;

  IF pg_catalog.cardinality(v_fail) > 0 THEN
    RAISE EXCEPTION '🔴 20260915060000 after-check 紅 % 格:%', pg_catalog.cardinality(v_fail), pg_catalog.array_to_string(v_fail, ' ‖ ');
  END IF;
  RAISE NOTICE '✅ 20260915060000 after-check 全過(①三支呼叫函式 ②舊字面不在 ③改價後 total ≡ 函式 ④手動單 total ≡ 函式)';
END
$chk$;

ROLLBACK;
