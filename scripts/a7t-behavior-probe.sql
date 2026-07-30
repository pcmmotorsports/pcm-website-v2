-- ============================================================
-- A7-t 行為探針 —— 取消帳本主從一致 CONSTRAINT TRIGGER
-- ============================================================
-- 片級 plan:docs/specs/2026-07-30-e10-a7t-cancellation-consistency-trigger-plan.md(v2)
-- migration:supabase/migrations/20260730140000_m4b_e10_a7t_cancellation_consistency_triggers.sql
-- 可重現驗證:scripts/a7t-verify.sh
--
-- 🔴 **為什麼是獨立檔、不併進 scripts/a7-behavior-probe.sql**(關卡1 codex must-fix):
--    A7-2 的探針 7/8/19/20/29 都是**刻意的零明細 header**。任何 `SET CONSTRAINTS ... IMMEDIATE`
--    會引爆它們累積的 pending 事件 ⇒ 既有 36 條當場全崩。
--    ⚠️ 那些 fixture **在交易中段本來就合法**(DEFERRED 的本義)—— 不是「production 非法」。
--    ⇒ A7-2 **一個字不改**,本檔另起爐灶。
--
-- 🔴 **為什麼需要 SET CONSTRAINTS**:本片 trigger 是 `DEFERRABLE INITIALLY DEFERRED`
--    = COMMIT 時才檢查,而本檔(同 A7-2)整份 ROLLBACK、**永不 COMMIT**。
--    直接照抄 A7-2 架構的話,**trigger 一次都不會被觸發,而探針會全綠** = 架構層假綠。
--    ⇒ 每個案例用 `SET CONSTRAINTS <具名> IMMEDIATE` 當「模擬 COMMIT 的檢查點」。
--    規劃期實測(本機 PG17.10,9/0 含消融對照):該指令對 CONSTRAINT TRIGGER 生效;
--    具名可行 ⇒ 不波及 FK 與 order_refunds 的五支。
--
-- 🔴 **為什麼復位寫在每個案例的「開頭」而不是結尾**:
--    實測:`SET CONSTRAINTS` 的效力**在交易裡持續**。負向案例因例外被子交易回滾 ⇒ 模式自動還原;
--    但**正向案例不會回滾** ⇒ IMMEDIATE 外漏 ⇒ 下一個兩段式合法流程在插 header 當下被誤擋(實測)。
--    結尾復位會被例外路徑跳過;**開頭復位則不論前一個案例怎麼結束都成立**。
--    案例 11 是這條紀律的專屬守門(拿掉開頭復位,它必須轉紅)。
--
-- 🔴 **判定紀律(升級 A7-2 的版本)**:A7-2 認「兩句成功 NOTICE 都出現」,
--    而那仍可假綠 —— 案例被註解掉或提早 RETURN,尾端 NOTICE 照樣印(codex must-fix)。
--    ⇒ 本檔逐案例印 `A7T-CASE-<n>-OK` 唯一 marker,harness **核對集合與數量**,
--      並要求零非預期錯誤。少一個案例當場抓得到。
--
-- 🔴 誠實邊界:本機 PG17 非 Supabase、auth.uid() 是 shim、C locale ≠ 正式站 en_US.UTF-8。
--    本片 trigger 是 count(*) 與 uuid 比對,零字元類、零 collation 依賴 ⇒ #305 對本片可轉移。
--    **本檔不驗併發** —— plan §2.0 立場:漏洞真實存在但觸發前提(有人刪改明細)在現行規劃內不成立。
-- ============================================================

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';

-- ══ 環境閘:**正向白名單**,不是黑名單 ═══════════════════════════════════════
-- 🔴 關卡2 對 A7-2 抓過:黑名單式環境閘(「不是這幾個 cluster 就放行」)對 staging
--    傳它自己的 cluster id 就會通過。⇒ 本檔要求「這個庫**主動標記過**自己是拋棄式」。
DO $$
BEGIN
  IF to_regclass('public.pcm_a7_probe_allowed') IS NULL THEN
    RAISE EXCEPTION 'A7-t 探針拒絕執行:本庫未標記為拋棄式測試庫'
      '(需存在 public.pcm_a7_probe_allowed)。本檔會寫入合成資料,絕不可對正式站執行';
  END IF;
END;
$$;

DO $$
DECLARE
  v_cust     uuid;
  v_actor    text;
  v_order_a  uuid;
  v_order_b  uuid;
  v_item_a1  uuid;
  v_item_a2  uuid;
  v_item_b1  uuid;
  v_ca       uuid;
  v_cb       uuid;
  v_tmp      uuid;
  v_cnt      integer;
  v_hash     text := repeat('a', 64);
  v_pass     integer := 0;
  v_err      text;
  v_state    text;
BEGIN
  -- ══ fixture ═══════════════════════════════════════════════════════════════
  -- 借用既有客戶與員工(customer_user_id / actor 都是 NOT NULL + FK)。
  -- 這是本檔對環境的唯一依賴,且是可斷言的硬前提,**不是**可略過的分支。
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN
    RAISE EXCEPTION 'fixture 失敗:customers 為空,無法合成訂單';
  END IF;

  SELECT id INTO v_actor FROM public.staff ORDER BY id LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'fixture 失敗:staff 為空,order_cancellations.actor 有 FK 到 staff';
  END IF;

  -- display_id 用 PCM-9998-xxxx(A7-2 用 9999,兩檔互不干擾);不呼叫 nextval ⇒ 不佔號。
  SELECT count(*) INTO v_cnt FROM public.orders
   WHERE display_id IN ('PCM-9998-0001', 'PCM-9998-0002');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'fixture 失敗:合成 display_id 已存在 % 筆(不該發生)', v_cnt;
  END IF;

  INSERT INTO public.orders
    (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
     subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9998-0001', v_cust,
          jsonb_build_object('name', 'A7-t 探針', 'phone', '0900000000', 'line', '測試地址'),
          'general'::public.member_tier, 3000, 100, 3100, 'home',
          jsonb_build_object('type', 'personal'))
  RETURNING id INTO v_order_a;

  INSERT INTO public.orders
    (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
     subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9998-0002', v_cust,
          jsonb_build_object('name', 'A7-t 探針', 'phone', '0900000000', 'line', '測試地址'),
          'general'::public.member_tier, 500, 100, 600, 'home',
          jsonb_build_object('type', 'personal'))
  RETURNING id INTO v_order_b;

  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order_a, 'A7T-SKU-1',
          jsonb_build_object('title', 'A7-t 商品 1', 'sku', 'A7T-SKU-1',
                             'spec', jsonb_build_object('color', 'black')),
          2, 1000, 2000)
  RETURNING id INTO v_item_a1;

  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order_a, 'A7T-SKU-2',
          jsonb_build_object('title', 'A7-t 商品 2', 'sku', 'A7T-SKU-2',
                             'spec', jsonb_build_object('color', 'red')),
          1, 1000, 1000)
  RETURNING id INTO v_item_a2;

  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order_b, 'A7T-SKU-3',
          jsonb_build_object('title', 'A7-t 商品 3', 'sku', 'A7T-SKU-3',
                             'spec', jsonb_build_object('color', 'blue')),
          1, 500, 500)
  RETURNING id INTO v_item_b1;

  RAISE NOTICE 'A7T fixture 就緒(2 單 / 3 品項 / actor=%)', v_actor;

  -- ══ 案例 12(正向):**宣告預設值**就是 DEFERRED ═══════════════════════════
  -- 🔴 **必須排在所有其他案例之前** —— 它測的是 trigger 宣告裡的 INITIALLY DEFERRED,
  --    而任何先前案例的 `SET CONSTRAINTS` 都會把模式蓋掉、讓本案例失去意義。
  -- 🔴 為什麼需要這條(初版漏掉、被自己的突變測試抓到):其他每個案例開頭都顯式設 DEFERRED,
  --    ⇒ 把 trigger 改成 `INITIALLY IMMEDIATE` 時**所有案例照樣全綠**。
  --    而 A8a1 上線後**不會呼叫 SET CONSTRAINTS**,它靠的就是這個宣告預設值
  --    ⇒ 沒有這條,探針驗的是一個 production 走不到的模式。
  -- 做法:完全不碰 SET CONSTRAINTS,只插 header。
  --    INITIALLY DEFERRED ⇒ 這一句不該報錯(檢查留到交易結束);
  --    INITIALLY IMMEDIATE ⇒ 這一句當場就炸。
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'customer_request', gen_random_uuid(), v_hash, v_actor)
    RETURNING id INTO v_tmp;
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_tmp, v_order_a, v_item_a1, 1);
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-12-OK';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '探針 12 失敗:插 header 當下就被擋 ⇒ trigger 的宣告預設值不是 INITIALLY DEFERRED(%)', SQLERRM;
  END;

  -- ══ 案例 1(正向):兩段式 —— 先插 header、再插明細 ════════════════════════
  -- 這是 A8a1/A8a2 的真實形狀。DEFERRED 的存在理由就是不能在插完 header 那一瞬間就擋。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'customer_request', gen_random_uuid(), v_hash, v_actor)
    RETURNING id INTO v_ca;

    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_ca, v_order_a, v_item_a1, 1);

    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-1-OK';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '探針 1 失敗:合法的兩段式取消被誤擋(%)', SQLERRM;
  END;

  -- ══ 案例 2(負向):只有 header、零明細 ═══════════════════════════════════
  -- 🔴 這是本片的存在理由。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'out_of_stock', gen_random_uuid(), v_hash, v_actor);

    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    RAISE EXCEPTION '探針 2 失敗:零明細 header 竟然通過';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P0001' OR position('沒有任何品項明細' in v_err) = 0 THEN
      RAISE EXCEPTION '探針 2 失敗:被擋了但不是本片的 RAISE(sqlstate=% / %)', v_state, v_err;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-2-OK';
  END;

  -- ══ 案例 3(正向):同交易內先零明細、後補上 ══════════════════════════════
  -- DEFERRED 的合法修復路徑:中途暫時失衡不該被擋,只看交易結束那一刻。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_b, 'price_change', gen_random_uuid(), v_hash, v_actor)
    RETURNING id INTO v_cb;

    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_cb, v_order_b, v_item_b1, 1);
    DELETE FROM public.order_cancellation_items WHERE cancellation_id = v_cb;
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_cb, v_order_b, v_item_b1, 1);

    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-3-OK';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '探針 3 失敗:暫時零明細後補回竟被擋(%)', SQLERRM;
  END;

  -- ══ 案例 4(負向):刪光明細 ═════════════════════════════════════════════
  -- 🔴 這條只有**子表**那支 trigger 抓得到(header 表那支不會因刪明細而觸發)。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  -- 🔴 **setup 與正向 flush 刻意放在 exception block 之外**(關卡2 codex must-fix):
  --    原版把它們包進同一個 `WHEN others`,一旦 setup 階段誤拋含「沒有任何品項明細」的錯,
  --    **DELETE 根本沒執行**卻照樣 v_pass+1 ⇒ 這條負向案例變成永遠通過。
  --    現在 setup 失敗會直接讓整份腳本炸掉(那本來就該是失敗),catch 只包被測的 DELETE。
  INSERT INTO public.order_cancellations
    (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order_a, 'long_leadtime', gen_random_uuid(), v_hash, v_actor)
  RETURNING id INTO v_tmp;
  INSERT INTO public.order_cancellation_items
    (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_tmp, v_order_a, v_item_a1, 1);
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    DELETE FROM public.order_cancellation_items WHERE cancellation_id = v_tmp;
    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    RAISE EXCEPTION '探針 4 失敗:刪光明細後 header 竟然還活著';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P0001' OR position('沒有任何品項明細' in v_err) = 0 THEN
      RAISE EXCEPTION '探針 4 失敗:被擋了但不是本片的 RAISE(sqlstate=% / %)', v_state, v_err;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-4-OK';
  END;

  -- ══ 案例 5(正向):刪二留一 ═════════════════════════════════════════════
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'duplicate_order', gen_random_uuid(), v_hash, v_actor)
    RETURNING id INTO v_tmp;
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_tmp, v_order_a, v_item_a1, 1), (v_tmp, v_order_a, v_item_a2, 1);
    DELETE FROM public.order_cancellation_items
     WHERE cancellation_id = v_tmp AND order_item_id = v_item_a2;

    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-5-OK';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '探針 5 失敗:刪二留一竟被擋(%)', SQLERRM;
  END;

  -- ══ 案例 6(負向):明細從 A 移掛到 B,A 變零明細 ═════════════════════════
  -- 🔴 證「UPDATE 必須同時驗 OLD 與 NEW」—— 只驗 NEW(B)的話 B 合計正確、整筆照樣過。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  -- 🔴 setup 與正向 flush 在 exception block 之外(理由同案例 4)
  INSERT INTO public.order_cancellations
    (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order_a, 'customer_request', gen_random_uuid(), v_hash, v_actor)
  RETURNING id INTO v_ca;
  INSERT INTO public.order_cancellations
    (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order_a, 'out_of_stock', gen_random_uuid(), v_hash, v_actor)
  RETURNING id INTO v_cb;
  INSERT INTO public.order_cancellation_items
    (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_ca, v_order_a, v_item_a1, 1);
  INSERT INTO public.order_cancellation_items
    (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_cb, v_order_a, v_item_a2, 1);
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;

  -- 把 A 唯一那列改掛到 B ⇒ A 變零明細,而 B 仍有明細
  BEGIN
    UPDATE public.order_cancellation_items
       SET cancellation_id = v_cb
     WHERE cancellation_id = v_ca;
    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    RAISE EXCEPTION '探針 6 失敗:明細移掛後原 header 變零明細卻通過(UPDATE 只驗了 NEW?)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P0001' OR position('沒有任何品項明細' in v_err) = 0 THEN
      RAISE EXCEPTION '探針 6 失敗:被擋了但不是本片的 RAISE(sqlstate=% / %)', v_state, v_err;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-6-OK';
  END;

  -- ══ 案例 7(負向):A 空 / B 有明細 —— 證關聯條件 ═══════════════════════════
  -- 🔴 函式若誤寫成算**全表** items,只要 B 有明細,空的 A 就會過關。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_b, 'internal_error', gen_random_uuid(), v_hash, v_actor)
    RETURNING id INTO v_cb;
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_cb, v_order_b, v_item_b1, 1);

    -- A:同交易內另開一個 header,一列明細都不給
    -- 🔴 **刻意不用 `'other'`**:A7-1 的 reason_detail 雙向 CHECK 要求 `other` 必填非空白
    --    ⇒ 用 `other` 會被那條 CHECK 先擋下、噴 check_violation,本案例就變成在測別人的約束
    --    (初版真的這樣寫、被自己的 harness 當場抓到:探針全綠條件不成立)。
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'duplicate_order', gen_random_uuid(), v_hash, v_actor);

    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    RAISE EXCEPTION '探針 7 失敗:空 header 因為別的 header 有明細而過關(關聯條件被省了?)';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P0001' OR position('沒有任何品項明細' in v_err) = 0 THEN
      RAISE EXCEPTION '探針 7 失敗:被擋了但不是本片的 RAISE(sqlstate=% / %)', v_state, v_err;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-7-OK';
  END;

  -- ══ 案例 8(正向):header 與明細同交易內一起刪掉 ═══════════════════════════
  -- 證 `CONTINUE WHEN NOT FOUND`:header 都不在了,沒有不變式可驗,不該 RAISE。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'price_change', gen_random_uuid(), v_hash, v_actor)
    RETURNING id INTO v_tmp;
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_tmp, v_order_a, v_item_a1, 1);
    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;

    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
    DELETE FROM public.order_cancellation_items WHERE cancellation_id = v_tmp;
    DELETE FROM public.order_cancellations WHERE id = v_tmp;
    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-8-OK';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '探針 8 失敗:整筆取消同交易刪除竟被擋(CONTINUE WHEN NOT FOUND 失效?)(%)', SQLERRM;
  END;

  -- ══ 案例 9 / 10(負向):TRUNCATE 兩表任一都必須被擋 ═══════════════════════
  -- 🔴 row-level trigger 對 TRUNCATE 完全不觸發 ⇒ 沒有這兩支 statement-level 攔截,
  --    明細會歸零而 header 全部保留 = 不變式靜默失效。
  BEGIN
    TRUNCATE TABLE public.order_cancellation_items;
    RAISE EXCEPTION '探針 9 失敗:order_cancellation_items 竟然被 TRUNCATE 成功';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P0001' OR position('禁止 TRUNCATE' in v_err) = 0 THEN
      RAISE EXCEPTION '探針 9 失敗:被擋了但不是本片的 RAISE(sqlstate=% / %)', v_state, v_err;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-9-OK';
  END;

  BEGIN
    TRUNCATE TABLE public.order_cancellations CASCADE;
    RAISE EXCEPTION '探針 10 失敗:order_cancellations 竟然被 TRUNCATE 成功';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_state <> 'P0001' OR position('禁止 TRUNCATE' in v_err) = 0 THEN
      RAISE EXCEPTION '探針 10 失敗:被擋了但不是本片的 RAISE(sqlstate=% / %)', v_state, v_err;
    END IF;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-10-OK';
  END;

  -- ══ 案例 11(正向):緊接在正向案例之後的兩段式流程 ═══════════════════════
  -- 🔴 **這條是「每案例開頭復位」那道紀律的專屬守門。**
  --    正向案例不會回滾 ⇒ 它留下的 IMMEDIATE 模式會外漏(實測);
  --    若把各案例開頭的 `SET CONSTRAINTS ... DEFERRED` 拿掉,本案例會在插 header 那一句當場被誤擋。
  --    沒有這條,那道紀律自己沒有守門。
  SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac DEFERRED;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_b, 'customer_request', gen_random_uuid(), v_hash, v_actor)
    RETURNING id INTO v_tmp;
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_tmp, v_order_b, v_item_b1, 1);

    SET CONSTRAINTS order_cancellations_items_presence_ac, order_cancellation_items_presence_ac IMMEDIATE;
    v_pass := v_pass + 1;
    RAISE NOTICE 'A7T-CASE-11-OK';
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION '探針 11 失敗:前一個正向案例的 IMMEDIATE 外漏、污染了本案例(%)', SQLERRM;
  END;

  -- ══ 收尾:案例數必須精確 ═══════════════════════════════════════════════════
  IF v_pass <> 12 THEN
    RAISE EXCEPTION 'A7-t 行為驗收失敗:通過案例數 = %,預期 12(有案例被跳過或註解掉?)', v_pass;
  END IF;

  RAISE NOTICE 'A7-t 行為驗收全數通過(12 / 12)';
END;
$$;

ROLLBACK;

-- ══ 交易外零殘留複驗 ════════════════════════════════════════════════════════
-- 🔴 上面整份 ROLLBACK,但「應該回滾了」和「驗過真的沒留下」是兩回事。
DO $$
DECLARE
  v_o integer; v_c integer; v_i integer;
BEGIN
  SELECT count(*) INTO v_o FROM public.orders WHERE display_id LIKE 'PCM-9998-%';
  SELECT count(*) INTO v_c FROM public.order_cancellations;
  SELECT count(*) INTO v_i FROM public.order_cancellation_items;
  IF v_o <> 0 THEN
    RAISE EXCEPTION 'A7-t 零殘留複驗失敗:合成訂單殘留 % 筆', v_o;
  END IF;
  IF v_c <> 0 OR v_i <> 0 THEN
    RAISE EXCEPTION 'A7-t 零殘留複驗失敗:取消表殘留 header % / items %', v_c, v_i;
  END IF;
  RAISE NOTICE 'A7-t 零殘留複驗通過';
END;
$$;
