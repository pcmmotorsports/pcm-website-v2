-- ⟦auth-PARTIALREFUNDCANCELGAP⟧ —— 「取消了、而且只退了一部分」的刷卡單,兩條寄信線都掃不到它。
--
-- ══ 為什麼需要它 ═══════════════════════════════════════════════════════════
-- 🔬 兩條寄信線的述詞(取自線上實體 `pg_get_viewdef`,不是讀 migration):
--    `pcm_cancelled_email_pending`       要 `payment_status = 'refunded'`      + `cancelled_at IS NOT NULL`
--    `pcm_partial_refund_email_pending`  要 `payment_status = 'partiallyRefunded'` + `cancelled_at IS NULL`
-- 🎯 **目標單 = `partiallyRefunded` + `cancelled_at IS NOT NULL`**:
--    取消信線被**狀態欄**排掉;部分退款線被**取消欄**排掉。
-- 📌 **兩個述詞在【兩個不同的欄】上各自排掉它 ⇒ 不需要跑資料就成立。**
-- ⇒ 🔴 客人的錢動了,而這兩條線不會通知他。
--
-- ⚠️ **而【不要】把它讀成「客人零通知」** —— 他可能在取消前已收到部分退款信、或被人工通知過。
--    ✅ 精確版:**在這個狀態下,這兩張 view 不會再把它掃進來。**
--
-- ══ 🔵 Sean 拍板 ══════════════════════════════════════════════════════════
-- 方向 `QB-16` 拍過;做法 2026-09-10 逐字「做」⇒ 照 plan **B 案**(新開一支專用函式)。
-- 📎 plan `docs/plans/2026-09-09-partialrefundcancelgap-alert-plan.md`(§1-d 有 2026-09-10 逐格重量)。
-- 🛑 **不接 A 案(掛進 `get_cancelled_mixed_rail_gap_counts`)** —— 那支的 COMMENT 逐字自稱
--    「述詞**逐字鏡像** `pcm_cancelled_email_pending`」,而那張 view 要 `= 'refunded'`
--    ⇒ 📌 **掛進去 = 讓一支自稱鏡像那張 view 的函式開始說謊。**
--    ⇒ 🎯 那正是本列自己在抓的那種病:**一句自陳替另一件它其實沒在看的事背書。**
--
-- ══ 🔴 述詞走【甲:帳務仍未結清】,不是【乙:尚未通知】═══════════════════════
-- plan §3-B-2 把這一格留給實作,而它自己傾向甲。**我選甲,理由寫出來讓人推翻**:
--   ① **Sean 的原話是「帳對不上那一群去告警」** —— 那是**帳務語意**,不是通知語意。
--   ② 🛑 **乙不能拿「outbox 裡有一列」當作已通知** —— codex 給的可複現反例:
--      部分退款信先入列,**寄出前訂單被取消** ⇒ `sweep-email-outbox.ts:1522` 的資格檢查
--      會讓它**跳過寄送** ⇒ 📌 **那一列在 outbox 裡,而信沒寄。** 拿它當排除依據就會漏報。
--      ⇒ 乙要先定義「什麼算有效通知」(要寄成功的證據),**那是另一組判斷、另一片。**
-- 🛑 **而甲的代價要寫在這裡,不是等人發現**:
--    **一張已經處理完、而狀態沒收尾的單會一直叫。** 它的出口是「把錢退完 / 把狀態收掉」,
--    ⇒ 📌 **這是刻意的方向**:一個因為「有人通知過」而閉嘴的告警,在錢還沒退完時是**假的安靜**。
--
-- ══ 🔵 而「錢退完了沒」不自己算 —— 用 repo 已經裁定過的那把尺 ══════════════
-- `public.pcm_pending_refund_amounts(uuid)` ⇒ `TABLE(rail text, amount bigint)`(唯讀實量的簽章)。
-- 🔴 它同時是 `pcm_cron.late_payment_pending_refund_sweep()` 的濾網用的那一支
--    ⇒ 📌 **告警與兜底掃描器問的是【同一個問題】** ⇒ 兩邊不會各自演化出一套「什麼叫欠錢」。
-- ⚠️ 而那也是相依:**那支改了,本支的意思就跟著改**,而不會有東西叫。
--
-- ══ 🛑 這一支答不出什麼(寫在這裡,免得讀的人自己補)═══════════════════════
-- ① 它答【現況】不是【歷史】 —— 一張今天退完的單,昨天叫過的事實這裡看不到。
-- ② 它答不出「那封信/那通電話**實際上有沒有到**」 —— 甲案根本不看通知那一側。
-- ③ 分母 `total_count` 是**全部**已取消的部分退款刷卡單(不含 anti-join)
--    ⇒ 讀法:`pending / total` = 這批單裡有多少比例帳還沒結清。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
BEGIN
  -- ① 述詞要讀的那把尺
  IF pg_catalog.to_regprocedure('public.pcm_pending_refund_amounts(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 pcm_pending_refund_amounts(uuid) ⇒ 本支的述詞讀它, 沒有它等於沒有述詞';
  END IF;

  -- ② 目標單的定義來自那張 view —— 它不在, 表示我引的述詞已經不是線上那一版
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'pcm_partial_refund_email_pending' AND c.relkind = 'v')
  THEN
    RAISE EXCEPTION '前置閘②:找不到 view pcm_partial_refund_email_pending ⇒ 本支的目標單定義失去對照';
  END IF;

  -- ③ 收權對象
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'payment_confirmer') THEN
    RAISE EXCEPTION '前置閘③:找不到角色 payment_confirmer ⇒ 收權那一段會建出一支沒有人讀得到的函式';
  END IF;

  -- ④ 防重貼 —— 本支是 CREATE FUNCTION(不是 OR REPLACE), 已存在就該停在這裡而不是報一句 SQL 錯
  IF pg_catalog.to_regprocedure('public.get_partial_refund_cancel_gap_counts()') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:get_partial_refund_cancel_gap_counts() 已經存在 ⇒ 這一支貼過了, 拒重貼';
  END IF;

  -- ⑤ 🔵 正對照:同一把尺要問得出一個【應該在】的東西, 否則上面四個 NULL 可能是尺壞了
  IF pg_catalog.to_regprocedure('public.get_cancelled_mixed_rail_gap_counts()') IS NULL THEN
    RAISE EXCEPTION '前置閘⑤(正對照):連 get_cancelled_mixed_rail_gap_counts 都找不到 ⇒ 這把尺在錯的庫上';
  END IF;
END
$pre$;

-- 🔴 **`CREATE FUNCTION` 不是 `CREATE OR REPLACE`** —— 這是**新物件**。
--    ⇒ 回退 = `DROP FUNCTION public.get_partial_refund_cancel_gap_counts();`
--      (`supabase/rollbacks/20260909110000_down.sql`,而它帶自己的前置閘)。
--    ✅ 而 drop 是安全的:呼叫端讀不到函式時走「函式不存在 ⇒ null(不知道)」那條三態路徑,
--      **不是回 0**(⇒ 不會把「量不到」印成「沒有缺口」)。
CREATE FUNCTION public.get_partial_refund_cancel_gap_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_result pg_catalog.jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(

    -- 🔴🔴 **告警的主詞。** 刷卡單、已取消、狀態停在 partiallyRefunded、而**帳還沒結清**。
    --    🛑 兩條寄信線各自在**不同的欄**上排掉它(檔頭 §為什麼需要它)⇒ 沒有人會通知那位客人。
    'pending_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'partiallyRefunded'
          AND o.cancelled_at IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM public.pcm_pending_refund_amounts(o.id) AS a
                 WHERE a.amount > 0)),

    -- 🔵 **等了多久。** 一個**不會因為「有人通知過」而下降**的數字 ——
    --    沒有這一格就答不出「這是今天的新單, 還是三個星期沒有人管」。
    'oldest_cancelled_at',
      (SELECT pg_catalog.min(o.cancelled_at)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'partiallyRefunded'
          AND o.cancelled_at IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM public.pcm_pending_refund_amounts(o.id) AS a
                 WHERE a.amount > 0)),

    -- 🔵 分母。**一個計數沒有分母, 讀的人會自己補一個**(而他補的那個多半是全部)。
    --    🔴 它數的是【全部】已取消的部分退款刷卡單 —— **不帶 anti-join**。
    'total_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'partiallyRefunded'
          AND o.cancelled_at IS NOT NULL)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.get_partial_refund_cancel_gap_counts() IS
$c$回 jsonb{pending_count, oldest_cancelled_at, total_count}。
🔴 告警的主詞是 pending_count:刷卡單、已取消、狀態停在 partiallyRefunded、而帳還沒結清
   ⇒ 兩條寄信線【各自在不同的欄】上排掉它(取消信線要 payment_status='refunded';
     部分退款線要 cancelled_at IS NULL)⇒ 沒有人會通知那位客人。
🔴 述詞走【甲:帳務仍未結清】不是【乙:尚未通知】—— 依據是 Sean 的原話「帳對不上那一群去告警」。
   🛑 而乙不能拿「outbox 裡有一列」當已通知:部分退款信入列後、寄出前訂單被取消
     ⇒ sweep 的資格檢查會跳過寄送 ⇒ 那一列在 outbox 裡而信沒寄。
🔵 「帳結清了沒」用 public.pcm_pending_refund_amounts(uuid) —— 與 pcm_cron.late_payment_pending_refund_sweep()
   的濾網是【同一支】⇒ 告警與兜底掃描器問同一個問題, 不會各自演化出一套「什麼叫欠錢」。
   ⚠️ 而那也是相依:那支改了本支的意思就跟著改, 而不會有東西叫。
🛑 甲的代價(刻意接受):一張已經處理完而狀態沒收尾的單會一直叫 —— 它的出口是把錢退完 / 把狀態收掉。
   📌 一個因為「有人通知過」而閉嘴的告警, 在錢還沒退完時是【假的安靜】。
🛑 它答【現況】不是【歷史】, 也答不出那封信 / 那通電話實際上有沒有到(甲案不看通知那一側)。$c$;

-- ── 收權:跟著新物件走 ────────────────────────────────────────
-- 🔴 **不抄 `20260906970000`** —— 那支是【補既有授權】,不是新函式的收權範本(plan §3-B、codex R1 nit)。
-- 🔵 新函式出生自帶 PUBLIC ⇒ 這三行是**必要**的,不是保險。
REVOKE ALL ON FUNCTION public.get_partial_refund_cancel_gap_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partial_refund_cancel_gap_counts()
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_partial_refund_cancel_gap_counts() TO payment_confirmer;

-- ── 收權斷言 + 形狀斷言 + 接線斷言 ────────────────────────────
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_partial_refund_cancel_gap_counts()']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
  v_src       text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '缺口計數 收權斷言失敗:找不到函式 % ⇒ 拒繼續', r;
    END IF;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '缺口計數 收權斷言失敗:% 的 proacl 是 NULL(= PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '缺口計數 收權斷言失敗:% 的 EXECUTE 多出非預期角色(%)⇒ 拒繼續', r, v_extra;
    END IF;
    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '缺口計數 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警讀不到', r, v_acl;
    END IF;
  END LOOP;

  -- 🔴 形狀斷言:三個鍵一個都不能少(先驗它是不是 object —— `?` 對陣列也成立)。
  --    🛑 缺鍵的後果是**安靜的**:告警那側讀到 undefined ⇒ 恆不叫。
  v_shape := public.get_partial_refund_cancel_gap_counts();
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR NOT (v_shape ? 'pending_count')
     OR NOT (v_shape ? 'oldest_cancelled_at')
     OR NOT (v_shape ? 'total_count') THEN
    RAISE EXCEPTION '缺口計數 形狀斷言失敗:回傳缺鍵(收到 %)⇒ 告警那側會讀到 undefined 而恆不叫', v_shape;
  END IF;

  -- 🔵 **接線斷言 —— 純字面**,apply 當下庫裡沒有資料可以分辨行為。
  --    ⚠️ 它證的是「那三個字面寫進函式體了」,**證不到「述詞算得對」**
  --      —— 後者要在拋棄式 PG 上造資料驗(見 rollback 檔旁的驗收筆記)。
  --    🔵 用 `strpos(haystack, needle)` 不用 `position(needle IN haystack)` ——
  --      後者是**特殊語法**,加 `pg_catalog.` 前綴會被當成一般函式呼叫而當場炸。
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_partial_refund_cancel_gap_counts()');

  IF pg_catalog.strpos(v_src, 'partiallyRefunded') = 0 THEN
    RAISE EXCEPTION '缺口計數 接線斷言失敗:函式體裡找不到 partiallyRefunded ⇒ 它數的不是本列的那群單';
  END IF;
  IF pg_catalog.strpos(v_src, 'pcm_pending_refund_amounts') = 0 THEN
    RAISE EXCEPTION '缺口計數 接線斷言失敗:函式體裡找不到 pcm_pending_refund_amounts ⇒ 甲案那條述詞沒接上, 這一支會數到全部';
  END IF;
  -- ⚪ **負對照:這把尺不是恆真** —— 一個現造字面必須找不到。
  IF pg_catalog.strpos(v_src, 'zzz_never_a_literal') <> 0 THEN
    RAISE EXCEPTION '缺口計數 接線斷言失敗(負對照):現造字面竟然命中 ⇒ 這把尺壞了, 上面兩格的 t 不算數';
  END IF;
END
$assert$;

COMMIT;
