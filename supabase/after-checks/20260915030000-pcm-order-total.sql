-- 20260915030000-pcm-order-total.sql — #953 P1 的驗收斷言(拋棄式 PG 跑;正式庫也能跑,零寫入:整包 ROLLBACK)。
--
-- 為什麼在這裡不在 supabase/tests/database/(pgTAP):本機與 repo 都沒有 pgtap extension,而 after-checks/ 是本 repo
-- 放「psql 直接貼的 DO-block 斷言」的地方。斷言與 plan 寫的 pgTAP 一樣,多一格突變。
--
-- 跑法:psql -h /tmp -p <PG> -U postgres -d postgres -v ON_ERROR_STOP=1 -f supabase/after-checks/20260915030000-pcm-order-total.sql
--   全綠 ⇒ 印「✅ 20260915030000 after-check 全過」然後 ROLLBACK(它自己造的列不留)。
--   任一格紅 ⇒ **每一格都跑完**再一次 RAISE 列出所有紅的(codex R1 #4:第一格炸掉會遮住後面的格)。
--   🔴 庫裡沒有 orders 列 ⇒ 行為格 ⑤ 做不了 ⇒ **紅,不是跳過**(拋棄式 PG 要先種一張單;replay-from-zero 那種空庫不算過)。
--
-- 🔴 突變證明(plan §2-c「不管選哪個,都要有一發突變證明它會咬」):
--   在拋棄式 PG 上把函式體的 `+ p_tax_total` 拿掉再跑本檔 ⇒ ③ 與 ⑤a **都必須紅**(2026-09-14 實跑結果在 P1 commit body)。

BEGIN;

-- 造列要跳過 trigger(order_item_quantity_summary 重算會撞 CHECK)—— 本交易結尾 ROLLBACK,不留痕。
SET LOCAL session_replication_role = replica;

DO $chk$
DECLARE
  v_fail  text[] := ARRAY[]::text[];
  v_def   text;
  v_src   uuid;
  v_new   uuid;
  v_state text;
  v_con   text;
  v_rows  bigint;
  v_fn    constant text := 'public.pcm_order_total(integer,integer,integer,integer)';
BEGIN
  -- ① CHECK 呼叫函式(限定 orders 那一條;conname 不是全庫唯一)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conname = 'orders_total_balances' AND c.conrelid = 'public.orders'::regclass;
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'pcm_order_total(') = 0 THEN
    v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('① CHECK 沒有呼叫 pcm_order_total(%s)', v_def));
  END IF;

  -- ② 函式 IMMUTABLE、回 bigint;EXECUTE:postgres(所有寫 orders 的 DEFINER RPC 的 owner)有、三個 API 角色沒有
  -- 函式不存在時 has_function_privilege 會 throw ⇒ ②③④ 各自包住,一格炸不遮別格(codex R2 #2)
  IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
    v_fail := pg_catalog.array_append(v_fail, '② pcm_order_total 不存在 ⇒ ②③④ 都驗不了(migration 沒貼?)');
  ELSE
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                      WHERE p.oid = pg_catalog.to_regprocedure(v_fn)
                        AND p.provolatile = 'i' AND p.prorettype = 'pg_catalog.int8'::regtype) THEN
        v_fail := pg_catalog.array_append(v_fail, '② pcm_order_total 不是 IMMUTABLE / 不回 bigint');
      END IF;
      IF NOT pg_catalog.has_function_privilege('postgres', v_fn, 'EXECUTE') THEN
        v_fail := pg_catalog.array_append(v_fail, '② postgres 不能 EXECUTE pcm_order_total ⇒ 每一支寫 orders 的 RPC 都會炸');
      END IF;
      IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
         OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
         OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
        v_fail := pg_catalog.array_append(v_fail, '② anon / authenticated / service_role 之一能 EXECUTE pcm_order_total(REVOKE 沒收乾淨)');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('② 檢查本身炸了(%s %s)', SQLSTATE, SQLERRM));
    END;

    -- ③ 值格(等式少一項 / 順序反 / 回 NULL ⇒ 這裡紅;IS DISTINCT FROM 不是 <>,NULL 也要紅)
    BEGIN
      IF public.pcm_order_total(1000, 100, 0, 55) IS DISTINCT FROM 1155
         OR public.pcm_order_total(1000, 100, 200, 45) IS DISTINCT FROM 945
         OR public.pcm_order_total(0, 0, 0, 0) IS DISTINCT FROM 0 THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ 值不對:(1000,100,0,55)=%s (1000,100,200,45)=%s',
          public.pcm_order_total(1000, 100, 0, 55), public.pcm_order_total(1000, 100, 200, 45)));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('③ 函式呼叫炸了(%s %s)', SQLSTATE, SQLERRM));
    END;

    -- ④ 既有列全數通過(重驗一次:與 CHECK 同一句;NULL 結果也算不滿足)
    BEGIN
      SELECT count(*) INTO v_rows FROM public.orders o
       WHERE o.total IS DISTINCT FROM public.pcm_order_total(o.subtotal, o.shipping_fee, o.discount_total, o.tax_total);
      IF v_rows <> 0 THEN
        v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('④ 有 %s 列 orders 不滿足等式', v_rows));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('④ 重驗本身炸了(%s %s)', SQLSTATE, SQLERRM));
    END;
  END IF;

  -- ⑤ 行為格:複製一張真單當模板,四個金額欄【固定】成 1000 / 100 / 0 / 50(codex R1 #5:正負對照只准差 total),
  --    5a total 少加稅(1100)⇒ 必須被 orders_total_balances 擋下(用 CONSTRAINT_NAME 認,不只認 23514);
  --    5b total 加對(1150)⇒ 必須進得去。
  SELECT o.id INTO v_src FROM public.orders o ORDER BY o.created_at LIMIT 1;
  IF v_src IS NULL THEN
    v_fail := pg_catalog.array_append(v_fail, '⑤ orders 一列都沒有 ⇒ 行為格做不了(拋棄式 PG 要先種一張單;這一格沒驗到就不算過)');
  ELSE
    v_new := pg_catalog.gen_random_uuid();
    v_state := NULL; v_con := NULL;
    BEGIN
      INSERT INTO public.orders
        SELECT (pg_catalog.jsonb_populate_record(o, pg_catalog.jsonb_build_object(
                  'id', v_new, 'display_id', 'ZZQ953',
                  'legacy_display_id', NULL, 'cart_session_id', NULL, 'tappay_rec_trade_id', NULL, 'manual_request_id', NULL,
                  'subtotal', 1000, 'shipping_fee', 100, 'discount_total', 0, 'tax_total', 50,
                  'total', 1100))).*
          FROM public.orders o WHERE o.id = v_src;
      v_state := 'no_error';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;  -- 別的錯也記下來,不中止整包
    END;
    IF v_state IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'orders_total_balances' THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('⑤a 少加稅的列沒有被 orders_total_balances 擋下(state=%s constraint=%s)⇒ CHECK 沒有咬', v_state, v_con));
    END IF;
    v_new := pg_catalog.gen_random_uuid();
    BEGIN
      INSERT INTO public.orders
        SELECT (pg_catalog.jsonb_populate_record(o, pg_catalog.jsonb_build_object(
                  'id', v_new, 'display_id', 'ZZQ95B',
                  'legacy_display_id', NULL, 'cart_session_id', NULL, 'tappay_rec_trade_id', NULL, 'manual_request_id', NULL,
                  'subtotal', 1000, 'shipping_fee', 100, 'discount_total', 0, 'tax_total', 50,
                  'total', 1150))).*
          FROM public.orders o WHERE o.id = v_src;
      IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_new) THEN
        v_fail := pg_catalog.array_append(v_fail, '⑤b 加對的列沒進去');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_fail := pg_catalog.array_append(v_fail, pg_catalog.format('⑤b 加對的列竟然被擋(%s %s)⇒ 5a 那個紅可能不是總額 CHECK 造成的', SQLSTATE, SQLERRM));
    END;
  END IF;

  IF pg_catalog.cardinality(v_fail) > 0 THEN
    RAISE EXCEPTION '🔴 20260915030000 after-check 紅 % 格:%', pg_catalog.cardinality(v_fail), pg_catalog.array_to_string(v_fail, ' ‖ ');
  END IF;
  RAISE NOTICE '✅ 20260915030000 after-check 全過(①CHECK 呼叫函式 ②IMMUTABLE/bigint/EXECUTE ③值 ④既有列 ⑤a 擋 ⑤b 放)';
END
$chk$;

ROLLBACK;
