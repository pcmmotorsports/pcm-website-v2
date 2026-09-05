-- ══════════════════════════════════════════════════════════════════
-- M-4b · ⟦0a-CARDCANCELNOREFUND⟧ 片① · 人工退款登記:刷卡單要多一個確認
-- ══════════════════════════════════════════════════════════════════
-- 真權威:`docs/plans/2026-09-05-card-cancel-blocks-until-refunded-plan.md`(三輪審查:codex R1/R2 + opus R3)。
-- Sean 2026-09-05 逐字拍:
--   `Q-人工退款擋不擋刷卡單: 乙 = 不擋:保留「卡退失敗改匯回去」這條退路,
--    但登記時多勾一格「我確認卡上沒退」`
-- 鐵則 12①(錢)③(DB 結構)。⛔ **本檔不由施工窗 apply** —— apply 要 Sean 在場。
--
-- ── 為什麼要有這一片 ─────────────────────────────────────────────
-- 🔬 量到的(`20260905010000_…sql:293-315`):判「退完了沒」的加總 **不分軌**
--    `v_moved = SUM(order_refunds confirmed) + SUM(order_manual_refunds voided_at IS NULL)`
--    ⇒ 對一張**刷卡**單登記一筆 `rail='bank_transfer'`、金額 ≥ 總額的人工退款
--      ⇒ `payment_status` 變 `refunded`, **而錢還在 TapPay 那裡沒退**。
--    ⇒ 🔴 而 `payment_status` **只升不降**(`IF v_ps <> 'refunded'`)⇒ **變了就回不去**。
-- 🔬 閘擋在哪、沒擋在哪:`admin_record_manual_refund:330` 有擋 `p_rail='card'`,
--    **而它不擋「這張單是刷卡收的」**;UI 那道有擋, 而 `manual-refund-entry-gate.ts:42`
--    **逐字**「UI 這道的 rail 條件 **server 端沒有重驗**」⇒ **繞過 UI 就進得去**。
--
-- 🔵 **而 Sean 選的不是「擋死」** —— 他看見一條我沒看見的業務退路:**卡退失敗時, 錢要改用匯款退回去。**
--    📌 **一個從碼看起來純粹是漏洞的東西, 在生意上可能是唯一的退路。**
--
-- ── 🔴🔴 為什麼是 DROP + CREATE 而不是 CREATE OR REPLACE ──────────────
-- **加一個帶 DEFAULT 的參數, `CREATE OR REPLACE` 會產生【多載】而不是取代。**
-- 🔬 2026-09-05 本線在拋棄式 PG 17 實測過同型:函式數 1 ⇒ 2, 而舊引數數的呼叫拿到
--    `function ... is not unique` ⇒ **功能整個壞掉, 而 migration 自己 rc=0。**
-- 🛑 而 `DROP` 會**同時帶走 ACL 與 `COMMENT ON`** ⇒ 兩樣都在本檔明文貼回(見最後兩節)。
-- 🔬 ACL 是**唯讀量到的**(2026-09-05):`{postgres=X/postgres, service_role=X/postgres}`
--    ⇒ `service_role` 有 EXECUTE、`anon`/`authenticated` **沒有**。
--    ⚠️ **而 repo 裡 `git grep "GRANT EXECUTE ON FUNCTION public.admin_record_manual_refund"` = 0**
--       ⇒ 📌 **那個 GRANT 不在版控裡** —— 本檔把它明文寫下來, 這是順手把漂移收回來。
--
-- ── 函式本體怎麼來的 ────────────────────────────────────────────
-- 🔬 **程式抽出, 零手抄**:`20260823020000_…sql` 第 290-482 行原樣取出, 只做三處插入:
--    ① 參數列加第 8 參 ② `DECLARE` 加 `v_has_card` ③ 步 4(鎖單)之後插入步 4b 的閘。
--    **其餘逐字未動。**
--
-- ── Rollback ──────────────────────────────────────────────────
--   ✅ **可跑的版本在 `supabase/rollbacks/20260905280000-rollback.sql`**(不是散文, 是一支貼得下去的檔)。
--   骨:`DROP FUNCTION …(…,boolean);` ⇒ 原樣貼回 `20260823020000:290-482`(7 參)
--       ⇒ 重貼 REVOKE/GRANT 與 COMMENT(簽名換回 7 參)⇒ `NOTIFY pgrst`。
--   🛑 **而 migration history 不會知道你退過** —— 手動還原不同步歷史(codex nit)。
--   🛑 **而回滾之後, 已經登記進去的那些人工退款【不會消失】** —— 它們是資料不是碼。
--      📌 **回滾的單位是碼, 而傷害的單位是資料。**
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘:現行必須是【7 參且只有一支】 ═══════════════════════════════
DO $pre$
DECLARE v_n integer; v_args text; v_md5 text; v_secdef boolean; v_cfg text; v_owner text;
BEGIN
  SELECT count(*), string_agg(p.pronargs::text, ',') INTO v_n, v_args
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_record_manual_refund';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘失敗:admin_record_manual_refund 現在有 % 支(引數數 %)—— 期望剛好 1 支。本檔已套用過, 或有人建了多載。', v_n, v_args;
  END IF;
  IF v_args <> '7' THEN
    RAISE EXCEPTION '前置閘失敗:現行那支是 % 參, 期望 7 參 —— 基線對不上, 拒跑。', v_args;
  END IF;

  -- 🔴🔴 **只驗「一支、7 參」不夠**(codex 2026-09-05):同一個簽名底下的 body 可能已經被別人改過,
  --    而 `DROP` + `CREATE` 會**靜默地把那個改動蓋掉**。⇒ 釘住 body 指紋與三個屬性。
  SELECT pg_catalog.md5(p.prosrc), p.prosecdef, p.proconfig::text, p.proowner::regrole::text
    INTO v_md5, v_secdef, v_cfg, v_owner
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_record_manual_refund';
  -- 🔬 這個值是 2026-09-05 唯讀量到的正式庫現況。
  IF v_md5 <> 'd8758e811699d33b28fe0b59e360eca6' THEN
    RAISE EXCEPTION '前置閘失敗:現行 body 的 md5 是 %, 而本檔的基線是 d8758e81… ⇒ 有人改過它。'
                    '🛑 不要硬跑 —— DROP+CREATE 會把那個改動靜默蓋掉。先去看那支現在長什麼樣。', v_md5;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION '前置閘失敗:現行那支不是 SECURITY DEFINER ⇒ 基線對不上';
  END IF;
  IF v_cfg IS DISTINCT FROM '{"search_path=\"\""}' THEN
    RAISE EXCEPTION '前置閘失敗:search_path 設定是 %, 期望 search_path="" ⇒ 基線對不上', v_cfg;
  END IF;
  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION '前置閘失敗:owner 是 %, 期望 postgres ⇒ 基線對不上', v_owner;
  END IF;
END
$pre$;

-- ══ 1. DROP + CREATE ═════════════════════════════════════════════════
DROP FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz);

CREATE FUNCTION public.admin_record_manual_refund(
  p_order_id      uuid,
  p_request_id    uuid,
  p_actor         text,
  p_rail          text,
  p_refund_amount integer,
  p_reason        text,
  p_occurred_at   timestamptz,
  -- 🔴🔴 **第 8 參(2026-09-05 Sean 拍乙)** —— 「這張單卡上的錢我確認【沒有】退」。
  --    他逐字:「不擋:保留『卡退失敗改匯回去』這條退路, 但登記時多勾一格『我確認卡上沒退』」
  --    ⇒ 📌 **一個從碼看起來純粹是漏洞的東西, 在生意上是唯一的退路。**
  --    🔵 `DEFAULT false` 是相容用的:**非刷卡收款的單完全不受影響**, 舊的 7 引數呼叫照樣過。
  --    🛑 而它**不是**「預設安全」——【刷卡收款的單】在下面步 4b 會因為 false 被擋下。
  p_confirm_card_not_refunded boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order      record;
  v_existing   record;
  v_remaining  bigint;
  v_id         uuid;
  v_n          integer;
  v_has_card   boolean;
  -- 業務拒絕用單一通用訊息(不洩「這張單存不存在」);輸入類與政策類另給具體訊息。
  -- 🔴 **全檔只有步4 那一處 RAISE 用它**(W5 盲審 n-2 實查)——
  --   而下面的負測③ 正是靠這件事才分得出「紅在步4」與「紅在別處」。
  --   ⇒ 哪天有人讓第二道守門也用這個通用訊息,**負測③ 會失去判別力而不會有東西紅**。
  v_generic_msg constant text := 'admin_record_manual_refund: 退款登記失敗';
BEGIN
  -- 步1 隔離閘(同族慣例;RR 等鎖醒來會拿到舊快照)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(缺值各自具體訊息)
  IF p_order_id      IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 訂單識別碼缺失'; END IF;
  IF p_request_id    IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 冪等鍵 request_id 缺失'; END IF;
  IF p_rail          IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 退款管道缺失'; END IF;
  IF p_refund_amount IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 金額缺失'; END IF;
  IF p_occurred_at   IS NULL THEN RAISE EXCEPTION 'admin_record_manual_refund: 退款時點缺失'; END IF;

  -- 🔴 card 單獨給訊息:它不是「打錯字」,是走錯帳本(卡片退款走 order_refunds)
  IF p_rail = 'card' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: card 軌不得由人工登記(卡片退款走 order_refunds 與它自己的狀態機)';
  END IF;
  IF p_rail NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款管道 [%] 不是 bank_transfer 或 cash', p_rail;
  END IF;
  IF p_refund_amount <= 0 THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 金額必須為正整數(實得 %)', p_refund_amount;
  END IF;
  -- 🔴 btrim 顯式給字集 —— 預設字集只有一般空格,`E'\n\t'` 會穿過去
  --    (該表的 CHECK 自己就是這樣寫的,本 RPC 對齊它,不留一個比 DB 寬的入口)
  IF p_reason IS NULL OR pg_catalog.btrim(p_reason, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款原因不得為空白';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 經手人不得為空白';
  END IF;

  -- 步3 actor 必須是啟用中的 staff(FK 只擋不存在;停用的擋不到)
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    -- 🔴🔴 這則訊息**必須帶一句「不要換人重送」**(W5 盲審 R2 MF-1;失敗鏈我實測重現過):
    --   員工 A 登記後離職 ⇒ **逐位元相同的重送**撞在這裡 ⇒ 而訊息說的是「人的問題」
    --   ⇒ 操作者照訊息換成在職的 B 重送 ⇒ 過了本道、到步4.5 判「內容不同」
    --   ⇒ 而**那則訊息原本無條件地叫人「用新的 request_id」**
    --   ⇒ ⇒ **同一筆實際退款在帳本上變成兩列,可退餘額被重複扣 —— 錢錯了。**
    --   📌 兩則訊息各自都對,而**它們聯手把人導向登第二筆**。修在訊息、不在順序:
    --      actor 排在冪等格之前是 op5 的設計(擋守門序 oracle),移動它會重新打開那個洞。
    RAISE EXCEPTION 'admin_record_manual_refund: 經手人 [%] 不存在或已停用 ⇒ 拒絕登記退款。'
                    '🔴 現金退款的失敗模式是【人】,而 actor 是唯一的線索。'
                    '⚠️ **若這是一次重送:不要換人重送,也不要換 request_id** —— '
                    '那會讓同一筆退款在帳本上變成兩列。'
                    '🔴 **而你在後台如果找不到「查退款登記」的地方,那就是還沒有** ——'
                    '⇒ **找系統維護幫你確認,不要自己重送。**', p_actor;
  END IF;

  -- 步4 鎖單(第一觸表動作;與同族一致的鎖序)
  SELECT id, created_at INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 🔴🔴 **步4b 必須在這一行【之後】** —— codex 2026-09-05 抓到, 我核了它對:
  --    `SELECT EXISTS(...) INTO v_has_card` **一定會回一列** ⇒ 它把 `FOUND` 設成 true
  --    ⇒ 上面那道「查無訂單」的閘**永遠不發火**, 不存在的單會一路走到步5。
  --    📌 **`SELECT ... INTO` 與它下面那句 `IF NOT FOUND` 是【一對】, 中間不可以插任何一句 SQL。**
  --    ⇒ 這與終端機紀律那條「`$?` 每一個指令都會覆寫」是**同一個形狀**, 換了一種語言。

  -- ══ 步4b 刷卡單的確認閘(2026-09-05 Sean 拍乙 · ⟦0a-CARDCANCELNOREFUND⟧)══════════
  -- 🔴 **判準讀 `order_payments.rail`, 不讀 `orders.payment_channel`, 也不讀 `orders.payment_method`。**
  --    理由不是風格:那是**三個不同的軸**, 而 `packages/domain/src/order/types.ts:1817-1822`
  --    逐字寫著「**兩個軸混用會出錯**」。本閘與 `admin_cancel_order` 的述詞
  --    (`20260903093000:421-429`)**刻意讀同一欄** —— 兩道閘看同一件事就不會分岔。
  -- 🔴 **鎖單之後才讀**(步4 已 `FOR UPDATE`):在鎖之前讀 `order_payments`,
  --    並行插入一筆 card 收款會讓「不是刷卡單」在下一瞬間變成假的。
  SELECT EXISTS (
    SELECT 1 FROM public.order_payments op
     WHERE op.order_id = p_order_id AND op.rail = 'card'
  ) INTO v_has_card;

  IF v_has_card AND p_confirm_card_not_refunded IS DISTINCT FROM true THEN
    -- 🛑 **這則訊息要講【他該做什麼】, 不是講一個內部狀態。**
    --    而它**刻意不是**通用訊息 —— 通用訊息會讓員工以為系統壞了, 而這裡他有一個明確的下一步。
    RAISE EXCEPTION 'admin_record_manual_refund: 這張單是刷卡收的。'
                    '要用匯款/現金把錢退回去之前, 請先確認【卡上那筆沒有退成功】—— '
                    '在登記畫面把「我確認卡上沒退」那一格勾起來再送一次。'
                    '🔴 若卡上其實已經退成功了, 不要在這裡登記 —— 那會變成退兩次。'
                    '⚠️ 若畫面上【還沒有】那一格:這個功能剛上, 前端還沒跟上 ⇒ 請聯絡工程, 不要繞路。';
  END IF;
  -- 🛑 **這道閘【不擋】刷卡單用匯款退** —— 它只要求那個確認。
  --    ⇒ 📌 若哪天有人想把它改成「一律擋」, 那是**推翻 Sean 2026-09-05 的乙**, 要他重新拍。
  -- ══════════════════════════════════════════════════════════════════════════════

  -- 🔴 occurred_at 兩道(W5 盲審 n-2:它原本是唯一沒被守的入參,而本 RPC 是唯一守門點
  --    ⇒ 遺漏是永久的)
  IF p_occurred_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款時點不得晚於現在(退款時點=%,現在=%)',
                    p_occurred_at, pg_catalog.now();
  END IF;
  IF p_occurred_at < v_order.created_at THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款時點早於訂單成立(退款時點=%,下限=%)',
                    p_occurred_at, v_order.created_at;
  END IF;

  -- 步4.5 🔴🔴 冪等格 —— **必須在額度守門【之前】**,而且要**逐欄比對**
  --   兩個缺陷都是實測出來的(拋棄式 PG 17.10,2026-08-20),不是推的:
  --   ① 原本只有 `EXCEPTION WHEN unique_violation` 而**零比對** ⇒
  --      同鍵送 (100) 再送 (50) ⇒ 第二發回 `{recorded:true, idempotent:true}`,
  --      **而帳本裡是 100** ⇒ 呼叫端相信 50 已登記。rail 換成 bank_transfer 也一樣穿過去。
  --      🔴 而 `pcm_order_refundable_remaining` 是減帳本算的 ⇒ 那個差額會靜靜留在「還可退」裡
  --        ⇒ **帳面上我們還欠客人,而系統認為已經登記過了。沒有東西會紅。**
  --   ② 冪等若排在額度守門【之後】,**完全相同的重試會被誤擋**:
  --      total 500、第一發退 500 ⇒ 剩餘 0 ⇒ 相同重試撞「超過可退餘額 0」
  --      ⇒ 實測訊息逐字如此 —— **一個誤導的訊息:它說錢不夠,而其實是同一次請求。**
  --   ⇒ 形狀照 op5(它的 COMMENT 逐字:「G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回
  --     idempotent(NULL-safe)」),而它的 unique_violation handler 自標「**backstop,不是主要路徑**」。
  SELECT r.id, r.rail, r.refund_amount, r.reason, r.actor, r.occurred_at
    INTO v_existing
    FROM public.order_manual_refunds r
   WHERE r.order_id = p_order_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.rail          IS NOT DISTINCT FROM p_rail
       AND v_existing.refund_amount IS NOT DISTINCT FROM p_refund_amount
       AND v_existing.reason     IS NOT DISTINCT FROM pg_catalog.btrim(p_reason, E' \t\r\n')
       AND v_existing.actor      IS NOT DISTINCT FROM pg_catalog.btrim(p_actor,  E' \t\r\n')
       AND v_existing.occurred_at IS NOT DISTINCT FROM p_occurred_at THEN
      RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', true, 'refund_id', v_existing.id);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**,而且要讓呼叫端分得出來這不是「錢不夠」也不是「重送」
    RAISE EXCEPTION 'admin_record_manual_refund: 同一個 request_id 帶了不同的內容 ⇒ 拒絕。'
                    '🔴 這不是重送,也不是額度問題:帳本裡那一筆與這次送來的至少有一欄不同'
                    '(rail / 金額 / 原因 / 經手人 / 退款時點)。'
                    '⚠️ **先確認這是不是同一筆錢**:'
                    '若你是在重送同一筆(例如原經手人已停用而你換了人)⇒ **不要用新的 request_id**,'
                    '那會讓同一筆退款在帳本上變成兩列、可退餘額被重複扣。'
                    '🔴 **判準寫在這裡,不要靠感覺**:問「**這張單實際退回去給客人的錢,發生過幾次?**」'
                    '——一次 ⇒ 這是同一筆(即使不是你經手的),用**原本的** request_id;'
                    '兩次(兩筆不同的錢都退出去了)⇒ 才是另一筆,才用新的 request_id。'
                    '⚠️ 主詞是**那筆錢**,不是**你** —— 接手的人自己沒退過,但那筆錢已經退過了。'
                    '⚠️ 而**目前沒有「沖銷」入口**(那是另一片,還沒做)⇒ '
                    '要更正既有那筆,**找系統維護**,不要用新的 request_id 補一筆。';
  END IF;

  -- 步5 🔴🔴 額度守門 —— **IS NULL 必須單獨分流**
  --   pcm_order_refundable_remaining 是 LANGUAGE sql + `WHERE o.id = p_order_id`
  --   ⇒ 訂單不存在 ⇒ 無列 ⇒ **回 NULL**。
  --   實測(拋棄式 PG 17.10,2026-08-20):`IF 999999 > NULL THEN RAISE` ⇒ **守門沒有開火 ⇒ 放行**。
  --   而穿過去之後**沒有第二道**(該表零 trigger、CHECK 只有 > 0、無上界)⇒ 那一發會真的寫進去。
  --   ⇒ 兩種成因**分開訊息**:它們的下一步完全不同。
  --   🔴🔴 **而這一道今天【不可達】,我用突變測出來的,不是推的**:
  --     步4 的 `IF NOT FOUND THEN RAISE` 已經先把「查無此單」擋掉了(實測:拿掉本分流之後
  --     用不存在的 order_id 呼叫,紅在步4 的通用訊息、不是這裡)。
  --   ⇒ 所以本分流是**縱深,而它沒有可構造的負測** —— 依本 repo 的紀律
  --     (`feedback_unconstructible-negative-test-means-noop-guard`:沒有測試證得了的縱深
  --      不是縱深,是一句宣稱),我把話講白而不是留一句好聽的:
  --     **下面的負測③ 測的是步4,不是這一道。突變拿掉這一道,負測不會紅 —— 那是預期的。**
  --   ⇒ **什麼會讓它變成活的**:任何人把步4 的 FOR UPDATE 查詢或它的 NOT FOUND 分支挪走/放寬。
  --     那時這一道就是最後一道,而 `999999 > NULL` 不為 true(拋棄式 PG 17.10 實測)⇒ 靜靜放行。
  v_remaining := public.pcm_order_refundable_remaining(p_order_id);
  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 算不出可退餘額(查無此單或帳本讀不到)⇒ fail-closed 拒絕。'
                    '🔴 這與「額度不足」不同:那是金額問題,這是**看不到帳本**';
  END IF;
  IF p_refund_amount > v_remaining THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款金額 % 超過可退餘額 %(帳本未登記額)',
                    p_refund_amount, v_remaining;
  END IF;

  -- 步6 寫入(冪等由 UNIQUE (order_id, request_id) 保證;撞鍵 = 同一次互動被重送)
  BEGIN
    INSERT INTO public.order_manual_refunds
      (order_id, request_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES
      (p_order_id, p_request_id, p_rail, p_refund_amount,
       pg_catalog.btrim(p_reason, E' \t\r\n'), pg_catalog.btrim(p_actor, E' \t\r\n'), p_occurred_at)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- 🔴 **這條 handler 是 backstop,不是主要路徑**(逐字沿用 op5 對它的定位)。
    --   主要路徑是上面的步4.5 冪等格。走到這裡只有一種情況:**兩發並行**,
    --   兩發都在步4.5 查無、然後其中一發先寫進去。
    --   ⇒ 這時**不能回 idempotent** —— 我們沒有比對過對方寫了什麼。**拒絕,讓呼叫端重試一次**,
    --     重試時步4.5 就看得到那一列、也就會逐欄比對。
    RAISE EXCEPTION 'admin_record_manual_refund: 同一個 request_id 正在被並行寫入 ⇒ 拒絕本次,請重試。'
                    '(重試時會走冪等格逐欄比對;這條路徑不回 idempotent,因為它沒有比對過對方寫了什麼)';
  END;

  -- 落帳筆數守(trigger 抑制單列 ⇒ 靜默漏寫;本表零 trigger,而這道是給未來的人)
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 落帳 % 列(期望恰 1)⇒ 退款帳本沒收到這筆', v_n;
  END IF;

  -- 片2a:接上退款方向的唯一寫入端(20260823010000 建的 helper)。
  -- 位置刻意在【本函式自己的 DML 完成之後】、以獨立語句呼叫(plan v7 §4-b 鎖定的順序)。
  -- 🔴 今天它是 no-op:helper 的算式只計 order_refunds 的 confirmed 列,而本函式寫的是
  --    order_manual_refunds ⇒ v_moved 不變 ⇒ helper 的早退或單調閘擋住寫入。
  --    片3 換算式之後,這一行才會真的讓畫面翻。**它現在就要在,是為了片3 不必再回來改三支 RPC。**
  -- 🔴 鎖序:本函式步4 已對 orders 取 FOR UPDATE(同族慣例、orders 先)⇒ helper 內再取
  --    FOR NO KEY UPDATE 是同交易重複鎖 = no-op,不新增鎖序風險。
  --    ⚠️ 另兩支(admin_void_manual_refund / admin_correct_order_refund_verdict)**沒有這個前提**
  --       —— 它們先鎖子表 ⇒ 直接照抄本行會形成反向鎖序。見片2b 的增補,**不要照抄**。
  PERFORM public.pcm_sync_order_refund_payment_status(p_order_id);

  RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', false, 'refund_id', v_id);
END;
$fn$;

-- ══ 2. ACL 明文貼回(DROP 帶走了)═══════════════════════════════════════
-- 🔴 兩道 REVOKE 都要:`FROM PUBLIC` 與 `FROM anon, authenticated, ...` 各擋一半
--    (新函式出生就自帶 PUBLIC 的 EXECUTE;而 ACL 欄是 NULL 時 `has_function_privilege` 看不出來)。
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz, boolean) FROM anon, authenticated, authenticator, service_role;
-- 🔬 而這一行是**照唯讀量到的現況**貼回(`service_role=X/postgres`), 不是我決定的。
GRANT EXECUTE ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz, boolean) TO service_role;

-- ══ 3. COMMENT 貼回(DROP 也帶走了)═════════════════════════════════════
COMMENT ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz, boolean) IS
  'M-4b E10 D1:非卡退款【登記】(SECURITY DEFINER、search_path=''''、鏡像 op5/opa12 形狀)。'
  '記的是【一件已經發生的事】—— 錢是人交回去的,系統沒有動作可做(該表 COMMENT 逐字)。'
  '🔴 **本 RPC 是那些守門唯一的存在位置**:該表零 trigger、CHECK 只有 refund_amount > 0 且**無上界**'
  '(A7c 拍板⑤:DB 不做防超退)⇒ 額度守門 / rail 值域 / actor 啟用 / occurred_at 兩道,'
  'DB 沒有第二道會接住。改本函式時,拿掉任何一道都不會有東西紅。'
  '🔴 額度守門對 `pcm_order_refundable_remaining` 回 NULL(查無此單)**單獨分流** —— '
  '實測(拋棄式 PG 17.10,2026-08-20):`999999 > NULL` 不為 true ⇒ 不分流就是靜靜放行。'
  '🔴 冪等:UNIQUE (order_id, request_id);撞鍵回既有那筆、不多寫一列。'
  '**射程**:它擋的是【同一次互動被重送】,**不擋**【同一筆錢被人用不同 request_id 登兩次】——'
  '後者靠對帳,與 op5 的限定相同。**不要把它讀成防重複入帳。**'
  '⛔ ~~本片**零 GRANT**(分期開權):EXECUTE 由 D2 與沖銷 RPC 一起開。在那之前正式路徑呼不到~~ '
  '🔴 **2026-09-05 訂正:那兩句今天已經是假的。** 唯讀量到正式庫 ACL = {postgres=X/postgres, service_role=X/postgres} '
  '⇒ `service_role` 早就叫得動它, 而那個 GRANT **不在版控裡**(`git grep` = 0)。本檔把它明文貼回來。'
  'rail 不含 card(卡片退款走 order_refunds)。回 {recorded, idempotent, refund_id}。

🔴 2026-09-05 第 8 參 p_confirm_card_not_refunded(Sean 拍乙):刷卡收款的單要用匯款/現金退, 必須明確確認【卡上那筆沒退成功】。不擋這條路 —— 那是卡退失敗時唯一的退路。';


-- ══ 3b. 收權斷言(canonical 形狀;`migration-new-file-static-checks` 規則③ 認的就是這個清單)══
-- 🛑 **這個清單防的是「忘記收權」, 不防「忘記列」** —— 它只檢查我列出來的物件。
DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz, boolean)'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE(兩道 REVOKE 少了一道?)', r;
    END IF;
    -- 🔴 反面也要問:一個「誰都沒有權限」的世界會讓上一道通過, 而後台登記退款一樣壞(42501)。
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 service_role 沒有 EXECUTE —— DROP 帶走的 ACL 沒補回來', r;
    END IF;
  END LOOP;
END
$grant_assert$;

-- ══ 4. 事後斷言 ═══════════════════════════════════════════════════════
DO $post$
DECLARE
  v_oid oid;
  v_n   integer;
BEGIN
  -- ① 只有一支, 而且是 8 參(擋住「不小心變成多載」)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_record_manual_refund';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '斷言①失敗:現在有 % 支 admin_record_manual_refund —— 多載會讓舊呼叫端拿 is not unique', v_n;
  END IF;

  v_oid := pg_catalog.to_regprocedure('public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz,boolean)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '斷言②失敗:8 參那支不存在';
  END IF;

  -- ③ ACL:service_role 要叫得動, anon/authenticated 不可以
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:service_role 叫不動它 ⇒ 後台登記人工退款會拿 42501';
  END IF;
  -- 🔴 **逐個角色問「有沒有」會漏掉【我沒想到的那個角色】**(codex 2026-09-05)
  --    ⇒ 改成**釘住完整的 ACL 字面**:誰在裡面、誰不在, 一次答完。
  --    📌 黑名單在跟下一個沒想到的角色賽跑;白名單不需要知道它們叫什麼。
  DECLARE v_acl text; v_owner text;
  BEGIN
    SELECT p.proacl::text, p.proowner::regrole::text INTO v_acl, v_owner
      FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION '斷言④失敗:ACL 是 %, 期望 {postgres=X/postgres,service_role=X/postgres} —— 多一個角色或少一個都要停下來看', v_acl;
    END IF;
    IF v_owner <> 'postgres' THEN
      RAISE EXCEPTION '斷言④b 失敗:owner 是 %, 期望 postgres', v_owner;
    END IF;
  END;

  -- ⑤ COMMENT 要在(DROP 帶走了, 沒貼回來的話這裡會紅)
  IF pg_catalog.obj_description(v_oid, 'pg_proc') IS NULL THEN
    RAISE EXCEPTION '斷言⑤失敗:COMMENT 不見了';
  END IF;

  -- ⑥ 🔴 新參數真的在簽名裡(而不是我只改了註解)
  IF pg_catalog.pg_get_function_identity_arguments(v_oid) NOT LIKE '%p_confirm_card_not_refunded%' THEN
    RAISE EXCEPTION '斷言⑥失敗:簽名裡沒有 p_confirm_card_not_refunded';
  END IF;
END
$post$;

-- 🛑 **上面五道斷言【證不到】那道閘會不會真的擋** —— 它們看的是 catalog 的形狀。
--    要證明它擋, 得真的呼叫一次;而那要 service_role 身分 ⇒ 貼後對帳另檔。
--    📌 **「rc=0 五道全過」與「它擋得住」是兩個宣稱。**

-- 🔴 簽名變了 ⇒ PostgREST 的 schema cache 要重載, 否則 TS 那側會拿 PGRST202。
NOTIFY pgrst, 'reload schema';

COMMIT;
