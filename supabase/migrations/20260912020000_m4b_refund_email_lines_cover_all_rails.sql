-- 20260912020000_m4b_refund_email_lines_cover_all_rails.sql
-- ⟦auth-PARTIALREFUNDCANCELGAP⟧ 完整版:**錢每動一次, 客人都收得到一封信**(刷卡 + 匯款 / 現金)。
--
-- Sean 2026-09-12 批 plan `docs/plans/2026-09-12-partialrefundcancelgap-full-plan.md`
--   Q1 甲(用 plan 的三句文案)· Q2 **乙 非卡 rail 一起做** · Q3 甲(補寄那一張自己人的單不擋)。
--
-- ══ 今天的洞(plan 第 2 節,已量)═══════════════════════════════════════════
--   G1  部分退款 + 已取消        ⇒ 取消信要 `refunded`、退款信要 `cancelled_at IS NULL` ⇒ 兩邊都撈不到
--   G1b 退款信排隊中、單被取消    ⇒ 寄出前那道閘擋掉, 而 G1 又撈不到
--   G2  分批退到全額而沒取消      ⇒ 退款信要 `partiallyRefunded` ⇒ 最後那一筆沒信(正式庫 2026-09-12 有 1 張)
--   G3  取消信寄了之後又退一筆    ⇒ 取消信一張單一封, 退款信排除已取消的單
--   非卡 匯款 / 現金的人工退款     ⇒ 兩張 view 都只收 `payment_method = 'tappay'` ⇒ 一封都沒有
--
-- ══ 改完的分工(plan 第 3 節)═══════════════════════════════════════════════
--   ④ 取消信   = 「取消, 以及到它排進佇列那一刻為止退了多少」(一張單一封)
--   ⑤ 退款信   = 「那之外的每一筆退款」(一筆一封)
--   去重規則(⑤ 自己的 WHERE):
--     · 沒取消            ⇒ 照常寄
--     · 已取消而 ④ 還沒排 ⇒ **先等**(④ 的總額會包含這一筆)
--     · 已取消而 ④ 已排   ⇒ 只有【確認時間晚於 ④ 排進佇列時間】的那幾筆才寄(G3)
--   🔴 排信 cron 裡 ④ 要排在 ⑤ 前面(同一輪都撈到時, ④ 先落表 ⑤ 才看得到)—— 碼那一側 `email-sweep/route.ts` 已是這個順序。
--
-- ══ 刻意不做(不是漏)═════════════════════════════════════════════════════
--   🛑 **刷卡單上的現金退款(混合軌)一律不寄 —— 取消的與【沒取消的】都是**(R2 補齊字面):
--      · 已取消 ⇒ ④ 排除(有有效人工退款的刷卡單)
--      · **沒取消** ⇒ ⑤ 的人工那半只收 `payment_method IS DISTINCT FROM 'tappay'`
--        ⇒ 一張刷卡單登記現金退款(後台 `admin_record_manual_refund` 帶「確認卡沒退」時准)**一封都沒有**。
--      ⇒ 📌 **與今天相同, 不是本片新造的**;要改要先推翻下面那一列的裁定。已寫進回報給 Sean。
--   🛑 那一列是 `⟦b4-CANCELMAILMIXEDRAIL⟧`(主視窗 2026-09-05 裁 Q2 乙
--      「整張不寄」), 板上另有一列, 不在本片。⇒ 它們的 ⑤ 會落在「已取消而 ④ 永遠不排」那一格 ⇒ 一直等 ⇒ 沒有信。
--      **與今天相同, 不是本片新造的**;要改要先推翻那一列的裁定。
--
-- ══ rollback ═════════════════════════════════════════════════════════════
--   `supabase/rollbacks/20260912020000-rollback.sql`:
--   該檔第一行就是 SET LOCAL lock_timeout = '5s';,它 DROP 兩張 view 再照舊定義重建(REPLACE 刪不掉欄)並重下權限。
--   🔴 回退順序:排信 / 寄信碼先 revert, 再跑回退。
--
-- ══ 🔴🔴 上線順序:**碼先上, DB 後貼**(二審 must-fix 1;⛔ ~~plan 原本寫「DB 先貼」~~ 那是錯的)══
--   🛑 **DB 先貼會出兩件事, 而其中一件補不回來**:
--     ① 舊碼只選那八欄, 照樣會撈到非卡的人工退款列 ⇒ 舊模板**無條件**印「款項將退回您原本付款的信用卡」
--        ⇒ 📌 **匯款 / 現金的客人收到一句假話**(正式庫今天就有 1 張非卡單帶有效人工退款)。
--     ② G2 / G3 那些列會被**舊的**寄出前閘(`order_partially_refunded: true`)擋成終態
--        `skipped_order_ineligible` ⇒ 而那個 code **不在**本檔 view 放行的 `last_error_code` 清單裡
--        ⇒ 🔴 **anti-join 從此永遠擋住那一列, 碼上了也補不回來。**
--   ✅ 正確順序:**碼先上(Sean FF main、cron 跑過一輪)⇒ 再貼本支**。
--     中間那段時間:新碼 + 舊 view ⇒ 讀不到 `order_state` ⇒ 排信端不排(計 unusableAmount)
--     ⇒ 📌 **退款信暫停、而不是寄錯**;本支貼完之後那些退款會被重新撈到(outbox 沒有列擋著)。
BEGIN;
SET LOCAL lock_timeout = '5s';
-- 事後閘會對正式資料各數一次兩張 view 撈到幾列;貼的 session 若有較短逾時會整支回滾 ⇒ 放寬到 120 秒。
SET LOCAL statement_timeout = '120s';

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $precondition$
DECLARE
  v_cols text;
BEGIN
  IF to_regclass('public.pcm_cancelled_email_pending') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.pcm_cancelled_email_pending ⇒ 部署態與預期不符';
  END IF;
  IF to_regclass('public.pcm_partial_refund_email_pending') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.pcm_partial_refund_email_pending(20260908080000 還沒貼)';
  END IF;
  IF to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.order_manual_refunds ⇒ 非卡那一半接不上';
  END IF;
  -- 🔴 REPLACE 只能【往後加欄】⇒ 既有欄序必須與本檔寫的前八欄逐字相同, 否則 REPLACE 會直接報錯而訊息難讀。
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_cols
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.pcm_partial_refund_email_pending'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols <> 'order_id,display_id,refund_id,refunded_amount,refunded_at,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '前置閘④:退款信 view 的欄不是預期那八欄(實得 %)⇒ 有人改過它, 停下重抄', v_cols;
  END IF;
END
$precondition$;

-- ── ④ 取消信的掃描面 ────────────────────────────────────────────────────────
-- 🔵 欄位與欄序**一個字都沒動**(REPLACE 的硬限制);變的是 WHERE 與那兩個金額欄的算法。
-- 🔴 `WITH (security_invoker = true)` 照寫 —— REPLACE 不帶 WITH 會把既有的 reloptions 清掉(事後閘⑤ 驗它)。
CREATE OR REPLACE VIEW public.pcm_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source,
  -- 🔵 退了多少 = 刷卡退回 + 有效的人工退款(非卡那半今天全部落在人工退款這一側)
  --   🛑 **主視窗 2026-09-05 裁「信那句宣稱的是那張卡, 人工現金不算」仍然成立** ——
  --     刷卡那一支的 WHERE 排除了有人工退款的單(混合軌)⇒ 對【刷卡單】這個和恆等於卡那一個數, 一個字都沒變。
  --     人工那一項只有在**非卡單**上才非 0, 而那是 Sean 2026-09-12 Q2 乙新納入的族群(當時不存在的世界)。
  (r.card_refunded + r.manual_refunded) AS refunded_amount,
  CASE WHEN (r.card_refunded + r.manual_refunded) >= o.total THEN 'full' ELSE 'partial' END AS refund_kind
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
CROSS JOIN LATERAL (
  SELECT public.pcm_order_card_refunded(o.id) AS card_refunded,
         -- 🔴 `::integer` 少不得:`sum()` 回 bigint, 而 REPLACE 不准改既有欄的型別(實測 ERROR)。
         COALESCE((SELECT sum(m.refund_amount)
                     FROM public.order_manual_refunds m
                    WHERE m.order_id = o.id AND m.voided_at IS NULL), 0)::integer AS manual_refunded
) r
WHERE o.cancelled_at IS NOT NULL
  AND (
        -- 刷卡:⛔ ~~只有 `payment_status = 'refunded'`(全額)~~ ⇒ 2026-09-12 放寬到部分退款(G1)。
        --   🛑 有**有效人工退款**的仍然排除 —— 那是混合軌 `⟦b4-CANCELMAILMIXEDRAIL⟧`, 另一列的地盤。
        (o.payment_method = 'tappay'
         AND o.payment_status IN ('refunded', 'partiallyRefunded')
         AND NOT EXISTS (SELECT 1 FROM public.order_manual_refunds m
                          WHERE m.order_id = o.id AND m.voided_at IS NULL))
        -- 非卡(匯款 / 現金 / payment_method 未填):**錢真的動過才寄** = 有有效的人工退款。
        --   🔵 判準刻意用「有沒有退款紀錄」而不是 payment_status —— 非卡的狀態同步曾經漏過
        --     (`⟦b4-NONCARDPAID1⟧`), 而錢動沒動的真來源是那張表。
     OR (o.payment_method IS DISTINCT FROM 'tappay'
         -- 🔴 **卡退一毛都沒有才算「非卡」**(二審 consider 4):`payment_method` 可以是 NULL,
         --    而卡退的真來源是 `order_payments.rail` 不是這一欄 ⇒ 少了這一行, 一張
         --    「method 是 NULL、既有卡退又有現金退」的取消單會從這裡溜進來,
         --    而那正是混合軌(主視窗 2026-09-05 裁「整張不寄」)⇒ 📌 繞過一個還活著的拍板。
         AND public.pcm_order_card_refunded(o.id) = 0
         AND EXISTS (SELECT 1 FROM public.order_manual_refunds m
                      WHERE m.order_id = o.id AND m.voided_at IS NULL))
      )
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_cancelled'
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  -- 🔴 手動單(電話 / LINE / 其他)必須有**這張單自己的**通知信箱 —— 逐字抄自 20260907230000,
  --    ⛔ 我第一版漏抄了這一段(二審 nit 5 親測:舊 0 列 / 新 1 列)⇒ 補回, 行為與今天一致。
  AND (
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

-- ── ⑤ 退款信的掃描面 ────────────────────────────────────────────────────────
-- 🔵 前八欄逐字不動, **往後加兩欄**:`order_state`(信裡要說哪一句)與 `refund_source`(卡 / 人工, 給日誌與查證用)。
-- 🔴 `WITH (security_invoker = false, security_barrier = true)` 照寫(理由同上;它以 owner 身分讀, 所以讀得到人工退款表)。
CREATE OR REPLACE VIEW public.pcm_partial_refund_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  x.order_id           AS order_id,
  x.display_id         AS display_id,
  x.refund_id          AS refund_id,
  x.refunded_amount    AS refunded_amount,
  x.refunded_at        AS refunded_at,
  x.notification_email AS notification_email,
  x.customer_email     AS customer_email,
  x.order_source       AS order_source,
  -- 🔴 信裡那三句話的分岔, **在排信那一刻定案**(寄出時不再重算):
  --    cancelled      = 已取消的單又退一筆
  --    fully_refunded = 這一筆退完之後整張單已全數退回(不可以再說「其餘照常出貨」)
  --    active         = 單還在, 其餘照常出貨
  CASE
    WHEN x.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN (x.card_refunded + x.manual_refunded) >= x.total THEN 'fully_refunded'
    ELSE 'active'
  END                  AS order_state,
  x.refund_source      AS refund_source
FROM (
  -- 刷卡:一列 = 一筆 `order_refunds`(⛔ ~~`payment_status = 'partiallyRefunded'` + `cancelled_at IS NULL`~~
  --   ⇒ 2026-09-12 放寬:全額退(G2)與已取消(G1 / G3)都進來, 由下面的去重規則決定寄不寄)
  SELECT o.id AS order_id, o.display_id, r.id AS refund_id, r.refund_amount AS refunded_amount,
         r.confirmed_at AS refunded_at,
         -- 🔴 **去重比的是這一欄, 不是 `refunded_at`**(二審 must-fix 2):
         --    人工那半的 `occurred_at` 是**員工填的**「實際交回時刻」, 可以回填到過去
         --    (`20260820010000:176,198-199`)⇒ 拿它跟 ④ 的排隊時間比, 一筆【後來才登記、而時間填在過去】的退款
         --    會被判成「④ 已經講過」⇒ 📌 **那筆錢永遠沒有信**。兩半都改用 DB 自己的時鐘。
         r.confirmed_at AS dedupe_at,
         o.notification_email, c.email AS customer_email,
         o.order_source, o.cancelled_at, o.total,
         'card'::text AS refund_source,
         cr.card_refunded, cr.manual_refunded
    FROM public.order_refunds r
    JOIN public.orders o ON o.id = r.order_id
    LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
    CROSS JOIN LATERAL (
      SELECT public.pcm_order_card_refunded(o.id) AS card_refunded,
             COALESCE((SELECT sum(m.refund_amount) FROM public.order_manual_refunds m
                        WHERE m.order_id = o.id AND m.voided_at IS NULL), 0)::integer AS manual_refunded
    ) cr
   WHERE o.payment_method = 'tappay'
     AND o.payment_status IN ('partiallyRefunded', 'refunded')
     AND r.status = 'confirmed'
     AND r.backfilled_source IS NULL
  UNION ALL
  -- 非卡:一列 = 一筆有效的 `order_manual_refunds`(Sean 2026-09-12 Q2 乙)
  SELECT o.id, o.display_id, m.id, m.refund_amount,
         m.occurred_at,
         -- 🔵 人工那半用 `created_at`(登記那一刻的 DB 時鐘);`occurred_at` 仍然是信上與 cutoff 用的那個時刻。
         m.created_at AS dedupe_at,
         o.notification_email, c.email,
         o.order_source, o.cancelled_at, o.total,
         'manual'::text,
         cr.card_refunded, cr.manual_refunded
    FROM public.order_manual_refunds m
    JOIN public.orders o ON o.id = m.order_id
    LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
    CROSS JOIN LATERAL (
      SELECT public.pcm_order_card_refunded(o.id) AS card_refunded,
             COALESCE((SELECT sum(m2.refund_amount) FROM public.order_manual_refunds m2
                        WHERE m2.order_id = o.id AND m2.voided_at IS NULL), 0)::integer AS manual_refunded
    ) cr
   WHERE o.payment_method IS DISTINCT FROM 'tappay'
     AND m.voided_at IS NULL
) x
WHERE NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_partially_refunded'
           AND e.dedup_key = x.refund_id::text
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  -- 🔴 去重規則:已取消的單, 只寄「④ 已經排進佇列**之後**才確認」的那幾筆;④ 還沒排 ⇒ 先等。
  AND (
        x.cancelled_at IS NULL
     OR EXISTS (SELECT 1 FROM public.email_outbox e2
                 WHERE e2.order_id = x.order_id
                   AND e2.event_type = 'order_cancelled'
                   AND COALESCE(e2.last_error_code, '') NOT IN (
                         'shipment_voided',
                         'tracking_superseded',
                         'bank_order_not_mailable_at_send',
                         'bank_order_snapshot_stale',
                         'recipient_stale_at_send'
                       )
                   AND e2.created_at < x.dedupe_at)
      )
  AND (
        nullif(pg_catalog.btrim(x.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(x.customer_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_partial_refund_email_pending IS
$c$退款通知信(`order_partially_refunded`)的掃描面。**一列 = 一筆退款**(`dedup_key = 那筆退款的 id`)。
🔵 2026-09-12(Sean 批 `⟦auth-PARTIALREFUNDCANCELGAP⟧` 完整版 + Q2 乙):
   · 刷卡:`order_refunds`(confirmed、非 backfill), 狀態放寬到 `partiallyRefunded` 或 `refunded`
   · 非卡:`order_manual_refunds`(未作廢), `payment_method` 不是 tappay 的單
   · 已取消的單:只寄「取消信排進佇列之後才確認」的那幾筆;取消信還沒排 ⇒ 先等(它的總額會包含)
   · `order_state` 決定信裡那一句(active / fully_refunded / cancelled), 在排信那一刻定案
🛑 卡 + 現金混合的取消單仍然不寄(`⟦b4-CANCELMAILMIXEDRAIL⟧` 主視窗 2026-09-05 裁「整張不寄」)
   ⇒ 它們的退款會落在「已取消而取消信永遠不排」那一格, 一直等。**與今天相同, 要改先推翻那一列。**
⛔ ~~要求 `cancelled_at IS NULL`~~(那是本片修掉的洞:取消 + 只退一部分的單兩條線都不寄)$c$;

-- ── 事後閘 ──────────────────────────────────────────────────────────────────
DO $postcondition$
DECLARE
  v_relations text[] := ARRAY['public.pcm_cancelled_email_pending', 'public.pcm_partial_refund_email_pending']::text[];
  v_def   text;
  v_cols  text;
  v_opts  text[];
  v_cnt   integer;
  v_i     integer;
BEGIN
  -- ① 兩張都還在, 而且還是 view
  FOR v_i IN 1..cardinality(v_relations) LOOP
    IF to_regclass(v_relations[v_i]) IS NULL THEN
      RAISE EXCEPTION '事後閘①:% 不見了', v_relations[v_i];
    END IF;
  END LOOP;

  -- ② 欄:取消信八 + 兩個金額欄照舊十欄;退款信 = 原八欄 + order_state + refund_source
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_cols
    FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.pcm_partial_refund_email_pending'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols <> 'order_id,display_id,refund_id,refunded_amount,refunded_at,notification_email,customer_email,order_source,order_state,refund_source' THEN
    RAISE EXCEPTION '事後閘②:退款信 view 的欄不對(實得 %)', v_cols;
  END IF;

  -- ③ 述詞特徵:少一條就是漏了一個洞
  v_def := pg_catalog.pg_get_viewdef('public.pcm_partial_refund_email_pending'::regclass, true);
  IF position('order_manual_refunds' IN v_def) = 0 THEN
    RAISE EXCEPTION '事後閘③a:退款信 view 沒有接到人工退款(非卡那半沒進去)';
  END IF;
  IF position('order_cancelled' IN v_def) = 0 THEN
    RAISE EXCEPTION '事後閘③b:退款信 view 沒有去重規則(會與取消信重複講同一筆錢)';
  END IF;
  IF position('order_state' IN v_def) = 0 THEN
    RAISE EXCEPTION '事後閘③c:退款信 view 沒有 order_state(信裡那三句分不了)';
  END IF;
  v_def := pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true);
  IF position('partiallyRefunded' IN v_def) = 0 THEN
    RAISE EXCEPTION '事後閘③d:取消信 view 沒有放寬到部分退款(G1 還在)';
  END IF;
  IF position('order_manual_refunds' IN v_def) = 0 THEN
    RAISE EXCEPTION '事後閘③e:取消信 view 沒有接到人工退款';
  END IF;
  -- 🔵 負對照:現造一個不存在的字面, 必須【沒有】命中 —— 證明上面那把尺是活的
  IF position('pcm_this_literal_should_not_exist' IN v_def) <> 0 THEN
    RAISE EXCEPTION '事後閘③f:現造字面命中 ⇒ 這把尺壞了';
  END IF;

  -- ④ reloptions:REPLACE 不帶 WITH 會把它清掉 ⇒ 明確驗
  SELECT reloptions INTO v_opts FROM pg_catalog.pg_class WHERE oid = 'public.pcm_cancelled_email_pending'::regclass;
  IF NOT ('security_invoker=true' = ANY(v_opts)) THEN
    RAISE EXCEPTION '事後閘④a:取消信 view 的 security_invoker 掉了(實得 %)', v_opts;
  END IF;
  SELECT reloptions INTO v_opts FROM pg_catalog.pg_class WHERE oid = 'public.pcm_partial_refund_email_pending'::regclass;
  IF NOT ('security_invoker=false' = ANY(v_opts) AND 'security_barrier=true' = ANY(v_opts)) THEN
    RAISE EXCEPTION '事後閘④b:退款信 view 的 security_invoker / barrier 掉了(實得 %)', v_opts;
  END IF;

  -- ⑤ ACL:REPLACE 保留既有授權 ⇒ 只准 owner 與 service_role, 而且 relacl 不得是 NULL
  FOR v_i IN 1..cardinality(v_relations) LOOP
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_class cl, LATERAL pg_catalog.aclexplode(cl.relacl) a
     WHERE cl.oid = v_relations[v_i]::regclass
       AND CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END
             NOT IN ('postgres', 'service_role');
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION '事後閘⑤a:% 的 ACL 上有名單外的角色(% 個)', v_relations[v_i], v_cnt;
    END IF;
    IF (SELECT cl.relacl FROM pg_catalog.pg_class cl WHERE cl.oid = v_relations[v_i]::regclass) IS NULL THEN
      RAISE EXCEPTION '事後閘⑤b:% 的 relacl 是 NULL ⇒ 兩道 REVOKE 的痕跡不見了', v_relations[v_i];
    END IF;
  END LOOP;

  -- ⑤b 🔴 **invoker view 用【呼叫者】的權限跑它 body 裡的函式**(invoker-view-execute-gate 要的那條):
  --    ④ 是 `security_invoker = true`, 而讀它的是 **service_role**(寄信掃描面那條路)。
  --    ⇒ 那兩支函式的 EXECUTE 哪天被收掉 ⇒ view 建得起來、靜態全綠, 而**查它的人一次錯一次**。
  --    🛑 斷言問的是「量到的結果」, 不是「我下過 GRANT」。
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_js_trim_whitespace()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑤c:service_role 執行不了 pcm_js_trim_whitespace() ⇒ 取消信掃描面查一次錯一次';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
           'service_role', 'public.pcm_order_card_refunded(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘⑤d:service_role 執行不了 pcm_order_card_refunded(uuid) ⇒ 取消信掃描面查一次錯一次';
  END IF;

  -- ⑥ 行為:對正式資料各數一次, 數字印在 NOTICE 裡(貼的人要看到它, 再與貼後核對)
  EXECUTE 'SELECT count(*) FROM public.pcm_cancelled_email_pending' INTO v_cnt;
  RAISE NOTICE '✅ 取消信掃描面現在撈到 % 列', v_cnt;
  EXECUTE 'SELECT count(*) FROM public.pcm_partial_refund_email_pending' INTO v_cnt;
  RAISE NOTICE '✅ 退款信掃描面現在撈到 % 列', v_cnt;
  EXECUTE 'SELECT count(*) FROM public.pcm_partial_refund_email_pending WHERE order_state = ''fully_refunded''' INTO v_cnt;
  RAISE NOTICE '✅ 其中 order_state = fully_refunded 的有 % 列(G2;Sean Q3 甲:這幾封照寄)', v_cnt;
  -- 🔴 **貼的人要看這兩個數**:它們就是「貼完之後這一輪 cron 會補寄幾封舊帳的信」。
  --    2026-09-12 唯讀預估:取消信那一張非卡單 + 退款信那 1~2 筆(都是自己人的單)。
  --    ⇒ 📌 **數字比預期大 ⇒ 先停下問 Sean**(那表示正式庫有我沒量到的舊單, 而信寄出去收不回來)。
END
$postcondition$;

COMMIT;
