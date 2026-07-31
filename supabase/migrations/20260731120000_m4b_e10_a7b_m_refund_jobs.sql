-- ============================================================
-- M-4b E10 第 1 批 · A7b-M:order_refund_jobs + order_refund_job_items(卡片退款工作表)
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 表第 25 列(A7b-M / A7b-T)
-- 片級 plan:docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md(**v7**)
-- 審查:關卡1 **六輪** —— codex R1(35+5)/ codex R2(18+4)/ Fable R3 換模型換角度(11+3)/
--       codex R4 靜態可達性與宣稱稽核(7)/ Fable R5 D9 名過其實(11+2)/ codex R6 實作者視角(11)
--       = **93 must-fix + 14 nit**,折入 91/93、駁回 0。逐字 = docs/reviews/2026-07-31-e10-a7b-k1*.md
-- 片型 M(純 schema;**零 trigger、零 DB 函式** —— 那些是 A7b-T)
-- Sean 拍板:Q1-Q4(07-31 早)+ Q1=A/Q2=B/Q3=A/Q4=A/Q5=A(07-31 下午),全文 = memory
--            project_m4b-a7b-refund-jobs-decisions
--
-- ── 這張表在答什麼 ──────────────────────────────────────────
-- 「這筆取消要退的錢,退到哪一步了」。TapPay 退款**隔日才生效**
-- (docs/reference/tappay-reference.md §2.3、親驗第 107 行):Refund API 回 status 0
-- 只代表「已送出」⇒ 送出與確認之間必須有可持久化、可重入、可對帳的中間狀態,
-- 否則 crash 或重試 = **退兩次錢**。
--
-- 🔴 **本片交付的是規則,不是行為。** worker 在第 3 批,照本合約寫、不得另立。
--
-- ── 🔴🔴 施工者必讀:這份合約最貴的三個教訓(六輪審查抓出來的) ──────────
-- ① **「證明成立」不等於「證明了對的事」**(R3):plan v3 證明了「一代最多一個後繼」,
--    但要保證的是「**同一筆錢只退一次**」。中間差一條路:已被 TapPay 受理的退款進 dead 後
--    若被結成「授權重試」,下一代會帶**全新 bank_refund_id** ⇒ TapPay 的冪等鍵不會擋。
-- ② **不要把 worker 紀律講成 DB 保證**(R4):plan v4 寫「retry_exhausted 蘊含零金額移動」,
--    但 worker 逾時誤寫 E5 就破。⇒ 見下方 orj_retry_auth_* 四條的註解,它們**是必要條件與稽核,
--    不是安全證明**。
-- ③ **每一句「所以安全」都要指得出具名 constraint**(R5):plan v5 寫「錢已入帳必定被擋下」,
--    而當時**沒有任何 CHECK 做那個比對**。⇒ 本檔所有此類註解一律附 constraint 名。
--
-- ── 沿用既有 pattern,不發明新的 ─────────────────────────────
-- order_refunds + order_refund_items(`20260725130100`)、order_cancellations +
-- order_cancellation_items(`20260730130000`)與本片**結構同形**:
-- header + 子表 + 兩道複合 FK 夾住「明細品項 ∈ header 的訂單」。
--   · order_cancellations 自帶 `UNIQUE (id, order_id)`(`20260730130000:125-126` 親驗)
--     ⇒ 本片的複合 FK **不需要 ALTER 任何既有表**(codex R6 Q2 親開核可)
--   · order_items 的 `order_items_order_id_id_key UNIQUE (order_id, id)` 早就存在
--     (`20260725130100:76-77`)
--   · 複合 FK 欄序必須對齊被引用唯一約束的欄序
--
-- ⚠️ **「不 ALTER」不等於「不取鎖」**(codex R6 F9,v6 曾把這條看反):
--    真正會擋結帳的**不是**下方的 dormant gate(它只鎖本片新表、且表恆空),
--    而是**子表 FK 指向 order_items 時對被引用表取的 SHARE ROW EXCLUSIVE** ——
--    它與 create_order 的 INSERT(ROW EXCLUSIVE)互斥。
--    🔴 而 `lock_timeout` **只保護本 migration 等不到鎖時放棄,不保護「結帳交易在等我放鎖」**
--    ⇒ 挑離峰 apply;鎖窗上限由 A7b-T 的 barrier lock probe 量測(plan §10)。
--
-- ── 本片與 A7b-T 的分界(鐵則 4 拆片;Sean 07-31 拍 Q2=A)────────────
-- 本檔 = A7b-M:兩表 + 所有 CHECK + 五道唯一性 + 索引 + ACL + COMMENT + **dormant gate**
--              + 結構/定義/ACL 驗收。**零合成資料、零行為探針、零條件略過分支。**
-- A7b-T = 十支守門 trigger(manifest 見 plan §5.0)+ 行為探針 + 突變 harness,
--         並在**同一交易的最後一步**移除 dormant gate。
--
-- 🔴🔴 **dormant gate 的存在理由(codex R2 #14)**:兩支 migration **各自 COMMIT**。
--    v2 曾寫「兩片同批 apply ⇒ 風險窗實際為零」——**那是錯的**:A7b-T 失敗時 A7b-M 會單獨留在
--    正式站,而那時**這張表是可以被亂寫的**(狀態機守門全在 T)。
--    ⇒ 本片建表時同時掛一條具名 `CHECK (false)`,任何 INSERT 一律被擋;
--      (🔴 **原本寫 `NOT VALID`,本機實跑證明它在 `CREATE TABLE` 不生效、已刪**,理由見約束定義處)
--      A7b-T 在所有守門安裝並通過結構驗收之後才 DROP 它。T 失敗 ⇒ 整支回滾 ⇒ gate 留著
--      ⇒ **表存在但寫不進去**,而不是「可以被亂寫」。
--
-- 🔴 **結構驗收證明什麼、不證明什麼**(A7-1 的教訓):
--    本檔的 DO block 證明「約束存在、形狀對、ACL 對、欄位清單對」,**不證明語意對**。
--    例:status 的七值 allowlist 若被寫成只允許 1 個值,單靠「約束存在」抓不到
--    ⇒ 那是 A7b-T 行為探針的責任。兩片缺一,本片不得宣稱「狀態機已鎖對」。
--
-- 🔴 **對 plan v7 的一處刻意偏離(施工時決定,已回寫 plan)**:
--    plan §4.4 寫「逐狀態 truth table 落成**一條** CASE CHECK」。
--    本檔改為**七條 per-status 具名 CHECK**(orj_shape_<status>)。理由:
--    單一 CHECK 會讓七個狀態共用一個 constraint 名 ⇒ 負測無法斷言「紅在哪一個狀態的形狀」,
--    與 A7 已立的「突變判定以**約束**為單位」紀律衝突。七條各自雙向(該 R 的必 R、該 N 的必 N),
--    合起來仍是完整 truth table(status 有七值 allowlist ⇒ 窮盡)。
-- ============================================================

BEGIN;

-- 🔴 建 FK 要對 order_cancellations / order_items / staff / order_refunds 取
--    SHARE ROW EXCLUSIVE,與 live 結帳 INSERT 互斥。5 秒等不到就整片回滾、改挑離峰重跑,不賭。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- 🔴 **關卡2 must-fix**:`lock_timeout` 只限制「等鎖」、`statement_timeout` 只限制「單一 statement」——
--    兩者都**不限制整個交易的持鎖時間**。FK 一旦取得 order_items 的 SHARE ROW EXCLUSIVE,
--    會一路持有到 COMMIT,期間 create_order 的 INSERT 全部排隊。
--    ⇒ PG17 的 `transaction_timeout` 才是整筆交易的硬上限。
SET LOCAL transaction_timeout = '90s';

-- ══ 1. order_refund_jobs:一次要退的錢 = 一列 ═════════════════════════════════
CREATE TABLE public.order_refund_jobs (
  -- ── 身分與世代 ──────────────────────────────────────────
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cancellation_id   uuid        NOT NULL,
  -- 冗餘欄,存在的唯一理由 = 讓下方複合 FK 夾住「本 job ∈ 該 cancellation 的訂單」。
  order_id          uuid        NOT NULL,
  generation        integer     NOT NULL DEFAULT 1,

  -- ── 外部識別(全部不可變,由 A7b-T 強制)────────────────────
  rec_trade_id      text        NOT NULL,
  bank_refund_id    text        NOT NULL,
  payload_hash      text        NOT NULL,
  -- Refund API 回的外部識別;**只有 E4 能首次寫入**(A7b-T D10),一旦非 NULL 即不可變。
  -- 🔴 它**不是**「到達某狀態就一定有」:走 E3b(不確定送出)的 job 從未收到成功回應
  --    ⇒ 永遠是 NULL,但可能一路走到 completed。狀態層因此不得要求它非 NULL(R3 F3)。
  tappay_refund_id  text,

  -- ── 金額與對帳基準 ──────────────────────────────────────
  refund_amount     integer     NOT NULL CHECK (refund_amount > 0),
  -- enqueue 時為 NULL,worker 首次 claim 後由 E2 持久化。
  -- 🔴 規範來源寫死:一律以 **TapPay Record API 的當下累計退款額**為準,
  --    **不得讀本地 order_refunds 加總** —— 否則 external_refund_confirmed 的 dead 會讓本地值
  --    低於 TapPay 事實,後續 job 對帳必然 > target ⇒ 連環進 dead(R5 nit 3)。
  refunded_before   integer,
  refunded_target   integer,

  -- ── 帳本快照(Q4=B;enqueue 當下凍結、不可變)────────────────
  -- 🔴 為什麼要凍結:隔日寫帳本時,運費規則與品項金額可能已經變了。
  items_amount        integer   NOT NULL CHECK (items_amount > 0),
  shipping_fee_before integer   NOT NULL CHECK (shipping_fee_before >= 0),
  shipping_fee_after  integer   NOT NULL CHECK (shipping_fee_after  >= 0),
  shipping_delta      integer   NOT NULL,
  reason              text      NOT NULL CHECK (btrim(reason, E' \t\r\n 　​  ') <> ''),
  -- 🔴 **刻意沒有形狀 CHECK**(A7 已實測、`20260730130000:100-113` 逐字記錄):
  --    FK 要求 actor ∈ staff.id,而 staff 自帶 staff_id_format(`20260726120000:21`)
  --    ⇒ 形狀已被**傳遞性保證**,加 CHECK 是嚴格被支配的死重、且原理上無法被獨立突變證明。
  actor               text      NOT NULL,
  request_id          text      NOT NULL CHECK (btrim(request_id, E' \t\r\n 　​  ') <> ''),

  -- ── 狀態與生命週期 ──────────────────────────────────────
  status            text        NOT NULL DEFAULT 'queued',

  -- lease **三欄**(不是四欄;v2 的「四欄」是計數錯誤)
  claim_token       uuid,
  claimed_at        timestamptz,
  claim_expires_at  timestamptz,

  -- 🔴 D2:語意 = 「**有一次呼叫已發出、且結果未知**」,不是「已成功」。
  --    worker 必須在呼叫 TapPay Refund **之前**以獨立交易戳它並 COMMIT,之後才發 HTTP。
  --    明確失敗(收到非成功回應)⇒ 結果已知 ⇒ E5/E5b 清為 NULL;
  --    🔴 逾時 / 無回應 ⇒ 結果未知 ⇒ **worker 不得寫任何東西**,讓 lease 自然過期走 E3b。
  --    ⚠️ 這一條 trigger 驗不到 = **第 3 批 worker 的 DoD 硬前置**,也是 D7 失效的唯一入口。
  refund_call_attempted_at timestamptz,
  -- 🔴 D9(R5 F2):**永不可清、單調不減**。D9b 的隔日閘錨它 ——
  --    錨「第一次」會讓「第 4 輪逾時受理」的情境當天就能結案重退,閘門形同虛設。
  last_refund_call_at      timestamptz,

  -- 排程
  retry_count       integer     NOT NULL DEFAULT 0,
  next_retry_at     timestamptz,
  next_check_at     timestamptz,
  check_fail_count  integer     NOT NULL DEFAULT 0,
  failed_reason     text,

  -- 人工複核與結案
  manual_review_required boolean NOT NULL DEFAULT false,
  reviewed_at       timestamptz,
  reviewed_by       text,
  resolution        text,
  dead_reason       text,
  -- 🔴 D9a:授權重試時必填的「結案當下 Record 查到的累計退款額 + 查詢時間」。
  --    ⚠️ DB **無法驗證這兩個值是真的** —— 它們是**稽核要求**,不是防護(plan §8)。
  retry_auth_recorded_refunded integer,
  retry_auth_checked_at        timestamptz,

  -- 🔴 D11(Sean 07-31 拍 Q2=B):結案選錯的正式更正路徑,取代「工程師手動 DISABLE TRIGGER」。
  --    推翻理由 = 訂單量是**每月 100-300 筆**(Sean 逐字更正;我原本用「年 1-300」推薦手動處理)
  --    ⇒ 手動路徑一年會走幾十次,是新的風險來源而非補救。
  corrected_at      timestamptz,
  corrected_by      text,
  correction_reason text,

  refund_id         uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- 🔴 只有 DEFAULT 的話它是**會說謊的欄位**(永遠停在建立時間)⇒ 由 A7b-T 的 BEFORE UPDATE 統一設值。
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- ── 約束:身分與歸屬 ────────────────────────────────────
  -- 🔴 複合 FK(codex R2 #9):單靠一支 cancellation_id FK,**cancellation A 的 job 可以宣稱
  --    自己屬於 order B**,而兩道 child FK 仍然各自合法。欄序對齊被引用的
  --    order_cancellations_id_order_id_key UNIQUE (id, order_id)。
  CONSTRAINT orj_cancellation_fk
    FOREIGN KEY (cancellation_id, order_id)
    REFERENCES public.order_cancellations (id, order_id) ON DELETE RESTRICT,
  -- 🔴 五支 FK 全部明寫 ON DELETE RESTRICT(codex R6 F8):v6 有三支未指定 ⇒ 實作者可能寫成
  --    CASCADE(刪 staff 連 job 一起刪掉)或 SET NULL(清掉稽核人)。confdeltype 納入下方驗收。
  CONSTRAINT orj_actor_fk       FOREIGN KEY (actor)       REFERENCES public.staff (id) ON DELETE RESTRICT,
  CONSTRAINT orj_reviewed_by_fk FOREIGN KEY (reviewed_by) REFERENCES public.staff (id) ON DELETE RESTRICT,
  CONSTRAINT orj_corrected_by_fk FOREIGN KEY (corrected_by) REFERENCES public.staff (id) ON DELETE RESTRICT,
  CONSTRAINT orj_refund_fk      FOREIGN KEY (refund_id)   REFERENCES public.order_refunds (id) ON DELETE RESTRICT,

  -- 供 order_refund_job_items 的複合 FK 反向引用(強制明細與 job 同一張訂單)。
  -- ⚠️ 本約束自身沒有獨立負向探針(同 A7 `20260730130000:120-124` 的處理):
  --    它擋的是「同一個 id 掛到不同 order_id」,而 id 是 PK ⇒ 那個情境物理上構不出來。
  CONSTRAINT orj_id_order_id_key UNIQUE (id, order_id),

  -- ── 五道唯一性(v2 的「四道」是計數錯誤,codex R2 #12)──────────
  -- 🔴🔴 這五道只擋「**同時**」,擋不住「**先後**」—— 擋先後的是 A7b-T 的 INSERT 守門,不是索引。
  -- U1:同一取消的同一世代只有一列。**這一道同時是「一代最多一個後繼」命題的承重前提**
  --     (plan §3.3):後代 INSERT 守門要求最大世代列是「直接前代」⇒ 第 N 代的後繼只可能是
  --     第 N+1 代,而 U1 使該世代最多一列。⇒ **拿掉 U1 會產生第二次退款,拿掉守門裡那把
  --     FOR UPDATE 不會**(併發負測因此必須斷言 U1 的 23505,不是 trigger 的自訂碼)。
  CONSTRAINT orj_cancellation_generation_key UNIQUE (cancellation_id, generation),
  -- U4:TapPay 端的冪等鍵在**本地**的唯一索引。
  -- 🔴 措辭收斂(R5 nit 1):它是**本地端**唯一,**不是**「TapPay 端的冪等鍵」——
  --    TapPay 對同一 bank_refund_id 重送的實際行為 PCM **從未實測**(plan §8)。
  -- 🔴 它也**擋不住跨表重用**(新 job 拿一個已存在於 order_refunds.bank_refund_id 的值)
  --    ⇒ 那道由 A7b-T 的 INSERT 守門查 order_refunds 承接。
  CONSTRAINT orj_bank_refund_id_key UNIQUE (bank_refund_id),
  -- U2 / U3 / U5 是 partial unique ⇒ 只能用 CREATE UNIQUE INDEX,見下方。

  -- ── 約束:外部識別的形狀 ──────────────────────────────────
  -- 🔴 官方只寫 String(20)(tappay-reference.md §2.2)⇒ **不加字元集 allowlist**:
  --    v2 曾寫 `[A-Za-z0-9_-]`,**沒有 TapPay 官方依據**,可能拒絕合法的外部 ID
  --    = 一筆該退的錢永遠進不了系統(codex R2 #17)。
  -- 🔴 只擋「明確不可能合法」的,而且**逐碼位寫死**(codex R6 F5):
  --    v6 只寫「控制碼 / 前後空白」四個字 ⇒ 一個人會用 btrim、另一個人會用 locale-dependent 的
  --    [[:space:]],而 TAB / DEL / 全形空白在兩版得到不同結果,各自挑兩個測例仍可全綠。
  -- 🔴 **刻意不涵蓋**:U+2000-200A 等其他 Unicode 空白、U+00AD / U+2800 / U+3164 三個
  --    「渲染全白但不屬空白類」的碼位 —— 明文認列不擋(對外部 ID 過度嚴格 = 拒收合法交易)。
  CONSTRAINT orj_rec_trade_id_shape CHECK (
    char_length(rec_trade_id) BETWEEN 1 AND 20
    AND rec_trade_id !~ '[\x00-\x1F\x7F]'
    AND left(rec_trade_id, 1)  !~ '[ \t\r\n 　]'
    AND right(rec_trade_id, 1) !~ '[ \t\r\n 　]'
  ),
  CONSTRAINT orj_bank_refund_id_shape CHECK (
    char_length(bank_refund_id) BETWEEN 1 AND 20
    AND bank_refund_id !~ '[\x00-\x1F\x7F]'
    AND left(bank_refund_id, 1)  !~ '[ \t\r\n 　]'
    AND right(bank_refund_id, 1) !~ '[ \t\r\n 　]'
  ),
  -- 🔴 **逐碼位列舉,不用 `[0-9a-f]`**(codex R2 #17):POSIX 字元範圍**跟著 locale 走**,
  --    A7 已實測同一條 CHECK 在 C locale 與 UTF-8 locale 行為不同(backlog #305)
  --    ⇒ harness 綠、正式站未知。
  CONSTRAINT orj_payload_hash_shape
    CHECK (payload_hash ~ '^[0123456789abcdef]{64}$'),

  -- ── 約束:金額守恆(逐條對齊 order_refunds `20260725130100:88-122`)────
  CONSTRAINT orj_generation_range CHECK (generation BETWEEN 1 AND 20),
  CONSTRAINT orj_amount_balances
    CHECK (refund_amount = items_amount - shipping_delta),
  CONSTRAINT orj_shipping_delta_balances
    CHECK (shipping_delta = shipping_fee_after - shipping_fee_before),
  CONSTRAINT orj_shipping_fee_sane
    CHECK (shipping_fee_before <= 100000 AND shipping_fee_after <= 100000),
  -- 🔴 成對 CHECK(codex R1 M12):v1 寫成 `target IS NOT NULL ⇒ target = before + amount`,
  --    **before 為 NULL 時整式求值為 NULL、PostgreSQL CHECK 放行**。
  -- 🔴 `refunded_target > 0` **刻意不加**:被 before >= 0、amount > 0、等式三者**嚴格蘊含**,
  --    行為層無法單獨觸發 ⇒ 留著就是宣稱一條沒有獨立負測的守門。
  CONSTRAINT orj_baseline_paired CHECK (
    (refunded_before IS NULL AND refunded_target IS NULL)
    OR (refunded_before IS NOT NULL AND refunded_target IS NOT NULL
        AND refunded_before >= 0
        AND refunded_target = refunded_before + refund_amount)
  ),

  -- ── 約束:值域 allowlist ─────────────────────────────────
  CONSTRAINT orj_status_allowlist CHECK (status IN (
    'queued', 'processing', 'submitted', 'reconciling', 'completed', 'failed', 'dead'
  )),
  CONSTRAINT orj_resolution_allowlist CHECK (resolution IS NULL OR resolution IN (
    'retry_authorized', 'external_refund_confirmed', 'over_refund_writeoff'
  )),
  CONSTRAINT orj_dead_reason_allowlist CHECK (dead_reason IS NULL OR dead_reason IN (
    'retry_exhausted', 'over_refunded', 'reconcile_exhausted'
  )),
  CONSTRAINT orj_retry_count_range      CHECK (retry_count      BETWEEN 0 AND 6),
  CONSTRAINT orj_check_fail_count_range CHECK (check_fail_count BETWEEN 0 AND 6),

  -- ── 約束:review 三欄的鐵律(codex R1 M5)────────────────────
  -- 🔴 v1 允許單獨寫 reviewed_at(甚至夾在自轉移裡)⇒ U2/U3 的 `reviewed_at IS NULL` 當場失效
  --    ⇒ **放行第二個 active job** = 退第二次錢。
  CONSTRAINT orj_review_triple_paired CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL AND resolution IS NULL)
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND resolution IS NOT NULL)
  ),

  -- ── 約束:D11 更正結案(Sean 拍 Q2=B)────────────────────────
  CONSTRAINT orj_correction_triple_paired CHECK (
    (corrected_at IS NULL AND corrected_by IS NULL AND correction_reason IS NULL)
    OR (corrected_at IS NOT NULL AND corrected_by IS NOT NULL
        AND correction_reason IS NOT NULL AND btrim(correction_reason, E' \t\r\n 　​  ') <> '')
  ),
  -- 更正必須發生在結案之後。
  CONSTRAINT orj_correction_after_review CHECK (
    corrected_at IS NULL OR reviewed_at IS NOT NULL
  ),
  -- 🔴 「兩人簽核」的 DB 層強制。
  -- ⚠️ **誠實邊界**:它強制的是「**兩個不同的 staff.id**」,**不是「兩個不同的人」** ——
  --    同一人若同時擁有兩組帳號仍可繞過。真正的兩人簽核需要 E8-B 的身分驗證 + 流程控制,
  --    **本片做不到,也不得宣稱**(plan §8-9)。
  CONSTRAINT orj_correction_two_person CHECK (
    corrected_by IS NULL OR corrected_by IS DISTINCT FROM reviewed_by
  ),

  -- ── 約束:錢面四條(D7 + D9a/b/d)——**本檔最重要的一組** ────────
  -- 🔴 D7(Fable R3 F5):`retry_authorized` 鎖死在 `dead_reason = 'retry_exhausted'`。
  --    沒有它,一個**已被 TapPay 受理**的退款(over_refunded / reconcile_exhausted)
  --    可被結成「授權重試」⇒ 下一代帶**全新 bank_refund_id** ⇒ TapPay 冪等鍵不會擋
  --    ⇒ **全合法、零違規路徑退第二次錢**。
  -- 🔴🔴 **D7 是必要條件,不是安全證明**(codex R4 F5 更正 plan v4 的錯話):
  --    retry_exhausted 只證明「呼叫者選了 E5b」,**不證明 TapPay 真的拒絕過六次**。
  --    反例:TapPay 已受理但 worker 逾時、worker 誤寫 E5 ⇒ 戳記被清 ⇒ 最終合法拿到該死因。
  --    ⇒ 真正的收斂靠下面 D9b/D9d + 第 3 批 worker 的「逾時不得寫任何東西」紀律。
  -- 🔴 兩邊都用 IS (NOT) DISTINCT FROM:寫成 `dead_reason = 'retry_exhausted'` 在該欄為 NULL 時
  --    整式求值為 NULL ⇒ **CHECK 放行**(本 repo 已燒過的同一族)。
  CONSTRAINT orj_retry_auth_only_from_retry_exhausted CHECK (
    resolution IS DISTINCT FROM 'retry_authorized'
    OR dead_reason IS NOT DISTINCT FROM 'retry_exhausted'
  ),
  -- D9a:證據成對 + 僅在授權重試時存在。
  CONSTRAINT orj_retry_auth_evidence_paired CHECK (
    (retry_auth_recorded_refunded IS NULL) = (retry_auth_checked_at IS NULL)
  ),
  CONSTRAINT orj_retry_auth_evidence_required CHECK (
    (resolution IS NOT DISTINCT FROM 'retry_authorized') = (retry_auth_checked_at IS NOT NULL)
  ),
  -- 🔴 D9b 隔日閘(Fable R5 F2/F3/F5 三處全改):
  --    ① 錨 **last_refund_call_at**(最後一次呼叫),不是第一次 —— 錨第一次會讓
  --       「第 1 輪 day0 失敗、第 4 輪 day3 逾時受理」的情境當天就能結案重退。
  --    ② 日界明定 **Asia/Taipei** —— `date_trunc('day', ts)` 隨 session TimeZone 走,
  --       Supabase 預設 UTC ⇒ 「隔日」會在台北早上 8 點就開,同一個營業日內。
  --    ③ **fail-closed**,不留 `IS NULL` 逃生分支 —— 那個分支的前提(「NULL ⇒ 沒發過 HTTP」)
  --       正是威脅模型裡**不被信任**的 worker 紀律。fail-closed 之所以成立,靠 A7b-T 的 D12
  --       (E5/E5b 必須 OLD.refund_call_attempted_at IS NOT NULL ⇒ 沒呼叫過不得記「明確失敗」)。
  -- ⚠️ 誠實邊界:本閘建立在「TapPay 隔日後 Record **必定**反映」這個**未實測**的假設上,
  --    且「隔日」的精確定義官方無逐字說明 ⇒ 採 Asia/Taipei 日曆日界是**推斷**。
  --    ⇒ 第 3 批 **sandbox hard release gate**(plan §8-5)。
  CONSTRAINT orj_retry_auth_next_day_gate CHECK (
    resolution IS DISTINCT FROM 'retry_authorized'
    OR (last_refund_call_at IS NOT NULL
        AND retry_auth_checked_at IS NOT NULL
        AND (retry_auth_checked_at AT TIME ZONE 'Asia/Taipei')::date
          > (last_refund_call_at   AT TIME ZONE 'Asia/Taipei')::date)
  ),
  -- 🔴 D9d(Fable R5 F1 —— plan v5 曾宣稱「錢已入帳必定被擋下」,而**當時沒有任何 CHECK
  --    做這個比對**,真正的擋點是「人看到數字變大要自己起疑」= 人不是 DB):
  --    結案當下 Record 查到的累計退款額**必須等於本代 baseline** ⇒ 本代開始到結案之間錢動過就擋。
  -- 🔴 定義域完整性(已複驗):D7 要求 retry_authorized ⇒ retry_exhausted;retry_exhausted 只能由
  --    E5b 寫入;E5b 與 E5 都要求 OLD.refund_call_attempted_at IS NOT NULL(D12);
  --    而 attempted_at 只能由 E2b 寫入、E2b 要求 baseline 已非 NULL
  --    ⇒ **任何 retry_exhausted 的列,refunded_before 必然非 NULL**。
  CONSTRAINT orj_retry_auth_recorded_matches_baseline CHECK (
    resolution IS DISTINCT FROM 'retry_authorized'
    OR retry_auth_recorded_refunded IS NOT DISTINCT FROM refunded_before
  ),

  -- ── 約束:逐狀態 truth table(七條 per-status,見檔頭「刻意偏離」)────
  -- R = 必須非 NULL / N = 必須 NULL / − = 不限制。七條合起來窮盡(status 有七值 allowlist)。
  CONSTRAINT orj_shape_queued CHECK (status <> 'queued' OR (
    claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
    AND refund_call_attempted_at IS NULL
    AND next_check_at IS NULL AND failed_reason IS NULL
    AND retry_count BETWEEN 0 AND 5 AND check_fail_count = 0
    AND reviewed_at IS NULL AND dead_reason IS NULL
    AND manual_review_required = false
    AND tappay_refund_id IS NULL AND refund_id IS NULL
  )),
  CONSTRAINT orj_shape_processing CHECK (status <> 'processing' OR (
    claim_token IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
    AND next_retry_at IS NULL AND next_check_at IS NULL AND failed_reason IS NULL
    AND retry_count BETWEEN 0 AND 5 AND check_fail_count = 0
    AND reviewed_at IS NULL AND dead_reason IS NULL
    AND manual_review_required = false
    -- 🔴 tappay_refund_id 在 processing 必須 NULL(Fable R5 F8;v5 曾放寬成「不限制」,理由是錯的)。
    --    放寬的理由是「與『只有 E4 能首寫』重複」—— 但在 break-glass(trigger 被 DISABLE)期間,
    --    D10 死了、**這條 CASE CHECK 是唯一還活著的那一層**。
    AND tappay_refund_id IS NULL AND refund_id IS NULL
  )),
  CONSTRAINT orj_shape_submitted CHECK (status <> 'submitted' OR (
    claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
    AND refund_call_attempted_at IS NOT NULL
    AND next_retry_at IS NULL AND next_check_at IS NOT NULL AND failed_reason IS NULL
    AND retry_count BETWEEN 0 AND 5 AND check_fail_count BETWEEN 0 AND 5
    AND reviewed_at IS NULL AND dead_reason IS NULL
    AND manual_review_required = false
    AND refund_id IS NULL
  )),
  CONSTRAINT orj_shape_reconciling CHECK (status <> 'reconciling' OR (
    claim_token IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
    AND refund_call_attempted_at IS NOT NULL
    AND next_retry_at IS NULL AND next_check_at IS NOT NULL AND failed_reason IS NULL
    AND retry_count BETWEEN 0 AND 5 AND check_fail_count BETWEEN 0 AND 5
    AND reviewed_at IS NULL AND dead_reason IS NULL
    AND manual_review_required = false
    AND refund_id IS NULL
  )),
  CONSTRAINT orj_shape_completed CHECK (status <> 'completed' OR (
    claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
    AND refund_call_attempted_at IS NOT NULL
    AND next_retry_at IS NULL AND next_check_at IS NULL AND failed_reason IS NULL
    AND retry_count BETWEEN 0 AND 5 AND check_fail_count BETWEEN 0 AND 5
    AND reviewed_at IS NULL AND dead_reason IS NULL
    AND manual_review_required = false
    AND refund_id IS NOT NULL
  )),
  CONSTRAINT orj_shape_failed CHECK (status <> 'failed' OR (
    claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
    -- 🔴 E5 清掉戳記(結果已知)⇒ failed 必須是 NULL。沒有這條,重試迴圈靜態不可能(Fable R3 F1/F2)。
    AND refund_call_attempted_at IS NULL
    AND next_retry_at IS NOT NULL AND next_check_at IS NULL
    AND failed_reason IS NOT NULL AND btrim(failed_reason, E' \t\r\n 　​  ') <> ''
    -- 🔴 下界是 1:retry_count = 0 的 failed 代表「沒失敗過卻是失敗態」。
    AND retry_count BETWEEN 1 AND 5 AND check_fail_count = 0
    AND reviewed_at IS NULL AND dead_reason IS NULL
    AND manual_review_required = false
    AND tappay_refund_id IS NULL AND refund_id IS NULL
  )),
  CONSTRAINT orj_shape_dead CHECK (status <> 'dead' OR (
    claim_token IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
    AND next_retry_at IS NULL AND next_check_at IS NULL
    -- 🔴 dead 一律有結構化死因 ⇒ 第 3 批 dead-review 畫面永遠有東西可顯示(D5)。
    AND dead_reason IS NOT NULL
    AND manual_review_required = true
    AND refund_id IS NULL
  )),

  -- ── 🔴🔴 dormant gate(D4;A7b-T 在同交易的最後一步 DROP 它)────
  -- 🔴 **施工時本機實跑發現、plan v7 §1.1 的字面已更正**:plan 寫 `CHECK (false) NOT VALID`,
  --    但 `NOT VALID` 在 `CREATE TABLE` 的 table constraint 上**不生效**(PostgreSQL 只在
  --    `ALTER TABLE ... ADD CONSTRAINT` 認它)⇒ 建出來的約束 `convalidated = true`,
  --    我原本那條「必須是 NOT VALID」的斷言當場轉紅(這正是它該做的事)。
  -- 🔴 **修法選擇 = 拿掉 NOT VALID,不是改成 ALTER TABLE**:本表與約束**同生**、
  --    因此恆為空表 ⇒ `NOT VALID` 唯一的作用(略過既有列的全表掃描)在這裡**沒有任何行為差異**。
  --    留著它等於宣稱一個不存在的效果(= 本片六輪審查一直在抓的那個病)。
  -- 效果不變:`CHECK (false)` 讓**任何 INSERT 一律被擋**。
  -- 驗收必須測**兩個方向**:M 之後合法 INSERT 必拒、T 之後同一筆必過 ——
  -- 否則等於沒證明 gate 被移除過。
  CONSTRAINT order_refund_jobs_dormant_until_triggers CHECK (false)
);

-- ── U2 / U3 / U5:三道 partial unique(只能用 index,不能用 table constraint)──
-- 🔴 U2/U3 用 `reviewed_at IS NULL` 而非「排除 dead」(codex R1 M16):未複核的 dead 若不再擋,
--    人還沒看,系統就自己再退一次。
-- 🔴 `rec_trade_id NOT NULL` 是 U3 成立的**前提**:partial unique **對 NULL 不生效**
--    ⇒ 多筆 NULL 可並存 ⇒ U3 形同虛設。沒有 rec_trade_id 的單本來就進不了卡片退款線。
CREATE UNIQUE INDEX orj_one_current_per_cancellation_idx
  ON public.order_refund_jobs (cancellation_id)
  WHERE status <> 'completed' AND reviewed_at IS NULL;

CREATE UNIQUE INDEX orj_one_current_per_rec_trade_idx
  ON public.order_refund_jobs (rec_trade_id)
  WHERE status <> 'completed' AND reviewed_at IS NULL;

-- U5(codex R1 M10):兩個 job 共用同一張帳本。
-- 🔴 它**只**防這一件事 —— 完全不證明 job 與 ledger 的欄位相等(那是 A7b-T §5.6(b) 的責任)。
CREATE UNIQUE INDEX orj_one_job_per_refund_idx
  ON public.order_refund_jobs (refund_id)
  WHERE refund_id IS NOT NULL;

-- ── 排程掃描用的 partial index(plan §11;逐條具名、EXPLAIN 驗收在 A7b-T)──
CREATE INDEX orj_due_queued_idx    ON public.order_refund_jobs (next_retry_at) WHERE status = 'queued';
CREATE INDEX orj_due_failed_idx    ON public.order_refund_jobs (next_retry_at) WHERE status = 'failed';
CREATE INDEX orj_due_submitted_idx ON public.order_refund_jobs (next_check_at) WHERE status = 'submitted';
-- lease 回收 + 🔴 R15 的「卡住告警」第 ② 段:只掃 dead 的話,**錢卡住的那天沒有人被叫醒**。
CREATE INDEX orj_stale_lease_idx   ON public.order_refund_jobs (claim_expires_at)
  WHERE status IN ('processing', 'reconciling');
CREATE INDEX orj_unreviewed_dead_idx ON public.order_refund_jobs (created_at)
  WHERE status = 'dead' AND reviewed_at IS NULL;

-- ══ 2. order_refund_job_items:帳本快照的明細側(Q4=B)══════════════════════════
-- 形狀逐欄對齊 order_refund_items(`20260725130100:143-172`),讓隔日寫帳本是「搬」不是「算」。
-- 🔴 為什麼不採 C 案(隔日重算):重算的依據(運費規則、品項金額)隔日可能已變,
--    等於讓「退多少錢」在兩個時間點各算一次。
CREATE TABLE public.order_refund_job_items (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid    NOT NULL,
  -- 冗餘欄,存在的唯一理由 = 讓下方兩道複合 FK 夾住「明細品項 ∈ 本 job 的訂單」。
  order_id      uuid    NOT NULL,
  order_item_id uuid    NOT NULL,

  quantity      integer NOT NULL CHECK (quantity > 0),
  unit_price    integer NOT NULL CHECK (unit_price >= 0),
  line_amount   integer NOT NULL CHECK (line_amount > 0),

  CONSTRAINT orji_line_balances CHECK (line_amount = unit_price * quantity),

  -- 🔴 兩道複合 FK 合力封死跨單串接:job_id 決定 order_id(來自 header)、
  --    order_id 又必須與 order_item_id 同屬一單 ⇒ job A 無法掛 order B 的品項。
  --    單靠兩個獨立 FK 做不到(兩個 FK 各自都合法)。
  CONSTRAINT orji_job_fk
    FOREIGN KEY (job_id, order_id)
    REFERENCES public.order_refund_jobs (id, order_id) ON DELETE RESTRICT,
  CONSTRAINT orji_item_fk
    FOREIGN KEY (order_id, order_item_id)
    REFERENCES public.order_items (order_id, id) ON DELETE RESTRICT,

  -- 同一個 job 不得重複列同一品項。
  CONSTRAINT orji_job_item_key UNIQUE (job_id, order_item_id)
);

-- 跨 job 聚合「單一品項還剩多少可退」。
CREATE INDEX orji_order_item_idx ON public.order_refund_job_items (order_item_id);

-- ══ 3. ACL(service_role only + RLS zero-policy)═══════════════════════════════
-- 樣板 = order_cancellations(`20260730130000:262-267`)/ order_refunds(`20260725130100:313`)。
-- 🔴 **無 DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN** —— 且那**不是**唯一防線:
--    表級 ACL 擋不住 **owner 與 SECURITY DEFINER RPC**,歷史一被清,五道唯一索引就不再擋重退
--    ⇒ 永久阻擋由 A7b-T 的 BEFORE DELETE / BEFORE TRUNCATE 承接(驗收必須證明 **owner 也失敗**)。
ALTER TABLE public.order_refund_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_refund_job_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_refund_jobs      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.order_refund_job_items FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.order_refund_jobs      TO service_role;
-- 子表**沒有 UPDATE** —— 「凍結快照」的第一層(第二層是 A7b-T 的 BEFORE UPDATE 阻擋)。
GRANT SELECT, INSERT         ON TABLE public.order_refund_job_items TO service_role;

-- ══ 4. COMMENT 合約(把「這道防護擋不住什麼」寫在物件上,不只寫在 plan)═════════
COMMENT ON TABLE public.order_refund_jobs IS
  'M-4b A7b 卡片退款工作表(一次要退的錢 = 一列)。TapPay 退款隔日生效 ⇒ 送出與確認之間需可持久化、可重入、可對帳的中間狀態。狀態機七態、16 條 edge 的守門全在 A7b-T,本片只有 schema。🔴 本表在 A7b-T 之前由 order_refund_jobs_dormant_until_triggers(CHECK false)完全擋住寫入。🔴 **寫入路徑的事實**:service_role **可以直接 INSERT / UPDATE 本表**(見本檔 GRANT 段)—— 直寫並非不可達。真正的守門是 A7b-T 的十支 trigger(狀態機 + 不可變欄 + exact-one edge classifier);**worker 的 token CAS 與稽核紀律是合約要求、不是表級權限強制**。⇒ 讀到這句的人不得假設「不走 RPC 就寫不進來」。(關卡2 抓:原字面寫「寫入只走 owner RPC」與 GRANT 直接矛盾。)';
COMMENT ON TABLE public.order_refund_job_items IS
  'M-4b A7b 退款工作表的帳本快照明細(Q4=B)。形狀逐欄對齊 order_refund_items,讓隔日寫帳本是「搬」不是「算」。🔴 至少一列 / Σ line_amount = jobs.items_amount / quantity ≤ 原品項 / unit_price = 訂單快照 —— 四條不變式全在 A7b-T 的 DEFERRED CONSTRAINT TRIGGER,本片的 CHECK 只驗列內自洽。🔴 永久禁止 UPDATE / DELETE / TRUNCATE(ACL 是第一層、trigger 是第二層)。';

COMMENT ON COLUMN public.order_refund_jobs.refund_call_attempted_at IS
  '語意 = 「有一次 TapPay Refund 呼叫已發出、且結果未知」,不是「已成功」。worker 必須先 commit 本欄再發 HTTP;🔴 逾時/無回應時不得寫任何東西(讓 lease 過期走 E3b)—— 這條 trigger 驗不到,是第 3 批 worker 的 DoD 硬前置,也是 D7 失效的唯一入口。';
COMMENT ON COLUMN public.order_refund_jobs.last_refund_call_at IS
  '每次 E2b 更新、永不可清、單調不減。D9b 隔日閘錨它 —— 錨「第一次呼叫」會讓「第 4 輪逾時受理」的情境當天就能結案重退,閘門形同虛設(Fable R5 F2)。';
COMMENT ON COLUMN public.order_refund_jobs.retry_auth_recorded_refunded IS
  '結案當下以 TapPay Record API 查到的累計退款額。⚠️ **DB 無法驗證這個值是真的** —— 它是稽核要求,不是防護。orj_retry_auth_recorded_matches_baseline(同列比對 refunded_before)與 A7b-T 在下一代 E2 的 D9c,擋的是「**在兩個取樣點之間**已反映到 Record 的變動」。🔴 **擋不住的(關卡2 抓,已列入 plan §8)**:gen2 的 E2 取樣通過之後、到 E2b 戳記與 HTTP 送出之間,仍有一段 **TOCTOU 窗** —— 有人在 TapPay portal 手動退款,四道 D7/D9 全綠而仍可能雙退。真正關閉它需要「禁止 portal 並發」或外部原子 CAS 協定,兩者都不在本片、也不在第 3 批的現行規劃。';
COMMENT ON COLUMN public.order_refund_jobs.corrected_by IS
  '更正結案的第二個人(Sean 07-31 拍 Q2=B)。⚠️ orj_correction_two_person 強制的是「兩個不同的 staff.id」,不是「兩個不同的人」—— 同一人擁有兩組帳號仍可繞過。真正的兩人簽核需要 E8-B 的身分驗證,本片做不到、也不宣稱。';
COMMENT ON CONSTRAINT orj_retry_auth_only_from_retry_exhausted ON public.order_refund_jobs IS
  'D7:只有 dead_reason = ''retry_exhausted'' 的死信才准被結成 retry_authorized。🔴 **這條 CHECK 能保證的就只有這件事** —— 它是**必要條件,不是安全證明**。「六次都收到 TapPay 明確失敗回應」是**呼叫者(第 3 批 worker)的責任**,DB 完全證明不了:worker 在逾時情境下誤寫 E5 就會讓一筆「錢可能已經出去」的 job 合法拿到 retry_exhausted(codex 關卡1 R4 F5)。⇒ 讀到這個 constraint 名的人**不得推論「外部確實失敗過六次」**。';
COMMENT ON CONSTRAINT orj_retry_auth_next_day_gate ON public.order_refund_jobs IS
  'D9b:授權重試不得早於「最後一次呼叫的隔天(Asia/Taipei 日曆日界)」。⚠️ 建立在「TapPay 隔日後 Record 必定反映」這個**未實測**假設上,且「隔日」官方無逐字定義 ⇒ 第 3 批 sandbox hard release gate。';
COMMENT ON CONSTRAINT order_refund_jobs_dormant_until_triggers ON public.order_refund_jobs IS
  '🔴 A7b-M 與 A7b-T 各自 COMMIT ⇒ T 失敗時 M 會單獨留在正式站,而狀態機守門全在 T。本 gate 讓那個中間態變成「表存在但寫不進去」,而不是「可以被亂寫」。A7b-T 在所有守門安裝並通過結構驗收之後、同交易最後一步 DROP 它。';

-- ══ 5. 結構驗收(fail-closed;任一條不成立 = 整片回滾)═══════════════════════════
-- 🔴 **本段沒有任何條件略過分支**(A7-1 的教訓:探針前提不足時 NOTICE + exit 0 = fail-open 假綠)。
--    它只驗「結構、定義字面、ACL、欄位清單」,這些在任何環境都成立。
DO $$
DECLARE
  v_cnt  integer;
  v_def  text;
  v_tbl  text;
  v_col  text;
  v_role text;
  v_priv text;
BEGIN
  -- ── 5.1 兩表存在、各恰一支 PK ────────────────────────────
  FOREACH v_tbl IN ARRAY ARRAY['order_refund_jobs', 'order_refund_job_items'] LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — 表 % 不存在', v_tbl;
    END IF;
    SELECT count(*) INTO v_cnt FROM pg_constraint
     WHERE conrelid = ('public.' || v_tbl)::regclass AND contype = 'p';
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — 表 % 的 PK 應為 1 支,實 % 支', v_tbl, v_cnt;
    END IF;
  END LOOP;

  -- ── 5.2 欄位 manifest(codex R6 F2/F3:deny-by-default)────
  -- 🔴 這一條同時關閉兩件事:①欄位型別/NULL 不得漂移 ②**多一欄少一欄都轉紅**
  --    —— 沒有後者,未來新增欄會預設可寫、而 A7b-T 的 allowed-delta 白名單不會知道它存在。
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_refund_jobs'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 42 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_jobs 應有 42 欄,實 % 欄(新增/刪除欄必須同步更新 A7b-T 的 allowed-delta 白名單)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_refund_job_items'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_job_items 應有 7 欄,實 % 欄', v_cnt;
  END IF;

  -- NOT NULL 清單:jobs 只有下列 21 欄是 NOT NULL,其餘 21 欄一律 nullable。
  -- 🔴 兩個方向都要驗(下面第二個迴圈):只驗「不該 NOT NULL 的沒有 NOT NULL」的話,
  --    把該 NOT NULL 的欄改成 nullable 仍然全綠。
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_refund_jobs'::regclass AND attnum > 0 AND NOT attisdropped
     AND attnotnull
     AND attname NOT IN ('id','cancellation_id','order_id','generation','rec_trade_id',
                         'bank_refund_id','payload_hash','refund_amount','items_amount',
                         'shipping_fee_before','shipping_fee_after','shipping_delta',
                         'reason','actor','request_id','status','retry_count',
                         'check_fail_count','manual_review_required','created_at','updated_at');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_jobs 有 % 個非預期的 NOT NULL 欄', v_cnt;
  END IF;
  -- 反向:上列每一欄都必須真的是 NOT NULL(少一個方向就只擋得住一半)。
  FOREACH v_col IN ARRAY ARRAY['id','cancellation_id','order_id','generation','rec_trade_id',
                               'bank_refund_id','payload_hash','refund_amount','items_amount',
                               'shipping_fee_before','shipping_fee_after','shipping_delta',
                               'reason','actor','request_id','status','retry_count',
                               'check_fail_count','manual_review_required','created_at','updated_at'] LOOP
    IF NOT (SELECT attnotnull FROM pg_attribute
             WHERE attrelid = 'public.order_refund_jobs'::regclass AND attname = v_col) THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_jobs.% 應為 NOT NULL', v_col;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_refund_job_items'::regclass
     AND attnum > 0 AND NOT attisdropped AND NOT attnotnull;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_job_items 有 % 個 nullable 欄(應全部 NOT NULL)', v_cnt;
  END IF;

  -- 型別:三個「型別本身就是第一道守門」的欄(A7-1 關卡2 的教訓:改成 varchar 會多出一個長度真相)
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.order_refund_jobs'::regclass AND attname = 'payload_hash') <> 'text' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — payload_hash 型別不是 text(varchar 會與 CHECK 的 {64} 形成兩個真相)';
  END IF;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.order_refund_jobs'::regclass AND attname = 'claim_token') <> 'uuid' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — claim_token 型別不是 uuid';
  END IF;
  FOREACH v_col IN ARRAY ARRAY['claimed_at','claim_expires_at','refund_call_attempted_at',
                               'last_refund_call_at','next_retry_at','next_check_at',
                               'reviewed_at','retry_auth_checked_at','corrected_at',
                               'created_at','updated_at'] LOOP
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
         WHERE attrelid = 'public.order_refund_jobs'::regclass AND attname = v_col)
       <> 'timestamp with time zone' THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — %.型別不是 timestamptz(timestamp 會讓 Asia/Taipei 日界計算失去意義)', v_col;
    END IF;
  END LOOP;

  -- ── 5.3 DEFAULT 的算式字面 ──────────────────────────────
  FOREACH v_tbl IN ARRAY ARRAY['order_refund_jobs', 'order_refund_job_items'] LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = ('public.' || v_tbl)::regclass AND a.attname = 'id';
    IF v_def IS DISTINCT FROM 'gen_random_uuid()' THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — %.id 的 default 不是 gen_random_uuid(),實 [%]', v_tbl, COALESCE(v_def, '(無)');
    END IF;
  END LOOP;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.order_refund_jobs'::regclass AND a.attname = 'status';
  IF v_def IS DISTINCT FROM '''queued''::text' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — status 的 default 不是 ''queued'',實 [%]', COALESCE(v_def, '(無)');
  END IF;
  FOREACH v_col IN ARRAY ARRAY['created_at', 'updated_at'] LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = 'public.order_refund_jobs'::regclass AND a.attname = v_col;
    IF v_def IS DISTINCT FROM 'now()' THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — %.default 不是 now(),實 [%]', v_col, COALESCE(v_def, '(無)');
    END IF;
  END LOOP;

  -- ── 5.4 FK:七支、且 confdeltype 全為 RESTRICT(codex R6 F8)──
  -- 🔴 只驗「FK 存在」不夠 —— CASCADE 會讓刪 staff 連 job 一起消失、SET NULL 會清掉稽核人,
  --    兩者都不會被任何「存在性」斷言抓到。
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_refund_jobs'::regclass AND contype = 'f';
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_jobs 的 FK 應為 5 支,實 % 支', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_refund_job_items'::regclass AND contype = 'f';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_job_items 的 FK 應為 2 支,實 % 支', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid IN ('public.order_refund_jobs'::regclass, 'public.order_refund_job_items'::regclass)
     AND contype = 'f' AND confdeltype <> 'r';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — 有 % 支 FK 不是 ON DELETE RESTRICT', v_cnt;
  END IF;
  -- 複合 FK 的欄序必須對齊被引用唯一約束,寫錯欄序會建得起來但夾不住跨單。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_refund_jobs'::regclass AND conname = 'orj_cancellation_fk';
  IF v_def IS DISTINCT FROM 'FOREIGN KEY (cancellation_id, order_id) REFERENCES order_cancellations(id, order_id) ON DELETE RESTRICT' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — orj_cancellation_fk 定義不符,實 [%]', COALESCE(v_def, '(無)');
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_refund_job_items'::regclass AND conname = 'orji_item_fk';
  IF v_def IS DISTINCT FROM 'FOREIGN KEY (order_id, order_item_id) REFERENCES order_items(order_id, id) ON DELETE RESTRICT' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — orji_item_fk 定義不符,實 [%]', COALESCE(v_def, '(無)');
  END IF;

  -- ── 5.5 五道唯一性(U1/U4 是 constraint、U2/U3/U5 是 partial index)──
  FOREACH v_col IN ARRAY ARRAY['orj_cancellation_generation_key', 'orj_bank_refund_id_key',
                               'orj_id_order_id_key'] LOOP
    SELECT count(*) INTO v_cnt FROM pg_constraint
     WHERE conrelid = 'public.order_refund_jobs'::regclass AND conname = v_col
       AND contype = 'u' AND convalidated;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — 唯一約束 % 不存在或未驗證', v_col;
    END IF;
  END LOOP;
  -- 🔴 partial unique 的 **WHERE 子句逐字比對**:少了 `reviewed_at IS NULL` 那半,
  --    未複核的 dead 就不再擋新 job = 退第二次錢,而索引「存在」仍為真。
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'orj_one_current_per_cancellation_idx';
  IF v_def IS DISTINCT FROM 'CREATE UNIQUE INDEX orj_one_current_per_cancellation_idx ON public.order_refund_jobs USING btree (cancellation_id) WHERE ((status <> ''completed''::text) AND (reviewed_at IS NULL))' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — U2 定義不符,實 [%]', COALESCE(v_def, '(無)');
  END IF;
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'orj_one_current_per_rec_trade_idx';
  IF v_def IS DISTINCT FROM 'CREATE UNIQUE INDEX orj_one_current_per_rec_trade_idx ON public.order_refund_jobs USING btree (rec_trade_id) WHERE ((status <> ''completed''::text) AND (reviewed_at IS NULL))' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — U3 定義不符,實 [%]', COALESCE(v_def, '(無)');
  END IF;
  SELECT indexdef INTO v_def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'orj_one_job_per_refund_idx';
  IF v_def IS DISTINCT FROM 'CREATE UNIQUE INDEX orj_one_job_per_refund_idx ON public.order_refund_jobs USING btree (refund_id) WHERE (refund_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — U5 定義不符,實 [%]', COALESCE(v_def, '(無)');
  END IF;

  -- ── 5.6 錢面四條 + 七條 truth table 必須逐條存在(具名清單,不數總數)──
  FOREACH v_col IN ARRAY ARRAY[
    'orj_retry_auth_only_from_retry_exhausted', 'orj_retry_auth_evidence_paired',
    'orj_retry_auth_evidence_required', 'orj_retry_auth_next_day_gate',
    'orj_retry_auth_recorded_matches_baseline',
    'orj_shape_queued', 'orj_shape_processing', 'orj_shape_submitted', 'orj_shape_reconciling',
    'orj_shape_completed', 'orj_shape_failed', 'orj_shape_dead',
    'orj_review_triple_paired', 'orj_correction_triple_paired', 'orj_correction_after_review',
    'orj_correction_two_person', 'orj_baseline_paired', 'orj_amount_balances',
    'orj_shipping_delta_balances', 'orj_shipping_fee_sane', 'orj_status_allowlist',
    'orj_resolution_allowlist', 'orj_dead_reason_allowlist', 'orj_generation_range',
    'orj_retry_count_range', 'orj_check_fail_count_range',
    'orj_rec_trade_id_shape', 'orj_bank_refund_id_shape', 'orj_payload_hash_shape',
    'order_refund_jobs_dormant_until_triggers'] LOOP
    SELECT count(*) INTO v_cnt FROM pg_constraint
     WHERE conrelid = 'public.order_refund_jobs'::regclass AND conname = v_col AND contype = 'c';
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — CHECK 約束 % 不存在', v_col;
    END IF;
  END LOOP;

  -- 🔴 D9b 的日界必須是 Asia/Taipei 的**字面**(Fable R5 F3):
  --    寫成 date_trunc('day', ts) 會隨 session TimeZone 走 ⇒ harness 綠、正式站在台北早上 8 點就開門。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_refund_jobs'::regclass AND conname = 'orj_retry_auth_next_day_gate';
  IF position('Asia/Taipei' in v_def) = 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — D9b 隔日閘沒有 Asia/Taipei 日界(隨 session TimeZone 走 = 正式站行為未知)';
  END IF;
  IF position('last_refund_call_at' in v_def) = 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — D9b 隔日閘沒有錨 last_refund_call_at(錨第一次呼叫 = 閘門形同虛設)';
  END IF;

  -- ── 5.7 dormant gate 必須存在,且它的定義字面真的是「恆假」──────
  -- 🔴 只驗「約束存在」不夠:改成 `CHECK (true)` 仍然存在,而 gate 當場失效、沒有任何東西會轉紅。
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_refund_jobs'::regclass
     AND conname = 'order_refund_jobs_dormant_until_triggers' AND contype = 'c';
  IF v_def IS DISTINCT FROM 'CHECK (false)' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — dormant gate 定義不是 CHECK (false),實 [%](A7b-T 失敗時這張表會變成可以被亂寫)',
      COALESCE(v_def, '(不存在)');
  END IF;

  -- ── 5.8 本片是 M 型:零 trigger、零新函式 ───────────────────
  SELECT count(*) INTO v_cnt FROM pg_trigger
   WHERE tgrelid IN ('public.order_refund_jobs'::regclass, 'public.order_refund_job_items'::regclass)
     AND NOT tgisinternal;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — 本片是 M 型,不得有 user trigger,實 % 支(那些是 A7b-T)', v_cnt;
  END IF;

  -- ── 5.9 ACL 八格 × 四角色(PG17;🔴 PUBLIC 必須排在角色矩陣之前)──
  -- 🔴 順序是正確性的一部分:GRANT … TO PUBLIC 會讓 anon/authenticated 因**繼承**轉紅
  --    ⇒ PUBLIC 那條斷言若排在後面,把它整條刪掉仍然全綠(本 repo 已實測)。
  -- 🔴 PG17 有第八種表權限 MAINTAIN:授出去之後 has_table_privilege(…,'SELECT') **仍為 false**
  --    ⇒ 七格矩陣對它完全無感。正式站同為 PG17。
  FOREACH v_tbl IN ARRAY ARRAY['order_refund_jobs', 'order_refund_job_items'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                                  'REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege('public', 'public.' || v_tbl, v_priv) THEN
        RAISE EXCEPTION 'A7b-M 驗收失敗 — PUBLIC 竟持有 %.% 權限', v_tbl, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_tbl IN ARRAY ARRAY['order_refund_jobs', 'order_refund_job_items'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                                    'REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(v_role, 'public.' || v_tbl, v_priv) THEN
          RAISE EXCEPTION 'A7b-M 驗收失敗 — % 竟持有 %.% 權限', v_role, v_tbl, v_priv;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  -- service_role:jobs = SELECT/INSERT/UPDATE;items = SELECT/INSERT。其餘一律無。
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.order_refund_jobs', v_priv) THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — service_role 缺 order_refund_jobs.% 權限', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    IF has_table_privilege('service_role', 'public.order_refund_jobs', v_priv) THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — service_role 竟持有 order_refund_jobs.% 權限', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT'] LOOP
    IF NOT has_table_privilege('service_role', 'public.order_refund_job_items', v_priv) THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — service_role 缺 order_refund_job_items.% 權限', v_priv;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    IF has_table_privilege('service_role', 'public.order_refund_job_items', v_priv) THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — service_role 竟持有 order_refund_job_items.%(子表凍結)', v_priv;
    END IF;
  END LOOP;

  -- ── 5.10 RLS 已啟用且 zero-policy ─────────────────────────
  FOREACH v_tbl IN ARRAY ARRAY['order_refund_jobs', 'order_refund_job_items'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_tbl)::regclass) THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — 表 % 未啟用 RLS', v_tbl;
    END IF;
    SELECT count(*) INTO v_cnt FROM pg_policy WHERE polrelid = ('public.' || v_tbl)::regclass;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A7b-M 驗收失敗 — 表 % 應為 zero-policy,實 % 條', v_tbl, v_cnt;
    END IF;
  END LOOP;

  -- ── 5.11 🔴🔴 三組指紋(關卡2 must-fix:name-only / count-only 斷言全是假綠)──
  -- codex 關卡2 實證的假綠路徑:
  --   · 「42 欄」只數總數 ⇒ `refund_amount` 改 bigint、`retry_count` DEFAULT 改 1,全綠
  --   · CHECK 只驗「同名存在」⇒ D9d 改成 `CHECK(true)`、D9b 改成保留關鍵字的 `true OR …`,全綠
  --   · U1 只驗名稱與 validated ⇒ 改成 `(order_id, generation)`,第二次退款防線消失而全綠
  --   · 七支 FK 只驗數量與 RESTRICT ⇒ `orji_job_fk` 改指別表、`reviewed_by` 重綁 actor,全綠
  --   · 子表列內 CHECK / unique、六個索引**完全沒有斷言** ⇒ 刪掉也全綠
  -- ⇒ 改用 repo 既有的**指紋**手法(同 A7-t 的 `md5(prosrc)`):任何一格漂移都轉紅。
  -- ⚠️ **指紋的代價(誠實揭示)**:它說得出「有東西變了」,**說不出「哪一格變了」**
  --    ⇒ 故下方仍保留 5.6 的具名清單與錢面四條的逐字比對當作可診斷的第一層。
  --    合法修改本片時**必須同步更新這三個常數**,那是刻意的摩擦(強迫改動帶意圖)。

  -- (a) 欄位:name / 型別 / NOT NULL / DEFAULT 四者任一漂移即轉紅(雙向,不數總數)
  SELECT md5(string_agg(
           a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' ||
           a.attnotnull::text || '|' ||
           COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), E'\n' ORDER BY a.attname))
    INTO v_def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.order_refund_jobs'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_def IS DISTINCT FROM '97813fcf78ed225dc0d061d57e34363f' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_jobs 欄位指紋不符,實 [%]', v_def;
  END IF;

  SELECT md5(string_agg(
           a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' ||
           a.attnotnull::text || '|' ||
           COALESCE(pg_get_expr(d.adbin, d.adrelid), '-'), E'\n' ORDER BY a.attname))
    INTO v_def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.order_refund_job_items'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_def IS DISTINCT FROM 'db6bff4eb3086c2a8c19351db26ef15e' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — order_refund_job_items 欄位指紋不符,實 [%]', v_def;
  END IF;

  -- (b) 兩表的**全部**約束(CHECK / UNIQUE / PK / FK)定義逐字入指紋
  --     ⇒ 涵蓋 U1/U4 的欄組、七支 FK 的來源欄與目標欄、子表列內 CHECK 與 unique、
  --       以及錢面四條被改成恆真的情形。
  SELECT md5(string_agg(c.conrelid::regclass::text || '.' || c.conname || ' :: ' ||
                        pg_get_constraintdef(c.oid) || ' :: ' || c.convalidated::text,
                        E'\n' ORDER BY c.conrelid::regclass::text, c.conname))
    INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid IN ('public.order_refund_jobs'::regclass,
                        'public.order_refund_job_items'::regclass);
  IF v_def IS DISTINCT FROM 'b64d85ef4c4283b715de6e91d84adfeb' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — 兩表約束指紋不符(有約束被新增/刪除/改寫),實 [%]', v_def;
  END IF;

  -- (c) 兩表的**全部**索引定義(涵蓋三道 partial unique 的 WHERE、六個排程索引)
  SELECT md5(string_agg(indexname || ' :: ' || indexdef, E'\n' ORDER BY indexname))
    INTO v_def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename IN ('order_refund_jobs', 'order_refund_job_items');
  IF v_def IS DISTINCT FROM '52645568f413c4cd9a650a6b770d2b6d' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — 兩表索引指紋不符,實 [%]', v_def;
  END IF;

  -- ── 5.12 完整 ACL(關卡2 must-fix:八格 × 四角色只涵蓋「這四個角色的有效權限」)──
  -- 🔴 它抓不到:授給**第四個角色之外的任意 grantee**、**欄級 ACL**、**WITH GRANT OPTION**。
  --    例:對子表授 service_role 欄級 UPDATE,或授權另一個 BYPASSRLS 角色,八格矩陣仍全綠。
  -- ⇒ 改用 aclexplode 比對**完整的 grantee × privilege × grant-option 集合**。
  SELECT COALESCE(string_agg(x.g || '|' || x.p || '|' || x.go::text, ',' ORDER BY x.g, x.p), '(none)')
    INTO v_def
    FROM (
      SELECT c.relname || '/' || COALESCE(pg_get_userbyid(a.grantee), 'PUBLIC') AS g,
             a.privilege_type AS p, a.is_grantable AS go
        FROM pg_class c, aclexplode(c.relacl) a
       WHERE c.oid IN ('public.order_refund_jobs'::regclass,
                       'public.order_refund_job_items'::regclass)
         -- owner 對自己的隱含全權不是我們要管的面(它由 owner 斷言另外守)
         AND a.grantee <> c.relowner
    ) x;
  IF v_def IS DISTINCT FROM 'order_refund_job_items/service_role|INSERT|false,order_refund_job_items/service_role|SELECT|false,order_refund_jobs/service_role|INSERT|false,order_refund_jobs/service_role|SELECT|false,order_refund_jobs/service_role|UPDATE|false' THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — 完整 ACL 集合不符(可能有額外 grantee / 欄級授權 / WITH GRANT OPTION),實 [%]', v_def;
  END IF;
  -- 欄級 ACL 必須完全不存在(表級 REVOKE 擋不住欄級 GRANT)。
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid IN ('public.order_refund_jobs'::regclass, 'public.order_refund_job_items'::regclass)
     AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — 有 % 個欄帶欄級 ACL(表級矩陣看不見它)', v_cnt;
  END IF;

  -- ── 5.13 M 型:本片不得建立任何 A7b 命名空間的函式 ────────
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'pcm\_a7bt\_%';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7b-M 驗收失敗 — 本片是 M 型,不得建立 A7b-T 的函式,實 % 支', v_cnt;
  END IF;

  RAISE NOTICE 'A7b-M 結構驗收全數通過';
END $$;

COMMIT;

-- ============================================================
-- rollback(🔴 順序寫死;先 DROP parent 會被 child FK 擋。plan §10)
-- 🔴 pg_depend preflight 必須在**任何 DROP 之前**(codex R6 F10:v6 把它排在最後 = 沒有 preflight),
--    且必須給 filter —— 空表本來就有一堆 internal 依賴,「非空即 abort」會永遠 abort。
-- 🔴 只允許在第一個 writer(第 3 批 worker)之前;之後只能 forward repair。
--   ① pg_depend preflight:🔴 **關卡2 更正 —— 原字面的方向是反的**:`pg_depend.objid` 才是
--      **dependent**(依賴別人的那個)、`refobjid` 是 **referenced**(被依賴的)。
--      要找的是「**外部物件依賴本片的表**」⇒ 條件應為 `refobjid IN (待刪物件)`
--      且 `objid` **不在**本片物件白名單內(白名單 = 兩表自己的 index / constraint /
--      composite type / 兩表之間的 FK)。原寫法 `refobjid NOT IN 本片集合` 會抓到
--      「本片 FK 指向 order_items」這種正常相依,同時**漏掉真正該擋的外部 view/constraint**。
--      ⇒ 施工 A7b-T 的 rollback 時必須在隔離庫**實跑**這段,證明它對空表不會誤 abort。
--   ② 停 writer(第 3 批之前 = 無 writer)
--   ③ 驗兩表為空;非空則備份後停下 raise Sean(不得靜默續行)
--   ④ DROP TABLE public.order_refund_job_items RESTRICT;
--   ⑤ DROP TABLE public.order_refund_jobs      RESTRICT;
--   (本片零函式 ⇒ 無函式要清;A7b-T 的函式由該片的 rollback 負責)
-- ============================================================
