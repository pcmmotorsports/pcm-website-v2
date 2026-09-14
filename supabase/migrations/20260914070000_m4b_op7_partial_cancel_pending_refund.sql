-- ══════════════════════════════════════════════════════════════════
-- OP7 · ⟦b4-PARTCANCEL1⟧ + ⟦b4-PARTCANCELTAX⟧
--   部分取消(與任何讓 effective_total 變小的動作)要開待退款;含稅單不猜。
--
-- 🔴 plan:docs/plans/2026-09-14-op7-partial-cancel-pending-refund-plan.md(讀完再動這支)。
--    上游拍板:丙 重算式 + 對帳(主視窗 A 2026-09-08)· Q1=C 跟著失敗 · Q2=D 訂單級含卡就不寫
--    · Sean Q13 公式 `max(0, 已收未退 − 取消後剩餘應收)` · Sean 09-10 甲「稅算不出來就不回數」。
--
-- 四個物件 + 三支 trigger,不動任何既有函式 / view:
--   ① pcm_order_remaining_receivable(uuid)             剩餘應收;有稅 ⇒ 先自檢 5% 重現得出 tax_total 才算
--   ② pcm_pending_refund_amounts_capped(uuid, bigint)   逐軌分配(與整單取消那支同一套口徑,總額由參數給)
--   ③ pcm_partial_cancel_recompute(uuid)                冪等重算:不做的三個世界 = 已整單取消 / 有卡 / 稅算不出
--   ④ pcm_partial_cancel_refund_reconciliation_v        對帳面(has_card / tax_uncomputable / missing_row / amount_mismatch)
--   ⑤ trigger ×3:order_cancellation_items INSERT · order_items UPDATE(unit_price / quantity 變了)· orders UPDATE(shipping_method 變了);statement-level
--
-- 🔴 half-up:全部用 pg_catalog.round(numeric),與 create_order / admin_create_manual_order 同一種。
-- 🔴 零改既有列語意:本機制只寫 order_pending_refunds;覆寫是丙的定義(重算 = 覆寫)。
-- 回滾:supabase/rollbacks/20260914070000_down.sql(先寫;不動資料)。
-- ══════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ══ 前置閘 ════════════════════════════════════════════════════════
DO $pre$
DECLARE v_n integer;
BEGIN
  IF pg_catalog.to_regclass('public.order_pending_refunds') IS NULL
     OR pg_catalog.to_regclass('public.pcm_order_effective_amounts_v') IS NULL
     OR pg_catalog.to_regclass('public.order_cancellation_items') IS NULL THEN
    RAISE EXCEPTION '前置閘①:order_pending_refunds / pcm_order_effective_amounts_v / order_cancellation_items 不齊 ⇒ 停';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_pending_refund_amounts(pg_catalog.uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_pending_refund_on_cancel()') IS NULL THEN
    RAISE EXCEPTION '前置閘②:整單取消那兩支不在 ⇒ 這台庫不是我以為的形狀';
  END IF;
  -- 四個新物件都還不在(防重貼)
  IF pg_catalog.to_regprocedure('public.pcm_order_remaining_receivable(pg_catalog.uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.pcm_pending_refund_amounts_capped(pg_catalog.uuid, pg_catalog.int8)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.pcm_partial_cancel_recompute(pg_catalog.uuid)') IS NOT NULL
     OR pg_catalog.to_regclass('public.pcm_partial_cancel_refund_reconciliation_v') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:OP7 物件已經在 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  -- 算式要讀的欄都在
  SELECT count(*) INTO v_n FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.orders'::regclass AND NOT attisdropped
     AND attname IN ('subtotal','shipping_fee','discount_total','tax_total','cancelled_at','order_source','shipping_method');
  IF v_n <> 7 THEN
    RAISE EXCEPTION '前置閘④:orders 缺算式要讀的欄(找到 % / 7)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.pcm_order_effective_amounts_v'::regclass AND NOT attisdropped
     AND attname IN ('effective_subtotal','effective_shipping_fee','effective_total');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '前置閘⑤:effective view 缺欄(找到 % / 3)', v_n;
  END IF;
  -- 待退款表的活列唯一鍵還在(ON CONFLICT 的仲裁靠它)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'order_pending_refunds'
                    AND indexname = 'order_pending_refunds_live_order_rail_key') THEN
    RAISE EXCEPTION '前置閘⑥:order_pending_refunds_live_order_rail_key 不在 ⇒ ON CONFLICT 沒有仲裁';
  END IF;
END
$pre$;

-- ══ ① 剩餘應收 ═════════════════════════════════════════════════════
CREATE FUNCTION public.pcm_order_remaining_receivable(p_order_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_tax        bigint;
  v_base       bigint;   -- 原稅基 = subtotal + shipping_fee − discount_total(create_order:548 那一句)
  v_cancelled  timestamptz;
  v_source     text;
  v_eff_sub    bigint;
  v_eff_ship   bigint;
  v_eff_total  bigint;
BEGIN
  SELECT o.tax_total, o.subtotal + o.shipping_fee - o.discount_total, o.cancelled_at, o.order_source
    INTO v_tax, v_base, v_cancelled, v_source
    FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- 整單取消 ⇒ 什麼都不該收
  IF v_cancelled IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT e.effective_subtotal, e.effective_shipping_fee, e.effective_total
    INTO v_eff_sub, v_eff_ship, v_eff_total
    FROM public.pcm_order_effective_amounts_v e WHERE e.order_id = p_order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- 沒有另計的稅 ⇒ 既有 view 的數就是答案(inclusive 單;或沒勾發票的手動單)
  IF COALESCE(v_tax, 0) = 0 THEN
    RETURN v_eff_total;
  END IF;
  -- 🔴🔴 有稅而【不是 web 單】⇒ NULL(codex 2026-09-14 R1 must-fix 1):手動單的稅 = round(未稅基×5%) + 逐列殘差
  --    (20260914030000:594), 而殘差【沒有存在任何一欄】(order_items 沒有「這一列是含稅輸入」的旗標)⇒
  --    含稅 31×100 + 32×100 的單:殘差 300 剛好 = 6000×5% ⇒ 總額自檢過、而取消一半之後剩餘稅不是 5% ⇒ 多開 50。
  --    ⇒ 📌 總額相等證明不了規則 ⇒ 手動單有稅一律「算不出來」(Sean 09-10 甲), 對帳報 tax_uncomputable, 人算。
  --    要算它得存每一列的殘差(schema), 另一片。
  IF v_source <> 'web' THEN
    RETURN NULL;
  END IF;
  -- web 單只有一句稅(create_order:548 `round((subtotal+shipping−discount)×0.05)`, 每一列都是未稅), 而且它可能是 0
  -- (稅隨付款方式)⇒ 自檢:儲存的 tax_total 能不能被那一句重現;能 ⇒ 用同一句算剩餘的稅
  -- (Q39 券作廢算原價 ⇒ 剩餘稅基不扣券);不能(日後別的規則)⇒ NULL。
  IF pg_catalog.round((v_base)::numeric * 0.05) <> v_tax THEN
    RETURN NULL;
  END IF;
  RETURN v_eff_sub + v_eff_ship + pg_catalog.round((v_eff_sub + v_eff_ship)::numeric * 0.05)::bigint;
END
$fn$;
COMMENT ON FUNCTION public.pcm_order_remaining_receivable(uuid) IS
  'OP7 ①:取消後訂單剩餘應收總額(Sean Q13 的第二個名詞)。'
  'tax_total = 0 ⇒ pcm_order_effective_amounts_v.effective_total;'
  'tax_total <> 0 且 order_source <> web ⇒ NULL(手動單的逐列殘差沒存, 總額相等證明不了規則;codex R1-1);'
  'tax_total <> 0 且 web ⇒ 先自檢 round((subtotal+shipping_fee−discount_total)×0.05) = tax_total,'
  '成立才回 effective_subtotal + effective_shipping_fee + round((effective_subtotal+effective_shipping_fee)×0.05);'
  '不成立回 NULL(= 算不出來, 呼叫端不得寫列;⟦b4-PARTCANCELTAX⟧ Sean 09-10 甲)。'
  '🔴 不複製稅率規則:它只驗「web 那一句重現得出儲存值」, 不猜混單 / 別的規則。'
  '🔴 half-up:pg_catalog.round(numeric), 與 create_order / admin_create_manual_order 同一種。'
  '整單取消(cancelled_at 非 NULL)⇒ 0。找不到單 ⇒ NULL。';
ALTER FUNCTION public.pcm_order_remaining_receivable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_order_remaining_receivable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_order_remaining_receivable(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_order_remaining_receivable(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_order_remaining_receivable(uuid) TO service_role;

-- ══ ② 逐軌分配(總額由參數給)═══════════════════════════════════════
-- 🔵 口徑逐字複製 pcm_pending_refund_amounts(20260902030000:65)的 net / pos / cum 三段;
--    差別只在 total:那支 = Σnet(整單取消退全部), 本支 = p_total(多收的那部分)。
--    ⚠️ 刻意不把那支改成呼叫本支 —— 它是活的整單取消路, 一個字不動(codex 對抗審查的面小一半)。
CREATE FUNCTION public.pcm_pending_refund_amounts_capped(p_order_id uuid, p_total bigint)
RETURNS TABLE (rail text, amount bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH net AS (
    SELECT r.rail,
           COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                      WHERE p.order_id = p_order_id AND p.rail = r.rail), 0)::bigint
         - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                      WHERE m.order_id = p_order_id AND m.rail = r.rail
                        AND m.voided_at IS NULL), 0)::bigint AS net
      FROM (VALUES ('bank_transfer'), ('cash')) AS r(rail)
  ),
  pos AS (SELECT n.rail, n.net FROM net n WHERE n.net > 0),
  cum AS (
    SELECT p.rail,
           SUM(p.net) OVER (ORDER BY p.rail ROWS UNBOUNDED PRECEDING)          AS c,
           SUM(p.net) OVER (ORDER BY p.rail ROWS UNBOUNDED PRECEDING) - p.net  AS c_prev
      FROM pos p
  )
  -- 貪婪:照 rail 字母序, 前一軌吃滿再輪到下一軌;每一軌最多退它自己的淨額。
  SELECT c.rail,
         LEAST(c.c, GREATEST(p_total, 0)) - LEAST(c.c_prev, GREATEST(p_total, 0)) AS amount
    FROM cum c
   WHERE LEAST(c.c, GREATEST(p_total, 0)) - LEAST(c.c_prev, GREATEST(p_total, 0)) > 0
$fn$;
COMMENT ON FUNCTION public.pcm_pending_refund_amounts_capped(uuid, bigint) IS
  'OP7 ②:把 p_total 逐軌分到 bank_transfer / cash(只分到有正淨額的軌;字母序貪婪;每軌不超過它的淨額)。'
  'net 口徑逐字 = pcm_pending_refund_amounts(20260902030000):Σ order_payments.amount − Σ order_manual_refunds.refund_amount(未作廢), 同軌。'
  'p_total ≤ 0 ⇒ 零列。card 不在分配裡(Q2=D:有卡的單根本不會走到這裡)。';
ALTER FUNCTION public.pcm_pending_refund_amounts_capped(uuid, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_amounts_capped(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_amounts_capped(uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_amounts_capped(uuid, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_pending_refund_amounts_capped(uuid, bigint) TO service_role;

-- ══ ③ 冪等重算(丙)═════════════════════════════════════════════════
CREATE FUNCTION public.pcm_partial_cancel_recompute(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cancelled  timestamptz;
  v_remaining  bigint;
  v_net        bigint;
  v_total      bigint;
  v_cid        uuid;
BEGIN
  -- 🔴🔴 先鎖單(codex 2026-09-14 R1 must-fix 2):本函式 service_role 也叫得到 ⇒ 不在 admin_cancel_order 的父列鎖底下時,
  --    「讀到未整單取消 → 算出 1000 → 停在寫入前」的期間另一個交易整單取消寫了 2100 ⇒ 本函式再 UPSERT 把它蓋回 1000。
  --    ⇒ 與既有 RPC 同一把鎖(orders 那一列 FOR UPDATE), 讀狀態與所有金額都在鎖後、持鎖到寫完。
  --    trigger 路徑上這一列本來就被同交易鎖著 ⇒ 零成本。
  PERFORM 1 FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT o.cancelled_at INTO v_cancelled FROM public.orders o WHERE o.id = p_order_id;
  -- 世界一:整單取消 ⇒ 那條路是 pcm_pending_refund_on_cancel 的, 本函式一個字都不動。
  IF v_cancelled IS NOT NULL THEN
    RETURN;
  END IF;
  -- 世界二(Q2=D):這張單收過【卡】⇒ 不寫列 —— 訂單級算出來的多收裡有卡的份, 而本表裝不下卡;
  --   寫到非卡軌上 = 算對總數、記到錯的軌(主視窗 A 09-08 打回丙的理由)。對帳面報 has_card。
  IF EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = p_order_id AND p.rail = 'card') THEN
    RETURN;
  END IF;
  -- 世界三:剩餘應收算不出來(含稅而 5% 重現不出)⇒ 不寫列。對帳面報 tax_uncomputable。
  v_remaining := public.pcm_order_remaining_receivable(p_order_id);
  IF v_remaining IS NULL THEN
    RETURN;
  END IF;
  -- 已收未退(非卡, 兩軌合計;口徑同 ②)
  SELECT COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                    WHERE p.order_id = p_order_id AND p.rail IN ('bank_transfer','cash')), 0)::bigint
       - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                    WHERE m.order_id = p_order_id AND m.rail IN ('bank_transfer','cash')
                      AND m.voided_at IS NULL), 0)::bigint
    INTO v_net;
  v_total := GREATEST(v_net - v_remaining, 0);   -- Sean Q13:max(0, 已收未退 − 剩餘應收)

  -- 歸屬:最新一筆取消單(部分取消一定有一筆);改價那條路沒有 ⇒ NULL(同整單取消那支「不猜」)。
  SELECT c.id INTO v_cid FROM public.order_cancellations c
   WHERE c.order_id = p_order_id ORDER BY c.created_at DESC LIMIT 1;

  IF v_total = 0 THEN
    -- 重算成 0 ⇒ 把本機制開的、還沒結的列作廢(不刪:它是紀錄)。整單取消那支開的列此時不存在(cancelled_at 為 NULL)。
    UPDATE public.order_pending_refunds r
       SET voided_at = pg_catalog.now(), void_reason = 'partial_recompute_zero'
     WHERE r.order_id = p_order_id AND r.settled_at IS NULL AND r.voided_at IS NULL;
    RETURN;
  END IF;

  -- 先作廢「這一輪分配不到的軌」上的未結列(例如上一輪 cash 有、這一輪只剩 bank)
  UPDATE public.order_pending_refunds r
     SET voided_at = pg_catalog.now(), void_reason = 'partial_recompute_rail_gone'
   WHERE r.order_id = p_order_id AND r.settled_at IS NULL AND r.voided_at IS NULL
     AND r.rail NOT IN (SELECT a.rail FROM public.pcm_pending_refund_amounts_capped(p_order_id, v_total) a);

  -- 覆寫(丙:重算 = 覆寫, 不累加)。活列唯一鍵 (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL 仲裁。
  INSERT INTO public.order_pending_refunds (order_id, cancellation_id, rail, amount_at_cancel)
  SELECT p_order_id, v_cid, a.rail, a.amount
    FROM public.pcm_pending_refund_amounts_capped(p_order_id, v_total) a
  ON CONFLICT (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL
  DO UPDATE SET amount_at_cancel = EXCLUDED.amount_at_cancel,
                cancellation_id  = EXCLUDED.cancellation_id;
END
$fn$;
COMMENT ON FUNCTION public.pcm_partial_cancel_recompute(uuid) IS
  'OP7 ③(丙 重算式, 主視窗 A 2026-09-08 批):對一張【未整單取消】的單, 依 Q13 重算待退款並【覆寫】。'
  '不做的三個世界:①已整單取消(那條路是 pcm_pending_refund_on_cancel 的)②有 card 收款(Q2=D, 對帳報 has_card)'
  '③剩餘應收 NULL(稅算不出, 對帳報 tax_uncomputable)。'
  'total = max(0, Σ非卡淨額 − pcm_order_remaining_receivable);= 0 ⇒ 作廢本單未結列(partial_recompute_zero)。'
  '冪等:多呼叫幾次答案一樣 ⇒ 資料層 trigger 可以放心多觸發(這是丙比甲乙好的那一格)。'
  '🛑 它【不是】對帳:漏觸發時唯一會叫的是 pcm_partial_cancel_refund_reconciliation_v(A 的必要條件)。';
ALTER FUNCTION public.pcm_partial_cancel_recompute(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_partial_cancel_recompute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_partial_cancel_recompute(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_partial_cancel_recompute(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_partial_cancel_recompute(uuid) TO service_role;

-- ══ ④ 對帳面 ═══════════════════════════════════════════════════════
-- 🔴 codex 2026-09-14 R1 must-fix 3 / 4 之後的形狀:
--   · has_card 的母體不看非卡淨額(純卡單也要報:recompute 因卡退出, 而卡那邊可能該退)——
--     判準 = 有卡 且(剩餘算不出 或 全軌淨收 > 剩餘)。⚠️ 卡的退款(payment_refunds)不在減項 ⇒ 已刷退的單會【多報】,
--     方向是「多一張給人看」不是「少一張」(D 逐字:改由對帳報出來給人看)。
--   · 非卡那半【逐軌】比:capped 分配 vs 未結列, 缺軌 / 多軌 / 金額差 都報 —— 只比總額看不到「開錯軌」
--     (bank 收款沖銷改登 cash 之後, 舊的 bank 待退列總額還對而軌錯了)。
CREATE VIEW public.pcm_partial_cancel_refund_reconciliation_v AS
WITH base AS (
  SELECT o.id AS order_id,
         COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                    WHERE p.order_id = o.id AND p.rail IN ('bank_transfer','cash')), 0)::bigint
       - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                    WHERE m.order_id = o.id AND m.rail IN ('bank_transfer','cash')
                      AND m.voided_at IS NULL), 0)::bigint AS noncard_net,
         COALESCE((SELECT SUM(p.amount) FROM public.order_payments p WHERE p.order_id = o.id), 0)::bigint
       - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                    WHERE m.order_id = o.id AND m.voided_at IS NULL), 0)::bigint AS all_net,
         EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = o.id AND p.rail = 'card') AS has_card,
         public.pcm_order_remaining_receivable(o.id) AS remaining,
         -- 🔴 已開 = 這張單【所有】未結待退款列(codex R2 must-fix 2:has_card / tax_uncomputable 的單也可能已有列,
         --    「已開 0」會讓人重複處理)—— 不受下面「非卡且可計算」那個母體限制。
         COALESCE((SELECT SUM(r.amount_at_cancel) FROM public.order_pending_refunds r
                    WHERE r.order_id = o.id AND r.settled_at IS NULL AND r.voided_at IS NULL), 0)::bigint AS open_total
    FROM public.orders o
   WHERE o.cancelled_at IS NULL
),
scoped AS (
  -- 🔴 該退(expected_total)只在【非卡且剩餘算得出】才有數(codex R2 must-fix 1):含卡的單, 非卡差額不是「整單該退」,
  --    印一個會被讀成整單該退的數比不印糟 ⇒ NULL = 待人工確認。
  SELECT b.*, CASE WHEN b.has_card OR b.remaining IS NULL THEN NULL ELSE GREATEST(b.noncard_net - b.remaining, 0) END AS expected_total
    FROM base b
),
per_rail AS (
  -- 逐軌比:期望分配 ∪ 未結列 的 rail 全集, 各自取金額(缺的那邊 0)
  SELECT s.order_id, u.rail,
         COALESCE((SELECT a.amount FROM public.pcm_pending_refund_amounts_capped(s.order_id, COALESCE(s.expected_total, 0)) a
                    WHERE a.rail = u.rail), 0)::bigint AS expected,
         COALESCE((SELECT SUM(r.amount_at_cancel) FROM public.order_pending_refunds r
                    WHERE r.order_id = s.order_id AND r.rail = u.rail AND r.settled_at IS NULL AND r.voided_at IS NULL), 0)::bigint AS open_amount
    FROM scoped s
    CROSS JOIN LATERAL (
      SELECT a.rail FROM public.pcm_pending_refund_amounts_capped(s.order_id, COALESCE(s.expected_total, 0)) a
      UNION
      SELECT r.rail FROM public.order_pending_refunds r
       WHERE r.order_id = s.order_id AND r.settled_at IS NULL AND r.voided_at IS NULL
    ) u
   WHERE s.remaining IS NOT NULL AND NOT s.has_card
),
rail_judged AS (
  SELECT p.order_id, bool_or(p.expected <> p.open_amount) AS any_diff
    FROM per_rail p WHERE p.rail IS NOT NULL
   GROUP BY p.order_id
),
judged AS (
  SELECT s.order_id, s.noncard_net, s.all_net, s.has_card, s.remaining, s.expected_total, s.open_total,
         CASE
           WHEN s.has_card AND (s.remaining IS NULL OR s.all_net - s.remaining > 0) THEN 'has_card'
           WHEN NOT s.has_card AND s.remaining IS NULL AND s.noncard_net > 0 THEN 'tax_uncomputable'
           WHEN NOT s.has_card AND s.remaining IS NOT NULL AND s.expected_total > 0 AND s.open_total = 0 THEN 'missing_row'
           WHEN NOT s.has_card AND s.remaining IS NOT NULL AND COALESCE(rj.any_diff, FALSE) THEN 'rail_mismatch'
           ELSE NULL
         END AS kind
    FROM scoped s
    LEFT JOIN rail_judged rj ON rj.order_id = s.order_id
)
SELECT j.order_id, j.kind, j.expected_total, j.open_total, j.noncard_net, j.all_net, j.remaining
  FROM judged j
 WHERE j.kind IS NOT NULL;
COMMENT ON VIEW public.pcm_partial_cancel_refund_reconciliation_v IS
  'OP7 ④ 對帳面(丙成立的前提, 主視窗 A 2026-09-08:「一處也是一處;對帳是那一處漏掉時唯一會叫的東西」)。'
  '母體 = 未整單取消的單。kind:has_card(D:含卡不開列;卡的刷退不在減項 ⇒ 可能多報, 方向是給人看;expected_total 對它恆 NULL = 待人工)'
  '· tax_uncomputable(稅重現不出, 不開列)· missing_row(該開而零列 = 漏觸發)'
  '· rail_mismatch(逐軌比 capped 分配 vs 未結列:缺軌 / 多軌 / 金額差)。ok 的不出現。'
  '消費端:後台 /orders/refund-exceptions 那頁(同一片接上;A 逐字要求「對帳不在 trigger 呼叫鏈上」)。';
REVOKE ALL ON public.pcm_partial_cancel_refund_reconciliation_v FROM PUBLIC;
REVOKE ALL ON public.pcm_partial_cancel_refund_reconciliation_v FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_partial_cancel_refund_reconciliation_v TO service_role;

-- ══ ⑤ 資料層 trigger(statement-level, transition table)═════════════
-- 🔴 為什麼是 trigger 不是在三支 RPC 裡各呼叫一次(plan §2):③ 冪等 ⇒ 多觸發無害;乙會在「明天多一條路」時安靜漏掉。
-- 🔴 Q1=C:與取消 / 改價同一個交易 ⇒ 重算炸 ⇒ 那個動作跟著炸(不會靜靜少一列)。
-- ⚠️ PG:transition table 不能與欄位清單(UPDATE OF …)並用 ⇒ order_items 那支收整個 UPDATE,
--    在函式裡用 OLD/NEW 兩張 transition table 自己挑「unit_price 或 quantity 真的變了」的 order。
CREATE FUNCTION public.pcm_partial_cancel_recompute_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_oid uuid;
BEGIN
  IF TG_TABLE_NAME = 'order_cancellation_items' THEN
    FOR v_oid IN SELECT DISTINCT n.order_id FROM new_rows n LOOP
      PERFORM public.pcm_partial_cancel_recompute(v_oid);
    END LOOP;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    FOR v_oid IN
      SELECT DISTINCT n.order_id
        FROM new_rows n JOIN old_rows o ON o.id = n.id
       WHERE n.unit_price IS DISTINCT FROM o.unit_price OR n.quantity IS DISTINCT FROM o.quantity
    LOOP
      PERFORM public.pcm_partial_cancel_recompute(v_oid);
    END LOOP;
  ELSE
    -- orders:只挑 shipping_method 真的變了的(codex R1 must-fix 5:改成門市 ⇒ 運費 0 ⇒ 剩餘應收變小,
    -- admin_update_order_workflow 20260913060000:337 會改它);cancelled_at 那一發不在這裡(那是整單取消那支的)。
    FOR v_oid IN
      SELECT DISTINCT n.id
        FROM new_rows n JOIN old_rows o ON o.id = n.id
       WHERE n.shipping_method IS DISTINCT FROM o.shipping_method
    LOOP
      PERFORM public.pcm_partial_cancel_recompute(v_oid);
    END LOOP;
  END IF;
  RETURN NULL;
END
$fn$;
ALTER FUNCTION public.pcm_partial_cancel_recompute_tg() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_partial_cancel_recompute_tg() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER order_cancellation_items_partial_refund_ai
  AFTER INSERT ON public.order_cancellation_items
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_partial_cancel_recompute_tg();

CREATE TRIGGER order_items_partial_refund_au
  AFTER UPDATE ON public.order_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_partial_cancel_recompute_tg();

CREATE TRIGGER orders_partial_refund_shipping_au
  AFTER UPDATE ON public.orders
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_partial_cancel_recompute_tg();

-- ══ 事後閘 ════════════════════════════════════════════════════════
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這兩個陣列;可授權物件 5 = 4 函式 + 1 view)
  v_functions text[] := ARRAY[
    'public.pcm_order_remaining_receivable(pg_catalog.uuid)',
    'public.pcm_pending_refund_amounts_capped(pg_catalog.uuid, pg_catalog.int8)',
    'public.pcm_partial_cancel_recompute(pg_catalog.uuid)',
    'public.pcm_partial_cancel_recompute_tg()'
  ]::text[];
  v_relations text[] := ARRAY[
    'public.pcm_partial_cancel_refund_reconciliation_v'
  ]::text[];
  r text; v_n integer;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN
      RAISE EXCEPTION '事後閘①:% 不存在', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘②:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
    -- trigger 函式不給 service_role(它只由 trigger 呼叫);其餘三支 service_role 要叫得到
    IF r <> 'public.pcm_partial_cancel_recompute_tg()'
       AND NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘③:% service_role 不能 EXECUTE(接線斷了)', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = pg_catalog.to_regprocedure(r) AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '事後閘④:% 的 search_path 不是空字串 ⇒ SECURITY DEFINER 提權面打開', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑤:% 對 anon/authenticated 讀得到', r;
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑤b:% service_role 讀不到(對帳頁會壞)', r;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_trigger t
   WHERE t.tgname IN ('order_cancellation_items_partial_refund_ai','order_items_partial_refund_au','orders_partial_refund_shipping_au') AND NOT t.tgisinternal;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '事後閘⑥:trigger 不是 3 支(實得 %)', v_n;
  END IF;
  -- 負對照:量具是活的
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260914(pg_catalog.uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
  RAISE NOTICE 'OP7 貼好了:remaining_receivable / amounts_capped / partial_cancel_recompute / reconciliation_v + 3 trigger。';
END
$post$;

COMMIT;
