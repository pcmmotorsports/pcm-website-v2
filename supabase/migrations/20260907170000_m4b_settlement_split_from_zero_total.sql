-- ═══ M-4b ⟦db-ZEROTOTALSPLIT⟧:把 admin_compute_order_settlement 從 76 抽出來單獨貼 ═══
-- Sean 2026-09-07 `Q55` 批准(plan `docs/plans/2026-09-07-zerototalsplit-plan.md`, 關卡1 兩輪)。
-- Sean 同日 `Q54` = 甲 ⇒ **76 不再貼**, 券那半另出新板。
--
-- 🔴 為什麼要抽:76(`20260901030000`)帶著券的相依閘而遲遲沒貼, 而這一支**不查券表**
--    (該段 `grep coupon` = 0 命中;它讀的 12 張表沒有一張是券的)
--    ⇒ 它被【與它無關的東西】擋在門外, 而正式庫因此停在較舊一代。
--
-- 🔬 三個 md5 都是唯讀量到的(2026-09-07):
--    · 正式庫現行(= 舊一代 `20260812140000…:356`)= `087a886d1dc2b379c5a02e607e703ead` len 9719
--    · 本支要產生的(= 76 `:1051` 那一版)      = `f134e95d24e768a84fd53d26f29aed70` len 11669
--    body 逐字抄自 76, **一個字未改**。
--
-- 🔴🔴 **前置閘是【三態】, 不是釘死一個舊 md5**(codex 關卡1 R2 `#3` 給的設計):
--      舊版 ⇒ 替換 · **目標版 ⇒ 不替換, 只驗屬性與 ACL** · 其他任何值 ⇒ 拒絕。
--    📌 **⇒ 本支與 76 沒有順序關係, 而且可以重跑。**
--    🛑 而它**分不出「尚未升級的舊版」與「刻意 rollback 回去的同一舊版」** —— 兩者 body 一模一樣。
--      **那不是閘能答的問題**, 要靠貼板紀律(rollback 之後要有人把板列改回 open)。**明寫, 不假裝閘擋得住。**
--
-- ⚠️ **本支【帶進來】的兩處行為變化, 逐條寫明**:
--    ① `voided` 排除:`orf.status <> 'failed'` ⇒ `NOT IN ('failed','voided')`
--       ⇒ 已作廢的補登不再被算成退款痕跡。`voided` 值已存在(貼板 70 已貼)⇒ **今天可構造**;
--       🛑 **未證實已發生** —— 要讀 `order_refunds` 才答得出, 我的唯讀角色沒試過那張表。
--    ② 0 元單的 P5 分支:只在 `payment_method = 'zero_total'` 時成立, 而寫那個值的
--       `settle_zero_total_order` **還沒貼** ⇒ 今天不會被觸發。
--       🛑 依據只是 **repo 裡沒有 `zero_total` 的寫入點** ⇒ **排除不了正式庫既有值或人工寫入。**
--
-- 🔴 **本支【沒有修】的一格(codex R2 `#5`, 我開檔驗過成立)**:
--    P5 的 0 元分支(本體內)**沒有檢查 `att.uncovered_n`**, 而同一個 P5 的第一分支有
--    ⇒ 一張 `total=0 · paid · zero_total · 零收款列` 而**存在未入帳 charged attempt** 的單,
--      其餘 P 值皆真時會被判 `settled`;舊一代會要求人工處理。
--    ⇒ 📌 **它跟著 body 一起搬進來了。本支不動它**(動它就不是「逐字抄」了)——
--      **已在板列 `⟦db-ZEROTOTALSPLIT⟧` 記為待處理。**

BEGIN;

DO $pre$
DECLARE v_oid oid; v_md5 text; v_n integer; v_own text; v_cfg text; v_sec boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('admin_compute_order_settlement', 0));

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_compute_order_settlement';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘 P1:該名字在 public 有 % 個多載(要 1 個)⇒ 停下人判', v_n;
  END IF;

  v_oid := 'public.admin_compute_order_settlement(uuid)'::regprocedure;
  SELECT md5(p.prosrc), pg_catalog.pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef
    INTO v_md5, v_own, v_cfg, v_sec FROM pg_proc p WHERE p.oid = v_oid;

  IF v_own <> 'postgres' THEN
    RAISE EXCEPTION '前置閘 P2:owner = %(要 postgres)⇒ 停下', v_own;
  END IF;

  IF v_md5 = 'f134e95d24e768a84fd53d26f29aed70' THEN
    RAISE NOTICE '前置閘 P3:正式庫【已經是】本支的目標版 ⇒ 不替換, 只往下驗屬性與 ACL。';
  ELSIF v_md5 = '087a886d1dc2b379c5a02e607e703ead' THEN
    RAISE NOTICE '前置閘 P3:正式庫是預期的舊一代 ⇒ 往下替換。';
  ELSE
    RAISE EXCEPTION '前置閘 P3:正式庫現行 body md5 = % ⇒ 既不是舊一代也不是目標版 ⇒ 停下, 不要蓋掉別人的東西', v_md5;
  END IF;
END
$pre$;

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
         ord.cancelled_reason,
         -- 🔴 2026-09-01 新增(0 元訂單片):P5 那一支要靠它才問得出
         --    「這張 0 元單**真的走過結清那條路**」, 而不只是「它的 total 現在是 0」。
         --    ⚠️ 這是本片對 `20260812140000` 那一代**除了 P5 之外唯一的改動**。
         ord.payment_method
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
      -- 🔴 ⟦b4-TAPPAYDIRECT⟧ A2 2026-09-07 加 'voided'(codex R2 抓到、線【帳號】account 改)。
      --    這是**反面述詞**:`<>` 加一個新狀態值會**自動把它含進去**
      --    ⇒ 一筆補登錯了、已作廢、**錢其實沒退**的訂單, 它的 `old_n` 仍會是 1
      --    ⇒ P6 判 false ⇒ 結清變 `needs_human / R_REFUND_TRACE_PRESENT`、金額輸出變 NULL。
      --    🔵 **`NOT IN` 在 voided 這個值還不存在的世界裡也成立** ⇒ 本檔與貼板 70 的先後無關。
      --    ⚠️ 而 `20260907030000`(貼板 70)是**建立** voided 那個值的那一支;
      --       本檔只是**不要把它算進來**, 兩者沒有依賴。
      WHERE orf.order_id = p_order_id AND orf.status NOT IN ('failed', 'voided'))          AS old_n,
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
      OR (pay.rows_n > 0 AND att.uncovered_n = 0)
      -- 🔴🔴 **第三支(2026-09-01, 0 元訂單片):`total = 0` 的單本來就沒有收款列。**
      --    ⇒ 那**不是「帳本沒回填」** —— 它本來就沒有東西可以填。
      --    成因:`order_payments.amount` 有 `CHECK (amount <> 0)`(`20260810100000:43`)
      --      ⇒ **0 元的收款列物理上寫不進去** ⇒ 全額折抵券的單走
      --        `settle_zero_total_order()`(`20260901030000`), 它刻意不寫帳本列。
      --    🔴 少了這一支, **每一張 0 元單都會被判成 `needs_human` / `G_LEDGER_NOT_BACKFILLED`**
      --      (下方那一格 `NOT c.p5 AND c.ps <> 'unpaid' AND c.rows_n = 0`)—— 而它其實是正常的。
      --    🔴 **本支【只放行 total = 0】** —— 有金額而零收款列的單**仍然判 false**(舊保護一格沒動)。
      --    📌 而作者原本的論證是「0 列的 SUM 是 0 ⇒ 不變式自己成立」⇒ **那句話是錯的**:
      --      PostgreSQL 零列的 `SUM()` 回 **NULL**, 不是 0(2026-09-01 實測, 含 coalesce 兩種寫法)。
      --      ⇒ **所以不能靠不變式自己成立, 要在這裡明寫一支。**
      -- ⛔ ~~本支第一版寫 `OR (o.total = 0 AND pay.rows_n = 0)`~~ **太寬**(codex R2 must-fix):
      --    ① 一張**還沒結清**的 0 元單(`unpaid`)也會走進來 ⇒ 而它不是 settled, 它是還沒付。
      --    ② 一張本來有金額、後來 `total` 被改成 0 的舊單 ⇒ 會**掩蓋掉真的**
      --       `G_LEDGER_NOT_BACKFILLED`(它確實少了收款列, 而那是問題)。
      -- ✅ 收緊成「**真的走過結清那條路**」:paid + `payment_method = 'zero_total'` + 零收款列。
      --    📌 判別句:**問「它怎麼變成 0 的」, 不要只問「它現在是不是 0」。**
      OR (o.total = 0 AND pay.rows_n = 0
          AND o.ps = 'paid' AND o.payment_method = 'zero_total'))
                                                         IS TRUE            AS p5,
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

-- ══ ACL(逐字抄自 76;`CREATE OR REPLACE` 保留 ACL, 這裡重申是為了讓它成為會執行的斷言)══
REVOKE ALL ON FUNCTION public.admin_compute_order_settlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_compute_order_settlement(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_compute_order_settlement(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_compute_order_settlement(uuid) TO service_role;

-- ══ 事後閘 ══
DO $post$
DECLARE v_oid oid; v_md5 text; v_n integer; v_own text; v_cfg text; v_sec boolean;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_compute_order_settlement';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A1:貼完有 % 個多載 ⇒ 我建了新簽章, 回滾', v_n;
  END IF;

  v_oid := 'public.admin_compute_order_settlement(uuid)'::regprocedure;
  SELECT md5(p.prosrc), pg_catalog.pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proconfig, ','), ''), p.prosecdef
    INTO v_md5, v_own, v_cfg, v_sec FROM pg_proc p WHERE p.oid = v_oid;

  IF v_md5 <> 'f134e95d24e768a84fd53d26f29aed70' THEN
    RAISE EXCEPTION '事後閘 A2:貼完 body md5 = %(要 f134e95d…)⇒ 回滾', v_md5;
  END IF;
  IF v_own <> 'postgres' THEN
    RAISE EXCEPTION '事後閘 A3:owner 變成 % ⇒ 回滾', v_own;
  END IF;

  -- 🔴 ACL fail-closed:service_role 必須叫得動, 而 anon / authenticated 必須叫不動。
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘 A4:service_role 叫不動這支 ⇒ 回滾';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘 A5:anon 或 authenticated 叫得動這支 ⇒ 回滾';
  END IF;

  RAISE NOTICE '事後閘 A1-A5 全過:單一多載 · body md5 = f134e95d… · owner=postgres · ACL 三向對。';
END
$post$;

COMMIT;

-- ══ 這一支【證不到】什麼 ══
--  · 前置閘的三態**分不出「尚未升級」與「刻意 rollback 的同一舊版」** —— 見檔頭。
--  · 本支**沒有修** P5 那一格缺 `att.uncovered_n` 的檢查(codex R2 #5)—— 它跟著 body 搬進來了。
--  · 「`voided` 那一格今天正在錯」**未證實** —— 只證構造得到(`voided` 值已存在), 沒讀過 `order_refunds`。
--  · advisory lock **只擋也拿同一把鍵的人** —— 76、舊貼板副本、SQL Editor 手改都不受它管。
