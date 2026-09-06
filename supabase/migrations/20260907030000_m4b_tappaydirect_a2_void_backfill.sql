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

-- ══ 4b. 🔴🔴 反面述詞那一族 —— `coupon_redeem_order_problem` ═══════════════════
--   codex **R2** 抓到的(R1 沒找到, 而 R1 那四條我是【換做法】不是逐條折 ⇒ 規矩要跑 R2, 我漏了、補跑)。
--   🎯 **我掃錯了一族**:我掃的是「哪些地方會【算】voided」= 正面述詞 `status IN ('processing','confirmed')`
--     ⇒ 那一族**加新值會自動排除**, 所以我判「五處一行不改就對」。
--     🛑 而**反面述詞**(`NOT IN` / `<>`)**加新值會自動包含** —— **兩族方向相反**, 而我只想到一族。
--   🔬 **全集我用【正式庫的可執行 body】當分母重掃過**(不是 grep 檔案 —— 那會撈到別張表):
--     body 提到 `order_refunds` 的函式 **17 支** / 其中有反面 status 述詞 **6 支** / 述詞共 **10 條**
--     ⇒ 逐條判主詞, **只有 2 條的主詞是 `order_refunds.status`**:本節這支, 與
--       `admin_compute_order_settlement`(見下方 §4c 那段, **本片不修, 已開板列**)。
--     其餘 8 條:`order_refund_jobs.status`(2)· `payment_status`(3)· charge attempt(2)·
--     `NEW.status <> 'processing'`(INSERT 初態, voided 本來就進不去 ⇒ **正確**)。
--     view 端 **0**;🔵 負對照造字串 ⇒ 0;TS 端逐條看 ⇒ 只有 `TERMINAL_REFUND_STATUSES` 一處(已修)。
--   🔬 live vs repo:body md5 **a9b25674… 兩邊相同** ⇒ 以 repo 那版為底安全。
-- 🔴🔴 `SET search_path` **改成 `''`(2026-09-07 03:2x, 主視窗 B 派;這是【收緊】)**
--   ⛔ ~~原本這裡寫「`public, pg_temp` 逐字保留, 不可以順手統一, 那會改變它解析物件名的方式」~~
--   ⚠️ 那句的**理由是對的而前提沒查** —— 「會不會改變解析方式」取決於 body 裡有沒有裸名, 而我沒數過。
--   🔬 **數了**(剝掉 `--` 註解之後對本函式 body):`FROM`/`JOIN` 的物件共 **16 個**、
--      **裸名 0 個**、`public.` 全名 **16 個**;body 內零函式呼叫(唯一命中的 `IN(` 是關鍵字)。
--      🟢 正對照:同一把尺數 `public.` 字面 = 16 ⇒ 尺是活的。
--   🔬 **而字面只是必要條件, 行為另外量**:探針上同一批 **28 張訂單**跑同一支函式,
--      改前 / 改後**逐列比對 0 差異**(見本片 commit body)。
--   ✅ ⇒ `''` 行為不變, 而它讓本片與 `definer-search-path-gate` 對齊
--      (那道閘**零豁免機制** ⇒ 留 `public, pg_temp` 會讓**任何人**合了 dev 之後 commit 都被擋)。
--   🛑 **這是收緊不是放寬**:`''` 之下沒有任何東西靠 search_path 解析 ⇒ 沒有「哪天 public 裡
--      多一個同名物件把它劫走」那條路。live 現在是 `public, pg_temp` ⇒ **貼 70 時一起收**,
--      70b 加一格 `proconfig` 期望 `search_path=""`。
-- 🔴 **`CREATE OR REPLACE`, 而原檔(`20260831155000:62`)是裸 `CREATE`** ——
--   我從那支抽出定義區塊時**照抄了裸 CREATE**, 而探針實跑當場紅
--   `function "coupon_redeem_order_problem" already exists with same argument types`。
--   📌 **抄一段既有定義, 抄得到它的內容, 抄不到「它當時是【第一次建】而我是【改】」。**
--   (A1 那顆的方向相反:那裡我反射性寫了 `OR REPLACE` 而它是新物件, 被靜態閘規則① 擋下。
--    ⇒ 兩次都錯在同一件事:**沒有先問「這個東西現在存不存在」。**)
CREATE OR REPLACE FUNCTION public.coupon_redeem_order_problem(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id)
      THEN 'not_found'
    -- 🔴🔴 **順序:失效的理由排在「沒付款」之前**(codex must-fix④):
    --    `not_paid` 排最前面的話, 一張**未付款而且已取消**的單會回 `not_paid`
    --    ⇒ 短碼失真, 讀 log 的人會去查付款而不是查取消。
    --    ⇒ 而 `partiallyRefunded` 這種付款狀態也會遮掉真正的退款原因。
    WHEN (SELECT o.cancelled_at FROM public.orders o WHERE o.id = p_order_id) IS NOT NULL
      THEN 'cancelled'
    -- 部分取消:它連 `cancelled_at` 都不寫(`20260820030000:668` 只在全數取消時 UPDATE)。
    WHEN EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)
      THEN 'partially_cancelled'
    -- 🔴🔴 **卡片退款帳:黑名單不是白名單**(codex must-fix①)。
    --    ⛔ ~~原本寫 `status <> 'failed'`~~ —— 那把 **`deferred` 也當成動了錢**,
    --      而 `deferred` 逐字是「10024 = **還不能做**」(`20260803150000:23`)⇒ 沒扣到款。
    --    🛑 而那個 CHECK **已經被加寬過**:`:186` 把三值改成
    --      `('processing','confirmed','failed','deferred')` —— 我讀的是建表時那一版。
    --    📌 **⇒ 又一次「引用的射程比它實際涵蓋的窄/寬一格」** —— 今天第二次。
    -- 🔵 **選黑名單是刻意的**:未來加的新狀態會【擋】而不是【放行】。
    --    在錢這一層, 對未知保守 = 客人再按一次;對未知放行 = 錢算錯。
    -- 🔴🔴 **要看【有效終局】不是原始 status**(codex R2)——
    --    `order_refund_manual_corrections`(`20260814190000:69`)可以把一筆退款
    --    人工更正成 `money_moved` / `no_money_moved`, 而那張表的 `:101` 逐字寫著
    --    **「corrected_to=money_moved 不會讓該筆退款變成 confirmed」**
    --    ⇒ 一筆 `failed` 而被更正成「錢其實有動」的退款, 只看 `status` 會**放行**。
    -- 🔵 **而那個領域自己已經有一支 view**:`order_refund_effective_verdict`
    --    (同檔, 每筆 refund 取 `seq` 最大的那次更正)⇒ **用它, 不自己重推。**
    -- 📌 **⇒ 我原本在寫一個「單一真相」, 而那個領域【已經有】一支** ——
    --    差別是它只答退款那一段, 而我要的是整張單。**用它的答案, 不重造它。**
    WHEN EXISTS (
      SELECT 1 FROM public.order_refunds r
      LEFT JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
      WHERE r.order_id = p_order_id
        AND CASE
              WHEN v.corrected_to = 'money_moved'    THEN true
              WHEN v.corrected_to = 'no_money_moved' THEN false
              -- 🔴 ⟦b4-TAPPAYDIRECT⟧ A2 2026-09-07 加 'voided'。
              --    這是**反面述詞**:加一個新狀態值, 它**預設把新值含進去**
              --    ⇒ 一筆補登錯了、已作廢、**錢其實沒退**的訂單, 仍然會被判成 'refunded'
              --    ⇒ `redeem_coupon` 拒絕兌券 ⇒ 📌 **客人的優惠券用不了。**
              --    🎯 我掃「哪些地方會【算】voided」時只掃了正面述詞(`status IN (...)`),
              --      而那一族加新值是**自動排除**;反面這一族是**自動包含**。兩族方向相反。
              ELSE r.status NOT IN ('failed', 'deferred', 'voided')
            END)
      THEN 'refunded'
    -- 人工退款帳。`voided_at` 有值 = 這筆退款被作廢 ⇒ 不算。
    WHEN EXISTS (SELECT 1 FROM public.order_manual_refunds m
                  WHERE m.order_id = p_order_id AND m.voided_at IS NULL)
      THEN 'manually_refunded'
    -- 🔴🔴 **第四本帳:`payment_refunds`**(codex must-fix②)——
    --    它**不直接連 orders**, 而是經 `payment_charge_attempts.order_id`
    --    (`20260810140000:75-77`)⇒ 只看那三張表會漏掉整條卡片退款鏈。
    -- 📌 **⇒ 這正是我在券那支檔頭寫的「打地鼠」的下一格**:我以為收成一個地方就收完了,
    --    而**收成一個地方只是讓下一格【改一個檔】, 不是讓它不存在。**
    -- 🔴🔴 **父列只代表【退款意圖】, 不代表錢動了**(codex R3 must-fix)。
    --    可執行的判準在 `payment_refund_effective_terminal.indicates_refund`
    --    (`20260812140000:308-341`)—— 而那支 view 自己就是 fail-closed 的
    --    (判不出來一律當「錢動過」;該檔 `:316-320` 逐字寫了為什麼不可以 COALESCE false)。
    WHEN EXISTS (
      SELECT 1 FROM public.payment_refunds pr
      JOIN public.payment_charge_attempts pa ON pa.id = pr.attempt_id
      JOIN public.payment_refund_effective_terminal et
        ON et.refund_id = pr.id AND et.indicates_refund IS TRUE
     WHERE pa.order_id = p_order_id)
      THEN 'payment_refunded'
    -- 🔴 **有父列而【沒有】有效終局 ⇒ 那是「不知道」, 不是「已退款」**(同上 must-fix)。
    --    ⇒ 擋, 而**短碼要說實話** —— 謊稱 `payment_refunded` 會讓讀 log 的人
    --      去查一筆不存在的退款。📌 **保守地擋, 與謊稱理由, 是兩件事。**
    -- 🔴🔴 **而「有終局且它說沒退錢」⇒ 那是【已判定】不是【不知道】⇒ 放行。**
    --    這一格是實測改的:我第一版寫成「有父列就回 unknown」⇒ 一筆人工判定
    --    `refunded=false` 的退款照樣被擋 ⇒ 與上面 `order_refunds` 那邊
    --    「更正成 `no_money_moved` ⇒ 放行」**兩套標準**。
    --    📌 **同一件事在兩張帳上要有同一個答案 —— 不然那不是保守, 是不一致。**
    WHEN EXISTS (
      SELECT 1 FROM public.payment_refunds pr
      JOIN public.payment_charge_attempts pa ON pa.id = pr.attempt_id
     WHERE pa.order_id = p_order_id
       AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et2
                        WHERE et2.refund_id = pr.id))
      THEN 'refund_unknown'
    -- 🔴🔴 **沖銷:比淨額, 不是「有沒有沖銷列」**(codex must-fix③)——
    --    ⛔ ~~原本只要有一列 `reverses_payment_id IS NOT NULL` 就永久擋~~
    --    ⇒ **沖銷之沖銷**(把錯誤的沖銷再沖回來)會讓收款恢復, 而那張單被永遠擋住。
    -- 🔵 而比淨額同時解掉原本那個 NULL 陷阱:卡刷不一定在這張表留列
    --    ⇒ 兩邊都是 NULL ⇒ `NULL < NULL` 是 NULL ⇒ **不成立 ⇒ 不誤擋**。
    WHEN (SELECT sum(amount) FROM public.order_payments WHERE order_id = p_order_id)
       < (SELECT sum(amount) FROM public.order_payments
           WHERE order_id = p_order_id AND reverses_payment_id IS NULL)
      THEN 'payment_reversed'
    -- 🔴🔴 **第五本帳:Dashboard 雙扣退款**(codex R2)——
    --    `payment_double_charge_anomalies`(`20260624120003`)有自己的 `old_order_id`
    --    ⇒ 一張因為雙扣而被退款的舊單, 前面四本帳可能一列都沒有。
    WHEN EXISTS (SELECT 1 FROM public.payment_double_charge_anomalies a
                  WHERE a.old_order_id = p_order_id)
      THEN 'double_charge_refunded'
    -- 付款軸放最後 —— 它是最常見而最不具體的理由。
    WHEN (SELECT o.payment_status::text FROM public.orders o WHERE o.id = p_order_id)
         IS DISTINCT FROM 'paid'
      THEN 'not_paid'
    ELSE NULL
  END;
$$;

-- ══ 4c. 🛑 `admin_compute_order_settlement` 那一條【本片不修】═══════════════════
--   同一族的第二條:`orf.status <> 'failed'` ⇒ voided 會被算進去
--   ⇒ 只剩作廢列的正常訂單令 P6=false ⇒ 結清判定變 `needs_human / R_REFUND_TRACE_PRESENT`、金額輸出變 NULL。
--   🔴 **而它的 repo 版與正式庫【不同】**:repo `dc421935…`(217 行)/ live `087a886d…`(193 行),
--     且 `latest-definition-of.sh` 說 repo 最新那一代(`20260901030000`)在帳本上**未記**
--     ⇒ 📌 **repo 那一版沒有貼過** ⇒ 我照 repo 改會把一個從來沒上線的版本推上去;
--       照 live 改則等於替那片的主人做了一個他沒同意的決定。**兩邊都有代價 ⇒ 不是我可以自己選的。**
--   ⇒ mainB 2026-09-07 裁:**本片不動它**, 開板列 `⟦account-SETTLEVOIDEDPRED⟧`, 由 A 去問
--     `20260901030000` 為什麼沒貼;答「要貼」⇒ 修法交那片主人併進去, 答「作廢」⇒ 我以 live 為底另開。
--   ⚠️ **所以貼了本片之後, 結清判定那一條仍然是壞的** —— 影響是**內部判定變 needs_human, 不對外**;
--     而兌券那一條(客人用不了優惠券)本片修掉了。**兩條的急迫度不同, 這是刻意的取捨不是遺漏。**

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
     -- 🔴🔴 **這道閘的判準【我寫錯過兩次】, 兩次都是它自己擋下我的**:
     --   第一版 `LIKE '%voided%'` ⇒ 撈到**別張表的欄位名** `order_manual_refunds.voided_at`(誤報 3 支)。
     --   第二版 `LIKE '%''voided''%'` ⇒ 收窄成狀態字面, 而**我隨後就往 coupon 那支加了那個字面**
     --     ⇒ **它又擋下我一次**(誤報 1 支)。
     --   📌 **一道「不准出現 X」的閘, 在【我自己要加 X】的那一刻會變成阻礙** ——
     --     而那不代表它錯:它逼我把「哪一種出現是對的」講清楚。
     --   ✅ 判準是**方向**不是**出現**:
     --     · 反面述詞含 voided(`NOT IN (… 'voided')`)= **對的**(它在排除作廢列)
     --     · 正面述詞含 voided(`status IN (… 'voided')` / `status = 'voided'`)= **要人去看**
     --       (那表示有人把作廢列【算進】某個加總裡)
     -- 🔴🔴 **第三次改判準, 而這一次是【我自己的註解】觸發了我自己的閘。**
     --   `LIKE '%status IN (%''voided''%'` 會**跨行匹配**:我在 coupon 那支的註解裡寫了
     --   「我掃…時只掃了正面述詞(`status IN (...)`)」, 而 `'voided'` 出現在同一個 body 的別處
     --   ⇒ 兩段中間隔著幾百個字元, 而 `%` 照樣接得起來 ⇒ **誤報**。
     --   📌 這支 repo 早就記過同一件事:`20260820100000` 檔內逐字
     --     「`prosrc` **含註解** ⇒ 在函式本體裡寫出那個名字, 會讓斷言恆真」——
     --     **那次是恆真(漏報), 這次是誤報。同一個根因, 兩個相反的方向。**
     --   ✅ 改用**有界正規式**:`[^)]*` 讓比對停在第一個右括號 ⇒ 跨不過去。
     AND (p.prosrc ~ 'status[[:space:]]+IN[[:space:]]*\([^)]*''voided'''
          OR p.prosrc ~ 'status[[:space:]]*=[[:space:]]*''voided''');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2 事後閘④:有 % 支算錢的函式用【正面述詞】把 voided 算進去了 ⇒ 去看那一支', v_cnt;
  END IF;
  -- 🔵 ④c **而反面述詞那一族要【有】它** —— 沒有這一格, ④ 的 0 同時相容於
  --    「沒有人把它算進去」與「也沒有人把它排除掉」, 而後者正是 codex R2 抓到的病。
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='coupon_redeem_order_problem'
     AND p.prosrc LIKE '%NOT IN (''failed'', ''deferred'', ''voided'')%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A2 事後閘④c:coupon 那支的反面述詞沒有排除 voided ⇒ 作廢列會被算成已退款';
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

  -- 🔴 ⑦ coupon 那支的反面述詞**真的含 voided 了**
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='coupon_redeem_order_problem'
                    AND p.prosrc LIKE '%NOT IN (''failed'', ''deferred'', ''voided'')%') THEN
    RAISE EXCEPTION 'A2 事後閘⑦:coupon_redeem_order_problem 的反面述詞沒有含 voided';
  END IF;
  -- 🔴🔴 ⑦b `search_path` **收成空字串了**(2026-09-07 03:2x, 見 `:229` 那段)。
  --   ⛔ ~~「它沒被 CREATE OR REPLACE 換掉(它是 `public, pg_temp`, 與本片其他支不同)」~~
  --   ⛔ ~~`proconfig @> ARRAY['search_path=public, pg_temp']`~~
  --   🔴🔴 **舊字面留在這裡, 因為它讓這一片【第一次貼進正式庫時整支回滾】** ——
  --     2026-09-07 03:5x A 貼 70, `psql` rc=3、零寫入、帳本不記、`70b` 貼前貼後同值。
  --     成因:我在 `93e7c7bd7` 把值從 `public, pg_temp` 改成 `''`, 改到了三處
  --     (函式的 `SET` 子句 `:253` · 前置閘③ `:399` · 貼板 `70b`), **而漏了這一格**
  --     ⇒ 貼下去當場撞 `:491` 的 RAISE。
  --   ⇒ 📌 **教訓:改一支 migration 的某一格, 同檔的【事後閘】與【註解】是同一個分母。**
  --     🛑 而**乾跑閘看不到這件事** —— 它只驗 sha / 帳本 / 形狀, **不跑 SQL**
  --       ⇒ 那道紅只有在真的貼下去的那一刻才出現。
  --   ✅ 現在與前置閘③ `:399` **同形**(兩處都問 `search_path=""`)。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='coupon_redeem_order_problem'
                    AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'A2 事後閘⑦b:coupon_redeem_order_problem 的 search_path 不是空字串'
                    '(本片把它從 public, pg_temp 收成 空字串 —— 理由見本檔 :229)';
  END IF;

  RAISE NOTICE 'A2 事後閘①-⑦ 全過(④ 掃了 5 支算錢函式, 零支提到 voided)。';
END
$post$;

COMMIT;
