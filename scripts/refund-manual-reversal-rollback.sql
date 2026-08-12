-- ============================================================
-- 沖銷片回退:把庫退回 `20260812140000` apply **之前**(= 2d post-image)
-- ============================================================
-- 標的 = supabase/migrations/20260812140000_m4b_lifecycle_refund_manual_reversal.sql
-- 順序依賴:本片在 2d(`20260811110000`)之後 ⇒ 本檔跑完,`l5b2-2d-rollback.sql` 才**進得了門**。
-- 🔴 **關卡2 codex RB-3(成立)**:「接得上棒」只到**schema 字面入口**這一層,
--    **不保證 2d 回退跑得完** —— 它有自己的**資料閘**(`l5b2-2d-rollback.sql:118-137`):
--      ①同一顆 refund 同時有 `result_success` 與 `result_failed` ⇒ 退回舊 terminal 集合會撞重複、拒退
--      ②庫內有任何一筆 `result_confirmed` ⇒ 值域要撤掉它,直接拒退
--    本片的前置閘只計 `result_confirmed/result_failed/manual`,對 ① 放行 ⇒ 第一棒過、第二棒仍可能被擋。
--    2026-08-12 的端到端實測是在**空帳本**上跑的 ⇒ 那次成功不能外推到有資料的庫。
--
-- 🔴🔴 **回退在第一筆沖銷寫入之後就永久關閉,這不是政策選擇、是做不到**(plan §10c-2,已實測):
--   沖銷發生過 ⇒ 同一顆 refund 上有兩筆 `manual`(舊的 + 替代的);
--   而要還原的 `pre_one_terminal_uniq` 述詞含 `manual` ⇒ **物理上建不起來(23505)**。
--   唯一解法是刪掉那些帳本列,但它們 append-only(`20260810140000:183-184`,刪會噴 P5B01)
--   且正是「誰在什麼時候作廢了哪一筆判定」的稽核證據。
--   ⇒ 本檔遇到這種庫**具名拒退**,不做半套。
--
-- 🔴 為什麼一定要把 `pre_one_terminal_uniq` 逐字建回來(plan §10c-1):
--   `l5b2-2d-rollback.sql:56-58` 的第一件事就是「該索引的 indexdef 為 NULL ⇒ RAISE」。
--   本片 DROP 了它 ⇒ 回退若不還原,**2d-rollback 會停在它的第一道閘**,鏈斷在第二棒。
--   還原形狀逐字等於 `l5b2-2d-rollback.sql:96-98` 釘的 2d post-image。
--
-- 用法:`psql "$URL" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f scripts/refund-manual-reversal-rollback.sql`
-- 🔴 `-v VERBOSITY=verbose` 不是裝飾:psql 預設不印 SQLSTATE,比 `*23505*` 會恆假。
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 前置閘:兩道拒退 ────────────────────────────────────────────────────────
DO $rb_pre$
DECLARE
  v_rev  bigint;
  v_dup  bigint;
BEGIN
  -- ① 語意面:沖銷發生過就不能退(理由見檔頭)
  SELECT pg_catalog.count(*) INTO v_rev
    FROM public.payment_refund_events e WHERE e.event_type = 'manual_reversal';

  IF v_rev > 0 THEN
    RAISE EXCEPTION '沖銷片回退:庫內已有 % 筆 manual_reversal ⇒ **回退已永久關閉**。'
                    '理由不是政策:同一顆 refund 上會有兩筆 manual,而要還原的 pre_one_terminal_uniq '
                    '述詞含 manual ⇒ 建不起來(23505);唯一解法是刪帳本列,但它 append-only(P5B01)'
                    '且是稽核證據。要前進修法請改 view/trigger 的述詞(CREATE OR REPLACE,不動資料)。',
                    v_rev
      USING ERRCODE = 'P5B03', CONSTRAINT = 'prmr_rollback_closed';
  END IF;

  -- ② 物理面:直接量「索引建不建得起來」的那個條件,不倚賴 ① 的推論
  --    🔴 ① 與 ② 不是同一件事:有人繞過 trigger 寫出兩筆 manual(而沒有 manual_reversal)時,
  --       ① 放行、② 才擋得住。兩道都要,不能只留語意那道。
  SELECT pg_catalog.count(*) INTO v_dup
    FROM (SELECT e.refund_id
            FROM public.payment_refund_events e
           WHERE e.event_type IN ('result_confirmed','result_failed','manual')
           GROUP BY e.refund_id HAVING pg_catalog.count(*) > 1) d;

  IF v_dup > 0 THEN
    RAISE EXCEPTION '沖銷片回退:有 % 顆 refund 在 2d 的終局述詞集合內超過一列 ⇒ '
                    'pre_one_terminal_uniq 還原不了(23505),回退不可行。停下人工判斷。', v_dup
      USING ERRCODE = 'P5B03', CONSTRAINT = 'prmr_rollback_unbuildable';
  END IF;

  RAISE NOTICE '沖銷片回退 前置閘:manual_reversal % 筆、述詞集合內重複 % 顆 ⇒ 可退', v_rev, v_dup;
END
$rb_pre$;

-- ── ① 先把 op6a 還原(它相依 canonical view;不先退它,下面 DROP VIEW 會被擋)──────
-- 🔴 本段是從 `20260811030000` 的定義**程式抽出**、逐字嵌入(手抄 200 行金流 SQL 會漂)。
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

-- ── ② 撤 RPC 與 canonical view ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_correct_refund_manual_verdict(uuid, uuid, text, text, boolean);
DROP VIEW IF EXISTS public.payment_refund_effective_terminal;

-- ── ③ 撤 trigger 與它的函式(唯一性交還給索引)────────────────────────────────
DROP TRIGGER IF EXISTS pre_one_effective_terminal ON public.payment_refund_events;
DROP FUNCTION IF EXISTS public.prl_one_effective_terminal_guard();

-- ── ④ 撤本片加的索引與約束 ──────────────────────────────────────────────────
DROP INDEX IF EXISTS public.pre_one_reversal_uniq;

ALTER TABLE public.payment_refund_events
  DROP CONSTRAINT IF EXISTS pre_reversal_shape_chk,
  DROP CONSTRAINT IF EXISTS pre_actor_required_chk,
  DROP CONSTRAINT IF EXISTS pre_reversal_same_refund_fk;

-- 🔴 `pre_refund_id_uniq` 是本片為了讓複合自我 FK 有對象而加的(FK 的被參照欄必須有唯一約束)
--    ⇒ 它是本片的產物,要一起撤;順序上必須在 FK 之後(上面同一句 ALTER 已先撤 FK)。
ALTER TABLE public.payment_refund_events
  DROP CONSTRAINT IF EXISTS pre_refund_id_uniq;

-- 🔴 本片給 lease_token 加過 COMMENT(pre-image 是**沒有**的:`col_description` → NULL,
--    2026-08-12 實查)⇒ 回退要清掉,否則「退回 2d post-image」這個宣稱當場不成立,
--    而④ 的自驗不比 comment ⇒ 這個偏離會永遠看不見(同 2d-rollback 對 index comment 的做法)。
COMMENT ON COLUMN public.payment_refund_events.lease_token IS NULL;

ALTER TABLE public.payment_refund_events
  DROP COLUMN IF EXISTS reverses_event_id,
  DROP COLUMN IF EXISTS reversal_reason,
  DROP COLUMN IF EXISTS actor;

-- ── ⑤ 值域退回 2d post-image 的七值 ─────────────────────────────────────────
ALTER TABLE public.payment_refund_events DROP CONSTRAINT IF EXISTS pre_event_type_chk;
ALTER TABLE public.payment_refund_events
  ADD CONSTRAINT pre_event_type_chk
  CHECK (event_type IN ('sent','result_success','result_confirmed','result_failed','result_unknown','reconcile','manual'));

-- ── ⑥ 🔴 把 `pre_one_terminal_uniq` 逐字建回 2d post-image ────────────────────
-- 述詞逐字等於 `l5b2-2d-rollback.sql:96-98` 釘的形狀。**這是 2d-rollback 的第一道閘的前提**。
DROP INDEX IF EXISTS public.pre_one_terminal_uniq;
CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events (refund_id)
  WHERE event_type IN ('result_confirmed','result_failed','manual');
-- 🔴 2d 建它時沒給 COMMENT(回退不得留下 pre-image 沒有的東西;同 2d-rollback 的做法)
-- 🔴 **關卡2 codex RB-1(成立)**:這一行原本是 `IS NULL` —— 我從 `l5b2-2d-rollback.sql` 抄來的,
--    在**它的**脈絡對(它退回 `20260810140000` 建表期,當時這顆索引沒有 COMMENT);
--    抄進**我的**脈絡就錯了 —— 本檔退回的是 **2d post-image**,而 2d 在 `20260811110000:203`
--    **有給它 COMMENT**。原寫法會把 2d 的 COMMENT 主動消掉 ⇒「逐字等於 2d post-image」當場不成立。
--    ⇒ 逐字還原 2d 的兩個 COMMENT(constraint 那個在 `:190`,本片 DROP+重建時也一起弄丟了)。
COMMENT ON INDEX public.pre_one_terminal_uniq IS
  'L5b-2 片2d:terminal 集合 = result_confirmed / result_failed / manual。'
  'result_success 已退出 terminal(它只表示「TapPay 受理了」)。'
  '🔴 2e 的排除條件必須認 result_confirmed 而不是 result_success,否則訊號會提前消失(母 plan §4b)。';

COMMENT ON CONSTRAINT pre_event_type_chk ON public.payment_refund_events IS
  'L5b-2 片2d:值域加入 result_confirmed。**受理(result_success)與確認(result_confirmed)是兩件事** —— '
  'TapPay 退款隔日生效,受理成功不代表錢已經退出去。判定用的 N 與述詞見母 plan §4b,屬 2e/2f/2g 實作。';

-- ── ⑦ 回退自驗:退到位了沒(任一紅 = 整片回滾,不留半套)────────────────────
DO $rb_post$
DECLARE
  v_txt text;
  v_n   integer;
BEGIN
  -- 🔴 最重要那格:2d-rollback 的第一道閘讀的就是這個 indexdef,逐字比。
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_txt
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = pg_catalog.to_regclass('public.pre_one_terminal_uniq')
     AND i.indisunique AND i.indisvalid;

  IF v_txt IS DISTINCT FROM
     'CREATE UNIQUE INDEX pre_one_terminal_uniq ON public.payment_refund_events USING btree (refund_id)'
     || ' WHERE (event_type = ANY (ARRAY[''result_confirmed''::text, ''result_failed''::text, ''manual''::text]))' THEN
    RAISE EXCEPTION '沖銷片回退 自驗:pre_one_terminal_uniq 沒還原成 2d post-image ⇒ '
                    'l5b2-2d-rollback.sql 會停在它的第一道閘,鏈斷在第二棒。實際=[%]',
                    COALESCE(v_txt, '(不存在或非 unique/valid)');
  END IF;

  -- 本片的產物一個都不該留
  SELECT pg_catalog.count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'payment_refund_events'
     AND column_name IN ('reverses_event_id','reversal_reason','actor');
  IF v_n <> 0 THEN RAISE EXCEPTION '沖銷片回退 自驗:三新欄還剩 % 欄', v_n; END IF;

  IF pg_catalog.to_regclass('public.pre_one_reversal_uniq') IS NOT NULL THEN
    RAISE EXCEPTION '沖銷片回退 自驗:pre_one_reversal_uniq 還在';
  END IF;
  IF pg_catalog.to_regclass('public.payment_refund_effective_terminal') IS NOT NULL THEN
    RAISE EXCEPTION '沖銷片回退 自驗:canonical view 還在';
  END IF;

  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('admin_correct_refund_manual_verdict','prl_one_effective_terminal_guard');
  IF v_n <> 0 THEN RAISE EXCEPTION '沖銷片回退 自驗:本片的函式還剩 % 支', v_n; END IF;

  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.payment_refund_events'::regclass
     AND t.tgname = 'pre_one_effective_terminal';
  IF v_n <> 0 THEN RAISE EXCEPTION '沖銷片回退 自驗:trigger 還在'; END IF;

  -- 值域退回七值
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_txt
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass AND c.conname = 'pre_event_type_chk';
  IF pg_catalog.strpos(v_txt, 'manual_reversal') <> 0 THEN
    RAISE EXCEPTION '沖銷片回退 自驗:值域還留著 manual_reversal';
  END IF;

  -- op6a 退回不吃 view 的版本
  SELECT p.prosrc INTO v_txt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_compute_order_settlement';
  IF pg_catalog.strpos(v_txt, 'payment_refund_effective_terminal') <> 0 THEN
    RAISE EXCEPTION '沖銷片回退 自驗:op6a 還在吃已被 DROP 的 canonical view ⇒ 它現在是壞的';
  END IF;

  -- 🔴 **關卡2 codex RB-2(成立)**:`DROP ... IF EXISTS` 對「被改名的物件」是靜默 no-op,
  --    而本片加的 `pre_refund_id_uniq` 不依賴三新欄、不會隨 DROP COLUMN 消失
  --    ⇒ 有人 rename 過它,回退會**留下半套**而自驗全過。改成比完整集合(同 migration ⑩-7 形制)。
  SELECT pg_catalog.string_agg(c.conname, ',' ORDER BY c.conname) INTO v_txt
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.payment_refund_events'::regclass;
  IF v_txt IS DISTINCT FROM
     'payment_refund_events_pkey,payment_refund_events_refund_id_fkey,pre_event_type_chk,'
     || 'pre_lease_token_nonneg_chk,pre_manual_needs_verdict_chk,pre_seq_positive_chk' THEN
    RAISE EXCEPTION '沖銷片回退 自驗:約束集合與 2d post-image 逐字不符 ⇒ 可能留下半套(例如本片加的'
                    ' pre_refund_id_uniq 被改名而 DROP IF EXISTS 靜默 no-op)。實際=[%]', COALESCE(v_txt, '(空)');
  END IF;

  SELECT pg_catalog.string_agg(i.indexname, ',' ORDER BY i.indexname) INTO v_txt
    FROM pg_catalog.pg_indexes i
   WHERE i.schemaname = 'public' AND i.tablename = 'payment_refund_events';
  IF v_txt IS DISTINCT FROM
     'payment_refund_events_pkey,pre_one_success_uniq,pre_one_terminal_uniq,'
     || 'pre_refund_idx,pre_refund_seq_uniq' THEN
    RAISE EXCEPTION '沖銷片回退 自驗:索引集合與 2d post-image 逐字不符。實際=[%]', COALESCE(v_txt, '(空)');
  END IF;

  -- 🔴 RB-1 的自驗:兩個 COMMENT 真的還原了(原本整段沒比 COMMENT ⇒ 弄丟了也全過)
  IF pg_catalog.obj_description(pg_catalog.to_regclass('public.pre_one_terminal_uniq'), 'pg_class') IS NULL THEN
    RAISE EXCEPTION '沖銷片回退 自驗:pre_one_terminal_uniq 的 COMMENT 沒還原(2d 有給它)';
  END IF;
  IF (SELECT pg_catalog.obj_description(c.oid, 'pg_constraint') FROM pg_catalog.pg_constraint c
       WHERE c.conrelid = 'public.payment_refund_events'::regclass
         AND c.conname = 'pre_event_type_chk') IS NULL THEN
    RAISE EXCEPTION '沖銷片回退 自驗:pre_event_type_chk 的 COMMENT 沒還原(2d 有給它)';
  END IF;

  IF pg_catalog.col_description('public.payment_refund_events'::regclass,
       (SELECT a.attnum FROM pg_catalog.pg_attribute a
         WHERE a.attrelid='public.payment_refund_events'::regclass AND a.attname='lease_token')) IS NOT NULL THEN
    RAISE EXCEPTION '沖銷片回退 自驗:lease_token 的 COMMENT 還在 ⇒ 留下了 pre-image 沒有的東西';
  END IF;

  RAISE NOTICE '沖銷片回退 自驗:全過(索引逐字還原/三欄與 FK 撤除/view+trigger+RPC 撤除/值域七值/op6a 已退版)';
END
$rb_post$;

COMMIT;
