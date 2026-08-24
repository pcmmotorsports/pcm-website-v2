-- 2026-08-24-858-orders-pair-valid-performs.sql
-- `orders_manual_request_pair_valid` 的【行為】斷言 —— 補窗B 2026-08-24 的 must-fix。
--
-- 🔴 它補的洞:那支 migration 的 apply-time `①-d`(:690-695)只
--    `SELECT count(*) … WHERE conname = '…pair_valid'` ⇒ **只驗它在不在,從不讓它表演**。
--    窗B 兩個世界對照:裝修好版與裝壞版, **印完全同一句話**。
--
-- 🔴🔴 **本檔【未實跑】。** 我(線C)手上沒有 DB。
--    缺的那一道檢查就是「真的跑它一次」;跑法在下面 §0。
--    ⇒ 在有人跑過並把輸出貼回來之前,**不得把本檔讀成「那道 CHECK 驗過了」**。
--
-- ⚠️ 字面層那一半在 `scripts/manual-request-pair-valid-guard.test.ts`(自動化在跑、突變驗過)。
--    兩件事不能互相冒充:那支全綠只證明【碼的字面】對,不證明庫裡那道 CHECK 對。
--
-- ── §0 跑法 ────────────────────────────────────────────────────────────────
--   前置:先跑 docs/probes/2026-08-24-858-manual-order-rpc-seed.sql(要有一位客人)
--   跑:  psql "$DSN" -v ON_ERROR_STOP=1 -f docs/probes/2026-08-24-858-orders-pair-valid-performs.sql
--   判準:**看 NOTICE,不要只看 exit code**。
--         五格全印「通過」⇒ 過。任何一格 RAISE EXCEPTION ⇒ 整支 rc=3(ON_ERROR_STOP)。
--   🔴 全檔包在 BEGIN … ROLLBACK 裡 ⇒ **零留痕**,可重複跑。
--      (自檢:跑完 `SELECT count(*) FROM public.orders` 應與跑前相同)

BEGIN;

DO $probe$
DECLARE
  v_con  text;
  v_uid  uuid;
  v_sha  text := repeat('a', 64);
  v_pass int := 0;
BEGIN
  SELECT c.user_id INTO v_uid FROM public.customers c LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '前置未滿足:public.customers 是空的 ⇒ 先跑 …-manual-order-rpc-seed.sql';
  END IF;

  -- ── 正對照①:兩欄都 NULL(既有的 web 單就長這樣)⇒ **必須存得進去** ──────────
  -- 🔴 少了正對照, 一道【恆擋】的 CHECK 也會讓下面三格負測全過。
  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice)
  VALUES (public.pcm_generate_display_id(), v_uid, NULL,
    '{"name":"探針","phone":"0900000000","line":"探針地址"}'::jsonb, 'general',
    100, 0, 0, 100, 'home', '{"type":"personal"}'::jsonb);
  v_pass := v_pass + 1;
  RAISE NOTICE '正對照① 通過:兩欄皆 NULL 的列存得進去';

  -- ── 正對照②:合法的手動單(鍵在場 + 64 碼小寫 hex)⇒ **必須存得進去** ────────
  INSERT INTO public.orders (
    display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
    manual_request_id, manual_request_payload_sha256)
  VALUES (public.pcm_generate_display_id(), v_uid, NULL,
    '{"name":"探針","phone":"0900000000","line":"探針地址"}'::jsonb, 'general',
    100, 0, 0, 100, 'home', '{"type":"personal"}'::jsonb,
    pg_catalog.gen_random_uuid(), v_sha);
  v_pass := v_pass + 1;
  RAISE NOTICE '正對照② 通過:合法手動單列存得進去';

  -- ── 負測 N1:有鍵、指紋 NULL ⇒ **必須被擋, 而且要是【那一道】擋的** ───────────
  -- 🔴 這正是窗B 用來分辨兩個世界的那一列:壞版放行它(NULL ~ '…' 得到 NULL,
  --    而 CHECK 只擋 FALSE、放行 NULL)。
  BEGIN
    INSERT INTO public.orders (
      display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
      subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
      manual_request_id, manual_request_payload_sha256)
    VALUES (public.pcm_generate_display_id(), v_uid, NULL,
      '{"name":"探針","phone":"0900000000","line":"探針地址"}'::jsonb, 'general',
      100, 0, 0, 100, 'home', '{"type":"personal"}'::jsonb,
      pg_catalog.gen_random_uuid(), NULL);
    RAISE EXCEPTION 'N1 失敗 — 有鍵無指紋的毒化列【存進去了】⇒ 那道 CHECK 沒有表演';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    -- 🔴 「有沒有被擋」與「【誰】擋的」是兩個宣稱。只驗前者的話,
    --    表上任何一道別的 CHECK(金額 / 白名單鍵)擋下它, 這一格照樣會過。
    IF v_con IS DISTINCT FROM 'orders_manual_request_pair_valid' THEN
      RAISE EXCEPTION 'N1 失敗 — 被擋了, 而擋的是 %(不是 orders_manual_request_pair_valid)', v_con;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'N1 通過:有鍵無指紋 被 % 擋下', v_con;
  END;

  -- ── 負測 N2:有鍵、指紋格式錯(不是 64 碼小寫 hex)⇒ 必須被同一道擋 ───────────
  BEGIN
    INSERT INTO public.orders (
      display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
      subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
      manual_request_id, manual_request_payload_sha256)
    VALUES (public.pcm_generate_display_id(), v_uid, NULL,
      '{"name":"探針","phone":"0900000000","line":"探針地址"}'::jsonb, 'general',
      100, 0, 0, 100, 'home', '{"type":"personal"}'::jsonb,
      pg_catalog.gen_random_uuid(), 'NOT-A-SHA');
    RAISE EXCEPTION 'N2 失敗 — 指紋格式錯的列【存進去了】';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con IS DISTINCT FROM 'orders_manual_request_pair_valid' THEN
      RAISE EXCEPTION 'N2 失敗 — 擋的是 %', v_con;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'N2 通過:指紋格式錯 被 % 擋下', v_con;
  END;

  -- ── 負測 N3:反方向 —— 無鍵、有指紋 ⇒ 同生共死的另一半 ─────────────────────
  BEGIN
    INSERT INTO public.orders (
      display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
      subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
      manual_request_id, manual_request_payload_sha256)
    VALUES (public.pcm_generate_display_id(), v_uid, NULL,
      '{"name":"探針","phone":"0900000000","line":"探針地址"}'::jsonb, 'general',
      100, 0, 0, 100, 'home', '{"type":"personal"}'::jsonb,
      NULL, v_sha);
    RAISE EXCEPTION 'N3 失敗 — 無鍵有指紋的列【存進去了】';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con IS DISTINCT FROM 'orders_manual_request_pair_valid' THEN
      RAISE EXCEPTION 'N3 失敗 — 擋的是 %', v_con;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'N3 通過:無鍵有指紋 被 % 擋下', v_con;
  END;

  IF v_pass <> 5 THEN
    RAISE EXCEPTION '格數不符:過了 % 格, 應為 5 ⇒ 有格子被跳過了', v_pass;
  END IF;
  RAISE NOTICE '=== 五格全過(正對照 2 + 負測 3)===';
END
$probe$;

ROLLBACK;
