-- 回滾 20261001170000(收款手續費 + 刷卡 / 蝦皮標記)
-- 🔴 只在還沒有任何訂單或收款用到刷卡 / 蝦皮標記時可以回滾:有的話先人工處理那些單(停止, 不硬拆)。
BEGIN;
SET LOCAL lock_timeout = '5s';   -- 拿不到表鎖就停, 不在正式庫排隊卡住別人

DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE payment_instrument IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.order_payments WHERE payment_instrument IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.order_manual_refunds WHERE payment_instrument IS NOT NULL) THEN
    RAISE EXCEPTION '已有訂單 / 收款 / 退款用到刷卡或蝦皮標記, 不能直接回滾;先人工處理那些資料'
      '(蝦皮單的標記受 orders_shopee_source_instrument_check 保護, 要先拿掉那條約束才改得動)';
  END IF;
END
$chk$;

-- 本體 = 正式庫 2026-10-01 唯讀原文(回到本次之前)
CREATE OR REPLACE FUNCTION public.admin_today_payment_total(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(total bigint, row_count bigint)
 LANGUAGE sql
 STABLE STRICT SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(SUM(p.amount), 0)::bigint AS total,
         count(*)::bigint                   AS row_count
    FROM public.order_payments p
   WHERE p.received_at >= p_from
     AND p.received_at <  p_to
$function$;

CREATE OR REPLACE FUNCTION public.pcm_op2b_immutable_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_bad text;
BEGIN
  -- 🔴 逐欄列出、不用「除了 allowlist 以外」的動態寫法:欄位日後新增時,
  --    動態寫法會**自動放行**新欄(靜默擴大可改面),逐欄寫死則是新增欄位時當場想起要決定。
  --    可改的只有:note / payer_note / reviewed_by / reviewed_at。
  v_bad := pg_catalog.concat_ws(', ',
    CASE WHEN NEW.id                  IS DISTINCT FROM OLD.id                  THEN 'id' END,
    CASE WHEN NEW.order_id            IS DISTINCT FROM OLD.order_id            THEN 'order_id' END,
    CASE WHEN NEW.rail                IS DISTINCT FROM OLD.rail                THEN 'rail' END,
    CASE WHEN NEW.amount              IS DISTINCT FROM OLD.amount              THEN 'amount' END,
    CASE WHEN NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id THEN 'reverses_payment_id' END,
    CASE WHEN NEW.received_at         IS DISTINCT FROM OLD.received_at         THEN 'received_at' END,
    CASE WHEN NEW.rec_trade_id        IS DISTINCT FROM OLD.rec_trade_id        THEN 'rec_trade_id' END,
    CASE WHEN NEW.bank_reference      IS DISTINCT FROM OLD.bank_reference      THEN 'bank_reference' END,
    CASE WHEN NEW.request_id          IS DISTINCT FROM OLD.request_id          THEN 'request_id' END,
    CASE WHEN NEW.reversal_reason     IS DISTINCT FROM OLD.reversal_reason     THEN 'reversal_reason' END,
    CASE WHEN NEW.actor               IS DISTINCT FROM OLD.actor               THEN 'actor' END,
    CASE WHEN NEW.created_at          IS DISTINCT FROM OLD.created_at          THEN 'created_at' END);

  IF v_bad IS NOT NULL AND v_bad <> '' THEN
    RAISE EXCEPTION '這些欄位不可變更:%(可改的只有 note / payer_note / reviewed_by / reviewed_at;更正走沖銷,不是改列)',
                    v_bad
      USING ERRCODE = 'P2B34', CONSTRAINT = 'pcm_op2b_immutable_violation';
  END IF;

  RETURN NEW;
END
$function$;

-- 兩支 RPC 回到本次之前的簽章與本體(本體 = 正式庫 2026-10-01 唯讀原文)。
-- COMMENT:取現在的說明, 去掉本次補的那一段「報價單Q1 2026-10-01:…」再接回。
CREATE TEMP TABLE _q1_fn_comment ON COMMIT DROP AS
  SELECT p.proname::text AS fn,
         pg_catalog.regexp_replace(pg_catalog.obj_description(p.oid, 'pg_proc'), E'\n\n報價單Q1 2026-10-01:.*$', '') AS cmt
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('admin_record_manual_payment', 'admin_record_manual_refund');

DROP FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text, text, integer);
CREATE FUNCTION public.admin_record_manual_payment(p_order_id uuid, p_request_id uuid, p_actor text, p_rail text, p_amount integer, p_received_at timestamp with time zone, p_bank_reference text DEFAULT NULL::text, p_payer_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- 業務拒絕單一通用訊息(PF-E 同款:不洩訂單狀態);輸入類與政策類另給具體訊息,理由見各處。
  v_generic_msg constant text := 'admin_record_manual_payment: 收款登錄失敗';
  -- ── 稽核 P0-2(20260915234000):逾期自動取消的匯款單補登記 ──────────────────────
  --    plan docs/plans/2026-09-15-expired-bank-order-late-registration-plan.md(R3,Sean 2026-09-15 批)
  v_disposition    text;                  -- NULL = 一般收款;'revive' = 期限內復活;'refund' = 期限後 / 客人已另下新單 ⇒ 開待退款
  v_due_at         timestamptz;           -- pcm_bank_transfer_due_at(created_at)
  v_new_order      boolean := false;      -- Sean Q2 乙:期限後同客人另下、未取消的單
  v_revive_n       integer;               -- 🔴 刻意不共用 v_n(同 v_audit_n 的理由:既有 harness 以 v_n 首次命中當順序錨)
  v_verdict        text;
  v_after_status   public.payment_status;
  v_replay_revived boolean;
  v_replay_refund  boolean;
  v_replay_new     boolean;
  v_con            text;
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
  SELECT o.id, o.created_at, o.cancelled_at, o.payment_status,
         o.cancelled_reason, o.payment_channel, o.customer_user_id   -- 稽核 P0-2:分流樹要用(codex plan R2 S7)
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;   -- 不洩「這張單存不存在」
  END IF;

  -- ══ G8 冪等樹(先查再走,不靠撞 unique)═══════════════════════════════════
  -- 🔴 稽核 P0-2(20260915234000):本段從 G7 之後【搬到 G5 之後、G6 之前】(plan §7.2)——
  --    否則「期限後開待退款」那條重送會先撞 G6 的「不是乾淨單」、待退款結清後重送會先撞 P2B41。
  --    重放在 INSERT 之前就 RETURN ⇒ 搬前面不會多寫任何一筆收款。
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

      -- 🔴 稽核 P0-2:重放回【當初的處置】,不從當下狀態猜(首次復活之後單已是活的,狀態猜不回來)。
      --    兩列稽核都綁這一筆收款的 id:復活列 target = order:<id> 且 after.payment_id = 本筆;
      --    收款列 target = payment:<本筆 id>。冪等鍵只在同一張單內唯一 ⇒ 不綁 id 會讀到別張單同鍵的處置。
      --    本片之前登記的收款沒有這些欄 ⇒ 一律 false。
      v_replay_revived := EXISTS (
        SELECT 1 FROM public.admin_audit_log a
         WHERE a.action = 'order.revive_expired'
           AND a.target = 'order:' || p_order_id::text
           AND a.request_id = p_request_id::text
           AND a.after ->> 'payment_id' = v_existing.id::text);
      SELECT COALESCE(a.after ->> 'expiry_disposition' = 'refund_opened', false),
             COALESCE((a.after ->> 'new_order_exists')::boolean, false)
        INTO v_replay_refund, v_replay_new
        FROM public.admin_audit_log a
       WHERE a.action = 'payment.record'
         AND a.target = 'payment:' || v_existing.id::text
         AND a.request_id = p_request_id::text
       ORDER BY a.created_at
       LIMIT 1;
      RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', true,
                                           'payment_id', v_existing.id,
                                           'revived', v_replay_revived,
                                           'refund_opened', COALESCE(v_replay_refund, false),
                                           'new_order_exists', COALESCE(v_replay_new, false));
    END IF;
    -- 🔴 稽核 P0-2(codex plan R2 M1):同鍵不同內容 = 那把鍵下【確定】已有一筆入帳 ⇒ 具名碼 P2B53,
    --    app 層不給「開始下一筆」(換鍵重送 = 第二筆入帳)。舊一代這裡是通用訊息 P0001。
    RAISE EXCEPTION 'admin_record_manual_payment: 同一把送出鍵已經登記過一筆內容不同的收款(那一筆已經入帳)'
      USING ERRCODE = 'P2B53', CONSTRAINT = 'pcm_p02_request_id_content_conflict';
  END IF;

  -- ══ G6 取消守門 + 狀態 allowlist ═════════════════════════════════════════
  -- 🔴 **只擋整單取消**(`orders.cancelled_at`)—— Fable/codex R3 抓到我抄錯先例:
  --    OP3 的守門是「確認整筆付款」語意,連「有任何 order_cancellations 列」都擋;
  --    但 §5.1b 契約寫死**部分取消不動 `orders.cancelled_at`**、那張單**還活著、還會收後續款**
  --    ⇒ 照抄 OP3 會把合法的後續收款全拒。⇒ 部分取消單放行。
  -- 🔴🔴 稽核 P0-2(20260915234000,Sean 2026-09-15 拍乙;範圍縮小「這次只做匯款單」):
  --    整單取消不再一律拒 —— 【逾期自動取消的匯款單】且【乾淨】才放行(plan §3 分流樹):
  --      B  cancelled_reason = 'payment_expired'(機器碼,員工打不進去:20260903093000)
  --         且 payment_channel = 'bank_transfer' 且 p_rail = 'bank_transfer' 且 payment_status = 'unpaid'
  --      B1 不乾淨 ⇒ P2B51 · B2 乾淨且 received_at < 期限且沒有新單 ⇒ 復活 · B3 乾淨且(期限後或有新單)⇒ 入帳 + 開待退款
  --      C  逾期取消而是現金單或現金補登 ⇒ P2B54 · D 其他整單取消(員工取消 / superseded_by_card …)⇒ P2B52
  --    🔴 這一拍取代 20260809160000:6 的「Q2=A 不復活」,只限這條路、只限乾淨匯款單。
  --    具體訊息(不是通用訊息)的理由同下面退款態那段:呼叫者已過 actor 閘、是後台員工。
  IF v_order.cancelled_at IS NOT NULL THEN
    IF v_order.cancelled_reason IS DISTINCT FROM 'payment_expired' THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 這張單不是逾期自動取消的,不能補登記收款'
        USING ERRCODE = 'P2B52', CONSTRAINT = 'pcm_p02_cancelled_not_expired';
    END IF;
    IF v_order.payment_channel = 'cash' OR p_rail = 'cash' THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 現金單逾期取消後補登請管理者人工處理'
        USING ERRCODE = 'P2B54', CONSTRAINT = 'pcm_p02_expired_cash_manual';
    END IF;
    IF v_order.payment_channel IS DISTINCT FROM 'bank_transfer'
       OR v_order.payment_status IS DISTINCT FROM 'unpaid'::public.payment_status THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 這張單不是逾期自動取消的匯款單,不能補登記收款'
        USING ERRCODE = 'P2B52', CONSTRAINT = 'pcm_p02_cancelled_not_expired';
    END IF;

    -- 🔴 客人層級 advisory lock(plan §7.1):key 與 create_order(20260915100000:262)、
    --    admin_create_manual_order(20260915233000)、begin_charge_attempt(20260904050000)逐字同一個算法。
    --    鎖序 = 訂單列(上面 G5)→ 客人鎖,與 begin_charge_attempt 同向;下面的乾淨判定與新單判定都在拿到鎖之後。
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));

    -- B1 乾淨單(plan §3.1 c1–c7):任一條不成立 ⇒ 不自動處理
    IF EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = p_order_id)                        -- c1 含沖銷列與被沖列
       OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)                 -- c2
       OR EXISTS (SELECT 1 FROM public.order_cancellation_items ci WHERE ci.order_id = p_order_id)          -- c2
       OR EXISTS (SELECT 1 FROM public.coupon_redemptions r WHERE r.order_id = p_order_id)                 -- c3 含已退回
       OR EXISTS (SELECT 1 FROM public.order_pending_refunds pr WHERE pr.order_id = p_order_id)            -- c4 含作廢 / 結清
       OR EXISTS (SELECT 1 FROM public.order_manual_refunds mr WHERE mr.order_id = p_order_id)             -- c5
       OR EXISTS (SELECT 1 FROM public.email_outbox e
                   WHERE e.order_id = p_order_id AND e.event_type = 'order_created')                        -- c6 不論 status
       OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                   WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN                             -- c7
      RAISE EXCEPTION 'admin_record_manual_payment: 這張單有歷史紀錄,請管理者人工處理'
        USING ERRCODE = 'P2B51', CONSTRAINT = 'pcm_p02_expired_has_history';
    END IF;

    v_due_at := public.pcm_bank_transfer_due_at(v_order.created_at);
    -- Sean Q2 乙:期限【之後】同客人另下、未取消的單 ⇒ 不復活。界用 due_at 不用 cancelled_at(排程會晚 0–59 分,plan §3.2)。
    v_new_order := EXISTS (
      SELECT 1 FROM public.orders n
       WHERE n.customer_user_id = v_order.customer_user_id
         AND n.id <> p_order_id
         AND n.created_at >= v_due_at
         AND n.cancelled_at IS NULL);
    IF p_received_at < v_due_at AND NOT v_new_order THEN
      v_disposition := 'revive';
    ELSE
      v_disposition := 'refund';
    END IF;
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

  -- ══ 稽核 P0-2 B2:復活 —— 【一定在 G9 INSERT 之前】═══════════════════════════════
  -- 🔴 對調的話 INSERT 觸發的狀態重算會看到「還是取消的」⇒ 開待退款、不翻狀態(plan §5.1;verify 突變格證)。
  --    兩欄都清:結算判準 P2 同時看 cancelled_at 與 cancelled_reason(20260907170000:224-227)。
  IF v_disposition = 'revive' THEN
    UPDATE public.orders o
       SET cancelled_at = NULL, cancelled_reason = NULL, updated_at = pg_catalog.now()
     WHERE o.id = p_order_id
       AND o.cancelled_at IS NOT NULL
       AND o.cancelled_reason = 'payment_expired';
    GET DIAGNOSTICS v_revive_n = ROW_COUNT;
    IF v_revive_n <> 1 THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 復活訂單落 % 列(期望恰 1)⇒ 整筆回滾', v_revive_n
        USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_p02_revive_row_count';
    END IF;
  END IF;

  -- ══ G9 落帳(append 一列;**本句不碰 orders**;P0-2 復活那一段在上面)════════════════════════════════
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

  -- ══ 稽核 P0-2:事後判定(plan §5.2、§6)═══════════════════════════════════════════
  IF v_disposition = 'revive' THEN
    -- 🔴 驗 verdict 與狀態【兩個都要】:重算把例外吞掉時 verdict 可能是 settled 而狀態仍是 unpaid。
    v_verdict := public.admin_compute_order_settlement(p_order_id) ->> 'verdict';
    SELECT o.payment_status INTO v_after_status FROM public.orders o WHERE o.id = p_order_id;
    IF NOT COALESCE(
         (v_verdict = 'settled'   AND v_after_status = 'paid'::public.payment_status)
      OR (v_verdict = 'underpaid' AND v_after_status = 'partiallyPaid'::public.payment_status)
      OR (v_verdict = 'overpaid'  AND v_after_status = 'unpaid'::public.payment_status), false) THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 這張單有歷史紀錄,請管理者人工處理(結算判定 = %,付款狀態 = %)',
                      COALESCE(v_verdict, '<null>'), v_after_status
        USING ERRCODE = 'P2B51', CONSTRAINT = 'pcm_p02_revive_settlement_unclear';
    END IF;
  ELSIF v_disposition = 'refund' THEN
    -- 🔴 驗【完整列集合】:這張單恰 1 列待退款,而且就是 (bank_transfer, 本筆金額, 活著)。
    --    重算把開列失敗吞成 incident 就繼續(20260905290000)⇒ 不驗會出現「錢入帳、沒有待退款、畫面說成功」。
    --    恰 1 列只在乾淨單上是不變量(c1 + c4 保證開之前 0 列、只有一軌)。
    IF (SELECT pg_catalog.count(*) FROM public.order_pending_refunds r WHERE r.order_id = p_order_id) <> 1
       OR NOT EXISTS (SELECT 1 FROM public.order_pending_refunds r
                       WHERE r.order_id = p_order_id AND r.rail = 'bank_transfer'
                         AND r.amount_at_cancel = p_amount
                         AND r.voided_at IS NULL AND r.settled_at IS NULL) THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 期限後入帳沒有開出恰好一列對得上的待退款 ⇒ 整筆回滾(收款也不會留)'
        USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_p02_late_refund_row_set';
    END IF;
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
       'has_payer_note', v_payer_note IS NOT NULL)
     -- 稽核 P0-2:補登記那兩條路多記三個鍵(重放靠它還原當初處置,plan §7.2);一般收款與上一代逐欄相同。
     || CASE WHEN v_disposition IS NULL THEN '{}'::jsonb
             ELSE pg_catalog.jsonb_build_object(
                    'expiry_disposition', CASE v_disposition WHEN 'revive' THEN 'revived' ELSE 'refund_opened' END,
                    'due_at', v_due_at,
                    'new_order_exists', v_new_order)
        END,
     NULL,  -- 表單沒有原因欄
     'admin');
  GET DIAGNOSTICS v_audit_n = ROW_COUNT;
  IF v_audit_n <> 1 THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 稽核落 % 列(期望恰 1)⇒ 這筆收款會變成沒有'
                    '「誰登的」紀錄。成因通常是 admin_audit_log 上有 BEFORE INSERT trigger 回了 NULL。'
                    '本交易整筆回滾(收款也不會留)', v_audit_n
      USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_op5_audit_row_count';
  END IF;

  -- ══ 稽核 P0-2:復活稽核列 ——「這張單曾經逾期取消過」只活在這一列裡(orders 兩欄已清)══
  IF v_disposition = 'revive' THEN
    INSERT INTO public.admin_audit_log
      (actor, action, target, request_id, before, after, reason, source_app)
    VALUES
      (p_actor, 'order.revive_expired', 'order:' || p_order_id::text, p_request_id::text,
       pg_catalog.jsonb_build_object('cancelled_at', v_order.cancelled_at,
                                     'cancelled_reason', v_order.cancelled_reason),
       pg_catalog.jsonb_build_object('cancelled_at', NULL::timestamptz,
                                     'payment_id', v_payment_id,
                                     'received_at', p_received_at,
                                     'due_at', v_due_at,
                                     'verdict', v_verdict),
       NULL, 'admin');
    GET DIAGNOSTICS v_audit_n = ROW_COUNT;
    IF v_audit_n <> 1 THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 復活稽核落 % 列(期望恰 1)⇒ 整筆回滾', v_audit_n
        USING ERRCODE = 'P2B40', CONSTRAINT = 'pcm_p02_revive_audit_row_count';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('recorded', true, 'idempotent', false,
                                       'payment_id', v_payment_id,
                                       'revived', COALESCE(v_disposition, '') = 'revive',
                                       'refund_opened', COALESCE(v_disposition, '') = 'refund',
                                       'new_order_exists', v_new_order);

EXCEPTION
  -- 🔴 真並發 backstop:同 `(order_id, request_id)` 的第二支在 G8 讀不到對方**未提交**的列,
  --    走到 INSERT 撞 `order_payments_request_id_uniq`。⚠️ 常態並發其實會先卡在 G5 的
  --    `orders FOR UPDATE`(同單序列化)⇒ 第二支醒來時多半在 G8 就看到既有列、走冪等樹。
  --    **這條 handler 是 backstop,不是主要路徑** —— 口徑照 harness 實測寫,不憑推論。
  WHEN unique_violation THEN
    -- 🔴 稽核 P0-2(codex TS 片 R1):只有撞到 order_payments_request_id_uniq(同單同鍵)才是「那一筆已經入帳」;
    --    其他唯一鍵撞到(例:待退款那支部分唯一索引)照舊通用訊息 —— 講成已入帳會是假話。
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'order_payments_request_id_uniq' THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 同一把送出鍵已經登記過一筆收款(並發重送)'
        USING ERRCODE = 'P2B53', CONSTRAINT = 'pcm_p02_request_id_content_conflict';
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text) TO service_role;

DROP FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean, text);
CREATE FUNCTION public.admin_record_manual_refund(p_order_id uuid, p_request_id uuid, p_actor text, p_rail text, p_refund_amount integer, p_reason text, p_occurred_at timestamp with time zone, p_confirm_card_not_refunded boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_order      record;
  v_existing   record;
  v_remaining  bigint;
  v_id         uuid;
  v_n          integer;
  v_has_card   boolean;
  v_pending    record;   -- ⟦Q2 甲⟧ 同單同軌那一列未結待退款
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

  -- 🔴🔴 ⟦Q2 甲⟧(20260916130000):結清同單同軌的未結待退款。
  --    · 同單同軌未結最多一列(order_pending_refunds_live_order_rail_key)。
  --    · 相等 ⇒ 結清;退得少 ⇒ 結清 + 差額另開一列(同 cancellation_id);退得多 ⇒ 只結清,多的不猜。
  --    · 🔴 被結清那列保留原 amount_at_cancel(分次退時結清列合計 > 實退)⇒ **不要 SUM 已結清列當「已退」**;
  --      已退看 order_manual_refunds。作廢那一支靠 LEAST() 取回真正結掉的份。
  --    · 冪等重送在步4.5 就 RETURN 了 ⇒ 走不到這裡,不會結兩次。
  --    · 鎖:步4 已持 orders FOR UPDATE;寫待退款的另外兩支(recompute / 整單取消 trigger)也是先鎖 orders。
  SELECT r.id, r.cancellation_id, r.amount_at_cancel
    INTO v_pending
    FROM public.order_pending_refunds r
   WHERE r.order_id = p_order_id AND r.rail = p_rail
     AND r.settled_at IS NULL AND r.voided_at IS NULL
     FOR UPDATE;
  IF FOUND THEN
    UPDATE public.order_pending_refunds
       SET settled_at = pg_catalog.now(), settled_manual_refund_id = v_id
     WHERE id = v_pending.id AND settled_at IS NULL AND voided_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'admin_record_manual_refund: 結清待退款影響 % 列(期望恰 1)⇒ 停下', v_n;
    END IF;
    IF p_refund_amount < v_pending.amount_at_cancel THEN
      INSERT INTO public.order_pending_refunds (order_id, cancellation_id, rail, amount_at_cancel)
      VALUES (p_order_id, v_pending.cancellation_id, p_rail, v_pending.amount_at_cancel - p_refund_amount);
    END IF;
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
$function$;
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean) TO service_role;

DO $cmt$
DECLARE v text;
BEGIN
  SELECT cmt INTO v FROM _q1_fn_comment WHERE fn = 'admin_record_manual_payment';
  EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text) IS %L', v);
  SELECT cmt INTO v FROM _q1_fn_comment WHERE fn = 'admin_record_manual_refund';
  EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean) IS %L', v);
END
$cmt$;

CREATE OR REPLACE FUNCTION public.pcm_d3d_manual_refund_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_bad text;
BEGIN
  -- ── ① 帳體:一律不可變 ────────────────────────────────────────────────
  --    🔴 逐欄列出,不用「除了 allowlist 以外」的動態寫法。理由見檔頭。
  --    ⚠️ `request_id` 也在裡面 —— 它是 `20260820021000:128` 後加的 NOT NULL 欄,
  --       **建表那支裡沒有它**。(「這張表長怎樣」的分母,是所有寫過它的 migration。)
  v_bad := pg_catalog.concat_ws(', ',
    CASE WHEN NEW.id            IS DISTINCT FROM OLD.id            THEN 'id' END,
    CASE WHEN NEW.order_id      IS DISTINCT FROM OLD.order_id      THEN 'order_id' END,
    CASE WHEN NEW.rail          IS DISTINCT FROM OLD.rail          THEN 'rail' END,
    CASE WHEN NEW.refund_amount IS DISTINCT FROM OLD.refund_amount THEN 'refund_amount' END,
    CASE WHEN NEW.reason        IS DISTINCT FROM OLD.reason        THEN 'reason' END,
    CASE WHEN NEW.actor         IS DISTINCT FROM OLD.actor         THEN 'actor' END,
    CASE WHEN NEW.occurred_at   IS DISTINCT FROM OLD.occurred_at   THEN 'occurred_at' END,
    CASE WHEN NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN 'created_at' END,
    CASE WHEN NEW.request_id    IS DISTINCT FROM OLD.request_id    THEN 'request_id' END,
    -- 🔴🔴 **[⟦b4-CAPRACE1⟧ 2026-09-07] 新欄位必須進這個清單, 而那是【硬性的】。**
    --    本函式**逐欄列舉**(它自己的註解逐字:「逐欄列出, 不用『除了 allowlist 以外』的動態寫法」)
    --    ⇒ 📌 **新欄位【預設不受保護】** —— 不加進來, over_cap_by / cap_state 就是這張金流帳本上
    --    **唯一可以事後 UPDATE 改掉的欄位**, 而改它 = 把「這筆超收過」抹掉。
    CASE WHEN NEW.over_cap_by   IS DISTINCT FROM OLD.over_cap_by   THEN 'over_cap_by' END,
    CASE WHEN NEW.cap_state     IS DISTINCT FROM OLD.cap_state     THEN 'cap_state' END);

  IF v_bad IS NOT NULL AND v_bad <> '' THEN
    RAISE EXCEPTION
      '人工退款登記的這些欄位不可變更:%。'
      '🔴 帳不塗改 —— 登錯了請用「作廢」,再另外登一筆新的;改列等於繞過 append-only。',
      v_bad
      USING ERRCODE = 'P2B45', CONSTRAINT = 'pcm_d3d_immutable_violation';
  END IF;

  -- ── ② 作廢是終態:已作廢的列,那三欄一個字都不能再動 ────────────────────
  --    🔴 這一格就是 Sean 那句話本身。它同時擋掉兩種形狀:
  --      · **復活**(`voided_at` 非 NULL ⇒ NULL)
  --      · **改作廢理由 / 改作廢的人**(那是塗改稽核痕跡,比復活更難發現)
  --    ⚠️ 表上的 `order_manual_refunds_void_trio` CHECK 只保證三欄**三向配對**
  --       (`num_nonnulls(...) IN (0,3)`,`20260820090000:115`)——
  --       它**擋不住把三欄一起清掉**(0 也在允許集合裡)。⇒ 那正是本格要擋的。
  IF OLD.voided_at IS NOT NULL THEN
    v_bad := pg_catalog.concat_ws(', ',
      CASE WHEN NEW.voided_at   IS DISTINCT FROM OLD.voided_at   THEN 'voided_at' END,
      CASE WHEN NEW.void_reason IS DISTINCT FROM OLD.void_reason THEN 'void_reason' END,
      CASE WHEN NEW.voided_by   IS DISTINCT FROM OLD.voided_by   THEN 'voided_by' END);

    IF v_bad IS NOT NULL AND v_bad <> '' THEN
      RAISE EXCEPTION
        '這一筆已經作廢了,作廢紀錄不能再改(你動到的是:%)。'
        '🔴 Sean 2026-08-30 拍板:**不能改回「有退過」,要另外開一筆新的更正紀錄(帳不塗改)**。'
        '⇒ 若這筆退款其實真的發生了,請用 admin_record_manual_refund **登一筆新的**,'
        '作廢的這一列原樣留著。'
        '🔴🔴 **而那一筆【必須用新的 request_id】** —— 沿用原本那把會【什麼都不做而回報成功】:'
        'admin_record_manual_refund 的冪等格是 (order_id, request_id) 且**不濾 voided_at**'
        '(20260823020000:394-403)⇒ 它會命中那個已作廢的列、回 idempotent:true, '
        '而後台把 idempotent 當成功顯示(manual-refund-actions.ts:150)⇒ **一列都沒寫、帳仍是沒退過**。'
        '⚠️ 而若你只改了內容(例如換個理由), 會撞到它的同鍵不同內容拒絕, '
        '那則訊息逐字叫你「不要用新的 request_id」—— **那句話的前提是「你在重送同一筆」, '
        '不涵蓋「原本那筆被作廢了」這個情況。**'
        '⇒ 補登完請核 pcm_order_refundable_remaining 是否回到預期值(D1 明文不擋'
        '「同一筆錢用不同 request_id 登兩次」, 20260820021000:333-335 ⇒ 那一半只有對帳看得到)。',
        v_bad
        USING ERRCODE = 'P2B46', CONSTRAINT = 'pcm_d3d_void_is_terminal';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

DROP FUNCTION public.admin_revenue_between(timestamptz, timestamptz);

-- 未收款自動取消:回到本次之前(正式庫原文)
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
       -- 🔴🔴 **2026-09-06 日界(Sean 逐字「乙」:「第 5 天整天都算, 隔天 00:00 才取消」)**
       --    ⛔ ~~原本是 `AND o.created_at < pg_catalog.now() - CASE o.payment_channel …`~~ **作廢** ——
       --      那是**時戳比較** ⇒ 9/5 12:00 下單的匯款單, 9/10 12:00 之後任一整點就可能被取消,
       --      而客人畫面上寫的是「9 月 10 日(**含**)之前」
       --      (`packages/domain/src/order/remittance-info.ts:127` 逐字 `請於 ${label}(含)之前完成匯款,逾期訂單將自動取消。`)
       --      ⇒ 📌 **文案與述詞在【第 5 天當天下午】那一段是矛盾的, 而兩邊各自都讀得通。**
       --    ✅ 現在的判準:**下單那一天(台北日曆日)+ N 天 + 1 天的 00:00(台北)**。
       --      驗算 N=5:9/5 任何時刻下單 ⇒ 日曆日 9/5 ⇒ +5 天 = 9/10 ⇒ +1 天 = **9/11 00:00 取消**
       --      ⇒ 9/10 整天有效 ⇒ 與畫面上那一句逐格對齊。
       -- 🛑 **`tappay` 不在下面那個 CASE 裡, 而那是刻意的**(主視窗 `-f8` 2026-09-06 裁【甲】):
       --    ① Sean 那題的主詞是**匯款**, 刷卡沒有「(含)之前」那句話可以對齊
       --    ② 刷卡棄單多活 24h 會多佔住「同車只能有一張活單」那道守門(⟦b4-BANKCARDRACE⟧ / 20260906500000)
       --    ③「不改」= 現況 = 不需要任何人拍板;「改」才是新行為。
       --    ⇒ 🔵 `tappay` 走 THEN 那一支, 維持原本的時戳比較。
       -- 🔵 **新界不早於舊界 —— 而這句話有【射程】, 不是全稱**(codex R1 #12/#13 打回第一版)
       --    量到的:2026-09-06 對正式庫跑純運算式 SELECT(唯讀零寫入, `scripts/readonly-prod-sql.sh`),
       --    六個 2026 年的下單時刻 ⇒ `新界 − 舊界` 全為正:
       --    00:00 ⇒ `1 day` · 00:01 ⇒ `23:59:00` · 12:00 ⇒ `12:00:00` · 23:59 ⇒ `00:01:00`
       --    · 2026-03-01 07:30 ⇒ `16:30:00` · 2026-12-31 22:15 ⇒ `01:45:00`
       --    ⛔ ~~原本寫「**沒有任何一張單**會提早被取消」「最多多活 24 小時」~~ **作廢** ——
       --      🔴 那是**全稱句**, 而它在【下單當天到期日之間有日光節約轉換】時不成立:
       --        台灣 1945-1961 年實施過夏令時間 ⇒ 那種輸入下新界可比舊界**早 30 分鐘**
       --        (codex R1 構造出 `1946-05-10` 那一發)。
       --    ✅ 正確字面:**`新界 − 舊界 = 1 天 − 下單當天的時刻`, 前提是那段區間內台北沒有 UTC 偏移變動。**
       --      🔵 台灣**自 1980 年起沒有再實施夏令時間** ⇒ 對 `orders.created_at` 的實際取值域
       --        (2026 年)這個前提成立;而**它是前提不是定理**, 未來若恢復 DST 要回來看這一格。
       --    🟢 同一發的正對照:六列邊界表兩欄都同時出現 t 與 f;🔵 負對照:channel 餵 NULL ⇒ 兩欄皆非 t。
       -- ⚠️ 代價明寫:`created_at` 被包進函式 ⇒ 比舊版更難用索引。現況存量小(正式庫 orders 2 列)、
       --    每小時一次(`20260809170000:77` 逐字 `'0 * * * *'`)⇒ 可接受。真的長起來時的修法 =
       --    加前置粗篩 `AND o.created_at < pg_catalog.now() - interval '1 day'`(對所有可取消的列恆真 ⇒ 不改語意)。
       --    **本片不加** —— 為一個量不到的問題付複雜度。
       -- 🛑 內層 CASE **沒有 ELSE** ⇒ 白名單以外的 channel 會得到 NULL ⇒ `now() >= NULL` 是 NULL
       --    ⇒ **不取消**。方向與上面那條白名單一致:不失效可逆, 失效不可逆。
       AND CASE o.payment_channel
             WHEN 'tappay' THEN o.created_at < pg_catalog.now() - interval '1 day'  -- 🔵 逐字不動(Sean 2026-08-09「1天」)
             ELSE pg_catalog.now() >= pg_catalog.timezone(
                    'Asia/Taipei',
                    pg_catalog.date_trunc('day', pg_catalog.timezone('Asia/Taipei', o.created_at))
                      + CASE o.payment_channel
                          WHEN 'bank_transfer' THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「乙 5天」
                          WHEN 'cash'          THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」
                        END
                      + interval '1 day'                                -- 🔴 Sean 2026-09-06 逐字「隔天 00:00 才取消」
                  )
           END
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

-- 收款明細:回到本次之前(正式庫原文)
CREATE OR REPLACE FUNCTION public.admin_list_order_payments(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 🔴 **快照一致性來自 `STABLE`,不是來自「只有一句」**(關卡2 codex 更正我原本寫的理由):
  --    `LANGUAGE sql` **不保證**單一 statement;而 STABLE 函式裡的每一句都共用**呼叫查詢的快照**
  --    ⇒ 就算日後變成多句,函式內仍看到同一個快照。
  --    ⇒ 檔尾對 `prolang` 的斷言**不是**在證「單句」,它證的是「沒被換成 plpgsql」
  --      (plpgsql 的 VOLATILE 子查詢會各自取快照)。原本那句「單一 statement ⇒ 一個快照」是**錯的推論**。
  -- 🔴 每個名稱全限定 `public.…`:`search_path = ''` 只讓未限定名稱**壞掉**,不等於保護。
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id)
      THEN NULL                     -- 訂單不存在:回 NULL,不造一個假的空陣列
    ELSE COALESCE(
      (SELECT pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'id',                  p.id,
                  'rail',                p.rail,
                  'amount',              p.amount,
                  'received_at',         p.received_at,
                  'created_at',          p.created_at,
                  'actor',               p.actor,
                  'bank_reference',      p.bank_reference,
                  'rec_trade_id',        p.rec_trade_id,
                  -- 🔴 是 `payer_note` 不是 `note`:OP5 的 INSERT 欄位表逐字
                  --    `(order_id, rail, amount, received_at, bank_reference, request_id, payer_note, actor)`
                  --    ⇒ **員工在表單打的備註存進 payer_note,`note` 這欄 OP5 根本不寫**。
                  --    讀錯欄的症狀是每一筆都顯示「無備註」,而員工明明打了字。
                  'payer_note',          p.payer_note,
                  'reverses_payment_id', p.reverses_payment_id,
                  'reversal_reason',     p.reversal_reason,
                  -- 🔴 具名旗標,呼叫端**不准用正負號判斷是不是沖銷**:
                  --    「沖銷之沖銷」的金額可以是正的(`20260810100000` 檔頭逐字:500−500+500=500)
                  --    ⇒ 看正負會把一筆沖銷讀成收款。
                  'is_reversal',         (p.reverses_payment_id IS NOT NULL)
                )
                -- 🔴 排序寫在**聚合函式裡面**:子查詢的 ORDER BY 不保證聚合結果的順序。
                --    三段是決定性排序 —— 同一秒入帳兩筆時少了 `id` 這個 tie-breaker,
                --    畫面順序會在兩次重整之間跳動,而員工正拿它跟銀行對帳。
                ORDER BY p.received_at DESC, p.created_at DESC, p.id DESC)
         FROM public.order_payments p
        WHERE p.order_id = p_order_id),
      '[]'::jsonb)                  -- 存在但零收款:`jsonb_agg` 回 NULL ⇒ 收斂成空陣列
  END
$function$;

DROP TRIGGER order_payments_fee_snapshot_bi ON public.order_payments;
DROP FUNCTION public.pcm_order_payment_fee_snapshot();
DROP FUNCTION public.pcm_payment_fee_rate(text, timestamptz);

ALTER TABLE public.order_manual_refunds DROP CONSTRAINT order_manual_refunds_instrument_check;
ALTER TABLE public.order_manual_refunds DROP COLUMN payment_instrument;
-- 建單 RPC:回到貼板 261 之後、本次之前(正式庫原文);COMMENT 去掉本次補的那一段再接回。
CREATE TEMP TABLE _q1_create_comment_rb ON COMMIT DROP AS
  SELECT pg_catalog.obj_description('public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb, text, text, jsonb, text, text, text, integer)'::regprocedure, 'pg_proc') AS cmt;
ALTER TABLE public.orders DROP CONSTRAINT orders_shopee_source_instrument_check;
DROP FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb, text, text, jsonb, text, text, text, integer);
CREATE OR REPLACE FUNCTION public.admin_create_manual_order(p_customer_user_id uuid, p_manual_request_id uuid, p_actor text, p_order_source text, p_payment_channel text, p_shipping_method text, p_ship_to jsonb, p_invoice jsonb, p_shipping_fee integer, p_lines jsonb, p_notification_email text DEFAULT NULL::text, p_tier text DEFAULT NULL::text, p_vehicle jsonb DEFAULT NULL::jsonb, p_shopee_username text DEFAULT NULL::text, p_shopee_order_no text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- 20260926100000:停用的會員不能建單
  v_disabled_at timestamptz;
  -- 第 9 代:白名單重組後的車輛快照(只收 kind / brand / model / raw / year;source 由本函式決定)。
  v_vehicle     jsonb := NULL;
  v_veh_year    integer;
  v_veh_key     text;
  v_veh_brand   text;
  v_veh_model   text;
  v_veh_raw     text;
  v_line        jsonb;
  v_qty         integer;
  v_unit_price  integer;
  v_sku         text;
  v_title       text;
  v_spec        jsonb;
  v_variant_id  uuid;
  v_line_total  bigint;
  v_subtotal    bigint := 0;
  v_total       bigint;
  -- 🔴 **第 6 代新增**:稅額。`bigint` 與 `v_subtotal`/`v_total` 同族, 溢位在同一道閘擋。
  v_tax         bigint;
  -- 🔴 **這個值出現在兩個地方**(INSERT 的值列 + audit payload)⇒ 收成一個變數。
  --    兩份字面會分岔, 而分岔時**沒有東西會叫** —— audit 說 inclusive 而資料是 exclusive。
  -- 🔴🔴 **第 7 代:它不再是 `constant`**(⟦b4-INVOICE5PCT⟧, Sean 2026-09-04 逐字
  --    「那如果我沒有勾選開發票價錢都不加」)⇒ 由 `v_invoice_requested` 決定, 見下方稅那一段。
  --    🛑 **拿掉 `constant` 這件事本身沒有守門** —— 它只是讓賦值合法;
  --       真正釘住「兩個世界各是什麼」的是那一段 `IF`, 與事後斷言③。
  v_price_tax_mode text;
  v_items       jsonb := '[]'::jsonb;
  -- 🔴🔴 **第 7 代新增:員工在每一列選的「未稅 / 含稅」—— 只為了記進稽核。**
  --    codex R3(2026-09-09 換模型換角度)打出來的那一條:沒勾開發票時兩種稅基**都不換算**
  --    ⇒ 「填 1,050 選含稅」與「填 1,050 選未稅」在資料庫裡**長得一模一樣**
  --    ⇒ 📌 三個月後退款爭議, 查不到他當初的意思。🛑 **不是 log 難找, 是那個資訊沒有被存下來。**
  --    ✅ Sean 2026-09-09 拍甲逐字:「先上, 而同一片多做一件:把他選的『未稅/含稅』記進稽核紀錄」。
  v_line_basis  text;
  v_line_bases  jsonb := '[]'::jsonb;
  -- 🔴🔴 **稽核要對得回 `order_items` 的【那一列】, 而唯一穩定的身分是它的 id。**
  --    ⛔ ~~第一版記 `line_key`(去重用的那把:料號|品名|單價|規格)~~ **codex R5 打掉它**:
  --      🔬 失敗情境逐字可構造:兩列合法代購, 料號品名規格相同而單價 1,000 / 1,200
  --      ⇒ 兩把 key 不同;而未開發票未付款的單**合法**可用 `admin_update_order_item_amount`
  --        把第一列改成 1,200 ⇒ 📌 **原本 1,000 那把對不到任何列, 原本 1,200 那把同時命中兩列。**
  --      🎯 **⇒ 它把一個【可以被改的值】當成身分的一部分。**
  --    ⛔ 而 `line_key` 還有第二個病:它明文含品名與規格(自由文字)⇒ 把員工輸入
  --      **多抄一份**進 append-only 的稽核表, 而那與本函式 G9 那段「少抄一份 = 少一個
  --      會過期、會外洩的副本」直接衝突。**我當時寫「不含敏感值」是錯的** —— 規格是自由文字。
  --    ✅ ⇒ 改成**自己生 id、明確寫進 `order_items`**, 稽核只記那個 id + 稅基 + 單價。
  --      🔵 **不動表結構**(`order_items.id` 本來就是 uuid 主鍵, 只是原本走 DEFAULT)。
  --      🔵 **不進冪等指紋** —— 它不進 `v_items`(那是指紋的來源);重送在指紋比對那一步就
  --        早退了, 根本走不到這個 INSERT。
  v_item_id     uuid;
  v_item_ids    jsonb := '[]'::jsonb;
  v_ship_to     jsonb;
  v_invoice     jsonb;
  -- 🔴 第④代新增(`⟦b4-INVOICE5PCT⟧` 第 2 步):**這張單開不開發票**。
  --    🛑 與 `v_invoice` 是兩件事:那個講「開的話抬頭寫誰」, 本欄講「開不開」。
  v_invoice_requested boolean;
  -- 🔴 ⟦b4-INVOICE5PCT⟧二:含稅那一列的【原值】與【殘差】。
  v_line_taxed     integer;
  v_taxed_key      text;
  v_taxed_residual bigint := 0;
  v_untaxed_base   bigint := 0;
  v_tier        public.member_tier;
  v_display_id  text;
  v_order_id    uuid;
  v_existing    record;
  v_attempt     integer;
  v_cname       text;
  v_n           integer;
  -- codex R1 `:186`:跨列去重的累積器(形狀照 `create_order` `20260730120100:322-325`)
  v_seen        text[] := ARRAY[]::text[];
  v_key         text;
  -- codex R1 `:143`/`:248`:正規化後的整包輸入 + 它的指紋
  v_canonical   jsonb;
  v_payload_sha text;
  -- 🔴 `''` 必須收斂成 NULL:`orders_notification_email_valid`(`20260718120000:125-127`)的
  --    `~ '^[!-~]+$'` 對空字串**不成立** ⇒ 直接寫 `''` 會被 CHECK 擋、整張單建不出來。
  --    而員工「留白」送過來的就是 `''`(HTML 表單的空欄不是 NULL)。
  v_notification_email text;
  -- 貼板 261:蝦皮帳號與蝦皮訂單編號(Sean 2026-10-01 蝦皮帳號 Q1–Q4 甲)。
  v_shopee_username text;
  v_shopee_order_no text;
  v_shopee_owner    uuid;
  v_shopee_added    boolean := false;
  -- codex R1 `:138`:兩個**業務上限**。
  -- 🔴 **這兩個數字是我挑的,Sean 沒有拍過。** 挑法=比實務用量大一個數量級、
  --    又小到擋得住「一發打爆」:電話單實務上個位數筆、單筆數量兩位數。
  --    ⇒ 撞到它們的時候要**改這裡並問 Sean**,不要在呼叫端拆單繞過去。
  c_max_lines   constant integer := 50;
  c_max_qty     constant integer := 9999;
BEGIN
  -- ── G1 輸入:每一格各自一道,訊息講【哪一格】不講「輸入有誤」 ──────────────
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定客人(customer_user_id 是 NULL);拒絕建出無主單';
  END IF;
  IF p_manual_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 缺冪等鍵(manual_request_id);沒有它,重送會建出第二張單';
  END IF;
  -- 🔴🔴 F1(R3 f5):**憑空建單卻記不住是誰做的** —— 而「憑空建單」正是本片新增的能力。
  --    對照:退款登記那支(`20260820021000`)提到 actor **29 次**;本檔上一版**零次**。
  --    f5 的框架句(收下,不改寫):兩片一起上線之後,能力邊界變成
  --    「**有後台密碼的人可以造出一條完整的假金流鏈,而鏈上第一環查不出是誰做的**」
  --    (建單 → 灌假收款 → 退款,三片各自都說「那不歸我管」,而沒有一片說錯)。
  --    ⇒ 走 `admin_audit_log`,**不在 `orders` 加欄**(那張表本來就沒有 actor 欄,
  --      而 audit 是這個 repo 既有的、對的載體)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定經手人(actor);'
                    '手動單是憑空建出來的,**不知道是誰建的單不准建**';
  END IF;
  -- 🔴 FK 只擋「不存在」,**擋不到已停用的** ⇒ 這一道查 is_active(逐字同 `20260820021000:198-199`)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = pg_catalog.btrim(p_actor, E' \t\r\n') AND s.is_active) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 經手人 [%] 不是啟用中的員工 ⇒ 拒絕建單。'
                    '🔴 手動建單的失敗模式是【人】,而 actor 是唯一的線索 —— '
                    '拿一個查不到的名字建單,等於這張單沒有來源。', p_actor;
  END IF;
  IF p_order_source IS NULL OR p_order_source NOT IN ('manual_phone', 'manual_line', 'manual_other', 'manual_shopee') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 來源 [%] 不是手動來源之一', p_order_source;
  END IF;
  -- 🔴 具名拒 tappay:刷卡那條路由 TapPay 那一側寫,人工建單不得宣稱一筆卡片交易。
  IF p_payment_channel = 'tappay' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 手動單不得標記為線上刷卡(tappay);那條路由付款確認寫入';
  END IF;
  IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金流管道 [%] 不是 bank_transfer 或 cash', p_payment_channel;
  END IF;
  -- 第 8 代:會員等級白名單(Sean 2026-09-14 逐字「手動建立訂單的時候可以選擇車行會員還是經銷的選項才對」)。
  --    只改這張單的 tier_at_checkout, 客人帳號的等級不動(那只有 tier-edit 能改)。
  IF p_tier IS NOT NULL AND p_tier NOT IN ('general', 'store', 'premiumStore') THEN
    RAISE EXCEPTION USING MESSAGE =
      'admin_create_manual_order: 會員等級 [' || p_tier || '] 不是 general / store / premiumStore 之一';
  END IF;
  -- 第 9 代(#956 乙):車輛一格。形狀逐字沿用 order_items.vehicle_snapshot 的判別式(20260716180000):
  --   {kind:'dict', brand, model, year?} ⇒ 字典帶入;{kind:'free', raw, year?} ⇒ 員工照打(字典沒有)。
  --   🔴 白名單重組:只收那幾個鍵;`source` 不信 client, 由本函式寫 manual_dict / manual_text(後台看得出「這台不在字典」, 主視窗 2026-09-14 補點 (2))。
  --   year:省略 / NULL 可;有值必須是 1900-2100 的整數(字典年份不強制在 year_start-year_end 內, 08-28 plan 同句「年份維持自由填」)。
  IF p_vehicle IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_vehicle) <> 'object' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 車輛不是物件(%)', pg_catalog.jsonb_typeof(p_vehicle);
    END IF;
    -- 🔴 codex R1 must-fix ①③④:三個文字欄先驗【非 null 的值必須是 string】(->> 會把陣列 / 物件 / 數字文字化, `raw:123` 與 `raw:"123"` 會合成同一個指紋;缺 / null 由下面 dict·free 分支再驗必填),
    --    再修剪空格 / tab / CR / LF(btrim 預設只吃空格), 再驗非空 + 長度 ≤ 200(沿用顧客站車輛主閘那個上限);驗完的值同時進落表與指紋。
    FOR v_veh_key IN SELECT pg_catalog.unnest(ARRAY['brand', 'model', 'raw']) LOOP
      IF p_vehicle ? v_veh_key AND pg_catalog.jsonb_typeof(p_vehicle -> v_veh_key) NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'admin_create_manual_order: 車輛 % 要是字串(收到 %)', v_veh_key, pg_catalog.jsonb_typeof(p_vehicle -> v_veh_key);
      END IF;
    END LOOP;
    v_veh_brand := NULLIF(pg_catalog.btrim(p_vehicle ->> 'brand', E' \t\r\n'), '');
    v_veh_model := NULLIF(pg_catalog.btrim(p_vehicle ->> 'model', E' \t\r\n'), '');
    v_veh_raw   := NULLIF(pg_catalog.btrim(p_vehicle ->> 'raw',   E' \t\r\n'), '');
    IF pg_catalog.length(COALESCE(v_veh_brand, '')) > 200 OR pg_catalog.length(COALESCE(v_veh_model, '')) > 200 OR pg_catalog.length(COALESCE(v_veh_raw, '')) > 200 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 車輛欄位超過 200 字';
    END IF;
    v_veh_year := NULL;
    IF p_vehicle ? 'year' AND pg_catalog.jsonb_typeof(p_vehicle -> 'year') <> 'null' THEN
      IF pg_catalog.jsonb_typeof(p_vehicle -> 'year') <> 'number'
         OR (p_vehicle ->> 'year') !~ '^[0-9]{4}$'
         OR (p_vehicle ->> 'year')::integer NOT BETWEEN 1900 AND 2100 THEN
        RAISE EXCEPTION 'admin_create_manual_order: 車輛年份要是 1900-2100 的整數(收到 %)', p_vehicle -> 'year';
      END IF;
      v_veh_year := (p_vehicle ->> 'year')::integer;
    END IF;
    IF COALESCE(p_vehicle ->> 'kind', '') = 'dict' THEN
      IF v_veh_brand IS NULL OR v_veh_model IS NULL THEN
        RAISE EXCEPTION 'admin_create_manual_order: 字典車輛缺 brand / model';
      END IF;
      v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'kind', 'dict',
        'brand', v_veh_brand,
        'model', v_veh_model,
        'year', v_veh_year,
        'source', 'manual_dict'));
    ELSIF COALESCE(p_vehicle ->> 'kind', '') = 'free' THEN
      IF v_veh_raw IS NULL THEN
        RAISE EXCEPTION 'admin_create_manual_order: 照打的車輛缺 raw';
      END IF;
      v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'kind', 'free',
        'raw', v_veh_raw,
        'year', v_veh_year,
        'source', 'manual_text'));
    ELSE
      RAISE EXCEPTION 'admin_create_manual_order: 車輛 kind 要是 dict 或 free(收到 %)', COALESCE(p_vehicle ->> 'kind', '(缺)');
    END IF;
  END IF;
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;
  IF p_shipping_fee IS NULL OR p_shipping_fee < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 運費必須是 0 或正整數(收到 %)', p_shipping_fee;
  END IF;
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
     OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有品項;一張單至少要有一個品項';
  END IF;
  -- 🔴 codex R1 `:138`:**沒有上限的迴圈**。舊版靠「總額 > integer 上限」兜底,而那道
  --    對 `unit_price = 0` 的品項**零判別力** ⇒ 幾萬筆零元品項可以整包穿過去。
  IF pg_catalog.jsonb_array_length(p_lines) > c_max_lines THEN
    RAISE EXCEPTION 'admin_create_manual_order: 一張單最多 % 個品項(收到 %);超過請拆單,'
                    '或這個上限要調整 ⇒ 找系統維護(它是保守預設值、未經拍板)',
                    c_max_lines, pg_catalog.jsonb_array_length(p_lines);
  END IF;

  -- 🔴🔴 **冪等格搬到 G6 之後了**(codex R1 `:143`)。
  --    原本它在這裡 = 「鍵在就回成功」,**完全不看內容** ⇒ 同鍵裝不同內容時,
  --    員工以為新單建好了,實際拿到的是**舊那張單**。
  --    ⇒ 要比對內容,就必須**先把內容正規化完**(G4/G5/G6 做那件事)⇒ 冪等格只能排在它們之後。
  --    ⚠️ 排序安全性:重送同一包輸入時,G3-G6 全部是**決定性**的(同輸入同結果)
  --       ⇒ 不存在「完全相同的重試被前面某道閘誤擋」那個坑
  --       (退款 RPC `20260820021000:238-242` 踩過的正是那個坑,方向相反)。

  -- ── G3 客人必須存在(FK 也會擋,而這裡先擋是為了給員工看得懂的訊息) ────────
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = p_customer_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_create_manual_order: 找不到這位客人(user_id=%);請先建立客人資料',
                    p_customer_user_id;
  END IF;
  -- 第 8 代:員工替這張單選的等級蓋過客人現在的;沒選(NULL)= 照客人現在的。上面那段查詢保留(兼客人存不存在的閘)。
  v_tier := COALESCE(p_tier::public.member_tier, v_tier);

  -- ── G4 收件快照:逐鍵白名單重組,**不收員工原樣的 jsonb** ───────────────────
  -- 🔴 表上有 exact-key CHECK(`20260604120000` orders_ship_addr_whitelist)
  --    ⇒ 多一個鍵就整筆回滾。這裡自己組,壞掉的輸入在這裡就講清楚。
  IF p_ship_to IS NULL OR pg_catalog.jsonb_typeof(p_ship_to) <> 'object'
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'name', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'phone', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'line', '')) = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 收件資料要有收件人 / 電話 / 地址三格,不得留空';
  END IF;
  v_ship_to := pg_catalog.jsonb_build_object(
    'name',  pg_catalog.btrim(p_ship_to ->> 'name'),
    'phone', pg_catalog.btrim(p_ship_to ->> 'phone'),
    'line',  pg_catalog.btrim(p_ship_to ->> 'line'));

  -- ── G5 發票:同樣逐鍵白名單 ────────────────────────────────────────────────
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR COALESCE(p_invoice ->> 'type', '') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 發票類型要是 personal / company / donate 之一';
  END IF;
  -- 🔴 codex R2 `N1`:上一版這裡**沒有 trim** ⇒ 載具打成 `" ABC "` 與 `"ABC"` 會被算成
  --    兩包不同的內容 ⇒ 合法重送被拒。`NULLIF(btrim(…), '')` 讓「只打了空白」與「沒填」歸位到同一個值。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴,那不是漏掉的,是唯一寫得對的寫法。**
  --    本函式其他每一個呼叫都寫成 `pg_catalog.xxx(...)`(因為 `SET search_path = ''`)
  --    ⇒ 照著那個風格會很自然地把這裡寫成 `pg_catalog.nullif(...)` —— **我自己就是這樣寫的。**
  --    而 `NULLIF` / `COALESCE` / `CASE` 是 **SQL 的語法構造,不是 `pg_catalog` 裡的函式**
  --    ⇒ `pg_catalog.nullif(...)` 會在**執行期**炸「function does not exist」。
  --    🔴 **那一發:靜態閘四道 + typecheck + lint + build + 本檔的 apply 斷言 —— 全綠。**
  --       plpgsql 的函式本體到**被呼叫**那一刻才解析名稱 ⇒ 上面每一道對它都是零判別力。
  --    ⚠️ ⇒ 誰要「統一風格」把前綴加回去:**請先跑一次真的呼叫**,不要只看它有沒有 apply 成功。
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       pg_catalog.btrim(p_invoice ->> 'type'),
    'carrier',    NULLIF(pg_catalog.btrim(p_invoice ->> 'carrier'), ''),
    'title',      NULLIF(pg_catalog.btrim(p_invoice ->> 'title'), ''),
    'taxId',      NULLIF(pg_catalog.btrim(p_invoice ->> 'taxId'), ''),
    'donateCode', NULLIF(pg_catalog.btrim(p_invoice ->> 'donateCode'), '')));

  -- 🔴🔴 **第④代:`p_invoice.requested` = 這張單開不開發票**(`⟦b4-INVOICE5PCT⟧` 第 2 步;
  --    Sean 2026-09-04 第十八題拍甲)。
  --
  --    🛑 **為什麼搭 `p_invoice` 的順風車而不另開參數**:不動簽名 ⇒ 不會多出一個 overload,
  --       呼叫端不必 `DROP + CREATE`。⛔ ~~我原本在 TS 那邊寫「多一個參數必然 PGRST203」~~ ——
  --       **那句是錯的**(codex R1 查 PostgREST 官方打掉);真正的理由只是**不動簽名比較便宜**。
  --
  --    🔴 **`NULL`(這個鍵不在)必須【拒絕】, 不得當成 `true` 或 `false`** ——
  --       第③代以前的呼叫端不送這個鍵, 而它們建的單靠 `orders.invoice_requested` 的
  --       DEFAULT `true` 落地。⇒ 若這裡把 NULL 當 `true`, **舊呼叫端與「員工勾了要開」
  --       會落在同一個值上而分不出來**;若當 `false`, 那是**替他做一個他沒做的決定**。
  --       ⇒ 📌 而本函式**只有一個呼叫端**(後台建單), 而它與本片同一顆 commit 開始送這個鍵
  --       ⇒ **拒絕是安全的, 而且它會【立刻】叫** —— 不是一個要等很久才顯形的洞。
  -- 🔴🔴 **相容期設計:缺這個鍵【不是錯誤】, 而是「照舊」**(codex R3 must-fix #1/#2 改的)。
  --
  --    ⛔ ~~我第一版寫「缺鍵 ⇒ RAISE(必填)」~~ —— **那個設計讓上線這件事沒有安全順序**:
  --      · 先貼 migration、碼還沒部署 ⇒ 舊碼不送這個鍵 ⇒ 🔴 **每一張手動單都建不出來**
  --      · 先部署碼、migration 還沒貼 ⇒ 沒勾的單靜靜落成 `true`
  --      ⇒ 📌 **兩個方向都壞, 只是壞法不同** ⇒ 那不是「順序寫清楚就好」, 是設計本身有問題。
  --
  --    ✅ **改成:缺鍵 ⇒ `true`, 而 `true` 正是 `orders.invoice_requested` 今天的 DEFAULT**
  --      ⇒ 🎯 **兩個部署順序的最壞情況都變成「與今天一模一樣」** ——
  --         先貼 migration ⇒ 舊碼照常建單, 行為零改變;先部署碼 ⇒ 舊函式忽略該鍵, 行為零改變。
  --      ⇒ 那不是把問題往後推, 是**把一個必須協調的上線, 換成一個不必協調的上線**。
  --
  --    ⚠️ **代價寫出來, 不藏**:相容期裡「舊呼叫端沒送」與「員工明確勾了要開」
  --      **在資料上是同一個 `true`, 分不出來**。
  --      ✅ 而它為什麼可接受:本函式**今天只有一個呼叫端**(後台建單 `manual-order-repository.ts`),
  --         而它與本片**同一顆 commit** 開始送這個鍵 ⇒ 分不出來的那段期間 = **部署的那幾分鐘**。
  --      🛑 而**要真的關掉它**, 需要之後另一支 migration 把缺鍵改回 RAISE。
  --         ⇒ 📌 那支**還沒有人排** —— 這是一個**已知未關的缺口**, 不是「做完了」。
  --
  --    🔵 **而「送了但不是 boolean」仍然要叫** —— 那是呼叫端寫錯, 不是舊版本。
  --      實測(PG 17, 2026-09-04):鍵不存在 ⇒ `jsonb_typeof` 回 **SQL NULL**;
  --      鍵是 JSON null ⇒ 回字串 `'null'`。⇒ 兩者要分開處理, 而 `?` 運算子分得出來。
  --      🔵 **六個世界逐一在 PG 17 上量過**(不是推的):
  --         鍵不存在 ⇒ true · 鍵=true ⇒ true · 鍵=false ⇒ **false** ·
  --         鍵=JSON null ⇒ RAISE · 鍵=字串 ⇒ RAISE · 鍵=數字 ⇒ RAISE
  --      ⇒ 📌 中間那個 `false` 是重點:**它證明這道閘不是恆真的** ——
  --         有一個真實的輸入會讓它印出與其他五個不同的東西。
  -- 🔴🔴 本代(20260915170000, Sean 2026-09-16 批 Q10 plan docs/plans/2026-09-15-invoice5pct-missing-key-raise-plan.md):
  --    **相容期結束 ⇒ 缺鍵改回 RAISE。** 上面那段「相容期設計」講的是 2026-09-04 的部署順序問題;
  --    唯一呼叫端(manual-order-repository.ts:307)自那天起一律送 boolean, 早已上線 ⇒ 兩個部署順序都不會壞。
  --    ⛔ ~~缺鍵 ⇒ COALESCE 成 true~~ —— 那會替員工決定開發票 +5%, 而且與「員工勾了要開」在資料上分不出來。
  --    ⚠️ 畫面那顆勾選預設不勾(Sean 2026-09-05 / 09-16 兩次拍), 而沒勾時表單靠同名 hidden 送 'off' ⇒ TS 送 false ⇒ 本道不會誤擋。
  --    p_invoice 本身在 :846 已驗過是 object ⇒ 這裡的 `?` 一定有值(不會因 NULL 短路放行)。
  IF NOT (p_invoice ? 'requested') THEN
    RAISE EXCEPTION 'admin_create_manual_order: p_invoice.requested 必填(true / false)—— 沒送就猜 true 會替員工決定開發票 +5%%'
                    USING ERRCODE = 'P0001';
  END IF;
  IF pg_catalog.jsonb_typeof(p_invoice -> 'requested') <> 'boolean' THEN
    RAISE EXCEPTION 'admin_create_manual_order: p_invoice.requested 送了但不是 true / false'
                    '(收到型別:%)。',
                    pg_catalog.jsonb_typeof(p_invoice -> 'requested')
                    USING ERRCODE = 'P0001';
  END IF;
  v_invoice_requested := (p_invoice ->> 'requested')::boolean;

  -- ── G6 品項:逐筆驗 + 自算金額(**價錢不信 client 送的合計**) ──────────────
  FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    v_sku   := pg_catalog.btrim(COALESCE(v_line ->> 'sku', ''));
    v_title := pg_catalog.btrim(COALESCE(v_line ->> 'title', ''));
    IF v_sku = '' OR v_title = '' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 每個品項都要有料號與品名(收到 sku=[%] title=[%])',
                      v_sku, v_title;
    END IF;
    v_qty := NULLIF(v_line ->> 'qty', '')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量要是正整數', v_sku;
    END IF;
    -- 🔴 codex R1 `:138`:`qty = 2147483647` 配 `unit_price = 0` ⇒ 金額守門**不會紅**
    --    (0 × 任何數還是 0)⇒ 一張「兩億件、零元」的單會真的建出來。
    IF v_qty > c_max_qty THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量 % 超過單筆上限 %;'
                      '真的要這個量 ⇒ 找系統維護(這個上限是保守預設值、未經拍板)',
                      v_sku, v_qty, c_max_qty;
    END IF;
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::integer;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的單價要是 0 或正整數', v_sku;
    END IF;
    -- 🔴 代購品項:`variant_id` 允許 NULL(`20260604120000:143`)⇒ 網站上沒有的商品也建得起來。
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::uuid;
    -- 🔵 ⟦b4-SPEC1⟧ 的權威 spec **不在這裡取** —— 見下方 G8 的 INSERT。
    --    🔴 **本檔第一版取在這裡, 而 codex R1 must-fix 1 打穿它**:
    --       這裡在 G6.5 冪等比對【之前】⇒ `v_items` 進指紋 ⇒ 指紋會跟著
    --       `product_variants.spec` 這個**可變的外部狀態**跑。
    --       ⇒ 首次成功之後那個變體的 spec 被改過 ⇒ **同鍵同內容的合法重送算出不同指紋**
    --          ⇒ 被判成「同鍵不同內容」而拒絕;變體被刪掉 ⇒ 直接 RAISE, **連既有那張單都回不了**。
    --    📌 而本函式檔頭 `:207` 自己寫著「重送同一包輸入時 G3-G6 全部是**決定性**的」——
    --       **我那一版把那句話變成假的, 而三綠 / 四個世界 / 四發突變全部沒有紅。**
    --    ⇒ ✅ 分成兩個問題:**指紋回答「這是不是同一個請求」(看呼叫端送什麼);
    --       快照回答「真相是什麼」(看權威)。** 兩者不該共用同一份值。
    -- 🔴 `spec` 只收物件,而且**每個值都必須是字串**(表上 CHECK 會擋,這裡先講清楚)。
    v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb);
    IF pg_catalog.jsonb_typeof(v_spec) <> 'object' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格要是物件', v_sku;
    END IF;
    -- 🔴🔴 codex R1 `:203`:舊版**只驗到這裡為止**,底下三句話是靠
    --    `order_items_snapshot_whitelist` 這道表上的 CHECK 幫我擋的。
    --    ⇒ 那是**別人家的守門**:正式庫若缺它或它漂移了,**本檔的 apply 斷言不會紅**,
    --      而經銷價 / cost 會直接寫進快照裡。⇒ **自己驗一遍**(判準逐字對齊 `20260604120000:157-165`)。
    --    ⚠️ 這不是重複勞動:表上那道是**縱深**,這一道是**訊息** —— CHECK 紅的時候
    --       員工看到的是一串約束名,這裡紅的時候他看得到是哪一個品項的哪一種問題。
    IF NOT public.m3_jsonb_values_all_string(v_spec) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格裡有不是字串的值(數字 / 巢狀物件 / 陣列);'
                      '規格只收「字串對字串」,那是為了擋價格欄藏在巢狀值裡', v_sku;
    END IF;
    IF v_spec ?| ARRAY['price_store', 'price_by_tier', 'cost'] THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格出現價格欄名(price_store / price_by_tier / cost);'
                      '訂單快照**絕不放經銷價與成本**', v_sku;
    END IF;
    -- 🔴 codex R2 `N1`:規格的鍵與值也要 trim —— 它們**進指紋**,而空白差異會讓合法重送被拒。
    --    ⚠️ 順序有意義:**先驗全值皆字串**(上面那道)**才能** `jsonb_each_text`,
    --       否則數字會被靜靜轉成字串、把該紅的那一發變綠。
    v_spec := COALESCE((SELECT pg_catalog.jsonb_object_agg(pg_catalog.btrim(k), pg_catalog.btrim(val))
                          FROM pg_catalog.jsonb_each_text(v_spec) AS t(k, val)), '{}'::jsonb);

    -- 🔴🔴 codex R1 `:186`:舊版**沒有任何跨列比對** ⇒ 員工手滑送兩列同一個變體,
    --    兩列各自計價 ⇒ `subtotal` / `total` **與退款分母**直接加倍。
    --    既有 `create_order` 明文要求同變體合併數量(`20260730120100:323` 逐字:「同變體應合併 qty」)。
    --    ⚠️ **代購品項(`variant_id` 是 NULL)怎麼去重**:它沒有變體可比 ⇒ 退而用 `料號 + 品名` 當鍵。
    --       兩列**料號與品名都一樣**幾乎只會是重送;真的是兩個不同東西 ⇒ 品名寫得出差別。
    -- 🔴🔴 codex R2 `N3`:上一版的代購鍵**只有 sku + 品名** ⇒ 兩個病一起犯:
    --    ① **太窄**:同料號同品名、但**規格或單價不同**的兩個代購品 ⇒ 被錯誤拒絕。
    --       ⚠️ 這一格的後果是**擋到合法的**(這裡是拒絕、不是合併)
    --       ⇒ 修的方向必須是**讓鍵更寬**,不是更嚴。
    --    ② **太鬆**:把品名中間的空白改一下 ⇒ 換一把鑰匙 ⇒ 真正的重複列繞過去。
    --    ⇒ 兩個方向一起修:**加進規格與單價**(變寬)+ **內部連續空白壓成一個**(變嚴)。
    -- 🔴🔴 ⟦b4-INVOICE5PCT⟧二:這一列是不是【員工打含稅價】那一種。
    --    🛑 **缺鍵 = 舊版表單** ⇒ 不 RAISE(先貼 migration 再上碼, 中間那段窗口要活著)。
    v_line_taxed := NULL;
    IF v_line ? 'unit_price_taxed' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'unit_price_taxed') <> 'number' THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_create_manual_order: 品項 [' || v_sku || '] 的 unit_price_taxed 不是數字';
      END IF;
      v_line_taxed := (v_line ->> 'unit_price_taxed')::integer;
      IF v_line_taxed IS NULL OR v_line_taxed < 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_create_manual_order: 品項 [' || v_sku || '] 的 unit_price_taxed 要是 0 或正整數';
      END IF;
    END IF;
    -- 🔵 去重鍵用的【正規化原值】:缺鍵而稅基是 taxed ⇒ 補回舊 app 隱含的那個值。
    -- 🔴🔴 **缺鍵一律補, 不看 `tax_basis`**(codex R3 must-fix 一)——
    --    ⛔ ~~只在 `tax_basis = 'taxed'` 時才補~~ ⇒ 出事世界:同料號同品名同規格、
    --      `unit_price` 都是 1000, 一列 untaxed 一列 taxed 而兩列都缺新鍵
    --      ⇒ 鑰匙一個是 `-` 一個是 `1050` ⇒ **兩列都放行, 成立一張 2,000 的單**,
    --      而**修改前那兩列的鑰匙一模一樣、是被拒的**。
    --      📌 已在拋棄式 PG 上重現:修改前 RAISE「重複品項 [X]」, 修改後回 display_id。
    --    🎯 判準是**「這一列真正的錢」**, 不是它宣告哪個稅基:
    --      · untaxed 1000 與 taxed-缺鍵 1000 ⇒ 庫裡都存 1000、都走正推 ⇒ **同一筆錢** ⇒ 要撞。
    --      · taxed-缺鍵 1000 與 taxed-送 1050 ⇒ 1000 + 正推 50 vs 1000 + 殘差 50 ⇒ **同一筆錢** ⇒ 要撞。
    --      · 含稅 31 與 32(未稅都 30)⇒ **不同筆錢** ⇒ 要分得開。
    --      ⇒ 三個要求同時成立的寫法只有一個:**有鍵用鍵, 沒鍵一律補 `unit_price × 21/20`。**
    v_taxed_key := CASE
      WHEN v_line_taxed IS NOT NULL THEN v_line_taxed::text
      ELSE (v_unit_price::bigint * 21 / 20)::text END;
    -- 🔴🔴 **這一段必須待在 `v_key` 的【上面】**(codex R2 must-fix 三的真正修法)——
    --    ⛔ 出事世界:`v_taxed_key` 在下面才指派 ⇒ 第一圈是 NULL、第二圈拿到**上一列**的值
    --      ⇒ 兩列一模一樣的代購也會拿到兩把不同的鑰匙 ⇒ 📌 **修改前擋得住的重複列, 修改後放行。**
    --    ✅ 先解析 `unit_price_taxed`、先算正規化原值, 鑰匙才拿得到這一列自己的值。
    v_key := COALESCE('variant:' || v_variant_id::text,
                      'custom:' || pg_catalog.lower(pg_catalog.regexp_replace(v_sku,   '\s+', ' ', 'g'))
                        || '|' || pg_catalog.lower(pg_catalog.regexp_replace(v_title, '\s+', ' ', 'g'))
                        || '|' || v_unit_price::text
                        -- 🔴 **含稅原值也要進這把鑰匙**(codex R1 must-fix 四:含稅 31 與 32
                        --    換算後都是未稅 30 ⇒ 舊鑰匙撞在一起, 而它們是兩個不同的應收金額)。
                        -- 🔴🔴 **而它必須【正規化】**(codex R2 must-fix 三)——
                        --    ⛔ ~~直接用 `COALESCE(那個鍵, '-')`~~ ⇒ 出事世界:兩列同料號同品名同規格、
                        --      `unit_price` 都是 1000、`tax_basis` 都是 taxed, 而第一列【缺新鍵】、
                        --      第二列送 1050 ⇒ 鑰匙一個是 `-` 一個是 `1050` ⇒ **兩列都放行**,
                        --      而它們是【同一個 1,050 元的東西】⇒ 📌 **修改前擋得住, 修改後擋不住。**
                        --    ✅ 缺鍵的舊形狀**補回它隱含的原值**:舊 app 那道整除閘只放行除得盡的值
                        --      ⇒ 原值必然是 `unit_price × 21/20` ⇒ 兩邊正規化到同一個數。
                        --    🔵 而 31 與 32 仍然分得開(它們都有鍵, 而值不同)⇒ **兩個要求同時成立。**
                        || '|' || COALESCE(v_taxed_key, '-')
                        || '|' || v_spec::text);
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 重複品項 [%];同一個東西請**合併數量**寫成一列,'
                      '不要送兩列 —— 送兩列會讓總額與**可退金額**都變成兩倍', v_sku;
    END IF;
    v_seen := v_seen || v_key;

    v_line_total := v_unit_price::bigint * v_qty::bigint;
    v_subtotal := v_subtotal + v_line_total;
    IF v_invoice_requested AND v_line_taxed IS NOT NULL THEN
      -- 🔴 **不信 client 送的數**:本函式自己再算一次並比對, 不合就拒。
      IF v_unit_price <> pg_catalog.round((v_line_taxed::numeric) * 20 / 21)::integer THEN
        RAISE EXCEPTION USING MESSAGE = '品項 [' || v_sku || '] 的含稅 ' || v_line_taxed::text || ' 換算回未稅應為 ' || pg_catalog.round((v_line_taxed::numeric) * 20 / 21)::integer::text || ', 而送來的是 ' || v_unit_price::text;
      END IF;
      -- 🎯 殘差【跟著這一列走、乘以數量】⇒ 員工打的含稅數乘以數量剛好回得來。
      v_taxed_residual := v_taxed_residual + (v_line_taxed - v_unit_price)::bigint * v_qty::bigint;
    ELSE
      -- 🔴🔴 **沒勾發票【也要驗一致】**(codex R2 must-fix 二)——
      --    ⛔ ~~沒勾就完全不看那個鍵~~ ⇒ 出事世界:送 `unit_price=1` 配 `unit_price_taxed=1050`
      --      ⇒ 型別與範圍都過、換算比對被跳過 ⇒ 📌 **成立一張 1 元的單, 而稽核留著 1,050。**
      --      而**修改前那組矛盾輸入是被拒的**。
      --    ✅ 沒勾 ⇒ 他打的數字即總額 ⇒ 那兩個數**必須相等**, 不相等就是呼叫端壞了。
      IF v_line_taxed IS NOT NULL AND v_line_taxed <> v_unit_price THEN
        RAISE EXCEPTION USING MESSAGE = '品項 [' || v_sku || '] 沒有勾開發票, 而送來的含稅原值 ' || v_line_taxed::text || ' 與單價 ' || v_unit_price::text || ' 不一樣 ⇒ 沒勾發票時他打的數字即總額, 兩者必須相同';
      END IF;
      -- 🔵 未稅那些列(與沒勾發票的每一列)才進【正推】的稅基。
      v_untaxed_base := v_untaxed_base + v_line_total;
    END IF;
    -- 🔴 **括號在這裡是承重的**:`v_items` 是【陣列】而 `||` 對它是「加一個元素」,
    --    對兩個 jsonb 物件則是「合併」⇒ 沒有括號的話 `v_items || A || B` 會**加兩個元素**
    --    ⇒ 📌 本函式自己那道「三個陣列長度不一致」的斷言當場抓到了(items 4 / ids 2 / bases 2)。
    v_items := v_items || (pg_catalog.jsonb_build_object(
      'variant_id', v_variant_id,
      'variant_sku', v_sku,
      -- 🔴 exact-key 白名單:title / sku / spec 三鍵,**不得把員工輸入原樣塞進去**
      --    (`order_items_snapshot_whitelist`:多一鍵整筆回滾)。
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_title, 'sku', v_sku, 'spec', v_spec),
      'quantity', v_qty,
      'unit_price', v_unit_price,
      'line_total', v_line_total)
      -- 🔴🔴 **含稅原值要進 `v_items`, 因為冪等指紋是從它算的**(codex R1 must-fix 一):
      --    含稅 31 與 32(未稅都 30)否則指紋一模一樣 ⇒ 第二次回第一張 31 元的單。
      -- 🔴🔴 **而【缺鍵時絕對不能加一個 null 進去】**(codex R2 must-fix 一)——
      --    出事世界:貼之前建單成功而回應遺失;貼之後舊表單拿同一顆 request_id、
      --    **完全相同的內容**重送(而它根本沒送這個鍵)⇒ 若這裡塞 `"unit_price_taxed": null`,
      --    指紋就變了 ⇒ 📌 **回 P858B, 那張已經成立的單再也取不回來。**
      --    ⇒ ✅ **有鍵才加** ⇒ 舊形狀的指紋與貼之前【逐位元相同】, 而 31/32 仍分得開。
      || CASE WHEN v_line_taxed IS NULL THEN '{}'::jsonb
              ELSE pg_catalog.jsonb_build_object('unit_price_taxed', v_line_taxed) END);

    -- ══ 第 7 代:把這一列的稅基收起來, 等一下寫進 audit ═══════════════════════
    -- 🔵 **缺鍵 ⇒ NULL, 不是報錯** —— 部署順序是「先貼 migration、再上碼」
    --    ⇒ 中間那段窗口裡, **舊版表單不會送這個鍵**。報錯的話那段窗口所有手動單都建不出來。
    --    ⇒ 📌 而 NULL 在 audit 裡是誠實的:它的意思是「這一筆沒有人告訴我」。
    -- 🛑 **已知未關的缺口**:窗口過後「舊呼叫端沒送」與「真的缺」仍然都是 NULL, 分不出來。
    --    要關掉需要**之後另一支 migration** 把缺鍵改成 RAISE ⇒ 那支還沒有人排, 所以寫在這裡。
    -- 🔴 **第三種值一律拒** —— 同本函式對 order_source / payment_channel 的做法:
    --    「看不懂就當未稅」會讓一個壞掉的表單靜默送出一個**沒有人宣告過**的稅基。
    -- 🔴🔴 **「缺鍵」與「送了一個空的」要分得開**(codex R4 2026-09-09 must-fix ④, 它對)。
    --    ⛔ ~~`v_line_basis := NULLIF(v_line ->> 'tax_basis', '');`~~ —— 那一版有兩條路悄悄變成 NULL:
    --      `{"tax_basis": ""}` 被 `NULLIF` 轉成 NULL · `{"tax_basis": null}` 經 `->>` 也是 NULL
    --      ⇒ 📌 **兩者都跳過下面那道 RAISE, 留下與「舊版沒送鍵」一模一樣的紀錄。**
    --      而它們的意思完全不同:一個是「那個版本還沒有這一格」, 另一個是**表單壞了**。
    --    ✅ 改成先用 `?` 問【鍵在不在】, 只有**缺鍵**才准是 NULL。
    --    🔵 `?` 是 jsonb 的存在運算子;運算子住在 `pg_catalog`, 而 `pg_catalog` 永遠隱含可見
    --      ⇒ `SET search_path = ''` 之下照樣解析得到(與本函式其他 `->>` / `||` 同理)。
    IF v_line ? 'tax_basis' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'tax_basis') <> 'string'
         OR (v_line ->> 'tax_basis') NOT IN ('untaxed', 'taxed') THEN
        RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的稅基 [%] 不是 untaxed / taxed',
                        v_sku, COALESCE(v_line ->> 'tax_basis', '<null>');
      END IF;
      v_line_basis := v_line ->> 'tax_basis';
    ELSE
      -- 🔵 **只有這一條路允許 NULL** —— 部署順序是「先貼 migration、再上碼」,
      --    中間那段窗口舊版表單不送這個鍵。報錯的話那段窗口所有手動單都建不出來。
      v_line_basis := NULL;
    END IF;
    -- 🔵 **`unit_price` 一起記** —— 它是【送進來的那個值】(表單那一側已經換算過了)。
    --    配上這一列的 `tax_basis` 與這張單的 `invoice_requested`, 三個湊起來就答得出
    --    「他當初打的是哪個數字、當成什麼」:
    --      勾了 + taxed ⇒ 他打的是 unit_price × 21/20   ·   沒勾 ⇒ 他打的就是 unit_price
    -- ✅ **這一列的 id 在這裡就決定**, 下面的 INSERT 明確寫它, 稽核記同一個。
    --    ⇒ 📌 **稽核那一列與 `order_items` 那一列從此靠【同一個 uuid】綁著, 不靠任何會變的值。**
    --    🔵 只記三樣:id + 稅基 + **建單當下**的單價。單價記的是「那一刻是多少」——
    --      它日後可能被 `admin_update_order_item_amount` 改掉, 而**那正是要留一份原值的理由**。
    --    🛑 **不記品名 / 規格 / 料號** —— 那些是自由文字, 抄進 append-only 的表就是多一份
    --      會過期、會外洩的副本(本函式 G9 那段逐字)。要看它們 ⇒ 拿 id 去 `order_items` 查。
    v_item_id := pg_catalog.gen_random_uuid();
    v_item_ids := v_item_ids || pg_catalog.to_jsonb(v_item_id);
    v_line_bases := v_line_bases || pg_catalog.jsonb_build_object(
      'order_item_id', v_item_id,
      'tax_basis',     v_line_basis,
      'unit_price',    v_unit_price,
      -- 🔴🔴 **原始含稅價要留下來**(codex R1 must-fix 三):A/B 兩列含稅 31/32 與 32/31
      --    在庫裡長得一模一樣(單價 30/30)⇒ 事後分不出哪一列原本收多少,
      --    而 `30 × 21/20 = 31.5` **還原不回去** ⇒ 📌 那是資料遺失。
      -- 🛑 **而【舊資料沒有這一格】** —— 貼之前建的單只有未稅價, 那些單的原值
      --    **不能用乘法還原**(codex R2 nit 三)。有這個鍵才讀它, 沒有就是沒有。
      'unit_price_taxed', v_line_taxed);
  END LOOP;

  -- ══ 第 6 代:稅在這裡算(Sean 2026-09-05 拍甲)═══════════════════════════════
  -- 🔴 **稅基 = 小計 + 運費 − 折扣**。而 `discount_total` 在本函式**寫死成 0**(見下面 INSERT)
  --    ⇒ 折扣那一項今天**恆為 0**, 而算式仍然把它寫出來:它天生正確, 且折扣功能上線那天不必再改一次。
  --    ⚠️ **而那也代表「折扣在稅前」這條規則今天走不到任何一條路** ⇒ 它未被任何測試涵蓋。
  -- 🔴 **先轉 `numeric` 再 `ROUND`** —— `numeric` 的 `ROUND` 對 `.5` 是**遠離零**(四捨五入),
  --    而 `double precision` 是銀行家捨入(進偶數)。營業稅尾數依財政部法規是四捨五入
  --    ⇒ 📌 **型別決定了合不合法, 那不是風格。**
  IF (v_subtotal + p_shipping_fee - 0) < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稅基是負的(小計 % + 運費 % − 折扣 0)⇒ 拒絕建單。'
                    '請檢查品項金額與運費。', v_subtotal, p_shipping_fee;
  END IF;
  -- ══ 第 7 代:**稅只有在「這張單要開發票」時才加**(⟦b4-INVOICE5PCT⟧)══════════
  -- 🔴 **Sean 2026-09-04 16:2x 逐字**(`~/pcm-mailbox/Sean拍板-20260904-七題.md:363`):
  --    「我們傾向於我輸入單價，然後勾選開發票自己幫我+5 %上去，
  --      **那如果我沒有勾選開發票價錢都不加**」
  --    ⇒ 同一份檔 `:367-369` 已整理成規格:勾了 ⇒ +5%;**沒勾 ⇒ 價錢都不加**。
  -- 🛑 **第 6 代的 `v_tax :=` 是無條件的** ⇒ 沒勾也加了 5%, 而那顆勾選**預設不勾**
  --    (`manual-order-form-body.tsx:234` 逐字「預設不勾選,也就是預設不開發票」)
  --    ⇒ 📌 **不加稅才是常態路徑, 而它一直在加。** 本段就是那一格。
  -- 🔴 **沒勾那一邊為什麼是 `inclusive` 而不是 `exclusive` + 稅 0**:
  --    Sean 同段逐字「**沒勾就是他打的數字即總額**」⇒ 那張單沒有另計的稅
  --    ⇒ `inclusive` 正是 `orders.price_tax_mode` 的 DEFAULT、也是第 6 代之前每一張單的語意
  --    ⇒ 🎯 **沒勾那條路 = 回到第 6 代之前的行為, 一個位元都沒有多。**
  --    🛑 **而寫成 `exclusive` + 稅 0 會有一個看不見的副作用**:
  --       `admin_update_order_item_amount` 的 `pcm_e13_no_edit_when_taxed`(本檔下游, 未改)
  --       判準逐字是 `price_tax_mode = 'exclusive' OR tax_total <> 0`
  --       ⇒ 一張**沒有稅**的單會被擋著不給改金額, 而員工看到的是一句在講稅的錯誤訊息。
  -- ⚠️ **這一格是【判斷】不是拍板** —— Sean 說的是「價錢都不加」, 沒有說欄位填什麼。
  --    理由寫在上面兩點, 而 `⟦b4-INVOICE5PCT⟧` 那一列要記著它可翻。
  -- 🔵 **負稅基閘與溢位閘刻意留在 IF 外面** —— 它們是這張單的不變式, 不是稅的附屬品;
  --    沒勾那一邊 `v_tax = 0`, 兩道閘照樣成立而且零成本。
  IF v_invoice_requested THEN
    -- 🔴🔴 ⟦b4-INVOICE5PCT⟧二:【混單】要分開算(整包正推會讓員工打的含稅數字回不來)。
    --    ⚠️ **運費永遠進正推那一邊** —— 本函式收不到運費的稅基(見本片 migration 檔頭)。
    v_tax := pg_catalog.round(((v_untaxed_base + p_shipping_fee - 0)::numeric) * 0.05)::bigint
             + v_taxed_residual;
    v_price_tax_mode := 'exclusive';
  ELSE
    v_tax := 0;
    v_price_tax_mode := 'inclusive';
  END IF;
  -- 🔴 **溢位那道連 `v_tax` 一起看** —— 照 `20260604130000:229` 同一種寫法, 不自創第二種。
  --   #953 P2(20260915060000):拆成兩段 —— 元件先驗(要 ::integer 餵函式), 總額後驗;訊息同一句。
  IF v_subtotal > 2147483647 OR v_tax > 2147483647 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金額超出 integer 上限;這張單請拆開建';
  END IF;
  -- #953 P2:總額等式只住 public.pcm_order_total()(20260915030000)。手動單沒有折扣 ⇒ 第三項明寫 0,
  --   與下面 INSERT 那一行顯式寫的 discount_total 0 同一個事實。
  v_total := public.pcm_order_total(v_subtotal::integer, p_shipping_fee, 0, v_tax::integer);
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金額超出 integer 上限;這張單請拆開建';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════════

  -- ── G6.5 冪等格(codex R1 `:143`;形狀照退款 RPC `20260820021000:245-270`)─────
  -- 🔴🔴 **這一段的上一版是一句假話,而它讀起來像一句保證**(codex R2 `N1` 抓到):
  --    ~~「多打一個空白、鍵的順序不同、發票欄位給了 NULL,都不會被誤判成不同內容」~~
  --    R1 當下的實情是:**發票與規格根本沒有 trim,品項也照原順序進指紋**
  --    ⇒ 那三件事**每一件都會**讓合法重送被拒。
  --    ⚠️ 這句話的危害不只是錯:**它會讓下一個人不去測那三件事** —— 我自己就沒測。
  --    ⇒ R2 把碼補齊之後,下面這句話**現在才成立**,而它成立是因為有三件事真的做了:
  --      ① 收件 / 發票 / 規格的鍵與值**全部 btrim**(空白只打了空白 ⇒ 等於沒填)
  --      ② 品項**排序後**才進指紋(順序不再影響指紋)
  --      ③ `jsonb` 本身把鍵排序、重複鍵消掉(這一件是 PG 給的,不是我做的)
  --    ⇒ 多打一個空白、品項換順序、鍵的順序不同、發票欄位給了 NULL,**都不會**被誤判成「不同內容」。
  --    📌 三件事各有一格負測釘著(`docs/probes/2026-08-24-858-manual-order-rpc-r2-negatives.sql` 的 R2-1b/1c/1e),不是只有這段話。
  -- ⚠️ **上限(誠實揭示)**:比的是**指紋**,所以只答得出「一樣 / 不一樣」,
  --    答不出**哪一欄**不一樣 —— 退款 RPC 那支比得出來,因為它比的是欄位。
  --    這裡的輸入是一整包(含品項陣列),逐欄比會隨著欄位增加而**靜靜漏掉新欄**;
  --    指紋不會漏,代價就是訊息比較鈍。**這是選擇,不是疏忽。**
  -- ⚠️ 另一格上限:`jsonb::text` 的輸出在**同一個 PG 大版本內**是決定性的(鍵已排序、
  --    重複鍵已消)。跨大版本若渲染改變 ⇒ 舊指紋對不上 ⇒ 會被判成「內容不同」而**拒絕**
  --    ⇒ 方向是 fail-closed(擋下來、不是放行)。
  -- 🔴 **`p_actor` 刻意【不進指紋】** —— 這是與 `20260820021000` 的**有意分歧**,不是漏掉:
  --    那支把 actor 放進逐欄比對,結果它必須為此寫一整段訊息教人怎麼辦
  --    (`:262-264` 逐字:「若你是在重送同一筆(**例如原經手人已停用而你換了人**)
  --     ⇒ 不要用新的 request_id」)。
  --    ⇒ 指紋要回答的問題是「**這是不是同一張單**」,而**誰按下送出不會改變那張單**。
  --      同事幫忙重送同一包內容 ⇒ 應該拿到 idempotent,不該被判成「內容不同」。
  --    ⇒ 「**誰建的**」由 `admin_audit_log` 那一列回答,那才是它該住的地方。
  --    ⚠️ **代價講明(2026-08-24 擴寫:我原本只寫了併發那一半,而它比那寬)**:
  --       **任何重送**,audit 都只會有**最初建單那一位**。
  --       · 併發:後到那發拿 `P858A`、不落 audit(它什麼都沒建)。
  --       · **非併發**:A 建單、B 一小時後拿同一顆 id 重送 ⇒ 回 `idempotent` ⇒ **B 這次操作零紀錄**。
  --    🔴 而**後者正是本設計自己舉的主要使用情境**(「原經手人已停用而你換了人」)
  --       ⇒ 它是**常態,不是邊角**。~~原本寫「併發時」~~ 那個限定把常態寫成了例外。
  --    ✅ 而這**不是缺陷**:B 沒有建單。`admin_audit_log` 記的是「**建單**」事件,不是「**請求**」事件
  --       ⇒ 不記 B 是**一致的**。⚠️ 但「誰碰過這張單」這條線索**確實不在系統裡** —— 要就得另立事件。
  -- 🔴🔴 **正規化要在指紋【之前】** —— 否則 `'a@b.c'` 與 `' a@b.c '` 會算出兩個指紋,
  --    而它們是**同一個請求** ⇒ 合法重送被判成「同鍵不同內容」而被拒。
  --    📌 這與同檔 `:420` 對規格鍵值做 trim 的理由**逐字是同一條**(codex R2 `N1`)。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴 —— 它是【SQL 語法構造】, 不是函式。**
  --    ⚠️ **本檔 `:245-247` 逐字警告過這一格, 而我照樣寫成了 `pg_catalog.nullif(...)`**
  --       ⇒ code-reviewer 2026-09-05 抓到(must-fix 1)。它會在**執行期**炸
  --         `function pg_catalog.nullif(text, unknown) does not exist` —— 而 **apply 全綠**。
  --    📌 **一段寫在同一支檔裡、講得完全正確的警告, 沒有阻止寫它的那個人再犯一次。**
  --       ⇒ 擋住它的不是那段字, 是一發【真的呼叫】(§7b)。
  -- 🔵 `btrim` 的字元集對齊同檔 `p_actor`(`:163`/`:168`)—— 只剝空格會讓
  --    貼上時帶進來的尾端換行留著, 而 CHECK 的 `~ '^[!-~]+$'` 不成立 ⇒ 整張單被擋、
  --    訊息只有約束名。fail-closed, 而那不是我們要給員工看的訊息。(nit 3)
  v_notification_email := NULLIF(pg_catalog.btrim(p_notification_email, E' \t\r\n'), '');
  -- 貼板 261:蝦皮帳號、蝦皮訂單編號。只有蝦皮單可以填;帳號已記在另一位客人身上 ⇒ 擋, 不默默搬。
  v_shopee_username := NULLIF(pg_catalog.btrim(p_shopee_username, E' \t\r\n'), '');
  v_shopee_order_no := NULLIF(pg_catalog.btrim(p_shopee_order_no, E' \t\r\n'), '');
  IF p_order_source <> 'manual_shopee' AND (v_shopee_username IS NOT NULL OR v_shopee_order_no IS NOT NULL) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 只有來源是蝦皮的單可以填蝦皮帳號或蝦皮訂單編號' USING ERRCODE = 'P2S02';
  END IF;
  IF v_shopee_username IS NOT NULL AND v_shopee_username !~ '^[^[:space:]]{1,64}$' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 蝦皮帳號不能有空白, 最多 64 個字' USING ERRCODE = 'P2S03';
  END IF;
  IF v_shopee_order_no IS NOT NULL AND v_shopee_order_no !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 蝦皮訂單編號只能是英文字母、數字、底線或連字號, 最多 40 個字' USING ERRCODE = 'P2S03';
  END IF;
  IF v_shopee_username IS NOT NULL THEN
    SELECT a.customer_user_id INTO v_shopee_owner
      FROM public.customer_shopee_accounts a
     WHERE pg_catalog.lower(a.account) = pg_catalog.lower(v_shopee_username);
    IF FOUND AND v_shopee_owner <> p_customer_user_id THEN
      RAISE EXCEPTION 'admin_create_manual_order: 蝦皮帳號 % 已經記在另一位客人身上', v_shopee_username USING ERRCODE = 'P2S01';
    END IF;
  END IF;

  v_canonical := pg_catalog.jsonb_build_object(
    'customer_user_id', p_customer_user_id,
    'order_source',     p_order_source,
    'payment_channel',  p_payment_channel,
    'shipping_method',  p_shipping_method,
    'shipping_fee',     p_shipping_fee,
    'ship_to',          v_ship_to,
    'invoice',          v_invoice,
    -- 🔴 第④代:**開不開發票要進指紋** —— 少了它, 「只改了這一格再送一次」會被
    --    判成「內容相同」⇒ 回上一張單 ⇒ **員工以為改掉了而其實沒有**。
    -- ⚠️ **代價寫出來**:指紋多一個鍵 ⇒ apply 之後算出來的 sha 與 apply 之前**不同**。
    --    ⛔ ~~我原本寫「窗口 = 貼這支的那幾秒」~~ —— **那句話寫窄了**(codex R2 must-fix):
    --    🔴 **apply 之前建立的每一顆 `manual_request_id`, 它的 sha 是用【舊指紋】算的,
    --       而那個值已經落表、永遠不會重算** ⇒ 那些單**在任何時候**被原樣重送, 都會算出新 sha
    --       ⇒ 判成 `P858B`(內容不同)。⇒ **不是幾秒, 是【所有舊單, 永久】。**
    --    ✅ **而它為什麼仍可接受**:重送只發生在「員工按了送出而沒看到結果」那一刻的補救,
    --       而那是**當下**的動作 —— 沒有人會去重送一張三天前的單。⇒ 影響面 = apply 那一刻
    --       正在飛的請求, 而 Sean 手動在安靜時段貼。
    --    🛑 **但那是一個【業務面的判斷】, 不是資料面的保證** —— 真的撞到 `P858B` 的人看到的
    --       是「內容不同」而他明明沒改東西 ⇒ 📌 那句錯誤訊息在這個情境下會誤導他。已知, 未修。
    'invoice_requested', v_invoice_requested,
    'notification_email', v_notification_email,
    -- 第 8 代:等級進指紋(主視窗裁, 理由同第④代 invoice_requested:它改變落表內容, 「只改了這一格再送」不可以被判成同內容)。
    --    代價同上面那段:apply 之前建立的舊 request_id 原樣重送會被判 P858B。
    -- 🔴 進指紋的是【員工送來的值 p_tier】不是算出來的 v_tier(codex 2026-09-14 R1 must-fix ①):
    --    v_tier 在沒帶 tier 時 = 客人【當下】的等級 ⇒ 建單成功而回應斷掉、客人等級中間被改、同鍵原樣重送 ⇒ P858B。
    --    p_tier 是請求本身的一部分, NULL 就是 NULL, 重送恆等。
    'tier',             p_tier,
    -- 🔴🔴 codex R2 `N1`:上一版直接把 `v_items` **照員工送來的順序**丟進指紋
    --    ⇒ 同樣的品項換個順序 ⇒ 指紋不同 ⇒ **合法重放被判成「內容不同」而拒絕**。
    --    ⇒ 排序後再算。排序鍵用 `x::text`:jsonb 轉文字時鍵已排序、重複鍵已消
    --      ⇒ 同一個 jsonb 值恆得同一個字串 ⇒ 是個穩定的鍵。
    --    ⚠️ **只有指紋排序,落表的 `order_items` 仍照員工原順序** —— 那是他要看的順序。
    'items',            (SELECT COALESCE(pg_catalog.jsonb_agg(x ORDER BY x::text), '[]'::jsonb)
                           FROM pg_catalog.jsonb_array_elements(v_items) AS x));
  -- 第 9 代:車輛進指紋【只在有填時】(codex R1 must-fix ②):沒填就一個鍵都不加 ⇒ 第 8 代建的單、回應斷掉、原樣重送舊 12 參
  --    ⇒ 指紋與落表的 sha 相同 ⇒ 仍回 idempotent, 不會被判 P858B。用重組後的 v_vehicle(由 p_vehicle 決定, 與客人狀態無關, 重送恆等)。
  IF v_vehicle IS NOT NULL THEN
    v_canonical := v_canonical || pg_catalog.jsonb_build_object('vehicle', v_vehicle);
  END IF;
  -- 貼板 261:蝦皮帳號 / 訂單編號進指紋【只在有填時】(同車輛那段的理由:沒填就不加鍵, 舊請求原樣重送仍回 idempotent)。
  IF v_shopee_username IS NOT NULL OR v_shopee_order_no IS NOT NULL THEN
    v_canonical := v_canonical || pg_catalog.jsonb_build_object('shopee_username', v_shopee_username, 'shopee_order_no', v_shopee_order_no);
  END IF;
  v_payload_sha := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_canonical::text, 'UTF8')), 'hex');

  SELECT o.id, o.display_id, o.manual_request_payload_sha256 INTO v_existing
    FROM public.orders o
   WHERE o.manual_request_id = p_manual_request_id;
  IF FOUND THEN
    IF v_existing.manual_request_payload_sha256 IS NOT DISTINCT FROM v_payload_sha THEN
      -- 同一顆鍵、同一包內容 ⇒ 這就是重送。回既有那張單。
      RETURN pg_catalog.jsonb_build_object(
        'order_id', v_existing.id, 'display_id', v_existing.display_id, 'idempotent', true);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**(合約逐字對齊 `20260820021000:257`)
    -- 🔴 codex R2 `N2` 連帶:這一條與上面那條的**下一步完全相反**
    --    (那條要「原樣重送」,這條是「**不准重送**」)⇒ 呼叫端必須分得出來
    --    ⇒ 兩條都給代碼,不能只給一條。
    RAISE EXCEPTION 'admin_create_manual_order: 這個建單請求的編號已經用過了,而**內容不一樣** ⇒ 拒絕。'
                    '🔴 **呼叫端合約**:SQLSTATE P858B / constraint pcm_858_manual_order_payload_mismatch ⇒ '
                    '**不要重送**(重送幾次都會是同一個答案)。'
                    '🔴 這不是「重複建單」的警告 —— 系統裡那張單(%)與你這次送來的至少有一處不同'
                    '(客人 / 品項 / 數量 / 單價 / 運費 / 收件資料 / 發票 / 來源 / 付款方式)。'
                    '⚠️ **先確認你要的是哪一件事**:'
                    '① 要**改**那張既有的單 ⇒ 去那張單上改,不要用建單重送(這裡不會幫你覆蓋它);'
                    '② 這是**另一張**單 ⇒ 請重新開一張建單表單(它會產一顆新編號),'
                    '   不要把舊表單改一改再送 —— 那顆編號綁的是**上一次那包內容**。',
                    v_existing.display_id
                    USING ERRCODE = 'P858B',
                          CONSTRAINT = 'pcm_858_manual_order_payload_mismatch';
  END IF;

  -- 🔴 稽核 P0-2(20260915233000):客人層級 advisory lock —— key 與 create_order(20260915100000:262)、
  --    begin_charge_attempt(20260904050000)逐字同一個算法。補登記收款判「客人是否已另下新單」時拿同一把,
  --    兩邊序列化:補登先拿到 ⇒ 這裡等它 commit 再建;這裡先拿到 ⇒ 補登等這張單 commit 之後才看得到它。
  --    位置:G7 之前的輸入驗證與冪等早退之後、INSERT 之前 ⇒ G7 之前被拒的呼叫與同鍵重送不排隊
  --    (G7 之後仍有規格驗證,那種失敗會先等到鎖才被拒)。本函式拿鎖之後不再鎖任何既有訂單列。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer_user_id::text, 0));

  -- 20260926100000:員工先選好客人、老闆接著停用、員工再送出 ⇒ 在這裡擋下。
  --   FOR SHARE 與 admin_disable_customer 的 FOR UPDATE 互斥 ⇒ 兩者一先一後。
  --   放在冪等早退之後:停用前已經建好的單, 同一把鍵重送仍回原單, 不會被誤擋。
  SELECT c.disabled_at INTO v_disabled_at FROM public.customers c WHERE c.user_id = p_customer_user_id FOR SHARE;
  IF v_disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 這位客人已停用, 不能建立訂單;請先到客戶頁恢復會員'
      USING ERRCODE = '42501';
  END IF;

  -- ── G7 建單(display_id 有界重試;形狀照 create_order `:432-463`) ───────────
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();
      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
        invoice_requested,
        -- 🔴 **`tax_total` 顯式寫 0(片 B2丙, 2026-08-29)** —— 不是「忘了寫所以走 DEFAULT」。
        --
        -- 🔴🔴 **而這個 0 是一個【假設】, 不是一個保證。codex 2026-08-29 must-fix, 它是對的。**
        --    ~~我原本寫「為什麼 0 是對的:單價來自 `price_general`, 而它含稅」~~ **那句話太寬**:
        --    **那是【今天唯一那個呼叫端】的性質, 不是【本函式的契約】。**
        --    本函式**直接收** `p_lines.unit_price`, 而它:
        --      · **不查也不驗** `price_general`
        --      · 代購品項(`variant_id` 是 NULL)的單價是**員工自己打的**
        --      · `p_shipping_fee` 同樣沒有任何「已含稅」的保證
        --      · 其他 service_role 呼叫端可以送任意合法非負單價
        --    ⇒ **有人送未稅價進來時, `tax_total = 0` 會少收稅。**
        --
        --    **⇒ 所以這一行的正確講法是**:
        --      「**假設**送進來的每一筆單價與運費都是【含稅】的 ⇒ 稅已內含在 `total` 裡 ⇒ `tax_total = 0`。
        --        而**本函式不強制那個假設**。」
        --    ✅ **今天那個假設成立**, 因為唯一的呼叫端是後台建單, 而它的目錄
        --       **只讀 `price_general`**(`apps/admin/src/lib/orders/manual-order-catalog.ts:84` 欄位表逐字),
        --       而 `price_general` 是含稅的(Sean 2026-08-29 逐字:
        --       「網站售價都含稅沒問題, 但是經銷價都是未稅。」)
        --    ⚠️ **而代購品項那一格【今天就已經沒有保證】** —— 它的單價是人打的。
        --       本片**沒有**擋它, 也沒有替它算稅 ⇒ **那是一個已知缺口, 寫在這裡而不是被靜靜帶過。**
        --
        -- 🔴 **⇒ 契約落地之前, 不得無條件宣稱這個 0 是對的。**
        --    要讓它變成保證, 需要下面「下一片」清單裡的第 1、2 項(價格基礎欄位 + 參數)。
        --    🔴 **而【那一天】要改這裡**:後台建單那顆兩段切換([定價][經銷])一旦做出來,
        --       經銷價(**未稅**)就會第一次變成訂單金額
        --       ⇒ 那一刻本行要開始**真的算稅**
        --       (進位依據:營業稅法 §14 第一項「尾數不滿通用貨幣一元者, 按四捨五入計算」)
        --    ⚠️ **而【不要】把它讀成 `ROUND(未稅小計 × 0.05)` 就好**(codex 2026-08-29 consider):
        --       那個式子**沒有處理**:應稅運費(營業稅法 §16:價額外收取的一切費用都進銷售額)、
        --       折扣怎麼分攤、代購品項的稅制、免稅品項。
        --       ⇒ **真正的算式要等【價格基礎與稅基契約】落地之後才寫得出來**
        --       ⇒ **這段註解不是規格。**
        --    ⚠️ **而本函式今天沒有任何參數說得出「這張是定價單還是經銷單」** ——
        --       那顆切換要加參數 ⇒ 而 `CREATE OR REPLACE` 加不了參數 ⇒ 要 `DROP + CREATE`。
        tax_total,
        order_source, payment_channel, manual_request_id, manual_request_payload_sha256,
        notification_email,
        -- 第 9 代:這張單一台車(顧客站的單這欄恆 NULL, 它的車在品項上)。
        vehicle_snapshot,
        -- 🔴 **第 6 代新增**:這張單的單價是【未稅】的 ⇒ 顯式寫 'exclusive'。
        --    🛑 **不可以靠 DEFAULT** —— DEFAULT 是 'inclusive'(顧客站與所有既有單),
        --       走 DEFAULT 等於讓這張單**自稱含稅**, 而它的 `subtotal` 是未稅的。
        price_tax_mode,
        shopee_username,
        shopee_order_no
      ) VALUES (
        v_display_id, p_customer_user_id, NULL, v_ship_to, v_tier,
        v_subtotal::integer, p_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice,
        v_invoice_requested,  -- 🔴 顯式寫入,**不是走 DEFAULT** —— 走 DEFAULT 就等於忽略員工那一勾。
        v_tax::integer,  -- 🔴 **第 6 代:這裡不再是 0** —— ⛔ ~~顯式的 0,不是預設的 0~~
                         --    舊字面留刪除線:搜「顯式的 0」的人要同一發撞到這裡。
        -- 🔴 這兩欄顯式寫。不寫的後果見檔頭 §2。
        p_order_source, p_payment_channel, p_manual_request_id, v_payload_sha,
        v_notification_email,
        v_vehicle,
        v_price_tax_mode,
        v_shopee_username,
        v_shopee_order_no
      )
      RETURNING id INTO v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴🔴 codex R1 `:248`:**這條路不得回 `idempotent: true`。**
      --    舊版在這裡直接把既有那張單回出去 —— 而**它從來沒有比對過對方寫了什麼**
      --    ⇒ 上面 G6.5 那道逐內容比對,在「兩發並行」這條路上等於不存在。
      --    ⇒ 處置逐字沿用退款 RPC 對同一條路的定位(`20260820021000:311-316`):
      --      **拒絕本次、請呼叫端重試一次** —— 重試時 G6.5 就看得到那一列,也就會比對內容。
      --    ⚠️ 走到這裡只有一種情況:兩發並行、兩發都在 G6.5 查無、其中一發先寫進去。
      IF v_cname = 'orders_manual_request_id_uniq' THEN
        -- 🔴🔴 codex R2 `N2`:**上一版這裡是一顆沒有代碼的 RAISE,而它對呼叫端說「請重送」。**
        --    那句話有一個致命前提:**重送的人要用同一顆 request id。**
        --    而**今天 repo 裡沒有任何呼叫端實作那件事** ⇒ 前端最可能的行為是
        --    「這次失敗了 ⇒ 開新表單 ⇒ 產一顆新 id ⇒ 再送」
        --    ⇒ 🔴 **第一張單其實已經建好了,於是變成兩張真訂單、要出兩次貨。**
        --    ⇒ 病灶不是訊息寫得不夠清楚:**是我把一個決定交給了一個還沒被寫出來的呼叫端**,
        --      而它的預設行為剛好是錯的那一邊。
        --    ⇒ 修法=給它**機器讀得懂的把手**(SQLSTATE + CONSTRAINT token,體例照 repo 既有
        --      `P2B02` 那族),而不是只給人看的字。
        RAISE EXCEPTION 'admin_create_manual_order: 同一個建單請求正在被並行送出 ⇒ 拒絕本次。'
                        '🔴 **呼叫端合約(這一句是給程式看的,不是給人看的)**:'
                        '收到 SQLSTATE P858A / constraint pcm_858_manual_order_concurrent_request ⇒ '
                        '**保留同一顆 manual_request_id 原樣重送**,'
                        '⚠️ **絕對不要產生新的 manual_request_id** —— '
                        '這一刻另一發很可能已經成功建好那張單了,換新 id 會建出【第二張真訂單】。'
                        '重送時會走內容比對:內容相同 ⇒ 回那張已建好的單(idempotent:true);'
                        '內容不同 ⇒ 回 P858B。'
                        USING ERRCODE = 'P858A',
                              CONSTRAINT = 'pcm_858_manual_order_concurrent_request';
      END IF;
      -- 🔴 只吞 display_id 的碰撞;其他 unique violation 原樣上拋(重試會把語意訊號吃掉)。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        RAISE EXCEPTION 'admin_create_manual_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 建單迴圈離開時沒有訂單 id;拒絕繼續';
  END IF;

  -- ── G8 品項落表 + 筆數守 ───────────────────────────────────────────────────
  -- ══ 🔴🔴 ⟦b4-SPEC1⟧ codex R2 MF1:**真正落表的是 `pv.spec`, 而上面三道驗證驗的是呼叫端那一份** ══
  --   G6 那三道(值全字串 / 不得含價格欄 / 是物件)跑在迴圈裡, 吃的是 `v_line -> 'spec'`。
  --   而本片把落表的值換成了 `pv.spec` ⇒ **被驗的與被寫的不再是同一個東西。**
  --   📌 這正是本片自己製造的:改之前它們是同一份, 所以那三道涵蓋得到;改之後就不是了,
  --      **而那三道一個字都不用改就會繼續全綠。**
  --   ⚠️ 今天 `order_items_snapshot_whitelist` 那道表上的 CHECK 仍會擋 ⇒ 不是立即可利用;
  --      🔴 而那是**別人家的守門** —— 正式庫若缺它或它漂移了, 經銷價 / cost 會直接寫進快照。
  --      (本函式檔頭 codex R1 `:203` 講過同一句話, 而本片讓它重新成立。)
  --   ⇒ 自己驗一遍, 判準逐字對齊上面那兩道。
  --
  --   🛑🛑 **codex R3:這一道【不是原子的】, 而我原本沒有講。**
  --      這個 `EXISTS` 與下面那個 `INSERT` 是**兩個 statement**;本函式跑在 READ COMMITTED
  --      ⇒ 兩者各自取一次快照 ⇒ **供應商同步若剛好夾在中間, 會「驗 A 而寫 B」。**
  --      📌 ⇒ 所以這一道的正確定位是**訊息**, 不是防線 —— 它讓員工看得懂哪裡不對,
  --         而**原子的保證來自 `order_items_snapshot_whitelist` 那道表上的 CHECK**
  --         (同一句 INSERT 裡求值 ⇒ 沒有中間狀態)。
  --      ⚠️ **而那正好是本函式檔頭 codex R1 `:203` 說的「別人家的守門」** ——
  --         ⇒ 兩句話一起讀才是完整的:**它是別人家的, 而它是這裡唯一原子的那一道。**
  --      🔴 **我沒有把這道合進 INSERT** —— 那要嘛用 CTE 重寫整段、要嘛在 SQL 裡想辦法 RAISE,
  --         兩條都會把一支「只加一個覆蓋」的 migration 變成重寫 G8。**那是另一片。**
  --         ⇒ 已明寫, 不假裝這裡是原子的。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_items) AS it
      JOIN public.product_variants AS pv
        ON pv.id = NULLIF(it ->> 'variant_id', '')::uuid
     WHERE NOT public.m3_jsonb_values_all_string(pv.spec)
        OR pv.spec ?| ARRAY['price_store', 'price_by_tier', 'cost']
  ) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 權威規格本身不合格(有非字串值, 或出現價格欄名)'
                    ' —— 這不是員工送錯, 是 product_variants.spec 那一列要先修好';
  END IF;

  -- ══ 🔴 三個陣列必須等長, 不等長就停(codex R6 2026-09-09 nit)═══════════════
  --   `v_items`(要插的列)· `v_item_ids`(它們的 id)· `v_line_bases`(稽核那一份)
  --   是**同一個迴圈裡平行 append 的三份**, 而下面靠「第 n 筆對第 n 筆」把它們接起來。
  -- 🛑 **今天走不到這一格** —— 迴圈裡沒有 `CONTINUE`、沒有早退, 三個一定同步。
  --   ⇒ 📌 **所以它不是在修一個現在的 bug, 是在釘住一個【維護時很容易破壞】的不變式**:
  --     未來有人在「append id」與「append v_items」之間插一個 `CONTINUE`,
  --     多出來的 id 會被 INSERT **靜靜忽略**, 而稽核那一份已經 append
  --     ⇒ 留下一筆**指向不存在品項**的稽核紀錄。
  -- 🔴 **而那個世界【今天沒有任何東西會叫】**:短的那一邊會撞主鍵 NOT NULL 而紅,
  --   **長的那一邊不會** —— 兩個方向的傷害不對稱, 而不會叫的那個方向才是安靜的那個。
  IF pg_catalog.jsonb_array_length(v_item_ids) <> pg_catalog.jsonb_array_length(v_items)
     OR pg_catalog.jsonb_array_length(v_line_bases) <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 內部三個陣列長度不一致(items % / ids % / bases %)'
                    ' ⇒ 稽核會指到不存在的品項, 整筆停下。',
                    pg_catalog.jsonb_array_length(v_items),
                    pg_catalog.jsonb_array_length(v_item_ids),
                    pg_catalog.jsonb_array_length(v_line_bases);
  END IF;

  -- 🔴 **`id` 改成明確寫**(原本走欄位 DEFAULT)—— 稽核那一列要指得回這一列。
  --    對位靠 `WITH ORDINALITY`:`v_item_ids` 是在同一個迴圈裡、同一個順序 append 的,
  --    而 `jsonb_array_elements` 依陣列順序展開 ⇒ 第 n 個元素配第 n 個 id。
  --    🛑 **不靠 `RETURNING` 的回傳順序** —— 那個順序 SQL 標準沒有保證。
  INSERT INTO public.order_items (
    id, order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT (v_item_ids ->> (it.ord - 1)::integer)::uuid,
         v_order_id,
         NULLIF(it.val ->> 'variant_id', '')::uuid,
         it.val ->> 'variant_sku',
         -- ══ 🔴🔴 ⟦b4-SPEC1⟧:規格【不信呼叫端】—— 在這裡用權威那一份覆蓋 ═══════════
         --   病:這份快照是**不可變**的 ⇒ 送錯一次就永遠錯, 客人訂單明細上的顏色/尺寸補不回來。
         --   🔴 應用層 `284ee4cf`(2026-08-24)已修, 而**那顆 commit 動的檔在 `supabase/` 底下是 0 支**
         --      ⇒ 修法整個在應用層 ⇒ **任何不走那支 repository 的 `service_role` 呼叫端仍然繞得過。**
         --   ⇒ 本片是 DB 那一半。
         --   🔴 **為什麼取在這裡而不是迴圈裡**(codex R1 MF1):這裡在冪等比對【之後】
         --      ⇒ 指紋仍然只吃呼叫端送的東西 ⇒ 檔頭 `:207` 那句「決定性」保住;
         --      而重送時走的是上面那條 early return, **根本不會跑到這一行**
         --      ⇒ 變體事後被改被刪都不影響既有那張單。
         --   🛑 代購品項(`variant_id` 是 NULL)⇒ `LEFT JOIN` 不命中 ⇒ 走 `it -> 'product_snapshot'` 原樣,
         --      它恆 `{}` 是**既有的刻意限制**(`manual-order-repository.ts:265` 同款判斷), 不是本片要解的。
         --   ⚠️ 變體不存在(被刪)而 `variant_id` 非 NULL ⇒ `pv.spec` 是 NULL ⇒ `COALESCE` 成 `{}`;
         --      **而那一列的 FK 會在同一句 INSERT 裡擋下整筆** ⇒ 不會留下空規格的真訂單。
         --   ⚠️ `SET search_path = ''` ⇒ 表名寫全 `public.product_variants`。
         --   📎 權威來源:`20260531142533_init_product_variants.sql:43`(`spec jsonb NOT NULL DEFAULT '{}'`)
         --      · `:62` CHECK 只保證 object · `:40` `id uuid PRIMARY KEY` ⇒ 一個 variant 恰一份 spec。
         -- ══ 🔴🔴 Sean 2026-09-01 12:0x 拍【甲】—— 原話一個字:「甲」 ══════════════
         --   題目逐字:「員工手動建單選了網站上有的商品, 而那個商品在我們目錄裡沒有填規格。
         --             員工自己打了規格。訂單上要留哪一份?」
         --     甲 留員工打的(目錄有填才用目錄的)  ← **他選這個**
         --     乙 一律用目錄的(目錄空的就寫空的)  ← ⛔ **本檔原本的行為, 已被推翻**
         --     丙 擋下來, 叫員工先去補目錄
         --   落點 `~/pcm-mailbox/決策-手動建單目錄沒填規格時用誰的-20260901.md`
         --
         --   🔴 **為什麼**(端題時給他的那一句):目錄是空的時候, 它**不是一個更可信的真相,
         --      它是【沒有值】** ⇒ 拿沒有值去蓋掉有值, 不是取權威, 是**把資料弄丟**,
         --      而且丟得很安靜 —— 員工打了字、按了送出、單子成立了, 而那格是空的, 畫面零訊號。
         --   🔴 **而它踩得到多少**:`product_variants` 54,000 列 / 空規格 **13,112(24%)**
         --      (2026-08-31 主視窗唯讀跑正式庫, 數字與範圍見本檔 `:31`)。
         --
         --   ══ 「空」的定義:三種都處理, 而只有第三種在今天可達 ═══════════════════
         --     ① `pv.spec IS NULL`  ⇒ 🔵 **今天不可達**:欄位是 `NOT NULL DEFAULT '{}'`
         --        (`20260531142533_init_product_variants.sql:43`)。仍然寫進條件, 理由是
         --        **它今天不可達的依據是【另一支檔的欄位定義】** —— 那支哪天放寬了,
         --        這裡會安靜地把 NULL 當成「有值」丟進 `jsonb_set` ⇒ 整格變 NULL。
         --     ② 空字串 `''` ⇒ 🔵 **結構上不可達**:`pv_spec_is_object` CHECK 要求
         --        `jsonb_typeof(spec) = 'object'`(同檔 `:62`)⇒ 字串進不了這一欄。
         --        ⇒ 所以**不為它寫條件** —— 寫了會是一句永遠為假的死碼, 而死碼讀起來像防護。
         --     ③ `pv.spec = '{}'::jsonb` ⇒ 🔴 **這才是那 13,112 列** ⇒ 本片真正要擋的那一種。
         --   ⛔ ~~我原本寫「`{"a": null}` 算有值, 會贏過員工那份, 那是刻意的」~~ **作廢**
         --      (codex R1 抓的):`{"a": null}` **根本走不到這裡** ——
         --      上面 `m3_jsonb_values_all_string` 那道(`:549` 一族)要求值全部是字串,
         --      `null` 不是 ⇒ **整張單直接 RAISE**。⇒ 我描述了一個不存在的行為。
         --      📌 而它讀起來完全合理, 因為它在講一個**看起來會發生**的情境。
         --
         --   ══ 🔴🔴 **「空」在這一格有【兩個意思】, 而 Sean 分開答了兩次** ══════════
         --      ① **空的 jsonb `{}`**(整個規格沒有任何鍵)⇒ **留員工打的**
         --         依據:Sean 2026-09-01 12:0x 原話一個字「甲」。
         --      ② **鍵在、而值是空字串**(`{"color": ""}`)⇒ 🔴 **用目錄的那個空白**
         --         依據:Sean 2026-09-01 12:1x 原話逐字「**算有填(用目錄的空白)**」。
         --      ⇒ ✅ 所以本 CASE 只判 `{}`, 是**對的**, 不是漏掉 ②。
         --
         --      🔵 **這一格的來歷寫下來, 因為它差一點被我自己決定掉**:
         --      codex R1 舉了 `{"color": ""}` 當 must-fix 反例(「用空字串蓋掉員工打的紅」)。
         --      🛑 而我判它**不是 bug, 是一格沒有被問到的業務規則** ⇒ 沒有自行擴張拍板, 端上去問。
         --      ⇒ 他花一行答完, 而答案是 ②(與我原本猜的方向相反 —— 我以為他會想保住員工那份)。
         --      📌 **⇒ 我猜錯了, 而因為我沒有把猜的東西寫成碼, 那個錯不需要任何人來修。**
         --      ⇒ ⇒ 若當時自己決定, 他永遠不會知道有這一格,
         --         而它會變成一個沒有人記得為什麼的行為。
         CASE WHEN pv.id IS NULL
                OR pv.spec IS NULL
                OR pv.spec = '{}'::jsonb
              THEN it.val -> 'product_snapshot'
              ELSE pg_catalog.jsonb_set(it.val -> 'product_snapshot', '{spec}', pv.spec)
         END,
         (it.val ->> 'quantity')::integer,
         (it.val ->> 'unit_price')::integer,
         (it.val ->> 'line_total')::integer
    FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS it(val, ord)
    LEFT JOIN public.product_variants AS pv
           ON pv.id = NULLIF(it.val ->> 'variant_id', '')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 品項落 % 列、期望 %;整筆回滾',
                    v_n, pg_catalog.jsonb_array_length(v_items);
  END IF;

  -- ── G9 稽核落列(F1;形狀逐字對齊 `20260804180000:251-260`)────────────────
  -- 🔴 `before` 是 NULL 而不是 `{}` —— **這張單建立之前不存在**,那不是「空的狀態」是「沒有狀態」。
  -- 🔴 `after` 只放**訂單層**的欄與**筆數**,不逐品項展開:
  --    ① 品項細節在 `order_items`,`target` 指得到那張單 ⇒ 查得到,不必抄一份
  --    ② 稽核表是 append-only、永久留存 ⇒ **少抄一份 = 少一個會過期、會外洩的副本**
  --    ⚠️ 零經銷價、零 cost(本函式從頭到尾不查價,見檔頭 §4)。
  -- 貼板 261:客人身上還沒有這個蝦皮帳號 ⇒ 補記(Q3 甲:自動加到客人身上)。同一刻別人搶先記到另一位客人 ⇒ 擋, 整張單不建。
  IF v_shopee_username IS NOT NULL AND v_shopee_owner IS NULL THEN
    INSERT INTO public.customer_shopee_accounts (customer_user_id, account, created_by)
    VALUES (p_customer_user_id, v_shopee_username, pg_catalog.btrim(p_actor, E' \t\r\n'))
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      v_shopee_added := true;
    ELSE
      SELECT a.customer_user_id INTO v_shopee_owner
        FROM public.customer_shopee_accounts a
       WHERE pg_catalog.lower(a.account) = pg_catalog.lower(v_shopee_username);
      IF v_shopee_owner IS DISTINCT FROM p_customer_user_id THEN
        RAISE EXCEPTION 'admin_create_manual_order: 蝦皮帳號 % 已經記在另一位客人身上', v_shopee_username USING ERRCODE = 'P2S01';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (pg_catalog.btrim(p_actor, E' \t\r\n'), 'order.manual_create',
          -- ⚠️ **`request_id` 這一欄的語意在這裡與別的 admin 操作不同源**(f5 R3 nit,記一筆):
          --    建表註解(`20260712210000:51`)說它是「correlation id(貫穿 admin 寫入→audit→DB→外部服務 log)」,
          --    而本函式填的是**本片自己的冪等鍵** `manual_request_id`。
          --    ✅ 它**串得回那一次操作**(那正是 correlation 要的),所以合理、不改。
          --    ⚠️ 但**它不是別處那個 request_id 的同一條血脈** ⇒ 拿它跨操作做關聯查詢時要知道這件事。
          'order:' || v_order_id::text, p_manual_request_id::text,
          NULL,
          pg_catalog.jsonb_build_object(
            'display_id',       v_display_id,
            'customer_user_id', p_customer_user_id,
            'order_source',     p_order_source,
            'shopee_username',  v_shopee_username,
            'shopee_order_no',  v_shopee_order_no,
            'shopee_account_added', v_shopee_added,
            'payment_channel',  p_payment_channel,
            'shipping_method',  p_shipping_method,
            -- 🔴 **第 6 代加這兩格**(codex 2026-09-05 must-fix #3):
            --    audit 記了 subtotal/total 卻沒記稅與價別 ⇒ **事後從建立事件看不出這張單是哪一種**,
            --    而 `tax_total = 0` 時尤其分不出(免稅 vs 含稅價)。
            'tax_total',        v_tax,
            'price_tax_mode',   v_price_tax_mode,
            'subtotal',         v_subtotal,
            'shipping_fee',     p_shipping_fee,
            'total',            v_total,
            'item_count',       pg_catalog.jsonb_array_length(v_items),
            -- 🔴🔴 **第 7 代加這一格** —— 它是本片唯一「事後查得到員工原始意思」的落點。
            --    🛑 而它**只在 audit**:不進 `order_items`(那要動表結構, 不在 Sean 拍的範圍)、
            --      不進冪等指紋(🔴 加進去會在部署窗製造真的失敗:舊版表單不送這個鍵
            --      ⇒ 新舊兩版對同一筆重送算出不同指紋 ⇒ 被判「同鍵不同內容」而拒;
            --      而它不影響「這是不是同一個請求」的答案 —— **錢一模一樣**)。
            --    🔬 **怎麼查**(寫在這裡, 因為三個月後那個人不會回頭讀 migration):
            --      SELECT after -> 'line_tax_bases'
            --        FROM public.admin_audit_log
            --       WHERE action = 'order.manual_create'
            --         AND target = 'order:' || '<那張單的 id>';
            'line_tax_bases',   v_line_bases,
            -- 第 8 代:這張單存的等級 + 是不是員工手選的(事後分得出「客人本來就是經銷」與「員工替這張單改成經銷」)。
            'tier_at_checkout', v_tier,
            'tier_overridden',  (p_tier IS NOT NULL),
            -- 第 9 代:車輛怎麼來的(manual_dict / manual_text / NULL = 沒填);整包不進 audit, 進 orders 那欄就查得到。
            'vehicle_source',   v_vehicle ->> 'source'),
          NULL, 'admin');
  -- 🔴 筆數守:trigger 抑制 / FORCE RLS ⇒ **零稽核的成功建單**,而那正是 F1 要擋的東西
  --    ⇒ 落不進去就整筆回滾,**不接受「單建好了但沒人知道是誰建的」**。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稽核落 % 列(期望恰 1)⇒ 整筆回滾;'
                    '這張單不准在沒有經手人紀錄的情況下存在', v_n;
  END IF;

  -- ⚠️ **重送(idempotent)那條路【不落 audit】** —— 它在 G6.5 就 return 了。
  --    理由:那一發**什麼都沒建**,而 audit 記的是「發生了什麼」不是「誰按過按鈕」。
  --    ⇒ 一張單 = 恰一列 `order.manual_create`。查「誰建的」不會查到兩個人。

  -- 🔴 **刻意不寫 `order_legal_consents`** —— 手動單沒有客人的同意動作,偽造它是錯的。
  -- 貼板 261:shopee_account_added 只在【有帶蝦皮帳號】時才回 —— 舊版後台逐字比對回傳只能有三個鍵,
  --   不帶帳號就跟貼板前一模一樣 ⇒ 先貼板、碼還沒推的那段時間, 舊後台建單照常。
  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order_id, 'display_id', v_display_id, 'idempotent', false)
    || CASE WHEN v_shopee_username IS NOT NULL
            THEN pg_catalog.jsonb_build_object('shopee_account_added', v_shopee_added)
            ELSE '{}'::jsonb END;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb, text, text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb, text, text, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb, text, text, jsonb, text, text) TO service_role;
DO $cmt2$
DECLARE v text;
BEGIN
  SELECT cmt INTO v FROM _q1_create_comment_rb;
  EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.admin_create_manual_order(uuid, uuid, text, text, text, text, jsonb, jsonb, integer, jsonb, text, text, jsonb, text, text) IS %L',
    pg_catalog.regexp_replace(v, E'(\n\n)?報價單Q1 2026-10-01\\(貼板 262\\):.*$', ''));
END
$cmt2$;

ALTER TABLE public.orders DROP CONSTRAINT orders_payment_instrument_check;
ALTER TABLE public.orders DROP COLUMN payment_instrument;
ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_shopee_fee;
ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_fee_shape;
ALTER TABLE public.order_payments DROP CONSTRAINT order_payments_instrument_check;
ALTER TABLE public.order_payments DROP COLUMN fee_amount;
ALTER TABLE public.order_payments DROP COLUMN fee_rate;
ALTER TABLE public.order_payments DROP COLUMN payment_instrument;
DROP TABLE public.payment_fee_rates;

NOTIFY pgrst, 'reload schema';

COMMIT;
