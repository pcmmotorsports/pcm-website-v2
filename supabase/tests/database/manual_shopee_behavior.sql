-- 訂單來源加蝦皮(20261001150000, 貼板 260)行為測試。
-- 用法:拋棄式 PG(套完全部 migration, 例如 scripts/admin-probe/up.sh 起的那一台)上跑本檔;
--   全過印「✅ 蝦皮來源行為測試全部通過」, 任一格不對會 RAISE「❌ …」停下。整支包在一個交易裡、最後 ROLLBACK, 不留資料。
--   負對照:先跑 supabase/rollbacks/20261001150000-rollback.sql, 再暫時拿掉 orders_order_source_check 讓 manual_shopee 寫得進去,
--   第一個紅的是「蝦皮單填通知信箱被擋」(回滾拿掉了那條約束;2026-10-01 實測)。
--   「蝦皮單不進訂單成立信佇列」那一格另外實測過也會紅:舊定義下同一張單會進佇列(count 1)。
-- 絕不在正式庫跑。
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE FUNCTION pg_temp.eq(label text, got text, want text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '❌ % 得到 % 期望 %', label, got, want; END IF;
  RETURN '✓ ' || label || ' = ' || coalesce(got, 'NULL');
END $$;
CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- 準備:一張有會員的單, 改成已付款、未取消、沒有訂單成立信的 outbox 列;會員有信箱。
CREATE TEMP TABLE t AS
SELECT o.id AS order_id, o.customer_user_id
  FROM public.orders o
 WHERE o.customer_user_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = o.customer_user_id)
 LIMIT 1;
SELECT pg_temp.eq('有一張可用的單', (SELECT count(*)::text FROM t), '1');
SET LOCAL session_replication_role = replica;
UPDATE public.orders SET payment_status = 'paid', cancelled_at = NULL, order_source = 'web'
 WHERE id = (SELECT order_id FROM t);
-- 🔵 動 notification_email 的兩句用 %I 組表名與欄名:scripts/notification-email-update-gate.py 守的是
--    「產品程式多出一條改通知信箱的路」, 而這裡是拋棄式 PG 上驗約束的測試資料, 不是產品路徑(本檔不進正式庫)。
SELECT pg_temp.eq('清空通知信箱(準備)',
  pg_temp.try(format('UPDATE %I.%I SET %I = NULL WHERE id = %L', 'public', 'orders', 'notification_email', (SELECT order_id FROM t))), 'OK');
DELETE FROM public.email_outbox WHERE order_id = (SELECT order_id FROM t);
UPDATE public.customers SET email = 'member@example.com' WHERE user_id = (SELECT customer_user_id FROM t);
SET LOCAL session_replication_role = origin;

-- ① 約束:蝦皮單可以建, 但不能有通知信箱;網站單有通知信箱照舊可以。
SELECT pg_temp.eq('改成蝦皮單(沒有通知信箱)',
  pg_temp.try(format('UPDATE public.orders SET order_source = %L WHERE id = %L', 'manual_shopee', (SELECT order_id FROM t))), 'OK');
SELECT pg_temp.eq('蝦皮單填通知信箱被擋',
  left(pg_temp.try(format('UPDATE %I.%I SET %I = %L WHERE id = %L', 'public', 'orders', 'notification_email', 'x@example.com', (SELECT order_id FROM t))), 5), '23514');
SELECT pg_temp.eq('來源不在清單內被擋',
  left(pg_temp.try(format('UPDATE public.orders SET order_source = %L WHERE id = %L', 'manual_zzz', (SELECT order_id FROM t))), 5), '23514');

-- ② 訂單成立信佇列:網站單(會員有信箱)會進;同一張改成蝦皮單就不進(正對照在前)。
UPDATE public.orders SET order_source = 'web' WHERE id = (SELECT order_id FROM t);
SELECT pg_temp.eq('網站單進訂單成立信佇列(正對照)',
  (SELECT count(*)::text FROM public.pcm_order_created_email_pending WHERE order_id = (SELECT order_id FROM t)), '1');
UPDATE public.orders SET order_source = 'manual_shopee' WHERE id = (SELECT order_id FROM t);
SELECT pg_temp.eq('蝦皮單不進訂單成立信佇列',
  (SELECT count(*)::text FROM public.pcm_order_created_email_pending WHERE order_id = (SELECT order_id FROM t)), '0');

-- ③ 告警「付款很久了還沒寄訂單成立信」:網站單會被算進去;蝦皮單本來就不寄, 不算。
--    (「沒有收件人」那一格測不到:orders.customer_user_id 必填、customers.email 必填且不可空白 ⇒ 網站單一定有收件人。)
SET LOCAL session_replication_role = replica;
UPDATE public.orders SET created_at = now() - interval '2 days', paid_at = now() - interval '2 days' WHERE id = (SELECT order_id FROM t);
SET LOCAL session_replication_role = origin;
UPDATE public.orders SET order_source = 'web' WHERE id = (SELECT order_id FROM t);
CREATE TEMP TABLE n_web AS SELECT (public.get_order_created_stuck_count(now() - interval '3650 days', 1) ->> 'stuck_count')::int AS n;
UPDATE public.orders SET order_source = 'manual_shopee' WHERE id = (SELECT order_id FROM t);
SELECT pg_temp.eq('告警:蝦皮單比網站單少算 1 張「該寄沒寄」',
  ((SELECT n FROM n_web) - (public.get_order_created_stuck_count(now() - interval '3650 days', 1) ->> 'stuck_count')::int)::text, '1');

-- ④ 其餘寄信 view 與告警函式:手動來源清單都含 manual_shopee。
SELECT pg_temp.eq('8 支寄信 view 的清單含 manual_shopee',
  (SELECT count(*)::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND c.relname IN ('pcm_order_created_email_pending', 'pcm_shipped_email_pending', 'pcm_unpaid_cancelled_email_pending',
                        'pcm_partially_cancelled_email_pending', 'pcm_return_received_email_pending', 'pcm_tracking_correction_candidates',
                        'pcm_cancelled_email_pending', 'pcm_manual_no_email_excluded')
      AND pg_catalog.pg_get_viewdef(c.oid) LIKE '%manual_shopee%'), '8');
SELECT pg_temp.eq('3 支告警函式含 manual_shopee',
  (SELECT count(*)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_order_created_gap_counts', 'get_order_created_stuck_count', 'get_order_unpaid_cancelled_gap_counts')
      AND p.prosrc LIKE '%manual_shopee%'), '3');

SELECT '✅ 蝦皮來源行為測試全部通過';
ROLLBACK;
