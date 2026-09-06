-- ⟦b4-TAPPAYDIRECT⟧ 片 A3:**同一交易**內作廢舊列 + 補登新列(金額/訂單記錯時的補救)
--
-- ══ 🔴🔴 這一片存在的理由:A2 的補救路【有一段窗口】═══════════════════════════
--   A2 的 COMMENT 逐字叫員工「金額錯 ⇒ **作廢後重新補登正確金額**」。
--   而那是**兩個動作** ⇒ 中間那一段時間, 帳上**少算了一筆真的動過的錢**
--   ⇒ `pcm_order_refundable_remaining` 被**高估** ⇒ 這時有人發起真退款可能超額。
--   📎 codex R1 must-fix(A2 那輪)逐字:那不是理論, 是**正常序列走得到**的。
--   ⇒ ✅ 本片把那兩個動作收進**一支 RPC、一個交易** ⇒ **窗口為零**。
--   🛑 而 A2 的純 void(`admin_void_backfilled_refund`)**保留** —— 它答的是另一個問題:
--     「這筆**根本沒發生**」(把 Rejected 看成成功)⇒ 沒有新列要補。**兩支不可互相取代。**
--
-- ══ 前置:貼板 69(20260907020000)與 70(20260907030000)都要先貼 ═══════════════
-- 貼板 73(`20260907050000`)。

BEGIN;

DO $pre$
DECLARE v_cnt integer; v_def text;
BEGIN
  -- P1. A2 的 voided 值域在(本片整個建立在它之上)
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_catalog.pg_constraint
   WHERE conrelid='public.order_refunds'::regclass AND conname='order_refunds_status_check';
  IF v_def IS NULL OR pg_catalog.strpos(v_def,'voided')=0 THEN
    RAISE EXCEPTION 'A3 前置閘 P1:status 值域沒有 voided ⇒ 先貼 20260907030000(貼板 70);拒繼續';
  END IF;

  -- 🔴 P2. **那個 partial unique 必須已經排除 voided** —— 本片的核心動作(同一交易內
  --     作廢舊列再用【同一個 DR 碼】補新列)完全靠它。少了它, 本片第一發就撞唯一鍵。
  SELECT indexdef INTO v_def FROM pg_catalog.pg_indexes
   WHERE schemaname='public' AND tablename='order_refunds' AND indexname='order_refunds_tappay_refund_id_key';
  IF v_def IS NULL OR pg_catalog.strpos(v_def,'voided')=0 THEN
    RAISE EXCEPTION 'A3 前置閘 P2:tappay_refund_id 的 partial unique 沒有排除 voided ⇒ 先貼貼板 70;拒繼續';
  END IF;

  -- P3. A2 的純 void RPC 在(本片與它並存, 不取代它)
  IF to_regprocedure('public.admin_void_backfilled_refund(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'A3 前置閘 P3:找不到 admin_void_backfilled_refund ⇒ 先貼貼板 70;拒繼續';
  END IF;

  -- P4. 本支不冪等
  IF to_regprocedure('public.admin_correct_backfilled_refund(uuid,integer,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'A3 前置閘 P4:本支已 apply 過;拒繼續(本支不冪等)';
  END IF;

  -- 🔵 P5. 正向對照
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid='public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('order_id','status','tappay_refund_id','backfilled_source');
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'A3 前置閘 P5(正向對照):四個既有欄只命中 % 個 ⇒ 我的量法壞了;拒繼續', v_cnt;
  END IF;

  RAISE NOTICE 'A3 前置閘 P1-P5 全過(P5 正向對照 = %)。', v_cnt;
END
$pre$;

CREATE FUNCTION public.admin_correct_backfilled_refund(
  p_refund_id  uuid,     -- 要更正的那一列(必須是補登的、confirmed 的)
  p_new_amount integer,  -- 正確的金額
  p_actor      text,
  p_reason     text,
  p_request_id text       -- 🔴 新列的冪等鍵(呼叫端給, 而不是這裡生)
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_order uuid; v_src text; v_status text; v_dr text; v_rec text;
  v_amount integer; v_kind text; v_att_by text; v_att_at timestamptz; v_occ timestamptz;
  v_new uuid;
  v_remaining bigint; v_existing uuid;
BEGIN
  IF p_refund_id IS NULL THEN RAISE EXCEPTION 'admin_correct_backfilled_refund: 缺 refund_id'; END IF;
  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 正確金額要大於 0(收到 %)', p_new_amount;
  END IF;
  IF p_actor IS NULL OR public.pcm_b2_is_blank(p_actor) THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 缺【誰更正的】';
  END IF;
  IF p_reason IS NULL OR public.pcm_b2_is_blank(p_reason) THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 缺【為什麼更正】';
  END IF;
  IF p_request_id IS NULL OR public.pcm_b2_is_blank(p_request_id) THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 缺 request_id(新列的冪等鍵)';
  END IF;

  -- 🔴 鎖順序沿既有約定 orders → order_refunds(`admin_initiate_order_refund:88-89` 實錘:
  --    `FOR UPDATE` 與 FK RI 的 KEY SHARE 死結 ⇒ 用 `FOR NO KEY UPDATE`)。
  SELECT r.order_id INTO v_order FROM public.order_refunds r WHERE r.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 找不到退款 %', p_refund_id;
  END IF;
  PERFORM 1 FROM public.orders o WHERE o.id = v_order FOR NO KEY UPDATE;

  -- 🔴🔴 **取鎖之後才重讀**(A2 那顆的 codex must-fix, 同一個坑不踩第二次)。
  SELECT r.backfilled_source, r.status, r.tappay_refund_id, r.rec_trade_id, r.refund_amount,
         r.backfill_attested_by, r.backfill_attested_at, r.backfill_occurred_at
    INTO v_src, v_status, v_dr, v_rec, v_amount, v_att_by, v_att_at, v_occ
    FROM public.order_refunds r WHERE r.id = p_refund_id;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 退款 % 不是【補登】的, 這條路只更正補登列', p_refund_id
      USING ERRCODE = 'P7C30';
  END IF;
  -- 🔵 **冪等:比內容, 不是撞到就回**(A2 那輪 codex must-fix 的同一條)。
  --    同一個 request_id 已經有列 ⇒ 內容一致回它的 id;**不一致就 RAISE**, 絕不靜默當成功。
  -- 🔴🔴 **它必須排在 status 閘【之前】** —— 拋棄式 PG 實跑量到(2026-09-07):重送時舊列
  --    已經是 `voided` ⇒ 排在後面的話, 一次成功的操作重送會收到 `P7C31` 而不是同一個 id。
  --    🛑 那正是 request_id 存在的理由:**網路斷在 commit 之後, 呼叫端只能重送。**
  --    ⚠️ 排在 P7C30 之【後】是刻意的:「這列根本不是補登」與重送無關, 那是叫錯人。
  SELECT r.id INTO v_existing FROM public.order_refunds r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    -- 🔴🔴 **指紋要含【來源】與【死活】, 不只金額與 DR 碼**(codex R1 #1, 我實跑複驗過)。
    --    🔬 反例(2026-09-07 拋棄式 PG 跑出來的, 不是推的):
    --       A100 --K1--> B500 --K2--> C700, 然後拿【舊鑰匙 K1】去更正 C 成 500。
    --       舊指紋只比 order_id + 金額 + DR 碼 ⇒ **B 三項全中**(鏈上每一列 DR 碼都一樣)
    --       ⇒ 回傳 B 的 id 當成功, 而 B 已經 voided、C 仍然是 700。
    --       ⇒ 📌 **呼叫端會以為改好了, 而帳上一毛都沒動。** 實測 card_refunded 仍是 700。
    --    ✅ 補兩項, 兩項各擋一半:
    --       ① status = 'confirmed' —— 重送要回一個【還活著】的結果, 不是墓碑。
    --       ② reason 逐字比對 —— 那串字裡含 p_refund_id(「更正自 <來源>」)
    --          ⇒ 這就是 codex 說的「指紋缺來源」那一項, 而它不必加欄位。
    IF EXISTS (SELECT 1 FROM public.order_refunds r
                WHERE r.id = v_existing AND r.order_id = v_order
                  AND r.refund_amount = p_new_amount AND r.tappay_refund_id = v_dr
                  AND r.status = 'confirmed'
                  AND r.reason = '更正自 ' || p_refund_id::text || ';' || p_reason) THEN
      RETURN v_existing::text;   -- 同一次操作的重送
    END IF;
    RAISE EXCEPTION 'admin_correct_backfilled_refund: request_id % 已經用過, 而內容不一樣 ⇒ 拒絕'
                    '(這不是重送, 是兩件不同的事共用了一把鑰匙)', p_request_id
      USING ERRCODE = 'P7C32';
  END IF;

  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 退款 % 現在是 %, 只有 confirmed 的補登列更正得了',
                    p_refund_id, v_status USING ERRCODE = 'P7C31';
  END IF;

  IF p_new_amount = v_amount THEN
    RAISE EXCEPTION 'admin_correct_backfilled_refund: 新金額與現值相同(%), 不需要更正', v_amount
      USING ERRCODE = 'P7C33';
  END IF;

  -- 🔴🔴 **兩道前置檢查, 換掉兩個【訊息與事實相反】的原始例外**(codex R1 #2/#3)。
  --    兩條我都在拋棄式 PG 上實跑複驗過 —— 而**第一次我報了「推翻」, 那是錯的**:
  --    我的探針缺 order_refunds_a445b_cap_guard_bi(後來的 migration 只 REPLACE 了函式、
  --    沒有重建 trigger), 而正式庫**有**(Sean 2026-08-30 親貼、g4 驗過)。
  --    ⇒ 📌 **「查無」是相對於你站在哪棵樹的。** 補上 trigger 之後, 兩條全部重現。

  -- ② 額度上限(codex #2):**訊息與事實相反, 那比擋下來本身更危險。**
  --    🔬 實測:訂單剩 200 · 補登記 100 · 外面真的退了 500
  --       ⇒ 作廢那 100 之後剩 300 < 500 ⇒ PCM04 整筆回滾, 舊列還原成 confirmed/100。
  --    🛑 而 PCM04 的訊息逐字是「**退款沒有發起、錢沒有動**」——
  --       在補登這條路上那句話是**假的**:那筆錢早就在外面出去了, 我們只是記不進來。
  --       ⇒ 員工照那句話會以為「沒事」, 而帳上少記了 400。
  --    ⚠️ **我不放寬那道閘 —— 而理由不是「沒人拍過」, 是【拍過的那個做法不在本片】**。
  --       ⛔ ~~不屬我可拍的板(R3)~~ ⇒ **這句 2026-09-07 03:0x 訂正**(mainB 指出):
  --       🔴 Sean **2026-09-07 00:17 `q33` 甲已經拍過**額度語意, 逐字是
  --          「補登金額超過我們帳上可退餘額時, **記下來並標異常, 而不是擋**
  --            (錢外面已經動了, 擋 = 從帳上消失)」(plan v3 §3.7 窄讓路:
  --            backfilled 列超額 ⇒ 不 RAISE, 寫 `pcm_incident`)。
  --       🛑 **而那個做法排在片 C**(補登 RPC + cap 讓路**一起**啟用)——
  --          在片 C 之前單獨放寬 cap, 等於開一個沒有 incident 接住的洞。
  --    ⇒ 📌 **本片的 `P7C34` 是【過渡】, 不是最終形狀**:它至少讓那句話說實話。
  --       片 C 上線後這一段要改成「記 + incident」。📎 板列 ⟦b4-TAPPAYDIRECT⟧ 片 C 那格。
  SELECT public.pcm_order_refundable_remaining(v_order) INTO v_remaining;
  IF p_new_amount > v_remaining + v_amount THEN
    RAISE EXCEPTION
      'admin_correct_backfilled_refund: 這張單作廢舊列之後只剩 % 元的額度, 記不下 % 元。'
      '🔴 而【那筆錢在外面已經退掉了】—— 這不是「退款沒發起」, 是我們記不進來。'
      '⇒ 代表這張單的退款總額已經超過訂單金額, 要人看過才能決定怎麼落帳。請找工程協助。',
      v_remaining + v_amount, p_new_amount
      USING ERRCODE = 'P7C34';
  END IF;

  -- ③ 同訂單另有處理中的退款(codex #3):新列必須先落地成 processing
  --    (A7c 帳本 INSERT 初態強制 processing —— 我實測直接插 confirmed 會噴 P7C01,
  --     一般列與補登列**同樣被擋** ⇒ 繞不過去), 而 order_refunds_single_processing_per_order
  --    一張單只准一列 processing ⇒ 撞 23505, 而那個訊息員工看不懂。
  --    🔬 實測:先有補登列、再插一列別人卡住的 processing ⇒ 更正回 23505。
  IF EXISTS (SELECT 1 FROM public.order_refunds r
              WHERE r.order_id = v_order AND r.status = 'processing') THEN
    RAISE EXCEPTION
      'admin_correct_backfilled_refund: 這張單另有一筆退款正在處理中, 更正要等它結束。'
      '(更正會先開一列新的處理中紀錄, 而一張單同時只准有一列)⇒ 請先讓那一筆結束或處理掉再來。'
      USING ERRCODE = 'P7C35';
  END IF;

  -- ── ① 作廢舊列 ────────────────────────────────────────────────────────────
  UPDATE public.order_refunds
     SET status='voided', voided_at=pg_catalog.now(), voided_by=p_actor,
         void_reason='更正金額:' || v_amount::text || ' ⇒ ' || p_new_amount::text || ';' || p_reason
   WHERE id = p_refund_id;

  -- ── ② 用【同一個 DR 碼】補登新列 ──────────────────────────────────────────
  -- 🔴 **這一步靠 A2 把 partial unique 改成 `AND status <> 'voided'`** ——
  --    唯一索引在**語句結束時**就生效(不是交易結束時)⇒ ① 一做完, 舊列就已經不在索引裡了。
  --    ✅ **2026-09-07 拋棄式 PG 實跑量到了**(原本這裡寫「這句是推的」):同交易內 void 舊列
  --       + 用同一個 DR 碼補新列 ⇒ 兩列並存、後者 `confirmed`, 唯一索引沒有擋。
  --    🔵 而**同一發還跑了兩個對照**, 免得這個綠是「索引根本沒在管」:
  --       · 兩列都活著、同一個 DR 碼 ⇒ `23505` 擋下(索引真的在管)
  --       · 先 void、再把同一個 DR 碼補到【另一張訂單】⇒ 通過(那正是「訂單記錯」的修法)
  v_new := pg_catalog.gen_random_uuid();
  INSERT INTO public.order_refunds
    (id, order_id, bank_refund_id, refund_amount, status, reason, actor, request_id,
     rec_trade_id, kind, record_refunded_before,
     backfilled_source, backfill_attested_by, backfill_attested_at, backfill_occurred_at)
  VALUES (v_new, v_order,
          'TPC' || pg_catalog.substr(pg_catalog.replace(v_new::text,'-',''), 1, 17),
          p_new_amount, 'processing',
          '更正自 ' || p_refund_id::text || ';' || p_reason,
          p_actor, p_request_id, v_rec,
          -- 🔴 kind 比【訂單總額】不比本地餘額(A2 同一條理由)
          (SELECT CASE WHEN p_new_amount >= o.total THEN 'full' ELSE 'partial' END
             FROM public.orders o WHERE o.id = v_order),
          0,
          -- 🔵 擔保三欄**沿用舊列的** —— 那筆退款是同一個人在同一個時候看到的,
          --    更正的是【我們記錯的金額】, 不是【他看到的那件事】。
          v_src, v_att_by, v_att_at, v_occ);

  -- 🔴 DR 碼與 confirmed 必須在**同一次 UPDATE**(A2 量到的 4.4/4.5)
  UPDATE public.order_refunds SET status='confirmed', tappay_refund_id=v_dr WHERE id = v_new;

  PERFORM public.pcm_sync_order_refund_payment_status(v_order);

  -- 🛑 **不觸發任何收款或退款** —— 那筆錢在外面已經出去了, 而它的金額從來沒變過;
  --    變的只有【我們記的那個數字】。
  RETURN v_new::text;
END;
$fn$;

COMMENT ON FUNCTION public.admin_correct_backfilled_refund(uuid, integer, text, text, text) IS
  '⟦b4-TAPPAYDIRECT⟧ A3:更正一筆補登的金額 —— **同一交易內**作廢舊列 + 用同一個 DR 碼補新列。'
  '🔴 存在的理由:先 void 再補是兩個動作, 中間帳上會少算一筆真的動過的錢 ⇒ 額度被高估。本支窗口為零。'
  '🛑 不觸發任何收款或退款。⚠️ 「這筆根本沒發生」請用 admin_void_backfilled_refund(兩支不可互相取代)。';

REVOKE ALL ON FUNCTION public.admin_correct_backfilled_refund(uuid, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_correct_backfilled_refund(uuid, integer, text, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_correct_backfilled_refund(uuid, integer, text, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_correct_backfilled_refund(uuid, integer, text, text, text) TO service_role;

DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_correct_backfilled_refund(uuid, integer, text, text, text)']::text[];
  v_obj text; v_role text;
BEGIN
  IF to_regprocedure('public.admin_correct_backfilled_refund(uuid,integer,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'A3 事後閘①:函式不在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='admin_correct_backfilled_refund'
                    AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'A3 事後閘②:search_path 不是空字串';
  END IF;
  -- 🔴 ③ **A2 那支純 void 還在** —— 本片不取代它
  IF to_regprocedure('public.admin_void_backfilled_refund(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'A3 事後閘③:A2 的純 void RPC 不見了 ⇒ 本片不該動到它';
  END IF;
  FOREACH v_obj IN ARRAY v_functions LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(v_role, v_obj, 'EXECUTE') THEN
        RAISE EXCEPTION 'A3 事後閘④:% 對 % 仍有 EXECUTE', v_role, v_obj;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION 'A3 事後閘④b:service_role 叫不動 %', v_obj;
    END IF;
  END LOOP;
  RAISE NOTICE 'A3 事後閘①-④ 全過(收權清單:0 個 relation / % 個 function)。',
               array_length(v_functions,1);
END
$post$;

COMMIT;
