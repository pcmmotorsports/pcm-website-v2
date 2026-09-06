-- 2026-09-06-expire-day-boundary-ROLLBACK.sql
-- ⟦b4-EXPIREDAYBOUND⟧ 的還原 —— 把 `pcm_cron.expire_unpaid_orders` 換回 20260904230000 那一版。
--
-- 🟢 **這是真的 SQL, 不是註解。整支貼上去就會跑。**
--    (`20260904230000:790` 那一格踩過反例:標題寫「可直接貼」而三行都以 `--` 開頭 ⇒ 貼了什麼都沒發生。)
--
-- 內容 = `sed -n '401,543p'` + `sed -n '553,564p'` 從 20260904230000 抽出來, **一個字元都沒有重打**。
--
-- ⚠️ **「還原回到原狀」對【已經多活的那些單】不成立**:日界版上線期間若有客人在多出來的
--    那段時間裡匯了款, 那筆錢已經進 `order_payments` —— 還原述詞不會把它變回去。
--    那是好事;寫在這裡是因為**字面要等於事實**。

-- ══ 🔴🔴 災難當天先讀這一段 ═════════════════════════════════════════════
-- (codex R3 #3 #4:第三版只是「換一支函式」, 它**不足以當災難操作手冊**。)
--
-- ## 步驟 0:先止血, 再談還原
-- 🔴 **如果現在正在【錯誤地大量取消訂單】, 第一件事不是貼這支檔, 是把 cron 停掉**:
-- ```
-- SELECT cron.unschedule('pcm-expire-unpaid-orders');
-- ```
--    ⇒ 它**立刻**停止繼續取消, 而且與本檔無關 —— 本檔換函式要時間, 停排程是一句話。
--    🔵 事後要恢復:`20260809170000_..._schedule.sql:77` 那一句 `cron.schedule(…, '0 * * * *', …)`。
--
-- ## 步驟 1:先看損害範圍(唯讀, 不改任何東西)
-- ```
-- SELECT payment_channel, count(*), min(cancelled_at), max(cancelled_at)
--   FROM public.orders
--  WHERE cancelled_reason = 'payment_expired'
--    AND cancelled_at > pg_catalog.now() - interval '6 hours'
--  GROUP BY payment_channel ORDER BY 2 DESC;
-- ```
--    🔴 **這一句答的是「剛剛有幾張被取消、哪一種通道」** —— 而那是判斷「是不是這一片造成的」的第一個數。
--
-- ## 步驟 2:🛑 **本檔【不會】把已經被取消的訂單改回來**
--    那需要人決定(客人已經收到「訂單已取消」的信, 收不回)⇒ 板列 `⟦b4-EXPIREDNOCANCELMAIL⟧`
--    與 `Q-取消後入款` 那一題都在講這件事。**不要自己 UPDATE `cancelled_at = NULL`。**
--
-- ## 步驟 3:前置閘擋住你的時候
-- 🔴 **本檔的前置閘會拒絕在「線上不是預期那兩版之一」時執行** —— 那是刻意的(不覆蓋別人的改動)。
--    ⚠️ **而災難當天那個保護會變成阻礙**:若已經有人把函式 hotfix 成 no-op 來止血,
--      這支就貼不上去了 ⇒ 值班的人手上會沒有可跑的還原。
--    ✅ **逃生口(明示, 不要靠註解掉程式碼)**:在貼本檔【之前】先跑這一行 ——
-- ```
-- SET pcm.rollback_force = '1';
-- ```
--    然後在**同一個 session** 貼本檔 ⇒ 前置閘會印一行 WARNING 並放行。
--    🛑 **用它之前先把現況抄下來**(`SELECT prosrc FROM pg_proc …`)—— force 的意思是
--      「我知道我要蓋掉現在那一版」, 不是「這樣比較快」。

BEGIN;

-- ══ 0. 前置閘 ═════════════════════════════════════════════════════════════
-- 🔴🔴 **codex R2 新 #1**:第一版**沒有**版本閘 —— 它會無條件把現況整支蓋成 20260904230000。
--    ⇒ 📌 若本片之後又有人合法改過那支函式, 這份還原會把那個改動**一起刪掉**,
--      而它的事後斷言只問「舊述詞回來了沒」⇒ **照樣宣稱還原完成**。
-- ✅ 現在:只還原「線上正好是本片那一版」的世界;不是 ⇒ 停下來讓人自己看。
DO $rbpre$
DECLARE v_n integer; v_raw text;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '還原前置閘①:pcm_cron.expire_unpaid_orders 有 % 支同名函式(期望 1)⇒ 拒繼續。', v_n;
  END IF;
  SELECT p.prosrc INTO v_raw FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  -- 🔴 逃生口:`SET pcm.rollback_force = '1'` ⇒ 放行(見檔頭「步驟 3」)。
  --    codex R3 #3:一個在災難當天拒絕執行的還原, 比沒有還原更糟。
  IF coalesce(current_setting('pcm.rollback_force', true), '') = '1' THEN
    RAISE WARNING '還原前置閘②:pcm.rollback_force=1 ⇒ 跳過版本比對, 直接覆蓋(現況 md5 = %)。你已經宣告你知道要蓋掉什麼。', pg_catalog.md5(v_raw);
  ELSIF pg_catalog.md5(v_raw) = 'b91dc97700d43dd1015dd31ff6eacdfa' THEN
    RAISE NOTICE '還原前置閘②:線上已經是 20260904230000 那一版了 ⇒ 本片重貼, 同定義覆蓋同定義, 安全。';
  ELSIF pg_catalog.md5(v_raw) <> '7e1e6764def6738440a1012cbea44f05' THEN
    RAISE EXCEPTION '還原前置閘②:線上那一支的原始 md5 = %(期望 7e1e6764def6738440a1012cbea44f05 = 20260906600000 那一版)⇒ 有人在它之上又改過, 這份還原會把那個改動一起刪掉。要硬蓋 ⇒ 先跑 SET pcm.rollback_force = ''1'';(見檔頭步驟 3)', pg_catalog.md5(v_raw);
  END IF;
END
$rbpre$;

CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- 🔴 誠實邊界(codex 關卡2):本函式**完全信任 `orders.created_at`**,而那一欄沒有不可變守門 ——
  --    owner / migration 把它回填成舊日期,新單會提早被取消;改成未來,則永遠掃不到。
  --    不加守門的理由:owner 本來就能繞過任何 DB 層防線,為此加欄位級 trigger 的代價大於收益。
  -- p_limit fail-safe:NULL / <=0 一律退回 1(不接受「無上限」;0-worker 會靜默不處理)。
  -- ⚠️ 誠實邊界(codex 關卡2 nit):`LIMIT` 限的是**改幾列**,不是**掃幾列** —— 歷史 paid/failed 單一多,
  --    找候選的掃描成本仍會長,且本函式沒有 statement_timeout。現況存量 0、每小時一次 ⇒ 可接受;
  --    真的長起來時的修法 = 對 (payment_status, cancelled_at, created_at) 加部分索引 + 設 statement_timeout。
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1;
  END IF;

  WITH target AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.payment_status = 'unpaid'::public.payment_status
       AND o.cancelled_at IS NULL                                    -- 已取消/已失效 → 不重複寫(冪等)
       -- 🔴🔴 **2026-09-03 依 payment_channel 分流**(Sean 本人逐字回「乙 5天」)。
       --    ⛔ ~~原本是無條件 `interval '1 day'`~~ —— 而那一行**沒有濾 payment_channel**
       --      ⇒ 員工手動建的匯款單(`admin_create_manual_order` 只收 bank_transfer/cash)
       --        1 天後就被殺掉, 而**匯款常要 1-3 天**。
       --    📌 **而這不是有人忘了改** —— `20260809160000:66-69` 那一節標題逐字
       --      「重估觸發(Sean 拍板時逐字要求寫死在規格裡)」, 內容逐字
       --      「開放匯款付款時『1 天』**必須重看** … **1 天會把正常等匯款的單殺掉**」
       --      ⇒ 🎯 **那是一個【自己寫下失效條件】的數字, 而今天正是那個條件。**
       -- 🛑 **白名單, 不是黑名單** —— 只有【明列的三種】會被自動失效。
       --    ⇒ `none` 與**任何未來新增的 channel** 一律【不失效】。
       -- 🔴🔴 ⛔ ~~原本這兩行寫「只有這兩種」「`cash` / `none` 一律不失效」~~ **作廢** ——
       --    那是 Sean 補拍 cash 之前的殘留, 而我改了碼沒改它(code-reviewer C1 抓)。
       --    ⇒ 📌 **它會被寫進正式庫的 `prosrc`** ⇒ 下一個 `\df+` 開這支函式的人讀到的是假的。
       --    🎯 而那正是本檔自己在講的病:**一句話在兩個世界是同一個字串。**
       --    🔴 理由是不對稱的:**不失效是可逆的**(人可以手動取消),
       --      **失效是不可逆的**(那張單就沒了, 而客人今天連取消信都收不到)。
       --    🔴 `cash` = **5 天**(Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」)——
       --      ⚠️ 我原本刻意留白不敢比照, 而他自己答了。**現在它是拍板不是推論。**
       --    🛑🛑 **`none` 【明列排除】, 而它不是漏掉的** —— 那個值在 CHECK 裡合法
       --      (`20260712203000:51`)、而**今天沒有任何寫入端會寫它**, 也沒有人談過它該怎樣。
       --      ⇒ 🔴 **若寫成「其餘 ⇒ 5 天」, `none` 會靜靜地拿到一個沒有人決定過的行為。**
       --      ⇒ ✅ 所以這裡是**白名單明列三種**;`none` 與任何未來新 channel ⇒ **不失效**
       --        (不失效可逆 · 失效不可逆 ⇒ 不對稱)。`none` 要怎樣**待拍板**。
       --    🔴 **而「有人開始寫它的那天要回來看」不是一句提醒, 它有一個可機械跑的訊號**:
       --      `SELECT count(*) FROM public.orders WHERE payment_channel = 'none'` **> 0**
       --      ⇒ 📌 今天它是 0(零寫入端)⇒ **那個 0 就是「這條規則還沒承重」的意思**;
       --        它變成非 0 的那一天, 這一格的「不失效」才第一次真的擋到東西。
       --    🔵 `payment_channel` 是 `NOT NULL DEFAULT 'tappay'` ⇒ 沒有 NULL 那一格要處理。
       AND o.payment_channel IN ('tappay', 'bank_transfer', 'cash')
       AND o.created_at < pg_catalog.now() - CASE o.payment_channel
             WHEN 'tappay'        THEN interval '1 day'    -- 🔵 逐字不動(Sean 2026-08-09「1天」)
             WHEN 'bank_transfer' THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「乙 5天」
             WHEN 'cash'          THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」
           END        -- 🔴 1 天 = Sean 2026-08-09 逐字「1天」(落 memory project_m4b-b2-shipments-db-decisions:79;
       --    ⚠️ 那份 memory 內部編號 Q2 指的是天數,與本 plan §6 的 Q2「失效單不復活」是**不同的兩題**,別混)。
       --    重估觸發見檔頭。
       -- 🔴 安全核心:有任何非終態 attempt = 錢可能在途 ⇒ 一律不碰(留給對帳/人工)。
       --    條件與 admin_cancel_order 步7 逐字相同 ⇒ 兩個寫入端維持同一條不變量。
       --    ⚠️ 代價(code-reviewer N7):`released` 也被這條擋住 ⇒ **帶 released attempt 的單永遠不會被失效**。
       --    這是保守的正確選擇(released = 鎖已釋、仍在低頻對帳到 terminal),但它意味著那類單
       --    **在本片之後仍然沒有終點** —— 那正是 Q7/L5 要處理的「放棄型」殭屍,不在件① 範圍。
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_charge_attempts a
              WHERE a.order_id = o.id
                AND a.status <> 'failed'
           )
       -- 🔴🔴 ⟦b4-NONCARDPAID1⟧ 新增的那一句(本片對 20260903080000 的【唯一】行為差異)。
       --    已收淨額 > 0 的單不取消 —— 客人錢已經進來了, 而狀態沒翻上去。
       -- 🔵 為什麼 `SUM(amount)` 就是淨額, 不必外接「哪些被沖掉了」:
       --    `order_payments` 是 append-only, 沖銷 = 插一列**反號**
       --    (`20260810100000_m4b_e10_op1_order_payments_m.sql:199` 逐字
       --     `amount integer NOT NULL CHECK (amount <> 0)`, 檔內 A10 拍板段
       --     逐字「P(+500)+R1(-500)+R2(+500) = 500」)⇒ 沖銷回 0 的單**恢復可取消**。
       -- 🛑 而它與上面那道 trigger 是**兩層不同的保護, 不是重複**:
       --    trigger 讓收到錢的單自己離開 `unpaid` 集合 ⇒ 涵蓋 verdict = settled / underpaid;
       --    這一句涵蓋 trigger **刻意不翻**的那兩種(overpaid / needs_human)——
       --    那兩種的錢一樣進來了, 而它們仍然是 `unpaid`。
       --    ⇒ 📌 少了這一句, 「不翻是安全的」這句話**不成立**。
       AND (
             SELECT coalesce(pg_catalog.sum(p.amount), 0)
               FROM public.order_payments p
              WHERE p.order_id = o.id
           ) <= 0
     ORDER BY o.created_at                                            -- 最舊的先處理(可預期、便於分批)
     LIMIT p_limit
     -- 🔴 字面精確(codex 關卡2 nit):SKIP LOCKED 只保證**本函式**跳過已被別人鎖住的列;
     --    若本函式先拿到鎖,後來的 admin 仍會等。稱「互不阻塞」不實,實際是「本函式不等別人」。
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.orders o
     SET cancelled_at     = pg_catalog.now(),
         cancelled_reason = 'payment_expired',
         updated_at       = pg_catalog.now()
    FROM target t
   WHERE o.id = t.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- 🔴 觀測點(plan §4-6 驗收條件):每次執行都留一行,零 PII(只有筆數與上限)。
  --    沒有它的話,「掃到 0 筆」與「這支根本沒被呼叫」在 DB 側分不出來 ——
  --    而 cron.job_run_details 的 return_message 對 SELECT 只會記 command tag、不記筆數。
  RAISE LOG '[expire_unpaid_orders] expired=% limit=%', v_count, p_limit;

  -- ══ ⟦b4-CRON6⟧ 片2 新增:成功心跳 ═════════════════════════════════════════
  -- 🔴🔴 **那個 EXCEPTION 子區塊是本片的重點,不是防禦性裝飾。**
  --    沒有它:心跳表出任何問題(被鎖住 / 被 TRUNCATE / 欄位被改名)⇒ 整個函式拋錯
  --    ⇒ **那一小時的訂單不會被取消** ⇒ 監控把被監控的弄死。
  --    📌 而那正是本檔檔頭那段話要防的事 —— 它差一點由這片自己實現。
  -- ⚠️ 代價明寫:心跳寫失敗時**只留一行 WARNING**,而心跳會開始變舊 ⇒ 後台那一列會亮。
  --    那是**假陽性,而方向是對的**(叫比不叫好),**不得**被讀成「這裡不會出錯」。
  -- 🔴🔴 **而「心跳寫不出去不影響本輪取消」有一個【真的例外】**(codex R1 must-fix ②):
  --    這一列**被別人鎖住**時不會立刻拋錯,它會**等** —— 而此時 orders 那半已經改完。
  --    若這一等撞上 statement_timeout 或人工 cancel(SQLSTATE 57014),
  --    🔴 `EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義**不接** query cancel
  --    ⇒ 例外冒出去 ⇒ **整輪取消一起 rollback**。
  --    ⇒ 正確字面:**心跳自己【出錯】不影響本輪;心跳【被卡住】+ 被取消,會拖垮本輪。**
  --    ⚠️ 本片**沒有修掉這條路**(要動 upsert 的鎖策略,那是另一片)。它是已知殘留風險。
  -- 🔴 只寫成功那三欄;**失敗那一欄一個字都不碰**(理由見檔頭:寫不出去,不是懶得寫)。
  --    ⚠️ 這句刻意不寫出那個欄名 —— 見檔頭「3d 這把尺分不出碼與註解」那段。
  -- 🔴 用 `clock_timestamp()` 不用 `now()`(codex R1 must-fix ③):

  --    `now()` 是**交易起始時間** ⇒ 一個 10:00 開始而跑很久的交易,會用 10:00 蓋掉
  --    另一個 10:05 已經寫好的心跳 ⇒ **`last_success_at` 會倒退**,而畫面上只是「比較舊」。
  --    心跳要的是**觀測時刻**,不是交易時刻。
  -- 🔴 而光換函式不夠,`GREATEST` 那半才是真正擋倒退的(晚到的舊值不得覆蓋新值)。
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-expire-unpaid-orders', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[expire_unpaid_orders] 心跳寫入失敗(本輪取消不受影響):%', SQLERRM;
  END;

  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION pcm_cron.expire_unpaid_orders(integer) IS
  'M-4b 生命週期 L3(件①):unpaid + 未取消 + **依 payment_channel 分流的逾時** + **無任何非終態 attempt** 的訂單 → 寫 cancelled_at + cancelled_reason=''payment_expired''(不刪資料、不動 payment_status、不碰庫存)。回本次筆數。'
  '🔴 **逾時分流(2026-09-03 Sean 本人逐字拍板)**:tappay = 1 天(逐字不動)· bank_transfer = **5 天**(「乙 5天」)· cash = **5 天**(「甲 跟匯款一樣 5 天」)。'
  '⛔ ~~原本無條件「建立超過 1 天」~~ **作廢** —— 那會把正常等匯款的單殺掉(匯款常要 1-3 天)。'
  '⛔ ~~原本的「⚠️ 重估觸發:…屆時改為依 payment_channel 分流」~~ **已完成, 不要再照它去做**。'
  '🛑 **白名單明列三種**:`none` 與任何未來新增的 channel 一律**不失效**(不失效可逆 · 失效不可逆)。`none` 今天零寫入端;`SELECT count(*) FROM orders WHERE payment_channel=''none''` > 0 的那天要回來看。'
  '🔴 不變量:cancelled ⇒ 無 active attempt(與 admin_cancel_order 步7 同條件)——三處「擋重新結帳」的查詢都靠 active attempt 判定,放寬本條件的人必須同時回頭改那三處,否則「已取消但 charge 在途」會不再被擋 = 雙扣。'
  '⛔ ~~本片【不修】⟦b4-NONCARDPAID1⟧:登記匯款/現金收款不會把 payment_status 翻成 paid ⇒ 已收錢的單仍會被本函式取消~~ **2026-09-04 由 20260904230000 修掉了**'
  '🔴 現況:①`order_payments` AFTER INSERT 掛了 pcm_noncard_settle_recompute ⇒ 收到錢的單會自己離開 unpaid;'
  '②本函式另加一條腿:**已收淨額 SUM(order_payments.amount) > 0 的單一律不取消**(涵蓋 verdict = overpaid / needs_human 那兩種不翻狀態的單)。'
  '🔵 沖銷回 0 之後恢復可取消 —— 那條腿問的是淨額, 不是「有沒有收款列」。'
  '批次上限 p_limit(預設 500、NULL/<=0 退回 1)、FOR UPDATE SKIP LOCKED。只由 pg_cron job pcm-expire-unpaid-orders 呼叫;無任何 client role 可執行。';


-- ── 事後斷言:真的還原了 ────────────────────────────────────────────────
DO $rb$
DECLARE v_src text; v_flat text;
BEGIN
  -- 🔴 codex R2 新 #2:這裡第一版又退回只用 schema + 名稱 ⇒ 同名多載時會任取一支。
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');
  v_flat := pg_catalog.regexp_replace(v_src, '\s+', '', 'g');
  IF pg_catalog.strpos(v_src, 'Asia/Taipei') > 0 THEN
    RAISE EXCEPTION '還原失敗:日界還在 ⇒ 這一貼沒生效。';
  END IF;
  IF pg_catalog.strpos(v_flat, 'o.created_at<pg_catalog.now()-CASEo.payment_channel') = 0 THEN
    RAISE EXCEPTION '還原失敗:舊的時戳比較述詞沒回來。';
  END IF;
  IF pg_catalog.strpos(v_src, 'order_payments') = 0 OR pg_catalog.strpos(v_src, 'sweeper_heartbeat') = 0
     OR pg_catalog.strpos(v_src, '5 days') = 0 THEN
    RAISE EXCEPTION '還原失敗:20260904230000 的三個特徵沒有全回來。';
  END IF;
  -- 🔴🔴 **md5 錨 —— 這一格才是「真的還原成那一版」的證明**(codex R1 #15 打回第一版)
  --    ⛔ ~~第一版只查散落 token~~ **不夠**:把還原函式的 attempt 或淨額邏輯改壞,
  --      只要舊時間述詞與那三個 token 還在, 它照樣宣稱「還原完成」。
  --    ✅ 期望值 `3a21a5aa1fa0d0f7b8b075c1cacfe85f` = 剝 `--` 註解 + 壓空白後的 md5,
  --      2026-09-06 由**兩個獨立來源**各自量到而相等:正式庫唯讀 · 拋棄式 PG 裝 20260904230000。
  IF pg_catalog.md5(v_src) <> 'b91dc97700d43dd1015dd31ff6eacdfa' THEN
    RAISE EXCEPTION '還原失敗:還原後的原始 md5 = %(期望 b91dc97700d43dd1015dd31ff6eacdfa)⇒ 貼回去的不是 20260904230000 那一版。',
      pg_catalog.md5(v_src);
  END IF;
  IF pg_catalog.md5(v_flat) <> '3a21a5aa1fa0d0f7b8b075c1cacfe85f' THEN
    RAISE EXCEPTION '還原失敗:還原後的正規化 md5 = %(期望 3a21a5aa1fa0d0f7b8b075c1cacfe85f)⇒ 貼回去的不是 20260904230000 那一版。',
      pg_catalog.md5(v_flat);
  END IF;
  -- 🔵 那把尺的正對照:同一個 md5 算法對一段現造字串必須回一個【不同的】值
  IF pg_catalog.md5('QXROLLBACKPROBE5581') = '3a21a5aa1fa0d0f7b8b075c1cacfe85f' THEN
    RAISE EXCEPTION '還原失敗:md5 對現造字串也回同一個值 ⇒ 這把尺壞了。';
  END IF;
  RAISE NOTICE '[ROLLBACK] 還原完成:日界已移除, 20260904230000 那一版回來了。';
END
$rb$;

COMMIT;
