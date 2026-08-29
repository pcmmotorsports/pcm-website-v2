-- ============================================================
-- M-4b ⟦b4-CRON6⟧ 片2:pcm-expire-unpaid-orders 自己寫一列心跳(第 6 支,純 SQL 那支)
-- ============================================================
-- 授權:Sean 2026-08-28 `q35: 批`(鐵則 8 plan;plan 全文 `~/pcm-mailbox/線D-plan-片2-expire心跳-20260828.md`)
--      + `q6: 甲`(第二批,⟦b4-CRON6⟧ 本身)。設計裁定(只寫成功)= 主視窗 2026-08-28 `Q-片2 = 甲`。
-- 鐵則 12 ①(錢:orders 自動取消那條線)+ ③(migration)⇒ codex 對抗審查由本窗自己跑。
--
-- 前五支 HTTP route 的心跳在 `aeadd43a`;讀取端(後台首頁)在 `85599ee1`。
-- 🔴 而第 6 支**走純 SQL、不經 HTTP**(`20260809170000_...schedule.sql:16` 逐字)
--    ⇒ 前五支那條路碰不到它 ⇒ 儀表上「5/6」與「6/6」長得一樣。本片補那一格。
--
-- ══ 🔴🔴 本片【只寫成功心跳】,而那不是省事,是物理限制 ══════════════════════════
--
-- pg_cron 把 `SELECT pcm_cron.expire_unpaid_orders(500)` 跑在**它自己的一個交易**裡
-- ⇒ 函式拋錯 ⇒ 整個交易 rollback ⇒ **任何在同一交易裡寫的失敗心跳也一起被回捲**。
-- ⇒ **本函式永遠不寫** `last_failure_at`、永遠把 `consecutive_failures` 寫回 0。
-- 🔴 **而「那一列永遠是 NULL / 0」【不是資料庫保證】**(codex R1 must-fix ④,我原句寫寬了):
--    那張表對 `service_role` 有 INSERT/UPDATE 的 GRANT + policy ⇒ **別的路徑寫得進去**,
--    而本 upsert 也**不清**失敗那一欄(它只碰成功那三欄)。
--    ⇒ 正確的字面是:**「今天沒有任何東西會寫它」**,**不是「它不可能被寫」**。
--      哪天有人加了寫入端,這張表就會出現一個沒有人在維護的失敗計數。
--
-- 🔴 **而一個永遠是 0 的失敗計數,在儀表上跟「一直很健康」長得一模一樣** ——
--    而它正好是六支裡唯一一支**碰錢**(訂單自動取消)的。
--    ⇒ **讀取端對這一支只准用 staleness 判**,不得讀它的失敗計數。
--    ⇒ 那一格已經落地:`apps/admin/src/lib/dashboard/cron-heartbeat-read.ts` 的
--      `FAILURE_COUNT_MEANINGLESS`(數法 `grep -c "pcm-expire-unpaid-orders" <該檔>` ⇒ 非 0)。
--
-- ⛔ **被否決的兩條路,寫在這裡是給【下一個想順手改善的人】看的**:
--   ① **吞掉例外再寫失敗心跳 —— 這條【不可選】,不是「比較差」**(主視窗 2026-08-28 明文):
--      那支管訂單自動取消的函式從此不再對外報錯,`cron.job_run_details` 會印成功。
--      🔴 **一個為了讓監控好看、而讓被監控的功能不再報錯的改動,是這整片在修的病的【完美反例】。**
--      📌 它在 diff 上會長得像一個貼心的修法。
--   ② 另包一層 wrapper 函式 ⇒ 多一個 SECURITY DEFINER 物件 + 排程 `command` 字面要改
--      ⇒ 動到 `20260809170000_...schedule.sql:104-108` 那道字面斷言 ⇒ 成本遠大於收益。
--
-- ══ 零漂移前置(2026-08-28 apply 前當場量的,不是引用舊值)═══════════════════════
-- 正式庫 `SELECT md5(prosrc), length(prosrc) FROM pg_proc WHERE oid = '…'::regprocedure`
--   ⇒ len **2370** / md5 `456db40fd5f959b9d1b96af7cfc8d4d2`,與 repo 的 `AS $fn$ … $fn$;` 那段**逐 byte 相同**
--   🔴 負對照:repo 那段後面加一個字元 ⇒ md5 變 `0951763c…` ⇒ **這把尺會動**
--   同發量到 `position('sweeper_heartbeat' in prosrc) > 0` ⇒ **false**(還沒接)
  --
-- 🔴🔴 **R2 must-fix ③(2026-08-29 `-b4`)**:原本的驗收是「餵一個未來時間戳,它沒被蓋回現在」——
--    而那**只驗到 `GREATEST`**,沒有演出「兩個時鐘在同一交易內分岔」那個世界
--    ⇒ 也就是說:把 `clock_timestamp()` 改回 `now()`,那一發**照樣會過**。
-- ✅ 補的那一發(2026-08-29 19:33,拋棄式 PG,`BEGIN … pg_sleep(1.2) … ROLLBACK`):
--      now()            第一次 19:33:46.299306  第二次 19:33:46.299306   ⇒ **一動也不動**
--      clock_timestamp  第一次 19:33:46.306749  第二次 19:33:47.513562   ⇒ **走了 1.2 秒**
--      而 `now() <> now()` ⇒ 恆 **false**(交易內固定)
--    ⇒ 📌 **那就是這條 must-fix 講的病**:pg_cron 把整輪跑在一個交易裡,
--      而一個慢交易用【交易起始時刻】去寫心跳 ⇒ **它會蓋掉一個比它新的成功心跳**
--      ⇒ `last_success_at` 倒退 ⇒ 儀表上看起來像「它 N 分鐘前就沒動了」。
-- ⚠️ **而這一發證什麼、不證什麼**:
--    ✅ 證到:兩個時鐘在同一交易內【真的會分岔】⇒ 這個病構造得出來、不是理論
--    ❌ 不證:本函式在正式庫的那一輪【真的跑得夠久到分岔】——
--       那要看真實執行時間,而 `p_limit` 預設 500 ⇒ 我沒有量過它跑多久
--    ⇒ 所以修法的理由是「這個病可達」,不是「它已經發生過」。
--
-- ⚠️ **而 md5 只對量測的那一刻成立** —— 下面 §0 的斷言會在 apply 當下自己再驗一次錨點,
--    **不要相信這段註解裡的 md5**。
--
-- ══ 🔴 3d 那把尺的【已知弱點】,而它是 apply 第一發當場撞到的 ══════════════════
-- 3d 用 `position('last_failure_at' in pg_get_functiondef(...))` 判「有沒有人順手補上失敗欄」。
-- 🔴 而 `pg_get_functiondef` **連函式體裡的註解一起回傳** ⇒ **這把尺分不出【碼】與【註解】**。
--    實跑:本片第一版在函式體內寫了一句解釋用的註解、裡面提到那個欄名 ⇒ **apply 當場被自己擋下**。
--    📌 而那一發同時證明了**這把尺是活的**(它真的會紅),那比它擋錯一次更值得留著。
-- ⇒ 代價明寫:**任何在函式體內【提到】那個欄名的註解都會被擋**,而錯誤訊息看起來像「你寫錯碼」。
--   下一個撞到的人:先看你加的是碼還是註解;是註解就換句話說,不要去鬆綁 3d。
-- ⚠️ 而它擋不到的:用動態 SQL(`EXECUTE format(...)`)組出那個欄名 ⇒ 字面不會出現在 functiondef。
--   那條路本檔沒有守門(而在這支函式裡用動態 SQL 本身就該被審查擋下)。
--
-- Rollback(Supabase forward-only、僅供參考):把 `20260809160000_...fn.sql:128-186` 那段
--   `CREATE OR REPLACE` 原樣重貼。
-- 🔴 **而那句 rollback 蓋不到兩樣東西**(codex R1 must-fix ⑤;我原句寫「沒有任何不可逆的東西」是寬了):
--   ① **表的 COMMENT** —— 本片改了 `sweeper_heartbeat` 的 COMMENT,重貼函式**不會**把它換回去
--      (舊文在 `20260817070000_..._sweeper_heartbeat.sql:73-78`,要回滾得一起貼)。
--   ② **ACL** —— 下面那行 `REVOKE`(照抄 L3a)是**冪等再宣告**,而若 apply 之前存在一個漂移出來的
--      grant,**本片會把它收掉**。方向是 fail-closed(對的),而**重貼函式救不回來**。
--   ⇒ 正確字面:**函式體可逆;COMMENT 與 ACL 不在那句 rollback 的射程裡。**
-- ============================================================


BEGIN;

-- ── 0. 前置閘(fail-closed;沿用 L3a/L3b 的形狀)────────────────────────────────
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'b4-CRON6-片2:migration 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;

  -- 心跳表必須先在(它是 20260817070000 建的)。不在 ⇒ 下面的 INSERT 會在【每小時】靜靜走進
  -- EXCEPTION 分支,而排程照跑、沒有人知道心跳從來沒寫成功過。
  IF to_regclass('public.sweeper_heartbeat') IS NULL THEN
    RAISE EXCEPTION 'b4-CRON6-片2:public.sweeper_heartbeat 不存在(20260817070000 未套用);拒繼續';
  END IF;

  -- 🔴 函式必須存在且**三項安全前提未漂**(抄 L3b:0 節的判準,理由相同 ——
  --    同簽名的函式可能被換成漂移的 body、或改掉 owner/SECDEF/ACL)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'b4-CRON6-片2:expire_unpaid_orders 不存在或 owner/SECDEF/search_path 不符;拒繼續';
  END IF;

  -- 🔴🔴 **四個安全錨必須在【改之前】就都在** —— 若已經被誰換掉,本片的 `CREATE OR REPLACE`
  --    會把那個漂移**默默蓋掉**,而 diff 上看不出來(我們貼的是自己那份)。
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT pg_get_functiondef('pcm_cron.expire_unpaid_orders(integer)'::regprocedure) AS d
    ) s
     WHERE position('payment_expired' in s.d) > 0
       AND position('status <> ''failed''' in s.d) > 0
       AND position('interval ''1 day''' in s.d) > 0
       AND position('SKIP LOCKED' in s.d) > 0
  ) THEN
    RAISE EXCEPTION 'b4-CRON6-片2:改之前四個安全錨就已經不齊(函式被換過?)—— 拒絕覆蓋;拒繼續';
  END IF;

  -- 🔴🔴 **四個錨擋不住「有人【加了】東西」**(codex R1 must-fix ①):
  --    如果有人在正式庫熱修了一條付款安全條件(例如多一個 `AND …`),四個錨**照樣全在**
  --    ⇒ 前置閘放行 ⇒ 下面那支 `CREATE OR REPLACE` 會把那條熱修**靜靜刪掉**
  --    ⇒ **直接改變哪些訂單被取消**,而 diff 上看不出來(我們貼的是自己那份)。
  --    📌 錨是「有沒有少東西」的尺,而它**對「有沒有多東西」完全沒有判別力**。
  -- ⇒ 改用把整支 body 的 md5 釘死。`OR` 那半是冪等出口:本片已經套過就放行。
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       -- 🔴🔴 **R2 must-fix ①(2026-08-29 `-b4`)**:這裡原本第二條是
       --    `OR position('sweeper_heartbeat' in p.prosrc) > 0`,而**那正是 md5 要關掉的那個洞**
       --    ——它從旁邊的 OR 走回來了:**任何含該字串的熱修版都放行**,
       --    有人加了一條 AND、改了 LIMIT、動了 status 集合,只要那個字串還在,這道閘照樣通過。
       --    ⇒ 改成**兩個 md5 的精確 allowlist**,移除 substring 出口。
       -- 🔴 而第二個值是【本片完成版】的 md5,它從 repo 這支檔自己的函式體算出來
       --    (`AS $fn$` 與 `$fn$` 之間那段 = PG 存進 `prosrc` 的東西)。
       --    ✅ **抽法先驗過**:同一支腳本抽 L3a(`20260809160000_…`)⇒ 長度 **2370**、
       --       md5 **456db40f…** ⇒ 與本檔 `:39` 記的已知值**逐字相符** ⇒ 抽法是對的。
       --    ✅ 完成版:長度 **4106** / md5 `b5a7681b594cd8423ee4d464811cb2e8`
       --       (含 `sweeper_heartbeat` 與 `clock_timestamp` ⇒ 抽到的確實是接了心跳、修過 R1③ 的那一版)
       --    🔴 負對照:同一段末尾加一個空白 ⇒ md5 變 `ba5abecd…` ⇒ **這把尺會動**。
       -- ⚠️ **代價照實寫**:改一個字(連註解、連空白)⇒ 這道閘就擋下,而訊息會說「錨點不符」。
       --    ⇒ **那是刻意的** —— 這支要蓋掉的是一個【碰錢】的函式(orders 自動取消),
       --      而「差一點點」在這裡沒有安全的讀法。改動它的人要同時更新這兩個 md5。
       AND md5(p.prosrc) IN (
             '456db40fd5f959b9d1b96af7cfc8d4d2',  -- L3a 那版(尚未接心跳),2026-08-28 正式庫與 repo 逐 byte 相同
             'b5a7681b594cd8423ee4d464811cb2e8'   -- 本片完成版(已接心跳)⇒ 重跑冪等放行
             -- 🔴🔴 **這個值【自指】** —— 它量的是這支檔【自己】的函式體
             --    ⇒ 之後任何一次編輯(連函式體【裡面】的一個註解字)都讓它過期,**而零訊號**。
             -- 📌 而那不是假設,是 2026-08-29 真的發生了:
             --    我折 must-fix ① 算出 md5,接著折 must-fix ③ 把一段實測註解寫進【函式體裡面】
             --    ⇒ 第二次折【改掉了第一次折量的那個東西】—— 同一個人、同一輪、同一支檔。
             --    ⇒ 首次 apply 過(prosrc=L3a 在名單裡)、**重跑就 RAISE**
             --      ⇒ 而旁邊那行註解逐字寫著「重跑冪等放行」
             --      📌 **那行註解描述的是它【想要】的行為,不是它會有的行為。**(`-b4` R3 抓到)
             -- ✅ 已做的兩件:①R2③ 那段實測搬出函式體(縮小自指面積)②留一支可機械執行的自檢:
             --      python3 scripts/verify-cron6-md5.py
             --    🔴 而那支自檢【自己帶正對照】(拿 L3a 的已知值驗抽法)——
             --      少了它,一把壞掉的抽法與對的答案會印同一個綠。
             -- ⚠️ **改動這支檔的函式體之後,先跑那支自檢再 commit。**
             -- 🔴 **而「函式體」的邊界寫成【錨】不是行號**(行號會漂 —— 2026-08-29
             --    我搬一段註解就漂了 30 行,而那正是自指那個病的同一個來源):
             --      起 = `AS $fn$`(那支函式的那一個)   止 = 下一個 `$fn$`
             --    ⇒ **改那兩個錨【之間】任何一個字(連註解、連空白)⇒ 這兩個 md5 就過期。**
             --    ⇒ 而改那兩個錨【之外】的東西(檔頭說明 / §3 斷言段 / probe)⇒ md5 不動。
             -- 📌 2026-08-29 實例:折 BLOCKER②(改 probe 那一行與誠實邊界那段)
             --    與補 ③ 的斷言 —— **三處全在體外** ⇒ 自檢跑完 rc=0 ⇒ md5 沒動。
             --    而若當時「從源頭修」去動 `IF p_limit <= 0 THEN p_limit := 1`(**在體內**)
             --    ⇒ md5 當場再過期一次。⇒ **那也是不動它的第二個理由。**
           )
  ) THEN
    RAISE EXCEPTION 'b4-CRON6-片2:函式體不是 L3a 那版、也還沒接過心跳 —— 有人動過它。'
                    '拒絕覆蓋(覆蓋會靜靜刪掉那個改動);拒繼續';
  END IF;
END $$;


-- ── 1. 函式整支重貼 ─────────────────────────────────────────────────────────
-- 🔴 **而「文字零改動」不等於「語意零改動」**(codex R1 nit ①,照收):那個 `EXCEPTION` 子區塊
--    會讓每一輪都**建立一個 subtransaction**(官方明說進出成本顯著較高),並多一筆競爭同一 PK 的寫入。
--    ⇒ 正確字面是 **「既有的取消邏輯零改動」**,不是「語意零改動」。
--    **取消哪幾張單**那一格由拋棄式 PG 上逐 id 比對背書(見 commit body)。
-- 🔴 **與 `20260809160000_...fn.sql:128-186` 的【文字】差異只有一處**:`RAISE LOG` 之後、
--    `RETURN v_count` 之前,插入那個帶 `EXCEPTION` 的心跳子區塊。
--    其餘一個字都沒改(四個安全錨、篩選條件、`cancelled_reason` 的值、註解全部照舊)。
CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- 防 SECURITY DEFINER search_path 劫持;下方全 schema-qualify。
AS $fn$
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
       AND o.created_at < pg_catalog.now() - interval '1 day'        -- 🔴 1 天 = Sean 2026-08-09 逐字「1天」(落 memory project_m4b-b2-shipments-db-decisions:79;
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
$fn$;

REVOKE ALL ON FUNCTION pcm_cron.expire_unpaid_orders(integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;


-- ── 2. 心跳表 COMMENT 補上「這一支寫不出失敗心跳」那一段(含它【不是】資料庫保證)──────────────────────────
-- 🔴 三個落點之一(migration 檔頭 / 本 COMMENT / 片3 規格)。三個都要,而三個各有一發 grep 驗收。
--    📌 「寫了三個地方」與「以為寫了三個地方」長得一樣,只有三發 grep 分得開。
COMMENT ON TABLE public.sweeper_heartbeat IS
  'sweeper 存活心跳（甲′＝單列三值 upsert，每個 job 一列）。'
  '存在理由：告警的觸發條件全部要靠 sweeper 活著才成立 ⇒ sweeper 死掉時，'
  '正好用來報告它的那個計數器會停在 0 而不告警。'
  '零 PII／零金額／零訂單編號／零 rec_trade_id。'
  '無歷史（刻意）：只答「它還活著嗎」，不答趨勢。'
  ' 🔴 例外一支（⟦b4-CRON6⟧ 片2，2026-08-28）：job_name=''pcm-expire-unpaid-orders'' 走純 SQL，'
  'pg_cron 把它跑在自己一個交易裡 ⇒ 函式拋錯則同一交易寫的失敗心跳一起被回捲 '
  '⇒ 【本片這條路】寫不出失敗心跳：它的 last_failure_at 會留在 NULL、consecutive_failures 留在 0。'
  '⚠️ 而那不是資料庫保證：那兩欄是普通欄位，任何有寫入權的路徑都寫得進去 '
  '（例如日後有人補一支別的 job、或手動 UPDATE）⇒ 不要把它讀成「這兩欄不可能有值」。'
  '而一個停在 0 的失敗計數，在儀表上跟「一直很健康」長得一模一樣 '
  '⇒ 讀取端對這一支只准用 staleness 判，不得讀它的失敗計數。';


-- ── 3. fail-closed 斷言(任一異常 → 整檔 ROLLBACK)────────────────────────────
DO $$
DECLARE v_def text;
        v_probe_ok boolean := false;
        v_probe_err text;
        v_candidates bigint;
BEGIN
  v_def := pg_get_functiondef('pcm_cron.expire_unpaid_orders(integer)'::regprocedure);

  -- 3a. 🔴 四個安全錨**改完之後仍在**(這是「行為零改動」的機械代理,不是全部)。
  IF NOT (position('payment_expired' in v_def) > 0
      AND position('status <> ''failed''' in v_def) > 0
      AND position('interval ''1 day''' in v_def) > 0
      AND position('SKIP LOCKED' in v_def) > 0) THEN
    RAISE EXCEPTION 'b4-CRON6-片2:改完之後四個安全錨不齊 —— 我把它改壞了;拒繼續';
  END IF;

  -- 3b. 心跳真的接上了(否則本片等於沒做,而排程照跑、儀表照樣說「從來沒寫過心跳」)。
  IF position('sweeper_heartbeat' in v_def) = 0 THEN
    RAISE EXCEPTION 'b4-CRON6-片2:心跳沒有出現在函式體內;拒繼續';
  END IF;

  -- 3c. 🔴🔴 **那個 EXCEPTION 子區塊在**。少了它 ⇒ 心跳表一出事就把整輪取消帶走,
  --     而**那個世界不會有任何紅色** —— 訂單只是安靜地不被取消。
  --     ⚠️ **這是【字面規則】不是語意斷言**(codex R1 must-fix ⑥ 逐字):把 handler 刪掉、
  --     而讓「心跳寫入失敗」那幾個字留在註解或一個普通的 WARNING 裡,這一格照樣會過。
  --     ⇒ 加驗 `EXCEPTION WHEN OTHERS THEN` 這串**只有 handler 才會有**的字面,把繞過成本墊高;
  --       **而它仍然是字面尺** —— 真正的證據是拋棄式 PG 上那一發(把表改名 ⇒ 函式必須不拋),
  --       數法與結果寫在 commit body。
  IF position('心跳寫入失敗' in v_def) = 0
     OR position('EXCEPTION WHEN OTHERS THEN' in v_def) = 0 THEN
    RAISE EXCEPTION 'b4-CRON6-片2:心跳的 EXCEPTION handler 不見了 —— 監控會把被監控的弄死;拒繼續';
  END IF;

  -- 3c-ter. 🔴 **`clock_timestamp()` 那一格要有一道【會紅的尺】**(R3 ③,2026-08-29 `-b4`)。
  --   我折 R2③ 時補的是【證據】(檔外實測兩個時鐘分岔),而**那不是守門** ——
  --   §3 斷言段整段 `grep clock_timestamp` ⇒ **0 命中**
  --   ⇒ 有人把 `clock_timestamp()` 改回 `now()`,**首次 apply 一路綠到 COMMIT**。
  --   📌 而我自己在檔頭那段訂正裡就寫著「把 clock_timestamp 改回 now(),那一發照樣會過」
  --      ⇒ **那句話在我補完證據之後【仍然成立】** —— 因為我補的東西不會叫。
  -- ⚠️ 而它與 3c 同族:**字面尺**。它擋的是「有人整個換掉」,擋不住「有人另外寫一個
  --    叫 clock_timestamp 的東西」—— 而後者不在本片的威脅模型裡。
  IF position('clock_timestamp' in v_def) = 0 THEN
    RAISE EXCEPTION 'b4-CRON6-片2:心跳寫入沒有用 clock_timestamp() —— '
                    'now() 是交易起始時間,慢交易會用舊時刻蓋掉新心跳 ⇒ last_success_at 倒退;拒繼續';
  END IF;

  -- 3c-bis. 🔴🔴 **行為負測(R2 must-fix ⑥,2026-08-29 `-b4`)** ——
  --   上面那兩個 `position()` **仍然是字面尺**,而 R2 逐字指出它還是會假綠:
  --   那兩串可以只存在【註解】裡、可以在一個【無關的子區塊】裡、
  --   handler 本身也可以只寫 `NULL;` ⇒ **兩個 substring 全部命中,而 handler 什麼都不做。**
  -- 🔴 而 §0 那道 md5 閘**涵蓋不到這一格** —— 它跑在 `CREATE OR REPLACE` 【之前】(:113),
  --    量的是【舊版】;這一格跑在【之後】(:269 取 `pg_get_functiondef`),量的是【新版】。
  --    📌 兩道在不同的時刻量不同的東西,不要把前者當成後者的保險。
  -- ✅ 所以這一格改成問【行為】:**把心跳表換掉,讓 upsert 必然失敗,而取消流程必須照樣成功。**
  --    那是唯一能分開「handler 在」與「handler 只是字串在」的做法。
  -- 🔴🔴 **R3 BLOCKER ②(2026-08-29 `-b4`):先數候選,再決定要不要跑那一發。**
  --    成因:`:196-198` 有 `IF p_limit IS NULL OR p_limit <= 0 THEN p_limit := 1`
  --    ⇒ 我傳的 `0` **被吞成 1** ⇒ 那一發實際以 limit=1 跑。
  --    🔴 而回捲的只有 `RENAME`(DDL 在交易內)—— **`orders` 那筆 UPDATE 跟著整檔 COMMIT,不回捲**
  --    ⇒ apply 當下若正好有一張過期未付款單,**它會被真的取消**(鐵則 12 ① 碰錢)。
  --    📌 而這一格的形狀值得留著:我在 `:358` 那段【誠實邊界】裡寫「不動任何一張訂單」——
  --      **那是我以為的行為,不是它的行為。⇒ 一個誠實邊界節本身可以是錯的,
  --      而它的形式會讓人不回頭查它。**
  -- 🔴🔴 **下面這段 WHERE 是【函式那段的手抄副本】**(R4 `-b4` 2026-08-29 多驗到的那一格):
  --    有人改了函式裡 `WITH target` 的條件而沒有同步改這裡 ⇒
  --    **這道閘會安靜地數錯,而兩邊都不會紅** ——
  --    而它數錯的方向正好是最糟的那一種:函式其實有東西可取消,而閘印 0 ⇒ 放行。
  -- ⇒ **改上面那個 `WITH target` 的 WHERE,就要同步改這裡。**
  -- ✅ 而它今天是對的(2026-08-29,兩邊各自機械比對過:去註解、壓空白、逐字 ⇒ 相同 = True;
  --    負對照把其中一份的 `'1 day'` 改成 `'2 day'` ⇒ 相同 = False ⇒ 那把比對尺會動)。
  -- ⚠️ 而「今天是對的」不等於「明天還是對的」—— 這一格沒有機制,只有這句話。
  SELECT pg_catalog.count(*) INTO v_candidates
    FROM public.orders o
   WHERE o.payment_status = 'unpaid'::public.payment_status
     AND o.cancelled_at IS NULL
     AND o.created_at < pg_catalog.now() - interval '1 day'
     AND NOT EXISTS (
           SELECT 1 FROM public.payment_charge_attempts a
            WHERE a.order_id = o.id
              AND a.status <> 'failed'
         );
  -- 🔴 **把數字印出來**(不是只在有問題時才說話):兩個世界都要留下痕跡。
  RAISE NOTICE 'b4-CRON6-片2:handler 行為負測前,過期未付款候選 = % 筆', v_candidates;
  IF v_candidates > 0 THEN
    RAISE EXCEPTION 'b4-CRON6-片2:現在有 % 筆過期未付款單,而 handler 負測會【真的取消掉其中一筆】'
                    '(p_limit=0 被 :196-198 吞成 1,而 orders 的 UPDATE 不隨本檔回捲);拒繼續。'
                    ' ⇒ 等那幾筆被正常的排程處理掉、或先確認它們該被取消,再貼這一支。', v_candidates;
  END IF;

  BEGIN
    -- 造一個必然失敗的世界:把心跳表暫時改名(同一交易內,結束就回捲)
    -- ⚠️ `RENAME` 拿 ACCESS EXCLUSIVE,而 :349 改回來**不釋鎖** ⇒ 押到整檔 COMMIT
    --    ⇒ 期間並發的心跳寫入會排隊。而取單那段走 `SKIP LOCKED` ⇒ 不成環 ⇒ **只等不死鎖**
    --    ⇒ **可接受,而它之前沒有寫在檔裡**(R3 ⑥ 指出)。
    EXECUTE 'ALTER TABLE public.sweeper_heartbeat RENAME TO sweeper_heartbeat__b4cron6_probe';
    BEGIN
      -- 🔴 這一發【必須成功】:心跳寫不出去,而取消流程不受影響
      PERFORM pcm_cron.expire_unpaid_orders(0);
      -- ⚠️ 上面那個 `0` **不代表「不動任何訂單」**(R3 BLOCKER ② —— 見 :364 起那段訂正)。
      v_probe_ok := true;
    EXCEPTION WHEN OTHERS THEN
      v_probe_ok := false;
      v_probe_err := SQLERRM;
    END;
    EXECUTE 'ALTER TABLE public.sweeper_heartbeat__b4cron6_probe RENAME TO sweeper_heartbeat';
  END;

  IF NOT v_probe_ok THEN
    RAISE EXCEPTION 'b4-CRON6-片2:心跳寫不出去時,取消流程【跟著死了】(%) —— 監控把被監控的弄死;拒繼續', v_probe_err;
  END IF;
  -- ⚠️ **這一發證什麼、不證什麼**(照家法寫死,不放寬):
  --   ✅ 證到:心跳 upsert 失敗時,`expire_unpaid_orders` **不拋** ⇒ handler 真的在承重
  --   ❌ 不證:handler 有沒有把錯誤【記下來】(它刻意只吞不記,見檔頭那條物理限制)
  --   🛑🛑 **訂正(R3 BLOCKER ②,2026-08-29)**:這裡原本寫「這一發用 `0` 是刻意的:
  --      **不動任何一張訂單**」—— **那句話是假的。**
  --      `:196-198` 把 `p_limit <= 0` 吞成 `1` ⇒ 這一發實際以 limit=1 跑,
  --      而 `orders` 的 UPDATE **不隨本檔回捲** ⇒ 它會真的取消一張單。
  --      ✅ 已加前置閘:apply 前先數候選,`> 0` 就拒絕(見上),並把數字 RAISE NOTICE 出來。
  --   ❌ 不證:`p_limit > 0` 那條路 —— 這一發跑的是 limit=1 而候選為 0 的那個世界
  --      ⇒ 「有訂單要取消時心跳失敗也不受影響」**沒有被這一發證到**
  -- 🔴 **而【該綠的綠】不算數,要看它會不會紅**:把上面那段 RENAME 拿掉 ⇒ 心跳寫得出去
  --    ⇒ 這一格就永遠是綠的 ⇒ **它會退化成一個恆真守門**。
  --    ⇒ 改動這一段的人,請先餵一發「handler 改成 RAISE」確認它真的會紅。

  -- 3d. 🔴 **不得碰 last_failure_at**(檔頭那條物理限制的機械守門:
  --     有人「順手補上」的話,它會寫進一個永遠回捲的交易裡,而畫面上多一個永遠不動的時間戳)。
  IF position('last_failure_at' in v_def) > 0 THEN
    RAISE EXCEPTION 'b4-CRON6-片2:函式體內出現 last_failure_at —— 它寫不出去(見檔頭);拒繼續';
  END IF;

  -- 3e. 權限零漂移:owner / SECDEF / search_path / 零 owner 以外的 grantee。
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'b4-CRON6-片2:改完之後 owner/SECDEF/search_path 漂了;拒繼續';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND a.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION 'b4-CRON6-片2:函式有 owner 以外的 grantee;拒繼續';
  END IF;

  -- 3f. COMMENT 那一句真的寫進去了(三個落點之一的機械驗收)。
  --     ⚠️ **射程講準**(codex R1 nit ③):上面第 2 節在**同一個交易裡**剛寫過那段 COMMENT
  --     ⇒ 這一格**只擋「我改 COMMENT 時把那句刪掉了」**,它**不證明那句話在資料模型上為真**。
  --     那句話的真假由 §「永遠是 NULL/0」那段的限定條件負責,不由這一格負責。
  -- 🔴 **R2 must-fix ④(2026-08-29)**:上面那句原本寫「永遠是 NULL / 永遠是 0」,
  --    而它與檔頭 :17 自己承認的「不是資料庫保證」**直接矛盾** —— 我當時只改了被點名的那一處。
  --    ⇒ 而這道斷言在數的就是那五個字 ⇒ **正文改了而它沒改的話,apply 當場炸**。
  --    📌 順手 grep 過全檔:「永遠是 NULL / 永遠是 0」共 8 處,其中 `:258` 是**會印進資料庫的正文**
  --       ⇒ 那一處才是別人讀得到的。改字面時要連【數它的那道斷言】一起改。
  IF position('留在 0' in obj_description('public.sweeper_heartbeat'::regclass)) = 0 THEN
    RAISE EXCEPTION 'b4-CRON6-片2:心跳表 COMMENT 缺「留在 0」那句;拒繼續';
  END IF;

  -- 3g. 排程那一列**沒有被本片動到**(本片不碰排程;動到就是我寫錯了)。
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobname = 'pcm-expire-unpaid-orders'
       AND active
       AND schedule = '0 * * * *'
       AND command  = 'SELECT pcm_cron.expire_unpaid_orders(500)'
       AND username = 'postgres'
  ) THEN
    RAISE EXCEPTION 'b4-CRON6-片2:排程那一列與預期不符(本片不該動它);拒繼續';
  END IF;
END $$;

COMMIT;

-- ══ 這支 migration 【不】證明什麼(免得 apply 綠了被讀成「心跳已上線」)═══════════
-- · 上面全部是**函式體字面**與**metadata** 的斷言 —— 它們**不證**下一次排程跑的時候
--   真的寫得進那一列。真正的證據 = apply 之後去看 `sweeper_heartbeat` 對
--   `pcm-expire-unpaid-orders` 有沒有一列、`last_success_at` 有沒有在動。
-- · 3a 那四個錨是「行為零改動」的**機械代理**,不是等價物:錨以外的改動它看不見
--   (同一個限制 `20260809170000_...schedule.sql:57-59` 已經寫過一次)。
-- · 🔴 **心跳寫失敗的那條路,本檔的斷言一格都碰不到** —— 它只在執行期發生,
--   而發生時只留一行 WARNING。驗它要在拋棄式 PG 上把表改名再跑一次(plan §6 第 2 條)。
