\pset pager off
-- 🔴 唯讀。20260905080000(四個 pending view 加 order_source)貼後對帳。
-- 🛑 而【view 存在】對 CREATE OR REPLACE VIEW 零判別力 ⇒ 判準是【欄位集合】, 不是存在性。
-- 🔵 每一格都印【預期值】—— 預期值是貼之前寫下的, 不是照著讀數抄的。

\echo '=== ① 前提:四個 view 在不在(不在 ⇒ 下面每一格都無意義)==='
\echo '    預期:4'
SELECT pg_catalog.count(*) AS 幾個view
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='v'
   AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                     'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending');

\echo ''
\echo '=== ② 🔴 判準:幾個 view 帶 order_source 欄 ==='
\echo '    預期:貼【前】0 · 貼【後】4'
SELECT pg_catalog.count(*) AS 帶order_source的view數
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='public' AND c.relkind='v'
   AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                     'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
   AND a.attname='order_source' AND a.attnum>0 AND NOT a.attisdropped;

\echo ''
\echo '=== ③ 🔴 而【有那一欄】與【它在最後一欄】是兩個宣稱 ==='
\echo '    預期:貼後四列都是 t;任何一個 f = 有人用 DROP+CREATE 重建過而欄序跑了'
SELECT t.relname AS view名, (t.os_num = t.last_num) AS 它在最後一欄
  FROM (SELECT c.relname,
               pg_catalog.max(a.attnum) AS last_num,
               pg_catalog.max(a.attnum) FILTER (WHERE a.attname='order_source') AS os_num
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
         WHERE n.nspname='public' AND c.relkind='v'
           AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                             'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
           AND a.attnum>0 AND NOT a.attisdropped
         GROUP BY c.relname) t
 ORDER BY 1;

\echo ''
\echo '=== 🟢 正對照:同一把尺問一個【一定在】的欄名 ⇒ 該 4 ==='
\echo '    預期:4(它證明這把尺在這四個 view 上會動;若它不是 4, 上面那個數沒有意義)'
SELECT pg_catalog.count(*) AS 正對照_notification_email
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='public' AND c.relkind='v'
   AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                     'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
   AND a.attname='notification_email' AND a.attnum>0 AND NOT a.attisdropped;

\echo ''
\echo '=== 🔵 負對照:同一把尺問一個現造的欄名 ⇒ 該 0 ==='
\echo '    預期:0(它證明這把尺不是對什麼欄名都印命中)'
SELECT pg_catalog.count(*) AS 負對照_zzz
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='public' AND c.relkind='v'
   AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                     'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
   AND a.attname='zzz_never_a_column';

\echo ''
\echo '=== ④ ACL:這四個 view 只該給 service_role SELECT ==='
\echo '    預期:四列都是 t(anon / authenticated / PUBLIC 一個都不該有)'
SELECT c.relname AS view名,
       -- 🔴 codex R2-MF1:表級那一支對【欄級授權】少報 ⇒ 一律用 has_any_column_privilege
       NOT pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT')          AS anon看不到,
       NOT pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT') AS authed看不到,
       pg_catalog.has_any_column_privilege('service_role', c.oid, 'SELECT')      AS service_role看得到
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='v'
   AND c.relname IN ('pcm_order_created_email_pending','pcm_shipped_email_pending',
                     'pcm_tracking_corrected_email_pending','pcm_unpaid_cancelled_email_pending')
 ORDER BY 1;

\echo ''
\echo '=== 🛑 這一份【證不到】什麼 ==='
\echo '    · 它證欄位在, 不證那一欄【填對了值】—— 要那個, 去看實際資料'
\echo '    · 它不證行為沒變。行為那一半由片 A 的探針(拋棄式 PG, 貼前貼後各數一次列)答'
\echo '    · ⛔ ~~has_table_privilege 對欄級授權會少報~~ ⇒ 已全部換成 has_any_column_privilege(codex R2-MF1)'
