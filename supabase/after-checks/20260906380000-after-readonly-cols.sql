-- 20260906380000 的【複驗】—— 唯讀、零寫入。
-- 🔴 帳本那一列的依據是 Sean 貼回來的那張表(轉述);這一支是拿來自己再量一次的。
-- 期望:白名單九欄 t · note / run_ref / last_error 三欄 f。
SELECT c.relname AS 表, a.attname AS 欄,
       pg_catalog.has_column_privilege('pcm_readonly', c.oid, a.attnum, 'SELECT') AS 給了嗎,
       CASE WHEN a.attname IN ('note','run_ref','last_error') THEN '⛔ 刻意不給' ELSE '✅ 白名單' END AS 意圖
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
 WHERE n.nspname='public'
   AND c.relname IN ('supplier_sync_runs','pcm_settle_retry_attempts')
   AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY c.relname, a.attnum;

-- 🔴 而 pcm_incident 那張刻意隱形的表, 表級與欄級都要是 0(它不在上面那張表裡, 單獨問)
SELECT pg_catalog.has_table_privilege('pcm_readonly','public.pcm_incident','SELECT') AS 表級_要f,
       (SELECT count(*) FROM pg_catalog.pg_attribute a
          JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname='pcm_incident'
           AND a.attnum>0 AND NOT a.attisdropped
           AND pg_catalog.has_column_privilege('pcm_readonly', c.oid, a.attnum,'SELECT')) AS 欄級幾欄_要0;
