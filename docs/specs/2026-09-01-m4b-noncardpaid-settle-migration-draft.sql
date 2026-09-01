-- ============================================================
-- 🛑🛑🛑 **草稿。codex R1 判 `FAIL(9 個 must-fix + 2 nit)` ⇒ 不要 apply、不要搬回 supabase/migrations/。**
-- ------------------------------------------------------------
-- 🔴 **為什麼它在 `docs/specs/` 而不在 `supabase/migrations/`**(這一段比下面那 580 行重要):
--    那 26 支 verify harness 的 provision 是【依序 apply `supabase/migrations/` 底下每一支】
--    ⇒ 一支已知不對的 migration 放進那個目錄, **每一發 provision 都會跑它**
--    ⇒ ⇒ 📌 而檔頭寫「不要 apply」是給【人】看的, **而跑它的是迴圈**。
--    ✅ `docs/specs/*-migration-draft.sql` 是這個 repo 既有的落點(當場量:`docs/specs/*.sql` 11 支,
--       其中 `-migration-draft` 字尾 8 支;🔴 負對照現造字尾 ⇒ 0;而 `supabase/migrations/` 裡含 draft ⇒ 0)。
--
-- 🔴 **九條 must-fix 的清單與收斂**:`docs/plans/2026-09-01-noncardpaid-settle-and-expire-guard-plan-v2.md`
--    ⇒ 而 v2 的結論是:**九條收斂成一條** —— 「我只在【一條路】上重算,而有三條路會動那個淨額」。
--    ⇒ ⇒ 所以下一版**不是修這 580 行**,是把重算搬到共同下游 ⇒ **這份草稿的形狀本身要被換掉。**
--
-- 🛑 **兩條打在判準上的(不是少一道守門)**:
--    · 人工退款寫 `order_manual_refunds`、**不寫回 `order_payments`**
--      ⇒ 下面 cron 那句 `sum(order_payments.amount)` 不等於「現在還握有多少錢」
--      ⇒ 而那推翻我當初判「自己寫述詞」的核心理由(我以為那個問題比 OP6a 窄)
--    · `partiallyPaid` 中間態與**尚未 apply** 的券片 trigger(只接受 `OLD.payment_status = unpaid`)相撞
--      ⇒ 🔵 而券片今天不在正式庫上(實查:coupon/redeem 相關非內部 trigger ⇒ 0,
--         🟢 正對照 全庫非內部 trigger 62)⇒ **今天撞不到,而誰後貼誰踩到。**
--
-- 🔵 **而它保留下來的價值**:兩支函式的**基底代**是查過的、正式庫實查的形狀在檔裡、
--    索引與 ACL 那幾段的寫法可以再用。⇒ **當素材讀,不當成品用。**
-- ============================================================

-- ============================================================
-- ⟦b4-NONCARDPAID1⟧ 匯款/現金收款不會翻狀態 ⇒ 那張單隔天被自動取消
-- ------------------------------------------------------------
-- 🔴🔴 **這支會改變正式庫的行為, 而它要 Sean 貼。**兩件事:
--   ① `public.admin_record_manual_payment` —— 登記收款之後**順手把 `payment_status` 翻對**
--   ② `pcm_cron.expire_unpaid_orders` —— 逾期取消的述詞**補上匯款/現金那條腿**
--
-- 病(逐格量到的, 不是推的):
--   客人匯款、後台登記了收款, 而【沒有任何一支函式為匯款翻 `payment_status`】
--   ⇒ 那張單一直是 `unpaid` ⇒ **逾期 cron 隔天把它取消掉, 而錢在我們這裡。**
--   實查(2026-09-01 唯讀正式庫):會寫 `payment_status` 的函式 = **2 支**
--     `public.confirm_order_payment`(卡片那條腿)/ `public.pcm_sync_order_refund_payment_status`(退款同步)
--     🟢 正對照 同尺找【讀】它的函式 ⇒ **29 支**(尺會動)· 🔴 負對照 現造欄名 ⇒ **0**
--   ⇒ 📌 **所以本列不是「有人漏了」, 是【這條路從來沒有被接上】。**
--
-- 🔴 **而 `20260810200000:77` 三週前就寫下來了**, 逐字:「⇒ **已收人工款的單目前仍可被取消**。不在本片可修。」
--   ⇒ 📌 **一句寫在碼旁的「不在本片可修」, 三週沒有人回來做。**
--   ⇒ ⇒ 而那正是主視窗今晚給另一片的條件所引用的那個例子。
--
-- ══ 授權鏈 ═══════════════════════════════════════════════════════════
--   Sean 2026-09-01 拍【甲:現在就修 —— 讓「登記收款」順手把狀態翻對】(不是乙:只在排程那邊擋)
--   主視窗 `-0a` 2026-09-01 裁:述詞形狀走 (ii)(自己寫述詞), 而判準與代價見
--   `docs/plans/2026-09-01-noncardpaid-settle-and-expire-guard-plan.md`
--
-- ══ 🛑 這支【證不到】什麼 ══════════════════════════════════════════════
--   · 那支 cron 現在【有沒有真的在跑】—— 唯讀帳號讀不到 `cron` schema(實測 permission denied)
--   · 今天有沒有真的發生過 —— `orders` 今早被 ⟦b4-PURGE1⟧ 清空 ⇒ 那個 0 沒有判別力
--     ⇒ 🔵 **急迫性未知, 而機制確定。不要用「今天沒發生」當理由放慢。**
--   · `overpaid` 該翻成什麼 —— `payment_status` 值域實查 = unpaid / paid / partiallyPaid /
--     refunded / partiallyRefunded 共 **5** 個(🟢 正對照 `fulfillment_status` 4 / `member_tier` 3;
--     🔴 負對照 現造型別名 ⇒ 0)⇒ **沒有溢收對應的值** ⇒ 本片**不翻**, 而不猜。
--   · OP6a 的第三代(`20260901030000`)**未 apply** ⇒ 本片以【第二代 `20260812140000`, 正式庫現行】為準。
--     🟢 而兩代的七條前提**逐字相同**(去空白逐條比 P1-P7 全同)⇒ 這一格已驗。
--
-- ══ 🔴 基底代(不是猜的)═══════════════════════════════════════════════
--   `admin_record_manual_payment` 最新代 = `20260812150000`(`latest-definition-of.sh`),
--   而**正式庫那一版與它逐字相同**(`pg_get_functiondef` 抽函式體、正規化空白後 md5 兩邊皆
--   `0b77ce2f97f9…`, 長度 11,239)⇒ 📌 那支工具自己說它答不出「正式庫現在跑的是哪一代」,
--   而這一格我用唯讀連線補上了。
--   `pcm_cron.expire_unpaid_orders` 基底 = `20260828060000`。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.admin_record_manual_payment(
  p_order_id       uuid,
  p_request_id     uuid,
  p_actor          text,
  p_rail           text,
  p_amount         integer,
  p_received_at    timestamptz,
  p_bank_reference text DEFAULT NULL,
  p_payer_note     text DEFAULT NULL
)
RETURNS jsonb                 -- {recorded, idempotent, payment_id};禁回 total / 價結構(PF-G 同款)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_existing    record;
  v_bank_ref    text;
  v_payer_note  text;
  v_payment_id  uuid;
  v_floor       timestamptz;
  v_n           integer;
  -- 🔴 稽核筆數守**自己的**變數(#423):刻意不共用 v_n ——
  --    既有 harness 的順序錨用字面 `GET DIAGNOSTICS v_n = ROW_COUNT;` 取**首次命中**
  --    (`scripts/op5-verify.sh:719-721`、`scripts/opa12-verify.sh:498-499`),
  --    共用同名會讓 replay 的守門排到 order_payments INSERT 之前 ⇒ 那道錨對健康新碼發火。
  v_audit_n    integer;
  -- 🔵 本片(⟦b4-NONCARDPAID1⟧)新增:結清判定與狀態回寫用
  v_settle      jsonb;
  v_verdict     text;
  v_new_status  public.payment_status;
  v_status_n    integer;
  -- 業務拒絕單一通用訊息(PF-E 同款:不洩訂單狀態);輸入類與政策類另給具體訊息,理由見各處。
  v_generic_msg constant text := 'admin_record_manual_payment: 收款登錄失敗';
BEGIN
  -- ══ G1 隔離閘(fail-closed;A8c1/A8c2/OP3 同款)══════════════════════════
  -- 非 READ COMMITTED 下 FOR UPDATE 等鎖醒來後快照仍舊 ⇒ 看不到已 commit 的取消。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_record_manual_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- ══ G2 actor 守門 —— 🔴 **排在任何訂單讀取之前** ═══════════════════════
  -- codex R1 #6:actor 守門若排在 orders 讀取之後,拿無效 actor 去探不同 order_id 可以區分
  -- 「訂單存在且未取消」(回 P2B39)與「不存在/已取消」(回通用訊息)⇒ 守門序自己變成 oracle,
  -- 而且無效身分還先把訂單列鎖住了。⇒ 身分錯的呼叫**拿不到任何訂單資訊**。
  -- 🔴 FK 只擋「不存在」,擋不住「已停用」⇒ 這道問的是 `is_active`(A7 債⑥、A8a2 `:355` 同款)。
  IF p_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 經手人 [%] 不存在或已停用 ⇒ 拒絕登錄收款。'
                    '這是人員設定問題、不是訂單問題(本 RPC 的使用者是後台員工,壓成通用訊息會讓'
                    '「這個帳號被停用了」變成查不出來的謎)', coalesce(p_actor, '(NULL)')
      USING ERRCODE = 'P2B39', CONSTRAINT = 'pcm_op5_actor_invalid';
  END IF;

  -- ══ G3 輸入驗(server 自供參數 ⇒ 具體訊息)══════════════════════════════
  -- 🔴 五個參數**逐一列名**、不寫「四個參數」這種計數字面 —— v3 折 NULL 守門時就是被
  --    計數字面害的:列了四個、把 v2 原本有的 `p_received_at` 弄丟了(Fable R3 #1 抓到)。
  IF p_order_id   IS NULL THEN RAISE EXCEPTION 'admin_record_manual_payment: 訂單識別碼缺失'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'admin_record_manual_payment: 冪等鍵 request_id 缺失'; END IF;
  IF p_rail       IS NULL THEN RAISE EXCEPTION 'admin_record_manual_payment: 收款管道缺失'; END IF;
  IF p_amount     IS NULL THEN RAISE EXCEPTION 'admin_record_manual_payment: 金額缺失'; END IF;
  IF p_received_at IS NULL THEN RAISE EXCEPTION 'admin_record_manual_payment: 收款時點缺失'; END IF;

  -- 🔴 `card` 具名拒:卡軌的冪等鍵是外部事實 `rec_trade_id`,由 OP3 的機器軌同交易寫。
  --    讓人工軌寫得出 card 列 = 繞過那把鎖,錢帳會出現沒有 TapPay 交易號的卡片收款。
  IF p_rail = 'card' THEN
    RAISE EXCEPTION 'admin_record_manual_payment: card 軌不得由人工登錄(卡片收款由付款確認同交易寫入)';
  END IF;
  IF p_rail NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 收款管道 [%] 不是 bank_transfer 或 cash', p_rail;
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 金額必須為正整數(實得 %)', p_amount;
  END IF;

  -- 🔴 正規化在**守門之前**(codex R1 #7):`bank_reference` 若帶前後空白,`btrim(x) <> ''`
  --    這種寫法會放行,然後在 INSERT 撞 OP1 的 `order_payments_bank_reference_trimmed`
  --    ⇒ 噴 raw 23514(PG 的 DETAIL 會把整列值帶出來)。⇒ 這裡就把它正規化成要寫進去的值。
  --    空字串一律收斂成 NULL,否則 `''` 會穿過「非空」的直覺卻違反 OP1 的 rail_fields。
  v_bank_ref   := pg_catalog.btrim(p_bank_reference);
  IF v_bank_ref = '' THEN v_bank_ref := NULL; END IF;
  v_payer_note := pg_catalog.btrim(p_payer_note);
  IF v_payer_note = '' THEN v_payer_note := NULL; END IF;

  -- 軌別欄位形狀(OP1 `order_payments_rail_fields` 的 CASE 分支;RPC 不送出違反它的組合)
  IF p_rail = 'bank_transfer' AND v_bank_ref IS NULL THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 匯款軌必須填銀行參考(末五碼或交易序號)';
  END IF;
  IF p_rail = 'cash' AND v_bank_ref IS NOT NULL THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 現金軌不得填銀行參考';
  END IF;

  -- ══ G4 未來時點(逐字 `clock_timestamp()`;OP2a 的 A8 閘是 backstop)═══════
  -- 🔴 **必須是 `clock_timestamp()` 不是 `now()`**:`now()` 是交易開始時刻,會誤殺
  --    「交易開始後、寫入前」真的已經發生的時刻(OP2a 檔頭逐字記過這條)。
  -- 🔴 這道**不是** OP2a 的重複:OP2a 噴的是 raw `P2B31`,而 app 層現行只認 `P0001`、
  --    其餘一律歸「連線失敗、可重試」⇒ 人打錯一個未來日期會變成「請重試」。
  --    ⇒ RPC 層給看得懂的話,trigger 層擋繞過 RPC 的路。**兩道並存是刻意的。**
  --    ⚠️ harness 要證這道**有判別力**:拔掉它之後 OP2a 那道仍紅(conname = `pcm_op2_received_at_future`,
  --       OP2a `:95`;⚠️ 別寫成 `pcm_op2_received_at_not_future`,那是**函式名**、不是約束名)。
  IF p_received_at > pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 收款時點不得晚於現在(收款時點=%,現在=%)',
                    p_received_at, pg_catalog.clock_timestamp()
      USING ERRCODE = 'P2B38', CONSTRAINT = 'pcm_op5_received_at_future';
  END IF;

  -- ══ G5 鎖臨界區 ═══════════════════════════════════════════════════════════
  SELECT o.id, o.created_at, o.cancelled_at, o.payment_status
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;   -- 不洩「這張單存不存在」
  END IF;

  -- ══ G6 取消守門 + 狀態 allowlist ═════════════════════════════════════════
  -- 🔴 **只擋整單取消**(`orders.cancelled_at`)—— Fable/codex R3 抓到我抄錯先例:
  --    OP3 的守門是「確認整筆付款」語意,連「有任何 order_cancellations 列」都擋;
  --    但 §5.1b 契約寫死**部分取消不動 `orders.cancelled_at`**、那張單**還活著、還會收後續款**
  --    ⇒ 照抄 OP3 會把合法的後續收款全拒。⇒ 部分取消單放行。
  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 退款態 = **政策性拒絕**,給可診斷訊息(不是通用訊息):
  --    走到這裡 actor 已經過驗、是後台員工,他本來就看得到訂單狀態 ⇒ 壓成「登錄失敗」只有壞處。
  --    (這條與本片 §actor 守門的分界理由自洽:洩訂單狀態給客人才是問題,對員工不是。)
  -- 🔴 為什麼是拒不是放行:退款態的單再進錢**真實但罕見**,而它的正確處置(淨額怎麼算、
  --    狀態要不要復活)屬 **OP6 且尚未拍板** ⇒ 現在放行等於製造沒人接的錢。⇒ fail-closed。
  IF v_order.payment_status IN ('refunded'::public.payment_status,
                                'partiallyRefunded'::public.payment_status) THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 本單為退款態(%),人工收款登錄暫不開放。'
                    '補收款與更正入口是 OP-A13(退款態單的沖銷與重登),需等 OP6 的淨額與狀態重算上線',
                    v_order.payment_status
      USING ERRCODE = 'P2B41', CONSTRAINT = 'pcm_op5_refunded_state';
  END IF;
  -- 🔴 fail-closed 兜底:allowlist 之外一律拒。日後 `payment_status` 新增 enum 值時,
  --    這裡會**當場拒**而不是靜默放行一個沒人想過的狀態。
  IF v_order.payment_status NOT IN ('unpaid'::public.payment_status,
                                    'paid'::public.payment_status,
                                    'partiallyPaid'::public.payment_status) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ══ G7 下限:收款不可能發生在訂單成立之前(逐軌粒度)═══════════════════════
  -- 🔴 **分軌比較**(Fable R3 #1 + codex R3 #1,本輪最重的交叉洞):
  --    `bank_transfer` 的值是**台北當日 00:00**,若拿它與 `created_at` 逐秒比,
  --    「今天下午 14:00 成立、客人立刻轉帳當日入帳」= 台灣最常見的情境**會恆被拒**。
  --    ⇒ 匯款比**台北曆日**(下限 = 建單日的台北 00:00)、現金比**精確時點**。
  -- ⚠️ **失效條件**:日後若出現「先收款後補單」或歷史款遷入,這條要一起改;
  --    不做成無界是因為 Q4=C 之後**沒有第二個人會看到打錯的年份**(打錯 2015 會永久離開今日對帳視窗)。
  IF p_rail = 'bank_transfer' THEN
    v_floor := pg_catalog.date_trunc('day', v_order.created_at AT TIME ZONE 'Asia/Taipei')
               AT TIME ZONE 'Asia/Taipei';
  ELSE
    v_floor := v_order.created_at;
  END IF;
  IF p_received_at < v_floor THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 收款時點早於訂單成立(收款時點=%,下限=%)。'
                    '匯款軌比台北曆日、現金軌比實際時點', p_received_at, v_floor
      USING ERRCODE = 'P2B38', CONSTRAINT = 'pcm_op5_received_at_before_order';
  END IF;

  -- ══ G8 冪等樹(先查再走,不靠撞 unique)═══════════════════════════════════
  -- 🔴 **不得只看鍵出現過就回成功**:同一個 request_id 帶不同金額 = 呼叫端有 bug 或竄改,
  --    不是重送(memory `feedback_idempotency-key-must-be-verified-not-just-present`)。
  -- 🔴🔴 **逐欄用 `IS NOT DISTINCT FROM`,不得用 `=`**(Fable R3 #3):cash 列的
  --    `bank_reference` / `payer_note` 皆為 NULL,`NULL = NULL` 得 NULL ⇒ 整條 AND 鏈變 NULL
  --    ⇒ **cash 的合法重送會被判成竄改**。同族前科 = A5a 的 conname `<>` 靜默吞。
  -- ⚠️ 誠實邊界(照抄 OP1 的字面,不改小):`request_id` 由**呼叫端產生** ⇒ 它擋的是
  --    「同一次互動被重送」,**不是「同一筆錢被登兩次」**。換個 request_id 再登一次 DB 擋不到;
  --    Q4=C 之後連複核也不擋了 ⇒ 那一面**只剩對帳**。
  SELECT op.id, op.rail, op.amount, op.received_at, op.bank_reference, op.payer_note, op.actor
    INTO v_existing
    FROM public.order_payments op
   WHERE op.order_id = p_order_id AND op.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.rail           IS NOT DISTINCT FROM p_rail
       AND v_existing.amount         IS NOT DISTINCT FROM p_amount
       AND v_existing.received_at    IS NOT DISTINCT FROM p_received_at
       AND v_existing.bank_reference IS NOT DISTINCT FROM v_bank_ref
       AND v_existing.payer_note     IS NOT DISTINCT FROM v_payer_note
       AND v_existing.actor          IS NOT DISTINCT FROM p_actor THEN
      -- ══ #423 稽核(重放路徑;Sean 線 Q-D16=B 主視窗裁)═══════════════════
      -- 🔴 **重放要留痕**:這條路幾乎只在「首送已 commit、回應斷在路上、員工重送」時發生,
      --    而它在正式站原本**零觀測點**(收款表單 backlog #430 的殘餘風險指的就是它)。
      -- 🔴 `action` 與正常路徑**刻意不同碼**:查「這張單有幾筆收款」的人濾 `payment.record`,
      --    重放列不會被誤算進去(「稽核列數 = 狀態變更數」這條不變式靠 action 區隔保住)。
      -- 🔴 `before`/`after` 只放既有那列的識別欄:重放的資訊量在「這件事又發生一次」,不在內容。
      INSERT INTO public.admin_audit_log
        (actor, action, target, request_id, before, after, reason, source_app)
      VALUES
        (p_actor, 'payment.record.replay', 'payment:' || v_existing.id::text,
         p_request_id::text,
         pg_catalog.jsonb_build_object('payment_id', v_existing.id, 'amount', v_existing.amount),
         pg_catalog.jsonb_build_object('payment_id', v_existing.id, 'amount', v_existing.amount),
         NULL, 'admin');
      GET DIAGNOSTICS v_audit_n = ROW_COUNT;
      IF v_audit_n <> 1 THEN
        RAISE EXCEPTION 'admin_record_manual_payment: 重放稽核落 % 列(期望恰 1)。'
                        '🔴 這筆收款**先前已經記進帳了**(本次是重放)—— 失敗的是稽核寫入,'
                        '不是收款不存在;請勿重新登錄。本交易整筆回滾', v_audit_n
          USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_op5_audit_replay_row_count';
      END IF;

      RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', true,
                                           'payment_id', v_existing.id);
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ══ G9 落帳(append 一列;**不碰 orders**)════════════════════════════════
  -- · `reverses_payment_id` / `reversal_reason` 恆 NULL:本 RPC 只登錄收款,沖銷是 OP-A12。
  -- · `rec_trade_id` 恆 NULL:那是卡軌的外部識別。
  -- · `reviewed_by` / `reviewed_at` 恆 NULL:Q4=C,本 RPC 不寫複核欄。
  -- · `received_at` 寫**人輸入的值**(Q1=A),不是 `now()`;`created_at` 由預設值記登錄時間。
  INSERT INTO public.order_payments
    (order_id, rail, amount, received_at, bank_reference, request_id, payer_note, actor)
  VALUES
    (p_order_id, p_rail, p_amount, p_received_at, v_bank_ref, p_request_id, v_payer_note, p_actor)
  RETURNING id INTO v_payment_id;

  -- ══ G10 落帳 row_count 守(位置**必須在 INSERT 之後**)═══════════════════
  -- 🔴 BEFORE INSERT trigger 回 NULL 會**靜默吞列** —— INSERT 影響 0 列、**不報任何錯**,
  --    函式照樣 RETURN 成功,而呼叫端以為錢記進帳了。OP3 才被這條咬過(P2B37),本片一開始就有。
  -- 🔴 排在 INSERT 之前的話,它讀到的是上一句的 ROW_COUNT ⇒ 恆真(OP3 順序錨的教訓)。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 落帳 % 列(期望恰 1)⇒ 收款帳本沒收到這筆。'
                    '成因通常是 order_payments 上有 BEFORE INSERT trigger 回了 NULL(靜默吞列)。'
                    '本交易整筆回滾', v_n
      USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_op5_row_count';
  END IF;

  -- ══ #423 稽核(正常路徑)═══════════════════════════════════════════════
  -- 位置:**G10 之後** —— 先確定帳真的落了一列,才記「誰登的」。
  -- 🔴 `after` 只放 `has_bank_reference` 布林、**不放單號與備註的值**:
  --    內容明細是 `order_payments` 自己那列的職責(那張表有更嚴的 RLS 與欄級權限);
  --    複製進來 = 同一份敏感資料多一個副本、多一條要各自維護的權限邊界,
  --    而未來若開稽核檢視器,那個副本會跟著被看見。
  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (p_actor, 'payment.record', 'payment:' || v_payment_id::text, p_request_id::text,
     NULL,  -- append-only:這一筆之前不存在,沒有前態
     pg_catalog.jsonb_build_object(
       'order_id', p_order_id, 'rail', p_rail, 'amount', p_amount,
       'received_at', p_received_at,
       'has_bank_reference', v_bank_ref IS NOT NULL,
       'has_payer_note', v_payer_note IS NOT NULL),
     NULL,  -- 表單沒有原因欄
     'admin');
  GET DIAGNOSTICS v_audit_n = ROW_COUNT;
  IF v_audit_n <> 1 THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 稽核落 % 列(期望恰 1)⇒ 這筆收款會變成沒有'
                    '「誰登的」紀錄。成因通常是 admin_audit_log 上有 BEFORE INSERT trigger 回了 NULL。'
                    '本交易整筆回滾(收款也不會留)', v_audit_n
      USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_op5_audit_row_count';
  END IF;


  -- ══ G11 結清判定與狀態回寫(⟦b4-NONCARDPAID1⟧;Sean 2026-09-01 拍甲「現在就修」)═════
  -- 🔴 **本片存在的理由**:在這一段之前, 正式庫上【沒有任何一支函式為匯款/現金翻 payment_status】。
  --    實查(2026-09-01 唯讀):`select proname from pg_proc where prosrc ~* 'set\s+payment_status\s*='`
  --    ⇒ 只有 `confirm_order_payment`(卡片)與 `pcm_sync_order_refund_payment_status`(退款同步)
  --    ⇒ 🟢 正對照 同尺找【讀】它的函式 ⇒ 29 支(尺會動)· 🔵 負對照 現造欄名 ⇒ 0
  --    ⇒ ⇒ **那張單一直是 unpaid ⇒ 逾期 cron 隔天取消它, 而錢在我們這裡。**
  --
  -- 🛑 而 repo 裡那句「全 repo 至少五處【不同函式】會 SET payment_status='paid'」**是錯的**
  --    (逐字在 `20260901020000:183` / `20260901021000:1090` / `20260901030000:1150` 的 COMMENT ON):
  --    收窄成【行首就是 SET payment_status =】的碼行 ⇒ 5 行, 而**函式只有 2 支** ——
  --    前四行是同一支 `confirm_order_payment` 的四代 CREATE OR REPLACE。
  --    ⇒ 📌 那個「五」數的是【定義點】不是【函式】。本片不改那三處 COMMENT(已 apply, 要另一支)。
  --
  -- 🔵 **不自己算結清** —— 呼叫既有的 `admin_compute_order_settlement`(OP6a, 唯讀 STABLE SECDEF)。
  --    它的七條前提對「匯款已登記」那個形狀全部成立(P5 走 `rows_n>0 AND uncovered_n=0` 那一支)。
  --    ⚠️ 代數:repo 有 3 代, 正式庫現行是 `20260812140000`;而兩代的七條前提**逐字相同**
  --      (去空白逐條比 P1-P7 全同), 差別只在 `ref` CTE 第②面 ⇒ 對零退款的匯款單同值。
  v_settle  := public.admin_compute_order_settlement(p_order_id);
  v_verdict := v_settle->>'verdict';

  -- 🔴🔴 **四種 verdict, 而只有兩種翻**:
  --    settled   ⇒ paid           (淨額 = 應收)
  --    underpaid ⇒ partiallyPaid  (值域裡有這個值)
  --    overpaid  ⇒ **不翻** —— `payment_status` 值域實查 = unpaid/paid/partiallyPaid/refunded/
  --                partiallyRefunded 共 5 個, **沒有溢收對應的值**。猜一個等於發明業務語意。
  --    needs_human ⇒ **不翻** —— 它自己宣告「這張單的帳我算不清」
  --                ⇒ 📌 用一個【自己宣告算不清】的判斷去決定終態, 那個組合本身就不對。
  -- 🛑🛑 **而「不翻是安全的」這句話【依賴逾期 cron 那道兜底】**(本片同時改的第二件):
  --    沒有那道兜底 ⇒ 那兩種單仍是 unpaid ⇒ cron 隔天照樣取消 ⇒ **缺口形狀與修之前一模一樣, 只是變窄。**
  --    ⇒ 🔴 **哪天有人拿掉那道兜底, 這一段會【安靜地】退化 —— 沒有測試會紅, 因為那兩種單本來就不常見。**
  IF v_verdict = 'settled' THEN
    v_new_status := 'paid'::public.payment_status;
  ELSIF v_verdict = 'underpaid' THEN
    v_new_status := 'partiallyPaid'::public.payment_status;
  ELSE
    v_new_status := NULL;   -- overpaid / needs_human / 任何未來新增的 verdict ⇒ fail-closed 不翻
  END IF;

  IF v_new_status IS NOT NULL AND v_new_status IS DISTINCT FROM v_order.payment_status THEN
    -- 🔵 這張單在 G5 已經 `FOR UPDATE` 鎖住(同單序列化)⇒ 這裡的 UPDATE 不需要再鎖。
    -- 🔴 `WHERE payment_status = v_order.payment_status` 是**狀態-race 偵測**(照 confirm_order_payment
    --    `20260611120000:13` 的同款寫法):有人在我們讀完之後改了它 ⇒ 這裡會落 0 列 ⇒ 下面當場紅。
    UPDATE public.orders o
       SET payment_status = v_new_status,
           updated_at     = pg_catalog.now()
     WHERE o.id = p_order_id
       AND o.payment_status = v_order.payment_status;
    GET DIAGNOSTICS v_status_n = ROW_COUNT;
    IF v_status_n <> 1 THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 狀態回寫落 % 列(期望恰 1)⇒ 收款記進帳了而'
                      '訂單狀態沒翻, 那張單會被逾期 cron 取消。成因可能是狀態在本交易期間被別人改過, '
                      '或 orders 上有 BEFORE UPDATE trigger 回了 NULL。本交易整筆回滾', v_status_n
        USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_noncardpaid_status_row_count';
    END IF;

    -- 🔵 稽核:狀態變更要留痕, 而它與 `payment.record` **刻意不同碼** ——
    --    查「這張單有幾筆收款」的人濾 `payment.record`, 狀態列不該被算進去(照本檔既有的 replay 慣例)。
    INSERT INTO public.admin_audit_log
      (actor, action, target, request_id, before, after, reason, source_app)
    VALUES
      (p_actor, 'payment.settle_status', 'order:' || p_order_id::text, p_request_id::text,
       pg_catalog.jsonb_build_object('payment_status', v_order.payment_status),
       pg_catalog.jsonb_build_object('payment_status', v_new_status, 'verdict', v_verdict),
       NULL, 'admin');
    GET DIAGNOSTICS v_audit_n = ROW_COUNT;
    IF v_audit_n <> 1 THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 狀態變更稽核落 % 列(期望恰 1)。本交易整筆回滾', v_audit_n
        USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_noncardpaid_status_audit_row_count';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', false,
                                       'payment_id', v_payment_id);

EXCEPTION
  -- 🔴 真並發 backstop:同 `(order_id, request_id)` 的第二支在 G8 讀不到對方**未提交**的列,
  --    走到 INSERT 撞 `order_payments_request_id_uniq`。⚠️ 常態並發其實會先卡在 G5 的
  --    `orders FOR UPDATE`(同單序列化)⇒ 第二支醒來時多半在 G8 就看到既有列、走冪等樹。
  --    **這條 handler 是 backstop,不是主要路徑** —— 口徑照 harness 實測寫,不憑推論。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

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
       -- ══ 🔴🔴 匯款/現金那條腿(⟦b4-NONCARDPAID1⟧;2026-09-01 補齊對稱)══════════
       -- 上面那一句保護的是【卡片】:有任何非終態 attempt = 錢可能在途 ⇒ 不碰。
       -- 而匯款/現金收款【不會產生 payment_charge_attempts 列】⇒ 上面那句對它恆真 ⇒ 它沒有保護。
       -- 📌 **所以本段不是「加一個保護」, 是【補齊一個已經存在的對稱】** —— 兩條腿要長得一樣。
       --
       -- 🔴 **判準是【淨額】不是【有沒有列】** —— 這一格是主視窗 2026-09-01 抓到的:
       --    `order_payments` 有沖銷列(`20260810100000:76` 逐字「沖銷列 amount < 0」;
       --     `:94`「一正一負互指(-300/+300)⇒ 該單 SUM=0」)
       --    ⇒ 一張「收了 300 又沖銷 300」的單**有列而錢是 0**
       --    ⇒ ⇒ 若寫成 `NOT EXISTS(order_payments)`, 那種單**永遠不會被取消**, 而它本來應該被取消。
       --    📌 **而那個錯的方向是【留下殭屍單】—— 它比誤取消安靜:沒有客人會來抱怨一張沒被取消的單。**
       --
       -- 🛑 **代價寫出來:這是第二份 `sum(amount)`** —— `admin_compute_order_settlement` 的
       --    `pay` CTE 有第一份(`coalesce(sum(op.amount),0)::bigint AS gross`)。**兩份會漂**:
       --    哪天 `order_payments` 多一種「不算數的列」(例如未來日期的 `received_at`),
       --    OP6a 的 `future_n` 會擋而這一句不會。
       --    ⇒ 🔴 **動一邊就要動兩邊。**而本檔尾端有一道碼錨在守「兩邊的算式都還在」——
       --      ⚠️ 那道錨**只擋刪除, 不擋改寫**;真正的同源證人在拋棄式 PG 的 harness 裡(見板)。
       --
       -- 🔵 **為什麼不直接呼叫 OP6a**(判準寫在 plan, 這裡留最硬的那一條):
       --    cron 要接住的只有【登記收款那一側接不住】的那些 = verdict 是 needs_human / overpaid 的單,
       --    而 needs_human 的意思正是「這張單的帳我算不清」
       --    ⇒ 📌 **用一個【自己宣告算不清】的函式的中間值去決定「不要取消」, 那是把它的輸出**
       --      **用在它宣告的射程之外。**而我要問的問題窄得多:【這張單淨收到的錢 > 0 嗎】。
       AND (SELECT pg_catalog.coalesce(pg_catalog.sum(p.amount), 0)
              FROM public.order_payments p
             WHERE p.order_id = o.id) <= 0
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

-- ── 🔴 碼錨:兩邊的算式都還在嗎 ──────────────────────────────────────
-- 🛑 **這道錨【只擋刪除, 不擋改寫】** —— 寫在這裡免得下一個人以為它守得比實際寬。
--    真正的「兩份同源」證人在拋棄式 PG 的 harness 裡(餵同一張單, 比 cron 那句與 OP6a 的
--    `gross` 同號;故意讓其中一份改成別的算式 ⇒ 必須紅)。**那一發突變沒跑, 這一片不算做完。**
-- 🔵 而它照 OP6a 自己的 `③ 碼錨` 慣例:每一個錨都對應一個【審查換來的東西】,
--    刪掉任何一個都會回到某個已知的誤判形狀。
DO $anchor$
DECLARE
  v_src  text;
  v_bad  text;
BEGIN
  -- ① 登記收款那支:結清呼叫 + 兩種翻法 + 兩種不翻
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_record_manual_payment';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '碼錨:找不到 public.admin_record_manual_payment ⇒ 這道錨自己沒接上, 拒繼續';
  END IF;
  SELECT pg_catalog.string_agg(x.frag, ' | ' ORDER BY x.frag) INTO v_bad
    FROM unnest(ARRAY[
      'public.admin_compute_order_settlement',   -- 不自己算結清
      'v_settle->>''verdict''',                  -- 吃 verdict 而不是吃 net
      '''settled''',                             -- ⇒ paid
      '''underpaid''',                           -- ⇒ partiallyPaid
      'v_new_status := NULL',                    -- overpaid / needs_human ⇒ fail-closed 不翻
      'o.payment_status = v_order.payment_status' -- 狀態-race 偵測
    ]) x(frag)
   WHERE pg_catalog.strpos(v_src, x.frag) = 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '碼錨消失於 admin_record_manual_payment(%)⇒ 每一個都對應一個審查抓過的形狀, 拒繼續', v_bad;
  END IF;

  -- ② 逾期 cron 那支:兩條腿都要在
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '碼錨:找不到 pcm_cron.expire_unpaid_orders ⇒ 這道錨自己沒接上, 拒繼續';
  END IF;
  SELECT pg_catalog.string_agg(x.frag, ' | ' ORDER BY x.frag) INTO v_bad
    FROM unnest(ARRAY[
      'public.payment_charge_attempts',          -- 卡片那條腿(既有)
      'public.order_payments',                   -- 匯款那條腿(本片)
      'sum(p.amount)'                            -- 🔴 淨額而不是「有沒有列」—— 沖銷洞的解
    ]) x(frag)
   WHERE pg_catalog.strpos(v_src, x.frag) = 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '碼錨消失於 pcm_cron.expire_unpaid_orders(%)⇒ 兩條腿要對稱, 拒繼續', v_bad;
  END IF;

  -- ③ 🔴 反向錨:cron 那句**不准**寫成 `NOT EXISTS(order_payments)` ——
  --    那個寫法會讓「收了 300 又沖銷 300」的單永遠不被取消(留下殭屍單, 而它比誤取消安靜)。
  IF v_src ~* 'NOT[[:space:]]+EXISTS[^;]*public\.order_payments' THEN
    RAISE EXCEPTION
      'pcm_cron.expire_unpaid_orders 用 NOT EXISTS(order_payments) 判匯款腿 ⇒ 沖銷過的單會永遠不被取消。'
      '判準必須是【淨額 sum(amount) <= 0】而不是【有沒有列】';
  END IF;

  RAISE NOTICE '碼錨全過:結清呼叫 6 個 + cron 兩條腿 3 個 + 反向錨 1 個。';
END
$anchor$;

COMMIT;
