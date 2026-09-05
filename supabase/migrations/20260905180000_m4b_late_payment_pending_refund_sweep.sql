-- ⟦b4-NCPCRONRACE⟧ / ⟦b4-SETTLERETRYNEVER⟧ 的**兜底** —— 腿 A(片 1)。
-- plan:docs/plans/2026-09-05-late-payment-scanner-plan.md(Sean 2026-09-05 逐字「5. 甲」)
--
-- ══ 這一支在解什麼 ═══════════════════════════════════════════════════════════
-- 一張**已取消**的單, 若某一軌還有正的未退淨額, 而 `order_pending_refunds` 上
-- **沒有那一軌的未作廢未結清列** ⇒ 🔴 **那筆錢在帳本上不存在。**
-- 本支每 10 分鐘掃一次, 把那樣的列補開。
--
-- 🔴🔴 **[R1-F6:本段與 `20260905070000:168` 打架, 而那一句是先寫的]**
--    那支檔逐字寫著:「**所以這裡【不加 FOR UPDATE】—— 那個競態改由事後掃描器收**」
--    ⇒ 📌 **070000 把本支當成【那個競態的唯一修法】, 不是兜底。**
--    ⇒ 🛑 **所以本支【不可以】因為「它只是兜底」而被關掉** —— 關掉它, 070000:168
--       明文交出去的那個世界就沒有人接了。
--    🔵 而下面那句「兩個已知世界都有人接」仍然成立, 只是它的第二半**靠的正是本支**。
--
-- 🛑 **它【不是】在修一個【新】的洞** —— 兩個已知世界的接手者是:
--    · 「取消已提交」 ⇒ `20260905070000` 的 trigger
--    · 「取消與付款同時在飛」 ⇒ 正式取消形狀全部先 `FOR UPDATE` ⇒ 它塌成序列
--      (前提由 `scripts/cancelled-at-writers-lock-gate.test.ts` 守著)
-- 🎯 **它的存在理由是**:不論什麼原因(競態 / 例外被吞 / 那個前提被改壞 /
--    **我們還沒想到的**), **該有列而沒列**的那一族會在 10 分鐘內被補上。
-- 📌 **一道兜底的價值, 恰好在於它不需要知道洞是什麼。**
--
-- 🔴🔴 **[射程 —— R1-F1 抓到我原本的全稱句是假的, 主視窗 2026-09-05 裁乙]**
--    ⛔ ~~「不論什麼原因漏開的那一列都會被補上」~~ ⇒ **那句話對兩族不成立**:
--    ① **列在而金額少**(取消後匯款分兩筆到:第一筆開列 500, 第二筆進來)——
--       `open_for(id, false)` 對既有活列 **DO NOTHING**, 而本支只選「沒有活列」的
--       ⇒ 🛑 **本支【不補它】, 只把它數成一格**(`amount_short`)。
--       🔵 依據 = Sean 2026-09-05「多匯不翻狀態只標字」那一板的同一條理:
--          **列在而後面又進錢, 本質是多付 ⇒ 走同一條「標不動」。**
--       📌 而不覆寫的硬理由:`amount_at_cancel` 的語意是**取消當下的快照**,
--          覆寫它等於改掉那一欄在講什麼。
--    ② **被人作廢過的單** ⇒ **整張跳過**, 只數成一格(`voided_skipped`)。見函式體那段。
--    ⇒ 📌 **這兩族今天【只有告警】, 而告警信要有人看** —— 那一格見 plan §7, 它還沒解。
--
-- ══ 🔴🔴 驗收條件(Sean 拍板時看到的那句, 逐字帶下來)═══════════════════════
--    ⚠️ **不要用「補了幾筆」當它的驗收。**
--    上線後一個月補 **0 筆是它該有的樣子**, 不是它沒用。
--    ⇒ 一個正確的 0 會被讀成失敗, 而那會讓人把它關掉。
--
-- ══ 本支【不做】腿 B(明寫, 不是漏掉)═══════════════════════════════════════
-- 腿 B =「已收匯款而 `payment_status` 仍 unpaid」⇒ 它要翻**狀態機**, 授權等級不同,
-- 而它卡在 plan §7(靠「有人讀告警信」, 而 2026-09-05 量到沒有人固定在看)。
-- 🛑 **⇒ 本支上線之後, 腿 B 那個世界仍然沒有人接。不要因此把板上那一列劃掉。**
-- 🔬 2026-09-05 唯讀實查:腿 B 候選 **0** —— 而成因是**正式庫一張 `bank_transfer` 的單都還沒有**
--    (🟢 同一把尺對 `tappay` 量 ⇒ **1** ⇒ 尺會動;🔵 負對照現造管道 ⇒ 0)。
--    ⇒ 📌 那個 0 是「還沒開始」, 不是「沒有這種問題」。
--
-- ══ 為什麼直接跑 SQL 而不走 HTTP route ═════════════════════════════════════
-- 兩種形狀 repo 裡都有(實查 `cron.schedule` 的 command:走 route 5 條 · 直接跑 SQL 2 條)。
-- 🔵 本支選**直接跑 SQL**, 理由是它**整段工作都在 SQL 裡** —— 沒有 TS 邏輯要跑
--    ⇒ 走一趟 HTTP 只是多一個會壞的環節(而那個環節壞掉時, 症狀是「安靜地沒補」)。
--    形狀比照最近的同族 `pcm_cron.expire_unpaid_orders`(`20260904230000`)。

-- ══ 🔴🔴 貼板順序:**這一支要先 apply, 白名單那一列才能進 dev**(R4-MF4)═══════
-- 本片同時改了 `packages/domain/src/ops/cron-jobs.ts` 的 `CRON_JOB_WHITELIST`(加第七支)。
-- 🔴 **那一列一合進 dev 就【當場部署】, 而這支 migration 是 Sean 手動貼** ——
--    兩者之間的缺口期裡, 儀表找不到 `pcm-late-payment-sweep` 的心跳
--    ⇒ `never_beat` ⇒ `abnormal_count >= 1` ⇒ **LINE + Email 每天一封, 而那條路沒有冷卻**
--      (`check-anomaly-alerts.ts` 逐字寫著「沒有冷卻機制」)。
-- 🛑 **⇒ 缺口不是「少了一點保護」, 是【每天一封確信的假警報】。**
-- ✅ 正確順序:**① Sean 貼這一支 ② 才把白名單那一顆 commit 合進 dev**。
--    ⚠️ 而 `scripts/20260905180000-down.sql` 只寫了**反向**(先退碼再退 DB)——
--       📌 **正反兩個方向都要寫, 而我原本只寫了一半。**

BEGIN;

-- ── 前置閘:它靠的那兩支函式在不在 ────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_pending_refund_open_for(uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.pcm_pending_refund_open_for(uuid, boolean) ⇒ 20260905070000 還沒貼, 先貼那一支';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_pending_refund_amounts(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.pcm_pending_refund_amounts(uuid) ⇒ 20260902030000 還沒貼';
  END IF;
  IF pg_catalog.to_regnamespace('pcm_cron') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 schema pcm_cron';
  END IF;
END $$;

-- ══ 1. 掃描函式 ═════════════════════════════════════════════════════════════
-- 🔴🔴 **裸 `CREATE`, 不用 `OR REPLACE`, 也不用 `DROP IF EXISTS`** ——
--    `migration-new-file-static-checks` 那道閘擋下我原本的寫法, 而**它是對的**:
--    這是一個**新物件** ⇒ 撞名必須**當場紅**。`OR REPLACE` 會把撞名靜靜蓋掉,
--    而我的 REVOKE 與事後斷言照樣全綠 —— 🛑 **拿到綠燈, 卻蓋掉了一個我不知道存在的東西。**
-- 🔵 而 R2-⑥ 擔心的那件事(開發期曾是 `RETURNS integer`, 而 `OR REPLACE` 不能改回傳型別)
--    **正好被裸 CREATE 解掉**:真有殘留 ⇒ 它報 `already exists` 而不是 `cannot change return type`,
--    ⇒ 兩種都是紅, 而**裸 CREATE 那一種說得出「有東西已經在那裡」**。
CREATE FUNCTION pcm_cron.late_payment_pending_refund_sweep(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r_row   record;
  v_open  integer := 0;   -- 真的補開了幾張單
  v_short integer := 0;   -- 🔴 有活列【而金額少】幾張(只數不動 —— R1-F1 乙案)
  v_void  integer := 0;   -- 🔴 有作廢列而整張跳過幾張(R1-F2)
  v_fail  integer := 0;   -- 補的時候炸掉幾張
  v_noop  integer := 0;   -- 🔵 呼叫沒炸而也沒新增(別人先開了)—— 不是成功也不是失敗
  v_scanned integer := -1;  -- 🔴 R4-MF5 分母:掃過幾張已取消單(-1 = 統計趟沒跑成)
  v_before integer;
  v_after  integer;
BEGIN
  -- p_limit fail-safe:NULL / <=0 一律退回 1(形狀照 pcm_cron.expire_unpaid_orders)。
  -- 🔴 **不接受「無上限」** —— 一個 0 或 NULL 會讓它靜默不處理,
  --    而那與「今天沒東西要補」印同一個數字。
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1;
  END IF;

  -- 🔴🔴 **R1-F7(飢餓)—— 而它在我自己的探針裡當場咬了我兩次**:
  --    第一版:`LIMIT` 套在「所有已取消的單」上 + `ORDER BY cancelled_at` 升冪
  --      ⇒ 最舊那幾張(什麼都不缺)佔滿名額, 真的缺列的新單永遠輪不到。
  --    第二版:改成「有事就進候選」⇒ 🔴 **只需要【被數】的單照樣佔走寫入名額。**
  --    ✅ 定案:**兩趟。數的那兩族不設限(它們不寫任何東西), 而 `LIMIT` 只管【要寫入】的那一趟。**
  --    📌 **一個名額只該限制會產生副作用的動作** —— 讓「只是數一數」去搶它, 是把
  --       一個便宜的動作變成一個會餓死別人的動作。
  --    ⚠️ 代價明寫:數的那一趟會掃過所有已取消的單。今天存量極小;天花板見本函式 COMMENT。

  -- ── 第二趟:要寫入的那一族(缺整列)—— 這一趟才受 p_limit 管 ──
  FOR r_row IN
    SELECT o.id AS order_id
      FROM public.orders o
     WHERE o.cancelled_at IS NOT NULL
       -- 🔴🔴 **R1-F2(主視窗 2026-09-05 裁):有作廢列的單, 整張跳過。**
       --    依據:`voided_at` 是**人**下的手(Sean 走 SQL Editor 可達)⇒ 🛑 **機器不推翻人。**
       --    而一列被作廢卻沒登記 `order_manual_refunds` 時 `amounts` 仍 > 0
       --    ⇒ 不跳過的話它會**每 10 分鐘原地復活, 永遠**。
       --    🔵 **跳過是零寫入的那一側**:跳錯了會在告警上看到;重開錯了會永遠復活。
       AND NOT EXISTS (SELECT 1 FROM public.order_pending_refunds v
                        WHERE v.order_id = o.id AND v.voided_at IS NOT NULL)
       -- 缺【整列】的那一族 —— 本支唯一會動手的。
       AND EXISTS (
             SELECT 1 FROM public.pcm_pending_refund_amounts(o.id) AS a
              WHERE a.amount > 0
                AND NOT EXISTS (SELECT 1 FROM public.order_pending_refunds r
                                 WHERE r.order_id = o.id AND r.rail = a.rail
                                   -- 🔴 這兩條要與那個部分唯一索引的謂語逐字相同
                                   --    (`20260901080000:261`)⇒ 否則「我看到的未結清」
                                   --    與「ON CONFLICT 認的未結清」是兩個集合。
                                   AND r.voided_at  IS NULL
                                   AND r.settled_at IS NULL))
     -- 🔴🔴 **codex R3-①:`ORDER BY cancelled_at` 升冪 + `LIMIT` = 飢餓**。
     --    一張**永久失敗**的舊單, 每一輪都排最前面 ⇒ 它與它前面那 p_limit-1 張
     --    **每輪重佔名額** ⇒ 後面的候選**永遠輪不到**;而兩個 worker 也會挑到同一批。
     -- ✅ 改成 `random()`。⚠️ **代價明寫:放棄了「最舊的先補」** ——
     --    那個順序看起來合理(錢漏最久的先), 而它在有永久失敗的單時**會把整條路堵死**。
     --    📌 **一個公平的順序, 在有一顆卡住的東西時會變成一個只服務那顆的順序。**
     -- 🔵 而今天候選數遠小於 p_limit(200)⇒ 順序不影響誰被處理, 只影響「卡住時誰還輪得到」。
     ORDER BY random()
     LIMIT p_limit
  LOOP
    BEGIN
      -- 🔴 第二參 **false** = 不覆寫既有金額。形狀照 `20260905070000:342`。
      --    ⇒ 本支只補【完全沒有】的那一軌;「列在而金額少」那一族只數不動(第一趟)。
      -- 🔴 **codex R3-②:`open_for` 回 void ⇒ 「呼叫沒炸」不等於「真的多開了一列」**。
      --    並發時另一個 worker 可能已經開好 ⇒ `ON CONFLICT DO NOTHING` ⇒ 零新增,
      --    而我原本照樣 `v_open + 1` ⇒ 📌 **`opened` 虛報, 而它是要進告警信的數字。**
      -- ✅ 拿【前後差】當答案, 不拿【呼叫成功】當答案。
      SELECT pg_catalog.count(*) INTO v_before
        FROM public.order_pending_refunds r
       WHERE r.order_id = r_row.order_id AND r.voided_at IS NULL AND r.settled_at IS NULL;
      PERFORM public.pcm_pending_refund_open_for(r_row.order_id, false);
      SELECT pg_catalog.count(*) INTO v_after
        FROM public.order_pending_refunds r
       WHERE r.order_id = r_row.order_id AND r.voided_at IS NULL AND r.settled_at IS NULL;
      IF v_after > v_before THEN
        v_open := v_open + 1;
      ELSE
        -- 🔵 沒炸而也沒新增 ⇒ 別人先開了(或那一軌的金額變 0)。**它不是失敗, 也不是成功。**
        v_noop := v_noop + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- 🛑 **一張單失敗不得讓整輪停** —— 否則第一張壞單會把後面每一張都擋住,
      --    而症狀是「掃描器每次都補 0 筆」, 與「今天沒東西要補」印同一個數字。
      -- ⚠️ 而 `WHEN OTHERS` **抓不到** query_canceled(57014) 與 assert_failure ⇒ 逾時仍整輪中止,
      --    🔴 **而那時本輪已經補好的列會一起回滾** —— 這一半刻意寫出來, 不只寫「整輪中止」。
      --    ⚠️ 而**統計趟**(它在寫入之後、不設限)是最可能吃到 57014 的那一段 ——
      --       見那一段的 handler 註解。**兩處講的是同一件事的兩端。**
      v_fail := v_fail + 1;
      RAISE LOG '[late_payment_sweep] order=% 補待退款失敗(%), 本輪其餘照跑', r_row.order_id, SQLERRM;
    END;
  END LOOP;

  -- 🔴🔴 **R1-F3:沒有下面這一段, 「每輪都失敗」是完全靜默的** ——
  --    `v_open` 不含失敗數 ⇒ 回 0 與「今天沒東西要補」印同一個數字;
  --    `cron.job_run_details` 記 success;`RAISE LOG` 進 server log **而沒有人在看**。
  --    🎯 那正是本支宣稱要接的那個世界(漏掉而沒有人知道), 換了一個位置。
  -- 🔴🔴 **R2-⑤:這一趟【移到寫入之後】, 而且自己包一層 EXCEPTION。**
  --    它原本排在前面, 而它是**不設限的全掃** ⇒ 它拋錯或吃到逾時 ⇒ **整輪中止,
  --    而第二趟一列都沒補** ⇒ 📌 **一個為了看見問題而加的動作, 會把補救整個關掉。**
  --    ⇒ 順序是:**先做會產生副作用的那一趟, 再做只是看的那一趟。**
  BEGIN
    SELECT
      -- 🔴 R4-MF5:回傳要有【分母】。沒有它, 上游 rail 集合漂掉 ⇒ 候選恆空
      --    ⇒ opened=0 / 心跳綠 / 儀表綠 / 告警靜, 而**兜底已經瞎了**。
      --    ⇒ 📌 scanned 是唯一一個「這把尺還搆得到東西」的證據。
      pg_catalog.count(*),
      pg_catalog.count(*) FILTER (WHERE t.short_rails > 0),
      pg_catalog.count(*) FILTER (WHERE t.has_voided)
      INTO v_scanned, v_short, v_void
      FROM (
        SELECT
          -- 🔴 R1-F2:這張單有沒有【被人作廢過】的列。
          EXISTS (SELECT 1 FROM public.order_pending_refunds v
                   WHERE v.order_id = o.id AND v.voided_at IS NOT NULL) AS has_voided,
          -- 🔴 R1-F1:有活列【而金額少】的軌數 —— **只數, 不動**(主視窗 2026-09-05 裁乙)。
          (SELECT pg_catalog.count(*) FROM public.pcm_pending_refund_amounts(o.id) AS a
            JOIN public.order_pending_refunds r
              ON r.order_id = o.id AND r.rail = a.rail
             AND r.voided_at IS NULL AND r.settled_at IS NULL
           WHERE a.amount > r.amount_at_cancel) AS short_rails
          FROM public.orders o
         WHERE o.cancelled_at IS NOT NULL) AS t;
  EXCEPTION WHEN OTHERS THEN
    -- 🛑 數不出來 ⇒ 用 -1 明示「這一格沒量到」, **不要用 0** —— 0 與「今天沒有」同一個字。
    -- 🔴🔴 **而這個 handler 接不住 `57014`(statement_timeout / 查詢被取消)**(codex ①):
    --    統計趟是**不設限的全掃** ⇒ 已取消單量大時它最可能吃到逾時,
    --    而 57014 **不是可以被 handler 接住的例外** ⇒ 🛑 **整個交易中止**
    --    ⇒ **這一輪【前面已經補好的那些待退款列, 一起回滾】。**
    --    ⇒ 📌 而本函式別處寫著「補列不受影響」—— **那句話對 57014 這條路是假的。**
    --       ⚠️ 那不是一句可以靠註解修好的東西:要真的擋它, 統計趟得走**另一個交易**
    --       (而 pg_cron 一輪一個交易 ⇒ 那要拆成兩支 job)。**本片不做, 明寫接受。**
    --    🔵 今天的實際暴露:已取消單存量極小 ⇒ 統計趟遠不到逾時。
    --       **它會在已取消單長起來的那天開始咬, 而那時症狀是「每輪都補 0 筆」。**
    v_scanned := -1; v_short := -1; v_void := -1;
    RAISE WARNING '[late_payment_sweep] 統計那一趟失敗(補列不受影響):%', SQLERRM;
  END;

  -- 🔴🔴 **R4-MF1:這一段原本排在【統計趟之前】,而 R5 抓到它【第一次沒有真的被移走】。**
  --    成因:那一發 python 在後面一個 assert 炸掉 ⇒ **整支腳本在寫檔之前就中止**,
  --    而我把「已移動」寫進了 commit body。
  --    ⇒ 📌 **一個沒有落地的修法 + 一句宣稱它落地的 commit,比沒修還糟** ——
  --       下一個人讀 commit 會判這條已關。(鐵則 11 的字面 vs 事實,受詞是我自己。)
  --
  --    病本身:統計趟是 R2-⑤ 為了「不要讓只是數的動作把補救關掉」才移到寫入之後的,
  --    而**印它的這行沒有跟著移** ⇒ `v_short` / `v_void` 在這裡還是宣告時的 0
  --    ⇒ `v_short > 0 OR v_void > 0` 這兩個觸發條件**永遠不成立**
  --    ⇒ 🛑 **R1-F1/F2 要求「只數不動、而要有人看得到」的那兩族,唯一的人類通道是啞的。**
  --
  -- ⚠️ **而探針對這一格結構上零判別力**(R5 指出):它讀的是 jsonb,
  --    而 jsonb 是統計趟【之後】才組的 ⇒ 那幾格全過與本缺陷**完全相容**。
  --    ⇒ 📌 **一個綠的測試, 證明不了一個它讀不到的東西。**
  -- ⚠️ R4-N4:`-1`(統計趟自己炸了)在 `> 0` 之下為假 ⇒ 判準用 `<> 0`。
  IF v_fail > 0 OR v_noop > 0 OR v_short <> 0 OR v_void <> 0 THEN
    RAISE WARNING '[late_payment_sweep] 掃過 % 張已取消單 · 補 % 張 · 沒動 % 張(別人先開)· 金額少 % 張 · 作廢跳過 % 張 · 失敗 % 張(-1 = 那一格沒量到)',
      v_scanned, v_open, v_noop, v_short, v_void, v_fail;
  END IF;

  -- 🔴🔴 **R2-② 心跳 —— 沒有這一段, 把本支放進 `CRON_JOB_WHITELIST` 會製造一封【每天的假警報】**:
  --    儀表讀 `sweeper_heartbeat`, 查無 ⇒ `neverBeat` + `abnormal` ⇒ 進 `abnormal_count`
  --    ⇒ `check-anomaly-alerts` 寄 LINE + Email, 而那條路**逐字寫著「沒有冷卻機制」**。
  --    🛑 **而測試抓不到它** —— 那支測試的 fixture 是【從白名單生出來的】,
  --       它替一個現實中不存在的心跳列造了一份資料。
  --    ⇒ 📌 一個為了「讓它被看見」而做的動作, 差一點變成一個每天叫的狼來了。
  -- 形狀逐字抄 `20260904230000:531-539`(同族純 SQL 排程):`GREATEST` 那半擋的是
  -- 「晚到的舊值覆蓋新值」, 不是裝飾。
  -- 🔴🔴 **codex R3-③:心跳不得【無條件】刷成功。**
  --    我原本無條件寫 `consecutive_failures = 0` ⇒ 就算**每一張都失敗**,
  --    cron 記 success、心跳也被刷成 0 ⇒ 📌 **每輪全失敗與一切正常, 在儀表上是同一個畫面。**
  --    (而那正是本片自己在講的病:漏掉了而沒有人知道。)
  -- ✅ 有失敗 ⇒ 寫**失敗心跳**並把 consecutive_failures **加上去**;零失敗才刷成功。
  -- 🔵 而這一支是純 SQL ⇒ 函式**拋錯**時失敗心跳會被同交易回捲(見 `cron-jobs.ts` 那段);
  --    但**本函式不拋錯**(單張失敗被接住)⇒ 這裡寫的失敗心跳**留得住**。
  --    ⇒ 📌 那正是 `FAILURE_COUNT_MEANINGLESS` 對它**仍然成立**的原因:
  --       57014 那條路照樣寫不出來。**兩種失敗, 只有一種留得下痕跡。**
  BEGIN
    IF v_fail > 0 THEN
      INSERT INTO public.sweeper_heartbeat (job_name, last_failure_at, consecutive_failures, updated_at)
      VALUES ('pcm-late-payment-sweep', pg_catalog.clock_timestamp(), 1, pg_catalog.clock_timestamp())
      ON CONFLICT (job_name) DO UPDATE
        SET last_failure_at      = GREATEST(public.sweeper_heartbeat.last_failure_at, excluded.last_failure_at),
            consecutive_failures = public.sweeper_heartbeat.consecutive_failures + 1,
            updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
    ELSE
      INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
      VALUES ('pcm-late-payment-sweep', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
      ON CONFLICT (job_name) DO UPDATE
        SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
            consecutive_failures = 0,
            updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[late_payment_sweep] 心跳寫入失敗(本輪補列不受影響):%', SQLERRM;
  END;

  -- 🔴 回傳四個數而不是一個 —— **一個整數載不動三種需要有人看的東西**。
  -- 🛑 **而今天沒有人讀這個回傳值** —— 把它接進 `pcm-anomaly-alert` 是【片 2】,
  --    不在本支裡。這一句明寫, 不假裝它已經有人接。
  RETURN pg_catalog.jsonb_build_object(
    'scanned', v_scanned, 'opened', v_open, 'noop', v_noop,
    'amount_short', v_short, 'voided_skipped', v_void, 'failed', v_fail);
END;
$function$;

ALTER FUNCTION pcm_cron.late_payment_pending_refund_sweep(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION pcm_cron.late_payment_pending_refund_sweep(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION pcm_cron.late_payment_pending_refund_sweep(integer) FROM anon;
REVOKE ALL ON FUNCTION pcm_cron.late_payment_pending_refund_sweep(integer) FROM authenticated;
REVOKE ALL ON FUNCTION pcm_cron.late_payment_pending_refund_sweep(integer) FROM service_role;

COMMENT ON FUNCTION pcm_cron.late_payment_pending_refund_sweep(integer) IS
$c$兜底:把「已取消 + 某軌有正的未退淨額 + 帳本上沒有那一軌未結清列」的單, 補開一列待退款。
🔴 它【不是】在修一個已知的洞 —— 兩個已知世界(取消已提交 / 同時在飛)都已經有人接。
它接的是「不論什麼原因漏掉的」, 包含我們還沒想到的。
🔴🔴 驗收條件(Sean 2026-09-05 拍板時看到的那句):**不要用「補了幾筆」當它的驗收** ——
上線後一個月補 0 筆是它該有的樣子。一個正確的 0 會被讀成失敗, 而那會讓人把它關掉。
🛑 本函式【不做】腿 B(已收匯款而 payment_status 仍 unpaid)—— 那要翻狀態機, 授權等級不同,
且它卡在「靠有人讀告警信, 而沒有人固定在看」。⇒ 本支上線不代表那個世界有人接了。
⚠️ 效能天花板:它對每一張已取消的單呼叫一次 pcm_pending_refund_amounts(STABLE, 內含彙總)
⇒ 已取消單量大起來時掃描成本會長。今天存量極小、每 10 分鐘一次 ⇒ 不加索引。
真的長起來時的修法 = 對 (cancelled_at) 加部分索引, 並給本函式設 statement_timeout。
⚠️ 一張單失敗不中斷整輪(RAISE LOG 後續跑);而 WHEN OTHERS 抓不到 57014 逾時。$c$;

-- ══ 2. 排程 ═════════════════════════════════════════════════════════════════
-- 🔴 `cron.schedule` 是 **by-name upsert** ⇒ 先拍既有 job 快照, 證明我沒動到別人的。
--    形狀照 `20260820070000:36-52`。
CREATE TEMP TABLE _lps_jobs_before ON COMMIT DROP AS
  SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active
    FROM cron.job;

DO $$
DECLARE v_cnt int;
BEGIN
  SELECT pg_catalog.count(*) INTO v_cnt FROM _lps_jobs_before;
  -- 🔴 少了這一格, 若 cron.job 是空的, before/after 會「兩邊都空 ⇒ 相等 ⇒ 全綠」——
  --    **一個【什麼都沒有】的比對, 與一個【什麼都沒變】的比對, 在輸出上是同一句話。**
  -- 🔴🔴 **codex R3-④:我原本在這裡 `RAISE EXCEPTION`** ——
  --    而**一個乾淨的、一支排程都還沒有的庫是合法的**(新環境 / 拋棄式 PG / 災後重建)
  --    ⇒ 那道閘會**拒絕一次正當的 apply**。
  --    🛑 而更糟的是:探針為了讓它過, **預植了一支 `pcm-someone-else`**
  --       ⇒ 📌 **那條「空 cron.job」的路在測試裡【固定是假綠】—— 它從來沒被走過。**
  -- ✅ 空的就明講「這一發比對沒有對象」, **不拒絕**;而下面事後⑤⑥ 照樣跑
  --    (空快照之下它們驗的是「我沒有憑空多冒出別的 job」, 那仍然有意義)。
  IF v_cnt < 1 THEN
    RAISE NOTICE '套用前 cron.job 是空的 ⇒ 下面的 before/after 比對【沒有對象】, 它證不到「別人的沒被動到」(因為沒有別人)';
  ELSE
    RAISE NOTICE '已快照 % 支既有 cron job(全部納入下面的逐欄比對保護)', v_cnt;
  END IF;
END $$;

DO $$
DECLARE v_id bigint;
BEGIN
  -- 🔵 `*/10` 的理由不是口味, 是**暴露窗**:本支沒跑之前, 那筆錢在帳本上不存在。
  --    而它**必須比 pcm-anomaly-alert(一天一次)密** —— 否則告警信會先報出一個
  --    本支本來就要補掉的東西 ⇒ 兩個機制對同一件事講不同的話, 客服不知道信哪一個。
  v_id := cron.schedule('pcm-late-payment-sweep', '*/10 * * * *',
    $job$SELECT pcm_cron.late_payment_pending_refund_sweep()$job$);
  -- by-name upsert 不會改 active ⇒ 顯式設(沿 20260820070000:60-61)。
  PERFORM cron.alter_job(job_id => v_id, active => true);
END $$;

-- ══ 3. fail-closed 事後斷言(任一異常 ⇒ 整檔 ROLLBACK)═══════════════════════
DO $$
DECLARE
  v_cnt int;
  v_txt text;
  -- 🔴 本檔可授權的物件, 具名列出(靜態閘會數它 vs 檔裡真的建了幾個)。
  v_functions text[] := ARRAY['pcm_cron.late_payment_pending_refund_sweep(integer)']::text[];
BEGIN
  -- 3a. 函式本身在, 而且**簽章對**(名字在對 CREATE OR REPLACE 零判別力)。
  IF pg_catalog.to_regprocedure('pcm_cron.late_payment_pending_refund_sweep(integer)') IS NULL THEN
    RAISE EXCEPTION '事後①:pcm_cron.late_payment_pending_refund_sweep(integer) 不存在';
  END IF;

  -- 3b. 🔴 **函式體要含那個判準字面** —— 有人把 NOT EXISTS 那段拿掉時, 3a 照樣綠。
  --    ⚠️ 射程:它證的是**字面在 prosrc 裡**, 不證它在真資料上篩對了;
  --       `strpos` 也擋不住有人加 `OR TRUE`;而它**只在本檔 apply 那一刻成立**。
  SELECT pg_catalog.pg_get_functiondef(p.oid) INTO v_txt
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.late_payment_pending_refund_sweep(integer)'::regprocedure;
  IF pg_catalog.strpos(v_txt, 'r.voided_at  IS NULL') = 0
     OR pg_catalog.strpos(v_txt, 'r.settled_at IS NULL') = 0 THEN
    RAISE EXCEPTION '事後②:函式體裡找不到那兩條未結清判準 ⇒ 它與部分唯一索引的謂語分家了';
  END IF;
  -- 🔵 變數名在 R1 折 F1/F2 時從 v_id 換成 r_row.order_id ⇒ 這個字面跟著改。
  --    📌 一個釘字面的斷言, 會在【重構】那一刻靜靜變成釘一個不存在的東西 —— 而它會紅, 那是對的。
  IF pg_catalog.strpos(v_txt, 'pcm_pending_refund_open_for(r_row.order_id, false)') = 0 THEN
    RAISE EXCEPTION '事後③:函式體沒有用 false 呼叫 open_for ⇒ 兜底會覆寫已開好的金額';
  END IF;
  -- 🔴 R1-F2:作廢跳過那一段是【主視窗裁的行為】⇒ 它要有一格釘著。
  IF pg_catalog.strpos(v_txt, 'WHERE v.order_id = o.id AND v.voided_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '事後③b:函式體沒有「有作廢列就整張跳過」那一段 ⇒ 被作廢的列會每 10 分鐘復活';
  END IF;
  -- 🔴 R1-F1:金額少那一族【只數不動】⇒ 也要有一格釘著, 否則有人順手改成覆寫。
  -- 🔴🔴 **R6:沒有任何一格殺得掉「把 WARNING 搬回統計趟之前」這個突變** ——
  --    字面斷言只釘變數名在不在, 而探針只讀 jsonb(它在更後面才組)⇒ 搬回去四道全綠。
  --    ⚠️ 而這條**已經復發過一次**(R4 提出、R5 抓到我宣稱修好而沒修)。
  -- ✅ 這一格比【位置】:統計趟的 INTO 必須排在那行 WARNING 之前。
  DECLARE
    v_into integer;
    v_warn integer;
  BEGIN
    v_into := pg_catalog.strpos(v_txt, 'INTO v_scanned, v_short, v_void');
    v_warn := pg_catalog.strpos(v_txt, '[late_payment_sweep] 掃過');
    IF v_into = 0 OR v_warn = 0 THEN
      RAISE EXCEPTION '事後③d:找不到統計趟或那行 WARNING 的字面 ⇒ 這一格量不到東西';
    END IF;
    IF v_into > v_warn THEN
      RAISE EXCEPTION '事後③d:WARNING 排在統計趟【之前】(INTO=%, WARNING=%) ⇒ v_short/v_void 會恆印 0', v_into, v_warn;
    END IF;
  END;

  IF pg_catalog.strpos(v_txt, 'INTO v_scanned, v_short, v_void') = 0 THEN
    RAISE EXCEPTION '事後③c:函式體沒有數「列在而金額少」那一格 ⇒ 那一族會變成完全靜默';
  END IF;
  -- 🔵 負對照:一個現造的字面必須【找不到】—— 沒有它, 上面幾格可能來自一把恆真的尺。
  -- 🛑🛑 **而 codex R3-⑤ 說得對:這個負對照【恆過】, 它證不到我真正想證的那件事。**
  --    `pg_get_functiondef` 回的是**含註解的整段函式體** ⇒ 上面那些 `strpos` 命中的
  --    **有可能是註解裡的字, 不是會執行的碼** —— 而這一格分不出來。
  --    ⇒ 📌 **我保留它(它擋得住「尺整個壞掉」), 而【它證不到的那一半明寫在這裡】。**
  --       真要分出來, 得先把註解剝掉再比 —— 那一格本檔沒做, 不是漏掉。
  IF pg_catalog.strpos(v_txt, 'zzz_never_in_this_function') <> 0 THEN
    RAISE EXCEPTION '負對照紅了:這把尺對任何字面都印命中 ⇒ 上面幾格不算數';
  END IF;

  -- 3c. job 逐格。
  SELECT pg_catalog.count(*) INTO v_cnt FROM cron.job
   WHERE jobname = 'pcm-late-payment-sweep' AND username = 'postgres' AND active
     AND database = pg_catalog.current_database() AND schedule = '*/10 * * * *'
     AND command = 'SELECT pcm_cron.late_payment_pending_refund_sweep()';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '事後④:pcm-late-payment-sweep job 不符(實 % 筆)', v_cnt;
  END IF;

  -- 3d. 🔴🔴 **我沒動到別人的排程** —— 逐欄比對快照。
  SELECT pg_catalog.count(*) INTO v_cnt
    FROM _lps_jobs_before b
    LEFT JOIN cron.job j
      ON j.jobid = b.jobid
     AND j.jobname = b.jobname AND j.schedule = b.schedule AND j.command = b.command
     AND j.nodename = b.nodename AND j.nodeport = b.nodeport
     AND j.database = b.database AND j.username = b.username AND j.active = b.active
   WHERE j.jobid IS NULL;
  IF v_cnt <> 0 THEN
    -- 🔵 R1-F13:訊息要說得出【是不是我自己那一支】—— 若 pcm-late-payment-sweep 先前
    --    被人手動 active=false, 重貼會讓它出現在這個差集裡, 而讀的人會去找一個不存在的第三方。
    RAISE EXCEPTION '事後⑤:有 % 支既有 cron job 與快照不符(若其中含 pcm-late-payment-sweep, 那是本檔自己重貼把它改回 active, 不是別人的被動到)', v_cnt;
  END IF;

  -- 3e. 🔴 而「別人的沒被改」與「沒有多冒出來別的」是兩個宣稱。
  SELECT pg_catalog.count(*) INTO v_cnt FROM cron.job j
   WHERE NOT EXISTS (SELECT 1 FROM _lps_jobs_before b WHERE b.jobid = j.jobid)
     AND j.jobname <> 'pcm-late-payment-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後⑥:本檔之外多出了 % 支 cron job', v_cnt;
  END IF;

  -- 3f. ACL:三個應用角色都不得叫得動它。
  --    🔴 清單寫成具名陣列(閘要數得到)—— **它防「忘記收權」, 不防「忘記列」**,
  --       所以列表本身要與上面的 REVOKE 對得起來。
  SELECT pg_catalog.count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(n)
   CROSS JOIN unnest(v_functions) AS f(sig)
   WHERE pg_catalog.has_function_privilege(r.n, f.sig::regprocedure, 'EXECUTE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後⑦:有 % 個應用角色叫得動這支排程函式', v_cnt;
  END IF;
END $$;

COMMIT;

-- ══ ROLLBACK ═══════════════════════════════════════════════════════════════
-- 回退腳本:`scripts/20260905180000-down.sql`(**已寫好而且跑過** —— 見探針格)。
-- 🛑 **資料不回滾** —— 本支可能已經開出一些 order_pending_refunds 列,
--    而**那些列本來就該存在** ⇒ 不要 DELETE;要作廢走既有的 voided_at。
-- 🔵 本支【不動】任何既有函式 ⇒ 沒有「還原上一版全文」那一步(與 070000 不同)。
