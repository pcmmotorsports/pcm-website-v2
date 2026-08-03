-- ============================================================
-- M-3 A7c RW1a:order_refunds 寫入 RPC 對 + schema 增補(退款接線線第一片)
-- ============================================================
-- 片級 plan = docs/specs/2026-08-03-a7c-refund-wire-plan.md **v3.2**(關卡1 三輪:
--   codex R1 22+6 → R2 20關/8未關+N1-N3 → Sean 拍板 a,a,a,B,a → fable R3 換角度 5+8
--   → 窄確認 F1-F5 全關;逐字紀錄 = docs/reviews/2026-08-03-a7c-wire-k1-codex.md,
--   窄確認段同檔;受審 plan 版本 = git 525e46f)。
-- 關卡2:code-reviewer(opus)FAIL 1C+4I+8M + codex gpt-5.6-sol FAIL 7 must-fix+5 nit
--   → 逐條親驗全折(駁回 1 條:「DO 區塊未實跑」— 本檔已在本機 PG17 from-zero 全套
--   migration 重放 + 13 路行為 smoke 實跑通過;54331 拋棄式、已 teardown)。
-- 前置:20260725130100(order_refunds 帳本)+ 20260801120000(A7c 守門 P7C01-P7C10、
--   帳本已 apply 正式站、兩表 0 列)+ 20260712210000(admin_audit_log)。
-- 形狀樣板 = 20260802150000 admin_append_order_note(A6 owner RPC 全套)。
--
-- 🔴 為什麼是 owner RPC 對:order_refunds 對 service_role 只開 SELECT(20260725130100:315
--    逐字「寫入(INSERT/UPDATE)全走 RF2b 的 SECURITY DEFINER owner RPC」—— 本檔就是那個
--    從未建的 RF2b)。**service_role 路徑的唯二寫入口** = admin_initiate_order_refund(登記)
--    + admin_finalize_order_refund(結案);owner/superuser 仍可直寫 = 既有邊界、不宣稱不可竄改。
--
-- 🔴 本檔落地的拍板與 probe 定案(不重述論證,出處=plan §0/§2):
--   · Sean 08-03 Q1=A:payment_status='refunded' 硬擋再發起(REFUND_LEDGER_FULL)。
--   · Sean 08-03 Q3=A:恢復結案=Record 差額 + Portal 真 DR 碼(recovered_confirmed);P7C09 不鬆綁。
--   · deferred=獨立第四態(承 08-03 早 Q2=A 三態契約;10024=「還不能做」不是失敗)。
--   · rotation-always:bank_refund_id 一列一鍵、RPC 自產(probe:10024 消耗鍵、10051 不消耗)。
--   · 拍板⑤:**零超退守門**(金額上界不設;TapPay 10051 是權威)。
--   · G8 翻轉:僅 confirmed 路徑、單調不降級、來源態 allowlist、鎖 orders → CAS → 新句 SUM。
--
-- 🔴 誠實邊界(RW1b harness 會再印):
--   · 併發交錯(finalize G8 × initiate G12 barrier)本檔不測 = RW1b 的事;檔內驗收全是結構面,
--     audit payload 的行為驗證亦屬 RW1b。
--   · actor 是自陳身分(E8-B 前非驗證;Sean Q2=A 接受、audit 誠實標註)。
--   · 「同單同時至多一筆 processing」由 S5 partial unique 承重;卡死的 processing 列
--     天然擋新發起(fail-closed),清列=RW4 恢復流程。
--   · 恢復出口(recovered_confirmed/manual_failed)的「Record 差額已驗」是 RW4 流程紀律,
--     DB 只能鏡像其入口條件(異常列閘,見 finalize 步 5);持 service_role 者仍可對異常列
--     直呼恢復出口 —— 縱深=audit 全記錄 + Portal 真碼 P7C09,非零信任。
--   · RPC 執行期無 lock_timeout(檔頭 SET LOCAL 只保護 apply 那一刻;同 A6 既有邊界)。
--   · search_path=public, pg_temp 為全庫既有樣式(非 pg_catalog 收斂);檔內應用物件
--     全數 schema-qualified,public CREATE ACL 斷言留 RW1b 評估。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 0. 前置斷言:現況必須是本片設計時看到的形狀(任一不符=整支回滾)══════════
DO $pre$
DECLARE
  v_cnt integer;
  v_txt text;
BEGIN
  -- 0a. 兩張退款表必須是空的(要 ADD COLUMN ... NOT NULL 且不給 DEFAULT;A7c 前例 :84 同語)
  SELECT count(*) INTO v_cnt FROM public.order_refunds;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — order_refunds 有 % 列(本片假設 0 列);拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.order_refund_items;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — order_refund_items 有 % 列;拒繼續', v_cnt;
  END IF;

  -- 0b. status CHECK 現形**恰**三值(數 ::text 出現次數=3 + 三值都在 + 無 deferred)
  SELECT pg_get_constraintdef(oid) INTO v_txt
    FROM pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass AND conname = 'order_refunds_status_check';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — order_refunds_status_check 不存在(名稱漂移?);拒繼續';
  END IF;
  IF v_txt NOT ILIKE '%''processing''%' OR v_txt NOT ILIKE '%''confirmed''%'
     OR v_txt NOT ILIKE '%''failed''%' OR v_txt ILIKE '%deferred%'
     OR (length(v_txt) - length(replace(v_txt, '::text', ''))) / length('::text') <> 3 THEN
    -- 3 = 三個值各帶一次 ::text cast(canonical 形狀 status = ANY (ARRAY[...]);
    --     status 欄本身為 text、無 cast —— 本機 PG17 實跑校正)
    RAISE EXCEPTION 'RW1a 前置失敗 — status CHECK 內容非預期恰三值:[%];拒繼續', v_txt;
  END IF;

  -- 0c. refund_amount > 0 CHECK 仍在(full 凍結額 >0 的最後防線)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.order_refunds'::regclass
       AND pg_get_constraintdef(oid) ILIKE '%refund_amount > 0%') THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — CHECK (refund_amount > 0) 不存在;拒繼續';
  END IF;

  -- 0d. 三支既有函式在、承重字面未漂移(即將 CREATE OR REPLACE —— 覆蓋前先驗現形,
  --     否則靜默蓋掉 live drift;codex 關卡2 must-fix)
  SELECT prosrc INTO v_txt FROM pg_proc
   WHERE oid = 'public.pcm_a7c_refund_insert_guard()'::regprocedure;
  IF v_txt NOT LIKE '%a7c_insert_order_payment_not_captured%'
     OR v_txt NOT LIKE '%a7c_insert_settlement_fields_must_be_empty%' THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — insert guard 現形缺承重字面(已被他片改過?);拒繼續';
  END IF;
  SELECT prosrc INTO v_txt FROM pg_proc
   WHERE oid = 'public.pcm_a7c_refund_immutable_guard()'::regprocedure;
  IF v_txt NOT LIKE '%a7c_update_settlement_fields_write_once%'
     OR v_txt NOT LIKE '%a7c_confirm_requires_tappay_refund_id%' THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — immutable guard 現形缺承重字面;拒繼續';
  END IF;
  SELECT prosrc INTO v_txt FROM pg_proc
   WHERE oid = 'public.pcm_order_refund_status_transition()'::regprocedure;
  IF v_txt NOT LIKE '%processing%' OR v_txt LIKE '%deferred%' THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — 狀態機函式現形非預期;拒繼續';
  END IF;
  SELECT pg_get_functiondef('public.pcm_order_refundable_remaining(uuid)'::regprocedure) INTO v_txt;
  IF v_txt NOT ILIKE '%<> ''failed''%' THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — remaining 函式現形非「<> failed」;拒繼續';
  END IF;

  -- 0e. 三支 trigger 綁定現況(掛對表、指對函式、啟用;覆寫函式不動 trigger,前後都要在)
  SELECT count(*) INTO v_cnt FROM pg_trigger t
   WHERE t.tgrelid = 'public.order_refunds'::regclass AND NOT t.tgisinternal
     AND ((t.tgname = 'order_refunds_a7c_insert_guard_bi'
           AND t.tgfoid = 'public.pcm_a7c_refund_insert_guard()'::regprocedure)
       OR (t.tgname = 'order_refunds_a7c_immutable_guard_bu'
           AND t.tgfoid = 'public.pcm_a7c_refund_immutable_guard()'::regprocedure)
       OR (t.tgname = 'order_refunds_status_transition_bu'
           AND t.tgfoid = 'public.pcm_order_refund_status_transition()'::regprocedure))
     AND t.tgenabled = 'O';
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — 三支守門 trigger 綁定/啟用非預期(命中 %/3);拒繼續', v_cnt;
  END IF;

  -- 0f. 四個新欄不得已存在
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass AND NOT attisdropped AND attnum > 0
     AND attname IN ('kind', 'record_refunded_before', 'provider_refund_id_evidence', 'failed_detail');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — 新欄已存在 % 個(重複 apply?);拒繼續', v_cnt;
  END IF;

  -- 0g. pgcrypto 就位(bank_refund_id 生成依賴;N3a 前例)
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — pgcrypto 未安裝;拒繼續';
  END IF;
  IF pg_catalog.length(extensions.gen_random_bytes(16)) <> 16 THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — extensions.gen_random_bytes 行為異常;拒繼續';
  END IF;

  -- 0h. payment_status enum(綁 regtype、不受他 schema 同名污染)含本檔讀寫的四值
  SELECT count(*) INTO v_cnt
    FROM pg_enum e
   WHERE e.enumtypid = 'public.payment_status'::regtype
     AND e.enumlabel IN ('paid', 'partiallyRefunded', 'refunded', 'unpaid');
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'RW1a 前置失敗 — payment_status enum 缺值(命中 %/4);拒繼續', v_cnt;
  END IF;
END;
$pre$;

-- ══ 1. S1-S3/S7:四個新欄(表 0 列=最便宜時機;plan §2 甲)═══════════════════
ALTER TABLE public.order_refunds
  -- S1 kind:身分欄、不可變(進 P7C05)。finalize 金額比對與 G4 指紋都讀它。
  ADD COLUMN kind text NOT NULL
    CONSTRAINT order_refunds_kind_check CHECK (kind IN ('full', 'partial')),
  -- S2 Record baseline:initiate 前 action 從 Record API 查得的 refunded_amount
  --   (G0:欄缺=abort、嚴禁 ?? 0 —— fable R3 F1);RW4 恢復判定 delta 的錨。不可變。
  ADD COLUMN record_refunded_before bigint NOT NULL
    CONSTRAINT order_refunds_record_baseline_nonneg CHECK (record_refunded_before >= 0),
  -- S3 證據欄:accepted 當下寫的 wire refundId。與結案點 tappay_refund_id **分離**:
  --   本欄 processing 期可寫(金額不符 hold 路徑靠它保存證據)、write-once(P7C12);
  --   tappay_refund_id 仍只在轉 confirmed 那次寫(P7C09/P7C10 全不動)。
  ADD COLUMN provider_refund_id_evidence text
    CONSTRAINT order_refunds_evidence_shape
      CHECK (provider_refund_id_evidence IS NULL OR provider_refund_id_evidence ~ '^\S{1,64}$'),
  -- S7 失敗詳情(人工/診斷文字;failed_reason 改承 machine code)。只有 failed 列可非空。
  ADD COLUMN failed_detail text
    CONSTRAINT order_refunds_failed_detail_len
      CHECK (failed_detail IS NULL OR char_length(failed_detail) <= 500),
  ADD CONSTRAINT order_refunds_failed_detail_only_failed
    CHECK (failed_detail IS NULL OR status = 'failed');

COMMENT ON COLUMN public.order_refunds.kind IS
  'RW1a S1:full=整張退(TapPay 不帶 amount)/ partial=金額退。身分欄不可變(P7C05)。full 的 refund_amount 凍結額 = initiate 當下 Record 的 amount(TapPay 剩餘額=權威,含 Portal 場外;plan G3)。';
COMMENT ON COLUMN public.order_refunds.record_refunded_before IS
  'RW1a S2:initiate 前 action 從 TapPay Record API 查得的 refunded_amount(G0 資料流;欄缺=abort、嚴禁翻成 0 —— fable R3 F1:0 化會讓 RW4 把「從未執行的退款」判成已退)。RW4 恢復判定:delta = Record 現值 − 本欄;delta ∉ {0, refund_amount} = 停+人工。';
COMMENT ON COLUMN public.order_refunds.provider_refund_id_evidence IS
  'RW1a S3:accepted 當下寫入的 wire refund_id 證據(processing 期可寫、write-once P7C12)。與結案點 tappay_refund_id 分離:金額不符 hold 時本欄保存唯一直接證據而列留 processing;轉 confirmed 且本欄非空時必須與 tappay_refund_id 一致(P7C13)。🔴 本欄非空 = TapPay 曾受理 ⇒ 該列不得再走「零動錢」終態(deferred/rejected/not_sent;P7C15),出口只剩 RW4 的 recovered_confirmed / manual_failed。';
COMMENT ON COLUMN public.order_refunds.failed_detail IS
  'RW1a S7:失敗詳情文字(≤500;僅 status=failed 可非空;write-once P7C14)。failed_reason 承 machine code:rejected_out_of_range / not_sent / manual_failed。';

-- ══ 2. S6:status 加第四值 deferred(終態;10024=還不能做)════════════════════
ALTER TABLE public.order_refunds DROP CONSTRAINT order_refunds_status_check;
ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_status_check
  CHECK (status IN ('processing', 'confirmed', 'failed', 'deferred'));

-- deferred 列不得帶對帳碼(其餘欄由既有 CHECK 蘊含:confirmed_at 由 confirmed_consistency、
-- failed_reason 由 failed_consistency、failed_detail 由 only_failed —— 刻意不重複,重複=死規則)。
ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_deferred_clean
  CHECK (status <> 'deferred' OR tappay_refund_id IS NULL);

-- ══ 3. S4/S5:兩支 unique index ═══════════════════════════════════════════════
-- S4:request_id 全域唯一(G4 查驗式冪等的錨;原本只 nonblank、可跨單重用=codex R1 F8)。
CREATE UNIQUE INDEX order_refunds_request_id_key ON public.order_refunds (request_id);
-- S5:同單同時至多一筆 processing(接線債② single-flight 的 DB 權威;advisory lock 方案已刪)。
CREATE UNIQUE INDEX order_refunds_single_processing_per_order
  ON public.order_refunds (order_id) WHERE status = 'processing';

-- ══ 4. 狀態機函式改版:deferred 為第三個終態 ═════════════════════════════════
CREATE OR REPLACE FUNCTION public.pcm_order_refund_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;                                  -- 同值冪等重寫
  END IF;
  IF OLD.status = 'processing' AND NEW.status IN ('confirmed', 'failed', 'deferred') THEN
    RETURN NEW;                                  -- 唯三合法轉移
  END IF;
  RAISE EXCEPTION 'order_refunds 狀態轉移非法 — % → %(confirmed/failed/deferred 皆為終態);拒繼續',
    OLD.status, NEW.status;
END;
$$;

COMMENT ON FUNCTION public.pcm_order_refund_status_transition() IS
  'RF2a 退款狀態機(RW1a 改版):僅允許 processing → confirmed / failed / deferred / 同值冪等;三終態轉出一律 RAISE。deferred=10024「還不能做」(Sean 08-03 Q2=A 獨立態;重試=新列新鍵,不轉回 processing)。DB 層硬防線。';

-- ══ 5. INSERT 守門改版:原五道+覆寫行為逐字保留(關卡2 已逐段比對無 drift),
--       新增 3.6(S3 留空);原文承重註解濃縮保留(pg_get_functiondef 可見)═══════
CREATE OR REPLACE FUNCTION public.pcm_a7c_refund_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_status text;
  v_rec_trade_id   text;
BEGIN
  -- ── 3.1 初態必須是 processing ────────────────────────────────────────────
  -- 狀態機 trigger 只有 BEFORE UPDATE、對 INSERT 不觸發 ⇒ 沒這道可憑空生出已完成退款。
  IF NEW.status <> 'processing' THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:初態必須是 processing(收到的是 %);confirmed/failed/deferred 只能由狀態機從 processing 轉入', NEW.status
      USING ERRCODE = 'P7C01', CONSTRAINT = 'a7c_insert_status_must_be_processing';
  END IF;

  -- ── 3.2 訂單必須真的收過錢 ───────────────────────────────────────────────
  -- 🔴 FOR SHARE(非純 SELECT):READ COMMITTED 下 T2 可在 T1 commit 前改 payment_status
  --    或換 rec_trade_id(TOCTOU);FOR KEY SHARE 擋不住非鍵欄 UPDATE。
  --    鎖順序約定:orders(FOR SHARE)→ order_refunds;登記與結案=兩個短命交易。
  SELECT o.payment_status::text, o.tappay_rec_trade_id
    INTO v_payment_status, v_rec_trade_id
    FROM public.orders o
   WHERE o.id = NEW.order_id
     FOR SHARE;

  -- 🔴 allowlist 非 denylist(enum 日後加值 fail-open);IS NULL 顯式擋(訂單不存在時
  --    NULL NOT IN (...) 求值為 NULL 非 true ⇒ 少這半句會靜默通過)。
  --    值域=Sean 08-01 Q1=A:放行 {paid, partiallyRefunded, refunded};refunded 刻意放行
  --    (RPC 層 G12 才擋=Sean 08-03 Q1=A;本道擋「沒收過錢」不擋「還能退多少」=拍板⑤)。
  IF v_payment_status IS NULL
     OR v_payment_status NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:訂單 % 的 payment_status = % 不在可退款白名單,不得登記退款', NEW.order_id, COALESCE(v_payment_status, '<訂單不存在>')
      USING ERRCODE = 'P7C02', CONSTRAINT = 'a7c_insert_order_payment_not_captured';
  END IF;

  -- ── 3.3 rec_trade_id 必須綁定到該訂單自己的交易 ──────────────────────────
  -- 🔴 承重、關錢:送錯 rec_trade_id 給 TapPay,它會乖乖退**別人**的錢。
  --    兩個失敗模式各自 constraint 名(共用會讓突變 harness 誤判死規則;實際踩過)。
  IF v_rec_trade_id IS NULL OR btrim(v_rec_trade_id) = '' THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:訂單 % 沒有 tappay_rec_trade_id(非信用卡交易?),無法登記退款', NEW.order_id
      USING ERRCODE = 'P7C03', CONSTRAINT = 'a7c_insert_order_has_no_rec_trade_id';
  END IF;

  IF NEW.rec_trade_id <> v_rec_trade_id THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:rec_trade_id(%)與訂單 % 自己的交易識別碼(%)不符;拒繼續', NEW.rec_trade_id, NEW.order_id, v_rec_trade_id
      USING ERRCODE = 'P7C03', CONSTRAINT = 'a7c_insert_rec_trade_id_mismatch';
  END IF;

  -- ── 3.4 結案欄在 INSERT 當下必須是空的 ───────────────────────────────────
  -- 🔴 INSERT 預填假碼 + 結案時值不變 ⇒ write-once 的 IS DISTINCT FROM 不觸發(實測繞道)。
  IF NEW.tappay_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:tappay_refund_id 必須留空(它只能在結案那一次 UPDATE 由 NULL 寫入);收到 %', NEW.tappay_refund_id
      USING ERRCODE = 'P7C08', CONSTRAINT = 'a7c_insert_settlement_fields_must_be_empty';
  END IF;

  -- ── 3.6 證據欄在 INSERT 當下也必須是空的(RW1a 新增;3.4 同型論證)──────────
  -- S3 只能在「TapPay 真的受理過」之後寫;INSERT 帶值=憑空捏造證據再被 write-once 凍住。
  -- ERRCODE 併入 P7C08 家族(plan §2 甲 S3 字面;P7C11 已被 items_frozen 佔用 —— 關卡2 Critical);
  -- constraint 名不同 ⇒ harness 仍可區分兩道(P7C03 一碼雙名同例)。
  IF NEW.provider_refund_id_evidence IS NOT NULL THEN
    RAISE EXCEPTION 'A7c 帳本 INSERT:provider_refund_id_evidence 必須留空(它只能在 accepted 之後寫入);收到 %', NEW.provider_refund_id_evidence
      USING ERRCODE = 'P7C08', CONSTRAINT = 'a7c_insert_evidence_must_be_empty';
  END IF;

  -- ── 3.5 created_at 由 DB 決定(DEFAULT 對顯式傳值無保護力 ⇒ 直接覆寫)───────
  NEW.created_at := now();

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.pcm_a7c_refund_insert_guard() IS
  'A7c 帳本 INSERT 守門(RW1a 改版=原五道+覆寫行為逐字保留,新增第六道):①初態必須 processing ②payment_status 白名單 {paid, partiallyRefunded, refunded}、NULL 一併擋 ③訂單必須有 tappay_rec_trade_id ④rec_trade_id 必須等於該訂單的那一筆 ⑤tappay_refund_id 必須留空(P7C08)⑥provider_refund_id_evidence 必須留空(P7C08 家族、constraint 名 a7c_insert_evidence_must_be_empty)。覆寫:created_at 一律 now()。🔴 讀 orders 取 FOR SHARE(TOCTOU);鎖順序 orders→order_refunds。🔴 不含任何超退檢查(拍板⑤)。';

-- ══ 6. UPDATE 守門改版:原 4.1-4.6 行為逐字保留,4.2 擴列、新增 4.7-4.10 ═══════
CREATE OR REPLACE FUNCTION public.pcm_a7c_refund_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ── 4.1 金額欄不可變(帳本可改金額=失去證據力;更正=轉 failed 另開一列)────
  IF NEW.refund_amount IS DISTINCT FROM OLD.refund_amount THEN
    RAISE EXCEPTION 'A7c 帳本:金額欄不可變(退款 %);如需更正請將該列轉 failed 後另開一列', OLD.id
      USING ERRCODE = 'P7C04', CONSTRAINT = 'a7c_update_money_columns_immutable';
  END IF;

  -- ── 4.2 身分與稽核欄不可變(RW1a:原七欄 + kind + record_refunded_before)────
  IF NEW.order_id               IS DISTINCT FROM OLD.order_id
  OR NEW.bank_refund_id         IS DISTINCT FROM OLD.bank_refund_id
  OR NEW.rec_trade_id           IS DISTINCT FROM OLD.rec_trade_id
  OR NEW.created_at             IS DISTINCT FROM OLD.created_at
  OR NEW.actor                  IS DISTINCT FROM OLD.actor
  OR NEW.request_id             IS DISTINCT FROM OLD.request_id
  OR NEW.reason                 IS DISTINCT FROM OLD.reason
  OR NEW.kind                   IS DISTINCT FROM OLD.kind
  OR NEW.record_refunded_before IS DISTINCT FROM OLD.record_refunded_before THEN
    RAISE EXCEPTION 'A7c 帳本:身分/稽核欄(order_id / bank_refund_id / rec_trade_id / created_at / actor / request_id / reason / kind / record_refunded_before)不可變(退款 %)', OLD.id
      USING ERRCODE = 'P7C05', CONSTRAINT = 'a7c_update_identity_columns_immutable';
  END IF;

  -- ── 4.3 結案欄 write-once(允許 NULL→值,禁改值、禁抹回 NULL)───────────────
  IF (OLD.tappay_refund_id IS NOT NULL AND NEW.tappay_refund_id IS DISTINCT FROM OLD.tappay_refund_id)
  OR (OLD.confirmed_at     IS NOT NULL AND NEW.confirmed_at     IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'A7c 帳本:結案欄 write-once(退款 %)—— tappay_refund_id / confirmed_at 一經寫入不得再改或抹除', OLD.id
      USING ERRCODE = 'P7C07', CONSTRAINT = 'a7c_update_settlement_fields_write_once';
  END IF;

  -- ── 4.4 結案必須帶對帳碼(「可不可以不填」那道;P7C09 不鬆綁=Sean Q3=A)──────
  IF NEW.status = 'confirmed' AND NEW.tappay_refund_id IS NULL THEN
    RAISE EXCEPTION 'A7c 帳本:結案(confirmed)必須同時回填 tappay_refund_id —— 那是這筆退款唯一的對帳點(退款 %)', OLD.id
      USING ERRCODE = 'P7C09', CONSTRAINT = 'a7c_confirm_requires_tappay_refund_id';
  END IF;

  -- ── 4.5 processing 期間不得預填對帳碼(否則 write-once 可被「先塞後不變」繞過)─
  IF NEW.status = 'processing' AND NEW.tappay_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'A7c 帳本:processing 期間不得填 tappay_refund_id(它只能在轉 confirmed 的那一次 UPDATE 寫入;退款 %)', OLD.id
      USING ERRCODE = 'P7C10', CONSTRAINT = 'a7c_processing_must_not_have_tappay_refund_id';
  END IF;

  -- ── 4.7 證據欄 write-once(RW1a 新增;S3 的證據力與金額欄一致)──────────────
  IF OLD.provider_refund_id_evidence IS NOT NULL
     AND NEW.provider_refund_id_evidence IS DISTINCT FROM OLD.provider_refund_id_evidence THEN
    RAISE EXCEPTION 'A7c 帳本:provider_refund_id_evidence write-once(退款 %)—— 證據一經寫入不得再改或抹除', OLD.id
      USING ERRCODE = 'P7C12', CONSTRAINT = 'a7c_update_evidence_write_once';
  END IF;

  -- ── 4.8 轉 confirmed 時證據與對帳碼必須一致(RW1a 新增)───────────────────
  -- 同步路徑 S3=wire refundId=tappay_refund_id ⇒ 必相等(DR 碼是同一識別空間;probe P1/L 實證)。
  -- 恢復路徑 S3 為 NULL ⇒ 本道不觸發,P7C09 仍要求 Portal 真碼。
  IF NEW.status = 'confirmed' AND NEW.provider_refund_id_evidence IS NOT NULL
     AND NEW.tappay_refund_id IS DISTINCT FROM NEW.provider_refund_id_evidence THEN
    RAISE EXCEPTION 'A7c 帳本:轉 confirmed 時 tappay_refund_id(%)必須等於已保存的證據 provider_refund_id_evidence(%)(退款 %)', NEW.tappay_refund_id, NEW.provider_refund_id_evidence, OLD.id
      USING ERRCODE = 'P7C13', CONSTRAINT = 'a7c_confirm_evidence_mismatch';
  END IF;

  -- ── 4.9 failed_detail write-once(RW1a 新增;終態後改詳情=竄改稽核文字)────
  IF OLD.failed_detail IS NOT NULL AND NEW.failed_detail IS DISTINCT FROM OLD.failed_detail THEN
    RAISE EXCEPTION 'A7c 帳本:failed_detail write-once(退款 %)', OLD.id
      USING ERRCODE = 'P7C14', CONSTRAINT = 'a7c_update_failed_detail_write_once';
  END IF;

  -- ── 4.10 hold 列(證據非空)不得走「零動錢」終態(RW1a 新增;關卡2 codex MF1)──
  -- 🔴 關雙退:S3 非空=TapPay 曾受理、錢極可能已動;若仍可轉 deferred / rejected /
  --    not_sent(三者語意=確定沒動錢),S5 與 remaining 會被釋放 ⇒ 再 initiate = 同一筆
  --    錢退第二次。出口只剩 RW4:recovered_confirmed(同 DR 碼,4.8 鎖一致)/
  --    manual_failed(Record 差額證明真的沒動錢)。
  IF OLD.provider_refund_id_evidence IS NOT NULL
     AND (NEW.status = 'deferred'
          OR (NEW.status = 'failed' AND NEW.failed_reason IN ('rejected_out_of_range', 'not_sent'))) THEN
    RAISE EXCEPTION 'A7c 帳本:證據欄非空的列不得走零動錢終態(deferred/rejected/not_sent;退款 %)—— 出口只剩 RW4 的 recovered_confirmed / manual_failed', OLD.id
      USING ERRCODE = 'P7C15', CONSTRAINT = 'a7c_hold_row_requires_recovery_exit';
  END IF;

  -- ── 4.6 confirmed_at 由 DB 決定(凍結呼叫端可造假的時間=沒有意義)───────────
  IF NEW.status = 'confirmed' AND OLD.status <> 'confirmed' THEN
    NEW.confirmed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.pcm_a7c_refund_immutable_guard() IS
  'A7c 帳本 UPDATE 守門(RW1a 改版=原五道+覆寫行為保留,新增四道):①refund_amount 不可變 ②身分/稽核九欄(+kind / record_refunded_before)不可變 ③結案二欄 write-once ④confirmed 必帶 tappay_refund_id(P7C09,Sean Q3=A 不鬆綁)⑤processing 不得預填 ⑥證據欄 write-once(P7C12)⑦confirmed 時證據與對帳碼一致(P7C13)⑧failed_detail write-once(P7C14)⑨hold 列(證據非空)不得走零動錢終態(P7C15,關雙退)。覆寫:轉 confirmed 時 confirmed_at=now()。刻意留可變:status / failed_reason / failed_detail(NULL→值)/ 尚未填過的結案欄與證據欄。';

-- ══ 7. remaining 函式改版(S6 連動;fable N8 方向翻轉警語)════════════════════
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.total::bigint - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = o.id
               AND r.status IN ('processing', 'confirmed')), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$$;

COMMENT ON FUNCTION public.pcm_order_refundable_remaining(uuid) IS
  'A7c 顯示用(RW1a 改版):orders.total 減去本帳本已登記(processing + confirmed)的退款金額。deferred 與 failed 不佔額度(deferred=10024 已證零動錢;failed 沿舊語意 —— 轉 failed 前必先 Record 對帳的營運鐵律不變)。🔴 RW1a 起本式為 allowlist:**未來新增任何 status 值預設不佔額度(顯示面 fail-open 方向,與舊 <> failed 寫法相反)—— 新增狀態時必須回訪本函式**。🔴 不是守門、沒有 trigger 讀它(拍板⑤);只反映本帳本,Portal 場外退款不在其中 ⇒ 真實剩餘額 ≤ 本值;UI 措辭必須是「帳本未登記額」不得寫「還能退多少」。查無訂單回 NULL。';

-- ══ 8. RPC 1:admin_initiate_order_refund(登記;帳先記、後打 API)═════════════
-- 固定回傳碼 8 碼(jsonb.result;呼叫端必斷言 ∈ 全集,未知碼=呼叫端 bug):
--   'INITIATED' / 'DUPLICATE_REQUEST' / 'ORDER_NOT_FOUND' / 'ORDER_NOT_REFUNDABLE' /
--   'ORDER_NO_CARD_TRANSACTION' / 'REFUND_LEDGER_FULL' / 'REFUND_IN_FLIGHT' / 'REFUND_NOTHING_LEFT'
--   (plan §2 S5/G12 原字面「具名 RAISE」已依 A6 house 慣例修訂為固定回傳碼 —— 業務態=回傳碼、
--    caller bug 與完整性異常=RAISE;plan v3.2 §2 同步改字面,關卡2 codex MF7 折入)
-- 🔴 檢查順序(順序是合約、G4 必須在 G12 之前 —— 否則全額退 confirmed 後同 token 重播
--    會拿到 REFUND_LEDGER_FULL 而非 DUPLICATE_REQUEST;關卡2 codex MF4):
--   1 輸入衛生(RAISE)→ 2 kind/金額互斥(RAISE)→ 3 鎖訂單 → 4 冪等查驗 G4 →
--   5 業務前置 G12/白名單/卡交易 → 6 凍結額+NOTHING_LEFT → 7 產鍵 → 8 INSERT → 9 稽核
CREATE FUNCTION public.admin_initiate_order_refund(
  p_order_id               uuid,
  p_kind                   text,
  p_amount                 integer,   -- partial 必填正整數;full 必須 NULL
  p_record_refunded_before bigint,    -- G0 baseline(action 從 Record 查得;缺欄時 action 已 abort)
  p_record_amount          bigint,    -- G0 那次 Record 的 amount(剩餘額);full 必填(凍結額)、partial 必須 NULL
  p_reason                 text,
  p_actor                  text,
  p_request_id             text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor    text;
  v_req      text;
  v_reason   text;
  v_ps       text;
  v_rec      text;
  v_frozen   integer;
  v_brid     text;
  v_row      public.order_refunds%ROWTYPE;
  v_id       uuid;
  v_conname  text;
BEGIN
  -- 步 1. 輸入衛生(G11;RAISE 面,鏡像 A6 步 1;slug regex 拒 unicode ⇒ 裸 btrim 已足)
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 actor';
  END IF;
  v_actor := btrim(p_actor);
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: actor 非法(須為 staff slug)';
  END IF;
  IF p_request_id IS NULL
     OR p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 非法(須為 UUID v4 小寫;表單渲染時 server 發)';
  END IF;
  v_req := p_request_id;
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 reason';
  END IF;
  v_reason := btrim(p_reason);
  IF v_reason = '' OR char_length(v_reason) > 200 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: reason 非法(1-200 字、零控制字元)';
  END IF;

  -- 步 2. kind 與金額參數互斥(RAISE 面;fail-closed 嚴格互斥;損壞輸入=RAISE 非業務碼)
  IF p_kind IS NULL OR p_kind NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: kind 須為 full|partial(got %)', COALESCE(p_kind, '<null>');
  END IF;
  IF p_record_refunded_before IS NULL OR p_record_refunded_before < 0 THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: record_refunded_before 須為非負整數(G0 baseline;Record 欄缺時 action 必須 abort、不得傳 0 充數)';
  END IF;
  IF p_kind = 'partial' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 必須帶正整數 amount';
    END IF;
    IF p_record_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 不得帶 record_amount(凍結額=員工輸入額)';
    END IF;
    v_frozen := p_amount;
  ELSE  -- full
    IF p_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 不得帶 amount(凍結額=Record 剩餘額;plan G3)';
    END IF;
    IF p_record_amount IS NULL OR p_record_amount < 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 必須帶非負 record_amount(G0 那次 Record 的 amount;負值=損壞輸入)';
    END IF;
    IF p_record_amount > 2147483647 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: record_amount 超出 integer 範圍';
    END IF;
    v_frozen := p_record_amount::integer;   -- =0 時走步 6 的 NOTHING_LEFT(業務態非損壞)
  END IF;

  -- 步 3. 鎖訂單(G1:FOR NO KEY UPDATE —— FOR UPDATE 與 FK RI KEY SHARE 死結 40P01 實錘;
  --   鎖順序沿既有約定 orders → order_refunds;INSERT trigger 的 FOR SHARE 同列同交易相容)
  SELECT o.payment_status::text, o.tappay_rec_trade_id
    INTO v_ps, v_rec
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_FOUND');
  END IF;

  -- 步 4. 查驗式冪等(G4;**先於一切業務前置** —— 重播必須拿到 DUPLICATE 而非被
  --   後續業務態遮蔽;以 S4 唯一鍵找列、逐欄比指紋)
  SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
  IF FOUND THEN
    IF v_row.order_id = p_order_id AND v_row.kind = p_kind
       AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec THEN
      IF v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: 該 request 的前次嘗試已終結為 %(deferred/failed 不得同鍵重放;請開新請求=新表單=新 token)', v_row.status;
    END IF;
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 已被使用且指紋不符(order/kind/金額/rec 任一變動;full 的凍結額會隨 Record 漂移 —— 金額已變動,請重新發起)';
  END IF;

  -- 步 5. 業務前置(友善碼面;P7C02/P7C03 仍是深層防線、不重複計門)
  IF v_ps = 'refunded' THEN
    RETURN jsonb_build_object('result', 'REFUND_LEDGER_FULL');   -- Sean Q1=A 硬擋(G12)
  END IF;
  IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_REFUNDABLE');
  END IF;
  IF v_rec IS NULL OR btrim(v_rec) = '' THEN
    RETURN jsonb_build_object('result', 'ORDER_NO_CARD_TRANSACTION');
  END IF;

  -- 步 6. full 的「已無可退」業務態(fable F2:凍 0 元會撞 refund_amount>0 CHECK 成裸錯)
  IF p_kind = 'full' AND v_frozen < 1 THEN
    RETURN jsonb_build_object('result', 'REFUND_NOTHING_LEFT');
  END IF;

  -- 步 7. bank_refund_id 生成(G2:rotation-always 一列一鍵;16 bytes→base64→+/→ab→截 20
  --   = 恰 20 字 [A-Za-z0-9ab]、熵 ≥90-bit;生成即形狀,不設驗證(恆真=死規則,關卡2 折入);
  --   撞鍵由 UNIQUE 承接、機率天文小、fail-loud)
  v_brid := substr(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', 'ab'), 1, 20);

  -- 步 8. 單列 INSERT(S5/S4 撞鍵在此收斂成具名結果;其餘 unique 撞鍵 fail-loud)
  BEGIN
    INSERT INTO public.order_refunds
      (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor,
       request_id, kind, record_refunded_before)
    VALUES
      (p_order_id, v_brid, v_rec, v_frozen, 'processing', v_reason, v_actor,
       v_req, p_kind, p_record_refunded_before)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_conname = CONSTRAINT_NAME;
    IF v_conname = 'order_refunds_single_processing_per_order' THEN
      RETURN jsonb_build_object('result', 'REFUND_IN_FLIGHT');   -- 接線債②:同單已有進行中退款
    END IF;
    IF v_conname = 'order_refunds_request_id_key' THEN
      -- 同 token 併發競態:另一連線剛插入 ⇒ 重跑步 4 的查驗(嚴格同判準)
      SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
      IF FOUND AND v_row.order_id = p_order_id AND v_row.kind = p_kind
         AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec
         AND v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: request_id 併發撞鍵且查驗不過;拒繼續';
    END IF;
    RAISE;  -- bank_refund_id 撞鍵等 = 異常,fail-loud
  END;

  -- 步 9. 同交易稽核(G9;audit INSERT 不包 EXCEPTION handler —— 失敗必整筆 rollback)
  -- 🔴 audit.reason 一律 NULL(零自由文字/零 PII;退款理由存帳本列 reason 欄、RLS 保護;
  --    關卡2 codex MF3 折入)。after 恰 8 鍵、全部取自實際寫入值。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.initiate', 'order:' || p_order_id::text, NULL,
          jsonb_build_object(
            'order_id', p_order_id,
            'refund_row_id', v_id,
            'kind', p_kind,
            'refund_amount', v_frozen,
            'rec_trade_id', v_rec,
            'bank_refund_id', v_brid,
            'record_refunded_before', p_record_refunded_before,
            'request_id', v_req),
          NULL, v_req, 'admin');

  RETURN jsonb_build_object('result', 'INITIATED', 'refund_id', v_id,
    'bank_refund_id', v_brid, 'refund_amount', v_frozen, 'status', 'processing');
END;
$fn$;

COMMENT ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) IS
  'M-3 A7c RW1a 退款登記 RPC(=RF2b 的 initiate 半邊;plan v3.2 §2)。帳先記(INSERT processing 列、RPC 自產 bank_refund_id 一列一鍵)、呼叫端再打 TapPay refund()。'
  '固定回傳碼 8 碼(jsonb.result;呼叫端必斷言 ∈ 全集):INITIATED / DUPLICATE_REQUEST / ORDER_NOT_FOUND / ORDER_NOT_REFUNDABLE / ORDER_NO_CARD_TRANSACTION / REFUND_LEDGER_FULL / REFUND_IN_FLIGHT / REFUND_NOTHING_LEFT。'
  '🔴 檢查順序=合約:鎖訂單 → 冪等查驗(G4,先於一切業務前置 —— 重播恆得 DUPLICATE、不被 REFUND_LEDGER_FULL 等遮蔽)→ G12/白名單/卡交易 → NOTHING_LEFT。'
  '🔴 DUPLICATE_REQUEST=查驗式冪等(同 request_id + 指紋 order/kind/金額/rec 全符 + 列在 processing|confirmed)⇒ 按成功處理;同鍵但指紋不符或前次已 deferred/failed = RAISE fail-loud。'
  '🔴 REFUND_IN_FLIGHT=同單已有 processing 列(S5;接線債② single-flight)。REFUND_LEDGER_FULL=Sean Q1=A refunded 硬擋。'
  'kind=full 凍結額=呼叫端提供的 Record 剩餘額(G0:action 先 recordQuery 並斷言 record_status∈{0,1,2}、refunded_amount 欄缺=abort 嚴禁 ??0、full 時 amount>0);partial=員工輸入。'
  'audit(action=order_refund.initiate、after 恰 8 鍵、reason=NULL 零自由文字)。鎖序=orders FOR NO KEY UPDATE → order_refunds。EXECUTE 僅 service_role。';

-- ══ 9. RPC 2:admin_finalize_order_refund(結案;三態+恢復)════════════════════
-- 固定回傳碼 3 碼:'FINALIZED' / 'HELD_AMOUNT_MISMATCH' / 'REFUND_NOT_FOUND'。
-- outcome allowlist 6 碼(G6;全部可達):同步=accepted / deferred_not_captured /
--   rejected_out_of_range / not_sent;恢復(RW4)=recovered_confirmed / manual_failed。
-- unknown-state(HTTP/逾時/6002/10050/格式異常)**沒有對應 outcome** —— 呼叫端不得呼本函式,
--   列留 processing 走 RW4(plan §3 末列)。
CREATE FUNCTION public.admin_finalize_order_refund(
  p_refund_id          uuid,
  p_outcome            text,
  p_tappay_refund_id   text,      -- accepted / recovered_confirmed 必填(其餘必 NULL)
  p_refund_amount_wire bigint,    -- accepted 必填(G7 比對;其餘必 NULL)
  p_failed_detail      text,      -- manual_failed 必填;rejected/not_sent 選填;其餘必 NULL
  p_actor              text,
  p_request_id         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor    text;
  v_req      text;
  v_order_id uuid;
  v_row      public.order_refunds%ROWTYPE;
  v_after    public.order_refunds%ROWTYPE;
  v_ps       text;
  v_total    integer;
  v_sum      bigint;
  v_target   text;
  v_result   text;
  v_audit_outcome text;
BEGIN
  -- 步 1. 輸入衛生(同 initiate)
  IF p_actor IS NULL OR btrim(p_actor) = '' OR btrim(p_actor) !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: actor 非法';
  END IF;
  v_actor := btrim(p_actor);
  IF p_request_id IS NULL
     OR p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: request_id 非法(須為 UUID v4 小寫)';
  END IF;
  v_req := p_request_id;
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 缺 refund_id';
  END IF;

  -- 步 2. outcome allowlist + 逐 outcome 參數矩陣(G6;fail-closed 嚴格互斥)
  IF p_outcome IS NULL OR p_outcome NOT IN
     ('accepted', 'deferred_not_captured', 'rejected_out_of_range', 'not_sent',
      'recovered_confirmed', 'manual_failed') THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: outcome 非法(got %)', COALESCE(p_outcome, '<null>');
  END IF;
  IF p_outcome IN ('accepted', 'recovered_confirmed') THEN
    IF p_tappay_refund_id IS NULL OR p_tappay_refund_id !~ '^\S{1,64}$' THEN
      RAISE EXCEPTION 'admin_finalize_order_refund: % 必須帶合法 tappay_refund_id', p_outcome;
    END IF;
  ELSIF p_tappay_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: % 不得帶 tappay_refund_id', p_outcome;
  END IF;
  IF p_outcome = 'accepted' THEN
    IF p_refund_amount_wire IS NULL OR p_refund_amount_wire < 0 THEN
      RAISE EXCEPTION 'admin_finalize_order_refund: accepted 必須帶 refund_amount_wire(G7 比對)';
    END IF;
  ELSIF p_refund_amount_wire IS NOT NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: % 不得帶 refund_amount_wire', p_outcome;
  END IF;
  IF p_outcome = 'manual_failed' AND (p_failed_detail IS NULL OR btrim(p_failed_detail) = '') THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: manual_failed 必須帶 failed_detail(Record 證據數字)';
  END IF;
  IF p_outcome IN ('accepted', 'deferred_not_captured', 'recovered_confirmed')
     AND p_failed_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: % 不得帶 failed_detail', p_outcome;
  END IF;
  IF p_failed_detail IS NOT NULL AND char_length(p_failed_detail) > 500 THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: failed_detail 超長(≤500)';
  END IF;

  -- 步 3. 隔離閘(G8;RR 下鎖後 SUM 看不到兄弟提交 —— P2B02 同型)
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 需在 READ COMMITTED 下執行(現為 %;RR 下 G8 的 SUM 讀不到並行提交)', current_setting('transaction_isolation');
  END IF;

  -- 步 4. 取 order_id(無鎖預讀,只取路由鍵)→ 鎖 orders → **重讀退款列 FOR UPDATE**
  --   (鎖序 orders → order_refunds;鎖前預讀的列值一律不信 —— 關卡2 codex MF1 後半)
  SELECT order_id INTO v_order_id FROM public.order_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'REFUND_NOT_FOUND');
  END IF;
  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = v_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 帳本列 % 的訂單 % 不存在(FK 應擋住;資料異常)', p_refund_id, v_order_id;
  END IF;
  SELECT * INTO v_row FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;

  -- 步 5. 出口前置(關卡2 codex MF1/MF2 折入):
  -- 5a. hold 列(證據非空)不得走零動錢同步終態(P7C15 trigger 是權威、這裡給友善訊息)
  IF v_row.provider_refund_id_evidence IS NOT NULL
     AND p_outcome IN ('deferred_not_captured', 'rejected_out_of_range', 'not_sent') THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 該列已保存 TapPay 受理證據(%)、不得標成零動錢終態;出口=RW4 的 recovered_confirmed / manual_failed', v_row.provider_refund_id_evidence;
  END IF;
  -- 5b. 恢復出口只對「異常列」開放(鏡像 RW4 異常清單入口條件:超時或已有證據;
  --     擋「憑空把剛建的 processing 列 confirm 掉」—— DB 驗不了 Record 差額,
  --     這道閘 + audit 全記錄 + P7C09 Portal 真碼 = 縱深,非零信任)
  IF p_outcome IN ('recovered_confirmed', 'manual_failed')
     AND v_row.provider_refund_id_evidence IS NULL
     AND clock_timestamp() - v_row.created_at < interval '30 minutes' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 恢復出口(%)只對異常列開放(processing 超 30 分或已有證據;該列建立於 %)', p_outcome, v_row.created_at;
  END IF;

  -- 步 6. 分支 + CAS(G5:WHERE status=processing;已持列鎖 ⇒ NOT FOUND=已被終結,
  --   訊息用**鎖後**現況;每支 UPDATE 緊接 RETURNING、不隔任何賦值 —— ROW_COUNT 陷阱)
  v_result := 'FINALIZED';
  v_audit_outcome := p_outcome;

  IF p_outcome = 'accepted' THEN
    IF p_refund_amount_wire = v_row.refund_amount THEN
      -- 同步 happy path:證據 + 對帳碼 + confirmed 一次寫(P7C13 一致性天然滿足)
      UPDATE public.order_refunds
         SET status = 'confirmed',
             tappay_refund_id = p_tappay_refund_id,
             provider_refund_id_evidence = p_tappay_refund_id
       WHERE id = p_refund_id AND status = 'processing'
       RETURNING * INTO v_after;
    ELSE
      -- G7 金額不符:只寫證據、留 processing、走 RW4(fail-closed;不 confirm 不翻轉)
      v_result := 'HELD_AMOUNT_MISMATCH';
      v_audit_outcome := 'accepted_amount_mismatch_hold';
      UPDATE public.order_refunds
         SET provider_refund_id_evidence = p_tappay_refund_id
       WHERE id = p_refund_id AND status = 'processing'
       RETURNING * INTO v_after;
    END IF;
  ELSIF p_outcome = 'deferred_not_captured' THEN
    UPDATE public.order_refunds SET status = 'deferred'
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  ELSIF p_outcome IN ('rejected_out_of_range', 'not_sent') THEN
    UPDATE public.order_refunds
       SET status = 'failed', failed_reason = p_outcome, failed_detail = p_failed_detail
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  ELSIF p_outcome = 'recovered_confirmed' THEN
    -- 恢復路徑(Sean Q3=A):Record 差額判定成立後、人工從 Portal 取回真 DR 碼。
    -- hold 列:S3 非空 ⇒ P7C13 要求 Portal 碼 == 證據碼(DR 碼同一識別空間;probe L 實證);
    -- 崩潰列:S3 為 NULL ⇒ P7C13 不觸發、P7C09 由 Portal 真碼滿足。
    UPDATE public.order_refunds
       SET status = 'confirmed', tappay_refund_id = p_tappay_refund_id
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  ELSE  -- manual_failed(Record 差額=0 已由 RW4 流程驗過;detail 必填=證據數字)
    UPDATE public.order_refunds
       SET status = 'failed', failed_reason = 'manual_failed', failed_detail = p_failed_detail
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  END IF;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: CAS 失敗 — 退款 % 現況 %(非 processing;已被終結)', p_refund_id, v_row.status;
  END IF;

  -- 步 7. G8 翻轉(僅 confirmed 路徑;來源態 allowlist —— domain 轉移表 state-machine.ts:15-40:
  --   只有 paid / partiallyRefunded 能進退款 target;refunded 保持不動(單調);
  --   其餘(unpaid/partiallyPaid)= 資料異常 RAISE 整筆回滾 —— 關卡2 兩線同抓)
  IF v_after.status = 'confirmed' THEN
    IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
      RAISE EXCEPTION 'admin_finalize_order_refund: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒結案', v_order_id, v_ps;
    END IF;
    SELECT COALESCE(SUM(refund_amount), 0) INTO v_sum
      FROM public.order_refunds
     WHERE order_id = v_order_id AND status = 'confirmed';
    v_target := CASE WHEN v_sum >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
    IF v_ps <> 'refunded' AND v_ps <> v_target THEN
      UPDATE public.orders SET payment_status = v_target::public.payment_status
       WHERE id = v_order_id;
      v_ps := v_target;
    END IF;
  END IF;

  -- 步 8. 同交易稽核(G9;after 恰 6 鍵、**全部取自 CAS 後實際列值**(RETURNING)——
  --   audit=事實非參數(關卡2 codex MF3);不包 EXCEPTION handler)
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.finalize', 'order:' || v_order_id::text, NULL,
          jsonb_build_object(
            'refund_row_id', v_after.id,
            'outcome', v_audit_outcome,
            'tappay_refund_id', v_after.tappay_refund_id,
            'provider_refund_id_evidence', v_after.provider_refund_id_evidence,
            'refund_amount_wire', p_refund_amount_wire,
            'request_id', v_req),
          NULL, v_req, 'admin');

  RETURN jsonb_build_object('result', v_result,
    'status_after', v_after.status,
    'payment_status_after', v_ps);
END;
$fn$;

COMMENT ON FUNCTION public.admin_finalize_order_refund(uuid, text, text, bigint, text, text, text) IS
  'M-3 A7c RW1a 退款結案 RPC(=RF2b 的 finalize 半邊;plan v3.2 §2/§3)。'
  '固定回傳碼 3 碼(jsonb.result):FINALIZED / HELD_AMOUNT_MISMATCH / REFUND_NOT_FOUND。'
  'outcome allowlist 6 碼(全部可達):accepted(wire 金額===凍結額→confirmed+證據+對帳碼;不符→只寫證據、留 processing=HELD_AMOUNT_MISMATCH 走 RW4,audit outcome 記第七值 accepted_amount_mismatch_hold)/ deferred_not_captured(→deferred 終態;10024;不寫 failed_reason —— 既有 failed_consistency CHECK 強制)/ rejected_out_of_range、not_sent(→failed)/ recovered_confirmed、manual_failed(恢復出口:只對異常列開放=processing 超 30 分或已有證據;Sean Q3=A)。'
  '🔴 hold 列(證據非空)不得走零動錢終態(deferred/rejected/not_sent;P7C15 trigger 權威)——關雙退。'
  '🔴 unknown-state(HTTP/逾時/6002/10050/格式異常)沒有 outcome —— 不得呼本函式,列留 processing 走 RW4。'
  '🔴 G8 翻轉僅 confirmed 路徑:鎖 orders(FOR NO KEY UPDATE)→ 重讀退款列 FOR UPDATE → CAS → 新句 SUM(confirmed)→ 來源態 allowlist {paid, partiallyRefunded}(refunded 保持不動、其餘 RAISE)→ SUM≥total 翻 refunded 否則 partiallyRefunded;單調不降級;開頭斷言 READ COMMITTED。'
  'CAS 失敗(已被終結)= RAISE fail-loud(訊息用鎖後現況)。audit after 恰 6 鍵全取自 RETURNING 實際列值。EXECUTE 僅 service_role。';

-- ══ 10. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role ═══════════════
REVOKE ALL ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text)
  TO service_role;
REVOKE ALL ON FUNCTION public.admin_finalize_order_refund(uuid, text, text, bigint, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_finalize_order_refund(uuid, text, text, bigint, text, text, text)
  TO service_role;

-- ══ 11. 檔內 fail-closed 驗收(任一不符=整支回滾;A6 形狀)═════════════════════
DO $verify$
DECLARE
  v_init oid := 'public.admin_initiate_order_refund(uuid,text,integer,bigint,bigint,text,text,text)'::regprocedure;
  v_fin  oid := 'public.admin_finalize_order_refund(uuid,text,text,bigint,text,text,text)'::regprocedure;
  v_oid  oid;
  v_cnt  integer;
  v_txt  text;
BEGIN
  -- 11a. 兩函式:SECDEF + search_path + proacl 非 NULL + ACL 恰 service_role:EXECUTE:false
  --      + PUBLIC 零授權 + owner 三表對齊(order_refunds / admin_audit_log / orders)
  FOREACH v_oid IN ARRAY ARRAY[v_init, v_fin] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % 應為 SECURITY DEFINER;拒繼續', v_oid::regprocedure;
    END IF;
    SELECT array_to_string(proconfig, ',') INTO v_txt FROM pg_proc WHERE oid = v_oid;
    IF v_txt IS DISTINCT FROM 'search_path=public, pg_temp' THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % proconfig 應為 search_path=public, pg_temp,實 [%];拒繼續', v_oid::regprocedure, v_txt;
    END IF;
    IF (SELECT proacl IS NULL FROM pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % proacl 為 NULL(= EXECUTE TO PUBLIC 預設);拒繼續', v_oid::regprocedure;
    END IF;
    SELECT coalesce(string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>') INTO v_txt
      FROM (SELECT pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr
              FROM pg_proc pr CROSS JOIN LATERAL aclexplode(pr.proacl) a
             WHERE pr.oid = v_oid AND a.grantee <> pr.proowner) x;
    IF v_txt <> 'service_role:EXECUTE:false' THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % 非 owner 授權應恰為 service_role:EXECUTE:false,實 [%];拒繼續', v_oid::regprocedure, v_txt;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_proc pr CROSS JOIN LATERAL aclexplode(pr.proacl) a
     WHERE pr.oid = v_oid AND a.grantee = 0;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % PUBLIC 應零授權;拒繼續', v_oid::regprocedure;
    END IF;
    IF (SELECT proowner FROM pg_proc WHERE oid = v_oid)
       <> (SELECT relowner FROM pg_class WHERE oid = 'public.order_refunds'::regclass) THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % owner 與 order_refunds 表 owner 不同;拒繼續', v_oid::regprocedure;
    END IF;
    IF (SELECT proowner FROM pg_proc WHERE oid = v_oid)
       <> (SELECT relowner FROM pg_class WHERE oid = 'public.admin_audit_log'::regclass) THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % owner 與 admin_audit_log 表 owner 不同(zero-policy RLS 下非 owner 寫不進);拒繼續', v_oid::regprocedure;
    END IF;
    IF (SELECT proowner FROM pg_proc WHERE oid = v_oid)
       <> (SELECT relowner FROM pg_class WHERE oid = 'public.orders'::regclass) THEN
      RAISE EXCEPTION 'RW1a 驗收失敗 — % owner 與 orders 表 owner 不同(G1/G8 要鎖與改 orders);拒繼續', v_oid::regprocedure;
    END IF;
  END LOOP;

  -- 11b. 簽章逐字(identity_arguments 回全稱型別;A6 3b 踩過)
  SELECT pg_get_function_identity_arguments(v_init) INTO v_txt;
  IF v_txt <> 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — initiate 簽章 [%];拒繼續', v_txt;
  END IF;
  SELECT pg_get_function_identity_arguments(v_fin) INTO v_txt;
  IF v_txt <> 'p_refund_id uuid, p_outcome text, p_tappay_refund_id text, p_refund_amount_wire bigint, p_failed_detail text, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — finalize 簽章 [%];拒繼續', v_txt;
  END IF;

  -- 11c. order_refunds 表級 ACL 未放寬(仍恰 service_role:SELECT:false)+ 欄級 ACL 0
  SELECT coalesce(string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>') INTO v_txt
    FROM (SELECT pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p, a.is_grantable::text AS gr
            FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
           WHERE c.oid = 'public.order_refunds'::regclass AND a.grantee <> c.relowner) x;
  IF v_txt <> 'service_role:SELECT:false' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — order_refunds ACL 應仍恰為 service_role:SELECT:false,實 [%];拒繼續', v_txt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_refunds'::regclass AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — order_refunds 有 % 個欄級 ACL;拒繼續', v_cnt;
  END IF;

  -- 11d. RLS on + 零 policy + FORCE off(order_refunds / admin_audit_log;orders 驗 FORCE off)
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_refunds'::regclass)
     OR (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.order_refunds'::regclass) THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — order_refunds RLS 應 on 且 FORCE off;拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_refunds';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — order_refunds 應零 policy,實 %;拒繼續', v_cnt;
  END IF;
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.admin_audit_log'::regclass) THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — admin_audit_log FORCE RLS 應 off;拒繼續';
  END IF;
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.orders'::regclass) THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — orders FORCE RLS 應 off(G1/G8 owner 穿透依賴);拒繼續';
  END IF;

  -- 11e. audit 8 欄在 + owner 對 audit 有 INSERT(本 RPC 對不查 audit ⇒ 不驗 SELECT)
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.admin_audit_log'::regclass AND NOT attisdropped AND attnum > 0
     AND attname IN ('actor','action','target','before','after','reason','request_id','source_app');
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — admin_audit_log 8 欄命中 %;拒繼續', v_cnt;
  END IF;
  IF NOT has_table_privilege((SELECT proowner FROM pg_proc WHERE oid = v_init),
       'public.admin_audit_log'::regclass, 'INSERT') THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — 函式 owner 對 admin_audit_log 無 INSERT;拒繼續';
  END IF;

  -- 11f. 新欄 4 個在、型別正確
  SELECT count(*) INTO v_cnt FROM pg_attribute a
   WHERE a.attrelid = 'public.order_refunds'::regclass AND NOT a.attisdropped
     AND ((a.attname = 'kind' AND format_type(a.atttypid, NULL) = 'text')
       OR (a.attname = 'record_refunded_before' AND format_type(a.atttypid, NULL) = 'bigint')
       OR (a.attname = 'provider_refund_id_evidence' AND format_type(a.atttypid, NULL) = 'text')
       OR (a.attname = 'failed_detail' AND format_type(a.atttypid, NULL) = 'text'));
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — 新欄/型別命中 %/4;拒繼續', v_cnt;
  END IF;

  -- 11g. 六條新 CHECK 具名在
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass
     AND conname IN ('order_refunds_kind_check', 'order_refunds_record_baseline_nonneg',
                     'order_refunds_evidence_shape', 'order_refunds_failed_detail_len',
                     'order_refunds_failed_detail_only_failed', 'order_refunds_deferred_clean');
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — 新 CHECK 命中 %/6;拒繼續', v_cnt;
  END IF;

  -- 11h. status CHECK 含 deferred;兩支 unique index 在且形狀對
  SELECT pg_get_constraintdef(oid) INTO v_txt FROM pg_constraint
   WHERE conrelid = 'public.order_refunds'::regclass AND conname = 'order_refunds_status_check';
  IF v_txt NOT ILIKE '%deferred%' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — status CHECK 未含 deferred:[%];拒繼續', v_txt;
  END IF;
  SELECT pg_get_indexdef(i.indexrelid) INTO v_txt
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'order_refunds_request_id_key';
  IF v_txt IS NULL OR v_txt NOT ILIKE '%UNIQUE%' OR v_txt ILIKE '%WHERE%' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — request_id unique index 形狀異常:[%];拒繼續', v_txt;
  END IF;
  SELECT pg_get_indexdef(i.indexrelid) INTO v_txt
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'order_refunds_single_processing_per_order';
  IF v_txt IS NULL OR v_txt NOT ILIKE '%UNIQUE%' OR v_txt NOT ILIKE '%order_id%'
     OR v_txt NOT ILIKE '%status = ''processing''%' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — single-flight index 形狀異常:[%];拒繼續', v_txt;
  END IF;

  -- 11i. 三支改版函式 body 含新字面、remaining 舊字面已除、P7C15 在
  SELECT pg_get_functiondef('public.pcm_order_refund_status_transition()'::regprocedure) INTO v_txt;
  IF v_txt NOT ILIKE '%deferred%' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — 狀態機函式未含 deferred;拒繼續';
  END IF;
  SELECT pg_get_functiondef('public.pcm_a7c_refund_insert_guard()'::regprocedure) INTO v_txt;
  IF v_txt NOT ILIKE '%a7c_insert_evidence_must_be_empty%' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — INSERT 守門未含 3.6;拒繼續';
  END IF;
  SELECT pg_get_functiondef('public.pcm_a7c_refund_immutable_guard()'::regprocedure) INTO v_txt;
  IF v_txt NOT ILIKE '%a7c_update_evidence_write_once%'
     OR v_txt NOT ILIKE '%a7c_confirm_evidence_mismatch%'
     OR v_txt NOT ILIKE '%a7c_update_failed_detail_write_once%'
     OR v_txt NOT ILIKE '%a7c_hold_row_requires_recovery_exit%'
     OR v_txt NOT ILIKE '%record_refunded_before%' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — UPDATE 守門缺 P7C12/P7C13/P7C14/P7C15 或未涵蓋新身分欄;拒繼續';
  END IF;
  SELECT pg_get_functiondef('public.pcm_order_refundable_remaining(uuid)'::regprocedure) INTO v_txt;
  IF v_txt NOT ILIKE '%IN (''processing'', ''confirmed'')%' OR v_txt ILIKE '%<> ''failed''%' THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — remaining 函式未改版或舊字面殘留;拒繼續';
  END IF;

  -- 11j. 三支 trigger 覆寫後仍綁對表、指對函式、啟用(關卡2 codex MF6)
  SELECT count(*) INTO v_cnt FROM pg_trigger t
   WHERE t.tgrelid = 'public.order_refunds'::regclass AND NOT t.tgisinternal
     AND ((t.tgname = 'order_refunds_a7c_insert_guard_bi'
           AND t.tgfoid = 'public.pcm_a7c_refund_insert_guard()'::regprocedure)
       OR (t.tgname = 'order_refunds_a7c_immutable_guard_bu'
           AND t.tgfoid = 'public.pcm_a7c_refund_immutable_guard()'::regprocedure)
       OR (t.tgname = 'order_refunds_status_transition_bu'
           AND t.tgfoid = 'public.pcm_order_refund_status_transition()'::regprocedure))
     AND t.tgenabled = 'O';
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — 覆寫後 trigger 綁定/啟用命中 %/3;拒繼續', v_cnt;
  END IF;

  -- 11k. 三支被覆寫 trigger 函式 EXECUTE 仍收斂(非 owner 授權 0;原檔 §7 REVOKE 過,
  --      CREATE OR REPLACE 保留 ACL 是 PG 行為,但「不得把預設當乾淨」)
  --      🔴 proacl 為 NULL 時 aclexplode 回零列會讓下面的 count 斷言假綠(NULL=EXECUTE TO
  --      PUBLIC 預設、正是要防的那格)⇒ 先擋 NULL(code-reviewer R2 nit)。
  SELECT count(*) INTO v_cnt FROM pg_proc
   WHERE oid IN ('public.pcm_a7c_refund_insert_guard()'::regprocedure,
                 'public.pcm_a7c_refund_immutable_guard()'::regprocedure,
                 'public.pcm_order_refund_status_transition()'::regprocedure)
     AND proacl IS NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — 被覆寫 trigger 函式 proacl 為 NULL(=PUBLIC EXECUTE 預設)% 筆;拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_proc pr CROSS JOIN LATERAL aclexplode(pr.proacl) a
   WHERE pr.oid IN ('public.pcm_a7c_refund_insert_guard()'::regprocedure,
                    'public.pcm_a7c_refund_immutable_guard()'::regprocedure,
                    'public.pcm_order_refund_status_transition()'::regprocedure)
     AND a.grantee <> pr.proowner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — 被覆寫 trigger 函式出現非 owner EXECUTE 授權 % 筆;拒繼續', v_cnt;
  END IF;

  -- 11l. COMMENT 合約:initiate 8 碼全集 / finalize 3+6 碼+hold 第七稽核值
  SELECT obj_description(v_init, 'pg_proc') INTO v_txt;
  IF v_txt IS NULL
     OR NOT (v_txt LIKE '%INITIATED%' AND v_txt LIKE '%DUPLICATE_REQUEST%'
         AND v_txt LIKE '%ORDER_NOT_FOUND%' AND v_txt LIKE '%ORDER_NOT_REFUNDABLE%'
         AND v_txt LIKE '%ORDER_NO_CARD_TRANSACTION%' AND v_txt LIKE '%REFUND_LEDGER_FULL%'
         AND v_txt LIKE '%REFUND_IN_FLIGHT%' AND v_txt LIKE '%REFUND_NOTHING_LEFT%') THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — initiate COMMENT 未含 8 碼全集;拒繼續';
  END IF;
  SELECT obj_description(v_fin, 'pg_proc') INTO v_txt;
  IF v_txt IS NULL
     OR NOT (v_txt LIKE '%FINALIZED%' AND v_txt LIKE '%HELD_AMOUNT_MISMATCH%'
         AND v_txt LIKE '%REFUND_NOT_FOUND%' AND v_txt LIKE '%accepted%'
         AND v_txt LIKE '%deferred_not_captured%' AND v_txt LIKE '%rejected_out_of_range%'
         AND v_txt LIKE '%not_sent%' AND v_txt LIKE '%recovered_confirmed%'
         AND v_txt LIKE '%manual_failed%' AND v_txt LIKE '%accepted_amount_mismatch_hold%') THEN
    RAISE EXCEPTION 'RW1a 驗收失敗 — finalize COMMENT 未含碼全集(含第七稽核值);拒繼續';
  END IF;

  RAISE NOTICE 'RW1a 結構驗收全數通過(兩 RPC SECDEF/ACL/owner 三表對齊 / 簽章 / 表 ACL 未放寬 / RLS / 新欄 4 + CHECK 6 + index 2 / 三函式改版字面含 P7C15 / trigger 綁定 / COMMENT 碼全集)';
END;
$verify$;

COMMIT;

-- ============================================================
-- 🔴 回滾(forward-only;plan §6 — 一旦有真退款列,絕不重建表、帳本與 audit 永不刪):
--   ① 停 UI 入口(REFUND_UI_ENABLED off)
--   ② REVOKE EXECUTE ... FROM service_role(兩支)
--   ③ DROP FUNCTION admin_initiate_order_refund / admin_finalize_order_refund
--   ④ DROP INDEX order_refunds_request_id_key / order_refunds_single_processing_per_order
--   ⑤ 三支改版函式若需還原=以 20260801120000 / 20260725130100 原文重放 CREATE OR REPLACE
--   ⑥ S1-S3/S7 欄與 deferred 值 = 無害殘留,除非 Sean 另拍(0 列時可逆、有列後不可)
-- ============================================================
