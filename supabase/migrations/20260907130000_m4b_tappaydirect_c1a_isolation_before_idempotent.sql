-- ⟦b4-TAPPAYDIRECT⟧ C-1a 補強 —— **隔離級別斷言搬到冪等早退【之前】**
--
-- 來源:codex R1 補審(貼板 80,2026-09-07)**must-fix ②**;主視窗 A 裁「② 先修、account 寫」。
-- R1 全文:`~/pcm-mailbox/codex-R1-貼板80-letpass-20260907.md`
--
-- ══ 🔴 為什麼貼【完整定義】而不是 patch 型字串取代 ═══════════════════════════
-- 同一輪 codex R1 的 **must-fix ③** 就是在打 patch 型:`v_hits = 1` **不辨註解與語意** ——
-- 前代若把舊條件寫成 `IF false THEN -- IF NEW.refund_amount > v_cap THEN`,
-- **舊字串仍恰好命中一次**,而 patch 只改到註解、所有字串閘照過。
-- ⇒ 🎯 **所以本片貼完整的 `CREATE OR REPLACE FUNCTION`,版控裡看得到改完長什麼樣。**
-- ⚠️ 代價寫出來:版控裡因此有兩份幾乎相同的全文(`20260907100000` 與本檔)。
--    **那是刻意的** —— 它們**不會分岔**,因為後貼的那一份就是真相;
--    而 patch 型「不重複」的代價是**沒有人看得到改完的樣子**,那個代價更大。
--
-- ══ 本檔的函式全文怎麼來的 ═══════════════════════════════════════════════════
-- 🔴 **程式抽的,不是手打**:`scratchpad/build_c1a_fix.py` 從 `20260907100000` 抽
--    `CREATE FUNCTION … $fn$;` 整段(⛔ ~~我第一版註解寫 `CREATE OR REPLACE`~~ —— **舊檔 `:68` 實際是
--    `CREATE FUNCTION`**,codex R2 nit ⑦ 抓到;腳本抽完會把動詞換成 `CREATE OR REPLACE`),
--    只在 `BEGIN` 之後插入 G0 那一段,其餘**逐字不動**。
--    腳本內建三道自檢:①抽得到起訖 ②`RETURN v_existing::text;` **命中恰好 1 次**
--    ③**插入點在早退之前**(不成立就 assert 掛掉 —— 插在早退後面等於這一片沒有意義)。
--
-- ⚠️ **本支【不動】守門 `pcm_order_refund_cap_guard`、不動 A3、不動同步器。**
--    codex R1 的 must-fix ① 與 ③ 由 `-db` 處理(A 裁)。
-- 🛑 **貼之前要 codex R2 過,並走 Sean「貼 N」授權。**

BEGIN;

-- ── 🔴🔴 前置閘 P1 —— **鎖【完整簽章】+ 鎖【前代 md5】** ─────────────────────
--   codex R2 must-fix ②:舊版只按【名稱】取函式,沒鎖簽章 ⇒ 重載時 `SELECT INTO` 不保證選到目標;
--   而且**沒鎖前代內容** ⇒ 線上若已被別人加過一段(不含我在數的那個字)檢查,
--   我整段覆寫會**把那個修正撤掉,而所有閘照過**。
--   ✅ 改成:簽章逐字比 + `md5(prosrc)` 逐字比。**不等就 abort** ——
--      那不是「壞了」,那是**「有人改過,你要重新推導這一片」**的訊號。
--   🔬 期望值取自正式庫(線【帳號】`account` 唯讀,2026-09-07 14:2x):
--      md5(prosrc) = 88ca8531a02616e47d5d969b6f49dc59 · length(prosrc) = 7433
DO $p1$
DECLARE
  v_oid oid;
  v_md5 text;
  v_len integer;
  v_args text;
  v_cfg text;
  v_secdef boolean;
  c_md5  constant text := '88ca8531a02616e47d5d969b6f49dc59';
  -- 🔴🔴 **`prosrc` 看不到 `SET` 子句與 `SECURITY DEFINER`**(R3 must-fix F3)——
  --   而那正是這道閘要擋的那種改動:有人若用 `ALTER FUNCTION … SET search_path=…` 做安全強化
  --   (**本 repo 的 runbook 教的就是這一招**), `prosrc` 一個字都不會變 ⇒ 舊版 P1 印綠
  --   ⇒ 我整段覆寫**把那個強化打回 `SET search_path = ''`**。
  --   📎 同族已記:memory `reference_create-or-replace-resets-set-clause`。
  --   ⇒ ✅ 所以連 `proconfig` 與 `prosecdef` 一起鎖。
  -- 🔴 **逐值全等,不是「含有」**(R4 must-fix ①):
  --   舊版寫 `strpos(v_cfg, 'search_path=') = 0 就炸` ⇒ 🛑 **`search_path=pg_catalog, pg_temp`
  --   或多一項 `row_security=on` 都仍然含有那個子字串 ⇒ P1 照過, 而整組設定接著被覆寫。**
  --   ✅ 期望值是我從正式庫唯讀取的逐字值(2026-09-07 14:3x):
  --      `array_to_string(proconfig,'|')` ⇒ `search_path=""` · `prosecdef` ⇒ `true`
  c_cfg  constant text := 'search_path=""';
  c_sec  constant boolean := true;
  c_len  constant integer := 7433;
  c_args constant text := 'p_order_id uuid, p_amount integer, p_dr_code text, '
                          'p_occurred_at timestamp with time zone, p_attested boolean, '
                          'p_actor text, p_request_id text';
BEGIN
  SELECT p.oid, md5(p.prosrc), pg_catalog.length(p.prosrc),
         pg_get_function_identity_arguments(p.oid),
         array_to_string(p.proconfig, '|'), p.prosecdef
    INTO v_oid, v_md5, v_len, v_args, v_cfg, v_secdef
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_backfill_tappay_console_refund';

  -- 🔴 **查無要【直接炸】,不可以往下比** —— codex R2 must-fix ③ 打的就是這個形狀:
  --    `NULL < 1` 不成立 ⇒ 舊版會一路印「全過」。
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'C-1a 補強 P1:找不到 admin_backfill_tappay_console_refund ⇒ 先貼 20260907100000(貼板 79);拒繼續';
  END IF;

  IF v_args IS DISTINCT FROM c_args THEN
    RAISE EXCEPTION 'C-1a 補強 P1:簽章不是我預期的那一支。期望 [%] 實際 [%]', c_args, v_args;
  END IF;

  IF v_secdef IS DISTINCT FROM c_sec THEN
    RAISE EXCEPTION 'C-1a 補強 P1:`SECURITY DEFINER` 旗標不是我預期的(期望 % 實際 %)⇒ 拒繼續', c_sec, v_secdef;
  END IF;
  IF v_cfg IS DISTINCT FROM c_cfg THEN
    RAISE EXCEPTION 'C-1a 補強 P1:`SET` 子句不是我預期的那一組(期望 [%] 實際 [%])'
                    '⇒ 有人動過它。**不要硬貼** —— `CREATE OR REPLACE` 會把【整組】 `SET` 換掉,'
                    '那個改動會消失。請重新從現行定義推導這一片。', c_cfg, v_cfg;
  END IF;
  IF v_md5 IS DISTINCT FROM c_md5 OR v_len IS DISTINCT FROM c_len THEN
    RAISE EXCEPTION 'C-1a 補強 P1:**前代 body 與我推導這一片時看到的不一樣**'
                    '(期望 md5=% len=%,實際 md5=% len=%)。'
                    '⇒ 有人改過它。**不要硬貼** —— 整段覆寫會撤掉那個改動。'
                    '請重新從現行 body 推導這一片。', c_md5, c_len, v_md5, v_len;
  END IF;
  RAISE NOTICE 'C-1a 補強 P1 過:簽章與前代 md5 都對得上(len=%)。', v_len;
END
$p1$;

-- ── 前置閘 P2:它現在【沒有】那一整句斷言 ────────────────────────────────────
--   🔴 剝註解再數(codex R2 must-fix ①):`--…行尾` 與 `/*…*/` 都先拿掉,
--      否則「把碼註解掉」與「碼還在」印同一個數。
DO $p2$
DECLARE v_src text; v_bare text; v_hits integer;
  c_code constant text := 'IF pg_catalog.current_setting(''transaction_isolation'') <> ''read committed'' THEN';
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_backfill_tappay_console_refund';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'C-1a 補強 P2:取不到 prosrc ⇒ 拒繼續(不往下比 NULL)';
  END IF;
  v_bare := pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(v_src, '/\*.*?\*/', '', 'gs'),
              '--[^
]*', '', 'g');
  v_hits := (pg_catalog.length(v_bare)
             - pg_catalog.length(pg_catalog.replace(v_bare, c_code, '')))
            / pg_catalog.length(c_code);
  IF v_hits <> 0 THEN
    RAISE EXCEPTION 'C-1a 補強 P2:剝掉註解之後仍數到 % 句隔離斷言 ⇒ 已 apply 過或已被別人改;拒繼續', v_hits;
  END IF;
END
$p2$;

-- ── 🟢 前置閘 P3(正向對照):同一把【剝註解的尺】對守門要數得到 ────────────────
--    🔴 codex R2 must-fix ③:查無要直接炸,不可以讓 `NULL < 1` 靜靜放行。
DO $p3$
DECLARE v_src text; v_bare text; v_hits integer;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refund_cap_guard';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'C-1a 補強 P3(正向對照):**找不到守門 pcm_order_refund_cap_guard** '
                    '⇒ 這把尺沒有對照組可量 ⇒ 拒繼續(舊版在這裡會靜靜放行 —— codex R2 must-fix ③)';
  END IF;
  v_bare := pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(v_src, '/\*.*?\*/', '', 'gs'),
              '--[^
]*', '', 'g');
  v_hits := (pg_catalog.length(v_bare)
             - pg_catalog.length(pg_catalog.replace(v_bare, 'transaction_isolation', '')))
            / pg_catalog.length('transaction_isolation');
  -- 🔴 門檻是 **2** 不是 1(R3 nit N5):守門實際有兩處(`20260902010000…:59,:63`)。
  --   寫 `< 1` 的話, 有人把其中一處註解掉, 這個正對照照樣印綠。
  IF v_hits < 2 THEN
    RAISE EXCEPTION 'C-1a 補強 P3(正向對照):剝註解後守門裡只數到 % 處 transaction_isolation(預期 2)⇒ 量法壞了或守門被改, 拒繼續', v_hits;
  END IF;
  RAISE NOTICE 'C-1a 補強 P1-P3 全過(守門剝註解後命中 % 次 ⇒ 尺是活的)。', v_hits;
END
$p3$;

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
  -- ── 🔴🔴 G0 隔離級別 —— **這一段是本片新增的,而它必須是【第一件事】** ────────
  --   來源:codex R1 補審(貼板 80)must-fix ②;主視窗 A 裁「② 先修、account 寫」。
  --   R1 全文 `~/pcm-mailbox/codex-R1-貼板80-letpass-20260907.md`。
  --
  --   🛑 **失敗情境(codex 構造,非實測)**:訂單總額 100,已有兩筆各 200 的 `confirmed` 補登;
  --     T1 在 REPEATABLE READ 建快照。T2 作廢其中一筆並提交 —— 因另一筆仍超額,
  --     `payment_status` 維持 `refunded`,同步器不 UPDATE 父列。
  --     T1 重送**被作廢那筆**的 `request_id` ⇒ 鎖父列不必遇到 concurrent-update 錯誤,
  --     普通 SELECT 仍讀到舊 `confirmed` ⇒ **直接回傳其 ID**。
  --     ⇒ 🔴 **沒有 INSERT ⇒ 守門的 PCM06 完全不會執行。**
  --
  --   🔴 **為什麼不是把冪等指紋寫得更嚴**:指紋已經要求 `status = 'confirmed'`,
  --     而 **RR 的快照本來就會把已作廢那列讀成 `confirmed`**
  --     ⇒ 📌 **在同一個快照裡,沒有任何述詞救得了它 —— 再嚴的指紋都是對著舊照片問問題。**
  --
  --   🔴 **而這道斷言【本來就存在,只是站錯地方】**:`pcm_order_refund_cap_guard` 有它,
  --     而那是 **BEFORE INSERT trigger** ⇒ **早退那條路一個 INSERT 都沒有 ⇒ 它永遠碰不到。**
  --     🔬 量到的:`grep -c transaction_isolation` 對 `20260907100000…c1_backfill_rpc.sql` ⇒ **0**;
  --       🟢 同一把尺對正式庫現行守門 body ⇒ 命中 **2** 處(`:18` / `:22`)
  --       ⇒ **尺是活的,那個 0 不是尺壞掉。**
  --   ⇒ 🎯 **本片是在 RPC 【新增】一道同類檢查。**
--     ⛔ ~~我第一版寫「不是新增、是搬」~~ —— **守門那道並沒有移除**(codex R2 nit ⑦)
--     ⇒ 兩處各有一道,而它們擋的是**不同時機**:守門擋 INSERT,這道擋**連 INSERT 都走不到的那條路**。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_backfill_tappay_console_refund: 這支只在 READ COMMITTED 下正確'
                    '(現在是 %)⇒ 拒收。理由:更高的隔離級別會讓冪等比對讀到過期的快照,'
                    '把一筆【已作廢】的補登回報成成功,而且完全不經過 INSERT ⇒ 上限守門不會跑。',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P7B09';
  END IF;
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

-- ── 🔴 事後閘 Q1/Q2:**先剝註解再數、再比位置** ────────────────────────────────
--    codex R2 must-fix ①:`IF false THEN -- IF pg_catalog.current_setting(…) THEN`
--    ⇒ 舊版「錨整句」照樣命中 1 次、位置也在早退之前 ⇒ **三道閘全過而那道碼從不執行。**
--    ✅ 剝掉 `--…行尾` 與 `/*…*/` 之後再量 —— 註解裡的那一份就不在分母裡了。
--    ⚠️ **而這仍然不是語意驗證** —— 真正的證人是 `84b` 的行為驗
--       (拋棄式 PG 上用 RR 呼叫一次必回 P7B09 / 用 RC 呼叫不觸發)。**兩層都要。**
DO $q12$
DECLARE
  v_src text; v_bare text; v_hits integer; v_iso integer; v_ret integer;
  c_code constant text := 'IF pg_catalog.current_setting(''transaction_isolation'') <> ''read committed'' THEN';
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_backfill_tappay_console_refund';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後閘 Q1:取不到 prosrc ⇒ 拒絕(不往下比 NULL)';
  END IF;
  v_bare := pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(v_src, '/\*.*?\*/', '', 'gs'),
              '--[^
]*', '', 'g');

  v_hits := (pg_catalog.length(v_bare)
             - pg_catalog.length(pg_catalog.replace(v_bare, c_code, '')))
            / pg_catalog.length(c_code);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION '事後閘 Q1:剝註解後那一整句命中 % 次(預期 1)⇒ 沒進去、進了兩份、或被註解掉', v_hits;
  END IF;

  v_iso := pg_catalog.strpos(v_bare, c_code);
  v_ret := pg_catalog.strpos(v_bare, 'RETURN v_existing::text;');
  IF v_iso = 0 OR v_ret = 0 THEN
    RAISE EXCEPTION '事後閘 Q2:剝註解後找不到其中一個錨(iso=% ret=%)⇒ 量法壞了', v_iso, v_ret;
  END IF;
  IF v_iso > v_ret THEN
    RAISE EXCEPTION '事後閘 Q2:隔離斷言(%)排在冪等早退(%)後面 ⇒ 本片沒有意義', v_iso, v_ret;
  END IF;
  RAISE NOTICE '事後閘 Q1/Q2 過(剝註解後):斷言 1 句、位置 % < 早退 %。', v_iso, v_ret;
END
$q12$;

-- ── 🟢 事後閘 Q3:**九個**錯誤碼(八個舊的 + 新的 P7B09)+ 尺的負對照 ─────────────
--    codex R2 nit ④:舊版不驗新碼 ⇒ 把 `P7B09` 換成 `P0001` 也全過,而呼叫端就失去辨識碼。
--    🛑 **射程照實寫**:這一格只證「這九個字面在」,**不證其他邏輯沒被改壞** ——
--       那要靠 P1 的前代 md5(改動只有 G0)+ `84b` 的行為驗。
DO $q3$
DECLARE v_src text; v_bare text; v_cnt integer;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_backfill_tappay_console_refund';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '事後閘 Q3:取不到 prosrc ⇒ 拒絕';
  END IF;
  -- 🔴 **剝註解再數**(R3 nit N1):`-- P7B09` 寫在註解裡就過關 ⇒ 那樣沒有任何一把尺在證它是活碼。
  v_bare := pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(v_src, '/\*.*?\*/', '', 'gs'),
              '--[^\n]*', '', 'g');
  SELECT count(*) INTO v_cnt
    FROM unnest(ARRAY['P7B01','P7B02','P7B03','P7B04','P7B05','P7B06','P7B07','P7B08','P7B09']) AS c
   WHERE pg_catalog.strpos(v_bare, c) > 0;
  IF v_cnt <> 9 THEN
    RAISE EXCEPTION '事後閘 Q3:九個錯誤碼只命中 % 個(含新碼 P7B09)', v_cnt;
  END IF;
  IF pg_catalog.strpos(v_src, 'P7B99') > 0 THEN
    RAISE EXCEPTION '事後閘 Q3(負對照):現造的碼 P7B99 竟然命中 ⇒ 我的量法壞了';
  END IF;
  RAISE NOTICE '事後閘 Q3 過:九個碼都在, 負對照 P7B99 不在。';
END
$q3$;

COMMIT;
