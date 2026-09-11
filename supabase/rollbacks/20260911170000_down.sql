-- ══════════════════════════════════════════════════════════════════════════════
-- 回捲 20260911170000「已真的退出去多少」收成一份
-- ══════════════════════════════════════════════════════════════════════════════
--   做什麼:把兩支換回收成一份【之前】的完整 body(本檔內含, 不寫「去某檔複製」), 再 DROP helper。
--     匯流點   ⇒ md5 5cd27b504015eb27ba3e8615a13bb149(= 20260910210000 接線那一版)
--     退券函式 ⇒ md5 2b235b489870a10c4108b11080d84460(= 20260901020500 那一版)
--   🔴 前置閘:兩支【現在】必須是收成一份那一版(md5 6ce1d4e2d1eead06c61a9b6726ea6f9e / 49dc62fb5ebb0a1885423d24288143de)
--      ⇒ 不是 = 有人在本支之後又改過 ⇒ 本回捲會蓋掉那個改動 ⇒ 停, 改手寫。
--   🔴 header 逐字同正向(CREATE OR REPLACE 會重設 SET 子句):退券函式含 SET lock_timeout = '3s'。
--      換回之後跑【同一組】屬性斷言(prosecdef / proconfig / proacl / provolatile …)。
--   🔴 回捲鏈:要回捲 20260910210000(接線), 得先跑本檔 —— 那支 down 檔的前置閘釘的是 5cd27b50…。
--   🔵 單向的格:無 —— 本支不寫資料, 回捲後行為與收成一份之前逐位元相同。
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $pre$
DECLARE
  v_sync text;
  v_coup text;
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_order_money_moved(pg_catalog.uuid)') IS NULL THEN
    RAISE EXCEPTION '回捲 fail-closed:helper 不存在 ⇒ 20260911170000 沒貼過或已回捲, 拒繼續';
  END IF;
  SELECT p.prosrc INTO v_sync FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)');
  SELECT p.prosrc INTO v_coup FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)');

  -- ── 兩支的 body 指紋 ──
  IF pg_catalog.md5(v_sync) <> '6ce1d4e2d1eead06c61a9b6726ea6f9e' THEN
    RAISE EXCEPTION '回捲 前置閘:匯流點 body md5 不是 6ce1d4e2d1eead06c61a9b6726ea6f9e(實得 %)', pg_catalog.md5(v_sync);
  END IF;
  IF pg_catalog.md5(v_coup) <> '49dc62fb5ebb0a1885423d24288143de' THEN
    RAISE EXCEPTION '回捲 前置閘:退券函式 body md5 不是 49dc62fb5ebb0a1885423d24288143de(實得 %)', pg_catalog.md5(v_coup);
  END IF;

  -- ── header / 屬性(CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 每一格都問)──
  --    期望值 = 正式庫 2026-09-11 唯讀親查現值。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)')
                    AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proleakproof AND p.proparallel = 'u'
                    AND p.proowner = 'postgres'::pg_catalog.regrole
                    AND p.proconfig = ARRAY['search_path=""']
                    AND p.proacl::text[] = ARRAY['postgres=X/postgres']) THEN
    RAISE EXCEPTION '回捲 前置閘:匯流點的 SECURITY DEFINER / proconfig / proacl / 屬性 不是預期值';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)')
                    AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proleakproof AND p.proparallel = 'u'
                    AND p.proowner = 'postgres'::pg_catalog.regrole
                    AND p.proconfig = ARRAY['search_path=""', 'lock_timeout=3s']
                    AND p.proacl::text[] = ARRAY['postgres=X/postgres', 'service_role=X/postgres']) THEN
    RAISE EXCEPTION '回捲 前置閘:退券函式的 SECURITY DEFINER / proconfig(含 lock_timeout=3s)/ proacl / 屬性 不是預期值';
  END IF;

  -- ── 20260901021000 / 20260901030000 的前置閘要「剝註解後 body 含 reverted_at」⇒ 這裡同一句再問 ──
  IF pg_catalog.strpos((SELECT pg_catalog.string_agg(pg_catalog.regexp_replace(l.txt,'--.*$',''), E'\n' ORDER BY l.ln)
       FROM pg_catalog.regexp_split_to_table(v_coup, E'\n') WITH ORDINALITY AS l(txt,ln)), 'reverted_at') = 0 THEN
    RAISE EXCEPTION '回捲 前置閘:退券函式的碼裡沒有 reverted_at ⇒ 021000 / 030000 的前置閘會拒';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$

DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', pg_catalog.current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  -- 🔴🔴 **[2026-09-05 ⟦b4-MANREFUNDNOOWNER2⟧]本片唯一的行為改動:把人工退款也算進來。**
  --    ⛔ ~~原本只加總 `order_refunds`(卡片軌)~~ —— 而 `admin_record_manual_refund` 寫的是
  --      **另一張表** `order_manual_refunds`, 然後呼叫本函式 ⇒ 本函式算到 0 ⇒ 提早 return
  --      ⇒ 🎯 **客人的人工退款登記進去之後, `payment_status` 從來沒有被改過。**
  --    🔬 掃描實測(2026-09-04, 分母 2,320 支檔):全 repo 六支活的 payment_status 寫入端,
  --      `order_manual_refunds` **全部 0 次**;而 `admin_record_manual_refund` **只呼叫本函式**
  --      ⇒ **人工退款那條路唯一到得了的寫入端, 就是這一支。** ⇒ 沒有別人在管。
  --    🔵 述詞用 `voided_at IS NULL` 而**不是** `status = 'confirmed'` ——
  --      🔬 `order_manual_refunds` 建表(`20260820010000`)**沒有 status 欄**;
  --      作廢走 `voided_at`(`20260820090000` 後補)。
  --      ⇒ 📌 這與 `20260904230000:239` 用的述詞**逐字相同** ⇒ 兩邊對齊, 不是各寫各的。
  SELECT COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  SELECT v_moved + COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_manual_refunds
   WHERE order_id = p_order_id AND voided_at IS NULL;

  -- 🔴🔴 **第三段帳本(片③ 新增;關卡1 R1 must-fix)** —— 「先判失敗、後來更正為錢有動」的卡退。
  --    座標:`20260814190000:417-423` **自己就在扣這一段** ⇒ 少了它, 那筆錢會被算成 0
  --    ⇒ 狀態錯降回 `paid`, 而**錢其實出去了**。
  --    📌 同一個問題在兩支函式各有一份答案 ⇒ **口徑分岔在這裡特別致命。**
  SELECT v_moved + COALESCE(pg_catalog.sum(r.refund_amount), 0) INTO v_moved
    FROM public.order_refunds r
    JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
   WHERE r.order_id = p_order_id
     AND r.status = 'failed'
     AND r.failed_reason = 'manual_failed'
     AND v.corrected_to = 'money_moved';

  -- ⛔ ~~IF v_moved <= 0 THEN RETURN v_ps; END IF;~~ **片③ 拿掉這道早退。**
  --    🔴 留著它 ⇒ 全部退款被作廢時 `v_moved = 0` ⇒ 早退 ⇒ **永遠走不到 `paid` 那一支**
  --      ⇒ `payment_status` 卡死在 `refunded`, 而 Sean 2026-08-22 `Q-B=甲` 拍的「作廢後照事實降回」
  --        **靜靜地不存在**(本函式自己的 COMMENT 逐字記過這件事)。
  --    🛑 **而拿掉它會讓一批本來走不到下面那道 domain 閘的單開始撞它** —— 那是刻意的, 見下。

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒繼續。🔴 本函式由多個呼叫端共用(卡片結案 / 非卡登記 / …)—— **錯不一定在卡片那條路**, 看呼叫堆疊', p_order_id, v_ps;
  END IF;

  -- 🔴 **`v_moved > 0` 那一半非有不可**(關卡1 R1 must-fix):`v_moved >= v_total` 在
  --    `0 >= 0` 時**成立** ⇒ 一張 `total = 0` 的單、零退款, 會被算成「已全額退款」。
  v_target := CASE WHEN v_moved > 0 AND v_moved >= v_total THEN 'refunded'
                   WHEN v_moved > 0                        THEN 'partiallyRefunded'
                   ELSE                                         'paid' END;

  -- 🔴🔴 **超退留痕(片③;`-f8` 2026-09-05 裁【丙】)** —— 卡退金額**明訂無上界**
  --    (`20260801120000:200-201`)⇒ 總額 1,000 而帳本 1,200 時上面算出 `refunded`
  --    ⇒ 📌 **看起來完全正常, 而 200 元的異常沒有任何人會知道。**
  --    ⛔ ~~用 `RAISE WARNING` + 標紅~~ —— `20260902020000:1-15,211-229` **逐字**說
  --      `WARNING` **員工看不到**、**不得與 UI／等價告警分開上線** ⇒ 那個先例**否定**那個做法。
  --    ✅ 改寫進小事故表, 那就是它要的「等價告警」⇒ 零 UI 工作、不算分開上線。
  --    🛑 **不擋** —— 擋了會讓一筆已經發生的事無法登記, 那正是 `⟦PCM01⟧` 否決的方向。
  -- 🔴 **去重(關卡2 R1 must-fix)**:`pcm_incident_log` 是**無去重的 INSERT**, 而本函式
  --    **有多個呼叫端**、每次退款動作都會被叫 ⇒ 一個持續存在的超退會**累積成一堆事故列**
  --    ⇒ 📌 **而告警是「事故 > 0 就叫」** ⇒ 那會變成同一件事叫很多次。
  --    🔵 本函式是 SECURITY DEFINER / owner=postgres, 而 `pcm_incident` 也是 postgres 的
  --      ⇒ 表主人預設 bypass RLS ⇒ 這個 NOT EXISTS 讀得到(拋棄式 PG 已驗)。
  IF v_moved > v_total
     AND NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'refund_over_total' AND i.subject_id = p_order_id
                        AND i.resolved_at IS NULL) THEN
    PERFORM public.pcm_incident_log(
      'refund_over_total', p_order_id,
      pg_catalog.format('退款總額 %s 超過訂單總額 %s(差 %s)—— 由 pcm_sync_order_refund_payment_status 記下, 未擋',
                        v_moved, v_total, v_moved - v_total));
  END IF;

  -- 🔴 **`v_ps <> 'refunded'` 那一半拿掉了** —— 它就是「只升不降」。
  IF v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  -- ══ 🔴 [2026-09-11 · 接線] 券的退回 —— 唯一新增的一段 ═══════════════════════
  --   Sean 2026-09-11 Q2 甲:**無條件呼, 由退券函式自己判夠不夠格**(靠它的冪等,
  --   不靠誰記得補呼)⇒ 本處【不判】, 也不要在這裡加任何條件。
  --   🔴 **位置刻意在【那一行 RETURN 之前】** —— 形狀抄 `pcm_noncard_settle_recompute`
  --      逐字:「位置刻意在所有 RETURN 之前 —— 下面每一條 early-return 都會漏掉它」。
  --      🔬 而本函式今天**只有一個 RETURN**(其餘出口都是 RAISE ⇒ 整個交易 abort)
  --        ⇒ 放這裡就蓋得住每一條走得到底的路。⚠️ **日後有人加 early-return, 要放到它之前。**
  --   🛑 **unpaid 那條路到不了這裡** —— 上面那道 domain 閘會先 RAISE
  --      (`payment_status NOT IN (paid, partiallyRefunded, refunded)`)
  --      ⇒ 📌 **所以「取消而從來沒付過錢」那一類, 由取消那條路的落點負責, 不是這裡。**
  PERFORM public.coupon_revert_on_full_refund(p_order_id);

  RETURN v_ps;
END;
$fn$;

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
  --   🛑🛑🛑 **這是【第二份同口徑的碼】, 而沒有東西在守它。三句話, 讀完再往下。**
  --   ① **來源**:`pcm_sync_order_refund_payment_status`(`20260907140000:165-180`)。
  --   ② **對方改了, 本支不會叫** —— 沒有任何機制在守這件事。
  --      真正的修法是抽一支共用 helper 兩邊都呼, 而那要改活的金流函式(七個呼叫端)
  --      ⇒ 範圍擴張, 要 Sean 批。**今天沒有做。**
  --   ③ 🔴 **而曾經有一道 apply 期釘子(比對對方 prosrc 的字面), 2026-09-11 拿掉了。**
  --      **不要再造一次同一個東西。** 它死在這裡:
  --
  --      ## 我的版本號是【插隊到過去】的, 而我卻叫它去釘一個【未來才會出現】的東西。
  --
  --      🔬 我釘的那個口徑最早出現在 `20260905440000`, 現行版在 `20260907140000`;
  --         而本支是 `20260901020500` ⇒ **db push 依版本號跑 ⇒ 本支永遠先跑**
  --         ⇒ 那一刻要釘的碼**還不存在**。
  --      🔬 拋棄式庫從零重放實測(2026-09-11):那一刻庫上的
  --         `pcm_sync_order_refund_payment_status` = **1,360 字元 · 不含 `--` · 不含 `v_moved > 0`**
  --         (它是 `20260823010000` 建的原始版;而正式庫今天那支是 **4,770** 字元)
  --         ⇒ 🔴 本支 apply 失敗, **連帶擋住 `20260901021000` 與 `20260901030000`**。
  --      🛑 **它不是「今天壞了」, 是【它讓這棵樹再也不能從零重建】。**
  --      🛑 **而兩輪 codex、六格靜態檢查、兩道 pre-commit 閘, 沒有一個抓得到它**
  --         —— **它只有真的照順序跑一次才會現形。**
  --      ⚖️ 裁決:主視窗 `pcm-website-v2-59` 2026-09-11 裁「甲 = 拿掉」
  --         (依據:同一件事最多修 2 輪, 而那是第三次咬同一個東西 ⇒ 換路不再修)。
  --
  --      🔵 **而那段釘子裡有一格值得留成經驗, 不要跟著一起丟**:
  --         ✅ 對的做法 = 替【剝行註解這一步】本身加負對照 —— 挑兩個**只在註解裡**出現的
  --            字串(當時用 `must-fix` / `⛔`), 剝完必須找不到它們。
  --            📌 那是「先證明你的尺在動, 再相信它印的數字」的可執行版。
  --         ⛔ **錯的那一格 = 「剝完長度必須變短」** —— 它把【剝註解失敗】與
  --            【對方本來就沒有行註解】當成同一件事, 而那正是實跑當下印出來的訊息。
  --            📌 **一個斷言的順序, 決定了下一個人會去查哪裡** ——
  --               而我把最沒有資訊的那一句排在最前面, 它指向我自己的尺, 不是真因。
  --   ══════════════════════════════════════════════════════════════════════════
  SELECT COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  SELECT v_moved + COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_manual_refunds
   WHERE order_id = p_order_id AND voided_at IS NULL;

  SELECT v_moved + COALESCE(pg_catalog.sum(r.refund_amount), 0) INTO v_moved
    FROM public.order_refunds r
    JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
   WHERE r.order_id = p_order_id
     AND r.status = 'failed'
     AND r.failed_reason = 'manual_failed'
     AND v.corrected_to = 'money_moved';

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

DROP FUNCTION public.pcm_order_money_moved(pg_catalog.uuid);

DO $post$
DECLARE
  v_sync text;
  v_coup text;
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_order_money_moved(pg_catalog.uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '回捲 事後斷言:helper 還在';
  END IF;
  SELECT p.prosrc INTO v_sync FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)');
  SELECT p.prosrc INTO v_coup FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)');

  -- ── 兩支的 body 指紋 ──
  IF pg_catalog.md5(v_sync) <> '5cd27b504015eb27ba3e8615a13bb149' THEN
    RAISE EXCEPTION '回捲 事後斷言:匯流點 body md5 不是 5cd27b504015eb27ba3e8615a13bb149(實得 %)', pg_catalog.md5(v_sync);
  END IF;
  IF pg_catalog.md5(v_coup) <> '2b235b489870a10c4108b11080d84460' THEN
    RAISE EXCEPTION '回捲 事後斷言:退券函式 body md5 不是 2b235b489870a10c4108b11080d84460(實得 %)', pg_catalog.md5(v_coup);
  END IF;

  -- ── header / 屬性(CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 每一格都問)──
  --    期望值 = 正式庫 2026-09-11 唯讀親查現值。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)')
                    AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proleakproof AND p.proparallel = 'u'
                    AND p.proowner = 'postgres'::pg_catalog.regrole
                    AND p.proconfig = ARRAY['search_path=""']
                    AND p.proacl::text[] = ARRAY['postgres=X/postgres']) THEN
    RAISE EXCEPTION '回捲 事後斷言:匯流點的 SECURITY DEFINER / proconfig / proacl / 屬性 不是預期值';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)')
                    AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proleakproof AND p.proparallel = 'u'
                    AND p.proowner = 'postgres'::pg_catalog.regrole
                    AND p.proconfig = ARRAY['search_path=""', 'lock_timeout=3s']
                    AND p.proacl::text[] = ARRAY['postgres=X/postgres', 'service_role=X/postgres']) THEN
    RAISE EXCEPTION '回捲 事後斷言:退券函式的 SECURITY DEFINER / proconfig(含 lock_timeout=3s)/ proacl / 屬性 不是預期值';
  END IF;

  -- ── 20260901021000 / 20260901030000 的前置閘要「剝註解後 body 含 reverted_at」⇒ 這裡同一句再問 ──
  IF pg_catalog.strpos((SELECT pg_catalog.string_agg(pg_catalog.regexp_replace(l.txt,'--.*$',''), E'\n' ORDER BY l.ln)
       FROM pg_catalog.regexp_split_to_table(v_coup, E'\n') WITH ORDINALITY AS l(txt,ln)), 'reverted_at') = 0 THEN
    RAISE EXCEPTION '回捲 事後斷言:退券函式的碼裡沒有 reverted_at ⇒ 021000 / 030000 的前置閘會拒';
  END IF;
END $post$;

COMMIT;
