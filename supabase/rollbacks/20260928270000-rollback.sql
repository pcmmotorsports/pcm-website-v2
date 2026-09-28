-- 退回 20260928270000(退貨收回第 4 片:全部退貨也退券)
-- 順序:先把兩支函式換回舊本體(逐字取自 20260911170000 與 20260927010000, SET 子句照抄), 再刪 helper。
-- 反過來的話, 中間每一筆退款與收回退貨都會因為找不到 helper 而出錯。
-- 已經因為本片退回的券不會自動收回;要收回得人工把那幾列 coupon_redemptions.reverted_at 清掉。

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(uuid)'))
     IS DISTINCT FROM 'ebac84d54ca983c802922e22c1398c52'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
          WHERE p.oid = pg_catalog.to_regprocedure('public.admin_receive_return(uuid, uuid, text, jsonb, text)'))
     IS DISTINCT FROM '354ab2f180dcb57e85d0a2483c08f088' THEN
    RAISE EXCEPTION '退回前置閘:兩支函式不是 20260928270000 那一版 ⇒ 停(可能沒貼過, 或之後又被改過)。';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.coupon_revert_on_full_refund(p_order_id pg_catalog.uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $fn$
DECLARE
  -- 🔵 `v_moved` = 已經【真的出去】的錢(三段帳本相加, 口徑同匯流點 `20260907140000:165-180`)。
  --    ⚠️ 名字刻意與那一支的區域變數同名, 方便兩邊並排讀。
  v_moved           bigint;
  v_total           bigint;
  v_cancelled_at    pg_catalog.timestamptz;
  v_reverted        integer;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'coupon_revert_on_full_refund:p_order_id 不可為 NULL';
  END IF;

  -- 🔴 那張單在不在。查無 ⇒ 大聲失敗, 不要靜靜回 0
  --    (📌 「這張單沒有券」與「這張單不存在」都會讓 UPDATE 影響 0 列 ——
  --     兩個世界印同一個數字, 所以要在這裡先把它們分開。)
  SELECT o.cancelled_at, o.total INTO v_cancelled_at, v_total
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon_revert_on_full_refund:訂單 % 不存在', p_order_id;
  END IF;

  -- ── 判準(Q2 甲 = 看金額 · Q5 甲 = 取消就退)──────────────────────────────
  -- 🔴🔴🔴 **[codex R1 must-fix ①②]我第一版挑錯了尺, 兩個 must-fix 是同一個根。**
  --   ⛔ ~~v_total_remaining := public.pcm_order_refundable_remaining(p_order_id);
  --      IF v_total_remaining > 0 AND v_cancelled_at IS NULL THEN RETURN 0; END IF;~~
  --
  --   🎯 **我的理由是對的(重用管線自己的尺), 而我拿的是【另一把】**:
  --     `pcm_order_refundable_remaining` 答的是「**還能再退多少**」⇒ 它把
  --     `status='processing'`(還在飛的卡退)**也扣掉**, 因為額度要先保留住。
  --     ⇒ 🔴 **反例(codex 給的)**:total=1000 · confirmed=400 · processing=600
  --       ⇒ remaining = 0 ⇒ 舊版判「整筆退了」⇒ **退券**。而**實際只出去 400**;
  --       那 600 後來若失敗, 券已經**不可逆地**還回去了。
  --   🔴 **反例② 零元單**:全額折抵的單 total=0 · 零退款 ⇒ remaining=0 ⇒ **退券**,
  --       而**訂單仍然有效、折扣已經享用**, 那張券卻能再用在別張單上。
  --
  --   ✅ **要的是「已經真的出去多少錢」, 那把尺住在匯流點自己身上**
  --     `pcm_sync_order_refund_payment_status`(`20260907140000:165-180`)三段帳本相加:
  --       ① order_refunds        status='confirmed'
  --       ② order_manual_refunds voided_at IS NULL   ← 那張表沒有 status 欄, 作廢走 voided_at
  --       ③ order_refunds        status='failed' + failed_reason='manual_failed'
  --                              + effective_verdict.corrected_to='money_moved'
  --     而它的判準逐字是 `v_moved > 0 AND v_moved >= v_total`(同檔 `:195`)——
  --     🔴 **`v_moved > 0` 那一半就是專門擋零元單的**(`0 >= 0` 會成立), 而我第一版漏了它。
  --
  --   ══════════════════════════════════════════════════════════════════════════
  --   ✅ **[20260911170000] 已收成一份** —— 原本這裡是【第二份同口徑的碼】(三段加總逐字抄匯流點),
  --      而沒有東西在守「兩份一樣」。現在兩邊都呼 public.pcm_order_money_moved ⇒ 只剩一個地方可以改。
  --   🛑 那道「比對對方 prosrc 字面」的 apply 期釘子 2026-09-11 拿掉了, **不要再造一次**:
  --      本支版本號插隊到過去(20260901020500), 釘一個未來才出現的口徑 ⇒ 從零重建必失敗。
  --      全文在 20260901020500:147-172(已 apply 的檔不改, 那一段仍在原檔)。
  --   ══════════════════════════════════════════════════════════════════════════
  v_moved := public.pcm_order_money_moved(p_order_id);

  -- 🔴 Q5 甲 —— **取消就退券, 不管有沒有退過錢。**
  --
  -- ⚠️⚠️ **這一段的【理由】2026-09-11 訂正過, 而條件本身沒有改。**
  --    ⛔ ~~理由:券是在 `create_order` 建單當下就扣掉的, 不等付款 ⇒ 未付款就取消的單
  --       券已經被扣走而錢從來沒進來過 ⇒ 沒有任何退款函式會被呼到~~
  --    🔴 **那是假的, 而且它是我同一個錯誤前提的【第三個下游】**:
  --       `create_order` **不呼** `redeem_coupon`(剝行註解重量:raw 11 行 ⇒ real 0 行;
  --       🟢 正對照 `pcm_order_refundable_remaining` ⇒ real 4)。
  --    ✅ 而 Sean 2026-08-29 逐字拍過相反的話, 就寫在
  --       `20260829150000_m4b_coupon_p1_tables.sql:7,11`:
  --         「Q『用掉一次』什麼時候算 ⇒ 乙:**付款成功才算**」
  --         「⇒ 片2 落點:寫 redemption 的時機**綁付款成功那一步, 不綁建單**。」
  --       📌 **⇒ 未付款就取消的單【根本沒有 redemption 可退】** —— 那一類單不需要救。
  --
  -- ✅ **而 `OR` 仍然要留, 換一個真的理由**:
  --    **付款成功 ⇒ 扣券 ⇒ 之後取消, 而退款還沒真的執行**的那一段時間裡,
  --    `pcm_order_refundable_remaining` 仍然 > 0(錢還沒退出去), 而單已經取消。
  --    ⇒ 只看金額的話, 那張券要等到有人真的把退款做完才回得來;
  --      而 Sean Q5 甲逐字是「**取消就退券**」⇒ 不等那一步。
  --    🛑 所以這裡是 `OR` 不是 `AND` —— 拿掉它, Q5 甲就沒有被實作。
  --    🔵 而**取消那一支是獨立的**(codex R1 nit①):它不經過金額判準,
  --       所以上面 `v_moved > 0` 那道零元單的閘**不會**把「取消的零元單」擋掉 —— 那是對的。
  IF NOT ((v_moved > 0 AND v_moved >= v_total) OR v_cancelled_at IS NOT NULL) THEN
    -- 沒有整筆退、而且沒取消 ⇒ 不退券(Sean 2026-08-29 逐字「只有整筆退才退回券」)。
    RETURN 0;
  END IF;

  -- ── 動作(Q3 甲 = 冪等、不可逆)────────────────────────────────────────────
  -- 🔵 `reverted_at IS NULL` 這個條件本身就是冪等:第二次呼叫影響 0 列, 不覆寫、不報錯。
  -- 🛑 **不刪列** —— 後台券清單 view 的名額口徑是 `WHERE r.reverted_at IS NULL`,
  --    填上這一欄名額就自己回來, **那支 view 一個字都不用改**。
  -- 🔴🔴 **`reverted_by` 刻意【不寫】, 留 NULL** —— 而這一格是我自己差點寫錯的:
  --    第一版我寫 `reverted_by = 'coupon_revert_on_full_refund'`(想記「哪個機制退的」),
  --    而 `coupon_redemptions_reverted_by_fkey` 是 **FOREIGN KEY (reverted_by) REFERENCES
  --    staff(id)** ⇒ 📌 **那個字串不是任何一個員工的 id ⇒ 每一次退券都會違反外鍵而整筆炸掉。**
  --    ⚠️ 而它**不會在 apply 當下叫** —— apply 只建函式, 這一句要等到**真的有人退款**
  --       才第一次執行 ⇒ 🛑 **一個只在正式營運中才會現形的錯誤。**
  --    ✅ 留 NULL 是合法的:`coupon_redemptions_revert_pair` 的 CHECK 是
  --       `(reverted_by IS NULL) OR (reverted_at IS NOT NULL)` ⇒ 只填 `reverted_at` 過得了。
  --    🔵 語意也對:**這不是某個人退的, 是規則退的。** 要記到人得改簽章(而簽章被前置閘釘死)。
  UPDATE public.coupon_redemptions r
     SET reverted_at = pg_catalog.now()
   WHERE r.order_id = p_order_id
     AND r.reverted_at IS NULL;
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  RETURN v_reverted;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_receive_return(
  p_return_id  uuid,
  p_request_id uuid,
  p_actor      text,
  p_items      jsonb,
  p_note       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_ret      record;
  v_n        integer;
  v_note     text := nullif(pg_catalog.btrim(p_note), '');
  v_generic  constant text := '確認收到退貨失敗。請重新整理畫面後再試一次;若持續發生請回報系統管理員。';
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_receive_return: isolation guard';
  END IF;
  IF p_return_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF pg_catalog.btrim(coalesce(p_actor, '')) = '' THEN
    RAISE EXCEPTION '確認收到退貨:缺少操作人員, 請重新登入後再試。';
  END IF;

  SELECT order_id INTO v_ret FROM public.order_returns WHERE id = p_return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  -- 鎖的順序與登記相同:先訂單、再這筆退貨
  PERFORM 1 FROM public.orders WHERE id = v_ret.order_id FOR UPDATE;
  SELECT id, order_id, status INTO v_ret FROM public.order_returns WHERE id = p_return_id FOR UPDATE;

  IF v_ret.status = 'received' THEN
    IF EXISTS (SELECT 1 FROM public.admin_audit_log g
                WHERE g.request_id = p_request_id::text AND g.action = 'order.return.receive'
                  AND g.target = 'order:' || v_ret.order_id::text AND g.actor = p_actor
                  AND (g.after->>'return_id')::uuid = p_return_id) THEN
      RETURN pg_catalog.jsonb_build_object('return_id', p_return_id, 'idempotent', true);
    END IF;
    RAISE EXCEPTION '確認收到退貨:這筆退貨已經確認收到過了, 不需要再確認一次。';
  END IF;
  IF v_ret.status <> 'registered' THEN
    RAISE EXCEPTION '確認收到退貨:這筆退貨登記已作廢, 不能再確認收到。';
  END IF;

  IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
              WHERE pg_catalog.jsonb_typeof(el) <> 'object'
                 OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 3
                 OR NOT (el ? 'order_item_id') OR NOT (el ? 'received_quantity') OR NOT (el ? 'condition')
                 OR pg_catalog.jsonb_typeof(el->'order_item_id') <> 'string'
                 OR (el->>'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR pg_catalog.jsonb_typeof(el->'received_quantity') <> 'number'
                 OR (el->>'received_quantity') !~ '^[0-9]+$'
                 OR (el->>'received_quantity')::numeric > 2147483647
                 OR pg_catalog.jsonb_typeof(el->'condition') NOT IN ('string', 'null')) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  -- 必須剛好涵蓋這筆退貨的每一個品項(不多不少、不重複)
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_items))
       <> (SELECT pg_catalog.count(*) FROM public.order_return_items ri WHERE ri.return_id = p_return_id)
     OR EXISTS (SELECT 1 FROM public.order_return_items ri
                 WHERE ri.return_id = p_return_id
                   AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                         WHERE (el->>'order_item_id')::uuid = ri.order_item_id) <> 1) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
               JOIN public.order_return_items ri
                 ON ri.return_id = p_return_id AND ri.order_item_id = (el->>'order_item_id')::uuid
              WHERE (el->>'received_quantity')::integer > ri.quantity) THEN
    RAISE EXCEPTION '確認收到退貨:實收數量不能多於登記的退貨數量。';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
              WHERE ((el->>'received_quantity')::integer > 0) <> (pg_catalog.jsonb_typeof(el->'condition') = 'string')
                 OR (pg_catalog.jsonb_typeof(el->'condition') = 'string' AND (el->>'condition') NOT IN ('good', 'damaged'))) THEN
    RAISE EXCEPTION '確認收到退貨:有收到的品項請選擇商品狀況(良好或有損傷);沒收到的品項不用選。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                  WHERE (el->>'received_quantity')::integer > 0) THEN
    RAISE EXCEPTION '確認收到退貨:所有品項都是 0 件。客人沒有寄回的話, 請改用「作廢退貨登記」。';
  END IF;

  UPDATE public.order_return_items ri
     SET received_quantity = (el->>'received_quantity')::integer,
         condition = el->>'condition'
    FROM pg_catalog.jsonb_array_elements(p_items) e(el)
   WHERE ri.return_id = p_return_id AND ri.order_item_id = (el->>'order_item_id')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(p_items) THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  UPDATE public.order_returns
     SET status = 'received', received_by = p_actor, received_at = pg_catalog.now(), receive_note = v_note
   WHERE id = p_return_id AND status = 'registered';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.return.receive', 'order:' || v_ret.order_id::text, p_request_id::text,
          pg_catalog.jsonb_build_object('return_id', p_return_id, 'return_status', 'registered'),
          pg_catalog.jsonb_build_object('return_id', p_return_id, 'return_status', 'received', 'return_items', p_items),
          NULL, 'admin');

  RETURN pg_catalog.jsonb_build_object('return_id', p_return_id, 'idempotent', false);
END;
$fn$;

DROP FUNCTION public.pcm_order_fully_returned(uuid);

DO $post$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(uuid)')) IS DISTINCT FROM '49dc62fb5ebb0a1885423d24288143de'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
          WHERE p.oid = pg_catalog.to_regprocedure('public.admin_receive_return(uuid, uuid, text, jsonb, text)')) IS DISTINCT FROM 'fcac06af3de5d320c7b5eaca1f87af4a' THEN
    RAISE EXCEPTION '退回事後斷言:兩支函式沒有回到舊本體';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(uuid)')
                    AND p.proconfig = ARRAY['search_path=""', 'lock_timeout=3s']
                    AND p.proacl::text[] = ARRAY['postgres=X/postgres', 'service_role=X/postgres'])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.admin_receive_return(uuid, uuid, text, jsonb, text)')
                    AND p.proconfig = ARRAY['search_path=""', 'lock_timeout=5s']
                    AND p.proacl::text[] = ARRAY['postgres=X/postgres', 'service_role=X/postgres']) THEN
    RAISE EXCEPTION '退回事後斷言:SET 子句或 ACL 不是舊值';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_order_fully_returned(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '退回事後斷言:pcm_order_fully_returned 還在';
  END IF;
END
$post$;

COMMIT;
