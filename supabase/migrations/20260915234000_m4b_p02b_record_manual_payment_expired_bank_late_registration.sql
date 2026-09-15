-- 20260915234000_m4b_p02b_record_manual_payment_expired_bank_late_registration.sql
-- 稽核 P0-2 逾期匯款單補登記 · DB 第 2 片:admin_record_manual_payment 新一代
--
-- 🛑 未貼(貼板 Sean 一張一點名)。plan:docs/plans/2026-09-15-expired-bank-order-late-registration-plan.md(R3,Sean 2026-09-15 11:3x 批甲)
--    §2 第 1 項、§3、§5、§6、§7。前一片 20260915233000(helper + 手動建單客人鎖)必須先貼。
--
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- 本體 = 20260812150000:74-342 那一代,以產生器逐段替換(每個錨點 assert 恰好出現一次,其餘逐字不變):
--   ① DECLARE 加變數  ② G5 多讀 cancelled_reason / payment_channel / customer_user_id
--   ③ G8 冪等搬到 G5 之後、G6 之前;重放回當初處置(綁 payment_id);同鍵不同內容 ⇒ P2B53
--   ④ G6 整單取消改成分流樹:逾期自動取消 + 匯款 + 乾淨 ⇒ 期限內復活 / 期限後或有新單 ⇒ 入帳開待退款;其餘具名拒
--   ⑤ 復活 UPDATE 在 G9 INSERT 之前  ⑥ G10 之後事後判定(復活:verdict × 狀態;待退款:完整列集合)
--   ⑦ 收款稽核列多記處置  ⑧ 復活稽核列 order.revive_expired  ⑨ 回傳多三鍵  ⑩ unique_violation 只在冪等索引才回 P2B53
-- 🔴 取代 20260809160000:6 的「Q2=A 不復活」,只限這條路、只限乾淨匯款單(Sean 範圍縮小:現金逾期單一律人工)。
-- 簽章不變 ⇒ CREATE OR REPLACE;ACL / proconfig / SECURITY DEFINER / owner 改前改後逐項比;COMMENT 保留舊文 + 補一段。
--
-- ══ 前提 ═══════════════════════════════════════════════════════════════
-- 前置閘:本體 md5 = 86e3948c900377ebdf256ab700e41979(20260812150000,正式庫 2026-09-15 dump 同值)⇒ 升;= be85108ca0b8296531f25246083491c8(本代)⇒ 冪等重跑;其他 ⇒ 停。
--         proconfig 恰好 {search_path=""};COMMENT md5 = b5cb93c79247931343b6139a603a0fc3 或本代 e090bdb4ef9351cbf4c6fc31a9564539;
--         pcm_bank_transfer_due_at md5 = 9c4775d65626d189fe3881ae6fe16b8b(20260915233000 已貼);依賴鏈五支 md5 釘住;
--         order_payments 上 pcm_noncard_settle_after_payment_ai 在;order_payments_request_id_uniq 是 (order_id, request_id)。
-- 回滾:supabase/rollbacks/20260915234000_down.sql。
-- 驗證:bash scripts/20260915234000-verify.sh(拋棄式 PG = 正式庫 schema dump,Sean Q41 甲)。

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _p02b_attr_before ON COMMIT DROP AS
SELECT p.proacl::text AS acl, p.proconfig::text AS cfg, p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner
  FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)');

DO $pre$
DECLARE v_src text; v_cfg text[]; v_cmt text; v_hel text;
BEGIN
  SELECT p.prosrc, p.proconfig INTO v_src, v_cfg FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 8 參 admin_record_manual_payment';
  END IF;
  IF v_cfg IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '前置閘①:proconfig = % 不是恰好 {search_path=""} ⇒ CREATE OR REPLACE 會洗掉多出來的設定, 停', v_cfg;
  END IF;
  IF pg_catalog.md5(v_src) = '86e3948c900377ebdf256ab700e41979' THEN
    RAISE NOTICE '前置閘①:20260812150000 那一代在 ⇒ 升本代';
  ELSIF pg_catalog.md5(v_src) = 'be85108ca0b8296531f25246083491c8' THEN
    RAISE NOTICE '前置閘①:已是本代 ⇒ 冪等重跑';
  ELSE
    RAISE EXCEPTION '前置閘①:admin_record_manual_payment md5 = % 不是 20260812150000 那一代也不是本代 ⇒ 有人又換了一代, 停下合併(版本晚的必須是聯集)', pg_catalog.md5(v_src);
  END IF;
  v_cmt := pg_catalog.md5(COALESCE(pg_catalog.obj_description(pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)'), 'pg_proc'), '(無)'));
  IF v_cmt NOT IN ('b5cb93c79247931343b6139a603a0fc3', 'e090bdb4ef9351cbf4c6fc31a9564539') THEN
    RAISE EXCEPTION '前置閘①:COMMENT md5 = % 不是舊文也不是本代 ⇒ 有人改過 COMMENT, 本片會覆寫它, 停', v_cmt;
  END IF;

  SELECT pg_catalog.md5(p.prosrc) INTO v_hel FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_bank_transfer_due_at(timestamptz)');
  IF v_hel IS DISTINCT FROM '9c4775d65626d189fe3881ae6fe16b8b' THEN
    RAISE EXCEPTION '前置閘②:pcm_bank_transfer_due_at 不在或不是 20260915233000 那一版(md5 = %)⇒ 先貼 20260915233000', COALESCE(v_hel, '(不在)');
  END IF;

  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_noncard_settle_recompute(uuid)')) IS DISTINCT FROM 'bc8d977dd098677dbba8a445a7ff6a56' THEN
    RAISE EXCEPTION '前置閘③:public.pcm_noncard_settle_recompute(uuid) 的本體不是本片寫的時候那一版(md5 應為 bc8d977dd098677dbba8a445a7ff6a56)⇒ 補登記依賴的鏈換代了, 停下重對';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_noncard_settle_after_payment()')) IS DISTINCT FROM '46598b3a24ebfe8d26e483ef4c84e1c7' THEN
    RAISE EXCEPTION '前置閘③:public.pcm_noncard_settle_after_payment() 的本體不是本片寫的時候那一版(md5 應為 46598b3a24ebfe8d26e483ef4c84e1c7)⇒ 補登記依賴的鏈換代了, 停下重對';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_pending_refund_open_for(uuid, boolean)')) IS DISTINCT FROM '0ca2c260e4f6077147dc3b9deb6fa4c7' THEN
    RAISE EXCEPTION '前置閘③:public.pcm_pending_refund_open_for(uuid, boolean) 的本體不是本片寫的時候那一版(md5 應為 0ca2c260e4f6077147dc3b9deb6fa4c7)⇒ 補登記依賴的鏈換代了, 停下重對';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_pending_refund_amounts(uuid)')) IS DISTINCT FROM '6b55a614b0e7b5b9a9b9bcb4c159eaa6' THEN
    RAISE EXCEPTION '前置閘③:public.pcm_pending_refund_amounts(uuid) 的本體不是本片寫的時候那一版(md5 應為 6b55a614b0e7b5b9a9b9bcb4c159eaa6)⇒ 補登記依賴的鏈換代了, 停下重對';
  END IF;
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_compute_order_settlement(uuid)')) IS DISTINCT FROM 'f134e95d24e768a84fd53d26f29aed70' THEN
    RAISE EXCEPTION '前置閘③:public.admin_compute_order_settlement(uuid) 的本體不是本片寫的時候那一版(md5 應為 f134e95d24e768a84fd53d26f29aed70)⇒ 補登記依賴的鏈換代了, 停下重對';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.order_payments'::regclass
                    AND t.tgname = 'pcm_noncard_settle_after_payment_ai' AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION '前置閘③:order_payments 上沒有啟用中的 pcm_noncard_settle_after_payment_ai ⇒ 入帳後不會重算狀態 / 開待退款, 停';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                  WHERE i.indexrelid = pg_catalog.to_regclass('public.order_payments_request_id_uniq')
                    AND i.indisunique
                    AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(order_id, request_id)%') THEN
    RAISE EXCEPTION '前置閘④:order_payments_request_id_uniq 不在或不是 (order_id, request_id) ⇒ P2B53 的判準對不上, 停';
  END IF;

  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260915234000(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
END
$pre$;

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
$fn$;

COMMENT ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text) IS
  'M-4b E10-OP5 人工軌收款登錄(SECURITY DEFINER、search_path='''')。一支 RPC 管 bank_transfer + cash 兩軌(master-plan §5.3 項 1);card 軌具名拒。🔴 actor = p_actor 參數 + staff FK + is_active 守門,**不是 session_user**(那是 OP3 機器軌的形狀)。🔴 actor 的誠實邊界:cookie 承載、非授權邊界(apps/admin/src/lib/session/actor.ts:6-7)⇒ 不得單獨作為責任歸屬證據。十道守門:G1 隔離閘 P8C01 → G2 actor(排在任何訂單讀取前,擋守門序 oracle)P2B39 → G3 輸入驗(p_order_id/p_request_id/p_rail/p_amount/p_received_at 各自一道 NULL 守門 + rail 二值 + amount 正 + 軌別欄位形狀;bank_reference/payer_note 先 btrim 正規化) → G4 未來時點 P2B38/pcm_op5_received_at_future(逐字 clock_timestamp;OP2a 的 A8 閘是 backstop)→ G5 orders FOR UPDATE(不存在=通用訊息) → G6 整單取消拒(通用;**部分取消單放行**,§5.1b 契約)+ 退款兩態具名拒 P2B41 + allowlist 之外 fail-closed → G7 下限:匯款比台北曆日、現金比精確時點 P2B38/pcm_op5_received_at_before_order → G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回 idempotent(NULL-safe;cash 兩欄為 NULL)→ G9 append 一列 → G10 row_count 守 P2B40。🔴 **不碰 orders.payment_status**(少收/溢收/結清判定=OP6)、不寫 reviewed_*(Q4=C 複核不強制)、零 UPDATE 零 DELETE(Q3=A 更正走沖銷)。🔴 received_at 逐軌(Sean 2026-08-10 拍板:「銀行入帳日」只適用匯款軌):bank_transfer=銀行入帳日(UI 傳 Asia/Taipei 當日 00:00)、cash=實際收現時點(UI 取 **server** 時間,不設容差)。🔴 **本片零 GRANT(分期開權)**:EXECUTE 由 OP-A12 與沖銷 RPC 一起開 ⇒ 物理上不存在「能登錄、不能更正」的窗口。這道 ACL 極性有到期日 = OP-A12。🔴 開權前置:OP-A12 沖銷入口 / OP-A13 退款態沖銷與重登 / OP-A14 已收款單的取消守門 / OP-A15 待認領款項暫存帳;錯誤碼分類(P2B38 一碼兩義、P2B39/40/41、42501)= backlog #371。零經銷價 / 零 cost。⛔ ~~上面「**不碰 orders.payment_status**」那句~~ —— **函式本體仍然一個字都不碰它, 那半仍為真**;🔴 而 **2026-09-04 起【呼叫它的效果】變了**(`20260904230000`):它寫進 `order_payments` 的那一列會觸發 AFTER INSERT trigger `pcm_noncard_settle_after_payment_ai`, 由 `pcm_noncard_settle_recompute` 改 payment_status。⇒ 📌 **「本支不碰」與「呼叫本支不會改到」是兩句話, 而讀的人要的是後者。**舊字面留著讓搜它的人撞到這裡。'
  '🔴 稽核 P0-2(20260915234000,Sean 2026-09-15 拍乙):逾期自動取消(payment_expired)的【乾淨匯款單】可補登記 —— received_at 早於 pcm_bank_transfer_due_at 且客人期限後沒有另下新單 ⇒ 清掉取消欄、入帳、狀態由重算判定(不明則整筆回滾 P2B51);否則單維持取消、入帳並由既有鏈開待退款(驗恰 1 列)。不乾淨 P2B51 · 非逾期取消 P2B52 · 現金 P2B54 · 同鍵不同內容 P2B53。G8 冪等搬到 G6 之前,重放回當初處置。B 分支拿客人層級 advisory lock(與 create_order / admin_create_manual_order 同 key)。';

DO $post$
DECLARE v_oid oid := pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)'); v_src text; v_cmt text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _p02b_attr_before) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p, _p02b_attr_before b
     WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)')
       AND (p.proacl::text IS DISTINCT FROM b.acl OR p.proconfig::text IS DISTINCT FROM b.cfg
            OR p.prosecdef IS DISTINCT FROM b.secdef OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM b.owner)
  ) THEN
    RAISE EXCEPTION '事後閘①:admin_record_manual_payment 的 ACL / proconfig / SECURITY DEFINER / owner 改前改後不同';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF pg_catalog.md5(v_src) <> 'be85108ca0b8296531f25246083491c8' THEN
    RAISE EXCEPTION '事後閘②:md5 = % 不是本代 be85108ca0b8296531f25246083491c8', pg_catalog.md5(v_src);
  END IF;
  IF pg_catalog.strpos(v_src, 'public.pcm_bank_transfer_due_at(v_order.created_at)') = 0
     OR pg_catalog.strpos(v_src, 'pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0))') = 0
     OR pg_catalog.strpos(v_src, '''order.revive_expired''') = 0
     OR pg_catalog.strpos(v_src, 'P2B53') = 0 THEN
    RAISE EXCEPTION '事後閘②:函式體缺 helper / 客人鎖 / 復活稽核 / P2B53 其中之一';
  END IF;
  v_cmt := pg_catalog.md5(COALESCE(pg_catalog.obj_description(v_oid, 'pg_proc'), '(無)'));
  IF v_cmt <> 'e090bdb4ef9351cbf4c6fc31a9564539' THEN
    RAISE EXCEPTION '事後閘③:COMMENT md5 = % 不是本代', v_cmt;
  END IF;
  RAISE NOTICE '20260915234000 貼好了:admin_record_manual_payment 可補登記逾期自動取消的乾淨匯款單。';
END
$post$;

COMMIT;
