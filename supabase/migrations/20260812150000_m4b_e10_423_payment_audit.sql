-- ============================================================
-- M-4b E10 #423:手動收款登錄(OP5)+ 沖銷(OP-A12)補**同交易稽核**
-- ============================================================
-- 規格權威 = 信箱 `D-568-PLAN`(v3;關卡1 Fable 九條全折、主視窗 `D-574-A` 窄確認 PASS)。
-- 裁定:Q-D13=B(錢的兩支一片)/ Q-D15(判準見下)/ Q-D16=B(重放要留痕)/ F1(沖銷用新列 id)。
--
-- ── 為什麼要做 ─────────────────────────────────────────────────────────────
-- 今天唯一追得到「誰」的欄位是 `order_payments.actor`,而它來自 picker cookie,
-- `apps/admin/src/lib/session/actor.ts:6-7` **逐字自陳「這不是登入 / 授權邊界」**
-- ⇒ 它記的是「畫面上被選的人」。對帳對不起來那天,
-- 「這筆 3 萬是誰登的、什麼時候、哪個請求」今天答不出來。
--
-- ── 🔴 判準:什麼時候「帳本列即稽核」才成立(主視窗 `D-569-A:1` 裁,未來第三條線照它裁)──
-- 「帳本列即稽核」**只在列上帶外部不可否認材料時成立**
-- (TapPay 回應、外部退款編號這類**非我方單方面產生**的證據)。
-- 沒有外部佐證 = 純內部宣稱 ⇒ **必須補 `admin_audit_log`**。
--   · 退款帳本(P 線 `20260812140000:122` 逐字「本線不寫 admin_audit_log」)= 前者 ⇒ 不必補、本片不動它。
--   · 人工軌收款/沖銷(本片)= 後者(一筆手動收款完全是內部宣稱)⇒ 要補。
-- ⇒ 兩線不是立場歧異,是同一條規則的兩種情況。
--
-- ── 🔴 稽核筆數守用 `v_audit_n`、**刻意不共用 `v_n`** ───────────────────────
-- 既有 harness 的順序錨取**首次命中**:
--   `scripts/op5-verify.sh:719-721` 與 `scripts/opa12-verify.sh:498-499` 都是
--   `strpos(v_body,'GET DIAGNOSTICS v_n = ROW_COUNT;') < strpos(v_body,'INSERT INTO public.order_payments')`
-- OP5 的**重放**稽核落在 `order_payments` INSERT **之前**(冪等分支提早 return)
-- ⇒ 共用 `v_n` 會讓首次命中位置變小 ⇒ **那道錨對一份健康的新碼發火**。
-- ⇒ 改用自己的變數名,兩支既有 harness **一個字都不必動**。
-- ⚠️ 偏離申報:plan §5 F2 原本寫「同 commit 修錨」,實作改成「不動錨、換變數名」——
--    理由是**動既有錢路徑的守門風險比較大**,能不動就不動;錨的語意與判別力完全不變
--    (它守的是「`order_payments` 的 row_count 守必須在 INSERT 之後」,那件事仍然被守著)。
--
-- ── 🔴 稽核筆數守擋得住什麼、擋不住什麼(關卡2 R2 codex P1-①② 抓到,已實測)────
-- 三道 `GET DIAGNOSTICS v_audit_n = ROW_COUNT` 守擋的是**寫不進去**:
--   BEFORE INSERT trigger 回 NULL 靜默吞列 ⇒ ROW_COUNT=0 ⇒ 發火、整筆回滾。(harness 靶②/P5 實證)
-- ⚠️ **擋不住「寫進去之後又被刪掉」**:AFTER INSERT trigger 刪掉剛寫的列時,ROW_COUNT 仍是 1
--    ⇒ 守門不發火、函式回 `recorded: true`,而稽核**零列**。
--    實測(拋棄式叢集 54401,交易內 ROLLBACK):掛 AFTER INSERT 刪列 trigger 後
--    `admin_record_manual_payment(...)` 回 `{"recorded": true, ...}`、`admin_audit_log` count=0、
--    `order_payments` count=1 ⇒ 錢在帳上、稽核不見。
-- 🔴 **這道缺口的正確防線不在本函式,在表**:`order_payments` 早就用 trigger 把這條路封死
--    (`order_payments_no_delete_bd` / `order_payments_immutable_bu`,實查 4 支 trigger),
--    而 `admin_audit_log` 的 append-only **只靠 GRANT**(service_role 無 UPDATE/DELETE)——
--    SECURITY DEFINER 是用**表 owner** 的身分寫的,owner 刪得掉。實查該表 trigger 數 = **0**。
--    ⇒ 在函式裡補「寫完再 SELECT 確認還在」只擋得住非 deferred 那一半
--      (`CONSTRAINT TRIGGER ... INITIALLY DEFERRED` 在 COMMIT 才跑,任何函式內檢查都看不到)
--      ⇒ **不在本片補半套**,立案 **backlog #439** 走表層 append-only trigger(同時覆蓋 A6/A9d2/A7 既有寫入者)。
-- ⚠️ 另一條同族(codex P1-③,實測**今日不可構造**):重放路徑的稽核 INSERT 若拋 unique_violation,
--    會被函式尾的 `WHEN unique_violation` handler 收成通用訊息「收款登錄失敗」——
--    而那時錢**早已在帳上**,員工可能換一把 request_id 重登 = 重複入帳。
--    今日不可達:`admin_audit_log` 的唯一索引只有 `admin_audit_log_pkey`(uuid 預設值),
--    其餘 4 支索引皆非 unique(實查)。⇒ 日後若有人替該表加 unique 索引,這條就活了,一併記進 **#439**。
--
-- ── 什麼**沒有**改 ─────────────────────────────────────────────────────────
-- · 兩支的**簽章**、參數名、回傳形狀:一字未動(`CREATE OR REPLACE` 保留 owner 與 ACL)。
-- · 兩支既有的十/十一道閘、鎖序、錯誤碼:一字未動。
-- · `order_payments` 的 schema、trigger、索引:完全沒碰。
-- · P 線的退款帳本:完全沒碰(見上面的判準)。
--
-- ── rollback ───────────────────────────────────────────────────────────────
-- `CREATE OR REPLACE` 回舊定義即可(OP5 的舊 body 在 `20260810200000:106-320`、
-- A12 在 `20260810210000:80-182`,兩份都是逐字可取的權威)。
-- 🔴 **資料面**:期間寫進 `admin_audit_log` 的列**留著、不刪** —— 它們記錄的是真的發生過的事。
-- ============================================================

BEGIN;

-- 🔴 整片一交易 + 三道 timeout(逐字沿用被改的那兩支:`20260810200000:102-104`、
--    `20260810210000:76-78`)。少了它,正式站套用時撞上鎖會無界等待
--    —— 而這支 `CREATE OR REPLACE` 要拿兩支錢路徑函式的鎖(關卡2)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

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

CREATE OR REPLACE FUNCTION public.admin_reverse_manual_payment(
  p_payment_id uuid,
  p_actor      text,
  p_reason     text
)
RETURNS jsonb                 -- {reversed, reversal_id};無 idempotent 欄(見檔頭)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_target      record;
  v_order_id    uuid;
  v_reason      text;
  v_existing    uuid;
  v_reversal_id uuid;
  v_n           integer;
  -- 🔴 同 OP5:稽核筆數守用自己的變數,不動既有順序錨的字面(#423)。
  v_audit_n    integer;
  v_generic_msg constant text := 'admin_reverse_manual_payment: 沖銷失敗';
BEGIN
  -- G1 隔離閘(OP5/A8c2 同款)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- G2 actor —— 排在任何資料讀取之前(OP5 同款:身分錯的呼叫拿不到任何帳本資訊)
  IF p_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 經手人 [%] 不存在或已停用 ⇒ 拒絕沖銷',
                    coalesce(p_actor, '(NULL)')
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_opa12_actor_invalid';
  END IF;

  -- G3 輸入驗。🔴 reason 一開始就正規化成單一變數,守門與寫入只用它(關卡1 R1 #3)。
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 收款列識別碼缺失';
  END IF;
  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 沖銷理由必填(錢帳上「為什麼把這筆沖掉」是稽核第一個問題)';
  END IF;

  -- G4 不鎖讀,**只取 order_id**(拿它去鎖正確的 orders 列);其餘欄位一律不沿用
  SELECT op.order_id INTO v_order_id FROM public.order_payments op WHERE op.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;   -- 不洩「這一列存不存在」
  END IF;

  -- G5 鎖序 orders → order_payments(與 OP5 同向)
  PERFORM 1 FROM public.orders o WHERE o.id = v_order_id FOR UPDATE;

  -- G6 鎖後**重讀** target(主視窗的錨):不鎖那次讀到的值可能已被另一支動過
  SELECT op.id, op.order_id, op.rail, op.amount, op.received_at
    INTO v_target
    FROM public.order_payments op
   WHERE op.id = p_payment_id
   FOR NO KEY UPDATE;                      -- 🔴 NKU 不是 FOR UPDATE,見檔頭的 a2b1 契約
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- G7 卡軌具名拒:卡片的錢走 refund adapter,不在本帳本沖
  IF v_target.rail = 'card' THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 卡軌收款不由本支沖銷(卡片退款走 TapPay refund,不是帳本沖銷)'
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_opa12_card_rail';
  END IF;

  -- 🔴 這裡**刻意沒有** OP5 的狀態 allowlist、也不擋已取消單(#372 逐字)。見檔頭的已知代價。

  -- G8 已被沖銷 ⇒ 具名拒(不回冪等;沒有 request identity 就不宣稱那個性質)
  SELECT op.id INTO v_existing
    FROM public.order_payments op
   WHERE op.reverses_payment_id = p_payment_id;
  IF FOUND THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 該列已被沖銷(沖銷列 id=%)⇒ 一列最多沖一次;'
                    '要再更正請沖銷那一列(沖銷之沖銷)', v_existing
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_opa12_already_reversed';
  END IF;

  -- G9 寫沖銷列:三個識別欄與 reviewed_* 全 NULL(OP1 rail_fields 對沖銷列的要求);
  --    金額 = 反號(A9 會再驗一次);received_at 跟著被沖那筆走(沖的是「那一筆錢」的更正)。
  INSERT INTO public.order_payments
    (order_id, rail, amount, received_at, reverses_payment_id, reversal_reason, actor)
  VALUES
    (v_target.order_id, v_target.rail, -v_target.amount, v_target.received_at,
     v_target.id, v_reason, p_actor)
  RETURNING id INTO v_reversal_id;

  -- G10 row_count 守(位置必須在 INSERT 之後:排前面讀到的是上一句的 ROW_COUNT、恆真)
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 沖銷列落 % 列(期望恰 1)⇒ 可能有 BEFORE INSERT '
                    'trigger 回了 NULL(靜默吞列)。本交易整筆回滾', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_opa12_row_count';
  END IF;

  -- ══ #423 稽核 ═══════════════════════════════════════════════════════════
  -- 🔴 **`request_id` 用沖銷新列的 id**(關卡1 F1;主視窗 `D-572-A:1` 裁):
  --    本函式簽章**沒有** `p_request_id`(`(p_payment_id, p_actor, p_reason)` 三個參數),
  --    而 `admin_audit_log.request_id` 是 NOT NULL + CHECK 非空 ⇒ 必須有值。
  --    取沖銷列自己的 id:稽核列 ↔ 帳列一對一,關聯語意比一把 client 送的 uuid 強
  --    (對這條路那把 uuid 根本不存在)。
  --    ⚠️ 不加參數的理由不是省事:加了就是新簽章 = 新函式 = 預設帶 PUBLIC EXECUTE,
  --       得再補 REVOKE,多一道容易漏的權限面;既有 harness 字面也會整串連鎖。
  -- 🔴 位置在 G10 之後:先確定沖銷列真的落了,才記「誰沖的」。
  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (p_actor, 'payment.reverse', 'payment:' || v_reversal_id::text,
     v_reversal_id::text,
     pg_catalog.jsonb_build_object('payment_id', v_target.id, 'amount', v_target.amount,
                                   'rail', v_target.rail),
     -- 🔴 `order_id` 必放(R3 Fable C3):before/after/target 原本三個欄位都只有 payment 層的 id ——
     --    災難當天要回答「這張**單**上發生過什麼」得先 join `order_payments` 拿 order_id 再回頭查,
     --    而那正是稽核最該自足的時刻。OP5 正常路徑的 after 本來就有 order_id,這裡補上=兩支對稱。
     pg_catalog.jsonb_build_object('reversal_id', v_reversal_id, 'amount', -v_target.amount,
                                   'reverses_payment_id', v_target.id,
                                   'order_id', v_target.order_id),
     v_reason,  -- 沖銷本來就必填原因(G3 已正規化)
     'admin');
  GET DIAGNOSTICS v_audit_n = ROW_COUNT;
  IF v_audit_n <> 1 THEN
    RAISE EXCEPTION 'admin_reverse_manual_payment: 稽核落 % 列(期望恰 1)⇒ 這筆沖銷會變成沒有'
                    '「誰沖的」紀錄。成因通常是 admin_audit_log 上有 BEFORE INSERT trigger 回了 NULL。'
                    '本交易整筆回滾(沖銷列也不會留)', v_audit_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_opa12_audit_row_count';
  END IF;

  RETURN pg_catalog.jsonb_build_object('reversed', true, 'reversal_id', v_reversal_id);

EXCEPTION
  -- 旁路 writer 的 backstop:兩支本 RPC 之間由 G5 的 orders 鎖序列化、G8 會先擋,
  -- 走到這裡代表有人不經本 RPC 直接寫(或未來多一個 writer)。收成通用訊息,不洩約束名。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 註解同步(關卡1 F3:字面 vs 事實)
-- 🔴 舊 COMMENT 逐字列著十道/步驟表,**不含稽核步** ⇒ 本片 apply 後即成不完整字面。
--    COMMENT 不能回頭改已套用的 migration,所以在這裡整份重下(內容 = 原文 + 稽核步)。
-- ══════════════════════════════════════════════════════════════════════════
COMMENT ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text) IS
  'M-4b E10-OP5 人工軌收款登錄(SECURITY DEFINER、search_path='''')。一支 RPC 管 bank_transfer + cash 兩軌(master-plan §5.3 項 1);card 軌具名拒。🔴 actor = p_actor 參數 + staff FK + is_active 守門,**不是 session_user**(那是 OP3 機器軌的形狀)。🔴 actor 的誠實邊界:cookie 承載、非授權邊界(apps/admin/src/lib/session/actor.ts:6-7)⇒ 不得單獨作為責任歸屬證據。十道守門:G1 隔離閘 P8C01 → G2 actor(排在任何訂單讀取前,擋守門序 oracle)P2B39 → G3 輸入驗(p_order_id/p_request_id/p_rail/p_amount/p_received_at 各自一道 NULL 守門 + rail 二值 + amount 正 + 軌別欄位形狀;bank_reference/payer_note 先 btrim 正規化) → G4 未來時點 P2B38/pcm_op5_received_at_future(逐字 clock_timestamp;OP2a 的 A8 閘是 backstop)→ G5 orders FOR UPDATE(不存在=通用訊息) → G6 整單取消拒(通用;**部分取消單放行**,§5.1b 契約)+ 退款兩態具名拒 P2B41 + allowlist 之外 fail-closed → G7 下限:匯款比台北曆日、現金比精確時點 P2B38/pcm_op5_received_at_before_order → G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回 idempotent(NULL-safe;cash 兩欄為 NULL)→ G9 append 一列 → G10 row_count 守 P2B40。🔴 **不碰 orders.payment_status**(少收/溢收/結清判定=OP6)、不寫 reviewed_*(Q4=C 複核不強制)、零 UPDATE 零 DELETE(Q3=A 更正走沖銷)。🔴 received_at 逐軌(Sean 2026-08-10 拍板:「銀行入帳日」只適用匯款軌):bank_transfer=銀行入帳日(UI 傳 Asia/Taipei 當日 00:00)、cash=實際收現時點(UI 取 **server** 時間,不設容差)。🔴 **本片零 GRANT(分期開權)**:EXECUTE 由 OP-A12 與沖銷 RPC 一起開 ⇒ 物理上不存在「能登錄、不能更正」的窗口。這道 ACL 極性有到期日 = OP-A12。🔴 開權前置:OP-A12 沖銷入口 / OP-A13 退款態沖銷與重登 / OP-A14 已收款單的取消守門 / OP-A15 待認領款項暫存帳;錯誤碼分類(P2B38 一碼兩義、P2B39/40/41、42501)= backlog #371。零經銷價 / 零 cost。 🔴 **#423(20260812150000)起同交易寫稽核**:成功走 action=payment.record、**冪等重放走 action=payment.record.replay**(Sean 線 Q-D16=B —— 重放幾乎只在「首送已 commit、回應斷在路上、員工重送」時發生,那條路原本零觀測點)。兩者各有筆數守(pcm_op5_audit_row_count / pcm_op5_audit_replay_row_count)恰 1。🔴 after **只放 has_bank_reference / has_payer_note 布林、不放值**:內容明細是 order_payments 自己那列的職責,複製進稽核 = 敏感資料多一份副本。⚠️ **重放的稽核寫入失敗 ≠ 這筆收款不存在** —— 那時收款早已在帳上,訊息逐字叫員工不要重新登錄。⚠️ 兩道筆數守擋的是「寫不進去」(BEFORE INSERT 回 NULL),**擋不到「寫進去又被 AFTER INSERT trigger 刪掉」**(ROW_COUNT 仍為 1);正確防線是 admin_audit_log 的表層 append-only trigger(該表現行 trigger 數=0、append-only 只靠 GRANT,而 SECDEF 是用表 owner 身分寫),見本片檔頭與 backlog。';

COMMENT ON FUNCTION public.admin_reverse_manual_payment(uuid, text, text) IS
  'M-4b E10-OP-A12 人工軌沖銷(SECURITY DEFINER、search_path='''')。沖銷=登錄錯誤的更正(同單同軌、金額為被沖列反號),**不是退款**。十一道:G1 隔離閘 P8C01 → G2 actor(排在任何資料讀取前)P2B42 → G3 輸入驗(reason 正規化成單一變數、必填)→ G4 不鎖讀只取 order_id → G5 鎖 orders FOR UPDATE(鎖序 orders→order_payments,與 OP5 同向)→ G6 **鎖後重讀** target(FOR NO KEY UPDATE;NKU 而非 FOR UPDATE 見 a2b1:20-24 的 40P01 契約) → G7 卡軌具名拒 P2B44/pcm_opa12_card_rail → G8 已被沖銷具名拒 P2B44/pcm_opa12_already_reversed(**無冪等**:沖銷列不得帶 request_id,同 actor+同 reason 分不出重送與誤按) → G9 append 沖銷列(識別欄與 reviewed_* 全 NULL、received_at 跟著被沖那筆)→ G10 row_count 守 P2B43。🔴 **刻意無 payment_status allowlist、不擋已取消單**(#372:沖銷是更正不是收錢);已知代價=A14 缺口下可把正確收款沖成淨零,見本片檔頭與 #372。🔴 反號由 OP2b 的 A9 保證(P2B33),本支不自己驗。零經銷價 / 零 cost。🔴 **不碰 orders.payment_status**(與 OP5 對稱:帳本只記事實,狀態判定歸 OP6)——沖銷把該單淨額打到 0 時,payment_status 仍停在原值,那是 OP6 的職責不是本支的漏做。 → G11 **同交易稽核**(#423,20260812150000):寫一列 admin_audit_log action=payment.reverse、target=payment:<沖銷列 id>、🔴 request_id=**沖銷列自己的 id**(本函式簽章無 p_request_id,而該欄 NOT NULL)、before=被沖那列 {payment_id,amount,rail}、after={reversal_id,amount,reverses_payment_id,**order_id**}(order_id 為 R3 C3 補,災難日免回頭 join)、reason=**v_reason**(= p_reason 去頭尾空白後的值,G3 正規化;不是 p_reason 原字面);筆數守 pcm_opa12_audit_row_count 恰 1,寫不進去整筆回滾。⚠️ 筆數守擋「寫不進去」、**擋不到「寫進去又被 AFTER INSERT trigger 刪掉」**(ROW_COUNT 仍為 1)——正確防線是 admin_audit_log 的表層 append-only trigger(該表現行 trigger 數=0、只靠 GRANT),見本片檔頭與 backlog。';

-- ══════════════════════════════════════════════════════════════════════════
-- 檔尾結構驗收(fail-closed;任一條不成立就 RAISE、整份不套用)
-- ══════════════════════════════════════════════════════════════════════════
DO $assert$
DECLARE
  v_op5   text;
  v_a12   text;
  v_miss  text;
  v_pi    integer;   -- 落帳 INSERT 位置
  v_pg    integer;   -- 落帳 row_count 守(具名約束)位置
  v_pa    integer;   -- 稽核 row_count 守(具名約束)位置
  v_pr    integer;   -- 重放稽核 row_count 守位置
  v_seg   text;      -- 兩道守之間的片段(稽核 INSERT 應該在裡面)
  v_probe text;      -- 反面錨的探針(挖掉合法字面後的殘餘)
BEGIN
  -- 🔴 **錨一律對「剝掉行內註解」的函式體比**(沿用 `20260810210000:345-346` 的作法)。
  --    理由這次是自己撞出來的:第一版直接比 `prosrc`,而我在 A12 的註解裡寫了
  --    「本函式簽章沒有 `p_request_id`」這句話 ⇒ 反面錨⑤ 把**自己的說明文字**當成違規、
  --    對一份正確的 migration 發火。註解會進 prosrc,這條是 repo 的老坑。
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g')
    INTO v_op5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_record_manual_payment';
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g')
    INTO v_a12 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_reverse_manual_payment';
  IF v_op5 IS NULL OR v_a12 IS NULL THEN
    RAISE EXCEPTION '#423:兩支函式應該都在,實際 op5=% a12=%',
      (v_op5 IS NOT NULL), (v_a12 IS NOT NULL);
  END IF;

  -- ① 三個 action 碼各自在對的函式裡(拼錯 = 查詢端永遠濾不到那類列,而且無症狀)
  IF pg_catalog.strpos(v_op5, '''payment.record''') = 0
     OR pg_catalog.strpos(v_op5, '''payment.record.replay''') = 0
     OR pg_catalog.strpos(v_a12, '''payment.reverse''') = 0 THEN
    RAISE EXCEPTION '#423 碼錨:三個 action 字面缺一';
  END IF;

  -- ② 稽核筆數守存在(拿掉它 = trigger 吞列時「零稽核卻回成功」)
  --    🔴 比**具名約束**而不是比 `GET DIAGNOSTICS`:後者在函式裡有三個,數不出誰是誰。
  SELECT string_agg(x.frag, ', ') INTO v_miss
    FROM unnest(ARRAY['pcm_op5_audit_row_count', 'pcm_op5_audit_replay_row_count']) x(frag)
   WHERE pg_catalog.strpos(v_op5, x.frag) = 0;
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION '#423 碼錨:OP5 稽核筆數守缺 %', v_miss;
  END IF;
  IF pg_catalog.strpos(v_a12, 'pcm_opa12_audit_row_count') = 0 THEN
    RAISE EXCEPTION '#423 碼錨:A12 稽核筆數守缺席';
  END IF;

  -- ③ 順序錨:錨的是**稽核 INSERT 敘述本身**的位置,不是兩個約束名的相對位置。
  --    🔴 關卡2 兩條:
  --      (a) 運算元缺席時 strpos=0、`0 > N` 恆假 ⇒ 舊版刪掉落帳守反而全綠(fail-open)。
  --          ⇒ 三個錨點先各自驗存在,缺一就 RAISE。
  --      (b) 只比兩個約束名 = 沒有錨到稽核寫入本身:把稽核 INSERT 搬到落帳守之前
  --          (名字不動)仍全綠;更糟的是搬進「落帳 INSERT 與 GET DIAGNOSTICS 之間」時,
  --          `v_n` 讀到的會是稽核那句的 ROW_COUNT ⇒ **落帳守恆真**。
  --          ⇒ 改成:兩道守之間必須有稽核 INSERT、落帳 INSERT 與落帳守之間不得有。
  --    🔴 這裡**不能**用 `GET DIAGNOSTICS` 當錨(本函式有三個,數不出誰是誰)。
  v_pi := pg_catalog.strpos(v_op5, 'INSERT INTO public.order_payments');
  v_pg := pg_catalog.strpos(v_op5, 'pcm_op5_row_count');
  v_pa := pg_catalog.strpos(v_op5, 'pcm_op5_audit_row_count');
  IF v_pi = 0 OR v_pg = 0 OR v_pa = 0 THEN
    RAISE EXCEPTION '#423 順序錨:OP5 錨點缺席(落帳 INSERT=%、落帳守=%、稽核守=%)⇒ 拒絕假綠',
      v_pi, v_pg, v_pa;
  END IF;
  IF NOT (v_pi < v_pg AND v_pg < v_pa) THEN
    RAISE EXCEPTION '#423 順序錨:OP5 順序應為 落帳 INSERT(%) < 落帳守(%) < 稽核守(%)',
      v_pi, v_pg, v_pa;
  END IF;
  IF pg_catalog.strpos(pg_catalog.substr(v_op5, v_pi, v_pg - v_pi),
                       'INSERT INTO public.admin_audit_log') <> 0 THEN
    RAISE EXCEPTION '#423 順序錨:OP5 有稽核 INSERT 夾在落帳 INSERT 與落帳守之間 ⇒ '
                    'v_n 讀到的是稽核那句的 ROW_COUNT、落帳守恆真';
  END IF;
  v_seg := pg_catalog.substr(v_op5, v_pg, v_pa - v_pg);
  IF pg_catalog.strpos(v_seg, 'INSERT INTO public.admin_audit_log') = 0 THEN
    RAISE EXCEPTION '#423 順序錨:OP5 落帳守與稽核守之間沒有稽核 INSERT ⇒ 稽核筆數守守的不是稽核寫入';
  END IF;

  v_pi := pg_catalog.strpos(v_a12, 'INSERT INTO public.order_payments');
  v_pg := pg_catalog.strpos(v_a12, 'pcm_opa12_row_count');
  v_pa := pg_catalog.strpos(v_a12, 'pcm_opa12_audit_row_count');
  IF v_pi = 0 OR v_pg = 0 OR v_pa = 0 THEN
    RAISE EXCEPTION '#423 順序錨:A12 錨點缺席(沖銷列 INSERT=%、落列守=%、稽核守=%)⇒ 拒絕假綠',
      v_pi, v_pg, v_pa;
  END IF;
  IF NOT (v_pi < v_pg AND v_pg < v_pa) THEN
    RAISE EXCEPTION '#423 順序錨:A12 順序應為 沖銷列 INSERT(%) < 落列守(%) < 稽核守(%)',
      v_pi, v_pg, v_pa;
  END IF;
  IF pg_catalog.strpos(pg_catalog.substr(v_a12, v_pi, v_pg - v_pi),
                       'INSERT INTO public.admin_audit_log') <> 0 THEN
    RAISE EXCEPTION '#423 順序錨:A12 有稽核 INSERT 夾在沖銷列 INSERT 與落列守之間 ⇒ 落列守恆真';
  END IF;
  IF pg_catalog.strpos(pg_catalog.substr(v_a12, v_pg, v_pa - v_pg),
                       'INSERT INTO public.admin_audit_log') = 0 THEN
    RAISE EXCEPTION '#423 順序錨:A12 落列守與稽核守之間沒有稽核 INSERT';
  END IF;

  -- ④ 🔴 敏感值不得進稽核:`after` 只准 `has_*` 布林
  --    比的是「`bank_reference` 這個識別字有沒有出現在 jsonb_build_object 的參數位置」——
  --    用具名的 has_ 前綴當正面錨,再用反面錨擋值本身。
  IF pg_catalog.strpos(v_op5, '''has_bank_reference''') = 0
     OR pg_catalog.strpos(v_op5, '''has_payer_note''') = 0 THEN
    RAISE EXCEPTION '#423 碼錨:OP5 稽核缺 has_* 布林';
  END IF;
  -- 🔴 反面錨的極性反過來(關卡2):舊版列舉「不准出現的拼法」——
  --    只擋 `'bank_reference', v_bank_ref` 這一種,改寫成 `p_bank_reference` 或
  --    `v_existing.bank_reference` 洩漏就擋不到(列舉式反面錨寫下當天就過期)。
  --    改成:在**稽核 INSERT 那一段**裡把兩個合法的布林運算式挖掉,殘餘不得再出現
  --    bank_ref / payer_note 這兩個**識別字**(fail-closed;
  --    連合法字面被改動格式也發火,那時本來就該有人看一眼)。
  --    ⚠️ **這道的能力界線**(關卡2 R2 codex P3 抓到我原本寫「任何拼法都發火」= 過大):
  --    它比的是識別字字面 ⇒ 用**位置參數**(`$7`/`$8`)或**整列傾印**(`to_jsonb(v_existing)`)
  --    洩漏時,段內零命中、這道靜默放行。那一層由 harness N2 守 ——
  --    它拿獨特 sentinel 值(CTBC-SENTINEL-77341 / NOTE-SENTINEL-99527)掃三條路徑的
  --    before+after **實際寫進去的值**,任何拼法的值洩漏都會讓 N2 紅。
  --    ⇒ 結構錨擋改名、值掃擋洩漏,兩層各守一半、不互相取代。
  --    v_seg = ③ 算出的「落帳守 → 稽核守」片段,稽核 INSERT 就在裡面。
  v_probe := pg_catalog.regexp_replace(v_seg, '[[:space:]]+', ' ', 'g');
  v_probe := pg_catalog.replace(v_probe, '''has_bank_reference'', v_bank_ref IS NOT NULL', '');
  v_probe := pg_catalog.replace(v_probe, '''has_payer_note'', v_payer_note IS NOT NULL', '');
  IF v_probe ~ '(bank_ref|payer_note)' THEN
    RAISE EXCEPTION '#423:OP5 正常路徑的稽核 INSERT 段出現單號/備註識別字(只准 has_* 布林)⇒ '
                    '敏感資料多一份副本';
  END IF;
  -- 🔴 重放路徑同一道(關卡2 的變形:值可以搬到重放的 before/after 去洩漏)。
  --    段落 = 第一個稽核 INSERT → 重放稽核守。
  -- 🔴 這一段**刻意不開 has_* 白名單**(正常路徑那段有):重放的 before/after 現行只放
  --    payment_id 與 amount,連 has_* 都不該出現 ⇒ 段內見到這兩個識別字一律違規。
  --    未來若真要在重放段加 has_* 布林,這道會擋下來 —— fail-closed,擋錯了改這裡、不是繞過。
  v_pi := pg_catalog.strpos(v_op5, 'INSERT INTO public.admin_audit_log');
  v_pr := pg_catalog.strpos(v_op5, 'pcm_op5_audit_replay_row_count');
  IF v_pi = 0 OR v_pr = 0 OR v_pi >= v_pr THEN
    RAISE EXCEPTION '#423:OP5 重放稽核錨點缺席或順序反了(稽核 INSERT=%、重放稽核守=%)', v_pi, v_pr;
  END IF;
  IF pg_catalog.substr(v_op5, v_pi, v_pr - v_pi) ~ '(bank_ref|payer_note)' THEN
    RAISE EXCEPTION '#423:OP5 重放路徑的稽核 INSERT 段出現單號/備註識別字';
  END IF;
  -- A12 的稽核完全不碰這兩個欄位 ⇒ 段內出現即違規(無白名單)。
  --    v_pa 此刻 = A12 稽核守的位置(③ 的 A12 段算的)。
  v_pi := pg_catalog.strpos(v_a12, 'INSERT INTO public.admin_audit_log');
  IF pg_catalog.substr(v_a12, v_pi, v_pa - v_pi) ~ '(bank_ref|payer_note)' THEN
    RAISE EXCEPTION '#423:A12 的稽核 INSERT 段出現單號/備註識別字';
  END IF;

  -- ⑤ A12 的 request_id 用沖銷新列 id(F1);不得殘留不存在的 p_request_id
  IF pg_catalog.strpos(v_a12, 'p_request_id') <> 0 THEN
    RAISE EXCEPTION '#423:A12 出現 p_request_id,但它的簽章沒有這個參數';
  END IF;

  -- ⑥ fail-open 面:稽核表的 owner / RLS / 欄級權限(C1)
  --    本片讓這兩支第一次寫這張表 ⇒ 它的權限面從此是這兩支的前提。
  --    🔴 比的對象是**函式的 owner**、不是 `current_user`(關卡2):
  --       `CREATE OR REPLACE` 保留原 owner ⇒ SECURITY DEFINER 執行期是用 `proowner` 的身分寫這張表,
  --       套 migration 的人是誰跟那件事無關。兩者不同時,舊版會在這裡假綠、留到執行期才因 RLS/權限炸。
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'admin_audit_log'
     AND c.relforcerowsecurity = false
     AND c.relowner = (SELECT p.proowner FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
                        WHERE n2.nspname = 'public' AND p.proname = 'admin_record_manual_payment')
     AND c.relowner = (SELECT p.proowner FROM pg_proc p JOIN pg_namespace n3 ON n3.oid = p.pronamespace
                        WHERE n3.nspname = 'public' AND p.proname = 'admin_reverse_manual_payment');
  IF NOT FOUND THEN
    RAISE EXCEPTION '#423 fail-open 面:admin_audit_log 的 owner 與這兩支 SECDEF 函式的 owner 不一致,'
                    '或它是 FORCE RLS ⇒ SECDEF 寫得進去這件事不再成立';
  END IF;

  -- ⑦ 兩支的 COMMENT 都要提到稽核(F3:字面 vs 事實;舊註解列步驟表但不含這一步)
  --    🔴 錨要挑「只可能由這一步產生」的字面(關卡2 nit):A12 原本錨「十一道」,
  --       那是**道數**不是稽核步 —— 未來刪掉 G11 卻留著那三個字仍會全綠。
  --       改錨 `pcm_opa12_audit_row_count`(舊註解零命中:`20260810210000` 全檔 grep = 0)。
  IF pg_catalog.strpos(coalesce(obj_description(
       'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure), ''),
       'payment.record.replay') = 0
     OR pg_catalog.strpos(coalesce(obj_description(
       'public.admin_reverse_manual_payment(uuid,text,text)'::regprocedure), ''),
       'pcm_opa12_audit_row_count') = 0 THEN
    RAISE EXCEPTION '#423:函式 COMMENT 沒有同步到稽核步(F3 字面 vs 事實)';
  END IF;

  RAISE NOTICE '#423 結構驗收通過:三個 action 碼錨在、三道稽核筆數守在、'
               '稽核 INSERT 確實落在「落帳守之後、稽核守之前」且沒有夾在落帳 INSERT 與落帳守之間、'
               '三段稽核 INSERT 挖掉 has_* 白名單後零敏感識別字、A12 零 p_request_id 殘留、'
               'admin_audit_log 的 owner 等於兩支函式的 owner 且非 FORCE RLS、'
               '兩支 COMMENT 各自錨到只可能由稽核步產生的字面';
END;
$assert$;

COMMIT;
