-- ══════════════════════════════════════════════════════════════════════════
-- OP5 · 人工軌收款登錄 RPC `admin_record_manual_payment`(bank_transfer + cash)
-- ══════════════════════════════════════════════════════════════════════════
-- 塊規格權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.3 項 1
--   (逐字:「`bank_transfer` 腿 = 本批匯款登錄 RPC、`cash` 腿 = 同 RPC 的現金選項」⇒ 一支 RPC 管兩軌)。
-- 塊級 plan = `B-395`(v2,主視窗 `MAIN-024-A` 批准)→ `B-396`(v3)→ `B-397`(v4)→ `B-398`(v5)→ **`B-399`(v6 = 開工版)**。
-- 關卡1 帳:codex R1 FAIL 13 → R2 FAIL 8 → R3 換角度 FAIL 5 → **Fable R3 換模型 FAIL 8MF+3nit**(`MAIN-028-R3`),四輪零重複、全折。
--
-- ── 🔴🔴 第一句:人工軌**不得**抄 OP3 的 `session_user` ────────────────────
-- OP3 的 card 腿是**機器軌、無人在場** ⇒ `actor = session_user`(DB 登入角色)。
-- **OP5 是人工軌、現場有人** ⇒ `actor` 一律走 `p_actor` **參數** + `staff` FK,
-- 並照 A8a1/A8a2 先例驗「**存在且啟用**」(`…a8a2_partial_cancel.sql:355` 逐字
-- `WHERE s.id = p_actor AND s.is_active`,親讀)。檔尾碼錨釘死 `session_user` **不得出現在本函式體**。
--
-- ── 🔴 第二句:兩條線**天然分艙**,不必另加守門 ───────────────────────────
-- OP3 seed 的系統身分 `payment_confirmer` 是 `is_active = false`(`…op3_confirm_card_leg.sql:52`,
-- 且同檔 `:664` 有結構斷言把它釘住),而人工軌要求 `is_active` ⇒ **系統身分結構上不可能當人工登錄的經手人**。
-- ⚠️ **失效條件**:哪天 OP3 那道斷言被拿掉、或 seed 被改成啟用,本句立刻不成立
--    ⇒ 屆時要補 `p_actor <> 'payment_confirmer'` 守門。不寫成恆真宣稱。
--
-- ── 四題拍板(memory `project_l5b0-and-op5-five-decisions`,Sean 2026-08-10 傍晚原文 `a,a,a,a,C`)──
-- · **Q1=A** `received_at` = 銀行入帳日、**由人輸入**(非 `now()`)⇒ 簽章含 `p_received_at`。
-- · **Q2=A** 客人聲稱的匯款日**不另存欄** ⇒ 本片**零 `ALTER TABLE`**(寫 `payer_note`,明文不參與判定)。
-- · **Q3=A** 更正**走沖銷**,OP2b 財務欄不可變契約**不放寬** ⇒ 本片零 UPDATE / 零 DELETE 路徑。
-- · **Q4=C** 複核**不強制** ⇒ 不建複核 RPC、OP6 不掛複核閘;`reviewed_by/reviewed_at` 兩欄留著自由用,
--   **本 RPC 不寫它們**。⚠️ 連帶效果要講明白:OP1 檔頭多處寫「靠 OP5 的複核與對帳擋」的字面
--   **已因 Q4=C 過期**(實查至少四處:OP1 `:234/:244/:371/:377`)—— 那些面現在**只剩對帳**。
--
-- ── 🔴 本片做什麼 / 不做什麼 ──────────────────────────────────────────────
-- 做:一支 SECDEF RPC(兩軌)+ harness `scripts/op5-verify.sh`。**純 DB 片**(admin 端目前無任何
--     匯款/現金登錄 UI,已 grep 盤點)。
-- 不做:①**不碰 `orders.payment_status`** —— 少收/溢收/結清判定是 **OP6**(OP1 檔頭 A6:溢款處置 grain 不對)
--       ②不寫 `reviewed_*` ③不加欄 ④不回填(OP4)⑤不碰 dormant gate(OP2b 已 DROP)
--       ⑥**不 GRANT**(見下方「分期開權」)⑦不動 `classifyPgError`(#371 獨立 adapter 片)。
--
-- ── 🔴🔴 分期開權(codex R2 #2 + Fable R3 #4):本片**建函式但不開權** ─────────
-- 原本寫「OP-A12 與 OP5 同批 apply」⇒ **不成立**:repo 的 apply 路徑逐 statement/逐檔自動提交,
-- 「同批 apply ⇒ 風險窗為零」這句話**在 OP1 檔頭 `:13-14` 已被證偽**(A7b 先例)。我引了那份檔卻犯同一句。
-- ⇒ 改成物理封死:**本片零 GRANT**;`GRANT EXECUTE TO service_role` 由 **OP-A12**(沖銷入口)那片
--   **與沖銷 RPC 一起開權**。在那之前,登錄 RPC 存在但正式路徑呼不到 ⇒ **不可能出現「能登錄、不能更正」的窗口**
--   (Q3=A 的更正路徑在 OP-A12 之前物理上不存在)。
-- ⚠️ **這道 ACL 斷言有到期日**:到期點 = OP-A12。OP-A12 **必須**同片做完三件事,否則本片的守門會反過來咬人:
--     ① `GRANT EXECUTE` 給**兩支**(登錄 + 沖銷)② 翻轉本片與 harness 的 ACL 極性(零 → `service_role only`)
--     ③ 補 `has_function_privilege` 的**有效權限**斷言(擋 role 繼承那條 `proacl` 看不到的路)。
--     反向的雷同樣要記:OP-A12 若**忘了 GRANT**,正式站噴 `42501`,而現行 adapter 會把它歸「連線失敗、可重試」
--     ⇒ `42501` 已列進 **backlog #371**(dev `c096e5eb`)。
--
-- ── 🔴 `actor` 的誠實邊界(Fable R3 / codex R1 #5;不擴張宣稱)────────────────
-- `apps/admin/src/lib/session/actor.ts:6-7` 逐字:「actor 以 cookie 承載、內容來自使用者自行選擇。
-- 這**不是**登入 / 授權邊界」⇒ 本欄記的是「**登錄畫面上被選的人**」,**不得單獨作為責任歸屬證據**。
-- 這是 repo 現況(A8a2 同款)、**不是本片新增的洞**;真身分綁定 = E8-B 個人帳號線。
--
-- ── 🔴 `received_at` 的逐軌契約(OP-A11 的 bank_transfer/cash 兩軌 owner = 本片)──
-- OP1 `:217-222` 逐軌定義(親讀):`bank_transfer` = **銀行入帳日**、`cash` = **收到現金的時點**。
-- · `bank_transfer`:UI 傳 **Asia/Taipei 當日 00:00** 的 timestamptz。RPC **不做時區轉換**
--   ⚠️ **這半是 UI 契約、不是 DB 不變式**(雙線審 nit):DB 這側沒有任何斷言逼 UI 真的送午夜值,
--      送別的時刻照樣寫得進去(只要過 G4/G7)。要變成不變式得等 OP-A11 的 UI 前置那片。
--   (SECDEF 內的 `timezone` GUC 由呼叫端決定、不可信)。
-- · `cash`:UI 傳**實際收到現金的時刻**,且 **時間取自 server**、不用 client 的鐘
--   (OP-A11 要的是「時間來源**與時鐘偏差政策**」兩半;偏差政策 = **不另設容差**,
--    超過 `clock_timestamp()` 一律紅在 G4)。⚠️ 少了這半就等於「OP-A11 已交付」是宣稱大於事實。
-- 🏁 **這一格 Sean 已拍板(2026-08-10 傍晚,Fable R3 #2 上呈)**:原拍板字面「匯款/**現金**的
--    `received_at` = 銀行入帳日」與 OP1 `:222`「cash = 收到現金的時點」看似打架 ——
--    **Sean 拍 A:「銀行入帳日」那句只適用匯款軌;cash = 實際收到現金的時點、UI 取 server 時間**
--    (落 memory `project_l5b0-and-op5-five-decisions` 第 10 條)。⇒ 下方 G7 的逐軌分支就是這個拍板的落地,
--    不是我對兩份字面的自行解釋。
--
-- ── 具名缺口(登記處 = **backlog #372**,不是 OP1 檔頭)──────────────────────
-- 🔴 這裡原本寫「全部登記進 OP1 檔頭的 OP-A11 登記處」= **字面大於事實**(codex 關卡2 抓):
--    OP1 那支已 apply,動它會讓 24 張 W7 收據再翻攪一輪 ⇒ 主視窗裁定**不補寫 OP1**,
--    改立 **backlog #372**(四缺口全文 + OP-A12 三義務 + OP-A14 歸 OP6/A8 帳)。
--    `MAIN-024-A` 那半條「寫進 OP1 檔頭」**已撤回**。本段留著是現場說明,權威在 #372。
-- · **OP-A12** 沖銷入口 `admin_reverse_manual_payment` —— 含「GRANT 兩支 + 翻 ACL 極性 + `has_function_privilege` 斷言」;
--   🔴 **沖銷 RPC 不受本片 `payment_status` allowlist 限制**(沖銷是更正、不是收錢;抄了 allowlist 會連更正都做不了)。
-- · **OP-A13** 退款態單的**沖銷與重登**入口(下方 G6 拒掉的那條路)。失效條件 = OP6 淨額與狀態重算上線。
-- · **OP-A14** 已收款單的取消守門 —— A8a2 的允許集合**不看 order_payments**(`…a8a2…sql` 步7 只看
--   `payment_status='unpaid'` + attempts)⇒ **已收人工款的單目前仍可被取消**。不在本片可修。
-- · **OP-A15** 待認領款項暫存帳 —— 🔴 **本片每一道 fail-closed 拒絕,在正式站等於「錢收到了但記不進去」**;
--   在 OP-A15 上線前,值班的唯一手段是**人工銀行對帳**(Q4=C 之後連複核那道人眼也沒有了)。
--   ⇒ **接 UI 之前必須先有它**。這條寫在這裡不是免責,是把代價講清楚。
--
-- ── 錯誤碼(全 repo 實查未用;三碼 + 本次新增第四碼)────────────────────────
-- `P2B38` = received_at 兩道(**一碼兩義,按 CONSTRAINT 名分**:`…_future` / `…_before_order`)
-- `P2B39` = actor 無效 / `P2B40` = 落帳 row_count / `P2B41` = 退款態拒登(政策性、可診斷)
-- 🔴 四碼都**不是 `P0001`** ⇒ 現行 `classifyPgError`(`packages/adapters/src/payment/PaymentConfirmerAdapter.ts:201-209`,
--    親讀:`P0001` → rejected、其餘 → **unreachable「可重試」**)會全部誤歸。⚠️ 但那支是
--    **`PaymentConfirmerAdapter` 的私有函式、只服務 `confirm_order_payment`** ——
--    本 RPC **目前零消費端**,不是「現有 adapter 會誤判」,是「**還沒有人接**」。
--    ⇒ 正確分類 = **開權 / 接 UI 的硬前置**。清單已於 dev 擴成五碼
--    (`P2B38` 一碼兩義 / `P2B39` / `P2B40` / `P2B41` / `42501`)—— ⚠️ 那筆在 dev 的 `c096e5eb`,
--    本 worktree 落後 6 顆時看不到它,別把「我這棵樹沒有」讀成「還沒立案」。
--
-- ── apply 前置 ─────────────────────────────────────────────────────────────
-- ① **OP2b 必須已 apply**(dormant gate 已 DROP),否則本 RPC 每一筆都紅在 gate —— 檔尾結構閘會擋。
-- ② `transaction_timeout` 是 **PG17-only**(OP1 檔頭同款代價)⇒ apply 前跑一次 `SHOW server_version;`。
-- ③ **本片不 push、不 apply**;apply 由 Sean 手動,且**開權在 OP-A12**。
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 🔴 整片一交易(OP1 R2 #6 的同款理由:逐 statement 自動提交會留下沒被驗過的半套錢路徑)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

CREATE FUNCTION public.admin_record_manual_payment(
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
  'M-4b E10-OP5 人工軌收款登錄(SECURITY DEFINER、search_path='''')。一支 RPC 管 bank_transfer + cash 兩軌(master-plan §5.3 項 1);card 軌具名拒。'
  '🔴 actor = p_actor 參數 + staff FK + is_active 守門,**不是 session_user**(那是 OP3 機器軌的形狀)。'
  '🔴 actor 的誠實邊界:cookie 承載、非授權邊界(apps/admin/src/lib/session/actor.ts:6-7)⇒ 不得單獨作為責任歸屬證據。'
  '十道守門:G1 隔離閘 P8C01 → G2 actor(排在任何訂單讀取前,擋守門序 oracle)P2B39 → G3 輸入驗(p_order_id/p_request_id/p_rail/p_amount/p_received_at 各自一道 NULL 守門 + rail 二值 + amount 正 + 軌別欄位形狀;bank_reference/payer_note 先 btrim 正規化)'
  ' → G4 未來時點 P2B38/pcm_op5_received_at_future(逐字 clock_timestamp;OP2a 的 A8 閘是 backstop)→ G5 orders FOR UPDATE(不存在=通用訊息)'
  ' → G6 整單取消拒(通用;**部分取消單放行**,§5.1b 契約)+ 退款兩態具名拒 P2B41 + allowlist 之外 fail-closed → G7 下限:匯款比台北曆日、現金比精確時點 P2B38/pcm_op5_received_at_before_order'
  ' → G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回 idempotent(NULL-safe;cash 兩欄為 NULL)→ G9 append 一列 → G10 row_count 守 P2B40。'
  '🔴 **不碰 orders.payment_status**(少收/溢收/結清判定=OP6)、不寫 reviewed_*(Q4=C 複核不強制)、零 UPDATE 零 DELETE(Q3=A 更正走沖銷)。'
  '🔴 received_at 逐軌(Sean 2026-08-10 拍板:「銀行入帳日」只適用匯款軌):bank_transfer=銀行入帳日(UI 傳 Asia/Taipei 當日 00:00)、cash=實際收現時點(UI 取 **server** 時間,不設容差)。'
  '🔴 **本片零 GRANT(分期開權)**:EXECUTE 由 OP-A12 與沖銷 RPC 一起開 ⇒ 物理上不存在「能登錄、不能更正」的窗口。這道 ACL 極性有到期日 = OP-A12。'
  '🔴 開權前置:OP-A12 沖銷入口 / OP-A13 退款態沖銷與重登 / OP-A14 已收款單的取消守門 / OP-A15 待認領款項暫存帳;錯誤碼分類(P2B38 一碼兩義、P2B39/40/41、42501)= backlog #371。'
  '零經銷價 / 零 cost。';

-- ── ACL:🔴 **刻意零 GRANT**(分期開權,見檔頭)────────────────────────────
-- ⚠️ 下一個人很可能「順手補一句 GRANT」—— 那會把 OP-A12 的封鎖打開。**要開權請連同沖銷 RPC 一起開**,
--    並同時翻轉本檔尾與 `op5-verify.sh` 的 ACL 斷言極性。
REVOKE ALL ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ══ 檔尾 fail-closed 結構驗收 ═══════════════════════════════════════════════
DO $op5_asserts$
DECLARE
  v_code text;
  v_body text;
  v_bad  text;
  v_n    integer;
  v_fn   oid;
BEGIN
  SELECT p.oid, p.prosrc INTO v_fn, v_code
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)'::regprocedure;

  -- 🔴🔴 **雙線審 MF1+MF2(同一個根因,兩線各自命中)**:錨點原本直接對 `prosrc` 比,
  --    而 `strpos` 取的是**首次命中** —— 那個位置多半落在**註解**裡:實測 `IS NOT DISTINCT FROM`
  --    在本函式出現 10 次、首次在註解;`AND s.is_active` 的首次命中甚至在檔頭第 13 行的說明。
  --    ⇒ 把六條比較改成 `=`、或把冪等樹整塊搬到 INSERT 之後,只要註解留在原位,**每一道錨都照樣綠**,
  --      而它們守的正是「cash 重送被誤判」與「重送落第二列」。
  --    ⇒ 先把行內註解剝掉,之後所有存在性錨與順序錨一律對 `v_body`(純程式碼)比。
  --    ⚠️ 誠實邊界:剝法是「每行 `--` 之後全砍」,若日後函式體出現含 `--` 的字串常值會被誤砍;
  --       本函式沒有(實查),真的出現時這裡會紅在下面的次數斷言,不會靜默放行。
  v_body := pg_catalog.regexp_replace(v_code, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');

  -- ① apply 前置:dormant gate 必須**已經不在**(OP2b 已 apply),否則本 RPC 每一筆都寫不進去。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conname = 'order_payments_dormant_until_triggers'
                AND conrelid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION 'dormant gate 還在 ⇒ OP2b 尚未 apply,本 RPC 落不了帳。發布序 OP1 → OP2a → OP2b → OP5'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_dormant_gate_present';
  END IF;

  -- ② OP2a + OP2b 的四支 trigger 逐支在、且**啟用中**(`tgenabled='O'`)。
  --    🔴 只驗「存在」擋不住「被 DISABLE」—— 停用的 trigger 照樣列在 pg_trigger。
  SELECT pg_catalog.string_agg(x.t, ', ' ORDER BY x.t) INTO v_bad
    FROM unnest(ARRAY['order_payments_received_at_not_future_biu',
                      'order_payments_reversal_amount_bi',
                      'order_payments_immutable_bu',
                      'order_payments_no_delete_bd']) x(t)
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g
                      WHERE g.tgrelid = 'public.order_payments'::regclass
                        AND g.tgname = x.t AND g.tgenabled = 'O');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'order_payments 的守門 trigger 缺席或被停用:% ⇒ 本 RPC 的上游不變式沒人守', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_upstream_triggers';
  END IF;

  -- ③ 四道 unique index 不只要「有定義」,還要**真的在生效**。
  --    🔴 invalid / not ready 的索引照樣有 `indexdef`,但它擋不住任何東西。
  -- 🔴🔴 codex 關卡2 #1:第一版是「掃仍存在的索引、挑出不生效的」——**對「整支被 DROP」全盲**
  --    (不存在就不在掃描範圍內 ⇒ 聚合回 NULL ⇒ 照樣通過)。把三道非 request_id 的 unique 刪掉,
  --    本斷言原本一聲不吭。⇒ 改成**從期望清單反查**(anti-join):少一支、或在但不生效,都紅。
  SELECT pg_catalog.string_agg(x.idx, ', ' ORDER BY x.idx) INTO v_bad
    FROM unnest(ARRAY['order_payments_card_idem_uniq', 'order_payments_rec_trade_global_uniq',
                      'order_payments_request_id_uniq', 'order_payments_one_reversal_uniq']) x(idx)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_index i
       JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'public.order_payments'::regclass
        AND c.relname = x.idx
        AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '這些 unique index 不存在、或存在但沒在生效(invalid/not ready/not live/非 unique):%', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_index_not_effective';
  END IF;
  -- 人工軌冪等鍵的 predicate 逐字(範圍與 partial 條件都不能漂)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
     WHERE schemaname = 'public' AND tablename = 'order_payments'
       AND indexname = 'order_payments_request_id_uniq'
       AND indexdef ILIKE '%(order_id, request_id)%'
       AND indexdef ILIKE '%WHERE (request_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION '人工軌冪等鍵 order_payments_request_id_uniq 的鍵欄或 WHERE 漂了 ⇒ G8 的 backstop 失效'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_request_uniq_drifted';
  END IF;

  -- ④ 碼錨:四個具名錯誤碼 + NULL-safe 比對 + 隔離閘,逐字在。
  SELECT pg_catalog.string_agg(x.frag, ' | ' ORDER BY x.frag) INTO v_bad
    FROM unnest(ARRAY['USING ERRCODE = ''P8C01''',
                      'USING ERRCODE = ''P2B38''',
                      'USING ERRCODE = ''P2B39''',
                      'USING ERRCODE = ''P2B40''',
                      'USING ERRCODE = ''P2B41''',
                      'IS NOT DISTINCT FROM',
                      'GET DIAGNOSTICS v_n = ROW_COUNT;',
                      'pg_catalog.clock_timestamp()',
                      'AND s.is_active']) x(frag)
   WHERE pg_catalog.strpos(v_body, x.frag) = 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP5 碼錨缺失:% ⇒ 守門被改寫或被拿掉;拒繼續', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_code_anchor';
  END IF;

  -- 🔴 次數錨(存在性對「只改其中一條」全盲):冪等比對是**六個輸入各一條**,
  --    改任一條成 `=` 就會讓那一欄的 NULL 比對失效,而只問「有沒有出現過」照樣綠。
  IF (pg_catalog.length(v_body) - pg_catalog.length(pg_catalog.replace(v_body, 'IS NOT DISTINCT FROM', '')))
     / pg_catalog.length('IS NOT DISTINCT FROM') <> 6 THEN
    RAISE EXCEPTION 'OP5 次數錨:冪等比對的 IS NOT DISTINCT FROM 不是 6 條 ⇒ 有欄被改成 = 或被刪;拒繼續'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_idempotent_arity';
  END IF;

  -- 🔴 反向錨:`session_user` **不得出現在本函式體**(這是本片與 OP3 最關鍵的差別)。
  IF pg_catalog.strpos(v_body, 'session_user') <> 0 THEN
    RAISE EXCEPTION 'OP5 函式體出現 session_user ⇒ 人工軌抄了 OP3 的機器軌身分,稽核會失真;拒繼續'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_no_session_user';
  END IF;

  -- ⑤ 順序錨(三條;順序本身是承重,不是風格)
  --    · row_count 守必須在 INSERT **之後**(排前面讀到的是上一句的 ROW_COUNT、恆真)
  IF pg_catalog.strpos(v_body, 'GET DIAGNOSTICS v_n = ROW_COUNT;')
     < pg_catalog.strpos(v_body, 'INSERT INTO public.order_payments') THEN
    RAISE EXCEPTION 'OP5 順序錨:row_count 守不在 INSERT 之後 ⇒ 它讀到的是上一句的 ROW_COUNT、恆真;拒繼續'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_order_rowcount';
  END IF;
  --    · actor 守門必須在**第一次讀 orders 之前**(否則守門序自己變成訂單狀態 oracle)
  IF pg_catalog.strpos(v_body, 'AND s.is_active')
     > pg_catalog.strpos(v_body, 'FROM public.orders o') THEN
    RAISE EXCEPTION 'OP5 順序錨:actor 守門排在讀 orders 之後 ⇒ 無效身分可探測訂單狀態並先鎖列;拒繼續'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_order_actor_first';
  END IF;
  --    · 冪等樹必須在 INSERT 之前(它是「重送不落第二列」的唯一機制)
  IF pg_catalog.strpos(v_body, 'IS NOT DISTINCT FROM')
     > pg_catalog.strpos(v_body, 'INSERT INTO public.order_payments') THEN
    RAISE EXCEPTION 'OP5 順序錨:冪等樹不在 INSERT 之前 ⇒ 重送會落第二列;拒繼續'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_order_idempotent_first';
  END IF;

  -- ⑥ 函式屬性:SECDEF + search_path='' 逐字。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
    RAISE EXCEPTION '本函式不是 SECURITY DEFINER ⇒ 零 GRANT 的錢帳寫不進去'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_not_secdef';
  END IF;
  SELECT pg_catalog.array_to_string(p.proconfig, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  -- 🔴 期望值是**實跑量出來的**,不是我推的:空 search_path 在 `proconfig` 裡渲染成
  --    `search_path=""`(帶兩個雙引號),不是 `search_path=`。第一版寫後者,apply 當場紅在這裡。
  IF v_bad IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION 'proconfig 是 [%],期望逐字 [%]', coalesce(v_bad, '(NULL)'), 'search_path=""'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_proconfig';
  END IF;

  -- ⑦ SECDEF fail-open 面(照 OP3 同款):函式 owner 必須是這幾張表的 owner、且沒開 FORCE RLS。
  --    🔴 owner 不對齊時症狀是「寫不進去」或「整筆紅」,而且可能只在某些路徑才炸。
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.orders'::regclass, 'public.order_payments'::regclass,
                   'public.staff'::regclass)
     AND (c.relowner <> (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
          OR c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECDEF fail-open 面 — [%] 的 owner 與本函式不對齊、或開了 FORCE RLS ⇒ '
                    '登錄會寫不進去;停下人工對齊,本片不自行 ALTER', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_secdef_fail_open';
  END IF;
  -- 欄級 INSERT 權(表級 ACL 攤平看不到欄級 GRANT/REVOKE)。八欄逐欄問。
  SELECT pg_catalog.string_agg(x.col, ', ' ORDER BY x.col) INTO v_bad
    FROM unnest(ARRAY['order_id','rail','amount','received_at',
                      'bank_reference','request_id','payer_note','actor']) x(col)
   WHERE NOT pg_catalog.has_column_privilege(
                (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_fn),
                'public.order_payments'::regclass, x.col, 'INSERT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SECDEF 可寫性 — 函式 owner 對 order_payments 的這些欄沒有 INSERT 權:%', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_column_insert_priv';
  END IF;

  -- ⑧ 🔴 ACL:**本片刻意零 GRANT**(分期開權)。proacl 非 NULL(證明 REVOKE 真的執行過),
  --    且 owner 以外零 EXECUTE。⚠️ **這道有到期日 = OP-A12**:那片開權時必須同時翻轉這裡與 harness。
  SELECT p.proacl::text INTO v_bad FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF v_bad IS NULL THEN
    RAISE EXCEPTION 'proacl 是 NULL(沒有任何 GRANT/REVOKE 紀錄)⇒ PG 對函式的預設是 EXECUTE TO PUBLIC'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_proacl_null';
  END IF;
  SELECT pg_catalog.string_agg(DISTINCT
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
   WHERE p.oid = v_fn AND g.grantee <> p.proowner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '本片刻意零 GRANT,但 proacl 有 owner 以外的 grantee(%)⇒ '
                    '開權必須與 OP-A12 的沖銷 RPC 一起做,否則會出現「能登錄、不能更正」的窗口', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_execute_not_zero';
  END IF;

  -- 🔴🔴 codex 關卡2 #2:上一道問的是 `proacl` 的**直接** grantee,而 EXECUTE 可以**經 role 繼承**
  --    拿到 —— 那條路 `proacl` 看不到。分期開權宣稱的是「正式路徑物理上呼不到」,
  --    只驗直接授權等於沒驗到那句話。⇒ 對三個具名角色問**有效權限**(OP2a/OP2b 同款)。
  --    ⚠️ 誠實邊界照抄 OP2a:這道涵蓋的是這三個角色(含它們繼承來的),**不涵蓋**清單外的角色、
  --       owner 身分與 superuser。
  SELECT pg_catalog.string_agg(x.r, ', ' ORDER BY x.r) INTO v_bad
    FROM unnest(ARRAY['anon','authenticated','service_role']) x(r)
   WHERE pg_catalog.has_function_privilege(x.r,
           'public.admin_record_manual_payment(uuid,uuid,text,text,integer,timestamptz,text,text)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '這些角色**有效**拿得到 EXECUTE(%)⇒ 分期開權被繞過(可能經 role 繼承,proacl 看不到那條路)。'
                    '處置 = 若這是 OP-A12 的開權,請同批翻本片與 harness 的極性,**不是把這道閘拿掉**', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op5_execute_effective';
  END IF;

  RAISE NOTICE 'OP5 結構驗收通過:dormant gate 已不在、四支上游 trigger 在且啟用、四道 unique index **逐支存在**且生效(anti-join,被 DROP 也紅)且冪等鍵 predicate 未漂、'
               '九個碼錨在(對剝掉註解的函式體比,不是對 prosrc 首次命中)、冪等比對次數恰 6、session_user 反向錨在、三條順序錨(row_count 在 INSERT 後 / actor 在讀 orders 前 / 冪等樹在 INSERT 前)、'
               'SECDEF + search_path 空、owner 對齊三張表且非 FORCE RLS、八欄欄級 INSERT 權在、proacl 非 NULL 且零外部 grantee + anon/authenticated/service_role 的**有效** EXECUTE 皆為假(分期開權,到期點=OP-A12)';
END
$op5_asserts$;

COMMIT;
