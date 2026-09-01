-- ⟦b4-PCM05SPLIT⟧ · 把「查無訂單」從 `PCM05` 拆出來, 給它自己的碼 `PCM07`
--
-- ══ 一句話 ═══════════════════════════════════════════════════════════════════
--   `PCM05` 現在同時是【查無訂單】與【算不出可退上限】兩件事,
--   **而這兩件事給員工的下一步是相反的**(重新整理 vs 找工程)。
--   app 層拿到 `PCM05` **分不出來** ⇒ 只能挑一個 ⇒ 另一種永遠看到錯的指示。
--   本支把前者拆成 `PCM07`。
--
-- ══ 🔴 這一列的完成判準【已經被別人推成 1 了, 而本列還沒做完】═══════════════
--   板 `⟦b4-PCM05SPLIT⟧`(`docs/launch-todo.md:800`)的判準逐字:
--     「`grep -rl PCM07 supabase/migrations/*.sql | wc -l` 現值 **0** ⇒ 變成 1 且
--       app 端 `CAP_GUARD_FAILURE_CODE` 多一格 = 本列可關」
--   🔴 **而 2026-09-02 當場量:那個數字已經是 1** —— 線 `-b4` 的
--      `20260901200000_m4b_caprace1_parent_row_lock.sql:310` 用了 `PCM07`,
--      而它做的是**另一條路**(手動退款 `pcm_manual_refund_rail_cap_guard`), 不是本支這一條。
--      ✅ 它自己的註解逐字寫著「本片把那個 0 推成 1(migration 那一半), **app 端那一半仍留給 743**」
--      ⇒ **它是誠實的, 而那個判準不是。**
--   ⇒ 📌 **判準綁在一個字面上, 而那個字面【任何人都推得動】** ——
--     一個照判準檢查的人今天會看到「1」而把這一列標成 done, 而 app 端一格都還沒有。
--   ⇒ ⇒ **那一列自己就寫著這個風險**(逐字「判準綁在一個字面上, 而那個字面是未來的人選的」)
--     —— 而寫下風險沒有阻止它發生。**寫下來與擋住是兩件事。**
--   ✅ **本支交件時要一併請 `-f3` 把那條判準改成【兩半各一個】:**
--     ① `grep -c "USING ERRCODE = 'PCM07'" supabase/migrations/20260902010000*.sql` ⇒ 1
--     ② app `CAP_GUARD_FAILURE_CODE` 有 `PCM07` 那一格
--
-- ══ 🛑 本支【不做】什麼 ═══════════════════════════════════════════════════════
--   · 不動 `:115` 那一句(算不出上限)—— 它留在 `PCM05`, 而那正是拆分後 `PCM05` 唯一的語意
--   · 不動任何訊息字面(兩句人話一個字都沒改)
--   · 不動 `20260901200000` 那一支(它是另一條路, 而它已經自己用了 `PCM07`)
--   · 函式本體逐字沿用上一代 `20260902000000`(`latest-definition-of.sh` ⇒ newest = 20260902000000)
--
-- ══ ⚠️ 新舊交錯上線 ═══════════════════════════════════════════════════════════
--   🛑🛑 **【codex must-fix】部署順序:app 必須【先】上, DB 才貼。**
--   ⛔ ~~舊 app + 新 DB ⇒ 落到通用錯誤訊息 ⇒ 只是訊息難懂, 與今天同級。~~ **那句話是錯的。**
--      舊 app 不認得 `PCM07` ⇒ `toCapGuard` 回 null ⇒ 落到**通用錯誤**,
--      而通用錯誤那句話會**鼓勵他再試一次** —— 而「訂單不在」再試一百次也不會有。
--      ⇒ 🔴 那不是「與今天同級」:今天他至少被送去找工程(`exceeds_unknown`, 明說勿重試),
--        而那個窗口裡他會【一直按】。**方向剛好相反。**
--   ✅ **⇒ 所以交件說明必須寫:這一支要在【後台新版上線之後】才貼。**
--   🔵 新 app + 舊 DB ⇒ DB 還是吐 `PCM05` ⇒ 走今天那條路(`exceeds_unknown`)
--      ⇒ **與今天逐字相同** ⇒ 這個方向是安全的, 所以順序才是「app 先」。

CREATE OR REPLACE FUNCTION public.pcm_order_refund_cap_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cap  bigint;
  v_lock uuid;
BEGIN
  -- 🔴 **執行期也斷言隔離級別,不只 apply 時。**
  --    本片的整個推導(「read committed 之下看不到別人未 commit 的列」⇒ 所以需要鎖)
  --    **依賴那個級別**。哪天有人把預設調成 repeatable read / serializable,
  --    鎖的必要性與本閘的行為都會變 —— **而今天沒有任何東西會出聲。**
  --    ⚠️ 它**不是**鎖的替代品:它讓「我假設的世界變了」會叫,不讓超額退款不發生。
  --    🔵 這一行抄自 repo 既有慣例(`pcm_a4a_*_summary_recompute` 等四支都這樣做)。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION
      '這筆退款的安全檢查在一個沒有預期到的資料庫設定下執行(隔離級別 = %),為了安全先擋下,'
      '退款沒有發起、錢沒有動。請通知系統維護。',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'PCM06';
  END IF;

  -- 🔴🔴 **先鎖父列,再算 cap** —— 這一行是本片的本體。
  --    少了它:兩個 session 各自算出同一個 cap、各自判「還夠」⇒ 兩筆都進去。
  --    **2026-08-30 實測過,不是理論**(見檔頭)。
  --
  -- 🔴🔴 **鎖的【強度】也是承重的,而正確答案已經寫在 repo 裡了**(codex R1 逼我去查):
  -- ```
  -- ⛔ 我第一版用 FOR UPDATE。
  -- 而 `admin_initiate_order_refund`(20260812170000:88-89)逐字寫著:
  --   「G1:FOR NO KEY UPDATE —— **FOR UPDATE 與 FK RI KEY SHARE 死結 40P01 實錘**;
  --     鎖順序沿既有約定 orders → order_refunds;INSERT trigger 的 FOR SHARE 同列同交易相容」
  -- ⇒ **我選的正是他們已經實錘會死結的那一個。**
  -- ✅ 改成 FOR NO KEY UPDATE:①與 FK 檢查的 KEY SHARE 相容 ②仍然與另一個
  --   FOR NO KEY UPDATE 互斥 ⇒ **併發序列化的效果不變**
  -- ```
  -- 📌 **⇒ 這一格不是我推出來的,是【repo 裡已經有人踩過並寫下來】的。**
  -- 🔵 而那支 RPC 在 INSERT 之前**已經取了同一把鎖**(步 3)⇒ 走 RPC 的正常路徑上,
  --    本行是一個 **no-op**(同交易已持有)⇒ **零額外成本、零額外鎖序風險**。
  --    ⇒ **本行真正守的是【不經那支 RPC 的直接 INSERT】** —— 而那正是閘該存在的理由。
  SELECT o.id INTO v_lock
    FROM public.orders o
   WHERE o.id = NEW.order_id
     FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    -- 父列不在 ⇒ FK 本來就會擋,而在這裡先講清楚比讓 FK 吐一句看不懂的話好。
    -- 🔴 **本支唯一的改動就是下面這個碼:`PCM05` ⇒ `PCM07`。訊息一個字都沒動。**
    --    這一句的意思是【查無訂單 ⇒ 重新整理】, 而 `:115` 那一句的意思是
    --    【算不出上限 ⇒ 找工程】—— **兩者的下一步相反, 而它們共用一個 SQLSTATE。**
    --    ⇒ app 層拿到 `PCM05` 分不出眼前是哪一種 ⇒ 只能挑一個,
    --      而它挑了「找工程」(錯的方向比較安全:白跑一趟、錢不動;
    --      反過來說成「重新整理就好」⇒ **他會一直按動錢的按鈕**)。
    --    ⇒ ⇒ 給它自己的碼之後, app 才講得出「請重新整理」。
    --    🔵 **`PCM07` 這個碼名不是我選的** —— 線 `-b4` 的 `20260901200000:310` 已經先用它
    --      表達【完全相同的語意】(手動退款那條路的「找不到這筆退款要掛的訂單」),
    --      而它在註解裡明說「app 端那一半留給 743」。⇒ **本支就是那一半的另一條路。**
    RAISE EXCEPTION
      '找不到這筆退款要掛的訂單,退款沒有發起、錢沒有動。請重新整理後確認。'
      USING ERRCODE = 'PCM07';
  END IF;

  -- 🔴🔴 **第二把鎖:把「更正判定」那條路也拉進同一個序列**(codex R1/R2 must-fix,實測關掉的)
  -- ```
  -- 病:admin_correct_order_refund_verdict(20260814190000:261-269)【只鎖子列、不鎖 orders】
  --    ⇒ 它與新退款鎖的是【不同的東西】⇒ 不會互相等
  --    ⇒ 一筆「更正成 money_moved」(那會讓 cap 變小)與一筆新退款可以同時 commit
  --    ⇒ 新退款按【舊的 cap】放行 ⇒ 事後總額超過 cap。
  -- 藥:它鎖子列用的是 FOR NO KEY UPDATE,而 **FOR SHARE 與它互斥**
  --    ⇒ 本閘在算 cap 之前,對【會影響 cap 的那幾列】取 FOR SHARE ⇒ 兩條路序列化。
  -- 鎖序:orders(NO KEY UPDATE)→ order_refunds(SHARE) —— **與 repo 既有約定同向**
  --    (20260803150000:244 逐字「鎖順序約定:orders(FOR SHARE)→ order_refunds」)
  --    ⇒ 而更正那支【只拿 order_refunds】、不要 orders ⇒ 沒有環 ⇒ 不會死結,只會排隊。
  -- ```
  -- 📌 **判別句:兩個交易鎖【不同的東西】就不會互相等 —— 而它們改的是同一個帳。**
  -- ⚠️ **只鎖 `failed` + `manual_failed` 那幾列**:它們是更正表唯一會動到的對象
  --    (`20260814190000:2` 逐字「更正的對象是 order_refunds 的 manual_failed」)
  --    ⇒ 不必鎖全部帳本列,那會把無關的退款也拖進來排隊。
  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = NEW.order_id
      AND r.status = 'failed'
      AND r.failed_reason = 'manual_failed'
      FOR SHARE;

  v_cap := public.pcm_order_refundable_remaining(NEW.order_id);

  IF v_cap IS NULL THEN
    -- 🔴 **與「金額太大」分開一個碼**(同 `#866` PCM02 的理由):
    --    那是金額問題,這是**系統算不出上限** —— 員工的下一步完全不同。
    --    ⚠️ 措辭照實:不寫「讀不到帳本」(真的讀不到通常直接拋權限錯),寫「算不出來」。
    RAISE EXCEPTION
      '這張單算不出可退上限 ⇒ 為了安全先擋下,退款沒有發起、錢沒有動。'
      '這與「金額太大」不同:那是金額問題,這是系統算不出上限,請找工程確認。'
      USING ERRCODE = 'PCM05';
  END IF;

  IF NEW.refund_amount > v_cap THEN
    -- 🔴 負 cap 也走這句人話(同 `#866` F-nit):髒資料下 cap 可能是負的,
    --    而「上限 -500」對員工不可讀。**fail-closed 的行為對,訊息也要對。**
    RAISE EXCEPTION
      '這張單目前只剩 % 元可退,退不了 % 元,退款沒有發起、錢沒有動。'
      '(這個數字已經扣掉處理中與已完成的退款、已判定錢有動的失敗退款、以及現金/匯款退款。)',
      GREATEST(v_cap, 0), NEW.refund_amount
      USING ERRCODE = 'PCM04',
            -- 🔴 **本支唯一的改動就是下面這兩行。**上面那句人話一個字都沒動。
            --    ⇒ 為什麼要它:那個數字今天【只存在於人話字串裡】, 而 app 層
            --      明文紀律是「分類依 SQLSTATE、**不解析 RPC message 的內容**」
            --      (`manual-refund-repository.ts` 檔頭)⇒ 從字串挖數字會做出一個
            --      **跟著文案漂**的解析器:改一個字, 員工看到的金額就變成 undefined,
            --      而三綠不會紅、型別也不會紅。
            --    ⇒ ⇒ 所以要把它當【結構化欄位】送出去, 而 `DETAIL` 就是那個欄位。
            --    ✅ 機制不是猜的(線 `-e4` 2026-08-31 實測:拋棄式 PG 17.10 + PostgREST 14.16
            --       + 真的 `@supabase/supabase-js` 2.105.3)⇒ `DETAIL` / `HINT` 兩欄【原樣抵達】
            --       `error.details` / `error.hint`。
            --    ⚠️ `DETAIL` 是給機器讀的 JSON, **不是給員工看的字** ——
            --       員工那句話由 app 層組(措辭鐵律 `refund-ledger-view.ts:4-8` 管的是那一句)。
            DETAIL = json_build_object(
                       'cap',   GREATEST(v_cap, 0),
                       'asked', NEW.refund_amount
                     )::text,
            HINT = 'lower-the-amount';
  END IF;

  RETURN NEW;
END
$fn$;


-- ── COMMENT 也要跟著改 ────────────────────────────────────────────────────────
-- 🔴 **`COMMENT ON FUNCTION` 是這個碼表【唯一寫在資料庫裡】的說明** ——
--    改了碼而沒改它 ⇒ 下一個人 `\df+` 讀到的是「PCM05=算不出上限或查無訂單」,
--    而那句話從這一支之後就是假的。
--    ⇒ 📌 而 `information_schema` / `pg_proc` 看不到 repo 的註解 —— **DB 裡的人只讀得到這一句。**
--    ⚠️ 而 `20260902000000`(上一支)**沒有帶 COMMENT** ⇒ 正式庫上那句仍是 `20260830210000` 那一版。
--       ⇒ 本支一併補上, 而其餘字面逐字沿用它, 只動 SQLSTATE 那一行。
COMMENT ON FUNCTION public.pcm_order_refund_cap_guard() IS
  '#445b:order_refunds 的 BEFORE INSERT ROW 金額上限閘。先對父列 orders 取 '
  '**FOR NO KEY UPDATE**(不是 FOR UPDATE —— 後者與 FK RI 的 KEY SHARE 死結,'
  '20260812170000:88-89 實錘)再算 pcm_order_refundable_remaining ⇒ 併發序列化。'
  'SQLSTATE:PCM04=超額(DETAIL 帶 {"cap","asked"} 的 JSON, 20260902000000)/ '
  'PCM05=算不出上限 / PCM06=隔離級別非 read committed / PCM07=查無訂單(20260902010000 從 PCM05 拆出)。'
  '🔴 trigger 名字承重:必須排在 order_refunds_a7c_insert_guard_bi 之前,否則本片的鎖變成升級 ⇒ 死結。'
  '(驗這個順序的後置斷言①b 在 20260830210000 那一支;20260902000000 與本支只 REPLACE 函式本體、'
  '不動 trigger,所以沒有重跑它。)'
  '🔴 只做 INSERT —— DELETE 與改金額由 20260801120000 的兩道鄰居擋,前置閘驗它們是啟用的 ROW 級。';

-- ── 後置斷言:兩個碼各自恰好一處, 而它們【不得是同一句】 ──────────────────────
-- 🔴 這道斷言問的是「拆開了沒」, 不是「有沒有 PCM07」——
--    後者在【只加了 PCM07 而忘了把 PCM05 那句拿掉】的世界也會過。
DO $assert_split$
DECLARE
  v_src text;
  v_p05 int;
  v_p07 int;
BEGIN
  SELECT pg_catalog.pg_get_functiondef('public.pcm_order_refund_cap_guard()'::regprocedure) INTO v_src;
  -- 🔴 **第一版數的是【行】不是【會執行的行】** —— 我自己寫的註解裡就提到 `PCM07` 三次,
  --    而 apply 當場紅在「出現 3 次, 期望 1」。⇒ **註解被算成碼, 這是今晚第三次同款。**
  --    ⇒ 先把 `--` 到行尾剝掉再數。
  --    ⚠️ **射程**:這個剝法對【字串常值裡的 `--`】會誤剝。本函式的常值是中文句子, 沒有 `--`
  --      (當場可驗:剝完之後兩個碼各剩 1 次)⇒ 今天成立;**若日後有人在訊息裡寫 `--`, 這道會失準。**
  --    🔴 **【codex must-fix】第二版還是不夠**:只剝 `--` 而沒剝 `/* … */`
  --       ⇒ 一段區塊註解裡的 `PCM07` 可以冒充實碼而讓斷言錯誤通過。
  --    ⇒ 兩層都剝, **而且數的是完整 token `ERRCODE = 'PCM07'` 不是裸字面**
  --      ⇒ 兩道各自獨立:剝漏了一種註解, 完整 token 那道還在;有人換了寫法, 剝註解那道還在。
  v_src := regexp_replace(v_src, '/\*.*?\*/', '', 'gs');
  v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');
  v_p05 := (length(v_src) - length(replace(v_src, 'ERRCODE = ''PCM05''', ''))) / length('ERRCODE = ''PCM05''');
  v_p07 := (length(v_src) - length(replace(v_src, 'ERRCODE = ''PCM07''', ''))) / length('ERRCODE = ''PCM07''');
  IF v_p07 <> 1 THEN
    RAISE EXCEPTION 'PCM07 在函式本體出現 % 次, 期望 1 ⇒ 拆分沒有落地', v_p07;
  END IF;
  IF v_p05 <> 1 THEN
    RAISE EXCEPTION 'PCM05 在函式本體出現 % 次, 期望 1(只剩「算不出上限」那一句)⇒ 拆分不完整', v_p05;
  END IF;
  RAISE NOTICE '✅ 拆分落地:PCM05 剩 1 處(算不出上限)· PCM07 有 1 處(查無訂單)';
END
$assert_split$;
