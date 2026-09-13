-- 20260913030000 · M-4b:`email_outbox` 加一欄 `handed_to_provider_at`。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼(plan 全文 `docs/plans/2026-09-13-outbox-handed-to-provider-fact.md`,Sean 2026-09-13 答甲)
-- ══════════════════════════════════════════════════════════════════
-- 🔴 **病灶**:部分取消補寄信(`bank_order_amount_changed`)在寄送前重驗發現「快照過期」時,
--    今天**一律不退休 `dedup_key`** ⇒ 掃描面的 anti-join 從此擋著那一列
--    ⇒ 📌 **那一次取消再也補寄不出去, 而客人手上那封錯金額的信永遠不會被更正** ——
--      log 全綠、心跳綠、沒有錯誤碼。**沒有人會知道。**
--
-- 🛑 **而不能乾脆退休鍵** —— 那會打開另一個洞(codex `gpt-6-astra` 2026-09-13 合成實跑到送達數 2):
--    信 A 已被 Resend 接受而 `markSent` 落表失敗 ⇒ 列留 `sending` ⇒ 租約回收 ⇒ 重新認領
--    ⇒ 判快照過期 ⇒ 退休鍵 ⇒ 重排一封 ⇒ **新的 outbox id = 新的 provider 冪等鍵**
--    ⇒ 🔴 **同一次取消寄出兩封**(金額若又被改回去, 客人收到兩封一模一樣的信)。
--
-- ⇒ 🎯 **兩個方向都會出事, 而分辨它們需要一個事實:這一列交給過 provider 沒有。**
--    本欄就是那個事實。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴 為什麼這個事實今天不在表上 —— **而它不是「有人忘了加」**
-- ══════════════════════════════════════════════════════════════════
-- 三個看起來像載體的欄位, 逐一開檔驗過**都不是**:
--   · `attempts`            ⇒ 死信救援 `admin_requeue_dead_email` 把它**歸零**
--                             (`20260831040000:136-142` 逐字 `attempts = 0`)
--                             ⇒ 📌 一列**已送達**的死信被救回來之後, 長得跟全新的一模一樣。
--   · `last_error_code`     ⇒ 回收器寫 `lease_reclaimed`, 而下一次 `markFailed` 覆寫它;
--                             死信救援也把它設回 NULL(同上 `:141`)⇒ 它是**最近一次**的原因, 不是歷史。
--   · `provider_message_id` ⇒ 由 `markSent` 寫 ⇒ **只有成功落表那條路才有**
--                             ⇒ 正好在我們要問的那個世界裡是 NULL。
-- 📌 **`attempts` 從來就不是這個事實的載體** —— 它是**退避的依據**
--    (`20260717020000:306` 欄註解逐字「已嘗試次數(退避依據)」), 而死信救援歸零它是**對的**
--    (`claimDue` 的述詞是 `attempts < max_attempts`, 不歸零就救不回來)。
-- ⇒ 🛑 **那不是 bug, 是拿錯了東西去問一個它沒被設計來回答的問題。**
-- ⇒ 🔴 **下一個人不要再拿 `attempts` 試一次。**
--
-- 🔵 **而本支【不碰】`admin_requeue_dead_email`** —— 那是別人的設計, 要改是另一題端 Sean。
--    本欄靠的是**它不在那支 RPC 的 UPDATE 清單裡**(該支只寫 status / attempts / claimed_at /
--    next_retry_at / last_error_code)⇒ 📌 **它天生就活得過一次死信救援, 不需要任何人記得。**
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 部署順序 —— **四步, 而第 ④ 步是新的**(codex R2 must-fix 換來的)
-- ══════════════════════════════════════════════════════════════════
-- ```
-- ① 確認 BANK_ORDER_AMOUNT_CHANGED_EMAIL_ARMED **沒有設成 on**(前置閘④ 只驗「現在零列」,
--    驗不到那顆 env)
-- ② 貼本支(含回填)
-- ③ 部署會寫本欄的碼
-- ④ **這時才可以上膛那顆 env**
-- ```
-- 🔴 **③ 與 ④ 不可對調, 而理由是 codex R2 實跑出來的**:
--    舊碼(不寫本欄)若在 ② 與 ③ 之間送出一封部分取消補寄信而 `markSent` 落表失敗
--    ⇒ 那一列是 NULL ⇒ 新碼接手時判快照過期 ⇒ **把 NULL 讀成「確定沒送過」⇒ 退休鍵 ⇒ 寄第二封**
--    (實跑:2 次寄送、2 把不同冪等鍵)。
-- 🛑 **而 ① 與 ④ 是【人的順序】, 不是閘** —— 本支看不到 Vercel 的 env。
--    ⇒ 📌 它今天之所以成立, 是因為**那顆 env 從來沒被設過**(那條線一封都還沒寄)
--      ⇒ 這不是「風險很小」, 是**那個世界現在是空的**。前置閘④ 就是在量它還空不空。
--
-- 🔴 **而 ② 與 ③ 的順序另有理由(反序的後果不同)**:先部署碼再貼庫
--    ⇒ 碼去 select 一個不存在的欄 ⇒ `claimDue` 整發失敗
--    ⇒ **那一輪一封都不寄**(含付款成功信)。
--
-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行, 而**會丟資料**)
-- ══════════════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE public.email_outbox DROP COLUMN handed_to_provider_at;
-- 🔴 **那一行 `lock_timeout` 不是樣板**(`scripts/rollback-locktimeout-gate.py` 擋下我一次):
--    回退是【人把這段註解貼進 psql】跑的, 而 psql 預設**沒有** lock_timeout ⇒ 它會**無限等**。
--    📌 而「很慢」與「卡在鎖上」在那個畫面上是同一件事:兩者都是一個不動的游標。
-- 🔴 退掉之後「哪些列可能已經送過」就沒了 ⇒ 那個抉擇退回保守版(一律不退休鍵 ⇒ 少寄一封)。
-- ✅ **正確的回退單位是【碼】** —— 讓 sweep 不再寫、不再讀它, 這一欄留著(零資料損失)。
--    形狀與理由照 `20260906200000` 檔尾那一段(同一張表、同一種「加一欄」)。

BEGIN;

-- 🔴 **等鎖最多 5 秒, 等不到就放棄整發**(照 `20260906200000:36-39` 那格的理由)——
--    `ADD COLUMN` 取 `ACCESS EXCLUSIVE` 並**持有到 COMMIT**;不重寫整張表 ⇒ 那把鎖是**瞬間**的,
--    📌 而「不重寫」與「不鎖表」是兩件事 —— **等待期仍可能排隊**, 而它後面每一個查詢跟著排。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE v_cnt int;
BEGIN
  -- 前置閘①:那張表要在
  IF pg_catalog.to_regclass('public.email_outbox') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.email_outbox';
  END IF;

  -- 前置閘②:forward-only —— 欄已存在就拒重跑
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.email_outbox'::regclass
     AND a.attname = 'handed_to_provider_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘②:handed_to_provider_at 已存在 ⇒ forward-only,拒重跑';
  END IF;

  -- 🔴🔴 前置閘③:**`attempts` 那一欄要還在, 而且死信救援那支 RPC 也要還在。**
  --    本欄的整個價值建立在「它不在那支 RPC 的 UPDATE 清單裡」——
  --    ⇒ 📌 那支 RPC 不存在時, 這一欄的理由書就指向一個不存在的東西, 而**沒有東西會叫**。
  --    ⚠️ 誠實標:本閘只驗那支 RPC **存在**, **驗不到它的 UPDATE 清單裡有沒有本欄**
  --      (那要解析函式本文 ⇒ 一道會隨排版漂掉的閘)。⇒ 它是**指路標, 不是保證**。
  IF pg_catalog.to_regprocedure('public.admin_requeue_dead_email(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 admin_requeue_dead_email(uuid) ⇒ 本欄的理由書指向一個不存在的東西,停下人工確認';
  END IF;

  -- 🔴🔴 前置閘④:**唯一會讀這一欄的那個 event_type, 現在必須一列都沒有。**
  --    (codex `gpt-6-astra` 2026-09-13 must-fix 換來的閘。)
  --
  -- 🔬 **它擋的那個世界**:一列 `bank_order_amount_changed` 由**還不會寫本欄的舊碼**送出、
  --    而 `markSent` 落表失敗 ⇒ 加欄之後它仍是 NULL
  --    ⇒ 新碼回收重認領、判快照過期 ⇒ **把 NULL 讀成「確定沒送過」⇒ 退休鍵 ⇒ 寄第二封。**
  --    ⇒ 📌 **「先貼庫後上碼」擋不到它** —— 那個窗口在【碼上線之前】就已經存在。
  --
  -- ✅ 而它今天是空的, 而且那**不是巧合**:那條線由 `BANK_ORDER_AMOUNT_CHANGED_EMAIL_ARMED`
  --    上膛(逐字等於 `on`), 而那顆 env 還沒設 ⇒ 排信那一段整段不跑 ⇒ 零列。
  -- 🛑 **所以這一閘不是形式**:它非 0 ⇒ 代表那條線在本欄存在之前就被開過
  --    ⇒ **那些 NULL 的成因不可知** ⇒ 停下來人工判, 不要讓 migration 幫你決定。
  SELECT count(*) INTO v_cnt
    FROM public.email_outbox
   WHERE event_type = 'bank_order_amount_changed';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘④:email_outbox 已有 % 列 bank_order_amount_changed ⇒ 它們的 NULL 成因不可知(可能已送出而沒記到)⇒ 停下人工確認,不要讓退休鍵把它們讀成「確定沒送過」', v_cnt;
  END IF;
END
$precondition$;

-- 🔴 **NULL-able 且【沒有 DEFAULT】**:
--    ⛔ ~~① 既有每一列都是 NULL ⇒ **不需要回填**。而 NULL 的意思是「我們還沒開始記」或
--         「這一列還沒被交出去」—— 兩族在本欄上分不出來, **而那不影響本欄唯一的用途**:
--         退休鍵那個抉擇只問「可不可能已經送過」, 兩族的答案都是「不可能」。~~
--    🔴🔴 **那一整段是假的**(codex `gpt-6-astra` 2026-09-13 must-fix, 合成重現出兩個冪等鍵):
--       **舊碼送出而 `markSent` 落表失敗的那一列, 本欄也是 NULL** —— 它的答案是「**可能送過**」。
--       ⇒ 📌 **我把「兩族分不出來」寫完之後, 下一句就自己假設了它們的答案相同。**
--    ⛔ ~~**修法 = 回填 `attempts > 0` 的列**:`attempts` 在認領當下 +1
--         ⇒ `attempts = 0` ⇒ 從沒被認領過 ⇒ 不可能被送出去(可證)。~~
--    🔴🔴 **那個判準也是假的**(codex R2 must-fix, 我核過屬實):
--       `admin_requeue_dead_email` 把 `attempts` **歸零**, 而它**不碰** `sent_at` / `claimed_at`
--       (那一列送出去而 `markSent` 落表失敗 ⇒ 它們本來就都是 NULL)
--       ⇒ 🎯 **一列「送過、死掉、被救回來」的舊列, 在每一個欄位上都與全新的一模一樣。**
--       ⇒ 📌 **它身上沒有任何證據** —— 我兩次都在找一個不存在的證據。
--    ✅ **修法 = 回填【每一列】。** 判準不是「證明它送過」, 是**「證明不了它沒送過」**:
--       🎯 **本欄存在之前的每一列, 都證明不了。** ⇒ 全部保守標記, 而 NULL 從此只有一個意思:
--         **「這一列出生在本欄之後, 而它還沒被交出去」** —— 那是可證的。
--       ⚠️ **代價**:既有列日後若快照過期, **一律不退休鍵 ⇒ 少寄一封**。
--         🔵 而那個代價**今天是零**:唯一會讀這一欄的型別由前置閘④ 保證一列都沒有。
--       🔵 值用 `COALESCE(sent_at, claimed_at, created_at)` —— **三個都是那一列自己的時刻**
--         (`created_at` NOT NULL ⇒ 一定取得到值), 不是現在、不是一個編出來的數。
--    ② 加一個 NULL-able 無 DEFAULT 的欄**不重寫整張表**。
ALTER TABLE public.email_outbox
  ADD COLUMN handed_to_provider_at timestamptz;

-- 🔴 回填(理由見上面那段):**本欄存在之前的每一列都證明不了自己沒送過** ⇒ 全部保守標記。
--    ⇒ 📌 回填之後, `NULL` 在這張表上從此**只有一個意思**:出生在本欄之後而還沒被交出去。
UPDATE public.email_outbox
   SET handed_to_provider_at = COALESCE(sent_at, claimed_at, created_at)
 WHERE handed_to_provider_at IS NULL;

-- 🔴 本文用 dollar-quoted 而不是單引號 —— 單引號字串裡若有【行尾的 ASCII 分號】,
--    Supabase SQL Editor 會在字串中間切一刀 ⇒ 貼下去 42601, 而本機與拋棄式 PG 全綠。
COMMENT ON COLUMN public.email_outbox.handed_to_provider_at IS
  $c$這一列曾經被交給 provider(呼叫過 sender.send), **不論結果**。2026-09-13, Sean 答甲。
🔴 它**不是**「寄成功了」(那是 sent_at)、**不是**「provider 收下了」(那是 provider_message_id)。
它答的是**「我們有沒有可能已經送出去了」** —— 而那正是「能不能安全地重排一封」要問的問題。
🛑 **寫入時機 = 呼叫 sender.send 的【正上方】, 不是之後。**
寫在之後, 失敗的正好就是要抓的那個世界(送出去了而落表失敗)
⇒ 📌 一個只在順利時才記得住的事實, 對「不順利」那一格恆為空。
⚠️ **因此它是【過度保守】的**:「準備要送」與「真的送出去了」之間仍有 HTTP 沒送出的可能
⇒ 那一列會被標成交給過而其實沒有 ⇒ **那一次取消少寄一封**。
方向是選的, 不是沒想到 —— 本族一貫那條:**少寄一封 < 把一個錯的金額寄兩次**。
🔵 它**不在** admin_requeue_dead_email 的 UPDATE 清單裡 ⇒ **天生活得過一次死信救援**。
那是本欄存在的理由(attempts 被那支歸零 ⇒ 已送達的死信救回來之後長得跟全新的一樣)。
🛑 **不要替本欄加 DEFAULT、trigger 或 NOT NULL** —— 任何一個都會讓「還沒交出去」與
「交出去了」分不出來, 而那正是本欄唯一要分的那件事。$c$;

DO $postcheck$
DECLARE
  v_notnull boolean;
  v_default text;
  v_type    text;
  v_rows    int;
  v_filled  int;
BEGIN
  -- 事後閘①:欄在, 而且是 nullable、無 DEFAULT、型別對
  SELECT a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid),
         pg_catalog.format_type(a.atttypid, a.atttypmod)
    INTO v_notnull, v_default, v_type
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.email_outbox'::regclass
     AND a.attname = 'handed_to_provider_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_notnull IS NULL THEN
    RAISE EXCEPTION '事後閘①:加完找不到 handed_to_provider_at';
  END IF;
  IF v_notnull THEN
    RAISE EXCEPTION '事後閘①b:它是 NOT NULL ⇒ 既有列會被擋, 而本支不打算回填';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①c:它有 DEFAULT [%] ⇒ 那會讓「還沒交出去」與「交出去了」分不出來', v_default;
  END IF;
  IF v_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION '事後閘①d:型別是 [%] 而不是 timestamptz', v_type;
  END IF;

  -- 🔴🔴 事後閘②:**anon / authenticated 讀不到它** —— 這裡問的是【欄級】權限。
  --    ⛔ `has_table_privilege` 對欄級授權會少報(2026-09-05 實錘)⇒ 用 `has_column_privilege`。
  --    🔵 而本欄**不是 PII**(一個時間戳)—— 收緊的理由不是它本身敏感,
  --      是**這張表其餘每一欄都只給 service_role**, 而一欄放寬會讓那條界線變成「看情況」。
  IF pg_catalog.has_column_privilege('anon', 'public.email_outbox', 'handed_to_provider_at', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②a:anon 讀得到 handed_to_provider_at ⇒ 與本表其餘欄的界線不一致';
  END IF;
  IF pg_catalog.has_column_privilege('authenticated', 'public.email_outbox', 'handed_to_provider_at', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②b:authenticated 讀得到 handed_to_provider_at';
  END IF;

  -- 🟢 事後閘②c(**正對照**):同一把尺對 `service_role` 要答【讀得到】——
  --    📌 少了這一格, 上面兩個 false 可能只是**這把尺對整張表都回 false**。
  IF NOT pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'handed_to_provider_at', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②c(正對照):service_role 讀不到 handed_to_provider_at ⇒ 上面兩格的 false 不可信';
  END IF;
  -- 🔴 **而【寫得進】要另外問** —— UPDATE 漂掉而 SELECT 還在 ⇒ 本支全綠,
  --    而那一發「記下我要送了」**每一封都失敗** ⇒ 📌 **fail-closed ⇒ 一封都寄不出去。**
  IF NOT pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'handed_to_provider_at', 'UPDATE') THEN
    RAISE EXCEPTION '事後閘②c2:service_role 對 handed_to_provider_at 沒有 UPDATE ⇒ 寄送前那一發會每一封都失敗';
  END IF;

  -- 🔵 事後閘②d(**負對照**):同一把尺問一個現造的欄名 —— 它必須炸。
  --    ⚠️ `has_column_privilege` 對不存在的欄會 raise ⇒ 用 exception block 收下來,
  --      而**收不到 exception 才是問題**(代表那把尺對任何欄名都回 true)。
  BEGIN
    IF pg_catalog.has_column_privilege('service_role', 'public.email_outbox', 'zzz_never_a_column', 'SELECT') THEN
      RAISE EXCEPTION '事後閘②d(負對照):現造的欄名居然回 true ⇒ 這把尺壞了, 上面三格不可信';
    END IF;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- ✅ 預期:不存在的欄會 raise ⇒ 那把尺在看真的欄
  END;

  -- 🔴🔴 事後閘③:**回填的不變式** —— 本欄存在之前的列, 一列 NULL 都不准剩。
  --    📌 它是上面那個 UPDATE 的收據:少跑了、或述詞打錯 ⇒ 這裡當場炸。
  --    ⛔ ~~舊版驗的是「attempts > 0 的列一定有值」~~ —— 那個述詞**漏掉被救回的死信**
  --      (codex R2:`admin_requeue_dead_email` 把 attempts 歸零)。
  IF EXISTS (SELECT 1 FROM public.email_outbox WHERE handed_to_provider_at IS NULL) THEN
    RAISE EXCEPTION '事後閘③:回填之後仍有 handed_to_provider_at IS NULL 的列 ⇒ 那些列會被退休鍵讀成「確定沒送過」';
  END IF;
  -- 🟢 事後閘③b(**正對照**):上面那個 `NOT EXISTS` 在**空表**上也成立
  --    ⇒ 📌 少了這一格, 一個「表被清空了」的世界與「回填成功了」印同一個綠。
  --    ⚠️ 而本表**可以**合法地是空的(全新環境)⇒ 這裡不能要求「一定有列」,
  --      只能要求**這把尺對這張表是活的**:數得出總列數, 而那個數與 NULL 數一致地相減。
  SELECT count(*) INTO v_rows FROM public.email_outbox;
  SELECT count(*) INTO v_filled FROM public.email_outbox WHERE handed_to_provider_at IS NOT NULL;
  IF v_rows <> v_filled THEN
    RAISE EXCEPTION '事後閘③b:總列數 % 與已填列數 % 不一致 ⇒ 上面那個 NOT EXISTS 不可信', v_rows, v_filled;
  END IF;
  RAISE NOTICE '回填收據:email_outbox 共 % 列, 全部已標記(空表時兩個數都是 0, 而那是合法的)', v_rows;

  -- 🔵 事後閘④:**本支只打算加這一欄** —— 逐名擋掉幾個最可能的同義欄。
  --    ⚠️ **誠實標**(codex 2026-09-13 nit):這是**黑名單不是白名單** ——
  --      換一個沒列到的名字(例如 `provider_started_at`)它擋不到。
  --      ⇒ 📌 **它擋的是「順手加一個同義欄」這個【常見動作】, 不是「只准加這一欄」這個【保證】。**
  --      (與 `20260906200000` 事後閘③ 同形、同一個限制。)
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.email_outbox'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attname IN ('sent_to_provider', 'handed_at', 'provider_handed_at', 'send_started_at')
     ) THEN
    RAISE EXCEPTION '事後閘③:出現了不該有的同義欄 ⇒ 一個事實兩個欄位, 兩份會漂';
  END IF;
END
$postcheck$;

COMMIT;
