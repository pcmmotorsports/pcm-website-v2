-- ⟦b4-TAPPAYDIRECT⟧ 片 A2:作廢一筆補登 —— 用**新狀態 `voided`**, 不是「每支算錢函式各加一句」
--
-- ══ 🔴🔴 這一片的做法【換過一次】, 而換的理由值得留著 ═══════════════════════════
--   ⛔ ~~第一版:兩支算錢函式各加一句 `AND NOT (backfilled_source IS NOT NULL AND voided_at IS NOT NULL)`~~
--   codex R1 指出我漏了 `pcm_order_card_refunded`(它餵**取消信給客人看的金額**)。
--   🔬 我自己去掃正式庫(body 同時含 `order_refunds` + `confirmed` + `sum`)⇒ **四支**:
--     `admin_compute_order_settlement` · `coupon_redeem_order_problem` ·
--     `pcm_order_card_refunded` · `pcm_sync_order_refund_payment_status`
--     ⇒ **前兩支 codex 也沒找到**;加上 `pcm_order_refundable_remaining` ⇒ **至少五處**。
--   ⇒ 🎯 **codex 數到 3、我數到 5 —— 而【沒有人數得準】就是那個做法的根因。**
--   ✅ **mainB 裁乙(2026-09-07)**:五處的述詞都是 `status IN ('processing','confirmed')`
--     ⇒ **讓作廢的那一列 status 變成 `voided`, 五支一行不改就自動排除**,
--       而未來任何新 SUM 只要照既有述詞寫也自動對。
--   📌 **甲是把根因【守起來】(五支各加一句 + 一道只擋 DB 函式的閘);乙是把根因【消掉】。**
--
-- ══ 前置:貼板 69(`20260907020000`)必須先貼 ═══════════════════════════════════
-- 貼板 70(`20260907030000`)。A3(原子更正 RPC)另取號。

BEGIN;

-- ══ 0. 前置閘 ═══════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_cnt integer; v_control integer; v_def text;
BEGIN
  -- P1. A1 的七欄在
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('backfilled_source','backfill_attested_by','backfill_attested_at',
                     'backfill_occurred_at','voided_at','void_reason','voided_by');
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'A2 前置閘 P1:A1 的七欄只有 % 欄 ⇒ 先貼 20260907020000(貼板 69);拒繼續', v_cnt;
  END IF;

  -- 🔴 P2. **那道 CHECK 的【名字】必須是 `order_refunds_status_check`** ——
  --     `20260803150000:66-68` 有一道前置閘逐字在檢查這個名字還在不在
  --     ⇒ 本片 DROP + ADD **必須同名**, 否則那支 migration 的 apply 會炸。
  --     📌 這一格不是我想到的, 是我去讀「誰會受影響」時撞到的。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass AND conname = 'order_refunds_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'A2 前置閘 P2:找不到 order_refunds_status_check(名稱漂移?);拒繼續';
  END IF;
  -- 🔴 而它的**現值**要是我以為的那四態 —— 不然我等一下加的那一格會蓋掉別人的改動。
  IF pg_catalog.strpos(v_def, 'voided') > 0 THEN
    RAISE EXCEPTION 'A2 前置閘 P2b:那道 CHECK 已經含 voided ⇒ 本支已 apply 過;拒繼續(本支不冪等)';
  END IF;
  IF NOT (pg_catalog.strpos(v_def, 'processing') > 0 AND pg_catalog.strpos(v_def, 'confirmed') > 0
          AND pg_catalog.strpos(v_def, 'failed') > 0 AND pg_catalog.strpos(v_def, 'deferred') > 0) THEN
    RAISE EXCEPTION 'A2 前置閘 P2c:那道 CHECK 的現值不是我以為的四態(實得 %);拒繼續', v_def;
  END IF;

  -- P3. 狀態機 trigger 在, 而且綁著、開著
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.order_refunds'::regclass AND NOT t.tgisinternal
                    AND t.tgname = 'order_refunds_status_transition_bu' AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'A2 前置閘 P3:狀態機 trigger 不在或被停用;拒繼續';
  END IF;

  -- 🔴 P4. **那個 partial unique 的現值** —— 本片要改它, 先確認要改的是我以為的那一個。
  SELECT indexdef INTO v_def FROM pg_catalog.pg_indexes
   WHERE schemaname='public' AND tablename='order_refunds'
     AND indexname='order_refunds_tappay_refund_id_key';
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'tappay_refund_id IS NOT NULL') = 0 THEN
    RAISE EXCEPTION 'A2 前置閘 P4:tappay_refund_id 的 partial unique 不是我以為的形狀(實得 %);拒繼續',
                    COALESCE(v_def, '<不存在>');
  END IF;

  -- 🔵 P5. 正向對照
  SELECT count(*) INTO v_control FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('order_id','status','tappay_refund_id');
  IF v_control <> 3 THEN
    RAISE EXCEPTION 'A2 前置閘 P5(正向對照):三個既有欄只命中 % 個 ⇒ 我的量法壞了;拒繼續', v_control;
  END IF;

  RAISE NOTICE 'A2 前置閘 P1-P5 全過(P5 正向對照 = %)。', v_control;
END
$pre$;

-- ══ 1. CHECK 加 `voided`(🔴 DROP + ADD **同名**)═══════════════════════════
ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_status_check;
ALTER TABLE public.order_refunds
  ADD CONSTRAINT order_refunds_status_check
    CHECK (status IN ('processing', 'confirmed', 'failed', 'deferred', 'voided'));

-- ══ 1b. 🔴🔴 `order_refunds_confirmed_consistency` 也要改 —— 而**這一格是實跑抓到的** ══
--   它逐字是 `CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))`
--   ⇒ 一列從 confirmed 轉 voided 時:左邊變 FALSE、右邊仍是 TRUE ⇒ **當場違反**。
--   🔬 而我與 mainB 的落法**都沒有列到它** —— 是拋棄式 PG 上真的跑那一發作廢才紅出來的。
--   ⇒ 📌 **「改一個 status 值域」的影響面, 不是只有值域那道 CHECK。**
--   ✅ 所以我把**所有**提到 status 的約束一次列完(7 道 CHECK + 3 個索引), 逐一判:
--     · confirmed_consistency  ⇒ 🔴 **會壞**(見上)          · deferred_clean  ⇒ 🟢 status<>'deferred' 成立
--     · failed_consistency     ⇒ 🟢 FALSE = FALSE            · failed_detail_only_failed ⇒ 🟢 NULL
--     · processing_clean       ⇒ 🟢 status<>'processing'     · status_check ⇒ 🟢 本片已加 voided
--     · single_processing_per_order / processing_idx ⇒ 🟢 只看 processing
--     · tappay_refund_id_key ⇒ 🟢 本片已加 `status <> 'voided'`
--   ⇒ **只有一道要動。** 而改法要讓 voided 列**保留** confirmed_at(它確實曾經 confirmed,
--     而 4.3 結案欄 write-once 本來就不准抹掉它)。
--   🔴 **同名 DROP + ADD**(理由同 §1:別的 migration 可能按名字檢查)。
ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_confirmed_consistency;
ALTER TABLE public.order_refunds
  ADD CONSTRAINT order_refunds_confirmed_consistency
    CHECK ((confirmed_at IS NOT NULL) = (status IN ('confirmed', 'voided')));

-- 🔴 `voided` 與作廢三欄要**同進同出** —— 否則會出現「status 是 voided 而沒人知道誰作廢的」。
ALTER TABLE public.order_refunds
  ADD CONSTRAINT order_refunds_voided_pairs_with_columns
    CHECK ((status = 'voided') = (voided_at IS NOT NULL));

-- ══ 2. 狀態機:加**唯一一條**新邊 ═══════════════════════════════════════════
-- 🛑 條件寫死三個都要:**從 confirmed 來** + **去 voided** + **那一列是補登的**
--    ⇒ 一般卡片退款走不到這條邊(它的 `backfilled_source` 恆 NULL)。
--    ⚠️ 這裡讀 `OLD.backfilled_source` 而不是 NEW —— 補登身分是 INSERT 時決定的(A1 的 P7C22),
--       讀 NEW 會讓「同一次 UPDATE 裡把自己標成補登再作廢」變成一條路。
CREATE OR REPLACE FUNCTION public.pcm_order_refund_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;                                  -- 同值冪等重寫
  END IF;
  IF OLD.status = 'processing' AND NEW.status IN ('confirmed', 'failed', 'deferred') THEN
    RETURN NEW;                                  -- 唯三合法轉移
  END IF;
  -- 🔴 ⟦b4-TAPPAYDIRECT⟧ A2 新增的**唯一一條**邊。
  IF OLD.status = 'confirmed' AND NEW.status = 'voided'
     AND OLD.backfilled_source IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_refunds 狀態轉移非法 — % → %(confirmed/failed/deferred 皆為終態;'
                  'voided 只准由【補登】的 confirmed 列進入);拒繼續',
    OLD.status, NEW.status;
END;
$fn$;

-- ══ 3. partial unique 加 `AND status <> 'voided'` ═══════════════════════════
-- 🔴 **為什麼要改它**:作廢那一列**仍然佔著 DR 碼** ⇒「金額記錯 ⇒ 作廢後重新補登正確金額」
--    會撞 `order_refunds_tappay_refund_id_key`(codex R1 must-fix,我複驗成立)。
--    而那正是最常見的一種錯(同一筆 TapPay 退款、金額打錯)⇒ **我叫員工做的事他做不到。**
-- 🔬 **複量過沒有人拿它當 ON CONFLICT 的仲裁者**(memory:partial UNIQUE 當 arbiter 要帶相符 WHERE):
--    `grep 'ON CONFLICT' supabase/migrations/*.sql | grep tappay_refund_id` ⇒ **0**;
--    TS 端 `upsert` / `onConflict` 提到 `tappay_refund_id` ⇒ **0**。
--    🔵 正對照:同一把尺查全部 `ON CONFLICT` ⇒ **55 支檔有** ⇒ 尺是活的, 那兩個 0 算數。
DROP INDEX public.order_refunds_tappay_refund_id_key;
CREATE UNIQUE INDEX order_refunds_tappay_refund_id_key
  ON public.order_refunds (tappay_refund_id)
  WHERE tappay_refund_id IS NOT NULL AND status <> 'voided';

-- ══ 4. 作廢 RPC ═════════════════════════════════════════════════════════════
CREATE FUNCTION public.admin_void_backfilled_refund(
  p_refund_id uuid, p_actor text, p_reason text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_order uuid; v_src text; v_status text; v_void timestamptz;
BEGIN
  IF p_refund_id IS NULL THEN RAISE EXCEPTION 'admin_void_backfilled_refund: 缺 refund_id'; END IF;
  IF p_actor  IS NULL OR public.pcm_b2_is_blank(p_actor) THEN
    RAISE EXCEPTION 'admin_void_backfilled_refund: 缺【誰作廢的】—— 作廢是一個要留名的動作';
  END IF;
  IF p_reason IS NULL OR public.pcm_b2_is_blank(p_reason) THEN
    RAISE EXCEPTION 'admin_void_backfilled_refund: 缺【為什麼作廢】。'
                    '這一句是下一個看帳的人唯一能知道發生什麼事的地方';
  END IF;

  -- 🔴 先拿 order_id(只為了取鎖), 鎖順序沿既有約定 orders → order_refunds。
  SELECT r.order_id INTO v_order FROM public.order_refunds r WHERE r.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_void_backfilled_refund: 找不到退款 %', p_refund_id;
  END IF;
  PERFORM 1 FROM public.orders o WHERE o.id = v_order FOR NO KEY UPDATE;

  -- 🔴🔴 **取鎖【之後】重讀**(codex R1 must-fix:TOCTOU)。
  --    第一版我在取鎖前就讀 `voided_at` ⇒ 兩人同時作廢, 第二人拿的是舊值
  --    ⇒ 走到 UPDATE 才撞 A1 的 write-once(`P7C21`)⇒ **他看到的是一句嚇人的內部錯誤,
  --      而正確答案是「已經有人作廢過了」**。⇒ 重讀之後這條路變成 `ALREADY_VOIDED`。
  SELECT r.backfilled_source, r.status, r.voided_at INTO v_src, v_status, v_void
    FROM public.order_refunds r WHERE r.id = p_refund_id;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'admin_void_backfilled_refund: 退款 % 不是【補登】的, 不能用這條路作廢。'
                    '這是一筆我們自己發起的退款 —— 要更正它請走既有的更正入口', p_refund_id
      USING ERRCODE = 'P7C30';
  END IF;
  IF v_status = 'voided' OR v_void IS NOT NULL THEN RETURN 'ALREADY_VOIDED'; END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'admin_void_backfilled_refund: 退款 % 現在是 %, 只有 confirmed 的補登列作廢得了',
                    p_refund_id, v_status USING ERRCODE = 'P7C31';
  END IF;

  UPDATE public.order_refunds
     SET status = 'voided', voided_at = pg_catalog.now(), voided_by = p_actor, void_reason = p_reason
   WHERE id = p_refund_id;

  PERFORM public.pcm_sync_order_refund_payment_status(v_order);

  -- 🛑🛑 **本函式不觸發任何收款或退款** —— 那筆錢在外面已經出去了。
  --    作廢的意思是「**我們記錯了**」, 不是「把錢要回來」。
  RETURN 'VOIDED';
END;
$fn$;

COMMENT ON FUNCTION public.admin_void_backfilled_refund(uuid, text, text) IS
  '⟦b4-TAPPAYDIRECT⟧ A2:作廢一筆【補登】的退款 ⇒ status 轉 voided。'
  '🔴 五處算錢的地方述詞都是 status IN (processing, confirmed) ⇒ **它們一行不改就自動排除這一列**。'
  '🛑 不觸發任何收款或退款。⚠️ 金額記錯請走 admin_correct_backfilled_refund(A3, 同交易 void + 重補)——'
  '**不要自己先 void 再補**:那中間有一段窗口, 帳上會少算一筆真的動過的錢。';

REVOKE ALL ON FUNCTION public.admin_void_backfilled_refund(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_void_backfilled_refund(uuid, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_void_backfilled_refund(uuid, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_void_backfilled_refund(uuid, text, text) TO service_role;

-- ══ 5. 事後閘 ═══════════════════════════════════════════════════════════════
DO $post$
DECLARE
  v_def text; v_cnt integer;
  v_functions text[] := ARRAY['public.admin_void_backfilled_refund(uuid, text, text)']::text[];
  v_obj text; v_role text;
BEGIN
  -- ① CHECK 同名、含 voided
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_catalog.pg_constraint
   WHERE conrelid='public.order_refunds'::regclass AND conname='order_refunds_status_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'A2 事後閘①:約束名不見了 ⇒ 20260803150000 的前置閘會炸'; END IF;
  IF pg_catalog.strpos(v_def,'voided')=0 THEN RAISE EXCEPTION 'A2 事後閘①b:CHECK 沒有 voided'; END IF;
  -- ①c confirmed_consistency 改過了(同名), 而且 voided 列過得去
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_catalog.pg_constraint
   WHERE conrelid='public.order_refunds'::regclass AND conname='order_refunds_confirmed_consistency';
  IF v_def IS NULL OR pg_catalog.strpos(v_def,'voided')=0 THEN
    RAISE EXCEPTION 'A2 事後閘①c:confirmed_consistency 沒改到(實得 %)', COALESCE(v_def,'<不存在>');
  END IF;

  -- ② partial unique 帶上 status 條件
  SELECT indexdef INTO v_def FROM pg_catalog.pg_indexes
   WHERE schemaname='public' AND tablename='order_refunds' AND indexname='order_refunds_tappay_refund_id_key';
  IF v_def IS NULL OR pg_catalog.strpos(v_def,'voided')=0 THEN
    RAISE EXCEPTION 'A2 事後閘②:partial unique 沒有排除 voided(實得 %)', COALESCE(v_def,'<不存在>');
  END IF;

  -- ③ 狀態機的 SET 子句沒掉(CREATE OR REPLACE 會把它整組換掉)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='pcm_order_refund_status_transition'
                    AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'A2 事後閘③:狀態機的 search_path 不是空字串';
  END IF;

  -- 🔴🔴 ④ **本片最重要的一格:那五處算錢的地方【真的】自動排除 voided。**
  --    做法不是「我讀碼覺得會」, 是**去問它們的述詞裡有沒有把 voided 算進去**:
  --    五支的條件都是 `status IN ('processing','confirmed')` 或 `status = 'confirmed'`
  --    ⇒ 只要**沒有任何一支的 body 出現 `'voided'`**, 它們就不可能把它算進來。
  --    ⚠️ 這一格證的是「**沒有人明文把 voided 加進去**」, 不是「它們的邏輯一定對」——
  --       後者要靠行為測試(拋棄式 PG 那一輪), 這裡守的是**未來有人手滑加進去**。
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('pcm_order_refundable_remaining','pcm_sync_order_refund_payment_status',
                       'pcm_order_card_refunded','admin_compute_order_settlement','coupon_redeem_order_problem')
     -- 🔴🔴 **尺要問【狀態值】不是【欄位名】, 而我第一版問錯了。**
     --    第一版寫 `LIKE '%voided%'` ⇒ **當場紅, 說有 3 支提到它**。去看 ⇒ 那三處講的全是
     --    **另一張表**(`order_manual_refunds.voided_at`)的作廢欄 —— 那是非卡帳本自己的機制,
     --    與 `order_refunds.status` 無關。
     --    📌 **`voided_at` 是欄位名, `'voided'` 是狀態值 —— 而裸字 `voided` 兩個都命中。**
     --    ⇒ 改成問**帶引號的字面**(狀態值只會以 `'voided'` 出現)。
     AND p.prosrc LIKE '%''voided''%';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2 事後閘④:有 % 支算錢的函式 body 出現狀態字面 ''voided'' ⇒ 去確認它是不是把作廢列算進去了', v_cnt;
  END IF;
  -- 🔵 ④b **正向對照** —— 沒有它, ④ 的 0 同時相容於「真的沒提到」與「那五支根本不存在」。
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('pcm_order_refundable_remaining','pcm_sync_order_refund_payment_status',
                       'pcm_order_card_refunded','admin_compute_order_settlement','coupon_redeem_order_problem');
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'A2 事後閘④b(正向對照):那五支只找到 % 支 ⇒ **我的量法壞了, 不是它們乾淨** ⇒ ④ 的 0 不可信', v_cnt;
  END IF;

  -- ⑤ 收權清單
  FOREACH v_obj IN ARRAY v_functions LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(v_role, v_obj, 'EXECUTE') THEN
        RAISE EXCEPTION 'A2 事後閘⑤:% 對 % 仍有 EXECUTE', v_role, v_obj;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION 'A2 事後閘⑤b:service_role 叫不動 % ⇒ 後台會 permission denied', v_obj;
    END IF;
  END LOOP;

  -- 🔴 ⑥ 本片**不該產生任何 voided 列**
  SELECT count(*) INTO v_cnt FROM public.order_refunds WHERE status='voided';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'A2 事後閘⑥:已經有 % 列 voided ⇒ 本片不該產生任何一列', v_cnt; END IF;

  RAISE NOTICE 'A2 事後閘①-⑥ 全過(④ 掃了 5 支算錢函式, 零支提到 voided)。';
END
$post$;

COMMIT;
