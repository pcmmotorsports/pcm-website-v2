-- 20260912040000_m4b_manrefundnoaudit_rpc_writes_audit.sql
-- ⟦b4-MANREFUNDNOAUDIT⟧ 人工退款登記 / 作廢 ⇒ **同一筆交易寫 admin_audit_log**,並回填既有 2 筆。
-- plan `docs/plans/2026-09-12-manrefundnoaudit-plan.md`(Sean 2026-09-12 批准實作;回填那題他答【甲 補】)。
-- pcm:idempotent: yes
--   理由:兩支都是 CREATE OR REPLACE(冪等);回填那段是 INSERT … WHERE NOT EXISTS(重跑不會加倍)。
--
-- ── 為什麼不是改 helper(板列原本寫的那個落點)──────────────────────────────
--   `pcm_sync_order_refund_payment_status(uuid)` **沒有 actor 參數**,而它被兩支不同的 RPC 呼叫
--   ⇒ 要它寫稽核就得改簽章 ⇒ 兩個呼叫端與所有既有代一起動。
--   ✅ 改在【兩支收得到 actor 的 RPC】裡:它們本來就知道「誰」。
--   🛑 代價明寫:任何**繞過那兩支、直接呼 helper** 的路徑仍然零稽核(今天 repo 內沒有那種呼叫端)。
--
-- ── 本支動什麼 ──────────────────────────────────────────────────────────────
--   ① admin_record_manual_refund(8 參)body:鎖單那一讀多取 payment_status(同一列同一把鎖)
--      + 落帳成功之後同交易寫一列 order_refund.manual_record + 筆數守
--   ② admin_void_manual_refund(3 參)body:作廢成功之後同交易寫一列 order_refund.manual_void + 筆數守
--   ③ 回填既有 2 筆(見檔尾;來源是 order_manual_refunds 自己的 actor / request_id,不是我們編的)
--   🛑 **簽章一個字都沒改** —— 改簽章會長出第二支多載而舊那支還活著(⟦db-SAMETRIGGERNAME⟧ 那一族)。
--   🛑 **SET search_path = '' 逐字抄回**(CREATE OR REPLACE 會把 SET 子句整組換掉;
--      memory `reference_create-or-replace-resets-set-clause`)。
--   🔵 EXECUTE / ACL **不動**:本支零 GRANT 零 REVOKE。
--
-- 🔴 本支碰到 `manual_failed` 那個共用邊界。兩支的判準必須【並排讀一次】:
--    · pcm_order_refundable_remaining          ⇒ corrected_to = 'money_moved' 才扣
--    · pcm_order_pending_manual_verdict_amount ⇒ v.refund_id IS NULL 才算
--    🛑 只改一邊 ⇒ 另一邊不會紅, 而畫面會雙重計算或漏算。板列 ⟦b9-REFUNDNUM1⟧。
--    🔵 **而本支【兩支都沒有改】** —— 它們只出現在我照抄回來的 body 裡(`pcm_order_refundable_remaining`
--      是 record 那支本來就在呼叫的),本支只在那之後多插一段 `INSERT admin_audit_log`。
--      ⇒ 這一句是閘要求的配對宣告, 同時也是給下一個人的界線:**要動那個邊界不是在這一支。**
--
-- ── 前置閘 ──────────────────────────────────────────────────────────────────
-- ── ROLLBACK ═══════════════════════════════════════════════════════════════
--   `supabase/rollbacks/20260912040000-rollback.sql`(內含兩支的完整 body,不寫「去某檔複製」)。
--   ⚠️ 回退之後**已經寫下的稽核列不會消失**(append-only)⇒ 那是對的,不要清它。

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.admin_audit_log';
  END IF;
  IF pg_catalog.to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.order_manual_refunds';
  END IF;
  -- 🔴 兩支都必須【已經存在】—— 本支是 REPLACE 不是 CREATE;不存在就代表我貼錯庫或順序反了。
  IF pg_catalog.to_regprocedure(
       'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamp with time zone,boolean)') IS NULL THEN
    RAISE EXCEPTION '前置閘③:admin_record_manual_refund 那支 8 參多載不存在 ⇒ 停下,不要盲改';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_void_manual_refund(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘④:admin_void_manual_refund(uuid,text,text) 不存在 ⇒ 停下';
  END IF;
  -- 🔴 稽核表的 request_id 是 NOT NULL + CHECK(<> ''):下面兩處各自帶值,而這裡先證那道約束還在
  --    ⇒ 哪天它被放寬, 讀這支的人要知道我們的值是為了它而造的。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.admin_audit_log'::regclass
                    AND conname = 'admin_audit_log_request_id_nonempty') THEN
    RAISE EXCEPTION '前置閘⑤:admin_audit_log_request_id_nonempty 不見了 ⇒ 本支對 request_id 的假設要重讀';
  END IF;
END $$;

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
-- 🔴 **必須自己帶** —— `CREATE OR REPLACE` 會把 SET 子句整組換掉(見前置閘④)。
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
  SELECT id, created_at, payment_status INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  -- 🔴 ⟦b4-MANREFUNDNOAUDIT⟧ 2026-09-12:多取 `payment_status` 是為了稽核的 `before` ——
  --    同一列、同一把 FOR UPDATE, **不新增任何讀取或鎖**。

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
    RAISE EXCEPTION 'admin_record_manual_refund: 這張單有刷卡收款。'
                    '要用匯款/現金把錢退回去之前, 請先去 TapPay 後台確認卡上那筆的狀態 —— '
                    '在登記畫面把「卡上那筆的狀態我確認過了」那一格勾起來再送一次。'
                    '🔴 卡上那筆【已經退成功】的話:卡那半不要在這裡登記(會變成退兩次), '
                    '而現金/匯款那半仍然要登記, 這一格照樣勾。'
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

  -- 🔴🔴 ⟦b4-MANREFUNDNOAUDIT⟧(2026-09-12,Sean 批准):**稽核與落帳同一筆交易。**
  --    在此之前本函式收得到 `p_actor` 而**一個字都沒寫進 `admin_audit_log`**
  --    ⇒ 「誰把這張單改成已退款」只查得到 `order_manual_refunds.actor`,
  --      而**後台〈稽核紀錄〉那一頁看不到這件事發生過**。
  --    🔵 `after` 刻意**不寫 payment_status** —— 這一刻它還沒變(翻狀態的是下面那支 helper)⇒
  --      寫進去會是一個「我預期它會變成什麼」的值,那正是本 repo 一再抓的「把期望值寫成觀察值」。
  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (pg_catalog.btrim(p_actor, E' \t\r\n'),
     'order_refund.manual_record',
     'order:' || p_order_id::text,
     p_request_id::text,
     pg_catalog.jsonb_build_object('payment_status', v_order.payment_status),
     pg_catalog.jsonb_build_object('manual_refund_id', v_id, 'rail', p_rail,
                                   'amount', p_refund_amount, 'occurred_at', p_occurred_at),
     pg_catalog.btrim(p_reason, E' \t\r\n'),
     'admin');
  -- 稽核筆數守(照 `20260908060000:730-734` 既有形狀):零稽核的成功登記 = 本列要防的那件事
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 稽核落 % 列(期望恰 1)⇒ 錢的紀錄與【誰做的】必須同生共死', v_n;
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

CREATE OR REPLACE FUNCTION public.admin_void_manual_refund(
  p_refund_id   uuid,
  p_void_reason text,
  p_actor       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''   -- 🔴 片③ 對齊正式庫(M1a/M1b 已收緊;repo 那支舊檔還寫著 public, pg_temp)
AS $fn$

DECLARE
  v_ws     CONSTANT text := E' \t\r\n';
  v_reason text;
  v_actor  text;
  v_row    public.order_manual_refunds%ROWTYPE;
  v_hit    integer;
  v_oid    uuid;    -- 片③:鎖序用的路由鍵(無鎖預讀)
BEGIN
  -- 步 1. 參數形狀。btrim 顯式給字集(理由同建表 20260820010000:170:預設字集只有一般空格)。
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 缺 refund_id ⇒ 不知道要作廢哪一筆';
  END IF;
  v_reason := pg_catalog.btrim(coalesce(p_void_reason, ''), v_ws);
  v_actor  := pg_catalog.btrim(coalesce(p_actor,  ''), v_ws);
  -- 🔴 用 pcm_b2_is_blank 不用 `<> ''`:它多擋 NBSP 與全形空格(20260805170000:56-68)。
  --    而配對 CHECK 也用它 ⇒ 這裡先擋,是為了給人話,不是為了防漏(DB 那道才是防漏)。
  IF public.pcm_b2_is_blank(v_reason) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 作廢理由不能是空白。'
                    '🔴 這一欄是「為什麼當初記錯了」的唯一紀錄 —— 沒有它,作廢與誤刪事後看起來一模一樣';
  END IF;
  IF public.pcm_b2_is_blank(v_actor) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 缺經手人 ⇒ 現金退款的失敗模式是【人】,這一欄不是裝飾';
  END IF;
  -- 🔴🔴 **比照 D1 驗 active staff**(codex R1 must-fix:舊版只擋空白 ⇒ actor 可由呼叫端隨便填)。
  --    形狀逐字同 D1(`20260820021000:199`)。
  -- ⇒ **而這一道是本 RPC「不需要 request_id」那個裁定的【前提】**:
  --    主視窗 2026-08-20 裁定拿掉 request_id,理由是「不同的人 = 不同的 payload ⇒ 會 RAISE」——
  --    🔴 **而那個推論只有在 actor 不能被冒填時才成立。** 沒有這一道,那句話只是呼叫端的自律。
  --    ⇒ **拿掉這一道 = 推翻那個裁定的前提,不是省一道檢查。**
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 經手人「%」不是啟用中的 staff ⇒ 拒絕。'
                    '🔴 這一道同時是「本 RPC 不需要冪等鍵」那個設計的前提', v_actor;
  END IF;

  -- 步 2. 鎖住那一列再讀。**那一列自己就是鎖** —— 這也是本 RPC 不需要冪等鍵的原因。
  -- 🔴🔴 **片③ 鎖序三步** —— 本函式原本**先鎖子表**, 而 `admin_record_manual_refund`
  --    先鎖 `orders` ⇒ 兩者相反 ⇒ 接上同步器(它會鎖 `orders`)之後就成環 ⇒ 40P01。
  --    ⛔ ~~「先鎖 orders」~~ **那句話不可施工** —— `order_id` 在子列裡, 要先讀子列才知道鎖哪張單。
  --    ✅ 可施工的形狀 = 無鎖預讀路由鍵 → 鎖 orders → 鎖後重讀子列 → 兩次不一致就叫。
  SELECT m.order_id INTO v_oid FROM public.order_manual_refunds m WHERE m.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 找不到退款 %', p_refund_id;
  END IF;
  PERFORM 1 FROM public.orders o WHERE o.id = v_oid FOR NO KEY UPDATE;

  SELECT * INTO v_row FROM public.order_manual_refunds WHERE id = p_refund_id FOR UPDATE;
  -- 🔴 兩次讀值不一致 ⇒ 有人把這筆退款搬到別張單上 ——
  --    **那不是併發, 那是資料異常** ⇒ RAISE, 不要自己修正、也不要重試
  --    (重試只會讓它安靜地成功)。
  -- 🔵 關卡2 nit:加 `FOUND` —— 子列在兩次讀取之間【消失】時, `v_row` 全是 NULL,
  --    而那會被誤報成「order_id 漂移」。真正的「查無」由下面既有那道 IF NOT FOUND 負責。
  IF FOUND AND v_row.order_id IS DISTINCT FROM v_oid THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 退款 % 的 order_id 在鎖前後不一致(% ⇒ %)⇒ 資料異常, 停下', p_refund_id, v_oid, v_row.order_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 找不到退款登記 % ⇒ 它不存在,或已被實體刪除', p_refund_id;
  END IF;

  -- 步 3. 已經作廢過了?
  IF v_row.voided_at IS NOT NULL THEN
    IF v_row.void_reason IS NOT DISTINCT FROM v_reason
       AND v_row.voided_by IS NOT DISTINCT FROM v_actor THEN
      -- 同一人、同一理由 ⇒ 就是同一個操作。
      -- 🔴🔴 **片③(關卡2 R1 must-fix):冪等重放這條路【也要同步】。**
      --    這一版之前作廢過的單, 當時沒有人去改 payment_status ⇒ 它卡在 refunded。
      --    ⇒ 📌 **重放時若直接 RETURN, 那些單【永遠】不會被帶回正軌** —— 而重放正是唯一還會碰到它們的動作。
      PERFORM public.pcm_sync_order_refund_payment_status(v_row.order_id);
      RETURN pg_catalog.jsonb_build_object(
        'voided', true, 'idempotent', true, 'refund_id', v_row.id);
    END IF;
    -- 🔴 訊息要寫出**現況**,不是只寫「衝突」——
    --    看到這句話的是員工,他要的是「已經有人做過了、是誰、什麼時候、理由是什麼」,不是錯誤碼。
    RAISE EXCEPTION 'admin_void_manual_refund: 這筆退款已於 % 由「%」以理由「%」作廢。'
                    '你這次送的是經手人「%」、理由「%」⇒ 兩者不同,本 RPC 不覆蓋既有的作廢紀錄。'
                    '⇒ 若你認為既有那筆記錯了,那是另一件事(要改作廢紀錄本身),本 RPC 做不到',
                    v_row.voided_at, v_row.voided_by, v_row.void_reason, v_actor, v_reason;
  END IF;

  -- 步 4. 寫入。`AND voided_at IS NULL` 是防 TOCTOU 的那一半 ——
  --   🔴 **對照組實測**:拿掉它,兩個併發 session 的第二發會 `UPDATE 1` 蓋掉第一發(W1-085 附錄世界③)。
  UPDATE public.order_manual_refunds
     SET voided_at   = now(),
         void_reason = v_reason,
         voided_by   = v_actor
   WHERE id = p_refund_id
     AND voided_at IS NULL;
  GET DIAGNOSTICS v_hit = ROW_COUNT;

  IF v_hit <> 1 THEN
    -- ⚠️ **誠實邊界:這一格我構造不出來。**
    --   步 2 的 `FOR UPDATE` 在 READ COMMITTED 之下會在鎖釋放後**重讀**那一列
    --   ⇒ 併發的第二發會在步 3 就看到 `voided_at` 非 NULL,走不到這裡。
    --   ⇒ 依本 repo 紀律,我**不宣稱它是縱深** —— 它是 fail-closed 的兜底,而**沒有測試證得了它**。
    --   ⇒ 什麼會讓它變成活的:有人把步 2 的 `FOR UPDATE` 拿掉、或把隔離等級調成 REPEATABLE READ
    --      (RR 之下第二發拿到的是序列化失敗,整筆交易中止 —— 也走不到這裡)。
    RAISE EXCEPTION 'admin_void_manual_refund: 寫入影響 % 列(預期 1)⇒ 在讀到它與寫入它之間有人動了那一列;'
                    'fail-closed 拒絕。請重新讀取那筆退款的現況再決定', v_hit;
  END IF;

  -- 🔴🔴 ⟦b4-MANREFUNDNOAUDIT⟧(2026-09-12,Sean 批准):作廢這一半同樣要留痕。
  --    🛑 **`request_id` 的來源要講清楚**:本 RPC **沒有冪等鍵參數**(它自陳「不需要」),
  --      而 `admin_audit_log.request_id` 是 `NOT NULL` + `CHECK (<> '')`。
  --      ⇒ 這裡用 `'void:' || p_refund_id` —— 它**識別的是這一次作廢的對象**,
  --        而同一筆退款只作廢得了一次(步 4 的 `AND voided_at IS NULL`)⇒ 這個值不會撞。
  --      ⛔ ~~加一個 `p_request_id` 參數~~ —— `CREATE OR REPLACE` **改不了簽章**:
  --        加參數會長出**第二支多載**,而舊那支還活著(⟦db-SAMETRIGGERNAME⟧ 那一族的形狀)。
  --        要那樣做得 DROP + CREATE + 改呼叫端, 不在本片範圍。
  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (v_actor,
     'order_refund.manual_void',
     'manual_refund:' || p_refund_id::text,
     'void:' || p_refund_id::text,
     pg_catalog.jsonb_build_object('manual_refund_id', v_row.id, 'rail', v_row.rail,
                                   'amount', v_row.refund_amount, 'voided_at', v_row.voided_at),
     pg_catalog.jsonb_build_object('voided_at', pg_catalog.now(), 'voided_by', v_actor),
     v_reason,
     'admin');
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  IF v_hit <> 1 THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 稽核落 % 列(期望恰 1)⇒ 錢的紀錄與【誰做的】必須同生共死', v_hit;
  END IF;

  -- 🔴🔴 **片③:作廢完要把狀態同步回去。**
  --    在此之前本函式**剝掉行註解後 `public.orders` 零命中** ⇒ 作廢一筆退款之後
  --    **沒有任何人去改 `payment_status`** ⇒ 它卡在 `refunded`。
  --    🔵 位置刻意在**本函式自己的 DML 完成之後**、以獨立語句呼叫(同步器 COMMENT `:357-358` 的規格)。
  --    🔵 鎖序已由上面三步拉成 `orders → 子表` ⇒ 同步器再取 `orders` 是同交易重複鎖 = no-op。
  PERFORM public.pcm_sync_order_refund_payment_status(v_oid);

  RETURN pg_catalog.jsonb_build_object(
    'voided', true, 'idempotent', false, 'refund_id', p_refund_id);
END
$fn$;

-- ══ ③ 回填既有的人工退款(Sean 2026-09-12 答【甲 = 補】)═══════════════════════
-- 🔴 **補的是真值, 不是編的**:來源是 `order_manual_refunds` 自己的 `actor` / `request_id` /
--    `voided_by`(唯讀實查 2026-09-12:2 列, actor 兩列都有值、request_id 兩列都有值、voided_by 1 列)。
-- 🛑 **而 `before` 一律寫 NULL 並在 reason 裡明說「改前付款狀態不可考」** ——
--    那個值沒有第二份來源, 填一個推出來的數就是把推論寫成觀察。
-- 🔵 冪等:`WHERE NOT EXISTS` 比對 (action, target) ⇒ 重跑不會加倍。
INSERT INTO public.admin_audit_log
  (actor, action, target, request_id, before, after, reason, source_app)
SELECT
  m.actor,
  'order_refund.manual_record',
  'order:' || m.order_id::text,
  coalesce(m.request_id::text, 'backfill:' || m.id::text),
  NULL,
  pg_catalog.jsonb_build_object('manual_refund_id', m.id, 'rail', m.rail,
                                'amount', m.refund_amount, 'occurred_at', m.occurred_at),
  '事後補(20260912 回填);改前付款狀態不可考。原始登記理由:' || coalesce(m.reason, '(無)'),
  'admin'
FROM public.order_manual_refunds m
WHERE m.actor IS NOT NULL AND m.actor <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_audit_log a
     WHERE a.action = 'order_refund.manual_record'
       AND a.after ->> 'manual_refund_id' = m.id::text);

INSERT INTO public.admin_audit_log
  (actor, action, target, request_id, before, after, reason, source_app)
SELECT
  m.voided_by,
  'order_refund.manual_void',
  'manual_refund:' || m.id::text,
  'backfill-void:' || m.id::text,
  NULL,
  pg_catalog.jsonb_build_object('voided_at', m.voided_at, 'voided_by', m.voided_by),
  '事後補(20260912 回填);作廢當下的改前狀態不可考。作廢理由:' || coalesce(m.void_reason, '(無)'),
  'admin'
FROM public.order_manual_refunds m
WHERE m.voided_at IS NOT NULL AND m.voided_by IS NOT NULL AND m.voided_by <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_audit_log a
     WHERE a.action = 'order_refund.manual_void'
       AND a.target = 'manual_refund:' || m.id::text);

COMMIT;
