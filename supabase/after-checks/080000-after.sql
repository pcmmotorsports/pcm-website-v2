\pset pager off
-- 🔴🔴 `psql -f` 的 rc 在【中間某格 ERROR】與【全對】兩個世界**都是 0**
--    ⇒ 沒有這一行的話, 早上 Sean 看到的那個 rc 對兩個世界印同一個東西。
--    🔬 2026-09-05 實測:一支只有 `SELECT * FROM 不存在的表;` 的 .sql ⇒ **rc=0**。
--    ⚠️ 加它的前提是本檔【沒有故意要噴錯的格】—— 加之前逐支跑過一次:真 psql 錯誤 0
--       (🟢 而那把尺我先用一支故意壞掉的 SQL 驗過會數到 1;
--        🔴 第一版我用 `grep -ci ERROR`, 它把工具自己那句含 `ON_ERROR_STOP` 的警告
--           數成一個 error ⇒ 四支各多報 1 —— 一個【講 error 的句子】被數成 error)。
\set ON_ERROR_STOP on
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
\echo '=== ⑤ 🔴 那四支函式 service_role 還叫得動嗎(R3-C1)==='
\echo '    預期:四列皆 t。任何一個 f ⇒ 這四個 invoker view【查一次錯一次】而上面每一格照樣綠'
\echo '    (它們是 security_invoker view ⇒ body 裡的函式用【呼叫者】權限跑)'
SELECT p.proname AS 函式,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role叫得動,
       NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')     AS anon叫不動
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('pcm_js_trim_whitespace','pcm_shipped_email_dedup_key',
                     'pcm_tracking_corrected_at_key','pcm_tracking_corrected_dedup_key')
 ORDER BY 1;

\echo ''
\echo '=== 🟢 正對照:同一把尺問一支【一定叫得動】的函式 ⇒ 該 t ==='
\echo '    預期:t(若它是 f, 上面那四個 t 沒有意義 —— 那表示這把尺在這裡不會動)'
SELECT pg_catalog.has_function_privilege('service_role', 'pg_catalog.now()'::regprocedure, 'EXECUTE') AS 正對照_now;

\echo ''
\echo '=== 🛑 這一份【證不到】什麼 ==='
\echo '    · 它證欄位在, 不證那一欄【填對了值】—— 要那個, 去看實際資料'
\echo '    · 它不證行為沒變。行為那一半由片 A 的探針(拋棄式 PG, 貼前貼後各數一次列)答'
\echo '    · 🔴 ⑤ 那格問的是【現在】—— 而它答不出「明天有人收緊 EXECUTE 之後會怎樣」'
\echo '      那要等下一支 migration 的自證④ 去擋, 或等有人再跑一次本檔'
\echo '    · 🔴 它不看 ALTER DATABASE / ALTER ROLE ... SET 那一層(R3-C3 同族)——'
\echo '      一個在角色層改掉的預設, 本檔每一格照樣綠'
\echo '    · 它問的是【權限】不是【資料】—— 那一欄有沒有填對, 這一份一個字都答不出來' 
\echo '    · ⛔ ~~has_table_privilege 對欄級授權會少報~~ ⇒ 已全部換成 has_any_column_privilege(codex R2-MF1)'
