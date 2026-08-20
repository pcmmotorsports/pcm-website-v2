-- ============================================================
-- M-4b E10 片 D3-a(甲):`order_manual_refunds` 加作廢三欄 + 配對 CHECK
-- ============================================================
-- 主視窗 2026-08-20 裁定「拆,照 #452 甲/乙兩片」,時間戳由主視窗當場指派。
-- plan = ~/pcm-mailbox/W1-086-沖銷片-plan定版-20260820.md;範圍盤點 = W1-085(292 行)。
--
-- ── 本片做什麼 ──────────────────────────────────────────────
--   只加欄與約束。**零行為改變、零 RPC、零 GRANT、不動任何函式。**
--   「怎麼作廢」與「可退餘額要排除作廢列」都在乙片(20260820100000)。
--
-- ── 🔴 為什麼是「作廢一列」而不是「寫一筆負數列」──────────────
--   同族 `order_payments` 用的是「負額 + reverses_payment_id」。**本表兩個機制都沒有**:
--     · `20260820010000:167` 的金額欄 CHECK 要求嚴格大於零 ⇒ 負數列寫不出來
--     · 八欄無 `reverses_id`                              ⇒ 配對關係不在資料裡
--   而 repo 內另有一份**同形狀且已 apply**的前例:#452「作廢一筆採購」
--     甲 `20260813120000:341-350`(加欄 + `order_item_procurement_void_pair`)
--     乙 `20260814180000`(作廢 RPC)
--   ⇒ 照它做,上面兩個限制**兩個都不用碰**:作廢是「自己指自己」,不需要負數、不需要指標。
--
-- ── 🔴 為什麼是【三】欄,而 #452 只有兩欄 ────────────────────
--   #452 只加兩欄是 Sean 2026-08-13 拍板「不要增加太多欄位」,而它把「誰撤的」
--   交給 `admin_audit_log`(`20260813120000:359` 逐字)。
--   **而本族沒有那條路** —— 實測(2026-08-20):
--     `grep -c admin_audit_log 20260820021000` = 0   ← 登記 RPC
--     `grep -c admin_audit_log 20260820010000` = 0   ← 建表
--     `grep -c admin_audit_log 20260814180000` = 3   ← 🔴 正向對照:#452 那支真的有寫
--   ⇒ 對本表而言,「誰作廢的」**沒有第二個落點** ⇒ 不加 `voided_by` 就等於不記錄。
--   ⇒ 而這與本表自己的設計一致:`20260820010000` 的 `actor` 欄 COMMENT 逐字說
--     「現金退款的失敗模式是【人】…**這一欄不是稽核裝飾,是唯一的線索**」。
--     作廢同樣是人做的動作 ⇒ 同一條理由適用。
--   ⚠️ 這是**對前例的刻意偏離**,不是照抄失誤。偏離理由是量到的(上面那三個數),不是風格偏好。
--
-- ── 效度限制(不放寬)────────────────────────────────────────
--   · 本片**不**宣稱「作廢功能可用」—— 沒有任何寫入路徑,三欄永遠是 NULL。
--   · 本片**不**改變可退餘額的算法。`pcm_order_refundable_remaining` 一個字都沒動
--     ⇒ 套完之後它仍然 SUM 全部列,而全部列的 `voided_at` 都是 NULL ⇒ **結果與套用前相同**。
--   · 🔴 因此本片**不**會讓 `refund-remaining-single-source.test.ts` 變紅:
--     全檔零「那個被掃的金額欄字面」(數法:拿該欄名 `grep -c` 本檔 ⇒ 0)。
--     🔴 **而這一句本身差點推翻它自己** —— 初稿在這裡把欄名寫了出來,自檢當場數到 3,
--        三次全在【解釋為什麼要避開它】的註解裡。⇒ 掃描器眼中,註解與 code 是同一種東西。
--     **而那不是巧合,是設計** —— 見 §3 為什麼負測跑在移植的暫存表上。
BEGIN;

-- ══ 0. 前置閘(fail-closed;任一不成立就拒絕繼續)═══════════════════════════════
DO $pre$
DECLARE
  v_cnt     integer;
  v_control integer;
BEGIN
  -- P1. 標的表在。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_manual_refunds' AND c.relkind = 'r';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'D3-a 前置閘 P1:找不到 public.order_manual_refunds(命中 % 個)⇒ 20260820010000 未 apply;拒繼續', v_cnt;
  END IF;

  -- P2. 三欄【還沒有】。本支不冪等 —— 重跑會在這裡停,而那是刻意的:
  --     ADD COLUMN 重跑會直接報錯,先在這裡給一句看得懂的話。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_manual_refunds'::regclass
     AND NOT attisdropped
     AND attname IN ('voided_at', 'void_reason', 'voided_by');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D3-a 前置閘 P2:作廢欄已存在 % 欄 ⇒ 本支已 apply 過(或有人手動加過);拒繼續。'
                    '🔴 這【不是】「有人破壞了什麼」—— 本支不冪等,重跑本來就會停在這裡', v_cnt;
  END IF;

  -- P3. `pcm_b2_is_blank` 在,而且**語意是我們以為的那個**。
  --     🔴 只驗「函式存在」不夠:配對 CHECK 的另一半完全依賴它的行為。
  --        這裡當場讓它在**三個世界**表演,任一不符就拒絕。
  IF to_regprocedure('public.pcm_b2_is_blank(text)') IS NULL THEN
    RAISE EXCEPTION 'D3-a 前置閘 P3:找不到 public.pcm_b2_is_blank(text) ⇒ 20260805170000 未 apply;拒繼續';
  END IF;
  IF NOT (public.pcm_b2_is_blank(NULL) AND public.pcm_b2_is_blank(U&'\3000')
          AND NOT public.pcm_b2_is_blank('x')) THEN
    RAISE EXCEPTION 'D3-a 前置閘 P3b:pcm_b2_is_blank 的行為不是預期的三格'
                    '(NULL=>true / 全形空格=>true / ''x''=>false)⇒ 它被改過;拒繼續';
  END IF;

  -- 🔴 P4. **正向對照** —— 沒有這一格,上面 P2 的「0」同時相容於
  --     「三欄不存在」與「我這個查詢對任何欄名都回 0」。
  SELECT count(*) INTO v_control
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_manual_refunds'::regclass
     AND NOT attisdropped
     AND attname IN ('order_id', 'rail');
  IF v_control <> 2 THEN
    RAISE EXCEPTION 'D3-a 前置閘 P4(正向對照):本該命中的兩個既有欄只命中 % 個 ⇒ '
                    '**我的量法壞了,不是資料庫壞了** ⇒ P2 的 0 不可信;拒繼續', v_control;
  END IF;

  RAISE NOTICE 'D3-a 前置閘 P1-P4 全過(P4 正向對照 = %,證明 P2 的 0 有判別力)。', v_control;
END
$pre$;

-- ══ 1. 三欄(皆 nullable)════════════════════════════════════════════════════
-- 🔴 **刻意全部 nullable** —— 與 D1 的 `request_id uuid NOT NULL` 不同:
--    那一支必須賭「表為空」(`20260820021000:89` 逐字),本支**不依賴表空不空**。
--    ⇒ 套用時機因此不受「有沒有人已經登記過退款」影響。
ALTER TABLE public.order_manual_refunds
  ADD COLUMN voided_at   timestamptz,
  ADD COLUMN void_reason text,
  ADD COLUMN voided_by   text;

-- ══ 2. 配對 CHECK:三欄同生同滅 + 兩個文字欄不得純空白 ═══════════════════════
-- 形狀源自 `order_item_procurement_void_pair`(`20260813120000:348-350`),而**擴成三欄**:
--   前例用 `(a IS NULL) = (b IS NULL)`;三欄若照抄要寫兩條等式,`num_nonnulls` 一條講完
--   且加第四欄時不必重寫 ⇒ **刻意換寫法,不是抄漏**。
-- 🔴 `pcm_b2_is_blank` 以 `true` 承接 NULL(它明文不加 STRICT,`20260805170000:53-55`)
--    ⇒ 這裡仍顯式寫 `IS NULL OR NOT ...`:讓「NULL 由第一項管、空白由第二項管」在字面上分得開。
ALTER TABLE public.order_manual_refunds
  ADD CONSTRAINT order_manual_refunds_void_trio
    CHECK (pg_catalog.num_nonnulls(voided_at, void_reason, voided_by) IN (0, 3)
           AND (void_reason IS NULL OR NOT public.pcm_b2_is_blank(void_reason))
           AND (voided_by   IS NULL OR NOT public.pcm_b2_is_blank(voided_by)));

COMMENT ON COLUMN public.order_manual_refunds.voided_at IS
  '這筆非卡退款登記被作廢的時間(NULL = 這筆登記仍然有效)。'
  '🔴 **作廢不是「又退了一筆負的錢」,是「這筆登記本身是錯的」** —— 錢有沒有真的交回去,'
  '要看 actor 與稽核,不看本欄(本表記的是既成事實,作廢只是說「這件事我們記錯了」)。'
  '🔴 乙片(20260820100000)起,`pcm_order_refundable_remaining` 第三段會排除 voided_at 非 NULL 的列 '
  '⇒ **作廢一筆會讓可退餘額變大**。而那個數字被後台退款入口的閘吃 ⇒ 不是純顯示。'
  '⚠️ 本片(甲)只加欄,**沒有任何寫入路徑**;三欄在乙片落地前恆為 NULL。'
  '🔴🔴 **要回退(DROP COLUMN)本欄之前,先讀這三行** —— 它們不在任何交接檔裡,只在這裡:'
  '① DROP COLUMN voided_at ⇒ 已經被作廢的那些列**安靜地變回有效**(欄沒了,篩選條件也沒了);'
  '② pcm_order_refundable_remaining 立刻把它們重新算進去 ⇒ **可退餘額變小**;'
  '③ 而那個數字被後台退款發起入口的閘吃 ⇒ **客人少拿到錢,而畫面上一切正常**。'
  '⇒ 🔴 **任何回退腳本必須先擋**:`SELECT count(*) FROM order_manual_refunds WHERE voided_at IS NOT NULL` '
  '不是 0 就**停下來要人工判斷**,不得自動往下走。'
  '⚠️ 同族前例 #452 的回退腳本(scripts/452b-down.sql)驗的是「回退【沒碰到】業務資料」—— '
  '**那道閘擋不住本欄的病**:這裡那些資料【本身】就是回退會殺掉的東西 ⇒ 要更前面就擋。'
  '📌 為什麼寫在 COMMENT 而不是寫在回退腳本裡:**回退腳本現在還不存在**,而這個欄位已經存在了;'
  '而且「刪掉一個沒人在用的欄位」聽起來零風險 ⇒ 危險必須住在**要刪它的人一定會看到的地方**。';
COMMENT ON COLUMN public.order_manual_refunds.void_reason IS
  '作廢理由(與 voided_at / voided_by 由 order_manual_refunds_void_trio 三向配對;不得純空白)。'
  '🔴 這一欄是「為什麼當初記錯了」的唯一紀錄 —— 沒有它,作廢與誤刪在事後看起來一模一樣。';
COMMENT ON COLUMN public.order_manual_refunds.voided_by IS
  '誰作廢的。🔴 **#452 同款前例刻意沒有這一欄**(Sean 2026-08-13「不要增加太多欄位」,'
  '把「誰撤的」交給 admin_audit_log)—— **而本族沒有那條路**:2026-08-20 實測 '
  '`grep -c admin_audit_log` 於登記 RPC(20260820021000)= 0、建表(20260820010000)= 0,'
  '而 #452 的作廢 RPC(20260814180000)= 3(正向對照)。'
  '⇒ 不加本欄 = 不記錄,不是「記在別處」。偏離前例的理由是量到的,不是風格。'
  '✅ **2026-08-20 Sean 拍板「甲 要(多一個欄位)」** —— 這一格有正式授權,不是實作者自裁。'
  '🔴 它推翻的**不是** 08-13 那條「不要增加太多欄位」,是**那條拍板在本族不成立的前提**'
  '(前提 = 「誰撤的」有 admin_audit_log 可去;本族沒有那條路)。'
  '⚠️ 本欄**不是**身分驗證 —— 它是 RPC 的呼叫端填進來的字串,與 actor 同一個信任等級。';

-- ══ 3. 後置驗收 ═══════════════════════════════════════════════════════════════
-- 🔴 **為什麼負測跑在一張「移植過來的暫存表」上,而不是直接插進 order_manual_refunds**
--    ①插一列要填那個被掃的金額欄 ⇒ 本檔就會出現那個字面 ⇒ `refund-remaining-single-source.test.ts`
--      會對本檔報紅,而**它報得對**(它掃的就是那個欄位字面)。為了一個結構片去動那張 allowlist,
--      是拿「守門的分母」換「我這一片方便」⇒ 不做。
--    ②而**不是**繞過守門:暫存表上跑的是**從 pg_catalog 取出來的、部署後那一條約束的定義字面**
--      (`pg_get_constraintdef`)⇒ 驗的是**真的那一條**,不是我在這裡重打一遍的複製品。
--      🔴 若有人改了上面 §2 的字面,這裡取到的就是被改過的那條 ⇒ 負測跟著變 ⇒ 不會恆真。
DO $post$
DECLARE
  v_cnt integer;
  v_def text;
  v_ok  boolean;
  -- ⚠️ 原本還宣告了 `v_control` 與 `v_bad`,**隨 A4/A5 一起移除**(見下方 MF-2 那段)。
  --    留著不會報錯,但一個沒人用的變數會讓下一個人以為這裡曾經有一道檢查。
BEGIN
  -- A1. 三欄都在,而且**都是 nullable**。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_manual_refunds'::regclass
     AND NOT attisdropped AND NOT attnotnull
     AND attname IN ('voided_at', 'void_reason', 'voided_by');
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'D3-a 後置 A1:三個作廢欄應皆存在且皆 nullable,實 % 個符合;'
                    '(若欄在但 NOT NULL,本片的「不依賴表為空」就不成立)', v_cnt;
  END IF;

  -- A2. 約束在,而且**定義字面就是我們寫的那條**。
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_def
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_manual_refunds'::regclass
     AND conname  = 'order_manual_refunds_void_trio';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'D3-a 後置 A2:找不到 order_manual_refunds_void_trio 約束';
  END IF;
  IF position('num_nonnulls' in v_def) = 0 OR position('pcm_b2_is_blank' in v_def) = 0 THEN
    RAISE EXCEPTION 'D3-a 後置 A2b:約束定義少了兩個承重零件之一(num_nonnulls / pcm_b2_is_blank):%', v_def;
  END IF;

  -- 🔴 A3. **讓那條約束當場表演** —— 把它移植到一張暫存表,四個世界各餵一發。
  --     這一段的判別力來自:通過的那兩發**必須真的通過**,而該擋的那兩發**必須真的擋**。
  CREATE TEMP TABLE d3a_probe (voided_at timestamptz, void_reason text, voided_by text) ON COMMIT DROP;
  EXECUTE pg_catalog.format('ALTER TABLE d3a_probe ADD CONSTRAINT d3a_trio %s', v_def);

  -- 世界①:三欄皆 NULL(還沒作廢)⇒ 必須放行。
  BEGIN
    INSERT INTO d3a_probe VALUES (NULL, NULL, NULL);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN v_ok := false;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'D3-a 後置 A3-①:三欄皆 NULL 被擋下 ⇒ 約束太嚴,既有列會全部違規'; END IF;

  -- 世界②:三欄齊備且非空白 ⇒ 必須放行。
  BEGIN
    INSERT INTO d3a_probe VALUES (now(), '金額登記錯了', 'sean');
    v_ok := true;
  EXCEPTION WHEN check_violation THEN v_ok := false;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'D3-a 後置 A3-②:合法的作廢三件組被擋下 ⇒ 乙片的 RPC 會永遠寫不進去'; END IF;

  -- 🔴 世界③:只填兩欄(缺 voided_by)⇒ **必須擋**。
  BEGIN
    INSERT INTO d3a_probe VALUES (now(), '缺人', NULL);
    v_ok := true;
  EXCEPTION WHEN check_violation THEN v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'D3-a 後置 A3-③:三欄配對【沒有生效】—— 只填兩欄也寫得進去 ⇒ '
                    '會出現「作廢了但不知道是誰」的列,而那種列事後看起來與誤刪一模一樣';
  END IF;

  -- 🔴 世界④:理由是全形空格 ⇒ **必須擋**(這一格證明 pcm_b2_is_blank 真的被掛上了)。
  BEGIN
    INSERT INTO d3a_probe VALUES (now(), U&'\3000', 'sean');
    v_ok := true;
  EXCEPTION WHEN check_violation THEN v_ok := false;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'D3-a 後置 A3-④:純空白理由寫得進去 ⇒ 空白判定沒有掛上 '
                    '(注意:一般空格會被預設 btrim 擋掉,**全形空格不會** ⇒ 這一格用的就是全形)';
  END IF;

  -- 🔴🔴 **原本這裡有 A4「零列被作廢」與 A5「總列數對照」,兩道【都已移除】**(W4 唯讀對抗審查 R1 MF-2)。
  --    移除的理由不是「不重要」,是**它們在任何可達世界都不會紅**:
  --      `voided_at` 在 `:102` 的 `ADD COLUMN` 才出生,而 `:102` 到這裡之間對本表**零句寫入**
  --      (W4 實測:該區間對 order_manual_refunds 的寫入語句 = 0;正向對照 = 同段 4 句 INSERT,
  --       全在 `d3a_probe` 暫存表上)⇒ 剛長出來的欄位,每一列**必然** NULL。
  --    🔴 而**更貴的是原本那句 A5 的解釋** —— 它寫「若兩者都是 0,A4 只證明了表是空的」,
  --       **那個成因是錯的**:W4 構造了「表裡先放 3 列真資料再套用」那個世界,**A4 仍然綠**。
  --       真成因是 A4 **站在 `ADD COLUMN` 的下游**,與表空不空無關。
  --    ⇒ ⇒ 一道恆真的斷言配一句指錯成因的解釋,**比沒有斷言更糟** ——
  --       它長得像正向對照,會讓下一個人以為 A4 已經被檢查過了。
  --    📌 依本 repo 紀律(memory `feedback_unconstructible-negative-test-means-noop-guard`:
  --       **沒有測試證得了的縱深不是縱深,是一句宣稱**),留這句話代替那兩道 code。
  --    ⇒ **本片「沒有寫入路徑」這件事,由「檔內零 INSERT/UPDATE 對本表」這個【可讀的事實】承擔,
  --       不由一道假裝在檢查的斷言承擔。**

  -- 🔴 A6-0. **先判存在,再問內容**(W4 R1 MF-3)。
  --    原版直接數「含 voided_at 的那支函式有幾個」⇒ 那個 0 同時相容於兩個世界:
  --      ①函式在,而且乾淨(我要的)   ②**函式根本不在**(整條 D 線的承重件不見了)
  --    ⇒ 而②不是無害的世界,它會讓 migration 說「一切正常」。
  --    📌 形狀與本人片 A 閘二(`20260820030000:236`)同款:**先 `to_regprocedure` 判存在。**
  --       這是我在片 A 做過、而在這裡漏掉的同一道 —— P2 的 0 我加了 P4 對照,A6 的 0 原本沒有。
  IF to_regprocedure('public.pcm_order_refundable_remaining(uuid)') IS NULL THEN
    RAISE EXCEPTION 'D3-a 後置 A6-0:找不到 public.pcm_order_refundable_remaining(uuid) ⇒ '
                    '**這不是「它很乾淨」,是它不在** —— 整條 D 線的可退餘額承重件缺席;拒繼續';
  END IF;

  -- A6. 函式一個字都沒動(本片的「零行為改變」宣稱)。
  --
  -- 🔴🔴 **本錨【刻意寫鬆】,而且它曾經被收窄過一次、又被退回來 —— 理由留在這裡,別再收窄它。**
  --    R1 的 nit 指出 `prosrc` 含註解 ⇒ 裸的 `voided_at` 會在「乙片只是加一句提到它的註解」時誤紅。
  --    我照那個 nit 把錨收窄成 `AND m.voided_at IS NULL`(23 字元)——
  --    🔴 **而 R2 實測那個修法把「誤紅」換成了「誤放」**(W4-031,同一個「乙片已生效」的世界,
  --       只換 WHERE 的寫法,每格自檢「函式體確含 voided_at」= 1):
  --         ① 我錨定的寫法 ✅開口   ② 換行縮排 ✅開口
  --         ③ 小寫 and/is null 🔴沒開口   ④ voided_at 條件寫在前面 🔴沒開口
  --         ⑤ AND 後兩個空格 🔴沒開口   ⑥ 不用別名寫全表名 🔴沒開口
  --       ⇒ **6 種等價寫法漏掉 4 種**,而④「`WHERE m.voided_at IS NULL AND m.order_id = o.id`」
  --         是乙片作者(同一個人)最自然會寫的順序。舊錨這 6 格**全部開口**。
  --    ⇒ ⇒ **裁定(主視窗):改回寬錨,接受那個誤紅。**
  --    📌 理由不是「舊的比較好」,是方向不對稱:
  --       **誤紅有人會來吵,誤放沒有** —— 誤放不會教任何人任何事,它只是安靜。
  --       (memory `feedback_a-false-block-teaches-the-habit-that-lets-false-passes-through`)
  --    ⚠️ 所以本道**會**在「乙片只是加註解提到 voided_at」時誤紅。**那是已接受的代價,不是缺陷。**
  --       要處理它,正解是乙片落地時建一個可查的標記(不比對文字),不是把這個錨再收窄一次。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refundable_remaining'
     AND position('voided_at' in p.prosrc) > 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D3-a 後置 A6:pcm_order_refundable_remaining 的函式體已經提到 voided_at ⇒ '
                    '本片的「零行為改變」宣稱不成立;拒繼續。'
                    '🔴 **射程說明(W4-031 實測,別把這道讀得比它大)**:真的那支函式是 LANGUAGE sql '
                    '(20260820010000:215)⇒ 建立時就 parse 函式體 ⇒ **欄位還不存在時乙片根本建不出來** '
                    '⇒ 「乙片被先套用了」在正常路徑上不可能發生(那條路會先被 P2 擋下)。'
                    '本道實際擋得到的是:plpgsql 版本的定義、或 check_function_bodies=off 的場合(例如 restore)。';
  END IF;
END
$post$;

COMMIT;
