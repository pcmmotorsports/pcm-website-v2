-- ⟦b4-CARDALREADYREFUNDED⟧ 回滾:把 `admin_record_manual_refund` 換回 `20260909090000` 之前那一版。
--
-- ⚠️ **回滾之後那句錯的話會回來** —— 混合單(卡那半已退成功)的員工又會看到
--    「若卡上其實已經退成功了, 不要在這裡登記」,而那句話對他是錯的。
--    📌 **那正是 `20260909090000` 在修的事,不是副作用。**
-- 🔵 不改表結構、不改資料:本支只換函式本體,不碰任何一列。
-- 🛑 `v_has_card` 那道述詞在正向與反向都一字未動。
-- 🔴 簽章/回傳型別/`search_path` 逐字照唯讀實查(codex R1 MF② ③ 修正後)。

BEGIN;

DO $pre$
DECLARE v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_record_manual_refund';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:那支函式不在 ⇒ 停';
  END IF;
  -- 只在「現行 = 20260909090000 貼進去的那一版」時才回滾;別人又改過 ⇒ 停。
  IF v_md5 <> '3296b5583dae2b78e796620fa2929634' THEN
    RAISE EXCEPTION '回滾前置閘:現行 body md5 = % ⇒ 不是 20260909090000 那一版(要 3296b558…)⇒ 停, 不要蓋掉別人的東西', v_md5;
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_record_manual_refund(
  p_order_id uuid,
  p_request_id uuid,
  p_actor text,
  p_rail text,
  p_refund_amount integer,
  p_reason text,
  p_occurred_at timestamp with time zone,
  -- 🔴 **`DEFAULT false` 不可省** —— 移除既有參數預設值 `CREATE OR REPLACE` 會直接失敗。
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

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_record_manual_refund';
  IF v_md5 <> 'dcfec0257b4f3efcadfdab94df20b504' THEN
    RAISE EXCEPTION '回滾對帳:回完的 md5 = % ⇒ 不是舊那一版(要 dcfec025…)', v_md5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='admin_record_manual_refund'
                    AND p.prosecdef IS TRUE
                    AND pg_catalog.array_to_string(p.proconfig, ',') = 'search_path=""') THEN
    RAISE EXCEPTION '回滾對帳:SECDEF 或 search_path 被洗掉了';
  END IF;
  RAISE NOTICE '✅ 已回滾到 20260909090000 之前那一版(md5 %)', v_md5;
END
$post$;

COMMIT;
