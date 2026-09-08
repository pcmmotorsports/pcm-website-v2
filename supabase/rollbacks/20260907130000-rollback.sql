-- 🔴🔴 **84r —— 貼板 84 的【還原】檔(災難用)**
--
-- 來源:R3 對抗審查(adversarial-reviewer / opus,2026-09-07)**must-fix F4**:
--   逐字「**災難當天沒有東西可以回退**」——「`84r_還原_災難用.sql` 不存在,而前一代【不能重跑】」。
--   R3 量到:貼板目錄 15 支姊妹板有 `還原_災難用`,鄰居 80/82/83 三支全有,**84 一支都沒有**。
--
-- ══ 🛑 為什麼「重貼 79」救不了 ═══════════════════════════════════════════════
-- `20260907100000_m4b_tappaydirect_c1_backfill_rpc.sql:48-53` 的前置閘 P4 逐字寫著
-- 「本支已 apply 過;拒繼續(本支不冪等)」⇒ **重貼 79 會被它自己擋掉。**
-- ⇒ 所以災難當下需要的是**這一支** —— 它只做一件事:把那支 RPC 換回 84 貼之前的樣子。
--
-- ══ 這一支怎麼來的 ═══════════════════════════════════════════════════════════
-- 🔴 **程式從 `20260907100000` 抽的,不是手打**(同一支 `build` 腳本的抽法),
--    動詞由 `CREATE FUNCTION` 換成 `CREATE OR REPLACE FUNCTION`,body **逐字不動**。
-- 🔬 **正對照**:抽出來的 body `md5(prosrc)` = `88ca8531a02616e47d5d969b6f49dc59` / len `7433`
--    —— 與貼板 84 內 P1 寫死的期望值**逐字相同**,而那個值是我從正式庫唯讀取回來的。
--    ⇒ 📌 **這證明「我抽出來的」與「正式庫貼 84 之前跑的」是同一份。**
--
-- ══ 🛑 用它之前先讀這三句 ═══════════════════════════════════════════════════
-- ① **它不含 84 的任何前置閘** —— 災難當下那些閘會擋路(P1 會因為 md5 已變而拒絕)。
--    ⇒ 這一支**刻意不帶閘**,它的安全性靠**你貼之前先跑下面那段對帳**。
-- ② **它會把 `SET` 子句與 `SECURITY DEFINER` 一起換回去** —— `CREATE OR REPLACE` 就是這樣。
--    ⇒ 若 84 貼下去到現在之間有人動過那兩樣,**這一支會把那個改動也一起打掉**。貼前先看 9b 那格。
-- ③ **貼它之前先跑 `84b` 的第 9 / 9b 格**,把當下的 md5 / SET / SECDEF 記下來 ——
--    **回退也是一次改動,它一樣要留得下前後兩個讀數。**

BEGIN;

-- ── 貼前確認:現在跑的【真的是】84 那一版(不是別的東西)────────────────────────
DO $r0$
DECLARE v_md5 text; v_len integer; v_args text;
  c_args constant text := 'p_order_id uuid, p_amount integer, p_dr_code text, '
                          'p_occurred_at timestamp with time zone, p_attested boolean, '
                          'p_actor text, p_request_id text';
BEGIN
  -- 🔴🔴 **鎖【完整簽章】**(R4 must-fix ②)—— 舊版只按 `proname` 找:
  --   災難時七參數那支若已不存在、而另有同名重載 ⇒ 舊版取得非 NULL body、印個警告就往下
  --   ⇒ 🛑 **`CREATE OR REPLACE` 會【新建】一支七參數函式** —— 那不是還原,那是無中生有。
  --     而新建的那支**沒有舊 ACL 可保留**,本檔也不收權 ⇒ 權限狀態未定義。
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_md5, v_len
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_backfill_tappay_console_refund'
     AND pg_get_function_identity_arguments(p.oid) = c_args;
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '84r:找不到【七參數那一支】admin_backfill_tappay_console_refund'
                    '(簽章 [%])⇒ **拒繼續**。'
                    '理由:繼續下去 `CREATE OR REPLACE` 會【新建】而不是【還原】,'
                    '而新建那支沒有舊 ACL、本檔也不收權。', c_args;
  END IF;
  IF v_md5 <> 'a2649c7616d269642e017e48c1d8ee0e' THEN
    RAISE WARNING '84r:現行 body 不是貼板 84 那一版(實際 md5=% len=%)。'
                  '⇒ 中間有人動過它。**這一支會把那個改動一起打掉。**'
                  '🛑 **本警告【不暫停、不等待確認】** —— 整檔一次送出的話,'
                  '下面的替換已經跟著跑了。要判斷就【不要整檔送】,先只跑這一段。', v_md5, v_len;
  END IF;
END
$r0$;

CREATE OR REPLACE FUNCTION public.admin_backfill_tappay_console_refund(
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

-- ── 還原之後:確認回到 84 貼之前那一版 ─────────────────────────────────────────
DO $r1$
DECLARE v_md5 text; v_len integer;
BEGIN
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_md5, v_len
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_backfill_tappay_console_refund'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_amount integer, p_dr_code text, '
           'p_occurred_at timestamp with time zone, p_attested boolean, '
           'p_actor text, p_request_id text';
  IF v_md5 IS DISTINCT FROM '88ca8531a02616e47d5d969b6f49dc59' OR v_len IS DISTINCT FROM 7433 THEN
    RAISE EXCEPTION '84r 事後閘:還原後不是前一代(期望 88ca8531…/7433,實際 %/%)', v_md5, v_len;
  END IF;
  -- 🔴 **成功訊息不得超出證據**(R4 nit ③):這裡只比了 body 指紋,
  --   **沒有比 `SET` 子句與 `SECURITY DEFINER`** ⇒ 不可以說「已還原成那一版」。
  RAISE NOTICE '84r 過:**前代 body 指紋相符**(md5=% len=%)。'
               '⚠️ 本閘【沒有】比 `SET` 子句與 `SECURITY DEFINER` —— 那兩樣請跑 `84b` 的第 9b 格看。',
               v_md5, v_len;
END
$r1$;

COMMIT;
