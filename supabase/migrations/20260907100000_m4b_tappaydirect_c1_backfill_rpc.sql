-- ⟦b4-TAPPAYDIRECT⟧ 片 C-1a:補登 RPC —— 把「有人直接在 TapPay 後台退了款」記進帳本
--
-- ══ 🔴🔴 這一支【第一次讓補登真的寫得進來】════════════════════════════════════
--   片 A 加了欄、片 B 做了畫面而**沒有後端**(送出鈕恆 disabled)。
--   ⇒ 📌 在這一支之前, 那七個欄位**沒有任何入口寫得進來** —— 那是刻意的, 不是遺漏。
--   ⇒ ⚠️ **貼了這一支之後, 那句話就不成立了。** 而 UI 仍由 `REFUND_BACKFILL_UI_ENABLED`
--     擋著(片 C-2 才翻開)⇒ 兩道門, 這一支只開了裡面那道。
--
-- ══ 貼序:A → B → C ═══════════════════════════════════════════════════════════
--   前置(都要先貼):69(`20260907020000` A1 七欄)· 70(`20260907030000` A2 voided)
--   🛑 **而本支排在【B1 讀取面切 view / 型別重生成】之後貼** —— 主視窗 B 2026-09-07 05:4x 指示。
--   貼板 **79**(`20260907100000`)。
--
-- ══ 🔴 它不做什麼(比它做什麼更重要)═════════════════════════════════════════
--   · **不觸發任何收款或退款** —— 錢在 TapPay 那邊已經動過了, 這裡只是把它記下來。
--   · **不改 `record_refunded_before` 的語意** —— 它填 `0`, 而那個 0 的意思是
--     **「未知」不是「零」**(見該欄位在本函式的註解)。
--   · **不放寬「初態必須 processing」** —— 走 G8/G9 兩步, 與一般退款同一條路(驗收⑧)。

BEGIN;

-- ══ 1. 前置閘(不成立 ⇒ 整支拒貼, 不留半套)═════════════════════════════════
DO $pre$
DECLARE v_cnt integer; v_def text;
BEGIN
  -- P1. A1 的七欄在(本支寫的就是它們)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid='public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('backfilled_source','backfill_attested_by','backfill_attested_at',
                     'backfill_occurred_at','voided_at','void_reason','voided_by');
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'C-1a 前置閘 P1:A1 的七欄只命中 % 個 ⇒ 先貼 20260907020000(貼板 69);拒繼續', v_cnt;
  END IF;

  -- P2. A2 的 voided 值域在(超額讓路與撤銷鏈都建在它之上)
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_catalog.pg_constraint
   WHERE conrelid='public.order_refunds'::regclass AND conname='order_refunds_status_check';
  IF v_def IS NULL OR pg_catalog.strpos(v_def,'voided')=0 THEN
    RAISE EXCEPTION 'C-1a 前置閘 P2:status 值域沒有 voided ⇒ 先貼 20260907030000(貼板 70);拒繼續';
  END IF;

  -- 🔴 P3. **同步器在, 而且它自己會開 incident** —— 本片的超額路徑靠它, 我不自己寫一份。
  --    (plan v3 §6b②:那支的 `:82-89` 已經在做「超額就開單而不擋」, 而且帶 `NOT EXISTS` 去重。)
  IF to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'C-1a 前置閘 P3:找不到 pcm_sync_order_refund_payment_status ⇒ 拒繼續';
  END IF;

  -- P4. 本支不冪等
  IF to_regprocedure(
       'public.admin_backfill_tappay_console_refund(uuid,integer,text,timestamptz,boolean,text,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'C-1a 前置閘 P4:本支已 apply 過;拒繼續(本支不冪等)';
  END IF;

  -- 🔵 P5. 正向對照 —— 一個【一定在】的既有欄, 命中才代表我的量法是活的
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid='public.order_refunds'::regclass AND NOT attisdropped
     AND attname IN ('order_id','status','tappay_refund_id','refund_amount');
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'C-1a 前置閘 P5(正向對照):四個既有欄只命中 % 個 ⇒ 我的量法壞了;拒繼續', v_cnt;
  END IF;

  RAISE NOTICE 'C-1a 前置閘 P1-P5 全過(P5 正向對照 = %)。', v_cnt;
END
$pre$;

-- ══ 2. 補登 RPC ═══════════════════════════════════════════════════════════════
CREATE FUNCTION public.admin_backfill_tappay_console_refund(
  p_order_id     uuid,
  p_amount       integer,
  p_dr_code      text,
  p_occurred_at  timestamptz,
  p_attested     boolean,
  p_actor        text,
  p_request_id   text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_new uuid;
  v_existing uuid;
  v_rec text;
  v_total bigint;
  v_kind text;
  v_bank text;
  v_dr text;
BEGIN
  -- ── G1 形狀 ────────────────────────────────────────────────────────────────
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 缺 order_id';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 金額必須是正整數(收到 %)', p_amount
      USING ERRCODE = 'P7B01';
  END IF;
  IF p_dr_code IS NULL OR public.pcm_b2_is_blank(p_dr_code) THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 缺 TapPay 的退款單號(DR 碼)'
      USING ERRCODE = 'P7B02';
  END IF;
  -- 🔴🔴 **DR 碼要正規化, 而理由是【錢】**(codex R1 #1, 我實跑複驗過):
  --   從後台複製貼上帶尾端空白是常態, 而 `DR_123` 與 `DR_123 ` 對唯一索引是**兩個不同的值**
  --   ⇒ 🔬 實測:同一個 DR 碼補兩次(第二次帶一個尾端空白)⇒ **兩列都 confirmed**,
  --     `[DR_V559575]` 與 `[DR_V559575 ]` ⇒ 📌 **同一筆退款被算了兩次。**
  --   ✅ 從這裡開始一律用 `v_dr`(trim 過的), **`p_dr_code` 底下不再出現** ——
  --     留著它才是危險:兩個名字裝著兩個不同的值, 而只有一個是對的。
  v_dr := pg_catalog.btrim(p_dr_code);
  IF v_dr = '' THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: DR 碼只有空白'
      USING ERRCODE = 'P7B02';
  END IF;
  IF p_actor IS NULL OR public.pcm_b2_is_blank(p_actor) THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR public.pcm_b2_is_blank(p_request_id) THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 缺 request_id(冪等鍵)';
  END IF;

  -- ── 🔴🔴 G0 必勾 ───────────────────────────────────────────────────────────
  --   Sean `Q29` 甲:補登這條路**信員工**, 而信任要留下**誰在什麼時候擔保**。
  --   🛑 `p_attested` 是 `boolean` ⇒ **`NULL` 與 `false` 都不算勾**(`IS NOT TRUE` 兩個都涵蓋)。
  --     寫成 `= false` 會漏掉 NULL, 而 NULL 正是「呼叫端沒送這個參數」的樣子。
  IF p_attested IS NOT TRUE THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 沒有勾「我已在 TapPay 後台確認這筆退款成功」'
                    '⇒ 不補登(這條路信的是你的確認, 沒有確認就沒有東西可信)'
      USING ERRCODE = 'P7B03';
  END IF;

  -- ── G2 發生時刻不得未來 ────────────────────────────────────────────────────
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 缺「那筆退款在 TapPay 上發生的時間」'
      USING ERRCODE = 'P7B04';
  END IF;
  IF p_occurred_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 發生時間是未來(%)⇒ 拒收', p_occurred_at
      USING ERRCODE = 'P7B05';
  END IF;

  -- ── 鎖父列(鎖順序沿既有約定 orders → order_refunds;
  --    `FOR UPDATE` 與 FK RI 的 KEY SHARE 死結是實錘 ⇒ 用 `FOR NO KEY UPDATE`)──────
  SELECT o.total, o.tappay_rec_trade_id INTO v_total, v_rec
    FROM public.orders o WHERE o.id = p_order_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 找不到訂單 %', p_order_id
      USING ERRCODE = 'P7B06';
  END IF;

  -- ── 🔴 G7 冪等:比【內容】不是撞到就回 ─────────────────────────────────────
  --   🔵 這一段的形狀與 A3 那支**刻意一致**(那裡的血:指紋缺了來源與死活, 鏈式操作會
  --     回一個**已作廢**的 id 當成功)。這裡的指紋 = order_id + 金額 + DR 碼 + 還活著。
  SELECT r.id INTO v_existing FROM public.order_refunds r WHERE r.request_id = p_request_id;
  IF FOUND THEN
    -- 🔴🔴 **指紋要含【那一列是不是補登】與【它記的是哪一刻】**(codex R1 #2/#3, 兩條我都實跑複驗過):
    --   ⛔ ~~只比 order_id + 金額 + DR 碼 + confirmed~~ —— 那漏掉兩個世界:
    --   ① **只改 `p_occurred_at`** ⇒ 三項全中 ⇒ 回同一個 id 當重送, 而**存的還是舊時刻**
    --      ⇒ 🔬 實測:送 `now()-9h` 而庫裡留著 `now()-2h` ⇒ **不同的內容被靜默吞掉。**
    --   ② **拿一般退款(非補登)的 `request_id`** + 同單 / 同額 / 同 DR 呼叫
    --      ⇒ 🔬 實測回 `OK` + 一個 id, 而**補登列 0、稽核 0**
    --      ⇒ 📌 **呼叫端以為補登成功, 而擔保欄與 audit 一個都沒寫。**
    --   ✅ 補兩項:`backfilled_source IS NOT NULL`(它得真的是補登列)+ `backfill_occurred_at` 逐值比。
    IF EXISTS (SELECT 1 FROM public.order_refunds r
                WHERE r.id = v_existing
                  AND r.order_id = p_order_id
                  AND r.refund_amount = p_amount
                  AND r.tappay_refund_id = v_dr
                  AND r.status = 'confirmed'
                  AND r.backfilled_source IS NOT NULL
                  AND r.backfill_occurred_at = p_occurred_at) THEN
      RETURN v_existing::text;   -- 同一次操作的重送
    END IF;
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: request_id % 已經用過, 而內容不一樣 ⇒ 拒絕'
                    '(這不是重送, 是兩件不同的事共用了一把鑰匙)', p_request_id
      USING ERRCODE = 'P7B07';
  END IF;

  -- ── 🔴 同訂單另有處理中的退款 ⇒ 講人話, 不要讓員工看見 `23505`(驗收⑦, R1#5)──
  --   新列必須先落地成 `processing`(A7c 帳本 INSERT 初態強制, 本片不放寬 —— 驗收⑧),
  --   而 `order_refunds_single_processing_per_order` 一張單只准一列 processing。
  --   🛑 少了這一格, 員工看到的是 `duplicate key value violates unique constraint …`
  --     ⇒ 📌 **那句話不但看不懂, 還會讓他以為「我按過了」** —— 而事實相反:那一筆沒有記進去。
  --   🔵 形狀與 A3 的 `P7C35` 刻意一致(同一個 constraint、同一種處置)。
  IF EXISTS (SELECT 1 FROM public.order_refunds r
              WHERE r.order_id = p_order_id AND r.status = 'processing') THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 這張單另有一筆退款正在處理中, 補登要等它結束。'
                    '(補登會先開一列新的處理中紀錄, 而一張單同時只准有一列)'
                    '⇒ 請先把那一筆結案(成功或失敗都可以)再回來補登。'
      USING ERRCODE = 'P7B08';
  END IF;

  -- ── 🔵 G6 `bank_refund_id`:合成的, **從來沒有送過 TapPay** ────────────────
  --   那個欄位原本裝的是「我們發起退款時送出去的單號」。補登這條路**沒有發起過任何東西**
  --   ⇒ 這裡填一個 `TPC` 開頭的合成值, 而讀取介面(A1 的 `order_refunds_readable`)
  --     對補登列**把它遮成 NULL** —— 免得有人拿它去對 TapPay 的帳。
  v_new  := pg_catalog.gen_random_uuid();
  v_bank := 'TPC' || pg_catalog.substr(pg_catalog.replace(v_new::text,'-',''), 1, 17);

  -- ── 🔴 G5 `kind` 比【訂單總額】不比本地餘額 ────────────────────────────────
  --   比本地餘額的話:同一筆錢在「帳上還沒記」與「已經記了」兩個時點會得到**不同的 kind**,
  --   而那兩個時點指的是同一件事。⇒ 用一個不會隨我們的紀錄漂動的分母。
  v_kind := CASE WHEN p_amount >= v_total THEN 'full' ELSE 'partial' END;

  -- ── G8 INSERT 成 processing(初態由 A7c 強制, 本片不放寬 —— 驗收⑧)──────────
  INSERT INTO public.order_refunds
    (id, order_id, bank_refund_id, refund_amount, status, reason, actor, request_id,
     rec_trade_id, kind, record_refunded_before,
     backfilled_source, backfill_attested_by, backfill_attested_at, backfill_occurred_at)
  VALUES (v_new, p_order_id, v_bank, p_amount, 'processing',
          'TapPay 後台補登', p_actor, p_request_id, v_rec, v_kind,
          -- 🔴🔴 **`0` 的意思是「未知」不是「零」** ——
          --   那個欄位原本記的是「我們發起退款前, TapPay 說已經退了多少」。
          --   補登這條路**沒有問過 TapPay** ⇒ 我們不知道那個數字。
          --   🛑 而它是 `NOT NULL` ⇒ 只能填 0。⇒ 讀取介面對補登列把它**遮成 NULL**,
          --     讓下游**拿不到**這個值, 而不是拿到之後被期待去理解它。
          0,
          'tappay_console', p_actor, pg_catalog.now(), p_occurred_at);

  -- ── 🔴 G9 DR 碼與 confirmed 必須在【同一次 UPDATE】────────────────────────
  --   分兩次的話, 中間那一瞬間有一列 `confirmed` 而**沒有 DR 碼** ——
  --   而「沒有 DR 碼的 confirmed」正是對帳時最難解釋的那一種列。
  UPDATE public.order_refunds
     SET status = 'confirmed', tappay_refund_id = v_dr
   WHERE id = v_new;

  -- ── G10 同步付款狀態(**而超額的 incident 由它開, 不是我開**)──────────────
  --   plan v3 §6b②:那支的 `:82-89` 已經在做「超額就開單而不擋」, 且帶 `NOT EXISTS` 去重
  --   ⇒ 📌 我自己再寫一份會**開兩列**。**現成的那個已經在正式庫上跑。**
  PERFORM public.pcm_sync_order_refund_payment_status(p_order_id);

  -- ── G11 同交易寫稽核(形狀抄 `admin_adjust_wallet`)────────────────────────
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'order.refund.backfill',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object('backfilled', false),
    pg_catalog.jsonb_build_object(
      'refund_id', v_new::text, 'amount', p_amount, 'dr_code', v_dr,
      'occurred_at', p_occurred_at, 'kind', v_kind),
    'TapPay 後台補登(員工已確認)',
    p_request_id,
    'admin'
  );

  RETURN v_new::text;
END;
$fn$;

COMMENT ON FUNCTION public.admin_backfill_tappay_console_refund(
  uuid, integer, text, timestamptz, boolean, text, text) IS
  '⟦b4-TAPPAYDIRECT⟧ 片 C-1a:把「有人直接在 TapPay 後台退的款」補記進帳本。'
  '🛑 **不觸發任何收款或退款** —— 錢在外面已經動過了, 這裡只記帳。'
  '🔴 `p_attested` 必須為 true(Sean Q29 甲:信員工, 而信任要留下誰在什麼時候擔保);'
  'NULL 與 false 都不算勾。`p_occurred_at` 不得未來。`p_request_id` 是冪等鍵, **比內容不是撞到就回**。'
  '🔵 `bank_refund_id` 是 `TPC` + 17 碼的**合成值, 從來沒有送過 TapPay**;'
  '`record_refunded_before = 0` 的意思是**「未知」不是「零」**(補登這條路沒問過 TapPay)——'
  '兩者都由讀取介面 `order_refunds_readable` 對補登列**遮成 NULL**。'
  '⚠️ 金額超過可退餘額時**不擋**(Sean 2026-09-07 q33 甲:錢外面已經動了, 擋 = 從帳上消失);'
  '那一列落地後由 `pcm_sync_order_refund_payment_status` 開 `refund_over_total` 的 incident（它自帶去重）。'
  '🛑 而**那道讓路在片 C-1b**;在 C-1b 之前, 超額仍會被 cap guard 擋下(`PCM04`)。EXECUTE 僅 service_role。';

-- ══ 3. 收權(新物件出生就自帶 PUBLIC 的 EXECUTE ⇒ 兩道 REVOKE 一道都不能少)═══
REVOKE ALL ON FUNCTION public.admin_backfill_tappay_console_refund(
  uuid, integer, text, timestamptz, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_backfill_tappay_console_refund(
  uuid, integer, text, timestamptz, boolean, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_backfill_tappay_console_refund(
  uuid, integer, text, timestamptz, boolean, text, text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_backfill_tappay_console_refund(
  uuid, integer, text, timestamptz, boolean, text, text) TO service_role;

-- ══ 4. 事後斷言(不成立 ⇒ 整筆回滾)═══════════════════════════════════════════
DO $post$
DECLARE
  v_oid oid;
  v_cnt integer;
  v_functions text[] := ARRAY['admin_backfill_tappay_console_refund'];
BEGIN
  v_oid := to_regprocedure(
    'public.admin_backfill_tappay_console_refund(uuid,integer,text,timestamptz,boolean,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'C-1a 事後閘①:那支 RPC 沒建起來';
  END IF;

  -- ② SECURITY DEFINER + search_path 是空字串(兩者成對:少了後者, DEFINER 就是一條路)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = v_oid AND p.prosecdef
                    AND p.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'C-1a 事後閘②:不是 SECURITY DEFINER, 或 search_path 不是空字串';
  END IF;

  -- ③ 只有 service_role 執行得了
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'C-1a 事後閘③:anon/authenticated 執行得了那支 RPC';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'C-1a 事後閘③b:service_role 執行不了那支 RPC(那它就沒有呼叫端)';
  END IF;

  -- 🔴 ④ 六個錯誤碼逐字都在 —— 它們是呼叫端分得出「哪一種拒絕」的唯一掛勾
  SELECT count(*) INTO v_cnt FROM unnest(ARRAY['P7B01','P7B02','P7B03','P7B04','P7B05','P7B06','P7B07','P7B08']) AS c
   WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid AND p.prosrc LIKE '%'||c||'%');
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION 'C-1a 事後閘④:八個錯誤碼只命中 % 個', v_cnt;
  END IF;

  -- 🔵 ⑤ 正向對照:同一把尺去找一個【一定不在】的碼 ⇒ 必須是 0
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_oid AND p.prosrc LIKE '%P7B99%') THEN
    RAISE EXCEPTION 'C-1a 事後閘⑤(正向對照):現造的碼 P7B99 竟然命中 ⇒ 我的量法壞了';
  END IF;

  -- 🛑 ⑥ **本片不得產生任何一列** —— 它只是把工具放上去
  SELECT count(*) INTO v_cnt FROM public.order_refunds WHERE reason = 'TapPay 後台補登';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'C-1a 事後閘⑥:貼這一支竟然產生了 % 列補登', v_cnt;
  END IF;

  RAISE NOTICE 'C-1a 事後閘①-⑥ 全過(收權清單:% 個 function)。', array_length(v_functions,1);
END
$post$;

COMMIT;
