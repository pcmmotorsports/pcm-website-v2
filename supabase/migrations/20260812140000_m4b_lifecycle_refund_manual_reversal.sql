-- ============================================================
-- M-4b 退款帳本 `manual` 沖銷(#405 + #417)
-- ============================================================
-- 規格權威 = `docs/specs/2026-08-11-refund-manual-reversal-plan.md` **v13**(§13=實跑、§14=折 R1、§15=折 R2、§16=折關卡2 codex)。
-- 審查鏈:關卡1 codex R1(8)+ R2(8)→ Q1=B 拍板 → codex R3(2)+ R2'(1 條駁回)
--         → **Fable R3 換模型(4 must-fix + 2 consider + 1 nit)** → 主視窗窄核 PASS(`P-538-A`)。
-- 拍板:Sean Q1=B(DB+RPC+讀取面一次到位)/ Q2=每筆終局至多被沖一次、修正走鏈狀 /
--       Q3=A(不限時、每次留痕)/ **Q-425=B**(有效 manual 且 refunded=false 視同 result_failed)。
--
-- ── 這支做什麼 ─────────────────────────────────────────────────────────────
-- 員工面只有一個動作:「修改這筆退款的人工判定」。系統面自動產一筆 `manual_reversal`
-- 把舊判定作廢、再寫一筆新的 `manual` —— 沖銷是 RPC 內部機制,不是員工要學的概念。
--
-- 🔴 **本片的一級交付物不是那三個欄位,是「有效事件」的正準語意**(plan §2d-1):
--   `payment_refund_effective_terminal` view 定義「這顆 refund 現在有效的終局是哪一筆」,
--   **所有讀取面一律消費它**,不得再自己問「有沒有 manual」。
--
-- ── 🔴 最重要的一件事:唯一性從**索引級**降成**trigger 級**(Fable R3 F1)──────────
-- 本片 DROP `pre_one_terminal_uniq`(舊 manual 被沖銷後仍佔著 refund_id,新 manual 必撞它,
-- 而 trigger 繞不過索引)。⇒「至多一個**有效**終局」改由 trigger 計數保證。
-- **代價**:計數的正確性完全靠「父列鎖 + read committed」。在 REPEATABLE READ 下,
-- 後到的交易取得父列鎖之後,它的快照**仍看不到兄弟剛提交的那一列** ⇒ 計數 0 ⇒ 放行
-- ⇒ **兩筆有效終局同時存在,而索引後盾已被本片拿掉、沒有任何一層接得住**。
-- ⇒ 故 **trigger 本體與 RPC 各有一道隔離閘(P8C01)**,形制逐字對照 `opa12` 的 G1
--   (`20260810210000:99-102`);本 repo 對這個形狀有實測案底(A2b1 的 P2B02)。
--
-- ── 回退 ───────────────────────────────────────────────────────────────────
-- `scripts/refund-manual-reversal-rollback.sql`。🔴 **回退鏈順序**:本片 → 2d → 2c。
-- 🔴🔴 **第一筆沖銷寫進去之後回退就永久關閉**(plan §5,已實測):沖銷會讓同一顆 refund
--   有兩筆 `manual`,而回退必須逐字還原的 `pre_one_terminal_uniq` 述詞含 `manual`
--   ⇒ 唯一索引物理上建不起來(23505),除非刪掉 append-only 的稽核列。
--   ⚠️ 但「回退關閉」≠「沒有出路」:語意要改**不必回退** —— view 與 trigger 都可以
--   `CREATE OR REPLACE` 換述詞、不動任何資料。真正關閉的只有「整個撤掉」這條路。
-- ============================================================

BEGIN;

-- 🔴 **code-reviewer R1 must-fix #1**:本片對 payment_refund_events 連取多次 ACCESS EXCLUSIVE
--    (三次 ADD COLUMN、DROP/ADD CONSTRAINT、ADD UNIQUE、DROP/CREATE INDEX、CREATE TRIGGER)。
--    少了 timeout,只要有一個未關的長交易持著該表,本片會**無限期等待**並把後面所有退款寫入
--    排在自己後面 ⇒ 錢的寫入面全停,且沒有任何機制讓它自己退開。
--    值逐字對齊同線(`20260811110000:67-69`、`20260811080000:64-66`)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ============================================================
-- ① 前置閘:確認**兩件**逐字等於 2d post-image,否則拒絕往下
--    🔴 **R1 nit #8**:這段原本自稱「庫的狀態逐字等於 2d post-image」——那超出它實際量的範圍。
--    它比的是:①`payment_refund_events` 的 **CHECK 集合** ②`pre_one_terminal_uniq` 的 **indexdef**。
--    **沒有**比 `pre_one_success_uniq`、沒有比三新欄不存在、沒有比 trigger 集合。
--    (post 面的完整集合斷言在 ⑩-7,那是 apply 之後才有意義的東西。)
-- ============================================================
-- 🔴 為什麼逐字而不是子字串:本片要 DROP 一個索引、換掉值域。若中間有別的片動過這兩者,
--    硬編碼的 DDL 會把那些改動**無聲吃掉**,而 post assert 比的正是吃完的結果 ⇒ 全綠。
--    (形制與教訓來源:`scripts/l5b2-2d-rollback.sql:86-101`。)
DO $rmr_pre$
DECLARE
  v_cons text;
  v_idx  text;
  v_n    bigint;
BEGIN
  -- 隔離閘也要守 apply 本身:DDL 在 RR 下對別的交易的可見性推論會失真。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION '沖銷片 前置閘:apply 必須在 read committed 下執行(實際=%)',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P8C01';
  END IF;

  SELECT COALESCE(pg_catalog.string_agg(
           c.conname || '=' || pg_catalog.pg_get_constraintdef(c.oid), ' | ' ORDER BY c.conname), '(空)')
    INTO v_cons
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.contype = 'c';

  IF v_cons IS DISTINCT FROM
     'pre_event_type_chk=CHECK ((event_type = ANY (ARRAY[''sent''::text, ''result_success''::text,'
     || ' ''result_confirmed''::text, ''result_failed''::text, ''result_unknown''::text,'
     || ' ''reconcile''::text, ''manual''::text])))'
     || ' | pre_lease_token_nonneg_chk=CHECK ((lease_token >= 0))'
     || ' | pre_manual_needs_verdict_chk=CHECK ((COALESCE((event_type <> ''manual''::text), false)'
     || ' OR COALESCE((jsonb_typeof((record_snapshot -> ''refunded''::text)) = ''boolean''::text), false)))'
     || ' | pre_seq_positive_chk=CHECK ((seq > 0))' THEN
    RAISE EXCEPTION '沖銷片 前置閘:payment_refund_events 的 CHECK 集合與 2d post-image **逐字不符** ⇒ '
                    '有別的片動過值域或約束。本片的 DDL 是硬編碼的,跑下去會把那些改動無聲吃掉。停下人工判斷。'
                    '實際=[%]', v_cons;
  END IF;

  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_idx
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
   WHERE i.indrelid = 'public.payment_refund_events'::regclass AND ic.relname = 'pre_one_terminal_uniq';

  IF v_idx IS DISTINCT FROM
     'CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id)'
     || ' WHERE (event_type = ANY (ARRAY[''result_confirmed''::text, ''result_failed''::text, ''manual''::text]))' THEN
    RAISE EXCEPTION '沖銷片 前置閘:pre_one_terminal_uniq 的定義與 2d post-image 逐字不符(或它已不存在)。'
                    '本片要 DROP 它並把唯一性交給 trigger ⇒ 定義不符表示前提已變。實際=[%]',
                    COALESCE(v_idx, '(不存在)');
  END IF;

  -- 資料現況只印不擋(apply 的人要看):`manual_reversal` 一旦寫入,回退就永久關閉(檔頭)。
  SELECT pg_catalog.count(*) INTO v_n FROM public.payment_refund_events;
  RAISE NOTICE '沖銷片 前置閘:payment_refund_events 現有 % 列', v_n;
  SELECT pg_catalog.count(*) INTO v_n FROM public.payment_refunds;
  RAISE NOTICE '沖銷片 前置閘:payment_refunds 現有 % 列', v_n;
END
$rmr_pre$;

-- ============================================================
-- ② 三欄(純加法、皆 nullable)+ 複合自我 FK
-- ============================================================
ALTER TABLE public.payment_refund_events
  ADD COLUMN reverses_event_id uuid,
  ADD COLUMN reversal_reason   text,
  ADD COLUMN actor             text;

COMMENT ON COLUMN public.payment_refund_events.reverses_event_id IS
  '非 NULL = 本列是沖銷列(event_type=manual_reversal),指向被它作廢的那一筆 manual。'
  '形制對照 order_payments.reverses_payment_id(20260810100000:215)。';
COMMENT ON COLUMN public.payment_refund_events.reversal_reason IS
  '只有沖銷列可以有,且必須非空白。稽核靠帳本列本身(本線不寫 admin_audit_log)。';
COMMENT ON COLUMN public.payment_refund_events.actor IS
  '經手人 staff.id。🔴 對「沖銷列」與「替代的新 manual 列」兩者皆必填,但約束是 NOT VALID '
  '⇒ **只約束未來列**;本片之前的舊列沒有這個欄位,它們的「誰做的」永遠拿不回來(plan §4 知情接受)。';

-- 🔴 **實作當天查 catalog 才發現的必要前置(plan v9 沒寫(v10 已補記於 §13-4))**:複合 FK 需要被參照側有唯一約束,
--    而現況 PK 只在 (id)(`payment_refund_events_pkey`)⇒ 先補 (refund_id, id) 唯一。
--    它是**純加法**:(id) 已唯一 ⇒ (refund_id, id) 必然唯一 ⇒ 對既有列不可能失敗。
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_refund_id_uniq UNIQUE (refund_id, id);

COMMENT ON CONSTRAINT pre_refund_id_uniq ON public.payment_refund_events IS
  '存在的唯一理由 = 撐起 pre_reversal_same_refund_fk 的複合 FK(PG 要求被參照欄有唯一約束)。'
  '🔴 不要因為「(id) 已經唯一、這條是多餘的」把它拿掉 —— 拿掉會讓那道 FK 一起倒。';

-- 🔴 **FK 必須複合、不能只指 id**(關卡1 R2):裸 (reverses_event_id) -> (id) 不保證同一顆 refund
--    ⇒ 可以跨 refund 指,而「鎖 A 的父列」就擋不住對 B 的影響。
--    「被指的必須是 manual」FK 表達不了,由 ⑥ 的 trigger 補。
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_reversal_same_refund_fk
  FOREIGN KEY (refund_id, reverses_event_id)
  REFERENCES public.payment_refund_events (refund_id, id);

-- ============================================================
-- ③ 值域加入 manual_reversal(嚴格放寬:只加一個允許值 ⇒ 既有列驗證不可能失敗)
-- ============================================================
ALTER TABLE public.payment_refund_events DROP CONSTRAINT pre_event_type_chk;
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_event_type_chk
  CHECK (event_type IN ('sent','result_success','result_confirmed','result_failed',
                        'result_unknown','reconcile','manual','manual_reversal'));

COMMENT ON CONSTRAINT pre_event_type_chk ON public.payment_refund_events IS
  '沖銷片:值域加入 manual_reversal。🔴 **它不是 terminal** —— 不進終局集合、不佔名額,'
  '只是「把某一筆終局標記成作廢」的那張紙(plan §2b-4)。';

-- ============================================================
-- ④ 唯一性換手:DROP 索引級、改 trigger 級;另加「一列最多被沖一次」
-- ============================================================
-- 🔴 為什麼非 DROP 不可(關卡1 R2 第一條):舊的 manual 被沖銷之後**仍然在索引裡佔著那個
--    refund_id** ⇒ 新的 manual 一定撞唯一索引,而 **trigger 繞不過索引**。
DROP INDEX public.pre_one_terminal_uniq;

-- 一列最多被沖一次(逐字對照 order_payments_one_reversal_uniq,20260810100000:387-389)
CREATE UNIQUE INDEX pre_one_reversal_uniq
  ON public.payment_refund_events (reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;

COMMENT ON INDEX public.pre_one_reversal_uniq IS
  '一筆 manual 最多被沖一次(Sean Q2:每筆終局至多被沖一次、要再改就沖新的那筆=鏈狀)。'
  '🔴 它索引的是 reverses_event_id ⇒ **擋不到「兩筆 terminal」**,那一層是 ⑥ 的 trigger + 父列鎖。';

-- ============================================================
-- ⑤ 形狀 CHECK
-- ============================================================
-- 🔴 全包 COALESCE(…, false):PG 的 CHECK 只擋 FALSE,求值 NULL 一律放行
--    (memory reference_pg-check-passes-on-null-use-coalesce-false)。
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_reversal_shape_chk
  CHECK (
    CASE WHEN event_type = 'manual_reversal' THEN
      COALESCE(reverses_event_id IS NOT NULL, false)
      AND COALESCE(pg_catalog.btrim(reversal_reason) <> '', false)
    ELSE
      COALESCE(reverses_event_id IS NULL, false)
      AND COALESCE(reversal_reason IS NULL, false)
    END
  );

-- actor:對「沖銷列」與「新的 manual 列」皆必填。
-- 🔴 **必須 NOT VALID**(關卡1 R2):一般 validated CHECK 會掃既有列,而本欄在本片之前不存在
--    ⇒ 舊列全是 NULL、apply 當場失敗。
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_actor_required_chk
  CHECK (
    COALESCE(event_type NOT IN ('manual','manual_reversal'), false)
    OR COALESCE(pg_catalog.btrim(actor) <> '', false)
  ) NOT VALID;

COMMENT ON CONSTRAINT pre_actor_required_chk ON public.payment_refund_events IS
  'NOT VALID = 只約束未來列。本片之前沒有 actor 欄 ⇒ 舊列的「誰做的」拿不回來(知情接受)。'
  '🔴 不要為了「乾淨」去 VALIDATE 它 —— 那會讓 apply 死在舊列上,而舊列不可能補得回來。';

-- ============================================================
-- ⑥ 🔴🔴 唯一性的新家:BEFORE INSERT trigger(索引級降級成 trigger 級的那一層)
-- ============================================================
-- **跨列不變量在 PG 裡就是 trigger 的活**(對照 op2b 為什麼用 trigger 而不是 CHECK,
--  `20260810130000:154-191`)——索引述詞不能引用別列,所以「排除已被沖銷者」寫不進索引。
CREATE OR REPLACE FUNCTION public.prl_one_effective_terminal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $prl_guard$
DECLARE
  v_n           bigint;
  v_target_type text;
  v_locked      uuid;
BEGIN
  -- ── G1 隔離閘(Fable R3 F1;**排最前**,形制逐字對照 opa12 的 G1 `20260810210000:99-102`)──
  -- 🔴 為什麼它是 must-fix 不是保險:本片 DROP 了 pre_one_terminal_uniq ⇒ 唯一性只剩下面那段計數。
  --    在 REPEATABLE READ 下,本交易取得父列鎖之後,快照**仍看不到兄弟剛提交的那一列**
  --    ⇒ 計數為 0 ⇒ 放行 ⇒ 兩筆有效終局同時存在,而**索引後盾已經不在、沒有任何一層接得住**。
  --    案底:A2b1 的 P2B02 隔離閘(memory project_m4b-a2b1-guard-decisions)。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'payment_refund_events:寫入必須在 read committed 下(實際=%)⇒ '
                    '本表的「至多一個有效終局」是 trigger 計數保證,RR/SERIALIZABLE 的快照會讓計數看不到'
                    '兄弟已提交的列,而索引後盾已於沖銷片移除。',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P8C01', CONSTRAINT = 'prl_isolation_guard';
  END IF;

  -- ── 沖銷列:不進終局集合、不佔名額;但要驗「被指的是同一顆 refund 的 manual」──────
  -- FK(pre_reversal_same_refund_fk)保證了「同一顆 refund」,**型別 FK 表達不了** ⇒ 這裡補。
  IF NEW.event_type = 'manual_reversal' THEN
    SELECT e.event_type INTO v_target_type
      FROM public.payment_refund_events e
     WHERE e.refund_id = NEW.refund_id AND e.id = NEW.reverses_event_id;

    IF v_target_type IS DISTINCT FROM 'manual' THEN
      RAISE EXCEPTION 'payment_refund_events:manual_reversal 只能指向同一顆 refund 的 manual 事件'
                      '(被指事件的型別=%)', COALESCE(v_target_type, '(找不到)')
        USING ERRCODE = 'P8C02', CONSTRAINT = 'prl_reversal_target_must_be_manual';
    END IF;

    RETURN NEW;
  END IF;

  -- ── 非終局事件(sent / result_success / result_unknown / reconcile):不受本閘管 ─────
  -- 🔴 `result_success` 在 2d 之後**不是終局**(受理成功 ≠ 錢已退出去,`20260811110000:191-192`)。
  IF NEW.event_type NOT IN ('result_confirmed','result_failed','manual') THEN
    RETURN NEW;
  END IF;

  -- ── 序列化點:鎖父列 ────────────────────────────────────────────────────────
  -- 🔴 `FOR NO KEY UPDATE` 不是 `FOR UPDATE`:子表 INSERT 的 FK 檢查會對父列取 KEY SHARE,
  --    而 NKU 與 KEY SHARE **相容**、與另一個 NKU **互斥** ⇒ 既序列化了兄弟、又不與自己的 FK 打架。
  --    用 FOR UPDATE 會與 KEY SHARE 相衝 ⇒ 40P01(本 repo A2b1 實測案底)。
  SELECT r.id INTO v_locked
    FROM public.payment_refunds r
   WHERE r.id = NEW.refund_id
     FOR NO KEY UPDATE;

  -- fail-closed:父列不存在 = 沒有序列化點 ⇒ 下面的計數不具保證,拒寫而不是靜默放行。
  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'payment_refund_events:找不到父列 payment_refunds(refund_id=%)⇒ '
                    '取不到序列化點,本閘的計數不具保證,拒絕寫入', NEW.refund_id
      USING ERRCODE = 'P8C03', CONSTRAINT = 'prl_parent_row_required';
  END IF;

  -- ── 有效終局計數(述詞與 ⑦ 的 canonical view **同一份語意**)───────────────────
  SELECT pg_catalog.count(*) INTO v_n
    FROM public.payment_refund_events e
   WHERE e.refund_id = NEW.refund_id
     AND e.event_type IN ('result_confirmed','result_failed','manual')
     AND NOT EXISTS (
           SELECT 1 FROM public.payment_refund_events rv
            WHERE rv.refund_id = e.refund_id
              AND rv.event_type = 'manual_reversal'
              AND rv.reverses_event_id = e.id);

  IF v_n > 0 THEN
    RAISE EXCEPTION 'payment_refund_events:refund % 已經有 % 筆**有效**終局事件 ⇒ 不得再寫。'
                    '要改判定請走 admin_correct_refund_manual_verdict(它會先沖銷舊的再寫新的)。',
                    NEW.refund_id, v_n
      USING ERRCODE = 'P8C04', CONSTRAINT = 'prl_one_effective_terminal';
  END IF;

  RETURN NEW;
END
$prl_guard$;

COMMENT ON FUNCTION public.prl_one_effective_terminal_guard() IS
  '沖銷片:取代 pre_one_terminal_uniq 的「至多一個有效終局」保證。'
  '🔴 正確性完全靠「G1 隔離閘 + 父列 FOR NO KEY UPDATE + read committed」這一組 —— '
  '索引後盾已於本片移除,這裡沒有第二層。改動本函式前先讀 plan §2b 與 §3-7。';

CREATE TRIGGER pre_one_effective_terminal
  BEFORE INSERT ON public.payment_refund_events
  FOR EACH ROW EXECUTE FUNCTION public.prl_one_effective_terminal_guard();

-- ============================================================
-- ⑦ 🔴🔴 一級交付物:canonical「有效事件」view
-- ============================================================
-- 契約(plan §2d-1):**所有讀取面一律消費它**,不得再自己問「有沒有 manual」。
-- `security_invoker` = 以呼叫者身分求值(view 本身不放權);零 GRANT ⇒ 只有 owner 與
-- 被明確授權的 SECDEF 函式讀得到,對照本線「表零 GRANT、寫入一律走 SECDEF RPC」的形制。
CREATE OR REPLACE VIEW public.payment_refund_effective_terminal
WITH (security_invoker = true) AS
SELECT
  e.refund_id,
  e.id         AS event_id,
  e.event_type,
  e.seq,
  e.created_at,
  -- 🔴🔴 indicates_refund = 「這個有效終局代表錢動過了嗎」。**Q-425=B 的落點只有這一欄**。
  --    fail-closed:判不出來一律當「錢動過」⇒ 算退款跡象 ⇒ needs_human ⇒ 保守。
  --    寫成 COALESCE(…, false) 就是 fail-**open**:判不出來就自動結清一張可能已退錢的單。
  --    ⚠️ 本 repo 通例的 COALESCE(…, false) 是**給 CHECK 用的**(CHECK 的 false 才擋得住),
  --       這裡是判定式,兩者的安全方向**相反**,不可照抄。
  --    🔴 CASE jsonb_typeof(...)(Fable R3 F4,實測):少了它,jsonb **字串** "true" 與 'true'::jsonb
  --       比較會求值成 **false 而不是 NULL** ⇒ COALESCE 根本不觸發 ⇒ 已退錢的單自動結清。
  COALESCE(
    e.event_type = 'result_confirmed'
    OR (e.event_type = 'manual'
        AND CASE pg_catalog.jsonb_typeof(e.record_snapshot -> 'refunded')
              WHEN 'boolean' THEN (e.record_snapshot -> 'refunded') = 'true'::jsonb
            END),
    true) AS indicates_refund
FROM public.payment_refund_events e
WHERE e.event_type IN ('result_confirmed','result_failed','manual')
  AND NOT EXISTS (
        SELECT 1 FROM public.payment_refund_events rv
         WHERE rv.refund_id = e.refund_id
           AND rv.event_type = 'manual_reversal'
           AND rv.reverses_event_id = e.id);

COMMENT ON VIEW public.payment_refund_effective_terminal IS
  'M-4b 沖銷片一級交付物:每顆 refund 的**有效終局**(終局集合 且 沒有 manual_reversal 指向它)。'
  '至多一列(由 pre_one_effective_terminal trigger 保證,不是由索引)。'
  'indicates_refund=錢動過了嗎:result_confirmed 或 manual+refunded=true 為 true;'
  'result_failed 或 **manual+refunded=false(Sean Q-425=B)** 為 false。'
  '🔴 所有讀取面一律消費本 view,不得自己再寫一份判定(plan §2d-1)。';

REVOKE ALL ON public.payment_refund_effective_terminal FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- ============================================================
-- ⑧ op6a 換吃 canonical view(plan §2d-1 契約 + §11-1 既存 drift 修正)
-- ============================================================
-- 🔴 **本體是從 `20260811030000` 的定義逐字抽出、只改 ②面那一段**(程式抽取、非手抄)——
--    手抄 200 行金流 SQL 正是 drift 的來源。其餘每一行與 op6a 原始定義位元相同。
-- 🔴 行為翻面(plan §11-4 表 A/B/C)**必須明列接受**,尤其 C:
--    同一顆 refund 有 `result_success` + `result_failed` 者,舊判 `needs_human`、新判**可結清**。
--    方向是「從保守變成自動結清」⇒ apply 檢查表要單獨列給 Sean。
-- 🔴 view/trigger/op6a 三者同一支 migration、同一交易切換(關卡1 R3 修法)—— 就是本檔。
CREATE OR REPLACE FUNCTION public.admin_compute_order_settlement(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE                       -- 唯讀;STABLE 而非 IMMUTABLE(讀表)
SECURITY DEFINER
SET search_path = ''
AS $fn$
WITH o AS (
  SELECT ord.id,
         ord.total,
         ord.subtotal,
         ord.payment_status::text AS ps,
         ord.cancelled_at,
         ord.cancelled_reason
    FROM public.orders ord
   WHERE ord.id = p_order_id
),
-- ── 收款面 ────────────────────────────────────────────────────────────────
pay AS (
  SELECT pg_catalog.count(*)                                        AS rows_n,
         -- 🔴 關卡2:不要 ::integer。sum() 回 bigint,硬轉會在溢位時**噴錯**而不是落 needs_human。
         coalesce(pg_catalog.sum(op.amount), 0)::bigint AS gross,
         pg_catalog.count(*) FILTER (
           WHERE op.received_at > pg_catalog.now())                 AS future_n
    FROM public.order_payments op
   WHERE op.order_id = p_order_id
),
-- 沖銷形狀:①指向同單既有列且金額為反號 ②同一列至多被沖一次
rev_bad AS (
  SELECT pg_catalog.count(*) AS n
    FROM public.order_payments r
   WHERE r.order_id = p_order_id
     AND r.reverses_payment_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.order_payments t
                      WHERE t.id = r.reverses_payment_id
                        AND t.order_id = r.order_id
                        AND t.amount = -r.amount)
),
rev_dup AS (
  SELECT pg_catalog.count(*) AS n
    FROM (SELECT r.reverses_payment_id
            FROM public.order_payments r
           WHERE r.order_id = p_order_id
             AND r.reverses_payment_id IS NOT NULL
           GROUP BY r.reverses_payment_id
          HAVING pg_catalog.count(*) > 1) d
),
-- ── 品項快照 ──────────────────────────────────────────────────────────────
-- 🔴 比的是 `subtotal` 不是 `total`:`20260604120000:112` 已有 DDL CHECK
--    `total = subtotal + shipping_fee - discount_total` ⇒ 再驗那條是恆真守門。
--    items 住在另一張表、**跨表這一段沒有 DDL 在守**,那才是會漂的地方。
items AS (
  SELECT pg_catalog.count(*)                                          AS n,
         coalesce(pg_catalog.sum(oi.line_total), 0)::bigint AS sum_line
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
),
-- ── 取消面(三處都看;Fable F11 核可 AND-of-negatives 的 fail-closed 方向)──
canc AS (
  SELECT (SELECT pg_catalog.count(*) FROM public.order_cancellations c
            WHERE c.order_id = p_order_id)
       + (SELECT pg_catalog.count(*) FROM public.order_cancellation_items ci
            WHERE ci.order_id = p_order_id) AS n
),
-- ── attempts 覆蓋(前提 5)─────────────────────────────────────────────────
-- 🔴 Fable F3:`order_payments` **無 attempt_id 欄**,唯一可行 join 鍵是 rec_trade_id;
--    但卡腿唯一鍵是 (order_id, rec_trade_id) 而 attempts 側 rec **全域唯一**
--    ⇒ 裸 rec join 會被「**別張單**的同 rec 卡腿」滿足。兩個鍵都要比。
att AS (
  SELECT pg_catalog.count(*) FILTER (WHERE a.status = 'charged') AS charged_n,
         pg_catalog.count(*) FILTER (
           WHERE a.status = 'charged'
             AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                              WHERE op.order_id     = a.order_id
                                AND op.rail         = 'card'
                                AND op.rec_trade_id = a.rec_trade_id)) AS uncovered_n
    FROM public.payment_charge_attempts a
   WHERE a.order_id = p_order_id
),
-- ── 退款面:**四個**來源(Fable F4)────────────────────────────────────────
ref AS (
  SELECT
    -- ① 訂單級舊帳本:只有 status='failed' 除外;`processing` 恆為跡象。
    --    🔴 **擋不掉什麼**(reviewer I3):四面裡只有這一面的除外值**沒有結構撐腰** ——
    --    ③ 的 failed 有 `orj_shape_failed` 保證 `refund_call_attempted_at IS NULL`、
    --    ② 的 failed 是 terminal 事件、④ 的 dismissed 有 status 一致性 CHECK;
    --    而 `order_refunds.status='failed'` **只有值域 CHECK**,沒有任何約束保證「外呼沒發生過」。
    --    ⇒ 若某天有人把已送出的退款標成 failed,這一面就會漏掉它。這是已知缺口,不是被守住的面。
    (SELECT pg_catalog.count(*) FROM public.order_refunds orf
      WHERE orf.order_id = p_order_id AND orf.status <> 'failed')                    AS old_n,
    -- ② L5b attempt 級 —— 🔴 **沖銷片改寫**:改吃 canonical view,不再自己問「有沒有 manual」。
    --    形狀刻意**維持原本的雙重否定**(plan §11-3):
    --      除外(不算跡象) ⇔ EXISTS(有效終局) AND NOT EXISTS(有效終局 且 indicates_refund)
    --    · **左半不能省**(Fable F5 原意):少了它,「零有效終局」(只有 `sent` 或只有
    --      `result_unknown` —— 兩個最危險的未知態)會被空集合當成「全 failed」而除外。
    --    · **不得簡化成單一 EXISTS(有效終局 AND NOT indicates_refund)**:那在 trigger 被繞過、
    --      同時存在兩筆有效終局(一 true 一 false)時會翻成 **fail-open**;現寫法仍 fail-closed。
    --    · 舊字面認 `result_success` 為終局,那是 2d 之前的殘留(plan §11-1 的既存 drift);
    --      新語意由 view 單一權威定義(`result_confirmed`/`result_failed`/`manual`)。
    (SELECT pg_catalog.count(*)
       FROM public.payment_refunds pr
       JOIN public.payment_charge_attempts a2 ON a2.id = pr.attempt_id
      WHERE a2.order_id = p_order_id
        AND NOT (
              EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                       WHERE et.refund_id = pr.id)
          AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                           WHERE et.refund_id = pr.id
                             AND et.indicates_refund)
        ))                                                                            AS l5b_n,
    -- ③ 在途退款工單:🔴 `failed` 態由 `orj_shape_failed`(20260731120000:395-400)硬性要求
    --    `refund_call_attempted_at IS NULL` ⇒ **DDL 保證外呼從未發生 = 錢確定沒動**,除外它安全。
    --    其餘六值(queued/processing/submitted/reconciling/completed/dead)全算跡象。
    (SELECT pg_catalog.count(*) FROM public.order_refund_jobs j
      WHERE j.order_id = p_order_id AND j.status <> 'failed')                        AS job_n,
    -- ④ 雙扣異常:走 Dashboard 退款、**不經 ①②** ⇒ 任何非 dismissed 列都算跡象
    (SELECT pg_catalog.count(*) FROM public.payment_double_charge_anomalies dc
      WHERE dc.old_order_id = p_order_id AND dc.status <> 'dismissed')               AS anom_n
),
-- ── 七條前提 P1-P7(每條以 IS TRUE 收斂;NULL 一律當 false)────────────────────────
prem AS (
  SELECT
    -- P1 訂單存在 + 狀態在**可判定集**內。
    --    🔴 五值(20260604120000:50 四值 + 20260725130000:45 partiallyRefunded),
    --    `refunded` / `partiallyRefunded` **排除**:退款帳本 2026-07-25 才建,更早的退款
    --    在庫內零跡象 ⇒ 「refunded + 四面皆空」會湊出「全 true 但錢已退」(Fable F1)。
    (o.ps IN ('unpaid','paid','partiallyPaid')) IS TRUE                    AS p1,
    -- P2 完全沒有取消痕跡(四處)
    (o.cancelled_at IS NULL
     AND o.cancelled_reason IS NULL
     AND canc.n = 0)                                    IS TRUE            AS p2,
    -- P3 品項快照完整
    (items.n > 0 AND items.sum_line = o.subtotal::bigint) IS TRUE          AS p3,
    -- P4 收款列形狀乾淨
    (pay.future_n = 0 AND rev_bad.n = 0 AND rev_dup.n = 0) IS TRUE         AS p4,
    -- P5 帳本覆蓋可信。🔴 branch 1 必須連 charged attempt 一起看(Fable F2):
    --    「unpaid + 零卡腿 + 有 charged attempt」= mark 半途死 / OP3 寫腿失敗,
    --    DB 裡明擺著錢動過(charged ⇒ rec_trade_id 非空,20260612150000:98),
    --    少了這一句會判 underpaid。
    (((o.ps = 'unpaid' AND pay.rows_n = 0 AND att.charged_n = 0))
      OR (pay.rows_n > 0 AND att.uncovered_n = 0))      IS TRUE            AS p5,
    -- P6 四個退款面全空
    (ref.old_n = 0 AND ref.l5b_n = 0 AND ref.job_n = 0 AND ref.anom_n = 0) IS TRUE AS p6,
    -- P7 金額落在 int4 範圍內(溢位 ⇒ 不可判定,而不是噴錯)
    -- 🔴 關卡2 R2:**溢位守門自己不能溢位**。第一版用 `abs(bigint)`:①`bigint` 最小值取 abs 會拋錯
    --    ②`gross - total` 可能**先溢位**才輪到 abs,而 SQL 的 AND **不保證求值順序**、擋不住。
    --    ⇒ 一律先轉 `numeric`(任意精度、不會溢位)再比範圍,且用 BETWEEN 不用 abs。
    (pay.gross::numeric BETWEEN -2147483648 AND 2147483647
     AND (pay.gross::numeric - o.total::numeric) BETWEEN -2147483648 AND 2147483647)
                                                        IS TRUE                   AS p7
    FROM o, pay, rev_bad, rev_dup, items, canc, att, ref
),
calc AS (
  SELECT o.total                                   AS receivable,
         pay.gross                                 AS gross,
         (pay.gross - o.total::bigint)             AS net,   -- R=0 才會用到(P6 為真時)
         prem.p1, prem.p2, prem.p3, prem.p4, prem.p5, prem.p6, prem.p7,
         (prem.p1 AND prem.p2 AND prem.p3 AND prem.p4 AND prem.p5 AND prem.p6
          AND prem.p7) AS all_ok,
         o.ps, pay.rows_n, att.charged_n, att.uncovered_n,
         items.n AS items_n, canc.n AS canc_n
    FROM o, pay, prem, att, items, canc
)
SELECT pg_catalog.jsonb_build_object(
  'scope',      'db_internal_only',
  'gross',      c.gross,
  -- 🔴 關卡2:**輸出數字的條件必須與 verdict 降級的條件是同一個**。
  --    第一版 refunded 只看 p6 ⇒ 歷史 payment_status='refunded' 且四本帳皆空時,
  --    verdict 是 needs_human 卻同時宣稱 `refunded: 0` —— 那正是本片存在的理由(假信心)。
  'refunded',   CASE WHEN c.all_ok THEN 0 ELSE NULL END,
  'receivable', CASE WHEN c.all_ok THEN c.receivable ELSE NULL END,
  'net',        CASE WHEN c.all_ok THEN c.net ELSE NULL END,
  'verdict',    CASE
                  WHEN NOT c.all_ok  THEN 'needs_human'
                  WHEN c.net = 0     THEN 'settled'
                  WHEN c.net < 0     THEN 'underpaid'
                  WHEN c.net > 0     THEN 'overpaid'
                  ELSE 'needs_human'          -- 🔴 NULL 兜底(Fable F6),不是裝飾
                END,
  -- 🔴 reasons **累積全部命中**,不是第一個 CASE 就短路:一張舊 paid 單可能同時零收款、
  --    有退款、有取消,值班要看到三個。
  'reasons',
    pg_catalog.to_jsonb(pg_catalog.array_remove(ARRAY[
      CASE WHEN NOT c.p1 THEN 'STATUS_NOT_DECIDABLE'        END,
      CASE WHEN NOT c.p2 THEN 'D_HAS_CANCELLATION'          END,
      CASE WHEN NOT c.p3 THEN 'D_NO_SNAPSHOT'               END,
      CASE WHEN NOT c.p4 THEN 'PAYMENT_ROW_SHAPE_ANOMALY'   END,
      -- P5 拆三碼:處置完全不同(前者=OP4 餵料、中者=線上寫入故障、後者=錢動過但單還 unpaid)
      CASE WHEN NOT c.p5 AND c.ps <> 'unpaid' AND c.rows_n = 0
             THEN 'G_LEDGER_NOT_BACKFILLED'                 END,
      CASE WHEN NOT c.p5 AND c.rows_n > 0 AND c.uncovered_n > 0
             THEN 'G_LEDGER_WRITE_GAP'                      END,
      CASE WHEN NOT c.p5 AND c.ps = 'unpaid' AND c.charged_n > 0
             THEN 'G_UNPAID_WITH_CHARGED_ATTEMPT'           END,
      CASE WHEN NOT c.p6 THEN 'R_REFUND_TRACE_PRESENT'      END,
      CASE WHEN NOT c.p7 THEN 'AMOUNT_OUT_OF_RANGE'           END
    ], NULL))
) FROM calc c
$fn$;

-- op6a 的 COMMENT / ACL 由 `20260811030000` 建立,`CREATE OR REPLACE` **不會動它們** ⇒ 本片不重下,
-- 免得把「只 REPLACE 函式本體」變成「順手改了權限」。
-- 🔴 **R1 must-fix #3**:這句原本寫「⑩ 會重驗它們沒被動到」——當時 ⑩ 只比 prosrc 與 prosecdef,
--    **沒有**比 COMMENT、ACL 與 search_path ⇒ 宣稱大於事實。已在 ⑩-5 補齊那三樣。
--    真正的風險形狀:有人把 CREATE OR REPLACE 改成 DROP+CREATE ⇒ ACL 回到 PUBLIC EXECUTE、
--    COMMENT 消失,而舊版 ⑩ 七組照樣全過(op6a 自己在 `20260811030000` 就記過這個 reviewer I4 舊傷)。

-- ============================================================
-- ⑨ RPC:員工面唯一動作「修改判定」(plan §2c)
-- ============================================================
-- 守門形制逐字對照 opa12(`20260810210000:99-172`)—— 同一條線、同一種錯誤語彙。
-- 🔴 `p_expected_event_id` 是併發正確性的本體、不是參數美觀(plan §2c):
--    只收 refund_id 的話,兩個交易同時修正時,後到者會**沖掉前一個剛寫進去的新 manual**,
--    兩邊都回成功而員工以為只改了一次。
-- 🔴 plan §2c 的「generation+1」是 v1 設計的殘句 —— `generation` 欄在 §2b 就被打掉重畫、
--    本表沒有這一欄。本片不實作它,改用 `(refund_id, seq)` 既有唯一序。
CREATE FUNCTION public.admin_correct_refund_manual_verdict(
  p_refund_id         uuid,
  p_expected_event_id uuid,
  p_actor             text,
  p_reason            text,
  p_refunded          boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $prmr$
DECLARE
  v_reason   text;
  v_locked   uuid;
  v_n        integer;
  v_cur_id   uuid;
  v_cur_type text;
  v_seq      integer;
  v_lease    integer;
  v_rev_id   uuid;
  v_new_id   uuid;
BEGIN
  -- ── G1 隔離閘(排最前;Fable R3 F1)────────────────────────────────────────
  -- 擋的是「呼叫端把交易開成 RR」;trigger 那道擋的是「繞過本 RPC 直接寫入」。兩邊都要。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:必須在 read committed 下呼叫(實際=%)⇒ '
                    '本片的「至多一個有效終局」是 trigger 計數保證,RR 快照看不到兄弟已提交的列。',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P8C01', CONSTRAINT = 'pcm_prmr_isolation';
  END IF;

  -- ── G2 actor:排在**任何資料讀取之前**(opa12 G2 同款:身分錯的呼叫拿不到任何帳本資訊)──
  IF p_actor IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:經手人 [%] 不存在或已停用 ⇒ 拒絕修改判定',
                    coalesce(p_actor, '(NULL)')
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_prmr_actor_invalid';
  END IF;

  -- ── G3 輸入驗(reason 一開始就正規化成單一變數,守門與寫入只用它)──────────────
  IF p_refund_id IS NULL OR p_expected_event_id IS NULL THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:refund 識別碼與期望事件識別碼皆必填'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_prmr_identity_missing';
  END IF;
  -- 🔴 `p_refunded` 不得為 NULL:它就是新判定本身,NULL 會寫出一筆讀不出判定的 manual
  --    (`pre_manual_needs_verdict_chk` 也會擋,但那是縱深;這裡具名拒才講得清楚)。
  IF p_refunded IS NULL THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:新判定(錢有沒有退出去)必填,不接受 NULL'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_prmr_verdict_missing';
  END IF;
  v_reason := pg_catalog.btrim(coalesce(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:修改理由必填'
                    '(錢帳上「為什麼把判定改掉」是稽核第一個問題)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_prmr_reason_required';
  END IF;

  -- ── G4 鎖父列(序列化點;NKU 而非 FOR UPDATE,見 trigger 那段的 40P01 契約)────────
  SELECT r.id INTO v_locked
    FROM public.payment_refunds r
   WHERE r.id = p_refund_id
     FOR NO KEY UPDATE;

  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:找不到 refund(%)'
                    ' ⇒ 取不到序列化點,拒絕寫入', p_refund_id
      USING ERRCODE = 'P8C03', CONSTRAINT = 'pcm_prmr_parent_row_required';
  END IF;

  -- ── G5 鎖後**重讀**現行有效終局(吃 canonical view,不自己再寫一份判定)───────────
  -- 🔴 先數再取:`SELECT INTO` 對多列**不報錯、靜默取第一列**。trigger 萬一被繞過而存在
  --    兩筆有效終局時,靜默取一列會讓本 RPC 沖掉「其中一筆」而另一筆還在 ⇒ fail-closed 擋掉。
  SELECT pg_catalog.count(*) INTO v_n
    FROM public.payment_refund_effective_terminal et
   WHERE et.refund_id = p_refund_id;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:refund % 沒有有效終局事件 ⇒ '
                    '沒有東西可以修正(本支只修既有判定,不建立新判定)', p_refund_id
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_prmr_no_effective_terminal';
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:refund % 竟有 % 筆有效終局 ⇒ '
                    '上游不變量已破(trigger 被繞過或停用),拒絕在破損狀態上寫入',
                    p_refund_id, v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_prmr_multiple_effective_terminal';
  END IF;

  SELECT et.event_id, et.event_type INTO v_cur_id, v_cur_type
    FROM public.payment_refund_effective_terminal et
   WHERE et.refund_id = p_refund_id;

  IF v_cur_type <> 'manual' THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:現行有效終局是 % ⇒ 本支只修正人工判定'
                    '(系統寫的終局要改請走對帳流程,不是把它沖掉)', v_cur_type
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_prmr_target_not_manual';
  END IF;

  -- ── G6 CAS:現行有效終局 ≠ 呼叫端看到的那筆 ⇒ 拒(併發正確性的本體)──────────────
  IF v_cur_id <> p_expected_event_id THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:你看到的判定(%)已經不是現行判定(%)'
                    ' ⇒ 期間有人改過,請重新讀取後再送出', p_expected_event_id, v_cur_id
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_prmr_cas_mismatch';
  END IF;

  -- ── G7 兩列寫入 ────────────────────────────────────────────────────────────
  -- `seq`:沿用既有 `(refund_id, seq)` 唯一序,取現有最大值往後接。
  -- `lease_token`:**沿用被沖那筆的值**。它的語意是「當時的 sweeper lease」,人工更正不是
  --   新的 lease;取 0 也不安全(0 是合法 lease token,不能當哨兵值)⇒ 不發明新值。
  SELECT pg_catalog.max(e.seq) INTO v_seq
    FROM public.payment_refund_events e
   WHERE e.refund_id = p_refund_id;

  SELECT e.lease_token INTO v_lease
    FROM public.payment_refund_events e
   WHERE e.id = v_cur_id;

  INSERT INTO public.payment_refund_events
         (refund_id, event_type, seq, lease_token, reverses_event_id, reversal_reason, actor)
  VALUES (p_refund_id, 'manual_reversal', v_seq + 1, v_lease, v_cur_id, v_reason, p_actor)
  RETURNING id INTO v_rev_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:沖銷列落 % 列(期望恰 1)⇒ '
                    '可能有 BEFORE INSERT trigger 把它吃掉了', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_prmr_row_count_reversal';
  END IF;

  INSERT INTO public.payment_refund_events
         (refund_id, event_type, seq, lease_token, record_snapshot, actor)
  VALUES (p_refund_id, 'manual', v_seq + 2, v_lease,
          pg_catalog.jsonb_build_object('refunded', p_refunded,
                                        'corrects_event_id', v_cur_id::text,
                                        'correction_reason', v_reason),
          p_actor)
  RETURNING id INTO v_new_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_refund_manual_verdict:新判定列落 % 列(期望恰 1)', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_prmr_row_count_manual';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'refund_id',         p_refund_id,
    'reversed_event_id', v_cur_id,
    'reversal_event_id', v_rev_id,
    'new_event_id',      v_new_id,
    'refunded',          p_refunded);
END
$prmr$;

COMMENT ON FUNCTION public.admin_correct_refund_manual_verdict(uuid, uuid, text, text, boolean) IS
  'M-4b 沖銷片:修正人工退款判定(SECURITY DEFINER、search_path='''')。一交易寫兩列 —— '
  '`manual_reversal`(指向現行 manual)+ 新的 `manual`(帶新 verdict);舊列不動(append-only)。'
  '七道:G1 隔離閘 P8C01 → G2 actor(排在任何資料讀取前)P2B42 → G3 輸入驗(reason 正規化、'
  'p_refunded 不得 NULL)→ G4 鎖父列 FOR NO KEY UPDATE → G5 鎖後重讀有效終局(先數再取;'
  '多於一筆=上游不變量已破 P2B20)→ G6 **CAS** p_expected_event_id(併發正確性本體)→ G7 兩列寫入 + row_count 守。'
  '🔴 員工面只看得到「修改判定」一個動作;沖銷與兩列寫入全在本支裡面。'
  '🔴 **重試契約**(R1 nit #11):`seq` 取自父列鎖下的 max(seq),但**非終局事件**'
  '(sent/result_unknown/reconcile)在 trigger 裡直接放行、**不取父列鎖** ⇒ sweeper 若在'
  '本支取完 max 之後提交一筆,兩發 INSERT 會撞 `pre_refund_seq_uniq` 得 23505、整支回滾。'
  '方向 fail-closed(不會寫壞),**重新呼叫一次即可**;呼叫端看到 23505 且約束名是'
  '`pre_refund_seq_uniq` 時應自動重試一次,不要當成使用者錯誤。';

-- ── ACL:只開 service_role(逐字對照 opa12 的開權段)──────────────────────────
REVOKE ALL ON FUNCTION public.admin_correct_refund_manual_verdict(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_correct_refund_manual_verdict(uuid, uuid, text, text, boolean)
  TO service_role;

-- 🔴 lease_token 的語意在本片被延伸,**寫成字面**(主視窗 P-542-A 條件 1):
--    沖銷列與更正後的 manual 列,其 lease_token **繼承自被沖那一列**,
--    **不是**寫入當下的 lease ⇒ 稽核時**不得**拿 lease_token 推斷寫入時間窗或 sweep 批次。
--    現況(2026-08-12 實查):全 repo 唯一讀這欄的地方就是本片的 RPC;沒有任何
--    匹配 / 去重 / lease 持有判斷吃它(`grep -rn 'lease_token *[=<>]'` 除 nonneg CHECK 外零命中)。
--    **失效條件**:哪天 sweeper 開始拿 lease_token 分組或做 CAS,這個繼承值就會讓晚到的
--    沖銷列被算進舊 sweep ⇒ 那一天要回頭改這裡,不能沿用。
COMMENT ON COLUMN public.payment_refund_events.lease_token IS
  '寫入當時的 sweeper lease。🔴 例外:manual_reversal 與「更正後的 manual」兩種列的值是'
  '**繼承自被沖那一列**、非寫入當下的 lease(沖銷片 admin_correct_refund_manual_verdict)'
  ' ⇒ 不得用本欄推斷寫入時間窗或 sweep 批次歸屬。';

-- ============================================================
-- ⑩ 結構斷言(全部在同一交易內;任一紅 = 整片回滾、不留半套)
-- ============================================================
-- 形制對照 opa12 `20260810210000:196-...`:**先驗再開權** —— 但本片的 GRANT 已在 ⑨ 下了,
-- 所以這裡是「開權後、COMMIT 前」的最後一道;任一紅整片回滾,不會留下開了權的半套狀態。
DO $prmr_post$
DECLARE
  v_txt text;
  v_n   integer;
BEGIN
  -- ── 1. trigger:存在 + 啟用 + 綁對函式 + BEFORE INSERT FOR EACH ROW ──────────────
  -- 🔴 只驗「存在」抓不到「還在但失效」(memory feedback_guard-checks-existence-not-effect)
  --    ⇒ 連 tgenabled 與 tgtype 一起驗;tgtype=7 = ROW(1) + BEFORE(2) + INSERT(4)。
  SELECT t.tgenabled::text || '/' || t.tgtype::text || '/' || p.proname
    INTO v_txt
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.payment_refund_events'::regclass
     AND t.tgname = 'pre_one_effective_terminal';

  IF v_txt IS DISTINCT FROM 'O/7/prl_one_effective_terminal_guard' THEN
    RAISE EXCEPTION '沖銷片 後置斷言:pre_one_effective_terminal 的 [啟用/時機/函式] 是 [%],'
                    '期望逐字 [O/7/prl_one_effective_terminal_guard]'
                    '(O=啟用、7=ROW+BEFORE+INSERT)。唯一性只剩這一層,它失效就沒有後盾。',
                    COALESCE(v_txt, '(不存在)');
  END IF;

  -- ── 2. 索引:舊的走了、新的在且是**唯一**索引 ────────────────────────────────
  IF pg_catalog.to_regclass('public.pre_one_terminal_uniq') IS NOT NULL THEN
    RAISE EXCEPTION '沖銷片 後置斷言:pre_one_terminal_uniq 竟然還在 ⇒ ④ 的 DROP 沒生效';
  END IF;

  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_txt
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_reversal_uniq')
     AND i.indisunique AND i.indisvalid;

  IF v_txt IS DISTINCT FROM
     'CREATE UNIQUE INDEX pre_one_reversal_uniq ON public.payment_refund_events'
     || ' USING btree (reverses_event_id) WHERE (reverses_event_id IS NOT NULL)' THEN
    RAISE EXCEPTION '沖銷片 後置斷言:pre_one_reversal_uniq 不存在 / 非唯一 / 未生效 / 定義被改。實際=[%]',
                    COALESCE(v_txt, '(不存在或不符 unique+valid)');
  END IF;

  -- ── 3. canonical view:security_invoker + 述詞的 fail-closed 方向 ──────────────
  -- 🔴 這一格是**定義層**斷言,不是行為斷言(plan §11-4 nit 逐字):`COALESCE(…, true)` 的
  --    NULL 路徑被 2c 的 verdict CHECK 擋成不可達 ⇒ 行為測不到它。
  --    它擋的是「有人順手把方向改成 fail-open」這個**編輯**,不是執行。
  --    ⇒ **不得**把本格說成「fail-open 已被測試擋住」。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = 'public.payment_refund_effective_terminal'::regclass
                    AND c.reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION '沖銷片 後置斷言:canonical view 沒有 security_invoker=true ⇒ 它會以 owner 身分求值,'
                    '等於在零 GRANT 的表上開了一條旁路';
  END IF;

  v_txt := pg_catalog.pg_get_viewdef('public.payment_refund_effective_terminal'::regclass, true);

  IF pg_catalog.strpos(v_txt, ', true) AS indicates_refund') = 0 THEN
    RAISE EXCEPTION '沖銷片 後置斷言:view 的 COALESCE 兜底值不是 true ⇒ 方向被改成 fail-open '
                    '(判不出來就自動結清一張可能已退錢的單)';
  END IF;
  IF pg_catalog.strpos(v_txt, 'jsonb_typeof') = 0 THEN
    RAISE EXCEPTION '沖銷片 後置斷言:view 少了 jsonb_typeof 的型別閘(Fable R3 F4)⇒ jsonb 字串 '
                    '"true" 會求值成 false 而不是 NULL,COALESCE 根本不觸發';
  END IF;

  -- ── 4. 零直權面:view 只有 owner 讀得到 ───────────────────────────────────────
  SELECT pg_catalog.count(*) INTO v_n
    FROM information_schema.role_table_grants g
   WHERE g.table_schema = 'public'
     AND g.table_name = 'payment_refund_effective_terminal'
     AND g.grantee <> 'postgres';

  IF v_n <> 0 THEN
    RAISE EXCEPTION '沖銷片 後置斷言:canonical view 有 % 筆 owner 以外的授權 ⇒ 零直權面不成立', v_n;
  END IF;

  -- ── 5. op6a:仍是 SECDEF、已改吃 view、舊字面已不在、ACL 沒被本片動到 ──────────
  SELECT p.prosrc INTO v_txt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_compute_order_settlement';

  IF pg_catalog.strpos(v_txt, 'payment_refund_effective_terminal') = 0 THEN
    RAISE EXCEPTION '沖銷片 後置斷言:op6a 沒有吃 canonical view ⇒ ⑧ 沒生效,'
                    '沖銷寫得進去但結清判定讀不到作廢(plan §2d-2:寫入面做完等於零)';
  END IF;
  IF pg_catalog.strpos(v_txt, '''result_success'',''result_failed'',''manual''') <> 0 THEN
    RAISE EXCEPTION '沖銷片 後置斷言:op6a 裡還留著 2d 之前的終局字面 ⇒ 舊述詞沒被換掉';
  END IF;

  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_compute_order_settlement(uuid)'::regprocedure
     AND p.prosecdef;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '沖銷片 後置斷言:op6a 不再是 SECURITY DEFINER ⇒ CREATE OR REPLACE 把屬性弄掉了';
  END IF;

  -- 🔴 **R1 must-fix #3 補齊**:⑧ 宣稱「COMMENT / ACL 沒被動到」⇒ 這裡真的去比,不是只比函式本體。
  --    風險形狀=有人把 CREATE OR REPLACE 改成 DROP+CREATE:ACL 回到 PG 預設的 PUBLIC EXECUTE、
  --    COMMENT 消失、`SET search_path` 也一起不見 —— 而只比 prosrc/prosecdef 的版本對這三樣全盲。
  IF pg_catalog.obj_description('public.admin_compute_order_settlement(uuid)'::regprocedure, 'pg_proc') IS NULL THEN
    RAISE EXCEPTION '沖銷片 後置斷言:op6a 的 COMMENT 不見了 ⇒ 很可能被 DROP+CREATE 重建過'
                    '(⑧ 宣稱只 REPLACE 函式本體)';
  END IF;

  SELECT pg_catalog.array_to_string(p.proconfig, ',') INTO v_txt
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_compute_order_settlement(uuid)'::regprocedure;
  -- 🔴 字面是 `search_path=""`(帶兩個雙引號)不是 `search_path=` —— 實跑量出來的,
  --    第一版憑推理寫成後者,apply 當場紅。
  IF v_txt IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '沖銷片 後置斷言:op6a 的 proconfig 是 [%],期望逐字 [search_path=""]' 
                    '(SECDEF 沒鎖 search_path = 可被搜尋路徑劫持)', COALESCE(v_txt, '(空)');
  END IF;

  SELECT pg_catalog.string_agg(g.grantee || CASE WHEN g.is_grantable = 'YES' THEN '(可轉授)' ELSE '' END, ', ')
    INTO v_txt
    FROM information_schema.role_routine_grants g
   WHERE g.routine_schema = 'public'
     AND g.routine_name = 'admin_compute_order_settlement'
     AND NOT (g.grantee = 'service_role' AND g.is_grantable = 'NO')
     AND g.grantee <> 'postgres';
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '沖銷片 後置斷言:op6a 的授權超出 service_role,或帶了轉授權:[%]'
                    ' ⇒ ⑧ 的「不動 ACL」宣稱不成立', v_txt;
  END IF;

  -- ── 6. RPC 的 ACL:只有 service_role,且不得帶 WITH GRANT OPTION ───────────────
  -- 🔴 grantee 對了還不夠(opa12 關卡2 R1 #2 實測):普通 GRANT 不會拔掉既有的 grant option。
  SELECT pg_catalog.string_agg(g.grantee || CASE WHEN g.is_grantable = 'YES' THEN '(可轉授)' ELSE '' END, ', ')
    INTO v_txt
    FROM information_schema.role_routine_grants g
   WHERE g.routine_schema = 'public'
     AND g.routine_name = 'admin_correct_refund_manual_verdict'
     AND NOT (g.grantee = 'service_role' AND g.is_grantable = 'NO')
     AND g.grantee <> 'postgres';

  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION '沖銷片 後置斷言:修改判定 RPC 的授權超出 service_role,或帶了轉授權:[%]', v_txt;
  END IF;

  -- ── 7. 三新欄 + 複合自我 FK + 兩條新 CHECK ────────────────────────────────────
  SELECT pg_catalog.count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'payment_refund_events'
     AND column_name IN ('reverses_event_id','reversal_reason','actor');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '沖銷片 後置斷言:三新欄只有 % 欄在', v_n;
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_txt
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass
     AND c.conname = 'pre_reversal_same_refund_fk';
  IF v_txt IS DISTINCT FROM
     'FOREIGN KEY (refund_id, reverses_event_id) REFERENCES payment_refund_events(refund_id, id)' THEN
    RAISE EXCEPTION '沖銷片 後置斷言:複合自我 FK 是 [%],期望逐字 '
                    '[FOREIGN KEY (refund_id, reverses_event_id) REFERENCES payment_refund_events(refund_id, id)]',
                    COALESCE(v_txt, '(不存在)');
  END IF;

  -- 🔴 **R1 must-fix #4**:原本只數兩條**新** CHECK ⇒ 對「既有約束被順手撤掉」全盲
  --    (§3-6 的驗收條款逐字是「既有約束**一條都沒被動到**」,而 ① 前置閘只比 apply **前**)。
  --    改成釘 post-image 的**完整集合**:名字逐字、按名排序、一次比完。
  SELECT pg_catalog.string_agg(c.conname, ',' ORDER BY c.conname) INTO v_txt
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass;

  IF v_txt IS DISTINCT FROM
     'payment_refund_events_pkey,payment_refund_events_refund_id_fkey,pre_actor_required_chk,'
     || 'pre_event_type_chk,pre_lease_token_nonneg_chk,pre_manual_needs_verdict_chk,'
     || 'pre_refund_id_uniq,pre_reversal_same_refund_fk,pre_reversal_shape_chk,pre_seq_positive_chk' THEN
    RAISE EXCEPTION '沖銷片 後置斷言:payment_refund_events 的約束集合與本片 post-image 逐字不符 ⇒ '
                    '既有約束被動到、或本片少建了東西。實際=[%]', COALESCE(v_txt, '(空)');
  END IF;

  -- 索引集合同理:`pre_one_success_uniq`(2d 建的「至多一筆 result_success」)不在本片射程,
  -- 但它跟本片 DROP 的那顆是鄰居 ⇒ 順手撤掉的風險最高,一起釘。
  SELECT pg_catalog.string_agg(i.indexname, ',' ORDER BY i.indexname) INTO v_txt
    FROM pg_catalog.pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename = 'payment_refund_events';

  IF v_txt IS DISTINCT FROM
     'payment_refund_events_pkey,pre_one_reversal_uniq,pre_one_success_uniq,'
     || 'pre_refund_id_uniq,pre_refund_idx,pre_refund_seq_uniq' THEN
    RAISE EXCEPTION '沖銷片 後置斷言:payment_refund_events 的索引集合與本片 post-image 逐字不符。'
                    '實際=[%]', COALESCE(v_txt, '(空)');
  END IF;

  RAISE NOTICE '沖銷片 後置斷言:七組全過(trigger 效力/索引換手/view 方向與零直權/op6a 已換吃 view/RPC ACL/欄與約束)';
END
$prmr_post$;

COMMIT;
