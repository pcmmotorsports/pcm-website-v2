-- 20260928260000_m4b_cron_run_log_purge.sql —— 排程執行紀錄每天清掉 14 天前的(網站正式庫)
-- pcm:idempotent: no
--   理由:建新函式、排新排程;前置閘看到函式已存在就停(要重來先跑 rollback)。
-- M-4b · 施工窗 86(主視窗 pcm-website-v2-a0 派)· Sean 2026-09-28 Q1 甲(三件都做)、Q2 甲(保留 14 天)
-- 🛑 未貼。只寫不貼, 貼的人是主視窗(Sean 授權後)。
-- 計畫:~/pcm-mailbox/計畫-網站資料庫索引與清理-20260928.md 第三、四、六節;先例 20260908030000(排程 + 心跳 + 四道收權)
--
-- ══ 為什麼 ══════════════════════════════════════════════════════════
-- cron.job_run_details 從 2026-07-25 起沒清過:2026-09-28 唯讀 98,888 列、22 MB、每天多約 2,200 列(10 支排程),
-- 其中 68,265 列超過 14 天。讀這張表的程式只有 scripts/d1-sweeper-control.ts(最近 10 分鐘)⇒ 保留 14 天不影響程式;
-- 超過 14 天的紀錄只影響工程師人工排查, 員工與客人看不到這張表。
--
-- ══ 做什麼 ══════════════════════════════════════════════════════════
-- ① public.pcm_cron_run_log_purge():刪 end_time 早於 14 天前的列, 成功後才寫心跳(sweeper_heartbeat)。
--    · 刪除那一段【不吞錯】:刪失敗 ⇒ 整次失敗、不寫心跳 ⇒ 心跳停在上一次, 超過 2 天後台與告警會提(R2 建議 3)。
--    · 只有寫心跳那一段包 EXCEPTION(寫不成只記警告, 不讓清理失敗)。
--    · 心跳用 clock_timestamp()(實際時鐘):事後閘拿它跟 transaction_timestamp() 比(R4 建議 F3)。
--    · SECURITY DEFINER(以 postgres 身分跑, cron.job_run_details 屬 supabase_admin、postgres 可刪且 bypassrls,
--      2026-09-28 唯讀實查)+ SET search_path = '' + 表名一律帶 schema。
-- ② 四道收權:PUBLIC / anon / authenticated / service_role, payment_confirmer 都 REVOKE EXECUTE(R2 必修 2)
--    ⇒ 未登入的人不能經 /rest/v1/rpc 叫它去清紀錄、偽造心跳。只有排程(postgres)叫得到。
-- ③ cron.schedule('pcm-cron-run-log-purge', '17 19 * * *'):UTC 19:17 = 台灣 03:17, 避開整點的其他排程。
-- ④ 貼的當下直接叫一次(R2 建議 4):證明函式跑得動、完成第一次約 6.8 萬列的清理、寫下第一筆心跳,
--    並斷言心跳是這一次寫的(R3 必修 3)⇒ 推碼之後後台不會亮「從來沒寫過心跳」。
--
-- ══ 貼板與推的順序(計畫第四節;R2 必修 1)════════════════════════════
--   🔴 先貼本檔, 再推白名單那顆碼到 dev 與 main。反過來(碼先上)⇒ 白名單有名字而心跳還沒有
--      ⇒ 後台標「從來沒寫過心跳」, 異常告警還會寄 LINE 與 Email。
--   本檔與白名單(packages/domain/src/ops/cron-jobs.ts)、兩支測試在同一顆 commit(排程白名單漂移閘要求)。
--   貼成功之後才補 APPLIED.tsv 那一列(主視窗照平常流程)。
--   · 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260928260000):新增 1 支函式。
--   · statement_timeout 300s:第一次要刪約 6.8 萬列(20 MB 循序掃, 推估幾秒)。不鎖商品或訂單。
-- ══ rollback ══════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- (上一行 = 退回檔開頭那句, rollback-locktimeout-gate 要它在本段第一行)
-- supabase/rollbacks/20260928260000-rollback.sql:unschedule、刪函式、刪心跳列。
--   🔴 退回的順序與上線相反:先推「白名單拿掉這一支」的碼, dev 與 main 都部署完成, 再貼退回;
--      正式退役要另寫一支 migration(含 cron.unschedule)跟白名單同一顆, 不能只靠這支手動退回檔(計畫第六節)。
--   已刪的舊紀錄無法還原(那是本件的本意)。
-- ════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';

-- ── 0. 前置閘 ───────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_cron_run_log_purge()') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:public.pcm_cron_run_log_purge() 已存在 ⇒ 貼過了或撞名, 停下(要重來先跑 rollback)';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-cron-run-log-purge') THEN
    RAISE EXCEPTION '前置閘二:排程 pcm-cron-run-log-purge 已存在, 停下';
  END IF;
  IF pg_catalog.to_regclass('cron.job_run_details') IS NULL OR pg_catalog.to_regclass('public.sweeper_heartbeat') IS NULL THEN
    RAISE EXCEPTION '前置閘三:cron.job_run_details / public.sweeper_heartbeat 不在';
  END IF;
  IF NOT pg_catalog.has_table_privilege('cron.job_run_details', 'DELETE') THEN
    RAISE EXCEPTION '前置閘四:目前的身分(%)對 cron.job_run_details 沒有 DELETE 權限', current_user;
  END IF;
END
$pre$;

-- ── 1. 清理函式 ─────────────────────────────────────────────────────
CREATE FUNCTION public.pcm_cron_run_log_purge()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_deleted bigint;
BEGIN
  -- 刪除:不包 EXCEPTION。失敗就讓整次失敗(心跳不動 ⇒ 後台看得出來)。
  DELETE FROM cron.job_run_details
   WHERE end_time < pg_catalog.now() - interval '14 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 心跳:成功之後才寫;寫不成只記警告, 不讓清理失敗(先例 20260908030000:304-315)。
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-cron-run-log-purge', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[pcm_cron_run_log_purge] 心跳寫入失敗(本次清理不受影響):%', SQLERRM;
  END;
  RETURN v_deleted;
END;
$fn$;

COMMENT ON FUNCTION public.pcm_cron_run_log_purge() IS
  '20260928260000:每天刪 cron.job_run_details 裡 end_time 早於 14 天前的列,成功後寫心跳 pcm-cron-run-log-purge。只給排程(postgres)叫。';

-- ── 2. 四道收權 ─────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.pcm_cron_run_log_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_cron_run_log_purge() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_cron_run_log_purge() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_cron_run_log_purge() FROM service_role, payment_confirmer;

-- ── 3. 排程(UTC 19:17 = 台灣 03:17)───────────────────────────────
SELECT cron.schedule('pcm-cron-run-log-purge', '17 19 * * *', $cron$SELECT public.pcm_cron_run_log_purge();$cron$);

-- ── 4. 貼的當下叫一次 + 事後閘 ─────────────────────────────────────
DO $post$
DECLARE
  v_functions text[] := ARRAY[
    'public.pcm_cron_run_log_purge()'
  ]::text[];
  v_deleted bigint;
  v_beat timestamptz;
  v_rec record;
  v_def record;
  v_oldest timestamptz;
BEGIN
  v_deleted := public.pcm_cron_run_log_purge();
  RAISE NOTICE '第一次清理:刪掉 % 列', v_deleted;

  -- ④a 心跳是這一次寫的(R3 必修 3):函式用 clock_timestamp(), 一定晚於交易開始時間
  SELECT last_success_at INTO v_beat FROM public.sweeper_heartbeat WHERE job_name = 'pcm-cron-run-log-purge';
  IF v_beat IS NULL OR v_beat < pg_catalog.transaction_timestamp() THEN
    RAISE EXCEPTION '事後閘④a:心跳沒有寫進去(last_success_at = %)⇒ 推碼後後台會亮紅, 整包回滾', v_beat;
  END IF;

  -- ④b 清完之後沒有超過 14 天的列
  SELECT pg_catalog.min(end_time) INTO v_oldest FROM cron.job_run_details;
  IF v_oldest IS NOT NULL AND v_oldest < pg_catalog.now() - interval '14 days' THEN
    RAISE EXCEPTION '事後閘④b:清完還有 % 的紀錄(早於 14 天前)', v_oldest;
  END IF;

  -- ④c 函式的屬性:owner、DEFINER、search_path
  SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig INTO v_def
    FROM pg_catalog.pg_proc p WHERE p.oid = 'public.pcm_cron_run_log_purge()'::regprocedure;
  IF v_def.owner IS DISTINCT FROM 'postgres' OR NOT v_def.prosecdef OR v_def.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '事後閘④c:函式屬性不對(owner=% definer=% config=%)', v_def.owner, v_def.prosecdef, v_def.proconfig;
  END IF;

  -- ④d 四個應用角色 × 本檔建的函式都叫不到(有效權限, 不只看直接授權)
  FOR v_rec IN
    SELECT f.fn, r.rol
      FROM unnest(v_functions) AS f(fn)
      CROSS JOIN unnest(ARRAY['anon','authenticated','service_role','payment_confirmer']) AS r(rol)
  LOOP
    IF pg_catalog.has_function_privilege(v_rec.rol, v_rec.fn, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘④d:% 叫得到 %', v_rec.rol, v_rec.fn;
    END IF;
  END LOOP;

  -- ④e 排程:在、指令對、啟用中、執行身分與資料庫、時間
  --    🔴 同名 job 既存且 active = false 時 cron.schedule 不會重新啟用(先例 20260908030000:441-451)
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'pcm-cron-run-log-purge'
                    AND command = 'SELECT public.pcm_cron_run_log_purge();'
                    AND schedule = '17 19 * * *'
                    AND active
                    AND username = current_user
                    AND database = pg_catalog.current_database()) THEN
    RAISE EXCEPTION '事後閘④e:排程 pcm-cron-run-log-purge 不存在, 或指令 / 時間 / 啟用 / 執行身分不對';
  END IF;
  RAISE NOTICE '事後閘 ok:心跳已寫、舊紀錄已清、函式收權、排程啟用。';
END
$post$;

COMMIT;
