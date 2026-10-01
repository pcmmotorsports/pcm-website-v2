-- 20261001170000  收款手續費 + 店內刷卡標記(貼板 262;報價單Q1 2026-10-01)
-- Sean 2026-10-01:付款方式多一個「刷卡」,營業額照收款方式扣手續費;給客人的金額不變。
--   Q32 甲 TapPay 也扣、費率分開設(目前都是 2.5%)· Q33 乙 營業額按收款日 · Q34 甲 營業額四捨五入到元
--   Q35 甲 手續費從實際刷卡金額算(含運費)· Q36 甲 手續費不退 · Q37 甲 分次付款每筆各自扣
--   主視窗技術決定甲:店內刷卡 = 當面收款(沿用 rail = 'cash' 那條路的所有規則),只加「刷卡」標記。
-- 計畫:~/pcm-mailbox/計畫-刷卡付款與營業額-20261001.md
--
-- 本檔第一部分(這一節)只放「手續費」:
--   ① payment_fee_rates:費率表,依生效日管理(改費率 = 新增一列, 不改舊列)。
--   ② order_payments 加 payment_instrument / fee_rate / fee_amount。
--   ③ BEFORE INSERT 觸發器:依收款方式與收款時間取費率, 算出這筆的手續費並寫在這筆上。
--      🔴 放在觸發器而不是 RPC:TapPay 那條路(confirm_order_payment)與人工登記都寫 order_payments,
--         觸發器是唯一同時攔得到兩條路的地方;TapPay 那支不用改。
--      🔴 觸發器【不會 raise】(除了資料本身不合法):它掛在 TapPay 付款確認的交易裡,
--         取不到費率時寫 NULL(營業額畫面另外標示「有幾筆沒有費率」),不讓付款確認失敗。
--   ④ 既有的 TapPay 收款(正式庫 2026-10-01 唯讀:5 列 card、0 列沖銷)回填手續費。
--   ⑤ 新的三欄加進 order_payments 的不可變更欄位清單(pcm_op2b_immutable_columns)。
--   ⑥ 今日實收扣手續費。⑦ 登記收款 / 手動退款兩支 RPC 加「付款標記」參數, 手動退款不可變更欄位加付款標記。
-- 建單 RPC(admin_create_manual_order)的付款標記另外一段:等網站B 的 261 貼完, 以那之後的正式庫版本為底。
--
-- 進位(Sean Q34 甲,例:3100 × 2.5% ⇒ 營業額 3022.5 ⇒ 3023):
--   淨額 = round(金額 × (1 − 費率)),PostgreSQL numeric 的 round 是四捨五入(.5 進位);手續費 = 金額 − 淨額。
--   3100 ⇒ 淨額 3023、手續費 77。
-- 沖銷列(reverses_payment_id 不是 NULL)= 原列登錯的更正 ⇒ 手續費一起反號(原列 77 ⇒ 沖銷列 −77)。
--   這不是退款:退款的手續費不退(Q36 甲), 退款在退款表, 不經過這裡。
--
-- 回滾:supabase/rollbacks/20261001170000-rollback.sql
--
-- 🔴 本支碰到 `manual_failed` 那個共用邊界。兩支的判準必須【並排讀一次】:
--    · pcm_order_refundable_remaining          ⇒ corrected_to = 'money_moved' 才扣
--    · pcm_order_pending_manual_verdict_amount ⇒ v.refund_id IS NULL 才算
--    🛑 只改一邊 ⇒ 另一邊不會紅, 而畫面會雙重計算或漏算。板列 ⟦b9-REFUNDNUM1⟧。
--    (本支只是在 admin_record_manual_refund 的正式庫原文上加付款標記參數, 那支裡呼叫 pcm_order_refundable_remaining
--     的那段一字未改;兩支的判準都沒動。已並排讀過。)

BEGIN;
SET LOCAL lock_timeout = '5s';   -- 拿不到表鎖就停, 不在正式庫排隊卡住別人

-- ═══ ① 費率表 ═══
CREATE TABLE public.payment_fee_rates (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fee_kind       text        NOT NULL CHECK (fee_kind IN ('tappay', 'card_terminal')),
  rate           numeric(6,5) NOT NULL CHECK (rate >= 0 AND rate < 1),
  effective_from timestamptz NOT NULL,
  note           text        NOT NULL CHECK (pg_catalog.btrim(note) <> ''),
  created_at     timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (fee_kind, effective_from)
);
COMMENT ON TABLE public.payment_fee_rates IS
  '收款手續費率(報價單Q1 2026-10-01)。改費率 = 新增一列並設生效日, 不改舊列;每筆收款寫入當下取「生效日 ≤ 收款時間」最新的一列, 並把費率與手續費記在那筆收款上。';
ALTER TABLE public.payment_fee_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_fee_rates FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_fee_rates FROM anon, authenticated;
GRANT SELECT ON TABLE public.payment_fee_rates TO service_role;
-- 後台(service_role)讀費率:不靠 BYPASSRLS 這個平台屬性, 明寫政策。
CREATE POLICY payment_fee_rates_select_service_role ON public.payment_fee_rates
  FOR SELECT TO service_role USING (true);

-- 生效日取遠早的日子:既有收款(最早 2026-08)也要取得到 2.5%。
INSERT INTO public.payment_fee_rates (fee_kind, rate, effective_from, note) VALUES
  ('tappay',        0.025, '2026-01-01 00:00:00+08', 'Sean 2026-10-01 Q32 甲:TapPay 也扣, 目前 2.5%'),
  ('card_terminal', 0.025, '2026-01-01 00:00:00+08', 'Sean 2026-10-01:店內刷卡 2.5%');

-- ═══ ② order_payments 新欄 ═══
ALTER TABLE public.order_payments
  ADD COLUMN payment_instrument text,
  ADD COLUMN fee_rate           numeric(6,5),
  ADD COLUMN fee_amount         integer;

-- 付款標記(刷卡 / 蝦皮)只能掛在 rail = 'cash'(當面收款那條路)。蝦皮只能是蝦皮來源的訂單:由 RPC 檢查(跨表)。
ALTER TABLE public.order_payments
  ADD CONSTRAINT order_payments_instrument_check
  CHECK (payment_instrument IS NULL OR (payment_instrument IN ('card_terminal', 'shopee') AND rail = 'cash'));
-- 蝦皮進帳那一筆一定要有手續費(可以是 0)。
ALTER TABLE public.order_payments
  ADD CONSTRAINT order_payments_shopee_fee
  CHECK (payment_instrument IS DISTINCT FROM 'shopee' OR reverses_payment_id IS NOT NULL OR fee_amount IS NOT NULL);
-- 手續費不可能超過金額本身(同號、絕對值不大於金額);沒有費率時兩欄一起是 NULL。
ALTER TABLE public.order_payments
  ADD CONSTRAINT order_payments_fee_shape
  CHECK ((fee_rate IS NULL OR fee_amount IS NOT NULL)
         AND (fee_amount IS NULL OR (pg_catalog.abs(fee_amount) <= pg_catalog.abs(amount)
                                     AND (fee_amount = 0 OR pg_catalog.sign(fee_amount) = pg_catalog.sign(amount)))));
COMMENT ON COLUMN public.order_payments.payment_instrument IS
  'card_terminal = 店內刷卡;shopee = 蝦皮進帳(rail 都是 cash, 規則同當面收款);NULL = 一般匯款 / 現金 / TapPay。';
COMMENT ON COLUMN public.order_payments.fee_rate IS
  '這筆寫入當下取到的手續費率(payment_fee_rates);不收手續費的方式或取不到費率時為 NULL。';
COMMENT ON COLUMN public.order_payments.fee_amount IS
  '這筆的手續費(整數元);營業額 = 金額 − 手續費。不收手續費的方式 = 0;應收而取不到費率 = NULL;蝦皮 = 訂單總額 − 蝦皮進帳(RPC 帶入)。沖銷列 = 原列的反號。';

-- 訂單:付款標記。付款管道都是 cash;有蝦皮標記就一定是蝦皮來源。
--   🔴 這裡只收單向(標記 ⇒ 來源), 不收反向(蝦皮來源 ⇒ 一定有標記):現行 admin_create_manual_order
--      建得出蝦皮來源的單(20261001150000)而不會寫這一欄 ⇒ 反向那條會讓建蝦皮單整張失敗(Fable R1 #1)。
--      反向由建單 RPC 那一段(本支第二段, 等 261 貼完)改成「蝦皮來源自動帶蝦皮標記」時一起收緊。
ALTER TABLE public.orders ADD COLUMN payment_instrument text;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_instrument_check
  CHECK (payment_instrument IS NULL
         OR (payment_instrument = 'card_terminal' AND payment_channel = 'cash')
         OR (payment_instrument = 'shopee' AND payment_channel = 'cash' AND order_source = 'manual_shopee'));
COMMENT ON COLUMN public.orders.payment_instrument IS
  '付款標記:card_terminal = 刷卡(店內刷卡機);shopee = 蝦皮(只限蝦皮來源);NULL = 照 payment_channel。畫面顯示以這欄優先。';

-- 手動退款:店內刷卡的單退款時標記(退款在刷卡機操作, 這裡只登記)。
ALTER TABLE public.order_manual_refunds ADD COLUMN payment_instrument text;
ALTER TABLE public.order_manual_refunds
  ADD CONSTRAINT order_manual_refunds_instrument_check
  CHECK (payment_instrument IS NULL OR (payment_instrument = 'card_terminal' AND rail = 'cash'));
COMMENT ON COLUMN public.order_manual_refunds.payment_instrument IS
  'card_terminal = 退回刷卡(在刷卡機操作, 這裡登記);NULL = 匯款 / 現金。';

-- ═══ ③ 觸發器 ═══
CREATE FUNCTION public.pcm_payment_fee_rate(p_fee_kind text, p_at timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.rate
    FROM public.payment_fee_rates r
   WHERE r.fee_kind = p_fee_kind
     AND r.effective_from <= p_at
   ORDER BY r.effective_from DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.pcm_payment_fee_rate(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_payment_fee_rate(text, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_payment_fee_rate(text, timestamptz) TO service_role;

CREATE FUNCTION public.pcm_order_payment_fee_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind   text;
  v_rate   numeric;
  v_parent record;
  v_given  integer := NEW.fee_amount;
BEGIN
  -- 呼叫端帶進來的費率與手續費一律不採用(這兩欄只由這裡算);唯一例外是蝦皮進帳, 見下。
  NEW.fee_rate   := NULL;
  NEW.fee_amount := NULL;

  IF NEW.reverses_payment_id IS NOT NULL THEN
    -- 沖銷 = 原列的完整反號(pcm_op2b_reversal_amount 保證金額恰為反號)⇒ 標記與手續費照抄、手續費反號。
    SELECT p.payment_instrument, p.fee_rate, p.fee_amount INTO v_parent
      FROM public.order_payments p
     WHERE p.id = NEW.reverses_payment_id;
    IF FOUND THEN
      NEW.payment_instrument := v_parent.payment_instrument;
      NEW.fee_rate           := v_parent.fee_rate;
      NEW.fee_amount         := CASE WHEN v_parent.fee_amount IS NULL THEN NULL ELSE -v_parent.fee_amount END;
    END IF;
    -- 找不到原列:不在這裡判, 交給 pcm_op2b_reversal_amount 拒(它的訊息比較清楚)。
    RETURN NEW;
  END IF;

  -- 蝦皮:手續費 = 訂單總額 − 蝦皮進帳, 由 admin_record_manual_payment 算好帶進來(那裡驗過 0 ≤ 手續費 < 金額)。
  IF NEW.payment_instrument = 'shopee' THEN
    NEW.fee_amount := v_given;   -- NULL 會被 order_payments_shopee_fee 擋下
    RETURN NEW;
  END IF;

  v_kind := CASE
              WHEN NEW.rail = 'card' THEN 'tappay'
              WHEN NEW.rail = 'cash' AND NEW.payment_instrument = 'card_terminal' THEN 'card_terminal'
              ELSE NULL
            END;

  IF v_kind IS NULL THEN
    NEW.fee_amount := 0;
    RETURN NEW;
  END IF;

  v_rate := public.pcm_payment_fee_rate(v_kind, NEW.received_at);
  IF v_rate IS NULL THEN
    RETURN NEW;  -- 應收手續費而取不到費率:兩欄留 NULL, 營業額畫面標示;不讓付款確認失敗。
  END IF;

  NEW.fee_rate   := v_rate;
  NEW.fee_amount := NEW.amount - pg_catalog.round(NEW.amount::numeric * (1 - v_rate))::integer;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.pcm_order_payment_fee_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_order_payment_fee_snapshot() FROM anon, authenticated;

CREATE TRIGGER order_payments_fee_snapshot_bi
  BEFORE INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_order_payment_fee_snapshot();

-- ═══ ④ 回填既有收款 ═══
-- 不收手續費的列 ⇒ 0;TapPay(card)⇒ 依收款時間取費率算。沖銷列在第二輪處理(要讀原列算好的值)。
UPDATE public.order_payments p
   SET fee_amount = 0
 WHERE p.reverses_payment_id IS NULL
   AND NOT (p.rail = 'card' OR (p.rail = 'cash' AND p.payment_instrument = 'card_terminal'));

UPDATE public.order_payments p
   SET fee_rate   = r.rate,
       fee_amount = p.amount - pg_catalog.round(p.amount::numeric * (1 - r.rate))::integer
  FROM (SELECT q.id, public.pcm_payment_fee_rate('tappay', q.received_at) AS rate
          FROM public.order_payments q
         WHERE q.reverses_payment_id IS NULL AND q.rail = 'card') r
 WHERE p.id = r.id
   AND r.rate IS NOT NULL;

UPDATE public.order_payments p
   SET payment_instrument = parent.payment_instrument,
       fee_rate           = parent.fee_rate,
       fee_amount         = -parent.fee_amount
  FROM public.order_payments parent
 WHERE p.reverses_payment_id = parent.id;

-- ═══ ⑤ 不可變更欄位:新三欄寫入後不得再改 ═══
-- 本體 = 正式庫 2026-10-01 唯讀 pg_get_functiondef 原文, 只多三行。
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
    CASE WHEN NEW.payment_instrument  IS DISTINCT FROM OLD.payment_instrument  THEN 'payment_instrument' END,
    CASE WHEN NEW.fee_rate            IS DISTINCT FROM OLD.fee_rate            THEN 'fee_rate' END,
    CASE WHEN NEW.fee_amount          IS DISTINCT FROM OLD.fee_amount          THEN 'fee_amount' END,
    CASE WHEN NEW.created_at          IS DISTINCT FROM OLD.created_at          THEN 'created_at' END);

  IF v_bad IS NOT NULL AND v_bad <> '' THEN
    RAISE EXCEPTION '這些欄位不可變更:%(可改的只有 note / payer_note / reviewed_by / reviewed_at;更正走沖銷,不是改列)',
                    v_bad
      USING ERRCODE = 'P2B34', CONSTRAINT = 'pcm_op2b_immutable_violation';
  END IF;

  RETURN NEW;
END
$function$;

-- ═══ ⑦ 登記收款 / 手動退款 RPC 加「付款標記」參數(報價單Q1 2026-10-01)═══
-- 本體 = 正式庫 2026-10-01 唯讀 pg_get_functiondef 原文;改動處都標「報價單Q1」。
-- 加參數 = 簽章改變 ⇒ DROP + CREATE(CREATE OR REPLACE 會長出第二支重載, PostgREST 會分不清)。
--   新參數都有 DEFAULT ⇒ 舊程式不帶新參數照樣叫得動;新程式要等本檔貼上才能帶新參數(貼板與推碼當成同一次動作)。
-- 🔴 DROP 帶走 ACL 與 COMMENT ⇒ 下面重設三行權限, COMMENT 從 DROP 前存下的原文接回並補一段說明。
CREATE TEMP TABLE _q1_fn_comment ON COMMIT DROP AS
  SELECT p.proname::text AS fn, pg_catalog.obj_description(p.oid, 'pg_proc') AS cmt
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('admin_record_manual_payment', 'admin_record_manual_refund');

DROP FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text);
CREATE FUNCTION public.admin_record_manual_payment(p_order_id uuid, p_request_id uuid, p_actor text, p_rail text, p_amount integer, p_received_at timestamp with time zone, p_bank_reference text DEFAULT NULL::text, p_payer_note text DEFAULT NULL::text, p_payment_instrument text DEFAULT NULL::text, p_shopee_payout integer DEFAULT NULL::integer)
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
  v_fee            integer;               -- 報價單Q1 2026-10-01:蝦皮進帳的手續費(訂單金額 − 進帳);其他方式由觸發器算
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

  -- ══ 付款標記(報價單Q1 2026-10-01;Sean:店內刷卡、蝦皮都走當面收款那條路, 只多一個標記)══
  IF p_payment_instrument IS NOT NULL AND p_payment_instrument NOT IN ('card_terminal', 'shopee') THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 付款標記 [%] 不是 card_terminal 或 shopee', p_payment_instrument;
  END IF;
  IF p_payment_instrument IS NOT NULL AND p_rail <> 'cash' THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 刷卡和蝦皮進帳只能登記在當面收款(cash)';
  END IF;
  IF p_payment_instrument = 'shopee' THEN
    -- 金額 = 這次收齊的訂單金額;蝦皮扣掉的部分記成手續費(Sean Q2 甲:全部記成一筆「蝦皮扣款」)。
    IF p_shopee_payout IS NULL OR p_shopee_payout <= 0 OR p_shopee_payout > p_amount THEN
      RAISE EXCEPTION 'admin_record_manual_payment: 蝦皮進帳金額必須大於 0、且不大於訂單金額(進帳 %,訂單金額 %)',
                      p_shopee_payout, p_amount;
    END IF;
    v_fee := p_amount - p_shopee_payout;
  ELSIF p_shopee_payout IS NOT NULL THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 只有蝦皮進帳才能填蝦皮進帳金額';
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
         o.cancelled_reason, o.payment_channel, o.customer_user_id,  -- 稽核 P0-2:分流樹要用(codex plan R2 S7)
         o.order_source                                              -- 報價單Q1:蝦皮來源只收蝦皮進帳
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;   -- 不洩「這張單存不存在」
  END IF;
  -- 報價單Q1:蝦皮來源的單只能登記蝦皮進帳;蝦皮進帳也只能登記在蝦皮來源的單(錢從蝦皮來, 不會是別的方式)。
  IF (v_order.order_source = 'manual_shopee') IS DISTINCT FROM (p_payment_instrument IS NOT DISTINCT FROM 'shopee') THEN
    RAISE EXCEPTION 'admin_record_manual_payment: 蝦皮訂單只能登記蝦皮進帳;蝦皮進帳也只能登記在蝦皮訂單';
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
  SELECT op.id, op.rail, op.amount, op.received_at, op.bank_reference, op.payer_note, op.actor,
         op.payment_instrument, op.fee_amount
    INTO v_existing
    FROM public.order_payments op
   WHERE op.order_id = p_order_id AND op.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.rail           IS NOT DISTINCT FROM p_rail
       AND v_existing.amount         IS NOT DISTINCT FROM p_amount
       AND v_existing.received_at    IS NOT DISTINCT FROM p_received_at
       AND v_existing.bank_reference IS NOT DISTINCT FROM v_bank_ref
       AND v_existing.payer_note     IS NOT DISTINCT FROM v_payer_note
       AND v_existing.actor          IS NOT DISTINCT FROM p_actor
       AND v_existing.payment_instrument IS NOT DISTINCT FROM p_payment_instrument
       AND (p_payment_instrument IS DISTINCT FROM 'shopee' OR v_existing.fee_amount IS NOT DISTINCT FROM v_fee) THEN
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
  -- 報價單Q1:付款標記一起寫;手續費只有蝦皮由這裡帶(其他方式由 order_payments_fee_snapshot_bi 觸發器算)。
  INSERT INTO public.order_payments
    (order_id, rail, amount, received_at, bank_reference, request_id, payer_note, actor,
     payment_instrument, fee_amount)
  VALUES
    (p_order_id, p_rail, p_amount, p_received_at, v_bank_ref, p_request_id, v_payer_note, p_actor,
     p_payment_instrument, v_fee)
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
     -- 報價單Q1:有付款標記才多記(一般收款與上一代逐欄相同)。
     || CASE WHEN p_payment_instrument IS NULL THEN '{}'::jsonb
             ELSE pg_catalog.jsonb_build_object('payment_instrument', p_payment_instrument, 'shopee_payout', p_shopee_payout)
        END
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
REVOKE ALL ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text, text, integer) TO service_role;

DROP FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean);
CREATE FUNCTION public.admin_record_manual_refund(p_order_id uuid, p_request_id uuid, p_actor text, p_rail text, p_refund_amount integer, p_reason text, p_occurred_at timestamp with time zone, p_confirm_card_not_refunded boolean DEFAULT false, p_payment_instrument text DEFAULT NULL::text)
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
  -- 報價單Q1 2026-10-01:店內刷卡的退款在刷卡機操作, 這裡只登記並標記「刷卡」(走 cash 那條路)。
  IF p_payment_instrument IS NOT NULL AND (p_payment_instrument <> 'card_terminal' OR p_rail <> 'cash') THEN
    RAISE EXCEPTION 'admin_record_manual_refund: 退款標記只能是刷卡(card_terminal), 而且要登記在當面收款(cash)';
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
  SELECT r.id, r.rail, r.refund_amount, r.reason, r.actor, r.occurred_at, r.payment_instrument
    INTO v_existing
    FROM public.order_manual_refunds r
   WHERE r.order_id = p_order_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.rail          IS NOT DISTINCT FROM p_rail
       AND v_existing.refund_amount IS NOT DISTINCT FROM p_refund_amount
       AND v_existing.reason     IS NOT DISTINCT FROM pg_catalog.btrim(p_reason, E' \t\r\n')
       AND v_existing.actor      IS NOT DISTINCT FROM pg_catalog.btrim(p_actor,  E' \t\r\n')
       AND v_existing.occurred_at IS NOT DISTINCT FROM p_occurred_at
       AND v_existing.payment_instrument IS NOT DISTINCT FROM p_payment_instrument THEN
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
      (order_id, request_id, rail, refund_amount, reason, actor, occurred_at, payment_instrument)
    VALUES
      (p_order_id, p_request_id, p_rail, p_refund_amount,
       pg_catalog.btrim(p_reason, E' \t\r\n'), pg_catalog.btrim(p_actor, E' \t\r\n'), p_occurred_at,
       p_payment_instrument)
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
                                   'amount', p_refund_amount, 'occurred_at', p_occurred_at)
     || CASE WHEN p_payment_instrument IS NULL THEN '{}'::jsonb
             ELSE pg_catalog.jsonb_build_object('payment_instrument', p_payment_instrument) END,
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
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean, text) TO service_role;

DO $cmt$
DECLARE v text;
BEGIN
  SELECT cmt INTO v FROM _q1_fn_comment WHERE fn = 'admin_record_manual_payment';
  EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamp with time zone, text, text, text, integer) IS %L',
    pg_catalog.concat_ws(E'\n\n', v,
      '報價單Q1 2026-10-01:第 9 參 p_payment_instrument(card_terminal = 店內刷卡、shopee = 蝦皮進帳, 都只能配 cash)、第 10 參 p_shopee_payout(蝦皮進帳金額;手續費 = 金額 − 進帳)。蝦皮訂單只收蝦皮進帳。'));
  SELECT cmt INTO v FROM _q1_fn_comment WHERE fn = 'admin_record_manual_refund';
  EXECUTE pg_catalog.format('COMMENT ON FUNCTION public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamp with time zone, boolean, text) IS %L',
    pg_catalog.concat_ws(E'\n\n', v,
      '報價單Q1 2026-10-01:第 9 參 p_payment_instrument(只能是 card_terminal, 配 cash):店內刷卡的退款在刷卡機操作, 這裡只登記並標記。'));
END
$cmt$;

-- 手動退款的不可變更欄位清單加上付款標記(本體 = 正式庫原文 + 1 行)。
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
    CASE WHEN NEW.cap_state     IS DISTINCT FROM OLD.cap_state     THEN 'cap_state' END,
    -- 報價單Q1 2026-10-01:付款標記(刷卡)寫入後不可改。
    CASE WHEN NEW.payment_instrument IS DISTINCT FROM OLD.payment_instrument THEN 'payment_instrument' END);

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

-- ═══ ⑥ 今日實收:扣掉手續費(Sean Q3 甲:蝦皮頁面上的進帳才是實際收入)═══
-- 本體 = 正式庫 2026-10-01 唯讀原文, 只把 SUM(p.amount) 改成 SUM(p.amount − 手續費);回傳型別不變 ⇒ CREATE OR REPLACE 保留 ACL。
--   手續費是 NULL(應收而沒有費率)的列先當 0 加總, 營業額卡片另外標示筆數。
CREATE OR REPLACE FUNCTION public.admin_today_payment_total(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(total bigint, row_count bigint)
 LANGUAGE sql
 STABLE STRICT SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(SUM(p.amount - COALESCE(p.fee_amount, 0)), 0)::bigint AS total,
         count(*)::bigint                   AS row_count
    FROM public.order_payments p
   WHERE p.received_at >= p_from
     AND p.received_at <  p_to
$function$;

-- ═══ ⑧ 營業額(Sean Q33 乙 + Q41 甲:按收款日;收到的錢 − 手續費 − 退款, 運費和稅都算在內)═══
-- 區間 [p_from, p_to)。退款依「錢真的退出去」的時點:
--   · TapPay 退款(order_refunds):status = 'confirmed' 且沒有作廢;時點 = 回填的發生時點, 沒有就用確認時點。
--   · TapPay 退款失敗、但人工更正成「錢已經退出去」(failed_reason = 'manual_failed' 且最新一筆更正 corrected_to = 'money_moved'):
--     照 pcm_order_refundable_remaining 的同一個判準算進來(Fable R1 #2);時點 = 那筆更正的時間(該列 confirmed_at 必為 NULL)。
--   · 手動退款(order_manual_refunds):沒有作廢;時點 = occurred_at。
--   · 待退款(order_pending_refunds)是「還沒退」, 不算。
-- 手續費不退(Q36 甲):退款只扣退款金額, 原收款那筆的手續費照扣。
-- 應收手續費而沒有費率的收款(fee_amount IS NULL)先當 0, 筆數另外回傳讓畫面標示。
CREATE FUNCTION public.admin_revenue_between(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(received bigint, fees bigint, refunds bigint, revenue bigint, missing_fee_count bigint)
LANGUAGE sql
STABLE STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH pay AS (
    SELECT COALESCE(SUM(p.amount), 0)::bigint                    AS received,
           COALESCE(SUM(COALESCE(p.fee_amount, 0)), 0)::bigint   AS fees,
           -- 只數原列:沒有費率的收款被沖銷時, 沖銷列也是 NULL, 不要數兩次(Fable R1 nit)
           pg_catalog.count(*) FILTER (WHERE p.fee_amount IS NULL AND p.reverses_payment_id IS NULL)::bigint AS missing_fee_count
      FROM public.order_payments p
     WHERE p.received_at >= p_from AND p.received_at < p_to
  ), ref AS (
    SELECT COALESCE((SELECT SUM(r.refund_amount)
                       FROM public.order_refunds r
                      WHERE r.status = 'confirmed' AND r.voided_at IS NULL
                        AND COALESCE(r.backfill_occurred_at, r.confirmed_at) >= p_from
                        AND COALESCE(r.backfill_occurred_at, r.confirmed_at) <  p_to), 0)
         + COALESCE((SELECT SUM(r.refund_amount)
                       FROM public.order_refunds r
                       JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
                      WHERE r.status = 'failed'
                        AND r.failed_reason = 'manual_failed'
                        AND v.corrected_to = 'money_moved'
                        AND v.created_at >= p_from AND v.created_at < p_to), 0)
         + COALESCE((SELECT SUM(m.refund_amount)
                       FROM public.order_manual_refunds m
                      WHERE m.voided_at IS NULL
                        AND m.occurred_at >= p_from AND m.occurred_at < p_to), 0) AS refunds
  )
  SELECT pay.received, pay.fees, ref.refunds::bigint,
         (pay.received - pay.fees - ref.refunds)::bigint AS revenue,
         pay.missing_fee_count
    FROM pay, ref
$$;
REVOKE ALL ON FUNCTION public.admin_revenue_between(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revenue_between(timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revenue_between(timestamptz, timestamptz) TO service_role;
COMMENT ON FUNCTION public.admin_revenue_between(timestamptz, timestamptz) IS
  '營業額(報價單Q1 2026-10-01;Sean Q33 乙、Q41 甲):區間內收到的錢 − 手續費 − 已退出去的錢(TapPay 已確認未作廢 + TapPay 失敗但人工更正為錢已退 + 手動退款未作廢)。運費與稅都算在內;手續費不退。missing_fee_count = 應收手續費而沒有費率的收款筆數。';

-- ═══ ⑨ 蝦皮單不參加「未收款自動取消」(Sean Q42 甲;Fable R1 #3)═══
-- 本體 = 正式庫 2026-10-01 唯讀 pg_get_functiondef 原文(prosrc md5 7e1e6764def6738440a1012cbea44f05), 只多一個條件。
-- 回傳型別與參數不變 ⇒ CREATE OR REPLACE 保留 ACL。
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
       -- 報價單Q1 2026-10-01(Sean Q42 甲「新增『蝦皮』。不會因為逾期被自動取消」):蝦皮撥款常晚於 5 天,
       --   而取消之後現金單補登會被拒(P2B54)⇒ 蝦皮進帳會永遠登不進去。蝦皮單一律不參加這支掃描。
       AND o.order_source IS DISTINCT FROM 'manual_shopee'
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

-- ═══ 收權斷言:新建的 6 個可授權物件(1 張表 + 5 支函式)═══
DO $acl$
DECLARE
  v_relations text[] := ARRAY['public.payment_fee_rates']::text[];
  v_functions text[] := ARRAY[
    'public.pcm_payment_fee_rate(text,timestamptz)',
    'public.pcm_order_payment_fee_snapshot()',
    'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text,text,integer)',
    'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz,boolean,text)',
    'public.admin_revenue_between(timestamptz,timestamptz)'
  ]::text[];
  v text;
BEGIN
  FOREACH v IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', v, 'SELECT') OR pg_catalog.has_table_privilege('authenticated', v, 'SELECT') THEN
      RAISE EXCEPTION '收權斷言:% 對 anon / authenticated 仍可 SELECT', v;
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', v, 'SELECT') THEN
      RAISE EXCEPTION '收權斷言:service_role 讀不到 %', v;
    END IF;
  END LOOP;
  FOREACH v IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 對 anon / authenticated 仍可 EXECUTE', v;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v::regprocedure AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '收權斷言:% 不是 SECURITY DEFINER 或 search_path 不是空字串', v;
    END IF;
  END LOOP;
  -- 後台會叫的三支要給 service_role(觸發器與費率小工具不必)
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text,text,integer)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz,boolean,text)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.admin_revenue_between(timestamptz,timestamptz)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '收權斷言:service_role 叫不到後台要用的 RPC';
  END IF;
END
$acl$;

-- ═══ 後置檢查:回填之後沒有「應收手續費卻是 NULL」的舊列 ═══
DO $chk$
DECLARE n integer;
BEGIN
  SELECT pg_catalog.count(*) INTO n
    FROM public.order_payments
   WHERE fee_amount IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION '回填後仍有 % 列 fee_amount 是 NULL', n;
  END IF;
END
$chk$;

COMMIT;
