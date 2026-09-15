-- 20260916050000_m4b_sql_cron_healthchecks_ping.sql
-- M-4b · 五支純 SQL 排程跑成功後,由資料庫自己去 healthchecks.io 報到(稽核 P2-1;主視窗 2026-09-15 派)
-- plan:docs/plans/2026-09-15-sql-cron-external-healthchecks-plan.md(456f01e01;Sean 甲「依照建議」)
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- healthchecks.io 面板只有 5 支 HTTP 排程;另外 5 支純 SQL 排程(兩支在金流路徑)停了外面一聲都不會出。
-- 站內代看(capture-recheck 順路讀 sweeper_heartbeat)只看其中兩支,而且跑在網站上 ⇒ 網站掛了一起掛。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 新函式 pcm_cron.ping_healthcheck(p_job text)(新物件 ⇒ 裸 CREATE)
--    · 排程名 → Vault secret 名:逐字 CASE(不做連字號轉換);不在表上 ⇒ RAISE LOG 後 return
--    · 心跳閘:sweeper_heartbeat 這一輪沒有成功列(last_success_at >= now())⇒ 不報到
--      now() = 交易開始時刻;5 支函式寫心跳都用 clock_timestamp() ⇒ 本輪寫的一定 >= now()
--      ⇒ late_payment 那種「單張失敗照常 return、寫失敗心跳」的輪次不會被報成成功
--      例外(plan §3 R2):late_payment 統計趟的非取消失敗仍寫成功心跳 ⇒ 仍會報到(與心跳原語意一致)
--    · secret 讀不到 / 不是 https://hc-ping.com/ 開頭 ⇒ RAISE LOG 後 return
--    · net.http_get 帶 User-Agent 'pcm-db/<job>'(輔助;pg_net 會再附自己的 UA)
--    · 🔴 整段 EXCEPTION WHEN OTHERS OR query_canceled 吞掉 + RAISE LOG:報到那句跟原函式同一個交易,
--      冒出去的錯會把這一輪的取消 / 重算整輪回滾(拋棄式 PG 2026-09-15 實測:第二句丟錯 ⇒ 第一句寫入回滾 + failed)。
--      代價:剛好在 ping 那一刻 pg_cancel_backend ⇒ 原函式照樣 commit、這一輪沒報到。接受。
--    · log 只印 SQLSTATE,不印 SQLERRM:ping 網址等於寫入權限,錯誤訊息有可能帶到網址。
-- ② 5 支排程 command 改成「原句; SELECT pcm_cron.ping_healthcheck('<job>');」
--    前提(拋棄式 PG 2026-09-15 實測,cron.use_background_workers=off 同正式庫,postgres 與非 superuser 兩種身分):
--      第一句丟錯 ⇒ 第二句不跑 + failed;兩句都成功 ⇒ 兩句都寫入 + succeeded。
--    前置閘逐支驗 live command = 原句逐字、active、username = postgres、database = postgres;
--    不鎖 cron.job(正式庫貼板角色 postgres 對 cron.job 沒有 UPDATE,FOR UPDATE 會 42501;20260915120000:25-40)。
--    改完逐支比對 command = 新句、schedule / active / username 沒被帶動。
-- ③ 後置閘:函式存在、owner postgres、SECURITY DEFINER、search_path 釘空、proacl 只剩 owner。
-- ⚠️ 偏離 plan §4-C「已是新句 ⇒ NOTICE 冪等」:函式是裸 CREATE ⇒ 重貼一律在前置閘一 RAISE、整筆回滾(較安全)。
--
-- ══ 需要 Sean(不在本檔)═════════════════════════════════════
-- · healthchecks.io 建 5 個 check(cron 模式、UTC、Grace 見 plan §4-A 表)
-- · Vault 貼 5 個 secret,名稱逐字:hc_ping_pcm_expire_unpaid_orders / hc_ping_pcm_settle_retry /
--   hc_ping_pcm_late_payment_sweep / hc_ping_pcm_acl_digest / hc_ping_pcm_net_exposure
--   ⇒ 一次只貼一個,等那支下一次執行後讀 API 確認只有那一支 new → up(plan §7-7)。
-- · secret 貼好之前:函式讀不到 secret ⇒ RAISE LOG 後 return,排程照常。
-- ⚠️ 殘餘風險(既有,不擴大):送出前網址會以明文短暫存在 net.http_request_queue.url。
-- ✅ 每日 ACL 摘要的 FN 族只掃 public(20260909060000:136-142)⇒ 新的 pcm_cron 函式不改指紋,不用跑 approve。
--
-- ══ rollback ════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句,rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260916050000-rollback.sql:🔴 同一個交易先把 5 支 command 改回原句逐字、再 DROP 函式。
-- 反過來的話,DROP 到改回之間的每一輪排程都會因為找不到函式而 failed。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_orig constant jsonb := pg_catalog.jsonb_build_object(
    'pcm-expire-unpaid-orders', 'SELECT pcm_cron.expire_unpaid_orders(500)',
    'pcm-settle-retry',         'SELECT public.pcm_settle_retry_sweep();',
    'pcm-late-payment-sweep',   'SELECT pcm_cron.late_payment_pending_refund_sweep()',
    'pcm-acl-digest',           'SELECT public.pcm_acl_digest_record();',
    'pcm-net-exposure',         'SELECT public.pcm_net_exposure_record();'
  );
  k        text;
  v_n      integer;
  v_cmd    text;
  v_active boolean;
  v_user   text;
  v_db     text;
BEGIN
  IF pg_catalog.to_regprocedure('pcm_cron.ping_healthcheck(text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:pcm_cron.ping_healthcheck(text) 已存在 ⇒ 本檔貼過了或有人先建了, 停下人工對齊';
  END IF;
  IF pg_catalog.to_regclass('public.sweeper_heartbeat') IS NULL THEN
    RAISE EXCEPTION '前置閘二:public.sweeper_heartbeat 不存在 ⇒ 心跳閘沒有對象';
  END IF;
  IF pg_catalog.to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION '前置閘三:net.http_get(text,jsonb,jsonb,integer) 不存在 ⇒ pg_net 沒裝';
  END IF;
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION '前置閘四:vault.decrypted_secrets 不存在';
  END IF;
  FOR k IN SELECT pg_catalog.jsonb_object_keys(v_orig) LOOP
    SELECT pg_catalog.count(*) INTO v_n FROM cron.job j WHERE j.jobname = k;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '前置閘五:cron.job 裡 % 不是恰一列(實 %)', k, v_n;
    END IF;
    SELECT j.command, j.active, j.username, j.database INTO v_cmd, v_active, v_user, v_db
      FROM cron.job j WHERE j.jobname = k;
    IF v_cmd IS DISTINCT FROM (v_orig ->> k) THEN
      RAISE EXCEPTION USING MESSAGE =
        '前置閘六:' || k || ' 的 command 不是我認得的原句 ⇒ 有人動過它, 本檔不准蓋掉。實得:' || COALESCE(v_cmd, '<null>');
    END IF;
    IF NOT COALESCE(v_active, false) THEN
      RAISE EXCEPTION '前置閘七:% 目前停用中 ⇒ 可能有人為了事故手動關的, 先去問清楚', k;
    END IF;
    IF v_user IS DISTINCT FROM 'postgres' OR v_db IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '前置閘八:% 的 username / database 不是 postgres / postgres(實 % / %)⇒ 報到函式的執行權會不夠', k, v_user, v_db;
    END IF;
  END LOOP;
END
$pre$;

-- ── ① 報到函式(新物件 ⇒ 裸 CREATE) ─────────────────────────────
CREATE FUNCTION pcm_cron.ping_healthcheck(p_job text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_secret text;
  v_url    text;
BEGIN
  -- 逐字對照(plan §4-B 表);不做 replace('-', '_'):打錯字要停在「找不到」,不是讀到別支的網址。
  v_secret := CASE p_job
    WHEN 'pcm-expire-unpaid-orders' THEN 'hc_ping_pcm_expire_unpaid_orders'
    WHEN 'pcm-settle-retry'         THEN 'hc_ping_pcm_settle_retry'
    WHEN 'pcm-late-payment-sweep'   THEN 'hc_ping_pcm_late_payment_sweep'
    WHEN 'pcm-acl-digest'           THEN 'hc_ping_pcm_acl_digest'
    WHEN 'pcm-net-exposure'         THEN 'hc_ping_pcm_net_exposure'
  END;
  IF v_secret IS NULL THEN
    RAISE LOG '[ping_healthcheck] 排程名 % 不在對照表 ⇒ 不報到', p_job;
    RETURN;
  END IF;

  -- 心跳閘:這一輪有寫成功心跳才報到
  IF NOT EXISTS (SELECT 1 FROM public.sweeper_heartbeat h
                  WHERE h.job_name = p_job
                    AND h.last_success_at >= pg_catalog.now()) THEN
    RAISE LOG '[ping_healthcheck] % 本輪沒有成功心跳 ⇒ 不報到', p_job;
    RETURN;
  END IF;

  SELECT s.decrypted_secret INTO v_url FROM vault.decrypted_secrets s WHERE s.name = v_secret;
  IF v_url IS NULL OR pg_catalog.left(v_url, 20) IS DISTINCT FROM 'https://hc-ping.com/' THEN
    RAISE LOG '[ping_healthcheck] % 的 secret % 不存在或不是 https://hc-ping.com/ 開頭 ⇒ 不報到', p_job, v_secret;
    RETURN;
  END IF;

  PERFORM net.http_get(
    url                  := v_url,
    headers              := pg_catalog.jsonb_build_object('User-Agent', 'pcm-db/' || p_job),
    timeout_milliseconds := 5000
  );
EXCEPTION WHEN OTHERS OR query_canceled THEN
  -- 🔴 吞掉:報到失敗不准把原排程這一輪回滾。只印 SQLSTATE(不印 SQLERRM,可能帶到網址)。
  RAISE LOG '[ping_healthcheck] % 報到失敗(已吞, 原排程不受影響)SQLSTATE=%', p_job, SQLSTATE;
END;
$fn$;
COMMENT ON FUNCTION pcm_cron.ping_healthcheck(text) IS
  '純 SQL 排程跑成功後向 healthchecks.io 報到(20260916050000;稽核 P2-1)。排程名→Vault secret 逐字對照;'
  ' 本輪 sweeper_heartbeat 有成功列才報到;錯誤一律吞掉只 RAISE LOG SQLSTATE,不准拖垮原排程。'
  ' 只由 pg_cron(postgres)呼叫,不 GRANT 任何角色。';

ALTER FUNCTION pcm_cron.ping_healthcheck(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION pcm_cron.ping_healthcheck(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pcm_cron.ping_healthcheck(text) FROM anon, authenticated, service_role, payment_confirmer;

-- ── ② 改 5 支排程 command ──────────────────────────────────────
DO $alter$
DECLARE
  v_orig constant jsonb := pg_catalog.jsonb_build_object(
    'pcm-expire-unpaid-orders', 'SELECT pcm_cron.expire_unpaid_orders(500)',
    'pcm-settle-retry',         'SELECT public.pcm_settle_retry_sweep();',
    'pcm-late-payment-sweep',   'SELECT pcm_cron.late_payment_pending_refund_sweep()',
    'pcm-acl-digest',           'SELECT public.pcm_acl_digest_record();',
    'pcm-net-exposure',         'SELECT public.pcm_net_exposure_record();'
  );
  v_new constant jsonb := pg_catalog.jsonb_build_object(
    'pcm-expire-unpaid-orders', 'SELECT pcm_cron.expire_unpaid_orders(500); SELECT pcm_cron.ping_healthcheck(''pcm-expire-unpaid-orders'');',
    'pcm-settle-retry',         'SELECT public.pcm_settle_retry_sweep(); SELECT pcm_cron.ping_healthcheck(''pcm-settle-retry'');',
    'pcm-late-payment-sweep',   'SELECT pcm_cron.late_payment_pending_refund_sweep(); SELECT pcm_cron.ping_healthcheck(''pcm-late-payment-sweep'');',
    'pcm-acl-digest',           'SELECT public.pcm_acl_digest_record(); SELECT pcm_cron.ping_healthcheck(''pcm-acl-digest'');',
    'pcm-net-exposure',         'SELECT public.pcm_net_exposure_record(); SELECT pcm_cron.ping_healthcheck(''pcm-net-exposure'');'
  );
  k         text;
  v_id      bigint;
  v_cmd     text;
  v_sched   text;
  v_active  boolean;
  v_user    text;
  v_cmd2    text;
  v_sched2  text;
  v_active2 boolean;
  v_user2   text;
BEGIN
  FOR k IN SELECT pg_catalog.jsonb_object_keys(v_new) LOOP
    SELECT j.jobid, j.command, j.schedule, j.active, j.username INTO v_id, v_cmd, v_sched, v_active, v_user
      FROM cron.job j WHERE j.jobname = k;
    -- 改之前再驗一次原句(前置閘到這裡之間有人動過 ⇒ 不蓋掉;不鎖列,天花板同 20260915120000)
    IF v_cmd IS DISTINCT FROM (v_orig ->> k) THEN
      RAISE EXCEPTION USING MESSAGE = '改前重驗:' || k || ' 的 command 不是原句 ⇒ 有人剛動過, 整筆回滾。實得:' || COALESCE(v_cmd, '<null>');
    END IF;
    PERFORM cron.alter_job(job_id => v_id, command => v_new ->> k);
    SELECT j.command, j.schedule, j.active, j.username INTO v_cmd2, v_sched2, v_active2, v_user2
      FROM cron.job j WHERE j.jobid = v_id;
    IF v_cmd2 IS DISTINCT FROM (v_new ->> k) THEN
      RAISE EXCEPTION USING MESSAGE = '事後比對一:' || k || ' 的 command 沒有變成新句。實得:' || COALESCE(v_cmd2, '<null>');
    END IF;
    IF v_sched2 IS DISTINCT FROM v_sched OR v_active2 IS DISTINCT FROM v_active OR v_user2 IS DISTINCT FROM v_user THEN
      RAISE EXCEPTION '事後比對二:% 改 command 的同時 schedule / active / username 跟著變了 ⇒ 有人同時在動這一列, 整筆回滾', k;
    END IF;
  END LOOP;
END
$alter$;

-- ── ③ 後置閘 ──────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;可授權物件 1)
  v_functions text[] := ARRAY[
    'pcm_cron.ping_healthcheck(text)'
  ]::text[];
  r      text;
  v_oid  regprocedure;
  v_extra integer;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '後置閘一:% 不存在', r;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_oid
                      AND p.prosecdef
                      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
                      AND p.proconfig @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '後置閘二:% 不是 owner=postgres + SECURITY DEFINER + search_path 釘空', r;
    END IF;
    -- proacl 只剩 owner(照 20260905220000:270-279 的 aclexplode 寫法)
    SELECT pg_catalog.count(*) INTO v_extra
      FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = v_oid AND a.grantee <> p.proowner;
    IF v_extra <> 0 THEN
      RAISE EXCEPTION '後置閘三:% 的 proacl 除了 owner 還有 % 條授權', r, v_extra;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四:% 對 anon / authenticated / service_role 開著 EXECUTE', r;
    END IF;
  END LOOP;
END
$post$;

COMMIT;
