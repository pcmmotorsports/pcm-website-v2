-- 20260915234000 回滾:admin_record_manual_payment 貼回 20260812150000 那一代逐字(已取消單一律拒);COMMENT 還原舊文。零資料改動。
-- ⚠️ 資料不回去:已復活的單維持復活、已開的待退款維持開著(真的收到的錢)。列出受影響紀錄:
--    SELECT action, target, after->>'expiry_disposition', created_at FROM public.admin_audit_log
--     WHERE action = 'order.revive_expired' OR (action = 'payment.record' AND after ? 'expiry_disposition');
-- ⚠️ 回滾後,期限後那條原封重送會被舊一代在 G6「已取消」拒(舊 G8 在 G6 之後)—— 那【不代表沒入帳】,查上面那段。
-- 要連 20260915233000 一起回滾 ⇒ 先跑本檔,再跑 20260915233000_down.sql。
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _p02b_down_attr_before ON COMMIT DROP AS
SELECT p.proacl::text AS acl, p.proconfig::text AS cfg, p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner
  FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)');

DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)');
  IF v_src IS NULL OR pg_catalog.md5(v_src) <> 'be85108ca0b8296531f25246083491c8' THEN
    RAISE EXCEPTION '回滾前置閘:md5 = % 不是 20260915234000 那一代 be85108ca0b8296531f25246083491c8 ⇒ 不回滾, 停', COALESCE(pg_catalog.md5(v_src), '(函式不在)');
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

COMMENT ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text) IS
  'M-4b E10-OP5 人工軌收款登錄(SECURITY DEFINER、search_path='''')。一支 RPC 管 bank_transfer + cash 兩軌(master-plan §5.3 項 1);card 軌具名拒。🔴 actor = p_actor 參數 + staff FK + is_active 守門,**不是 session_user**(那是 OP3 機器軌的形狀)。🔴 actor 的誠實邊界:cookie 承載、非授權邊界(apps/admin/src/lib/session/actor.ts:6-7)⇒ 不得單獨作為責任歸屬證據。十道守門:G1 隔離閘 P8C01 → G2 actor(排在任何訂單讀取前,擋守門序 oracle)P2B39 → G3 輸入驗(p_order_id/p_request_id/p_rail/p_amount/p_received_at 各自一道 NULL 守門 + rail 二值 + amount 正 + 軌別欄位形狀;bank_reference/payer_note 先 btrim 正規化) → G4 未來時點 P2B38/pcm_op5_received_at_future(逐字 clock_timestamp;OP2a 的 A8 閘是 backstop)→ G5 orders FOR UPDATE(不存在=通用訊息) → G6 整單取消拒(通用;**部分取消單放行**,§5.1b 契約)+ 退款兩態具名拒 P2B41 + allowlist 之外 fail-closed → G7 下限:匯款比台北曆日、現金比精確時點 P2B38/pcm_op5_received_at_before_order → G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回 idempotent(NULL-safe;cash 兩欄為 NULL)→ G9 append 一列 → G10 row_count 守 P2B40。🔴 **不碰 orders.payment_status**(少收/溢收/結清判定=OP6)、不寫 reviewed_*(Q4=C 複核不強制)、零 UPDATE 零 DELETE(Q3=A 更正走沖銷)。🔴 received_at 逐軌(Sean 2026-08-10 拍板:「銀行入帳日」只適用匯款軌):bank_transfer=銀行入帳日(UI 傳 Asia/Taipei 當日 00:00)、cash=實際收現時點(UI 取 **server** 時間,不設容差)。🔴 **本片零 GRANT(分期開權)**:EXECUTE 由 OP-A12 與沖銷 RPC 一起開 ⇒ 物理上不存在「能登錄、不能更正」的窗口。這道 ACL 極性有到期日 = OP-A12。🔴 開權前置:OP-A12 沖銷入口 / OP-A13 退款態沖銷與重登 / OP-A14 已收款單的取消守門 / OP-A15 待認領款項暫存帳;錯誤碼分類(P2B38 一碼兩義、P2B39/40/41、42501)= backlog #371。零經銷價 / 零 cost。⛔ ~~上面「**不碰 orders.payment_status**」那句~~ —— **函式本體仍然一個字都不碰它, 那半仍為真**;🔴 而 **2026-09-04 起【呼叫它的效果】變了**(`20260904230000`):它寫進 `order_payments` 的那一列會觸發 AFTER INSERT trigger `pcm_noncard_settle_after_payment_ai`, 由 `pcm_noncard_settle_recompute` 改 payment_status。⇒ 📌 **「本支不碰」與「呼叫本支不會改到」是兩句話, 而讀的人要的是後者。**舊字面留著讓搜它的人撞到這裡。';

DO $post$
DECLARE v_oid oid := pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)');
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> '86e3948c900377ebdf256ab700e41979' THEN
    RAISE EXCEPTION '回滾事後閘①:本體不是 20260812150000 那一代';
  END IF;
  IF pg_catalog.md5(COALESCE(pg_catalog.obj_description(v_oid, 'pg_proc'), '(無)')) <> 'b5cb93c79247931343b6139a603a0fc3' THEN
    RAISE EXCEPTION '回滾事後閘①:COMMENT 沒還原成舊文';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _p02b_down_attr_before) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p, _p02b_down_attr_before b
     WHERE p.oid = pg_catalog.to_regprocedure('public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)')
       AND (p.proacl::text IS DISTINCT FROM b.acl OR p.proconfig::text IS DISTINCT FROM b.cfg
            OR p.prosecdef IS DISTINCT FROM b.secdef OR pg_catalog.pg_get_userbyid(p.proowner) IS DISTINCT FROM b.owner)
  ) THEN
    RAISE EXCEPTION '回滾事後閘②:admin_record_manual_payment 的 ACL / proconfig / SECURITY DEFINER / owner 改前改後不同';
  END IF;
END
$post$;
COMMIT;
