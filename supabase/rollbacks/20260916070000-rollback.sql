-- 20260916070000-rollback.sql
-- 退「放棄章只數還在候選」(supabase/migrations/20260916070000_m4b_settle_retry_gaveup_count_only_candidates.sql)。
--
-- 🔴 健康檢查本體由程式從 20260916060000 那一代逐字產生;後置閘驗 md5 回到 77690bb08e3aea51714ec53251ca296c。
--    CREATE OR REPLACE 保留 owner / ACL ⇒ 不重下 REVOKE / GRANT;後置閘逐角色核。
-- 🔴 順序:先 revert 告警文案那一顆(否則信說「不再算」而 DB 已回舊版照算)⇒ 本檔 ⇒ 同批跑 pcm_acl_approve_latest(p_note 帶 20260916070000 rollback)。
-- 🔴 本檔內順序:先把健康檢查退回舊版(它是新函式唯一的呼叫端)⇒ 再 DROP 新函式。
-- 🔴 不會被撤銷的事實:無(那一片零寫入)。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.get_settle_retry_gaveup_health()')) IS DISTINCT FROM '366d75f956a14d6037d864632d538543'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
          WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_settle_retry_still_candidate(uuid)')) IS DISTINCT FROM '6603ccb71d5e67c8773a20d1e5e99c5a' THEN
    RAISE EXCEPTION '前置閘:健康檢查或 pcm_settle_retry_still_candidate 不是 20260916070000 那一代(md5 對不上)⇒ 沒貼過、已退過、或有人改過, 停下';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.get_settle_retry_gaveup_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 每個 key 獨佔一行、逗號結尾(anomaly-alert-key-contract.test.ts 用 ^\s*'key',\s*$ 抽 key)。
    -- 🔴 R2 S3:attempts 表沒有管道欄 ⇒ JOIN orders。舊三鍵只數匯款 ⇒ DB 先上、TS 還沒上的空窗裡,
    --    舊信件段「N 張匯款單…已經匯了錢」仍然正確,不會把現金單寫成匯款單。
    --    join 不到 orders 的列(訂單被刪)兩邊都不算(R2 N6)⇒ 匯款 + 現金可能 < 全部放棄列數。
    'gave_up_count',
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'),
    'oldest_gave_up',
    (SELECT pg_catalog.min(a.gave_up_at) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'),
    'sample_order_ids',
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT a.order_id FROM public.pcm_settle_retry_attempts a
               JOIN public.orders o ON o.id = a.order_id
              WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'
              ORDER BY a.gave_up_at LIMIT 5) x),
    'gave_up_cash_count',
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'),
    'oldest_gave_up_cash',
    (SELECT pg_catalog.min(a.gave_up_at) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'),
    'sample_cash_order_ids',
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT a.order_id FROM public.pcm_settle_retry_attempts a
               JOIN public.orders o ON o.id = a.order_id
              WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'
              ORDER BY a.gave_up_at LIMIT 5) x),
    'tracked_total',
    -- 分母:全表列數(語意不變)。
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts)
  );
$fn$;

DROP FUNCTION public.pcm_settle_retry_still_candidate(uuid);

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.get_settle_retry_gaveup_health()')
                    AND pg_catalog.md5(p.prosrc) = '77690bb08e3aea51714ec53251ca296c'
                    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                    AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=""']
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}') THEN
    RAISE EXCEPTION '後置閘:get_settle_retry_gaveup_health 沒有回到 20260916060000 那一代(md5 / owner / definer / search_path / ACL)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'pcm_settle_retry_still_candidate') THEN
    RAISE EXCEPTION '後置閘:pcm_settle_retry_still_candidate 還在';
  END IF;
END
$post$;

COMMIT;
