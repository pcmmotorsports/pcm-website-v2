-- ============================================================
-- M-4b · E10 第 1 批 · A7b-T:退款工作表的十支守門 trigger + 移除 dormant gate
-- 規格 = docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md v7 §5 / §7 / §10
-- 前置 = 20260731120000(A7b-M:兩表、36 CHECK、五道唯一性、七支 FK、dormant gate)
-- ============================================================
--
-- 🔴🔴 本檔「做不到什麼」(明文能力邊界,不得在任何地方宣稱超出;plan §5.4)
--
--   trigger 看得到:狀態圖、本地欄位、同表其他列(可鎖)、其他表的**已提交**內容。
--   trigger 看不到,以下全部是**第 3 批 worker 的 DoD 硬前置**,不是本片的防護:
--     ① TapPay Refund 是否真的成功;Record 的累計是 < / = / > target
--     ② baseline 與 D9 兩個證據欄**是不是真的來自 Record API** —— DB 無從驗證,是稽核要求
--     ③ 呼叫者以為自己持有哪一把 token ⇒ **token CAS 是 worker 的責任**,本片不強制
--     ④ worker 有沒有遵守「先 commit E2b 戳記、再發 HTTP」
--     ⑤ 🔴 worker 有沒有遵守「逾時 / 無回應時不得寫任何東西」
--        —— **這是 D7 失效的唯一入口**;D9 只把後果收斂成可偵測,不能取代這條紀律
--     ⑥ TapPay 對同一 bank_refund_id 重送的實際行為(自動重試完全依賴它,PCM **從未實測**)
--     ⑦ `corrected_by <> reviewed_by` 只保證**兩個 staff.id**,不保證兩個人
--     ⑧ 跨表 bank id 的併發、C2 的併發(plan §4.3 兩條合約債)
--
-- 🔴 本檔**不**證明的事(留給後續片,不得提前宣稱):
--   - 行為負測(哪一條規則實際擋得住哪一筆壞資料)= T2/T3a/T3b
--   - 突變證明(把規則改壞、測試必須轉紅)、ACL 32 格、鎖窗量測、rollback 實跑 = T4
--   本檔的驗收只到「**結構是我宣稱的那個結構**」+「gate 被移除過」。
--
-- 🔴 本檔的 SQLSTATE 與具名 ID 約定(plan §5.5;2026-07-30 實測背景):
--   普通 `RAISE EXCEPTION` 的 `CONSTRAINT_NAME` 是**空的** ⇒ 「負測斷言 constraint 名」
--   的紀律在 trigger 上會**整條失效**(A7-t 就踩過:全檔沒有一個 USING CONSTRAINT)。
--   ⇒ 本檔所有守門 RAISE 一律帶 `USING ERRCODE = 'P7B01', CONSTRAINT = '<具名 ID>'`。
--   ERRCODE 只用**一個**自訂碼:辨識力放在 CONSTRAINT 名(負測斷言的就是它),
--   多一套 ERRCODE 分類 = 第二份會與第一份漂移的真相,不建。
--   `P7B01` 與 repo 既有的 `P0001`(一般錯誤)、`PC001`(probe rollback 標記)不衝突。
--   🔴 本檔第 9.6 段有**自我測試**:當場 raise 一次再接住,證明這個自訂碼與 CONSTRAINT
--      真的能 round-trip —— 不然「所有負測都斷言 constraint 名」會建立在一個沒被驗過的假設上。
--
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 0. 前置 fail-closed:A7b-M 必須已套用,且 gate 必須還在 ═══════════════════
-- 🔴 為什麼要驗 gate 還在:對應 plan §10 的三方狀態矩陣情境 6/7。
--    若 gate 已不在,代表本片(或某個等價物)已經跑過 ⇒ 重跑會把守門裝第二次
--    ⇒ `CREATE FUNCTION` 撞名而死在中間。與其死在中間,不如在這裡明確停下。
DO $$
DECLARE
  v_gate_def text;
BEGIN
  IF to_regclass('public.order_refund_jobs') IS NULL
     OR to_regclass('public.order_refund_job_items') IS NULL THEN
    RAISE EXCEPTION
      'A7b-T 前置失敗 — order_refund_jobs / order_refund_job_items 不存在;'
      '本片依賴 20260731120000(A7b-M),請先套用它。';
  END IF;

  -- 🔴 **逐字驗 `CHECK (false)`,不是只驗同名存在(關卡2 F8)**:
  --    原本這一段只驗「有這個約束」、到 §9.7 才驗定義。兩者之間隔著整段建函式的時間,
  --    而 gate 若被改成 `CHECK (true)`,那段期間**表是可寫的且零守門**
  --    ⇒ 別的 session 可以塞進一筆無人看管的列並提交;本片後段就算回滾也收不回來。
  --    ⇒ 定義比對必須在**任何事情發生之前**。
  SELECT pg_get_constraintdef(oid) INTO v_gate_def
    FROM pg_constraint
   WHERE conrelid = 'public.order_refund_jobs'::regclass
     AND conname  = 'order_refund_jobs_dormant_until_triggers';

  IF v_gate_def IS NULL THEN
    RAISE EXCEPTION
      'A7b-T 前置失敗 — dormant gate 已不存在。'
      '⇒ 本片(或等價物)可能已套用過:對照 plan §10 三方狀態矩陣情境 6/7 判定,'
      '**不要盲目重跑**(CREATE FUNCTION 會撞名死在中間)。';
  END IF;

  IF v_gate_def IS DISTINCT FROM 'CHECK (false)' THEN
    RAISE EXCEPTION
      'A7b-T 前置失敗 — dormant gate 存在但定義不是 CHECK (false),實為 [%]。'
      '「約束存在」不等於「它擋得住」⇒ 立即停下,不得續行。', v_gate_def;
  END IF;

  -- 🔴 **migration ledger 一致性(關卡2 F7;plan §10 三方狀態矩陣情境 2 vs 3)**:
  --    情境 2 =「M 的 SQL 已 COMMIT 但版本沒登記」。那個狀態下**禁止重跑 M**
  --    (非冪等 `CREATE` 會撞),只能補登 ledger。
  --    如果本片在情境 2 就放行、還把 gate 移除,日後 `db push` 會重跑 M 而炸在中間。
  -- 🔴 條件式:本機 harness 用 psql 直接套 migration、**沒有** supabase_migrations schema
  --    ⇒ 該表不存在時略過本檢查(並明說略過),表存在時一律 fail-closed。
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260731120000'
    ) THEN
      RAISE EXCEPTION
        'A7b-T 前置失敗 — A7b-M 的物件在,但版本 20260731120000 未登記於 migration ledger '
        '(plan §10 情境 2)。⇒ **先補登 ledger**,不要重跑 M、也不要續跑 T。';
    END IF;
  ELSE
    RAISE NOTICE
      'A7b-T 前置:supabase_migrations.schema_migrations 不存在(本機 harness 情境),ledger 一致性檢查【已略過】';
  END IF;

  -- gate 在的話,兩表必為空(gate = CHECK(false) ⇒ 寫不進去)。非空 = plan §10 情境 4「不可能狀態」。
  IF EXISTS (SELECT 1 FROM public.order_refund_jobs)
     OR EXISTS (SELECT 1 FROM public.order_refund_job_items) THEN
    RAISE EXCEPTION
      'A7b-T 前置失敗 — dormant gate 仍在,但表非空(plan §10 情境 4 = 不可能狀態)。'
      '立即停機並回報,不得續行。';
  END IF;
END;
$$;

-- ══ 1. 共用:永久阻擋(DELETE / TRUNCATE / 子表 UPDATE)══════════════════════
-- 🔴 為什麼 DELETE / TRUNCATE 要永久擋(plan §5.3,同 A7-t 拍板 Q2=A「不留逃生門」):
--    表級 ACL **擋不住 owner 與 SECURITY DEFINER RPC**。歷史一被清,五道唯一索引
--    就**不再擋重退** —— 唯一性只對「還在表裡的列」有意義。
-- 🔴 本擋是 BEFORE trigger 無條件 RAISE、**不讀任何快照** ⇒ 與隔離級無關
--    (R3 已驗:`a7t-concurrency-probe.sh` 那條 RR 雙刪打的是快照依賴檢查,對本形狀無殺傷力)。
-- 🔴 刻意用 CREATE 而非 CREATE OR REPLACE(逐字沿用 `20260730140000:138-142` 的理由):
--    OR REPLACE 會保留既有函式的 owner 與 ACL ⇒ 若庫裡已有同名函式且授權給某自訂 grantee,
--    本片的 REVOKE 只收回列名的四個 role,那個 grantee 仍能 EXECUTE 一支 SECURITY DEFINER 函式。

-- 三支共用(jobs DELETE / items UPDATE / items DELETE)。
-- 🔴 具名 ID 靠 TG_ARGV[0] 帶進來,**不是**靠共用一個名字:
--    共用同一個 CONSTRAINT 名的話,負測分不出「紅在哪一支」,
--    刪掉其中一支 trigger、另一支仍會讓測試全綠 = 假覆蓋。
CREATE FUNCTION public.pcm_a7bt_block_write()
RETURNS trigger
LANGUAGE plpgsql
-- 🔴 本函式只 RAISE、不參照任何物件,但仍釘死 search_path:
--    §9.4 對 `pcm_a7bt_*` 一律要求,不留「這支例外」。
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    '退款工作表禁止此操作(% on %)—— 歷史一被清,五道唯一索引就不再擋重退。'
    '表級 ACL 擋不住 owner 與 SECURITY DEFINER RPC,本擋是縱深的第二層。'
    '如確需清理,走受控的 forward migration,不要 DISABLE 本 trigger。',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P7B01', CONSTRAINT = TG_ARGV[0];
END;
$$;

-- 兩支共用(jobs / items 的 TRUNCATE)。
-- 🔴 row-level trigger 對 TRUNCATE **完全不觸發**(逐字沿用 `20260725130100:255-257`)
--    ⇒ 必須另掛 STATEMENT 級,否則 TRUNCATE 會靜默清空、上面那支一次也不會跑。
CREATE FUNCTION public.pcm_a7bt_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
-- 🔴 同上:只 RAISE、不參照物件,仍釘死 search_path 以維持 §9.4 的無例外規則。
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    '退款工作表禁止 TRUNCATE(%)—— row-level trigger 對 TRUNCATE 不觸發,'
    '清空後五道唯一索引與世代鏈**靜默失效**。'
    '也不要改用逐列 DELETE:那條路徑由 pcm_a7bt_block_write 擋住。', TG_TABLE_NAME
    USING ERRCODE = 'P7B01', CONSTRAINT = TG_ARGV[0];
END;
$$;

-- ══ 2. 逐 edge 的 allowed-delta 白名單(plan §5.2-4)═══════════════════════════
-- 🔴🔴 這一段關掉的是 plan v6 反覆出現卻沒定義的那句話:「其餘欄不得改」。
--    沒有機械定義會出現**兩種方向相反的壞法**,而且兩種都測得出綠:
--      ① 漏比 `last_refund_call_at` ⇒ **放行竄改**(D9b 的錨點被搬走 = 隔日閘失效)
--      ② 把自動欄 `updated_at` 也列為不可變 ⇒ **合法 edge 永遠失敗**
--
-- 🔴 實作選擇:**用 `to_jsonb(OLD)` / `to_jsonb(NEW)` 逐 key 比對,不宣告 42 欄清單。**
--    規格原本要求「全欄位 canonical manifest + deny-by-default」。用 jsonb 逐 key 比對
--    可以**免費得到 deny-by-default 且結構上不可能漂移**:
--      - 新增一欄 ⇒ 它不在任何白名單裡 ⇒ 自動落入「必須 IS NOT DISTINCT FROM OLD」
--        ⇒ 想改它一定被擋。宣告式清單反而要靠人記得去加,忘了就是靜默放行。
--      - 少一欄 / 改名 ⇒ 第 9.2 段的欄位 manifest 斷言會轉紅(那份宣告留在驗收層,
--        它的作用是「表還是不是我以為的表」,不是「哪些欄可以改」)。
--    ⇒ 兩件事分兩層做:**可變性**用 jsonb 自動涵蓋、**結構身分**用宣告式 manifest 釘死。
--
-- 🔴 這個做法的天花板(不得省略):比對的是 **jsonb 表示法**,不是型別原生值。
--    對本表 42 欄全部是 uuid / text / integer / boolean / timestamptz,jsonb 表示法一對一;
--    同一 statement 內 OLD 與 NEW 用同一組 session 設定渲染 ⇒ 相等性被保留。
--    若未來加入 float / jsonb / range 欄,這個假設要重新檢查。
-- 🔴 附帶好處:jsonb 的 NULL 是 `jsonb 'null'`(不是 SQL NULL)
--    ⇒ `IS DISTINCT FROM` 天生 NULL-safe,不會踩本 repo 燒過很多次的「天真 `=` 遇 NULL 靜默放行」。
--
-- 🔴 `status` 與 `updated_at` 是**每條 edge 都在白名單內**的自動欄,明列、不靠慣例。
--    `status` 的實際值由 classifier 的 OLD→NEW 配對釘死,白名單放行它不等於不管它。
CREATE FUNCTION public.pcm_a7bt_allowed_delta(p_edge text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
-- 🔴 本函式不參照任何資料庫物件(純 CASE 回傳字面陣列)⇒ search_path 對它沒有影響。
--    仍然釘死:§9.4 對 `pcm_a7bt_*` 一律要求釘死 search_path,
--    留一個「這支例外」等於在稽核規則上開一個要靠人記得的洞。
--    副作用僅有「帶 SET 的 SQL 函式不會被 planner inline」,每次 UPDATE 呼叫一次,可忽略。
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_edge
    -- lease 錨點 + 清 next_retry_at
    WHEN 'E1'  THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at','next_retry_at']
    -- baseline 成對初始化
    WHEN 'E2'  THEN ARRAY['status','updated_at','refunded_before','refunded_target']
    -- 呼叫戳記(D6);last_refund_call_at 每次更新、單調不減
    WHEN 'E2b' THEN ARRAY['status','updated_at','refund_call_attempted_at','last_refund_call_at']
    -- lease 重領(確定未打款)
    WHEN 'E3'  THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at']
    -- 不確定送出 ⇒ 進對帳
    WHEN 'E3b' THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at','next_check_at']
    -- 成功送出:唯一可首寫 tappay_refund_id 的 edge
    WHEN 'E4'  THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at','next_check_at','tappay_refund_id']
    -- 明確失敗
    WHEN 'E5'  THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at',
                          'refund_call_attempted_at','next_retry_at','failed_reason','retry_count']
    -- 第六次明確失敗 ⇒ dead
    WHEN 'E5b' THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at',
                          'refund_call_attempted_at','next_retry_at','failed_reason','retry_count',
                          'dead_reason','manual_review_required']
    -- 🔴 next_retry_at **刻意不在**白名單:E6 只准「保留」不准「重算」(plan §3.1 E6)。
    --    不列 = 自動被要求 IS NOT DISTINCT FROM OLD ⇒ 這條規則不需要另寫一行檢查。
    WHEN 'E6'  THEN ARRAY['status','updated_at','failed_reason']
    WHEN 'E8'  THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at']
    WHEN 'E9'  THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at','next_check_at','refund_id']
    WHEN 'E10' THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at','next_check_at','check_fail_count']
    WHEN 'E11' THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at']
    WHEN 'E12' THEN ARRAY['status','updated_at','claim_token','claimed_at','claim_expires_at','next_check_at',
                          'dead_reason','manual_review_required','check_fail_count']
    -- 結案:review 三欄 + D9 兩證據欄
    WHEN 'E13' THEN ARRAY['status','updated_at','reviewed_at','reviewed_by','resolution',
                          'retry_auth_recorded_refunded','retry_auth_checked_at']
    -- 🔴 更正結案(D11):reviewed_at / reviewed_by **不在**白名單 —— 原始結案人是稽核痕跡
    WHEN 'E14' THEN ARRAY['status','updated_at','resolution',
                          'retry_auth_recorded_refunded','retry_auth_checked_at',
                          'corrected_at','corrected_by','correction_reason']
    ELSE NULL
  END;
$$;

-- ══ 3. BEFORE INSERT 守門(plan §5.1)═════════════════════════════════════════
CREATE FUNCTION public.pcm_a7bt_jobs_before_insert()
RETURNS trigger
LANGUAGE plpgsql
-- 🔴 **SECURITY INVOKER**(plan §4.5 第 470-471 行逐字要求;關卡2 抓到我原本寫 DEFINER)。
--    規格的門檻是「只有寫出『INVOKER 下具體缺哪一個權限、在哪一行會炸』才准改 DEFINER」。
--    **本機實測結果 = 一個都不缺**:service_role 對 order_refunds / order_items /
--    order_refund_items / order_refund_jobs / order_refund_job_items / staff 六張表
--    全部 `has_table_privilege(...,'SELECT') = true`,且 service_role 是 **BYPASSRLS**
--    ⇒ 五張 RLS zero-policy 表也讀得到。**沒有正當理由用 DEFINER。**
--    ⇒ 改回 INVOKER 同時消掉「多一個以 owner 權限起跑的入口」這整個攻擊面。
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev public.order_refund_jobs%ROWTYPE;
BEGIN
  -- ── 3.1 所有世代一律:必須從 queued 起跑,且所有「歷程欄」必須空白 ──
  -- 🔴 沒有這條,呼叫者可以直接 INSERT 一列 status='completed' 的假完成單
  --    (A7 的同型漏法:trigger 只掛 BEFORE UPDATE ⇒ 可直接 INSERT 成終態繞過整個狀態機)。
  IF NEW.status IS DISTINCT FROM 'queued' THEN
    RAISE EXCEPTION 'A7b job INSERT 必須是 queued,收到 %', NEW.status
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_must_be_queued';
  END IF;

  IF NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.claim_expires_at IS NOT NULL
     OR NEW.refund_call_attempted_at IS NOT NULL OR NEW.last_refund_call_at IS NOT NULL
     OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_by IS NOT NULL OR NEW.resolution IS NOT NULL
     OR NEW.retry_auth_recorded_refunded IS NOT NULL OR NEW.retry_auth_checked_at IS NOT NULL
     OR NEW.corrected_at IS NOT NULL OR NEW.corrected_by IS NOT NULL OR NEW.correction_reason IS NOT NULL
     OR NEW.dead_reason IS NOT NULL OR NEW.refund_id IS NOT NULL OR NEW.tappay_refund_id IS NOT NULL
     OR NEW.refunded_before IS NOT NULL OR NEW.refunded_target IS NOT NULL
     OR NEW.next_retry_at IS NOT NULL OR NEW.next_check_at IS NOT NULL
     OR NEW.failed_reason IS NOT NULL THEN
    RAISE EXCEPTION 'A7b job INSERT:歷程欄必須全為 NULL(新單不得帶既往狀態)'
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_history_must_be_null';
  END IF;

  IF NEW.retry_count <> 0 OR NEW.check_fail_count <> 0 OR NEW.manual_review_required <> false THEN
    RAISE EXCEPTION 'A7b job INSERT:三個計數/旗標欄必須是起始值(0 / 0 / false)'
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_counters_must_be_initial';
  END IF;

  -- ── 3.2 跨表 bank id 唯一(plan §4.3:U4 擋不住跨表重用)──
  -- 🔴 U4 只是**本地 order_refund_jobs 內**的唯一索引。一個已經寫進帳本
  --    (order_refunds.bank_refund_id)的值被拿來開新 job,U4 完全不會響。
  -- ⚠️ 誠實邊界:這是**查詢**不是宣告式約束 ⇒ 擋不住「job INSERT 與 ledger INSERT 同時」
  --    (plan §4.3 併發合約債 1;PostgreSQL 無法做跨表宣告式唯一)。
  IF EXISTS (SELECT 1 FROM public.order_refunds WHERE bank_refund_id = NEW.bank_refund_id) THEN
    RAISE EXCEPTION 'A7b job INSERT:bank_refund_id % 已存在於 order_refunds(跨表重用)', NEW.bank_refund_id
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_bank_id_crosstable_reuse';
  END IF;

  -- ── 3.3 後代(generation > 1):必須接在「已授權重試的直接前代」之後 ──
  IF NEW.generation > 1 THEN
    -- 🔴🔴 **世代序列化鎖(關卡2 F2 + Sean 07-31 拍 Q4=A)**:先鎖 cancellation 那一列。
    --    為什麼不能只靠下面那把「鎖最大世代列」的 FOR UPDATE:
    --      E14(更正結案)要檢查「本世代尚無後繼」,而在 READ COMMITTED 下,
    --      **UPDATE 只會重新讀取它自己那一列**(EvalPlanQual),
    --      trigger 內對**其他列**的查詢仍用舊快照(PostgreSQL 官方明列的
    --      「updating command 可能看到不一致快照」)⇒ E14 看不到剛被插入的後代。
    --    ⇒ 兩條路徑必須搶**同一把、且與被查的列無關**的鎖 = cancellation 列本身。
    --    ⇒ 取得鎖之後的每一個查詢都是新 statement ⇒ READ COMMITTED 下拿到新快照。
    --    鎖序固定:**先 order_cancellations、後 order_refund_jobs**(避免與 E14 互鎖)。
    PERFORM 1 FROM public.order_cancellations WHERE id = NEW.cancellation_id FOR UPDATE;

    -- 鎖住該取消的最大世代列。
    -- 🔴🔴 **本段原本的註解在 2026-07-31 T3a 併發實跑下被推翻,已更正。**
    --    舊文(逐字):「併發正確性的真正來源是 U1,不是這把鎖……最後紅在 U1 的 23505;
    --    拿掉 U1 會產生第二次退款,拿掉這把鎖不會;併發負測必須斷言 U1 的 constraint 名。」
    --    那段話寫於上面那把 cancellation 列鎖(關卡2 F2 / Sean 拍 Q4=A)加進來**之前**。
    -- **實測**(`scripts/a7bt-negative-state.sh` §7.4-6,獨立資料庫 + barrier):
    --    後者先被擋在上面 `PERFORM … order_cancellations … FOR UPDATE` 這**一個獨立 statement**;
    --    解鎖後下面這個 SELECT 是新 statement,READ COMMITTED 下取得**新快照**、看得到剛提交的後代
    --    ⇒ 紅在 `a7bt_insert_not_direct_successor`,**不是** U1 的 23505。
    --    「解鎖後不會重跑 ORDER BY」講的是同一 statement 內的 EvalPlanQual,已不是實際路徑。
    -- 🔴 **反事實已就地驗證**:把 U1 整條 DROP 再跑同一個競賽,後者**仍**紅在
    --    `a7bt_insert_not_direct_successor`、gen2 仍恰一列 ⇒ 舊文「拿掉 U1 會產生第二次退款」
    --    在這個競賽形狀下不成立。⚠️ 但**不表示 U1 可以拿掉** —— 守門被 DISABLE 的 break-glass
    --    情境下它是唯一還在的一層(§7.4-20 的 U2 負測就是那個情境)。
    --    其餘競賽形狀(前者 abort、後者先到)未測。
    SELECT * INTO v_prev
      FROM public.order_refund_jobs
     WHERE cancellation_id = NEW.cancellation_id
     ORDER BY generation DESC
     LIMIT 1
       FOR UPDATE;

    -- 🔴 NOT FOUND 必須 RAISE,不得 CONTINUE / 略過
    --    (`a7t-concurrency-probe.sh:76` 的 `CONTINUE WHEN NOT FOUND` 是同型漏法:
    --     查無前代時靜默放行 = 任何人都能直接開一張 generation=2 的單)。
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A7b job INSERT:generation=% 但該取消一列 job 都沒有', NEW.generation
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_no_predecessor';
    END IF;

    IF v_prev.generation IS DISTINCT FROM NEW.generation - 1 THEN
      RAISE EXCEPTION 'A7b job INSERT:generation=% 的直接前代必須是 %,實為 %',
        NEW.generation, NEW.generation - 1, v_prev.generation
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_not_direct_successor';
    END IF;

    IF v_prev.status IS DISTINCT FROM 'dead' THEN
      RAISE EXCEPTION 'A7b job INSERT:前代必須是 dead,實為 %', v_prev.status
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_predecessor_not_dead';
    END IF;

    -- 🔴 這一條是「不會退第二次錢」的承重點之一(D7 的下游):
    --    前代必須被人明確結案成「授權重試」。over_refunded / reconcile_exhausted
    --    這種**已被 TapPay 受理**的死因,由 D7 的 CHECK 擋在結案那一步。
    IF v_prev.resolution IS DISTINCT FROM 'retry_authorized' THEN
      RAISE EXCEPTION 'A7b job INSERT:前代 resolution 必須是 retry_authorized,實為 %',
        coalesce(v_prev.resolution, '(NULL)')
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_predecessor_not_authorized';
    END IF;

    -- 🔴 D1:**不戳前代任何欄位**。
    --    v2 曾設計「戳 retry_consumed_at 表示已消耗」,那是死結:可被消耗的前代必然已結案
    --    ⇒ reviewed_at IS NOT NULL ⇒ 而 dead 只允許 E13 且要求 OLD.reviewed_at IS NULL
    --    ⇒ 任何要戳前代的 UPDATE 都會被自己的守門拒絕。

    -- ── 3.4 後代 payload 逐欄等於直接前代 ──
    -- 🔴 一律 IS NOT DISTINCT FROM(不是 `=`):多數欄 nullable,天真 `=` 遇 NULL
    --    整式為 NULL ⇒ 「不等才 RAISE」靜默放行。
    -- 例外六欄:id / generation / bank_refund_id / request_id / created_at / updated_at。
    --   bank_refund_id 必須是**全新**的(世代重試不能靠 TapPay 冪等鍵,plan §3.4 表)。
    IF NEW.order_id            IS DISTINCT FROM v_prev.order_id
       OR NEW.rec_trade_id     IS DISTINCT FROM v_prev.rec_trade_id
       OR NEW.payload_hash     IS DISTINCT FROM v_prev.payload_hash
       OR NEW.refund_amount    IS DISTINCT FROM v_prev.refund_amount
       OR NEW.items_amount     IS DISTINCT FROM v_prev.items_amount
       OR NEW.shipping_fee_before IS DISTINCT FROM v_prev.shipping_fee_before
       OR NEW.shipping_fee_after  IS DISTINCT FROM v_prev.shipping_fee_after
       OR NEW.shipping_delta   IS DISTINCT FROM v_prev.shipping_delta
       OR NEW.reason           IS DISTINCT FROM v_prev.reason
       OR NEW.actor            IS DISTINCT FROM v_prev.actor THEN
      RAISE EXCEPTION 'A7b job INSERT:後代 payload 必須逐欄等於直接前代(gen %)', v_prev.generation
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_payload_differs_from_predecessor';
    END IF;

    IF NEW.bank_refund_id IS NOT DISTINCT FROM v_prev.bank_refund_id THEN
      RAISE EXCEPTION 'A7b job INSERT:後代必須帶**全新** bank_refund_id(世代重試不靠冪等鍵)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_insert_successor_reuses_bank_id';
    END IF;

    -- 🔴 D9c:後代的 baseline 由 E2 寫入時另比對前代的 retry_auth_recorded_refunded
    --    (擋「結案到重試之間錢動了」,含別人在 TapPay portal 手動退款)。
    --    ⇒ 落點在 BEFORE UPDATE 的 E2,不在這裡(INSERT 時 baseline 必為 NULL)。
  END IF;

  -- 🔴 子表 item set 相等(後代)由 §5.6(a) 的 DEFERRED constraint trigger 在交易結束時比對
  --    —— INSERT 當下子表還沒插,這裡驗不到。

  RETURN NEW;
END;
$$;

-- ══ 4. BEFORE UPDATE 守門:exact-one classifier + 逐 edge 規則(plan §5.2)══════
-- 🔴🔴 **禁用 IF / ELSIF 首條命中**(plan §5.2-1,R6 F1):
--    E2 / E2b / E3 三條都是 processing → processing;E13 / E14 都是 dead → dead。
--    用 ELSIF 的話**分支順序會直接改變結果**,而且「重疊」與「零命中」會被靜默吞掉。
--    ⇒ 16 條各自算成獨立 boolean,先數 match_count,`= 1` 才執行。
CREATE FUNCTION public.pcm_a7bt_jobs_before_update()
RETURNS trigger
LANGUAGE plpgsql
-- 🔴 **SECURITY INVOKER**(plan §4.5 第 470-471 行逐字要求;關卡2 抓到我原本寫 DEFINER)。
--    規格的門檻是「只有寫出『INVOKER 下具體缺哪一個權限、在哪一行會炸』才准改 DEFINER」。
--    **本機實測結果 = 一個都不缺**:service_role 對 order_refunds / order_items /
--    order_refund_items / order_refund_jobs / order_refund_job_items / staff 六張表
--    全部 `has_table_privilege(...,'SELECT') = true`,且 service_role 是 **BYPASSRLS**
--    ⇒ 五張 RLS zero-policy 表也讀得到。**沒有正當理由用 DEFINER。**
--    ⇒ 改回 INVOKER 同時消掉「多一個以 owner 權限起跑的入口」這整個攻擊面。
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match    text[] := ARRAY[]::text[];
  v_edge     text;
  v_allowed  text[];
  v_bad      text[];
  v_now      timestamptz := now();
  v_prev     public.order_refund_jobs%ROWTYPE;
BEGIN
  -- ── 4.1 十六條互斥判別式 ──────────────────────────────────────────────
  -- 🔴 判別式只放**辨別用的最小條件**(把這條 edge 與其他 15 條分開的那些)。
  --    其餘規則一律放到下面的逐 edge 驗證,並各自帶具名 ID
  --    —— 否則負測會全部紅在 a7bt_edge_unmatched,分不出是哪一條規則擋下的。
  --
  -- 🔴🔴 **`'E1'::text` 的顯式轉型不可省(2026-07-31 T2 正向鏈實跑抓到、本檔原本 16 處全錯)**:
  --    `text[] || 'E1'` 的右運算元是 **unknown 型**,PostgreSQL 會優先解析成
  --    `anyarray || anyarray` 而不是 `anyarray || anyelement`
  --    ⇒ 執行期報 `malformed array literal: "E1"`(實測:`ARRAY[]::text[] || 'E1'` 直接炸)。
  --    後果是**整個狀態機死掉** —— 任何一筆 UPDATE 都在第一條判別式當場拋錯,16 條 edge 全不可達。
  --    🔴 **T1 自己的結構驗收看不到它**:plpgsql 函式本體只在**執行時**才解析,
  --       而 T1 全程零 UPDATE(dormant gate 在 M 期間擋住所有寫入、T 本身只做 DDL)
  --       ⇒ 這正是 plan §7.4「負測證明不了『好的走得通』」那條紀律要抓的東西,
  --         而它是被**正向鏈的第一步**抓到的。

  IF OLD.status = 'queued' AND NEW.status = 'processing' THEN
    v_match := v_match || 'E1'::text;
  END IF;

  -- E2 / E2b / E3 同為 processing→processing,靠「哪些欄產生 delta」互斥。
  -- 🔴 這一點必須由判別式**明文表達**,不能靠實作者理解(plan §5.2-1)。
  IF OLD.status = 'processing' AND NEW.status = 'processing'
     AND OLD.refunded_before IS NULL AND NEW.refunded_before IS NOT NULL THEN
    v_match := v_match || 'E2'::text;
  END IF;

  IF OLD.status = 'processing' AND NEW.status = 'processing'
     AND OLD.refund_call_attempted_at IS NULL AND NEW.refund_call_attempted_at IS NOT NULL THEN
    v_match := v_match || 'E2b'::text;
  END IF;

  IF OLD.status = 'processing' AND NEW.status = 'processing'
     AND NEW.claim_token IS DISTINCT FROM OLD.claim_token THEN
    v_match := v_match || 'E3'::text;
  END IF;

  IF OLD.status = 'processing' AND NEW.status = 'reconciling' THEN
    v_match := v_match || 'E3b'::text;
  END IF;

  IF OLD.status = 'processing' AND NEW.status = 'submitted' THEN
    v_match := v_match || 'E4'::text;
  END IF;

  IF OLD.status = 'processing' AND NEW.status = 'failed' THEN
    v_match := v_match || 'E5'::text;
  END IF;

  IF OLD.status = 'processing' AND NEW.status = 'dead' THEN
    v_match := v_match || 'E5b'::text;
  END IF;

  IF OLD.status = 'failed' AND NEW.status = 'queued' THEN
    v_match := v_match || 'E6'::text;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status = 'reconciling' THEN
    v_match := v_match || 'E8'::text;
  END IF;

  IF OLD.status = 'reconciling' AND NEW.status = 'completed' THEN
    v_match := v_match || 'E9'::text;
  END IF;

  IF OLD.status = 'reconciling' AND NEW.status = 'submitted' THEN
    v_match := v_match || 'E10'::text;
  END IF;

  IF OLD.status = 'reconciling' AND NEW.status = 'reconciling' THEN
    v_match := v_match || 'E11'::text;
  END IF;

  IF OLD.status = 'reconciling' AND NEW.status = 'dead' THEN
    v_match := v_match || 'E12'::text;
  END IF;

  -- E13 / E14 同為 dead→dead,靠 OLD.reviewed_at 本身互斥。
  IF OLD.status = 'dead' AND NEW.status = 'dead' AND OLD.reviewed_at IS NULL THEN
    v_match := v_match || 'E13'::text;
  END IF;

  IF OLD.status = 'dead' AND NEW.status = 'dead' AND OLD.reviewed_at IS NOT NULL THEN
    v_match := v_match || 'E14'::text;
  END IF;

  -- ── 4.2 exact-one ─────────────────────────────────────────────────────
  IF array_length(v_match, 1) IS NULL THEN
    RAISE EXCEPTION 'A7b job UPDATE:% → % 不對應任何合法轉移(表外的組合一律拒絕)',
      OLD.status, NEW.status
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_edge_unmatched';
  END IF;

  IF array_length(v_match, 1) > 1 THEN
    RAISE EXCEPTION 'A7b job UPDATE:同時命中多條轉移 %(判別式必須互斥)',
      array_to_string(v_match, ',')
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_edge_ambiguous';
  END IF;

  v_edge := v_match[1];

  -- ── 4.3 allowed-delta:白名單以外的欄一律不得改(deny-by-default)──────
  -- 🔴 這一段同時關掉「不可變欄位」的整份清單:id / cancellation_id / order_id /
  --    generation / rec_trade_id / bank_refund_id / payload_hash / refund_amount /
  --    帳本快照六欄 / created_at,以及「一旦非 NULL 即不可變」的那些欄
  --    —— 它們不在任何 edge 的白名單裡,因此每一條 edge 都會要求它們不變。
  v_allowed := public.pcm_a7bt_allowed_delta(v_edge);

  SELECT array_agg(o.key ORDER BY o.key) INTO v_bad
    FROM jsonb_each(to_jsonb(OLD)) o
   WHERE NOT (o.key = ANY (v_allowed))
     AND o.value IS DISTINCT FROM (to_jsonb(NEW) -> o.key);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A7b job UPDATE(%):不在本轉移白名單內的欄被改動 → %',
      v_edge, array_to_string(v_bad, ', ')
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_immutable_column_changed';
  END IF;

  -- ── 4.4 D10:除 E4 外,tappay_refund_id 一律不得動 ─────────────────────
  -- 🔴 白名單已涵蓋(只有 E4 列了它),此處**不重複檢查**:
  --    再寫一次會多出一條「刪掉它仍全綠」的死重規則,正是本線六輪一直在抓的病。

  -- ── 4.5 逐 edge 規則 ──────────────────────────────────────────────────
  IF v_edge = 'E1' THEN
    IF OLD.claim_token IS NOT NULL OR NEW.claim_token IS NULL THEN
      RAISE EXCEPTION 'E1:claim_token 必須由 NULL 變為非 NULL'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e1_claim_token_shape';
    END IF;
    IF NEW.claimed_at IS DISTINCT FROM v_now
       OR NEW.claim_expires_at IS DISTINCT FROM v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'E1:lease 錨點必須是 claimed_at = now() 且 claim_expires_at = claimed_at + 5min'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e1_lease_anchor';
    END IF;
    IF NOT (OLD.next_retry_at IS NULL OR OLD.next_retry_at <= v_now) THEN
      RAISE EXCEPTION 'E1:next_retry_at 尚未到期,不得 claim'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e1_not_due_yet';
    END IF;
    IF NEW.next_retry_at IS NOT NULL THEN
      RAISE EXCEPTION 'E1:claim 後必須清空 next_retry_at'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e1_next_retry_not_cleared';
    END IF;
    IF OLD.refund_call_attempted_at IS NOT NULL THEN
      RAISE EXCEPTION 'E1:refund_call_attempted_at 必須為 NULL'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e1_attempted_must_be_null';
    END IF;

  ELSIF v_edge = 'E2' THEN
    IF NEW.refunded_target IS NULL THEN
      RAISE EXCEPTION 'E2:baseline 必須成對寫入(refunded_before / refunded_target)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2_baseline_not_paired';
    END IF;
    IF NEW.refund_call_attempted_at IS NOT NULL THEN
      RAISE EXCEPTION 'E2:baseline 初始化時 refund_call_attempted_at 必須仍為 NULL'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2_attempted_must_be_null';
    END IF;
    -- 🔴 D9c(後代專用):baseline 必須等於前代結案時查到的累計退款額。
    --    擋的是「結案到重試之間錢動了」,含**別人在 TapPay portal 手動退了一筆**。
    -- ⚠️ 誠實邊界:D9c 與 D9d 兩邊都讀 Record API ⇒ **共模失效** ——
    --    Record 本身回錯時兩邊會一起錯、兩條規則全綠(plan §3.5)。
    IF NEW.generation > 1 THEN
      SELECT * INTO v_prev
        FROM public.order_refund_jobs
       WHERE cancellation_id = NEW.cancellation_id
         AND generation = NEW.generation - 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'E2:generation=% 找不到直接前代,無法比對 D9c', NEW.generation
          USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2_no_predecessor_for_d9c';
      END IF;

      IF NEW.refunded_before IS DISTINCT FROM v_prev.retry_auth_recorded_refunded THEN
        RAISE EXCEPTION 'E2/D9c:後代 baseline(%)必須等於前代結案時查到的累計退款額(%)',
          NEW.refunded_before, coalesce(v_prev.retry_auth_recorded_refunded::text, '(NULL)')
          USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2_d9c_baseline_mismatch';
      END IF;
    END IF;

  ELSIF v_edge = 'E2b' THEN
    -- 🔴🔴 **Sean 07-31 拍 Q1=A(送錢前再比對一次)—— 本片做不到,原因寫在這裡,不留假象。**
    --    關卡2 F1 指出的洞是真的:D9c 只在 **E2** 取樣一次;E2 到 E2b(真正發 HTTP)之間
    --    若前代那筆退款才入帳,兩道都會通過 ⇒ 用新的 bank_refund_id 再退一次。
    --    🔴 但「再比對一次」在 DB 層**沒有東西可以比**:
    --      D9c 比的兩邊(`refunded_before` 與前代的 `retry_auth_recorded_refunded`)
    --      **都是不可變欄**,在這裡重比一次恆為真 = 一條刪掉也不會有人發現的死重規則,
    --      正是本線六輪一直在抓的那個病(「防護被命名成超出它的實際能力」)。
    --    ⇒ 真正的實作需要 worker 在 E2b **帶入一份當下的 Record 讀數**供 DB 比對,
    --      而本表沒有那個欄位 ⇒ **需要一支新的 schema migration**,不在 T1 範圍。
    --    ⇒ 已回報 Sean 為獨立待辦(見交接檔);在它落地之前,這一段是
    --      **worker 紀律 + 第 3 批 sandbox 實測關卡**,不是本表的防護。
    IF OLD.refunded_before IS NULL THEN
      RAISE EXCEPTION 'E2b:必須先完成 baseline 初始化(E2)才能戳呼叫記號'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2b_baseline_required';
    END IF;
    IF NEW.refund_call_attempted_at IS DISTINCT FROM v_now THEN
      RAISE EXCEPTION 'E2b:refund_call_attempted_at 必須等於 now()'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2b_attempted_must_be_now';
    END IF;
    -- 🔴 D9b 的錨點就是這一欄(R5 F2):錨「最後一次」而非「第一次」。
    --    錨第一次會讓「第 1 輪 day0 失敗、第 4 輪 day3 逾時受理」的情境當天就能結案重退。
    IF NEW.last_refund_call_at IS DISTINCT FROM v_now THEN
      RAISE EXCEPTION 'E2b:last_refund_call_at 必須更新為 now()(每次呼叫都更新)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2b_last_call_must_be_now';
    END IF;
    IF OLD.last_refund_call_at IS NOT NULL AND NEW.last_refund_call_at < OLD.last_refund_call_at THEN
      RAISE EXCEPTION 'E2b:last_refund_call_at 單調不減,不得往回改'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e2b_last_call_not_monotonic';
    END IF;

  ELSIF v_edge = 'E3' THEN
    IF OLD.claim_expires_at IS NULL OR OLD.claim_expires_at > v_now THEN
      RAISE EXCEPTION 'E3:lease 尚未過期,不得重領'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3_lease_not_expired';
    END IF;
    IF NEW.claimed_at IS DISTINCT FROM v_now
       OR NEW.claim_expires_at IS DISTINCT FROM v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'E3:lease 錨點必須重設為 now() / now()+5min'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3_lease_anchor';
    END IF;
    -- 🔴 D2:attempted_at IS NULL 才代表「一定還沒打過」⇒ 才可以安全重領回 processing 再呼叫。
    --    非 NULL 的話結果未知,必須走 E3b 進 reconciling 由 Record 裁定。
    IF OLD.refund_call_attempted_at IS NOT NULL THEN
      RAISE EXCEPTION 'E3:已有未知結果的呼叫記號,必須走 E3b 進 reconciling,不得重領回 processing'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3_attempted_must_be_null';
    END IF;

  ELSIF v_edge = 'E3b' THEN
    IF OLD.claim_expires_at IS NULL OR OLD.claim_expires_at > v_now THEN
      RAISE EXCEPTION 'E3b:lease 尚未過期'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3b_lease_not_expired';
    END IF;
    IF OLD.refund_call_attempted_at IS NULL THEN
      RAISE EXCEPTION 'E3b:沒有呼叫記號就沒有「不確定」可言,應走 E3'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3b_attempted_required';
    END IF;
    IF NEW.claimed_at IS DISTINCT FROM v_now
       OR NEW.claim_expires_at IS DISTINCT FROM v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'E3b:lease 錨點必須重設為 now() / now()+5min'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3b_lease_anchor';
    END IF;
    -- 🔴 關卡2 抓:規格 §3.1 的 E3b 明寫「**lease 錨點 + token 換新**」,我原本只驗了錨點。
    --    白名單允許 claim_token 變動 ≠ 強制它變動 ⇒ 舊 worker 手上那把 token 仍然有效,
    --    接管失敗:兩個 worker 同時認為自己持有這一列。
    --    (E3 靠判別式本身就要求 token 不同,E3b 沒有那個判別式 ⇒ 必須在這裡明寫。)
    IF NEW.claim_token IS NULL OR NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token THEN
      RAISE EXCEPTION 'E3b:claim_token 必須換新(舊 worker 的 token 必須失效)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3b_claim_token_not_new';
    END IF;
    -- 🔴 隔日基準一律 Asia/Taipei 日曆日界:date_trunc('day', ts) 隨 session TimeZone 走,
    --    Supabase 預設 UTC ⇒ 「隔日」會在台北早上 8 點就開,落在同一個營業日內。
    IF NEW.next_check_at IS NULL
       OR (NEW.next_check_at AT TIME ZONE 'Asia/Taipei')::date
           <= (OLD.refund_call_attempted_at AT TIME ZONE 'Asia/Taipei')::date THEN
      RAISE EXCEPTION 'E3b:next_check_at 的台北日期必須晚於呼叫日(TapPay 退款隔日生效)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e3b_next_check_not_next_day';
    END IF;

  ELSIF v_edge = 'E4' THEN
    IF OLD.refunded_before IS NULL THEN
      RAISE EXCEPTION 'E4:baseline 必須已初始化'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e4_baseline_required';
    END IF;
    IF OLD.refund_call_attempted_at IS NULL THEN
      RAISE EXCEPTION 'E4:未戳呼叫記號就宣告送出成功(worker 必須先 commit E2b 再發 HTTP)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e4_attempted_required';
    END IF;
    -- 🔴 D10:E4 是**唯一**可首寫 tappay_refund_id 的 edge。
    IF OLD.tappay_refund_id IS NOT NULL OR NEW.tappay_refund_id IS NULL THEN
      RAISE EXCEPTION 'E4:tappay_refund_id 必須由 NULL 首次寫入'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e4_tappay_id_first_write';
    END IF;
    IF NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.claim_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'E4:必須清空 lease 三欄'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e4_lease_not_cleared';
    END IF;
    IF NEW.next_check_at IS NULL
       OR (NEW.next_check_at AT TIME ZONE 'Asia/Taipei')::date
           <= (OLD.refund_call_attempted_at AT TIME ZONE 'Asia/Taipei')::date THEN
      RAISE EXCEPTION 'E4:next_check_at 的台北日期必須晚於呼叫日'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e4_next_check_not_next_day';
    END IF;

  ELSIF v_edge = 'E5' THEN
    -- 🔴 D12:沒呼叫過不得記「明確失敗」。
    --    沒有這條,worker 可以在完全沒發 HTTP 的情況下把 retry_count 灌到 6
    --    ⇒ 合法拿到 retry_exhausted ⇒ D7 放行 retry_authorized ⇒ 開新世代重退。
    IF OLD.refund_call_attempted_at IS NULL THEN
      RAISE EXCEPTION 'E5:沒有呼叫記號,不得記為明確失敗(D12)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5_attempted_required';
    END IF;
    IF NEW.failed_reason IS NULL OR btrim(NEW.failed_reason, E' \t\r\n 　​  ') = '' THEN
      RAISE EXCEPTION 'E5:failed_reason 不得為空白'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5_failed_reason_blank';
    END IF;
    IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 OR NEW.retry_count > 5 THEN
      RAISE EXCEPTION 'E5:retry_count 必須 +1 且 <= 5(第六次走 E5b)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5_retry_count_step';
    END IF;
    IF NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.claim_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'E5:必須清空 lease 三欄'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5_lease_not_cleared';
    END IF;
    -- 明確失敗 ⇒ 結果已知 ⇒ 戳記清掉(否則重試迴圈靜態不可能:failed 的 truth table 要求它為 NULL)
    IF NEW.refund_call_attempted_at IS NOT NULL THEN
      RAISE EXCEPTION 'E5:明確失敗必須清掉 refund_call_attempted_at'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5_attempted_not_cleared';
    END IF;
    -- 🔴 backoff 基準是**失敗當下**(now()),不是 created_at 也不是 OLD.updated_at。
    -- 🔴 用 `1 << (n-1)` 而非規格字面的 `power(2, n-1)`:power() 回 double precision,
    --    interval * double 會有浮點不精確 ⇒ 這裡是**逐值相等**斷言,浮點會讓合法值偶發被拒。
    --    n ∈ 1..5 ⇒ 1,2,4,8,16 —— 兩者數學上等值,整數位移是精確的。
    IF NEW.next_retry_at IS DISTINCT FROM
       v_now + interval '5 minutes' * (1 << (NEW.retry_count - 1)) THEN
      RAISE EXCEPTION 'E5:next_retry_at 必須是 now() + 5min * 2^(retry_count-1)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5_backoff_formula';
    END IF;

  ELSIF v_edge = 'E5b' THEN
    IF OLD.refund_call_attempted_at IS NULL THEN
      RAISE EXCEPTION 'E5b:沒有呼叫記號,不得記為明確失敗(D12)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_attempted_required';
    END IF;
    IF NEW.retry_count IS DISTINCT FROM OLD.retry_count + 1 OR NEW.retry_count <> 6 THEN
      RAISE EXCEPTION 'E5b:retry_count 必須 +1 且恰為 6'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_retry_count_must_be_six';
    END IF;
    -- 🔴 D7 的上游:retry_exhausted 是唯一能結成 retry_authorized 的死因(CHECK 層擋)。
    IF NEW.dead_reason IS DISTINCT FROM 'retry_exhausted' THEN
      RAISE EXCEPTION 'E5b:dead_reason 必須是 retry_exhausted'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_dead_reason';
    END IF;
    IF NEW.manual_review_required IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'E5b:必須標記 manual_review_required'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_manual_review_required';
    END IF;
    IF NEW.failed_reason IS NULL OR btrim(NEW.failed_reason, E' \t\r\n 　​  ') = '' THEN
      RAISE EXCEPTION 'E5b:failed_reason 不得為空白'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_failed_reason_blank';
    END IF;
    IF NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.claim_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'E5b:必須清空 lease 三欄'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_lease_not_cleared';
    END IF;
    IF NEW.refund_call_attempted_at IS NOT NULL THEN
      RAISE EXCEPTION 'E5b:必須清掉 refund_call_attempted_at'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_attempted_not_cleared';
    END IF;
    IF NEW.next_retry_at IS NOT NULL THEN
      RAISE EXCEPTION 'E5b:dead 不再重試,next_retry_at 必須為 NULL'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e5b_next_retry_not_cleared';
    END IF;

  ELSIF v_edge = 'E6' THEN
    IF NEW.retry_count IS DISTINCT FROM OLD.retry_count OR NEW.retry_count > 5 THEN
      RAISE EXCEPTION 'E6:retry_count 不得變動且必須 <= 5'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e6_retry_count_changed';
    END IF;
    IF NEW.failed_reason IS NOT NULL THEN
      RAISE EXCEPTION 'E6:重回佇列必須清掉 failed_reason'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e6_failed_reason_not_cleared';
    END IF;
    -- 🔴 「只保留、不重算 next_retry_at」由白名單自動強制(它不在 E6 白名單裡)
    --    ⇒ 此處不重複寫一條檢查。

  ELSIF v_edge = 'E8' THEN
    IF OLD.next_check_at IS NULL OR OLD.next_check_at > v_now THEN
      RAISE EXCEPTION 'E8:對帳時間未到'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e8_not_due_yet';
    END IF;
    IF NEW.claimed_at IS DISTINCT FROM v_now
       OR NEW.claim_expires_at IS DISTINCT FROM v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'E8:lease 錨點必須是 now() / now()+5min'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e8_lease_anchor';
    END IF;
    IF NEW.claim_token IS NULL OR NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token THEN
      RAISE EXCEPTION 'E8:claim_token 必須換新'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e8_claim_token_not_new';
    END IF;

  ELSIF v_edge = 'E9' THEN
    IF OLD.refund_id IS NOT NULL OR NEW.refund_id IS NULL THEN
      RAISE EXCEPTION 'E9:refund_id 必須由 NULL 首次寫入'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e9_refund_id_first_write';
    END IF;
    IF NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.claim_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'E9:必須清空 lease 三欄'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e9_lease_not_cleared';
    END IF;
    IF NEW.next_check_at IS NOT NULL THEN
      RAISE EXCEPTION 'E9:完成後 next_check_at 必須為 NULL'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e9_next_check_not_cleared';
    END IF;
    -- 🔴 job ↔ ledger 的**逐欄等值**由 §5.6(b) 的 DEFERRED constraint trigger 在交易結束時比對
    --    —— 這裡驗不到:帳本列可能在同交易稍後才寫入。

  ELSIF v_edge = 'E10' THEN
    IF NEW.next_check_at IS NULL OR OLD.next_check_at IS NULL
       OR NEW.next_check_at <= OLD.next_check_at THEN
      RAISE EXCEPTION 'E10:next_check_at 必須往後推'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e10_next_check_not_advanced';
    END IF;
    IF NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.claim_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'E10:必須清空 lease 三欄'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e10_lease_not_cleared';
    END IF;
    -- 二擇一:成功查到但未達標 ⇒ 歸零;查詢異常 ⇒ +1 且 <= 5。
    IF NOT (NEW.check_fail_count = 0
            OR (NEW.check_fail_count = OLD.check_fail_count + 1 AND NEW.check_fail_count <= 5)) THEN
      RAISE EXCEPTION 'E10:check_fail_count 只能歸 0(查到未達標)或 +1 且 <= 5(查詢異常)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e10_check_fail_count_step';
    END IF;

  ELSIF v_edge = 'E11' THEN
    IF OLD.claim_expires_at IS NULL OR OLD.claim_expires_at > v_now THEN
      RAISE EXCEPTION 'E11:lease 尚未過期'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e11_lease_not_expired';
    END IF;
    IF NEW.claimed_at IS DISTINCT FROM v_now
       OR NEW.claim_expires_at IS DISTINCT FROM v_now + interval '5 minutes' THEN
      RAISE EXCEPTION 'E11:lease 錨點必須重設為 now() / now()+5min'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e11_lease_anchor';
    END IF;
    IF NEW.claim_token IS NULL OR NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token THEN
      RAISE EXCEPTION 'E11:claim_token 必須換新'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e11_claim_token_not_new';
    END IF;
    -- 🔴 「永不回 processing」由 classifier 保證(reconciling→processing 不在 16 條裡
    --    ⇒ 落到 a7bt_edge_unmatched)。此處不重複寫。

  ELSIF v_edge = 'E12' THEN
    IF NEW.manual_review_required IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'E12:必須標記 manual_review_required'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e12_manual_review_required';
    END IF;
    IF NEW.claim_token IS NOT NULL OR NEW.claimed_at IS NOT NULL OR NEW.claim_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'E12:必須清空 lease 三欄'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e12_lease_not_cleared';
    END IF;
    IF NEW.next_check_at IS NOT NULL THEN
      RAISE EXCEPTION 'E12:進 dead 後 next_check_at 必須為 NULL'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e12_next_check_not_cleared';
    END IF;
    -- 二擇一:超退 ⇒ over_refunded 且計數器不變;第六次查詢異常 ⇒ reconcile_exhausted 且 = 6。
    IF NEW.dead_reason IS NOT DISTINCT FROM 'over_refunded' THEN
      IF NEW.check_fail_count IS DISTINCT FROM OLD.check_fail_count THEN
        RAISE EXCEPTION 'E12(over_refunded):check_fail_count 不得變動'
          USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e12_over_refunded_counter_changed';
      END IF;
    ELSIF NEW.dead_reason IS NOT DISTINCT FROM 'reconcile_exhausted' THEN
      IF NEW.check_fail_count IS DISTINCT FROM OLD.check_fail_count + 1
         OR NEW.check_fail_count <> 6 THEN
        RAISE EXCEPTION 'E12(reconcile_exhausted):check_fail_count 必須 +1 且恰為 6'
          USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e12_exhausted_counter_step';
      END IF;
    ELSE
      RAISE EXCEPTION 'E12:dead_reason 必須是 over_refunded 或 reconcile_exhausted,實為 %',
        coalesce(NEW.dead_reason, '(NULL)')
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e12_dead_reason';
    END IF;

  ELSIF v_edge = 'E13' THEN
    -- review 三欄必須同時由 NULL 變非 NULL(CHECK 層已有成對約束,這裡管的是「同時發生」)。
    IF NEW.reviewed_at IS NULL OR NEW.reviewed_by IS NULL OR NEW.resolution IS NULL THEN
      RAISE EXCEPTION 'E13:review 三欄必須同時寫入'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e13_review_triple_incomplete';
    END IF;
    -- 🔴 R5 F4:結案時填入的 Record 查詢時間不得是未來
    --    —— 沒有這條,D9b 的「隔日」閘可以靠填一個明天的 checked_at 當場繞過。
    IF NEW.retry_auth_checked_at IS NOT NULL AND NEW.retry_auth_checked_at > v_now THEN
      RAISE EXCEPTION 'E13:retry_auth_checked_at 不得是未來時間'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e13_checked_at_in_future';
    END IF;
    -- 🔴 D7 + D9a/b/d 由 A7b-M 的 CHECK 層承接(orj_retry_auth_* 四條),此處不重複。

  ELSIF v_edge = 'E14' THEN
    -- OLD.reviewed_at IS NOT NULL 已由 classifier 保證。
    IF OLD.corrected_at IS NOT NULL THEN
      RAISE EXCEPTION 'E14:只准更正一次(第二道 CAS)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e14_already_corrected';
    END IF;
    IF NEW.corrected_at IS NULL OR NEW.corrected_by IS NULL OR NEW.correction_reason IS NULL THEN
      RAISE EXCEPTION 'E14:corrected 三欄必須同時寫入'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e14_correction_triple_incomplete';
    END IF;
    IF btrim(NEW.correction_reason, E' \t\r\n 　​  ') = '' THEN
      RAISE EXCEPTION 'E14:correction_reason 不得為空白'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e14_correction_reason_blank';
    END IF;
    IF NEW.corrected_at > v_now THEN
      RAISE EXCEPTION 'E14:corrected_at 不得是未來時間'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e14_corrected_at_in_future';
    END IF;
    -- 🔴 兩人簽核的 DB 層強制。誠實邊界:它強制的是**兩個 staff.id**,不是兩個人
    --    —— 同一人若同時擁有兩組帳號仍可繞過(真正的兩人簽核需要 E8-B)。
    IF NEW.corrected_by IS NOT DISTINCT FROM NEW.reviewed_by THEN
      RAISE EXCEPTION 'E14:更正人不得與原結案人相同'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e14_same_person';
    END IF;
    IF NEW.retry_auth_checked_at IS NOT NULL AND NEW.retry_auth_checked_at > v_now THEN
      RAISE EXCEPTION 'E14:retry_auth_checked_at 不得是未來時間'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e14_checked_at_in_future';
    END IF;
    -- 🔴🔴 **先鎖 cancellation 列,再查後繼**(關卡2 F2 + Sean 07-31 拍 Q4=A)。
    --    順序不可顛倒:READ COMMITTED 下 UPDATE 只會重新讀取自己那一列,
    --    trigger 內對**其他列**的查詢仍用舊快照 ⇒ 先查再鎖 = 查到的是過期事實,
    --    後繼列剛被別的交易插入時**看不到**,E14 會放行 ⇒ 留下「授權已被改掉、
    --    下一張卡卻已經開出去」的孤兒。取得鎖之後的查詢是新 statement ⇒ 新快照。
    --    鎖序與 INSERT 守門一致(先 order_cancellations、後 order_refund_jobs)。
    PERFORM 1 FROM public.order_cancellations WHERE id = OLD.cancellation_id FOR UPDATE;

    -- 🔴 該世代尚無後繼列 —— 否則會出現「下一張卡已開、授權卻被改掉」的孤兒。
    IF EXISTS (
      SELECT 1 FROM public.order_refund_jobs
       WHERE cancellation_id = OLD.cancellation_id
         AND generation = OLD.generation + 1
    ) THEN
      RAISE EXCEPTION 'E14:該世代已有後繼列,不得再更正結案(會產生孤兒授權)'
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_e14_successor_exists';
    END IF;
  END IF;

  -- ── 4.6 updated_at 統一設值 ───────────────────────────────────────────
  -- 🔴 只有 DEFAULT 的話它是**會說謊的欄位**(永遠停在建立時間)。
  --    放在最後:任何 RAISE 都不會走到這裡,而合法路徑一律被覆寫
  --    ⇒ 呼叫者自己填什麼都不影響結果(白名單允許它變動,值由這裡決定)。
  NEW.updated_at := v_now;

  RETURN NEW;
END;
$$;

-- ══ 5. DEFERRED:主從一致 C1-C4 + 後代 item set 相等(plan §5.6(a))══════════
-- 🔴 **為何要兩支**(parent AFTER INSERT + child AFTER INSERT OR DELETE):
--    只掛子表的話,「插了 header 但一列明細都沒插」**永遠不會觸發任何事件**
--    —— `20260725130100:180-186` 的同一個教訓,已實證。
-- 🔴 DEFERRABLE INITIALLY DEFERRED:合法的 enqueue 是「先插 header 再插明細」,
--    立即檢查會在 header 那一刻就因為零明細而失敗。
CREATE FUNCTION public.pcm_a7bt_assert_job_consistent()
RETURNS trigger
LANGUAGE plpgsql
-- 🔴 **SECURITY INVOKER**(plan §4.5 第 470-471 行逐字要求;關卡2 抓到我原本寫 DEFINER)。
--    規格的門檻是「只有寫出『INVOKER 下具體缺哪一個權限、在哪一行會炸』才准改 DEFINER」。
--    **本機實測結果 = 一個都不缺**:service_role 對 order_refunds / order_items /
--    order_refund_items / order_refund_jobs / order_refund_job_items / staff 六張表
--    全部 `has_table_privilege(...,'SELECT') = true`,且 service_role 是 **BYPASSRLS**
--    ⇒ 五張 RLS zero-policy 表也讀得到。**沒有正當理由用 DEFINER。**
--    ⇒ 改回 INVOKER 同時消掉「多一個以 owner 權限起跑的入口」這整個攻擊面。
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_ids uuid[];
  v_job_id  uuid;
  v_job     public.order_refund_jobs%ROWTYPE;
  v_cnt     integer;
  v_sum     integer;
  v_bad     integer;
  v_prev_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'order_refund_jobs' THEN
    v_job_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    v_job_ids := ARRAY[OLD.job_id];
  ELSIF TG_OP = 'UPDATE' THEN
    -- 🔴 **兩個都要驗**(逐字沿用 `20260730140000:161-162` 的既有教訓):
    --    明細從 job A 改掛到 job B 時,只驗 B 會讓 A 靜默變成失衡(甚至零明細)。
    v_job_ids := ARRAY[OLD.job_id, NEW.job_id];
  ELSE
    v_job_ids := ARRAY[NEW.job_id];
  END IF;

  FOREACH v_job_id IN ARRAY v_job_ids LOOP
    SELECT * INTO v_job FROM public.order_refund_jobs WHERE id = v_job_id;
    -- header 已不存在 ⇒ 無不變式可驗。
    -- (現行設計下 DELETE 被永久擋住 ⇒ 走不到;保留是為了讓本函式不依賴那個擋。)
    CONTINUE WHEN NOT FOUND;

    -- ── C1:每個 job 至少一列明細 ──
    -- 🔴 關聯條件不可省:誤寫成全表 count 時,只要別的 job 有明細,空 job 就會過關。
    SELECT count(*), coalesce(sum(line_amount), 0)
      INTO v_cnt, v_sum
      FROM public.order_refund_job_items
     WHERE job_id = v_job_id;

    IF v_cnt = 0 THEN
      RAISE EXCEPTION 'A7b 主從一致:job % 沒有任何明細(C1)', v_job_id
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_c1_job_has_no_items';
    END IF;

    -- ── C2:items_amount = Σ line_amount ──
    -- ⚠️ 誠實邊界(plan §4.3 併發合約債 2):count/sum 型 deferred 檢查 + 子表 INSERT 對
    --    service_role 開放 ⇒ 兩交易併發各插明細,**各自快照皆平衡、落地後 Σ > items_amount**。
    --    現行 enqueue 單交易一次寫完 ⇒ 不可觸發,**但那是推論不是防護**。
    --    若第 3 批出現「分批追加明細」,必須先補「trigger 內鎖 parent + 隔離級 fail-closed 閘」
    --    (鎖 parent 單獨不足以補,同一 harness 已實測)。
    IF v_sum IS DISTINCT FROM v_job.items_amount THEN
      RAISE EXCEPTION 'A7b 主從一致:job % 的 Σ line_amount(%)≠ items_amount(%)(C2)',
        v_job_id, v_sum, v_job.items_amount
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_c2_items_amount_mismatch';
    END IF;

    -- ── C3 / C4:數量不得超過原品項、單價必須等於訂單快照 ──
    SELECT count(*) INTO v_bad
      FROM public.order_refund_job_items ji
      JOIN public.order_items oi ON oi.id = ji.order_item_id
     WHERE ji.job_id = v_job_id
       AND ji.quantity > oi.quantity;

    IF v_bad > 0 THEN
      RAISE EXCEPTION 'A7b 主從一致:job % 有 % 列明細的數量超過原品項(C3)', v_job_id, v_bad
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_c3_quantity_exceeds_order_item';
    END IF;

    SELECT count(*) INTO v_bad
      FROM public.order_refund_job_items ji
      JOIN public.order_items oi ON oi.id = ji.order_item_id
     WHERE ji.job_id = v_job_id
       AND ji.unit_price IS DISTINCT FROM oi.unit_price;

    IF v_bad > 0 THEN
      RAISE EXCEPTION 'A7b 主從一致:job % 有 % 列明細的單價不等於訂單快照(C4)', v_job_id, v_bad
        USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_c4_unit_price_mismatch';
    END IF;

    -- ── 後代 item set 必須與直接前代完全相同(plan §5.1-5)──
    -- 🔴 雙向無差集,不是只比 count:同樣的列數、不同的品項組合會通過 count 比對。
    IF v_job.generation > 1 THEN
      SELECT id INTO v_prev_id
        FROM public.order_refund_jobs
       WHERE cancellation_id = v_job.cancellation_id
         AND generation = v_job.generation - 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A7b 主從一致:job %(gen %)找不到直接前代', v_job_id, v_job.generation
          USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_successor_no_predecessor';
      END IF;

      -- 🔴🔴 **括號不可省(關卡2 抓、當場實測證實)**:
      --    `EXCEPT` 與 `UNION` 在 SQL 裡**同優先級、左結合**
      --    ⇒ 不加括號會被解析成 `((A EXCEPT ALL B) UNION ALL B) EXCEPT ALL A`,
      --      那是**單向**差集。實測:後代多出一列時它回 0 = 整個方向靜默漏掉。
      --    正確形狀 = 兩個 EXCEPT 各自括起來再 UNION。
      SELECT count(*) INTO v_bad FROM (
        (SELECT order_item_id, quantity, unit_price, line_amount
           FROM public.order_refund_job_items WHERE job_id = v_job_id
         EXCEPT ALL
         SELECT order_item_id, quantity, unit_price, line_amount
           FROM public.order_refund_job_items WHERE job_id = v_prev_id)
        UNION ALL
        (SELECT order_item_id, quantity, unit_price, line_amount
           FROM public.order_refund_job_items WHERE job_id = v_prev_id
         EXCEPT ALL
         SELECT order_item_id, quantity, unit_price, line_amount
           FROM public.order_refund_job_items WHERE job_id = v_job_id)
      ) d;

      IF v_bad > 0 THEN
        RAISE EXCEPTION 'A7b 主從一致:job %(gen %)的明細集合與前代不同(差集 % 列)',
          v_job_id, v_job.generation, v_bad
          USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_successor_item_set_differs';
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- ══ 6. DEFERRED:job ↔ ledger 逐欄等值(plan §5.6(b))════════════════════════
-- 🔴 U5 只防「兩個 job 共用一張帳本」,**完全不證明**下面任何一格。
--
-- 🔴🔴 **誠實邊界:本支只掛在 job 側,帳本自己被改不會觸發**(關卡2 F3;Sean 07-31 拍 Q2=A)。
--    具體漏法:job 走到 completed、本支比對通過並提交之後,
--    有人把 `order_refunds.reason` 改成另一個合法的非空字串
--    ⇒ 帳本自身的 CHECK 全過、job 一個欄位都沒動 ⇒ **本支永遠不會再被觸發**
--    ⇒ 十一欄從此不相等,而系統沒有任何地方會發現。
--    ⇒ **要擋住它,必須在 `order_refunds` 上另掛 trigger,那是 RF2a 那片的表。**
--    Sean 拍板 A:**不把手伸過去**,改成明文列為本片管不到的事(同時寫進表 COMMENT)。
--    ⇒ 這一條屬「稽核 / 別片的責任」,**不得在任何地方被算成本片已有的防護**。
CREATE FUNCTION public.pcm_a7bt_assert_job_ledger_equal()
RETURNS trigger
LANGUAGE plpgsql
-- 🔴 **SECURITY INVOKER**(plan §4.5 第 470-471 行逐字要求;關卡2 抓到我原本寫 DEFINER)。
--    規格的門檻是「只有寫出『INVOKER 下具體缺哪一個權限、在哪一行會炸』才准改 DEFINER」。
--    **本機實測結果 = 一個都不缺**:service_role 對 order_refunds / order_items /
--    order_refund_items / order_refund_jobs / order_refund_job_items / staff 六張表
--    全部 `has_table_privilege(...,'SELECT') = true`,且 service_role 是 **BYPASSRLS**
--    ⇒ 五張 RLS zero-policy 表也讀得到。**沒有正當理由用 DEFINER。**
--    ⇒ 改回 INVOKER 同時消掉「多一個以 owner 權限起跑的入口」這整個攻擊面。
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.order_refund_jobs%ROWTYPE;
  v_led public.order_refunds%ROWTYPE;
  v_bad integer;
BEGIN
  -- 🔴 重新 SELECT 而不是直接用 NEW:本支是 DEFERRED,NEW 是**觸發當下**的快照,
  --    同交易稍後的 UPDATE 不會反映在它身上 ⇒ 用 NEW 會對著過期的列做等值比對。
  SELECT * INTO v_job FROM public.order_refund_jobs WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- 只有 completed 需要有帳本;其餘狀態 refund_id 必為 NULL(A7b-M truth table 已擋)。
  IF v_job.status IS DISTINCT FROM 'completed' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_led FROM public.order_refunds WHERE id = v_job.refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A7b job↔ledger:job % 已 completed 但帳本 % 不存在', v_job.id, v_job.refund_id
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_ledger_missing';
  END IF;

  IF v_led.status IS DISTINCT FROM 'confirmed' OR v_led.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'A7b job↔ledger:帳本 % 必須是 confirmed 且 confirmed_at 非 NULL', v_led.id
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_ledger_not_confirmed';
  END IF;

  -- 🔴🔴 逐欄一律 IS NOT DISTINCT FROM,**禁用 `=`**:
  --    tappay_refund_id 兩邊皆 nullable(`20260725130100:88`),天真 `=` 遇 NULL
  --    整式為 NULL ⇒ 「不等才 RAISE」**靜默放行**。
  --    走 E3b(不確定送出)的 job 全程該欄為 NULL 卻可能一路走到 completed
  --    ⇒ 這不是理論邊界,是正向鏈 D 的常態。
  IF v_job.order_id            IS DISTINCT FROM v_led.order_id
     OR v_job.bank_refund_id   IS DISTINCT FROM v_led.bank_refund_id
     OR v_job.tappay_refund_id IS DISTINCT FROM v_led.tappay_refund_id
     OR v_job.refund_amount    IS DISTINCT FROM v_led.refund_amount
     OR v_job.items_amount     IS DISTINCT FROM v_led.items_amount
     OR v_job.shipping_fee_before IS DISTINCT FROM v_led.shipping_fee_before
     OR v_job.shipping_fee_after  IS DISTINCT FROM v_led.shipping_fee_after
     OR v_job.shipping_delta   IS DISTINCT FROM v_led.shipping_delta
     OR v_job.reason           IS DISTINCT FROM v_led.reason
     OR v_job.actor            IS DISTINCT FROM v_led.actor
     OR v_job.request_id       IS DISTINCT FROM v_led.request_id THEN
    RAISE EXCEPTION 'A7b job↔ledger:job % 與帳本 % 的十一欄不完全相等', v_job.id, v_led.id
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_ledger_column_mismatch';
  END IF;

  -- item set 雙向無差集。
  -- 🔴🔴 括號不可省,理由同 pcm_a7bt_assert_job_consistent(同一個 bug 在本檔出現兩次)。
  SELECT count(*) INTO v_bad FROM (
    (SELECT order_item_id, quantity, unit_price, line_amount
       FROM public.order_refund_job_items WHERE job_id = v_job.id
     EXCEPT ALL
     SELECT order_item_id, quantity, unit_price, line_amount
       FROM public.order_refund_items WHERE refund_id = v_led.id)
    UNION ALL
    (SELECT order_item_id, quantity, unit_price, line_amount
       FROM public.order_refund_items WHERE refund_id = v_led.id
     EXCEPT ALL
     SELECT order_item_id, quantity, unit_price, line_amount
       FROM public.order_refund_job_items WHERE job_id = v_job.id)
  ) d;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'A7b job↔ledger:job % 與帳本 % 的明細集合不同(差集 % 列)',
      v_job.id, v_led.id, v_bad
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_ledger_item_set_differs';
  END IF;

  RETURN NULL;
END;
$$;

-- ══ 7. 函式 EXECUTE 收斂 ═════════════════════════════════════════════════════
-- 🔴 PostgreSQL 新建 function **預設 GRANT EXECUTE TO PUBLIC**
--    (逐字沿用 `20260725130100:327-334` / `20260730140000:205-210` 的理由與實測)。
--    本片全部是 SECURITY INVOKER ⇒ 沒有「以 owner 權限起跑」那個攻擊面;
--    但 REVOKE 仍然要做:任何 role 都能把守門函式掛到**自己的表**上當 trigger,
--    製造一個名字長得像本片守門、行為卻由對方決定的物件,
--    會讓 §9.1 那類「靠函式名比對」的稽核產生混淆。
-- ⇒ 全數 REVOKE;trigger 由表擁有者觸發、**不需要任何 role 的 EXECUTE 權限**。
REVOKE ALL ON FUNCTION public.pcm_a7bt_block_write()               FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7bt_block_truncate()            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7bt_allowed_delta(text)         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7bt_jobs_before_insert()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7bt_jobs_before_update()        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7bt_assert_job_consistent()     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a7bt_assert_job_ledger_equal()   FROM PUBLIC, anon, authenticated, service_role;

-- ══ 8. 十支 trigger(manifest = plan §5.0)════════════════════════════════════
-- 🔴 具名 ID 由 TG_ARGV 帶入,三支共用 pcm_a7bt_block_write 但各自紅在不同 constraint 名
--    ⇒ 負測分得出「紅在哪一支」;刪掉其中一支,另一支不會替它擋。

-- parent 六支
CREATE TRIGGER a7bt_jobs_before_insert
  BEFORE INSERT ON public.order_refund_jobs
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_jobs_before_insert();

CREATE TRIGGER a7bt_jobs_before_update
  BEFORE UPDATE ON public.order_refund_jobs
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_jobs_before_update();

CREATE TRIGGER a7bt_jobs_block_delete
  BEFORE DELETE ON public.order_refund_jobs
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_block_write('a7bt_jobs_delete_blocked');

-- 🔴🔴 **施工時本機實跑發現(2026-07-31),負測作者必讀**:
--    `TRUNCATE public.order_refund_jobs` **單獨下**根本走不到本 trigger ——
--    子表的 `orji_job_fk` 指向本表,PostgreSQL 在更早的階段就回
--    `0A000 cannot truncate a table referenced in a foreign key constraint`。
--    ⇒ **用那個形狀寫負測 = 假綠:把本 trigger 整支刪掉,測試仍然會過**
--      (它測到的是 FK 的行為,不是這支守門的)。
--    本守門的**可達形狀只有兩種**(兩種都已實測會紅在 a7bt_jobs_truncate_blocked):
--      ① `TRUNCATE public.order_refund_jobs CASCADE`
--      ② `TRUNCATE public.order_refund_jobs, public.order_refund_job_items`
--    ⇒ T3b / T4 的負測**必須用這兩種之一**,並且突變(刪掉本 trigger)必須讓它轉紅。
-- 🔴🔴 **T2 追加實測(2026-07-31),照上面兩種形狀寫仍可能假綠**:交易內只要還有
--    **pending 的 DEFERRED trigger 事件**(= 任何剛插完 job/明細的 fixture 還沒
--    `SET CONSTRAINTS ALL IMMEDIATE`),`TRUNCATE jobs, items` 會先死在
--    **`55006 cannot TRUNCATE … because it has pending trigger events`**,
--    而該錯誤的 `CONSTRAINT_NAME` 是**空的** ⇒ 「斷言紅在 a7bt_jobs_truncate_blocked」的負測
--    會拿到空字串、而把本 trigger 整支刪掉結果完全一樣 = 測不到任何東西。
--    ⇒ T3b / T4 的 TRUNCATE 負測**必須先把 fixture 的 deferred 事件清乾淨**
--      (先 `SET CONSTRAINTS ALL IMMEDIATE`,或在沒有 pending 事件的空表上跑);
--      實測空表時才會如預期紅在 `P7B01 / a7bt_jobs_truncate_blocked`。
CREATE TRIGGER a7bt_jobs_block_truncate
  BEFORE TRUNCATE ON public.order_refund_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_a7bt_block_truncate('a7bt_jobs_truncate_blocked');

CREATE CONSTRAINT TRIGGER a7bt_jobs_after_ins_consistency
  AFTER INSERT ON public.order_refund_jobs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_assert_job_consistent();

CREATE CONSTRAINT TRIGGER a7bt_jobs_after_insupd_ledger
  AFTER INSERT OR UPDATE ON public.order_refund_jobs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_assert_job_ledger_equal();

-- child 四支
CREATE TRIGGER a7bt_items_block_update
  BEFORE UPDATE ON public.order_refund_job_items
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_block_write('a7bt_items_update_blocked');

-- 🔴 第 8 支(永久阻擋)與第 10 支(constraint trigger 的 DELETE 分支)**不是重複**:
--    第 10 支必須含 DELETE 才是正確形狀(`20260725130100:180-186` 的既有教訓:
--    子表那支不含 DELETE 的話,刪明細後合計失衡不會觸發)。
--    現行設計下第 8 支讓第 10 支的 DELETE 分支**永遠不會被觸發**
--    ⇒ 依「不留無法獨立證明的東西」紀律,該分支在 §7.2 標為**結構字面驗證**,
--      它的價值在 break-glass 期間第 8 支被 DISABLE 時。
CREATE TRIGGER a7bt_items_block_delete_guard
  BEFORE DELETE ON public.order_refund_job_items
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_block_write('a7bt_items_delete_blocked');

CREATE TRIGGER a7bt_items_block_truncate
  BEFORE TRUNCATE ON public.order_refund_job_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_a7bt_block_truncate('a7bt_items_truncate_blocked');

-- 🔴 **Sean 07-31 拍 Q3=A:加上 UPDATE(刻意偏離 plan §5.0 manifest 的「INSERT OR DELETE」)**
--    關卡2 抓到規格自身矛盾:manifest 保留 DELETE 分支的理由是「破窗期間第 8 支被 DISABLE 時
--    這一支還在」,但 UPDATE 的處境**完全一樣**(平常被 a7bt_items_block_update 永久擋住)。
--    只 DISABLE `a7bt_items_block_update` 就能改 quantity / line_amount,
--    而 C2/C3/C4 與「後代 item set 相等」**都不會排隊檢查** ⇒ 失衡可提交。
--    ⇒ 三個事件一致才是完整的第二層。plan §5.0 已同步更正(tgtype 13 → 29)。
CREATE CONSTRAINT TRIGGER a7bt_items_after_insdel_consistency
  AFTER INSERT OR UPDATE OR DELETE ON public.order_refund_job_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a7bt_assert_job_consistent();

-- ══ 9. 結構驗收(fail-closed;必須在移除 gate 之前全過)══════════════════════
-- 🔴🔴 本段被 codex 關卡 2 打了 10 條 must-fix,全部同一個病:**驗收自己會假綠**。
--    「數總數」「驗同名存在」「只驗 FK 存在」「只比 relname/proname」
--    全部被實證可以在規則被改壞的情況下仍然全綠。折入後的原則:
--      ① 能比「系統自己產生的完整定義字串」就不要自己拼欄位
--         (pg_get_triggerdef / pg_get_constraintdef / indexdef —— 少拼一個欄位就少一個漏洞)
--      ② 定義字串蓋不到的執行期狀態(tgenabled、ACL、owner、函式本體)另外逐項比對
--      ③ 一律**集合相等**,不是「我列的都在」
--      ④ 本片**移除 gate**,所以移除前必須確認 **A7b-M 的結構也還完好**
--         —— 否則 M 被改壞 + T 照跑 = 閘門在守門已失效的表上被拆掉
DO $$
DECLARE
  v_expect  text;
  v_actual  text;
  v_missing text;
  v_cnt     integer;
BEGIN
  -- ── 9.1 十支 trigger:比對系統產生的完整定義 + 啟用態 ──────────────────
  -- 🔴 用 pg_get_triggerdef 一次涵蓋 timing / 事件 / ROW-STMT / DEFERRABLE /
  --    函式(含 schema)/ **傳入的具名 ID 參數** / WHEN 條件。
  --    關卡2 抓到我原本自拼欄位漏掉的四樣:tgenabled、tgqual、schema、tgargs
  --    —— 其中 tgargs 一旦被掉包,負測會拿到**錯的 CONSTRAINT_NAME**,
  --    「精確歸因」這份契約整個失效而測試全綠。
  -- 🔴 tgenabled **必須另外驗**:pg_get_triggerdef **不反映** DISABLE TRIGGER。
  --    在本 DO block 之前 DISABLE 掉守門,定義字串一字不差、gate 照樣被移除。
  FOR v_expect, v_actual IN
    SELECT e.def,
           coalesce(
             (SELECT pg_get_triggerdef(t.oid) || '|enabled=' || t.tgenabled::text
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace tn ON tn.oid = c.relnamespace
               WHERE t.tgname = e.tgname
                 AND tn.nspname = 'public'
                 AND c.relname = e.relname
                 AND NOT t.tgisinternal),
             '(缺)')
      FROM (VALUES
        ('a7bt_jobs_before_insert',            'order_refund_jobs',      'CREATE TRIGGER a7bt_jobs_before_insert BEFORE INSERT ON public.order_refund_jobs FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_jobs_before_insert()|enabled=O'),
        ('a7bt_jobs_before_update',            'order_refund_jobs',      'CREATE TRIGGER a7bt_jobs_before_update BEFORE UPDATE ON public.order_refund_jobs FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_jobs_before_update()|enabled=O'),
        ('a7bt_jobs_block_delete',             'order_refund_jobs',      'CREATE TRIGGER a7bt_jobs_block_delete BEFORE DELETE ON public.order_refund_jobs FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_block_write(''a7bt_jobs_delete_blocked'')|enabled=O'),
        ('a7bt_jobs_block_truncate',           'order_refund_jobs',      'CREATE TRIGGER a7bt_jobs_block_truncate BEFORE TRUNCATE ON public.order_refund_jobs FOR EACH STATEMENT EXECUTE FUNCTION pcm_a7bt_block_truncate(''a7bt_jobs_truncate_blocked'')|enabled=O'),
        ('a7bt_jobs_after_ins_consistency',    'order_refund_jobs',      'CREATE CONSTRAINT TRIGGER a7bt_jobs_after_ins_consistency AFTER INSERT ON public.order_refund_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_assert_job_consistent()|enabled=O'),
        ('a7bt_jobs_after_insupd_ledger',      'order_refund_jobs',      'CREATE CONSTRAINT TRIGGER a7bt_jobs_after_insupd_ledger AFTER INSERT OR UPDATE ON public.order_refund_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_assert_job_ledger_equal()|enabled=O'),
        ('a7bt_items_block_update',            'order_refund_job_items', 'CREATE TRIGGER a7bt_items_block_update BEFORE UPDATE ON public.order_refund_job_items FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_block_write(''a7bt_items_update_blocked'')|enabled=O'),
        ('a7bt_items_block_delete_guard',      'order_refund_job_items', 'CREATE TRIGGER a7bt_items_block_delete_guard BEFORE DELETE ON public.order_refund_job_items FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_block_write(''a7bt_items_delete_blocked'')|enabled=O'),
        ('a7bt_items_block_truncate',          'order_refund_job_items', 'CREATE TRIGGER a7bt_items_block_truncate BEFORE TRUNCATE ON public.order_refund_job_items FOR EACH STATEMENT EXECUTE FUNCTION pcm_a7bt_block_truncate(''a7bt_items_truncate_blocked'')|enabled=O'),
        ('a7bt_items_after_insdel_consistency','order_refund_job_items', 'CREATE CONSTRAINT TRIGGER a7bt_items_after_insdel_consistency AFTER INSERT OR DELETE OR UPDATE ON public.order_refund_job_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pcm_a7bt_assert_job_consistent()|enabled=O')
      ) AS e(tgname, relname, def)
  LOOP
    IF v_actual IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'A7b-T 驗收失敗(9.1 trigger)— 期望 [%],實際 [%]', v_expect, v_actual;
    END IF;
  END LOOP;

  -- 🔴 集合相等:本片的十支之外,兩表不得有任何其他非內部 trigger。
  SELECT count(*) INTO v_cnt
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace tn ON tn.oid = c.relnamespace
   WHERE tn.nspname = 'public'
     AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')
     AND NOT t.tgisinternal;
  IF v_cnt <> 10 THEN
    RAISE EXCEPTION 'A7b-T 驗收失敗(9.1)— 兩表的非內部 trigger 應為 10 支,實為 %', v_cnt;
  END IF;

  -- 🔴 綁定的函式必須都在 **public** schema。
  --    pg_get_triggerdef 只在「函式不在 search_path 上」時才印出 schema
  --    ⇒ 若攻擊者把假函式放進一個**排在 public 前面**的 schema,定義字串可能仍印成不帶 schema。
  --    ⇒ namespace 另外硬驗一次,不倚賴渲染結果。
  FOR v_missing IN
    SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace tn ON tn.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
     WHERE tn.nspname = 'public'
       AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')
       AND NOT t.tgisinternal
       AND (pn.nspname <> 'public' OR p.proname NOT LIKE 'pcm\_a7bt\_%')
  LOOP
    RAISE EXCEPTION
      'A7b-T 驗收失敗(9.1)— trigger % 綁到 public.pcm_a7bt_* 以外的函式', v_missing;
  END LOOP;

  -- ── 9.2 42 欄 manifest:name | 型別 | notnull | **DEFAULT** ────────────
  -- 🔴 關卡2 抓:原本漏驗 DEFAULT(plan §7.2 本來就要求 pg_attrdef)。
  --    把 status 的預設改成 'dead',欄名/型別/notnull 全不變 ⇒ 我原本的比對全綠,
  --    而所有省略 status 的 INSERT 之後都會被 a7bt_insert_must_be_queued 拒絕。
  FOR v_expect, v_actual IN
    SELECT format('%s|%s|%s|%s', e.attname, e.atttype, e.attnotnull, e.attdefault),
           coalesce(
             (SELECT format('%s|%s|%s|%s', a.attname,
                       format_type(a.atttypid, a.atttypmod), a.attnotnull,
                       coalesce(pg_get_expr(d.adbin, d.adrelid), '(none)'))
                FROM pg_attribute a
                LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
               WHERE a.attrelid = 'public.order_refund_jobs'::regclass
                 AND a.attname = e.attname
                 AND a.attnum > 0 AND NOT a.attisdropped),
             '(缺)')
      FROM (VALUES
        ('id','uuid','t','gen_random_uuid()'),
        ('cancellation_id','uuid','t','(none)'),
        ('order_id','uuid','t','(none)'),
        ('generation','integer','t','1'),
        ('rec_trade_id','text','t','(none)'),
        ('bank_refund_id','text','t','(none)'),
        ('payload_hash','text','t','(none)'),
        ('tappay_refund_id','text','f','(none)'),
        ('refund_amount','integer','t','(none)'),
        ('refunded_before','integer','f','(none)'),
        ('refunded_target','integer','f','(none)'),
        ('items_amount','integer','t','(none)'),
        ('shipping_fee_before','integer','t','(none)'),
        ('shipping_fee_after','integer','t','(none)'),
        ('shipping_delta','integer','t','(none)'),
        ('reason','text','t','(none)'),
        ('actor','text','t','(none)'),
        ('request_id','text','t','(none)'),
        ('status','text','t','''queued''::text'),
        ('claim_token','uuid','f','(none)'),
        ('claimed_at','timestamp with time zone','f','(none)'),
        ('claim_expires_at','timestamp with time zone','f','(none)'),
        ('refund_call_attempted_at','timestamp with time zone','f','(none)'),
        ('last_refund_call_at','timestamp with time zone','f','(none)'),
        ('retry_count','integer','t','0'),
        ('next_retry_at','timestamp with time zone','f','(none)'),
        ('next_check_at','timestamp with time zone','f','(none)'),
        ('check_fail_count','integer','t','0'),
        ('failed_reason','text','f','(none)'),
        ('manual_review_required','boolean','t','false'),
        ('reviewed_at','timestamp with time zone','f','(none)'),
        ('reviewed_by','text','f','(none)'),
        ('resolution','text','f','(none)'),
        ('dead_reason','text','f','(none)'),
        ('retry_auth_recorded_refunded','integer','f','(none)'),
        ('retry_auth_checked_at','timestamp with time zone','f','(none)'),
        ('corrected_at','timestamp with time zone','f','(none)'),
        ('corrected_by','text','f','(none)'),
        ('correction_reason','text','f','(none)'),
        ('refund_id','uuid','f','(none)'),
        ('created_at','timestamp with time zone','t','now()'),
        ('updated_at','timestamp with time zone','t','now()')
      ) AS e(attname, atttype, attnotnull, attdefault)
  LOOP
    IF v_actual IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'A7b-T 驗收失敗(9.2 欄位)— 期望 [%],實際 [%]', v_expect, v_actual;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_refund_jobs'::regclass
     AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 42 THEN
    RAISE EXCEPTION 'A7b-T 驗收失敗(9.2)— order_refund_jobs 應為 42 欄,實為 %', v_cnt;
  END IF;

  -- ── 9.3 七支 FK:比對系統產生的完整定義 + 所屬表 ───────────────────────
  -- 🔴 關卡2 抓:原本只比「全庫有同名 FK 且 confdeltype='r'」。
  --    把 orji_item_fk 改成單欄 order_item_id → order_items.id RESTRICT 仍然全綠,
  --    而**跨訂單的品項就能掛進退款 job**(複合 FK 的整個作用消失)。
  --    ⇒ 改比 pg_get_constraintdef:一次涵蓋來源欄組、目標表、目標欄組、ON DELETE。
  FOR v_expect, v_actual IN
    SELECT format('%s@%s|%s', e.conname, e.relname, e.def),
           coalesce(
             (SELECT format('%s@%s|%s', con.conname, c.relname, pg_get_constraintdef(con.oid))
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = e.relname
                 AND con.conname = e.conname AND con.contype = 'f'),
             '(缺)')
      FROM (VALUES
        ('orj_cancellation_fk','order_refund_jobs',
         'FOREIGN KEY (cancellation_id, order_id) REFERENCES order_cancellations(id, order_id) ON DELETE RESTRICT'),
        ('orj_actor_fk','order_refund_jobs',
         'FOREIGN KEY (actor) REFERENCES staff(id) ON DELETE RESTRICT'),
        ('orj_reviewed_by_fk','order_refund_jobs',
         'FOREIGN KEY (reviewed_by) REFERENCES staff(id) ON DELETE RESTRICT'),
        ('orj_corrected_by_fk','order_refund_jobs',
         'FOREIGN KEY (corrected_by) REFERENCES staff(id) ON DELETE RESTRICT'),
        ('orj_refund_fk','order_refund_jobs',
         'FOREIGN KEY (refund_id) REFERENCES order_refunds(id) ON DELETE RESTRICT'),
        ('orji_job_fk','order_refund_job_items',
         'FOREIGN KEY (job_id, order_id) REFERENCES order_refund_jobs(id, order_id) ON DELETE RESTRICT'),
        ('orji_item_fk','order_refund_job_items',
         'FOREIGN KEY (order_id, order_item_id) REFERENCES order_items(order_id, id) ON DELETE RESTRICT')
      ) AS e(conname, relname, def)
  LOOP
    IF v_actual IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'A7b-T 驗收失敗(9.3 FK)— 期望 [%],實際 [%]', v_expect, v_actual;
    END IF;
  END LOOP;

  -- ── 9.4 七支函式:存在 / INVOKER / search_path / owner / **本體指紋** / **完整 ACL** ──
  -- 🔴 關卡2 抓兩條:
  --    ① 原本不驗函式本體 ⇒ 把 pcm_a7bt_jobs_before_update 整個掏空成 `RETURN NEW`,
  --       名稱、search_path、ACL 全不變、驗收全綠,而**所有 UPDATE 守門失效**。
  --    ② 原本 ACL 用「排除四個具名角色」⇒ 多 GRANT 一個自訂角色就漏。改成 allowlist:
  --       完整 grantee 集合必須**只有 owner 自己**。
  -- 🔴 md5(prosrc) 的跨環境成立性:本 repo 已在 N3a/N3b 實證「正式站逐字元 = 本機算出值」。
  FOR v_expect, v_actual IN
    SELECT format('%s|%s', e.proname, e.md5),
           coalesce(
             (SELECT format('%s|%s', p.proname, md5(p.prosrc))
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = e.proname),
             '(缺)')
      FROM (VALUES
        ('pcm_a7bt_block_write',             'c98400dc1a4ee2e5683269e3926dbb81'),
        ('pcm_a7bt_block_truncate',          '5560a7dac9d1d5e8f9e9559c83893a9f'),
        ('pcm_a7bt_allowed_delta',           '1d28b7f83b078e2de23175f8c618f141'),
        ('pcm_a7bt_jobs_before_insert',      '667875ef084d4f0b130817c5ff8d6f2e'),
        ('pcm_a7bt_jobs_before_update',      '6ce43f7499742d2e2ceb4c780f439560'),
        ('pcm_a7bt_assert_job_consistent',   '04a247b662142d93f8635c133f63a16c'),
        ('pcm_a7bt_assert_job_ledger_equal', '276e7dc4d4de51932dca8bef74469c02')
      ) AS e(proname, md5)
  LOOP
    IF v_actual IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'A7b-T 驗收失敗(9.4 函式本體指紋)— 期望 [%],實際 [%]', v_expect, v_actual;
    END IF;
  END LOOP;

  -- 全部七支必須是 SECURITY INVOKER + 釘死 search_path + owner = postgres。
  FOR v_missing IN
    SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'pcm_a7bt\_%'
       AND (p.prosecdef = true
            OR p.proconfig IS NULL
            OR NOT ('search_path=public, pg_temp' = ANY (p.proconfig))
            OR pg_get_userbyid(p.proowner) <> 'postgres')
  LOOP
    RAISE EXCEPTION
      'A7b-T 驗收失敗(9.4)— % 不是 SECURITY INVOKER、search_path 未釘死、或 owner 不是 postgres',
      v_missing;
  END LOOP;

  -- 🔴 完整 ACL allowlist:唯一允許的 grantee 是 owner 自己(postgres)。
  --    proacl IS NULL = 「預設」= PUBLIC 可執行 ⇒ 同樣算失敗。
  FOR v_missing IN
    SELECT p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'pcm_a7bt\_%'
       AND (p.proacl IS NULL
            OR EXISTS (
              SELECT 1 FROM aclexplode(p.proacl) ae
               WHERE ae.grantee <> p.proowner
            ))
  LOOP
    RAISE EXCEPTION
      'A7b-T 驗收失敗(9.4 ACL allowlist)— % 的 grantee 不是只有 owner 一個', v_missing;
  END LOOP;

  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'pcm_a7bt\_%';
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'A7b-T 驗收失敗(9.4)— pcm_a7bt_* 函式應為 7 支,實為 %', v_cnt;
  END IF;

  -- ── 9.5 allowed-delta:**精確集合**比對,逐 edge 完整白名單 ─────────────
  -- 🔴 關卡2 抓:原本只驗「非 NULL + 含 status/updated_at + 欄名存在」。
  --    把 next_retry_at 加進 E6 白名單後全綠,而 E6 就能任意重算重試時間
  --    ——「只保留不重算」那條規則本來就是靠**不在白名單裡**強制的,
  --    白名單一鬆,那條規則連同它的註解一起變成空話。
  FOR v_expect, v_actual IN
    SELECT e.edge || '=' || e.cols,
           coalesce(e.edge || '=' || (
             SELECT string_agg(c, ',' ORDER BY c)
               FROM unnest(public.pcm_a7bt_allowed_delta(e.edge)) AS u(c)
           ), e.edge || '=(NULL)')
      FROM (VALUES
        ('E1',  'claim_expires_at,claim_token,claimed_at,next_retry_at,status,updated_at'),
        ('E2',  'refunded_before,refunded_target,status,updated_at'),
        ('E2b', 'last_refund_call_at,refund_call_attempted_at,status,updated_at'),
        ('E3',  'claim_expires_at,claim_token,claimed_at,status,updated_at'),
        ('E3b', 'claim_expires_at,claim_token,claimed_at,next_check_at,status,updated_at'),
        ('E4',  'claim_expires_at,claim_token,claimed_at,next_check_at,status,tappay_refund_id,updated_at'),
        ('E5',  'claim_expires_at,claim_token,claimed_at,failed_reason,next_retry_at,refund_call_attempted_at,retry_count,status,updated_at'),
        ('E5b', 'claim_expires_at,claim_token,claimed_at,dead_reason,failed_reason,manual_review_required,next_retry_at,refund_call_attempted_at,retry_count,status,updated_at'),
        ('E6',  'failed_reason,status,updated_at'),
        ('E8',  'claim_expires_at,claim_token,claimed_at,status,updated_at'),
        ('E9',  'claim_expires_at,claim_token,claimed_at,next_check_at,refund_id,status,updated_at'),
        ('E10', 'check_fail_count,claim_expires_at,claim_token,claimed_at,next_check_at,status,updated_at'),
        ('E11', 'claim_expires_at,claim_token,claimed_at,status,updated_at'),
        ('E12', 'check_fail_count,claim_expires_at,claim_token,claimed_at,dead_reason,manual_review_required,next_check_at,status,updated_at'),
        ('E13', 'resolution,retry_auth_checked_at,retry_auth_recorded_refunded,reviewed_at,reviewed_by,status,updated_at'),
        ('E14', 'corrected_at,corrected_by,correction_reason,resolution,retry_auth_checked_at,retry_auth_recorded_refunded,status,updated_at')
      ) AS e(edge, cols)
  LOOP
    IF v_actual IS DISTINCT FROM v_expect THEN
      RAISE EXCEPTION 'A7b-T 驗收失敗(9.5 白名單)— 期望 [%],實際 [%]', v_expect, v_actual;
    END IF;
  END LOOP;

  -- 白名單裡的欄名必須真的存在(打錯字會靜默變成「這欄不在白名單」⇒ 合法轉移被擋)。
  FOR v_missing IN
    SELECT DISTINCT u.col
      FROM (VALUES ('E1'),('E2'),('E2b'),('E3'),('E3b'),('E4'),('E5'),('E5b'),
                   ('E6'),('E8'),('E9'),('E10'),('E11'),('E12'),('E13'),('E14')) AS e(edge)
      CROSS JOIN LATERAL unnest(public.pcm_a7bt_allowed_delta(e.edge)) AS u(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = 'public.order_refund_jobs'::regclass
          AND a.attname = u.col AND a.attnum > 0 AND NOT a.attisdropped)
  LOOP
    RAISE EXCEPTION 'A7b-T 驗收失敗(9.5)— 白名單欄名 % 不存在於 order_refund_jobs', v_missing;
  END LOOP;

  -- ── 9.6 🔴🔴 A7b-M 的結構指紋(移除 gate 之前必須確認 M 還完好)─────────
  -- 🔴 關卡2 抓的最重一條:本片會**移除閘門**,但完全沒重驗 M 的 36 條 CHECK、
  --    五道唯一性與索引。M 之後若有人把 D9d 同名改成 `CHECK (true)`,
  --    T 會照樣全綠、照樣拆閘門 ⇒ 「結案金額必須等於本代 baseline」那道錢面守門已死,
  --    而表從此可寫。⇒ 拆閘門的前提是「我要守的東西還在」。
  -- 🔴 指紋**排除 dormant gate 本身**(它馬上要被拆掉)⇒ 拆前拆後同一個值,T4 可直接沿用。
  -- 🔴🔴 **也必須排除 `contype = 't'`(正式站 read-back 當場抓到、2026-07-31)**:
  --    `CREATE CONSTRAINT TRIGGER` 會在 `pg_constraint` 留下 contype='t' 的列
  --    ⇒ 本片自己建的三支 constraint trigger 會被算進來。
  --    我原本的常數(`718e86eb…` / 55 條)就是這樣算出來的 —— 斷言仍會通過,
  --    但它量的是「**M + 本片**」,而註解與錯誤訊息卻寫「A7b-M 的約束」= **字面與事實不符**,
  --    正是本線一直在抓的那個病(防護被命名成不同於它實際量到的東西)。
  --    ⇒ 排除後 = **52 條 / b2612ec8…**,且已與**正式站實測值逐字元相同**
  --      (正式站當時只套到 A7b-M、沒有本片 ⇒ 那是純粹的 M 指紋,構成跨環境交叉驗證)。
  --    本片自己的三支 constraint trigger 由 §9.1 的 trigger manifest 負責,不重複計。
  SELECT md5(string_agg(sig, E'\n' ORDER BY sig)) INTO v_actual FROM (
    SELECT c.relname || '.' || con.conname || '=' || pg_get_constraintdef(con.oid) AS sig
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')
       AND con.contype <> 't'
       AND con.conname <> 'order_refund_jobs_dormant_until_triggers'
  ) s;
  IF v_actual IS DISTINCT FROM 'b2612ec86908e886269d73e687108a63' THEN
    RAISE EXCEPTION
      'A7b-T 驗收失敗(9.6)— A7b-M 的約束集合指紋不符:期望 b2612ec86908e886269d73e687108a63,實際 %。'
      '⇒ M 的約束在 M 與 T 之間被改動過,**不得拆除 dormant gate**。', v_actual;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')
     AND con.contype <> 't'
     AND con.conname <> 'order_refund_jobs_dormant_until_triggers';
  IF v_cnt <> 52 THEN
    RAISE EXCEPTION
      'A7b-T 驗收失敗(9.6)— A7b-M 的約束應為 52 條(不含 gate、不含 constraint trigger),實為 %', v_cnt;
  END IF;

  SELECT md5(string_agg(indexdef, E'\n' ORDER BY indexdef)) INTO v_actual
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename IN ('order_refund_jobs', 'order_refund_job_items');
  IF v_actual IS DISTINCT FROM '929934fd60c980dfb39333f4689da872' THEN
    RAISE EXCEPTION
      'A7b-T 驗收失敗(9.6)— A7b-M 的索引集合指紋不符:期望 929934fd60c980dfb39333f4689da872,實際 %。'
      '⇒ 五道唯一性或排程索引被改動過,**不得拆除 dormant gate**。', v_actual;
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename IN ('order_refund_jobs', 'order_refund_job_items');
  IF v_cnt <> 15 THEN
    RAISE EXCEPTION 'A7b-T 驗收失敗(9.6)— A7b-M 的索引應為 15 條,實為 %', v_cnt;
  END IF;

  -- ── 9.7 自訂 SQLSTATE / CONSTRAINT 的 round-trip 自我測試 ──────────────
  -- 🔴 本片**所有**負測的斷言形狀都是「紅在具名 constraint」。若 P7B01 或
  --    USING CONSTRAINT 在這個 PG 版本上不如預期,那些負測會全部改紅在別的地方、
  --    或 CONSTRAINT_NAME 回空字串 ⇒ 整套驗收建立在沒被觀察過的假設上
  --    (A7-t 整檔就是這樣失效的:全檔沒有一個 USING CONSTRAINT)。
  BEGIN
    RAISE EXCEPTION 'a7bt self-test'
      USING ERRCODE = 'P7B01', CONSTRAINT = 'a7bt_selftest_marker';
  EXCEPTION WHEN SQLSTATE 'P7B01' THEN
    GET STACKED DIAGNOSTICS v_actual = CONSTRAINT_NAME;
    IF v_actual IS DISTINCT FROM 'a7bt_selftest_marker' THEN
      RAISE EXCEPTION
        'A7b-T 驗收失敗(9.7)— USING CONSTRAINT 沒有 round-trip:期望 a7bt_selftest_marker,實際 [%]',
        coalesce(v_actual, '(NULL)');
    END IF;
  END;

  -- ── 9.8 移除 gate 之前:gate 必須還在,且逐字仍是 CHECK (false)──────────
  SELECT pg_get_constraintdef(oid) INTO v_actual
    FROM pg_constraint
   WHERE conrelid = 'public.order_refund_jobs'::regclass
     AND conname  = 'order_refund_jobs_dormant_until_triggers';
  IF v_actual IS DISTINCT FROM 'CHECK (false)' THEN
    RAISE EXCEPTION 'A7b-T 驗收失敗(9.8)— dormant gate 的定義不是 CHECK (false),實為 [%]',
      coalesce(v_actual, '(不存在)');
  END IF;

  RAISE NOTICE 'A7b-T 結構驗收全數通過(trigger 定義+啟用態 / 42 欄含 DEFAULT / 七支 FK 定義 / 函式指紋+INVOKER+owner+ACL allowlist / 白名單精確集合 / A7b-M 約束與索引指紋 / SQLSTATE round-trip / gate 逐字)';
END;
$$;

-- ══ 10. 最後一步:移除 dormant gate ══════════════════════════════════════════
-- 🔴 位置就是這裡、不能更早(plan §1.1):所有守門安裝並通過結構驗收**之後**、
--    同一交易的**最後一步**。本片任何一步失敗 ⇒ 整支回滾 ⇒ 表存在但寫不進去
--    ⇒ 落回 plan §10 三方狀態矩陣的情境 3(正常中間態,由 gate 承接,不是異常)。
ALTER TABLE public.order_refund_jobs
  DROP CONSTRAINT order_refund_jobs_dormant_until_triggers;

-- ══ 11. 移除後的收尾斷言 ════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.order_refund_jobs'::regclass
       AND conname  = 'order_refund_jobs_dormant_until_triggers'
  ) THEN
    RAISE EXCEPTION 'A7b-T 驗收失敗(11)— dormant gate 仍然存在,DROP 沒有生效';
  END IF;
END;
$$;

-- 🔴 COMMENT 更新:A7b-M 的表註解寫著「守門全在 A7b-T」,那句話從這一刻起是過去式。
COMMENT ON TABLE public.order_refund_jobs IS
  'M-4b A7b 卡片退款工作表(一次要退的錢 = 一列)。TapPay 退款隔日生效 ⇒ 送出與確認之間需可持久化、可重入、可對帳的中間狀態。狀態機七態、16 條 edge 的守門由 A7b-T(20260731120100)的十支 trigger 強制,dormant gate 已於該片移除。🔴 **寫入路徑(Sean 2026-07-31 拍 Q1=D,推翻本檔原本的字面)**:寫入**一律走 owner 的 SECURITY DEFINER RPC**(plan §6 已具名 complete_refund_job / admin_resolve_dead_refund_job / admin_correct_dead_refund_resolution,worker 機械步驟的數支由第 3 批補齊),與 orders / order_cancellations / order_refunds 三張表一致。**「service_role 直接 UPDATE 本表」實測不可達**:BEFORE UPDATE 守門內對 pcm_a7bt_allowed_delta 是巢狀函式呼叫、以 current_user 檢查 EXECUTE ⇒ service_role 一律 42501;開新世代與 E14 另因 order_cancellations 的 FOR UPDATE 需要 UPDATE 權限而 42501(兩者皆由 scripts/a7bt-verify.sh 第 7 段當**合約**斷言,直寫哪天又通了會轉紅)。⚠️ **本片未收回那兩個 GRANT** —— service_role 對本表仍持有 INSERT/UPDATE(A7b-M 給的),`INSERT` 實測仍會成功(gen1 建單走得到);收回 GRANT 讓直寫在表層就失敗 = 第 3 批的前置,不在本片。守門靠 trigger、不靠表級權限這句仍然成立。🔴 **trigger 看不到的事**(全部是第 3 批 worker 的 DoD 硬前置,不得當成本表已有的防護):TapPay 是否真的成功、baseline 與 D9 證據是否真的來自 Record API、worker 的 token CAS、「逾時不得寫任何東西」的紀律(這條是 D7 失效的唯一入口)、TapPay 對同一 bank_refund_id 重送的實際行為(PCM 從未實測)。🔴 corrected_by <> reviewed_by 只保證兩個 staff.id,不保證兩個人。🔴 **job↔ledger 等值只掛在本表側**:job 完成並比對通過後,若有人去改 order_refunds 的欄位(例如 reason 改成另一個合法值),本表的 trigger 永遠不會再被觸發 ⇒ 十一欄從此不相等而無人發現。要擋住它必須在 order_refunds 上另掛 trigger(RF2a 的表),Sean 2026-07-31 拍板不跨過去 ⇒ 列為本片管不到的事,不得算成已有的防護。🔴 **開新世代重退的餘額比對只在 E2 取樣一次**:E2 到 E2b(真正發出退款呼叫)之間若前代退款才入帳,兩道都會通過。DB 層要再比一次需要 worker 帶入當下 Record 讀數 ⇒ 本表尚無該欄位,屬未落地的獨立待辦;在它落地前這是 worker 紀律 + 第 3 批 sandbox 實測關卡。';

COMMIT;
