-- ══════════════════════════════════════════════════════════════════════════
-- OP4 盤點:回填前的**唯讀**事實清單(每張單一列)
-- ══════════════════════════════════════════════════════════════════════════
-- 用途:OP4 歷史回填的輸入清單與可回填性分類。本檔**零寫入**,可對正式站直跑。
-- 跑法(唯讀交易,寫入會當場紅):
--   psql "$PROD_DSN" -v ON_ERROR_STOP=1 -f scripts/op4-inventory.sql
--
-- 🔴 為什麼要有這一份:OP6-a 只回「這張單能不能判定」,不回「它的錢長什麼樣」。
--    回填要寫的是 amount / received_at / rec_trade_id 三個具體值,那三個值的來源
--    在正式站是什麼形狀 —— 沒盤點過就寫回填 = 拿假設當事實。
-- 🔴 本檔只盤點、不分類「該不該回填」。分類判準寫在 OP4 migration 自己的 WHERE,
--    因為判準必須是**函式化、可被突變測試**的東西,不是一份人看的表。
-- ══════════════════════════════════════════════════════════════════════════
BEGIN;
SET TRANSACTION READ ONLY;

\pset pager off
\pset border 2

\echo ''
\echo '══ ① 全站訂單 × 帳本覆蓋狀況 ══'
SELECT
  o.display_id,
  o.payment_status::text                                   AS ps,
  o.total,
  o.subtotal,
  o.paid_at,
  o.payment_method,
  (o.tappay_rec_trade_id IS NOT NULL)                      AS has_rec,
  -- 帳本
  (SELECT pg_catalog.count(*) FROM public.order_payments p
    WHERE p.order_id = o.id)                               AS ledger_rows,
  -- attempts(卡軌回填的佐證來源)
  (SELECT pg_catalog.count(*) FROM public.payment_charge_attempts a
    WHERE a.order_id = o.id)                               AS att_all,
  (SELECT pg_catalog.count(*) FROM public.payment_charge_attempts a
    WHERE a.order_id = o.id AND a.status = 'charged')      AS att_charged,
  -- 🔴 attempts 的 rec 與 orders 的 rec 是否**同一個值**:兩邊各自 UNIQUE,
  --    但沒有任何約束保證它們一致 ⇒ 不一致就代表這張單的卡軌事實有兩個版本,不可回填。
  (SELECT bool_and(a.rec_trade_id IS NOT DISTINCT FROM o.tappay_rec_trade_id)
     FROM public.payment_charge_attempts a
    WHERE a.order_id = o.id AND a.status = 'charged')      AS rec_agrees,
  -- 🔴 金額佐證:attempts **沒有 amount 欄**(20260612150000:87-99 親驗)⇒ 唯一可用的
  --    「當時收了多少」是 orders.total。它會不會已經被改過,只能靠這兩個間接訊號:
  (o.updated_at > o.paid_at)                               AS touched_after_paid,
  (SELECT pg_catalog.count(*) FROM public.admin_audit_log l
    WHERE l.target = 'order:' || o.id::text
      AND (o.paid_at IS NULL OR l.created_at > o.paid_at))  AS audit_after_paid,
  -- 品項快照(OP6-a 前提 3 同判準)
  (SELECT coalesce(pg_catalog.sum(oi.line_total), 0) FROM public.order_items oi
    WHERE oi.order_id = o.id)                              AS items_sum,
  -- 取消面 / 退款面(有任一 ⇒ 回填之外還有別的帳要算,OP4 不碰)
  (SELECT pg_catalog.count(*) FROM public.order_cancellations c
    WHERE c.order_id = o.id)                               AS canc_n,
  (SELECT pg_catalog.count(*) FROM public.order_refunds r
    WHERE r.order_id = o.id)                               AS refund_n
FROM public.orders o
ORDER BY o.created_at;

\echo ''
\echo '══ ② charged attempt 明細(卡軌回填的逐筆佐證)══'
SELECT
  o.display_id,
  a.status,
  (a.rec_trade_id IS NOT NULL)      AS att_has_rec,
  (a.rec_trade_id = o.tappay_rec_trade_id) AS rec_same,
  a.created_at                      AS att_created,
  a.updated_at                      AS att_updated,
  o.paid_at,
  -- 🔴 received_at 的候選值有兩個(paid_at / att.updated_at),差多少要看得到:
  --    差很大代表「授權時點」與「翻單時點」不是同一件事,回填要挑哪個得有依據。
  (a.updated_at - o.paid_at)        AS updated_minus_paid
FROM public.payment_charge_attempts a
JOIN public.orders o ON o.id = a.order_id
WHERE a.status = 'charged'
ORDER BY a.created_at;

\echo ''
\echo '══ ③ 匯總:各形狀幾張單 ══'
SELECT
  o.payment_status::text AS ps,
  pg_catalog.count(*)                                                     AS orders_n,
  pg_catalog.count(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM public.order_payments p WHERE p.order_id = o.id))       AS no_ledger_n,
  pg_catalog.count(*) FILTER (WHERE o.tappay_rec_trade_id IS NOT NULL)    AS has_rec_n,
  pg_catalog.count(*) FILTER (WHERE o.paid_at IS NOT NULL)                AS has_paid_at_n,
  pg_catalog.count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.payment_charge_attempts a
     WHERE a.order_id = o.id AND a.status = 'charged'))                   AS has_charged_att_n
FROM public.orders o
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '══ ④ 🔴 沒有卡軌佐證卻已 paid 的單(= OP4 回填不到、只能走 OP5 人工登錄)══'
SELECT o.display_id, o.payment_status::text AS ps, o.total, o.paid_at, o.payment_method
FROM public.orders o
WHERE o.payment_status::text IN ('paid', 'partiallyPaid')
  AND NOT EXISTS (SELECT 1 FROM public.order_payments p WHERE p.order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                   WHERE a.order_id = o.id AND a.status = 'charged')
ORDER BY o.created_at;

ROLLBACK;
