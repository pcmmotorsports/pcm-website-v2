-- ============================================================
-- M-4b 生命週期 L5b-1:補償退款 —— refunds(父)+ refund_events(append-only 子)【v5 兩表版】
-- ============================================================
-- 真權威:docs/specs/2026-08-10-l5b-compensation-refund-plan.md(Sean 四點拍板 + 主視窗裁「拆兩表」)
-- 依賴:20260612150000(payment_charge_attempts)、20260809230000(L5a-M superseded 三欄)
-- 鐵則 12①③(錢 + DB 結構)。
--
-- 🔴 **為什麼是兩張表(主視窗裁 B;本片核心)**
--   單表版被 Fable **四發 probe 實證**:五條不變量 DB 其實擋不住、只能靠 L5b-2 自律 ——
--   而「靠自律」正是本片存在要消滅的東西。拆兩表之後,其中**三條變成 DB 保證**:
--     · **supersedes 存在性 + 同 attempt** → 父表 PK + **複合自我 FK**
--       `(attempt_id, supersedes_refund_id)` → `(attempt_id, id)`(靶 = `pr_attempt_id_uniq`)。
--       🔴 v4 只有單欄自我 FK ⇒ 只證「存在」、不證「是同一筆退款的重試鏈」:
--       重試鏈可跨 attempt / 跨 order 寫歪(三線審查實跑 ACCEPTED)。複合 FK 兩行修掉、零 trigger。
--     · **事件同 attempt**   → attempt_id 只存在父表,事件無從與它不一致
--     · **無環**             → 🔴 **BEFORE INSERT 前手可見守門**(`prl_no_cycle_guard`,SQLSTATE **P5B02**):
--       插入時 `supersedes_refund_id` 指向的列**必須當下就看得見**,看不見就擋
--       ⇒ 每列的前手嚴格早於自己 ⇒ 沿鏈走**不可能回到起點**。
--       ⛔ **v4 檔頭曾寫「父表 insert-only + FK ⇒ 構造上即 DAG、環插不進、不需要防環守門」——那句是錯的、已刪。**
--          PG 的 FK 是**語句末**檢查、不是逐列:單一 statement 的多列 INSERT 互指
--          (`VALUES (1,2),(2,1)`)**插得進去、COMMIT 後環仍在**(三線審查各自實測命中)。
--       · **合法代價的精確範圍(只寫實測到的,不寫「零代價」)**:
--         ✅ 已實測寫得進:**單列 INSERT**(正式 writer 的形狀)、以及**多列 `VALUES` 且後列指前列**
--            (`VALUES (根,NULL),(子,根)`;harness 格 `G-CHAIN-SAME-STMT`)——
--            BEFORE ROW 看得到同一 command 稍早**已處理**的列。
--         ⚠️ **未實測、且 PG 不保證**:`INSERT … SELECT`、data-modifying CTE 等**列處理順序未定**的寫法。
--            這些形狀下前手可能排在後面 ⇒ 合法的鏈會被**誤擋** `P5B02`。
--            方向是 **fail-closed**(誤擋合法,不會漏放環或跨 attempt 鏈),但那是**能力上限**、不是零代價。
--         ⇒ 🔴 **L5b-2 的 writer 一律一次插一列**,不得依賴同 statement 建鏈;
--            要支援其他形狀,先為那個形狀補 probe 再改本段字面。
--         ⇒ 綜合:守門讓 DAG 宣稱**變成真的**,代價是「順序未定的批次寫法不受支援」。
--       · 🔴 **與 B 線 OP2b 互鏈**:`20260810130000_m4b_e10_op2b_reversal_invariants.sql` 檔頭
--         「可見性的精確規則」段是**同一條 PG 語意**(後列看得到前列、前列看不到後列);
--         該片用 `P2B32` 擋、本片用 `P5B02` 擋,**兩片各自實測過**。動其中一片的語意請同時看另一片。
--       · **天花板(同 OP2b,逐條寫明、不假裝擋住)**:owner/superuser 可 `DISABLE TRIGGER`、
--         `session_replication_role='replica'`、或 DROP 掉本守門 —— **不宣稱防得住它們**。
--       · `pr_not_self_chk`(自環 CHECK)被本守門**嚴格蘊含**(BEFORE INSERT 時自己那列還看不見自己),
--         保留為守門停用時的第二層;判別力靠**分層突變**證(harness `MUT-no-cycle` / `MUT-not-self`)。
--   ⚠️ 仍**擋不住**的**五條**(誠實列;交 L5b-2 的 RPC 強制、**該片各配突變**):
--     ① **未知態禁重試(開新根 refund「或」沿鏈接手,兩種都算)** —— terminal 未落就換鍵再送;跨列狀態,row-local 判不了。
--     ② **write-ahead 順序** —— 本片零痕跡;唯一偵測面是 Record 對帳。
--     ③ **Σ 超退上界** —— 兩檔皆無總額約束:同一 attempt 開兩條根鏈各退 100 元照收(跨列 SUM,row-local 判不了)。
--     ④ **退款目標限「L5 讓路過的 attempt」** —— 對從未讓路的 pending attempt 開 refund 照收
--        (母 plan §3.2「寧漏勿誤」的主閘在 L5b-2,不在本表)。
--     ⑤ **lease token 當前性** —— DB 只驗 `>= 0`,驗不了「這把 token 是不是當前那把」。
--   🔴 **本清單本身也可能不完整**:它是「已知擋不住」的列舉,**不是「其餘全部擋得住」的證明**
--      (v4 曾列「兩條」並暗示那是全部,實為至少五條 —— 誠實邊界的完整性本身也會超稱)。
--   **本片不宣稱擋得住這五條。**
--
-- 🔴 權威矩陣(Sean 拍板):attempts 三欄=讓路身分 / TapPay Record=外部金流事實(唯一權威)/ 本兩表=本地決策與動作。
-- 🔴 **落檔宣告**:L5a-M(20260809230000)檔頭「補償紀錄=attempt 另一組欄」那句**作廢**
--   (已 apply 檔內改不了;掛帳 #369,主視窗已補 commit 241ff3b6)。
-- 🔴 ownership **不在本片**:沿用既有 sweeper lease(next_settle_at + settle_attempt_count token;
--   R1c1 20260624120008 已讓 released 也 claim 得到)。本片 UNIQUE 只管冪等,**不是第二套 ownership**。
-- 🔴 **與 Sean 核過的 v3 :126 的對應關係(主視窗指定寫明,免得下一輪審查誤判為偏離)**:
--   v3 逐字要求「amount/currency:intent **與 result_success** NOT NULL」——那是**單表**形狀下的寫法。
--   兩表版改成:**金額掛在父表、NOT NULL**,一列 refund = 一個金額;結果事件不帶金額。
--   ⇒ **語意等價**(每次物理退款嘗試都有確定金額、且 DB 強制),形狀不同。
--   ⚠️ 連帶語意:**部分退款多次 = 多條根鏈,各自帶自己的金額**(不是一條鏈上累加)。
--
-- 🔴 **金額單位 = 整數「元」**(code-reviewer 頭條):全庫慣例是元不是分(OP1 20260810100000:56,142 逐字)。
--   寫成「分」會讓 L5b-2 對 TapPay refund_amount **退 100 倍** —— 一行註解,但本輪最貴的一條。
--
-- ⛔ apply 停點:commit 後**不 apply**。🔴 apply 序:20260810130000(OP2b,已在 dev)須先於本檔;
--   本檔若先 apply 需 `--include-all`。
-- Rollback(forward-only):DROP TABLE public.payment_refund_events; DROP TABLE public.payment_refunds;
--   🔴 兩支函式**不隨表消失**,要各自 DROP(v4 漏列 ⇒ rollback 後會留下孤兒函式):
--   DROP FUNCTION IF EXISTS public.prl_append_only_guard(); DROP FUNCTION IF EXISTS public.prl_no_cycle_guard();
--   (trigger 隨 DROP TABLE 一起消失,不必單獨 DROP。)
-- ============================================================

BEGIN;

-- ── 父表:一列 = 一個 logical refund = 一次物理退款嘗試 = 一把鍵 ──────────────
CREATE TABLE public.payment_refunds (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE 一律預設 NO ACTION(不寫 CASCADE):兩表皆 append-only、父列永不刪
  -- ⇒ CASCADE 沒有合法觸發情境,而寫上去會在守門被繞過時放大破壞面。
  attempt_id           uuid        NOT NULL REFERENCES public.payment_charge_attempts(id),
  supersedes_refund_id uuid,       -- 🔴 重試鏈;FK 在下方(**複合**,綁同一 attempt)
  idempotency_key      text        NOT NULL,
  amount               integer     NOT NULL,   -- 🔴 整數**元**(全庫慣例,非分);禁浮點
  currency             text        NOT NULL,
  strong_key           text        NOT NULL,   -- 弱識別不得進退款路徑 ⇒ NOT NULL
  lease_token          integer     NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pr_amount_positive_chk    CHECK (amount > 0),
  CONSTRAINT pr_currency_domain_chk    CHECK (currency = 'TWD'),
  CONSTRAINT pr_lease_token_nonneg_chk CHECK (lease_token >= 0),
  CONSTRAINT pr_not_self_chk           CHECK (supersedes_refund_id IS DISTINCT FROM id),
  -- 🔴 NOT NULL 擋不掉空字串與純空白 ⇒ 弱鍵仍進得了退款路徑;btrim 後不得為空
  CONSTRAINT pr_idem_key_nonblank_chk   CHECK (pg_catalog.btrim(idempotency_key) <> ''),
  CONSTRAINT pr_strong_key_nonblank_chk CHECK (pg_catalog.btrim(strong_key) <> ''),
  -- 🔴 複合自我 FK 的靶:證「同一 attempt 下這個 id 存在」
  CONSTRAINT pr_attempt_id_uniq UNIQUE (attempt_id, id),
  -- 🔴 重試鏈**不得跨 attempt / 跨 order**(單欄 FK 只證存在、證不到這件事)
  -- MATCH SIMPLE:supersedes_refund_id IS NULL(根 refund)時本約束自動滿足。ON DELETE 同上不寫。
  CONSTRAINT pr_supersedes_same_attempt_fkey
    FOREIGN KEY (attempt_id, supersedes_refund_id)
    REFERENCES public.payment_refunds (attempt_id, id)
);
CREATE UNIQUE INDEX pr_idem_key_uniq   ON public.payment_refunds (idempotency_key);
CREATE UNIQUE INDEX pr_supersedes_uniq ON public.payment_refunds (supersedes_refund_id)
  WHERE supersedes_refund_id IS NOT NULL;
CREATE INDEX pr_attempt_idx ON public.payment_refunds (attempt_id, created_at);

-- ── 子表:append-only 事件 ────────────────────────────────────────────────
CREATE TABLE public.payment_refund_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id       uuid        NOT NULL REFERENCES public.payment_refunds(id),  -- ON DELETE 預設 NO ACTION(父列永不刪;不寫 CASCADE)
  event_type      text        NOT NULL,
  seq             integer     NOT NULL,
  lease_token     integer     NOT NULL,
  record_snapshot jsonb,
  created_at      timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pre_event_type_chk         CHECK (event_type IN ('sent','result_success','result_failed','result_unknown','reconcile','manual')),
  CONSTRAINT pre_seq_positive_chk       CHECK (seq > 0),
  CONSTRAINT pre_lease_token_nonneg_chk CHECK (lease_token >= 0)
);
CREATE UNIQUE INDEX pre_refund_seq_uniq   ON public.payment_refund_events (refund_id, seq);
CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)
  WHERE event_type IN ('result_success','result_failed','manual');
CREATE INDEX pre_refund_idx ON public.payment_refund_events (refund_id, created_at);

COMMENT ON TABLE public.payment_refunds IS
  'M-4b L5b 父表:一列=一個 logical refund=**一次物理退款嘗試=一把冪等鍵**(TapPay refund 鍵恆久消耗、絕不重用)。🔴 insert-only(append-only trigger);**複合**自我 FK `(attempt_id, supersedes_refund_id) → (attempt_id, id)` 串重試鏈 ⇒ 鏈不得跨 attempt。🔴 **無環靠 BEFORE INSERT 前手可見守門 `prl_no_cycle_guard`(P5B02),不是靠 FK** —— FK 是語句末檢查,單一 statement 多列互指插得進去(v4 檔頭那句「構造上即 DAG、不需要防環守門」已證為假、已刪);加了守門之後 DAG 才真的成立,而代價僅限「列處理順序未定的批次寫法(INSERT…SELECT / data-modifying CTE)可能被誤擋」——已實測的單列 INSERT 與多列 VALUES 後列指前列不受影響。🔴 金額為整數**元**(全庫慣例,非分)。🔴 ownership 不在本表:沿用既有 sweeper lease。';
COMMENT ON TABLE public.payment_refund_events IS
  'M-4b L5b 子表:append-only 事件流。`sent`=外呼已送出(write-ahead:父列與 sent 事件須先 commit 才准打 TapPay)。attempt 歸屬由父表決定 ⇒ 事件無從與它不一致。🔴 仍由 L5b-2 強制的**五條**(逐條見本片 migration 檔頭「仍擋不住的五條」):①未知態禁重試(開新根或沿鏈接手)②write-ahead 順序 ③Σ 超退上界 ④退款目標限讓路過的 attempt ⑤lease token 當前性。🔴 **該清單本身也可能不完整**。';

-- ── ACL:只由 SECDEF RPC 存取(owner 繞 RLS);非 owner 零權限 ────────────────
-- 🔴 初版曾 GRANT 給 payment_confirmer + zero-policy RLS = **靜默死表**(harness 實測抓到)。
REVOKE ALL ON TABLE public.payment_refunds       FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
REVOKE ALL ON TABLE public.payment_refund_events FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
ALTER TABLE public.payment_refunds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refund_events ENABLE ROW LEVEL SECURITY;

-- ── append-only:trigger 不是 ACL(ACL 只擋非 owner,而唯一寫入者是 owner)──
CREATE OR REPLACE FUNCTION public.prl_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  RAISE EXCEPTION '% 是 append-only:禁止 %(只接受 INSERT;更正事實請追加新事件列)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P5B01';
END
$fn$;
COMMENT ON FUNCTION public.prl_append_only_guard() IS
  'M-4b L5b:兩張退款表的 append-only 守門。🔴 trigger 而非 ACL —— ACL 只擋非 owner,唯一寫入者是 SECDEF RPC(owner);trigger 對 owner 照樣觸發。**ROW(UPDATE/DELETE)與 STATEMENT(TRUNCATE)兩種都掛**(FOR EACH ROW 對 TRUNCATE 不觸發)。SQLSTATE P5B01。⚠️ 誠實邊界:**table owner 或 superuser**(不只 superuser;而 owner 正是唯一寫入者)可 DISABLE/DROP trigger 或設 session_replication_role=replica 繞過 —— **不宣稱防得住它們**。';

-- ── 無環:BEFORE INSERT 前手可見守門(**不是** FK;FK 是語句末檢查、擋不住同 statement 互指)──
CREATE OR REPLACE FUNCTION public.prl_no_cycle_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NEW.supersedes_refund_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.payment_refunds p WHERE p.id = NEW.supersedes_refund_id) THEN
    RAISE EXCEPTION '退款重試鏈:前手 refund % 在插入當下不可見(不存在,或與本列在同一 statement 的更後面)—— 環與懸空指向一律不得寫入',
      NEW.supersedes_refund_id USING ERRCODE = 'P5B02';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.prl_no_cycle_guard() IS
  'M-4b L5b:退款重試鏈的**無環**守門。🔴 前手必須在插入當下**看得見** ⇒ 每列的前手嚴格早於自己 ⇒ 沿鏈走不可能回到起點。**FK 做不到這件事**:FK 在語句末檢查,單一 statement 的多列互指(VALUES (1,2),(2,1))兩列都存在 ⇒ FK 滿足、環仍在(三線審查實測)。**已實測的合法形狀**:單列 INSERT(正式 writer 的形狀)、多列 VALUES 且後列指前列 —— 照常寫得進(BEFORE ROW 看得到同一 command 稍早**已處理**的列)。⚠️ **未實測且 PG 不保證**:INSERT…SELECT / data-modifying CTE 這類**列處理順序未定**的寫法,前手可能排在後面 ⇒ 合法鏈被**誤擋**(fail-closed 方向、不會漏放環或跨 attempt 鏈)⇒ **L5b-2 一律一次插一列**,不得依賴同 statement 建鏈。SQLSTATE P5B02。🔴 同一條 PG 語意在 B 線 OP2b(20260810130000)以 P2B32 擋,兩片各自實測。⚠️ 天花板:owner/superuser 可 DISABLE/DROP trigger 或 session_replication_role=replica 繞過 —— **不宣稱防得住它們**。';

CREATE TRIGGER pr_no_cycle BEFORE INSERT ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION public.prl_no_cycle_guard();

CREATE TRIGGER pr_append_only           BEFORE UPDATE OR DELETE ON public.payment_refunds       FOR EACH ROW       EXECUTE FUNCTION public.prl_append_only_guard();
CREATE TRIGGER pr_append_only_truncate  BEFORE TRUNCATE         ON public.payment_refunds       FOR EACH STATEMENT EXECUTE FUNCTION public.prl_append_only_guard();
CREATE TRIGGER pre_append_only          BEFORE UPDATE OR DELETE ON public.payment_refund_events FOR EACH ROW       EXECUTE FUNCTION public.prl_append_only_guard();
CREATE TRIGGER pre_append_only_truncate BEFORE TRUNCATE         ON public.payment_refund_events FOR EACH STATEMENT EXECUTE FUNCTION public.prl_append_only_guard();

-- ── fail-closed 斷言:ACL(表級**與欄級**)+ 四個 trigger 皆 enabled ──────────
-- 🔴 欄級 attacl 那半=code-reviewer M7:同線 l5am/l5a1 早已寫成 relacl+attacl 全集 ⇒ 漏掉是回歸。
DO $$
DECLARE v_bad text; v_trig int;
BEGIN
  SELECT string_agg(x, ',' ORDER BY x) INTO v_bad FROM (
    SELECT 'tbl:' || c.relname || ':' || CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS x
      FROM pg_catalog.pg_class c, aclexplode(c.relacl) a
     WHERE c.oid IN ('public.payment_refunds'::regclass,'public.payment_refund_events'::regclass)
       AND a.grantee <> c.relowner
    UNION ALL
    SELECT 'col:' || c.relname || '.' || att.attname
      FROM pg_catalog.pg_attribute att
      JOIN pg_catalog.pg_class c ON c.oid = att.attrelid, aclexplode(att.attacl) a
     WHERE att.attrelid IN ('public.payment_refunds'::regclass,'public.payment_refund_events'::regclass)
       AND a.grantee <> c.relowner) t;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'L5b ACL 異常 — 非 owner 拿到 [%];本片只該由 SECDEF RPC 存取;拒繼續', v_bad;
  END IF;
  SELECT count(*) INTO v_trig FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid IN ('public.payment_refunds'::regclass,'public.payment_refund_events'::regclass)
     AND t.tgname LIKE '%append_only%' AND t.tgenabled = 'O';
  IF v_trig <> 4 THEN
    RAISE EXCEPTION 'L5b append-only trigger 應恰 4 個且皆 enabled,實得 %;拒繼續', v_trig;
  END IF;
  -- 🔴 防環守門分開數:名字不含 append_only,被上面那條算不到 ⇒ 漏掉會靜默通過
  SELECT count(*) INTO v_trig FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.payment_refunds'::regclass
     AND t.tgname = 'pr_no_cycle' AND t.tgenabled = 'O';
  IF v_trig <> 1 THEN
    RAISE EXCEPTION 'L5b 防環 trigger pr_no_cycle 應恰 1 個且 enabled,實得 %;拒繼續', v_trig;
  END IF;
END
$$;

COMMIT;
