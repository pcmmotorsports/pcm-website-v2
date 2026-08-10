-- ============================================================
-- M-4b E10-OP6-a:訂單結清狀態**純算函式**(唯讀、零寫入)
-- ============================================================
-- 規格權威 = `B-430-PLAN.md` v4.1(md5 77e6b04823824e6295bf8d0be56479aa)。
-- 審查鏈:關卡1 codex R1(23 條)+ R2(22 條)→ 結構改為前提閘 → Fable R3(7 條)
--         → Fable 窄複審(F12)→ 本片。四輪共 53 條 must-fix,零駁回。
--
-- ── 這支做什麼 ─────────────────────────────────────────────────────────────
-- 輸入 order_id,回 jsonb:{gross, refunded, receivable, net, verdict, reasons[], scope}。
-- **零寫入**:LANGUAGE sql + 單一 statement(順帶滿足「G/R/D 必須同一快照」——多段 SELECT
-- 之間有 commit 會組出資料庫從未同時存在過的數字,然後給出有信心的 verdict)。
--
-- ── 🔴 verdict 的產生方式:前提閘,不是真值表 ───────────────────────────────
-- `verdict` **預設 `needs_human`**;只有**七條**前提(P1-P7)**全部被積極證明為真**才准降級成
-- settled / underpaid / overpaid。
-- 🔴🔴 **但這不等於「漏想到的形狀會自動保守」** —— 那句話是 plan v3 的宣稱,已被 Fable
--   用四個**在庫可構造**的形狀證偽(F1/F2/F4/F5):漏想到的形狀**可以**落在「六前提全 true」
--   區然後拿到有信心的錯答案。**結構只是把完整性負擔從真值表搬到「前提集合充分性」,
--   後者仍然是枚舉。** ⇒ 本片的正確宣稱只有一句:**誤判必須同時穿過七條前提**(縱深),
--   不是「不可能誤判」。🔴 **前提的「擋不掉什麼」寫在有已知缺口的那幾條旁邊**
--   (P1 的帳本起點、P5 的 join 鍵與 branch1、P6 的四面與各自除外值);**不是每條都寫了**。
--
-- ── 🔴 三值邏輯落地紀律(Fable F6)────────────────────────────────────────
-- SQL 裡「判不出來」**不自動等於 false**:`NOT premise` 遇 NULL 不成立;空集 `SUM` 回 NULL,
-- 進比較之後**每個 verdict 分支都不 fire**。⇒ 本檔硬性:
--   ①每條前提最終以 `IS TRUE` 收斂 ②`gross` 一律 `COALESCE(...,0)`
--   ③verdict 的 CASE **必有 `ELSE 'needs_human'`**(NULL 兜底,不是裝飾)。
--
-- ── 執行身分(Q8-1,已翻案)────────────────────────────────────────────────
-- **SECURITY DEFINER**。原本我推薦 INVOKER,實查推翻:`20260810100000:410` 逐字
-- `REVOKE ALL ON TABLE public.order_payments FROM PUBLIC, anon, authenticated, service_role, authenticator;`
-- ⇒ service_role 對錢帳表**零表權限**,INVOKER 會直接 permission denied、一格都跑不了。
--
-- ── 誠實邊界 ───────────────────────────────────────────────────────────────
-- `scope = db_internal_only`:本函式只知道**庫內事實**。卡軌的最終權威是 TapPay Record,
-- 庫內可能落後。verdict 永遠不是「錢的真相」,是「我們的帳目前這樣說」。
--
-- ── apply 前置 ─────────────────────────────────────────────────────────────
-- ① `transaction_timeout` = PG17-only ⇒ apply 前 `SHOW server_version`。
-- ② 本片零 DML、零表 DDL、可 `DROP FUNCTION` 回退,零資料風險。
-- ③ 施工窗不得自行 apply。
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

CREATE FUNCTION public.admin_compute_order_settlement(p_order_id uuid)
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
    -- ② L5b attempt 級:🔴 正向存在式(Fable F5)——必須「**有** terminal 且全部是
    --    result_failed」才除外。寫成 NOT EXISTS(非 failed terminal) 會讓 `sent`-only 與
    --    `result_unknown`-only(兩個最危險的未知態)變成**空集恆真**而被除外。
    (SELECT pg_catalog.count(*)
       FROM public.payment_refunds pr
       JOIN public.payment_charge_attempts a2 ON a2.id = pr.attempt_id
      WHERE a2.order_id = p_order_id
        AND NOT (
              EXISTS (SELECT 1 FROM public.payment_refund_events e
                       WHERE e.refund_id = pr.id
                         AND e.event_type IN ('result_success','result_failed','manual'))
          AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                           WHERE e.refund_id = pr.id
                             AND e.event_type IN ('result_success','manual'))
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

COMMENT ON FUNCTION public.admin_compute_order_settlement(uuid) IS
  'M-4b E10-OP6-a 訂單結清狀態純算函式(唯讀、零寫入、SECURITY DEFINER、search_path='''')。'
  '前提閘:verdict 預設 needs_human,**七條**前提(狀態值域/取消/品項快照/收款列形狀/帳本覆蓋/退款四面/金額範圍)全為真才降級。'
  '🔴 這**不是**「漏想到的形狀會自動保守」——那句已被 Fable 用四個在庫可構造的形狀證偽;'
  '正確宣稱只有「誤判必須同時穿過七條前提」(縱深)。退款面查四張表(order_refunds / '
  'payment_refunds+events / order_refund_jobs / payment_double_charge_anomalies)。'
  'scope=db_internal_only:只知庫內事實,卡軌外部權威是 TapPay Record。';

-- ── ACL:零 GRANT 給任何人以外的角色;只開 service_role ──────────────────────
REVOKE ALL ON FUNCTION public.admin_compute_order_settlement(uuid)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_compute_order_settlement(uuid) TO service_role;

-- ── 結構斷言(全部在同一交易內;任一紅 = 整片回滾、不留半套)────────────────
DO $gate$
DECLARE
  v_fn  oid := 'public.admin_compute_order_settlement(uuid)'::regprocedure;
  v_bad text;
  v_src text;
BEGIN
  -- ① SECDEF + search_path
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
    RAISE EXCEPTION 'OP6-a:本函式不是 SECURITY DEFINER ⇒ service_role 對錢帳表零表權限,一格都跑不了'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_not_secdef';
  END IF;
  -- 🔴 逐字比 `search_path=""`(含雙引號)—— 這是 PG 對 `SET search_path = ''` 的實際存法。
  --    我第一版寫 `proconfig @> ARRAY['search_path=']`,自己的閘當場紅在拋棄庫(實測),
  --    形式照 A12 `:388-391` 對齊。
  SELECT pg_catalog.array_to_string(p.proconfig, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF v_bad IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION 'OP6-a proconfig 是 [%],期望逐字 [%]', coalesce(v_bad,'(NULL)'), 'search_path=""'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_search_path';
  END IF;
  -- ② 唯讀:必須是 STABLE 或 IMMUTABLE(VOLATILE 代表有人把它改成會寫東西)
  IF (SELECT p.provolatile FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) NOT IN ('s','i') THEN
    RAISE EXCEPTION 'OP6-a:provolatile 不是 STABLE/IMMUTABLE ⇒ 唯讀宣稱沒有 catalog 撐著'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_not_readonly';
  END IF;

  -- ②b 🔴🔴 **SECDEF fail-open 面**(code-reviewer C1 = Critical;A12:393-402 同款,
  --     🔴 「同族八支都有」是我原本寫的、**任何定義都重現不出 8**(fresh R2 抓到)。
  --     重數後的事實(附命令,可重現):
  --       同款檢查 `grep -l 'relforcerowsecurity' supabase/migrations/*.sql | wc -l` = **24 檔**(含本片)
  --       具名 `grep -l 'secdef_fail_open' supabase/migrations/*.sql`               = **3 檔**
  --                                                    (OP5 / OP-A12 / 本片)
  --     而本片讀 **11 張表**,是這一族裡最寬的一支。
  --     失敗形狀:任一表被開 FORCE RLS ⇒ SECDEF 以 owner 執行也照樣套 RLS ⇒ 查詢**靜默回空**
  --     ⇒ pay.rows_n=0、gross=0,而 ps='unpaid' 那條 branch 剛好成立 ⇒ all_ok=true、判 underpaid。
  --     「靜默回空」是這一族最毒的失敗:沒有錯誤、沒有紅,只有一個有信心的錯答案。
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.orders'::regclass, 'public.order_items'::regclass,
                   'public.order_payments'::regclass, 'public.order_refunds'::regclass,
                   'public.payment_refunds'::regclass, 'public.payment_refund_events'::regclass,
                   'public.payment_charge_attempts'::regclass, 'public.order_cancellations'::regclass,
                   'public.order_cancellation_items'::regclass, 'public.order_refund_jobs'::regclass,
                   'public.payment_double_charge_anomalies'::regclass)
     AND (c.relowner <> (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
          OR c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP6-a SECDEF fail-open 面 — [%] owner 不對齊或開了 FORCE RLS ⇒ '
                    '查詢會靜默回空、函式會給出有信心的錯答案', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_secdef_fail_open';
  END IF;

  -- ③ 碼錨:四個退款面、兩個 join 鍵、NULL 兜底、IS TRUE 收斂 —— 逐字在
  --    🔴 錨的用途:這些是**審查換來的**東西,刪掉任何一個都會回到某個已知的誤判形狀。
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  SELECT pg_catalog.string_agg(x.frag, ' | ' ORDER BY x.frag) INTO v_bad
    FROM unnest(ARRAY[
      'public.order_refunds',                       -- 退款面①
      'public.payment_refunds',                     -- 退款面②
      'public.order_refund_jobs',                   -- 退款面③(Fable F4)
      'public.payment_double_charge_anomalies',     -- 退款面④(Fable F4)
      'op.rec_trade_id = a.rec_trade_id',           -- F3 join 鍵之一
      'op.order_id     = a.order_id',               -- F3 join 鍵之二(跨單陷阱)
      'att.charged_n = 0',                          -- F2 branch 1
      'ELSE ''needs_human''',                       -- F6 NULL 兜底
      'IS TRUE',                                    -- F6 三值收斂
      'AMOUNT_OUT_OF_RANGE',                        -- 溢位改走 needs_human 而非噴錯
      'ORDER_NOT_FOUND_PLACEHOLDER_NOT_USED'        -- 佔位:見下方 ④
    ]) x(frag)
   WHERE pg_catalog.strpos(v_src, x.frag) = 0
     AND x.frag <> 'ORDER_NOT_FOUND_PLACEHOLDER_NOT_USED';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP6-a 碼錨消失(%)⇒ 每一個都對應一個審查抓過的誤判形狀,拒繼續', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_code_anchor';
  END IF;

  -- ④ ORDER_NOT_FOUND 的實作方式是「零列 ⇒ 函式回 NULL」,由呼叫端與 harness 斷言,
  --    不在函式內造一個假的 jsonb —— 這一格刻意不設碼錨,理由寫在這裡免得下一個人補一個。

  -- ⑤ ACL 閉世界(照 A12 樣板):只准 {owner, service_role},且不得帶 WITH GRANT OPTION
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL THEN
    RAISE EXCEPTION 'OP6-a:proacl 是 NULL ⇒ REVOKE 沒執行過,函式預設 PUBLIC 可 EXECUTE'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_proacl_null';
  END IF;
  SELECT pg_catalog.string_agg(y.grantee, ', ' ORDER BY y.grantee) INTO v_bad
    FROM (
      SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(g.grantee) END AS grantee
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
       WHERE p.oid = v_fn
         AND g.privilege_type = 'EXECUTE'
         AND (g.grantee = 0
              OR pg_catalog.pg_get_userbyid(g.grantee)
                 NOT IN ('service_role', pg_catalog.pg_get_userbyid(p.proowner))
              OR g.is_grantable)
    ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP6-a EXECUTE 閉世界被打破(%)⇒ ①出現 {owner, service_role} 以外的 grantee '
                    '②或允許集合內的角色帶了 WITH GRANT OPTION', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_execute_closed_world';
  END IF;
  SELECT pg_catalog.string_agg(x.r, ', ' ORDER BY x.r) INTO v_bad
    FROM unnest(ARRAY['anon','authenticated','authenticator']) x(r)
   WHERE pg_catalog.has_function_privilege(x.r, v_fn, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'OP6-a:這些角色有效拿得到 EXECUTE(%)', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_execute_too_wide';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'OP6-a:service_role 拿不到 EXECUTE ⇒ 開權沒生效'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op6a_execute_missing';
  END IF;

  RAISE NOTICE 'OP6-a 結構斷言全過:SECDEF + search_path 空 + STABLE + fail-open 面 + **十個**碼錨(陣列 11 項,含一個明列的佔位)+ ACL 閉世界。';
END
$gate$;

COMMIT;
