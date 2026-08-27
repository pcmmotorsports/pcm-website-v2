-- D1t2:pg_cron / pg_net 的 fake 介面 —— **rehearsal 隔離環境專用**(Sean 拍板 T-Q1=A)。
--
-- 🔴 誠實邊界:介面忠實(表形狀、五元組字面、alter_job named-arg 簽章與
-- d1-sweeper-control.ts 的 SQL 常數逐句對齊),**未測真排程器** ——
-- 不會真的排程、不會真的發 HTTP;production 的 pg_cron/pg_net 行為以
-- D1b2 dry-run 對真庫的唯讀 preflight 為準。
-- 型別逐欄釘死(D1t2 關卡1 R2-6):active 是 boolean 非 text(text 'false' 在 Node 判 truthy)、
-- start_time 是 timestamptz、jobid 是 bigint。
BEGIN;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;

CREATE TABLE cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text NOT NULL,
  username text NOT NULL,
  database text NOT NULL,
  schedule text NOT NULL,
  command text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE cron.job_run_details (
  jobid bigint NOT NULL,
  start_time timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL
);

-- named-arg 簽章與 d1-sweeper-control.ts 的呼叫形狀逐字對齊:
--   cron.alter_job(job_id => $1, active => false)
CREATE FUNCTION cron.alter_job(job_id bigint, active boolean) RETURNS void
LANGUAGE sql AS 'UPDATE cron.job SET active = alter_job.active WHERE jobid = alter_job.job_id';

-- headers 欄含 Authorization(production 實況);任何輸出面都不得 SELECT 它。
CREATE TABLE net.http_request_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 五元組逐字 = migration 20260723120000 字面(jobname/username/database/schedule/command)。
INSERT INTO cron.job (jobname, username, database, schedule, command) VALUES
  ('pcm-settle-sweep', 'postgres', 'postgres', '*/2 * * * *',
   $job$SELECT pcm_cron.invoke_cron_route('/api/cron/settle-sweep')$job$);

-- 干擾列(D1t2 R2-6):第二個不同名 job —— 五元組定位必須仍恰一列。
INSERT INTO cron.job (jobname, username, database, schedule, command) VALUES
  ('pcm-anomaly-alert', 'postgres', 'postgres', '0 1 * * *',
   $job$SELECT pcm_cron.invoke_cron_route('/api/cron/anomaly-alert')$job$);

COMMIT;
