-- M-4b · 匯款單的逾時改成 5 天(Sean 2026-09-03 本人逐字「乙 5天」)
-- ============================================================
-- 為什麼有這一片:
--   `pcm_cron.expire_unpaid_orders` **沒有濾 `payment_channel`**, 一律 `interval '1 day'`。
--   而員工用 `admin_create_manual_order` 建的單**只能是 bank_transfer 或 cash**
--   ⛔ ~~原本寫「該檔 `:271` / `:268`」~~ —— **那兩個行號只在最初那一代成立, 而且我沒寫檔名**
--     (code-reviewer N1)。✅ 最新代是 `20260831180000_m4b_spec1_manual_order_authoritative_spec.sql`:
--     `:185` 逐字 `NOT IN ('bank_transfer', 'cash')` ⇒ RAISE;`:182` 反而把 `tappay` 擋掉。
--     🔵 斷言本身仍為真(我開最新那支核過)—— **漂的是座標不是結論。**
--   ⇒ 🔴 **一張匯款單 1 天後就被自動取消, 而匯款常要 1-3 天。**
--   🛑 而它的既有保護「有非終態 `payment_charge_attempts` 就不碰」對匯款單
--     **結構上不適用** —— 匯款沒有刷卡 attempt。
--   ⇒ 🎯 **今天沒有人受害, 而理由只是還沒有人用那條路 —— 不是有東西擋著。**
--
-- 📌 **而這不是有人忘了改**:`20260809160000:66-69` 那一節標題逐字
--   「重估觸發(Sean 拍板時逐字要求寫死在規格裡)」, 內容逐字
--   「開放匯款付款時『1 天』**必須重看** —— 匯款常要 1-3 天, **1 天會把正常等匯款的單殺掉**」
--   ⇒ ✅ **那是一個【自己寫下失效條件】的數字, 而今天正是那個條件被觸發的日子。**
--
-- 🔴🔴 **本檔的函式體是【從正式庫的活函式機械抽出來改一行】, 不是照 repo 檔手抄。**
--   而那個決定是量出來的, 不是謹慎:
--   ```
--   repo 有兩代:20260809160000 與 20260828060000(後者加了心跳碼)
--   `scripts/latest-definition-of.sh` 的 `live` 欄說 = 20260809160000
--   🛑 而那一欄答的是【帳本 APPLIED.tsv】不是正式庫(該工具自己印了這句警告)
--   🔬 我 dump 正式庫的 pg_get_functiondef ⇒ **含 heartbeat 3 處** ⇒ 活的是 20260828060000
--   ⇒ 📌 **照帳本抄舊版 ⇒ 這一支 CREATE OR REPLACE 會【靜靜把心跳碼刪掉】**
--     ⇒ 而它三綠全綠、審查看到的是「只改了一行 interval」。
--   ```
--
-- ── 🔴🔴 本片【不修】什麼(code-reviewer I1:沒寫這一段, 讀了檔頭的人會判成已修)──
--   ⟦b4-NONCARDPAID1⟧(板上態 `doing`)逐字:「登記匯款/現金收款**不會把 `payment_status` 翻成 paid**
--   ⇒ **已收錢的單會被逾期 cron 自動取消**」。
--   🛑 **本片一個字都沒關掉它** —— 我做的只是把那條路從**第 2 天延到第 6 天**。
--   ⇒ 📌 **客人已經把錢匯過來了, 而 6 天後他的單一樣會消失。**
--   ⇒ 🎯 而本片會讓那個症狀**更難被發現**:它從「隔天就爆」變成「一週後才爆」
--     ⇒ **延後一個症狀, 與修好它, 在板子上長得很像。**
--   ✅ 兩支新檔 grep `NONCARDPAID|order_payments|已收款|收款` ⇒ **0 命中** ⇒ 所以要有這一段。
--
-- 🛑 **本片不動任何別的東西**:同簽名 `CREATE OR REPLACE` ⇒ ACL 保留;零 schema 改動;
--   零資料寫入;`cron.schedule` 不碰。
-- ============================================================

BEGIN;

-- ── 1. 前置閘:確認我要改的那一版【逐 byte 就是正式庫在跑的那一版】──
-- 🔴🔴 **這裡原本是四道 `strpos` 字面錨, 而 code-reviewer C2/C3 打掉了它, 理由是實錘**:
--   ① `20260828060000:124-128` 逐字:「四個錨**擋不住有人【加了】東西** ⇒ 下面那支
--      `CREATE OR REPLACE` 會把那條熱修**靜靜刪掉** ⇒ 直接改變哪些訂單被取消」
--      ⇒ 🛑 **同一支函式上, codex 已經否決過這條路一次, 而我退回去了。**
--      🔴 而**今天有一個真實的碰撞對象**:`docs/specs/2026-09-01-m4b-noncardpaid-settle-v3.sql`
--        那條待貼的錢守門**不含 `payment_channel` 字面** ⇒ 它若先上, 我四道閘全過、把它靜靜刪掉。
--   ② 更難堪的一格:我原本的「事後② 找 `interval '1 day'`」**被我自己的註解打敗** ——
--      `pg_get_functiondef` 連註解一起回傳, 而我的註解裡就有那個字面
--      ⇒ 📌 **把 `WHEN 'tappay' THEN interval '1 day'` 整條刪掉, 那道「最重要的正對照」照樣綠。**
-- ✅ ⇒ 改用 `md5(prosrc)` —— 它逐 byte, **加一個空白就會動**(`20260828060000:144` 有負對照實測)。
-- 🔵 **這兩個值是我自己算的, 不是抄來的**:
--    · 改前 `md5=b5a7681b594cd8423ee4d464811cb2e8` / `len=4106`
--      🔬 **量法**:`SELECT md5(p.prosrc), length(p.prosrc) FROM pg_proc p JOIN pg_namespace n
--         ON n.oid=p.pronamespace WHERE n.nspname='pcm_cron' AND p.proname='expire_unpaid_orders'`
--         **對正式庫跑, 時點 2026-09-03 下午(唯讀連線)**。
--      ⛔ ~~原本寫「我從正式庫算一次、在拋棄式庫套上活函式再算一次 ⇒ 兩邊相同」~~ **那是假證據**
--        (adversarial-reviewer N1):第二次量的是**同一份 dump** ⇒ 📌 **一個證據複印兩份,
--        而一致不是效度。** 真正承重的只有那一次 prod 量測。
--      ⛔ ~~又寫「與 `20260828060000:142` 相符 ⇒ **證明**正式庫活的是 0828」~~ —— 也太強:
--        `0828:141` 逐字說該值是**從 repo 這支檔自己的函式體算的** ⇒ repo vs repo 是恆等式。
--        ✅ 真正證明「活的是 0828」的是**那一次 prod 量測的值等於 4106/b5a76**, 不是那個相符。
--      ⇒ 🎯 **⇒ 這同時證明了「正式庫活的是 20260828060000」** —— 那是 code-reviewer
--         唯一驗不到的一句(它只讀得到 repo)。**這道閘在 apply 當下會自己再證一次。**
--    · 改後 `md5=c5c85cb9039f71c5aed63920d0cb26d4` / `len=6180`(拋棄式庫套完本片實測)
-- 🛑🛑 **而這個坑【已經有一支腳本專門在防它】, 只是那支綁死在另一片上**:
--    `scripts/verify-cron6-md5.py` 的檔頭逐字記著 2026-08-29 的同一個病 ——
--    「折 must-fix ③ 把一段實測註解寫進**函式體裡面** ⇒ **第二次折改掉了第一次折量的那個東西**」。
--    🔴 而它 `:23` 寫死 `CRON6 = '20260828060000_…'` ⇒ **對本片結構上失明。**
--    ⇒ 📌 **⇒ 那條教訓被寫下來了、被做成工具了, 而我照樣踩了一次** ——
--      因為那支工具的分母裡沒有我這一片。(要不要把它一般化, 不在本片範圍, 已回報。)
-- 🔬 **而這道閘的第一個讀數就抓到東西, 而抓到的是我自己**:
--    我先修了 C1 那兩行【函式體內的註解】, 而註解在 `prosrc` 裡
--    ⇒ md5 從 `5ef36540…` 變成 `4b108f14…` ⇒ **事後① 當場紅、整支回捲。**
--    ⇒ 📌 **一把新尺的第一個讀數不是結論, 是它的自檢** —— 而這一發它證明了自己會動。
--    🎯 而它同時演了一件事:**改了尺之後, 先前那些讀數當場作廢, 而它們不會出聲。**
-- ⚠️ **代價照實寫**(沿 0828 的說法):往後任何人改那支函式一個字(連註解、連空白),
--    這道閘就擋下本片, 而訊息會說「錨點不符」。**那是刻意的。**
DO $pre$
DECLARE v_md5 text; v_len integer;
BEGIN
  -- 🔴 **釘簽名, 不用 (nspname, proname)**(adversarial-reviewer N8):PL/pgSQL 的
  --    `SELECT INTO` 命中多列**不報錯、取任意一列** ⇒ 日後出現 overload(例如零參數包裝)
  --    這裡會讀到不確定的那一支, 而訊息會說「有人動過它」⇒ **指錯方向**。
  --    (事後那兩道本來就用 `::regprocedure`, 前置這道漏了。)
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_md5, v_len
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('pcm_cron.expire_unpaid_orders(integer)');
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '前置閘①:pcm_cron.expire_unpaid_orders 不存在 ⇒ 這不是我以為的那個世界, 拒繼續';
  END IF;
  -- 🔴 已經套過本片 ⇒ forward-only, 明確講出來(否則下面那句會說成「有人改過」, 指錯方向)。
  IF v_md5 = 'c5c85cb9039f71c5aed63920d0cb26d4' THEN
    RAISE EXCEPTION '前置閘②:本片已經套用過(md5 已是改後的值)⇒ forward-only, 拒重跑';
  END IF;
  IF v_md5 <> 'b5a7681b594cd8423ee4d464811cb2e8' OR v_len <> 4106 THEN
    RAISE EXCEPTION '前置閘③:活函式的 prosrc 與我改的那一版不符(md5=% len=%)⇒ 有人動過它, 而我的 diff 是對著舊世界算的 ⇒ 拒盲蓋', v_md5, v_len;
  END IF;
END
$pre$;

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

-- ── 1b. COMMENT 也要改(adversarial-reviewer M2)──
-- 🔴🔴 **`CREATE OR REPLACE` 保留 oid ⇒ catalog COMMENT 原封不動。**
--   而 `20260809160000:191-192` 是這支函式 COMMENT 的**全 repo 唯一來源**, 它逐字寫著
--   「建立超過 **1 天**」與「⚠️ 重估觸發:開放匯款付款時「1 天」必須重看…**屆時改為依
--   `payment_channel` 分流**」。
--   ⇒ 🛑 **不改它 ⇒ apply 之後任何人 `\df+` 讀到的是「1 天、而這件事還沒做」** —— 兩句都假了。
--   🎯 **⇒ 那正是本檔 C1 在修的同一個病(碼改了而說明沒改), 只是落在【repo 之外的人
--     唯一讀得到的那一份】上, 而那一份比 repo 更權威。**
--   🔵 舊字面留刪除線不刪 —— 讓 `\df+` 搜「1 天」的人同一發撞到訂正。
COMMENT ON FUNCTION pcm_cron.expire_unpaid_orders(integer) IS
  'M-4b 生命週期 L3(件①):unpaid + 未取消 + **依 payment_channel 分流的逾時** + **無任何非終態 attempt** 的訂單 → 寫 cancelled_at + cancelled_reason=''payment_expired''(不刪資料、不動 payment_status、不碰庫存)。回本次筆數。'
  '🔴 **逾時分流(2026-09-03 Sean 本人逐字拍板)**:tappay = 1 天(逐字不動)· bank_transfer = **5 天**(「乙 5天」)· cash = **5 天**(「甲 跟匯款一樣 5 天」)。'
  '⛔ ~~原本無條件「建立超過 1 天」~~ **作廢** —— 那會把正常等匯款的單殺掉(匯款常要 1-3 天)。'
  '⛔ ~~原本的「⚠️ 重估觸發:…屆時改為依 payment_channel 分流」~~ **已完成, 不要再照它去做**。'
  '🛑 **白名單明列三種**:`none` 與任何未來新增的 channel 一律**不失效**(不失效可逆 · 失效不可逆)。`none` 今天零寫入端;`SELECT count(*) FROM orders WHERE payment_channel=''none''` > 0 的那天要回來看。'
  '🔴 不變量:cancelled ⇒ 無 active attempt(與 admin_cancel_order 步7 同條件)——三處「擋重新結帳」的查詢都靠 active attempt 判定,放寬本條件的人必須同時回頭改那三處,否則「已取消但 charge 在途」會不再被擋 = 雙扣。'
  '🛑 **本片【不修】⟦b4-NONCARDPAID1⟧**:登記匯款/現金收款不會把 payment_status 翻成 paid ⇒ 已收錢的單仍會被本函式取消, 只是從第 2 天延到第 6 天。'
  '批次上限 p_limit(預設 500、NULL/<=0 退回 1)、FOR UPDATE SKIP LOCKED。只由 pg_cron job pcm-expire-unpaid-orders 呼叫;無任何 client role 可執行。';

-- ── 2. 事後斷言(fail-closed:對不上就 RAISE, 整支回捲)──
-- 🔴 同樣改用 md5 —— 理由見上面。字面比對在這支函式上**已經被證明會被註解打敗**。
DO $post$
DECLARE v_md5 text; v_len integer;
BEGIN
  SELECT md5(p.prosrc), pg_catalog.length(p.prosrc) INTO v_md5, v_len
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  IF v_md5 <> 'c5c85cb9039f71c5aed63920d0cb26d4' OR v_len <> 6180 THEN
    RAISE EXCEPTION '事後①:改完的 prosrc 不是我預期的那一份(md5=% len=%)⇒ 拒繼續', v_md5, v_len;
  END IF;

  -- 🔴🔴 **權限零漂移四件**(code-reviewer C4:我原本只驗 `proacl IS NOT NULL`,
  --    而它比它取代的 `20260828060000:436-453` **弱一整級** ——
  --    一個漂移出來的 `GRANT EXECUTE … TO anon` 會讓 `proacl` 非 NULL ⇒ 那道閘照樣印綠,
  --    而本檔檔頭還宣稱「同簽名 ⇒ ACL 保留」⇒ 📌 **保留的正是那個漂移。**)
  --    ⇒ ✅ 四項照 0828 抄回來(它是同一支函式上的既有成例, 不是我新發明的形狀)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '事後②:改完之後 owner / SECURITY DEFINER / search_path 漂了;拒繼續';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND a.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION '事後③:函式有 owner 以外的 grantee;拒繼續';
  END IF;
END
$post$;

COMMIT;
